<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$success = true;

try {
    $check = $pdo->query("SHOW TABLES LIKE 'product_variants'");
    if ($check->rowCount() === 0) {
        $messages[] = 'The "product_variants" table does not exist yet. Please run Backend/upgrade_add_product_variants.php FIRST, then run this script again.';
        $success = false;
    } else {
        // ---- purchases.variant_id ----
        $check = $pdo->query("SHOW COLUMNS FROM purchases LIKE 'variant_id'");
        if ($check->rowCount() > 0) {
            $messages[] = 'The "variant_id" column already exists on purchases. Nothing to do there.';
        } else {
            $pdo->exec("ALTER TABLE purchases ADD COLUMN variant_id INT UNSIGNED NULL DEFAULT NULL AFTER product_id");
            $pdo->exec("ALTER TABLE purchases ADD KEY fk_purchase_variant (variant_id)");
            $pdo->exec("ALTER TABLE purchases ADD CONSTRAINT fk_purchase_variant FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE SET NULL");
            $messages[] = 'Success! The "variant_id" column has been added to purchases.';
        }

        // ---- damages.variant_id ----
        $check = $pdo->query("SHOW COLUMNS FROM damages LIKE 'variant_id'");
        if ($check->rowCount() > 0) {
            $messages[] = 'The "variant_id" column already exists on damages. Nothing to do there.';
        } else {
            $pdo->exec("ALTER TABLE damages ADD COLUMN variant_id INT UNSIGNED NULL DEFAULT NULL AFTER product_id");
            $pdo->exec("ALTER TABLE damages ADD KEY fk_damage_variant (variant_id)");
            $pdo->exec("ALTER TABLE damages ADD CONSTRAINT fk_damage_variant FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE SET NULL");
            $messages[] = 'Success! The "variant_id" column has been added to damages.';
        }
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
    <p><a href="../Frontend/purchases.html">Go to Purchases &rarr;</a></p>
  </div>
</body>
</html>
