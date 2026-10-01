<?php
/**
 * EDESK STATIONERY - Cash Audit history
 *
 * Any logged-in user (admin or worker) can save a filled Cash Audit sheet
 * for a day - it is stored under their own name/role, taken from their
 * session, never from anything the browser sends. Every save adds a new
 * row (it does not overwrite an earlier one), so the day's audit trail
 * shows every time it was filled and by whom - exactly what "history"
 * means here. Anyone (admin or worker) can list and view this history;
 * nothing about it is restricted to a single worker or to admins only.
 *
 * The cash/electronic/credit/expense totals are always recomputed here
 * from the real sales/expenses rows for that date - never trusted from
 * the browser - so a saved entry always reflects what actually happened
 * that day, even if someone tampered with the request.
 *
 * Credit/debt: Total Sales still includes credit sales, but Expected Cash only
 * counts money actually received - credit sales are taken back out, and debts
 * that customers paid in cash on that day are added (see helpers/cash_audit_helper.php).
 * Bank deposits are recorded through api/bank_deposits.php and are picked up here.
 *
 * GET ?summary=YYYY-MM-DD  -> that day's debt repayments, outstanding debts and bank deposits
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/float_helper.php';
require_once __DIR__ . '/../helpers/cash_audit_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

function upgrade_needed_message(): string
{
    return 'The Cash Audit upgrade has not been applied yet. Please run Backend/upgrade_v6_cash_audit_enhancements.php once, then try again.';
}

if ($method === 'GET') {
    // ---- One day's debt repayments, outstanding debts and bank deposits (for Part B) ----
    if (!empty($_GET['summary'])) {
        $date = clean($_GET['summary']);
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
            respond(false, null, 'Invalid date.', 422);
        }
        respond(true, [
            'debt'     => get_debt_day_summary($pdo, $date),
            'deposits' => get_deposit_day_summary_safe($pdo, $date),
        ]);
    }

    // ---- Single entry (for the "View" / print / download-again screen) ----
    if (!empty($_GET['id'])) {
        $stmt = $pdo->prepare('SELECT * FROM cash_audits WHERE id = ?');
        $stmt->execute([(int)$_GET['id']]);
        $row = $stmt->fetch();
        if (!$row) respond(false, null, 'Cash audit entry not found.', 404);
        $row['denominations'] = json_decode($row['denominations'] ?? '[]', true) ?: [];
        $row['debt_payments'] = json_decode($row['debt_payments'] ?? '[]', true) ?: [];
        respond(true, $row);
    }

    // ---- History list, with time filtration ----
    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['start'])) { $where .= ' AND audit_date >= ?'; $params[] = clean($_GET['start']); }
    if (!empty($_GET['end']))   { $where .= ' AND audit_date <= ?'; $params[] = clean($_GET['end']); }
    if (!empty($_GET['saved_by'])) { $where .= ' AND saved_by = ?'; $params[] = (int)$_GET['saved_by']; }
    // Time-of-day filter on when the sheet was saved (HH:MM), on top of the date range.
    if (!empty($_GET['start_time']) && preg_match('/^\d{2}:\d{2}$/', $_GET['start_time'])) {
        $where .= ' AND TIME(created_at) >= ?'; $params[] = $_GET['start_time'] . ':00';
    }
    if (!empty($_GET['end_time']) && preg_match('/^\d{2}:\d{2}$/', $_GET['end_time'])) {
        $where .= ' AND TIME(created_at) <= ?'; $params[] = $_GET['end_time'] . ':59';
    }
    if (!empty($_GET['q'])) {
        $where .= ' AND (cashier LIKE ? OR shift LIKE ? OR saved_by_name LIKE ? OR note LIKE ? OR user_remark LIKE ? OR bank_deposit_remark LIKE ?)';
        $q = '%' . clean($_GET['q']) . '%';
        array_push($params, $q, $q, $q, $q, $q, $q);
    }
    $limit = !empty($_GET['limit']) ? min((int)$_GET['limit'], 1000) : 200;

    try {
        $stmt = $pdo->prepare("SELECT id, audit_date, cashier, shift, opening_cash, cash_sales, electronic_sales,
                                       credit_sales, total_sales, expenses, counted_cash, expected_cash, variance,
                                       calc_version, debt_collected, outstanding_debts,
                                       total_cash, bank_deposit, remaining_cash, note, user_remark, bank_deposit_remark,
                                       saved_by, saved_by_name, saved_by_role, created_at
                                FROM cash_audits
                                $where
                                ORDER BY audit_date DESC, id DESC
                                LIMIT $limit");
        $stmt->execute($params);
    } catch (PDOException $e) {
        if ($e->getCode() === '42S22') respond(false, null, upgrade_needed_message(), 500);
        throw $e;
    }
    $rows = $stmt->fetchAll();

    // Distinct people who have ever saved an audit, for the "Saved By" filter -
    // works the same way audit_log.php builds its user filter list.
    $saversStmt = $pdo->query('SELECT DISTINCT saved_by AS id, saved_by_name AS name FROM cash_audits
                                WHERE saved_by IS NOT NULL ORDER BY saved_by_name ASC');
    $savers = $saversStmt->fetchAll();

    respond(true, ['entries' => $rows, 'savers' => $savers]);
}

if ($method === 'POST') {
    $d = body();
    $missing = missing_fields($d, ['audit_date']);
    if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);

    $auditDate = clean($d['audit_date']);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $auditDate)) {
        respond(false, null, 'Invalid audit date.', 422);
    }

    // Recompute the day's figures ourselves from sale_transactions/expenses -
    // matches the exact grouping the Cash Audit screen shows.
    $cash = 0; $electronic = 0; $credit = 0;
    $sStmt = $pdo->prepare('SELECT payment_method, cash_type, total_amount FROM sale_transactions WHERE sale_date = ?');
    $sStmt->execute([$auditDate]);
    foreach ($sStmt->fetchAll() as $s) {
        $amt = (float)$s['total_amount'];
        if ($s['payment_method'] === 'credit') $credit += $amt;
        elseif ($s['cash_type'] === 'online') $electronic += $amt;
        else $cash += $amt;
    }
    $eStmt = $pdo->prepare('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE expense_date = ?');
    $eStmt->execute([$auditDate]);
    $expenses = (float)$eStmt->fetchColumn();

    // Opening cash is no longer typed in: it is the day's float (opening cash
    // + anything added - anything reduced), recorded from the Opening Cash screen.
    try {
        $opening = max(0.0, get_float_summary($pdo, $auditDate)['total']);
    } catch (PDOException $e) {
        respond(false, null, 'Opening cash is not set up yet. Please run Backend/upgrade_add_cash_float.php once, then try again.', 500);
    }
    $total = $cash + $electronic + $credit;

    // Credit sales are in Total Sales but no money came in for them; debts customers paid in cash
    // on this date did come in. Debts paid online are listed but are not drawer cash.
    try {
        $debt = get_debt_day_summary($pdo, $auditDate);
    } catch (PDOException $e) {
        respond(false, null, 'Could not work out the debt payments for this date. Please make sure Backend/upgrade_v4_sales_customers.php has been run. (Detail: ' . $e->getMessage() . ')', 500);
    }
    $debtCash = $debt['collected_cash'];
    $expected = (($opening + $total) - $credit + $debtCash) - $expenses;

    $denoms = [];
    $counted = 0;
    if (!empty($d['denominations']) && is_array($d['denominations'])) {
        foreach ($d['denominations'] as $row) {
            $denom = (int)($row['denom'] ?? 0);
            $qty = max(0, (int)($row['qty'] ?? 0));
            $remark = clean($row['remark'] ?? '');
            if ($denom <= 0) continue;
            $counted += $denom * $qty;
            if ($qty > 0 || $remark !== '') $denoms[] = ['denom' => $denom, 'qty' => $qty, 'remark' => $remark];
        }
    }
    $variance = $counted - $expected;

    // Bank deposits already recorded for this date (through the Bank Deposit button).
    $deposits = get_deposit_day_summary_safe($pdo, $auditDate);
    $bankDeposit = $deposits['total'];
    $remainingCash = $counted - $bankDeposit;
    $depositRemarks = [];
    foreach ($deposits['entries'] as $dep) {
        if (trim((string)$dep['remark']) !== '') $depositRemarks[] = trim($dep['remark']);
    }

    try {
        $stmt = $pdo->prepare('INSERT INTO cash_audits
            (audit_date, cashier, shift, opening_cash, cash_sales, electronic_sales, credit_sales, total_sales,
             expenses, counted_cash, expected_cash, variance, note, denominations,
             calc_version, debt_collected, debt_collected_online, outstanding_debts, debt_payments,
             user_remark, total_cash, bank_deposit, remaining_cash, bank_deposit_remark,
             saved_by, saved_by_name, saved_by_role, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,2,?,?,?,?,?,?,?,?,?,?,?,?,NOW())');
        $stmt->execute([
            $auditDate,
            clean($d['cashier'] ?? ''),
            clean($d['shift'] ?? ''),
            $opening,
            $cash, $electronic, $credit, $total,
            $expenses, $counted, $expected, $variance,
            clean($d['note'] ?? ''),
            json_encode($denoms),
            $debtCash, $debt['collected_online'], $debt['outstanding'], json_encode($debt['payments']),
            mb_substr(clean($d['user_remark'] ?? ''), 0, 1000),
            $counted, $bankDeposit, $remainingCash,
            $depositRemarks ? implode(' | ', $depositRemarks) : null,
            $user['id'], $user['full_name'], $user['role'],
        ]);
    } catch (PDOException $e) {
        if ($e->getCode() === '42S22') respond(false, null, upgrade_needed_message(), 500);
        throw $e;
    }
    $newId = $pdo->lastInsertId();

    // Link this day's bank deposits to the audit just saved.
    if ($deposits['entries']) sync_day_deposits($pdo, $auditDate);

    log_activity($pdo, $user, 'create', 'cash_audit', $newId,
        'Saved cash audit for ' . $auditDate . ' - counted TZS ' . number_format($counted)
        . ', expected TZS ' . number_format($expected)
        . ($bankDeposit > 0 ? ', banked TZS ' . number_format($bankDeposit) . ', remaining TZS ' . number_format($remainingCash) : ''));

    respond(true, ['id' => $newId], 'Cash audit saved to history.');
}

if ($method === 'DELETE') {
    // Kept admin-only, the same way the Activity Log is read-only from the
    // UI - a history that anyone can erase isn't a reliable history.
    require_role(['admin']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Cash audit id is required.', 422);

    $lookup = $pdo->prepare('SELECT audit_date, cashier FROM cash_audits WHERE id = ?');
    $lookup->execute([$id]);
    $row = $lookup->fetch();
    $pdo->prepare('DELETE FROM cash_audits WHERE id = ?')->execute([$id]);
    if ($row) {
        log_activity($pdo, $user, 'delete', 'cash_audit', $id, 'Deleted cash audit entry for ' . $row['audit_date']
            . ($row['cashier'] ? ' (' . $row['cashier'] . ')' : ''));
    }
    respond(true, null, 'Cash audit entry removed.');
}

respond(false, null, 'Unsupported method.', 405);
