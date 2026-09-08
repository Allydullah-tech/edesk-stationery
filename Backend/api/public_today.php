<?php
/**
 * EDESK STATIONERY - Public "Today's Report" widget for the landing page.
 * Intentionally returns ONLY high-level totals (no customer names, no line items)
 * so it is safe to show before login.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/report_helper.php';

$pdo = get_db();
$today = today();
$report = build_report($pdo, $today, $today);
$cfg = require __DIR__ . '/../config.php';

respond(true, [
    'shop_name' => $cfg['shop_name'] ?? 'EDESK STATIONERY',
    'date' => date('l, d F Y'),
    'total_sales' => (float)$report['sales']['total_sales'],
    'transactions' => (int)$report['sales']['transactions'],
    'total_expenses' => (float)$report['expenses']['total_expenses'],
    'net_profit' => (float)$report['net_profit'],
]);
