<?php
/**
 * EDESK STATIONERY - Upgrade v6: Cash Audit, Credit/Debt & Bank Deposit enhancements
 *
 * Run ONCE (safe to run again - it only adds what is missing):
 *   http://yourdomain/edesk-stationery/Backend/upgrade_v6_cash_audit_enhancements.php
 *
 * Requires upgrade_add_cash_audits.php and upgrade_add_cash_float.php to have
 * been run already (it adds to the tables they created).
 *
 * What it adds
 *  - cash_audits: calc_version, debt_collected, debt_collected_online, outstanding_debts,
 *                 debt_payments (JSON), user_remark, total_cash, bank_deposit, remaining_cash,
 *                 bank_deposit_remark
 *      Existing saved audits are kept EXACTLY as they were (calc_version = 1, old formula).
 *  - bank_deposits: every bank deposit, with who/when, total cash, amount, remaining cash and remark.
 */
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];

function v6_table_exists(PDO $pdo, string $table): bool
{
    return $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table))->rowCount() > 0;
}

function v6_column_exists(PDO $pdo, string $table, string $column): bool
{
    return $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column))->rowCount() > 0;
}

try {
    // ---- 1. cash_audits: new columns ------------------------------------
    if (!v6_table_exists($pdo, 'cash_audits')) {
        $messages[] = ['err', 'The "cash_audits" table does not exist yet. Run upgrade_add_cash_audits.php first, then run this again.'];
    } else {
        $newCols = [
            'calc_version'          => "TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 = old formula, 2 = credit/debt aware'",
            'debt_collected'        => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'debt_collected_online' => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'outstanding_debts'     => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'debt_payments'         => "TEXT NULL COMMENT 'JSON: debt repayments received on the audit date'",
            'user_remark'           => 'TEXT NULL',
            'total_cash'            => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'bank_deposit'          => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'remaining_cash'        => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
            'bank_deposit_remark'   => 'TEXT NULL',
        ];
        foreach ($newCols as $col => $def) {
            if (v6_column_exists($pdo, 'cash_audits', $col)) {
                $messages[] = ['ok', "cash_audits.$col already exists."];
            } else {
                $pdo->exec("ALTER TABLE `cash_audits` ADD COLUMN `$col` $def");
                $messages[] = ['ok', "Added cash_audits.$col."];
            }
        }
    }

    // ---- 2. bank_deposits table ------------------------------------------
    if (v6_table_exists($pdo, 'bank_deposits')) {
        $messages[] = ['ok', 'The "bank_deposits" table already exists.'];
    } else {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS `bank_deposits` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
              `deposit_date` DATE NOT NULL,
              `audit_id` INT UNSIGNED NULL COMMENT 'latest cash audit of that date (kept in step automatically)',
              `total_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'cash counted before banking',
              `amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
              `remaining_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'total cash minus all deposits made that day up to and including this one',
              `remark` TEXT NULL,
              `saved_by` INT UNSIGNED NULL,
              `saved_by_name` VARCHAR(100) NOT NULL DEFAULT '',
              `saved_by_role` VARCHAR(20) NOT NULL DEFAULT '',
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `idx_bd_date` (`deposit_date`),
              KEY `idx_bd_saved_by` (`saved_by`),
              KEY `idx_bd_audit` (`audit_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ");
        $messages[] = ['ok', 'Created the "bank_deposits" table.'];
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
<title>Upgrade v6 - eDESK STATIONERY</title>
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
    <p><?= $failed ? 'Upgrade finished with problems:' : 'Upgrade complete - Cash Audit, credit/debt and bank deposit features are ready.' ?></p>
    <?php foreach ($messages as $m): ?>
      <div class="msg <?= $m[0] ?>"><?= htmlspecialchars($m[1]) ?></div>
    <?php endforeach; ?>
    <p><a href="../Frontend/sales.html">Go to the Sales page &rarr;</a></p>
  </div>
</body>
</html>
