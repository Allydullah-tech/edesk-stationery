<?php
/**
 * eDESK Print & Digital - Products / materials used by services
 *
 * When a service is SOLD, the cashier can say which SERVICE STOCK items were used to
 * provide it (e.g. "Manila Binding" used 1 x Manila Cover). Those items come from the
 * Service Purchases stock (tables service_items / service_purchases), which is kept
 * completely separate from the Product Purchases stock (products / product_variants).
 *
 * The rules, in one place:
 *
 *   Sales / cash : ALWAYS the full price charged. Never reduced by material cost.
 *   Stock        : the items are deducted from SERVICE stock - never from product stock.
 *   Profit       : sale_items.profit / sale_transactions.total_profit are NOT changed (a service
 *                  line still carries its full selling price). The real service profit for a period
 *                  (service revenue minus service purchase costs) is worked out separately by
 *                  api/service_purchases.php?view=profit.
 *
 * For the sale line this file only feeds SERVICE STOCK (and a snapshot of what was used).
 * It never touches unit_price, subtotal, total_amount or total_profit - those drive the sales
 * reports and the daily cash audit.
 *
 * Older service sales (recorded before upgrade_v10_service_purchases.php) took their materials
 * from PRODUCT stock. Those snapshot rows have no service_item_id, and they are still given
 * back to PRODUCT stock if such a sale is edited or deleted, so old data stays correct.
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

/** True once the v10 upgrade (service_items table + sale_item_materials.service_item_id) has been run. */
function sm_service_stock_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $ready = sm_feature_ready($pdo)
            && $pdo->query("SHOW TABLES LIKE 'service_items'")->rowCount() > 0
            && $pdo->query("SHOW COLUMNS FROM `sale_item_materials` LIKE 'service_item_id'")->rowCount() > 0;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

function sm_upgrade_message(): string
{
    return 'The database is missing the "products used by services" table. Please run Backend/upgrade_v8_service_materials.php once, then try again.';
}

/** True once upgrade_v11_service_item_descriptions.php has been run (service_items.description exists). */
function sm_item_description_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $ready = $pdo->query("SHOW COLUMNS FROM `service_items` LIKE 'description'")->rowCount() > 0;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

function sm_service_stock_upgrade_message(): string
{
    return 'The database is missing the Service Purchases tables. Please run Backend/upgrade_v10_service_purchases.php once, then try again.';
}

/** Stable key for the PRODUCT stock row an older (pre-v10) material drew from. */
function sm_stock_key($productId, $variantId): string
{
    return $variantId ? 'v' . (int)$variantId : 'p' . (int)$productId;
}

/**
 * Work out what ONE sale line of a service consumes, from the service stock items the cashier
 * picked while recording the sale. $requested = [['service_item_id'=>, 'quantity'=>], ...]
 * where quantity is the amount used per 1 service (it is multiplied by the sale quantity).
 *
 * The cost price comes from the Service Purchases record - the cashier never types it.
 * Returns ['materials' => [...snapshot rows...], 'unit_cost' => cost per 1 service, 'total_cost' => cost for the line].
 * Calls respond() and exits on invalid input.
 */
function sm_build_line_materials(PDO $pdo, array $requested, int $saleQty): array
{
    $out = ['materials' => [], 'unit_cost' => 0.0, 'total_cost' => 0.0];
    if (!$requested) return $out;

    // Merge repeated items into one line.
    $merged = [];
    foreach ($requested as $r) {
        $sid = (int)($r['service_item_id'] ?? 0);
        if (!$sid) continue; // blank row
        $qty = (int)($r['quantity'] ?? 0);
        if ($qty <= 0) respond(false, null, 'Enter a quantity of 1 or more for every item used.', 422);
        if (isset($merged[$sid])) $merged[$sid]['quantity'] += $qty;
        else $merged[$sid] = ['service_item_id' => $sid, 'quantity' => $qty];
    }
    if (!$merged) return $out;

    if (!sm_service_stock_ready($pdo)) respond(false, null, sm_service_stock_upgrade_message(), 500);

    $perUnitCost = 0.0;
    $totalCost = 0.0;
    $descSql = sm_item_description_ready($pdo) ? 'description' : "'' AS description";
    foreach ($merged as $m) {
        $iStmt = $pdo->prepare("SELECT id, name, $descSql, unit, buying_price FROM service_items WHERE id = ?");
        $iStmt->execute([$m['service_item_id']]);
        $item = $iStmt->fetch();
        if (!$item) respond(false, null, 'An item used for the service no longer exists in Service Purchases stock.', 404);

        $unitCost = (float)$item['buying_price'];
        $usedTotal = $m['quantity'] * $saleQty;
        $lineCost = round($usedTotal * $unitCost, 2);
        $perUnitCost += $m['quantity'] * $unitCost;
        $totalCost += $lineCost;
        $out['materials'][] = [
            'service_item_id' => (int)$item['id'],
            'material_product_id' => null,
            'material_variant_id' => null,
            // Name + description (e.g. "Pen — Obama Pen"), so the sale shows exactly which item was used.
            'name' => trim((string)$item['description']) !== '' ? $item['name'] . ' — ' . trim($item['description']) : $item['name'],
            'unit' => $item['unit'],
            'quantity' => $usedTotal,
            'unit_cost' => $unitCost,
            'total_cost' => $lineCost,
        ];
    }
    $out['unit_cost'] = round($perUnitCost, 2);
    $out['total_cost'] = round($totalCost, 2);
    return $out;
}

/**
 * The items used by each sale line, for showing/editing a saved sale. quantity = per 1 service.
 * Rows with a service_item_id came from Service Purchases stock; rows without one are older
 * sales that used product stock (flagged legacy = true).
 */
function sm_materials_for_sale_items(PDO $pdo, array $items): array
{
    if (!$items || !sm_feature_ready($pdo)) return $items;
    $hasService = sm_service_stock_ready($pdo);
    $select = 'material_product_id, material_variant_id, material_name, quantity' . ($hasService ? ', service_item_id' : '');
    $stmt = $pdo->prepare("SELECT $select FROM sale_item_materials WHERE sale_item_id = ? ORDER BY id ASC");
    foreach ($items as &$it) {
        $stmt->execute([$it['id']]);
        $qty = max(1, (int)$it['quantity']);
        $it['materials'] = array_map(function ($m) use ($qty) {
            $sid = !empty($m['service_item_id']) ? (int)$m['service_item_id'] : null;
            return [
                'service_item_id' => $sid,
                'legacy' => $sid === null,
                'product_id' => $m['material_product_id'] ? (int)$m['material_product_id'] : null,
                'variant_id' => $m['material_variant_id'] ? (int)$m['material_variant_id'] : null,
                'name' => $m['material_name'],
                'quantity' => (int)round($m['quantity'] / $qty),
                'total_quantity' => (int)$m['quantity'],
            ];
        }, $stmt->fetchAll());
    }
    unset($it);
    return $items;
}

/**
 * Inside an open transaction: make sure the whole sale can be served from SERVICE stock, and
 * lock the service stock rows involved. Several service lines of the same sale that use the
 * same item are counted together. Returns an error message, or null if everything is fine.
 *
 * Product stock is never looked at here: services do not draw from it any more.
 */
function sm_lock_and_check_stock(PDO $pdo, array $items): ?string
{
    $watch = [];   // service_item_id => ['name', 'need', 'services' => [labels]]
    foreach ($items as $it) {
        if (empty($it['materials'])) continue;
        foreach ($it['materials'] as $m) {
            if (empty($m['service_item_id'])) continue;
            $k = (int)$m['service_item_id'];
            if (!isset($watch[$k])) $watch[$k] = ['name' => $m['name'], 'need' => 0, 'services' => []];
            $watch[$k]['need'] += (int)$m['quantity'];
            $watch[$k]['services'][$it['label']] = true;
        }
    }
    if (!$watch) return null;

    foreach ($watch as $id => $w) {
        $s = $pdo->prepare('SELECT stock_quantity, unit FROM service_items WHERE id = ? FOR UPDATE');
        $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) return 'An item used by "' . implode('", "', array_keys($w['services'])) . '" no longer exists in Service Purchases stock.';
        if ((int)$row['stock_quantity'] < $w['need']) {
            return 'Not enough service stock of "' . $w['name'] . '" to provide "' . implode('", "', array_keys($w['services'])) . '". '
                . 'This sale needs ' . $w['need'] . ' ' . $row['unit'] . ' but only ' . (int)$row['stock_quantity'] . ' ' . $row['unit']
                . ' left. Record a Service Purchase to add stock.';
        }
    }
    return null;
}

/**
 * Inside an open transaction: take the items used by one saved sale line out of SERVICE stock
 * and store the snapshot (quantity + cost at the time of sale).
 */
function sm_deduct_and_record(PDO $pdo, int $saleItemId, array $materials): void
{
    if (!$materials) return;
    $ins = $pdo->prepare('INSERT INTO sale_item_materials (sale_item_id, service_item_id, material_product_id, material_variant_id, material_name, quantity, unit_cost, total_cost) VALUES (?,?,?,?,?,?,?,?)');
    foreach ($materials as $m) {
        $pdo->prepare('UPDATE service_items SET stock_quantity = stock_quantity - ?, updated_at = NOW() WHERE id = ?')->execute([$m['quantity'], $m['service_item_id']]);
        $ins->execute([$saleItemId, $m['service_item_id'], null, null, $m['name'], $m['quantity'], $m['unit_cost'], $m['total_cost']]);
    }
}

/**
 * Inside an open transaction: give back the items that the given sale lines consumed.
 * Service-stock rows go back to SERVICE stock; older rows (no service_item_id) go back to the
 * PRODUCT stock they were taken from. Call this BEFORE the sale_items rows are deleted
 * (the snapshot is removed with them).
 */
function sm_restore_for_items(PDO $pdo, array $saleItemIds): void
{
    if (!$saleItemIds || !sm_feature_ready($pdo)) return;
    $hasService = sm_service_stock_ready($pdo);
    $in = implode(',', array_fill(0, count($saleItemIds), '?'));
    $select = 'material_product_id, material_variant_id, quantity' . ($hasService ? ', service_item_id' : '');
    $stmt = $pdo->prepare("SELECT $select FROM sale_item_materials WHERE sale_item_id IN ($in)");
    $stmt->execute(array_values($saleItemIds));
    foreach ($stmt->fetchAll() as $m) {
        if (!empty($m['service_item_id'])) {
            $pdo->prepare('UPDATE service_items SET stock_quantity = stock_quantity + ?, updated_at = NOW() WHERE id = ?')->execute([$m['quantity'], $m['service_item_id']]);
        } elseif (!empty($m['material_variant_id'])) {
            $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$m['quantity'], $m['material_variant_id']]);
        } elseif (!empty($m['material_product_id'])) {
            $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$m['quantity'], $m['material_product_id']]);
        }
    }
}
