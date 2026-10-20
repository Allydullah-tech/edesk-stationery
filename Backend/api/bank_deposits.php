<?php
/**
 * EDESK STATIONERY - Bank Deposit & Closing Cash
 *
 * Any logged-in user (admin or worker) can record a bank deposit after the
 * cash has been counted. Each deposit is its own record, stamped with who
 * made it (from the session, never from the browser) and when.
 *
 *   Total Cash     = the cash counted in Part A of the Cash Audit (worked out here from the
 *                    denominations sent - the browser's total is never trusted)
 *   Bank Deposit   = what was taken to the bank (all of that day's deposits added up)
 *   Remaining Cash = Total Cash - Bank Deposit  -> the cash left at the office.
 *                    It automatically becomes the next day's Opening Cash
 *                    (see helpers/float_helper.php - it can still be changed by hand).
 *
 * A deposit can be recorded for ANY past day (a worker who forgot Monday's deposit can add it on Tuesday by
 * choosing Monday's date), and a photo of the bank receipt can be attached. When a deposit is added to an
 * earlier day, that day's Cash Audit and the next day's Opening Cash / Expected Cash follow automatically
 * (see sync_day_deposits() and ca_apply_next_opening() in helpers/cash_audit_helper.php).
 *
 * GET ?date=YYYY-MM-DD                       -> that day's deposits and totals (+ the cash count already known for that day)
 * GET ?start=&end=&start_time=&end_time=&saved_by=&q=&limit=  -> history list
 * POST {deposit_date, denominations[], amount, remark, receipt(file)}  -> record a deposit (JSON, or multipart when a photo is attached)
 * DELETE ?id=                                                  -> admin only
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/float_helper.php';
require_once __DIR__ . '/../helpers/cash_audit_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

function valid_deposit_date($s): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', (string)$s, $m)) return false;
    return checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

/** The day's figures plus what tomorrow's Opening Cash will be. */
function deposit_day_payload(PDO $pdo, string $date, ?float $totalCash = null): array
{
    $day = get_deposit_day_summary($pdo, $date);
    if ($totalCash === null && $day['entries']) {
        $totalCash = (float)$day['entries'][0]['total_cash'];
    }
    $day['total_cash'] = $totalCash === null ? null : ca_money($totalCash);
    $day['remaining_cash'] = $totalCash === null ? null : ca_money($totalCash - $day['total']);
    $known = bd_known_cash($pdo, $date);          // cash count already saved for that day (Cash Audit, or an earlier deposit)
    $day['known_cash'] = $known['amount'];
    $day['known_cash_source'] = $known['source'];
    return $day;
}

try {
    if ($method === 'GET') {
        // ---- One day ----
        if (!empty($_GET['date'])) {
            $date = clean($_GET['date']);
            if (!valid_deposit_date($date)) respond(false, null, 'Invalid date.', 422);
            respond(true, deposit_day_payload($pdo, $date));
        }

        // ---- History list, with date + time filtration ----
        $where = 'WHERE 1=1';
        $params = [];
        if (!empty($_GET['start'])) { $where .= ' AND b.deposit_date >= ?'; $params[] = clean($_GET['start']); }
        if (!empty($_GET['end']))   { $where .= ' AND b.deposit_date <= ?'; $params[] = clean($_GET['end']); }
        if (!empty($_GET['start_time']) && preg_match('/^\d{2}:\d{2}$/', $_GET['start_time'])) {
            $where .= ' AND TIME(b.created_at) >= ?'; $params[] = $_GET['start_time'] . ':00';
        }
        if (!empty($_GET['end_time']) && preg_match('/^\d{2}:\d{2}$/', $_GET['end_time'])) {
            $where .= ' AND TIME(b.created_at) <= ?'; $params[] = $_GET['end_time'] . ':59';
        }
        if (!empty($_GET['saved_by'])) { $where .= ' AND b.saved_by = ?'; $params[] = (int)$_GET['saved_by']; }
        if (!empty($_GET['q'])) {
            $where .= ' AND (b.remark LIKE ? OR b.saved_by_name LIKE ? OR a.user_remark LIKE ?)';
            $q = '%' . clean($_GET['q']) . '%';
            array_push($params, $q, $q, $q);
        }
        $limit = !empty($_GET['limit']) ? min((int)$_GET['limit'], 1000) : 200;

        $receiptCol = bd_receipt_column_ready($pdo) ? '(b.receipt_file IS NOT NULL) AS has_receipt,' : '0 AS has_receipt,';
        $stmt = $pdo->prepare("SELECT b.id, b.deposit_date, b.audit_id, b.total_cash, b.amount, b.remaining_cash, b.remark,
                                      b.saved_by, b.saved_by_name, b.saved_by_role, b.created_at, $receiptCol
                                      a.user_remark AS audit_remark
                               FROM bank_deposits b
                               LEFT JOIN cash_audits a ON a.id = b.audit_id
                               $where
                               ORDER BY b.deposit_date DESC, b.id DESC
                               LIMIT $limit");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) $row['has_receipt'] = (bool)$row['has_receipt'];
        unset($row);

        $savers = $pdo->query('SELECT DISTINCT saved_by AS id, saved_by_name AS name FROM bank_deposits
                               WHERE saved_by IS NOT NULL ORDER BY saved_by_name ASC')->fetchAll();

        respond(true, ['entries' => $rows, 'savers' => $savers]);
    }

    if ($method === 'POST') {
        // A photo makes the browser send multipart/form-data. If the photo is bigger than the server accepts at all,
        // PHP drops the whole request - say so clearly instead of complaining about a missing date.
        if (empty($_POST) && empty($_FILES) && !empty($_SERVER['CONTENT_LENGTH'])
            && stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') !== false) {
            respond(false, null, 'That photo is too large for the server to accept. Please take a smaller photo and try again.', 422);
        }
        $d = body();

        $date = clean($d['deposit_date'] ?? '');
        if (!valid_deposit_date($date)) respond(false, null, 'Please choose a valid date.', 422);
        if ($date > today()) respond(false, null, 'The deposit date cannot be in the future.', 422);

        // Total Cash = the cash counted in Part A, recomputed from the denominations. A deposit for another (earlier)
        // day sends no count: it is taken out of the cash already saved for that day in the Cash Audit.
        $denoms = $d['denominations'] ?? [];
        if (is_string($denoms)) $denoms = json_decode($denoms, true) ?: [];
        $counted = 0;
        if (is_array($denoms)) {
            foreach ($denoms as $row) {
                $denom = (int)($row['denom'] ?? 0);
                $qty = max(0, (int)($row['qty'] ?? 0));
                if ($denom > 0) $counted += $denom * $qty;
            }
        }
        if ($counted <= 0) {
            $counted = bd_known_cash($pdo, $date)['amount'];
        }
        if ($counted <= 0) {
            respond(false, null, 'No cash count has been saved for ' . $date . ' yet. Open that date on the Cash Audit sheet, count the cash in Part A and save it, then record the deposit.', 422);
        }

        if (!isset($d['amount']) || !is_numeric($d['amount'])) respond(false, null, 'Please enter the amount deposited.', 422);
        $amount = round((float)$d['amount'], 2);
        if ($amount <= 0) respond(false, null, 'The bank deposit must be more than zero.', 422);

        $already = get_deposit_day_summary($pdo, $date)['total'];
        $available = $counted - $already;
        $dayWord = $date === today() ? 'today' : 'on that day';
        if ($amount > $available + 0.001) {
            respond(false, null, 'The bank deposit (TZS ' . number_format($amount) . ') is more than the cash left to bank (TZS '
                . number_format(max($available, 0)) . ($already > 0 ? ', after TZS ' . number_format($already) . ' already deposited ' . $dayWord : '') . ').', 422);
        }
        $remaining = round($available - $amount, 2);

        $remark = mb_substr(clean($d['remark'] ?? ''), 0, 1000);

        // Receipt photo (optional). Checked and stored before anything is written to the database.
        $receipt = null;
        if (!empty($_FILES['receipt']) && (int)$_FILES['receipt']['error'] !== UPLOAD_ERR_NO_FILE) {
            if (!bd_receipt_column_ready($pdo)) respond(false, null, bd_receipt_upgrade_message(), 500);
            $receipt = bd_store_receipt($_FILES['receipt'], $date);
        }

        $auditIdStmt = $pdo->prepare('SELECT id FROM cash_audits WHERE audit_date = ? ORDER BY id DESC LIMIT 1');
        $auditIdStmt->execute([$date]);
        $auditId = $auditIdStmt->fetchColumn() ?: null;

        // Remember what the next saved Cash Audit's opening cash is now, so it can follow if this deposit changes it.
        $nextBefore = ca_snapshot_next_opening($pdo, $date);

        try {
            $pdo->beginTransaction();
            $stmt = $pdo->prepare('INSERT INTO bank_deposits
                (deposit_date, audit_id, total_cash, amount, remaining_cash, remark, saved_by, saved_by_name, saved_by_role, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,NOW())');
            $stmt->execute([$date, $auditId, $counted, $amount, $remaining, $remark, $user['id'], $user['full_name'], $user['role']]);
            $newId = $pdo->lastInsertId();
            if ($receipt) {
                $pdo->prepare('UPDATE bank_deposits SET receipt_file = ?, receipt_mime = ? WHERE id = ?')->execute([$receipt['file'], $receipt['mime'], $newId]);
            }

            // Keeps the day's latest saved Cash Audit showing the deposit and remaining cash...
            sync_day_deposits($pdo, $date);
            // ...and, for an earlier day, the next day's saved Cash Audit (opening cash -> expected cash -> variance).
            $audits = ca_apply_next_opening($pdo, $nextBefore);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($receipt) bd_delete_receipt_file($receipt['file']);
            throw $e;
        }

        $backdated = $date < today();
        log_activity($pdo, $user, 'create', 'bank_deposit', $newId,
            'Bank deposit of TZS ' . number_format($amount) . ' for ' . $date . ($backdated ? ' (recorded late, on ' . today() . ')' : '')
            . ' (cash counted TZS ' . number_format($counted) . ', remaining TZS ' . number_format($remaining) . ')'
            . ($receipt ? ', receipt photo attached' : '')
            . ($audits > 0 ? ', updated ' . $audits . ' saved cash audit(s) of ' . $nextBefore['date'] : '')
            . ($remark !== '' ? ' - ' . $remark : ''));

        $msg = 'Bank deposit saved' . ($backdated ? ' for ' . $date : '') . '. Remaining cash TZS ' . number_format($remaining) . ' will be the next opening cash.';
        if ($backdated) $msg .= ' The Cash Audit history has been updated.';
        respond(true, deposit_day_payload($pdo, $date, $counted), $msg);
    }

    if ($method === 'DELETE') {
        // Admin-only, the same as the cash audit and float history: a record anyone can erase isn't a reliable record.
        require_role(['admin']);
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) respond(false, null, 'Deposit id is required.', 422);

        $lookup = $pdo->prepare('SELECT * FROM bank_deposits WHERE id = ?');
        $lookup->execute([$id]);
        $row = $lookup->fetch();
        if (!$row) respond(false, null, 'Deposit not found.', 404);

        // Removing a deposit changes that day's Remaining Cash too, so the next saved Cash Audit follows (see POST).
        $nextBefore = ca_snapshot_next_opening($pdo, $row['deposit_date']);
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM bank_deposits WHERE id = ?')->execute([$id]);
            sync_day_deposits($pdo, $row['deposit_date']);
            $audits = ca_apply_next_opening($pdo, $nextBefore);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        bd_delete_receipt_file($row['receipt_file'] ?? null);
        log_activity($pdo, $user, 'delete', 'bank_deposit', $id,
            'Deleted bank deposit of TZS ' . number_format((float)$row['amount']) . ' for ' . $row['deposit_date']
            . (!empty($row['receipt_file']) ? ' (its receipt photo was removed too)' : '')
            . ($audits > 0 ? ', updated ' . $audits . ' saved cash audit(s) of ' . $nextBefore['date'] : ''));
        respond(true, null, 'Bank deposit removed.');
    }

    respond(false, null, 'Unsupported method.', 405);
} catch (PDOException $e) {
    if ($e->getCode() === '42S02' || $e->getCode() === '42S22') { // table/column doesn't exist yet
        respond(false, null, 'Bank deposits are not set up yet. Please run Backend/upgrade_v6_cash_audit_enhancements.php once, then try again.', 500);
    }
    throw $e;
}
