<?php
/**
 * EDESK STATIONERY - Who may see the business's financial figures
 *
 * Only ADMIN users may see buying/cost prices, profit and anything that lets
 * profit be worked out. Workers keep every normal function, but the server
 * never sends them these figures (hiding a column in the browser alone would
 * still leave the numbers visible in the network response).
 *
 * Usage:
 *   if (!is_admin_user($user)) $rows = hide_fields_in_rows($rows, ['buying_price']);
 */

function is_admin_user(array $user): bool
{
    return ($user['role'] ?? '') === 'admin';
}

/** Removes the given keys from one row (an associative array). */
function hide_fields(array $row, array $keys): array
{
    foreach ($keys as $k) unset($row[$k]);
    return $row;
}

/** Removes the given keys from every row of a list. */
function hide_fields_in_rows(array $rows, array $keys): array
{
    return array_map(fn($r) => is_array($r) ? hide_fields($r, $keys) : $r, $rows);
}
