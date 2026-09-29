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
 *
 * The Cash Audit uses the current float as "Opening Cash" in Part B.
 */

function get_float_summary(PDO $pdo, string $date): array
{
    $stmt = $pdo->prepare('SELECT id, entry_type, amount, note, saved_by, saved_by_name, saved_by_role, created_at
                           FROM cash_floats WHERE float_date = ? ORDER BY id ASC');
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

    return [
        'date'          => $date,
        'opening'       => $opening,
        'opening_entry' => $openingEntry,
        'added'         => $added,
        'reduced'       => $reduced,
        'total'         => $opening + $added - $reduced,
        'entries'       => $rows,
    ];
}
