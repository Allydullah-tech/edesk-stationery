/**
 * EDESK STATIONERY - Damages & Waste page logic
 * Admin and worker can both record, edit, and delete damage/waste
 * entries - every edit/delete is written to the Activity Log
 * automatically (see Backend/api/damages.php).
 *
 * Two modes when creating a NEW record:
 *  - "product": something from Stock. Loss value is calculated
 *    automatically from the product's buying price, and stock is reduced.
 *  - "other": equipment, material, or anything else NOT in Stock. The
 *    cost is entered by hand since there's no stock record to work from.
 * Editing an existing record keeps its original type - switching a
 * record between "product" and "other" is a delete-and-re-add, not
 * an edit (the two shapes need genuinely different fields).
 */
let DAMAGES_CACHE = [];
let DAMAGE_PRODUCT_OPTIONS = [];
let SELECTED_DAMAGE_PRODUCT = null;
let DM_HIGHLIGHT_INDEX = -1;
let DM_CURRENT_MATCHES = [];
let DAMAGE_MODE = 'product';
let DAMAGE_EDIT_ID = null;

function todayStr() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

(async function init() {
  await requireAuth();
  document.getElementById('dm-date').value = todayStr();
  await loadProductOptions();
  resetFilter();
  setupProductSearch();
  setDamageMode('product');
})();

async function loadProductOptions() {
  const res = await API.get('products.php', { status: 'active', type: '0' });
  if (!res.success) return;
  DAMAGE_PRODUCT_OPTIONS = res.data;
}

/* =========================================================
   Mode toggle: Product (in Stock) vs Other (equipment/material)
   Locked (buttons hidden) while editing an existing record.
   ========================================================= */
function setDamageMode(mode) {
  DAMAGE_MODE = mode;
  const productBtn = document.getElementById('dmModeProductBtn');
  const otherBtn = document.getElementById('dmModeOtherBtn');

  if (mode === 'product') {
    productBtn.className = 'btn btn-primary btn-sm w-full';
    otherBtn.className = 'btn btn-outline btn-sm w-full';
    document.getElementById('dm-product-field').classList.remove('hidden');
    document.getElementById('dm-other-field').classList.add('hidden');
    document.getElementById('dm-qty-field').classList.remove('hidden');
    document.getElementById('dm-cost-field').classList.add('hidden');
    document.getElementById('dm-cost-hint').textContent = "The loss value is calculated automatically using the item's buying price, and stock is reduced.";
    document.getElementById('dm-qty').required = true;
  } else {
    productBtn.className = 'btn btn-outline btn-sm w-full';
    otherBtn.className = 'btn btn-primary btn-sm w-full';
    document.getElementById('dm-product-field').classList.add('hidden');
    document.getElementById('dm-other-field').classList.remove('hidden');
    document.getElementById('dm-qty-field').classList.add('hidden');
    document.getElementById('dm-cost-field').classList.remove('hidden');
    document.getElementById('dm-cost-hint').textContent = 'This item is not in Stock (e.g. equipment or material), so enter its cost yourself.';
    document.getElementById('dm-qty').required = false;
  }
}

/* =========================================================
   Type-to-search product picker
   ========================================================= */
function setupProductSearch() {
  const input = document.getElementById('dm-product-search');
  const list = document.getElementById('dm-product-suggestions');

  input.addEventListener('input', () => {
    SELECTED_DAMAGE_PRODUCT = null;
    document.getElementById('dm-product-id').value = '';
    renderDamageSuggestions(input.value.trim());
  });

  input.addEventListener('focus', () => {
    renderDamageSuggestions(input.value.trim());
  });

  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden') || !DM_CURRENT_MATCHES.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      DM_HIGHLIGHT_INDEX = Math.min(DM_HIGHLIGHT_INDEX + 1, DM_CURRENT_MATCHES.length - 1);
      paintDamageHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      DM_HIGHLIGHT_INDEX = Math.max(DM_HIGHLIGHT_INDEX - 1, 0);
      paintDamageHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = DM_CURRENT_MATCHES[DM_HIGHLIGHT_INDEX] || DM_CURRENT_MATCHES[0];
      if (pick) selectDamageProduct(pick.id);
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete')) list.classList.add('hidden');
  });
}

function renderDamageSuggestions(query) {
  const list = document.getElementById('dm-product-suggestions');
  const q = query.toLowerCase();

  DM_CURRENT_MATCHES = !q
    ? DAMAGE_PRODUCT_OPTIONS.slice(0, 8)
    : DAMAGE_PRODUCT_OPTIONS.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);

  DM_HIGHLIGHT_INDEX = 0;

  if (!DM_CURRENT_MATCHES.length) {
    list.innerHTML = '<div class="autocomplete-empty">No matching product in Stock.</div>';
    list.classList.remove('hidden');
    return;
  }

  list.innerHTML = DM_CURRENT_MATCHES.map((p, i) => `
    <div class="autocomplete-item${i === 0 ? ' highlighted' : ''}" data-id="${p.id}">
      <span class="name">${p.name}</span>
      <span class="meta">${p.stock_quantity} ${p.unit} in stock</span>
    </div>`).join('');

  list.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('click', () => selectDamageProduct(el.dataset.id));
  });

  list.classList.remove('hidden');
}

function paintDamageHighlight() {
  const items = document.querySelectorAll('#dm-product-suggestions .autocomplete-item');
  items.forEach((el, i) => el.classList.toggle('highlighted', i === DM_HIGHLIGHT_INDEX));
}

function selectDamageProduct(id) {
  const p = DAMAGE_PRODUCT_OPTIONS.find(x => x.id == id);
  if (!p) return;
  SELECTED_DAMAGE_PRODUCT = p;
  document.getElementById('dm-product-id').value = p.id;
  document.getElementById('dm-product-search').value = p.name;
  document.getElementById('dm-product-suggestions').classList.add('hidden');
}

/* ========================================================= */

function resetFilter() {
  document.getElementById('fStart').value = firstOfMonth();
  document.getElementById('fEnd').value = todayStr();
  loadDamages();
}

async function loadDamages() {
  const tbody = document.getElementById('damagesBody');
  tbody.innerHTML = '<tr><td colspan="8" class="muted">Loading...</td></tr>';

  const start = document.getElementById('fStart').value;
  const end = document.getElementById('fEnd').value;
  document.getElementById('print-date-damages').textContent =
    (start === end ? fmtDate(start) : fmtDate(start) + ' to ' + fmtDate(end)) + ' · Generated ' + new Date().toLocaleString('en-GB');

  const res = await API.get('damages.php', { start, end });
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="8" class="muted">${res.message}</td></tr>`; return; }

  DAMAGES_CACHE = res.data;
  let total = 0, totalQty = 0;
  res.data.forEach(d => {
    total += Number(d.display_cost != null ? d.display_cost : d.loss_value);
    if (d.item_type !== 'other') totalQty += Number(d.quantity || 0);
  });
  document.getElementById('dm-total').textContent = money(total);
  document.getElementById('dm-count').textContent = res.data.length;
  document.getElementById('dm-total-print').textContent = money(total);
  document.getElementById('dm-count-print').textContent = res.data.length;

  if (!res.data.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">No damage or waste recorded for this period.</td></tr>'; return; }

  tbody.innerHTML = res.data.map(d => {
    const isOther = d.item_type === 'other';
    const name = d.display_name || d.product_name || d.item_name || '—';
    const unit = isOther ? '—' : (d.unit || '');
    const qty = isOther ? '—' : d.quantity;
    const cost = d.display_cost != null ? d.display_cost : d.loss_value;
    return `
    <tr>
      <td>${fmtDate(d.damage_date)}</td>
      <td>${name}${isOther ? ' <span class="tag tag-gray">Not in Stock</span>' : ''}</td>
      <td>${unit}</td>
      <td>${qty}</td>
      <td class="muted">${d.reason}</td>
      <td class="red"><strong>${money(cost)}</strong></td>
      <td>${d.recorded_by_name}</td>
      <td class="no-print">
        <button class="icon-action-btn edit-btn" title="Edit" onclick="editDamage(${d.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        <button class="icon-action-btn delete-btn" title="Delete" onclick="deleteDamage(${d.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </td>
    </tr>`;
  }).join('');
}

function openDamageModal() {
  DAMAGE_EDIT_ID = null;
  document.getElementById('damageForm').reset();
  document.getElementById('dm-id').value = '';
  document.getElementById('dm-date').value = todayStr();
  document.getElementById('dm-product-id').value = '';
  document.getElementById('dm-product-search').value = '';
  document.getElementById('dm-product-suggestions').classList.add('hidden');
  document.getElementById('dm-item-name').value = '';
  document.getElementById('dm-manual-cost').value = '';
  SELECTED_DAMAGE_PRODUCT = null;
  document.getElementById('damageModalTitle').textContent = 'Record Damage / Waste';
  document.getElementById('dmModeToggle').classList.remove('hidden');
  document.getElementById('dm-edit-type-note').classList.add('hidden');
  document.getElementById('dm-product-search').disabled = false;
  setDamageMode('product');
  openModal('damageModal');
}

function editDamage(id) {
  const d = DAMAGES_CACHE.find(x => x.id == id);
  if (!d) return;

  DAMAGE_EDIT_ID = id;
  document.getElementById('damageForm').reset();
  document.getElementById('dm-id').value = id;
  document.getElementById('dm-reason').value = d.reason;
  document.getElementById('dm-date').value = d.damage_date;
  document.getElementById('damageModalTitle').textContent = 'Edit Damage Record';

  // Locked to the record's original type - see the note above setDamageMode.
  document.getElementById('dmModeToggle').classList.add('hidden');
  document.getElementById('dm-edit-type-note').classList.remove('hidden');

  if (d.item_type === 'other') {
    setDamageMode('other');
    document.getElementById('dm-item-name').value = d.item_name || '';
    document.getElementById('dm-manual-cost').value = d.manual_cost;
  } else {
    setDamageMode('product');
    SELECTED_DAMAGE_PRODUCT = { id: d.product_id, name: d.product_name };
    document.getElementById('dm-product-id').value = d.product_id;
    document.getElementById('dm-product-search').value = d.product_name;
    document.getElementById('dm-product-search').disabled = true; // product itself isn't editable, only quantity/reason/date
    document.getElementById('dm-qty').value = d.quantity;
  }

  openModal('damageModal');
}

document.getElementById('damageForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  let payload;
  if (DAMAGE_MODE === 'product') {
    if (!SELECTED_DAMAGE_PRODUCT) { toast('Please search and select a product first.', 'error'); return; }
    payload = {
      item_type: 'product',
      product_id: SELECTED_DAMAGE_PRODUCT.id,
      quantity: document.getElementById('dm-qty').value,
      reason: document.getElementById('dm-reason').value.trim(),
      damage_date: document.getElementById('dm-date').value,
    };
  } else {
    const itemName = document.getElementById('dm-item-name').value.trim();
    if (!itemName) { toast('Please enter the name of the damaged item.', 'error'); return; }
    const cost = document.getElementById('dm-manual-cost').value;
    if (cost === '' || Number(cost) < 0) { toast('Please enter the cost of the item.', 'error'); return; }
    payload = {
      item_type: 'other',
      item_name: itemName,
      manual_cost: cost,
      reason: document.getElementById('dm-reason').value.trim(),
      damage_date: document.getElementById('dm-date').value,
    };
  }

  const res = DAMAGE_EDIT_ID
    ? await API.put('damages.php', { id: DAMAGE_EDIT_ID, ...payload })
    : await API.post('damages.php', payload);

  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  closeModal('damageModal');
  loadProductOptions();
  loadDamages();
});

async function deleteDamage(id) {
  if (!confirm('Delete this damage record? Any stock it removed will be restored.')) return;
  const res = await API.del('damages.php', { id });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  loadProductOptions();
  loadDamages();
}

function downloadDamagesExcel() {
  const rows = DAMAGES_CACHE.map(d => [
    d.damage_date, d.display_name || d.product_name || d.item_name, d.item_type === 'other' ? '' : (d.unit || ''),
    d.item_type === 'other' ? '' : d.quantity, d.reason, d.display_cost != null ? d.display_cost : d.loss_value, d.recorded_by_name,
  ]);
  exportToExcel('eDESK_Damages_' + document.getElementById('fStart').value + '_to_' + document.getElementById('fEnd').value + '.csv',
    ['Date', 'Item', 'Unit', 'Qty', 'Reason', 'Loss Value', 'Recorded By'], rows);
}
