<?php
/**
 * eDESK STATIONERY - Upgrade: Add Purchases table
 * ------------------------------------------------
 * Run this ONCE in your browser if your system was installed before the
 * Purchases feature existed:
 *   http://yourdomain/edesk-stationery/Backend/upgrade_add_purchases.php
 *
 * It safely adds the new "purchases" table to your EXISTING database
 * without touching any of your current products, sales, users, etc.
 * It is safe to run more than once - it will simply say the table
 * already exists.
 *
 * You can delete this file afterwards if you like, or just leave it.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$message = '';
$success = false;

try {
    $check = $pdo->query("SHOW TABLES LIKE 'purchases'");
    if ($check->rowCount() > 0) {
        $message = 'The "purchases" table already exists. Nothing to do - your system is up to date.';
        $success = true;
    } else {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS `purchases` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
              `product_id` INT UNSIGNED NOT NULL,
              `quantity` DECIMAL(12,2) NOT NULL,
              `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
              `total_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `source` ENUM('manual','import') NOT NULL DEFAULT 'manual',
              `note` VARCHAR(255) NULL,
              `recorded_by` INT UNSIGNED NOT NULL,
              `purchase_date` DATE NOT NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `fk_pur_product` (`product_id`),
              KEY `fk_pur_user` (`recorded_by`),
              KEY `idx_pur_date` (`purchase_date`),
              CONSTRAINT `fk_pur_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_pur_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ");
        $message = 'Success! The "purchases" table has been added to your database.';
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
    <p><a href="../Frontend/purchases.html">Go to the Purchases page &rarr;</a></p>
  </div>
</body>
</html>
