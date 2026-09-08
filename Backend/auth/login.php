<?php
/**
 * EDESK STATIONERY - Login
 * POST { username, password }
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(false, null, 'Invalid request method.', 405);

$data = body();
$missing = missing_fields($data, ['username', 'password']);
if ($missing) respond(false, null, 'Please provide username and password.', 422);

$pdo = get_db();
$stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
$stmt->execute([clean($data['username'])]);
$user = $stmt->fetch();

if (!$user || !password_verify($data['password'], $user['password_hash'])) {
    respond(false, null, 'Incorrect username or password.', 401);
}

if ($user['status'] !== 'active') {
    respond(false, null, 'Your account has been disabled. Contact your administrator.', 403);
}

$_SESSION['user_id'] = $user['id'];
$_SESSION['role'] = $user['role'];

log_activity($pdo, $user, 'login', 'login', null, $user['full_name'] . ' logged in');

respond(true, [
    'id' => $user['id'],
    'full_name' => $user['full_name'],
    'username' => $user['username'],
    'role' => $user['role'],
], 'Welcome back, ' . $user['full_name'] . '.');
