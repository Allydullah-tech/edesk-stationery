<?php
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/report_helper.php';
require_once __DIR__ . '/../helpers/access_helper.php';

$user = require_login();
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

/** Workers can see what was bought, but never what it cost. */
function purchases_for_user(array $user, array $rows): array
{
    return is_admin_user($user) ? $rows : hide_fields_in_rows($rows, ['buying_price', 'total_cost']);
}

/**
 * The row whose stock a purchase feeds: the type (variant) when the
 * purchase was for one, otherwise the product itself. Returns null when
 * there is nothing to adjust - a purchase of a type that has since been
 * deleted (its variant_id was cleared) must not touch the parent product's
 * own stock, which is not used once a product has types.
 */
function purchase_stock_target(PDO $pdo, array $purchase): ?array
{
    if (!empty($purchase['variant_id'])) return ['product_variants', (int)$purchase['variant_id']];

    if (array_key_exists('variant_id', $purchase)) {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ?');
        $stmt->execute([(int)$purchase['product_id']]);
        if ((int)$stmt->fetchColumn() > 0) return null;
    }
    return ['products', (int)$purchase['product_id']];
}

/** Readable name for the activity log, e.g. "Pen — Obama Pen". */
function purchase_label(PDO $pdo, array $purchase): string
{
    $stmt = $pdo->prepare('SELECT name FROM products WHERE id = ?');
    $stmt->execute([(int)$purchase['product_id']]);
    $label = (string)($stmt->fetchColumn() ?: 'a product');
    if (!empty($purchase['variant_id'])) {
        $v = $pdo->prepare('SELECT variant_name FROM product_variants WHERE id = ?');
        $v->execute([(int)$purchase['variant_id']]);
        $vn = $v->fetchColumn();
        if ($vn) $label .= ' — ' . $vn;
    }
    return $label;
}

/**
 * Is this the most recent purchase of that product/type? Only the latest
 * purchase is allowed to move the item's current buying price when it is
 * edited or deleted - an older one must never overwrite a newer price.
 * (Works on installs that don't have purchases.variant_id yet too.)
 */
function purchase_is_latest(PDO $pdo, array $p): bool
{
    if (array_key_exists('variant_id', $p)) {
        $stmt = $pdo->prepare('SELECT MAX(id) FROM purchases WHERE product_id = ? AND variant_id <=> ?');
        $stmt->execute([$p['product_id'], $p['variant_id']]);
    } else {
        $stmt = $pdo->prepare('SELECT MAX(id) FROM purchases WHERE product_id = ?');
        $stmt->execute([$p['product_id']]);
    }
    return (int)$stmt->fetchColumn() === (int)$p['id'];
}

/** Buying price of the purchase just before this one for the same product/type, or null. */
function purchase_previous_price(PDO $pdo, array $p): ?float
{
    if (array_key_exists('variant_id', $p)) {
        $stmt = $pdo->prepare('SELECT buying_price FROM purchases WHERE product_id = ? AND variant_id <=> ? AND id < ? ORDER BY id DESC LIMIT 1');
        $stmt->execute([$p['product_id'], $p['variant_id'], $p['id']]);
    } else {
        $stmt = $pdo->prepare('SELECT buying_price FROM purchases WHERE product_id = ? AND id < ? ORDER BY id DESC LIMIT 1');
        $stmt->execute([$p['product_id'], $p['id']]);
    }
    $v = $stmt->fetchColumn();
    return $v === false ? null : (float)$v;
}

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
        // item_name / item_description carry the same information split in two, for the
        // Purchase History table's separate Product and Description columns.
        $stmt = $pdo->prepare("SELECT pu.*,
                                CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, ' — ', pv.variant_name) ELSE p.name END AS product_name,
                                p.name AS item_name, COALESCE(pv.variant_name, '') AS item_description,
                                COALESCE(pv.unit, p.unit) AS unit, u.full_name AS recorded_by_name
                                FROM purchases pu
                                JOIN products p ON p.id = pu.product_id
                                LEFT JOIN product_variants pv ON pv.id = pu.variant_id
                                JOIN users u ON u.id = pu.recorded_by
                                $where ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT $limit");
        $stmt->execute($params);
        respond(true, purchases_for_user($user, $stmt->fetchAll()));
    } catch (PDOException $e) {
        $stmt = $pdo->prepare("SELECT pu.*, p.name AS product_name, p.name AS item_name, '' AS item_description, p.unit, u.full_name AS recorded_by_name
                                FROM purchases pu
                                JOIN products p ON p.id = pu.product_id
                                JOIN users u ON u.id = pu.recorded_by
                                $where ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT $limit");
        $stmt->execute($params);
        respond(true, purchases_for_user($user, $stmt->fetchAll()));
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
        // Minimum selling price (optional): the lowest price a worker may sell at. Blank = keep what is already set.
        $minimumPrice = isset($item['minimum_price']) && $item['minimum_price'] !== '' ? (float)$item['minimum_price'] : null;
        if ($minimumPrice !== null && $minimumPrice < 0) { $errors[] = "Row $rowNum ($name): the Minimum Selling Price cannot be negative."; continue; }
        if ($minimumPrice !== null && $sellingPrice !== null && $minimumPrice > $sellingPrice) {
            $errors[] = "Row $rowNum ($name): the Minimum Selling Price cannot be higher than the Selling Price.";
            continue;
        }

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
            'minimum_price' => $minimumPrice,
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
                        if ($row['minimum_price'] !== null) { $fields[] = 'minimum_price = ?'; $params[] = $row['minimum_price']; }
                        $fields[] = 'updated_at = NOW()';
                        $params[] = $variantId;
                        $pdo->prepare('UPDATE product_variants SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
                        $buyingPriceUsed = $row['buying_price'] !== null ? $row['buying_price'] : (float)$row['variant']['buying_price'];
                        $updated++;
                    } else {
                        // Brand new type under this existing parent product.
                        $insV = $pdo->prepare('INSERT INTO product_variants
                            (product_id, variant_name, unit, buying_price, selling_price, minimum_price, stock_quantity, reorder_level, status, created_by, created_at, updated_at)
                            VALUES (?,?,?,?,?,?,?,5,"active",?,NOW(),NOW())');
                        $insV->execute([$productId, $row['variant_name'], $row['unit'], $row['buying_price'], $row['selling_price'], $row['minimum_price'], $row['quantity'], $user['id']]);
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
                    if ($row['minimum_price'] !== null) { $fields[] = 'minimum_price = ?'; $params[] = $row['minimum_price']; }
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
                    (name, category_id, is_service, unit, buying_price, selling_price, minimum_price, stock_quantity, reorder_level, status, created_by, created_at, updated_at)
                    VALUES (?,?,0,?,?,?,?,?,5,"active",?,NOW(),NOW())');
                $ins->execute([
                    $row['name'], $categoryId, $row['unit'],
                    $row['buying_price'], $row['selling_price'], $row['minimum_price'], $row['quantity'], $user['id'],
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
        if (strpos($e->getMessage(), 'minimum_price') !== false) {
            respond(false, null, 'The database is missing the "minimum_price" column. Please run Backend/upgrade_add_minimum_price.php once, then try again.', 500);
        }
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

if ($method === 'PUT') {
    // Admin only: fix a purchase that was recorded wrongly. Stock moves by the
    // difference, so the shelf count stays in step with what the record says.
    $user = require_role(['admin']);
    $d = body();
    $id = (int)($d['id'] ?? 0);
    if (!$id) respond(false, null, 'Purchase id is required.', 422);

    $qty = isset($d['quantity']) && $d['quantity'] !== '' ? (int)$d['quantity'] : 0;
    if ($qty <= 0) respond(false, null, 'Enter a valid quantity.', 422);
    if (!isset($d['buying_price']) || $d['buying_price'] === '' || (float)$d['buying_price'] < 0) {
        respond(false, null, 'Enter a valid buying price.', 422);
    }
    $newPrice = round((float)$d['buying_price'], 2);
    $newNote = mb_substr(clean($d['note'] ?? ''), 0, 255);
    $newDate = null;
    if (!empty($d['purchase_date'])) {
        $newDate = clean($d['purchase_date']);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $newDate)) respond(false, null, 'Enter a valid purchase date.', 422);
    }

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare('SELECT * FROM purchases WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
        if (!$existing) { $pdo->rollBack(); respond(false, null, 'Purchase not found.', 404); }

        $newDate = $newDate ?? $existing['purchase_date'];
        $oldQty = (int)$existing['quantity'];
        $delta = $qty - $oldQty;
        $item = false; // stays false when there is no stock row left to adjust
        $stockMoved = 0; // what stock actually changed by (0 when there was nothing to adjust)
        $target = purchase_stock_target($pdo, $existing);
        if ($target) {
            [$table, $targetId] = $target;
            $itemStmt = $pdo->prepare("SELECT stock_quantity, buying_price FROM $table WHERE id = ? FOR UPDATE");
            $itemStmt->execute([$targetId]);
            $item = $itemStmt->fetch();
        }

        if ($item) {
            $stock = (int)$item['stock_quantity'];
            if ($delta < 0 && $stock + $delta < 0) {
                $pdo->rollBack();
                respond(false, null, 'Cannot reduce this purchase to ' . $qty . '. Only ' . $stock . ' of the ' . $oldQty
                    . ' bought are still in stock (the rest were sold, damaged or used), so the lowest quantity you can set is '
                    . max($oldQty - $stock, 1) . '.', 422);
            }

            if ($delta > 0) {
                $pdo->prepare("UPDATE $table SET stock_quantity = stock_quantity + ?, updated_at = NOW() WHERE id = ?")->execute([$delta, $targetId]);
            } elseif ($delta < 0) {
                $pdo->prepare("UPDATE $table SET stock_quantity = stock_quantity - ?, updated_at = NOW() WHERE id = ?")->execute([abs($delta), $targetId]);
            }
            $stockMoved = $delta;

            // Keep the item's current buying price right too - but only when this is the
            // latest purchase and nobody has changed the price by hand since.
            if (abs((float)$existing['buying_price'] - $newPrice) > 0.004
                && abs((float)$item['buying_price'] - (float)$existing['buying_price']) < 0.005
                && purchase_is_latest($pdo, $existing)) {
                $pdo->prepare("UPDATE $table SET buying_price = ?, updated_at = NOW() WHERE id = ?")->execute([$newPrice, $targetId]);
            }
        }

        $pdo->prepare('UPDATE purchases SET quantity = ?, buying_price = ?, total_cost = ?, purchase_date = ?, note = ? WHERE id = ?')
            ->execute([$qty, $newPrice, round($qty * $newPrice, 2), $newDate, $newNote, $id]);

        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not update the purchase. Please try again.', 500);
    }

    $changes = [];
    if ($qty !== $oldQty) $changes[] = 'quantity ' . $oldQty . ' to ' . $qty;
    if (abs((float)$existing['buying_price'] - $newPrice) > 0.004) $changes[] = 'buying price ' . audit_money_diff($existing['buying_price'], $newPrice);
    if ($existing['purchase_date'] !== $newDate) $changes[] = 'date ' . $existing['purchase_date'] . ' to ' . $newDate;
    if ((string)($existing['note'] ?? '') !== $newNote) $changes[] = 'note changed';
    log_activity($pdo, $user, 'update', 'purchase', $id,
        'Edited purchase #' . $id . ' of "' . purchase_label($pdo, $existing) . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no changes)')
        . ($stockMoved !== 0 ? '; stock ' . ($stockMoved > 0 ? '+' : '-') . abs($stockMoved) : ''));

    respond(true, null, $stockMoved === 0 ? 'Purchase updated.' : 'Purchase updated and stock adjusted by ' . ($stockMoved > 0 ? '+' : '-') . abs($stockMoved) . '.');
}

if ($method === 'DELETE') {
    // Admin only: remove a purchase that should never have been recorded. The quantity
    // it added is taken back out of stock - unless some of it is already gone.
    $user = require_role(['admin']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Purchase id is required.', 422);

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare('SELECT * FROM purchases WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
        if (!$existing) { $pdo->rollBack(); respond(false, null, 'Purchase not found.', 404); }

        $qty = (int)$existing['quantity'];
        $item = false;
        $stockRemoved = false;
        $target = purchase_stock_target($pdo, $existing);
        if ($target) {
            [$table, $targetId] = $target;
            $itemStmt = $pdo->prepare("SELECT stock_quantity, buying_price FROM $table WHERE id = ? FOR UPDATE");
            $itemStmt->execute([$targetId]);
            $item = $itemStmt->fetch();
        }

        if ($item) {
            $stock = (int)$item['stock_quantity'];
            if ($stock < $qty) {
                $pdo->rollBack();
                respond(false, null, 'This purchase cannot be deleted: it added ' . $qty . ' but only ' . $stock
                    . ' are still in stock (' . ($qty - $stock) . ' were sold, damaged or used). Edit the quantity instead.', 422);
            }

            $pdo->prepare("UPDATE $table SET stock_quantity = stock_quantity - ?, updated_at = NOW() WHERE id = ?")->execute([$qty, $targetId]);
            $stockRemoved = true;

            // If this purchase set the current buying price, go back to the one before it.
            if (abs((float)$item['buying_price'] - (float)$existing['buying_price']) < 0.005 && purchase_is_latest($pdo, $existing)) {
                $prev = purchase_previous_price($pdo, $existing);
                if ($prev !== null) {
                    $pdo->prepare("UPDATE $table SET buying_price = ?, updated_at = NOW() WHERE id = ?")->execute([$prev, $targetId]);
                }
            }
        }

        $label = purchase_label($pdo, $existing);
        $pdo->prepare('DELETE FROM purchases WHERE id = ?')->execute([$id]);
        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not delete the purchase. Please try again.', 500);
    }

    log_activity($pdo, $user, 'delete', 'purchase', $id,
        'Deleted purchase #' . $id . ': ' . $qty . ' x "' . $label . '" bought on ' . $existing['purchase_date']
        . ' for TZS ' . number_format((float)$existing['total_cost']) . ($stockRemoved ? '; ' . $qty . ' removed from stock' : '; stock not changed (item no longer exists)'));

    respond(true, null, $stockRemoved ? 'Purchase deleted and ' . $qty . ' removed from stock.' : 'Purchase deleted. Stock was not changed because that item no longer exists.');
}

respond(false, null, 'Unsupported method.', 405);
