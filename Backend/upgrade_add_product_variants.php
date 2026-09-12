<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$success = true;

try {
    // ---- product_variants table ----
    $check = $pdo->query("SHOW TABLES LIKE 'product_variants'");
    if ($check->rowCount() > 0) {
        $messages[] = 'The "product_variants" table already exists. Nothing to do there.';
    } else {
        $pdo->exec("CREATE TABLE `product_variants` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `product_id` INT UNSIGNED NOT NULL,
            `variant_name` VARCHAR(150) NOT NULL,
            `unit` VARCHAR(30) NOT NULL DEFAULT 'pcs',
            `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
            `selling_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
            `minimum_price` DECIMAL(12,2) NULL DEFAULT NULL,
            `stock_quantity` INT UNSIGNED NOT NULL DEFAULT 0,
            `reorder_level` INT UNSIGNED NOT NULL DEFAULT 5,
            `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
            `created_by` INT UNSIGNED NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `fk_variant_product` (`product_id`),
            UNIQUE KEY `uniq_variant_per_product` (`product_id`, `variant_name`),
            CONSTRAINT `fk_variant_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $messages[] = 'Success! The "product_variants" table has been created.';
    }

    // ---- sale_items.variant_id ----
    $check = $pdo->query("SHOW COLUMNS FROM sale_items LIKE 'variant_id'");
    if ($check->rowCount() > 0) {
        $messages[] = 'The "variant_id" column already exists on sale_items. Nothing to do there.';
    } else {
        $pdo->exec("ALTER TABLE sale_items ADD COLUMN variant_id INT UNSIGNED NULL DEFAULT NULL AFTER product_id");
        $pdo->exec("ALTER TABLE sale_items ADD KEY fk_item_variant (variant_id)");
        // ON DELETE SET NULL - deleting a type later must never delete the
        // sale history that references it; the sale simply keeps the
        // parent product's name if the type is later removed.
        $pdo->exec("ALTER TABLE sale_items ADD CONSTRAINT fk_item_variant FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE SET NULL");
        $messages[] = 'Success! The "variant_id" column has been added to sale_items.';
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
    <p><a href="../Frontend/products.html">Go to Products &rarr;</a></p>
  </div>
</body>
</html>
