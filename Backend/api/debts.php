<?php
/**
 * eDESK Print & Digital - Debts (Madeni / Credit Sales) API
 *
 * A credit "sale" here is a sale_transactions row that can contain
 * several products - see Backend/api/sales.php. The item list is
 * summarized (comma-separated names) since a debt can span more than
 * one product now.
 *
 * GET  -> list credit sales with their computed remaining balance.
 *         ?scope=today restricts to sales made today (for the dashboard widget).
 *         ?status=pending|overdue|paid filters by computed status.
 *         ?history=<id> returns full payment history for one credit sale.
 * POST -> record a repayment against a credit sale.
 *         body: { sale_id, amount, method, online_method, payment_date, note }
 *         Recording a payment re-checks the customer's overdue count and
 *         may lift them out of/into DEBT RESTRICTED status.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/customer_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

function debt_base_query(): string {
    return "SELECT s.id, s.sale_date, s.credit_deadline, s.customer_id, s.customer_name, s.customer_phone, s.total_amount,
                   u.full_name AS sold_by_name,
                   (SELECT GROUP_CONCAT(p.name SEPARATOR ', ') FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.transaction_id = s.id) AS item_names,
                   COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = s.id), 0) AS paid_amount
            FROM sale_transactions s
            JOIN users u ON u.id = s.sold_by
            WHERE s.payment_method = 'credit'";
}

if ($method === 'GET' && !empty($_GET['history'])) {
    // Full payment history for a single debt/credit sale: every payment
    // ever made against it, plus the original amount and remaining balance.
    $saleId = (int)$_GET['history'];
    $stmt = $pdo->prepare("SELECT s.id, s.sale_date, s.credit_deadline, s.customer_name, s.customer_phone, s.total_amount,
                                   (SELECT GROUP_CONCAT(p.name SEPARATOR ', ') FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.transaction_id = s.id) AS item_names
                            FROM sale_transactions s WHERE s.id = ? AND s.payment_method = 'credit'");
    $stmt->execute([$saleId]);
    $sale = $stmt->fetch();
    if (!$sale) respond(false, null, 'Credit sale not found.', 404);

    $pStmt = $pdo->prepare('SELECT dp.payment_date, dp.amount, dp.method, dp.online_method, dp.note, u.full_name AS recorded_by_name
                             FROM debt_payments dp JOIN users u ON u.id = dp.recorded_by
                             WHERE dp.sale_id = ? ORDER BY dp.payment_date ASC, dp.id ASC');
    $pStmt->execute([$saleId]);
    $payments = $pStmt->fetchAll();

    $totalPaid = 0;
    foreach ($payments as $p) { $totalPaid += (float)$p['amount']; }
    $sale['payments'] = $payments;
    $sale['total_paid'] = round($totalPaid, 2);
    $sale['remaining'] = max(round((float)$sale['total_amount'] - $totalPaid, 2), 0);

    respond(true, $sale);
}

if ($method === 'GET') {
    $sql = debt_base_query();
    $params = [];

    if (!empty($_GET['scope']) && $_GET['scope'] === 'today') {
        $sql .= ' AND s.sale_date = ?';
        $params[] = today();
    }
    if (!empty($_GET['start'])) { $sql .= ' AND s.sale_date >= ?'; $params[] = clean($_GET['start']); }
    if (!empty($_GET['end']))   { $sql .= ' AND s.sale_date <= ?'; $params[] = clean($_GET['end']); }

    $sql .= ' ORDER BY s.credit_deadline ASC, s.sale_date DESC';

    $stmt = $pdo->prepare($sql);
    try {
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } catch (PDOException $e) {
        respond(false, null, 'Could not load debts. Please make sure Backend/upgrade_v4_sales_customers.php has been run. (Detail: ' . $e->getMessage() . ')', 500);
    }

    $today = today();
    foreach ($rows as &$row) {
        $remaining = round((float)$row['total_amount'] - (float)$row['paid_amount'], 2);
        $row['remaining'] = max($remaining, 0);
        if ($remaining <= 0) {
            $row['status'] = 'paid';
        } elseif (!empty($row['credit_deadline']) && $row['credit_deadline'] < $today) {
            $row['status'] = 'overdue';
        } else {
            $row['status'] = 'pending';
        }
    }
    unset($row);

    if (!empty($_GET['status'])) {
        $wantStatus = clean($_GET['status']);
        $rows = array_values(array_filter($rows, fn($r) => $r['status'] === $wantStatus));
    }

    respond(true, $rows);
}

if ($method === 'POST') {
    $d = body();
    $missing = missing_fields($d, ['sale_id', 'amount']);
    if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);

    $saleId = (int)$d['sale_id'];
    $amount = (float)$d['amount'];
    if ($amount <= 0) respond(false, null, 'Enter a valid payment amount.', 422);

    $stmt = $pdo->prepare("SELECT s.*, COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = s.id), 0) AS paid_amount
                            FROM sale_transactions s WHERE s.id = ? AND s.payment_method = 'credit'");
    $stmt->execute([$saleId]);
    $sale = $stmt->fetch();
    if (!$sale) respond(false, null, 'Credit sale not found.', 404);

    $remaining = round((float)$sale['total_amount'] - (float)$sale['paid_amount'], 2);
    if ($amount > $remaining + 0.01) {
        respond(false, null, 'That amount is more than the remaining balance of ' . number_format($remaining) . '.', 422);
    }

    $paymentMethod = (!empty($d['method']) && $d['method'] === 'online') ? 'online' : 'cash_in_hand';
    $onlineMethod = $paymentMethod === 'online' ? clean($d['online_method'] ?? '') : null;

    $ins = $pdo->prepare('INSERT INTO debt_payments (sale_id, amount, method, online_method, payment_date, note, recorded_by, created_at)
                           VALUES (?,?,?,?,?,?,?,NOW())');
    $ins->execute([
        $saleId, $amount, $paymentMethod, $onlineMethod,
        !empty($d['payment_date']) ? clean($d['payment_date']) : today(),
        clean($d['note'] ?? ''),
        $user['id'],
    ]);

    $newRemaining = round($remaining - $amount, 2);

    // A payment can reduce the customer's CURRENT overdue count (this
    // debt may no longer be overdue), but per the note in
    // refresh_customer_restriction(), it never auto-un-restricts - it
    // only ever moves them further toward restriction, never away.
    if ($sale['customer_id']) refresh_customer_restriction($pdo, (int)$sale['customer_id']);

    log_activity($pdo, $user, 'payment', 'debt_payment', $saleId,
        'Recorded ' . $paymentMethod . ' payment of TZS ' . number_format($amount) . ' for ' . ($sale['customer_name'] ?: 'a customer') . "'s debt (sale #" . $saleId . '), leaving TZS ' . number_format(max($newRemaining, 0)) . ' remaining');

    respond(true, ['remaining' => max($newRemaining, 0)],
        $newRemaining <= 0 ? 'Fully paid off. Debt cleared.' : 'Payment recorded. ' . number_format($newRemaining) . ' still remaining.');
}

respond(false, null, 'Unsupported method.', 405);
