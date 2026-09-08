<?php
/**
 * eDESK STATIONERY - Purchases API
 * Handles stock being received - either one product at a time, or a
 * bulk list imported from a supplier's Excel/CSV file.
 *
 * GET  -> list recent purchases (any logged-in user can view)
 *         optional filters: ?source=manual|import
 *                            &period=day|week|month|year|custom &date=YYYY-MM-DD &end=YYYY-MM-DD
 *         (period/date/end resolved the same way as the Reports page - see resolve_period())
 * POST -> admin only. body: { items: [ { name, quantity, buying_price, selling_price,
 *                             category, unit, purchase_date, note }, ... ] }
 *         For each item: if a product with that name already exists in
 *         Stock (case-insensitive match), its stock_quantity is increased
 *         and its prices are updated only if new prices were given.
 *         If no match exists, a brand new product is created (buying and
 *         selling price are required in that case).
 *         The whole batch is all-or-nothing: if any row fails validation,
 *         nothing is saved and the specific problem is reported back.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/report_helper.php';

$user = require_login();
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $limit = !empty($_GET['limit']) ? (int)$_GET['limit'] : 100;

    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['source']) && in_array($_GET['source'], ['manual', 'import'], true)) {
        $where .= ' AND pu.source = ?';
        $params[] = $_GET['source'];
    }
    if (!empty($_GET['period']) && in_array($_GET['period'], ['day', 'week', 'month', 'year', 'custom'], true)) {
        $anchor = !empty($_GET['date']) ? clean($_GET['date']) : null;
        $endCustom = !empty($_GET['end']) ? clean($_GET['end']) : null;
        [$periodStart, $periodEnd] = resolve_period($_GET['period'], $anchor, $endCustom);
        $where .= ' AND pu.purchase_date BETWEEN ? AND ?';
        $params[] = $periodStart;
        $params[] = $periodEnd;
    }

    $stmt = $pdo->prepare("SELECT pu.*, p.name AS product_name, p.unit, u.full_name AS recorded_by_name
                            FROM purchases pu
                            JOIN products p ON p.id = pu.product_id
                            JOIN users u ON u.id = pu.recorded_by
                            $where ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT $limit");
    $stmt->execute($params);
    respond(true, $stmt->fetchAll());
}

if ($method === 'POST') {
    $user = require_role(['admin']);
    $d = body();
    $items = $d['items'] ?? null;

    if (!is_array($items) || count($items) === 0) {
        respond(false, null, 'No items were submitted.', 422);
    }

    // ---- Pass 1: validate everything first, resolve product matches ----
    $resolved = [];
    $errors = [];

    foreach ($items as $i => $item) {
        $rowNum = $i + 1;
        $name = clean($item['name'] ?? '');
        $qty = isset($item['quantity']) && $item['quantity'] !== '' ? (int)$item['quantity'] : null;

        if ($name === '') { $errors[] = "Row $rowNum: product name is missing."; continue; }
        if ($qty === null || $qty <= 0) { $errors[] = "Row $rowNum ($name): enter a valid quantity."; continue; }

        $stmt = $pdo->prepare('SELECT * FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1');
        $stmt->execute([$name]);
        $existing = $stmt->fetch();

        $buyingPrice = isset($item['buying_price']) && $item['buying_price'] !== '' ? (float)$item['buying_price'] : null;
        $sellingPrice = isset($item['selling_price']) && $item['selling_price'] !== '' ? (float)$item['selling_price'] : null;

        if (!$existing) {
            if ($buyingPrice === null || $sellingPrice === null) {
                $errors[] = "Row $rowNum ($name): this is a new product, so both Buying Price and Selling Price are required.";
                continue;
            }
        }

        $resolved[] = [
            'name' => $name,
            'quantity' => $qty,
            'buying_price' => $buyingPrice,
            'selling_price' => $sellingPrice,
            'category' => clean($item['category'] ?? ''),
            'unit' => clean($item['unit'] ?? 'pcs') ?: 'pcs',
            'existing' => $existing,
        ];
    }

    if (!empty($errors)) {
        respond(false, ['errors' => $errors], 'Please fix the following before importing: ' . implode(' ', $errors), 422);
    }

    // ---- Pass 2: apply all writes in one transaction ----
    try {
        $pdo->beginTransaction();
        $purchaseDate = !empty($d['purchase_date']) ? clean($d['purchase_date']) : today();
        $source = !empty($d['source']) && $d['source'] === 'import' ? 'import' : 'manual';
        $created = 0;
        $updated = 0;

        foreach ($resolved as $row) {
            if ($row['existing']) {
                $productId = $row['existing']['id'];
                $fields = ['stock_quantity = stock_quantity + ?'];
                $params = [$row['quantity']];

                if ($row['buying_price'] !== null) { $fields[] = 'buying_price = ?'; $params[] = $row['buying_price']; }
                if ($row['selling_price'] !== null) { $fields[] = 'selling_price = ?'; $params[] = $row['selling_price']; }
                $fields[] = 'updated_at = NOW()';
                $params[] = $productId;

                $pdo->prepare('UPDATE products SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
                $buyingPriceUsed = $row['buying_price'] !== null ? $row['buying_price'] : (float)$row['existing']['buying_price'];
                $updated++;
            } else {
                $categoryId = null;
                if ($row['category'] !== '') {
                    $pdo->prepare('INSERT INTO categories (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name')->execute([$row['category']]);
                    $g = $pdo->prepare('SELECT id FROM categories WHERE name = ?');
                    $g->execute([$row['category']]);
                    $categoryId = $g->fetchColumn();
                }

                $ins = $pdo->prepare('INSERT INTO products
                    (name, category_id, is_service, unit, buying_price, selling_price, stock_quantity, reorder_level, status, created_by, created_at, updated_at)
                    VALUES (?,?,0,?,?,?,?,5,"active",?,NOW(),NOW())');
                $ins->execute([
                    $row['name'], $categoryId, $row['unit'],
                    $row['buying_price'], $row['selling_price'], $row['quantity'], $user['id'],
                ]);
                $productId = $pdo->lastInsertId();
                $buyingPriceUsed = $row['buying_price'];
                $created++;
            }

            $totalCost = round($row['quantity'] * $buyingPriceUsed, 2);
            $pdo->prepare('INSERT INTO purchases (product_id, quantity, buying_price, total_cost, source, note, recorded_by, purchase_date, created_at)
                            VALUES (?,?,?,?,?,?,?,?,NOW())')
                ->execute([$productId, $row['quantity'], $buyingPriceUsed, $totalCost, $source, clean($d['note'] ?? ''), $user['id'], $purchaseDate]);
        }

        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        respond(false, null, 'Could not save the purchase. Please try again.', 500);
    }

    $itemSummary = count($resolved) === 1
        ? '"' . $resolved[0]['name'] . '" (' . $resolved[0]['quantity'] . ' ' . $resolved[0]['unit'] . ')'
        : count($resolved) . ' product(s)';
    log_activity($pdo, $user, 'create', 'purchase', null,
        'Recorded a ' . $source . ' purchase of ' . $itemSummary . ': ' . $created . ' new item(s) added, ' . $updated . ' item(s) restocked');

    respond(true, ['created' => $created, 'updated' => $updated], "Stock updated: $created new item(s) added, $updated existing item(s) restocked.");
}

respond(false, null, 'Unsupported method.', 405);
