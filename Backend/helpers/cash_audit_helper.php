<?php
/**
 * EDESK STATIONERY - Cash Audit helpers (credit/debt + bank deposits)
 *
 * Shared by api/cash_audit.php and api/bank_deposits.php so both always
 * work out the same figures.
 *
 * Expected Cash (calc_version 2):
 *   Actual Cash Available = Opening Cash + (Total Sales - On Credit Sales) + Debts collected in cash
 *   Expected Cash         = Actual Cash Available - Expenses
 *
 * A credit sale is part of Total Sales but no money came in, so it is taken
 * back out. When a customer later pays a debt in cash, the amount actually
 * paid is added on the day it was paid (full or partial payment).
 * Debts paid ONLINE are listed but not added - that money is not in the drawer.
 */

/** Rounds money the way the rest of the app stores it. */
function ca_money($v): float
{
    return round((float)$v, 2);
}

/**
 * Debt repayments received ON $date, plus what customers still owe at the end of that date.
 *
 * Each payment shows: customer, the debt before this payment ("previous_debt"), the amount paid,
 * what is left ("remaining_debt") and how much of it went into Expected Cash ("added_to_expected").
 * If a debt is paid in several instalments the same day, each one is worked out in order.
 */
function get_debt_day_summary(PDO $pdo, string $date): array
{
    $stmt = $pdo->prepare('SELECT dp.id, dp.sale_id, dp.amount, dp.method, dp.online_method, dp.payment_date, dp.created_at,
                                  s.customer_name, s.total_amount, s.sale_date
                           FROM debt_payments dp
                           JOIN sale_transactions s ON s.id = dp.sale_id
                           WHERE dp.payment_date = ?
                           ORDER BY dp.id ASC');
    $stmt->execute([$date]);
    $todays = $stmt->fetchAll();

    $payments = [];
    $collectedCash = 0.0;
    $collectedOnline = 0.0;

    if ($todays) {
        // Everything paid on these debts up to the end of $date, in the order it happened.
        $saleIds = array_values(array_unique(array_map(fn($r) => (int)$r['sale_id'], $todays)));
        $in = implode(',', array_fill(0, count($saleIds), '?'));
        $hist = $pdo->prepare("SELECT id, sale_id, amount, payment_date FROM debt_payments
                               WHERE sale_id IN ($in) AND payment_date <= ?
                               ORDER BY payment_date ASC, id ASC");
        $hist->execute(array_merge($saleIds, [$date]));
        $paidBefore = []; // payment id => amount already paid on that debt before it
        $running = [];    // sale id => running total
        foreach ($hist->fetchAll() as $h) {
            $sid = (int)$h['sale_id'];
            $paidBefore[(int)$h['id']] = $running[$sid] ?? 0.0;
            $running[$sid] = ($running[$sid] ?? 0.0) + (float)$h['amount'];
        }

        foreach ($todays as $r) {
            $amount = ca_money($r['amount']);
            $before = $paidBefore[(int)$r['id']] ?? 0.0;
            $previousDebt = max(ca_money((float)$r['total_amount'] - $before), 0);
            $remaining = max(ca_money($previousDebt - $amount), 0);
            $isCash = ($r['method'] !== 'online');
            $added = $isCash ? $amount : 0.0;

            if ($isCash) $collectedCash += $amount; else $collectedOnline += $amount;

            $payments[] = [
                'id'                => (int)$r['id'],
                'sale_id'           => (int)$r['sale_id'],
                'customer_name'     => trim((string)$r['customer_name']) !== '' ? $r['customer_name'] : 'A customer',
                'sale_date'         => $r['sale_date'],
                'previous_debt'     => $previousDebt,
                'amount_paid'       => $amount,
                'remaining_debt'    => $remaining,
                'method'            => $isCash ? 'cash_in_hand' : 'online',
                'online_method'     => $r['online_method'],
                'added_to_expected' => $added,
                'paid_at'           => $r['created_at'],
            ];
        }
    }

    // What customers still owe at the end of $date (credit sales up to then, less repayments up to then).
    $o = $pdo->prepare("SELECT COUNT(*) AS debts, COUNT(DISTINCT x.who) AS debtors, COALESCE(SUM(x.left_amt), 0) AS outstanding
                        FROM (
                          SELECT s.id,
                                 COALESCE(NULLIF(s.customer_id, 0), CONCAT('n:', s.customer_name)) AS who,
                                 s.total_amount - COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp
                                                            WHERE dp.sale_id = s.id AND dp.payment_date <= ?), 0) AS left_amt
                          FROM sale_transactions s
                          WHERE s.payment_method = 'credit' AND s.sale_date <= ?
                        ) x
                        WHERE x.left_amt > 0.009");
    $o->execute([$date, $date]);
    $out = $o->fetch();

    return [
        'date'             => $date,
        'payments'         => $payments,
        'collected_cash'   => ca_money($collectedCash),
        'collected_online' => ca_money($collectedOnline),
        'outstanding'      => ca_money($out['outstanding'] ?? 0),
        'open_debts'       => (int)($out['debts'] ?? 0),
        'debtors'          => (int)($out['debtors'] ?? 0),
    ];
}

/** All bank deposits recorded for a date, oldest first, with the day's running totals. */
function get_deposit_day_summary(PDO $pdo, string $date): array
{
    $stmt = $pdo->prepare('SELECT id, deposit_date, audit_id, total_cash, amount, remaining_cash, remark,
                                  saved_by, saved_by_name, saved_by_role, created_at
                           FROM bank_deposits WHERE deposit_date = ? ORDER BY id ASC');
    $stmt->execute([$date]);
    $rows = $stmt->fetchAll();

    $total = 0.0;
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['total_cash'] = (float)$r['total_cash'];
        $r['amount'] = (float)$r['amount'];
        $r['remaining_cash'] = (float)$r['remaining_cash'];
        $total += $r['amount'];
    }
    unset($r);

    return [
        'date'      => $date,
        'total'     => ca_money($total),
        'entries'   => $rows,
    ];
}

/** Bank-deposit figures for a date, or zeros if the v6 upgrade has not been run yet. */
function get_deposit_day_summary_safe(PDO $pdo, string $date): array
{
    try {
        return get_deposit_day_summary($pdo, $date);
    } catch (PDOException $e) {
        if ($e->getCode() === '42S02') return ['date' => $date, 'total' => 0.0, 'entries' => []];
        throw $e;
    }
}

/**
 * Keeps everything for one date in step after a deposit is added or removed, or an audit is saved:
 *  - each deposit's "remaining cash" = its total cash minus all deposits that day up to and including it
 *  - every deposit of the date is linked to the latest audit of that date
 *  - the latest audit of that date shows the day's total deposited, the remaining cash and the deposit remarks
 * Nothing about the audit's own count, sales or remarks is touched.
 */
function sync_day_deposits(PDO $pdo, string $date): void
{
    $latest = $pdo->prepare('SELECT id, counted_cash FROM cash_audits WHERE audit_date = ? ORDER BY id DESC LIMIT 1');
    $latest->execute([$date]);
    $audit = $latest->fetch();

    $stmt = $pdo->prepare('SELECT id, total_cash, amount, remark FROM bank_deposits WHERE deposit_date = ? ORDER BY id ASC');
    $stmt->execute([$date]);
    $deposits = $stmt->fetchAll();

    $cumulative = 0.0;
    $remarks = [];
    $upd = $pdo->prepare('UPDATE bank_deposits SET remaining_cash = ?, audit_id = ? WHERE id = ?');
    foreach ($deposits as $d) {
        $cumulative += (float)$d['amount'];
        $upd->execute([ca_money((float)$d['total_cash'] - $cumulative), $audit ? (int)$audit['id'] : null, (int)$d['id']]);
        if (trim((string)$d['remark']) !== '') $remarks[] = trim($d['remark']);
    }

    if ($audit) {
        $counted = (float)$audit['counted_cash'];
        $pdo->prepare('UPDATE cash_audits SET total_cash = ?, bank_deposit = ?, remaining_cash = ?, bank_deposit_remark = ? WHERE id = ?')
            ->execute([
                ca_money($counted), ca_money($cumulative), ca_money($counted - $cumulative),
                $remarks ? implode(' | ', $remarks) : null,
                (int)$audit['id'],
            ]);
    }
}
