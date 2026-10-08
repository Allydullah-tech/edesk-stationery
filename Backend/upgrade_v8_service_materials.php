<?php
/**
 * eDESK Print & Digital - Upgrade v8: Products used by services
 *
 * Run this ONCE in the browser (like the other upgrade_*.php files).
 *
 * Adds one table:
 *
 *  sale_item_materials   - the products used to provide a service in a real sale
 *                          (a snapshot taken at the moment of sale: quantity + the
 *                          cost price at that time). Used to give stock back when a
 *                          sale is edited or deleted, and so old sales keep their
 *                          original cost even if the product's buying price changes later.
 *
 * (If you ran the earlier version of this script, an unused "service_materials"
 *  table may exist. It is no longer used and can be ignored or dropped.)
 *
 * Nothing here touches sale amounts: sale_transactions.total_amount (sales and cash)
 * is never reduced by the material cost. The cost only reduces profit.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$success = true;

try {
    // ---- sale_item_materials ----
    // Deliberately NO foreign keys to products/variants: sale history must survive a
    // product being deleted later. It only cascades from sale_items, so deleting a
    // sale removes its snapshot too.
    $check = $pdo->query("SHOW TABLES LIKE 'sale_item_materials'");
    if ($check->rowCount() > 0) {
        $messages[] = 'The "sale_item_materials" table already exists. Nothing to do there.';
    } else {
        $pdo->exec("CREATE TABLE `sale_item_materials` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `sale_item_id` INT UNSIGNED NOT NULL,
            `material_product_id` INT UNSIGNED NULL DEFAULT NULL,
            `material_variant_id` INT UNSIGNED NULL DEFAULT NULL,
            `material_name` VARCHAR(255) NOT NULL,
            `quantity` INT UNSIGNED NOT NULL,
            `unit_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            `total_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            PRIMARY KEY (`id`),
            KEY `idx_sim_item` (`sale_item_id`),
            CONSTRAINT `fk_sim_item` FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $messages[] = 'Success! The "sale_item_materials" table has been created.';
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
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:480px;}
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
    <p><a href="../Frontend/sales.html">Go to Sales &rarr;</a></p>
  </div>
</body>
</html>
