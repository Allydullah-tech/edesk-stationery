<?php
/**
 * EDESK STATIONERY - Cash Audit helpers (credit/debt + bank deposits)
 *
 * Shared by api/cash_audit.php and api/bank_deposits.php so both always
 * work out the same figures.
 *
 * Expected Closing Cash (calc_version 2 = old, 3 = current):
 *   Actual Cash Available = Opening Cash + (Total Sales - On Credit Sales) + Debts collected in cash
 *                           [+ Debts collected ONLINE, calc_version 3 only]
 *   Expected Cash         = Actual Cash Available - Expenses
 *
 * A credit sale is part of Total Sales but no money came in, so it is taken
 * back out. When a customer later pays a debt, the amount actually paid is added on
 * the day it was paid (full or partial payment).
 *
 * calc_version 3 (online-aware): money that came in ONLINE (online sales + debts paid online) is part of
 * Expected Closing Cash, and Part A of the sheet now counts it too (Total Counted In Hand + Total Counted
 * Online). So Variance = (Counted In Hand + Counted Online) - Expected Closing Cash, and online money can no
 * longer show up as a false "short". Sheets saved before (calc_version 1 and 2) keep their old figures.
 */
require_once __DIR__ . '/float_helper.php';

/**
 * Part A online money is typed in by the person (a physical check of what was really received), so it is stored
 * in its own two columns. They are added automatically the first time they are needed - no separate upgrade script.
 * NULL = an older sheet that never stored a typed amount (it keeps showing the system figures).
 */
function ca_online_counted_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        if ($pdo->query("SHOW COLUMNS FROM `cash_audits` LIKE 'counted_online_sales'")->rowCount() === 0) {
            $pdo->exec("ALTER TABLE `cash_audits`
                        ADD COLUMN `counted_online_sales` DECIMAL(14,2) NULL DEFAULT NULL,
                        ADD COLUMN `counted_online_debt` DECIMAL(14,2) NULL DEFAULT NULL");
        }
        $ready = true;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

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
            // Cash and online repayments both count towards Expected Closing Cash (online ones are
            // matched by the online total counted in Part A).
            $added = $amount;

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

    // Which deposits have a bank receipt photo attached (only once upgrade_v9 has been run).
    $withReceipt = [];
    if ($rows && bd_receipt_column_ready($pdo)) {
        $ids = array_map(fn($r) => (int)$r['id'], $rows);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $rs = $pdo->prepare("SELECT id FROM bank_deposits WHERE receipt_file IS NOT NULL AND id IN ($in)");
        $rs->execute($ids);
        $withReceipt = array_flip(array_map('intval', $rs->fetchAll(PDO::FETCH_COLUMN)));
    }

    $total = 0.0;
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['total_cash'] = (float)$r['total_cash'];
        $r['amount'] = (float)$r['amount'];
        $r['remaining_cash'] = (float)$r['remaining_cash'];
        $r['has_receipt'] = isset($withReceipt[$r['id']]);
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


/* ---------------------------------------------------------------------------------------------
 * Bank deposit receipts (photo of the bank slip) + back-dated deposits
 * ------------------------------------------------------------------------------------------- */

/** True once upgrade_v9_bank_deposit_receipts.php has been run (the receipt columns exist). */
function bd_receipt_column_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $ready = $pdo->query("SHOW COLUMNS FROM `bank_deposits` LIKE 'receipt_file'")->rowCount() > 0;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

function bd_receipt_upgrade_message(): string
{
    return 'Receipt photos are not set up yet. Please run Backend/upgrade_v9_bank_deposit_receipts.php once, then try again.';
}

/** The private folder receipts are kept in. It is created (and shut off from direct web access) on first use. */
function bd_receipt_dir(): string
{
    $dir = __DIR__ . '/../uploads/bank_receipts';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $ht = $dir . '/.htaccess';
    if (is_dir($dir) && !file_exists($ht)) {
        @file_put_contents($ht, "# Receipts are private: they are only served by api/bank_deposit_receipt.php after login.\n"
            . "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
    }
    if (is_dir($dir) && !file_exists($dir . '/index.html')) @file_put_contents($dir . '/index.html', '');
    return $dir;
}

/**
 * Checks an uploaded receipt photo and stores it under a random name.
 * Returns ['file' => stored name, 'mime' => mime type]. Calls respond() and exits with a clear message if it is not acceptable.
 */
function bd_store_receipt(array $f, string $date): array
{
    $err = (int)($f['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
        respond(false, null, 'That photo is too large for the server. Please take a smaller photo and try again.', 422);
    }
    if ($err !== UPLOAD_ERR_OK || empty($f['tmp_name']) || !is_uploaded_file($f['tmp_name'])) {
        respond(false, null, 'The receipt photo could not be uploaded. Please try again.', 422);
    }
    if ((int)$f['size'] > 8 * 1024 * 1024) {
        respond(false, null, 'The receipt photo is larger than 8 MB. Please use a smaller photo.', 422);
    }
    $types = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    if (!isset($types[$mime]) || @getimagesize($f['tmp_name']) === false) {
        respond(false, null, 'The receipt must be a photo (JPG, PNG or WebP).', 422);
    }
    $dir = bd_receipt_dir();
    if (!is_dir($dir) || !is_writable($dir)) {
        respond(false, null, 'The receipt folder (Backend/uploads/bank_receipts) is not writable on the server.', 500);
    }
    $name = 'dep_' . str_replace('-', '', $date) . '_' . bin2hex(random_bytes(10)) . '.' . $types[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) {
        respond(false, null, 'The receipt photo could not be saved on the server.', 500);
    }
    return ['file' => $name, 'mime' => $mime];
}

/** Deletes a stored receipt file (only ever a plain file name inside the receipt folder). */
function bd_delete_receipt_file(?string $file): void
{
    if (!$file || $file !== basename($file)) return;
    $path = bd_receipt_dir() . '/' . $file;
    if (is_file($path)) @unlink($path);
}

/**
 * The cash counted for a date, as far as the system already knows it:
 * the latest saved Cash Audit's counted cash, else the cash count the day's first deposit was taken from.
 * Used when a deposit is recorded for a day other than the one being counted right now (a back-dated deposit).
 */
function bd_known_cash(PDO $pdo, string $date): array
{
    $a = $pdo->prepare('SELECT counted_cash FROM cash_audits WHERE audit_date = ? ORDER BY id DESC LIMIT 1');
    $a->execute([$date]);
    $counted = $a->fetchColumn();
    if ($counted !== false && (float)$counted > 0) return ['amount' => ca_money($counted), 'source' => 'audit'];

    $b = $pdo->prepare('SELECT total_cash FROM bank_deposits WHERE deposit_date = ? ORDER BY id ASC LIMIT 1');
    $b->execute([$date]);
    $dep = $b->fetchColumn();
    if ($dep !== false && (float)$dep > 0) return ['amount' => ca_money($dep), 'source' => 'deposit'];

    return ['amount' => 0.0, 'source' => null];
}

/**
 * Back-dated deposits: a deposit added to (or removed from) an earlier day changes that day's Remaining Cash,
 * and the Remaining Cash of a day is the next day's Opening Cash. So the next saved Cash Audit after $date
 * has to follow along. Call ca_snapshot_next_opening() BEFORE changing the deposits of $date, then
 * ca_apply_next_opening() AFTER sync_day_deposits(). Only audits whose opening cash was carried over from
 * that day are touched (an opening cash someone typed in by hand is never changed).
 */
function ca_snapshot_next_opening(PDO $pdo, string $date): ?array
{
    try {
        $n = $pdo->prepare('SELECT MIN(audit_date) FROM cash_audits WHERE audit_date > ? AND calc_version >= 2');
        $n->execute([$date]);
        $next = $n->fetchColumn();
        if (!$next) return null;
        $f = get_float_summary($pdo, $next);
        if ($f['opening_source'] !== 'carry_over') return null;
        return ['date' => $next, 'opening' => (float)$f['opening']];
    } catch (PDOException $e) {
        return null;
    }
}

/** Returns how many saved cash audits were brought in line (0 if nothing needed changing). */
function ca_apply_next_opening(PDO $pdo, ?array $before): int
{
    if (!$before) return 0;
    $f = get_float_summary($pdo, $before['date']);
    if ($f['opening_source'] !== 'carry_over') return 0;
    $delta = (float)$f['opening'] - $before['opening'];
    if (abs($delta) < 0.005) return 0;

    // Expected cash moves one-for-one with the opening cash, so each saved sheet of that day is shifted by the same
    // amount and its variance is worked out again from its own counted cash. Nothing else on the sheet is touched.
    $typed = ca_online_counted_ready($pdo) ? ', counted_online_sales, counted_online_debt' : ', NULL AS counted_online_sales, NULL AS counted_online_debt';
    $rows = $pdo->prepare('SELECT id, opening_cash, expected_cash, counted_cash, calc_version, electronic_sales, debt_collected_online' . $typed . '
                           FROM cash_audits WHERE audit_date = ? AND calc_version >= 2');
    $rows->execute([$before['date']]);
    $upd = $pdo->prepare('UPDATE cash_audits SET opening_cash = ?, expected_cash = ?, variance = ? WHERE id = ?');
    $changed = 0;
    foreach ($rows->fetchAll() as $r) {
        $newOpening = max(0.0, (float)$r['opening_cash'] + $delta);
        $applied = $newOpening - (float)$r['opening_cash'];
        $newExpected = ca_money((float)$r['expected_cash'] + $applied);
        // calc_version 3: the online money counted in Part A (online sales + online debt repayments) is part of the count.
        $countedAll = (float)$r['counted_cash'];
        if ((int)$r['calc_version'] >= 3) {
            // typed (physically verified) online amounts; older sheets without them keep the system figures
            $countedAll += $r['counted_online_sales'] !== null
                ? (float)$r['counted_online_sales'] + (float)$r['counted_online_debt']
                : (float)$r['electronic_sales'] + (float)$r['debt_collected_online'];
        }
        $upd->execute([ca_money($newOpening), $newExpected, ca_money($countedAll - $newExpected), (int)$r['id']]);
        $changed++;
    }
    return $changed;
}
