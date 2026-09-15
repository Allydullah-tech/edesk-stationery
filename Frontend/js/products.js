let PRODUCTS_CACHE = [];
let CURRENT_TYPES_PRODUCT = null;
let TYPES_CACHE = [];
let NEW_VARIANT_SEQ = 0;

(async function init() {
    await requireAuth();
    document.getElementById('print-date-products').textContent = new Date().toLocaleString('en-GB');
    await loadProducts();
    loadTypeNameSuggestions();
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
        const unitCell = hasVariants ? (p.variant_unit || '—') : p.unit;
        // "Description" column: doubles as the quick/emergency entry point for
        // managing this product's types - same modal as before, just relocated
        // and relabelled on the list.
        const descriptionCell = hasVariants ?
            `<button type="button" class="btn btn-outline btn-sm" onclick="openTypesModal(${p.id})">${p.variant_count} description${Number(p.variant_count) === 1 ? '' : 's'} →</button>` :
            `<button type="button" class="btn btn-outline btn-sm" onclick="openTypesModal(${p.id})">+ Add descriptions</button>`;

        return `<tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.category_name || '—'}</td>
      <td class="no-print">${descriptionCell}</td>
      <td>${buyingCell}</td>
      <td>${minCell}</td>
      <td>${sellingCell}</td>
      <td>${unitCell}</td>
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
    // p-unit no longer exists on the Products page (it's on each type now) -
    // still exists on the Services page, so guard it.
    const unitField = document.getElementById('p-unit');
    if (unitField) unitField.value = 'pcs';
    resetNewVariantsList();
    // Services can't have types (enforced server-side too) - only show the
    // builder for the Products page. Every product must have at least one
    // type, so start with one row ready to fill in.
    const variantsSection = document.getElementById('newVariantsSection');
    if (variantsSection) variantsSection.style.display = PAGE_PRODUCT_TYPE === 1 ? 'none' : 'block';
    if (PAGE_PRODUCT_TYPE === 0) addNewVariantRow();
    openModal('productModal');
}

function editProduct(id) {
    const p = PRODUCTS_CACHE.find(x => x.id == id);
    if (!p) return;
    document.getElementById('productModalTitle').textContent = PAGE_PRODUCT_TYPE === 1 ? 'Edit Service' : 'Edit Product';
    document.getElementById('p-id').value = p.id;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-category').value = p.category_name || '';
    // Buying/selling/minimum/stock/reorder/unit only exist in the form for
    // Services now - a product's own copies of these are unused once it's
    // saved with types, so guard every one of them.
    const buyingField = document.getElementById('p-buying');
    if (buyingField) buyingField.value = p.buying_price;
    const sellingField = document.getElementById('p-selling');
    if (sellingField) sellingField.value = p.selling_price;
    const minField = document.getElementById('p-minimum');
    if (minField) minField.value = p.minimum_price || '';
    const stockField = document.getElementById('p-stock');
    if (stockField) stockField.value = p.stock_quantity;
    const reorderField = document.getElementById('p-reorder');
    if (reorderField) reorderField.value = p.reorder_level;
    const unitField = document.getElementById('p-unit');
    if (unitField) unitField.value = p.unit;
    document.getElementById('p-status').value = p.status;
    document.getElementById('statusField').style.display = 'block';
    // Editing an existing item: types are managed from the "Description"
    // column on the list instead, so the inline builder stays out of the way.
    resetNewVariantsList();
    const variantsSection = document.getElementById('newVariantsSection');
    if (variantsSection) variantsSection.style.display = 'none';
    openModal('productModal');
}

document.getElementById('productForm').addEventListener('submit', async(e) => {
    e.preventDefault();
    const id = document.getElementById('p-id').value;

    // Only a brand-new item can carry inline types from this form; for an
    // existing item they're always added via the "Description" column.
    let newVariants = [];
    if (!id) {
        try {
            newVariants = collectNewVariants();
        } catch (err) {
            toast(err.message, 'error');
            return;
        }
        // Products (not services) no longer carry their own price/unit/stock -
        // every product is required to have at least one type.
        if (PAGE_PRODUCT_TYPE === 0 && newVariants.length === 0) {
            toast('Add at least one description before saving - every product needs at least one.', 'error');
            return;
        }
    }

    // p-buying/p-selling/p-minimum/p-stock/p-reorder/p-unit only exist in
    // the form for Services now - a product's price/unit/stock live on its
    // type(s) instead, so guard every one of them here.
    const unitField = document.getElementById('p-unit');
    const payload = {
        name: document.getElementById('p-name').value.trim(),
        category_name: document.getElementById('p-category').value.trim(),
        is_service: PAGE_PRODUCT_TYPE,
        buying_price: document.getElementById('p-buying') ? document.getElementById('p-buying').value : '',
        selling_price: document.getElementById('p-selling') ? document.getElementById('p-selling').value : '',
        minimum_price: document.getElementById('p-minimum') ? document.getElementById('p-minimum').value : '',
        stock_quantity: document.getElementById('p-stock') ? document.getElementById('p-stock').value : '',
        reorder_level: document.getElementById('p-reorder') ? document.getElementById('p-reorder').value : '',
        unit: unitField ? (unitField.value.trim() || 'pcs') : 'pcs',
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

    if (!id && newVariants.length && res.data && res.data.id) {
        const newProductId = res.data.id;
        let added = 0;
        const failures = [];
        for (const v of newVariants) {
            const vRes = await API.post('product_variants.php', { ...v, product_id: newProductId });
            if (vRes.success) added++;
            else failures.push(`${v.variant_name} (${vRes.message})`);
        }
        if (failures.length) {
            toast(`${res.message} ${added} of ${newVariants.length} description(s) saved. Couldn't save: ${failures.join(', ')}`, added ? 'success' : 'error');
        } else {
            toast(`${res.message} ${added} description${added === 1 ? '' : 's'} added.`);
        }
        loadTypeNameSuggestions();
    } else {
        toast(res.message);
    }

    closeModal('productModal');
    loadProducts();
});

async function deleteProduct(id) {
    if (!confirm('Delete this item? This cannot be undone. Any descriptions under it will be deleted too.')) return;
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
            isService ? '' : (hasVariants ? (p.variant_unit || '') : p.unit),
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
   Inline Types / Variants builder - lives inside the Add Item form so a
   product's types can be created (or picked from ones used before, via
   the type-name suggestions) at the same time the product itself is
   created. Guarded like quickNameForm/variantForm below: these elements
   only exist in products.html, never in services.html.
   ========================================================= */
async function loadTypeNameSuggestions() {
    const datalist = document.getElementById('typeNameSuggestions');
    if (!datalist) return;
    const res = await API.get('product_variants.php', { all_names: 1 });
    if (!res.success || !Array.isArray(res.data)) return;
    datalist.innerHTML = res.data.map(name => `<option value="${name}"></option>`).join('');
}

function resetNewVariantsList() {
    const list = document.getElementById('newVariantsList');
    if (list) list.innerHTML = '';
}

function addNewVariantRow() {
    const list = document.getElementById('newVariantsList');
    if (!list) return;
    const rowId = 'nv' + (++NEW_VARIANT_SEQ);
    list.insertAdjacentHTML('beforeend', `
    <div class="new-variant-row" data-row-id="${rowId}">
      <div class="field-row nv-remove-row">
        <div class="field">
          <label>Description Name</label>
          <input type="text" class="nv-name" list="typeNameSuggestions" placeholder="e.g. Obama Pen (type or pick one)">
        </div>
        <button type="button" class="icon-action-btn delete-btn" title="Remove this description" onclick="removeNewVariantRow('${rowId}')">
          <svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg>
        </button>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Buying Price (TZS)</label>
          <input type="number" class="nv-buying" min="0" step="0.01">
        </div>
        <div class="field">
          <label>Selling Price (TZS)</label>
          <input type="number" class="nv-selling" min="0" step="0.01">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Minimum Price (TZS) — optional</label>
          <input type="number" class="nv-minimum" min="0" step="0.01">
        </div>
        <div class="field">
          <label>Unit</label>
          <input type="text" class="nv-unit" placeholder="pcs, box..." value="pcs">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Stock Quantity</label>
          <input type="number" class="nv-stock" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label>Reorder Alert Level</label>
          <input type="number" class="nv-reorder" min="0" step="1" value="5">
        </div>
      </div>
    </div>`);
}

function removeNewVariantRow(rowId) {
    const row = document.querySelector(`.new-variant-row[data-row-id="${rowId}"]`);
    if (row) row.remove();
}

// Reads whichever type rows the admin actually filled in (a blank, untouched
// row is ignored rather than rejected) and turns them into payloads ready
// for product_variants.php. Throws with a friendly message if a named type
// is missing the one thing product_variants.php requires beyond the name.
function collectNewVariants() {
    const rows = document.querySelectorAll('#newVariantsList .new-variant-row');
    const variants = [];
    for (const row of rows) {
        const name = row.querySelector('.nv-name').value.trim();
        if (!name) continue;
        const selling = row.querySelector('.nv-selling').value;
        if (selling === '') {
            throw new Error(`"${name}" needs a Selling Price before it can be saved.`);
        }
        variants.push({
            variant_name: name,
            buying_price: row.querySelector('.nv-buying').value,
            selling_price: selling,
            minimum_price: row.querySelector('.nv-minimum').value,
            unit: row.querySelector('.nv-unit').value.trim() || 'pcs',
            stock_quantity: row.querySelector('.nv-stock').value,
            reorder_level: row.querySelector('.nv-reorder').value,
        });
    }
    return variants;
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
    document.getElementById('typesModalTitle').textContent = 'Descriptions — ' + p.name;
    document.getElementById('typesModalSubtitle').textContent =
        '"' + p.name + '" is the group name. Each description below has its own price, unit, stock and reorder level, and is what gets sold and tracked individually.';
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
        tbody.innerHTML = '<tr><td colspan="9" class="muted">No descriptions yet. Add the first one below.</td></tr>';
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
    document.getElementById('variantFormTitle').textContent = '+ Add Description';
    document.getElementById('variantSubmitBtn').textContent = 'Add Description';
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
    document.getElementById('variantFormTitle').textContent = 'Edit Description';
    document.getElementById('variantSubmitBtn').textContent = 'Update Description';
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
    if (!confirm('Delete this description? This cannot be undone.')) return;
    const res = await API.del('product_variants.php', { id });
    if (!res.success) { toast(res.message, 'error'); return; }
    toast(res.message);
    await loadTypesList();
    loadProducts();
}