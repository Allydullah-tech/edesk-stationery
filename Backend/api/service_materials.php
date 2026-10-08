<?php
/**
 * Products used by services.
 *
 *  GET  ?service_product_id=ID            -> every description's setup for that service
 *  GET  ?service_product_id=ID&service_variant_id=ID  -> just one description
 *  POST/PUT  (admin) { service_product_id, service_variant_id, materials: [{material_product_id, material_variant_id, quantity}] }
 *        -> replaces that description's whole list (send an empty list to clear it)
 *
 * The cost shown comes live from the product/inventory record; it is only used for
 * profit. Nothing here changes what a service sells for.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/service_material_helper.php';

$user = require_login();
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if (!sm_feature_ready($pdo)) respond(false, null, sm_upgrade_message(), 500);

if ($method === 'GET') {
    $serviceId = (int)($_GET['service_product_id'] ?? 0);
    if (!$serviceId) respond(false, null, 'A service is required.', 422);

    $sql = "SELECT sm.id, sm.service_product_id, sm.service_variant_id, sm.material_product_id, sm.material_variant_id, sm.quantity,
                   p.name AS product_name, pv.variant_name,
                   COALESCE(pv.buying_price, p.buying_price) AS unit_cost,
                   COALESCE(pv.stock_quantity, p.stock_quantity) AS stock_quantity,
                   COALESCE(pv.unit, p.unit) AS unit
            FROM service_materials sm
            JOIN products p ON p.id = sm.material_product_id
            LEFT JOIN product_variants pv ON pv.id = sm.material_variant_id
            WHERE sm.service_product_id = ?";
    $params = [$serviceId];
    if (isset($_GET['service_variant_id']) && $_GET['service_variant_id'] !== '') {
        $sql .= ' AND sm.service_variant_id = ?';
        $params[] = (int)$_GET['service_variant_id'];
    }
    $sql .= ' ORDER BY sm.id ASC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['material_name'] = $r['variant_name'] ? $r['product_name'] . ' — ' . $r['variant_name'] : $r['product_name'];
        $r['line_cost'] = round((float)$r['unit_cost'] * (int)$r['quantity'], 2);
    }
    unset($r);
    respond(true, $rows);
}

if ($method === 'POST' || $method === 'PUT') {
    require_role(['admin']);
    $d = body();

    $serviceId = (int)($d['service_product_id'] ?? 0);
    $serviceVariantId = !empty($d['service_variant_id']) ? (int)$d['service_variant_id'] : null;
    if (!$serviceId) respond(false, null, 'A service is required.', 422);
    $list = isset($d['materials']) && is_array($d['materials']) ? $d['materials'] : [];

    $sStmt = $pdo->prepare('SELECT id, name, is_service FROM products WHERE id = ?');
    $sStmt->execute([$serviceId]);
    $service = $sStmt->fetch();
    if (!$service || !$service['is_service']) respond(false, null, 'Products can only be attached to a service.', 422);

    $serviceLabel = $service['name'];
    if ($serviceVariantId) {
        $vStmt = $pdo->prepare('SELECT variant_name FROM product_variants WHERE id = ? AND product_id = ?');
        $vStmt->execute([$serviceVariantId, $serviceId]);
        $svRow = $vStmt->fetch();
        if (!$svRow) respond(false, null, 'That description does not belong to this service.', 404);
        $serviceLabel .= ' — ' . $svRow['variant_name'];
    }

    // Validate every line before touching anything.
    $clean = [];
    $seen = [];
    $names = [];
    foreach ($list as $m) {
        $mpId = (int)($m['material_product_id'] ?? 0);
        $mvId = !empty($m['material_variant_id']) ? (int)$m['material_variant_id'] : null;
        $qty = (int)($m['quantity'] ?? 0);
        if (!$mpId) continue; // blank row
        if ($qty <= 0) respond(false, null, 'Enter a quantity of 1 or more for every product used.', 422);

        $pStmt = $pdo->prepare('SELECT id, name, is_service FROM products WHERE id = ?');
        $pStmt->execute([$mpId]);
        $mp = $pStmt->fetch();
        if (!$mp) respond(false, null, 'One of the selected products no longer exists.', 404);
        if ($mp['is_service']) respond(false, null, '"' . $mp['name'] . '" is a service. Only stock products can be used by a service.', 422);

        $cStmt = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ?');
        $cStmt->execute([$mpId]);
        $hasVariants = (int)$cStmt->fetchColumn() > 0;
        $label = $mp['name'];
        if ($hasVariants) {
            if (!$mvId) respond(false, null, 'Select a description for "' . $mp['name'] . '".', 422);
            $mvStmt = $pdo->prepare('SELECT variant_name FROM product_variants WHERE id = ? AND product_id = ?');
            $mvStmt->execute([$mvId, $mpId]);
            $mv = $mvStmt->fetch();
            if (!$mv) respond(false, null, 'That description of "' . $mp['name'] . '" no longer exists.', 404);
            $label .= ' — ' . $mv['variant_name'];
        } else {
            $mvId = null;
        }

        $key = sm_stock_key($mpId, $mvId);
        if (isset($seen[$key])) respond(false, null, '"' . $label . '" is listed twice. Combine it into one line.', 422);
        $seen[$key] = true;

        $clean[] = ['product_id' => $mpId, 'variant_id' => $mvId, 'quantity' => $qty];
        $names[] = $label . ' x' . $qty;
    }

    try {
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM service_materials WHERE service_product_id = ? AND service_variant_id <=> ?')->execute([$serviceId, $serviceVariantId]);
        $ins = $pdo->prepare('INSERT INTO service_materials (service_product_id, service_variant_id, material_product_id, material_variant_id, quantity) VALUES (?,?,?,?,?)');
        foreach ($clean as $c) {
            $ins->execute([$serviceId, $serviceVariantId, $c['product_id'], $c['variant_id'], $c['quantity']]);
        }
        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not save the products used: ' . $e->getMessage(), 500);
    }

    log_activity($pdo, $user, 'update', 'service', $serviceId,
        $clean ? 'Set products used by "' . $serviceLabel . '": ' . implode(', ', $names) : 'Cleared the products used by "' . $serviceLabel . '"');

    respond(true, ['count' => count($clean)], $clean ? 'Products used saved.' : 'No products are used by this service now.');
}

respond(false, null, 'Unsupported method.', 405);
