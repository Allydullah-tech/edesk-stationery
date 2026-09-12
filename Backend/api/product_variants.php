<?php
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';

$user = require_login();
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (isset($_GET['id'])) {
        $stmt = $pdo->prepare('SELECT pv.*, p.name AS product_name FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?');
        $stmt->execute([(int)$_GET['id']]);
        $row = $stmt->fetch();
        if (!$row) respond(false, null, 'Type not found.', 404);
        respond(true, $row);
    }

    if (empty($_GET['product_id'])) respond(false, null, 'A product_id is required.', 422);

    $stmt = $pdo->prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY variant_name ASC');
    $stmt->execute([(int)$_GET['product_id']]);
    respond(true, $stmt->fetchAll());
}

if ($method === 'POST') {
    require_role(['admin']);
    $d = body();
    $missing = missing_fields($d, ['product_id', 'variant_name']);
    if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);

    $productId = (int)$d['product_id'];
    $parent = $pdo->prepare('SELECT id, name, is_service FROM products WHERE id = ?');
    $parent->execute([$productId]);
    $product = $parent->fetch();
    if (!$product) respond(false, null, 'Parent product not found.', 404);
    if ($product['is_service']) respond(false, null, 'Services cannot have types.', 422);

    $variantName = clean($d['variant_name']);
    if ($variantName === '') respond(false, null, 'Type name is required.', 422);

    $check = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ? AND LOWER(variant_name) = LOWER(?)');
    $check->execute([$productId, $variantName]);
    if ($check->fetchColumn() > 0) {
        respond(false, null, '"' . $variantName . '" already exists under "' . $product['name'] . '".', 409);
    }

    $minimumPrice = isset($d['minimum_price']) && $d['minimum_price'] !== '' ? (float)$d['minimum_price'] : null;

    $stmt = $pdo->prepare('INSERT INTO product_variants
        (product_id, variant_name, unit, buying_price, selling_price, minimum_price, stock_quantity, reorder_level, status, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())');
    try {
        $stmt->execute([
            $productId,
            $variantName,
            clean($d['unit'] ?? 'pcs') ?: 'pcs',
            (float)($d['buying_price'] ?? 0),
            (float)($d['selling_price'] ?? 0),
            $minimumPrice,
            (int)($d['stock_quantity'] ?? 0),
            (float)($d['reorder_level'] ?? 5),
            'active',
            $user['id'],
        ]);
    } catch (PDOException $e) {
        respond(false, null, 'Could not save this type. Please make sure Backend/upgrade_add_product_variants.php has been run, then try again.', 500);
    }
    $newId = $pdo->lastInsertId();
    log_activity($pdo, $user, 'create', 'product', $productId, 'Added type "' . $variantName . '" under "' . $product['name'] . '"');
    respond(true, ['id' => $newId], 'Type "' . $variantName . '" added under "' . $product['name'] . '".');
}

if ($method === 'PUT') {
    require_role(['admin']);
    $d = body();
    if (empty($d['id'])) respond(false, null, 'Type id is required.', 422);

    $existingStmt = $pdo->prepare('SELECT pv.*, p.name AS product_name FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?');
    $existingStmt->execute([(int)$d['id']]);
    $existing = $existingStmt->fetch();
    if (!$existing) respond(false, null, 'Type not found.', 404);

    $variantName = isset($d['variant_name']) ? clean($d['variant_name']) : $existing['variant_name'];
    if ($variantName === '') respond(false, null, 'Type name is required.', 422);

    if (strcasecmp($variantName, $existing['variant_name']) !== 0) {
        $check = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ? AND LOWER(variant_name) = LOWER(?) AND id != ?');
        $check->execute([$existing['product_id'], $variantName, $existing['id']]);
        if ($check->fetchColumn() > 0) {
            respond(false, null, '"' . $variantName . '" already exists under "' . $existing['product_name'] . '".', 409);
        }
    }

    $minimumPrice = isset($d['minimum_price']) && $d['minimum_price'] !== '' ? (float)$d['minimum_price'] : null;
    $newBuying = isset($d['buying_price']) ? (float)$d['buying_price'] : (float)$existing['buying_price'];
    $newSelling = isset($d['selling_price']) ? (float)$d['selling_price'] : (float)$existing['selling_price'];

    $stmt = $pdo->prepare('UPDATE product_variants SET
        variant_name = ?, unit = ?, buying_price = ?, selling_price = ?, minimum_price = ?,
        stock_quantity = ?, reorder_level = ?, status = ?, updated_at = NOW()
        WHERE id = ?');
    $stmt->execute([
        $variantName,
        (isset($d['unit']) ? clean($d['unit']) : $existing['unit']) ?: 'pcs',
        $newBuying,
        $newSelling,
        $minimumPrice,
        isset($d['stock_quantity']) ? (int)$d['stock_quantity'] : (int)$existing['stock_quantity'],
        isset($d['reorder_level']) ? (float)$d['reorder_level'] : (float)$existing['reorder_level'],
        (isset($d['status']) ? clean($d['status']) : $existing['status']) ?: 'active',
        (int)$d['id'],
    ]);

    $changes = [];
    if ($existing['variant_name'] !== $variantName) $changes[] = 'name "' . $existing['variant_name'] . '" to "' . $variantName . '"';
    if ((float)$existing['buying_price'] != $newBuying) $changes[] = 'buying price ' . audit_money_diff($existing['buying_price'], $newBuying);
    if ((float)$existing['selling_price'] != $newSelling) $changes[] = 'selling price ' . audit_money_diff($existing['selling_price'], $newSelling);

    log_activity($pdo, $user, 'update', 'product', $existing['product_id'],
        'Edited type "' . $existing['variant_name'] . '" under "' . $existing['product_name'] . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no price/name changes)'));

    respond(true, null, 'Type updated successfully.');
}

if ($method === 'DELETE') {
    require_role(['admin']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Type id is required.', 422);

    $lookup = $pdo->prepare('SELECT pv.variant_name, pv.product_id, p.name AS product_name FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?');
    $lookup->execute([$id]);
    $row = $lookup->fetch();

    $stmt = $pdo->prepare('DELETE FROM product_variants WHERE id = ?');
    $stmt->execute([$id]);

    if ($row) {
        log_activity($pdo, $user, 'delete', 'product', $row['product_id'],
            'Deleted type "' . $row['variant_name'] . '" under "' . $row['product_name'] . '"');
    }
    respond(true, null, 'Type removed.');
}

respond(false, null, 'Unsupported method.', 405);
