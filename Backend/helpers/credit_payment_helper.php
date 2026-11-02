<?php
/**
 * EDESK STATIONERY - Initial payment on a credit sale ("Amount Paid Now")
 *
 * The part a customer pays at the moment of a credit sale is stored as an ordinary
 * debt_payments row (same table, same cash / online fields as every later repayment),
 * flagged is_initial = 1. Because it is a normal repayment dated the sale date, the
 * Cash Audit, Debts, Customers and Dashboard figures pick it up with no separate
 * payment mechanism and no duplicated logic.
 */

/**
 * Is the debt_payments.is_initial column there?
 * $create = true adds it on the spot (a one-off ALTER; it must run BEFORE a transaction
 * begins because MySQL commits implicitly on DDL). Same result as upgrade_v14_initial_payment.php.
 */
function dp_initial_ready(PDO $pdo, bool $create = false): bool
{
    static $ready = null;
    if ($ready === true) return true;
    try {
        if ($pdo->query("SHOW COLUMNS FROM `debt_payments` LIKE 'is_initial'")->rowCount() > 0) {
            return $ready = true;
        }
        if (!$create) return false; // not cached: a later call may still create it
        $pdo->exec("ALTER TABLE `debt_payments` ADD COLUMN `is_initial` TINYINT(1) NOT NULL DEFAULT 0 AFTER `note`");
        return $ready = true;
    } catch (Throwable $e) {
        return false;
    }
}

/** Money rounded the way the rest of the app stores it. */
function dp_money($v): float
{
    return round((float)$v, 2);
}

/**
 * SQL fragments (selected columns) giving a credit sale's initial payment, for a query whose
 * sale_transactions alias is $alias. Empty-safe: before the column exists it returns zeros.
 */
function dp_initial_select_sql(PDO $pdo, string $alias = 's'): string
{
    if (!dp_initial_ready($pdo)) {
        return "0 AS initial_paid, NULL AS initial_method, NULL AS initial_online_method";
    }
    $base = "FROM debt_payments ip WHERE ip.sale_id = {$alias}.id AND ip.is_initial = 1";
    return "COALESCE((SELECT SUM(ip.amount) $base), 0) AS initial_paid,
            (SELECT ip.method $base ORDER BY ip.id ASC LIMIT 1) AS initial_method,
            (SELECT ip.online_method $base ORDER BY ip.id ASC LIMIT 1) AS initial_online_method";
}
