let DEBTS_CACHE = [];

(async function init() {
    await requireAuth();
    document.getElementById('pay-date').value = todayStr();
    document.getElementById('print-date-debts').textContent = new Date().toLocaleString('en-GB');
    await loadDebts();
})();

function todayStr() { return new Date().toISOString().slice(0, 10); }

/** Format a Date as YYYY-MM-DD using LOCAL time (not UTC, unlike toISOString). */
function toLocalISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Turn a period keyword (week/month/year) into a {start, end} date-string
 * pair covering that whole calendar period around today. "week" runs
 * Monday -> Sunday of the current week.
 */
function debtsPeriodRange(period) {
    const now = new Date();
    let start, end;

    if (period === 'week') {
        const day = now.getDay(); // 0 = Sunday ... 6 = Saturday
        const mondayOffset = (day === 0) ? -6 : 1 - day;
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
        end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    } else if (period === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (period === 'year') {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
    } else {
        return null;
    }

    return { start: toLocalISODate(start), end: toLocalISODate(end) };
}

async function loadDebts() {
    const tbody = document.getElementById('debtsBody');
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Loading...</td></tr>';

    const params = {};
    const status = document.getElementById('statusFilter').value;
    if (status) params.status = status;

    const rangeHint = document.getElementById('debtsRangeHint');
    const period = document.getElementById('periodFilter').value;

    if (period === 'custom') {
        const start = document.getElementById('debtsStartDate').value;
        const end = document.getElementById('debtsEndDate').value;
        if (start) params.start = start;
        if (end) params.end = end;
        rangeHint.textContent = (start || end) ?
            `Showing debts from ${start ? fmtDate(start) : 'the beginning'} to ${end ? fmtDate(end) : 'today'}.` :
            'Pick a start and/or end date for the custom range.';
    } else if (period) {
        const range = debtsPeriodRange(period);
        params.start = range.start;
        params.end = range.end;
        rangeHint.textContent = `Showing debts from ${fmtDate(range.start)} to ${fmtDate(range.end)}.`;
    } else {
        rangeHint.textContent = 'Showing debts from all time.';
    }

    const res = await API.get('debts.php', params);
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="9" class="muted">${res.message}</td></tr>`; return; }

    DEBTS_CACHE = res.data;

    let outstanding = 0,
        overdue = 0,
        openCount = 0,
        totalOwed = 0;
    res.data.forEach(d => {
        totalOwed += Number(d.total_amount);
        if (d.status !== 'paid') {
            outstanding += Number(d.remaining);
            openCount++;
            if (d.status === 'overdue') overdue += Number(d.remaining);
        }
    });
    document.getElementById('d-outstanding').textContent = money(outstanding);
    document.getElementById('d-overdue').textContent = money(overdue);
    document.getElementById('d-count').textContent = openCount;
    document.getElementById('d-outstanding-print').textContent = money(outstanding);
    document.getElementById('d-overdue-print').textContent = money(overdue);
    document.getElementById('d-count-print').textContent = openCount;

    if (!res.data.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">No credit sales found.</td></tr>'; return; }

    tbody.innerHTML = res.data.map(d => {
                const isOverdue = d.status === 'overdue';
                const rowStyle = isOverdue ? ' style="background:#FEF6F5;"' : '';
                const remainingClass = d.status === 'paid' ? 'muted' : (isOverdue ? 'red' : 'gold');
                const customerCell = `<a href="customers.html?q=${encodeURIComponent(d.customer_phone || d.customer_name || '')}" style="color:inherit;text-decoration:none;">${d.customer_name || '—'}${d.customer_phone ? `<br><span class="muted" style="font-size:11.5px;">${d.customer_phone}</span>` : ''}</a>`;
    return `
    <tr${rowStyle}>
      <td>${fmtDate(d.sale_date)}</td>
      <td>${customerCell}</td>
      <td>${d.item_names}</td>
      <td>${money(d.total_amount)}</td>
      <td class="green">${money(d.paid_amount)}</td>
      <td class="${remainingClass}"><strong>${money(d.remaining)}</strong></td>
      <td class="${isOverdue ? 'red' : ''}">${d.credit_deadline ? fmtDate(d.credit_deadline) : '—'}${isOverdue ? ' <svg class="ui-icon" style="width:12px;height:12px;"><use href="assets/icons.svg#alert-triangle"></use></svg>' : ''}</td>
      <td>${statusTag(d.status)}</td>
      <td class="no-print">
        <button class="icon-action-btn view-btn" title="View payment history" onclick="openHistoryModal(${d.id})"><svg class="ui-icon"><use href="assets/icons.svg#eye"></use></svg></button>
        ${d.status !== 'paid' ? `<button class="btn btn-primary btn-sm" onclick="openPaymentModal(${d.id})">Record Payment</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function statusTag(status) {
  if (status === 'paid') return '<span class="tag tag-green">Paid</span>';
  if (status === 'overdue') return '<span class="tag tag-red">Overdue</span>';
  return '<span class="tag tag-gold">Pending</span>';
}

function openPaymentModal(saleId) {
  const d = DEBTS_CACHE.find(x => x.id == saleId);
  if (!d) return;

  document.getElementById('paymentForm').reset();
  document.getElementById('pay-sale-id').value = saleId;
  document.getElementById('pay-date').value = todayStr();
  document.getElementById('paymentContext').textContent =
    `${d.customer_name || 'Customer'}${d.customer_phone ? ' (' + d.customer_phone + ')' : ''} — ${d.item_names} — Remaining: ${money(d.remaining)}`;
  document.getElementById('pay-amount').max = d.remaining;
  document.getElementById('pay-remaining-hint').textContent = `Remaining balance: ${money(d.remaining)}. Cannot exceed this.`;

  openModal('paymentModal');
}

document.getElementById('paymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const res = await API.post('debts.php', {
    sale_id: document.getElementById('pay-sale-id').value,
    amount: document.getElementById('pay-amount').value,
    payment_date: document.getElementById('pay-date').value,
    method: document.getElementById('pay-method').value,
    online_method: document.getElementById('pay-online-method').value.trim(),
    note: document.getElementById('pay-note').value.trim(),
  });

  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  closeModal('paymentModal');
  loadDebts();
});

/**
 * Full payment history for one debt: every date/amount the customer has
 * ever paid against it, plus the original amount, total paid, and the
 * remaining balance.
 */
let HISTORY_SALE = null; // the debt currently shown in the history modal

async function openHistoryModal(saleId) {
  const d = DEBTS_CACHE.find(x => x.id == saleId);
  document.getElementById('historyContext').innerHTML =
    `<strong>${d ? (d.customer_name || 'Customer') : 'Customer'}</strong>${d && d.customer_phone ? ' &middot; ' + d.customer_phone : ''}${d ? ' &middot; ' + d.item_names : ''}`;
  document.getElementById('historyBody').innerHTML = '<tr><td colspan="6" class="muted">Loading...</td></tr>';
  openModal('historyModal');

  const res = await API.get('debts.php', { history: saleId });
  if (!res.success) { document.getElementById('historyBody').innerHTML = `<tr><td colspan="6" class="muted">${res.message}</td></tr>`; return; }

  const sale = res.data;
  HISTORY_SALE = sale;
  document.getElementById('hist-original').textContent = money(sale.total_amount);
  document.getElementById('hist-paid').textContent = money(sale.total_paid);
  document.getElementById('hist-remaining').textContent = money(sale.remaining);

  if (!sale.payments.length) {
    document.getElementById('historyBody').innerHTML = '<tr><td colspan="6" class="muted">No payments recorded yet against this debt.</td></tr>';
    return;
  }

  document.getElementById('historyBody').innerHTML = sale.payments.map(p => `
    <tr>
      <td>${fmtDate(p.payment_date)}</td>
      <td class="green"><strong>${money(p.amount)}</strong></td>
      <td>${p.method === 'online' ? 'Online' + (p.online_method ? ' (' + p.online_method + ')' : '') : 'Cash'}</td>
      <td>${p.recorded_by_name}</td>
      <td class="muted">${p.note || '—'}</td>
      <td class="admin-only">
        <button class="icon-action-btn edit-btn" title="Edit payment" onclick="openEditPayment(${p.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        <button class="icon-action-btn delete-btn" title="Delete payment" onclick="deletePayment(${p.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>
      </td>
    </tr>`).join('');
  applyRoleVisibility(); // hides the Actions column for workers
}

/* ========================================================================
   Edit / Delete a recorded payment (admin only - the server enforces it too)
   ======================================================================== */
function openEditPayment(paymentId) {
  if (!HISTORY_SALE) return;
  const p = HISTORY_SALE.payments.find(x => x.id == paymentId);
  if (!p) return;

  // The most this payment can be: what the debt totals, less every OTHER payment.
  const maxAllowed = Math.max(Number(HISTORY_SALE.total_amount) - (Number(HISTORY_SALE.total_paid) - Number(p.amount)), 0);

  document.getElementById('ep-id').value = p.id;
  document.getElementById('ep-amount').value = p.amount;
  document.getElementById('ep-amount').max = maxAllowed;
  document.getElementById('ep-date').value = p.payment_date;
  document.getElementById('ep-method').value = p.method === 'online' ? 'online' : 'cash_in_hand';
  const epSel = document.getElementById('ep-online-method');
  const epVal = p.online_method || '';
  // An older payment may carry a method that is not in the list: keep it selectable so it is not lost on save.
  if (epVal && ![...epSel.options].some(o => o.value === epVal)) epSel.add(new Option(epVal, epVal));
  epSel.value = epVal || epSel.options[0].value;
  document.getElementById('ep-online-method-field').classList.toggle('hidden', p.method !== 'online');
  document.getElementById('ep-note').value = p.note || '';
  document.getElementById('editPaymentContext').textContent =
    `${HISTORY_SALE.customer_name || 'Customer'}${HISTORY_SALE.customer_phone ? ' (' + HISTORY_SALE.customer_phone + ')' : ''} — payment recorded by ${p.recorded_by_name}.`;
  document.getElementById('ep-max-hint').textContent = `Cannot exceed ${money(maxAllowed)} (the debt's total less its other payments).`;
  openModal('editPaymentModal');
}

document.getElementById('editPaymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const res = await API.put('debts.php', {
    id: document.getElementById('ep-id').value,
    amount: document.getElementById('ep-amount').value,
    payment_date: document.getElementById('ep-date').value,
    method: document.getElementById('ep-method').value,
    online_method: document.getElementById('ep-online-method').value.trim(),
    note: document.getElementById('ep-note').value.trim(),
  });

  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  closeModal('editPaymentModal');
  refreshAfterPaymentChange();
});

async function deletePayment(paymentId) {
  if (!HISTORY_SALE) return;
  const p = HISTORY_SALE.payments.find(x => x.id == paymentId);
  if (!p) return;
  if (!confirm(`Delete this payment of ${money(p.amount)} made on ${fmtDate(p.payment_date)}?\n\nThe amount will be added back to the customer's remaining balance.`)) return;

  const res = await API.del('debts.php', { payment_id: paymentId });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  refreshAfterPaymentChange();
}

/** Refresh the open history modal and the debts table behind it, so every figure matches. */
async function refreshAfterPaymentChange() {
  const saleId = HISTORY_SALE ? HISTORY_SALE.id : null;
  await loadDebts();
  if (saleId) openHistoryModal(saleId);
}

function downloadDebtsExcel() {
  const rows = DEBTS_CACHE.map(d => [
    d.sale_date, d.customer_name || '', d.customer_phone || '', d.item_names, d.total_amount, d.paid_amount, d.remaining,
    d.credit_deadline || '', d.status, d.sold_by_name,
  ]);
  exportToExcel('eDESK_Debts_' + todayStr() + '.csv',
    ['Date', 'Customer', 'Phone', 'Item', 'Total', 'Paid', 'Remaining', 'Deadline', 'Status', 'Sold By'], rows);
}