<?php
/**
 * EDESK STATIONERY - Upgrade v7: Customer Change / Balance Due
 *
 * Run ONCE (safe to run again - it only adds what is missing):
 *   http://yourdomain/edesk-stationery/Backend/upgrade_v7_customer_change.php
 *
 * Requires upgrade_add_cash_audits.php and upgrade_v6_cash_audit_enhancements.php
 * to have been run already (it adds to the cash_audits table they created).
 *
 * What it adds
 *  - sale_transactions.change_amount : the change a customer left behind on that sale
 *      (0 for every existing sale - nothing about old sales changes).
 *  - sale_change_collections : each time a customer collects (part of) their change,
 *      one row linked to the ORIGINAL sale. It is not a sale and not a debt - it is
 *      only the collection history of that sale's change, so the Cash Audit can tell
 *      exactly which day each payout happened.
 *  - cash_audits: change_held, change_collected, outstanding_change, change_details (JSON)
 *      Existing saved audits keep their figures exactly as they were (all zero).
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];

function v7_table_exists(PDO $pdo, string $table): bool
{
    return $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table))->rowCount() > 0;
}

function v7_column_exists(PDO $pdo, string $table, string $column): bool
{
    return $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column))->rowCount() > 0;
}

try {
    // ---- 1. sale_transactions.change_amount -------------------------------
    if (!v7_table_exists($pdo, 'sale_transactions')) {
        $messages[] = ['err', 'The "sale_transactions" table does not exist. Run the earlier upgrades first.'];
    } elseif (v7_column_exists($pdo, 'sale_transactions', 'change_amount')) {
        $messages[] = ['ok', 'sale_transactions.change_amount already exists.'];
    } else {
        $pdo->exec("ALTER TABLE `sale_transactions`
                    ADD COLUMN `change_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00
                    COMMENT 'change the customer left behind on this sale (business owes the customer)'");
        $messages[] = ['ok', 'Added sale_transactions.change_amount.'];
    }

    // ---- 2. sale_change_collections ----------------------------------------
    if (v7_table_exists($pdo, 'sale_change_collections')) {
        $messages[] = ['ok', 'The "sale_change_collections" table already exists.'];
    } elseif (v7_table_exists($pdo, 'sale_transactions')) {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS `sale_change_collections` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
              `sale_id` INT UNSIGNED NOT NULL,
              `amount` DECIMAL(14,2) NOT NULL,
              `collected_date` DATE NOT NULL,
              `note` VARCHAR(255) NULL DEFAULT NULL,
              `recorded_by` INT UNSIGNED NULL DEFAULT NULL,
              `recorded_by_name` VARCHAR(100) NOT NULL DEFAULT '',
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `idx_scc_sale` (`sale_id`),
              KEY `idx_scc_date` (`collected_date`),
              CONSTRAINT `fk_scc_sale` FOREIGN KEY (`sale_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ");
        $messages[] = ['ok', 'Created the "sale_change_collections" table.'];
    }

    // ---- 3. cash_audits: new columns ---------------------------------------
    if (!v7_table_exists($pdo, 'cash_audits')) {
        $messages[] = ['err', 'The "cash_audits" table does not exist yet. Run upgrade_add_cash_audits.php and upgrade_v6_cash_audit_enhancements.php first, then run this again.'];
    } else {
        $newCols = [
            'change_held'        => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'change_collected'   => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'outstanding_change' => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'change_details'     => "TEXT NULL COMMENT 'JSON: customer change left / collected on the audit date'",
        ];
        foreach ($newCols as $col => $def) {
            if (v7_column_exists($pdo, 'cash_audits', $col)) {
                $messages[] = ['ok', "cash_audits.$col already exists."];
            } else {
                $pdo->exec("ALTER TABLE `cash_audits` ADD COLUMN `$col` $def");
                $messages[] = ['ok', "Added cash_audits.$col."];
            }
        }
    }
} catch (Exception $e) {
    $messages[] = ['err', 'Upgrade failed: ' . $e->getMessage()];
}

$failed = false;
foreach ($messages as $m) { if ($m[0] === 'err') $failed = true; }
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Upgrade v7 - eDESK STATIONERY</title>
<style>
  body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;}
  .box{background:#16213C;padding:40px;border-radius:14px;max-width:560px;}
  h2{color:#F0B849;margin-top:0;}
  .msg{padding:8px 14px;border-radius:8px;font-size:13.5px;margin:6px 0;text-align:left;}
  .ok{background:#173325;color:#8be0ac;}
  .err{background:#3a1c22;color:#ff9b9b;}
  a{color:#F0B849;}
</style>
</head>
<body>
  <div class="box">
    <h2>eDESK STATIONERY</h2>
    <p><?= $failed ? 'Upgrade finished with problems:' : 'Upgrade complete - Customer Change tracking is ready.' ?></p>
    <?php foreach ($messages as $m): ?>
      <div class="msg <?= $m[0] ?>"><?= htmlspecialchars($m[1]) ?></div>
    <?php endforeach; ?>
    <p><a href="../Frontend/sales.html">Go to the Sales page &rarr;</a></p>
  </div>
</body>
</html>
