<?php
/**
 * EDESK STATIONERY - Customer Change / Balance Due helpers
 *
 * "Customer change" is money the BUSINESS owes the CUSTOMER: a customer paid
 * more than the sale came to and left without taking the change.
 * It is completely separate from customer debt (money a customer owes the
 * business, payment_method = 'credit'):
 *   - it lives on the original sale (sale_transactions.change_amount),
 *   - each time (part of) it is handed back, one row is added to
 *     sale_change_collections linked to that same sale - no new sale, no debt,
 *   - it is only ever allowed on cash-in-hand sales (the extra money is physically
 *     in the drawer), never on credit or online sales.
 *
 * Cash Audit effect (see get_change_day_summary):
 *   Expected Closing Cash = ((Cash Available + Outstanding Customer Change) - Cash Expenses)
 *   where Outstanding Customer Change is the change left on THIS date's sales that is still unpaid at the
 *   end of the date (cash held in the drawer, not a sale), and Cash Available already has taken off any
 *   change paid out today that was left on an EARLIER day.
 * Change left on earlier days is already inside the opening cash (carried over from the previous
 * closing count), so it is never added a second time. The change is never part of Total Sales or profit.
 */

/** Rounds money the way the rest of the app stores it. */
function chg_money($v): float
{
    return round((float)$v, 2);
}

/**
 * True once Backend/upgrade_v7_customer_change.php has been run (sale column + collections table).
 * Lets every screen keep working exactly as before until the upgrade is applied.
 */
function change_feature_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $col = $pdo->query("SHOW COLUMNS FROM `sale_transactions` LIKE 'change_amount'")->rowCount() > 0;
        $tbl = $pdo->query("SHOW TABLES LIKE 'sale_change_collections'")->rowCount() > 0;
        $ready = $col && $tbl;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

/** True once the cash_audits columns for change exist (same upgrade script). */
function change_audit_columns_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $ready = $pdo->query("SHOW COLUMNS FROM `cash_audits` LIKE 'change_held'")->rowCount() > 0;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

function change_upgrade_message(): string
{
    return 'The Customer Change upgrade has not been applied yet. Please run Backend/upgrade_v7_customer_change.php once, then try again.';
}

/** 'none' | 'pending' | 'partial' | 'collected' */
function change_status($amount, $collected): string
{
    $amount = chg_money($amount);
    $collected = chg_money($collected);
    if ($amount <= 0) return 'none';
    if ($collected <= 0) return 'pending';
    if ($collected + 0.009 < $amount) return 'partial';
    return 'collected';
}

/** Adds change_collected / change_remaining / change_status / change_collected_at to a sale row. */
function decorate_sale_change(array $row): array
{
    $amount = chg_money($row['change_amount'] ?? 0);
    $collected = chg_money($row['change_collected'] ?? 0);
    $row['change_amount'] = $amount;
    $row['change_collected'] = $collected;
    $row['change_remaining'] = max(chg_money($amount - $collected), 0);
    $row['change_status'] = change_status($amount, $collected);
    return $row;
}

/** SQL fragments that add the collected total and last collection time to a sale_transactions query (alias $a). */
function change_select_sql(string $a = 'st'): string
{
    return "COALESCE((SELECT SUM(c.amount) FROM sale_change_collections c WHERE c.sale_id = $a.id), 0) AS change_collected,
            (SELECT MAX(c.created_at) FROM sale_change_collections c WHERE c.sale_id = $a.id) AS change_collected_at";
}

/**
 * Everything the Cash Audit needs about customer change for one date.
 *
 *  held            change customers left on sales dated $date (gross) - cash in the drawer that is not a sale
 *  collected       change handed back to customers on $date - cash that left the drawer
 *  net             held - collected
 *  day_outstanding change left on sales dated $date that is still unpaid at the end of $date
 *                  = the "Outstanding Customer Change" that is added to Expected Closing Cash
 *  paid_prior      change handed back on $date that was left on an EARLIER day (already in the opening
 *                  cash, so it is deducted from Cash Available)
 *  outstanding     change still owed to customers at the end of $date over ALL days (information only)
 *
 * Returns zeros if the upgrade has not been run, so the audit keeps working as before.
 */
function get_change_day_summary(PDO $pdo, string $date): array
{
    $empty = [
        'date' => $date, 'held' => 0.0, 'collected' => 0.0, 'net' => 0.0,
        'day_outstanding' => 0.0, 'paid_prior' => 0.0, 'outstanding' => 0.0, 'open_count' => 0, 'held_entries' => [], 'collected_entries' => [],
    ];
    if (!change_feature_ready($pdo)) return $empty;

    // ---- change left on sales dated $date
    // 'remaining' = what is still unpaid at the end of $date (anything collected up to then is not counted)
    $h = $pdo->prepare("SELECT s.id, s.customer_name, s.change_amount,
                               COALESCE((SELECT SUM(cc.amount) FROM sale_change_collections cc
                                         WHERE cc.sale_id = s.id AND cc.collected_date <= ?), 0) AS paid_to_date
                        FROM sale_transactions s
                        WHERE s.sale_date = ? AND s.change_amount > 0 ORDER BY s.id ASC");
    $h->execute([$date, $date]);
    $heldEntries = [];
    $held = 0.0;
    foreach ($h->fetchAll() as $r) {
        $amt = chg_money($r['change_amount']);
        $held += $amt;
        $heldEntries[] = [
            'sale_id'       => (int)$r['id'],
            'customer_name' => trim((string)$r['customer_name']) !== '' ? $r['customer_name'] : 'A customer',
            'amount'        => $amt,
            'remaining'     => max(chg_money($amt - (float)$r['paid_to_date']), 0),
        ];
    }

    // ---- change handed back on $date (each one shows the balance before and after it)
    $c = $pdo->prepare("SELECT cc.id, cc.sale_id, cc.amount, cc.created_at, s.customer_name, s.change_amount
                        FROM sale_change_collections cc
                        JOIN sale_transactions s ON s.id = cc.sale_id
                        WHERE cc.collected_date = ? ORDER BY cc.id ASC");
    $c->execute([$date]);
    $todays = $c->fetchAll();

    $collectedEntries = [];
    $collected = 0.0;
    if ($todays) {
        $saleIds = array_values(array_unique(array_map(fn($r) => (int)$r['sale_id'], $todays)));
        $in = implode(',', array_fill(0, count($saleIds), '?'));
        $hist = $pdo->prepare("SELECT id, sale_id, amount FROM sale_change_collections
                               WHERE sale_id IN ($in) AND collected_date <= ?
                               ORDER BY collected_date ASC, id ASC");
        $hist->execute(array_merge($saleIds, [$date]));
        $paidBefore = [];
        $running = [];
        foreach ($hist->fetchAll() as $row) {
            $sid = (int)$row['sale_id'];
            $paidBefore[(int)$row['id']] = $running[$sid] ?? 0.0;
            $running[$sid] = ($running[$sid] ?? 0.0) + (float)$row['amount'];
        }
        foreach ($todays as $r) {
            $amt = chg_money($r['amount']);
            $before = max(chg_money((float)$r['change_amount'] - ($paidBefore[(int)$r['id']] ?? 0.0)), 0);
            $collected += $amt;
            $collectedEntries[] = [
                'id'               => (int)$r['id'],
                'sale_id'          => (int)$r['sale_id'],
                'customer_name'    => trim((string)$r['customer_name']) !== '' ? $r['customer_name'] : 'A customer',
                'previous_balance' => $before,
                'amount_collected' => $amt,
                'remaining'        => max(chg_money($before - $amt), 0),
                'collected_at'     => $r['created_at'],
            ];
        }
    }

    // ---- change still owed to customers at the end of $date
    $o = $pdo->prepare("SELECT COUNT(*) AS n, COALESCE(SUM(x.left_amt), 0) AS outstanding
                        FROM (
                          SELECT s.change_amount - COALESCE((SELECT SUM(cc.amount) FROM sale_change_collections cc
                                                              WHERE cc.sale_id = s.id AND cc.collected_date <= ?), 0) AS left_amt
                          FROM sale_transactions s
                          WHERE s.change_amount > 0 AND s.sale_date <= ?
                        ) x
                        WHERE x.left_amt > 0.009");
    $o->execute([$date, $date]);
    $out = $o->fetch();

    // ---- this date's change that is still unpaid at the end of the date (goes into Expected Closing Cash)
    $d1 = $pdo->prepare("SELECT COALESCE(SUM(GREATEST(s.change_amount - COALESCE((SELECT SUM(cc.amount) FROM sale_change_collections cc
                                                                                  WHERE cc.sale_id = s.id AND cc.collected_date <= ?), 0), 0)), 0)
                         FROM sale_transactions s WHERE s.sale_date = ? AND s.change_amount > 0");
    $d1->execute([$date, $date]);
    $dayOutstanding = chg_money($d1->fetchColumn());

    // ---- change paid out on this date that was left on an earlier day
    $d2 = $pdo->prepare("SELECT COALESCE(SUM(cc.amount), 0) FROM sale_change_collections cc
                         JOIN sale_transactions s ON s.id = cc.sale_id
                         WHERE cc.collected_date = ? AND s.sale_date < ?");
    $d2->execute([$date, $date]);
    $paidPrior = chg_money($d2->fetchColumn());

    return [
        'date'              => $date,
        'held'              => chg_money($held),
        'collected'         => chg_money($collected),
        'net'               => chg_money($held - $collected),
        'day_outstanding'   => $dayOutstanding,
        'paid_prior'        => $paidPrior,
        'outstanding'       => chg_money($out['outstanding'] ?? 0),
        'open_count'        => (int)($out['n'] ?? 0),
        'held_entries'      => $heldEntries,
        'collected_entries' => $collectedEntries,
    ];
}
