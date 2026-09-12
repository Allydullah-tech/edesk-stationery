/**
 * eDESK Print & Digital - Activity Log page logic (admin only)
 * Read-only view over the audit_log table. Nothing here can be
 * edited or deleted from the UI - an audit trail that can be
 * tampered with from the same app isn't an audit trail.
 */
let AUDIT_CACHE = [];

(async function init() {
  await requireAuth(['admin']);
  resetFilter();
})();

function todayStr() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

/**
 * "Clear / This Month" - wipes every filter back to its default (no
 * search text, no type, no user) and resets the date range to the
 * current month, then reloads. A genuine reset, not just a date shortcut.
 */
function resetFilter() {
  document.getElementById('searchInput').value = '';
  document.getElementById('typeFilter').value = '';
  document.getElementById('userFilter').value = '';
  document.getElementById('fStart').value = firstOfMonth();
  document.getElementById('fEnd').value = todayStr();
  loadAuditLog();
}

const ACTION_LABELS = { create: 'Created', update: 'Edited', delete: 'Deleted', payment: 'Payment', login: 'Login' };
const ACTION_TAG_CLASS = { create: 'tag-green', update: 'tag-gold', delete: 'tag-red', payment: 'tag-gold', login: 'tag-gray' };
const ENTITY_LABELS = {
  sale: 'Sale', product: 'Product', service: 'Service', damage: 'Damage',
  expense: 'Expense', purchase: 'Purchase', debt_payment: 'Debt Payment',
  user: 'User Account', login: 'Login',
};

async function loadAuditLog() {
  const tbody = document.getElementById('auditBody');
  tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading...</td></tr>';

  const start = document.getElementById('fStart').value;
  const end = document.getElementById('fEnd').value;
  document.getElementById('print-date-audit').textContent =
    (start === end ? fmtDate(start) : fmtDate(start) + ' to ' + fmtDate(end)) + ' · ' + new Date().toLocaleString('en-GB');

  const params = { start, end };
  const userId = document.getElementById('userFilter').value;
  const q = document.getElementById('searchInput').value.trim();
  const type = document.getElementById('typeFilter').value; // "entity:action", e.g. "sale:delete"

  if (userId) params.user_id = userId;
  if (q) params.q = q;
  if (type) {
    const [entityType, action] = type.split(':');
    params.entity_type = entityType;
    params.action = action;
  }

  const res = await API.get('audit_log.php', params);
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="6" class="muted">${res.message}</td></tr>`; return; }

  AUDIT_CACHE = res.data.entries;
  populateUserFilter(res.data.users);

  if (!AUDIT_CACHE.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted">No activity matches this search/filter.</td></tr>'; return; }

  tbody.innerHTML = AUDIT_CACHE.map(e => `
    <tr>
      <td>${fmtDateTime(e.created_at)}</td>
      <td>${e.user_name}</td>
      <td class="no-print muted">${e.user_role}</td>
      <td><span class="tag ${ACTION_TAG_CLASS[e.action] || 'tag-gray'}">${ACTION_LABELS[e.action] || e.action}</span></td>
      <td>${ENTITY_LABELS[e.entity_type] || e.entity_type}</td>
      <td class="muted">${e.description}</td>
    </tr>`).join('');
}

function populateUserFilter(users) {
  const select = document.getElementById('userFilter');
  const current = select.value;
  if (select.dataset.populated === 'true') return; // build the list once per page load
  select.innerHTML = '<option value="">All Users</option>' +
    users.map(u => `<option value="${u.user_id}">${u.user_name}</option>`).join('');
  select.value = current;
  select.dataset.populated = 'true';
}

function fmtDateTime(dt) {
  if (!dt) return '—';
  const d = new Date(dt.replace(' ', 'T'));
  return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function downloadAuditExcel() {
  const rows = AUDIT_CACHE.map(e => [
    fmtDateTime(e.created_at), e.user_name, e.user_role, ACTION_LABELS[e.action] || e.action,
    ENTITY_LABELS[e.entity_type] || e.entity_type, e.description,
  ]);
  exportToExcel('eDESK_ActivityLog_' + document.getElementById('fStart').value + '_to_' + document.getElementById('fEnd').value + '.csv',
    ['Date & Time', 'User', 'Role', 'Action', 'Area', 'Details'], rows);
}
