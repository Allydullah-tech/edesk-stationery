/**
 * eDESK STATIONERY - Dashboard page logic
 */
let DASHBOARD_DATA = null;

(async function init() {
  await requireAuth();
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('today-label').textContent = 'Today — ' + dateStr;
  document.getElementById('print-date-dashboard').textContent = dateStr + ' · ' + new Date().toLocaleTimeString('en-GB');

  const res = await API.get('dashboard.php');
  if (!res.success) { toast(res.message || 'Could not load dashboard.', 'error'); return; }
  const d = res.data;
  DASHBOARD_DATA = d;

  document.getElementById('d-sales').textContent = money(d.today.total_sales);
  document.getElementById('d-transactions').textContent = d.today.transactions;
  document.getElementById('d-expenses').textContent = money(d.today.total_expenses);
  document.getElementById('d-damage').textContent = money(d.today.total_damage_loss);
  document.getElementById('d-profit').textContent = money(d.today.net_profit);
  document.getElementById('d-credit').textContent = money(d.today.total_credit || 0);
  document.getElementById('d-credit-sub').textContent = (d.today.credit_count || 0) + ' sale(s) — view on Debts page';

  document.getElementById('d-products').textContent = d.stock.total_products;
  document.getElementById('d-services').textContent = d.stock.total_services;
  document.getElementById('d-month-sales').textContent = money(d.month.total_sales);
  document.getElementById('d-month-profit').textContent = money(d.month.net_profit);

  // Plain-words mirrors of the figures above, shown only in the printed
  // PDF (see .report-summary-text) instead of the on-screen stat cards.
  document.getElementById('d-sales-print').textContent = money(d.today.total_sales);
  document.getElementById('d-transactions-print').textContent = d.today.transactions;
  document.getElementById('d-expenses-print').textContent = money(d.today.total_expenses);
  document.getElementById('d-damage-print').textContent = money(d.today.total_damage_loss);
  document.getElementById('d-profit-print').textContent = money(d.today.net_profit);
  document.getElementById('d-credit-print').textContent = money(d.today.total_credit || 0);
  document.getElementById('d-products-print').textContent = d.stock.total_products;
  document.getElementById('d-services-print').textContent = d.stock.total_services;
  document.getElementById('d-month-sales-print').textContent = money(d.month.total_sales);
  document.getElementById('d-month-profit-print').textContent = money(d.month.net_profit);

  // Top selling today
  const tbody = document.getElementById('topSellingBody');
  if (d.top_selling_today && d.top_selling_today.length) {
    tbody.innerHTML = d.top_selling_today.map(row => `
      <tr>
        <td>${row.name} ${row.is_service == 1 ? '<span class="tag tag-gold">Service</span>' : ''}</td>
        <td>${row.qty_sold}</td>
        <td>${money(row.revenue)}</td>
        <td class="gold">${money(row.profit)}</td>
      </tr>`).join('');
  }

  // Debt (madeni) due-date alerts
  const alerts = d.debt_alerts || { due_today: [], overdue: [], due_today_total: 0, overdue_total: 0 };
  if (alerts.overdue.length || alerts.due_today.length) {
    const parts = [];
    if (alerts.overdue.length) {
      parts.push(`<strong>${alerts.overdue.length}</strong> debt(s) overdue, totaling <strong>${money(alerts.overdue_total)}</strong>`);
    }
    if (alerts.due_today.length) {
      parts.push(`<strong>${alerts.due_today.length}</strong> debt(s) due today, totaling <strong>${money(alerts.due_today_total)}</strong>`);
    }
    const borderColor = alerts.overdue.length ? 'var(--red)' : 'var(--gold)';
    const bg = alerts.overdue.length ? '#FEF6F5' : '#FDF3E3';

    document.getElementById('debtAlertBanner').innerHTML = `
      <div class="card mt-16 no-print" style="border-left:4px solid ${borderColor};background:${bg};">
        <div class="flex-between">
          <div>
            <strong style="font-size:13px;"><svg class="ui-icon"><use href="assets/icons.svg#credit-card"></use></svg> Debt Alert</strong>
            <div class="muted" style="font-size:12px;margin-top:2px;">${parts.join(' · ')}</div>
          </div>
          <a href="debts.html"><button class="btn btn-outline btn-sm">View Debts</button></a>
        </div>
      </div>
      <p class="print-only report-summary-text" style="margin-top:14px;">Debt Alert: ${parts.join(', ').replace(/<\/?strong>/g, '')}.</p>`;
  }

  // Low stock alerts
  if (d.low_stock_alerts && d.low_stock_alerts.length) {
    document.getElementById('lowStockList').innerHTML = d.low_stock_alerts.map(p => `
      <div class="flex-between" style="padding:7px 0;border-bottom:1px dashed var(--line);font-size:12.5px;">
        <span>${p.name}</span>
        <span class="tag tag-red">${p.stock_quantity} ${p.unit} left</span>
      </div>`).join('');

    document.getElementById('lowStockPrintTable').innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead><tr><th>Product</th><th>Current Stock</th><th>Reorder Level</th><th>Unit</th></tr></thead>
          <tbody>
            ${d.low_stock_alerts.map(p => `
              <tr><td>${p.name}</td><td>${p.stock_quantity}</td><td>${p.reorder_level}</td><td>${p.unit}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    document.getElementById('lowStockBanner').innerHTML = `
      <div class="card no-print" style="border-left:4px solid var(--red);background:#FEF6F5;">
        <div class="flex-between">
          <div>
            <strong style="font-size:13px;"><svg class="ui-icon"><use href="assets/icons.svg#alert-triangle"></use></svg> Stock Alert</strong>
            <div class="muted" style="font-size:12px;margin-top:2px;">${d.low_stock_alerts.length} item(s) are running low and need restocking soon.</div>
          </div>
          <a href="products.html"><button class="btn btn-outline btn-sm">View Stock</button></a>
        </div>
      </div>
      <p class="print-only report-summary-text">Stock Alert: ${d.low_stock_alerts.length} item(s) are running low and need restocking soon.</p>`;
  } else {
    document.getElementById('lowStockPrintTable').innerHTML =
      '<p class="muted" style="font-size:12.5px;">All stock levels were healthy at the time this was generated.</p>';
  }
})();

/**
 * Downloads (prints to PDF) only the Low Stock Alerts card -
 * a focused shopping list, without the rest of the dashboard.
 */
function downloadLowStock() {
  document.getElementById('print-date-lowstock').textContent = new Date().toLocaleString('en-GB');
  document.body.classList.add('print-low-stock-only');

  const cleanup = () => document.body.classList.remove('print-low-stock-only');
  window.addEventListener('afterprint', cleanup, { once: true });

  window.print();
}

function downloadLowStockExcel() {
  const list = (DASHBOARD_DATA && DASHBOARD_DATA.low_stock_alerts) || [];
  const rows = list.map(p => [p.name, p.stock_quantity, p.reorder_level, p.unit]);
  exportToExcel('eDESK_Low_Stock_' + new Date().toISOString().slice(0, 10) + '.csv',
    ['Product', 'Current Stock', 'Reorder Level', 'Unit'], rows);
}

function downloadDashboardExcel() {
  if (!DASHBOARD_DATA) { toast('Please wait for the dashboard to finish loading.', 'error'); return; }
  const d = DASHBOARD_DATA;
  const rows = [
    ['Sales Today', d.today.total_sales],
    ['Transactions Today', d.today.transactions],
    ['Expenses Today', d.today.total_expenses],
    ['Damage Loss Today', d.today.total_damage_loss],
    ['Profit Today', d.today.net_profit],
    [],
    ['Total Products', d.stock.total_products],
    ['Total Services', d.stock.total_services],
    ['Sales This Month', d.month.total_sales],
    ['Net Profit This Month', d.month.net_profit],
    [],
    ['LOW STOCK ALERTS'],
    ['Product', 'Current Stock', 'Reorder Level', 'Unit'],
    ...(d.low_stock_alerts || []).map(p => [p.name, p.stock_quantity, p.reorder_level, p.unit]),
  ];
  exportToExcel('eDESK_Dashboard_' + new Date().toISOString().slice(0, 10) + '.csv', ['Metric', 'Value'], rows);
}

