<?php
/**
 * eDESK Print & Digital - Upgrade: Receipts, Audit Log, Customer Profiles
 * ------------------------------------------------------------
 * Run this ONCE in your browser:
 *   http://yourdomain/edesk-stationery/Backend/upgrade_v3_features.php
 *
 * What this adds:
 *   - audit_log table - a record of who created, edited, or deleted
 *     what, and when.
 *
 * Receipts and Customer Profiles need NO new tables - receipts are
 * built from the existing sales table (the sale's own id is its
 * receipt number), and customer profiles are computed by grouping
 * existing sales by customer_phone. Keeping it this way on purpose:
 * a second copy of a customer's name/phone that can drift out of
 * sync with what's on the actual sale is worse than not having it.
 *
 * Safe to run more than once.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS audit_log (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NULL,
            user_name VARCHAR(150) NOT NULL,
            user_role VARCHAR(20) NOT NULL,
            action VARCHAR(20) NOT NULL,
            entity_type VARCHAR(30) NOT NULL,
            entity_id INT UNSIGNED NULL,
            description VARCHAR(500) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_audit_entity (entity_type, entity_id),
            KEY idx_audit_created (created_at),
            KEY idx_audit_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $messages[] = ['ok', 'The "audit_log" table is ready.'];
} catch (Exception $e) {
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
    <p><a href="../Frontend/dashboard.html">Go to Dashboard &rarr;</a></p>
  </div>
</body>
</html>
