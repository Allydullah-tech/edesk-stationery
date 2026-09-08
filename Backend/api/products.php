<?php
/**
 * eDESK Print & Digital - Products & Services API
 * GET    -> list all (admin + worker can view, needed for recording sales)
 * POST   -> create new product/service (admin only). Only "name" is
 *           required - this lets a bare "name only" entry be added to
 *           the Product/Service list first (e.g. from the Purchases
 *           page), with prices and stock filled in later.
 * PUT    -> update existing (admin only)
 * DELETE -> remove (admin only)   ?id=
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';

$user = require_login();
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (isset($_GET['id'])) {
        $stmt = $pdo->prepare('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?');
        $stmt->execute([(int)$_GET['id']]);
        $row = $stmt->fetch();
        if (!$row) respond(false, null, 'Product not found.', 404);
        respond(true, $row);
    }

    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['status'])) { $where .= ' AND p.status = ?'; $params[] = clean($_GET['status']); }
    if (isset($_GET['type']) && $_GET['type'] !== '') { $where .= ' AND p.is_service = ?'; $params[] = (int)$_GET['type']; }
    if (!empty($_GET['q'])) { $where .= ' AND p.name LIKE ?'; $params[] = '%' . clean($_GET['q']) . '%'; }
    if (!empty($_GET['names_only'])) {
        $stmt = $pdo->prepare("SELECT p.id, p.name FROM products p $where ORDER BY p.name ASC");
        $stmt->execute($params);
        respond(true, $stmt->fetchAll());
    }

    $stmt = $pdo->prepare("SELECT p.*, c.name AS category_name FROM products p
                            LEFT JOIN categories c ON c.id = p.category_id
                            $where ORDER BY p.name ASC");
    $stmt->execute($params);
    respond(true, $stmt->fetchAll());
}

if ($method === 'POST') {
    require_role(['admin']);
    $d = body();
    $missing = missing_fields($d, ['name']);
    if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);

    $name = clean($d['name']);
    $check = $pdo->prepare('SELECT COUNT(*) FROM products WHERE LOWER(name) = LOWER(?)');
    $check->execute([$name]);
    if ($check->fetchColumn() > 0) {
        respond(false, null, 'That name is already in your Product/Service list.', 409);
    }

    $categoryId = null;
    if (!empty($d['category_name'])) {
        $cat = clean($d['category_name']);
        $c = $pdo->prepare('INSERT INTO categories (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name');
        $c->execute([$cat]);
        $g = $pdo->prepare('SELECT id FROM categories WHERE name = ?');
        $g->execute([$cat]);
        $categoryId = $g->fetchColumn();
    } elseif (!empty($d['category_id'])) {
        $categoryId = (int)$d['category_id'];
    }

    $isService = !empty($d['is_service']) ? 1 : 0;
    $minimumPrice = isset($d['minimum_price']) && $d['minimum_price'] !== '' ? (float)$d['minimum_price'] : null;

    $stmt = $pdo->prepare('INSERT INTO products
        (name, category_id, is_service, unit, buying_price, selling_price, minimum_price, stock_quantity, reorder_level, status, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())');
    try {
        $stmt->execute([
            $name,
            $categoryId,
            $isService,
            clean($d['unit'] ?? 'pcs'),
            (float)($d['buying_price'] ?? 0),
            (float)($d['selling_price'] ?? 0),
            $minimumPrice,
            $isService ? 0 : (int)($d['stock_quantity'] ?? 0),
            (float)($d['reorder_level'] ?? 5),
            'active',
            $user['id'],
        ]);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'minimum_price') !== false) {
            respond(false, null, 'The database is missing the "minimum_price" column. Please run Backend/upgrade_add_minimum_price.php once, then try again.', 500);
        }
        respond(false, null, 'Could not save this item. Please try again.', 500);
    }
    $newId = $pdo->lastInsertId();
    log_activity($pdo, $user, 'create', $isService ? 'service' : 'product', $newId, 'Added ' . ($isService ? 'service' : 'product') . ': "' . $name . '"');
    respond(true, ['id' => $newId], 'Added to the ' . ($isService ? 'Service' : 'Product') . ' list successfully.');
}

if ($method === 'PUT') {
    require_role(['admin']);
    $d = body();
    if (empty($d['id'])) respond(false, null, 'Product id is required.', 422);

    $existingStmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
    $existingStmt->execute([(int)$d['id']]);
    $existing = $existingStmt->fetch();
    if (!$existing) respond(false, null, 'Product not found.', 404);

    $categoryId = null;
    if (!empty($d['category_name'])) {
        $cat = clean($d['category_name']);
        $c = $pdo->prepare('INSERT INTO categories (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name');
        $c->execute([$cat]);
        $g = $pdo->prepare('SELECT id FROM categories WHERE name = ?');
        $g->execute([$cat]);
        $categoryId = $g->fetchColumn();
    } elseif (isset($d['category_id'])) {
        $categoryId = $d['category_id'] !== '' ? (int)$d['category_id'] : null;
    }

    $isService = !empty($d['is_service']) ? 1 : 0;
    $minimumPrice = isset($d['minimum_price']) && $d['minimum_price'] !== '' ? (float)$d['minimum_price'] : null;

    $stmt = $pdo->prepare('UPDATE products SET
        name = ?, category_id = ?, is_service = ?, unit = ?, buying_price = ?, selling_price = ?, minimum_price = ?,
        stock_quantity = ?, reorder_level = ?, status = ?, updated_at = NOW()
        WHERE id = ?');
    try {
        $stmt->execute([
            clean($d['name']),
            $categoryId,
            $isService,
            clean($d['unit'] ?? 'pcs'),
            (float)($d['buying_price'] ?? 0),
            (float)($d['selling_price'] ?? 0),
            $minimumPrice,
            $isService ? 0 : (int)($d['stock_quantity'] ?? 0),
            (float)($d['reorder_level'] ?? 5),
            clean($d['status'] ?? 'active'),
            (int)$d['id'],
        ]);
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), 'minimum_price') !== false) {
            respond(false, null, 'The database is missing the "minimum_price" column. Please run Backend/upgrade_add_minimum_price.php once, then try again.', 500);
        }
        respond(false, null, 'Could not save changes. Please try again.', 500);
    }
    $changes = [];
    $newName = clean($d['name']);
    $newBuying = (float)($d['buying_price'] ?? 0);
    $newSelling = (float)($d['selling_price'] ?? 0);
    $newStatus = clean($d['status'] ?? 'active');
    if ($existing['name'] !== $newName) $changes[] = 'name "' . $existing['name'] . '" to "' . $newName . '"';
    if ((float)$existing['buying_price'] != $newBuying) $changes[] = 'buying price ' . audit_money_diff($existing['buying_price'], $newBuying);
    if ((float)$existing['selling_price'] != $newSelling) $changes[] = 'selling price ' . audit_money_diff($existing['selling_price'], $newSelling);
    if ((float)($existing['minimum_price'] ?? 0) != (float)$minimumPrice) $changes[] = 'minimum price ' . audit_money_diff($existing['minimum_price'] ?? 0, $minimumPrice ?? 0);
    if ($existing['status'] !== $newStatus) $changes[] = 'status ' . $existing['status'] . ' to ' . $newStatus;

    log_activity($pdo, $user, 'update', $existing['is_service'] ? 'service' : 'product', $existing['id'],
        'Edited "' . $existing['name'] . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no price/status changes)'));

    respond(true, null, 'Updated successfully.');
}

if ($method === 'DELETE') {
    require_role(['admin']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Product id is required.', 422);
    $lookup = $pdo->prepare('SELECT name, is_service FROM products WHERE id = ?');
    $lookup->execute([$id]);
    $row = $lookup->fetch();
    $stmt = $pdo->prepare('DELETE FROM products WHERE id = ?');
    $stmt->execute([$id]);
    log_activity($pdo, $user, 'delete', ($row && $row['is_service']) ? 'service' : 'product', $id,
        'Deleted ' . (($row && $row['is_service']) ? 'service' : 'product') . ': "' . ($row['name'] ?? 'unknown') . '"');
    respond(true, null, 'Removed.');
}

respond(false, null, 'Unsupported method.', 405);
