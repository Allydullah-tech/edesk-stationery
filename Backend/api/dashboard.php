<?php
/**
 * EDESK STATIONERY - Dashboard Summary API
 * GET -> today's + overall stock summary, low-stock alerts, quick totals
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/report_helper.php';

$user = require_login();
$pdo = get_db();

$today = today();

// Today's report
$todayReport = build_report($pdo, $today, $today);

// Overall stock counts
$stmt = $pdo->query('SELECT
    SUM(CASE WHEN is_service = 0 THEN 1 ELSE 0 END) AS total_products,
    SUM(CASE WHEN is_service = 1 THEN 1 ELSE 0 END) AS total_services,
    COUNT(*) AS total_items
    FROM products WHERE status = "active"');
$stock = $stmt->fetch();

// Low stock alerts
$stmt = $pdo->query('SELECT id, name, stock_quantity, reorder_level, unit FROM products
    WHERE is_service = 0 AND status = "active" AND stock_quantity <= reorder_level
    ORDER BY stock_quantity ASC LIMIT 15');
$lowStock = $stmt->fetchAll();

// This month totals
[$mStart, $mEnd] = resolve_period('month', $today);
$monthReport = build_report($pdo, $mStart, $mEnd);

// Today's credit (madeni) sales - shown as a marker only, never subtracted
// from profit. Wrapped defensively in case the credit-system upgrade
// script hasn't been run yet on this install (older "sales" table without
// the payment_method column) - the dashboard should still load either way.
$creditToday = ['total_credit' => 0, 'credit_count' => 0];
try {
    $stmt = $pdo->prepare("SELECT COALESCE(SUM(total_amount), 0) AS total_credit, COUNT(*) AS credit_count
                            FROM sale_transactions WHERE payment_method = 'credit' AND sale_date = ?");
    $stmt->execute([$today]);
    $creditToday = $stmt->fetch();
} catch (Exception $e) {
    // Column doesn't exist yet - fall back to zero, no crash.
}

// Debt (madeni) due-date alerts - debts due today, and debts already
// overdue with nothing paid off yet. Wrapped defensively in case the
// credit-system upgrade script hasn't been run yet.
$dueTodayDebts = [];
$overdueDebts = [];
try {
    $stmt = $pdo->query("SELECT s.id, s.customer_name, s.credit_deadline, s.total_amount,
            COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = s.id), 0) AS paid_amount
        FROM sale_transactions s WHERE s.payment_method = 'credit'");
    $allCredits = $stmt->fetchAll();

    foreach ($allCredits as $c) {
        $remaining = round((float)$c['total_amount'] - (float)$c['paid_amount'], 2);
        if ($remaining <= 0 || empty($c['credit_deadline'])) continue;
        if ($c['credit_deadline'] === $today) {
            $dueTodayDebts[] = ['customer_name' => $c['customer_name'], 'remaining' => $remaining];
        } elseif ($c['credit_deadline'] < $today) {
            $overdueDebts[] = ['customer_name' => $c['customer_name'], 'remaining' => $remaining, 'deadline' => $c['credit_deadline']];
        }
    }
} catch (Exception $e) {
    // Credit-system columns don't exist yet - no alerts, no crash.
}

respond(true, [
    'shop_today' => $today,
    'today' => [
        'total_sales' => (float)$todayReport['sales']['total_sales'],
        'transactions' => (int)$todayReport['sales']['transactions'],
        'total_expenses' => (float)$todayReport['expenses']['total_expenses'],
        'total_damage_loss' => (float)$todayReport['damages']['total_loss'],
        'gross_profit' => (float)$todayReport['sales']['total_profit'],
        'net_profit' => (float)$todayReport['net_profit'],
        'total_credit' => (float)$creditToday['total_credit'],
        'credit_count' => (int)$creditToday['credit_count'],
    ],
    'month' => [
        'total_sales' => (float)$monthReport['sales']['total_sales'],
        'total_expenses' => (float)$monthReport['expenses']['total_expenses'],
        'net_profit' => (float)$monthReport['net_profit'],
    ],
    'stock' => [
        'total_products' => (int)($stock['total_products'] ?? 0),
        'total_services' => (int)($stock['total_services'] ?? 0),
        'total_items' => (int)($stock['total_items'] ?? 0),
    ],
    'low_stock_alerts' => $lowStock,
    'top_selling_today' => array_slice($todayReport['top_selling'], 0, 5),
    'debt_alerts' => [
        'due_today' => $dueTodayDebts,
        'overdue' => $overdueDebts,
        'due_today_total' => array_sum(array_column($dueTodayDebts, 'remaining')),
        'overdue_total' => array_sum(array_column($overdueDebts, 'remaining')),
    ],
]);
