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
 * POST {action:'restore', id}  -> bring a deleted entry back
 * PUT ?id= {amount, note}  -> correct the amount / note of an entry (its date and type stay as recorded)
 * DELETE ?id=            -> delete an entry (soft delete: it stays in history and can be restored)
 *
 * Who may edit / delete / restore: an admin can do it for any record. A worker can only do it for a record
 * they saved themselves, dated today (and restore only what they deleted themselves).
 * Every delete and restore is written to the activity log. Nothing is ever erased from the table.
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

/** May this user delete / restore this float record? (the server is the authority; the screen only mirrors it) */
function float_can_manage(array $user, array $row, bool $restoring = false): bool
{
    if (($user['role'] ?? '') === 'admin') return true;
    if ((int)($row['saved_by'] ?? 0) !== (int)$user['id']) return false;
    if (($row['float_date'] ?? '') !== date('Y-m-d')) return false;
    if ($restoring && (int)($row['deleted_by'] ?? 0) !== (int)$user['id']) return false;
    return true;
}

/** A day's summary, with a can_delete flag on every entry for the current user. */
function float_summary_for(PDO $pdo, string $date, array $user): array
{
    $s = get_float_summary($pdo, $date);
    foreach ($s['entries'] as &$e) {
        $mine = float_can_manage($user, $e + ['float_date' => $date]);
        $e['can_delete'] = float_soft_delete_ready($pdo) && $mine;
        $e['can_edit'] = $mine;
    }
    unset($e);
    return $s;
}

/**
 * Soft-deletes ($restore = false) or restores ($restore = true) one float record, re-checks that the day's
 * float does not go below zero because of it, writes the activity log and answers the request.
 */
function float_change_state(PDO $pdo, array $user, int $id, bool $restore): void
{
    if (!$id) respond(false, null, 'Record id is required.', 422);
    if (!float_soft_delete_ready($pdo)) {
        respond(false, null, 'Delete and restore are not set up yet. Please run Backend/upgrade_v13_float_soft_delete.php once, then try again.', 500);
    }

    $pdo->beginTransaction();
    try {
        $q = $pdo->prepare('SELECT * FROM cash_floats WHERE id = ? FOR UPDATE');
        $q->execute([$id]);
        $row = $q->fetch();

        if (!$row) { $pdo->rollBack(); respond(false, null, 'That record no longer exists.', 404); }
        $isDeleted = !empty($row['deleted_at']);
        if (!$restore && $isDeleted)  { $pdo->rollBack(); respond(false, null, 'This record is already deleted.', 409); }
        if ($restore && !$isDeleted)  { $pdo->rollBack(); respond(false, null, 'This record is not deleted.', 409); }
        if (!float_can_manage($user, $row, $restore)) {
            $pdo->rollBack();
            respond(false, null, ($user['role'] ?? '') === 'admin'
                ? 'You are not allowed to do this.'
                : 'You can only ' . ($restore ? 'restore records you deleted yourself' : 'delete records you saved yourself')
                  . ', and only for today. Please ask an admin.', 403);
        }

        if ($restore) {
            $pdo->prepare('UPDATE cash_floats SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = \'\',
                           restored_at = NOW(), restored_by_name = ? WHERE id = ? AND deleted_at IS NOT NULL')
                ->execute([$user['full_name'], $id]);
        } else {
            $pdo->prepare('UPDATE cash_floats SET deleted_at = NOW(), deleted_by = ?, deleted_by_name = ?,
                           restored_at = NULL, restored_by_name = \'\' WHERE id = ? AND deleted_at IS NULL')
                ->execute([$user['id'], $user['full_name'], $id]);
        }

        // Recalculate the day. The float may never be left below zero by this change.
        $summary = get_float_summary($pdo, $row['float_date']);
        if ($summary['total'] < -0.004) {
            $pdo->rollBack();
            respond(false, null, ($restore
                ? 'This record cannot be restored because the float for that day would go below zero (TZS '
                : 'This record cannot be deleted because the float for that day would go below zero (TZS ')
                . number_format($summary['total']) . '). Delete or restore the related records in the right order.', 422);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $labels = ['opening' => 'opening cash', 'add' => 'addition to the float', 'reduce' => 'reduction of the float'];
    log_activity($pdo, $user, $restore ? 'restore' : 'delete', 'cash_float', $id,
        ($restore ? 'Restored ' : 'Deleted ') . $labels[$row['entry_type']] . ' record (TZS ' . number_format((float)$row['amount'])
        . ') for ' . $row['float_date'] . ', saved by ' . ($row['saved_by_name'] ?: 'unknown')
        . '. Float for that day is now TZS ' . number_format($summary['total']));

    respond(true, float_summary_for($pdo, $row['float_date'], $user),
        $restore ? 'Record restored.' : 'Record deleted. You can restore it from History.');
}

/** Corrects the amount / note of one float record. The day's float is recalculated and may not go below zero. */
function float_update_entry(PDO $pdo, array $user, int $id, array $d): void
{
    if (!$id) respond(false, null, 'Record id is required.', 422);
    if (!isset($d['amount']) || !is_numeric($d['amount'])) respond(false, null, 'Please enter a valid amount.', 422);
    $amount = round((float)$d['amount'], 2);
    if ($amount < 0 || $amount > 999999999999) respond(false, null, 'That amount is not valid.', 422);
    $note = mb_substr(clean($d['note'] ?? ''), 0, 255);

    $pdo->beginTransaction();
    try {
        $q = $pdo->prepare('SELECT * FROM cash_floats WHERE id = ? FOR UPDATE');
        $q->execute([$id]);
        $row = $q->fetch();

        if (!$row) { $pdo->rollBack(); respond(false, null, 'That record no longer exists.', 404); }
        if (float_soft_delete_ready($pdo) && !empty($row['deleted_at'])) {
            $pdo->rollBack();
            respond(false, null, 'This record is deleted. Restore it first if you need to change it.', 409);
        }
        if (!float_can_manage($user, $row)) {
            $pdo->rollBack();
            respond(false, null, ($user['role'] ?? '') === 'admin'
                ? 'You are not allowed to do this.'
                : 'You can only edit records you saved yourself, and only for today. Please ask an admin.', 403);
        }
        if ($row['entry_type'] !== 'opening' && $amount <= 0) {
            $pdo->rollBack();
            respond(false, null, 'The amount must be more than zero.', 422);
        }

        $pdo->prepare('UPDATE cash_floats SET amount = ?, note = ? WHERE id = ?')->execute([$amount, $note, $id]);

        $summary = get_float_summary($pdo, $row['float_date']);
        if ($summary['total'] < -0.004) {
            $pdo->rollBack();
            respond(false, null, 'This change would take the float for that day below zero (TZS '
                . number_format($summary['total']) . '), so it was not saved.', 422);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $labels = ['opening' => 'opening cash', 'add' => 'addition to the float', 'reduce' => 'reduction of the float'];
    $changes = [];
    if (abs((float)$row['amount'] - $amount) > 0.004) $changes[] = 'amount ' . audit_money_diff($row['amount'], $amount);
    if ((string)$row['note'] !== $note) $changes[] = 'note "' . $row['note'] . '" to "' . $note . '"';
    log_activity($pdo, $user, 'update', 'cash_float', $id,
        'Edited ' . $labels[$row['entry_type']] . ' record for ' . $row['float_date'] . ' (saved by '
        . ($row['saved_by_name'] ?: 'unknown') . '): ' . ($changes ? implode('; ', $changes) : 'no change')
        . '. Float for that day is now TZS ' . number_format($summary['total']));

    respond(true, float_summary_for($pdo, $row['float_date'], $user), 'Record updated.');
}

try {
    if ($method === 'GET') {
        // ---- One day's summary ----
        if (!empty($_GET['date'])) {
            $date = clean($_GET['date']);
            if (!valid_date_string($date)) respond(false, null, 'Invalid date.', 422);
            respond(true, float_summary_for($pdo, $date, $user));
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

        $soft = float_soft_delete_ready($pdo);
        $delCols = $soft ? ', f.deleted_at, f.deleted_by, f.deleted_by_name, f.restored_at, f.restored_by_name' : '';
        $activeInner = $soft ? ' AND f2.deleted_at IS NULL' : '';
        $stmt = $pdo->prepare("SELECT f.id, f.float_date, f.entry_type, f.amount, f.note,
                                      f.saved_by, f.saved_by_name, f.saved_by_role, f.created_at$delCols,
                                      (f.entry_type = 'opening' AND f.id < (
                                          SELECT MAX(f2.id) FROM cash_floats f2
                                          WHERE f2.float_date = f.float_date AND f2.entry_type = 'opening'$activeInner
                                      )) AS superseded
                               FROM cash_floats f
                               $where
                               ORDER BY f.float_date DESC, f.id DESC
                               LIMIT $limit");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['amount'] = (float)$r['amount'];
            $r['deleted'] = $soft && !empty($r['deleted_at']);
            // a deleted record is "deleted", not "replaced"
            $r['superseded'] = (bool)$r['superseded'] && !$r['deleted'];
            $r['can_delete']  = $soft && !$r['deleted'] && float_can_manage($user, $r);
            $r['can_edit']    = !$r['deleted'] && float_can_manage($user, $r);
            $r['can_restore'] = $soft && $r['deleted']  && float_can_manage($user, $r, true);
        }
        unset($r);

        $savers = $pdo->query('SELECT DISTINCT saved_by AS id, saved_by_name AS name FROM cash_floats
                               WHERE saved_by IS NOT NULL ORDER BY saved_by_name ASC')->fetchAll();

        respond(true, ['entries' => $rows, 'savers' => $savers]);
    }

    if ($method === 'POST') {
        $d = body();

        // ---- Restore a deleted record ----
        if (($d['action'] ?? '') === 'restore') {
            float_change_state($pdo, $user, (int)($d['id'] ?? 0), true);
        }

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
        respond(true, float_summary_for($pdo, $date, $user), $messages[$type]);
    }

    if ($method === 'DELETE') {
        float_change_state($pdo, $user, (int)($_GET['id'] ?? 0), false);
    }

    if ($method === 'PUT') {
        float_update_entry($pdo, $user, (int)($_GET['id'] ?? 0), body());
    }

    respond(false, null, 'Unsupported method.', 405);
} catch (PDOException $e) {
    if ($e->getCode() === '42S02') { // table doesn't exist yet
        respond(false, null, 'Opening cash is not set up yet. Please run Backend/upgrade_add_cash_float.php once, then try again.', 500);
    }
    throw $e;
}
