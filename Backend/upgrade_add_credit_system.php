<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$success = true;

function columnExists(PDO $pdo, $table, $column) {
    // SHOW COLUMNS does not support a bound "?" placeholder under native
    // (non-emulated) prepared statements on some MySQL/MariaDB versions -
    // it causes a syntax error right at the "?". $table/$column here are
    // always our own hardcoded values, never user input, so building the
    // string directly is safe.
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
    $column = preg_replace('/[^a-zA-Z0-9_]/', '', $column);
    $stmt = $pdo->query("SHOW COLUMNS FROM `$table` LIKE '$column'");
    return $stmt->rowCount() > 0;
}

try {
    $columns = [
        'payment_method'  => "ALTER TABLE sales ADD COLUMN payment_method ENUM('cash','credit') NOT NULL DEFAULT 'cash' AFTER note",
        'cash_type'       => "ALTER TABLE sales ADD COLUMN cash_type ENUM('cash_in_hand','online') NULL DEFAULT NULL AFTER payment_method",
        'online_method'   => "ALTER TABLE sales ADD COLUMN online_method VARCHAR(50) NULL DEFAULT NULL AFTER cash_type",
        'credit_deadline' => "ALTER TABLE sales ADD COLUMN credit_deadline DATE NULL DEFAULT NULL AFTER online_method",
    ];

    foreach ($columns as $col => $sql) {
        if (columnExists($pdo, 'sales', $col)) {
            $messages[] = "Column \"$col\" already exists on sales - skipped.";
        } else {
            $pdo->exec($sql);
            $messages[] = "Added column \"$col\" to sales.";
        }
    }

    $check = $pdo->query("SHOW TABLES LIKE 'debt_payments'");
    if ($check->rowCount() > 0) {
        $messages[] = 'The "debt_payments" table already exists - skipped.';
    } else {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS `debt_payments` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
              `sale_id` INT UNSIGNED NOT NULL,
              `amount` DECIMAL(14,2) NOT NULL,
              `payment_date` DATE NOT NULL,
              `note` VARCHAR(255) NULL,
              `recorded_by` INT UNSIGNED NOT NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `fk_debt_sale` (`sale_id`),
              KEY `fk_debt_user` (`recorded_by`),
              CONSTRAINT `fk_debt_sale` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_debt_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ");
        $messages[] = 'Created the "debt_payments" table.';
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
  body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;}
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:480px;}
  h2{color:#F0B849;margin-top:0;}
  .msg{padding:10px 14px;border-radius:8px;font-size:13px;margin:8px 0;text-align:left;}
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
    <p style="margin-top:18px;"><a href="../Frontend/debts.html">Go to the Debts page &rarr;</a></p>
  </div>
</body>
</html>
