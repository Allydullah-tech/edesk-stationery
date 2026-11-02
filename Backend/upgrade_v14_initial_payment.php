<?php
/**
 * EDESK STATIONERY - Upgrade v14: Partial payment on credit sales ("Amount Paid Now")
 *
 * Adds debt_payments.is_initial so the part a customer pays at the moment of a credit sale
 * can be told apart from later repayments. Safe to run more than once. (The system also adds
 * this column automatically the first time an initial payment is saved, so running this page
 * is optional.) Run it once in the browser, then you can delete it.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers/credit_payment_helper.php';

$pdo = get_db();
$message = '';
$success = false;

try {
    if ($pdo->query("SHOW TABLES LIKE 'debt_payments'")->rowCount() === 0) {
        $message = 'The "debt_payments" table does not exist yet. Please run upgrade_add_credit_system.php first, then run this page again.';
    } elseif (dp_initial_ready($pdo)) {
        $message = 'Your database is already up to date. Nothing to do.';
        $success = true;
    } elseif (dp_initial_ready($pdo, true)) {
        $message = 'Success! Credit sales can now record an "Amount Paid Now". Nothing that was already saved was changed.';
        $success = true;
    } else {
        $message = 'Could not add the column. Please check the database user has permission to alter tables.';
    }
} catch (Exception $e) {
    $message = 'Upgrade failed: ' . $e->getMessage();
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Upgrade - eDESK STATIONERY</title>
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
    <h2>eDESK STATIONERY</h2>
    <div class="msg <?= $success ? 'ok' : 'err' ?>"><?= htmlspecialchars($message) ?></div>
    <p><a href="../Frontend/sales.html">Go to the Sales page &rarr;</a></p>
  </div>
</body>
</html>
