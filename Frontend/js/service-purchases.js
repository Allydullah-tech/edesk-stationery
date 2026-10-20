/**
 * Service Purchases page.
 * Products and materials bought to PROVIDE services - a stock of its own,
 * completely separate from Product Purchases (stock bought for direct sale).
 *
 * An item is identified by its name AND its description (e.g. "Pen" + "Obama Pen"), the same
 * way a product + its description works on the Product Purchases page. Every item needs a
 * description. Purchases can be added
 * by hand or imported from an Excel / CSV file.
 */
let SERVICE_STOCK_CACHE = []; // service items: name, unit, stock, price (price for admins only)
let SERVICE_PURCHASES_CACHE = [];
let SP_ROW_COUNTER = 0;

(async function init() {
    const user = await requireAuth();
    if (!user) return;

    document.getElementById('sp-date').value = todayStr();
    document.getElementById('purchaseDateInput').value = todayStr();
    document.getElementById('print-date-sp').textContent = new Date().toLocaleString('en-GB');

    if (user.role === 'admin') {
        document.getElementById('workerPurchaseNote').classList.add('hidden');
        document.getElementById('pf-date').value = todayStr();
        document.getElementById('pf-end').value = todayStr();
        onProfitPeriodChange();
        addPurchaseRow();

        document.getElementById('importDate').value = todayStr();
        document.getElementById('importFile').addEventListener('change', handleServiceFileSelected);
        setServicePurchaseMode('single');
    }

    await loadServiceItems();
    onPurchasePeriodChange();
})();

function todayStr() { return new Date().toISOString().slice(0, 10); }

function escSP(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ========================================================================
   Service items (the names offered while typing a purchase)
   ======================================================================== */
async function loadServiceItems() {
    const res = await API.get('service_purchases.php', { view: 'stock' });
    if (!res.success) { SERVICE_STOCK_CACHE = []; return res; }
    SERVICE_STOCK_CACHE = res.data;
    // One suggestion per item name (the same name can have several descriptions).
    const names = [...new Set(res.data.map(i => i.name.trim()))];
    document.getElementById('spItemNames').innerHTML = names.map(n => `<option value="${escSP(n)}"></option>`).join('');
    document.querySelectorAll('#spRows .sp-row').forEach(refreshRowHint);
    document.querySelectorAll('#importPreviewBody tr').forEach(updateImportRowStatus);
    return res;
}

/** The label shown for an item: "Pen — Obama Pen", or just "Pen" when it has no description. */
function svcLabel(name, description) {
    const d = String(description || '').trim();
    return d ? `${name} — ${d}` : String(name || '');
}

/** Same label, safe for HTML; an older item without a description is flagged so it gets one. */
function svcLabelHtml(name, description) {
    const d = String(description || '').trim();
    return d ? escSP(`${name} — ${d}`) : `${escSP(name)} <span class="muted" style="font-size:12px;">(no description)</span>`;
}

/** Existing service item with exactly this name AND description (case-insensitive), or null. */
function findServiceItem(name, description) {
    const n = String(name || '').trim().toLowerCase();
    const d = String(description || '').trim().toLowerCase();
    return n ? SERVICE_STOCK_CACHE.find(i => i.name.trim().toLowerCase() === n && String(i.description || '').trim().toLowerCase() === d) : null;
}

/** Every existing item that has this name, whatever its description. */
function findItemsByName(name) {
    const n = String(name || '').trim().toLowerCase();
    return n ? SERVICE_STOCK_CACHE.filter(i => i.name.trim().toLowerCase() === n) : [];
}

/** Fills a description <datalist> with the descriptions already used under an item name. */
function fillDescriptionList(listEl, name) {
    const descs = findItemsByName(name).map(i => String(i.description || '').trim()).filter(Boolean);
    listEl.innerHTML = [...new Set(descs)].map(d => `<option value="${escSP(d)}"></option>`).join('');
}

/* ========================================================================
   Add purchase form: one or more item rows, one date
   ======================================================================== */
function addPurchaseRow() {
    const id = ++SP_ROW_COUNTER;
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.dataset.row = id;
    row.style.cssText = 'border:1px solid #e3e6ec;border-radius:8px;padding:10px;margin-bottom:10px;';
    row.innerHTML = `
      <div class="field-row" style="margin-bottom:8px;">
        <div class="field">
          <label>Item Bought</label>
          <input type="text" class="sp-name" list="spItemNames" placeholder="Type an existing item, or a new one..." autocomplete="off">
        </div>
        <div class="field">
          <label>Description</label>
          <input type="text" class="sp-desc" list="spDesc-${id}" placeholder="e.g. Obama Pen" autocomplete="off">
          <datalist id="spDesc-${id}" class="sp-desc-list"></datalist>
        </div>
      </div>
      <p class="help-text sp-hint" style="margin:0 0 8px;"></p>
      <div class="field-row">
        <div class="field">
          <label>Unit</label>
          <input type="text" class="sp-unit" value="pcs">
        </div>
        <div class="field">
          <label>Quantity</label>
          <input type="number" class="sp-qty" min="1" step="1">
        </div>
        <div class="field">
          <label>Buying Price per Unit (TZS)</label>
          <input type="number" class="sp-price" min="0" step="0.01">
        </div>
      </div>
      <div class="flex-between" style="align-items:center;">
        <span class="help-text sp-line" style="margin:0;"></span>
        <button type="button" class="icon-action-btn delete-btn sp-remove" title="Remove this item"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </div>`;
    document.getElementById('spRows').appendChild(row);

    const nameEl = row.querySelector('.sp-name');
    const descEl = row.querySelector('.sp-desc');
    [nameEl, descEl].forEach(el => {
        el.addEventListener('input', () => refreshRowHint(row));
        el.addEventListener('change', () => refreshRowHint(row));
    });
    row.querySelectorAll('.sp-qty, .sp-price').forEach(el => el.addEventListener('input', updatePurchaseTotal));
    row.querySelector('.sp-remove').addEventListener('click', () => {
        if (document.querySelectorAll('#spRows .sp-row').length === 1) {
            // Keep one row on screen: just clear it.
            row.querySelectorAll('input').forEach(i => { i.value = ''; });
            row.querySelector('.sp-unit').value = 'pcs';
            refreshRowHint(row);
        } else {
            row.remove();
        }
        updatePurchaseTotal();
    });
    refreshRowHint(row);
}

// Tells the person whether the typed name + description is an existing service item or a new one.
function refreshRowHint(row) {
    const nameEl = row.querySelector('.sp-name');
    const descEl = row.querySelector('.sp-desc');
    const unitEl = row.querySelector('.sp-unit');
    const hint = row.querySelector('.sp-hint');
    const priceEl = row.querySelector('.sp-price');
    const name = nameEl.value.trim();
    const description = descEl.value.trim();
    const item = findServiceItem(name, description);
    const sameName = findItemsByName(name);

    fillDescriptionList(row.querySelector('.sp-desc-list'), name);

    if (!name) {
        hint.textContent = '';
        unitEl.disabled = false;
        priceEl.placeholder = '';
    } else if (!description) {
        unitEl.disabled = false;
        priceEl.placeholder = '';
        hint.textContent = sameName.some(i => !String(i.description || '').trim())
            ? `Enter the description. "${name}" already exists without one — give it a description from View Service Stock, or type one here to add a new item.`
            : 'Enter the description, e.g. Obama Pen.';
    } else if (item) {
        unitEl.value = item.unit;
        unitEl.disabled = true; // an existing item keeps its unit
        hint.textContent = `Existing service item "${svcLabel(item.name, item.description)}" — ${item.stock_quantity} ${item.unit} in stock now. The quantity you enter is added to it.`;
        priceEl.placeholder = item.buying_price !== undefined ? 'Last price: ' + Number(item.buying_price).toLocaleString('en-US') : '';
    } else if (sameName.length) {
        unitEl.disabled = false;
        const others = sameName.map(i => i.description ? i.description : '(no description)').join(', ');
        hint.textContent = `New description — "${svcLabel(name, description)}" will be created as a separate item in service stock. "${name}" already exists as: ${others}.`;
        priceEl.placeholder = '';
    } else {
        unitEl.disabled = false;
        hint.textContent = 'New item — it will be created in service stock.';
        priceEl.placeholder = '';
    }
    updatePurchaseTotal();
}

function updatePurchaseTotal() {
    let total = 0;
    document.querySelectorAll('#spRows .sp-row').forEach(row => {
        const qty = parseInt(row.querySelector('.sp-qty').value, 10) || 0;
        const price = parseFloat(row.querySelector('.sp-price').value) || 0;
        const line = qty * price;
        total += line;
        row.querySelector('.sp-line').textContent = line > 0 ? 'Line total: ' + money(line) : '';
    });
    document.getElementById('sp-form-total').textContent = money(total);
}

function resetPurchaseForm() {
    document.getElementById('spRows').innerHTML = '';
    document.getElementById('sp-note').value = '';
    document.getElementById('sp-form-error').textContent = '';
    addPurchaseRow();
    updatePurchaseTotal();
}

document.getElementById('servicePurchaseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('sp-form-error');
    errBox.textContent = '';

    const items = [];
    const rows = document.querySelectorAll('#spRows .sp-row');
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = row.querySelector('.sp-name').value.trim();
        const description = row.querySelector('.sp-desc').value.trim();
        const qtyRaw = row.querySelector('.sp-qty').value;
        const priceRaw = row.querySelector('.sp-price').value;
        const unit = row.querySelector('.sp-unit').value.trim() || 'pcs';
        // A completely empty row is ignored.
        if (!name && !description && qtyRaw === '' && priceRaw === '') continue;
        const n = i + 1;
        if (!name) { errBox.textContent = `Item ${n}: enter the item name.`; return; }
        if (!description) { errBox.textContent = `"${name}": enter the description (e.g. Obama Pen).`; return; }
        const shown = svcLabel(name, description);
        if (!qtyRaw || parseInt(qtyRaw, 10) <= 0) { errBox.textContent = `"${shown}": enter a valid quantity.`; return; }
        if (priceRaw === '' || parseFloat(priceRaw) < 0) { errBox.textContent = `"${shown}": enter the buying price per unit.`; return; }
        items.push({ name, description, unit, quantity: parseInt(qtyRaw, 10), buying_price: parseFloat(priceRaw) });
    }
    if (!items.length) { errBox.textContent = 'Add at least one item.'; return; }

    const btn = document.getElementById('spSubmitBtn');
    btn.disabled = true; // stops a double-click from recording the same purchase twice
    const res = await API.post('service_purchases.php', {
        items,
        purchase_date: document.getElementById('sp-date').value,
        note: document.getElementById('sp-note').value.trim(),
    });
    btn.disabled = false;

    if (!res.success) { errBox.textContent = res.message; toast(res.message, 'error'); return; }
    toast(res.message);
    resetPurchaseForm();
    await loadServiceItems();
    loadServicePurchases();
    loadServiceProfit();
});

/* ========================================================================
   Recent service purchases (with period filter)
   ======================================================================== */
function onPurchasePeriodChange() {
    const period = document.getElementById('periodSelect').value;
    document.getElementById('purchaseDateField').classList.toggle('hidden', period === '');
    document.getElementById('purchaseEndField').classList.toggle('hidden', period !== 'custom');
    document.getElementById('purchaseWeekHint').classList.toggle('hidden', period !== 'week');
    const labels = { day: 'Date', week: 'Starting Date', month: 'Any Date in Month', year: 'Any Date in Year', custom: 'Start Date' };
    document.getElementById('purchaseDateLabel').textContent = labels[period] || 'Date';
    loadServicePurchases();
}

async function loadServicePurchases() {
    const tbody = document.getElementById('recentPurchasesBody');
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Loading...</td></tr>';

    const period = document.getElementById('periodSelect').value;
    const params = { limit: 200 };
    if (period) {
        params.period = period;
        params.date = document.getElementById('purchaseDateInput').value;
        const end = document.getElementById('purchaseEndInput').value;
        if (period === 'custom' && end) params.end = end;
    }

    const res = await API.get('service_purchases.php', params);
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="9" class="muted">${escSP(res.message)}</td></tr>`; return; }
    SERVICE_PURCHASES_CACHE = res.data;

    let totalUnits = 0, totalCost = 0;
    const distinct = new Set();
    res.data.forEach(p => {
        totalUnits += Number(p.quantity) || 0;
        totalCost += Number(p.total_cost) || 0;
        distinct.add(p.service_item_id);
    });
    document.getElementById('sp-total-units').textContent = totalUnits;
    document.getElementById('sp-total-types').textContent = distinct.size;
    document.getElementById('sp-total-cost').textContent = money(totalCost);

    if (!res.data.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">No service purchases recorded for this period.</td></tr>'; return; }

    tbody.innerHTML = res.data.map(p => `
    <tr>
      <td>${fmtDate(p.purchase_date)}</td>
      <td>${escSP(p.item_name)}${p.note ? `<div class="help-text" style="margin:2px 0 0;">${escSP(p.note)}</div>` : ''}</td>
      <td>${String(p.item_description || '').trim() ? escSP(p.item_description) : '<span class="muted" style="font-size:12px;">(no description)</span>'}</td>
      <td>${escSP(p.unit)}</td>
      <td>${p.quantity}</td>
      <td class="admin-only">${money(p.buying_price)}</td>
      <td class="admin-only"><strong>${money(p.total_cost)}</strong></td>
      <td>${escSP(p.recorded_by_name)}</td>
      <td class="admin-only no-print">
        <button class="icon-action-btn edit-btn" title="Edit purchase" onclick="openEditPurchase(${p.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        <button class="icon-action-btn delete-btn" title="Delete purchase" onclick="deletePurchase(${p.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </td>
    </tr>`).join('');
    applyRoleVisibility(); // hides Buying Price / Total Cost / Actions for workers
}

function downloadServicePurchasesExcel() {
    const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
    const rows = SERVICE_PURCHASES_CACHE.map(p => [
        p.purchase_date, p.item_name, p.item_description || '', p.unit, p.quantity, ...(isAdmin ? [p.buying_price, p.total_cost] : []), p.recorded_by_name, p.note || '',
    ]);
    const period = document.getElementById('periodSelect').value;
    exportToExcel('eDESK_Service_Purchases' + (period ? '_' + period : '') + '_' + todayStr() + '.csv',
        ['Date', 'Item', 'Description', 'Unit', 'Qty', ...(isAdmin ? ['Buying Price', 'Total Cost'] : []), 'Recorded By', 'Note'], rows);
}

/* ========================================================================
   Edit / delete a recorded service purchase (admin only - the server enforces it too)
   ======================================================================== */
function openEditPurchase(id) {
    const p = SERVICE_PURCHASES_CACHE.find(x => x.id == id);
    if (!p) return;
    document.getElementById('ep-id').value = p.id;
    document.getElementById('ep-qty').value = p.quantity;
    document.getElementById('ep-buying').value = p.buying_price;
    document.getElementById('ep-date').value = p.purchase_date;
    document.getElementById('ep-note').value = p.note || '';
    document.getElementById('editPurchaseContext').textContent =
        `${p.item_label || p.item_name} (${p.unit}) — recorded by ${p.recorded_by_name}. You can fix the quantity, price, date or note. To fix the wrong item, delete this purchase and record it again.`;
    openModal('editPurchaseModal');
}

document.getElementById('editPurchaseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await API.put('service_purchases.php', {
        id: document.getElementById('ep-id').value,
        quantity: document.getElementById('ep-qty').value,
        buying_price: document.getElementById('ep-buying').value,
        purchase_date: document.getElementById('ep-date').value,
        note: document.getElementById('ep-note').value.trim(),
    });
    if (!res.success) { toast(res.message, 'error'); return; }
    toast(res.message);
    closeModal('editPurchaseModal');
    await loadServiceItems();
    loadServicePurchases();
    loadServiceProfit();
});

async function deletePurchase(id) {
    const p = SERVICE_PURCHASES_CACHE.find(x => x.id == id);
    if (!p) return;
    if (!confirm(`Delete this purchase of ${p.quantity} ${p.unit} of "${p.item_label || p.item_name}"?\n\n${p.quantity} will be taken out of service stock.`)) return;
    const res = await API.del('service_purchases.php', { id });
    if (!res.success) { toast(res.message, 'error'); return; }
    toast(res.message);
    await loadServiceItems();
    loadServicePurchases();
    loadServiceProfit();
}

/* ========================================================================
   Service stock overview (button on this page)
   ======================================================================== */
async function openServiceStock() {
    document.getElementById('stockSearch').value = '';
    document.getElementById('serviceStockBody').innerHTML = '<tr><td colspan="9" class="muted">Loading...</td></tr>';
    openModal('serviceStockModal');
    const res = await loadServiceItems(); // always fresh figures
    if (res && res.success === false) {
        document.getElementById('serviceStockBody').innerHTML = `<tr><td colspan="9" class="muted">${escSP(res.message)}</td></tr>`;
        return;
    }
    renderServiceStock();
}

/** Service stock grouped by item name: one group per name (e.g. "Pen"), holding its descriptions. */
function groupServiceStock(items) {
    const map = new Map();
    items.forEach(i => {
        const key = i.name.trim().toLowerCase();
        if (!map.has(key)) map.set(key, { key, name: i.name, items: [] });
        map.get(key).items.push(i);
    });
    return [...map.values()];
}

function sumField(items, f) { return items.reduce((t, i) => t + (Number(i[f]) || 0), 0); }

// "TZS 200 – TZS 500", or a single price when they are all the same (like the Products page).
function priceRange(items) {
    const prices = items.map(i => Number(i.buying_price)).filter(n => !isNaN(n));
    if (!prices.length) return '—';
    const lo = Math.min(...prices), hi = Math.max(...prices);
    return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
}

let OPEN_DESC_GROUP = null; // name key of the group whose descriptions are on screen

function renderServiceStock() {
    const tbody = document.getElementById('serviceStockBody');
    const q = document.getElementById('stockSearch').value.trim().toLowerCase();
    const all = SERVICE_STOCK_CACHE;
    const groups = groupServiceStock(all);
    // A search matches the item name or any of its descriptions.
    const shown = q ? groups.filter(g => g.items.some(i => (i.label || i.name).toLowerCase().includes(q))) : groups;

    document.getElementById('ss-count').textContent = groups.length;
    document.getElementById('ss-out').textContent = all.filter(i => Number(i.stock_quantity) <= 0).length;
    document.getElementById('ss-value').textContent = money(sumField(all, 'stock_value'));

    if (!all.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">No service stock yet. Record a service purchase to add items.</td></tr>'; return; }
    if (!shown.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">No item matches your search.</td></tr>'; return; }

    tbody.innerHTML = shown.map(g => {
        const left = sumField(g.items, 'stock_quantity');
        const outCount = g.items.filter(i => Number(i.stock_quantity) <= 0).length;
        let tag = '';
        if (left <= 0) tag = ' <span class="tag tag-red">Out of stock</span>';
        else if (outCount > 0) tag = ` <span class="tag tag-gold">${outCount} desc${outCount === 1 ? '' : 's'} out</span>`;

        // One item with no description yet: offer to add it. Otherwise open the list of descriptions.
        const onlyBlank = g.items.length === 1 && !String(g.items[0].description || '').trim();
        const descBtn = onlyBlank
            ? `<button type="button" class="btn btn-outline btn-sm" onclick="openItemDescription(${g.items[0].id})">+ Add desc</button>`
            : `<button type="button" class="btn btn-outline btn-sm" onclick="openServiceDescriptions('${escSP(g.key).replace(/'/g, "\\'")}')">${g.items.length} desc${g.items.length === 1 ? '' : 's'} →</button>`;

        const units = [...new Set(g.items.map(i => i.unit))].join(', ');
        const dates = g.items.map(i => i.last_purchase_date).filter(Boolean).sort();
        return `
    <tr>
      <td><strong>${escSP(g.name)}</strong></td>
      <td>${descBtn}</td>
      <td>${escSP(units)}</td>
      <td>${sumField(g.items, 'total_purchased')}</td>
      <td>${sumField(g.items, 'total_used')}</td>
      <td><strong>${left}</strong>${tag}</td>
      <td>${dates.length ? fmtDate(dates[dates.length - 1]) : '—'}</td>
      <td class="admin-only">${priceRange(g.items)}</td>
      <td class="admin-only">${money(sumField(g.items, 'stock_value'))}</td>
    </tr>`;
    }).join('');
    applyRoleVisibility();
}

/* ========================================================================
   Descriptions of one item (like the Descriptions card on the Products page):
   each description has its own stock, price and purchase history.
   ======================================================================== */
function openServiceDescriptions(key) {
    OPEN_DESC_GROUP = key;
    renderServiceDescriptions();
    openModal('serviceDescModal');
}

function renderServiceDescriptions() {
    if (!OPEN_DESC_GROUP) return;
    const items = SERVICE_STOCK_CACHE.filter(i => i.name.trim().toLowerCase() === OPEN_DESC_GROUP);
    if (!items.length) { closeModal('serviceDescModal'); OPEN_DESC_GROUP = null; return; }

    document.getElementById('serviceDescTitle').textContent = 'Descriptions — ' + items[0].name;
    document.getElementById('serviceDescBody').innerHTML = items.map(i => {
        const left = Number(i.stock_quantity);
        const hasDesc = String(i.description || '').trim() !== '';
        const tag = left <= 0 ? ' <span class="tag tag-red">Out of stock</span>' : '';
        return `
    <tr>
      <td>${hasDesc ? `<strong>${escSP(i.description)}</strong>` : '<span class="tag tag-gold">No description</span>'}</td>
      <td>${escSP(i.unit)}</td>
      <td>${i.total_purchased}</td>
      <td>${i.total_used}</td>
      <td><strong>${left}</strong>${tag}</td>
      <td>${i.last_purchase_date ? fmtDate(i.last_purchase_date) : '—'}</td>
      <td class="admin-only">${money(i.buying_price)}</td>
      <td class="admin-only">${money(i.stock_value)}</td>
      <td class="admin-only no-print">
        <button class="icon-action-btn edit-btn" title="${hasDesc ? 'Change description' : 'Add description'}" onclick="openItemDescription(${i.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
      </td>
    </tr>`;
    }).join('');
    applyRoleVisibility();
}

/* ========================================================================
   Give an item its description (older items were bought before descriptions existed)
   ======================================================================== */
function openItemDescription(id) {
    const i = SERVICE_STOCK_CACHE.find(x => x.id == id);
    if (!i) return;
    document.getElementById('idesc-id').value = i.id;
    document.getElementById('idesc-value').value = i.description || '';
    document.getElementById('idesc-error').textContent = '';
    document.getElementById('itemDescContext').textContent =
        `${i.name} (${i.unit}) — ${i.stock_quantity} in stock. Type the description of this item, e.g. "Obama Pen".`;
    openModal('itemDescModal');
    document.getElementById('idesc-value').focus();
}

document.getElementById('itemDescForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('idesc-error');
    errEl.textContent = '';
    const description = document.getElementById('idesc-value').value.trim();
    if (!description) { errEl.textContent = 'Enter the description.'; return; }

    const res = await API.put('service_purchases.php', { item_id: document.getElementById('idesc-id').value, description });
    if (!res.success) { errEl.textContent = res.message; return; }
    toast(res.message);
    closeModal('itemDescModal');
    await loadServiceItems();
    renderServiceStock();
    renderServiceDescriptions();
    loadServicePurchases();
});

function downloadServiceStockExcel() {
    const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
    const rows = SERVICE_STOCK_CACHE.map(i => [
        i.name, i.description || '', i.unit, i.total_purchased, i.total_used, i.stock_quantity, i.last_purchase_date || '',
        ...(isAdmin ? [i.buying_price, i.stock_value] : []),
    ]);
    exportToExcel('eDESK_Service_Stock_' + todayStr() + '.csv',
        ['Item', 'Description', 'Unit', 'Purchased', 'Used in Services', 'Remaining', 'Last Bought', ...(isAdmin ? ['Buying Price', 'Stock Value'] : [])], rows);
}

/* ========================================================================
   Service profit for a period (admin only)
   Service revenue collected - service purchase costs, for the chosen dates.
   ======================================================================== */
function onProfitPeriodChange() {
    const period = document.getElementById('pf-period').value;
    document.getElementById('pf-end-field').classList.toggle('hidden', period !== 'custom');
    const labels = { day: 'Date', week: 'Starting Date', month: 'Any Date in Month', year: 'Any Date in Year', custom: 'Start Date' };
    document.getElementById('pf-date-label').textContent = labels[period] || 'Date';
    loadServiceProfit();
}

async function loadServiceProfit() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'admin') return;
    const period = document.getElementById('pf-period').value;
    const params = { view: 'profit', period, date: document.getElementById('pf-date').value };
    if (period === 'custom') params.end = document.getElementById('pf-end').value;

    const res = await API.get('service_purchases.php', params);
    const profitEl = document.getElementById('pf-profit');
    if (!res.success) {
        document.getElementById('pf-range').textContent = res.message || 'Could not load the service profit.';
        return;
    }
    const d = res.data;
    document.getElementById('pf-range').textContent = `Showing ${fmtDate(d.range.start)} to ${fmtDate(d.range.end)}`;
    document.getElementById('pf-revenue').textContent = money(d.service_revenue);
    document.getElementById('pf-cost').textContent = money(d.purchase_cost);
    profitEl.textContent = money(d.service_profit);
    profitEl.style.color = Number(d.service_profit) < 0 ? 'var(--red)' : 'var(--green)';

    let detail = `${d.service_sales_count} service sale(s) worth ${money(d.service_sales)} in this period; ${d.purchase_count} service purchase(s) costing ${money(d.purchase_cost)}.`;
    if (Number(d.credit_unpaid) > 0) detail += ` ${money(d.credit_unpaid)} of the service sales is still unpaid on credit and is not counted as collected yet.`;
    document.getElementById('pf-detail').textContent = detail;
}

/* ========================================================================
   MODE TOGGLE: add items by hand / import from Excel or CSV (admin only)
   ======================================================================== */
function setServicePurchaseMode(mode) {
    const singleBtn = document.getElementById('modeSingleBtn');
    const importBtn = document.getElementById('modeImportBtn');
    if (!singleBtn || !importBtn) return;
    const single = mode === 'single';
    singleBtn.className = (single ? 'btn btn-primary' : 'btn btn-outline') + ' btn-sm w-full';
    importBtn.className = (single ? 'btn btn-outline' : 'btn btn-primary') + ' btn-sm w-full';
    document.getElementById('addServicePurchaseCard').classList.toggle('hidden', !single);
    document.getElementById('importModeCard').classList.toggle('hidden', single);
}

/* ========================================================================
   Excel / CSV import
   Columns understood: Item Name, Description, Unit, Quantity, Buying Price.
   Items that are not in service stock yet are created when the import is saved.
   ======================================================================== */
let IMPORT_ROW_COUNT = 0;
const IMPORT_COLUMN_ORDER = ['Item Name', 'Description', 'Unit', 'Quantity', 'Buying Price'];

// Downloadable .xlsx starter file with the exact headings the importer matches, two example
// rows and an "Instructions" tab.
async function downloadServiceImportTemplate() {
    if (typeof loadXlsxStyle === 'function') await loadXlsxStyle();
    if (typeof XLSX === 'undefined') {
        toast('The file library could not load - check your internet connection and try again.', 'error');
        return;
    }

    const exampleRows = [
        ['Manila Cover', 'A4 Blue', 'pcs', 50, 500],
        ['Pen', 'Obama Pen', 'pcs', 24, 300],
    ];
    const sheet = XLSX.utils.aoa_to_sheet([IMPORT_COLUMN_ORDER, ...exampleRows]);
    sheet['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
    IMPORT_COLUMN_ORDER.forEach((_, c) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = { fill: { patternType: 'solid', fgColor: { rgb: 'FFC000' } }, font: { color: { rgb: '000000' } } };
    });

    const instructions = XLSX.utils.aoa_to_sheet([
        ['How to use this template'],
        [''],
        ['1. One row per item you are purchasing for services.'],
        ['2. "Item Name" is required. It is matched against your Service Stock, or a new item is created if it is not there yet.'],
        ['3. "Description" is required for every row (e.g. "Pen" with the descriptions "Obama Pen" and "Marker Pen"). Each description has its own stock and buying price.'],
        ['4. "Unit", "Quantity" and "Buying Price" (price per unit) are required for every row. An existing item keeps the unit it already has.'],
        ['5. Delete the two example rows on the "Service Purchases" tab before uploading, or just overwrite them with your own.'],
        ['6. Save this file, then upload it from the "Import from Excel / CSV" button on the Service Purchases page.'],
    ]);
    instructions['!cols'] = [{ wch: 110 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Service Purchases');
    XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
    XLSX.writeFile(wb, 'eDESK_Service_Purchase_Import_Template.xlsx');
}

// First column heading that contains one of the keywords and none of the excluded words.
function svcFindColumn(row, keywords, exclude) {
    exclude = exclude || [];
    for (const k of Object.keys(row)) {
        const lower = k.toLowerCase();
        if (keywords.some(kw => lower.includes(kw)) && !exclude.some(ex => lower.includes(ex))) return k;
    }
    return null;
}

// "15,000" / " 300 " / 300 -> 300; anything that is not a number -> ''.
function svcNumber(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
    return isNaN(n) ? '' : n;
}

function handleServiceFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('importStatus');

    if (typeof XLSX === 'undefined') {
        statusEl.innerHTML = '<div class="msg error-box show">The file-reading library could not load - this needs an internet connection the first time. Please check your connection and try again.</div>';
        return;
    }
    statusEl.innerHTML = '<p class="help-text mt-8">Reading file...</p>';

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            let json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            // Damaged headings (e.g. the same heading copied across several columns): read the
            // columns in the template's own order instead of by heading.
            let headingsFixed = false;
            if (json.length) {
                const probe = json[0];
                const nameLikeCount = Object.keys(probe).filter(k => /item|name|product/i.test(k)).length;
                if (nameLikeCount >= 2 && !svcFindColumn(probe, ['qty', 'quantity']) && !svcFindColumn(probe, ['buy', 'cost'])) {
                    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                    if (raw.length > 1 && raw[0].length >= 4) {
                        json = raw.slice(1).map(cells => {
                            const o = {};
                            IMPORT_COLUMN_ORDER.forEach((h, i) => { o[h] = cells[i] === undefined ? '' : cells[i]; });
                            return o;
                        });
                        headingsFixed = true;
                    }
                }
            }

            if (!json.length) {
                statusEl.innerHTML = '<div class="msg error-box show">The file appears to be empty.</div>';
                return;
            }

            const parsedRows = json.map(row => {
                const descKey = svcFindColumn(row, ['desc', 'variant', 'type']); // 'desc' also catches typos like "Descripton"
                const nameKey = svcFindColumn(row, ['item', 'name', 'product'], ['desc', 'variant', 'type', 'unit', 'price', 'qty', 'quantity']);
                const qtyKey = svcFindColumn(row, ['qty', 'quantity']);
                const buyKey = svcFindColumn(row, ['buy', 'cost']);
                // No explicit buying column: fall back to any generic money column ("Price", "Amount", "Rate").
                const priceKey = !buyKey ? svcFindColumn(row, ['price', 'amount', 'rate']) : null;
                const unitKey = svcFindColumn(row, ['unit', 'uom'], ['price', 'cost', 'amount', 'rate']);

                return {
                    name: nameKey ? String(row[nameKey]).trim() : '',
                    description: descKey ? String(row[descKey]).trim() : '',
                    unit: unitKey && String(row[unitKey]).trim() ? String(row[unitKey]).trim() : 'pcs',
                    quantity: qtyKey ? svcNumber(row[qtyKey]) : '',
                    buying_price: buyKey ? svcNumber(row[buyKey]) : (priceKey ? svcNumber(row[priceKey]) : ''),
                };
            }).filter(r => r.name || r.quantity !== '');

            if (!parsedRows.length) {
                statusEl.innerHTML = '<div class="msg error-box show">Couldn\'t find any item rows in that file. You can also add rows manually in the Review table.</div>';
            } else {
                statusEl.innerHTML = `<p class="help-text mt-8">Found ${parsedRows.length} row(s). Review them below, then confirm.</p>` +
                    (headingsFixed ? '<p class="help-text warn" style="margin-top:4px;">The column headings in this file were not recognised, so the columns were read in the template order (Item Name, Description, Unit, Quantity, Buying Price). Please check the table below.</p>' : '');
            }
            renderImportPreview(parsedRows);
        } catch (err) {
            statusEl.innerHTML = '<div class="msg error-box show">Could not read that file. Please make sure it is a valid .xlsx or .csv file.</div>';
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderImportPreview(rows) {
    document.getElementById('importPreviewBody').innerHTML = '';
    IMPORT_ROW_COUNT = 0;
    rows.forEach(r => addImportRow(r));
    document.getElementById('importPreviewWrap').classList.remove('hidden');
    updateImportTotal();
}

function addBlankImportRow() {
    addImportRow({ name: '', description: '', unit: 'pcs', quantity: '', buying_price: '' });
    document.getElementById('importPreviewWrap').classList.remove('hidden');
}

function addImportRow(r) {
    const idx = IMPORT_ROW_COUNT++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
    <td><input type="text" class="imp-name" list="spItemNames" value="${escSP(r.name)}" style="min-width:150px;" autocomplete="off"></td>
    <td><input type="text" class="imp-desc" list="impDesc-${idx}" value="${escSP(r.description)}" placeholder="required" style="min-width:130px;" autocomplete="off"><datalist id="impDesc-${idx}" class="imp-desc-list"></datalist></td>
    <td><input type="text" class="imp-unit" value="${escSP(r.unit || 'pcs')}" style="width:70px;"></td>
    <td><input type="number" class="imp-qty" min="0" step="1" value="${escSP(r.quantity)}" style="width:80px;"></td>
    <td><input type="number" class="imp-buying" min="0" step="0.01" value="${escSP(r.buying_price)}" style="width:110px;"></td>
    <td class="imp-status"></td>
    <td><button type="button" class="icon-action-btn delete-btn" title="Remove row"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button></td>`;
    document.getElementById('importPreviewBody').appendChild(tr);

    tr.querySelectorAll('.imp-name, .imp-desc').forEach(el => {
        el.addEventListener('input', () => updateImportRowStatus(tr));
        el.addEventListener('change', () => updateImportRowStatus(tr));
    });
    tr.querySelectorAll('.imp-qty, .imp-buying').forEach(el => el.addEventListener('input', updateImportTotal));
    tr.querySelector('.delete-btn').addEventListener('click', () => { tr.remove(); updateImportTotal(); refreshImportMessage(); });
    updateImportRowStatus(tr);
}

// Existing item (same name + description) / new description under an existing name / brand new item.
function updateImportRowStatus(tr) {
    const name = tr.querySelector('.imp-name').value.trim();
    const description = tr.querySelector('.imp-desc').value.trim();
    const unitEl = tr.querySelector('.imp-unit');
    const statusCell = tr.querySelector('.imp-status');
    const item = findServiceItem(name, description);

    fillDescriptionList(tr.querySelector('.imp-desc-list'), name);

    if (!name) {
        statusCell.innerHTML = '<span class="tag tag-gray">—</span>';
        unitEl.disabled = false;
    } else if (!description) {
        unitEl.disabled = false;
        statusCell.innerHTML = '<span class="tag tag-red">Description required</span>';
    } else if (item) {
        unitEl.value = item.unit;
        unitEl.disabled = true; // an existing item keeps its unit
        statusCell.innerHTML = `<span class="tag tag-green">Existing</span><div class="help-text" style="margin:2px 0 0;">${item.stock_quantity} ${escSP(item.unit)} in stock</div>`;
    } else if (findItemsByName(name).length) {
        unitEl.disabled = false;
        statusCell.innerHTML = '<span class="tag tag-gold">New description</span>';
    } else {
        unitEl.disabled = false;
        statusCell.innerHTML = '<span class="tag tag-gold">New item</span>';
    }
}

function updateImportTotal() {
    let total = 0;
    document.querySelectorAll('#importPreviewBody tr').forEach(tr => {
        const qty = parseInt(tr.querySelector('.imp-qty').value, 10) || 0;
        const price = parseFloat(tr.querySelector('.imp-buying').value) || 0;
        total += qty * price;
    });
    document.getElementById('importTotal').textContent = money(total);
}

function refreshImportMessage() {
    if (!document.querySelectorAll('#importPreviewBody tr').length) document.getElementById('importValidationMsg').textContent = '';
}

async function confirmServiceImport() {
    const msgEl = document.getElementById('importValidationMsg');
    msgEl.textContent = '';
    const rows = Array.from(document.querySelectorAll('#importPreviewBody tr'));
    if (!rows.length) { msgEl.textContent = 'Add at least one row first.'; return; }

    const items = [];
    for (let i = 0; i < rows.length; i++) {
        const tr = rows[i];
        const name = tr.querySelector('.imp-name').value.trim();
        const description = tr.querySelector('.imp-desc').value.trim();
        const unit = tr.querySelector('.imp-unit').value.trim() || 'pcs';
        const qty = tr.querySelector('.imp-qty').value;
        const price = tr.querySelector('.imp-buying').value;
        const n = i + 1;
        const shown = svcLabel(name, description);

        if (!name) { msgEl.textContent = `Row ${n}: enter the item name.`; return; }
        if (!description) { msgEl.textContent = `Row ${n} (${name}): enter the description (e.g. Obama Pen).`; return; }
        if (!qty || parseInt(qty, 10) <= 0) { msgEl.textContent = `Row ${n} (${shown}): enter a valid quantity.`; return; }
        if (price === '' || parseFloat(price) < 0) { msgEl.textContent = `Row ${n} (${shown}): enter the buying price per unit.`; return; }
        items.push({ name, description, unit, quantity: parseInt(qty, 10), buying_price: parseFloat(price) });
    }

    const btn = document.getElementById('confirmImportBtn');
    btn.disabled = true; // stops a double-click from saving the same import twice
    btn.textContent = 'Saving...';
    const res = await API.post('service_purchases.php', {
        items,
        source: 'import',
        purchase_date: document.getElementById('importDate').value,
        note: document.getElementById('importNote').value.trim(),
    });
    btn.disabled = false;
    btn.textContent = 'Confirm & Save All to Service Stock';

    if (!res.success) { msgEl.textContent = res.message; toast(res.message, 'error'); return; }
    toast(res.message);

    // Back to a clean import form, then refresh everything on the page.
    document.getElementById('importPreviewBody').innerHTML = '';
    document.getElementById('importPreviewWrap').classList.add('hidden');
    document.getElementById('importStatus').innerHTML = '';
    document.getElementById('importFile').value = '';
    document.getElementById('importNote').value = '';
    updateImportTotal();
    await loadServiceItems();
    loadServicePurchases();
    loadServiceProfit();
}
