/**
 * eDESK Print & Digital - Customer Profiles page logic
 *
 * Backed by the real `customers` table now (see
 * Backend/upgrade_v4_sales_customers.php) - a customer exists if a
 * sale ever gave a name and/or phone, regardless of whether they've
 * ever taken credit. Paying cash every time does NOT make someone
 * "owe money" - that distinction is shown explicitly below.
 *
 * NOTE: this is the current, functional version of the page. The
 * fuller "Customer 360" profile (payment trends, debt trend chart,
 * activity timeline, unified risk score, restrict/unrestrict controls)
 * described in a later request has not been built into the UI yet -
 * this file exposes `status`/`id` so that can be added without another
 * backend change, but the page itself is still the simpler list +
 * summary-modal version.
 */
let CUSTOMERS_CACHE = [];

(async function init() {
  await requireAuth();
  document.getElementById('print-date-customers').textContent = 'Generated ' + new Date().toLocaleString('en-GB');

  // Coming from a link on the Debts page (?q=name-or-phone) - prefill the
  // search once, but don't keep re-applying it every time Filter is clicked.
  const urlQ = new URLSearchParams(window.location.search).get('q');
  if (urlQ) document.getElementById('searchInput').value = urlQ;

  await loadCustomers();
})();

/** Format a Date as YYYY-MM-DD using LOCAL time (not UTC, unlike toISOString). */
function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Turn a period keyword (week/month/year) into a {start, end} date-string
 * pair covering that whole calendar period around today. "week" runs
 * Monday -> Sunday of the current week.
 */
function customersPeriodRange(period) {
  const now = new Date();
  let start, end;

  if (period === 'week') {
    const day = now.getDay(); // 0 = Sunday ... 6 = Saturday
    const mondayOffset = (day === 0) ? -6 : 1 - day;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31);
  } else {
    return null;
  }

  return { start: toLocalISODate(start), end: toLocalISODate(end) };
}

async function loadCustomers() {
  const tbody = document.getElementById('customersBody');
  tbody.innerHTML = '<tr><td colspan="8" class="muted">Loading...</td></tr>';

  const params = {};
  const q = document.getElementById('searchInput').value.trim();
  if (q) params.q = q;

  const rangeHint = document.getElementById('customersRangeHint');
  const period = document.getElementById('periodFilter').value;

  if (period === 'custom') {
    const start = document.getElementById('customersStartDate').value;
    const end = document.getElementById('customersEndDate').value;
    if (start) params.start = start;
    if (end) params.end = end;
    rangeHint.textContent = (start || end)
      ? `Showing customers active from ${start ? fmtDate(start) : 'the beginning'} to ${end ? fmtDate(end) : 'today'}. Purchases/Total Spent reflect this period; Outstanding Debt is always current.`
      : 'Pick a start and/or end date for the custom range.';
  } else if (period) {
    const range = customersPeriodRange(period);
    params.start = range.start;
    params.end = range.end;
    rangeHint.textContent = `Showing customers active from ${fmtDate(range.start)} to ${fmtDate(range.end)}. Purchases/Total Spent reflect this period; Outstanding Debt is always current.`;
  } else {
    rangeHint.textContent = 'Showing all customers, all time.';
  }

  const res = await API.get('customers.php', params);
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="8" class="muted">${res.message}</td></tr>`; return; }

  CUSTOMERS_CACHE = res.data;

  let totalSpent = 0, totalOutstanding = 0, withDebt = 0;
  res.data.forEach(c => {
    totalSpent += Number(c.total_spent) || 0;
    totalOutstanding += Number(c.total_outstanding) || 0;
    if (Number(c.total_outstanding) > 0.01) withDebt++;
  });
  document.getElementById('c-total-customers').textContent = res.data.length;
  document.getElementById('c-with-debt').textContent = withDebt;
  document.getElementById('c-no-debt').textContent = res.data.length - withDebt;
  document.getElementById('c-total-spent').textContent = money(totalSpent);
  document.getElementById('c-total-outstanding').textContent = money(totalOutstanding);

  if (!res.data.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">No customers recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = res.data.map(c => {
    let riskTag;
    if (c.status === 'restricted') riskTag = '<span class="tag tag-red">⛔ Restricted</span>';
    else if (c.overdue_count > 0) riskTag = `<span class="tag tag-red">${c.overdue_count} overdue</span>`;
    else if (c.total_outstanding > 0) riskTag = '<span class="tag tag-gold">Owes, on time</span>';
    else riskTag = '<span class="tag tag-green">No debt</span>';

    return `
    <tr>
      <td><strong>${c.name || 'Unknown'}</strong></td>
      <td>${c.phone || '—'}</td>
      <td>${c.total_purchases}</td>
      <td>${money(c.total_spent)}</td>
      <td class="${c.total_outstanding > 0 ? 'red' : 'muted'}">${money(c.total_outstanding)}</td>
      <td class="no-print">${riskTag}</td>
      <td>${fmtDate(c.last_purchase_date)}</td>
      <td class="no-print">
        <button class="icon-action-btn view-btn" title="View profile" onclick="openCustomerModal(${c.id})"><svg class="ui-icon"><use href="assets/icons.svg#eye"></use></svg></button>
      </td>
    </tr>`;
  }).join('');
}

async function openCustomerModal(id) {
  const summaryRow = CUSTOMERS_CACHE.find(c => c.id == id);
  document.getElementById('customerModalTitle').textContent = (summaryRow ? (summaryRow.name || 'Customer') : 'Customer') + (summaryRow && summaryRow.phone ? ' — ' + summaryRow.phone : '');
  document.getElementById('customerSalesBody').innerHTML = '<tr><td colspan="5" class="muted">Loading...</td></tr>';
  openModal('customerModal');

  const res = await API.get('customers.php', { id });
  if (!res.success) { document.getElementById('customerSalesBody').innerHTML = `<tr><td colspan="5" class="muted">${res.message}</td></tr>`; return; }

  const s = res.data.summary;
  document.getElementById('cp-purchases').textContent = s.total_purchases;
  document.getElementById('cp-spent').textContent = money(s.total_spent);
  document.getElementById('cp-outstanding').textContent = money(s.total_outstanding);
  document.getElementById('cp-overdue').textContent = s.overdue_count;

  if (!res.data.sales.length) {
    document.getElementById('customerSalesBody').innerHTML = '<tr><td colspan="5" class="muted">No purchase history.</td></tr>';
  } else {
    document.getElementById('customerSalesBody').innerHTML = res.data.sales.map(sale => {
      let status = '<span class="tag tag-green">Cash</span>';
      if (sale.payment_method === 'credit') {
        const remaining = Number(sale.total_amount) - Number(sale.paid_amount);
        const isOverdue = sale.credit_deadline && new Date(sale.credit_deadline) < new Date() && remaining > 0.01;
        status = remaining <= 0.01
          ? '<span class="tag tag-green">Paid</span>'
          : (isOverdue ? '<span class="tag tag-red">Overdue</span>' : '<span class="tag tag-gold">Pending</span>');
      }
      return `
      <tr>
        <td>${fmtDate(sale.sale_date)}</td>
        <td>${sale.items_summary || '—'}</td>
        <td>${money(sale.total_amount)}</td>
        <td>${sale.payment_method === 'credit' ? 'Credit' : 'Cash'}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
  }

  renderCustomerPaymentRecords(res.data.payment_records || []);
}

const PAYMENT_RECORD_LABELS = {
  cash_sale: '<span class="tag tag-green">Cash Sale</span>',
  debt_payment: '<span class="tag tag-gold">Debt Payment</span>',
  debt_overdue: '<span class="tag tag-red">Went Overdue</span>',
};

function renderCustomerPaymentRecords(records) {
  const tbody = document.getElementById('customerPaymentRecordsBody');
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No cash sales, debt payments, or overdue debts recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    const via = r.type === 'debt_overdue'
      ? '—'
      : (r.method === 'online' ? (r.online_method ? 'Online (' + r.online_method + ')' : 'Online') : 'Cash');
    return `
    <tr>
      <td>${fmtDate(r.event_date)}</td>
      <td>${PAYMENT_RECORD_LABELS[r.type] || r.type}</td>
      <td class="${r.type === 'debt_overdue' ? 'red' : ''}"><strong>${money(r.amount)}</strong></td>
      <td>${via}</td>
      <td class="muted">#${r.sale_id}</td>
    </tr>`;
  }).join('');
}

function downloadCustomersExcel() {
  const rows = CUSTOMERS_CACHE.map(c => [
    c.name || 'Unknown', c.phone || '', c.total_purchases, c.total_spent, c.total_outstanding, c.overdue_count, c.status, c.last_purchase_date,
  ]);
  exportToExcel('eDESK_Customers_' + new Date().toISOString().slice(0, 10) + '.csv',
    ['Name', 'Phone', 'Purchases', 'Total Spent', 'Outstanding Debt', 'Overdue Debts', 'Status', 'Last Purchase'], rows);
}
