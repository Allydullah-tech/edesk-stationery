<?php
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

    // product_name/unit fold in the type name (e.g. "Pen — Obama Pen") so
    // the Purchases table needs no other changes. Wrapped defensively in
    // case Backend/upgrade_add_variant_to_purchases_damages.php hasn't
    // been run yet on this install (older "purchases" table without the
    // variant_id column) - the page should still load either way.
    try {
        $stmt = $pdo->prepare("SELECT pu.*,
                                CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, ' — ', pv.variant_name) ELSE p.name END AS product_name,
                                COALESCE(pv.unit, p.unit) AS unit, u.full_name AS recorded_by_name
                                FROM purchases pu
                                JOIN products p ON p.id = pu.product_id
                                LEFT JOIN product_variants pv ON pv.id = pu.variant_id
                                JOIN users u ON u.id = pu.recorded_by
                                $where ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT $limit");
        $stmt->execute($params);
        respond(true, $stmt->fetchAll());
    } catch (PDOException $e) {
        $stmt = $pdo->prepare("SELECT pu.*, p.name AS product_name, p.unit, u.full_name AS recorded_by_name
                                FROM purchases pu
                                JOIN products p ON p.id = pu.product_id
                                JOIN users u ON u.id = pu.recorded_by
                                $where ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT $limit");
        $stmt->execute($params);
        respond(true, $stmt->fetchAll());
    }
}

if ($method === 'POST') {
    $user = require_role(['admin']);
    $d = body();
    $items = $d['items'] ?? null;

    if (!is_array($items) || count($items) === 0) {
        respond(false, null, 'No items were submitted.', 422);
    }

    // ---- Pass 1: validate everything first, resolve product/type matches ----
    $resolved = [];
    $errors = [];

    foreach ($items as $i => $item) {
        $rowNum = $i + 1;
        $name = clean($item['name'] ?? '');
        $variantName = clean($item['variant_name'] ?? '');
        $qty = isset($item['quantity']) && $item['quantity'] !== '' ? (int)$item['quantity'] : null;

        if ($name === '') { $errors[] = "Row $rowNum: product name is missing."; continue; }
        if ($qty === null || $qty <= 0) { $errors[] = "Row $rowNum ($name): enter a valid quantity."; continue; }

        $stmt = $pdo->prepare('SELECT * FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1');
        $stmt->execute([$name]);
        $existing = $stmt->fetch();

        $buyingPrice = isset($item['buying_price']) && $item['buying_price'] !== '' ? (float)$item['buying_price'] : null;
        $sellingPrice = isset($item['selling_price']) && $item['selling_price'] !== '' ? (float)$item['selling_price'] : null;

        $hasVariants = false;
        $variant = null;

        if (!$existing) {
            if ($buyingPrice === null || $sellingPrice === null) {
                $errors[] = "Row $rowNum ($name): this is a new product, so both Buying Price and Selling Price are required.";
                continue;
            }
        } else {
            $vCountStmt = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ?');
            $vCountStmt->execute([$existing['id']]);
            $hasVariants = (int)$vCountStmt->fetchColumn() > 0;

            if ($hasVariants) {
                if ($variantName === '') {
                    $errors[] = "Row $rowNum ($name): this product has types - please specify which type (e.g. \"Obama Pen\").";
                    continue;
                }
                $vStmt = $pdo->prepare('SELECT * FROM product_variants WHERE product_id = ? AND LOWER(variant_name) = LOWER(?)');
                $vStmt->execute([$existing['id'], $variantName]);
                $variant = $vStmt->fetch();
                if (!$variant && ($buyingPrice === null || $sellingPrice === null)) {
                    $errors[] = "Row $rowNum ($name — $variantName): this is a new type, so both Buying Price and Selling Price are required.";
                    continue;
                }
            }
        }

        $resolved[] = [
            'name' => $name,
            'variant_name' => $variantName,
            'quantity' => $qty,
            'buying_price' => $buyingPrice,
            'selling_price' => $sellingPrice,
            'category' => clean($item['category'] ?? ''),
            'unit' => clean($item['unit'] ?? 'pcs') ?: 'pcs',
            'existing' => $existing,
            'has_variants' => $hasVariants,
            'variant' => $variant,
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
            $variantId = null;

            if ($row['existing']) {
                $productId = $row['existing']['id'];

                if ($row['has_variants']) {
                    if ($row['variant']) {
                        // Restock an existing type.
                        $variantId = $row['variant']['id'];
                        $fields = ['stock_quantity = stock_quantity + ?'];
                        $params = [$row['quantity']];
                        if ($row['buying_price'] !== null) { $fields[] = 'buying_price = ?'; $params[] = $row['buying_price']; }
                        if ($row['selling_price'] !== null) { $fields[] = 'selling_price = ?'; $params[] = $row['selling_price']; }
                        $fields[] = 'updated_at = NOW()';
                        $params[] = $variantId;
                        $pdo->prepare('UPDATE product_variants SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
                        $buyingPriceUsed = $row['buying_price'] !== null ? $row['buying_price'] : (float)$row['variant']['buying_price'];
                        $updated++;
                    } else {
                        // Brand new type under this existing parent product.
                        $insV = $pdo->prepare('INSERT INTO product_variants
                            (product_id, variant_name, unit, buying_price, selling_price, stock_quantity, reorder_level, status, created_by, created_at, updated_at)
                            VALUES (?,?,?,?,?,?,5,"active",?,NOW(),NOW())');
                        $insV->execute([$productId, $row['variant_name'], $row['unit'], $row['buying_price'], $row['selling_price'], $row['quantity'], $user['id']]);
                        $variantId = $pdo->lastInsertId();
                        $buyingPriceUsed = $row['buying_price'];
                        $created++;
                    }
                } else {
                    // Plain product restock - unchanged from before this feature.
                    $fields = ['stock_quantity = stock_quantity + ?'];
                    $params = [$row['quantity']];
                    if ($row['buying_price'] !== null) { $fields[] = 'buying_price = ?'; $params[] = $row['buying_price']; }
                    if ($row['selling_price'] !== null) { $fields[] = 'selling_price = ?'; $params[] = $row['selling_price']; }
                    $fields[] = 'updated_at = NOW()';
                    $params[] = $productId;
                    $pdo->prepare('UPDATE products SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
                    $buyingPriceUsed = $row['buying_price'] !== null ? $row['buying_price'] : (float)$row['existing']['buying_price'];
                    $updated++;
                }
            } else {
                // Brand new product - unchanged from before this feature.
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
            $pdo->prepare('INSERT INTO purchases (product_id, variant_id, quantity, buying_price, total_cost, source, note, recorded_by, purchase_date, created_at)
                            VALUES (?,?,?,?,?,?,?,?,?,NOW())')
                ->execute([$productId, $variantId, $row['quantity'], $buyingPriceUsed, $totalCost, $source, clean($d['note'] ?? ''), $user['id'], $purchaseDate]);
        }

        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (strpos($e->getMessage(), 'variant_id') !== false) {
            respond(false, null, 'The database is missing the "variant_id" column. Please run Backend/upgrade_add_variant_to_purchases_damages.php once, then try again.', 500);
        }
        respond(false, null, 'Could not save the purchase. Please try again.', 500);
    }

    $itemSummary = count($resolved) === 1
        ? '"' . $resolved[0]['name'] . ($resolved[0]['variant_name'] !== '' ? ' — ' . $resolved[0]['variant_name'] : '') . '" (' . $resolved[0]['quantity'] . ' ' . $resolved[0]['unit'] . ')'
        : count($resolved) . ' product(s)';
    log_activity($pdo, $user, 'create', 'purchase', null,
        'Recorded a ' . $source . ' purchase of ' . $itemSummary . ': ' . $created . ' new item(s) added, ' . $updated . ' item(s) restocked');

    respond(true, ['created' => $created, 'updated' => $updated], "Stock updated: $created new item(s) added, $updated existing item(s) restocked.");
}

respond(false, null, 'Unsupported method.', 405);
