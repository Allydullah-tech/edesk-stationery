<?php
/**
 * EDESK STATIONERY - Upgrade v13: Opening Cash & Float - Delete / Restore
 *
 * Adds "soft delete" columns to cash_floats so a mistaken record can be removed
 * from the float and later restored, instead of being erased for good.
 * Safe to run more than once. Run it once in the browser, then you can delete it.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$message = '';
$success = false;

try {
    $check = $pdo->query("SHOW TABLES LIKE 'cash_floats'");
    if ($check->rowCount() === 0) {
        $message = 'The "cash_floats" table does not exist yet. Please run upgrade_add_cash_float.php first, then run this page again.';
    } else {
        $have = [];
        foreach ($pdo->query('SHOW COLUMNS FROM `cash_floats`')->fetchAll() as $c) $have[$c['Field']] = true;

        $add = [
            'deleted_at'       => "ADD COLUMN `deleted_at` DATETIME NULL DEFAULT NULL",
            'deleted_by'       => "ADD COLUMN `deleted_by` INT UNSIGNED NULL DEFAULT NULL",
            'deleted_by_name'  => "ADD COLUMN `deleted_by_name` VARCHAR(100) NOT NULL DEFAULT ''",
            'restored_at'      => "ADD COLUMN `restored_at` DATETIME NULL DEFAULT NULL",
            'restored_by_name' => "ADD COLUMN `restored_by_name` VARCHAR(100) NOT NULL DEFAULT ''",
        ];
        $done = 0;
        foreach ($add as $col => $sql) {
            if (empty($have[$col])) { $pdo->exec("ALTER TABLE `cash_floats` $sql"); $done++; }
        }

        $idx = $pdo->query("SHOW INDEX FROM `cash_floats` WHERE Key_name = 'idx_cf_deleted'");
        if ($idx->rowCount() === 0) $pdo->exec('ALTER TABLE `cash_floats` ADD KEY `idx_cf_deleted` (`deleted_at`)');

        $message = $done > 0
            ? 'Success! Opening Cash & Float records can now be deleted and restored. Nothing that was already saved was changed.'
            : 'Your database is already up to date. Nothing to do.';
        $success = true;
    }
} catch (Exception $e) {
    $message = 'Upgrade failed: ' . $e->getMessage();
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Upgrade - eDESK STATIONERY</title>
<style>
  body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;}
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:440px;}
  h2{color:#F0B849;margin-top:0;}
  .msg{padding:12px 16px;border-radius:8px;font-size:14px;margin:14px 0;}
  .ok{background:#173325;color:#8be0ac;}
  .err{background:#3a1c22;color:#ff9b9b;}
  a{color:#F0B849;}
</style>
</head>
<body>
  <div class="box">
    <h2>eDESK STATIONERY</h2>
    <div class="msg <?= $success ? 'ok' : 'err' ?>"><?= htmlspecialchars($message) ?></div>
    <p><a href="../Frontend/cash-audit.html">Go to the Cash Audit page &rarr;</a></p>
  </div>
</body>
</html>
