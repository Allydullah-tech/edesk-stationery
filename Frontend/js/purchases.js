let PURCHASE_PRODUCTS = [];
let PURCHASE_NAME_MAP = {}; // lowercase name -> product
let PURCHASE_VARIANTS_CACHE = {}; // product id -> that product's active types
let PURCHASE_MODE = 'single';
let SELECTED_PURCHASE_PRODUCT = null;
let SINGLE_TYPE_OPTIONS = [];
let SP_HIGHLIGHT_INDEX = -1;
let SP_MATCHES = [];
let QUICK_ADD_CALLBACK = null;

(async function init() {
    const user = await requireAuth();
    document.getElementById('sp-date').value = todayStr();
    document.getElementById('importDate').value = todayStr();
    document.getElementById('purchaseDateInput').value = todayStr();
    document.getElementById('periodSelect').addEventListener('change', onPurchasePeriodChange);

    if (user && user.role === 'admin') {
        document.getElementById('workerPurchaseNote').classList.add('hidden');
    }

    await loadProductsForMatching();
    onPurchasePeriodChange();

    setupSingleProductSearch();
    document.getElementById('importFile').addEventListener('change', handleFileSelected);
})();

function todayStr() { return new Date().toISOString().slice(0, 10); }

/**
 * Mirrors the Reports page: toggle the date/end fields and swap the date
 * label depending on the chosen period, then reload the filtered list.
 */
function onPurchasePeriodChange() {
    const period = document.getElementById('periodSelect').value;
    const dateField = document.getElementById('purchaseDateField');
    const endField = document.getElementById('purchaseEndField');
    const weekHint = document.getElementById('purchaseWeekHint');
    const label = document.getElementById('purchaseDateLabel');

    dateField.classList.toggle('hidden', period === '');
    endField.classList.toggle('hidden', period !== 'custom');
    weekHint.classList.toggle('hidden', period !== 'week');

    const labels = { day: 'Date', week: 'Starting Date', month: 'Any Date in Month', year: 'Any Date in Year', custom: 'Start Date' };
    label.textContent = labels[period] || 'Date';

    loadRecentPurchases();
}

async function loadProductsForMatching() {
    // Purchases only ever deal with physical stock, never services -
    // so matching is scoped to products only (type 0).
    const res = await API.get('products.php', { type: '0' });
    if (!res.success) return;
    PURCHASE_PRODUCTS = res.data;
    PURCHASE_NAME_MAP = {};
    res.data.forEach(p => { PURCHASE_NAME_MAP[p.name.trim().toLowerCase()] = p; });
    PURCHASE_VARIANTS_CACHE = {};
}

/**
 * A product's types rarely change while this page is open, so they're
 * fetched once per product and reused for both the single-product form
 * and the Excel import review table.
 */
async function getVariantsForProduct(productId) {
    if (PURCHASE_VARIANTS_CACHE[productId]) return PURCHASE_VARIANTS_CACHE[productId];
    const res = await API.get('product_variants.php', { product_id: productId });
    const variants = res.success ? res.data.filter(v => v.status === 'active') : [];
    PURCHASE_VARIANTS_CACHE[productId] = variants;
    return variants;
}

let RECENT_PURCHASES_CACHE = [];

async function loadRecentPurchases() {
    const tbody = document.getElementById('recentPurchasesBody');
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Loading...</td></tr>';

    const source = document.getElementById('sourceFilter').value;
    const period = document.getElementById('periodSelect').value;
    const date = document.getElementById('purchaseDateInput').value;
    const end = document.getElementById('purchaseEndInput').value;

    const params = { limit: 50 };
    if (source) params.source = source;
    if (period) {
        params.period = period;
        params.date = date;
        if (period === 'custom' && end) params.end = end;
    }

    const titleMap = { '': 'Purchases', manual: 'Manual Purchases', import: 'Imported Purchases' };
    document.getElementById('purchasesReportTitle').textContent = titleMap[source];
    document.getElementById('print-date-purchases').textContent = new Date().toLocaleString('en-GB');

    const res = await API.get('purchases.php', params);
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="8" class="muted">${res.message}</td></tr>`; return; }

    RECENT_PURCHASES_CACHE = res.data;

    let totalUnits = 0,
        totalCost = 0;
    const distinctProducts = new Set();
    res.data.forEach(p => {
        totalUnits += Number(p.quantity) || 0;
        totalCost += Number(p.total_cost) || 0;
        distinctProducts.add(p.variant_id ? 'v' + p.variant_id : 'p' + p.product_id);
    });
    document.getElementById('pu-total-units').textContent = totalUnits;
    document.getElementById('pu-total-types').textContent = distinctProducts.size;
    document.getElementById('pu-total-cost').textContent = money(totalCost);

    if (!res.data.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">No purchases recorded yet.</td></tr>'; return; }

    // product_name/unit from the API already fold in the type name (e.g.
    // "Pen — Obama Pen") so this table needs no other changes.
    tbody.innerHTML = res.data.map(p => `
    <tr>
      <td>${fmtDate(p.purchase_date)}</td>
      <td>${p.product_name}</td>
      <td>${p.unit}</td>
      <td>${p.quantity}</td>
      <td>${money(p.buying_price)}</td>
      <td><strong>${money(p.total_cost)}</strong></td>
      <td>${p.source === 'import' ? '<span class="tag tag-gold">Imported</span>' : '<span class="tag tag-gray">Manual</span>'}</td>
      <td>${p.recorded_by_name}</td>
    </tr>`).join('');
}

function downloadPurchasesExcel() {
    const rows = RECENT_PURCHASES_CACHE.map(p => [
        p.purchase_date, p.product_name, p.unit, p.quantity, p.buying_price, p.total_cost,
        p.source === 'import' ? 'Imported' : 'Manual', p.recorded_by_name,
    ]);
    const source = document.getElementById('sourceFilter').value;
    const period = document.getElementById('periodSelect').value;
    let suffix = source ? '_' + source : '';
    if (period) suffix += '_' + period;
    exportToExcel('eDESK_Purchases' + suffix + '_' + todayStr() + '.csv', ['Date', 'Product', 'Unit', 'Qty', 'Buying Price', 'Total Cost', 'Source', 'Recorded By'], rows);
}

/* ========================================================================
   MODE TOGGLE
   ======================================================================== */
function setPurchaseMode(mode) {
    PURCHASE_MODE = mode;
    const singleBtn = document.getElementById('modeSingleBtn');
    const importBtn = document.getElementById('modeImportBtn');
    const singleCard = document.getElementById('singleModeCard');
    const importCard = document.getElementById('importModeCard');

    if (mode === 'single') {
        singleBtn.className = 'btn btn-primary btn-sm w-full';
        importBtn.className = 'btn btn-outline btn-sm w-full';
        singleCard.classList.remove('hidden');
        importCard.classList.add('hidden');
    } else {
        singleBtn.className = 'btn btn-outline btn-sm w-full';
        importBtn.className = 'btn btn-primary btn-sm w-full';
        singleCard.classList.add('hidden');
        importCard.classList.remove('hidden');
    }
}
setPurchaseMode('single');

/* ========================================================================
   MODE 1: Single product - type-to-search + add
   ======================================================================== */
function setupSingleProductSearch() {
    const input = document.getElementById('sp-name');
    const list = document.getElementById('sp-suggestions');

    input.addEventListener('input', () => {
        SELECTED_PURCHASE_PRODUCT = null;
        renderSingleSuggestions(input.value.trim());
        updateMatchHint(input.value.trim());
        clearSingleValidation();
        refreshSingleTypeField(PURCHASE_NAME_MAP[input.value.trim().toLowerCase()] || null);
    });

    input.addEventListener('focus', () => {
        if (input.value.trim()) renderSingleSuggestions(input.value.trim());
    });

    input.addEventListener('keydown', (e) => {
        if (list.classList.contains('hidden') || !SP_MATCHES.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault();
            SP_HIGHLIGHT_INDEX = Math.min(SP_HIGHLIGHT_INDEX + 1, SP_MATCHES.length - 1);
            paintSpHighlight(); } else if (e.key === 'ArrowUp') { e.preventDefault();
            SP_HIGHLIGHT_INDEX = Math.max(SP_HIGHLIGHT_INDEX - 1, 0);
            paintSpHighlight(); } else if (e.key === 'Enter' && SP_HIGHLIGHT_INDEX >= 0) { e.preventDefault();
            selectSingleProduct(SP_MATCHES[SP_HIGHLIGHT_INDEX].id); } else if (e.key === 'Escape') { list.classList.add('hidden'); }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.autocomplete')) list.classList.add('hidden');
    });

    document.getElementById('sp-variant-name').addEventListener('input', () => {
        if (SELECTED_PURCHASE_PRODUCT) updateVariantHint(SELECTED_PURCHASE_PRODUCT, SINGLE_TYPE_OPTIONS);
    });
}

function renderSingleSuggestions(query) {
    const list = document.getElementById('sp-suggestions');
    if (!query) { list.classList.add('hidden'); return; }
    const q = query.toLowerCase();
    SP_MATCHES = PURCHASE_PRODUCTS.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
    SP_HIGHLIGHT_INDEX = -1;

    if (!SP_MATCHES.length) { list.classList.add('hidden'); return; }

    list.innerHTML = SP_MATCHES.map((p, i) => `
    <div class="autocomplete-item" data-id="${p.id}">
      <span class="name">${p.name}</span>
      <span class="meta">${p.is_service == 1 ? 'Service' : (Number(p.variant_count) > 0 ? p.variant_count + ' type(s)' : p.stock_quantity + ' ' + p.unit + ' in stock')}</span>
    </div>`).join('');

    list.querySelectorAll('.autocomplete-item').forEach(el => {
        el.addEventListener('click', () => selectSingleProduct(el.dataset.id));
    });
    list.classList.remove('hidden');
}

function paintSpHighlight() {
    document.querySelectorAll('#sp-suggestions .autocomplete-item').forEach((el, i) => el.classList.toggle('highlighted', i === SP_HIGHLIGHT_INDEX));
}

function selectSingleProduct(id) {
    const p = PURCHASE_PRODUCTS.find(x => x.id == id);
    if (!p) return;
    SELECTED_PURCHASE_PRODUCT = p;
    document.getElementById('sp-name').value = p.name;
    document.getElementById('sp-suggestions').classList.add('hidden');
    document.getElementById('sp-unit').value = p.unit;
    updateMatchHint(p.name);
    clearSingleValidation();
    refreshSingleTypeField(p);
}

function updateMatchHint(name) {
    const match = PURCHASE_NAME_MAP[name.trim().toLowerCase()];
    const hint = document.getElementById('sp-match-hint');
    const buyingHint = document.getElementById('sp-buying-hint');
    const sellingHint = document.getElementById('sp-selling-hint');

    if (match) {
        hint.innerHTML = `<span class="tag tag-green">Existing product</span> Currently ${match.stock_quantity} ${match.unit} in stock. This purchase will add to that.`;
        buyingHint.textContent = `Leave blank to keep the current buying price (${money(match.buying_price)}).`;
        sellingHint.textContent = `Leave blank to keep the current selling price (${money(match.selling_price)}).`;
    } else if (name) {
        hint.innerHTML = '<span class="tag tag-gold">New</span> <button type="button" class="btn btn-outline btn-sm" onclick="quickAddSingleProduct()">+ Add to List</button>';
        buyingHint.textContent = 'Required for a new product.';
        sellingHint.textContent = 'Required for a new product.';
    } else {
        hint.textContent = '';
        buyingHint.textContent = 'Required for a new product. Leave blank on an existing product to keep its current price.';
        sellingHint.textContent = 'Required for a new product. Leave blank on an existing product to keep its current price.';
    }
}

/**
 * Shows/hides the "Type" field for the single-purchase form. Only
 * relevant once the matched product already has at least one type -
 * a product that doesn't have types yet keeps being restocked directly,
 * exactly as before. Adding a product's FIRST type is still done from
 * the Products page, not from here.
 */
async function refreshSingleTypeField(product) {
    const field = document.getElementById('sp-variant-field');
    const datalist = document.getElementById('sp-variant-datalist');
    const nameInput = document.getElementById('sp-variant-name');

    if (!product || product.is_service || Number(product.variant_count) === 0) {
        field.classList.add('hidden');
        nameInput.value = '';
        SINGLE_TYPE_OPTIONS = [];
        return;
    }

    field.classList.remove('hidden');
    SINGLE_TYPE_OPTIONS = await getVariantsForProduct(product.id);
    datalist.innerHTML = SINGLE_TYPE_OPTIONS.map(v => `<option value="${escapeAttr(v.variant_name)}">`).join('');
    updateVariantHint(product, SINGLE_TYPE_OPTIONS);
}

function updateVariantHint(product, variants) {
    const name = document.getElementById('sp-variant-name').value.trim();
    const hint = document.getElementById('sp-variant-hint');
    const match = variants.find(v => v.variant_name.toLowerCase() === name.toLowerCase());

    if (!name) {
        hint.textContent = `"${product.name}" has types — pick an existing one from the list, or type a new type name.`;
    } else if (match) {
        hint.innerHTML = `<span class="tag tag-green">Existing type</span> Currently ${match.stock_quantity} ${match.unit} in stock. This purchase will add to that.`;
    } else {
        hint.innerHTML = `<span class="tag tag-gold">New type</span> "${name}" will be added as a new type under "${product.name}". Buying Price and Selling Price are required for a new type.`;
    }
}

/**
 * Triggered by the inline "+ Add to List" button next to the name field -
 * same pattern as the Excel import review table. Just registers the name
 * in the Product List; the person still clicks "Save Purchase" afterward.
 */
function quickAddSingleProduct() {
    const name = document.getElementById('sp-name').value.trim();
    if (!name) return;
    const category = document.getElementById('sp-category').value.trim();
    const unit = document.getElementById('sp-unit').value.trim() || 'pcs';
    openQuickAddModal(name, category, unit, () => { updateMatchHint(name);
        clearSingleValidation(); });
}

/* ========================================================================
   Quick "Add to Product List" card - replaces the browser's native
   confirm() popup. Reused by both the single-purchase flow and the
   Excel-import review table's per-row "+ Add to List" buttons.
   ======================================================================== */
function openQuickAddModal(name, category, unit, onSuccess) {
    document.getElementById('qa-name').value = name;
    document.getElementById('qa-category').value = category || '';
    document.getElementById('qa-unit').value = unit || 'pcs';
    document.getElementById('quickAddContext').innerHTML =
        `<strong>"${name}"</strong> isn't in your Product List yet. Add it now, then continue.`;
    QUICK_ADD_CALLBACK = onSuccess;
    openModal('quickAddModal');
}

document.getElementById('quickAddForm').addEventListener('submit', async(e) => {
    e.preventDefault();
    const name = document.getElementById('qa-name').value.trim();
    const category = document.getElementById('qa-category').value.trim();
    const unit = document.getElementById('qa-unit').value.trim() || 'pcs';
    if (!name) { toast('Please enter a product name.', 'error'); return; }

    const res = await API.post('products.php', { name, category_name: category, unit, is_service: 0 });
    if (!res.success) { toast(res.message, 'error'); return; }

    await loadProductsForMatching();
    toast(name + ' added to your Product List.');
    closeModal('quickAddModal');

    if (QUICK_ADD_CALLBACK) {
        const cb = QUICK_ADD_CALLBACK;
        QUICK_ADD_CALLBACK = null;
        cb();
    }
});

/**
 * Small, professional inline validation text (red, no background box) -
 * replaces the old large toast. Identifies every offending row by number,
 * e.g. "Row 1, add product to list first" or, for several rows,
 * "Row 1, Row 3, Row 7, add product to list first".
 */
function showSingleValidation(msg) {
    let el = document.getElementById('sp-row-error');
    if (!el) {
        el = document.createElement('p');
        el.id = 'sp-row-error';
        el.className = 'row-error';
        document.getElementById('sp-match-hint').insertAdjacentElement('afterend', el);
    }
    el.textContent = msg;
}

function clearSingleValidation() {
    const el = document.getElementById('sp-row-error');
    if (el) el.textContent = '';
}

document.getElementById('singleForm').addEventListener('submit', async(e) => {
    e.preventDefault();

    const name = document.getElementById('sp-name').value.trim();
    if (!name) { showSingleValidation('Add product to list first'); return; }

    const match = PURCHASE_NAME_MAP[name.toLowerCase()];
    if (!match) {
        showSingleValidation('Add product to list first');
        return;
    }

    if (Number(match.variant_count) > 0 && !document.getElementById('sp-variant-name').value.trim()) {
        showSingleValidation(`"${match.name}" has types — pick an existing type or type a new type name first.`);
        return;
    }

    clearSingleValidation();
    await submitSinglePurchase(name);
});

async function submitSinglePurchase(name) {
    const item = {
        name,
        variant_name: document.getElementById('sp-variant-field').classList.contains('hidden') ? '' : document.getElementById('sp-variant-name').value.trim(),
        quantity: document.getElementById('sp-qty').value,
        unit: document.getElementById('sp-unit').value.trim() || 'pcs',
        buying_price: document.getElementById('sp-buying').value,
        selling_price: document.getElementById('sp-selling').value,
        category: document.getElementById('sp-category').value.trim(),
    };

    const res = await API.post('purchases.php', {
        items: [item],
        source: 'manual',
        purchase_date: document.getElementById('sp-date').value,
    });

    if (!res.success) {
        toast(res.message, 'error');
        return;
    }

    sessionStorage.setItem('flashMessage', res.message);
    window.location.href = 'products.html';
}

/* ========================================================================
   MODE 2: Excel / CSV import
   ======================================================================== */
let IMPORT_ROW_COUNT = 0;

function findColumn(row, keywords) {
    const keys = Object.keys(row);
    for (const k of keys) {
        const lower = k.toLowerCase();
        if (keywords.some(kw => lower.includes(kw))) return k;
    }
    return null;
}

function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('importStatus');

    if (typeof XLSX === 'undefined') {
        statusEl.innerHTML = '<div class="msg error-box show">The file-reading library could not load - this needs an internet connection the first time. Please check your connection and try again, or ask your supplier for a plain CSV file.</div>';
        return;
    }

    statusEl.innerHTML = '<p class="help-text mt-8">Reading file...</p>';

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = new Uint8Array(evt.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (!json.length) {
                statusEl.innerHTML = '<div class="msg error-box show">The file appears to be empty.</div>';
                return;
            }

            const parsedRows = json.map(row => {
                const nameKey = findColumn(row, ['product', 'name', 'item']);
                const typeKey = findColumn(row, ['type', 'variant']);
                const qtyKey = findColumn(row, ['qty', 'quantity']);
                const buyKey = findColumn(row, ['buy', 'cost']);
                const sellKey = findColumn(row, ['sell', 'retail']);
                // If there's no explicit buy/sell column, fall back to any generic
                // money column - "Price", "Amount", "Rate" - and treat it as the
                // buying price, since a supplier's file is what YOU pay them.
                const priceKey = (!buyKey && !sellKey) ? findColumn(row, ['price', 'amount', 'rate']) : null;
                const catKey = findColumn(row, ['category', 'group']);
                const unitKey = findColumn(row, ['unit', 'uom']);

                return {
                    name: nameKey ? String(row[nameKey]).trim() : '',
                    variant_name: typeKey ? String(row[typeKey]).trim() : '',
                    quantity: qtyKey ? row[qtyKey] : '',
                    buying_price: buyKey ? row[buyKey] : (priceKey ? row[priceKey] : ''),
                    selling_price: sellKey ? row[sellKey] : '',
                    category: catKey ? String(row[catKey]).trim() : '',
                    unit: unitKey ? String(row[unitKey]).trim() : 'pcs',
                };
            }).filter(r => r.name || r.quantity);

            if (!parsedRows.length) {
                statusEl.innerHTML = '<div class="msg error-box show">Couldn\'t find any product rows in that file. Check the Review table appears - you can also add rows manually.</div>';
            } else {
                statusEl.innerHTML = `<p class="help-text mt-8">Found ${parsedRows.length} row(s). Review and complete the missing prices below, then confirm.</p>`;
            }

            renderImportPreview(parsedRows);
        } catch (err) {
            statusEl.innerHTML = '<div class="msg error-box show">Could not read that file. Please make sure it is a valid .xlsx or .csv file.</div>';
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderImportPreview(rows) {
    const tbody = document.getElementById('importPreviewBody');
    tbody.innerHTML = '';
    IMPORT_ROW_COUNT = 0;
    rows.forEach(r => addImportRow(r));
    document.getElementById('importPreviewWrap').classList.remove('hidden');
}

function addBlankImportRow() {
    addImportRow({ name: '', variant_name: '', quantity: '', buying_price: '', selling_price: '', category: '', unit: 'pcs' });
    document.getElementById('importPreviewWrap').classList.remove('hidden');
}

function addImportRow(r) {
    const idx = IMPORT_ROW_COUNT++;
    const tbody = document.getElementById('importPreviewBody');
    const tr = document.createElement('tr');
    tr.dataset.rowId = idx;
    tr.innerHTML = `
    <td><input type="text" class="imp-name" value="${escapeAttr(r.name)}" style="min-width:150px;"></td>
    <td><input type="text" class="imp-type" value="${escapeAttr(r.variant_name)}" placeholder="only if it has types" style="min-width:130px;"></td>
    <td><input type="text" class="imp-unit" value="${escapeAttr(r.unit || 'pcs')}" style="width:70px;"></td>
    <td><input type="number" class="imp-qty" min="0" step="1" value="${escapeAttr(r.quantity)}" style="width:80px;"></td>
    <td><input type="number" class="imp-buying" min="0" step="0.01" value="${escapeAttr(r.buying_price)}" style="width:100px;"></td>
    <td><input type="number" class="imp-selling" min="0" step="0.01" value="${escapeAttr(r.selling_price)}" style="width:100px;"></td>
    <td><input type="text" class="imp-category" value="${escapeAttr(r.category)}" style="width:110px;"></td>
    <td class="imp-status"></td>
    <td><button type="button" class="icon-action-btn delete-btn" title="Remove row" onclick="this.closest('tr').remove()"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button></td>
  `;
    tbody.appendChild(tr);

    const nameInput = tr.querySelector('.imp-name');
    const typeInput = tr.querySelector('.imp-type');
    const refreshStatus = () => updateImportRowStatus(tr);
    nameInput.addEventListener('input', refreshStatus);
    typeInput.addEventListener('input', refreshStatus);
    refreshStatus();
}

function updateImportRowStatus(tr) {
    const name = tr.querySelector('.imp-name').value.trim();
    const typeName = tr.querySelector('.imp-type').value.trim();
    const statusCell = tr.querySelector('.imp-status');
    const match = PURCHASE_NAME_MAP[name.toLowerCase()];

    // Clear any previous "Row N, add product to list first" message for this
    // row now that it's being retyped.
    const rowErr = tr.querySelector('.row-error');
    if (rowErr) rowErr.remove();

    if (!name) {
        statusCell.innerHTML = '<span class="tag tag-gray">—</span>';
    } else if (!match) {
        statusCell.innerHTML = '<span class="tag tag-gold">New</span><br><button type="button" class="btn btn-outline btn-sm mt-8" onclick="quickAddImportRow(this)">+ Add to List</button>';
    } else if (Number(match.variant_count) > 0) {
        if (!typeName) {
            statusCell.innerHTML = '<span class="tag tag-red">Type required</span>';
        } else {
            statusCell.innerHTML = '<span class="tag tag-gray">Checking type...</span>';
            checkImportRowType(tr, match, typeName);
        }
    } else {
        statusCell.innerHTML = '<span class="tag tag-green">Existing</span>';
    }
    refreshImportValidationSummary();
}

/**
 * The matched product's types are fetched on demand (and cached) - this
 * runs a moment after updateImportRowStatus so it doesn't block typing.
 * Bails out quietly if the Type text changed again before it resolved.
 */
async function checkImportRowType(tr, product, typeName) {
    const variants = await getVariantsForProduct(product.id);
    if (tr.querySelector('.imp-type').value.trim() !== typeName) return;
    const statusCell = tr.querySelector('.imp-status');
    const match = variants.find(v => v.variant_name.toLowerCase() === typeName.toLowerCase());
    statusCell.innerHTML = match ?
        '<span class="tag tag-green">Existing type</span>' :
        '<span class="tag tag-gold">New type</span>';
}

function quickAddImportRow(btn) {
    const tr = btn.closest('tr');
    const name = tr.querySelector('.imp-name').value.trim();
    const category = tr.querySelector('.imp-category').value.trim();
    const unit = tr.querySelector('.imp-unit').value.trim() || 'pcs';
    if (!name) return;

    openQuickAddModal(name, category, unit, () => updateImportRowStatus(tr));
}

function escapeAttr(v) {
    return String(v === null || v === undefined ? '' : v).replace(/"/g, '&quot;');
}

/**
 * Small, professional inline validation text (red, no background box) -
 * replaces the old large toast. Identifies every offending row by number,
 * e.g. "Row 1, add product to list first" or, for several rows,
 * "Row 1, Row 3, Row 7, add product to list first".
 */
function refreshImportValidationSummary() {
    const rows = Array.from(document.querySelectorAll('#importPreviewBody tr'));
    const badRows = [];
    rows.forEach((tr, i) => {
        const name = tr.querySelector('.imp-name').value.trim();
        if (name && !PURCHASE_NAME_MAP[name.toLowerCase()]) badRows.push(i + 1);
    });

    const summary = document.getElementById('importValidationMsg');
    if (!badRows.length) { summary.textContent = ''; return; }
    summary.textContent = badRows.map(n => 'Row ' + n).join(', ') + ', add product to list first';
}

async function confirmImport() {
    const rows = Array.from(document.querySelectorAll('#importPreviewBody tr'));
    if (!rows.length) { toast('Add at least one row first.', 'error'); return; }

    const items = [];
    const problems = [];
    let hasUnlistedRows = false;

    rows.forEach((tr, i) => {
        const name = tr.querySelector('.imp-name').value.trim();
        const typeName = tr.querySelector('.imp-type').value.trim();
        const qty = tr.querySelector('.imp-qty').value;
        const buying = tr.querySelector('.imp-buying').value;
        const selling = tr.querySelector('.imp-selling').value;
        const unit = tr.querySelector('.imp-unit').value.trim() || 'pcs';
        const category = tr.querySelector('.imp-category').value.trim();

        if (!name) { problems.push(`Row ${i + 1}: missing product name.`); return; }
        if (!qty || Number(qty) <= 0) { problems.push(`Row ${i + 1} (${name}): enter a valid quantity.`); return; }

        const match = PURCHASE_NAME_MAP[name.toLowerCase()];
        if (!match) {
            hasUnlistedRows = true;
            return;
        }

        if (Number(match.variant_count) > 0 && !typeName) {
            problems.push(`Row ${i + 1} (${name}): this product has types - specify which type in the Type column.`);
            return;
        }

        items.push({ name, variant_name: typeName, quantity: qty, buying_price: buying, selling_price: selling, unit, category });
    });

    refreshImportValidationSummary();

    if (hasUnlistedRows) {
        // The small red text under the Confirm button already names the rows -
        // no large toast needed for this specific, very common case.
        return;
    }

    if (problems.length) {
        toast(problems[0] + (problems.length > 1 ? ` (+${problems.length - 1} more)` : ''), 'error');
        return;
    }

    const btn = document.getElementById('confirmImportBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const res = await API.post('purchases.php', {
        items,
        source: 'import',
        purchase_date: document.getElementById('importDate').value,
    });

    btn.disabled = false;
    btn.textContent = 'Confirm & Save All to Stock';

    if (!res.success) {
        toast(res.message, 'error');
        return;
    }

    sessionStorage.setItem('flashMessage', res.message);
    window.location.href = 'products.html';
}