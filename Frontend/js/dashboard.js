/**
 * eDESK STATIONERY - Dashboard page logic
 */
let DASHBOARD_DATA = null;

(async function init() {
  await requireAuth();
  if (typeof initDashHero === 'function') initDashHero(CURRENT_USER); // welcome banner (see js/dashboard-anim.js)
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('today-label').textContent = 'Today — ' + dateStr;
  document.getElementById('print-date-dashboard').textContent = dateStr + ' · ' + new Date().toLocaleTimeString('en-GB');

  const res = await API.get('dashboard.php');
  if (!res.success) { if (window.stopStatSkeleton) stopStatSkeleton(); toast(res.message || 'Could not load dashboard.', 'error'); return; }
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

  if (window.animateStatValues) animateStatValues(); // count-up animation (see js/dashboard-anim.js)

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
        <td class="gold admin-only">${money(row.profit)}</td>
      </tr>`).join('');
    applyRoleVisibility(); // hides the Profit column for workers
  }

  // Debt (madeni) due-date alerts -> shown in the notification bell (top right).
  // The on-screen banner cards were removed; only the plain-text lines used
  // in the printed PDF are kept here.
  const alerts = d.debt_alerts || { due_today: [], overdue: [], due_soon: [], due_today_total: 0, overdue_total: 0, due_soon_total: 0 };
  alerts.due_soon = alerts.due_soon || [];
  if (alerts.overdue.length || alerts.due_today.length) {
    const parts = [];
    if (alerts.overdue.length) {
      parts.push(`${alerts.overdue.length} debt(s) overdue, totaling ${money(alerts.overdue_total)}`);
    }
    if (alerts.due_today.length) {
      parts.push(`${alerts.due_today.length} debt(s) due today, totaling ${money(alerts.due_today_total)}`);
    }
    document.getElementById('debtAlertBanner').innerHTML =
      `<p class="print-only report-summary-text" style="margin-top:14px;">Debt Alert: ${parts.join(', ')}.</p>`;
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

    document.getElementById('lowStockBanner').innerHTML =
      `<p class="print-only report-summary-text">Stock Alert: ${d.low_stock_alerts.length} item(s) are running low and need restocking soon.</p>`;
  } else {
    document.getElementById('lowStockPrintTable').innerHTML =
      '<p class="muted" style="font-size:12.5px;">All stock levels were healthy at the time this was generated.</p>';
  }


  buildNotifications(alerts, d.low_stock_alerts || []);
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

/** Low stock Excel = the Purchases page's "Import Template" file, exactly:
 *  same "Purchases" sheet headers and column widths, same "Instructions"
 *  sheet, same .xlsx format - but filled with the items being bought
 *  (quantities typed in the modal) instead of the two example rows.
 *  Self-contained on purpose: it only needs the SheetJS (XLSX) library. */
async function downloadLowStockExcel(items) {
  if (!items || !items.length) return;
  // Make sure the colour-capable Excel library is the one in use (see ui.js).
  if (typeof loadXlsxStyle === 'function') await loadXlsxStyle();
  if (typeof XLSX === 'undefined') {
    toast('The file library could not load - check your internet connection and try again.', 'error');
    return;
  }

  const num = (v) => (v !== undefined && v !== null && Number(v) > 0) ? Number(v) : '';
  const headers = ['Product Name', 'Category', 'Description', 'Unit', 'Quantity', 'Buying Price', 'Selling Price'];
  const dataRows = items.map(p => [
    p.product_name || p.name || '',
    p.category_name || '',
    p.variant_name || '',
    p.unit || '',
    p.buy_qty > 0 ? p.buy_qty : '',
    num(p.buying_price),   // never sent to workers, so blank for them
    num(p.selling_price),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  sheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];

  // Amber header row (same look for the Purchases template and the
  // Dashboard low stock Excel). Needs the xlsx-js-style build of SheetJS.
  headers.forEach((_, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { fill: { patternType: 'solid', fgColor: { rgb: 'FFC000' } }, font: { color: { rgb: '000000' } } };
  });

  const instructions = XLSX.utils.aoa_to_sheet([
    ['How to use this template'],
    [''],
    ['1. One row per item you are purchasing.'],
    ['2. "Product Name" is required - it is matched against your existing Product list, or a new one is created if it doesn\'t exist yet.'],
    ['3. "Description" is only for a product that already has types (e.g. "Pen" with Obama Pen, Marker Pen...). Leave it blank for a plain product.'],
    ['4. "Unit", "Quantity" and "Buying Price" are required for every row.'],
    ['5. "Selling Price" and "Category" are optional - leave blank to keep the product\'s existing price/category.'],
    ['6. Delete the two example rows on the "Purchases" tab before uploading, or just overwrite them with your own.'],
    ['7. Save this file, then upload it from the "Import from Excel / CSV" tab on the Purchases page.'],
  ]);
  instructions['!cols'] = [{ wch: 100 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Purchases');
  XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
  XLSX.writeFile(wb, 'eDesk_Low Stock_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

function downloadDashboardExcel() {
  if (!DASHBOARD_DATA) { toast('Please wait for the dashboard to finish loading.', 'error'); return; }
  const d = DASHBOARD_DATA;
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  const rows = [
    ['Sales Today', d.today.total_sales],
    ['Transactions Today', d.today.transactions],
    ['Expenses Today', d.today.total_expenses],
    ...(isAdmin ? [['Damage Loss Today', d.today.total_damage_loss], ['Profit Today', d.today.net_profit]] : []),
    [],
    ['Total Products', d.stock.total_products],
    ['Total Services', d.stock.total_services],
    ['Sales This Month', d.month.total_sales],
    ...(isAdmin ? [['Net Profit This Month', d.month.net_profit]] : []),
    [],
    ['LOW STOCK ALERTS'],
    ['Product', 'Current Stock', 'Reorder Level', 'Unit'],
    ...(d.low_stock_alerts || []).map(p => [p.name, p.stock_quantity, p.reorder_level, p.unit]),
  ];
  exportToExcel('eDESK_Dashboard_' + new Date().toISOString().slice(0, 10) + '.csv', ['Metric', 'Value'], rows);
}



/* =====================================================================
 * Notification bell (top right, after the Download button)
 * One place for everything: overdue debts, debts due today, debts due
 * soon (next 3 days) and low-stock warnings.
 *
 * Only UNREAD notifications are shown. Opening the bell marks what it
 * showed as read; that is remembered per logged-in user (kept in this
 * browser), so it stays gone after logout / login. A notification comes
 * back only when something NEW appears - a different debt, a debt that
 * moved to a later stage (soon -> today -> overdue), or an item that
 * runs low again after being restocked.
 * ===================================================================== */
function notifEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function notifDaysBetween(dateStr, baseStr) {
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(baseStr + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}

function notifStoreKey() {
  const id = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.id) ? CURRENT_USER.id : 'anon';
  return 'edesk_seen_notifs_u' + id;
}
function notifLoadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(notifStoreKey()) || '[]')); } catch (e) { return new Set(); }
}
function notifSaveSeen(set) {
  try { localStorage.setItem(notifStoreKey(), JSON.stringify(Array.from(set))); } catch (e) { /* storage blocked: alerts simply show again next visit */ }
}

function buildNotifications(alerts, lowStock) {
  const today = (DASHBOARD_DATA && DASHBOARD_DATA.shop_today) || new Date().toISOString().slice(0, 10);
  const MAX_SUB = 3;

  // Every individual alert gets a stable key so "seen" can be remembered.
  const tag = (rows, kind, dateOf) => rows.map(r => Object.assign({}, r, {
    _key: `debt:${kind}:${r.sale_id != null ? r.sale_id : (r.customer_name || '?')}:${dateOf(r)}`
  }));
  const groups = [
    { id: 'overdue', sev: 'red',  icon: 'alert-triangle', title: 'Overdue debts',   href: 'debts.html',    cta: 'View Debts',
      rows: tag(alerts.overdue,   'overdue', r => r.deadline || '') },
    { id: 'today',   sev: 'gold', icon: 'coins',          title: 'Debts due today', href: 'debts.html',    cta: 'View Debts',
      rows: tag(alerts.due_today, 'today',   () => today) },
    { id: 'soon',    sev: 'blue', icon: 'calendar',       title: 'Debts due soon',  href: 'debts.html',    cta: 'View Debts',
      rows: tag(alerts.due_soon,  'soon',    r => r.deadline || '') },
    { id: 'stock',   sev: 'red',  icon: 'package',        title: 'Low stock',       href: 'products.html', cta: 'View Stock',
      rows: lowStock.map(p => Object.assign({}, p, { _key: 'stock:' + (p.id != null ? p.id : p.name) })) }
  ];

  // Forget "seen" marks for things that no longer apply (debt paid, item
  // restocked) so they notify again if they ever come back.
  const allKeys = new Set();
  groups.forEach(g => g.rows.forEach(r => allKeys.add(r._key)));
  const seen = new Set(Array.from(notifLoadSeen()).filter(k => allKeys.has(k)));
  notifSaveSeen(seen);

  const bell = document.getElementById('notifBell');
  const badge = document.getElementById('notifBadge');
  const panel = document.getElementById('notifPanel');
  const list = document.getElementById('notifList');
  const count = document.getElementById('notifCount');
  if (!bell || !panel) return;

  const debtRows = (rows, labelFn) => {
    const shown = rows.slice(0, MAX_SUB).map(r =>
      `<li><span>${notifEsc(r.customer_name || 'Customer')} — ${money(r.remaining)}</span><span>${labelFn(r)}</span></li>`).join('');
    const more = rows.length > MAX_SUB ? `<li><span>+ ${rows.length - MAX_SUB} more</span><span></span></li>` : '';
    return `<ul class="notif-sub">${shown}${more}</ul>`;
  };
  const sum = rows => rows.reduce((t, r) => t + (parseFloat(r.remaining) || 0), 0);

  // Build the card for one group using ONLY its unread rows.
  const card = (g, rows) => {
    let text, extra;
    if (g.id === 'overdue') {
      text = `<strong>${rows.length}</strong> debt(s) overdue, totaling <strong>${money(sum(rows))}</strong>`;
      extra = debtRows(rows, r => { const n = Math.abs(notifDaysBetween(r.deadline, today)); return n + ' day' + (n === 1 ? '' : 's') + ' late'; });
    } else if (g.id === 'today') {
      text = `<strong>${rows.length}</strong> debt(s) due today, totaling <strong>${money(sum(rows))}</strong>`;
      extra = debtRows(rows, () => 'today');
    } else if (g.id === 'soon') {
      text = `<strong>${rows.length}</strong> debt(s) due in the next 3 days, totaling <strong>${money(sum(rows))}</strong>`;
      extra = debtRows(rows, r => { const n = notifDaysBetween(r.deadline, today); return 'in ' + n + ' day' + (n === 1 ? '' : 's'); });
    } else {
      text = `<strong>${rows.length}</strong> item(s) are running low and need restocking soon.`;
      const shown = rows.slice(0, MAX_SUB).map(p =>
        `<li><span>${notifEsc(p.name)}</span><span>${notifEsc(p.stock_quantity)} ${notifEsc(p.unit)} left</span></li>`).join('');
      const more = rows.length > MAX_SUB ? `<li><span>+ ${rows.length - MAX_SUB} more</span><span></span></li>` : '';
      extra = `<ul class="notif-sub">${shown}${more}</ul>`;
    }
    return `
      <div class="notif-item sev-${g.sev}">
        <div class="notif-ic"><svg class="ui-icon"><use href="assets/icons.svg#${g.icon}"></use></svg></div>
        <div class="notif-body">
          <div class="notif-title">${g.title}</div>
          <div class="notif-text">${text}</div>
          ${extra}
          <a class="notif-link" href="${g.href}">${g.cta} →</a>
        </div>
      </div>`;
  };

  const emptyHtml = '<div class="notif-empty"><svg class="ui-icon"><use href="assets/icons.svg#bell"></use></svg>No new notifications.<br>You\'re all caught up.</div>';

  // What is unread right now
  let unread = groups.map(g => ({ g, rows: g.rows.filter(r => !seen.has(r._key)) })).filter(x => x.rows.length);
  const unreadKeys = [];
  unread.forEach(x => x.rows.forEach(r => unreadKeys.push(r._key)));

  const showBadge = (n) => {
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : n;
      badge.classList.remove('hidden');
      bell.classList.add('has-alerts');
      count.textContent = n + ' new';
    } else {
      badge.classList.add('hidden');
      bell.classList.remove('has-alerts');
      count.textContent = '';
    }
  };

  list.innerHTML = unread.length ? unread.map(x => card(x.g, x.rows)).join('') : emptyHtml;
  showBadge(unreadKeys.length);

  let markedThisOpen = false;
  const close = () => {
    if (panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    bell.setAttribute('aria-expanded', 'false');
    // Once the person has looked at them, they disappear.
    if (markedThisOpen) { list.innerHTML = emptyHtml; markedThisOpen = false; }
  };
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.classList.contains('hidden')) { close(); return; }
    panel.classList.remove('hidden');
    bell.setAttribute('aria-expanded', 'true');
    if (unreadKeys.length) {
      unreadKeys.forEach(k => seen.add(k));   // mark as read (remembered for this user)
      notifSaveSeen(seen);
      unreadKeys.length = 0;
      markedThisOpen = true;
      showBadge(0);                            // the red number clears as soon as they are seen
    }
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
