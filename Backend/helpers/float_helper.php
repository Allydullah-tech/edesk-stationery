<?php
/**
 * EDESK STATIONERY - Opening cash / float helper
 *
 * A day's float works like this:
 *   - "opening" entries set what the day started with. If it is set more
 *     than once (a correction), the LATEST one counts and earlier ones are
 *     shown as "replaced" in history - nothing is ever overwritten.
 *   - "add" / "reduce" entries move the float up or down during the day
 *     (change added to the till, cash taken out for banking, etc.). These
 *     are NOT sales - they only change the float.
 *   current float = opening + all added - all reduced
 *   - Deleted entries (soft delete) are ignored everywhere; they stay in history and can be restored.
 *
 * The Cash Audit uses the current float as "Opening Cash" in Part B.
 *
 * Carry-over: if nobody has typed an opening cash for a date, the opening
 * cash is filled in automatically from the Remaining Cash (cash left at the
 * office after banking) of the most recent earlier day that has a Cash Audit
 * or Bank Deposit. Typing an opening cash for the date always wins over it.
 */

/**
 * True once upgrade_v13_float_soft_delete.php has been run (the cash_floats table has a deleted_at column).
 * Until then nothing is ever treated as deleted, so the system keeps working exactly as before.
 */
function float_soft_delete_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $ready = $pdo->query("SHOW COLUMNS FROM cash_floats LIKE 'deleted_at'")->rowCount() > 0;
    } catch (PDOException $e) {
        $ready = false;
    }
    return $ready;
}

/** SQL fragment that leaves out deleted records, e.g. float_active_sql($pdo, 'f') => " AND f.deleted_at IS NULL". */
function float_active_sql(PDO $pdo, string $alias = ''): string
{
    if (!float_soft_delete_ready($pdo)) return '';
    return ' AND ' . ($alias !== '' ? $alias . '.' : '') . 'deleted_at IS NULL';
}

/**
 * Remaining Cash of the latest day BEFORE $date that has a closing record.
 * Returns ['amount' => float, 'from_date' => 'YYYY-MM-DD'] or null.
 * Never throws if the v6 upgrade has not been run - it just returns null.
 */
function get_carry_over(PDO $pdo, string $date): ?array
{
    $best = null;
    try {
        // Audits saved before the v6 upgrade (calc_version 1) have no Remaining Cash, so they never carry over.
        $a = $pdo->prepare('SELECT audit_date AS d, remaining_cash AS r FROM cash_audits
                            WHERE calc_version >= 2 AND audit_date < ?
                            ORDER BY audit_date DESC, id DESC LIMIT 1');
        $a->execute([$date]);
        $row = $a->fetch();
        if ($row) $best = ['amount' => (float)$row['r'], 'from_date' => $row['d']];
    } catch (PDOException $e) { /* table/columns not there yet */ }

    try {
        $b = $pdo->prepare('SELECT deposit_date AS d, remaining_cash AS r FROM bank_deposits
                            WHERE deposit_date < ?
                            ORDER BY deposit_date DESC, id DESC LIMIT 1');
        $b->execute([$date]);
        $row = $b->fetch();
        // A later day wins; on the same day the audit row already includes the deposits, so it wins the tie.
        if ($row && (!$best || $row['d'] > $best['from_date'])) {
            $best = ['amount' => (float)$row['r'], 'from_date' => $row['d']];
        }
    } catch (PDOException $e) { /* table not there yet */ }

    if ($best) $best['amount'] = max(0.0, $best['amount']);
    return $best;
}

function get_float_summary(PDO $pdo, string $date): array
{
    // Deleted records are kept in the table (so they can be restored) but never count towards the float.
    $stmt = $pdo->prepare('SELECT id, entry_type, amount, note, saved_by, saved_by_name, saved_by_role, created_at
                           FROM cash_floats WHERE float_date = ?' . float_active_sql($pdo) . ' ORDER BY id ASC');
    $stmt->execute([$date]);
    $rows = $stmt->fetchAll();

    $openingId = null;
    $opening = 0.0;
    $openingEntry = null;
    $added = 0.0;
    $reduced = 0.0;

    foreach ($rows as $r) {
        $amt = (float)$r['amount'];
        if ($r['entry_type'] === 'opening') {
            $openingId = (int)$r['id'];      // rows are in id order, so the last one wins
            $opening = $amt;
            $openingEntry = $r;
        } elseif ($r['entry_type'] === 'add') {
            $added += $amt;
        } elseif ($r['entry_type'] === 'reduce') {
            $reduced += $amt;
        }
    }

    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['amount'] = (float)$r['amount'];
        $r['superseded'] = ($r['entry_type'] === 'opening' && $r['id'] !== $openingId);
    }
    unset($r);

    // Previous day's Remaining Cash (always looked up, so the screen can still show it
    // next to a manually typed opening). It is only USED when no opening was typed.
    $carry = get_carry_over($pdo, $date);
    $source = $openingEntry ? 'manual' : 'none';
    if (!$openingEntry && $carry) {
        $opening = $carry['amount'];
        $source = 'carry_over';
    }

    return [
        'date'           => $date,
        'opening'        => $opening,
        'opening_entry'  => $openingEntry,
        'opening_source' => $source,   // 'manual' | 'carry_over' | 'none'
        'carry_over'     => $carry,    // ['amount', 'from_date'] or null; used only when opening_source = 'carry_over'
        'added'          => $added,
        'reduced'        => $reduced,
        'total'          => $opening + $added - $reduced,
        'entries'        => $rows,
    ];
}
