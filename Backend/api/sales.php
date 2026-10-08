<?php
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/customer_helper.php';
require_once __DIR__ . '/../helpers/change_helper.php';
require_once __DIR__ . '/../helpers/service_material_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

/**
 * Validate and price one cart line against the products/product_variants
 * tables. Returns the enriched item array, or calls respond() (which
 * exits) on failure.
 */
function prepare_sale_item(PDO $pdo, array $raw): array
{
    if (empty($raw['product_id']) || !isset($raw['quantity']) || !isset($raw['unit_price'])) {
        respond(false, null, 'Each item needs a product, quantity, and unit price.', 422);
    }
    $productId = (int)$raw['product_id'];
    $variantId = !empty($raw['variant_id']) ? (int)$raw['variant_id'] : null;
    $qty = (int)$raw['quantity'];
    $unitPrice = (float)$raw['unit_price'];
    if ($qty <= 0 || $unitPrice < 0) respond(false, null, 'Enter a valid quantity and price for every item.', 422);

    $stmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
    $stmt->execute([$productId]);
    $product = $stmt->fetch();
    if (!$product) respond(false, null, 'One of the items in this sale no longer exists.', 404);

    // A product with types cannot be sold as itself - a specific type
    // must be selected, and that type's own price/stock are used
    // instead of the parent product's.
    $variant = null;
    if (!$product['is_service']) {
        $countStmt = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ?');
        $countStmt->execute([$productId]);
        $hasVariants = (int)$countStmt->fetchColumn() > 0;

        if ($hasVariants) {
            if (!$variantId) respond(false, null, 'Please select a type for "' . $product['name'] . '".', 422);
            $vStmt = $pdo->prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?');
            $vStmt->execute([$variantId, $productId]);
            $variant = $vStmt->fetch();
            if (!$variant) respond(false, null, 'That type of "' . $product['name'] . '" no longer exists.', 404);
        }
    }

    $label = $variant ? ($product['name'] . ' — ' . $variant['variant_name']) : $product['name'];
    $minimumPrice = $variant ? $variant['minimum_price'] : $product['minimum_price'];
    $stockAvailable = (int)($variant ? $variant['stock_quantity'] : $product['stock_quantity']);
    $unit = $variant ? $variant['unit'] : $product['unit'];
    $buyingPrice = $product['is_service'] ? 0.0 : (float)($variant ? $variant['buying_price'] : $product['buying_price']);

    if (!empty($minimumPrice) && $unitPrice < (float)$minimumPrice) {
        respond(false, null, 'That price is below the minimum allowed selling price of TZS ' . number_format((float)$minimumPrice) . ' for "' . $label . '".', 422);
    }
    if (!$product['is_service'] && $stockAvailable < $qty) {
        respond(false, null, 'Not enough stock for "' . $label . '". Only ' . $stockAvailable . ' ' . $unit . ' left.', 422);
    }

    // The sale amount is ALWAYS the full price charged: quantity x unit price.
    // Products used to provide a service never reduce it - they only reduce PROFIT
    // (and come out of stock when the sale is saved).
    $subtotal = round($qty * $unitPrice, 2);
    $materials = [];
    if ($product['is_service']) {
        $line = sm_build_line_materials($pdo, is_array($raw['materials'] ?? null) ? $raw['materials'] : [], $qty);
        $materials = $line['materials'];
        $buyingPrice = $line['unit_cost'];                 // cost of the products used, per 1 service
        $profit = round($subtotal - $line['total_cost'], 2);
    } else {
        $profit = round(($unitPrice - $buyingPrice) * $qty, 2);
    }

    return [
        'product' => $product, 'variant' => $variant, 'product_id' => $productId, 'variant_id' => $variant ? $variantId : null,
        'quantity' => $qty, 'unit_price' => $unitPrice, 'buying_price' => $buyingPrice, 'subtotal' => $subtotal, 'profit' => $profit,
        'label' => $label, 'unit' => $unit, 'materials' => $materials,
    ];
}

if ($method === 'GET') {
    if (isset($_GET['id'])) {
        // One full transaction, with every item - for the receipt/edit screens.
        $stmt = $pdo->prepare("SELECT st.*, u.full_name AS sold_by_name FROM sale_transactions st JOIN users u ON u.id = st.sold_by WHERE st.id = ?");
        $stmt->execute([(int)$_GET['id']]);
        $txn = $stmt->fetch();
        if (!$txn) respond(false, null, 'Sale not found.', 404);

        // product_name/unit already fold in the type name (e.g. "Pen — Obama
        // Pen") so the receipt and edit screens need no changes of their own.
        $itemsStmt = $pdo->prepare("SELECT si.*,
                                     CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, ' — ', pv.variant_name) ELSE p.name END AS product_name,
                                     COALESCE(pv.unit, p.unit) AS unit, p.is_service
                                     FROM sale_items si
                                     JOIN products p ON p.id = si.product_id
                                     LEFT JOIN product_variants pv ON pv.id = si.variant_id
                                     WHERE si.transaction_id = ? ORDER BY si.id ASC");
        $itemsStmt->execute([$txn['id']]);
        $txn['items'] = $itemsStmt->fetchAll();

        // Customer change (money the shop owes the customer) - kept on this same sale record:
        // the original amount, every collection so far, what is left, and the status.
        if (change_feature_ready($pdo)) {
            $cStmt = $pdo->prepare('SELECT amount, collected_date, note, recorded_by_name, created_at
                                    FROM sale_change_collections WHERE sale_id = ? ORDER BY id ASC');
            $cStmt->execute([$txn['id']]);
            $collections = $cStmt->fetchAll();
            $txn['change_collections'] = $collections;
            $txn['change_collected'] = array_sum(array_map(fn($c) => (float)$c['amount'], $collections));
            $txn['change_collected_at'] = $collections ? end($collections)['created_at'] : null;
            $txn = decorate_sale_change($txn);
        }

        $txn['items'] = sm_materials_for_sale_items($pdo, $txn['items']);
        respond(true, $txn);
    }

    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['start'])) { $where .= ' AND st.sale_date >= ?'; $params[] = clean($_GET['start']); }
    if (!empty($_GET['end']))   { $where .= ' AND st.sale_date <= ?'; $params[] = clean($_GET['end']); }
    $limit = !empty($_GET['limit']) ? (int)$_GET['limit'] : 100;

    // One row per transaction, with an item summary (comma list of names
    // and a total item/qty count) built alongside it - so the Sales table
    // can show "Notebook, Pen — Obama Pen (3 items)" without a second
    // query per row.
    $changeSelect = change_feature_ready($pdo) ? ', ' . change_select_sql('st') : '';
    $stmt = $pdo->prepare("
        SELECT st.*, u.full_name AS sold_by_name{$changeSelect},
               (SELECT GROUP_CONCAT(CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, ' — ', pv.variant_name) ELSE p.name END SEPARATOR ', ')
                FROM sale_items si JOIN products p ON p.id = si.product_id LEFT JOIN product_variants pv ON pv.id = si.variant_id
                WHERE si.transaction_id = st.id) AS item_names,
               (SELECT COUNT(*) FROM sale_items si WHERE si.transaction_id = st.id) AS item_count,
               (SELECT SUM(si.quantity) FROM sale_items si WHERE si.transaction_id = st.id) AS total_quantity
        FROM sale_transactions st
        JOIN users u ON u.id = st.sold_by
        $where ORDER BY st.sale_date DESC, st.id DESC LIMIT $limit
    ");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    if ($changeSelect !== '') $rows = array_map('decorate_sale_change', $rows);
    respond(true, $rows);
}

if ($method === 'POST') {
    $d = body();

    // ---- Customer collects the change they left on an earlier sale ------------
    // Recorded straight against the ORIGINAL sale: no new sale, no debt. The row it
    // adds is what lets the Cash Audit show the payout on the day it really happened.
    if (($d['action'] ?? '') === 'collect_change') {
        if (!change_feature_ready($pdo)) respond(false, null, change_upgrade_message(), 500);
        $saleId = (int)($d['sale_id'] ?? 0);
        $amount = chg_money($d['amount'] ?? 0);
        if (!$saleId) respond(false, null, 'Sale id is required.', 422);
        if ($amount <= 0) respond(false, null, 'Enter the amount of change being collected.', 422);

        try {
            $pdo->beginTransaction();
            // Lock the sale row so two people cannot collect the same change at the same moment.
            $sStmt = $pdo->prepare('SELECT id, customer_name, sale_date, change_amount FROM sale_transactions WHERE id = ? FOR UPDATE');
            $sStmt->execute([$saleId]);
            $sale = $sStmt->fetch();
            if (!$sale || chg_money($sale['change_amount']) <= 0) {
                $pdo->rollBack();
                respond(false, null, 'This sale has no customer change to collect.', 404);
            }
            $paidStmt = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM sale_change_collections WHERE sale_id = ?');
            $paidStmt->execute([$saleId]);
            $remaining = chg_money((float)$sale['change_amount'] - (float)$paidStmt->fetchColumn());
            if ($remaining <= 0) {
                $pdo->rollBack();
                respond(false, null, 'All of the change on this sale has already been collected.', 422);
            }
            if ($amount > $remaining + 0.009) {
                $pdo->rollBack();
                respond(false, null, 'That is more than the remaining change of TZS ' . number_format($remaining) . '.', 422);
            }

            $collectedDate = today();
            if (!empty($d['collected_date'])) {
                $collectedDate = clean($d['collected_date']);
                if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $collectedDate, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
                    $pdo->rollBack();
                    respond(false, null, 'Invalid collection date.', 422);
                }
            }
            if ($collectedDate > today()) {
                $pdo->rollBack();
                respond(false, null, 'The collection date cannot be in the future.', 422);
            }
            if ($collectedDate < $sale['sale_date']) {
                $pdo->rollBack();
                respond(false, null, 'The collection date cannot be before the sale date (' . $sale['sale_date'] . ').', 422);
            }

            $pdo->prepare('INSERT INTO sale_change_collections (sale_id, amount, collected_date, note, recorded_by, recorded_by_name, created_at)
                           VALUES (?,?,?,?,?,?,NOW())')
                ->execute([$saleId, $amount, $collectedDate, mb_substr(clean($d['note'] ?? ''), 0, 255) ?: null, $user['id'], $user['full_name']]);
            $pdo->commit();
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not record the change collection: ' . $e->getMessage(), 500);
        }

        $left = max(chg_money($remaining - $amount), 0);
        log_activity($pdo, $user, 'payment', 'sale_change', $saleId,
            'Paid back TZS ' . number_format($amount) . ' customer change to ' . ($sale['customer_name'] ?: 'a customer')
            . ' (sale #' . $saleId . '), leaving TZS ' . number_format($left) . ' to collect');

        respond(true, ['change_remaining' => $left, 'change_status' => $left > 0 ? 'partial' : 'collected'],
            $left > 0 ? 'Change collection recorded. TZS ' . number_format($left) . ' still to collect.' : 'All change collected. This sale is now settled.');
    }
    if (empty($d['items']) || !is_array($d['items'])) {
        respond(false, null, 'Add at least one product to the sale.', 422);
    }

    $items = array_map(fn($raw) => prepare_sale_item($pdo, $raw), $d['items']);
    $totalAmount = round(array_sum(array_column($items, 'subtotal')), 2);
    $totalProfit = round(array_sum(array_column($items, 'profit')), 2);
    $saleDate = !empty($d['sale_date']) ? clean($d['sale_date']) : today();

    $paymentMethod = (!empty($d['payment_method']) && $d['payment_method'] === 'credit') ? 'credit' : 'cash';
    $cashType = null; $onlineMethod = null; $creditDeadline = null;
    $customerName = trim($d['customer_name'] ?? '');
    $customerPhone = trim($d['customer_phone'] ?? '');

    if ($paymentMethod === 'cash') {
        $cashType = (!empty($d['cash_type']) && $d['cash_type'] === 'online') ? 'online' : 'cash_in_hand';
        if ($cashType === 'online') $onlineMethod = clean($d['online_method'] ?? '');
    } else {
        if (empty($d['credit_deadline'])) respond(false, null, 'Please set a deadline date for this credit (madeni) sale.', 422);
        if ($customerName === '') respond(false, null, 'Please enter the customer\'s name for a credit sale.', 422);
        if ($customerPhone === '') respond(false, null, 'Please enter the customer\'s phone number for a credit sale.', 422);
        $creditDeadline = clean($d['credit_deadline']);
    }

    // Customer change left behind (money the shop owes the customer). Only for cash-in-hand sales.
    $changeAmount = chg_money($d['change_amount'] ?? 0);
    if ($changeAmount < 0) respond(false, null, 'Customer change cannot be negative.', 422);
    if ($changeAmount > 0) {
        if (!change_feature_ready($pdo)) respond(false, null, change_upgrade_message(), 500);
        if ($paymentMethod !== 'cash' || $cashType !== 'cash_in_hand') {
            respond(false, null, 'Customer change can only be recorded on a cash-in-hand sale.', 422);
        }
        if ($customerName === '') respond(false, null, 'Please enter the customer\'s name so the change can be given to the right person.', 422);
    }

    // Customer details are optional for cash sales, but if EITHER was
    // given, resolve/create the customer record. Neither given -> no
    // customer record at all (see resolve_customer()).
    $customerId = ($customerName !== '' || $customerPhone !== '') ? resolve_customer($pdo, $customerName, $customerPhone) : null;

    if ($paymentMethod === 'credit') {
        block_if_credit_restricted($pdo, $customerId); // exits with a clear error if blocked
    }

    try {
        $pdo->beginTransaction();

        // Products used by services must be in stock (checked together with any
        // direct sale of the same product in this cart, and locked until we commit).
        $stockError = sm_lock_and_check_stock($pdo, $items);
        if ($stockError) { $pdo->rollBack(); respond(false, null, $stockError, 422); }

        $ins = $pdo->prepare('INSERT INTO sale_transactions
            (customer_id, customer_name, customer_phone, payment_method, cash_type, online_method, credit_deadline, total_amount, total_profit, note, sold_by, sale_date, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())');
        $ins->execute([
            $customerId, $customerName !== '' ? $customerName : null, $customerPhone !== '' ? $customerPhone : null,
            $paymentMethod, $cashType, $onlineMethod, $creditDeadline,
            $totalAmount, $totalProfit, clean($d['note'] ?? ''), $user['id'], $saleDate,
        ]);
        $txnId = $pdo->lastInsertId();
        if ($changeAmount > 0) {
            $pdo->prepare('UPDATE sale_transactions SET change_amount = ? WHERE id = ?')->execute([$changeAmount, $txnId]);
        }

        $itemIns = $pdo->prepare('INSERT INTO sale_items (transaction_id, product_id, variant_id, quantity, unit_price, buying_price, subtotal, profit) VALUES (?,?,?,?,?,?,?,?)');
        foreach ($items as $item) {
            $itemIns->execute([$txnId, $item['product_id'], $item['variant_id'], $item['quantity'], $item['unit_price'], $item['buying_price'], $item['subtotal'], $item['profit']]);
            if ($item['product']['is_service']) {
                // Take the products used out of stock + keep a cost snapshot.
                sm_deduct_and_record($pdo, (int)$pdo->lastInsertId(), $item['materials']);
            }
            if (!$item['product']['is_service']) {
                if ($item['variant_id']) {
                    $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?')->execute([$item['quantity'], $item['variant_id']]);
                } else {
                    $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?')->execute([$item['quantity'], $item['product_id']]);
                }
            }
        }

        $pdo->commit();
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not record sale: ' . $e->getMessage(), 500);
    }

    if ($paymentMethod === 'credit') refresh_customer_restriction($pdo, $customerId);

    $itemSummary = count($items) === 1
        ? '1 ' . $items[0]['unit'] . ' x "' . $items[0]['label'] . '"'
        : count($items) . ' item(s) (' . implode(', ', array_map(fn($i) => $i['label'], $items)) . ')';
    log_activity($pdo, $user, 'create', 'sale', $txnId,
        'Recorded a ' . $paymentMethod . ' sale: ' . $itemSummary . ' for TZS ' . number_format($totalAmount)
        . ($customerName !== '' ? ' to ' . $customerName : '')
        . ($changeAmount > 0 ? ', customer left TZS ' . number_format($changeAmount) . ' change' : ''));

    respond(true, ['id' => $txnId, 'total_amount' => $totalAmount, 'profit' => $totalProfit, 'change_amount' => $changeAmount], 'Sale recorded successfully.');
}

if ($method === 'PUT') {
    require_role(['admin', 'worker']);
    $d = body();
    if (empty($d['id'])) respond(false, null, 'Sale id is required.', 422);
    if (empty($d['items']) || !is_array($d['items'])) respond(false, null, 'A sale needs at least one item.', 422);

    $txnId = (int)$d['id'];
    $stmt = $pdo->prepare('SELECT * FROM sale_transactions WHERE id = ?');
    $stmt->execute([$txnId]);
    $existing = $stmt->fetch();
    if (!$existing) respond(false, null, 'Sale not found.', 404);

    $oldItemsStmt = $pdo->prepare('SELECT * FROM sale_items WHERE transaction_id = ?');
    $oldItemsStmt->execute([$txnId]);
    $oldItems = $oldItemsStmt->fetchAll();

    $items = array_map(fn($raw) => prepare_sale_item($pdo, $raw), $d['items']);
    $totalAmount = round(array_sum(array_column($items, 'subtotal')), 2);
    $totalProfit = round(array_sum(array_column($items, 'profit')), 2);

    $paymentMethod = isset($d['payment_method']) && $d['payment_method'] === 'credit' ? 'credit' : (isset($d['payment_method']) ? 'cash' : $existing['payment_method']);
    $cashType = $existing['cash_type']; $onlineMethod = $existing['online_method']; $creditDeadline = $existing['credit_deadline'];
    if (isset($d['payment_method'])) {
        if ($paymentMethod === 'cash') {
            $cashType = (!empty($d['cash_type']) && $d['cash_type'] === 'online') ? 'online' : 'cash_in_hand';
            $onlineMethod = $cashType === 'online' ? clean($d['online_method'] ?? '') : null;
            $creditDeadline = null;
        } else {
            $creditDeadline = !empty($d['credit_deadline']) ? clean($d['credit_deadline']) : $existing['credit_deadline'];
            $cashType = null; $onlineMethod = null;
        }
    }
    $customerName = trim($d['customer_name'] ?? $existing['customer_name'] ?? '');
    $customerPhone = trim($d['customer_phone'] ?? $existing['customer_phone'] ?? '');
    $customerId = ($customerName !== '' || $customerPhone !== '') ? resolve_customer($pdo, $customerName, $customerPhone) : $existing['customer_id'];

    // Customer change on this sale. If the edit screen did not send it, the current amount is kept.
    // It can never drop below what has already been handed back, and it only belongs on cash-in-hand sales.
    $existingChange = change_feature_ready($pdo) ? chg_money($existing['change_amount'] ?? 0) : 0.0;
    $changeAmount = array_key_exists('change_amount', $d) ? chg_money($d['change_amount']) : $existingChange;
    if ($changeAmount < 0) respond(false, null, 'Customer change cannot be negative.', 422);
    $changeCollected = 0.0;
    if (change_feature_ready($pdo)) {
        $cs = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) AS paid, MIN(collected_date) AS first_date FROM sale_change_collections WHERE sale_id = ?');
        $cs->execute([$txnId]);
        $csRow = $cs->fetch();
        $changeCollected = chg_money($csRow['paid'] ?? 0);
        $saleDateNew = !empty($d['sale_date']) ? clean($d['sale_date']) : $existing['sale_date'];
        if ($changeCollected > 0 && !empty($csRow['first_date']) && $saleDateNew > $csRow['first_date']) {
            respond(false, null, 'The sale date cannot be later than ' . $csRow['first_date'] . ', when its customer change was first collected.', 422);
        }
    }
    if ($changeAmount > 0 || $changeCollected > 0) {
        if ($changeAmount + 0.009 < $changeCollected) {
            respond(false, null, 'Customer change cannot be lower than the TZS ' . number_format($changeCollected) . ' already collected on this sale.', 422);
        }
        if ($paymentMethod !== 'cash' || $cashType !== 'cash_in_hand') {
            respond(false, null, 'Customer change can only be on a cash-in-hand sale. Remove or settle the customer change first.', 422);
        }
    }
    if ($changeAmount > 0) {
        if (!change_feature_ready($pdo)) respond(false, null, change_upgrade_message(), 500);
        if ($customerName === '') respond(false, null, 'Please enter the customer\'s name so the change can be given to the right person.', 422);
    }

    try {
        $pdo->beginTransaction();

        // Restore stock for every old item, then delete them.
        //
        // NOTE - fixed a pre-existing bug here: the old code checked
        // `if (!$p->fetchColumn())` against the product's `is_service`
        // value to detect "product deleted since". Since is_service is 0
        // for a normal product, and the string "0" is falsy in PHP, that
        // check skipped the stock restore for every real product, every
        // time a sale was edited - old stock was never given back before
        // the new items were deducted. Checking `id` instead (never 0)
        // fixes it. This is unrelated to the types/variants feature but
        // was directly in the code being changed here.
        foreach ($oldItems as $old) {
            if (!empty($old['variant_id'])) {
                $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$old['quantity'], $old['variant_id']]);
            } else {
                $p = $pdo->prepare('SELECT id FROM products WHERE id = ?');
                $p->execute([$old['product_id']]);
                if (!$p->fetchColumn()) continue; // product deleted since - nothing to restore
                $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$old['quantity'], $old['product_id']]);
            }
        }
        // Give back the products the old service lines used (must run before the rows are deleted).
        sm_restore_for_items($pdo, array_column($oldItems, 'id'));
        $pdo->prepare('DELETE FROM sale_items WHERE transaction_id = ?')->execute([$txnId]);

        // Now that stock is restored, make sure the edited sale can still be served.
        $stockError = sm_lock_and_check_stock($pdo, $items);
        if ($stockError) { $pdo->rollBack(); respond(false, null, $stockError, 422); }

        // Insert the new item set and deduct their stock.
        $itemIns = $pdo->prepare('INSERT INTO sale_items (transaction_id, product_id, variant_id, quantity, unit_price, buying_price, subtotal, profit) VALUES (?,?,?,?,?,?,?,?)');
        foreach ($items as $item) {
            $itemIns->execute([$txnId, $item['product_id'], $item['variant_id'], $item['quantity'], $item['unit_price'], $item['buying_price'], $item['subtotal'], $item['profit']]);
            if ($item['product']['is_service']) {
                // Take the products used out of stock + keep a cost snapshot.
                sm_deduct_and_record($pdo, (int)$pdo->lastInsertId(), $item['materials']);
            }
            if (!$item['product']['is_service']) {
                if ($item['variant_id']) {
                    $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?')->execute([$item['quantity'], $item['variant_id']]);
                } else {
                    $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?')->execute([$item['quantity'], $item['product_id']]);
                }
            }
        }

        $pdo->prepare('UPDATE sale_transactions SET customer_id=?, customer_name=?, customer_phone=?, payment_method=?, cash_type=?, online_method=?, credit_deadline=?, total_amount=?, total_profit=?, sale_date=? WHERE id=?')
            ->execute([
                $customerId, $customerName !== '' ? $customerName : null, $customerPhone !== '' ? $customerPhone : null,
                $paymentMethod, $cashType, $onlineMethod, $creditDeadline, $totalAmount, $totalProfit,
                !empty($d['sale_date']) ? clean($d['sale_date']) : $existing['sale_date'], $txnId,
            ]);
        if (change_feature_ready($pdo) && $changeAmount != $existingChange) {
            $pdo->prepare('UPDATE sale_transactions SET change_amount = ? WHERE id = ?')->execute([$changeAmount, $txnId]);
        }

        $pdo->commit();

        if ($paymentMethod === 'credit') refresh_customer_restriction($pdo, $customerId);

        $changes = [];
        if ((float)$existing['total_amount'] != $totalAmount) $changes[] = 'total ' . audit_money_diff($existing['total_amount'], $totalAmount);
        if ($existing['payment_method'] !== $paymentMethod) $changes[] = 'payment ' . $existing['payment_method'] . ' to ' . $paymentMethod;
        if (count($oldItems) !== count($items)) $changes[] = 'items ' . count($oldItems) . ' to ' . count($items);
        if ($changeAmount != $existingChange) $changes[] = 'customer change ' . audit_money_diff($existingChange, $changeAmount);
        log_activity($pdo, $user, 'update', 'sale', $txnId, 'Edited sale #' . $txnId . ($changes ? ': ' . implode(', ', $changes) : ' (no changes)'));
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        respond(false, null, 'Could not update sale: ' . $e->getMessage(), 500);
    }

    respond(true, ['total_amount' => $totalAmount, 'profit' => $totalProfit], 'Sale updated successfully.');
}

if ($method === 'DELETE') {
    require_role(['admin', 'worker']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Sale id is required.', 422);

    $stmt = $pdo->prepare('SELECT * FROM sale_transactions WHERE id = ?');
    $stmt->execute([$id]);
    $txn = $stmt->fetch();
    if (!$txn) respond(false, null, 'Sale not found.', 404);

    $itemsStmt = $pdo->prepare("SELECT si.*,
                                 CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, ' — ', pv.variant_name) ELSE p.name END AS name,
                                 p.is_service
                                 FROM sale_items si
                                 JOIN products p ON p.id = si.product_id
                                 LEFT JOIN product_variants pv ON pv.id = si.variant_id
                                 WHERE si.transaction_id = ?");
    $itemsStmt->execute([$id]);
    $items = $itemsStmt->fetchAll();

    // A sale that still owes the customer change cannot simply disappear - the shop would lose track of that money.
    if (change_feature_ready($pdo) && chg_money($txn['change_amount'] ?? 0) > 0) {
        $paidStmt = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM sale_change_collections WHERE sale_id = ?');
        $paidStmt->execute([$id]);
        $owed = chg_money((float)$txn['change_amount'] - (float)$paidStmt->fetchColumn());
        if ($owed > 0) {
            respond(false, null, 'This sale still has TZS ' . number_format($owed) . ' of customer change to collect. Record the change as collected before deleting it.', 422);
        }
    }

    $pdo->beginTransaction();
    sm_restore_for_items($pdo, array_column($items, 'id')); // products used by service lines go back to stock
    foreach ($items as $item) {
        if (!$item['is_service']) {
            if (!empty($item['variant_id'])) {
                $pdo->prepare('UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$item['quantity'], $item['variant_id']]);
            } else {
                $pdo->prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?')->execute([$item['quantity'], $item['product_id']]);
            }
        }
    }
    $pdo->prepare('DELETE FROM sale_transactions WHERE id = ?')->execute([$id]); // cascades to sale_items and debt_payments
    $pdo->commit();

    $itemSummary = count($items) === 1 ? $items[0]['name'] : count($items) . ' item(s)';
    log_activity($pdo, $user, 'delete', 'sale', $id,
        'Deleted sale #' . $id . ': ' . $itemSummary . ' for TZS ' . number_format($txn['total_amount'])
        . ', sold on ' . $txn['sale_date'] . (!empty($txn['customer_name']) ? ' to ' . $txn['customer_name'] : ''));

    respond(true, null, 'Sale removed and stock restored.');
}

respond(false, null, 'Unsupported method.', 405);
