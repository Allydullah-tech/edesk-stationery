<?php
/**
 * eDESK Print & Digital - Customer Profiles API (read-only)
 *
 * Backed by the real `customers` table (see
 * Backend/upgrade_v4_sales_customers.php) - one row per matched
 * customer (by phone if given, else by exact name). This means
 * name-only customers (no phone) now appear here too, which the
 * previous phone-only-aggregation version could not show.
 *
 * NOTE: this is the data layer only. The full "Customer 360" profile
 * (payment trends, debt trend chart, activity timeline, risk scoring
 * display, search/sort/filter UI) described in the newer spec is a
 * separate, larger frontend build that has not been done yet - this
 * file currently returns the same fields the existing Customers page
 * already displays, plus `status`/`id` so that page can be extended
 * without another backend rewrite.
 *
 * GET (no params) -> list every customer, with aggregate stats.
 *                    ?q= filters by name/phone.
 *                    ?start= / ?end= restrict "Purchases", "Total Spent"
 *                    and "Last Purchase" to sales made in that date
 *                    range - only customers with at least one sale in
 *                    the range are then returned. Outstanding debt and
 *                    overdue count are always CURRENT figures (not
 *                    period-bound), since a balance owed today isn't a
 *                    historical fact tied to any one date range.
 * GET ?id=...     -> one customer's full profile: summary, every sale
 *                    (transaction), and `payment_records` - a merged,
 *                    date-sorted list of cash sales, debt repayments,
 *                    and debts currently sitting overdue. This is a
 *                    record of what happened, not a score - no
 *                    restriction logic lives here.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/customer_helper.php';

require_role(['admin', 'worker']);
$pdo = get_db();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(false, null, 'Unsupported method.', 405);
}

/** Shared per-customer aggregate, reused by both the list and detail views. */
function customer_summary_select(): string {
    return "
        c.id, c.name, c.phone, c.status, c.first_purchase_date,
        COUNT(st.id) AS total_purchases,
        COALESCE(SUM(st.total_amount), 0) AS total_spent,
        MAX(st.sale_date) AS last_purchase_date,
        SUM(st.payment_method = 'credit') AS credit_purchases,
        COALESCE((
            SELECT SUM(st2.total_amount) - COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = st2.id), 0)
            FROM sale_transactions st2 WHERE st2.customer_id = c.id AND st2.payment_method = 'credit'
        ), 0) AS total_outstanding,
        COALESCE((
            SELECT COUNT(*) FROM sale_transactions st3
            WHERE st3.customer_id = c.id AND st3.payment_method = 'credit'
              AND st3.credit_deadline < CURDATE()
              AND (st3.total_amount - COALESCE((SELECT SUM(dp2.amount) FROM debt_payments dp2 WHERE dp2.sale_id = st3.id), 0)) > 0.01
        ), 0) AS overdue_count
    ";
}

if (isset($_GET['id'])) {
    $id = (int)$_GET['id'];

    $sumStmt = $pdo->prepare("SELECT " . customer_summary_select() . " FROM customers c
                               LEFT JOIN sale_transactions st ON st.customer_id = c.id
                               WHERE c.id = ? GROUP BY c.id");
    $sumStmt->execute([$id]);
    $summary = $sumStmt->fetch();
    if (!$summary) respond(false, null, 'Customer not found.', 404);

    $salesStmt = $pdo->prepare("SELECT st.id, st.sale_date, st.total_amount, st.payment_method, st.credit_deadline,
                                        (SELECT GROUP_CONCAT(CONCAT(p.name, ' x', si.quantity) SEPARATOR ', ')
                                            FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.transaction_id = st.id) AS items_summary,
                                        COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = st.id), 0) AS paid_amount
                                 FROM sale_transactions st
                                 WHERE st.customer_id = ?
                                 ORDER BY st.sale_date DESC, st.id DESC");
    $salesStmt->execute([$id]);
    $sales = $salesStmt->fetchAll();

    // ---- Payment records: every cash sale, every debt repayment, and
    // every debt currently sitting overdue - merged into one
    // chronological list. This is a record of what happened, not a
    // score or a restriction check.
    $records = [];

    $cashStmt = $pdo->prepare("SELECT id AS sale_id, sale_date AS event_date, total_amount AS amount, cash_type, online_method
                                FROM sale_transactions WHERE customer_id = ? AND payment_method = 'cash'
                                ORDER BY sale_date DESC, id DESC");
    $cashStmt->execute([$id]);
    foreach ($cashStmt->fetchAll() as $row) {
        $records[] = [
            'type' => 'cash_sale',
            'event_date' => $row['event_date'],
            'amount' => (float)$row['amount'],
            'method' => $row['cash_type'],
            'online_method' => $row['online_method'],
            'sale_id' => (int)$row['sale_id'],
        ];
    }

    $debtPayStmt = $pdo->prepare("SELECT dp.sale_id, dp.payment_date AS event_date, dp.amount, dp.method, dp.online_method
                                   FROM debt_payments dp JOIN sale_transactions st ON st.id = dp.sale_id
                                   WHERE st.customer_id = ?
                                   ORDER BY dp.payment_date DESC, dp.id DESC");
    $debtPayStmt->execute([$id]);
    foreach ($debtPayStmt->fetchAll() as $row) {
        $records[] = [
            'type' => 'debt_payment',
            'event_date' => $row['event_date'],
            'amount' => (float)$row['amount'],
            'method' => $row['method'],
            'online_method' => $row['online_method'],
            'sale_id' => (int)$row['sale_id'],
        ];
    }

    $overdueStmt = $pdo->prepare("SELECT st.id AS sale_id, st.credit_deadline AS event_date,
                                          st.total_amount - COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = st.id), 0) AS amount
                                   FROM sale_transactions st
                                   WHERE st.customer_id = ? AND st.payment_method = 'credit'
                                     AND st.credit_deadline < CURDATE()
                                     AND (st.total_amount - COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = st.id), 0)) > 0.01
                                   ORDER BY st.credit_deadline DESC");
    $overdueStmt->execute([$id]);
    foreach ($overdueStmt->fetchAll() as $row) {
        $records[] = [
            'type' => 'debt_overdue',
            'event_date' => $row['event_date'],
            'amount' => (float)$row['amount'],
            'method' => null,
            'online_method' => null,
            'sale_id' => (int)$row['sale_id'],
        ];
    }

    usort($records, fn($a, $b) => strcmp($b['event_date'], $a['event_date']));

    respond(true, ['summary' => $summary, 'sales' => $sales, 'payment_records' => $records]);
}

// Date range restricts which sale_transactions rows feed the "Purchases" /
// "Total Spent" / "Last Purchase" aggregates. It's applied in the JOIN's ON
// clause (not WHERE) so a LEFT JOIN still returns every customer row even
// when none of their sales fall in the range - they just show zeroed
// aggregates, and are then dropped via HAVING below so the list only shows
// customers who were actually active in the chosen period.
$joinDateSql = '';
$joinDateParams = [];
$hasDateFilter = false;
if (!empty($_GET['start'])) { $joinDateSql .= ' AND st.sale_date >= ?'; $joinDateParams[] = clean($_GET['start']); $hasDateFilter = true; }
if (!empty($_GET['end']))   { $joinDateSql .= ' AND st.sale_date <= ?'; $joinDateParams[] = clean($_GET['end']); $hasDateFilter = true; }

$havingParts = [];
$havingParams = [];
if (!empty($_GET['q'])) {
    $q = '%' . clean($_GET['q']) . '%';
    $havingParts[] = '(c.name LIKE ? OR c.phone LIKE ?)';
    $havingParams[] = $q;
    $havingParams[] = $q;
}
if ($hasDateFilter) {
    $havingParts[] = 'total_purchases > 0';
}
$havingSql = $havingParts ? ('HAVING ' . implode(' AND ', $havingParts)) : '';

$stmt = $pdo->prepare("SELECT " . customer_summary_select() . "
                        FROM customers c
                        LEFT JOIN sale_transactions st ON st.customer_id = c.id $joinDateSql
                        GROUP BY c.id
                        $havingSql
                        ORDER BY total_spent DESC");
$stmt->execute(array_merge($joinDateParams, $havingParams));
respond(true, $stmt->fetchAll());
