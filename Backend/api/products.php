<?php
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

        // Fold in this product's types, if any exist yet (harmless if the
        // product_variants table isn't there yet - just comes back empty).
        try {
            $vStmt = $pdo->prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY variant_name ASC');
            $vStmt->execute([$row['id']]);
            $row['variants'] = $vStmt->fetchAll();
        } catch (PDOException $e) {
            $row['variants'] = [];
        }
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

    // Each product's types (product_variants) are folded in here so the
    // Products page and the Sales picker both know, without a second call
    // per row, whether a product is a plain item or a parent with several
    // types - and if it's a parent, its combined stock, price range, and
    // whether any type is running low.
    try {
        $stmt = $pdo->prepare("SELECT p.*, c.name AS category_name,
                COALESCE(v.variant_count, 0) AS variant_count,
                CASE WHEN v.variant_count > 0 THEN v.total_stock ELSE p.stock_quantity END AS stock_quantity,
                v.min_buying, v.max_buying, v.min_selling, v.max_selling,
                COALESCE(v.total_value, 0) AS variant_stock_value,
                CASE WHEN v.low_variant_count > 0 THEN 1 ELSE 0 END AS has_low_variant
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN (
                SELECT product_id,
                       COUNT(*) AS variant_count,
                       SUM(stock_quantity) AS total_stock,
                       SUM(stock_quantity * buying_price) AS total_value,
                       MIN(buying_price) AS min_buying,
                       MAX(buying_price) AS max_buying,
                       MIN(selling_price) AS min_selling,
                       MAX(selling_price) AS max_selling,
                       SUM(CASE WHEN status = 'active' AND stock_quantity <= reorder_level THEN 1 ELSE 0 END) AS low_variant_count
                FROM product_variants
                WHERE status = 'active'
                GROUP BY product_id
            ) v ON v.product_id = p.id
            $where ORDER BY p.name ASC");
        $stmt->execute($params);
        respond(true, $stmt->fetchAll());
    } catch (PDOException $e) {
        // product_variants table not present yet (the upgrade script
        // hasn't been run) - fall back to the plain product list so the
        // page still loads normally.
        $stmt = $pdo->prepare("SELECT p.*, c.name AS category_name FROM products p
                                LEFT JOIN categories c ON c.id = p.category_id
                                $where ORDER BY p.name ASC");
        $stmt->execute($params);
        respond(true, $stmt->fetchAll());
    }
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
