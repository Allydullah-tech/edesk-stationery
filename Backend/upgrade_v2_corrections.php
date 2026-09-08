<?php
/**
 * eDESK Print & Digital - Upgrade: System Corrections Batch
 * ------------------------------------------------------------
 * Run this ONCE in your browser:
 *   http://yourdomain/edesk-stationery/Backend/upgrade_v2_corrections.php
 *
 * Adds:
 *   - sales.customer_phone        - phone number captured with credit/debt sales
 *   - damages.product_id          - made nullable (a damage record can now be
 *                                   for something that isn't in Stock)
 *   - damages.item_type           - 'product' or 'other' (equipment/material)
 *   - damages.item_name           - free-text name used when item_type = 'other'
 *   - damages.manual_cost         - cost entered by hand when item_type = 'other'
 *
 * Safe to run more than once.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$overallSuccess = true;

function column_exists(PDO $pdo, string $table, string $column): bool {
    // NOTE: SHOW COLUMNS does not support a bound "?" placeholder under a
    // real (server-side) prepared statement, which this project uses
    // (PDO::ATTR_EMULATE_PREPARES => false). $pdo->quote() escapes the
    // value safely without needing a placeholder.
    $stmt = $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column));
    return $stmt->rowCount() > 0;
}

try {
    // ---- sales.customer_phone ----
    if (column_exists($pdo, 'sales', 'customer_phone')) {
        $messages[] = ['ok', 'The "customer_phone" column already exists on sales. Nothing to do.'];
    } else {
        $pdo->exec("ALTER TABLE sales ADD COLUMN customer_phone VARCHAR(30) NULL DEFAULT NULL AFTER customer_name");
        $messages[] = ['ok', 'Added "customer_phone" to the sales table.'];
    }

    // ---- damages.product_id -> nullable ----
    $pdo->exec("ALTER TABLE damages MODIFY COLUMN product_id INT UNSIGNED NULL");
    $messages[] = ['ok', 'damages.product_id is now optional (needed for non-stock damage records).'];

    // ---- damages.item_type ----
    if (column_exists($pdo, 'damages', 'item_type')) {
        $messages[] = ['ok', 'The "item_type" column already exists on damages. Nothing to do.'];
    } else {
        $pdo->exec("ALTER TABLE damages ADD COLUMN item_type ENUM('product','other') NOT NULL DEFAULT 'product' AFTER product_id");
        $messages[] = ['ok', 'Added "item_type" to the damages table.'];
    }

    // ---- damages.item_name ----
    if (column_exists($pdo, 'damages', 'item_name')) {
        $messages[] = ['ok', 'The "item_name" column already exists on damages. Nothing to do.'];
    } else {
        $pdo->exec("ALTER TABLE damages ADD COLUMN item_name VARCHAR(150) NULL DEFAULT NULL AFTER item_type");
        $messages[] = ['ok', 'Added "item_name" to the damages table.'];
    }

    // ---- damages.manual_cost ----
    if (column_exists($pdo, 'damages', 'manual_cost')) {
        $messages[] = ['ok', 'The "manual_cost" column already exists on damages. Nothing to do.'];
    } else {
        $pdo->exec("ALTER TABLE damages ADD COLUMN manual_cost DECIMAL(14,2) NULL DEFAULT NULL AFTER loss_value");
        $messages[] = ['ok', 'Added "manual_cost" to the damages table.'];
    }

    // ---- damages.quantity -> nullable (not applicable to non-stock items) ----
    $pdo->exec("ALTER TABLE damages MODIFY COLUMN quantity DECIMAL(12,2) NULL");
    $messages[] = ['ok', 'damages.quantity is now optional for non-stock (equipment/material) records.'];

} catch (Exception $e) {
    $overallSuccess = false;
    $messages[] = ['err', 'Upgrade failed: ' . $e->getMessage()];
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Upgrade - eDESK Print &amp; Digital</title>
<style>
  body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;padding:20px;}
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:520px;}
  h2{color:#F0B849;margin-top:0;}
  .msg{padding:12px 16px;border-radius:8px;font-size:14px;margin:10px 0;text-align:left;}
  .ok{background:#173325;color:#8be0ac;}
  .err{background:#3a1c22;color:#ff9b9b;}
  a{color:#F0B849;}
</style>
</head>
<body>
  <div class="box">
    <h2>eDESK Print &amp; Digital</h2>
    <?php foreach ($messages as [$type, $text]): ?>
      <div class="msg <?= $type === 'ok' ? 'ok' : 'err' ?>"><?= htmlspecialchars($text) ?></div>
    <?php endforeach; ?>
    <p><a href="../Frontend/damages.html">Go to Damages &amp; Waste &rarr;</a></p>
  </div>
</body>
</html>
