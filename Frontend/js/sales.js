let SALES_CACHE = [];
let PRODUCT_OPTIONS = []; // is_service = 0
let SERVICE_OPTIONS = []; // is_service = 1
let SALE_MODE = 'product'; // 'product' or 'service'
let SELECTED_PRODUCT = null;
let SELECTED_VARIANT = null;
let CURRENT_TYPE_OPTIONS = [];
let EDITING_SALE_ID = null;
let HIGHLIGHT_INDEX = -1;
let CURRENT_MATCHES = [];
let CART = []; // [{product_id, variant_id, name, unit, quantity, unit_price, subtotal, materials}]
// Products used to provide a service (service sales only)
let MATERIALS_USED = false;
let MATERIAL_VARIANT_CACHE = {};
let HELD_STOCK = {}; // while EDITING a sale: stock that sale already holds, key -> quantity

(async function init() {
    await requireAuth();
    document.getElementById('s-date').value = todayStr();
    await loadProductOptions();
    resetFilter();

    document.getElementById('s-payment-method').addEventListener('change', updatePaymentFieldsVisibility);
    document.getElementById('s-cash-type').addEventListener('change', updatePaymentFieldsVisibility);
    document.getElementById('s-change-left').addEventListener('change', updateChangeFieldVisibility);

    setupProductSearch();
})();

function todayStr() { return new Date().toISOString().slice(0, 10); }

async function loadProductOptions() {
    const [pRes, sRes] = await Promise.all([
        API.get('products.php', { status: 'active', type: '0' }),
        API.get('products.php', { status: 'active', type: '1' }),
    ]);
    if (pRes.success) PRODUCT_OPTIONS = pRes.data;
    if (sRes.success) SERVICE_OPTIONS = sRes.data;
    MATERIAL_VARIANT_CACHE = {}; // description stock must never be stale
}

function currentOptionList() {
    return SALE_MODE === 'product' ? PRODUCT_OPTIONS : SERVICE_OPTIONS;
}

/* =========================================================
   Type-to-search product/service picker (for the item being ADDED,
   not the whole sale - the sale itself is the cart below).
   ========================================================= */
function setupProductSearch() {
    const input = document.getElementById('s-product-search');
    const list = document.getElementById('s-product-suggestions');

    input.addEventListener('input', () => {
        SELECTED_PRODUCT = null;
        SELECTED_VARIANT = null;
        document.getElementById('s-product-id').value = '';
        hideTypeField();
        renderSuggestions(input.value.trim());
    });

    input.addEventListener('focus', () => {
        renderSuggestions(input.value.trim());
    });

    input.addEventListener('keydown', (e) => {
        if (list.classList.contains('hidden') || !CURRENT_MATCHES.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            HIGHLIGHT_INDEX = Math.min(HIGHLIGHT_INDEX + 1, CURRENT_MATCHES.length - 1);
            paintHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            HIGHLIGHT_INDEX = Math.max(HIGHLIGHT_INDEX - 1, 0);
            paintHighlight();
        } else if (e.key === 'Enter') { e.preventDefault(); const pick = CURRENT_MATCHES[HIGHLIGHT_INDEX] || CURRENT_MATCHES[0]; if (pick) selectProduct(pick.id); } else if (e.key === 'Escape') { list.classList.add('hidden'); }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.autocomplete')) list.classList.add('hidden');
    });
}

function renderSuggestions(query) {
    const list = document.getElementById('s-product-suggestions');
    const q = query.toLowerCase();
    const options = currentOptionList();

    CURRENT_MATCHES = !q ? options.slice(0, 8) : options.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
    HIGHLIGHT_INDEX = 0;

    if (!CURRENT_MATCHES.length) {
        list.innerHTML = `<div class="autocomplete-empty">No matching ${SALE_MODE} found in your ${SALE_MODE === 'product' ? 'Products' : 'Services'} list.</div>`;
        list.classList.remove('hidden');
        return;
    }

    list.innerHTML = CURRENT_MATCHES.map((p, i) => `
    <div class="autocomplete-item${i === 0 ? ' highlighted' : ''}" data-id="${p.id}">
      <span class="name">${p.name}</span>
      <span class="meta">${Number(p.variant_count) > 0
        ? p.variant_count + ' description(s)'
        : (SALE_MODE === 'product' ? p.stock_quantity + ' ' + p.unit + ' in stock' : money(p.selling_price))}</span>
    </div>`).join('');

    list.querySelectorAll('.autocomplete-item').forEach(el => {
        el.addEventListener('click', () => selectProduct(el.dataset.id));
    });
    list.classList.remove('hidden');
}

function paintHighlight() {
    document.querySelectorAll('#s-product-suggestions .autocomplete-item').forEach((el, i) => el.classList.toggle('highlighted', i === HIGHLIGHT_INDEX));
}

function hideTypeField() {
    document.getElementById('s-type-field').classList.add('hidden');
    document.getElementById('s-type-select').innerHTML = '';
    CURRENT_TYPE_OPTIONS = [];
}

async function selectProduct(id) {
    const p = currentOptionList().find(x => x.id == id);
    if (!p) return;
    SELECTED_PRODUCT = p;
    SELECTED_VARIANT = null;
    document.getElementById('s-product-id').value = p.id;
    document.getElementById('s-product-search').value = p.name;
    document.getElementById('s-product-suggestions').classList.add('hidden');

    if (Number(p.variant_count) > 0) {
        // This product/service has descriptions - a specific one must be chosen
        // before a price/quantity can be entered, since each description has
        // its own price (e.g. "Printing" -> "A4" / "A3", or "Pen" -> "Obama Pen").
        const typeField = document.getElementById('s-type-field');
        const typeSelect = document.getElementById('s-type-select');
        typeField.classList.remove('hidden');
        typeSelect.innerHTML = '<option value="">Loading descriptions...</option>';
        document.getElementById('s-price').value = '';

        const res = await API.get('product_variants.php', { product_id: p.id });
        CURRENT_TYPE_OPTIONS = res.success ? res.data.filter(v => v.status === 'active') : [];

        if (!CURRENT_TYPE_OPTIONS.length) {
            typeSelect.innerHTML = '<option value="">No active descriptions available</option>';
        } else {
            typeSelect.innerHTML = '<option value="">Select a description...</option>' +
                CURRENT_TYPE_OPTIONS.map(v => `<option value="${v.id}">${v.variant_name}${SALE_MODE === 'product' ? ' (' + v.stock_quantity + ' ' + v.unit + ' in stock)' : ''}</option>`).join('');
        }
    } else {
        hideTypeField();
        if (!document.getElementById('s-price').dataset.touched) {
            document.getElementById('s-price').value = p.selling_price;
        }
    }
    updatePriceHint();
}

function selectVariantType() {
    const id = document.getElementById('s-type-select').value;
    SELECTED_VARIANT = id ? CURRENT_TYPE_OPTIONS.find(v => v.id == id) : null;
    if (SELECTED_VARIANT && !document.getElementById('s-price').dataset.touched) {
        document.getElementById('s-price').value = SELECTED_VARIANT.selling_price;
    }
    updatePriceHint();
}

/* ========================================================= */

function setSaleMode(mode) {
    SALE_MODE = mode;
    const productBtn = document.getElementById('modeProductBtn');
    const serviceBtn = document.getElementById('modeServiceBtn');
    const label = document.getElementById('s-product-label');

    if (mode === 'product') {
        productBtn.className = 'btn btn-primary btn-sm w-full';
        serviceBtn.className = 'btn btn-outline btn-sm w-full';
        label.textContent = 'Product';
        document.getElementById('s-product-search').placeholder = 'Type a product name...';
    } else {
        productBtn.className = 'btn btn-outline btn-sm w-full';
        serviceBtn.className = 'btn btn-primary btn-sm w-full';
        label.textContent = 'Service';
        document.getElementById('s-product-search').placeholder = 'Type a service name...';
    }

    SELECTED_PRODUCT = null;
    SELECTED_VARIANT = null;
    document.getElementById('s-product-id').value = '';
    document.getElementById('s-product-search').value = '';
    document.getElementById('s-product-suggestions').classList.add('hidden');
    hideTypeField();
    updatePriceHint();

    // "Was any product used?" only exists for services.
    document.getElementById('s-materials-field').classList.toggle('hidden', mode !== 'service');
    resetMaterialsForm();
}

document.getElementById('s-price').addEventListener('input', function() {
    this.dataset.touched = '1';
    updatePriceHint();
});

/**
 * Live check against the item's (or its selected type's) minimum
 * selling price, if one is set - warns the person before they even
 * try to add it to the cart.
 */
function updatePriceHint() {
    const hint = document.getElementById('s-price-hint');
    const src = SELECTED_VARIANT || SELECTED_PRODUCT;
    const min = src && src.minimum_price ? Number(src.minimum_price) : null;

    if (!min) {
        hint.textContent = '';
        hint.classList.remove('warn');
        return;
    }

    const current = parseFloat(document.getElementById('s-price').value);
    hint.textContent = `Minimum allowed selling price: ${money(min)}`;
    if (!isNaN(current) && current < min) {
        hint.textContent = `Not allowed — below the minimum selling price of ${money(min)}.`;
        hint.classList.add('warn');
    } else {
        hint.classList.remove('warn');
    }
}

/* =========================================================
   CART - the actual "multiple products in one sale" mechanism.
   ========================================================= */
function clearItemError() { document.getElementById('s-item-error').textContent = ''; }

function addCartItem() {
    clearItemError();
    if (!SELECTED_PRODUCT) { document.getElementById('s-item-error').textContent = 'Search and select a product or service first.'; return; }
    if (Number(SELECTED_PRODUCT.variant_count) > 0 && !SELECTED_VARIANT) {
        document.getElementById('s-item-error').textContent = `Select a description for "${SELECTED_PRODUCT.name}" first.`;
        return;
    }

    const qty = parseInt(document.getElementById('s-qty').value, 10);
    const price = parseFloat(document.getElementById('s-price').value);
    if (!qty || qty <= 0) { document.getElementById('s-item-error').textContent = 'Enter a valid quantity.'; return; }
    if (isNaN(price) || price < 0) { document.getElementById('s-item-error').textContent = 'Enter a valid unit price.'; return; }

    const priceSource = SELECTED_VARIANT || SELECTED_PRODUCT;
    if (priceSource.minimum_price && price < Number(priceSource.minimum_price)) {
        document.getElementById('s-item-error').textContent = `That price is below the minimum of ${money(priceSource.minimum_price)}.`;
        return;
    }

    // Services: the products used (if the cashier said yes).
    let materials = [];
    if (SALE_MODE === 'service') {
        try { materials = collectMaterials(); }
        catch (err) { document.getElementById('s-item-error').textContent = err.message; return; }
        const stockProblem = materialsStockProblem(materials, qty);
        if (stockProblem) { document.getElementById('s-item-error').textContent = stockProblem; return; }
    }

    const variantId = SELECTED_VARIANT ? SELECTED_VARIANT.id : null;
    const displayName = SELECTED_VARIANT ? `${SELECTED_PRODUCT.name} — ${SELECTED_VARIANT.variant_name}` : SELECTED_PRODUCT.name;
    const unit = SELECTED_VARIANT ? SELECTED_VARIANT.unit : (SELECTED_PRODUCT.unit || '');

    if (SALE_MODE === 'product') {
        const alreadyInCart = stockUsedInCart(SELECTED_PRODUCT.id, variantId);
        if (Number(priceSource.stock_quantity) + stockHeld(SELECTED_PRODUCT.id, variantId) < alreadyInCart + qty) {
            document.getElementById('s-item-error').textContent = `Not enough stock. Only ${priceSource.stock_quantity} ${unit} available.`;
            return;
        }
    }

    const existingRow = CART.find(c => c.product_id == SELECTED_PRODUCT.id && c.variant_id == variantId && c.unit_price == price && sameMaterials(c.materials, materials));
    if (existingRow) {
        existingRow.quantity += qty;
        existingRow.subtotal = existingRow.quantity * existingRow.unit_price;
    } else {
        CART.push({
            product_id: SELECTED_PRODUCT.id,
            variant_id: variantId,
            name: displayName,
            unit,
            quantity: qty,
            unit_price: price,
            subtotal: qty * price,
            is_service: SALE_MODE === 'service',
            materials,
        });
    }

    // Reset just the add-item fields, ready for the next line.
    SELECTED_PRODUCT = null;
    SELECTED_VARIANT = null;
    document.getElementById('s-product-id').value = '';
    document.getElementById('s-product-search').value = '';
    document.getElementById('s-qty').value = 1;
    document.getElementById('s-price').value = '';
    delete document.getElementById('s-price').dataset.touched;
    document.getElementById('s-price-hint').textContent = '';
    hideTypeField();
    resetMaterialsForm();

    renderCart();
}

function removeCartItem(index) {
    CART.splice(index, 1);
    renderCart();
}

function renderCart() {
    const tbody = document.getElementById('cartBody');
    if (!CART.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">No items added yet.</td></tr>';
    } else {
        tbody.innerHTML = CART.map((c, i) => `
      <tr>
        <td>${c.name}${(c.materials && c.materials.length) ? `<div class="help-text" style="margin:2px 0 0;">Used: ${c.materials.map(m => `${escSales(m.name)} × ${m.quantity * c.quantity}`).join(', ')}</div>` : ''}</td>
        <td>${c.quantity} ${c.unit}</td>
        <td>${money(c.unit_price)}</td>
        <td><strong>${money(c.subtotal)}</strong></td>
        <td><button type="button" class="icon-action-btn delete-btn" title="Remove" onclick="removeCartItem(${i})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button></td>
      </tr>`).join('');
    }
    const grandTotal = CART.reduce((sum, c) => sum + c.subtotal, 0);
    document.getElementById('cart-grand-total').textContent = money(grandTotal);
}

/* =========================================================
   Payment method (cash / credit) field visibility
   ========================================================= */
function updatePaymentFieldsVisibility() {
    const method = document.getElementById('s-payment-method').value;
    const cashType = document.getElementById('s-cash-type').value;

    document.getElementById('cashFields').classList.toggle('hidden', method !== 'cash');
    document.getElementById('onlineMethodField').classList.toggle('hidden', !(method === 'cash' && cashType === 'online'));
    document.getElementById('creditDeadlineField').classList.toggle('hidden', method !== 'credit');
    document.getElementById('s-customer-required-note').classList.toggle('hidden', method !== 'credit');
    document.getElementById('customerPhoneField').classList.toggle('hidden', method !== 'credit');
    document.getElementById('s-credit-deadline').required = method === 'credit';
    document.getElementById('s-customer-phone').required = method === 'credit';
    document.getElementById('s-restriction-error').textContent = '';

    // Customer change only makes sense when the customer paid cash in hand (the extra money is in the drawer).
    const changeAllowed = method === 'cash' && cashType === 'cash_in_hand';
    document.getElementById('customerChangeBox').classList.toggle('hidden', !changeAllowed);
    if (!changeAllowed) {
        document.getElementById('s-change-left').checked = false;
        document.getElementById('s-change-amount').value = '';
    }
    updateChangeFieldVisibility();
}

function updateChangeFieldVisibility() {
    const on = document.getElementById('s-change-left').checked;
    document.getElementById('changeAmountField').classList.toggle('hidden', !on);
    document.getElementById('s-customer-required-note').classList.toggle('hidden',
        !(document.getElementById('s-payment-method').value === 'credit' || on));
    if (document.getElementById('s-payment-method').value !== 'credit') {
        document.getElementById('s-customer-required-note').textContent = '(required when the customer leaves change)';
    } else {
        document.getElementById('s-customer-required-note').textContent = '(required for credit sales)';
    }
}

function resetFilter() {
    document.getElementById('fStart').value = todayStr();
    document.getElementById('fEnd').value = todayStr();
    loadSales();
}

async function loadSales() {
    const tbody = document.getElementById('salesBody');
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Loading...</td></tr>';

    const start = document.getElementById('fStart').value;
    const end = document.getElementById('fEnd').value;
    document.getElementById('print-date-sales').textContent =
        (start === end ? fmtDate(start) : fmtDate(start) + ' to ' + fmtDate(end)) + ' · ' + new Date().toLocaleString('en-GB');

    const res = await API.get('sales.php', { start, end });
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="7" class="muted">${res.message}</td></tr>`; return; }

    SALES_CACHE = res.data;

    let totalSales = 0,
        totalProfit = 0,
        totalCredit = 0,
        changeOwed = 0; // money the shop still owes customers - never mixed into credit above
    res.data.forEach(s => {
        totalSales += Number(s.total_amount);
        totalProfit += Number(s.total_profit);
        if (s.payment_method === 'credit') totalCredit += Number(s.total_amount);
        changeOwed += Number(s.change_remaining) || 0;
    });
    document.getElementById('s-change-owed').textContent = money(changeOwed);
    document.getElementById('s-change-owed-print').textContent = money(changeOwed);
    document.getElementById('s-total').textContent = money(totalSales);
    document.getElementById('s-count').textContent = res.data.length;
    document.getElementById('s-profit').textContent = money(totalProfit);
    document.getElementById('s-credit').textContent = money(totalCredit);
    document.getElementById('s-total-print').textContent = money(totalSales);
    document.getElementById('s-profit-print').textContent = money(totalProfit);
    document.getElementById('s-count-print').textContent = res.data.length;
    document.getElementById('s-credit-print').textContent = money(totalCredit);

    if (!res.data.length) { tbody.innerHTML = '<tr><td colspan="7" class="muted">No sales recorded for this period.</td></tr>'; return; }

    tbody.innerHTML = res.data.map(s => `
    <tr>
      <td>${fmtDate(s.sale_date)}</td>
      <td>${s.item_names || '—'}${s.item_count > 1 ? ` <span class="tag tag-gray">${s.item_count} items</span>` : ''}</td>
      <td><strong>${money(s.total_amount)}</strong></td>
      <td class="gold">${money(s.total_profit)}</td>
      <td>${paymentTag(s)}${changeTag(s)}</td>
      <td>${s.sold_by_name}</td>
      <td class="no-print">
        ${Number(s.change_amount) > 0 ? `<button class="icon-action-btn view-btn" title="Customer change" onclick="openChangeModal(${s.id})"><svg class="ui-icon"><use href="assets/icons.svg#coins"></use></svg></button>` : ''}
        <button class="icon-action-btn view-btn" title="Print receipt" onclick="window.open('receipt.html?id=${s.id}', '_blank')"><svg class="ui-icon"><use href="assets/icons.svg#receipt"></use></svg></button>
        <button class="icon-action-btn edit-btn" title="Edit" onclick="editSale(${s.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        <button class="icon-action-btn delete-btn" title="Delete" onclick="deleteSale(${s.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </td>
    </tr>`).join('');

  applyRoleVisibility();
}

function paymentTag(s) {
  if (s.payment_method === 'credit') return '<span class="tag tag-red">Credit</span>';
  if (s.cash_type === 'online') return `<span class="tag tag-green">${s.online_method || 'Online'}</span>`;
  return '<span class="tag tag-gray">Cash</span>';
}

/** Small status line under the payment tag: how much change the customer left and where it stands. */
function changeTag(s) {
  const amount = Number(s.change_amount) || 0;
  if (amount <= 0) return '';
  const remaining = Number(s.change_remaining) || 0;
  let tag;
  if (s.change_status === 'collected') tag = `<span class="tag tag-green">Change collected</span>`;
  else if (s.change_status === 'partial') tag = `<span class="tag tag-gold">Change left: ${money(remaining)}</span>`;
  else tag = `<span class="tag tag-red">Change due: ${money(remaining)}</span>`;
  return `<div style="margin-top:4px;cursor:pointer;" onclick="openChangeModal(${s.id})" title="Customer change details">${tag}</div>`;
}

function openSaleModal() {
  document.getElementById('saleForm').reset();
  document.getElementById('s-edit-id').value = '';
  document.getElementById('saleModalTitle').textContent = 'Record a Sale';
  document.getElementById('saleSubmitBtn').textContent = 'Save Sale';
  document.getElementById('saleModeToggle').classList.remove('hidden');
  document.getElementById('s-product-search').disabled = false;
  document.getElementById('s-date').value = todayStr();
  delete document.getElementById('s-price').dataset.touched;
  EDITING_SALE_ID = null;
  HELD_STOCK = {};
  CART = [];
  loadProductOptions(); // fresh stock figures for this sale
  clearItemError();
  document.getElementById('s-restriction-error').textContent = '';
  resetChangeFields();
  renderCart();
  setSaleMode('product');
  updatePaymentFieldsVisibility();
  openModal('saleModal');
}

function resetChangeFields() {
  document.getElementById('s-change-left').checked = false;
  document.getElementById('s-change-left').disabled = false;
  document.getElementById('s-change-amount').value = '';
  document.getElementById('s-change-amount').min = '0';
}

async function editSale(id) {
  const summary = SALES_CACHE.find(x => x.id == id);
  if (!summary) return;

  const res = await API.get('sales.php', { id });
  if (!res.success) { toast(res.message, 'error'); return; }
  const s = res.data;

  document.getElementById('saleForm').reset();
  document.getElementById('saleModalTitle').textContent = 'Edit Sale #' + id;
  document.getElementById('saleSubmitBtn').textContent = 'Update Sale';
  document.getElementById('saleModeToggle').classList.remove('hidden');
  document.getElementById('s-product-search').disabled = false;
  EDITING_SALE_ID = id;
  document.getElementById('s-edit-id').value = id;
  loadProductOptions(); // fresh stock figures for this sale

  // product_name/unit from the API already fold in the description name (e.g.
  // "Pen — Obama Pen") and the description's own unit, so this needs no extra
  // lookups - variant_id just rides along for when the sale is re-saved.
  CART = s.items.map(item => ({
    product_id: item.product_id, variant_id: item.variant_id || null, name: item.product_name, unit: item.unit || '',
    quantity: Number(item.quantity), unit_price: Number(item.unit_price), subtotal: Number(item.subtotal), is_service: !!Number(item.is_service),
    materials: (item.materials || []).filter(m => m.product_id).map(m => ({ product_id: m.product_id, variant_id: m.variant_id || null, quantity: Number(m.quantity), name: m.name })),
  }));
  // Stock this sale already took out - it is given back if the sale is changed, so
  // it still counts as available while editing.
  HELD_STOCK = {};
  s.items.forEach(item => {
    if (Number(item.is_service)) {
      (item.materials || []).forEach(m => { if (m.product_id) holdStock(m.product_id, m.variant_id, Number(m.total_quantity)); });
    } else {
      holdStock(item.product_id, item.variant_id, Number(item.quantity));
    }
  });
  renderCart();
  clearItemError();

  document.getElementById('s-customer').value = s.customer_name || '';
  document.getElementById('s-customer-phone').value = s.customer_phone || '';
  document.getElementById('s-date').value = s.sale_date;

  document.getElementById('s-payment-method').value = s.payment_method || 'cash';
  document.getElementById('s-cash-type').value = s.cash_type || 'cash_in_hand';
  if (s.online_method) document.getElementById('s-online-method').value = s.online_method;
  if (s.credit_deadline) document.getElementById('s-credit-deadline').value = s.credit_deadline;
  updatePaymentFieldsVisibility();

  // Customer change already recorded on this sale (it can be raised or lowered, but never below what was collected).
  resetChangeFields();
  const changeAmount = Number(s.change_amount) || 0;
  const changeCollected = Number(s.change_collected) || 0;
  if (changeAmount > 0) {
    document.getElementById('s-change-left').checked = true;
    document.getElementById('s-change-amount').value = changeAmount;
    if (changeCollected > 0) {
      document.getElementById('s-change-left').disabled = true; // part of it was already paid back
      document.getElementById('s-change-amount').min = String(changeCollected);
    }
    updateChangeFieldVisibility();
  }

  setSaleMode('product');
  openModal('saleModal');
}

document.getElementById('saleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('s-restriction-error').textContent = '';

  if (!CART.length) { toast('Add at least one product or service to this sale.', 'error'); return; }

  const paymentMethod = document.getElementById('s-payment-method').value;
  const customerName = document.getElementById('s-customer').value.trim();
  const customerPhone = document.getElementById('s-customer-phone').value.trim();

  if (paymentMethod === 'credit' && !customerName) { toast("Please enter the customer's name for a credit sale.", 'error'); return; }
  if (paymentMethod === 'credit' && !customerPhone) { toast("Please enter the customer's phone number for a credit sale.", 'error'); return; }
  if (paymentMethod === 'credit' && !document.getElementById('s-credit-deadline').value) { toast('Please set a payment deadline for this credit sale.', 'error'); return; }

  // Customer change left on this sale (cash in hand only - the section is hidden otherwise).
  const changeOn = document.getElementById('s-change-left').checked;
  let changeAmount = 0;
  if (changeOn) {
    changeAmount = parseFloat(document.getElementById('s-change-amount').value);
    if (isNaN(changeAmount) || changeAmount <= 0) { toast('Enter the amount of change the customer left.', 'error'); return; }
    if (!customerName) { toast("Please enter the customer's name so the change can be given to the right person.", 'error'); return; }
  }

  const payload = {
    change_amount: changeAmount,
    items: CART.map(c => ({ product_id: c.product_id, variant_id: c.variant_id || null, quantity: c.quantity, unit_price: c.unit_price, materials: (c.materials || []).map(m => ({ product_id: m.product_id, variant_id: m.variant_id || null, quantity: m.quantity })) })),
    customer_name: customerName,
    customer_phone: customerPhone,
    sale_date: document.getElementById('s-date').value,
    payment_method: paymentMethod,
    cash_type: document.getElementById('s-cash-type').value,
    online_method: document.getElementById('s-online-method').value,
    credit_deadline: document.getElementById('s-credit-deadline').value,
  };

  const res = EDITING_SALE_ID
    ? await API.put('sales.php', { id: EDITING_SALE_ID, ...payload })
    : await API.post('sales.php', payload);

  if (!res.success) {
    // "Credit Sale Blocked" errors are shown inline near the payment
    // fields, not as a toast - they need to stay visible while the
    // person decides what to do (switch to cash, pick a different
    // customer, etc), not disappear after a few seconds.
    if (res.message && res.message.includes('Credit Sale Blocked')) {
      document.getElementById('s-restriction-error').textContent = res.message;
    } else {
      toast(res.message, 'error');
    }
    return;
  }

  toast(res.message);
  document.getElementById('s-product-search').disabled = false;
  closeModal('saleModal');
  loadProductOptions();
  loadSales();
});

async function deleteSale(id) {
  if (!confirm('Delete this sale? Stock will be restored for every item in it.')) return;
  const res = await API.del('sales.php', { id });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  loadProductOptions();
  loadSales();
}

function downloadSalesExcel() {
  const rows = SALES_CACHE.map(s => [
    s.sale_date, s.item_names || '', s.item_count, s.total_amount, s.total_profit,
    s.payment_method === 'credit' ? 'Credit' : (s.cash_type === 'online' ? s.online_method : 'Cash'),
    s.customer_name || '', s.customer_phone || '', s.sold_by_name,
    Number(s.change_amount) || 0, Number(s.change_collected) || 0, Number(s.change_remaining) || 0,
    changeStatusLabel(s.change_status),
  ]);
  exportToExcel('eDESK_Sales_' + document.getElementById('fStart').value + '_to_' + document.getElementById('fEnd').value + '.csv',
    ['Date', 'Items', 'Item Count', 'Total', 'Profit', 'Payment', 'Customer', 'Customer Phone', 'Sold By',
     'Customer Change', 'Change Collected', 'Change Remaining', 'Change Status'], rows);
}

/* =========================================================
   Customer Change - details and collection, all on the original sale.
   (Money the SHOP owes the customer; separate from customer debts.)
   ========================================================= */
let CHANGE_SALE_ID = null;

function changeStatusLabel(status) {
  return status === 'collected' ? 'Collected' : status === 'partial' ? 'Partially Collected' : status === 'pending' ? 'Pending' : '';
}

function changeStatusTag(status) {
  const cls = status === 'collected' ? 'tag-green' : status === 'partial' ? 'tag-gold' : 'tag-red';
  return `<span class="tag ${cls}">${changeStatusLabel(status) || '—'}</span>`;
}

function fmtDateTimeSales(dt) {
  if (!dt) return '—';
  const d = new Date(String(dt).replace(' ', 'T'));
  if (isNaN(d)) return dt;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function openChangeModal(id) {
  const res = await API.get('sales.php', { id });
  if (!res.success) { toast(res.message, 'error'); return; }
  const s = res.data;
  CHANGE_SALE_ID = id;

  const original = Number(s.change_amount) || 0;
  const collected = Number(s.change_collected) || 0;
  const remaining = Number(s.change_remaining) || 0;

  document.getElementById('changeModalTitle').textContent = 'Customer Change — Sale #' + id;
  document.getElementById('chg-customer').textContent =
    (s.customer_name || 'Customer') + (s.customer_phone ? ' · ' + s.customer_phone : '') + ' · sale of ' + fmtDate(s.sale_date) + ' (' + money(s.total_amount) + ')';
  document.getElementById('chg-status').innerHTML = changeStatusTag(s.change_status);
  document.getElementById('chg-original').textContent = money(original);
  document.getElementById('chg-collected').textContent = money(collected);
  document.getElementById('chg-remaining').textContent = money(remaining);
  document.getElementById('chg-last').textContent = s.change_collected_at
    ? 'Last collected: ' + fmtDateTimeSales(s.change_collected_at)
    : 'Nothing collected yet. The customer left this change with the shop on ' + fmtDate(s.sale_date) + '.';

  const collections = s.change_collections || [];
  document.getElementById('chg-history-wrap').classList.toggle('hidden', !collections.length);
  document.getElementById('chg-history').innerHTML = collections.map(c => `
    <tr>
      <td>${fmtDateTimeSales(c.created_at)}</td>
      <td><strong>${money(c.amount)}</strong></td>
      <td>${c.note || '—'}</td>
      <td>${c.recorded_by_name || '—'}</td>
    </tr>`).join('');

  // The collect form only shows while something is still owed.
  document.getElementById('chg-collect-box').classList.toggle('hidden', remaining <= 0);
  document.getElementById('chg-amount').value = remaining > 0 ? remaining : '';
  document.getElementById('chg-amount').max = String(remaining);
  document.getElementById('chg-date').value = todayStr();
  document.getElementById('chg-date').min = s.sale_date;
  document.getElementById('chg-date').max = todayStr();
  document.getElementById('chg-note').value = '';
  document.getElementById('chg-error').textContent = '';
  document.getElementById('chg-submit').disabled = false;
  openModal('changeModal');
}

async function submitChangeCollection() {
  const err = document.getElementById('chg-error');
  err.textContent = '';
  const amount = parseFloat(document.getElementById('chg-amount').value);
  if (isNaN(amount) || amount <= 0) { err.textContent = 'Enter the amount of change being collected.'; return; }

  const btn = document.getElementById('chg-submit');
  btn.disabled = true; // stops a double-click from recording the same payout twice
  const res = await API.post('sales.php', {
    action: 'collect_change',
    sale_id: CHANGE_SALE_ID,
    amount,
    collected_date: document.getElementById('chg-date').value,
    note: document.getElementById('chg-note').value.trim(),
  });
  if (!res.success) { err.textContent = res.message; btn.disabled = false; return; }

  toast(res.message);
  await loadSales();
  openChangeModal(CHANGE_SALE_ID); // refresh the same record: collected, remaining, status and history
}

/* =========================================================
   Products used to provide a SERVICE.
   The customer is always charged the full price. The products come
   out of stock and their cost only reduces profit - never the sale
   amount or the cash to be counted.
   ========================================================= */
function escSales(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- Stock accounting for the cart (a product's stock is shared by direct sales and by services that use it) ---- */
function stockKey(productId, variantId) { return productId + ':' + (variantId || 0); }

function holdStock(productId, variantId, qty) {
    const k = stockKey(productId, variantId);
    HELD_STOCK[k] = (HELD_STOCK[k] || 0) + qty;
}

function stockHeld(productId, variantId) { return HELD_STOCK[stockKey(productId, variantId)] || 0; }

// How much of this product/description is already used by the lines in the cart
// (sold directly, or used up by a service).
function stockUsedInCart(productId, variantId) {
    const key = stockKey(productId, variantId);
    let used = 0;
    CART.forEach(c => {
        if (c.is_service) {
            (c.materials || []).forEach(m => { if (stockKey(m.product_id, m.variant_id) === key) used += m.quantity * c.quantity; });
        } else if (stockKey(c.product_id, c.variant_id) === key) {
            used += c.quantity;
        }
    });
    return used;
}

// What is still free to use right now: stock in the shop - what the cart already uses.
function stockLeft(productId, variantId, dbStock) {
    return Number(dbStock) + stockHeld(productId, variantId) - stockUsedInCart(productId, variantId);
}

function variantStock(productId, variantId) {
    const v = (MATERIAL_VARIANT_CACHE[productId] || []).find(x => x.id == variantId);
    return v ? Number(v.stock_quantity) : 0;
}

// Returns an error message if the products used for this service line are not in stock, else ''.
function materialsStockProblem(materials, lineQty) {
    for (const m of materials) {
        const dbStock = m.variant_id ? variantStock(m.product_id, m.variant_id) : Number((PRODUCT_OPTIONS.find(p => p.id == m.product_id) || {}).stock_quantity || 0);
        const left = stockLeft(m.product_id, m.variant_id, dbStock);
        const need = m.quantity * lineQty;
        if (left <= 0) return `"${m.name}" is out of stock, so it cannot be used for this service.`;
        if (left < need) return `Not enough stock of "${m.name}". This needs ${need} but only ${left} ${m.unit || ''} left.`.replace('  ', ' ');
    }
    return '';
}

function sameMaterials(a, b) {
    const key = list => (list || []).map(m => `${m.product_id}:${m.variant_id || 0}:${m.quantity}`).sort().join('|');
    return key(a) === key(b);
}

function setMaterialsUsed(yes) {
    MATERIALS_USED = yes;
    document.getElementById('matYesBtn').className = yes ? 'btn btn-primary btn-sm w-full' : 'btn btn-outline btn-sm w-full';
    document.getElementById('matNoBtn').className = yes ? 'btn btn-outline btn-sm w-full' : 'btn btn-primary btn-sm w-full';
    document.getElementById('s-materials-panel').classList.toggle('hidden', !yes);
    if (yes && !document.querySelector('#s-materials-rows .material-row')) addMaterialRow();
}

function resetMaterialsForm() {
    document.getElementById('s-materials-rows').innerHTML = '';
    setMaterialsUsed(false);
}

// One searchable "product used" row: type to search, pick from the list, set the quantity.
function addMaterialRow() {
    const row = document.createElement('div');
    row.className = 'material-row';
    row.style.cssText = 'border:1px solid #e3e6ec;border-radius:8px;padding:10px;margin-bottom:8px;';
    row.innerHTML = `
      <div class="field autocomplete" style="margin-bottom:8px;">
        <input type="text" class="mat-search" placeholder="Search the product used..." autocomplete="off">
        <div class="autocomplete-list hidden mat-suggestions"></div>
      </div>
      <div class="field hidden mat-type-field" style="margin-bottom:8px;">
        <select class="mat-type"></select>
      </div>
      <div class="flex gap-8" style="align-items:center;">
        <input type="number" class="mat-qty" min="1" step="1" value="1" style="max-width:90px;" title="Quantity used per service">
        <span class="help-text mat-hint" style="margin:0;flex:1;">Quantity used per service</span>
        <button type="button" class="icon-action-btn delete-btn" title="Remove" onclick="this.closest('.material-row').remove()"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </div>`;
    document.getElementById('s-materials-rows').appendChild(row);

    const input = row.querySelector('.mat-search');
    const list = row.querySelector('.mat-suggestions');
    const typeField = row.querySelector('.mat-type-field');
    const typeSel = row.querySelector('.mat-type');
    let matches = [];
    let hi = 0;
    row._product = null;
    row._variants = [];

    const paint = () => list.querySelectorAll('.autocomplete-item').forEach((el, i) => el.classList.toggle('highlighted', i === hi));

    const show = () => {
        const q = input.value.trim().toLowerCase();
        matches = (q ? PRODUCT_OPTIONS.filter(p => p.name.toLowerCase().includes(q)) : PRODUCT_OPTIONS).slice(0, 8);
        // Products with nothing left in stock cannot be used - they are shown greyed out.
        // (For products with descriptions this is the combined stock; each description is checked once it is chosen.)
        const left = p => Number(p.variant_count) > 0 ? Number(p.stock_quantity) : stockLeft(p.id, null, p.stock_quantity);
        hi = Math.max(0, matches.findIndex(p => left(p) > 0));
        if (!matches.length) {
            list.innerHTML = '<div class="autocomplete-empty">No matching product found in your Products list.</div>';
        } else {
            list.innerHTML = matches.map((p, i) => {
                const out = left(p) <= 0;
                const meta = out ? 'Out of stock'
                    : (Number(p.variant_count) > 0 ? p.variant_count + ' description(s)' : left(p) + ' ' + escSales(p.unit) + ' in stock');
                return `
              <div class="autocomplete-item${i === hi ? ' highlighted' : ''}" data-id="${p.id}" data-out="${out ? 1 : 0}"${out ? ' style="opacity:.45;cursor:not-allowed;"' : ''}>
                <span class="name">${escSales(p.name)}</span>
                <span class="meta">${meta}</span>
              </div>`;
            }).join('');
            list.querySelectorAll('.autocomplete-item').forEach(el => el.addEventListener('click', () => { if (el.dataset.out !== '1') pick(el.dataset.id); }));
        }
        list.classList.remove('hidden');
    };

    const pick = async (id) => {
        const p = PRODUCT_OPTIONS.find(x => x.id == id);
        if (!p) return;
        row._product = p;
        row._variants = [];
        input.value = p.name;
        list.classList.add('hidden');
        typeSel.innerHTML = '';
        if (Number(p.variant_count) > 0) {
            typeField.classList.remove('hidden');
            typeSel.innerHTML = '<option value="">Loading descriptions...</option>';
            if (!MATERIAL_VARIANT_CACHE[p.id]) {
                const res = await API.get('product_variants.php', { product_id: p.id });
                MATERIAL_VARIANT_CACHE[p.id] = res.success ? res.data.filter(v => v.status === 'active') : [];
            }
            row._variants = MATERIAL_VARIANT_CACHE[p.id];
            typeSel.innerHTML = row._variants.length
                ? '<option value="">Select a description...</option>' + row._variants.map(v => {
                    const left = stockLeft(p.id, v.id, v.stock_quantity);
                    return left > 0
                        ? `<option value="${v.id}">${escSales(v.variant_name)} (${left} ${escSales(v.unit)} in stock)</option>`
                        : `<option value="${v.id}" disabled>${escSales(v.variant_name)} (out of stock)</option>`;
                }).join('')
                : '<option value="">No active descriptions available</option>';
        } else {
            typeField.classList.add('hidden');
        }
        row.querySelector('.mat-hint').textContent = 'Quantity used per service';
    };

    input.addEventListener('input', () => {
        row._product = null;
        row._variants = [];
        typeField.classList.add('hidden');
        typeSel.innerHTML = '';
        show();
    });
    input.addEventListener('focus', show);
    input.addEventListener('keydown', (e) => {
        if (list.classList.contains('hidden') || !matches.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, matches.length - 1); paint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(hi - 1, 0); paint(); }
        else if (e.key === 'Enter') { e.preventDefault(); const el = list.querySelectorAll('.autocomplete-item')[hi]; if (el && el.dataset.out !== '1') pick(el.dataset.id); }
        else if (e.key === 'Escape') { list.classList.add('hidden'); }
    });
    document.addEventListener('click', (e) => {
        if (!row.contains(e.target)) list.classList.add('hidden');
    });
    input.focus();
}

// Reads the "products used" rows. Returns [] when the answer is No.
function collectMaterials() {
    if (!MATERIALS_USED) return [];
    const out = [];
    document.querySelectorAll('#s-materials-rows .material-row').forEach(row => {
        const text = row.querySelector('.mat-search').value.trim();
        if (!text) return;                                    // empty row, ignore
        const p = row._product;
        if (!p) throw new Error(`Pick "${text}" from the search list, or remove that row.`);
        let variant = null;
        if (Number(p.variant_count) > 0) {
            const vId = row.querySelector('.mat-type').value;
            variant = vId ? row._variants.find(v => v.id == vId) : null;
            if (!variant) throw new Error(`Select a description for "${p.name}".`);
        }
        const qty = parseInt(row.querySelector('.mat-qty').value, 10);
        if (!qty || qty < 1) throw new Error(`Enter a quantity of 1 or more for "${p.name}".`);
        out.push({
            product_id: p.id,
            variant_id: variant ? variant.id : null,
            quantity: qty,
            name: variant ? `${p.name} — ${variant.variant_name}` : p.name,
        });
    });
    if (!out.length) throw new Error('Choose the product used, or tap "No".');

    // The same product picked twice in one line counts once, with the quantities added up.
    const merged = [];
    out.forEach(m => {
        const same = merged.find(x => x.product_id === m.product_id && x.variant_id === m.variant_id);
        if (same) same.quantity += m.quantity; else merged.push(m);
    });
    return merged.map(m => {
        const p = PRODUCT_OPTIONS.find(x => x.id == m.product_id);
        return { ...m, unit: p ? p.unit : '' };
    });
}
