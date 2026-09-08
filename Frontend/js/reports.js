/**
 * EDESK STATIONERY - Reports page logic
 */
let LAST_REPORT = null;

(async function init() {
  await requireAuth();
  document.getElementById('dateInput').value = new Date().toISOString().slice(0, 10);
  document.getElementById('periodSelect').addEventListener('change', onPeriodChange);
  onPeriodChange();
  generateReport();
})();

function onPeriodChange() {
  const period = document.getElementById('periodSelect').value;
  const label = document.getElementById('dateLabel');
  const endField = document.getElementById('endField');
  const weekHint = document.getElementById('weekHint');

  weekHint.classList.toggle('hidden', period !== 'week');
  endField.classList.toggle('hidden', period !== 'custom');

  const labels = { day: 'Date', week: 'Starting Date', month: 'Any Date in Month', year: 'Any Date in Year', custom: 'Start Date' };
  label.textContent = labels[period] || 'Date';
}

async function generateReport() {
  const period = document.getElementById('periodSelect').value;
  const date = document.getElementById('dateInput').value;
  const end = document.getElementById('endInput').value;

  const params = { period, date };
  if (period === 'custom' && end) params.end = end;

  const res = await API.get('reports.php', params);
  if (!res.success) { toast(res.message || 'Could not generate report.', 'error'); return; }

  LAST_REPORT = res.data;
  renderReport(res.data);
}

function renderReport(r) {
  const rangeText = (r.range.start === r.range.end) ? fmtDate(r.range.start) : (fmtDate(r.range.start) + '  —  ' + fmtDate(r.range.end));
  document.getElementById('reportRangeLabel').textContent = rangeText;
  document.getElementById('reportRangeLabelPrint').textContent = rangeText;
  document.getElementById('reportGeneratedAt').textContent = 'Generated ' + new Date().toLocaleString('en-GB');

  document.getElementById('r-sales').textContent = money(r.sales.total_sales);
  document.getElementById('r-transactions').textContent = r.sales.transactions;
  document.getElementById('r-gross').textContent = money(r.sales.total_profit);
  document.getElementById('r-expenses').textContent = money(r.expenses.total_expenses);
  document.getElementById('r-damage').textContent = money(r.damages.total_loss);
  document.getElementById('r-net').textContent = money(r.net_profit);
  document.getElementById('r-sales-print').textContent = money(r.sales.total_sales);
  document.getElementById('r-transactions-print').textContent = r.sales.transactions;
  document.getElementById('r-gross-print').textContent = money(r.sales.total_profit);
  document.getElementById('r-expenses-print').textContent = money(r.expenses.total_expenses);
  document.getElementById('r-damage-print').textContent = money(r.damages.total_loss);
  document.getElementById('r-net-print').textContent = money(r.net_profit);

  const topBody = document.getElementById('topSellingTable');
  topBody.innerHTML = r.top_selling.length ? r.top_selling.map((p, i) => `
    <tr><td>${i + 1}</td><td>${p.name}</td><td>${p.is_service == 1 ? '<span class="tag tag-gold">Service</span>' : '<span class="tag tag-gray">Product</span>'}</td>
    <td>${p.qty_sold}</td><td>${money(p.revenue)}</td><td class="gold">${money(p.profit)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No sales in this period.</td></tr>';

  const profitSorted = [...r.most_profitable];
  const profBody = document.getElementById('mostProfitableTable');
  profBody.innerHTML = profitSorted.length ? profitSorted.map((p, i) => `
    <tr><td>${i + 1}</td><td>${p.name}</td><td>${p.is_service == 1 ? '<span class="tag tag-gold">Service</span>' : '<span class="tag tag-gray">Product</span>'}</td>
    <td>${p.qty_sold}</td><td>${money(p.revenue)}</td><td class="green">${money(p.profit)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No sales in this period.</td></tr>';

  const expBody = document.getElementById('expenseBreakdownTable');
  expBody.innerHTML = r.expense_breakdown.length ? r.expense_breakdown.map(e => `
    <tr><td>${e.category}</td><td class="red">${money(e.total)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">No expenses in this period.</td></tr>';

  const dmgBody = document.getElementById('damageTable');
  dmgBody.innerHTML = r.damage_list.length ? r.damage_list.map(d => `
    <tr><td>${fmtDate(d.damage_date)}</td><td>${d.product_name}${d.item_type === 'other' ? ' <span class="tag tag-gray">Not in Stock</span>' : ''}</td><td>${d.item_type === 'other' ? '—' : d.quantity}</td><td class="muted">${d.reason}</td><td class="red">${money(d.loss_value)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No damage or waste in this period.</td></tr>';
}

function downloadReportExcel() {
  if (!LAST_REPORT) { toast('Please generate a report first.', 'error'); return; }
  const r = LAST_REPORT;

  const rows = [
    ['eDESK STATIONERY - Business Report'],
    ['Period', r.range.start + ' to ' + r.range.end],
    [],
    ['SUMMARY'],
    ['Total Sales', r.sales.total_sales],
    ['Total Transactions', r.sales.transactions],
    ['Gross Profit', r.sales.total_profit],
    ['Total Expenses', r.expenses.total_expenses],
    ['Total Damage / Loss', r.damages.total_loss],
    ['Net Profit', r.net_profit],
    [],
    ['TOP SELLING PRODUCTS / SERVICES'],
    ['Name', 'Type', 'Qty Sold', 'Revenue', 'Profit'],
    ...r.top_selling.map(p => [p.name, p.is_service == 1 ? 'Service' : 'Product', p.qty_sold, p.revenue, p.profit]),
    [],
    ['MOST PROFITABLE PRODUCTS / SERVICES'],
    ['Name', 'Type', 'Qty Sold', 'Revenue', 'Profit'],
    ...r.most_profitable.map(p => [p.name, p.is_service == 1 ? 'Service' : 'Product', p.qty_sold, p.revenue, p.profit]),
    [],
    ['EXPENSE BREAKDOWN'],
    ['Category', 'Amount'],
    ...r.expense_breakdown.map(e => [e.category, e.total]),
    [],
    ['DAMAGES / WASTED STOCK'],
    ['Product', 'Qty', 'Reason', 'Loss Value', 'Date'],
    ...r.damage_list.map(d => [d.product_name, d.quantity, d.reason, d.loss_value, d.damage_date]),
  ];

  exportToExcel('eDESK_Report_' + r.range.start + '_to_' + r.range.end + '.csv', [], rows);
}

