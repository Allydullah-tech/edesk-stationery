<?php
/**
 * Service Purchases - products and materials bought to PROVIDE services.
 *
 * This is a stock of its own. It never reads from or writes to the Product Purchases stock
 * (products / product_variants / purchases), and Product Purchases never touch it.
 *
 *  GET                                  -> list of service purchases (?period=&date=&end=&limit=)
 *  GET  ?view=stock                     -> every service item with purchased / used / remaining
 *  GET  ?view=items                     -> light list for the "items used" picker on the Sales page
 *  GET  ?view=profit&period=&date=&end= -> (admin) service revenue, service purchase cost and profit
 *  POST   (admin) { items: [{name, description, unit, quantity, buying_price}], purchase_date, note }
 *         description is required (e.g. item "Pen", description "Obama Pen"); an item is
 *         identified by its name AND description (needs Backend/upgrade_v11_service_item_descriptions.php)
 *  PUT    (admin) { id, quantity, buying_price, purchase_date, note }
 *  PUT    (admin) { item_id, description }   -> sets the description of an existing service item
 *         (used to give older items, bought before descriptions existed, their description)
 *  DELETE (admin) ?id=
 *
 * Service stock goes DOWN when a service sale records the items it used (see
 * helpers/service_material_helper.php) and UP when a purchase is recorded here.
 * Cost figures are shown to admins only.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/report_helper.php';
require_once __DIR__ . '/../helpers/access_helper.php';

$user = require_login();
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

/** True once Backend/upgrade_v10_service_purchases.php has been run. */
function sp_tables_ready(PDO $pdo): bool
{
    try {
        return $pdo->query("SHOW TABLES LIKE 'service_items'")->rowCount() > 0
            && $pdo->query("SHOW TABLES LIKE 'service_purchases'")->rowCount() > 0;
    } catch (Throwable $e) {
        return false;
    }
}

if (!sp_tables_ready($pdo)) {
    respond(false, null, 'The database is missing the Service Purchases tables. Please run Backend/upgrade_v10_service_purchases.php once, then reload this page.', 500);
}

/** True once Backend/upgrade_v11_service_item_descriptions.php has been run (service_items.description exists). */
function sp_desc_ready(PDO $pdo): bool
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

/** "Pen — Obama Pen" when there is a description, otherwise just the name. */
function sp_label(string $name, ?string $description): string
{
    $description = trim((string)$description);
    return $description !== '' ? $name . ' — ' . $description : $name;
}

/** SQL piece for the description column ('' on installs that have not run the v11 upgrade yet). */
function sp_desc_sql(PDO $pdo, string $alias = 'si'): string
{
    return sp_desc_ready($pdo) ? "$alias.description" : "''";
}

/** Workers can see what was bought, but never what it cost. */
function sp_rows_for_user(array $user, array $rows, array $costKeys = ['buying_price', 'total_cost']): array
{
    return is_admin_user($user) ? $rows : hide_fields_in_rows($rows, $costKeys);
}

/** Is this the most recent purchase of that item? Only the latest one may move the item's current buying price. */
function sp_is_latest(PDO $pdo, array $p): bool
{
    $stmt = $pdo->prepare('SELECT MAX(id) FROM service_purchases WHERE service_item_id = ?');
    $stmt->execute([$p['service_item_id']]);
    return (int)$stmt->fetchColumn() === (int)$p['id'];
}

/** Buying price of the purchase just before this one for the same item, or null. */
function sp_previous_price(PDO $pdo, array $p): ?float
{
    $stmt = $pdo->prepare('SELECT buying_price FROM service_purchases WHERE service_item_id = ? AND id < ? ORDER BY id DESC LIMIT 1');
    $stmt->execute([$p['service_item_id'], $p['id']]);
    $v = $stmt->fetchColumn();
    return $v === false ? null : (float)$v;
}

function sp_item_name(PDO $pdo, int $itemId): string
{
    $stmt = $pdo->prepare('SELECT name, ' . sp_desc_sql($pdo, 'service_items') . ' AS description FROM service_items WHERE id = ?');
    $stmt->execute([$itemId]);
    $row = $stmt->fetch();
    return $row ? sp_label($row['name'], $row['description']) : 'an item';
}

function sp_valid_date(string $d): bool
{
    return (bool)preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m) && checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

/** Period filter shared by the list and the profit view. */
function sp_period_range(): array
{
    $period = !empty($_GET['period']) && in_array($_GET['period'], ['day', 'week', 'month', 'year', 'custom'], true) ? $_GET['period'] : 'month';
    $anchor = !empty($_GET['date']) ? clean($_GET['date']) : null;
    $endCustom = !empty($_GET['end']) ? clean($_GET['end']) : null;
    if (($anchor !== null && !sp_valid_date($anchor)) || ($endCustom !== null && !sp_valid_date($endCustom))) {
        respond(false, null, 'Enter a valid date.', 422);
    }
    [$start, $end] = resolve_period($period, $anchor, $endCustom);
    if ($start > $end) respond(false, null, 'The end date cannot be before the start date.', 422);
    return [$period, $start, $end];
}

if ($method === 'GET') {
    $view = $_GET['view'] ?? '';

    // ---- Picker list for the Sales page (every logged-in user) ----
    if ($view === 'items') {
        // "name" already carries the description (e.g. "Pen — Obama Pen") so the Sales page
        // shows and stores it without any change of its own.
        $stmt = $pdo->query('SELECT id, name, ' . sp_desc_sql($pdo, 'service_items') . ' AS description, unit, stock_quantity FROM service_items ORDER BY name ASC, description ASC');
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['base_name'] = $r['name'];
            $r['name'] = sp_label($r['name'], $r['description']);
        }
        unset($r);
        respond(true, $rows);
    }

    // ---- Service stock overview: what was bought, what was used, what is left ----
    if ($view === 'stock') {
        $stmt = $pdo->query("SELECT si.id, si.name, " . sp_desc_sql($pdo) . " AS description, si.unit, si.buying_price, si.stock_quantity,
                COALESCE((SELECT SUM(sp.quantity) FROM service_purchases sp WHERE sp.service_item_id = si.id), 0) AS total_purchased,
                (SELECT MAX(sp.purchase_date) FROM service_purchases sp WHERE sp.service_item_id = si.id) AS last_purchase_date
            FROM service_items si ORDER BY si.name ASC, description ASC");
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['label'] = sp_label($r['name'], $r['description']);
            $r['stock_quantity'] = (int)$r['stock_quantity'];
            $r['total_purchased'] = (int)$r['total_purchased'];
            // Everything that is not on the shelf any more was used by service sales.
            $r['total_used'] = max($r['total_purchased'] - $r['stock_quantity'], 0);
            $r['stock_value'] = round($r['stock_quantity'] * (float)$r['buying_price'], 2);
        }
        unset($r);
        respond(true, sp_rows_for_user($user, $rows, ['buying_price', 'stock_value']));
    }

    // ---- Period profit: service revenue collected minus service purchase costs ----
    if ($view === 'profit') {
        require_role(['admin']); // profit figures are admin only
        [$period, $start, $end] = sp_period_range();

        // Everything sold as a SERVICE in the period (full price charged).
        $stmt = $pdo->prepare('SELECT COALESCE(SUM(si.subtotal), 0) AS service_sales, COUNT(DISTINCT st.id) AS service_sales_count
                               FROM sale_items si
                               JOIN sale_transactions st ON st.id = si.transaction_id
                               JOIN products p ON p.id = si.product_id
                               WHERE p.is_service = 1 AND st.sale_date BETWEEN ? AND ?');
        $stmt->execute([$start, $end]);
        $sales = $stmt->fetch();

        // Service money still owed on credit sales: each credit sale's unpaid share is applied to its service lines.
        $stmt = $pdo->prepare('SELECT st.total_amount, SUM(si.subtotal) AS service_part,
                                      COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = st.id), 0) AS paid
                               FROM sale_transactions st
                               JOIN sale_items si ON si.transaction_id = st.id
                               JOIN products p ON p.id = si.product_id AND p.is_service = 1
                               WHERE st.payment_method = \'credit\' AND st.sale_date BETWEEN ? AND ?
                               GROUP BY st.id, st.total_amount');
        $stmt->execute([$start, $end]);
        $unpaid = 0.0;
        foreach ($stmt->fetchAll() as $c) {
            $total = (float)$c['total_amount'];
            if ($total <= 0) continue;
            $owed = max($total - (float)$c['paid'], 0.0);
            $unpaid += (float)$c['service_part'] * ($owed / $total);
        }
        $unpaid = round($unpaid, 2);

        // Everything bought for services in the period.
        $stmt = $pdo->prepare('SELECT COALESCE(SUM(total_cost), 0) AS purchase_cost, COUNT(*) AS purchase_count
                               FROM service_purchases WHERE purchase_date BETWEEN ? AND ?');
        $stmt->execute([$start, $end]);
        $buys = $stmt->fetch();

        $serviceSales = round((float)$sales['service_sales'], 2);
        $collected = round($serviceSales - $unpaid, 2);
        $cost = round((float)$buys['purchase_cost'], 2);

        respond(true, [
            'period' => $period,
            'range' => ['start' => $start, 'end' => $end],
            'service_sales' => $serviceSales,
            'service_sales_count' => (int)$sales['service_sales_count'],
            'credit_unpaid' => $unpaid,
            'service_revenue' => $collected,
            'purchase_cost' => $cost,
            'purchase_count' => (int)$buys['purchase_count'],
            'service_profit' => round($collected - $cost, 2),
        ]);
    }

    // ---- Purchases list ----
    $limit = !empty($_GET['limit']) ? max(1, (int)$_GET['limit']) : 100;
    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['period']) && in_array($_GET['period'], ['day', 'week', 'month', 'year', 'custom'], true)) {
        [, $start, $end] = sp_period_range();
        $where .= ' AND sp.purchase_date BETWEEN ? AND ?';
        $params[] = $start;
        $params[] = $end;
    }
    $stmt = $pdo->prepare("SELECT sp.*, si.name AS item_name, " . sp_desc_sql($pdo) . " AS item_description, si.unit, u.full_name AS recorded_by_name
                           FROM service_purchases sp
                           JOIN service_items si ON si.id = sp.service_item_id
                           JOIN users u ON u.id = sp.recorded_by
                           $where ORDER BY sp.purchase_date DESC, sp.id DESC LIMIT $limit");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['item_label'] = sp_label($r['item_name'], $r['item_description']);
    }
    unset($r);
    respond(true, sp_rows_for_user($user, $rows));
}

if ($method === 'POST') {
    $user = require_role(['admin']);
    $d = body();
    $items = $d['items'] ?? null;
    if (!is_array($items) || count($items) === 0) respond(false, null, 'Add at least one item.', 422);

    $purchaseDate = !empty($d['purchase_date']) ? clean($d['purchase_date']) : today();
    if (!sp_valid_date($purchaseDate)) respond(false, null, 'Enter a valid purchase date.', 422);
    $note = mb_substr(clean($d['note'] ?? ''), 0, 255);

    if (!sp_desc_ready($pdo)) {
        respond(false, null, 'The database is missing the service item "description" column. Please run Backend/upgrade_v11_service_item_descriptions.php once, then try again.', 500);
    }

    // ---- Validate every row first ----
    $rows = [];
    $errors = [];
    foreach ($items as $i => $item) {
        $n = $i + 1;
        $name = mb_substr(clean($item['name'] ?? ''), 0, 150);
        $description = mb_substr(clean($item['description'] ?? ''), 0, 150);
        $unit = mb_substr(clean($item['unit'] ?? ''), 0, 30) ?: 'pcs';
        $qty = isset($item['quantity']) && $item['quantity'] !== '' ? (int)$item['quantity'] : 0;
        $hasPrice = isset($item['buying_price']) && $item['buying_price'] !== '' && is_numeric($item['buying_price']);
        $price = $hasPrice ? round((float)$item['buying_price'], 2) : null;

        if ($name === '') { $errors[] = "Row $n: enter the item name."; continue; }
        $shown = sp_label($name, $description);
        // Every item needs a description (e.g. "Obama Pen", "A4", "Blue") - the same as every product does.
        if ($description === '') { $errors[] = "Row $n ($name): enter the description (e.g. Obama Pen)."; continue; }
        if ($qty <= 0) { $errors[] = "Row $n ($shown): enter a valid quantity."; continue; }
        if ($price === null || $price < 0) { $errors[] = "Row $n ($shown): enter the buying price per unit."; continue; }
        $rows[] = ['name' => $name, 'description' => $description, 'unit' => $unit, 'quantity' => $qty, 'price' => $price];
    }
    if ($errors) respond(false, ['errors' => $errors], implode(' ', $errors), 422);

    // ---- Apply everything in one transaction ----
    $created = 0;
    $restocked = 0;
    try {
        $pdo->beginTransaction();
        foreach ($rows as $r) {
            // An item is identified by its name AND description ("Pen" + "Obama Pen" is a different
            // item from "Pen" + "Marker Pen", and from a plain "Pen").
            if (sp_desc_ready($pdo)) {
                $find = $pdo->prepare('SELECT id FROM service_items WHERE LOWER(name) = LOWER(?) AND LOWER(description) = LOWER(?) LIMIT 1 FOR UPDATE');
                $find->execute([$r['name'], $r['description']]);
            } else {
                $find = $pdo->prepare('SELECT id FROM service_items WHERE LOWER(name) = LOWER(?) LIMIT 1 FOR UPDATE');
                $find->execute([$r['name']]);
            }
            $itemId = $find->fetchColumn();

            if ($itemId) {
                // Existing item: add to its stock and remember the newest buying price.
                $pdo->prepare('UPDATE service_items SET stock_quantity = stock_quantity + ?, buying_price = ?, updated_at = NOW() WHERE id = ?')
                    ->execute([$r['quantity'], $r['price'], $itemId]);
                $restocked++;
            } else {
                if (sp_desc_ready($pdo)) {
                    $pdo->prepare('INSERT INTO service_items (name, description, unit, buying_price, stock_quantity, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())')
                        ->execute([$r['name'], $r['description'], $r['unit'], $r['price'], $r['quantity'], $user['id']]);
                } else {
                    $pdo->prepare('INSERT INTO service_items (name, unit, buying_price, stock_quantity, created_by, created_at, updated_at) VALUES (?,?,?,?,?,NOW(),NOW())')
                        ->execute([$r['name'], $r['unit'], $r['price'], $r['quantity'], $user['id']]);
                }
                $itemId = $pdo->lastInsertId();
                $created++;
            }

            $pdo->prepare('INSERT INTO service_purchases (service_item_id, quantity, buying_price, total_cost, note, recorded_by, purchase_date, created_at)
                           VALUES (?,?,?,?,?,?,?,NOW())')
                ->execute([$itemId, $r['quantity'], $r['price'], round($r['quantity'] * $r['price'], 2), $note !== '' ? $note : null, $user['id'], $purchaseDate]);
        }
        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not save the service purchase. Please try again.', 500);
    }

    $totalCost = array_sum(array_map(fn($r) => $r['quantity'] * $r['price'], $rows));
    $summary = count($rows) === 1
        ? '"' . sp_label($rows[0]['name'], $rows[0]['description']) . '" (' . $rows[0]['quantity'] . ' ' . $rows[0]['unit'] . ')'
        : count($rows) . ' item(s)';
    log_activity($pdo, $user, 'create', 'service_purchase', null,
        'Recorded a service purchase of ' . $summary . ' for TZS ' . number_format($totalCost) . ': ' . $created . ' new item(s), ' . $restocked . ' restocked');

    respond(true, ['created' => $created, 'restocked' => $restocked],
        "Service stock updated: $created new item(s) added, $restocked existing item(s) restocked.");
}

if ($method === 'PUT') {
    // Admin only: fix a service purchase that was recorded wrongly. Stock moves by the difference.
    $user = require_role(['admin']);
    $d = body();

    // ---- Set the description of an existing item (older items were bought without one) ----
    if (isset($d['item_id'])) {
        if (!sp_desc_ready($pdo)) {
            respond(false, null, 'The database is missing the service item "description" column. Please run Backend/upgrade_v11_service_item_descriptions.php once, then try again.', 500);
        }
        $itemId = (int)$d['item_id'];
        $newDesc = mb_substr(clean($d['description'] ?? ''), 0, 150);
        if ($newDesc === '') respond(false, null, 'Enter the description.', 422);

        $stmt = $pdo->prepare('SELECT id, name, description FROM service_items WHERE id = ?');
        $stmt->execute([$itemId]);
        $item = $stmt->fetch();
        if (!$item) respond(false, null, 'Item not found.', 404);

        $dup = $pdo->prepare('SELECT id FROM service_items WHERE LOWER(name) = LOWER(?) AND LOWER(description) = LOWER(?) AND id <> ? LIMIT 1');
        $dup->execute([$item['name'], $newDesc, $itemId]);
        if ($dup->fetchColumn()) {
            respond(false, null, '"' . sp_label($item['name'], $newDesc) . '" already exists in service stock. Choose a different description.', 422);
        }

        $pdo->prepare('UPDATE service_items SET description = ?, updated_at = NOW() WHERE id = ?')->execute([$newDesc, $itemId]);
        log_activity($pdo, $user, 'update', 'service_purchase', null,
            'Changed the description of service item "' . sp_label($item['name'], $item['description']) . '" to "' . sp_label($item['name'], $newDesc) . '"');
        respond(true, null, 'Description saved: ' . sp_label($item['name'], $newDesc));
    }

    $id = (int)($d['id'] ?? 0);
    if (!$id) respond(false, null, 'Purchase id is required.', 422);

    $qty = isset($d['quantity']) && $d['quantity'] !== '' ? (int)$d['quantity'] : 0;
    if ($qty <= 0) respond(false, null, 'Enter a valid quantity.', 422);
    if (!isset($d['buying_price']) || $d['buying_price'] === '' || !is_numeric($d['buying_price']) || (float)$d['buying_price'] < 0) {
        respond(false, null, 'Enter a valid buying price.', 422);
    }
    $newPrice = round((float)$d['buying_price'], 2);
    $newNote = mb_substr(clean($d['note'] ?? ''), 0, 255);
    $newDate = null;
    if (!empty($d['purchase_date'])) {
        $newDate = clean($d['purchase_date']);
        if (!sp_valid_date($newDate)) respond(false, null, 'Enter a valid purchase date.', 422);
    }

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare('SELECT * FROM service_purchases WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
        if (!$existing) { $pdo->rollBack(); respond(false, null, 'Purchase not found.', 404); }

        $newDate = $newDate ?? $existing['purchase_date'];
        $oldQty = (int)$existing['quantity'];
        $delta = $qty - $oldQty;

        $itemStmt = $pdo->prepare('SELECT stock_quantity, buying_price FROM service_items WHERE id = ? FOR UPDATE');
        $itemStmt->execute([$existing['service_item_id']]);
        $item = $itemStmt->fetch();
        if (!$item) { $pdo->rollBack(); respond(false, null, 'The item for this purchase no longer exists.', 404); }

        $stock = (int)$item['stock_quantity'];
        if ($delta < 0 && $stock + $delta < 0) {
            $pdo->rollBack();
            respond(false, null, 'Cannot reduce this purchase to ' . $qty . '. Only ' . $stock . ' of the ' . $oldQty
                . ' bought are still in service stock (the rest were used by services), so the lowest quantity you can set is '
                . max($oldQty - $stock, 1) . '.', 422);
        }
        if ($delta !== 0) {
            $pdo->prepare('UPDATE service_items SET stock_quantity = stock_quantity + ?, updated_at = NOW() WHERE id = ?')->execute([$delta, $existing['service_item_id']]);
        }

        // Keep the item's current buying price right too - but only when this is the latest
        // purchase and nobody has changed the price by hand since.
        if (abs((float)$existing['buying_price'] - $newPrice) > 0.004
            && abs((float)$item['buying_price'] - (float)$existing['buying_price']) < 0.005
            && sp_is_latest($pdo, $existing)) {
            $pdo->prepare('UPDATE service_items SET buying_price = ?, updated_at = NOW() WHERE id = ?')->execute([$newPrice, $existing['service_item_id']]);
        }

        $pdo->prepare('UPDATE service_purchases SET quantity = ?, buying_price = ?, total_cost = ?, purchase_date = ?, note = ? WHERE id = ?')
            ->execute([$qty, $newPrice, round($qty * $newPrice, 2), $newDate, $newNote !== '' ? $newNote : null, $id]);

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
    log_activity($pdo, $user, 'update', 'service_purchase', $id,
        'Edited service purchase #' . $id . ' of "' . sp_item_name($pdo, (int)$existing['service_item_id']) . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no changes)')
        . ($delta !== 0 ? '; service stock ' . ($delta > 0 ? '+' : '-') . abs($delta) : ''));

    respond(true, null, $delta === 0 ? 'Service purchase updated.' : 'Service purchase updated and service stock adjusted by ' . ($delta > 0 ? '+' : '-') . abs($delta) . '.');
}

if ($method === 'DELETE') {
    // Admin only: remove a purchase that should never have been recorded. The quantity it added
    // is taken back out of service stock - unless some of it has already been used.
    $user = require_role(['admin']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Purchase id is required.', 422);

    $itemRemoved = false;
    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare('SELECT * FROM service_purchases WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
        if (!$existing) { $pdo->rollBack(); respond(false, null, 'Purchase not found.', 404); }

        $qty = (int)$existing['quantity'];
        $itemId = (int)$existing['service_item_id'];

        $itemStmt = $pdo->prepare('SELECT name, ' . sp_desc_sql($pdo, 'service_items') . ' AS description, stock_quantity, buying_price FROM service_items WHERE id = ? FOR UPDATE');
        $itemStmt->execute([$itemId]);
        $item = $itemStmt->fetch();
        if (!$item) { $pdo->rollBack(); respond(false, null, 'The item for this purchase no longer exists.', 404); }

        $stock = (int)$item['stock_quantity'];
        if ($stock < $qty) {
            $pdo->rollBack();
            respond(false, null, 'This purchase cannot be deleted: it added ' . $qty . ' but only ' . $stock
                . ' are still in service stock (' . ($qty - $stock) . ' were used by services). Edit the quantity instead.', 422);
        }

        $pdo->prepare('UPDATE service_items SET stock_quantity = stock_quantity - ?, updated_at = NOW() WHERE id = ?')->execute([$qty, $itemId]);

        // If this purchase set the current buying price, go back to the one before it.
        if (abs((float)$item['buying_price'] - (float)$existing['buying_price']) < 0.005 && sp_is_latest($pdo, $existing)) {
            $prev = sp_previous_price($pdo, $existing);
            if ($prev !== null) {
                $pdo->prepare('UPDATE service_items SET buying_price = ?, updated_at = NOW() WHERE id = ?')->execute([$prev, $itemId]);
            }
        }

        $label = sp_label($item['name'], $item['description']);
        $pdo->prepare('DELETE FROM service_purchases WHERE id = ?')->execute([$id]);

        // A mistyped item that now has no purchases and was never used by a service is tidied away,
        // so the service stock list does not fill up with empty leftovers.
        $left = $pdo->prepare('SELECT COUNT(*) FROM service_purchases WHERE service_item_id = ?');
        $left->execute([$itemId]);
        if ((int)$left->fetchColumn() === 0) {
            $usedCount = 1; // if usage cannot be checked, keep the item rather than risk losing history
            try {
                $used = $pdo->prepare('SELECT COUNT(*) FROM sale_item_materials WHERE service_item_id = ?');
                $used->execute([$itemId]);
                $usedCount = (int)$used->fetchColumn();
            } catch (Throwable $e) { /* keep the item */ }
            if ($usedCount === 0) {
                $pdo->prepare('DELETE FROM service_items WHERE id = ?')->execute([$itemId]);
                $itemRemoved = true;
            }
        }

        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not delete the purchase. Please try again.', 500);
    }

    log_activity($pdo, $user, 'delete', 'service_purchase', $id,
        'Deleted service purchase #' . $id . ': ' . $qty . ' x "' . $label . '" bought on ' . $existing['purchase_date']
        . ' for TZS ' . number_format((float)$existing['total_cost']) . '; ' . $qty . ' removed from service stock'
        . ($itemRemoved ? ' (the item had no other purchases, so it was removed from the list)' : ''));

    respond(true, null, 'Service purchase deleted and ' . $qty . ' removed from service stock.');
}

respond(false, null, 'Unsupported method.', 405);
