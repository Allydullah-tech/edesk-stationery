/**
 * eDESK Print & Digital - Products / Services page logic
 * Shared by products.html (PAGE_PRODUCT_TYPE = 0) and
 * services.html (PAGE_PRODUCT_TYPE = 1).
 */
let PRODUCTS_CACHE = [];

(async function init() {
  await requireAuth();
  document.getElementById('print-date-products').textContent = 'Generated ' + new Date().toLocaleString('en-GB');
  await loadProducts();
})();

/**
 * The Status field has exactly three real-world states:
 *  - Disabled: switched off by an admin, no longer available.
 *  - Low: still available, but stock has fallen below the reorder level.
 *         This is calculated automatically - it's never set by hand.
 *  - Active: available, and (for products) stock is healthy.
 * Services have no stock, so they can only ever be Active or Disabled.
 */
function computeStatusTag(p, isService) {
  if (p.status === 'disabled') return '<span class="tag tag-gray">Disabled</span>';
  if (!isService && Number(p.stock_quantity) <= Number(p.reorder_level)) return '<span class="tag tag-low">Low</span>';
  return '<span class="tag tag-green">Active</span>';
}

async function loadProducts() {
  const tbody = document.getElementById('productsBody');
  const isService = PAGE_PRODUCT_TYPE === 1;
  const colCount = isService ? 7 : 9;
  tbody.innerHTML = `<tr><td colspan="${colCount}" class="muted">Loading...</td></tr>`;

  const params = { type: String(PAGE_PRODUCT_TYPE) };
  const q = document.getElementById('searchInput').value.trim();
  if (q) params.q = q;

  const res = await API.get('products.php', params);
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="${colCount}" class="muted">${res.message}</td></tr>`; return; }

  PRODUCTS_CACHE = res.data;

  if (!isService) {
    let totalItems = 0, totalValue = 0;
    res.data.forEach(p => {
      totalItems += Number(p.stock_quantity) || 0;
      totalValue += (Number(p.stock_quantity) || 0) * (Number(p.buying_price) || 0);
    });
    document.getElementById('pr-total-products').textContent = res.data.length;
    document.getElementById('pr-total-items').textContent = totalItems;
    document.getElementById('pr-total-value').textContent = money(totalValue);
  } else {
    document.getElementById('pr-total-services').textContent = res.data.length;
  }

  if (!res.data.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="muted">No ${isService ? 'services' : 'products'} yet. Click "+ Add ${isService ? 'Service' : 'Item'}" to get started.</td></tr>`;
    return;
  }

  tbody.innerHTML = res.data.map(p => {
    const statusTag = computeStatusTag(p, isService);
    const minPrice = p.minimum_price ? money(p.minimum_price) : '—';
    const actions = `<td class="admin-only no-print">
        <button class="icon-action-btn edit-btn" title="Edit" onclick="editProduct(${p.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        <button class="icon-action-btn delete-btn" title="Delete" onclick="deleteProduct(${p.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </td>`;

    if (isService) {
      return `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.category_name || '—'}</td>
        <td>${money(p.buying_price)}</td>
        <td>${minPrice}</td>
        <td>${money(p.selling_price)}</td>
        <td class="no-print">${statusTag}</td>
        ${actions}
      </tr>`;
    }

    return `<tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.category_name || '—'}</td>
      <td>${money(p.buying_price)}</td>
      <td>${minPrice}</td>
      <td>${money(p.selling_price)}</td>
      <td>${p.unit}</td>
      <td>${p.stock_quantity}</td>
      <td class="no-print">${statusTag}</td>
      ${actions}
    </tr>`;
  }).join('');

  applyRoleVisibility();
}

function openProductModal() {
  document.getElementById('productForm').reset();
  document.getElementById('p-id').value = '';
  document.getElementById('productModalTitle').textContent = PAGE_PRODUCT_TYPE === 1 ? 'Add Service' : 'Add Product';
  document.getElementById('statusField').style.display = 'none';
  document.getElementById('p-unit').value = 'pcs';
  openModal('productModal');
}

function editProduct(id) {
  const p = PRODUCTS_CACHE.find(x => x.id == id);
  if (!p) return;
  document.getElementById('productModalTitle').textContent = PAGE_PRODUCT_TYPE === 1 ? 'Edit Service' : 'Edit Product';
  document.getElementById('p-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-category').value = p.category_name || '';
  document.getElementById('p-buying').value = p.buying_price;
  document.getElementById('p-selling').value = p.selling_price;
  document.getElementById('p-minimum').value = p.minimum_price || '';
  document.getElementById('p-stock').value = p.stock_quantity;
  document.getElementById('p-reorder').value = p.reorder_level;
  document.getElementById('p-unit').value = p.unit;
  document.getElementById('p-status').value = p.status;
  document.getElementById('statusField').style.display = 'block';
  openModal('productModal');
}

document.getElementById('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('p-id').value;
  const payload = {
    name: document.getElementById('p-name').value.trim(),
    category_name: document.getElementById('p-category').value.trim(),
    is_service: PAGE_PRODUCT_TYPE,
    buying_price: document.getElementById('p-buying').value,
    selling_price: document.getElementById('p-selling').value,
    minimum_price: document.getElementById('p-minimum').value,
    stock_quantity: document.getElementById('p-stock').value,
    reorder_level: document.getElementById('p-reorder').value,
    unit: document.getElementById('p-unit').value.trim() || 'pcs',
  };

  let res;
  if (id) {
    payload.id = id;
    payload.status = document.getElementById('p-status').value;
    res = await API.put('products.php', payload);
  } else {
    res = await API.post('products.php', payload);
  }

  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  closeModal('productModal');
  loadProducts();
});

async function deleteProduct(id) {
  if (!confirm('Delete this item? This cannot be undone.')) return;
  const res = await API.del('products.php', { id });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  loadProducts();
}

function downloadProductsExcel() {
  const isService = PAGE_PRODUCT_TYPE === 1;
  const rows = PRODUCTS_CACHE.map(p => [
    p.name, p.category_name || '', p.buying_price, p.minimum_price || '', p.selling_price,
    isService ? '' : p.unit, isService ? '' : p.stock_quantity,
    p.status === 'disabled' ? 'Disabled' : (!isService && Number(p.stock_quantity) <= Number(p.reorder_level) ? 'Low' : 'Active'),
  ]);
  exportToExcel('eDESK_' + (isService ? 'Services' : 'Products') + '_' + new Date().toISOString().slice(0, 10) + '.csv',
    ['Name', 'Category', 'Buying Price', 'Minimum Selling Price', 'Selling Price', 'Unit', 'Stock', 'Status'], rows);
}

/**
 * A quick, no-frills view of just names - nothing else - for times
 * someone just needs to see what's offered, with a search box to
 * filter down to a word or two, and (for admins) a way to add a brand
 * new name right there without leaving this view.
 */
function openNamesOnlyModal() {
  const isService = PAGE_PRODUCT_TYPE === 1;
  document.getElementById('namesOnlyModalTitle').textContent = isService ? 'Service Names' : 'Product Names';
  document.getElementById('namesOnlySearch').value = '';
  document.getElementById('quickNameInput').value = '';
  renderNamesOnlyList();
  openModal('namesOnlyModal');
}

const quickNameForm = document.getElementById('quickNameForm');
if (quickNameForm) {
  quickNameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('quickNameInput');
    const name = input.value.trim();
    if (!name) return;

    const res = await API.post('products.php', { name, is_service: PAGE_PRODUCT_TYPE });
    if (!res.success) { toast(res.message, 'error'); return; }

    toast(name + ' added to the ' + (PAGE_PRODUCT_TYPE === 1 ? 'Service' : 'Product') + ' list.');
    input.value = '';

    const listRes = await API.get('products.php', { type: String(PAGE_PRODUCT_TYPE) });
    if (listRes.success) PRODUCTS_CACHE = listRes.data;
    renderNamesOnlyList();
  });
}

function renderNamesOnlyList() {
  const isService = PAGE_PRODUCT_TYPE === 1;
  const q = document.getElementById('namesOnlySearch').value.trim().toLowerCase();
  const list = document.getElementById('namesOnlyList');

  const filtered = PRODUCTS_CACHE.filter(p => p.name.toLowerCase().includes(q));

  if (!filtered.length) {
    list.innerHTML = `<p class="muted">No matching ${isService ? 'services' : 'products'} found.</p>`;
    return;
  }

  list.innerHTML = filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px;">${p.name}</div>`)
    .join('');
}
