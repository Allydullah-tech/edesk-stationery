let PRODUCTS_CACHE = [];
let CURRENT_TYPES_PRODUCT = null;
let TYPES_CACHE = [];

(async function init() {
    await requireAuth();
    document.getElementById('print-date-products').textContent = new Date().toLocaleString('en-GB');
    await loadProducts();
})();

/**
 * The Status field has exactly three real-world states:
 *  - Disabled: switched off by an admin, no longer available.
 *  - Low: still available, but stock has fallen below the reorder level.
 *         This is calculated automatically - it's never set by hand.
 *         For a parent product with types, "Low" means at least one of
 *         its types is low, not the parent's own (unused) stock field.
 *  - Active: available, and (for products) stock is healthy.
 * Services have no stock, so they can only ever be Active or Disabled.
 */
function computeStatusTag(p, isService) {
    if (p.status === 'disabled') return '<span class="tag tag-gray">Disabled</span>';
    if (!isService) {
        if (Number(p.variant_count) > 0) {
            if (Number(p.has_low_variant) > 0) return '<span class="tag tag-low">Low</span>';
        } else if (Number(p.stock_quantity) <= Number(p.reorder_level)) {
            return '<span class="tag tag-low">Low</span>';
        }
    }
    return '<span class="tag tag-green">Active</span>';
}

async function loadProducts() {
    const tbody = document.getElementById('productsBody');
    const isService = PAGE_PRODUCT_TYPE === 1;
    const colCount = isService ? 7 : 10;
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="muted">Loading...</td></tr>`;

    const params = { type: String(PAGE_PRODUCT_TYPE) };
    const q = document.getElementById('searchInput').value.trim();
    if (q) params.q = q;

    const res = await API.get('products.php', params);
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="${colCount}" class="muted">${res.message}</td></tr>`; return; }

    PRODUCTS_CACHE = res.data;

    if (!isService) {
        let totalItems = 0,
            totalValue = 0;
        res.data.forEach(p => {
            const hasVariants = Number(p.variant_count) > 0;
            totalItems += Number(p.stock_quantity) || 0;
            totalValue += hasVariants ? (Number(p.variant_stock_value) || 0) : ((Number(p.stock_quantity) || 0) * (Number(p.buying_price) || 0));
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

        const hasVariants = Number(p.variant_count) > 0;
        const buyingCell = hasVariants ?
            (Number(p.min_buying) === Number(p.max_buying) ? money(p.min_buying) : `${money(p.min_buying)} – ${money(p.max_buying)}`) :
            money(p.buying_price);
        const sellingCell = hasVariants ?
            (Number(p.min_selling) === Number(p.max_selling) ? money(p.min_selling) : `${money(p.min_selling)} – ${money(p.max_selling)}`) :
            money(p.selling_price);
        const minCell = hasVariants ? '—' : minPrice;
        const unitCell = hasVariants ? '<span class="muted">Multiple</span>' : p.unit;
        const typesCell = hasVariants ?
            `<button type="button" class="btn btn-outline btn-sm" onclick="openTypesModal(${p.id})">${p.variant_count} type${Number(p.variant_count) === 1 ? '' : 's'} →</button>` :
            `<button type="button" class="btn btn-outline btn-sm" onclick="openTypesModal(${p.id})">+ Add types</button>`;

        return `<tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.category_name || '—'}</td>
      <td>${buyingCell}</td>
      <td>${minCell}</td>
      <td>${sellingCell}</td>
      <td>${unitCell}</td>
      <td>${p.stock_quantity}</td>
      <td class="no-print">${typesCell}</td>
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

document.getElementById('productForm').addEventListener('submit', async(e) => {
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
    if (!confirm('Delete this item? This cannot be undone. Any types under it will be deleted too.')) return;
    const res = await API.del('products.php', { id });
    if (!res.success) { toast(res.message, 'error'); return; }
    toast(res.message);
    loadProducts();
}

function downloadProductsExcel() {
    const isService = PAGE_PRODUCT_TYPE === 1;
    const rows = PRODUCTS_CACHE.map(p => {
        const hasVariants = !isService && Number(p.variant_count) > 0;
        return [
            p.name, p.category_name || '',
            hasVariants ? `${p.min_buying}–${p.max_buying}` : p.buying_price,
            hasVariants ? '' : (p.minimum_price || ''),
            hasVariants ? `${p.min_selling}–${p.max_selling}` : p.selling_price,
            isService ? '' : (hasVariants ? 'Multiple' : p.unit),
            isService ? '' : p.stock_quantity,
            p.status === 'disabled' ?
            'Disabled' :
            (hasVariants ?
                (Number(p.has_low_variant) > 0 ? 'Low' : 'Active') :
                (!isService && Number(p.stock_quantity) <= Number(p.reorder_level) ? 'Low' : 'Active')),
        ];
    });
    exportToExcel('eDESK_' + (isService ? 'Services' : 'Products') + '_' + new Date().toISOString().slice(0, 10) + '.csv', ['Name', 'Category', 'Buying Price', 'Minimum Selling Price', 'Selling Price', 'Unit', 'Stock', 'Status'], rows);
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
    quickNameForm.addEventListener('submit', async(e) => {
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

/* =========================================================
   Types (variants) modal - products.html only. Every element this
   code touches (typesModal, typesBody, variantForm, ...) only exists
   in products.html, never in services.html, and every entry point
   into this block (openTypesModal) is only ever called from a button
   rendered in the non-service branch of loadProducts() above - so
   none of this runs on the Services page.
   ========================================================= */
async function openTypesModal(productId) {
    const p = PRODUCTS_CACHE.find(x => x.id == productId);
    if (!p) return;
    CURRENT_TYPES_PRODUCT = p;
    document.getElementById('typesModalTitle').textContent = 'Types — ' + p.name;
    document.getElementById('typesModalSubtitle').textContent =
        '"' + p.name + '" is the group name. Each type below has its own price, unit, stock and reorder level, and is what gets sold and tracked individually.';
    document.getElementById('v-product-id').value = p.id;
    resetVariantForm();
    await loadTypesList();
    openModal('typesModal');
}

async function loadTypesList() {
    const tbody = document.getElementById('typesBody');
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Loading...</td></tr>';
    const res = await API.get('product_variants.php', { product_id: CURRENT_TYPES_PRODUCT.id });
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="9" class="muted">${res.message}</td></tr>`; return; }
    TYPES_CACHE = res.data;
    renderTypesList();
}

function renderTypesList() {
    const tbody = document.getElementById('typesBody');
    if (!TYPES_CACHE.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="muted">No types yet. Add the first one below.</td></tr>';
        document.getElementById('types-total-stock').textContent = '0';
        return;
    }
    let totalStock = 0;
    tbody.innerHTML = TYPES_CACHE.map(v => {
        totalStock += Number(v.stock_quantity) || 0;
        const low = v.status === 'active' && Number(v.stock_quantity) <= Number(v.reorder_level);
        const statusTag = v.status === 'disabled' ?
            '<span class="tag tag-gray">Disabled</span>' :
            (low ? '<span class="tag tag-low">Low</span>' : '<span class="tag tag-green">Active</span>');
        return `<tr>
      <td><strong>${v.variant_name}</strong></td>
      <td>${money(v.buying_price)}</td>
      <td>${v.minimum_price ? money(v.minimum_price) : '—'}</td>
      <td>${money(v.selling_price)}</td>
      <td>${v.unit}</td>
      <td>${v.stock_quantity}</td>
      <td>${v.reorder_level}</td>
      <td class="no-print">${statusTag}</td>
      <td class="admin-only no-print">
        <button type="button" class="icon-action-btn edit-btn" title="Edit" onclick="editVariant(${v.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        <button type="button" class="icon-action-btn delete-btn" title="Delete" onclick="deleteVariant(${v.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </td>
    </tr>`;
    }).join('');
    document.getElementById('types-total-stock').textContent = totalStock;
    applyRoleVisibility();
}

function resetVariantForm() {
    const form = document.getElementById('variantForm');
    if (!form) return;
    form.reset();
    document.getElementById('v-id').value = '';
    document.getElementById('v-unit').value = 'pcs';
    document.getElementById('v-reorder').value = 5;
    document.getElementById('v-stock').value = 0;
    document.getElementById('variantFormTitle').textContent = '+ Add Type';
    document.getElementById('variantSubmitBtn').textContent = 'Add Type';
    document.getElementById('v-statusField').style.display = 'none';
    document.getElementById('variantCancelBtn').classList.add('hidden');
}

function editVariant(id) {
    const v = TYPES_CACHE.find(x => x.id == id);
    if (!v) return;
    document.getElementById('v-id').value = v.id;
    document.getElementById('v-name').value = v.variant_name;
    document.getElementById('v-buying').value = v.buying_price;
    document.getElementById('v-selling').value = v.selling_price;
    document.getElementById('v-minimum').value = v.minimum_price || '';
    document.getElementById('v-unit').value = v.unit;
    document.getElementById('v-stock').value = v.stock_quantity;
    document.getElementById('v-reorder').value = v.reorder_level;
    document.getElementById('v-status').value = v.status;
    document.getElementById('variantFormTitle').textContent = 'Edit Type';
    document.getElementById('variantSubmitBtn').textContent = 'Update Type';
    document.getElementById('v-statusField').style.display = 'block';
    document.getElementById('variantCancelBtn').classList.remove('hidden');
    document.getElementById('v-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Guarded (like quickNameForm above): this element only exists in
// products.html, so this must not blow up when products.js runs on
// services.html.
const variantForm = document.getElementById('variantForm');
if (variantForm) {
    variantForm.addEventListener('submit', async(e) => {
        e.preventDefault();
        const id = document.getElementById('v-id').value;
        const payload = {
            product_id: document.getElementById('v-product-id').value,
            variant_name: document.getElementById('v-name').value.trim(),
            buying_price: document.getElementById('v-buying').value,
            selling_price: document.getElementById('v-selling').value,
            minimum_price: document.getElementById('v-minimum').value,
            unit: document.getElementById('v-unit').value.trim() || 'pcs',
            stock_quantity: document.getElementById('v-stock').value,
            reorder_level: document.getElementById('v-reorder').value,
        };

        let res;
        if (id) {
            payload.id = id;
            payload.status = document.getElementById('v-status').value;
            res = await API.put('product_variants.php', payload);
        } else {
            res = await API.post('product_variants.php', payload);
        }

        if (!res.success) { toast(res.message, 'error'); return; }
        toast(res.message);
        resetVariantForm();
        await loadTypesList();
        loadProducts();
    });
}

async function deleteVariant(id) {
    if (!confirm('Delete this type? This cannot be undone.')) return;
    const res = await API.del('product_variants.php', { id });
    if (!res.success) { toast(res.message, 'error'); return; }
    toast(res.message);
    await loadTypesList();
    loadProducts();
}