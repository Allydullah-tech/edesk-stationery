<?php
/**
 * eDESK Print & Digital - Upgrade v10: Service Purchases (separate service stock)
 *
 * Run this ONCE in the browser (like the other upgrade_*.php files).
 *
 * Product Purchases and Service Purchases are two completely separate stocks:
 *
 *   products / product_variants / purchases   -> stock bought to SELL directly (unchanged)
 *   service_items / service_purchases         -> products & materials bought to PROVIDE services (new)
 *
 * Adds:
 *  1. service_items       - one row per product/material used for services, with its own
 *                           running stock_quantity (what is left) and latest buying price.
 *  2. service_purchases   - every purchase of those items (date, quantity, buying price, cost).
 *  3. sale_item_materials.service_item_id - which service item a service sale used, so the
 *                           quantity can be taken out of (and given back to) SERVICE stock.
 *
 * Nothing existing is changed or removed: older service sales that used product stock keep
 * working exactly as before (their materials are returned to product stock if such a sale is
 * edited or deleted). Sale amounts, profit and cash are never touched by this upgrade.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$success = true;

try {
    // ---- service_items ----
    if ($pdo->query("SHOW TABLES LIKE 'service_items'")->rowCount() > 0) {
        $messages[] = 'The "service_items" table already exists. Nothing to do there.';
    } else {
        $pdo->exec("CREATE TABLE `service_items` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `name` VARCHAR(150) NOT NULL,
            `unit` VARCHAR(30) NOT NULL DEFAULT 'pcs',
            `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
            `stock_quantity` INT NOT NULL DEFAULT 0,
            `created_by` INT UNSIGNED NULL DEFAULT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `uq_service_item_name` (`name`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $messages[] = 'Success! The "service_items" table has been created.';
    }

    // ---- service_purchases ----
    if ($pdo->query("SHOW TABLES LIKE 'service_purchases'")->rowCount() > 0) {
        $messages[] = 'The "service_purchases" table already exists. Nothing to do there.';
    } else {
        $pdo->exec("CREATE TABLE `service_purchases` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `service_item_id` INT UNSIGNED NOT NULL,
            `quantity` INT UNSIGNED NOT NULL,
            `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
            `total_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            `note` VARCHAR(255) NULL DEFAULT NULL,
            `recorded_by` INT UNSIGNED NOT NULL,
            `purchase_date` DATE NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_sp_item` (`service_item_id`),
            KEY `idx_sp_user` (`recorded_by`),
            KEY `idx_sp_date` (`purchase_date`),
            CONSTRAINT `fk_sp_item` FOREIGN KEY (`service_item_id`) REFERENCES `service_items` (`id`) ON DELETE CASCADE,
            CONSTRAINT `fk_sp_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $messages[] = 'Success! The "service_purchases" table has been created.';
    }

    // ---- sale_item_materials.service_item_id ----
    // Needs the v8 table. Deliberately no foreign key: sale history must survive an item being removed.
    if ($pdo->query("SHOW TABLES LIKE 'sale_item_materials'")->rowCount() === 0) {
        $success = false;
        $messages[] = 'The "sale_item_materials" table is missing. Please run Backend/upgrade_v8_service_materials.php first, then run this upgrade again.';
    } elseif ($pdo->query("SHOW COLUMNS FROM `sale_item_materials` LIKE 'service_item_id'")->rowCount() > 0) {
        $messages[] = 'The "service_item_id" column already exists on "sale_item_materials". Nothing to do there.';
    } else {
        $pdo->exec("ALTER TABLE `sale_item_materials`
            ADD COLUMN `service_item_id` INT UNSIGNED NULL DEFAULT NULL AFTER `sale_item_id`,
            ADD KEY `idx_sim_service_item` (`service_item_id`)");
        $messages[] = 'Success! The "service_item_id" column has been added to "sale_item_materials".';
    }
} catch (Exception $e) {
    $success = false;
    $messages[] = 'Upgrade failed: ' . $e->getMessage();
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Upgrade - eDESK Print &amp; Digital</title>
<style>
  body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;}
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:520px;}
  h2{color:#F0B849;margin-top:0;}
  .msg{padding:12px 16px;border-radius:8px;font-size:14px;margin:14px 0;text-align:left;}
  .ok{background:#173325;color:#8be0ac;}
  .err{background:#3a1c22;color:#ff9b9b;}
  a{color:#F0B849;}
</style>
</head>
<body>
  <div class="box">
    <h2>eDESK Print &amp; Digital</h2>
    <?php foreach ($messages as $m): ?>
      <div class="msg <?= $success ? 'ok' : 'err' ?>"><?= htmlspecialchars($m) ?></div>
    <?php endforeach; ?>
    <p><a href="../Frontend/service-purchases.html">Go to Service Purchases &rarr;</a></p>
  </div>
</body>
</html>
