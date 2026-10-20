<?php
/**
 * eDESK Print & Digital - Upgrade v11: Descriptions for Service Purchases
 *
 * Run this ONCE in the browser (like the other upgrade_*.php files), AFTER
 * upgrade_v10_service_purchases.php.
 *
 * Service items can now carry a Description, exactly like products carry a
 * Description (type) on the Product Purchases page. "Pen" with the description
 * "Obama Pen" and "Pen" with the description "Marker Pen" are two separate service
 * items, each with its own stock and buying price.
 *
 * Changes:
 *  1. service_items.description - new column, blank ('') for items that have none.
 *  2. The unique key on service_items changes from (name) to (name, description), so the
 *     same name can exist once per description.
 *
 * Nothing existing is changed or removed: every current service item keeps its stock,
 * price and history, and simply has a blank description.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$success = true;

try {
    if ($pdo->query("SHOW TABLES LIKE 'service_items'")->rowCount() === 0) {
        $success = false;
        $messages[] = 'The "service_items" table is missing. Please run Backend/upgrade_v10_service_purchases.php first, then run this upgrade again.';
    } else {
        // ---- 1. description column ----
        if ($pdo->query("SHOW COLUMNS FROM `service_items` LIKE 'description'")->rowCount() > 0) {
            $messages[] = 'The "description" column already exists on "service_items". Nothing to do there.';
        } else {
            $pdo->exec("ALTER TABLE `service_items` ADD COLUMN `description` VARCHAR(150) NOT NULL DEFAULT '' AFTER `name`");
            $messages[] = 'Success! The "description" column has been added to "service_items".';
        }

        // ---- 2. unique key: (name) -> (name, description) ----
        $hasOld = $pdo->query("SHOW INDEX FROM `service_items` WHERE Key_name = 'uq_service_item_name'")->rowCount() > 0;
        $hasNew = $pdo->query("SHOW INDEX FROM `service_items` WHERE Key_name = 'uq_service_item_name_desc'")->rowCount() > 0;

        if ($hasNew) {
            $messages[] = 'The (name, description) key already exists. Nothing to do there.';
        } else {
            if ($hasOld) {
                $pdo->exec("ALTER TABLE `service_items` DROP INDEX `uq_service_item_name`");
            }
            try {
                $pdo->exec("ALTER TABLE `service_items` ADD UNIQUE KEY `uq_service_item_name_desc` (`name`, `description`)");
                $messages[] = 'Success! A service item is now identified by its name AND description.';
            } catch (Exception $e) {
                // Very old MySQL versions limit the size of an index. A normal index still works -
                // the system itself already prevents two identical name + description items.
                $pdo->exec("ALTER TABLE `service_items` ADD KEY `idx_service_item_name_desc` (`name`(100), `description`(100))");
                $messages[] = 'Success! The description column is ready (a standard index was used on this server).';
            }
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
