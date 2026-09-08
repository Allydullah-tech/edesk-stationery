<?php
/**
 * eDESK Print & Digital - Upgrade: Multi-Item Sales & Customer 360
 * ------------------------------------------------------------
 * Run this ONCE in your browser (BACK UP YOUR DATABASE FIRST - this
 * migration restructures how sales are stored):
 *   http://yourdomain/edesk-stationery/Backend/upgrade_v4_sales_customers.php
 *
 * This is the single biggest change made to this system so far. It
 * replaces the old one-row-per-product `sales` table with a proper
 * transaction structure:
 *
 *   customers          - one row per real customer (matched by phone
 *                         when given, otherwise by name).
 *   sale_transactions  - one row per checkout/receipt. Holds the
 *                         customer, payment method, and grand total.
 *   sale_items         - one row per product within a transaction.
 *                         Many sale_items belong to one sale_transaction.
 *
 * Existing data is migrated, not discarded:
 *   - Every existing row in `sales` becomes exactly one
 *     sale_transactions row + one sale_items row (a single-item
 *     transaction) - so nothing you've already recorded is lost or
 *     changed in meaning.
 *   - Transaction IDs are preserved from the old sales.id, so
 *     debt_payments (which points at a sale by id) keeps working
 *     without needing to be touched.
 *   - The old `sales` table is renamed to `sales_legacy_backup`
 *     rather than deleted, in case anything needs to be double-checked
 *     against it later.
 *
 * Also adds:
 *   - customers.status (active/restricted) and the fields needed to
 *     track WHY and WHEN a customer was restricted.
 *   - debt_payments.method / online_method, so debt repayments (not
 *     just the original sale) can be counted toward "cash vs online"
 *     payment-trend figures.
 *
 * Safe to run more than once - every step checks whether it already
 * happened before doing it again.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/db.php';

$pdo = get_db();
$messages = [];

function table_exists(PDO $pdo, string $table): bool {
    $stmt = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table));
    return $stmt->rowCount() > 0;
}
function column_exists(PDO $pdo, string $table, string $column): bool {
    $stmt = $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column));
    return $stmt->rowCount() > 0;
}

try {
    $pdo->beginTransaction();

    // ---- 1. customers ----
    if (table_exists($pdo, 'customers')) {
        $messages[] = ['ok', 'The "customers" table already exists.'];
    } else {
        $pdo->exec("
            CREATE TABLE customers (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name VARCHAR(150) NULL,
                phone VARCHAR(30) NULL,
                status ENUM('active','restricted') NOT NULL DEFAULT 'active',
                restricted_at DATETIME NULL DEFAULT NULL,
                restricted_reason VARCHAR(255) NULL DEFAULT NULL,
                restriction_overridden_by INT UNSIGNED NULL DEFAULT NULL,
                first_purchase_date DATE NULL DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_customer_phone (phone),
                KEY idx_customer_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
        $messages[] = ['ok', 'Created the "customers" table.'];
    }

    // ---- 2. sale_transactions ----
    if (table_exists($pdo, 'sale_transactions')) {
        $messages[] = ['ok', 'The "sale_transactions" table already exists.'];
    } else {
        $pdo->exec("
            CREATE TABLE sale_transactions (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                customer_id INT UNSIGNED NULL DEFAULT NULL,
                customer_name VARCHAR(150) NULL DEFAULT NULL,
                customer_phone VARCHAR(30) NULL DEFAULT NULL,
                payment_method ENUM('cash','credit') NOT NULL DEFAULT 'cash',
                cash_type ENUM('cash_in_hand','online') NULL DEFAULT NULL,
                online_method VARCHAR(50) NULL DEFAULT NULL,
                credit_deadline DATE NULL DEFAULT NULL,
                total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
                total_profit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
                note VARCHAR(255) NULL DEFAULT NULL,
                sold_by INT UNSIGNED NOT NULL,
                sale_date DATE NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY fk_txn_customer (customer_id),
                KEY fk_txn_user (sold_by),
                KEY idx_txn_date (sale_date),
                CONSTRAINT fk_txn_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
                CONSTRAINT fk_txn_user FOREIGN KEY (sold_by) REFERENCES users (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
        $messages[] = ['ok', 'Created the "sale_transactions" table.'];
    }

    // ---- 3. sale_items ----
    if (table_exists($pdo, 'sale_items')) {
        $messages[] = ['ok', 'The "sale_items" table already exists.'];
    } else {
        $pdo->exec("
            CREATE TABLE sale_items (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                transaction_id INT UNSIGNED NOT NULL,
                product_id INT UNSIGNED NOT NULL,
                quantity DECIMAL(12,2) NOT NULL,
                unit_price DECIMAL(14,2) NOT NULL,
                buying_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
                subtotal DECIMAL(14,2) NOT NULL,
                profit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
                PRIMARY KEY (id),
                KEY fk_item_txn (transaction_id),
                KEY fk_item_product (product_id),
                CONSTRAINT fk_item_txn FOREIGN KEY (transaction_id) REFERENCES sale_transactions (id) ON DELETE CASCADE,
                CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
        $messages[] = ['ok', 'Created the "sale_items" table.'];
    }

    // ---- 4. debt_payments: track HOW a repayment was made ----
    if (table_exists($pdo, 'debt_payments')) {
        if (!column_exists($pdo, 'debt_payments', 'method')) {
            $pdo->exec("ALTER TABLE debt_payments ADD COLUMN method ENUM('cash_in_hand','online') NOT NULL DEFAULT 'cash_in_hand' AFTER amount");
            $messages[] = ['ok', 'Added "method" to debt_payments.'];
        }
        if (!column_exists($pdo, 'debt_payments', 'online_method')) {
            $pdo->exec("ALTER TABLE debt_payments ADD COLUMN online_method VARCHAR(50) NULL DEFAULT NULL AFTER method");
            $messages[] = ['ok', 'Added "online_method" to debt_payments.'];
        }
    }

    // ---- 5. Migrate existing `sales` rows, once ----
    if (table_exists($pdo, 'sales')) {
        // Build/find a customer for every distinct (name, phone) pair
        // seen in the old sales table, so migrated transactions link
        // to a real customer record just like new ones will.
        $pairsStmt = $pdo->query("SELECT DISTINCT customer_name, customer_phone FROM sales WHERE (customer_name IS NOT NULL AND customer_name != '') OR (customer_phone IS NOT NULL AND customer_phone != '')");
        $pairs = $pairsStmt->fetchAll();
        $phoneToCustomerId = [];
        $nameOnlyToCustomerId = [];

        foreach ($pairs as $pair) {
            $name = trim($pair['customer_name'] ?? '');
            $phone = trim($pair['customer_phone'] ?? '');

            if ($phone !== '') {
                if (!isset($phoneToCustomerId[$phone])) {
                    $existing = $pdo->prepare('SELECT id FROM customers WHERE phone = ?');
                    $existing->execute([$phone]);
                    $existingId = $existing->fetchColumn();
                    if ($existingId) {
                        $phoneToCustomerId[$phone] = $existingId;
                    } else {
                        $ins = $pdo->prepare('INSERT INTO customers (name, phone, created_at) VALUES (?,?,NOW())');
                        $ins->execute([$name !== '' ? $name : null, $phone]);
                        $phoneToCustomerId[$phone] = $pdo->lastInsertId();
                    }
                } elseif ($name !== '') {
                    // Keep the customer's name up to date with the latest sale that named them.
                    $pdo->prepare('UPDATE customers SET name = ? WHERE id = ? AND (name IS NULL OR name = "")')
                        ->execute([$name, $phoneToCustomerId[$phone]]);
                }
            } elseif ($name !== '') {
                $key = mb_strtolower($name);
                if (!isset($nameOnlyToCustomerId[$key])) {
                    $existing = $pdo->prepare('SELECT id FROM customers WHERE phone IS NULL AND LOWER(name) = ?');
                    $existing->execute([$key]);
                    $existingId = $existing->fetchColumn();
                    if ($existingId) {
                        $nameOnlyToCustomerId[$key] = $existingId;
                    } else {
                        $ins = $pdo->prepare('INSERT INTO customers (name, phone, created_at) VALUES (?, NULL, NOW())');
                        $ins->execute([$name]);
                        $nameOnlyToCustomerId[$key] = $pdo->lastInsertId();
                    }
                }
            }
        }

        // Copy every sales row into sale_transactions, preserving its id
        // so debt_payments.sale_id keeps pointing at the right thing.
        $rows = $pdo->query('SELECT * FROM sales')->fetchAll();
        $txnInsert = $pdo->prepare("INSERT INTO sale_transactions
            (id, customer_id, customer_name, customer_phone, payment_method, cash_type, online_method, credit_deadline, total_amount, total_profit, note, sold_by, sale_date, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $itemInsert = $pdo->prepare("INSERT INTO sale_items (transaction_id, product_id, quantity, unit_price, buying_price, subtotal, profit) VALUES (?,?,?,?,?,?,?)");

        foreach ($rows as $r) {
            $name = trim($r['customer_name'] ?? '');
            $phone = trim($r['customer_phone'] ?? '');
            $customerId = null;
            if ($phone !== '' && isset($phoneToCustomerId[$phone])) $customerId = $phoneToCustomerId[$phone];
            elseif ($phone === '' && $name !== '' && isset($nameOnlyToCustomerId[mb_strtolower($name)])) $customerId = $nameOnlyToCustomerId[mb_strtolower($name)];

            $txnInsert->execute([
                $r['id'], $customerId, $name !== '' ? $name : null, $phone !== '' ? $phone : null,
                $r['payment_method'], $r['cash_type'], $r['online_method'], $r['credit_deadline'],
                $r['total_amount'], $r['profit'], $r['note'], $r['sold_by'], $r['sale_date'], $r['created_at'],
            ]);
            $itemInsert->execute([
                $r['id'], $r['product_id'], $r['quantity'], $r['unit_price'], $r['buying_price'], $r['total_amount'], $r['profit'],
            ]);
        }

        // Backfill first_purchase_date for every customer created above.
        $pdo->exec("
            UPDATE customers c
            JOIN (SELECT customer_id, MIN(sale_date) AS first_date FROM sale_transactions WHERE customer_id IS NOT NULL GROUP BY customer_id) t
            ON t.customer_id = c.id
            SET c.first_purchase_date = t.first_date
            WHERE c.first_purchase_date IS NULL
        ");

        $pdo->exec('RENAME TABLE sales TO sales_legacy_backup');
        $messages[] = ['ok', 'Migrated ' . count($rows) . ' existing sale(s) into the new structure. The old table is kept as "sales_legacy_backup" (not deleted).'];
    } else {
        $messages[] = ['ok', 'No old "sales" table found - nothing to migrate (probably already done).'];
    }

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
    <p>This page only touched the database. The Sales, Debts, Customers, Reports, and Dashboard pages/APIs still need to be rebuilt to use the new tables before anything will work again - that's the next step.</p>
  </div>
</body>
</html>
