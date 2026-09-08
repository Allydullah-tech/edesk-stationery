<?php
/**
 * EDESK STATIONERY - Reports API
 * GET ?period=day|week|month|year|custom &date=YYYY-MM-DD &end=YYYY-MM-DD &format=json|csv
 *
 * day:    date = the exact day
 * week:   date = the starting date the user clicked; system auto-adds 6 more days
 * month:  date = any date within the target month
 * year:   date = any date within the target year
 * custom: date = start, end = end
 */
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
