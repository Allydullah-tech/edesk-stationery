<?php
/**
 * EDESK STATIONERY - Upgrade v9: Bank deposit receipt photos
 *
 * Run ONCE (safe to run again - it only adds what is missing):
 *   http://yourdomain/edesk-stationery/Backend/upgrade_v9_bank_deposit_receipts.php
 *
 * Requires upgrade_v6_cash_audit_enhancements.php to have been run already (it adds to the
 * "bank_deposits" table that one created).
 *
 * What it adds
 *  - bank_deposits.receipt_file / receipt_mime: the photo of the bank receipt attached to a deposit.
 *    Existing deposits are untouched (they simply have no receipt).
 *  - The private folder Backend/uploads/bank_receipts/ (closed to direct web access; photos are only
 *    shown to logged-in users through api/bank_deposit_receipt.php).
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers/cash_audit_helper.php';

$pdo = get_db();
$messages = [];

function v9_column_exists(PDO $pdo, string $table, string $column): bool
{
    return $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column))->rowCount() > 0;
}

try {
    if ($pdo->query("SHOW TABLES LIKE 'bank_deposits'")->rowCount() === 0) {
        $messages[] = ['err', 'The "bank_deposits" table does not exist yet. Run upgrade_v6_cash_audit_enhancements.php first, then run this again.'];
    } else {
        $cols = [
            'receipt_file' => "VARCHAR(255) NULL COMMENT 'stored file name of the bank receipt photo'",
            'receipt_mime' => 'VARCHAR(50) NULL',
        ];
        foreach ($cols as $col => $def) {
            if (v9_column_exists($pdo, 'bank_deposits', $col)) {
                $messages[] = ['ok', "bank_deposits.$col already exists."];
            } else {
                $pdo->exec("ALTER TABLE `bank_deposits` ADD COLUMN `$col` $def");
                $messages[] = ['ok', "Added bank_deposits.$col."];
            }
        }

        $dir = bd_receipt_dir();
        if (is_dir($dir) && is_writable($dir)) {
            $messages[] = ['ok', 'The receipt folder is ready (Backend/uploads/bank_receipts).'];
        } else {
            $messages[] = ['err', 'The receipt folder Backend/uploads/bank_receipts could not be created or is not writable. Create it by hand and make it writable by the web server.'];
        }
    }
} catch (Exception $e) {
    $messages[] = ['err', 'Upgrade failed: ' . $e->getMessage()];
}

$failed = false;
foreach ($messages as $m) { if ($m[0] === 'err') $failed = true; }
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Upgrade v9 - eDESK STATIONERY</title>
<style>
  body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;}
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:560px;}
  h2{color:#F0B849;margin-top:0;}
  .msg{padding:8px 14px;border-radius:8px;font-size:13.5px;margin:6px 0;text-align:left;}
  .ok{background:#173325;color:#8be0ac;}
  .err{background:#3a1c22;color:#ff9b9b;}
  a{color:#F0B849;}
</style>
</head>
<body>
  <div class="box">
    <h2>eDESK STATIONERY</h2>
    <p><?= $failed ? 'Upgrade finished with problems:' : 'Upgrade complete - bank deposit receipt photos are ready.' ?></p>
    <?php foreach ($messages as $m): ?>
      <div class="msg <?= $m[0] ?>"><?= htmlspecialchars($m[1]) ?></div>
    <?php endforeach; ?>
    <p><a href="../Frontend/sales.html">Go to the Sales page &rarr;</a></p>
  </div>
</body>
</html>
