<?php
/**
 * EDESK STATIONERY - Opening cash / float
 *
 * Any logged-in user (admin or worker) can set the opening cash for a
 * date and add to / reduce the float during the day. Each action is its
 * own record, stamped with who did it (from the session) and when, so
 * the full history can be reviewed with date filtering.
 *
 * GET ?date=YYYY-MM-DD   -> that day's summary (opening, added, reduced, current float, entries)
 * GET ?start=&end=&type=&saved_by=&q=  -> history list
 * POST                   -> record an entry {float_date, entry_type: opening|add|reduce, amount, note}
 * DELETE ?id=            -> admin only
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/float_helper.php';

$user = require_role(['admin', 'worker']);
$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

function valid_date_string($s): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', (string)$s, $m)) return false;
    return checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

try {
    if ($method === 'GET') {
        // ---- One day's summary ----
        if (!empty($_GET['date'])) {
            $date = clean($_GET['date']);
            if (!valid_date_string($date)) respond(false, null, 'Invalid date.', 422);
            respond(true, get_float_summary($pdo, $date));
        }

        // ---- History list, with time filtration ----
        $where = 'WHERE 1=1';
        $params = [];
        if (!empty($_GET['start'])) { $where .= ' AND f.float_date >= ?'; $params[] = clean($_GET['start']); }
        if (!empty($_GET['end']))   { $where .= ' AND f.float_date <= ?'; $params[] = clean($_GET['end']); }
        if (!empty($_GET['type']) && in_array($_GET['type'], ['opening', 'add', 'reduce'], true)) {
            $where .= ' AND f.entry_type = ?';
            $params[] = $_GET['type'];
        }
        if (!empty($_GET['saved_by'])) { $where .= ' AND f.saved_by = ?'; $params[] = (int)$_GET['saved_by']; }
        if (!empty($_GET['q'])) {
            $where .= ' AND (f.note LIKE ? OR f.saved_by_name LIKE ?)';
            $q = '%' . clean($_GET['q']) . '%';
            array_push($params, $q, $q);
        }
        $limit = !empty($_GET['limit']) ? min((int)$_GET['limit'], 1000) : 200;

        $stmt = $pdo->prepare("SELECT f.id, f.float_date, f.entry_type, f.amount, f.note,
                                      f.saved_by, f.saved_by_name, f.saved_by_role, f.created_at,
                                      (f.entry_type = 'opening' AND f.id < (
                                          SELECT MAX(f2.id) FROM cash_floats f2
                                          WHERE f2.float_date = f.float_date AND f2.entry_type = 'opening'
                                      )) AS superseded
                               FROM cash_floats f
                               $where
                               ORDER BY f.float_date DESC, f.id DESC
                               LIMIT $limit");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) { $r['superseded'] = (bool)$r['superseded']; }
        unset($r);

        $savers = $pdo->query('SELECT DISTINCT saved_by AS id, saved_by_name AS name FROM cash_floats
                               WHERE saved_by IS NOT NULL ORDER BY saved_by_name ASC')->fetchAll();

        respond(true, ['entries' => $rows, 'savers' => $savers]);
    }

    if ($method === 'POST') {
        $d = body();

        $type = $d['entry_type'] ?? '';
        if (!in_array($type, ['opening', 'add', 'reduce'], true)) {
            respond(false, null, 'Choose whether this is the opening cash, an increase or a reduction.', 422);
        }

        $date = clean($d['float_date'] ?? '');
        if (!valid_date_string($date)) respond(false, null, 'Please choose a valid date.', 422);

        if (!isset($d['amount']) || !is_numeric($d['amount'])) {
            respond(false, null, 'Please enter a valid amount.', 422);
        }
        $amount = round((float)$d['amount'], 2);
        if ($amount < 0 || $amount > 999999999999) respond(false, null, 'That amount is not valid.', 422);
        if ($type !== 'opening' && $amount <= 0) respond(false, null, 'The amount must be more than zero.', 422);

        if ($type === 'reduce') {
            $current = get_float_summary($pdo, $date)['total'];
            if ($amount > $current) {
                respond(false, null, 'You cannot reduce the float by more than what it is now (TZS '
                    . number_format($current) . ').', 422);
            }
        }

        $note = mb_substr(clean($d['note'] ?? ''), 0, 255);

        $stmt = $pdo->prepare('INSERT INTO cash_floats
            (float_date, entry_type, amount, note, saved_by, saved_by_name, saved_by_role, created_at)
            VALUES (?,?,?,?,?,?,?,NOW())');
        $stmt->execute([$date, $type, $amount, $note, $user['id'], $user['full_name'], $user['role']]);
        $newId = $pdo->lastInsertId();

        $labels = ['opening' => 'Set opening cash', 'add' => 'Added to float', 'reduce' => 'Reduced float'];
        log_activity($pdo, $user, 'create', 'cash_float', $newId,
            $labels[$type] . ' for ' . $date . ': TZS ' . number_format($amount) . ($note !== '' ? ' (' . $note . ')' : ''));

        $messages = ['opening' => 'Opening cash saved.', 'add' => 'Float increased.', 'reduce' => 'Float reduced.'];
        respond(true, get_float_summary($pdo, $date), $messages[$type]);
    }

    if ($method === 'DELETE') {
        // Admin-only, so the record of the float can't be quietly erased.
        require_role(['admin']);
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) respond(false, null, 'Record id is required.', 422);

        $lookup = $pdo->prepare('SELECT float_date, entry_type, amount FROM cash_floats WHERE id = ?');
        $lookup->execute([$id]);
        $row = $lookup->fetch();
        $pdo->prepare('DELETE FROM cash_floats WHERE id = ?')->execute([$id]);
        if ($row) {
            log_activity($pdo, $user, 'delete', 'cash_float', $id,
                'Deleted float record (' . $row['entry_type'] . ', TZS ' . number_format((float)$row['amount'])
                . ') for ' . $row['float_date']);
        }
        respond(true, null, 'Record removed.');
    }

    respond(false, null, 'Unsupported method.', 405);
} catch (PDOException $e) {
    if ($e->getCode() === '42S02') { // table doesn't exist yet
        respond(false, null, 'Opening cash is not set up yet. Please run Backend/upgrade_add_cash_float.php once, then try again.', 500);
    }
    throw $e;
}
