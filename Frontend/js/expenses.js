/**
 * EDESK STATIONERY - Expenses page logic
 * Admin and worker can both add, edit, and delete expenses - every
 * edit/delete is written to the Activity Log automatically (see
 * Backend/api/expenses.php), so mistakes stay correctable without
 * losing accountability for who changed what.
 */
let EXPENSES_CACHE = [];
function todayStr() { return new Date().toISOString().slice(0, 10); }

(async function init() {
  await requireAuth();
  document.getElementById('ex-date').value = todayStr();
  resetFilter();
})();

function resetFilter() {
  document.getElementById('fStart').value = todayStr();
  document.getElementById('fEnd').value = todayStr();
  loadExpenses();
}

async function loadExpenses() {
  const tbody = document.getElementById('expensesBody');
  tbody.innerHTML = '<tr><td colspan="7" class="muted">Loading...</td></tr>';

  const start = document.getElementById('fStart').value;
  const end = document.getElementById('fEnd').value;
  document.getElementById('print-date-expenses').textContent =
    (start === end ? fmtDate(start) : fmtDate(start) + ' to ' + fmtDate(end)) + ' · Generated ' + new Date().toLocaleString('en-GB');

  const res = await API.get('expenses.php', { start, end });
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="7" class="muted">${res.message}</td></tr>`; return; }

  EXPENSES_CACHE = res.data;
  let total = 0;
  res.data.forEach(e => total += Number(e.amount));
  document.getElementById('e-total').textContent = money(total);
  document.getElementById('e-count').textContent = res.data.length;
  document.getElementById('e-total-print').textContent = money(total);
  document.getElementById('e-count-print').textContent = res.data.length;

  if (!res.data.length) { tbody.innerHTML = '<tr><td colspan="7" class="muted">No expenses recorded for this period.</td></tr>'; return; }

  tbody.innerHTML = res.data.map(e => `
    <tr>
      <td>${fmtDate(e.expense_date)}</td>
      <td>${e.title}</td>
      <td><span class="tag tag-gray">${e.category}</span></td>
      <td class="red"><strong>${money(e.amount)}</strong></td>
      <td>${e.recorded_by_name}</td>
      <td class="muted">${e.note || '—'}</td>
      <td class="no-print">
        <button class="icon-action-btn edit-btn" title="Edit" onclick="editExpense(${e.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        <button class="icon-action-btn delete-btn" title="Delete" onclick="deleteExpense(${e.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </td>
    </tr>`).join('');
}

function openExpenseModal() {
  document.getElementById('expenseForm').reset();
  document.getElementById('ex-id').value = '';
  document.getElementById('ex-date').value = todayStr();
  document.getElementById('expenseModalTitle').textContent = 'Add Expense';
  openModal('expenseModal');
}

function editExpense(id) {
  const e = EXPENSES_CACHE.find(x => x.id == id);
  if (!e) return;
  document.getElementById('ex-id').value = e.id;
  document.getElementById('ex-title').value = e.title;
  document.getElementById('ex-category').value = e.category;
  document.getElementById('ex-amount').value = e.amount;
  document.getElementById('ex-date').value = e.expense_date;
  document.getElementById('ex-note').value = e.note || '';
  document.getElementById('expenseModalTitle').textContent = 'Edit Expense';
  openModal('expenseModal');
}

document.getElementById('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('ex-id').value;
  const payload = {
    title: document.getElementById('ex-title').value.trim(),
    category: document.getElementById('ex-category').value,
    amount: document.getElementById('ex-amount').value,
    expense_date: document.getElementById('ex-date').value,
    note: document.getElementById('ex-note').value.trim(),
  };

  const res = id
    ? await API.put('expenses.php', { id, ...payload })
    : await API.post('expenses.php', payload);

  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  closeModal('expenseModal');
  loadExpenses();
});

async function deleteExpense(id) {
  if (!confirm('Delete this expense entry?')) return;
  const res = await API.del('expenses.php', { id });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  loadExpenses();
}

function downloadExpensesExcel() {
  const rows = EXPENSES_CACHE.map(e => [e.expense_date, e.title, e.category, e.amount, e.recorded_by_name, e.note || '']);
  exportToExcel('eDESK_Expenses_' + document.getElementById('fStart').value + '_to_' + document.getElementById('fEnd').value + '.csv',
    ['Date', 'Title', 'Category', 'Amount', 'Recorded By', 'Note'], rows);
}
