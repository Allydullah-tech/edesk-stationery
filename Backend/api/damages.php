<?php
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';

$user = require_login();
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['start'])) { $where .= ' AND d.damage_date >= ?'; $params[] = clean($_GET['start']); }
    if (!empty($_GET['end']))   { $where .= ' AND d.damage_date <= ?'; $params[] = clean($_GET['end']); }
    $limit = !empty($_GET['limit']) ? (int)$_GET['limit'] : 100;

    // product_name/unit fold in the type name (e.g. "Pen — Obama Pen") so
    // the frontend needs no other changes for that part. Wrapped
    // defensively in two layers: the non-stock damage columns (older
    // installs) and the variant_id column (see
    // Backend/upgrade_add_variant_to_purchases_damages.php) - either
    // missing should degrade gracefully rather than break the page.
    try {
        $stmt = $pdo->prepare("SELECT d.*,
                                CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, ' — ', pv.variant_name) ELSE p.name END AS product_name,
                                COALESCE(pv.unit, p.unit) AS unit, u.full_name AS recorded_by_name
                                FROM damages d
                                LEFT JOIN products p ON p.id = d.product_id
                                LEFT JOIN product_variants pv ON pv.id = d.variant_id
                                JOIN users u ON u.id = d.recorded_by
                                $where ORDER BY d.damage_date DESC, d.id DESC LIMIT $limit");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } catch (PDOException $e) {
        try {
            $stmt = $pdo->prepare("SELECT d.*, p.name AS product_name, p.unit AS unit, u.full_name AS recorded_by_name FROM damages d
                                    LEFT JOIN products p ON p.id = d.product_id
                                    JOIN users u ON u.id = d.recorded_by
                                    $where ORDER BY d.damage_date DESC, d.id DESC LIMIT $limit");
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } catch (PDOException $e2) {
            respond(false, null, 'The database is missing the non-stock damage columns. Please run Backend/upgrade_v2_corrections.php once, then reload this page.', 500);
        }
    }

    // Normalise the "name" and "cost" shown regardless of item_type, so the
    // frontend can render one table without branching on every row.
    foreach ($rows as &$row) {
        $row['display_name'] = $row['item_type'] === 'other' ? $row['item_name'] : $row['product_name'];
        $row['display_cost'] = $row['item_type'] === 'other' ? $row['manual_cost'] : $row['loss_value'];
    }
    unset($row);

    respond(true, $rows);
}

if ($method === 'POST') {
    require_role(['admin', 'worker']);
    $d = body();
    $itemType = (!empty($d['item_type']) && $d['item_type'] === 'other') ? 'other' : 'product';

    if (empty($d['reason'])) respond(false, null, 'Missing fields: reason', 422);
    $damageDate = !empty($d['damage_date']) ? clean($d['damage_date']) : today();

    try {
        if ($itemType === 'product') {
            $missing = missing_fields($d, ['product_id', 'quantity']);
            if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);

            $productId = (int)$d['product_id'];
            $variantId = !empty($d['variant_id']) ? (int)$d['variant_id'] : null;
            $qty = (int)$d['quantity'];
            if ($qty <= 0) respond(false, null, 'Enter a valid quantity.', 422);

            $stmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
            $stmt->execute([$productId]);
            $product = $stmt->fetch();
            if (!$product) respond(false, null, 'Product not found.', 404);

            // A product with types can't have damage recorded against
            // itself - a specific type must be given, and that type's own
            // buying price/stock are what's used.
            $variant = null;
            if (!$product['is_service']) {
                $vCountStmt = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ?');
                $vCountStmt->execute([$productId]);
                $hasVariants = (int)$vCountStmt->fetchColumn() > 0;

                if ($hasVariants) {
                    if (!$variantId) respond(false, null, 'Please select a type for "' . $product['name'] . '".', 422);
                    $vStmt = $pdo->prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?');
                    $vStmt->execute([$variantId, $productId]);
                    $variant = $vStmt->fetch();
                    if (!$variant) respond(false, null, 'That type of "' . $product['name'] . '" no longer exists.', 404);
                }
            }

            $label = $variant ? ($product['name'] . ' — ' . $variant['variant_name']) : $product['name'];
            $buyingPrice = (float)($variant ? $variant['buying_price'] : $product['buying_price']);
            $lossValue = round($qty * $buyingPrice, 2);

            $pdo->beginTransaction();
            $ins = $pdo->prepare('INSERT INTO damages (product_id, variant_id, item_type, item_name, quantity, reason, loss_value, manual_cost, recorded_by, damage_date, created_at)
                                   VALUES (?,?,?,?,?,?,?,?,?,?,NOW())');
            $ins->execute([$productId, $variant ? $variantId : null, 'product', null, $qty, clean($d['reason']), $lossValue, null, $user['id'], $damageDate]);

            if (!$product['is_service']) {
                if ($variant) {
                    $pdo->prepare('UPDATE product_variants SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE id = ?')->execute([$qty, $variantId]);
                } else {
                    $pdo->prepare('UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE id = ?')->execute([$qty, $productId]);
                }
            }
            $pdo->commit();

            log_activity($pdo, $user, 'create', 'damage', $pdo->lastInsertId(),
                'Recorded damage: ' . $qty . ' ' . ($variant ? $variant['unit'] : $product['unit']) . ' x "' . $label . '" - loss TZS ' . number_format($lossValue) . ' (' . clean($d['reason']) . ')');

            respond(true, ['id' => $pdo->lastInsertId(), 'loss_value' => $lossValue], 'Damage/waste recorded and stock adjusted.');
        } else {
            // Non-stock item: equipment, material, furniture, etc. There is
            // no stock record, so the cost is entered by hand.
            $missing = missing_fields($d, ['item_name', 'manual_cost']);
            if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);

            $itemName = clean($d['item_name']);
            $cost = (float)$d['manual_cost'];
            if ($cost < 0) respond(false, null, 'Enter a valid cost.', 422);

            $pdo->beginTransaction();
            $ins = $pdo->prepare('INSERT INTO damages (product_id, variant_id, item_type, item_name, quantity, reason, loss_value, manual_cost, recorded_by, damage_date, created_at)
                                   VALUES (NULL,NULL,?,?,NULL,?,?,?,?,?,NOW())');
            $ins->execute(['other', $itemName, clean($d['reason']), $cost, $cost, $user['id'], $damageDate]);
            $pdo->commit();

            log_activity($pdo, $user, 'create', 'damage', $pdo->lastInsertId(),
                'Recorded damage for non-stock item: "' . $itemName . '" - cost TZS ' . number_format($cost) . ' (' . clean($d['reason']) . ')');

            respond(true, ['id' => $pdo->lastInsertId(), 'loss_value' => $cost], 'Damage recorded for "' . $itemName . '" (not in Stock).');
        }
    } catch (PDOException $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        if (strpos($e->getMessage(), 'variant_id') !== false) {
            respond(false, null, 'The database is missing the "variant_id" column. Please run Backend/upgrade_add_variant_to_purchases_damages.php once, then try again.', 500);
        }
        if (strpos($e->getMessage(), 'item_type') !== false || strpos($e->getMessage(), 'item_name') !== false || strpos($e->getMessage(), 'manual_cost') !== false || strpos($e->getMessage(), "doesn't have a default value") !== false) {
            respond(false, null, 'The database is missing the non-stock damage columns. Please run Backend/upgrade_v2_corrections.php once, then try again.', 500);
        }
        respond(false, null, 'Could not record damage entry.', 500);
    } catch (Exception $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not record damage entry.', 500);
    }
}

if ($method === 'PUT') {
    require_role(['admin', 'worker']);
    $d = body();
    if (empty($d['id'])) respond(false, null, 'Damage record id is required.', 422);
    if (empty($d['reason'])) respond(false, null, 'Missing fields: reason', 422);

    $existingStmt = $pdo->prepare('SELECT * FROM damages WHERE id = ?');
    $existingStmt->execute([(int)$d['id']]);
    $existing = $existingStmt->fetch();
    if (!$existing) respond(false, null, 'Damage record not found.', 404);

    // Editing does not allow switching between a stock product and a
    // non-stock item, or between one type and another - that's a big
    // enough change in meaning that it should be a delete + a fresh
    // entry, not an "edit". Only quantity/reason/date can change.
    $newDate = !empty($d['damage_date']) ? clean($d['damage_date']) : $existing['damage_date'];
    $newReason = clean($d['reason']);

    try {
        if ($existing['item_type'] === 'product') {
            $missing = missing_fields($d, ['quantity']);
            if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);
            $newQty = (int)$d['quantity'];
            if ($newQty <= 0) respond(false, null, 'Enter a valid quantity.', 422);

            $pStmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
            $pStmt->execute([$existing['product_id']]);
            $product = $pStmt->fetch();
            if (!$product) respond(false, null, 'The product this damage was recorded against no longer exists.', 404);

            $variant = null;
            if (!empty($existing['variant_id'])) {
                $vStmt = $pdo->prepare('SELECT * FROM product_variants WHERE id = ?');
                $vStmt->execute([$existing['variant_id']]);
                $variant = $vStmt->fetch();
            }
            $buyingPrice = (float)($variant ? $variant['buying_price'] : $product['buying_price']);

            $newLossValue = round($newQty * $buyingPrice, 2);
            $qtyDelta = $newQty - (int)$existing['quantity']; // positive = MORE damaged than before

            $pdo->beginTransaction();
            $pdo->prepare('UPDATE damages SET quantity = ?, reason = ?, loss_value = ?, damage_date = ? WHERE id = ?')
                ->execute([$newQty, $newReason, $newLossValue, $newDate, $existing['id']]);
            if (!$product['is_service'] && $qtyDelta != 0) {
                // More damage now -> take more stock away. Less damage now -> give stock back.
                if ($variant) {
                    $pdo->prepare('UPDATE product_variants SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE id = ?')
                        ->execute([$qtyDelta, $variant['id']]);
                } else {
                    $pdo->prepare('UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE id = ?')
                        ->execute([$qtyDelta, $existing['product_id']]);
                }
            }
            $pdo->commit();

            $label = $variant ? ($product['name'] . ' — ' . $variant['variant_name']) : $product['name'];
            $changes = [];
            if ((int)$existing['quantity'] != $newQty) $changes[] = 'quantity ' . $existing['quantity'] . ' to ' . $newQty . ' (loss ' . audit_money_diff($existing['loss_value'], $newLossValue) . ')';
            if ($existing['reason'] !== $newReason) $changes[] = 'reason "' . $existing['reason'] . '" to "' . $newReason . '"';
            if ($existing['damage_date'] !== $newDate) $changes[] = 'date ' . $existing['damage_date'] . ' to ' . $newDate;
            log_activity($pdo, $user, 'update', 'damage', $existing['id'],
                'Edited damage record for "' . $label . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no changes)'));

            respond(true, null, 'Damage record updated and stock adjusted.');
        } else {
            $missing = missing_fields($d, ['item_name', 'manual_cost']);
            if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);
            $newItemName = clean($d['item_name']);
            $newCost = (float)$d['manual_cost'];
            if ($newCost < 0) respond(false, null, 'Enter a valid cost.', 422);

            $pdo->prepare('UPDATE damages SET item_name = ?, reason = ?, loss_value = ?, manual_cost = ?, damage_date = ? WHERE id = ?')
                ->execute([$newItemName, $newReason, $newCost, $newCost, $newDate, $existing['id']]);

            $changes = [];
            if ($existing['item_name'] !== $newItemName) $changes[] = 'item "' . $existing['item_name'] . '" to "' . $newItemName . '"';
            if ((float)$existing['manual_cost'] != $newCost) $changes[] = 'cost ' . audit_money_diff($existing['manual_cost'], $newCost);
            if ($existing['reason'] !== $newReason) $changes[] = 'reason "' . $existing['reason'] . '" to "' . $newReason . '"';
            if ($existing['damage_date'] !== $newDate) $changes[] = 'date ' . $existing['damage_date'] . ' to ' . $newDate;
            log_activity($pdo, $user, 'update', 'damage', $existing['id'],
                'Edited damage record for non-stock item "' . $existing['item_name'] . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no changes)'));

            respond(true, null, 'Damage record updated.');
        }
    } catch (Exception $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not update damage entry.', 500);
    }
}

if ($method === 'DELETE') {
    require_role(['admin', 'worker']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Damage record id is required.', 422);
    $lookup = $pdo->prepare("SELECT d.*, p.name AS product_name, p.is_service FROM damages d LEFT JOIN products p ON p.id = d.product_id WHERE d.id = ?");
    $lookup->execute([$id]);
    $row = $lookup->fetch();

    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM damages WHERE id = ?')->execute([$id]);
    // Deleting a damage record undoes its effect on stock - it's a
    // correction, not just a removal from the list.
    if ($row && $row['item_type'] === 'product' && !$row['is_service']) {
        if (!empty($row['variant_id'])) {
            $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$row['quantity'], $row['variant_id']]);
        } else {
            $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$row['quantity'], $row['product_id']]);
        }
    }
    $pdo->commit();

    if ($row) {
        $name = $row['item_type'] === 'other' ? $row['item_name'] : $row['product_name'];
        $cost = $row['item_type'] === 'other' ? $row['manual_cost'] : $row['loss_value'];
        log_activity($pdo, $user, 'delete', 'damage', $id, 'Deleted damage record: "' . $name . '" - TZS ' . number_format($cost)
            . ($row['item_type'] === 'product' && !$row['is_service'] ? ' (stock restored by ' . $row['quantity'] . ')' : ''));
    }
    respond(true, null, 'Damage record removed.');
}

respond(false, null, 'Unsupported method.', 405);
