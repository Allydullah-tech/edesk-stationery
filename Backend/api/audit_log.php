<?php
/**
 * eDESK Print & Digital - Activity / Audit Log API (read-only)
 * GET -> list log entries, most recent first.
 *        Filters: ?start=&end= (date range on created_at),
 *                 ?user_id=, ?entity_type=, ?action=,
 *                 ?q= free-text search (user name, description, module, action)
 * Admin only - this is precisely the kind of record a worker should
 * not be able to browse or, worse, clear.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';

require_role(['admin']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    respond(false, null, 'Unsupported method.', 405);
}

$where = 'WHERE 1=1';
$params = [];

if (!empty($_GET['start'])) { $where .= ' AND DATE(created_at) >= ?'; $params[] = clean($_GET['start']); }
if (!empty($_GET['end']))   { $where .= ' AND DATE(created_at) <= ?'; $params[] = clean($_GET['end']); }
if (!empty($_GET['user_id'])) { $where .= ' AND user_id = ?'; $params[] = (int)$_GET['user_id']; }
if (!empty($_GET['entity_type'])) { $where .= ' AND entity_type = ?'; $params[] = clean($_GET['entity_type']); }
if (!empty($_GET['action'])) { $where .= ' AND action = ?'; $params[] = clean($_GET['action']); }
if (!empty($_GET['q'])) {
    // Free-text search across everything a user would plausibly type:
    // who did it, what it says, or the module name itself.
    $where .= ' AND (user_name LIKE ? OR description LIKE ? OR entity_type LIKE ? OR action LIKE ?)';
    $q = '%' . clean($_GET['q']) . '%';
    array_push($params, $q, $q, $q, $q);
}

$limit = !empty($_GET['limit']) ? min((int)$_GET['limit'], 1000) : 200;

try {
    $stmt = $pdo->prepare("SELECT * FROM audit_log $where ORDER BY created_at DESC, id DESC LIMIT $limit");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
} catch (PDOException $e) {
    respond(false, null, 'The activity log is not set up yet. Please run Backend/upgrade_v3_features.php once, then reload this page.', 500);
}

// Distinct users seen in the log, for the filter dropdown - cheaper and
// simpler than a second endpoint, and it's the exact list this page needs.
$usersStmt = $pdo->query('SELECT DISTINCT user_id, user_name FROM audit_log WHERE user_id IS NOT NULL ORDER BY user_name ASC');
$users = $usersStmt->fetchAll();

respond(true, ['entries' => $rows, 'users' => $users]);
