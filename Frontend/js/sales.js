/**
 * eDESK Print & Digital - Sales page logic
 *
 * A sale is a TRANSACTION that can hold multiple products/services
 * (the cart below), not one row per product. See Backend/api/sales.php.
 *
 * Two modes for the item picker: Product (from Stock) or Service (from
 * Service list). No custom on-the-fly item writing - every line must
 * reference something already in the Product or Service list.
 */
let SALES_CACHE = [];
let PRODUCT_OPTIONS = [];   // is_service = 0
let SERVICE_OPTIONS = [];   // is_service = 1
let SALE_MODE = 'product';  // 'product' or 'service'
let SELECTED_PRODUCT = null;
let EDITING_SALE_ID = null;
let HIGHLIGHT_INDEX = -1;
let CURRENT_MATCHES = [];
let CART = []; // [{product_id, name, unit, quantity, unit_price, subtotal}]

(async function init() {
  await requireAuth();
  document.getElementById('s-date').value = todayStr();
  await loadProductOptions();
  resetFilter();

  document.getElementById('s-payment-method').addEventListener('change', updatePaymentFieldsVisibility);
  document.getElementById('s-cash-type').addEventListener('change', updatePaymentFieldsVisibility);

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
    document.getElementById('s-product-id').value = '';
    renderSuggestions(input.value.trim());
  });

  input.addEventListener('focus', () => {
    renderSuggestions(input.value.trim());
  });

  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden') || !CURRENT_MATCHES.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); HIGHLIGHT_INDEX = Math.min(HIGHLIGHT_INDEX + 1, CURRENT_MATCHES.length - 1); paintHighlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); HIGHLIGHT_INDEX = Math.max(HIGHLIGHT_INDEX - 1, 0); paintHighlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); const pick = CURRENT_MATCHES[HIGHLIGHT_INDEX] || CURRENT_MATCHES[0]; if (pick) selectProduct(pick.id); }
    else if (e.key === 'Escape') { list.classList.add('hidden'); }
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
      <span class="meta">${SALE_MODE === 'product' ? p.stock_quantity + ' ' + p.unit + ' in stock' : money(p.selling_price)}</span>
    </div>`).join('');

  list.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('click', () => selectProduct(el.dataset.id));
  });
  list.classList.remove('hidden');
}

function paintHighlight() {
  document.querySelectorAll('#s-product-suggestions .autocomplete-item').forEach((el, i) => el.classList.toggle('highlighted', i === HIGHLIGHT_INDEX));
}

function selectProduct(id) {
  const p = currentOptionList().find(x => x.id == id);
  if (!p) return;
  SELECTED_PRODUCT = p;
  document.getElementById('s-product-id').value = p.id;
  document.getElementById('s-product-search').value = p.name;
  document.getElementById('s-product-suggestions').classList.add('hidden');

  if (!document.getElementById('s-price').dataset.touched) {
    document.getElementById('s-price').value = p.selling_price;
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
  document.getElementById('s-product-id').value = '';
  document.getElementById('s-product-search').value = '';
  document.getElementById('s-product-suggestions').classList.add('hidden');
  updatePriceHint();
}

document.getElementById('s-price').addEventListener('input', function () {
  this.dataset.touched = '1';
  updatePriceHint();
});

/**
 * Live check against the item's minimum selling price (if one is set) -
 * warns the person before they even try to add it to the cart.
 */
function updatePriceHint() {
  const hint = document.getElementById('s-price-hint');
  const min = SELECTED_PRODUCT && SELECTED_PRODUCT.minimum_price ? Number(SELECTED_PRODUCT.minimum_price) : null;

  if (!min) { hint.textContent = ''; hint.classList.remove('warn'); return; }

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

  const qty = parseInt(document.getElementById('s-qty').value, 10);
  const price = parseFloat(document.getElementById('s-price').value);
  if (!qty || qty <= 0) { document.getElementById('s-item-error').textContent = 'Enter a valid quantity.'; return; }
  if (isNaN(price) || price < 0) { document.getElementById('s-item-error').textContent = 'Enter a valid unit price.'; return; }
  if (SELECTED_PRODUCT.minimum_price && price < Number(SELECTED_PRODUCT.minimum_price)) {
    document.getElementById('s-item-error').textContent = `That price is below the minimum of ${money(SELECTED_PRODUCT.minimum_price)}.`;
    return;
  }
  if (SALE_MODE === 'product') {
    const alreadyInCart = CART.filter(c => c.product_id == SELECTED_PRODUCT.id).reduce((sum, c) => sum + c.quantity, 0);
    if (Number(SELECTED_PRODUCT.stock_quantity) < alreadyInCart + qty) {
      document.getElementById('s-item-error').textContent = `Not enough stock. Only ${SELECTED_PRODUCT.stock_quantity} ${SELECTED_PRODUCT.unit} available.`;
      return;
    }
  }

  const existingRow = CART.find(c => c.product_id == SELECTED_PRODUCT.id && c.unit_price == price);
  if (existingRow) {
    existingRow.quantity += qty;
    existingRow.subtotal = existingRow.quantity * existingRow.unit_price;
  } else {
    CART.push({
      product_id: SELECTED_PRODUCT.id, name: SELECTED_PRODUCT.name, unit: SELECTED_PRODUCT.unit || '',
      quantity: qty, unit_price: price, subtotal: qty * price,
    });
  }

  // Reset just the add-item fields, ready for the next line.
  SELECTED_PRODUCT = null;
  document.getElementById('s-product-id').value = '';
  document.getElementById('s-product-search').value = '';
  document.getElementById('s-qty').value = 1;
  document.getElementById('s-price').value = '';
  delete document.getElementById('s-price').dataset.touched;
  document.getElementById('s-price-hint').textContent = '';

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
        <td>${c.name}</td>
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
    (start === end ? fmtDate(start) : fmtDate(start) + ' to ' + fmtDate(end)) + ' · Generated ' + new Date().toLocaleString('en-GB');

  const res = await API.get('sales.php', { start, end });
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="7" class="muted">${res.message}</td></tr>`; return; }

  SALES_CACHE = res.data;

  let totalSales = 0, totalProfit = 0, totalCredit = 0;
  res.data.forEach(s => {
    totalSales += Number(s.total_amount);
    totalProfit += Number(s.total_profit);
    if (s.payment_method === 'credit') totalCredit += Number(s.total_amount);
  });
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
      <td>${paymentTag(s)}</td>
      <td>${s.sold_by_name}</td>
      <td class="no-print">
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
  CART = [];
  clearItemError();
  document.getElementById('s-restriction-error').textContent = '';
  renderCart();
  setSaleMode('product');
  updatePaymentFieldsVisibility();
  openModal('saleModal');
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

  CART = s.items.map(item => ({
    product_id: item.product_id, name: item.product_name, unit: item.unit || '',
    quantity: Number(item.quantity), unit_price: Number(item.unit_price), subtotal: Number(item.subtotal),
  }));
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

  const payload = {
    items: CART.map(c => ({ product_id: c.product_id, quantity: c.quantity, unit_price: c.unit_price })),
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
  ]);
  exportToExcel('eDESK_Sales_' + document.getElementById('fStart').value + '_to_' + document.getElementById('fEnd').value + '.csv',
    ['Date', 'Items', 'Item Count', 'Total', 'Profit', 'Payment', 'Customer', 'Customer Phone', 'Sold By'], rows);
}
