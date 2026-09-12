<?php
function resolve_period(string $period, ?string $anchor = null, ?string $endCustom = null): array
{
    $anchor = $anchor ?: date('Y-m-d');

    switch ($period) {
        case 'day':
            return [$anchor, $anchor];

        case 'week':
            // Worker picks a starting date; system counts 7 days automatically.
            $start = new DateTime($anchor);
            $end   = (clone $start)->modify('+6 days');
            return [$start->format('Y-m-d'), $end->format('Y-m-d')];

        case 'month':
            $d = new DateTime($anchor);
            $start = new DateTime($d->format('Y-m-01'));
            $end   = new DateTime($d->format('Y-m-t'));
            return [$start->format('Y-m-d'), $end->format('Y-m-d')];

        case 'year':
            $d = new DateTime($anchor);
            $start = new DateTime($d->format('Y-01-01'));
            $end   = new DateTime($d->format('Y-12-31'));
            return [$start->format('Y-m-d'), $end->format('Y-m-d')];

        case 'custom':
            $end = $endCustom ?: $anchor;
            return [$anchor, $end];

        default:
            return [$anchor, $anchor];
    }
}

/**
 * Build the full report payload for a date range.
 */
function build_report(PDO $pdo, string $start, string $end): array
{
    // ---- Sales summary ----
    $stmt = $pdo->prepare('
        SELECT COALESCE(SUM(total_amount),0) AS total_sales,
               COALESCE(SUM(total_profit),0) AS total_profit,
               COUNT(*) AS transactions
        FROM sale_transactions WHERE sale_date BETWEEN ? AND ?
    ');
    $stmt->execute([$start, $end]);
    $salesSummary = $stmt->fetch();

    // ---- Expenses summary ----
    $stmt = $pdo->prepare('
        SELECT COALESCE(SUM(amount),0) AS total_expenses, COUNT(*) AS entries
        FROM expenses WHERE expense_date BETWEEN ? AND ?
    ');
    $stmt->execute([$start, $end]);
    $expenseSummary = $stmt->fetch();

    // ---- Damages summary ----
    $stmt = $pdo->prepare('
        SELECT COALESCE(SUM(loss_value),0) AS total_loss, COUNT(*) AS entries
        FROM damages WHERE damage_date BETWEEN ? AND ?
    ');
    $stmt->execute([$start, $end]);
    $damageSummary = $stmt->fetch();

    // ---- Top selling products/services (by quantity) ----
    // Grouped by PARENT product only, same as always - so a product with
    // types still shows one combined row/total here (e.g. "Pen" = every
    // type's quantity added together). The type-level split is attached
    // separately below, as a `types` list on each row, so both views are
    // available without changing what this main total means.
    $stmt = $pdo->prepare('
        SELECT p.id, p.name, p.is_service,
               SUM(si.quantity) AS qty_sold,
               SUM(si.subtotal) AS revenue,
               SUM(si.profit) AS profit
        FROM sale_items si
        JOIN sale_transactions st ON st.id = si.transaction_id
        JOIN products p ON p.id = si.product_id
        WHERE st.sale_date BETWEEN ? AND ?
        GROUP BY p.id, p.name, p.is_service
        ORDER BY qty_sold DESC
        LIMIT 10
    ');
    $stmt->execute([$start, $end]);
    $topSelling = $stmt->fetchAll();

    // ---- Most profitable products/services ----
    $stmt = $pdo->prepare('
        SELECT p.id, p.name, p.is_service,
               SUM(si.quantity) AS qty_sold,
               SUM(si.subtotal) AS revenue,
               SUM(si.profit) AS profit
        FROM sale_items si
        JOIN sale_transactions st ON st.id = si.transaction_id
        JOIN products p ON p.id = si.product_id
        WHERE st.sale_date BETWEEN ? AND ?
        GROUP BY p.id, p.name, p.is_service
        ORDER BY profit DESC
        LIMIT 10
    ');
    $stmt->execute([$start, $end]);
    $mostProfitable = $stmt->fetchAll();

    // ---- Type-level breakdown, for parents that have variant sales ----
    // Attached below onto matching rows of top_selling/most_profitable as
    // a `types` array, so the report can show both:
    //   Pen — Total: 80 sold
    //     ↳ Obama Pen — 50 sold
    //     ↳ Marker Pen — 30 sold
    // Wrapped defensively in case product_variants doesn't exist yet on
    // this install - falls back to no breakdown, no crash.
    $typeBreakdown = [];
    try {
        $stmt = $pdo->prepare('
            SELECT si.product_id, pv.id AS variant_id, pv.variant_name,
                   SUM(si.quantity) AS qty_sold,
                   SUM(si.subtotal) AS revenue,
                   SUM(si.profit) AS profit
            FROM sale_items si
            JOIN sale_transactions st ON st.id = si.transaction_id
            JOIN product_variants pv ON pv.id = si.variant_id
            WHERE st.sale_date BETWEEN ? AND ?
            GROUP BY si.product_id, pv.id, pv.variant_name
            ORDER BY qty_sold DESC
        ');
        $stmt->execute([$start, $end]);
        foreach ($stmt->fetchAll() as $row) {
            $typeBreakdown[$row['product_id']][] = $row;
        }
    } catch (PDOException $e) {
        // product_variants table not present yet - no breakdown, no crash.
    }

    foreach ($topSelling as &$row) {
        $row['types'] = $typeBreakdown[$row['id']] ?? [];
    }
    unset($row);
    foreach ($mostProfitable as &$row) {
        $row['types'] = $typeBreakdown[$row['id']] ?? [];
    }
    unset($row);

    // ---- Expense breakdown by category ----
    $stmt = $pdo->prepare('
        SELECT category, SUM(amount) AS total
        FROM expenses WHERE expense_date BETWEEN ? AND ?
        GROUP BY category ORDER BY total DESC
    ');
    $stmt->execute([$start, $end]);
    $expenseBreakdown = $stmt->fetchAll();

    // ---- Damage detail list ----
    // product_name folds in the type name (e.g. "Pen — Obama Pen") when
    // the damage was recorded against a specific type. Wrapped
    // defensively in case the variant_id column isn't there yet.
    try {
        $stmt = $pdo->prepare('
            SELECT d.id, COALESCE(CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, " — ", pv.variant_name) ELSE p.name END, d.item_name) AS product_name,
                   d.item_type, d.quantity, d.reason, d.loss_value, d.damage_date
            FROM damages d
            LEFT JOIN products p ON p.id = d.product_id
            LEFT JOIN product_variants pv ON pv.id = d.variant_id
            WHERE d.damage_date BETWEEN ? AND ?
            ORDER BY d.damage_date DESC
        ');
        $stmt->execute([$start, $end]);
        $damageList = $stmt->fetchAll();
    } catch (PDOException $e) {
        $stmt = $pdo->prepare('
            SELECT d.id, COALESCE(p.name, d.item_name) AS product_name, d.item_type, d.quantity, d.reason, d.loss_value, d.damage_date
            FROM damages d LEFT JOIN products p ON p.id = d.product_id
            WHERE d.damage_date BETWEEN ? AND ?
            ORDER BY d.damage_date DESC
        ');
        $stmt->execute([$start, $end]);
        $damageList = $stmt->fetchAll();
    }

    $netProfit = (float)$salesSummary['total_profit'] - (float)$expenseSummary['total_expenses'] - (float)$damageSummary['total_loss'];

    return [
        'range' => ['start' => $start, 'end' => $end],
        'sales' => $salesSummary,
        'expenses' => $expenseSummary,
        'damages' => $damageSummary,
        'net_profit' => round($netProfit, 2),
        'top_selling' => $topSelling,
        'most_profitable' => $mostProfitable,
        'expense_breakdown' => $expenseBreakdown,
        'damage_list' => $damageList,
    ];
}

/**
 * Stream a CSV version of the report straight to the browser and exit.
 */
function stream_report_csv(array $report, string $shopName): void
{
    $filename = 'EDESK_Report_' . $report['range']['start'] . '_to_' . $report['range']['end'] . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');

    $out = fopen('php://output', 'w');

    fputcsv($out, [$shopName . ' - Business Report']);
    fputcsv($out, ['Period', $report['range']['start'] . ' to ' . $report['range']['end']]);
    fputcsv($out, []);

    fputcsv($out, ['SUMMARY']);
    fputcsv($out, ['Total Sales (TZS)', $report['sales']['total_sales']]);
    fputcsv($out, ['Total Transactions', $report['sales']['transactions']]);
    fputcsv($out, ['Gross Profit (TZS)', $report['sales']['total_profit']]);
    fputcsv($out, ['Total Expenses (TZS)', $report['expenses']['total_expenses']]);
    fputcsv($out, ['Total Damage/Loss (TZS)', $report['damages']['total_loss']]);
    fputcsv($out, ['Net Profit (TZS)', $report['net_profit']]);
    fputcsv($out, []);

    fputcsv($out, ['TOP SELLING PRODUCTS / SERVICES (by quantity)']);
    fputcsv($out, ['Name', 'Type', 'Qty Sold', 'Revenue (TZS)', 'Profit (TZS)']);
    foreach ($report['top_selling'] as $row) {
        $label = !empty($row['types']) ? $row['name'] . ' — Total' : $row['name'];
        fputcsv($out, [$label, $row['is_service'] ? 'Service' : 'Product', $row['qty_sold'], $row['revenue'], $row['profit']]);
        foreach ($row['types'] ?? [] as $t) {
            fputcsv($out, ['    ' . $t['variant_name'], '', $t['qty_sold'], $t['revenue'], $t['profit']]);
        }
    }
    fputcsv($out, []);

    fputcsv($out, ['MOST PROFITABLE PRODUCTS / SERVICES']);
    fputcsv($out, ['Name', 'Type', 'Qty Sold', 'Revenue (TZS)', 'Profit (TZS)']);
    foreach ($report['most_profitable'] as $row) {
        $label = !empty($row['types']) ? $row['name'] . ' — Total' : $row['name'];
        fputcsv($out, [$label, $row['is_service'] ? 'Service' : 'Product', $row['qty_sold'], $row['revenue'], $row['profit']]);
        foreach ($row['types'] ?? [] as $t) {
            fputcsv($out, ['    ' . $t['variant_name'], '', $t['qty_sold'], $t['revenue'], $t['profit']]);
        }
    }
    fputcsv($out, []);

    fputcsv($out, ['EXPENSE BREAKDOWN']);
    fputcsv($out, ['Category', 'Amount (TZS)']);
    foreach ($report['expense_breakdown'] as $row) {
        fputcsv($out, [$row['category'], $row['total']]);
    }
    fputcsv($out, []);

    fputcsv($out, ['DAMAGES / WASTED STOCK']);
    fputcsv($out, ['Product', 'Quantity', 'Reason', 'Loss Value (TZS)', 'Date']);
    foreach ($report['damage_list'] as $row) {
        fputcsv($out, [$row['product_name'], $row['quantity'], $row['reason'], $row['loss_value'], $row['damage_date']]);
    }

    fclose($out);
    exit;
}
