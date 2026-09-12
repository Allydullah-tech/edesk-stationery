<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$message = '';
$success = false;

try {
    $check = $pdo->query("SHOW COLUMNS FROM products LIKE 'minimum_price'");
    if ($check->rowCount() > 0) {
        $message = 'The "minimum_price" column already exists. Nothing to do.';
        $success = true;
    } else {
        $pdo->exec("ALTER TABLE products ADD COLUMN minimum_price DECIMAL(12,2) NULL DEFAULT NULL AFTER selling_price");
        $message = 'Success! The "minimum_price" column has been added to your products table.';
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
<title>Upgrade - eDESK Print &amp; Digital</title>
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
    <h2>eDESK Print &amp; Digital</h2>
    <div class="msg <?= $success ? 'ok' : 'err' ?>"><?= htmlspecialchars($message) ?></div>
    <p><a href="../Frontend/products.html">Go to Products &rarr;</a></p>
  </div>
</body>
</html>
