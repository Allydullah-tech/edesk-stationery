<?php
/**
 * eDESK Print & Digital - Upgrade v12: Fill in descriptions on old service sales
 *
 * Run this ONCE in the browser (like the other upgrade_*.php files).
 *
 * Before the sales.php fix, a service sale did not save which description was chosen,
 * so old service sales show a dash in the Sales History "Descriptions" column.
 *
 * This script fills those in safely. For every old service sale line with no description:
 *   1. If the service has exactly ONE description, that one is used.
 *   2. Otherwise, if exactly ONE of the service's descriptions has a selling price equal
 *      to the price the line was sold at, that one is used.
 *   3. Anything else (two descriptions with the same price, or a price that no longer
 *      matches) is left as it is - guessing could record the wrong description.
 *
 * Only sale_items.variant_id is filled in. Totals, profit and stock are not touched.
 * Safe to run more than once: lines that already have a description are never changed.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];
$success = true;

try {
    $rows = $pdo->query("SELECT si.id, si.product_id, si.unit_price
                         FROM sale_items si
                         JOIN products p ON p.id = si.product_id
                         WHERE p.is_service = 1 AND si.variant_id IS NULL")->fetchAll();

    $vStmt = $pdo->prepare('SELECT id, selling_price FROM product_variants WHERE product_id = ?');
    $upd = $pdo->prepare('UPDATE sale_items SET variant_id = ? WHERE id = ? AND variant_id IS NULL');

    $filled = 0;
    $left = 0;
    $variantCache = [];

    foreach ($rows as $r) {
        $pid = (int)$r['product_id'];
        if (!isset($variantCache[$pid])) {
            $vStmt->execute([$pid]);
            $variantCache[$pid] = $vStmt->fetchAll();
        }
        $variants = $variantCache[$pid];

        $chosen = null;
        if (count($variants) === 1) {
            $chosen = (int)$variants[0]['id'];
        } elseif (count($variants) > 1) {
            $matches = array_values(array_filter($variants, fn($v) => abs((float)$v['selling_price'] - (float)$r['unit_price']) < 0.005));
            if (count($matches) === 1) $chosen = (int)$matches[0]['id'];
        }

        if ($chosen) {
            $upd->execute([$chosen, (int)$r['id']]);
            $filled++;
        } else {
            $left++;
        }
    }

    $messages[] = "Success! $filled old service sale line(s) now show their description.";
    if ($left > 0) {
        $messages[] = "$left line(s) could not be matched safely (same price on several descriptions, or the price has changed since) and still show a dash. You can fix those by editing the sale and re-selecting the description.";
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
    <p><a href="../Frontend/sales.html">Go to Sales &rarr;</a></p>
  </div>
</body>
</html>
