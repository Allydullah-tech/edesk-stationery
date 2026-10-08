<?php
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/report_helper.php';

$user = require_login();
$pdo = get_db();

$period = clean($_GET['period'] ?? 'day');
$date = !empty($_GET['date']) ? clean($_GET['date']) : today();
$endCustom = !empty($_GET['end']) ? clean($_GET['end']) : null;
$format = clean($_GET['format'] ?? 'json');

[$start, $end] = resolve_period($period, $date, $endCustom);
$report = build_report($pdo, $start, $end);
$report['period'] = $period;

if ($format === 'csv') {
    $cfg = require __DIR__ . '/../config.php';
    stream_report_csv($report, $cfg['shop_name'] ?? 'EDESK STATIONERY');
}

respond(true, $report);
