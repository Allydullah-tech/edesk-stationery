<?php
/**
 * EDESK STATIONERY - Users API (Admin only)
 * GET    -> list all users
 * POST   -> add new admin or worker
 * PUT    -> update a user (name, role, status) - not password
 * DELETE -> remove a user ?id=
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';

$admin = require_role(['admin']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $stmt = $pdo->query('SELECT id, full_name, username, role, status, created_at FROM users ORDER BY created_at DESC');
    respond(true, $stmt->fetchAll());
}

if ($method === 'POST') {
    $d = body();
    $missing = missing_fields($d, ['full_name', 'username', 'password', 'role', 'security_question', 'security_answer']);
    if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);

    if (!in_array($d['role'], ['admin', 'worker'], true)) respond(false, null, 'Role must be admin or worker.', 422);
    if (strlen($d['password']) < 6) respond(false, null, 'Password must be at least 6 characters.', 422);

    $check = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ?');
    $check->execute([clean($d['username'])]);
    if ($check->fetchColumn() > 0) respond(false, null, 'That username is already taken.', 409);

    $stmt = $pdo->prepare('INSERT INTO users (full_name, username, password_hash, role, security_question, security_answer_hash, status, created_by, created_at, updated_at)
                            VALUES (?,?,?,?,?,?,"active",?,NOW(),NOW())');
    $stmt->execute([
        clean($d['full_name']),
        clean($d['username']),
        password_hash($d['password'], PASSWORD_DEFAULT),
        clean($d['role']),
        clean($d['security_question']),
        password_hash(strtolower(trim($d['security_answer'])), PASSWORD_DEFAULT),
        $admin['id'],
    ]);
    $newId = $pdo->lastInsertId();
    log_activity($pdo, $admin, 'create', 'user', $newId, 'Created ' . $d['role'] . ' account: "' . clean($d['full_name']) . '" (username: ' . clean($d['username']) . ')');
    respond(true, ['id' => $newId], ucfirst($d['role']) . ' account created successfully.');
}

if ($method === 'PUT') {
    $d = body();
    if (empty($d['id'])) respond(false, null, 'User id is required.', 422);
    $targetId = (int)$d['id'];

    $existingStmt = $pdo->prepare('SELECT full_name, role, status FROM users WHERE id = ?');
    $existingStmt->execute([$targetId]);
    $existingUser = $existingStmt->fetch();
    if (!$existingUser) respond(false, null, 'User not found.', 404);

    if ($targetId === (int)$admin['id'] && isset($d['status']) && $d['status'] !== 'active') {
        respond(false, null, 'You cannot disable your own account.', 422);
    }

    $fields = [];
    $params = [];
    if (isset($d['full_name'])) { $fields[] = 'full_name = ?'; $params[] = clean($d['full_name']); }
    if (isset($d['role']) && in_array($d['role'], ['admin', 'worker'], true)) { $fields[] = 'role = ?'; $params[] = $d['role']; }
    if (isset($d['status']) && in_array($d['status'], ['active', 'disabled'], true)) { $fields[] = 'status = ?'; $params[] = $d['status']; }
    if (!empty($d['password'])) {
        if (strlen($d['password']) < 6) respond(false, null, 'Password must be at least 6 characters.', 422);
        $fields[] = 'password_hash = ?'; $params[] = password_hash($d['password'], PASSWORD_DEFAULT);
    }
    if (empty($fields)) respond(false, null, 'Nothing to update.', 422);

    $fields[] = 'updated_at = NOW()';
    $params[] = $targetId;
    $pdo->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);

    $changes = [];
    if (isset($d['role']) && $d['role'] !== $existingUser['role']) $changes[] = 'role ' . $existingUser['role'] . ' to ' . $d['role'];
    if (isset($d['status']) && $d['status'] !== $existingUser['status']) $changes[] = 'status ' . $existingUser['status'] . ' to ' . $d['status'];
    if (!empty($d['password'])) $changes[] = 'password reset';
    log_activity($pdo, $admin, 'update', 'user', $targetId,
        'Edited user "' . $existingUser['full_name'] . '"' . ($changes ? ': ' . implode(', ', $changes) : ' (no role/status changes)'));

    respond(true, null, 'User updated successfully.');
}

if ($method === 'DELETE') {
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'User id is required.', 422);
    if ($id === (int)$admin['id']) respond(false, null, 'You cannot delete your own account.', 422);
    $lookup = $pdo->prepare('SELECT full_name, role FROM users WHERE id = ?');
    $lookup->execute([$id]);
    $row = $lookup->fetch();
    $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    if ($row) {
        log_activity($pdo, $admin, 'delete', 'user', $id, 'Deleted ' . $row['role'] . ' account: "' . $row['full_name'] . '"');
    }
    respond(true, null, 'User removed.');
}

respond(false, null, 'Unsupported method.', 405);
