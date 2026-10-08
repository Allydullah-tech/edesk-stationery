<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$message = '';
$success = false;

try {
    $check = $pdo->query("SHOW TABLES LIKE 'cash_audits'");
    if ($check->rowCount() > 0) {
        $message = 'The "cash_audits" table already exists. Nothing to do - your system is up to date.';
        $success = true;
    } else {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS `cash_audits` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
              `audit_date` DATE NOT NULL,
              `cashier` VARCHAR(80) NOT NULL DEFAULT '',
              `shift` VARCHAR(40) NOT NULL DEFAULT '',
              `opening_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `cash_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `electronic_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `credit_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `total_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `expenses` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `counted_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `expected_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `variance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `note` TEXT NULL,
              `denominations` TEXT NULL COMMENT 'JSON: [{denom, qty, remark}]',
              `saved_by` INT UNSIGNED NULL,
              `saved_by_name` VARCHAR(100) NOT NULL DEFAULT '',
              `saved_by_role` VARCHAR(20) NOT NULL DEFAULT '',
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `idx_ca_date` (`audit_date`),
              KEY `idx_ca_saved_by` (`saved_by`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ");
        $message = 'Success! The "cash_audits" table has been added to your database. '
                 . 'Cash Audit sheets on the Sales page can now be saved and reviewed as history.';
        $success = true;
    }
} catch (Exception $e) {
    $message = 'Upgrade failed: ' . $e->getMessage();
    $success = false;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
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
    <p><a href="../Frontend/sales.html">Go to the Sales page &rarr;</a></p>
  </div>
</body>
</html>
