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
 * The Low Stock Alerts card's "Download" produces a ready-to-use supplier
 * Purchase Order for the items running low - not just a list, something a
 * worker can print, hand to (or send) a supplier, fill in prices by hand,
 * and get signed. Layout mirrors the company's official Purchase Order /
 * Supplier Purchase template.
 */
const PURCHASE_ORDER_LOGO = 'assets/logo1.png'; // same file & size as the Cash Audit sheet

function lowStockItemsOrEmpty() {
  const list = (DASHBOARD_DATA && DASHBOARD_DATA.low_stock_alerts) || [];
  if (!list.length) toast('All stock levels are healthy right now - there is nothing to order.', 'error');
  return list;
}

let POF_BUILT = false;

/** Opens the "how many are you going to buy" screen for the items running
 *  low, before anything is downloaded. The PDF/Excel are only generated
 *  once quantities have been entered here. */
function openPurchaseOrderModal() {
  const list = lowStockItemsOrEmpty();
  if (!list.length) return;
  buildPoFillModal();

  document.getElementById('poFillBody').innerHTML = list.map((p, i) => `
    <tr>
      <td>${p.name}</td>
      <td>${p.unit}</td>
      <td>${p.stock_quantity}</td>
      <td>${p.reorder_level}</td>
      <td><input type="number" class="po-qty-input" min="1" step="1" inputmode="numeric"
                 data-idx="${i}" placeholder="0"></td>
    </tr>`).join('');

  openModal('poFillModal');
}

function buildPoFillModal() {
  if (POF_BUILT) return;
  POF_BUILT = true;
  document.getElementById('poFillCloseBtn').addEventListener('click', () => closeModal('poFillModal'));
  document.getElementById('poFillPdfBtn').addEventListener('click', () => submitPurchaseOrder('pdf'));
  document.getElementById('poFillExcelBtn').addEventListener('click', () => submitPurchaseOrder('excel'));
}

/** Reads the quantities the user just typed in, matches them back to the
 *  low stock list (by position - the table is rebuilt fresh every time the
 *  modal opens, so the order always lines up), and hands off to the PDF
 *  or Excel generator. Every item must have a quantity greater than zero. */
function submitPurchaseOrder(format) {
  const list = lowStockItemsOrEmpty();
  if (!list.length) return;

  const inputs = document.querySelectorAll('#poFillBody .po-qty-input');
  const items = list
    .map((p, i) => {
      const raw = inputs[i] ? parseInt(inputs[i].value, 10) : NaN;
      return Object.assign({}, p, { buy_qty: raw > 0 ? raw : 0 });
    })
    .filter((p) => p.buy_qty > 0); // only the items actually being bought this time

  if (!items.length) {
    toast('Enter a quantity for at least one item you want to buy.', 'error');
    return;
  }

  closeModal('poFillModal');
  if (format === 'pdf') downloadLowStock(items); else downloadLowStockExcel(items);
}

function purchaseOrderHTML(items) {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const rows = items.map((p, i) => `
      <tr>
        <td class="po-c">${i + 1}</td>
        <td>${p.name}</td>
        <td class="po-c">${p.unit}</td>
        <td class="po-c">${p.buy_qty}</td>
        <td></td>
        <td></td>
        <td><span class="po-remark">${p.stock_quantity} ${p.unit} left in stock</span></td>
      </tr>`).join('');

  return `
    <div class="po-sheet">
      <div class="po-logo"><img src="${PURCHASE_ORDER_LOGO}" alt="eDesk Print &amp; Digital"></div>
      <div class="po-heading">
        <div class="po-brand">eDesk Print &amp; Digital</div>
        <div class="po-title">PURCHASE ORDER / SUPPLIER PURCHASE</div>
      </div>

      <div class="po-business">
        <div><b>Business Name:</b> eDesk Print &amp; Digital</div>
        <div><b>Location:</b> Mbeya, Iyunga (Moja One)</div>
        <div><b>Phone:</b> +255 763 399 399</div>
      </div>

      <div class="po-fields">
        <div><b>Supplier Name:</b><span class="po-fill"></span></div>
        <div><b>Supplier Contact:</b><span class="po-fill"></span></div>
        <div><b>Date:</b><span class="po-fill">${today}</span></div>
        <div><b>Purchase Ref No:</b><span class="po-fill"></span></div>
      </div>

      <table class="po-table">
        <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"><col class="c6"><col class="c7"></colgroup>
        <thead>
          <tr><th>S/N</th><th>Item Description</th><th>Unit</th><th>Quantity</th><th>Unit Price</th><th>Total</th><th>Remarks</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="po-totals">
        <div>Subtotal:<span class="po-fill"></span></div>
        <div>Transport Cost:<span class="po-fill"></span></div>
        <div>Other Expenses:<span class="po-fill"></span></div>
        <div>Grand Total:<span class="po-fill"></span></div>
      </div>

      <div class="po-sign">
        <div class="po-sig-block">
          <div class="po-sig-role">Prepared By</div>
          <div class="po-sig-field"><span class="po-sig-label">Name</span><span class="po-sig-line"></span></div>
          <div class="po-sig-field"><span class="po-sig-label">Signature</span><span class="po-sig-line"></span></div>
        </div>
        <div class="po-sig-block">
          <div class="po-sig-role">Supplier Signature</div>
          <div class="po-sig-field"><span class="po-sig-label">Name</span><span class="po-sig-line"></span></div>
          <div class="po-sig-field"><span class="po-sig-label">Signature</span><span class="po-sig-line"></span></div>
        </div>
      </div>
    </div>`;
}

/** Downloads (prints to PDF) the Purchase Order for the items running low -
 *  only that document prints, the rest of the Dashboard stays hidden,
 *  exactly like the Cash Audit sheet's own PDF download. */
async function downloadLowStock(items) {
  if (!items || !items.length) return;

  const box = document.getElementById('purchaseOrderPrint');
  box.innerHTML = purchaseOrderHTML(items);

  const img = box.querySelector('img');
  if (img && img.decode) { try { await img.decode(); } catch (e) { /* print anyway */ } }

  const oldTitle = document.title;
  document.title = 'eDESK_Purchase_Order_' + new Date().toISOString().slice(0, 10);
  document.body.classList.add('po-printing');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove('po-printing');
    document.title = oldTitle;
    box.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

function downloadLowStockExcel(items) {
  if (!items || !items.length) return;

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const rows = [
    ['Business Name:', 'eDesk Print & Digital'],
    ['Location:', 'Mbeya, Iyunga (Moja One)'],
    ['Phone:', '+255 763 399 399'],
    [],
    ['Supplier Name:', ''],
    ['Supplier Contact:', ''],
    ['Date:', today],
    ['Purchase Ref No:', ''],
    [],
    ['S/N', 'Item Description', 'Unit', 'Quantity', 'Unit Price', 'Total', 'Remarks'],
    ...items.map((p, i) => [
      i + 1, p.name, p.unit, p.buy_qty, '', '',
      `${p.stock_quantity} ${p.unit} left in stock`,
    ]),
    [],
    ['Subtotal:', ''],
    ['Transport Cost:', ''],
    ['Other Expenses:', ''],
    ['Grand Total:', ''],
    [],
    ['Prepared By - Name:', ''],
    ['Prepared By - Signature:', ''],
    ['Supplier - Name:', ''],
    ['Supplier - Signature:', ''],
  ];
  exportToExcel('eDESK_Purchase_Order_' + new Date().toISOString().slice(0, 10) + '.csv', ['PURCHASE ORDER / SUPPLIER PURCHASE'], rows);
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

