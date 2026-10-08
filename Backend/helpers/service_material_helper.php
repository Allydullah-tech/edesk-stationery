<?php
/**
 * eDESK Print & Digital - Products used by services
 *
 * When a service is SOLD, the cashier can say which stock products were used to
 * provide it (e.g. "Manila Binding" used 1 x Manila). The rules, in one place:
 *
 *   Sales / cash : ALWAYS the full price charged. Never reduced by material cost.
 *   Stock        : the materials are deducted from inventory.
 *   Profit       : revenue - cost of the materials consumed.
 *
 * So for the sale line this file only ever feeds the PROFIT fields
 * (sale_items.buying_price / sale_items.profit) and stock. It never touches
 * unit_price, subtotal or total_amount - those drive sales reports and the
 * daily cash audit.
 *
 * Everything is a safe no-op until upgrade_v8_service_materials.php has been run.
 */

/** True once the v8 table (sale_item_materials) exists. */
function sm_feature_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $ready = $pdo->query("SHOW TABLES LIKE 'sale_item_materials'")->rowCount() > 0;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

function sm_upgrade_message(): string
{
    return 'The database is missing the "products used by services" table. Please run Backend/upgrade_v8_service_materials.php once, then try again.';
}

/** Stable key for the stock row a material draws from. */
function sm_stock_key($productId, $variantId): string
{
    return $variantId ? 'v' . (int)$variantId : 'p' . (int)$productId;
}

/**
 * Work out what ONE sale line of a service consumes, from the products the cashier
 * picked while recording the sale. $requested = [['product_id'=>, 'variant_id'=>, 'quantity'=>], ...]
 * where quantity is the amount used per 1 service (it is multiplied by the sale quantity).
 *
 * The cost price comes from the product/inventory record - the cashier never types it.
 * Returns ['materials' => [...snapshot rows...], 'unit_cost' => cost per 1 service, 'total_cost' => cost for the line].
 * Calls respond() and exits on invalid input.
 */
function sm_build_line_materials(PDO $pdo, array $requested, int $saleQty): array
{
    $out = ['materials' => [], 'unit_cost' => 0.0, 'total_cost' => 0.0];
    if (!$requested) return $out;
    if (!sm_feature_ready($pdo)) respond(false, null, sm_upgrade_message(), 500);

    // Merge repeated products into one line.
    $merged = [];
    foreach ($requested as $r) {
        $pid = (int)($r['product_id'] ?? 0);
        if (!$pid) continue; // blank row
        $vid = !empty($r['variant_id']) ? (int)$r['variant_id'] : null;
        $qty = (int)($r['quantity'] ?? 0);
        if ($qty <= 0) respond(false, null, 'Enter a quantity of 1 or more for every product used.', 422);
        $k = $pid . ':' . ($vid ?: 0);
        if (isset($merged[$k])) $merged[$k]['quantity'] += $qty;
        else $merged[$k] = ['product_id' => $pid, 'variant_id' => $vid, 'quantity' => $qty];
    }

    $perUnitCost = 0.0;
    $totalCost = 0.0;
    foreach ($merged as $m) {
        $pStmt = $pdo->prepare('SELECT id, name, is_service, buying_price, unit FROM products WHERE id = ?');
        $pStmt->execute([$m['product_id']]);
        $p = $pStmt->fetch();
        if (!$p) respond(false, null, 'A product used for the service no longer exists.', 404);
        if ($p['is_service']) respond(false, null, '"' . $p['name'] . '" is a service. Only stock products can be used to provide a service.', 422);

        $cStmt = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ?');
        $cStmt->execute([$m['product_id']]);
        $hasVariants = (int)$cStmt->fetchColumn() > 0;

        $name = $p['name'];
        $unit = $p['unit'];
        $unitCost = (float)$p['buying_price'];
        $variantId = null;
        if ($hasVariants) {
            if (!$m['variant_id']) respond(false, null, 'Select a description for "' . $p['name'] . '" in the products used.', 422);
            $vStmt = $pdo->prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?');
            $vStmt->execute([$m['variant_id'], $m['product_id']]);
            $v = $vStmt->fetch();
            if (!$v) respond(false, null, 'That description of "' . $p['name'] . '" no longer exists.', 404);
            $variantId = (int)$v['id'];
            $name = $p['name'] . ' — ' . $v['variant_name'];
            $unit = $v['unit'];
            $unitCost = (float)$v['buying_price'];
        }

        $usedTotal = $m['quantity'] * $saleQty;
        $lineCost = round($usedTotal * $unitCost, 2);
        $perUnitCost += $m['quantity'] * $unitCost;
        $totalCost += $lineCost;
        $out['materials'][] = [
            'material_product_id' => (int)$p['id'],
            'material_variant_id' => $variantId,
            'name' => $name,
            'unit' => $unit,
            'quantity' => $usedTotal,
            'unit_cost' => $unitCost,
            'total_cost' => $lineCost,
        ];
    }
    $out['unit_cost'] = round($perUnitCost, 2);
    $out['total_cost'] = round($totalCost, 2);
    return $out;
}

/** The products used by each sale line, for showing/editing a saved sale. quantity = per 1 service. */
function sm_materials_for_sale_items(PDO $pdo, array $items): array
{
    if (!$items || !sm_feature_ready($pdo)) return $items;
    $stmt = $pdo->prepare('SELECT material_product_id, material_variant_id, material_name, quantity FROM sale_item_materials WHERE sale_item_id = ? ORDER BY id ASC');
    foreach ($items as &$it) {
        $stmt->execute([$it['id']]);
        $qty = max(1, (int)$it['quantity']);
        $it['materials'] = array_map(fn($m) => [
            'product_id' => $m['material_product_id'] ? (int)$m['material_product_id'] : null,
            'variant_id' => $m['material_variant_id'] ? (int)$m['material_variant_id'] : null,
            'name' => $m['material_name'],
            'quantity' => (int)round($m['quantity'] / $qty),
            'total_quantity' => (int)$m['quantity'],
        ], $stmt->fetchAll());
    }
    unset($it);
    return $items;
}

/**
 * Inside an open transaction: make sure the whole sale can be served from stock, and
 * lock the stock rows involved. Looks at service materials AND ordinary product lines
 * of the same sale together (so "1 Manila sold directly + 1 Manila binding" is counted
 * as 2). Returns an error message, or null if everything is fine.
 *
 * Only runs checks for stock rows that some service in this sale actually uses, so a
 * sale without any material-using service behaves exactly as before.
 */
function sm_lock_and_check_stock(PDO $pdo, array $items): ?string
{
    $watch = [];   // key => ['pid','vid','name','need','services'=>[labels]]
    foreach ($items as $it) {
        if (empty($it['materials'])) continue;
        foreach ($it['materials'] as $m) {
            $k = sm_stock_key($m['material_product_id'], $m['material_variant_id']);
            if (!isset($watch[$k])) {
                $watch[$k] = ['pid' => $m['material_product_id'], 'vid' => $m['material_variant_id'], 'name' => $m['name'], 'need' => 0, 'services' => []];
            }
            $watch[$k]['need'] += (int)$m['quantity'];
            $watch[$k]['services'][$it['label']] = true;
        }
    }
    if (!$watch) return null;

    // Add ordinary product lines that draw from the same stock rows.
    foreach ($items as $it) {
        if ($it['product']['is_service']) continue;
        $k = sm_stock_key($it['product_id'], $it['variant_id']);
        if (isset($watch[$k])) $watch[$k]['need'] += (int)$it['quantity'];
    }

    foreach ($watch as $w) {
        if ($w['vid']) {
            $s = $pdo->prepare('SELECT stock_quantity, unit FROM product_variants WHERE id = ? FOR UPDATE');
            $s->execute([$w['vid']]);
        } else {
            $s = $pdo->prepare('SELECT stock_quantity, unit FROM products WHERE id = ? FOR UPDATE');
            $s->execute([$w['pid']]);
        }
        $row = $s->fetch();
        if (!$row) return 'A product used by "' . implode('", "', array_keys($w['services'])) . '" no longer exists. Please update that service\'s products.';
        if ((int)$row['stock_quantity'] < $w['need']) {
            return 'Not enough stock of "' . $w['name'] . '" to provide "' . implode('", "', array_keys($w['services'])) . '". '
                . 'This sale needs ' . $w['need'] . ' ' . $row['unit'] . ' but only ' . (int)$row['stock_quantity'] . ' ' . $row['unit'] . ' left.';
        }
    }
    return null;
}

/**
 * Inside an open transaction: take the materials of one saved sale line out of stock
 * and store the snapshot (quantity + cost at the time of sale).
 */
function sm_deduct_and_record(PDO $pdo, int $saleItemId, array $materials): void
{
    if (!$materials) return;
    $ins = $pdo->prepare('INSERT INTO sale_item_materials (sale_item_id, material_product_id, material_variant_id, material_name, quantity, unit_cost, total_cost) VALUES (?,?,?,?,?,?,?)');
    foreach ($materials as $m) {
        if ($m['material_variant_id']) {
            $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?')->execute([$m['quantity'], $m['material_variant_id']]);
        } else {
            $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?')->execute([$m['quantity'], $m['material_product_id']]);
        }
        $ins->execute([$saleItemId, $m['material_product_id'], $m['material_variant_id'], $m['name'], $m['quantity'], $m['unit_cost'], $m['total_cost']]);
    }
}

/**
 * Inside an open transaction: give back the materials that the given sale lines consumed.
 * Call this BEFORE the sale_items rows are deleted (the snapshot is removed with them).
 */
function sm_restore_for_items(PDO $pdo, array $saleItemIds): void
{
    if (!$saleItemIds || !sm_feature_ready($pdo)) return;
    $in = implode(',', array_fill(0, count($saleItemIds), '?'));
    $stmt = $pdo->prepare("SELECT material_product_id, material_variant_id, quantity FROM sale_item_materials WHERE sale_item_id IN ($in)");
    $stmt->execute(array_values($saleItemIds));
    foreach ($stmt->fetchAll() as $m) {
        if (!empty($m['material_variant_id'])) {
            $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$m['quantity'], $m['material_variant_id']]);
        } elseif (!empty($m['material_product_id'])) {
            $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$m['quantity'], $m['material_product_id']]);
        }
    }
}
