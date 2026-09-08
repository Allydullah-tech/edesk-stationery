<?php
/**
 * eDESK Print & Digital - Upgrade: Whole-Number Quantities
 * ------------------------------------------------------------
 * Run this ONCE in your browser (BACK UP YOUR DATABASE FIRST):
 *   http://yourdomain/edesk-stationery/Backend/upgrade_v5_integer_quantities.php
 *
 * Every quantity in this system (stock, purchases, sales, damages,
 * reorder level) was stored as DECIMAL(12,2), which is why the UI
 * showed things like "10.00 pcs" instead of "10 pcs". Since stock is
 * always counted in whole units here, this migration:
 *
 *   1. Rounds any existing fractional values to the nearest whole
 *      number (there shouldn't be any, but this makes the column
 *      change safe either way).
 *   2. Converts the columns below from DECIMAL(12,2) to INT UNSIGNED:
 *        - products.stock_quantity
 *        - products.reorder_level
 *        - sale_items.quantity
 *        - purchases.quantity
 *        - damages.quantity (nullable)
 *
 * Safe to run more than once - every step checks whether it already
 * happened before doing it again.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];

function col_type(PDO $pdo, string $table, string $column): ?string {
    $stmt = $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column));
    $row = $stmt->fetch();
    return $row ? strtolower($row['Type']) : null;
}

function to_int_column(PDO $pdo, array &$messages, string $table, string $column, string $definition): void {
    $type = col_type($pdo, $table, $column);
    if ($type === null) {
        $messages[] = ['err', "Column `$table`.`$column` not found - skipped."];
        return;
    }
    if (str_starts_with($type, 'int')) {
        $messages[] = ['ok', "`$table`.`$column` is already an integer column."];
        return;
    }
    // Round existing values before narrowing the column type.
    $pdo->exec("UPDATE `$table` SET `$column` = ROUND(`$column`) WHERE `$column` IS NOT NULL");
    $pdo->exec("ALTER TABLE `$table` MODIFY COLUMN `$column` $definition");
    $messages[] = ['ok', "Converted `$table`.`$column` to a whole-number column."];
}

try {
    $pdo->beginTransaction();

    to_int_column($pdo, $messages, 'products', 'stock_quantity', 'INT UNSIGNED NOT NULL DEFAULT 0');
    to_int_column($pdo, $messages, 'products', 'reorder_level', 'INT UNSIGNED NOT NULL DEFAULT 5');
    to_int_column($pdo, $messages, 'sale_items', 'quantity', 'INT UNSIGNED NOT NULL');
    to_int_column($pdo, $messages, 'purchases', 'quantity', 'INT UNSIGNED NOT NULL');
    to_int_column($pdo, $messages, 'damages', 'quantity', 'INT UNSIGNED NULL DEFAULT NULL');

    $pdo->commit();
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $messages[] = ['err', 'Upgrade failed, nothing was changed: ' . $e->getMessage()];
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Upgrade - eDESK Print &amp; Digital</title>
<style>
  body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;padding:20px;}
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:560px;}
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
    <p>Quantities across Products, Purchases, Sales, and Damages will now display and accept whole numbers only.</p>
  </div>
</body>
</html>
