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
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/float_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // ---- Single entry (for the "View" / print / download-again screen) ----
    if (!empty($_GET['id'])) {
        $stmt = $pdo->prepare('SELECT * FROM cash_audits WHERE id = ?');
        $stmt->execute([(int)$_GET['id']]);
        $row = $stmt->fetch();
        if (!$row) respond(false, null, 'Cash audit entry not found.', 404);
        $row['denominations'] = json_decode($row['denominations'] ?? '[]', true) ?: [];
        respond(true, $row);
    }

    // ---- History list, with time filtration ----
    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['start'])) { $where .= ' AND audit_date >= ?'; $params[] = clean($_GET['start']); }
    if (!empty($_GET['end']))   { $where .= ' AND audit_date <= ?'; $params[] = clean($_GET['end']); }
    if (!empty($_GET['saved_by'])) { $where .= ' AND saved_by = ?'; $params[] = (int)$_GET['saved_by']; }
    if (!empty($_GET['q'])) {
        $where .= ' AND (cashier LIKE ? OR shift LIKE ? OR saved_by_name LIKE ? OR note LIKE ?)';
        $q = '%' . clean($_GET['q']) . '%';
        array_push($params, $q, $q, $q, $q);
    }
    $limit = !empty($_GET['limit']) ? min((int)$_GET['limit'], 1000) : 200;

    $stmt = $pdo->prepare("SELECT id, audit_date, cashier, shift, opening_cash, cash_sales, electronic_sales,
                                   credit_sales, total_sales, expenses, counted_cash, expected_cash, variance,
                                   saved_by, saved_by_name, saved_by_role, created_at
                            FROM cash_audits
                            $where
                            ORDER BY audit_date DESC, id DESC
                            LIMIT $limit");
    $stmt->execute($params);
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
    $expected = ($opening + $total) - $expenses;

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

    $stmt = $pdo->prepare('INSERT INTO cash_audits
        (audit_date, cashier, shift, opening_cash, cash_sales, electronic_sales, credit_sales, total_sales,
         expenses, counted_cash, expected_cash, variance, note, denominations,
         saved_by, saved_by_name, saved_by_role, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())');
    $stmt->execute([
        $auditDate,
        clean($d['cashier'] ?? ''),
        clean($d['shift'] ?? ''),
        $opening,
        $cash, $electronic, $credit, $total,
        $expenses, $counted, $expected, $variance,
        clean($d['note'] ?? ''),
        json_encode($denoms),
        $user['id'], $user['full_name'], $user['role'],
    ]);
    $newId = $pdo->lastInsertId();

    log_activity($pdo, $user, 'create', 'cash_audit', $newId,
        'Saved cash audit for ' . $auditDate . ' - counted TZS ' . number_format($counted)
        . ', expected TZS ' . number_format($expected));

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
