<?php
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $where = 'WHERE 1=1';
    $params = [];
    if (!empty($_GET['start'])) { $where .= ' AND e.expense_date >= ?'; $params[] = clean($_GET['start']); }
    if (!empty($_GET['end']))   { $where .= ' AND e.expense_date <= ?'; $params[] = clean($_GET['end']); }
    $limit = !empty($_GET['limit']) ? (int)$_GET['limit'] : 100;

    $stmt = $pdo->prepare("SELECT e.*, u.full_name AS recorded_by_name FROM expenses e
                            JOIN users u ON u.id = e.recorded_by
                            $where ORDER BY e.expense_date DESC, e.id DESC LIMIT $limit");
    $stmt->execute($params);
    respond(true, $stmt->fetchAll());
}

if ($method === 'POST') {
    $d = body();
    $missing = missing_fields($d, ['title', 'amount']);
    if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);
    if ((float)$d['amount'] <= 0) respond(false, null, 'Enter a valid amount.', 422);

    $stmt = $pdo->prepare('INSERT INTO expenses (title, category, amount, note, recorded_by, expense_date, created_at)
                            VALUES (?,?,?,?,?,?,NOW())');
    $stmt->execute([
        clean($d['title']),
        clean($d['category'] ?? 'General'),
        (float)$d['amount'],
        clean($d['note'] ?? ''),
        $user['id'],
        !empty($d['expense_date']) ? clean($d['expense_date']) : today(),
    ]);
    $newId = $pdo->lastInsertId();
    log_activity($pdo, $user, 'create', 'expense', $newId, 'Recorded expense: "' . clean($d['title']) . '" - TZS ' . number_format((float)$d['amount']));
    respond(true, ['id' => $newId], 'Expense recorded successfully.');
}

if ($method === 'PUT') {
    require_role(['admin', 'worker']);
    $d = body();
    if (empty($d['id'])) respond(false, null, 'Expense id is required.', 422);
    $missing = missing_fields($d, ['title', 'amount']);
    if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);
    if ((float)$d['amount'] <= 0) respond(false, null, 'Enter a valid amount.', 422);

    $existingStmt = $pdo->prepare('SELECT * FROM expenses WHERE id = ?');
    $existingStmt->execute([(int)$d['id']]);
    $existing = $existingStmt->fetch();
    if (!$existing) respond(false, null, 'Expense not found.', 404);

    $newTitle = clean($d['title']);
    $newCategory = clean($d['category'] ?? 'General');
    $newAmount = (float)$d['amount'];
    $newNote = clean($d['note'] ?? '');
    $newDate = !empty($d['expense_date']) ? clean($d['expense_date']) : $existing['expense_date'];

    $pdo->prepare('UPDATE expenses SET title = ?, category = ?, amount = ?, note = ?, expense_date = ? WHERE id = ?')
        ->execute([$newTitle, $newCategory, $newAmount, $newNote, $newDate, $existing['id']]);

    $changes = [];
    if ($existing['title'] !== $newTitle) $changes[] = 'title "' . $existing['title'] . '" to "' . $newTitle . '"';
    if ((float)$existing['amount'] != $newAmount) $changes[] = 'amount ' . audit_money_diff($existing['amount'], $newAmount);
    if ($existing['category'] !== $newCategory) $changes[] = 'category "' . $existing['category'] . '" to "' . $newCategory . '"';
    if ($existing['expense_date'] !== $newDate) $changes[] = 'date ' . $existing['expense_date'] . ' to ' . $newDate;

    log_activity($pdo, $user, 'update', 'expense', $existing['id'],
        'Edited expense "' . $existing['title'] . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no changes)'));

    respond(true, null, 'Expense updated successfully.');
}

if ($method === 'DELETE') {
    require_role(['admin', 'worker']);
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'Expense id is required.', 422);
    $lookup = $pdo->prepare('SELECT title, amount FROM expenses WHERE id = ?');
    $lookup->execute([$id]);
    $row = $lookup->fetch();
    $pdo->prepare('DELETE FROM expenses WHERE id = ?')->execute([$id]);
    if ($row) {
        log_activity($pdo, $user, 'delete', 'expense', $id, 'Deleted expense: "' . $row['title'] . '" - TZS ' . number_format($row['amount']));
    }
    respond(true, null, 'Expense removed.');
}

respond(false, null, 'Unsupported method.', 405);
