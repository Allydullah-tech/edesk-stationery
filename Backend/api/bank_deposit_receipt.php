<?php
/**
 * EDESK STATIONERY - Bank deposit receipt photo
 *
 * GET ?id=DEPOSIT_ID  -> the receipt photo attached to that bank deposit.
 *
 * Receipts are private. They are kept outside public reach and only handed out here, to a logged-in
 * admin or worker, so a receipt can never be opened by someone who is not signed in.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/cash_audit_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();

$id = (int)($_GET['id'] ?? 0);
if (!$id) respond(false, null, 'Deposit id is required.', 422);
if (!bd_receipt_column_ready($pdo)) respond(false, null, bd_receipt_upgrade_message(), 404);

$stmt = $pdo->prepare('SELECT receipt_file, receipt_mime FROM bank_deposits WHERE id = ?');
$stmt->execute([$id]);
$row = $stmt->fetch();
if (!$row || empty($row['receipt_file'])) respond(false, null, 'There is no receipt photo for this bank deposit.', 404);

$path = bd_receipt_dir() . '/' . basename($row['receipt_file']);
if (!is_file($path)) respond(false, null, 'The receipt photo file could not be found on the server.', 404);

$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
header('Content-Type: ' . ($row['receipt_mime'] ?: 'image/jpeg'));
header('Content-Length: ' . filesize($path));
header('Content-Disposition: inline; filename="bank-receipt-' . $id . '.' . $ext . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=3600');
readfile($path);
exit;
