/**
 * EDESK STATIONERY - Cash Audit
 * "Daily Cash Closing & Sales Reconciliation Sheet" for ONE day.
 *
 *  Part A - cash count: the person types how many notes/coins of each
 *           denomination; the Amount column and the total fill in by themselves.
 *  Part B - reconciliation: Opening Cash comes from the Opening Cash screen (or is carried over
 *           automatically from the previous day's Remaining Cash); everything else is pulled from
 *           the Sales, Debt payments and Expenses recorded on that day. Credit sales are counted in
 *           Total Sales but taken back out of Expected Cash; debts customers paid in cash are added.
 *           It also holds the Bank Deposit & Closing Cash block (Total Cash - Bank Deposit = Remaining
 *           Cash, which becomes tomorrow's Opening Cash).
 *
 * Download as PDF  -> prints ONLY the sheet (choose "Save as PDF" in the print dialog).
 * Download as Excel -> a real .xlsx (formulas included), built right here in the browser.
 *
 * Needs (already on the Sales page): api.js, ui.js, guard.js, sales.js.
 */
(function () {
  'use strict';

  const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50];
  const LOGO_SRC = 'assets/logo1.png'; // same logo as the login page
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const drafts = {};   // date -> what the person typed (kept while the page stays open)
  let state = null;    // { date, draft, cash, electronic, credit, expenses, debtCash, debtPayments, outstanding, bankDeposit, ..., ready }
  let built = false;
  let reqToken = 0;

  /* ------------------------------------------------------------------ helpers */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const dayToday = () => (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10));

  function newDraft() {
    const u = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER : null;
    return { cashier: u ? (u.full_name || '') : '', shift: '', opening: '', note: '', userRemark: '', qty: {}, remarks: {} };
  }

  function qtyOf(v, ctx) {
    ctx = ctx || state;
    const q = parseInt(ctx.draft.qty[v], 10);
    return q > 0 ? q : 0;
  }

  /** ctx defaults to the live edit state, but a saved history entry can be
   *  passed in instead so the exact same math/render code can show it
   *  read-only without disturbing whatever is currently being edited.
   *
   *  version 2 (all new sheets):
   *    Actual Cash Available = Opening + (Total Sales - On Credit Sales) + Debts collected in cash
   *    Expected Cash         = Actual Cash Available - Expenses
   *    Remaining Cash        = Total Cash (counted) - Bank Deposit
   *  version 1 (sheets saved before the upgrade) keeps the old formula so history never changes:
   *    Expected Cash = (Opening + Total Sales) - Expenses */
  function calc(ctx) {
    ctx = ctx || state;
    const d = ctx.draft;
    let counted = 0;
    DENOMS.forEach((v) => { counted += v * qtyOf(v, ctx); });
    const opening = Math.max(0, Number(d.opening) || 0);
    const total = ctx.cash + ctx.electronic + ctx.credit;
    const version = ctx.version || 2;
    if (version < 2) {
      return { version, counted, opening, total, expected: (opening + total) - ctx.expenses };
    }
    const debtCash = Number(ctx.debtCash) || 0;
    const received = total - ctx.credit;                 // sales that actually came in (not owed by customers)
    const available = opening + received + debtCash;     // actual cash available
    const expected = available - ctx.expenses;
    const deposit = Number(ctx.bankDeposit) || 0;
    const remaining = counted - deposit;                 // cash left at the office = tomorrow's opening cash
    return { version, counted, opening, total, received, debtCash, available, expected, deposit, remaining };
  }

  /* ------------------------------------------------------------------ DOM */
  function build() {
    if (built) return;
    built = true;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="cashAuditModal">
        <div class="modal modal-xl">
          <div class="modal-head">
            <h3>Cash Audit — Daily Cash Closing</h3>
            <div class="ca-head-actions">
              <button type="button" class="btn btn-outline btn-sm" id="caFloatBtn">
                <svg class="ui-icon"><use href="assets/icons.svg#coins"></use></svg> Opening Cash
              </button>
              <button type="button" class="btn btn-outline btn-sm" id="caBankBtn">
                <svg class="ui-icon"><use href="assets/icons.svg#coins"></use></svg> Bank Deposit
              </button>
              <button type="button" class="btn btn-outline btn-sm" id="caHistoryBtn">
                <svg class="ui-icon"><use href="assets/icons.svg#calendar"></use></svg> History
              </button>
              <button type="button" class="btn btn-outline btn-sm" id="caDownloadBtn">
                <svg class="ui-icon"><use href="assets/icons.svg#download"></use></svg> Download
              </button>
              <button type="button" class="btn btn-primary btn-sm" id="caSaveBtn">Save</button>
              <button type="button" class="modal-close" id="caCloseBtn" title="Close">
                <svg class="ui-icon"><use href="assets/icons.svg#x"></use></svg>
              </button>
            </div>
          </div>
          <div class="modal-body">
            <p class="ca-status" id="caStatus"></p>
            <div class="ca-scroll"><div id="cashAuditSheet"></div></div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="cashAuditHistoryModal">
        <div class="modal modal-xl">
          <div class="modal-head">
            <h3>Cash Audit — History</h3>
            <button type="button" class="modal-close" id="cahCloseBtn" title="Close">
              <svg class="ui-icon"><use href="assets/icons.svg#x"></use></svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="filter-bar" style="margin-bottom:14px;">
              <div class="field" style="margin:0;width:150px;">
                <label>From</label>
                <input type="date" id="cahStart">
              </div>
              <div class="field" style="margin:0;width:150px;">
                <label>To</label>
                <input type="date" id="cahEnd">
              </div>
              <div class="field" style="margin:0;width:190px;">
                <label>Saved By</label>
                <select id="cahSavedBy"><option value="">Everyone</option></select>
              </div>
              <button type="button" class="btn btn-outline btn-sm" id="cahFilterBtn">Filter</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Cashier</th><th>Shift</th><th>Total Cash</th><th>Expected</th>
                    <th>Variance</th><th>Bank Deposit</th><th>Remaining Cash</th><th>Remarks</th>
                    <th>Saved By</th><th>Saved At</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody id="cahBody"><tr><td colspan="12" class="muted">Loading...</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="cashAuditViewModal">
        <div class="modal modal-xl">
          <div class="modal-head">
            <h3>Cash Audit — <span id="cavTitle"></span></h3>
            <div class="ca-head-actions">
              <button type="button" class="btn btn-outline btn-sm" id="cavDownloadBtn">
                <svg class="ui-icon"><use href="assets/icons.svg#download"></use></svg> Download
              </button>
              <button type="button" class="modal-close" id="cavCloseBtn" title="Close">
                <svg class="ui-icon"><use href="assets/icons.svg#x"></use></svg>
              </button>
            </div>
          </div>
          <div class="modal-body">
            <div class="ca-scroll"><div id="cashAuditViewSheet"></div></div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="cashFloatModal">
        <div class="modal">
          <div class="modal-head">
            <h3>Opening Cash &amp; Float</h3>
            <div class="ca-head-actions">
              <button type="button" class="btn btn-outline btn-sm" id="cfHistoryBtn">
                <svg class="ui-icon"><use href="assets/icons.svg#calendar"></use></svg> History
              </button>
              <button type="button" class="modal-close" id="cfCloseBtn" title="Close">
                <svg class="ui-icon"><use href="assets/icons.svg#x"></use></svg>
              </button>
            </div>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Date</label>
              <input type="date" id="cfDate">
            </div>
            <div id="cfSummary" class="cf-summary"></div>

            <div class="cf-form">
              <div class="field">
                <label>What happened?</label>
                <select id="cfType">
                  <option value="opening">Set opening cash (what the day started with)</option>
                  <option value="add">Add to float (float increased)</option>
                  <option value="reduce">Reduce float (float decreased)</option>
                </select>
              </div>
              <div class="field">
                <label>Amount (TZS)</label>
                <input type="number" id="cfAmount" min="0" step="any" inputmode="decimal" placeholder="0">
              </div>
              <div class="field">
                <label>Note (optional)</label>
                <input type="text" id="cfNote" maxlength="255" placeholder="e.g. change added, cash taken to bank">
              </div>
              <button type="button" class="btn btn-primary" id="cfSaveBtn">Save</button>
              
            </div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="cashFloatHistoryModal">
        <div class="modal modal-xl">
          <div class="modal-head">
            <h3>Opening Cash — History</h3>
            <button type="button" class="modal-close" id="cfhCloseBtn" title="Close">
              <svg class="ui-icon"><use href="assets/icons.svg#x"></use></svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="filter-bar" style="margin-bottom:14px;">
              <div class="field" style="margin:0;width:150px;">
                <label>From</label>
                <input type="date" id="cfhStart">
              </div>
              <div class="field" style="margin:0;width:150px;">
                <label>To</label>
                <input type="date" id="cfhEnd">
              </div>
              <div class="field" style="margin:0;width:170px;">
                <label>Type</label>
                <select id="cfhType">
                  <option value="">All records</option>
                  <option value="opening">Opening cash</option>
                  <option value="add">Added to float</option>
                  <option value="reduce">Reduced from float</option>
                </select>
              </div>
              <div class="field" style="margin:0;width:180px;">
                <label>Saved By</label>
                <select id="cfhSavedBy"><option value="">Everyone</option></select>
              </div>
              <button type="button" class="btn btn-outline btn-sm" id="cfhFilterBtn">Filter</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th><th>Saved By</th><th>Saved At</th><th>Actions</th></tr>
                </thead>
                <tbody id="cfhBody"><tr><td colspan="7" class="muted">Loading...</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="bankDepositModal">
        <div class="modal">
          <div class="modal-head">
            <h3>Bank Deposit &amp; Closing Cash</h3>
            <div class="ca-head-actions">
              <button type="button" class="btn btn-outline btn-sm" id="bdHistoryBtn">
                <svg class="ui-icon"><use href="assets/icons.svg#calendar"></use></svg> History
              </button>
              <button type="button" class="modal-close" id="bdCloseBtn" title="Close">
                <svg class="ui-icon"><use href="assets/icons.svg#x"></use></svg>
              </button>
            </div>
          </div>
          <div class="modal-body">
            <p class="ca-status" id="bdDate"></p>
            <div id="bdSummary" class="cf-summary"></div>
            <div class="cf-form">
              <div class="field">
                <label>Bank Deposit (TZS)</label>
                <input type="number" id="bdAmount" min="0" step="any" inputmode="decimal" placeholder="0">
              </div>
              <div class="field">
                <label>Bank Deposit Remark (optional)</label>
                <textarea id="bdRemark" rows="2" maxlength="1000" placeholder="e.g. Deposited today's excess cash to the boss's bank account."></textarea>
              </div>
              <button type="button" class="btn btn-primary" id="bdSaveBtn">Save Bank Deposit</button>
              <p class="ca-note">The deposit is taken out of the <b>Total Cash</b> counted in Part A. Whatever is left (Remaining Cash) is the cash kept at the
                office and automatically becomes the next day's Opening Cash.</p>
            </div>
            <div id="bdList"></div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="bankDepositHistoryModal">
        <div class="modal modal-xl">
          <div class="modal-head">
            <h3>Bank Deposits — History</h3>
            <button type="button" class="modal-close" id="bdhCloseBtn" title="Close">
              <svg class="ui-icon"><use href="assets/icons.svg#x"></use></svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="filter-bar" style="margin-bottom:14px;">
              <div class="field" style="margin:0;width:150px;">
                <label>From</label>
                <input type="date" id="bdhStart">
              </div>
              <div class="field" style="margin:0;width:150px;">
                <label>To</label>
                <input type="date" id="bdhEnd">
              </div>
              <div class="field" style="margin:0;width:180px;">
                <label>Saved By</label>
                <select id="bdhSavedBy"><option value="">Everyone</option></select>
              </div>
              <button type="button" class="btn btn-outline btn-sm" id="bdhFilterBtn">Filter</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Time</th><th>Saved By</th><th>Total Cash</th><th>Bank Deposit</th>
                    <th>Remaining Cash</th><th>Deposit Remark</th><th>Cash Audit Remark</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody id="bdhBody"><tr><td colspan="9" class="muted">Loading...</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div id="cashAuditPrint" aria-hidden="true"></div>`);

    const box = document.getElementById('cashAuditSheet');

    box.addEventListener('input', (e) => {
      const t = e.target;
      const k = t.dataset ? t.dataset.k : null;
      if (!k || !state) return;
      const d = state.draft;
      if (k === 'qty') d.qty[t.dataset.v] = t.value;
      else if (k === 'rem') d.remarks[t.dataset.v] = t.value;
      else if (k === 'cashier') d.cashier = t.value;
      else if (k === 'shift') d.shift = t.value;
      else if (k === 'note') d.note = t.value;
      else if (k === 'userRemark') d.userRemark = t.value;
      if (k === 'qty') refreshOutputs();
    });

    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.k === 'date') {
        if (!t.value) { t.value = state.date; return; } // cleared - keep the current day
        switchDate(t.value);
      }
    });

    document.getElementById('caCloseBtn').addEventListener('click', () => closeModal('cashAuditModal'));
    document.getElementById('caDownloadBtn').addEventListener('click', function () {
      if (!state || !state.ready) { toast('Please wait — the sales for this day are still loading.', 'error'); return; }
      openDownloadMenu(this, printAudit, downloadAuditExcel);
    });
    document.getElementById('caSaveBtn').addEventListener('click', saveCashAudit);
    document.getElementById('caFloatBtn').addEventListener('click', () => openCashFloat());

    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="float"]')) openCashFloat();
    });

    document.getElementById('cfCloseBtn').addEventListener('click', () => closeModal('cashFloatModal'));
    document.getElementById('cfHistoryBtn').addEventListener('click', openCashFloatHistory);
    document.getElementById('cfDate').addEventListener('change', () => loadFloatDay(true));
    document.getElementById('cfSaveBtn').addEventListener('click', saveFloatEntry);

    document.getElementById('cfhCloseBtn').addEventListener('click', () => closeModal('cashFloatHistoryModal'));
    document.getElementById('cfhFilterBtn').addEventListener('click', loadFloatHistory);
    document.getElementById('cfhBody').addEventListener('click', (e) => {
      const del = e.target.closest('[data-fdel]');
      if (del) deleteFloatEntry(del.dataset.fdel);
    });
    document.getElementById('caHistoryBtn').addEventListener('click', openCashAuditHistory);

    document.getElementById('caBankBtn').addEventListener('click', () => openBankDeposit());
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="bank"]')) openBankDeposit();
    });
    document.getElementById('bdCloseBtn').addEventListener('click', () => closeModal('bankDepositModal'));
    document.getElementById('bdHistoryBtn').addEventListener('click', openBankDepositHistory);
    document.getElementById('bdSaveBtn').addEventListener('click', saveBankDeposit);
    document.getElementById('bdAmount').addEventListener('input', renderBankSummary);
    document.getElementById('bdhCloseBtn').addEventListener('click', () => closeModal('bankDepositHistoryModal'));
    document.getElementById('bdhFilterBtn').addEventListener('click', loadBankDepositHistory);
    document.getElementById('bdhBody').addEventListener('click', (e) => {
      const del = e.target.closest('[data-bdel]');
      if (del) deleteBankDeposit(del.dataset.bdel);
    });

    document.getElementById('cahCloseBtn').addEventListener('click', () => closeModal('cashAuditHistoryModal'));
    document.getElementById('cahFilterBtn').addEventListener('click', loadCashAuditHistory);
    document.getElementById('cahBody').addEventListener('click', onHistoryBodyClick);

    document.getElementById('cavCloseBtn').addEventListener('click', () => closeModal('cashAuditViewModal'));
    document.getElementById('cavDownloadBtn').addEventListener('click', function () {
      if (!viewCtx) return;
      openDownloadMenu(this, () => printAudit(viewCtx), () => downloadAuditExcel(viewCtx));
    });
  }

  /* ------------------------------------------------------------------ save + history */
  let viewCtx = null; // the read-only context currently shown in the "View" modal

  /** Saves the sheet as it stands right now as a NEW history entry - it
   *  never overwrites an earlier save, so saving again later the same day
   *  (a correction, a second shift, etc.) simply adds another entry and
   *  the full history stays reviewable. Who saved it comes from the
   *  logged-in session on the server, not from anything sent here. */
  async function saveCashAudit() {
    if (!state || !state.ready) { toast('Please wait — the sales for this day are still loading.', 'error'); return; }

    const btn = document.getElementById('caSaveBtn');
    btn.disabled = true;
    try {
      const denominations = DENOMS.map((v) => ({
        denom: v, qty: qtyOf(v), remark: state.draft.remarks[v] || '',
      })).filter((r) => r.qty > 0 || r.remark);

      const res = await API.post('cash_audit.php', {
        audit_date: state.date,
        cashier: state.draft.cashier || '',
        shift: state.draft.shift || '',
        note: state.draft.note || '',
        user_remark: state.draft.userRemark || '',
        denominations,
      });

      if (!res.success) { toast(res.message || 'Could not save this cash audit.', 'error'); return; }

      toast('Cash audit saved to history.');
      const who = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.full_name : 'you';
      const when = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      setStatus('Saved to history by ' + who + ' at ' + when + '. Open "History" to review it.');
    } finally {
      btn.disabled = false;
    }
  }

  /** Called by the "History" button. Lists saved audits for everyone -
   *  admins and workers alike - so anyone can review what was filled on
   *  any earlier day, not just their own entries. */
  window.openCashAuditHistory = function () {
    build();
    const endEl = document.getElementById('cahEnd');
    const startEl = document.getElementById('cahStart');
    if (!endEl.value) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      endEl.value = end.toISOString().slice(0, 10);
      startEl.value = start.toISOString().slice(0, 10);
    }
    openModal('cashAuditHistoryModal');
    loadCashAuditHistory();
  };

  async function loadCashAuditHistory() {
    const tbody = document.getElementById('cahBody');
    tbody.innerHTML = '<tr><td colspan="12" class="muted">Loading...</td></tr>';

    const params = {
      start: document.getElementById('cahStart').value,
      end: document.getElementById('cahEnd').value,
      limit: 500,
    };
    const savedBy = document.getElementById('cahSavedBy').value;
    if (savedBy) params.saved_by = savedBy;

    const res = await API.get('cash_audit.php', params);
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="12" class="muted">${esc(res.message || 'Could not load the history.')}</td></tr>`; return; }

    populateSavedByFilter(res.data.savers);

    const rows = res.data.entries;
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="12" class="muted">No cash audits saved for this range yet.</td></tr>'; return; }

    const isAdmin = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'admin');
    tbody.innerHTML = rows.map((r) => {
      const varAmt = Math.round(Number(r.variance) || 0);
      const varCls = varAmt === 0 ? 'tag-green' : 'tag-red';
      const varLabel = varAmt === 0 ? 'Balanced' : (varAmt > 0 ? 'Over ' + num(varAmt) : 'Short ' + num(Math.abs(varAmt)));
      // Sheets saved before the bank-deposit upgrade have no deposit / remaining cash figures.
      const hasBank = Number(r.calc_version) >= 2;
      const remarkBits = [];
      const bit = (label, text) => { if (text) remarkBits.push(`<div class="ca-rm"><span class="ca-rm-lbl">${label}</span><span class="ca-rm-txt">${esc(text)}</span></div>`); };
      bit('Remark', r.note);
      bit('User remark', r.user_remark);
      bit('Bank deposit remark', r.bank_deposit_remark);
      return `<tr>
        <td>${fmtDate(r.audit_date)}</td>
        <td>${esc(r.cashier || '—')}</td>
        <td>${esc(r.shift || '—')}</td>
        <td class="ca-r">${num(r.counted_cash)}</td>
        <td class="ca-r">${num(r.expected_cash)}</td>
        <td><span class="tag ${varCls}">${varLabel}</span></td>
        <td class="ca-r">${hasBank ? num(r.bank_deposit) : '—'}</td>
        <td class="ca-r">${hasBank ? num(r.remaining_cash) : '—'}</td>
        <td class="ca-remarks-cell">${remarkBits.join('') || '<span class="muted">—</span>'}</td>
        <td>${esc(r.saved_by_name || '—')}</td>
        <td class="muted">${fmtDateTimeCA(r.created_at)}</td>
        <td>
          <button type="button" class="btn btn-outline btn-sm" data-view="${r.id}">View</button>
          ${isAdmin ? `<button type="button" class="btn btn-outline btn-sm" data-del="${r.id}">Delete</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  function populateSavedByFilter(savers) {
    const select = document.getElementById('cahSavedBy');
    const current = select.value;
    select.innerHTML = '<option value="">Everyone</option>' +
      (savers || []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    select.value = current;
  }

  function onHistoryBodyClick(e) {
    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn) { viewHistoryEntry(viewBtn.dataset.view); return; }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) { deleteHistoryEntry(delBtn.dataset.del); }
  }

  /** Loads one saved entry read-only into its own context (never into the
   *  live `state`), so viewing history can never overwrite whatever is
   *  currently being typed into the live Cash Audit sheet. */
  async function viewHistoryEntry(id) {
    const res = await API.get('cash_audit.php', { id });
    if (!res.success) { toast(res.message || 'Could not load this entry.', 'error'); return; }

    const r = res.data;
    const qty = {}, remarks = {};
    (r.denominations || []).forEach((row) => { qty[row.denom] = row.qty; remarks[row.denom] = row.remark; });

    viewCtx = {
      date: r.audit_date,
      draft: { cashier: r.cashier || '', shift: r.shift || '', opening: r.opening_cash, note: r.note || '', userRemark: r.user_remark || '', qty, remarks },
      cash: Number(r.cash_sales) || 0,
      electronic: Number(r.electronic_sales) || 0,
      credit: Number(r.credit_sales) || 0,
      expenses: Number(r.expenses) || 0,
      // Sheets saved before the upgrade (version 1) are shown with the formula they were saved with.
      version: Number(r.calc_version) || 1,
      debtCash: Number(r.debt_collected) || 0,
      debtPayments: r.debt_payments || [],
      outstanding: Number(r.outstanding_debts) || 0,
      debtors: null,
      bankDeposit: Number(r.bank_deposit) || 0,
      bankRemarkText: r.bank_deposit_remark || '',
      openingSource: 'none',
      openingFrom: null,
      ready: true,
    };

    document.getElementById('cavTitle').textContent =
      fmtDate(r.audit_date) + ' · saved by ' + (r.saved_by_name || 'Unknown user') + ' · ' + fmtDateTimeCA(r.created_at);
    document.getElementById('cashAuditViewSheet').innerHTML = sheetHTML(false, viewCtx);
    openModal('cashAuditViewModal');
  }

  async function deleteHistoryEntry(id) {
    if (!confirm('Remove this saved cash audit entry? This cannot be undone.')) return;
    const res = await API.del('cash_audit.php', { id });
    if (!res.success) { toast(res.message || 'Could not delete this entry.', 'error'); return; }
    toast('Cash audit entry removed.');
    loadCashAuditHistory();
  }

  function shortText(t, n) {
    t = String(t == null ? '' : t);
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  function fmtDateTimeCA(dt) {
    if (!dt) return '—';
    const d = new Date(String(dt).replace(' ', 'T'));
    if (isNaN(d)) return dt;
    return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  /* ------------------------------------------------------------------ opening cash / float */
  const FLOAT_TAG = { opening: ['tag-gold', 'Opening'], add: ['tag-green', 'Added'], reduce: ['tag-red', 'Reduced'] };
  const floatSign = (t) => (t === 'add' ? '+' : (t === 'reduce' ? '−' : ''));

  /** Opens the Opening Cash screen for a date (defaults to the sheet's date).
   *  Anyone can set the opening cash and add to / reduce the float; every
   *  action is saved as its own record under the user's own name. */
  window.openCashFloat = function (date) {
    build();
    document.getElementById('cfDate').value = date || (state && state.date) || dayToday();
    document.getElementById('cfAmount').value = '';
    document.getElementById('cfNote').value = '';
    openModal('cashFloatModal');
    loadFloatDay(true);
  };

  async function loadFloatDay(setDefaultType) {
    const box = document.getElementById('cfSummary');
    const date = document.getElementById('cfDate').value;
    if (!date) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="muted">Loading...</p>';
    const res = await API.get('cash_float.php', { date });
    if (date !== document.getElementById('cfDate').value) return; // date changed while loading
    if (!res.success) { box.innerHTML = `<p class="ca-status error">${esc(res.message || 'Could not load this day.')}</p>`; return; }
    renderFloatSummary(res.data);
    if (setDefaultType) document.getElementById('cfType').value = res.data.opening_entry ? 'add' : 'opening';
  }

  function renderFloatSummary(s) {
    const items = (s.entries || []).map((e) => {
      const tag = FLOAT_TAG[e.entry_type] || ['tag-gray', e.entry_type];
      return `<li>
        <span class="tag ${tag[0]}">${tag[1]}${e.superseded ? ' · replaced' : ''}</span>
        <b class="${e.superseded ? 'cf-strike' : ''}">${floatSign(e.entry_type)}${num(e.amount)}</b>
        <span class="muted">${esc(e.saved_by_name || '—')} · ${fmtDateTimeCA(e.created_at)}${e.note ? ' · ' + esc(e.note) : ''}</span>
      </li>`;
    }).join('');

    // Where the opening amount comes from: typed in, or brought forward from the previous day's Remaining Cash.
    const auto = s.opening_source === 'carry_over' && s.carry_over;
    const openingCell = s.opening_entry ? num(s.opening) : (auto ? num(s.opening) : 'Not set');
    const openingNote = auto
      ? `<p class="ca-auto-note">Automatic: brought forward from the <b>Remaining Cash</b> of ${esc(fmtDate(s.carry_over.from_date))} (TZS ${num(s.carry_over.amount)}). You can change it by setting the opening cash below.</p>`
      : (s.opening_entry && s.carry_over
        ? `<p class="ca-auto-note">Set by hand. The previous day's Remaining Cash (${esc(fmtDate(s.carry_over.from_date))}) was TZS ${num(s.carry_over.amount)}.</p>`
        : '');

    document.getElementById('cfSummary').innerHTML = `
      <div class="cf-grid">
        <div><span>Opening cash${auto ? ' (automatic)' : ''}</span><b>${openingCell}</b></div>
        <div><span>Added</span><b>+${num(s.added)}</b></div>
        <div><span>Reduced</span><b>−${num(s.reduced)}</b></div>
        <div class="cf-total"><span>Current float</span><b>${num(s.total)}</b></div>
      </div>
      ${openingNote}
      ${items ? `<ul class="cf-list">${items}</ul>` : '<p class="muted cf-empty">Nothing recorded for this date yet.</p>'}
      `;
  }

  async function saveFloatEntry() {
    const date = document.getElementById('cfDate').value;
    const type = document.getElementById('cfType').value;
    const amount = document.getElementById('cfAmount').value;
    if (!date) { toast('Please choose a date.', 'error'); return; }
    if (amount === '' || isNaN(Number(amount)) || Number(amount) < 0) { toast('Please enter a valid amount.', 'error'); return; }

    const btn = document.getElementById('cfSaveBtn');
    btn.disabled = true;
    try {
      const res = await API.post('cash_float.php', {
        float_date: date, entry_type: type, amount: Number(amount),
        note: document.getElementById('cfNote').value,
      });
      if (!res.success) { toast(res.message || 'Could not save this.', 'error'); return; }

      toast(res.message || 'Saved.');
      document.getElementById('cfAmount').value = '';
      document.getElementById('cfNote').value = '';
      document.getElementById('cfType').value = 'add';
      renderFloatSummary(res.data);
      // keep Part B of the open sheet in step with what was just recorded
      if (state && state.date === date) loadNumbers();
    } finally {
      btn.disabled = false;
    }
  }

  window.openCashFloatHistory = function () {
    build();
    const endEl = document.getElementById('cfhEnd');
    const startEl = document.getElementById('cfhStart');
    if (!endEl.value) {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      endEl.value = dayToday();
      startEl.value = start.toISOString().slice(0, 10);
    }
    openModal('cashFloatHistoryModal');
    loadFloatHistory();
  };

  async function loadFloatHistory() {
    const tbody = document.getElementById('cfhBody');
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Loading...</td></tr>';

    const params = {
      start: document.getElementById('cfhStart').value,
      end: document.getElementById('cfhEnd').value,
      limit: 500,
    };
    const type = document.getElementById('cfhType').value;
    if (type) params.type = type;
    const savedBy = document.getElementById('cfhSavedBy').value;
    if (savedBy) params.saved_by = savedBy;

    const res = await API.get('cash_float.php', params);
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="7" class="muted">${esc(res.message || 'Could not load the history.')}</td></tr>`; return; }

    const select = document.getElementById('cfhSavedBy');
    const current = select.value;
    select.innerHTML = '<option value="">Everyone</option>' +
      (res.data.savers || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    select.value = current;

    const rows = res.data.entries;
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="muted">No opening cash records for this range.</td></tr>'; return; }

    const isAdmin = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'admin');
    tbody.innerHTML = rows.map((r) => {
      const tag = FLOAT_TAG[r.entry_type] || ['tag-gray', r.entry_type];
      return `<tr>
        <td>${fmtDate(r.float_date)}</td>
        <td><span class="tag ${tag[0]}">${tag[1]}</span>${r.superseded ? ' <span class="tag tag-gray">Replaced</span>' : ''}</td>
        <td class="ca-r ${r.superseded ? 'cf-strike' : ''}">${floatSign(r.entry_type)}${num(r.amount)}</td>
        <td>${esc(r.note || '—')}</td>
        <td>${esc(r.saved_by_name || '—')}</td>
        <td class="muted">${fmtDateTimeCA(r.created_at)}</td>
        <td>${isAdmin ? `<button type="button" class="btn btn-outline btn-sm" data-fdel="${r.id}">Delete</button>` : ''}</td>
      </tr>`;
    }).join('');
  }

  async function deleteFloatEntry(id) {
    if (!confirm('Remove this opening cash record? The float for that day will change. This cannot be undone.')) return;
    const res = await API.del('cash_float.php', { id });
    if (!res.success) { toast(res.message || 'Could not delete this record.', 'error'); return; }
    toast('Record removed.');
    loadFloatHistory();
    if (state) loadNumbers(); // Part B may have depended on it
  }

  /* ------------------------------------------------------------------ bank deposit & closing cash */

  /** Opens the Bank Deposit screen for the sheet that is open. Total Cash is the cash counted in Part A;
   *  what is left after the deposit (Remaining Cash) becomes the next day's Opening Cash. */
  function openBankDeposit() {
    if (!state) return;
    if (!state.ready) { toast('Please wait — the figures for this day are still loading.', 'error'); return; }
    document.getElementById('bdAmount').value = '';
    document.getElementById('bdRemark').value = '';
    document.getElementById('bdDate').textContent = 'Deposit for ' + fmtDate(state.date) + ' · recorded under your name';
    openModal('bankDepositModal');
    renderBankSummary();
    renderBankList();
  }

  function renderBankSummary() {
    if (!state) return;
    const c = calc();
    const typed = Math.max(0, Number(document.getElementById('bdAmount').value) || 0);
    const left = c.counted - c.deposit;          // cash still available to bank
    const after = left - typed;                  // Remaining Cash once this deposit is saved

    let hint = '';
    if (c.counted <= 0) hint = 'Count the cash in Part A of the Cash Audit first — the bank deposit is taken out of the cash counted.';
    else if (typed > left) hint = 'That is more than the cash left to bank (TZS ' + num(Math.max(left, 0)) + ').';
    else hint = 'Tomorrow\'s Opening Cash will be TZS ' + num(after) + '.';

    document.getElementById('bdSummary').innerHTML = `
      <div class="cf-grid">
        <div><span>Total Cash</span><b>${num(c.counted)}</b></div>
        <div><span>Already deposited</span><b>${num(c.deposit)}</b></div>
        <div><span>This deposit</span><b>${num(typed)}</b></div>
        <div class="cf-total"><span>Remaining Cash</span><b>${num(after)}</b></div>
      </div>
      <p class="ca-note ${(c.counted <= 0 || typed > left) ? 'ca-warn-text' : ''}">${esc(hint)}</p>`;
  }

  function renderBankList() {
    const box = document.getElementById('bdList');
    const rows = (state && state.bankEntries) || [];
    if (!rows.length) { box.innerHTML = '<p class="muted cf-empty">No bank deposit recorded for this date yet.</p>'; return; }
    box.innerHTML = '<ul class="cf-list">' + rows.map((e) => `<li>
        <span class="tag tag-green">Deposit</span>
        <b>${num(e.amount)}</b>
        <span class="muted">${esc(e.saved_by_name || '—')} · ${fmtDateTimeCA(e.created_at)}${e.remark ? ' · ' + esc(e.remark) : ''}</span>
      </li>`).join('') + '</ul>';
  }

  async function saveBankDeposit() {
    if (!state || !state.ready) return;
    const c = calc();
    const amount = Number(document.getElementById('bdAmount').value);
    if (c.counted <= 0) { toast('Count the cash in Part A first.', 'error'); return; }
    if (!amount || amount <= 0) { toast('Please enter the amount deposited.', 'error'); return; }
    if (amount > c.counted - c.deposit) { toast('That is more than the cash left to bank.', 'error'); return; }

    const btn = document.getElementById('bdSaveBtn');
    btn.disabled = true;
    try {
      const denominations = DENOMS.map((v) => ({ denom: v, qty: qtyOf(v), remark: '' })).filter((r) => r.qty > 0);
      const res = await API.post('bank_deposits.php', {
        deposit_date: state.date,
        denominations,
        amount,
        remark: document.getElementById('bdRemark').value,
      });
      if (!res.success) { toast(res.message || 'Could not save this bank deposit.', 'error'); return; }

      toast(res.message || 'Bank deposit saved.');
      state.bankDeposit = Math.round(Number(res.data.total) || 0);
      state.bankEntries = res.data.entries || [];
      state.bankRemarkText = state.bankEntries.map((e) => (e.remark || '').trim()).filter(Boolean).join(' | ');
      document.getElementById('bdAmount').value = '';
      document.getElementById('bdRemark').value = '';
      refreshOutputs();
      renderBankSummary();
      renderBankList();
      setStatus('Bank deposit recorded. Save the Cash Audit to keep the whole sheet in History.');
    } finally {
      btn.disabled = false;
    }
  }

  function openBankDepositHistory() {
    const endEl = document.getElementById('bdhEnd');
    const startEl = document.getElementById('bdhStart');
    if (!endEl.value) {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      endEl.value = dayToday();
      startEl.value = start.toISOString().slice(0, 10);
    }
    openModal('bankDepositHistoryModal');
    loadBankDepositHistory();
  }

  async function loadBankDepositHistory() {
    const tbody = document.getElementById('bdhBody');
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Loading...</td></tr>';

    const params = {
      start: document.getElementById('bdhStart').value,
      end: document.getElementById('bdhEnd').value,
      limit: 500,
    };
    const savedBy = document.getElementById('bdhSavedBy').value;
    if (savedBy) params.saved_by = savedBy;

    const res = await API.get('bank_deposits.php', params);
    if (!res.success) { tbody.innerHTML = `<tr><td colspan="9" class="muted">${esc(res.message || 'Could not load the history.')}</td></tr>`; return; }

    const select = document.getElementById('bdhSavedBy');
    const current = select.value;
    select.innerHTML = '<option value="">Everyone</option>' +
      (res.data.savers || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    select.value = current;

    const rows = res.data.entries;
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">No bank deposits for this range.</td></tr>'; return; }

    const isAdmin = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'admin');
    tbody.innerHTML = rows.map((r) => {
      const t = new Date(String(r.created_at).replace(' ', 'T'));
      const time = isNaN(t) ? '—' : t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return `<tr>
        <td>${fmtDate(r.deposit_date)}</td>
        <td class="muted">${time}</td>
        <td>${esc(r.saved_by_name || '—')}</td>
        <td class="ca-r">${num(r.total_cash)}</td>
        <td class="ca-r"><b>${num(r.amount)}</b></td>
        <td class="ca-r">${num(r.remaining_cash)}</td>
        <td class="ca-remarks-cell">${r.remark ? `<div class="ca-rm"><span class="ca-rm-txt">${esc(r.remark)}</span></div>` : '<span class="muted">—</span>'}</td>
        <td class="ca-remarks-cell">${r.audit_remark ? `<div class="ca-rm"><span class="ca-rm-txt">${esc(r.audit_remark)}</span></div>` : '<span class="muted">—</span>'}</td>
        <td>${isAdmin ? `<button type="button" class="btn btn-outline btn-sm" data-bdel="${r.id}">Delete</button>` : ''}</td>
      </tr>`;
    }).join('');
  }

  async function deleteBankDeposit(id) {
    if (!confirm('Remove this bank deposit record? The Remaining Cash for that day will change. This cannot be undone.')) return;
    const res = await API.del('bank_deposits.php', { id });
    if (!res.success) { toast(res.message || 'Could not delete this record.', 'error'); return; }
    toast('Bank deposit removed.');
    loadBankDepositHistory();
    if (state) loadNumbers(); // the open sheet may have depended on it
  }

  function signatureHTML() {
    const block = (role) => `
      <div class="ca-sig-block">
        <div class="ca-sig-role">${role}</div>
        <div class="ca-sig-field"><span class="ca-sig-label">Name</span><span class="ca-sig-line"></span></div>
        <div class="ca-sig-field"><span class="ca-sig-label">Signature</span><span class="ca-sig-line"></span></div>
      </div>`;
    return `<div class="ca-sign">${block('Prepared By')}${block('Approved By')}</div>`;
  }

  const neg = (n) => (n ? '−' + num(n) : num(0));

  /** Plain-text explanations of how credit/debt changed Expected Cash (shared by the screen, PDF and Excel).
   *  Each note is { lead, rest }: the lead is shown in bold. */
  function debtNotes(ctx) {
    if ((ctx.version || 2) < 2) return [];
    const notes = [];
    if (ctx.credit > 0) {
      notes.push({
        lead: 'Credit sales: ' + money(ctx.credit),
        rest: ' of the Total Sales was sold on credit. No money was received for it, so it is taken out of Expected Cash.',
      });
    }
    (ctx.debtPayments || []).forEach((p) => {
      const who = p.customer_name || 'A customer';
      const left = Number(p.remaining_debt) || 0;
      if (p.method === 'online') {
        notes.push({
          lead: '',
          rest: who + ' paid ' + money(p.amount_paid) + ' of the previous ' + money(p.previous_debt) + ' debt online'
            + (p.online_method ? ' (' + p.online_method + ')' : '') + '. This is not cash in the drawer, so Expected Cash was not increased. Remaining debt: '
            + money(left) + '.',
        });
      } else {
        notes.push({
          lead: 'Expected Cash increased by ' + money(p.added_to_expected),
          rest: ' because ' + who + ' paid ' + money(p.amount_paid) + ' of the previous ' + money(p.previous_debt)
            + ' debt. Remaining debt: ' + money(left) + '.' + (left <= 0 ? ' The debt is cleared.' : ''),
        });
      }
    });
    if (ctx.outstanding > 0) {
      const n = ctx.debtors;
      notes.push({
        lead: 'Outstanding customer debts: ' + money(ctx.outstanding),
        rest: (n ? ' (' + n + ' customer' + (n === 1 ? '' : 's') + ')' : '') + ' still owed by customers. This is not part of Expected Cash until it is paid.',
      });
    }
    return notes;
  }

  function debtNotesHTML(ctx) {
    const notes = debtNotes(ctx);
    if (!notes.length) return '';
    return `<div class="ca-notebox"><div class="ca-lbl">Notes on Expected Cash:</div><ul>${
      notes.map((n) => `<li>${n.lead ? '<b>' + esc(n.lead) + '</b>' : ''}${esc(n.rest)}</li>`).join('')}</ul></div>`;
  }

  function debtTableHTML(ctx) {
    const pays = ctx.debtPayments || [];
    if ((ctx.version || 2) < 2 || !pays.length) return '';
    const rows = pays.map((p) => `<tr>
        <td>${esc(p.customer_name || 'A customer')}${p.method === 'online' ? ' <i>(online)</i>' : ''}</td>
        <td class="ca-r">${num(p.previous_debt)}</td>
        <td class="ca-r">${num(p.amount_paid)}</td>
        <td class="ca-r">${num(p.remaining_debt)}</td>
        <td class="ca-r">${num(p.added_to_expected)}</td>
      </tr>`).join('');
    return `<div class="ca-section ca-sub">Debt Payments Received</div>
      <table class="ca-table ca-debts">
        <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"></colgroup>
        <tr class="ca-th"><td class="ca-l">Customer</td><td>Previous Debt</td><td>Amount Paid</td><td>Remaining Debt</td><td>Added to Expected Cash</td></tr>
        ${rows}
      </table>`;
  }

  function openingSrcHTML(ctx, editable) {
    if (ctx.openingSource !== 'carry_over' || !ctx.openingFrom) return '';
    return `<div class="ca-src">Automatic: brought forward from the Remaining Cash of ${esc(fmtDate(ctx.openingFrom))}.${editable ? ' Use “Set / adjust” to change it.' : ''}</div>`;
  }

  function bankRemarkHTML(ctx) {
    return ctx.bankRemarkText ? esc(ctx.bankRemarkText) : '';
  }

  function tomorrowHTML(c) {
    if (c.remaining < 0) {
      return `<div class="ca-tomorrow ca-warn">The bank deposits (${money(c.deposit)}) are more than the cash counted (${money(c.counted)}). Please check the cash count or the deposits.</div>`;
    }
    if (c.counted <= 0 && c.deposit <= 0) {
      return `<div class="ca-tomorrow">Count the cash in Part A to see the Total Cash, then record what was banked with the Bank Deposit button. The Remaining Cash becomes tomorrow's Opening Cash.</div>`;
    }
    return `<div class="ca-tomorrow">Tomorrow's Opening Cash: <b>${money(c.remaining)}</b> <i>(the Remaining Cash is carried forward automatically and can still be adjusted from Opening Cash)</i></div>`;
  }

  function bankBlockHTML(editable, ctx, c) {
    if (c.version < 2) return '';
    return `
      <div class="ca-section ca-sub">Bank Deposit &amp; Closing Cash${editable ? ' <button type="button" class="ca-float-link" data-act="bank">Record / view bank deposit</button>' : ''}</div>
      <table class="ca-table ca-bank">
        <colgroup><col class="c1"><col class="c2"></colgroup>
        <tr class="ca-th"><td class="ca-l">Item</td><td>Amount</td></tr>
        <tr><td>Total Cash <i>(cash counted in Part A)</i></td><td class="ca-r" data-out="bTotal">${money(c.counted)}</td></tr>
        <tr><td>Bank Deposit</td><td class="ca-r" data-out="bDeposit">${money(c.deposit)}</td></tr>
        <tr><td>Remaining Cash <i>(Total Cash − Bank Deposit)</i></td><td class="ca-r ca-strong" data-out="bRemaining">${money(c.remaining)}</td></tr>
        <tr><td colspan="2" class="ca-mini-box"><span class="ca-lbl">Bank Deposit Remark:</span> <span class="ca-remarks-print" data-html="bankRemark">${bankRemarkHTML(ctx)}</span></td></tr>
      </table>
      <div data-html="tomorrow">${tomorrowHTML(c)}</div>`;
  }

  /** The whole form. editable=true -> inputs (screen); false -> plain text (print). */
  function sheetHTML(editable, ctx) {
    ctx = ctx || state;
    const d = ctx.draft;
    const c = calc(ctx);
    const input = (k, val, extra = '', attrs = '') =>
      `<input class="ca-in ${extra}" data-k="${k}" ${attrs} value="${esc(val)}">`;

    const rows = DENOMS.map((v) => {
      const q = qtyOf(v, ctx);
      return `<tr>
        <td class="ca-c">${num(v)}</td>
        <td class="ca-c">${editable
          ? input('qty', q || '', 'ca-c', `type="number" min="0" step="1" inputmode="numeric" data-v="${v}"`)
          : (q || '')}</td>
        <td class="ca-r" data-out="amt-${v}">${q ? num(q * v) : ''}</td>
        <td>${editable
          ? input('rem', d.remarks[v] || '', '', `type="text" maxlength="120" data-v="${v}"`)
          : esc(d.remarks[v] || '')}</td>
      </tr>`;
    }).join('');

    const metaField = (label, k, val, type, extraAttrs) => `
      <div class="ca-item"><b>${label}:</b>${editable
        ? input(k, val, '', `type="${type}" ${extraAttrs || ''}`)
        : `<span class="ca-fill">${esc(k === 'date' ? fmtDate(val) : val)}</span>`}</div>`;

    return `
    <div class="ca-sheet">
      <div class="ca-logo"><img src="${LOGO_SRC}" alt="eDESK Print &amp; Digital"></div>
      <div class="ca-title">DAILY CASH CLOSING &amp; SALES RECONCILIATION SHEET</div>

      <div class="ca-meta">
        ${metaField('Date', 'date', ctx.date, 'date')}
        ${metaField('Cashier', 'cashier', d.cashier, 'text', 'maxlength="80"')}
        ${metaField('Shift', 'shift', d.shift, 'text', 'maxlength="40"')}
      </div>

      <div class="ca-section">A. Cash Count</div>
      <table class="ca-table ca-count">
        <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup>
        <tr class="ca-th"><td class="ca-l">Denomination (TZS)</td><td>Quantity</td><td>Amount (TZS)</td><td>Remarks</td></tr>
        ${rows}
        <tr><td colspan="2" class="ca-strong">TOTAL CASH COUNTED</td>
            <td class="ca-r ca-strong" data-out="counted">${num(c.counted)}</td><td></td></tr>
      </table>

      <div class="ca-section">B. Sales Reconciliation</div>
      ${c.version < 2 ? partBLegacyHTML(editable, ctx, c) : partBHTML(editable, ctx, c)}

      ${signatureHTML()}
    </div>`;
  }

  const remarksRowHTML = (editable, d) => `<tr><td colspan="2" class="ca-remarks-box"><span class="ca-lbl">Remarks:</span>${editable
      ? `<textarea class="ca-in" data-k="note" rows="2" maxlength="400">${esc(d.note)}</textarea>`
      : ` <span class="ca-remarks-print">${esc(d.note)}</span>`}</td></tr>`;

  /** Sheets saved before the credit/debt upgrade are shown exactly as they were saved. */
  function partBLegacyHTML(editable, ctx, c) {
    const d = ctx.draft;
    return `
      <table class="ca-table ca-recon">
        <colgroup><col class="c1"><col class="c2"></colgroup>
        <tr class="ca-th"><td class="ca-l">Description</td><td>Amount (TZS)</td></tr>
        <tr><td>Opening Cash (<i>Physical Float</i>)</td>
            <td class="ca-r">${editable ? '<button type="button" class="ca-float-link" data-act="float">Set / adjust</button> ' : ''}<span data-out="opening">${(editable || c.opening) ? num(c.opening) : ''}</span></td></tr>
        <tr><td>Cash Physical Sales</td><td class="ca-r" data-out="cash">${num(ctx.cash)}</td></tr>
        <tr><td>Electronic Sales (<i>Mixx by Yas/M-Pesa/Bank</i>)</td><td class="ca-r" data-out="electronic">${num(ctx.electronic)}</td></tr>
        <tr><td>On Credit Sales</td><td class="ca-r" data-out="credit">${num(ctx.credit)}</td></tr>
        <tr><td>Total Sales (<i>Cash Physical Sales + Electronic Sales + On Credit Sales</i>)</td>
            <td class="ca-r ca-strong" data-out="total">${num(c.total)}</td></tr>
        <tr><td>Expenses</td><td class="ca-r" data-out="expenses">${num(ctx.expenses)}</td></tr>
        <tr><td>Expected Cash <i>((Opening Float + Total Sales) - Expenses)</i></td>
            <td class="ca-r ca-strong" data-out="expected">${num(c.expected)}</td></tr>
        ${remarksRowHTML(editable, d)}
      </table>`;
  }

  function partBHTML(editable, ctx, c) {
    const d = ctx.draft;
    return `
      <table class="ca-table ca-recon">
        <colgroup><col class="c1"><col class="c2"></colgroup>
        <tr class="ca-th"><td class="ca-l">Description</td><td>Amount (TZS)</td></tr>
        <tr><td>Opening Cash (<i>Physical Float</i>)<span data-html="openingSrc">${openingSrcHTML(ctx, editable)}</span></td>
            <td class="ca-r">${editable ? '<button type="button" class="ca-float-link" data-act="float">Set / adjust</button> ' : ''}<span data-out="opening">${(editable || c.opening) ? num(c.opening) : ''}</span></td></tr>
        <tr><td>Cash Physical Sales</td><td class="ca-r" data-out="cash">${num(ctx.cash)}</td></tr>
        <tr><td>Electronic Sales (<i>Mixx by Yas/M-Pesa/Bank</i>)</td><td class="ca-r" data-out="electronic">${num(ctx.electronic)}</td></tr>
        <tr><td>On Credit Sales</td><td class="ca-r" data-out="credit">${num(ctx.credit)}</td></tr>
        <tr><td>Total Sales, including credit (<i>Cash Physical Sales + Electronic Sales + On Credit Sales</i>)</td>
            <td class="ca-r ca-strong" data-out="total">${num(c.total)}</td></tr>
        <tr><td>Less: On Credit Sales (<i>owed by customers, not received</i>)</td><td class="ca-r" data-out="lessCredit">${neg(ctx.credit)}</td></tr>
        <tr><td>Add: Previous Debts Paid in Cash (<i>collected on this date</i>)</td><td class="ca-r" data-out="debtCash">${num(c.debtCash)}</td></tr>
        <tr><td>Actual Cash Available (<i>Opening Cash + Total Sales - On Credit Sales + Debts Paid in Cash</i>)</td>
            <td class="ca-r ca-strong" data-out="available">${num(c.available)}</td></tr>
        <tr><td>Expenses</td><td class="ca-r" data-out="expenses">${num(ctx.expenses)}</td></tr>
        <tr><td>Expected Cash <i>(Actual Cash Available - Expenses)</i></td>
            <td class="ca-r ca-strong" data-out="expected">${num(c.expected)}</td></tr>
        <tr><td>Outstanding Customer Debts (<i>still owed by customers; not part of Expected Cash</i>)</td>
            <td class="ca-r" data-out="outstanding">${num(ctx.outstanding)}</td></tr>
      </table>

      <div data-html="notes">${debtNotesHTML(ctx)}</div>
      <div data-html="debts">${debtTableHTML(ctx)}</div>

      <table class="ca-table ca-recon ca-remarks-tbl">
        <colgroup><col class="c1"><col class="c2"></colgroup>
        ${remarksRowHTML(editable, d)}
        <tr><td colspan="2" class="ca-remarks-box ca-user-remark"><span class="ca-lbl">User Remark:</span>${editable
          ? ' <span class="ca-hint">(optional - write anything you need to explain or record about this audit)</span>'
            + `<textarea class="ca-in" data-k="userRemark" rows="2" maxlength="1000">${esc(d.userRemark || '')}</textarea>`
          : ` <span class="ca-remarks-print">${esc(d.userRemark || '')}</span>`}</td></tr>
      </table>

      ${bankBlockHTML(editable, ctx, c)}`;
  }

  /** Update only the calculated cells, so typing never loses focus. */
  function refreshOutputs() {
    const box = document.getElementById('cashAuditSheet');
    const c = calc();
    const setOut = (key, text) => {
      const el = box.querySelector(`[data-out="${key}"]`);
      if (el) el.textContent = text;
    };
    DENOMS.forEach((v) => { const q = qtyOf(v); setOut('amt-' + v, q ? num(q * v) : ''); });
    setOut('counted', num(c.counted));
    setOut('opening', num(c.opening));
    setOut('cash', num(state.cash));
    setOut('electronic', num(state.electronic));
    setOut('credit', num(state.credit));
    setOut('total', num(c.total));
    setOut('expenses', num(state.expenses));
    setOut('expected', num(c.expected));

    if (c.version >= 2) {
      const setHtml = (key, html) => {
        const el = box.querySelector(`[data-html="${key}"]`);
        if (el && el.innerHTML !== html) el.innerHTML = html;
      };
      setOut('lessCredit', neg(state.credit));
      setOut('debtCash', num(c.debtCash));
      setOut('available', num(c.available));
      setOut('outstanding', num(state.outstanding));
      setOut('bTotal', money(c.counted));
      setOut('bDeposit', money(c.deposit));
      setOut('bRemaining', money(c.remaining));
      setHtml('openingSrc', openingSrcHTML(state, true));
      setHtml('notes', debtNotesHTML(state));
      setHtml('debts', debtTableHTML(state));
      setHtml('bankRemark', bankRemarkHTML(state));
      setHtml('tomorrow', tomorrowHTML(c));
    }
    if (document.getElementById('bankDepositModal').classList.contains('open')) renderBankSummary();
  }

  function setStatus(text, isError) {
    const el = document.getElementById('caStatus');
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }

  /* ------------------------------------------------------------------ data */
  async function loadNumbers() {
    const token = ++reqToken;
    state.ready = false;
    setStatus('Loading sales and expenses for ' + fmtDate(state.date) + '...');

    // limit is raised on purpose - the APIs default to the latest 100 rows,
    // which could silently drop sales on a very busy day.
    const [sRes, eRes, fRes, dRes] = await Promise.all([
      API.get('sales.php', { start: state.date, end: state.date, limit: 10000 }),
      API.get('expenses.php', { start: state.date, end: state.date, limit: 10000 }),
      API.get('cash_float.php', { date: state.date }),
      API.get('cash_audit.php', { summary: state.date }), // debt repayments, outstanding debts, bank deposits
    ]);
    if (token !== reqToken) return; // the date was changed while this was loading

    if (!sRes.success || !eRes.success || !fRes.success || !dRes.success) {
      const msg = (!sRes.success ? sRes.message : (!eRes.success ? eRes.message : (!fRes.success ? fRes.message : dRes.message))) || 'Could not load the figures.';
      setStatus('Could not load the figures for this day: ' + msg + ' Close and open Cash Audit to try again.', true);
      toast(msg, 'error');
      return;
    }

    let cash = 0, electronic = 0, credit = 0, expenses = 0;
    sRes.data.forEach((s) => {
      const amt = Number(s.total_amount) || 0;
      if (s.payment_method === 'credit') credit += amt;
      else if (s.cash_type === 'online') electronic += amt;
      else cash += amt;                                   // cash in hand
    });
    eRes.data.forEach((e) => { expenses += Number(e.amount) || 0; });

    state.cash = Math.round(cash);
    state.electronic = Math.round(electronic);
    state.credit = Math.round(credit);
    state.expenses = Math.round(expenses);
    // Opening cash = the day's float (opening + added - reduced), recorded on the Opening Cash screen.
    // If none was recorded, the server fills it in from the previous day's Remaining Cash.
    state.draft.opening = Math.max(0, Math.round(Number(fRes.data.total) || 0));
    state.openingSource = fRes.data.opening_source || 'none';
    state.openingFrom = fRes.data.carry_over ? fRes.data.carry_over.from_date : null;

    // Credit / debt: repayments received on this date, what customers still owe, and the day's bank deposits.
    const debt = dRes.data.debt || {};
    const deps = dRes.data.deposits || { total: 0, entries: [] };
    state.debtCash = Math.round(Number(debt.collected_cash) || 0);
    state.debtPayments = debt.payments || [];
    state.outstanding = Math.round(Number(debt.outstanding) || 0);
    state.debtors = Number(debt.debtors) || 0;
    state.bankDeposit = Math.round(Number(deps.total) || 0);
    state.bankEntries = deps.entries || [];
    state.bankRemarkText = state.bankEntries.map((e) => (e.remark || '').trim()).filter(Boolean).join(' | ');

    state.ready = true;
    setStatus(fRes.data.opening_source !== 'none' ? '' :
      'No opening cash has been recorded for ' + fmtDate(state.date) + ' yet. Use "Opening Cash" to set it.');
    refreshOutputs();
  }

  /** The figures that come from the server for a day - reset to zero while a day is loading. */
  function blankDay(st) {
    st.cash = st.electronic = st.credit = st.expenses = 0;
    st.version = 2;
    st.debtCash = 0; st.debtPayments = []; st.outstanding = 0; st.debtors = 0;
    st.bankDeposit = 0; st.bankEntries = []; st.bankRemarkText = '';
    st.openingSource = 'none'; st.openingFrom = null;
    return st;
  }

  function switchDate(date) {
    state.draft = drafts[date] || (drafts[date] = newDraft());
    state.date = date;
    blankDay(state);
    state.draft.opening = 0;
    document.getElementById('cashAuditSheet').innerHTML = sheetHTML(true);
    loadNumbers();
  }

  /** Called by the "Cash Audit" button on the Sales page. */
  window.openCashAudit = function () {
    build();
    const date = dayToday();
    state = blankDay({ date, draft: drafts[date] || (drafts[date] = newDraft()), ready: false });
    state.draft.opening = 0;
    document.getElementById('cashAuditSheet').innerHTML = sheetHTML(true);
    openModal('cashAuditModal');
    loadNumbers();
  };

  /* ------------------------------------------------------------------ PDF (print) */
  async function printAudit(ctx) {
    ctx = ctx || state;
    const box = document.getElementById('cashAuditPrint');
    box.innerHTML = sheetHTML(false, ctx);

    const img = box.querySelector('img');
    if (img && img.decode) { try { await img.decode(); } catch (e) { /* print anyway */ } }

    const oldTitle = document.title;
    document.title = 'eDESK_Cash_Audit_' + ctx.date; // suggested file name in "Save as PDF"
    document.body.classList.add('ca-printing');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('ca-printing');
      document.title = oldTitle;
      box.innerHTML = '';
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
  }

  /* ------------------------------------------------------------------ Excel (.xlsx) */
  const xmlText = (s) => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** Minimal ZIP writer (no compression) - all an .xlsx needs. */
  function zipStore(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const parts = [];
    const central = [];
    let offset = 0;

    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    });

    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: XLSX_MIME });
  }

  function pngSize(bytes) {
    const sig = [0x89, 0x50, 0x4E, 0x47];
    if (!bytes || bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }

  function buildXlsx(c, logo, ctx) {
    ctx = ctx || state;
    const enc = new TextEncoder();
    const d = ctx.draft;
    const FONT = 'Times New Roman';

    /* ---- styles -------------------------------------------------------- */
    const fonts = [
      `<font><sz val="11"/><name val="${FONT}"/><family val="1"/></font>`,                 // 0 normal
      `<font><b/><sz val="11"/><name val="${FONT}"/><family val="1"/></font>`,             // 1 bold
      `<font><b/><sz val="15"/><name val="${FONT}"/><family val="1"/></font>`,             // 2 title
    ];
    const borders = [
      '<border><left/><right/><top/><bottom/><diagonal/></border>',
      '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>',
      '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>',
    ];
    const xfs = [];
    const xfIndex = new Map();
    const xf = (o) => {
      const key = JSON.stringify(o);
      if (xfIndex.has(key)) return xfIndex.get(key);
      const fmt = o.fmt || 0;
      const align = `<alignment${o.h ? ` horizontal="${o.h}"` : ''} vertical="${o.v || 'center'}"${o.wrap ? ' wrapText="1"' : ''}${o.indent ? ` indent="${o.indent}"` : ''}/>`;
      xfs.push(`<xf numFmtId="${fmt}" fontId="${o.font || 0}" fillId="0" borderId="${o.border || 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
      xfIndex.set(key, xfs.length - 1);
      return xfs.length - 1;
    };
    xf({}); // index 0 = default

    const S = {
      title: xf({ font: 2, h: 'center' }),
      meta: xf({ h: 'left' }),
      section: xf({ font: 1, h: 'left' }),
      headC: xf({ font: 1, border: 1, h: 'center', wrap: 1 }),
      headL: xf({ font: 1, border: 1, h: 'left' }),
      denom: xf({ border: 1, h: 'center', fmt: 3 }),
      qty: xf({ border: 1, h: 'center', fmt: 1 }),
      amtHide: xf({ border: 1, h: 'right', fmt: 164, indent: 1 }),
      rem: xf({ border: 1, h: 'left', wrap: 1 }),
      totLabel: xf({ font: 1, border: 1, h: 'left' }),
      totAmt: xf({ font: 1, border: 1, h: 'right', fmt: 3, indent: 1 }),
      desc: xf({ border: 1, h: 'left', wrap: 1 }),
      amt: xf({ border: 1, h: 'right', fmt: 3, indent: 1 }),
      amtBold: xf({ font: 1, border: 1, h: 'right', fmt: 3, indent: 1 }),
      remBox: xf({ border: 1, h: 'left', v: 'top', wrap: 1 }),
      sigRole: xf({ font: 1, h: 'left', v: 'bottom' }),
      sigLine: xf({ border: 2, h: 'left', v: 'bottom' }),
    };

    /* ---- sheet model --------------------------------------------------- */
    const COLS = 'ABCD';
    const grid = {};
    const heights = {};
    const merges = [];
    const ref = (ci, r) => COLS[ci] + r;
    const put = (r, ci, xml) => { (grid[r] = grid[r] || {})[ci] = xml; };
    const blank = (ci, r, s) => put(r, ci, `<c r="${ref(ci, r)}" s="${s}"/>`);
    const str = (ci, r, text, s) => put(r, ci, `<c r="${ref(ci, r)}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`);
    const rich = (ci, r, runs, s) => put(r, ci, `<c r="${ref(ci, r)}" s="${s}" t="inlineStr"><is>${runs.map((u) =>
      `<r><rPr>${u.b ? '<b/>' : ''}${u.i ? '<i/>' : ''}<sz val="11"/><rFont val="${FONT}"/><family val="1"/></rPr><t xml:space="preserve">${xmlText(u.t)}</t></r>`).join('')}</is></c>`);
    const numc = (ci, r, val, s, formula) => put(r, ci, `<c r="${ref(ci, r)}" s="${s}">${formula ? `<f>${xmlText(formula)}</f>` : ''}<v>${val}</v></c>`);
    const merge = (r1, c1, r2, c2, s) => {
      for (let r = r1; r <= r2; r++) for (let ci = c1; ci <= c2; ci++) {
        if (!(grid[r] && grid[r][ci])) blank(ci, r, s);
      }
      merges.push(`${ref(c1, r1)}:${ref(c2, r2)}`);
    };

    const logoDims = logo ? pngSize(logo) : null;
    const LOGO_W = 300; // px
    const logoH = logoDims ? Math.round(LOGO_W * logoDims.h / logoDims.w) : 0;
    heights[1] = logo && logoDims ? Math.ceil(logoH * 0.75) + 8 : 6;

    str(0, 2, 'DAILY CASH CLOSING & SALES RECONCILIATION SHEET', S.title);
    merge(2, 0, 2, 3, S.title); heights[2] = 28;

    rich(0, 4, [{ t: 'Date: ', b: true }, { t: fmtDate(ctx.date) }], S.meta);
    rich(1, 4, [{ t: 'Cashier: ', b: true }, { t: d.cashier }], S.meta); merge(4, 1, 4, 2, S.meta);
    rich(3, 4, [{ t: 'Shift: ', b: true }, { t: d.shift }], S.meta);
    heights[4] = 20;

    // ---- A. Cash Count
    str(0, 6, 'A. Cash Count', S.section);
    str(0, 7, 'Denomination (TZS)', S.headL);
    str(1, 7, 'Quantity', S.headC);
    str(2, 7, 'Amount (TZS)', S.headC);
    str(3, 7, 'Remarks', S.headC);
    heights[7] = 20;

    DENOMS.forEach((v, i) => {
      const r = 8 + i;
      const q = qtyOf(v, ctx);
      numc(0, r, v, S.denom);
      if (q) numc(1, r, q, S.qty); else blank(1, r, S.qty);
      numc(2, r, q * v, S.amtHide, `A${r}*B${r}`);
      if (d.remarks[v]) str(3, r, d.remarks[v], S.rem); else blank(3, r, S.rem);
      heights[r] = 20;
    });
    const rTot = 8 + DENOMS.length; // 16
    str(0, rTot, 'TOTAL CASH COUNTED', S.totLabel);
    merge(rTot, 0, rTot, 1, S.totLabel);
    numc(2, rTot, c.counted, S.totAmt, `SUM(C8:C${rTot - 1})`);
    blank(3, rTot, S.rem);
    heights[rTot] = 22;

    // ---- B. Sales Reconciliation
    const rB = rTot + 2; // 18
    str(0, rB, 'B. Sales Reconciliation', S.section);
    str(0, rB + 1, 'Description', S.headL); merge(rB + 1, 0, rB + 1, 1, S.headL);
    str(2, rB + 1, 'Amount (TZS)', S.headC);
    heights[rB + 1] = 20;

    const r0 = rB + 2; // first line row (Opening Cash)
    let rAfter;        // last row used before the signature block

    if (c.version < 2) {
      // Sheets saved before the credit/debt upgrade: exactly as they were saved.
      const lines = [
        [[{ t: 'Opening Cash ' }, { t: '(Physical Float)', i: true }], c.opening, S.amt, null],
        [[{ t: 'Cash Physical Sales' }], ctx.cash, S.amt, null],
        [[{ t: 'Electronic Sales ' }, { t: '(Mixx by Yas/M-Pesa/Bank)', i: true }], ctx.electronic, S.amt, null],
        [[{ t: 'On Credit Sales' }], ctx.credit, S.amt, null],
        [[{ t: 'Total Sales ' }, { t: '(Cash Physical Sales + Electronic Sales + On Credit Sales)', i: true }], c.total, S.amtBold, 'SUM(C{r1}:C{r3})'],
        [[{ t: 'Expenses' }], ctx.expenses, S.amt, null],
        [[{ t: 'Expected Cash ' }, { t: '((Opening Float + Total Sales) - Expenses)', i: true }], c.expected, S.amtBold, '(C{r0}+C{r4})-C{r5}'],
      ];
      lines.forEach((ln, i) => {
        const r = r0 + i;
        rich(0, r, ln[0], S.desc); merge(r, 0, r, 1, S.desc);
        const f = ln[3] ? ln[3].replace('{r0}', r0).replace('{r1}', r0 + 1).replace('{r3}', r0 + 3).replace('{r4}', r0 + 4).replace('{r5}', r0 + 5) : null;
        numc(2, r, ln[1], ln[2], f);
        heights[r] = 20;
      });

      const rRem = r0 + lines.length;
      rich(0, rRem, [{ t: 'Remarks: ', b: true }, { t: d.note }], S.remBox);
      merge(rRem, 0, rRem, 2, S.remBox);
      heights[rRem] = 62;
      rAfter = rRem;
    } else {
      const L = [
        { key: 'opening', label: [{ t: 'Opening Cash ' }, { t: '(Physical Float)', i: true }], val: c.opening },
        { key: 'cash', label: [{ t: 'Cash Physical Sales' }], val: ctx.cash },
        { key: 'elec', label: [{ t: 'Electronic Sales ' }, { t: '(Mixx by Yas/M-Pesa/Bank)', i: true }], val: ctx.electronic },
        { key: 'credit', label: [{ t: 'On Credit Sales' }], val: ctx.credit },
        { key: 'total', label: [{ t: 'Total Sales, including credit ' }, { t: '(Cash Physical + Electronic + On Credit Sales)', i: true }], val: c.total, bold: true, f: (R) => `SUM(C${R.cash}:C${R.credit})` },
        { key: 'less', label: [{ t: 'Less: On Credit Sales ' }, { t: '(owed by customers, not received)', i: true }], val: -ctx.credit, f: (R) => `-C${R.credit}` },
        { key: 'debt', label: [{ t: 'Add: Previous Debts Paid in Cash ' }, { t: '(collected on this date)', i: true }], val: c.debtCash },
        { key: 'avail', label: [{ t: 'Actual Cash Available ' }, { t: '(Opening Cash + Total Sales - On Credit Sales + Debts Paid in Cash)', i: true }], val: c.available, bold: true, f: (R) => `C${R.opening}+C${R.total}+C${R.less}+C${R.debt}` },
        { key: 'exp', label: [{ t: 'Expenses' }], val: ctx.expenses },
        { key: 'expected', label: [{ t: 'Expected Cash ' }, { t: '(Actual Cash Available - Expenses)', i: true }], val: c.expected, bold: true, f: (R) => `C${R.avail}-C${R.exp}` },
        { key: 'out', label: [{ t: 'Outstanding Customer Debts ' }, { t: '(still owed by customers; not part of Expected Cash)', i: true }], val: ctx.outstanding || 0 },
      ];
      const R = {};
      L.forEach((ln, i) => { R[ln.key] = r0 + i; });
      L.forEach((ln, i) => {
        const r = r0 + i;
        rich(0, r, ln.label, S.desc); merge(r, 0, r, 1, S.desc);
        numc(2, r, ln.val, ln.bold ? S.amtBold : S.amt, ln.f ? ln.f(R) : null);
        heights[r] = 20;
      });
      let r = r0 + L.length;

      // ---- notes on how credit/debt changed Expected Cash
      const notes = debtNotes(ctx);
      if (notes.length) {
        r += 1;
        str(0, r, 'Notes on Expected Cash:', S.section); heights[r] = 20; r += 1;
        notes.forEach((n) => {
          const runs = n.lead ? [{ t: n.lead, b: true }, { t: n.rest }] : [{ t: n.rest }];
          rich(0, r, runs, S.desc); merge(r, 0, r, 3, S.desc);
          heights[r] = Math.max(20, Math.ceil((n.lead.length + n.rest.length) / 100) * 16 + 6);
          r += 1;
        });
      }

      // ---- debt payments received
      const pays = ctx.debtPayments || [];
      if (pays.length) {
        r += 1;
        str(0, r, 'Debt Payments Received', S.section); heights[r] = 20; r += 1;
        str(0, r, 'Customer', S.headL);
        str(1, r, 'Previous Debt', S.headC);
        str(2, r, 'Amount Paid', S.headC);
        str(3, r, 'Remaining Debt / Added to Expected Cash', S.headC);
        heights[r] = 32; r += 1;
        pays.forEach((p) => {
          str(0, r, (p.customer_name || 'A customer') + (p.method === 'online' ? ' (online)' : ''), S.desc);
          numc(1, r, Number(p.previous_debt) || 0, S.amt);
          numc(2, r, Number(p.amount_paid) || 0, S.amt);
          str(3, r, 'Remaining ' + num(p.remaining_debt) + ' · Added ' + num(p.added_to_expected), S.rem);
          heights[r] = 20; r += 1;
        });
      }

      // ---- remarks (the existing one, then the dedicated user remark)
      r += 1;
      rich(0, r, [{ t: 'Remarks: ', b: true }, { t: d.note }], S.remBox);
      merge(r, 0, r, 2, S.remBox); heights[r] = 50; r += 1;
      rich(0, r, [{ t: 'User Remark: ', b: true }, { t: d.userRemark || '' }], S.remBox);
      merge(r, 0, r, 2, S.remBox); heights[r] = 50; r += 1;

      // ---- Bank Deposit & Closing Cash
      r += 1;
      str(0, r, 'Bank Deposit & Closing Cash', S.section); r += 1;
      str(0, r, 'Item', S.headL); merge(r, 0, r, 1, S.headL);
      str(2, r, 'Amount (TZS)', S.headC); heights[r] = 20; r += 1;
      const rBT = r;
      rich(0, r, [{ t: 'Total Cash ' }, { t: '(cash counted in Part A)', i: true }], S.desc); merge(r, 0, r, 1, S.desc);
      numc(2, r, c.counted, S.amt, `C${rTot}`); heights[r] = 20; r += 1;
      const rBD = r;
      rich(0, r, [{ t: 'Bank Deposit' }], S.desc); merge(r, 0, r, 1, S.desc);
      numc(2, r, c.deposit, S.amt); heights[r] = 20; r += 1;
      const rBR = r;
      rich(0, r, [{ t: 'Remaining Cash ' }, { t: '(Total Cash - Bank Deposit)', i: true }], S.desc); merge(r, 0, r, 1, S.desc);
      numc(2, r, c.remaining, S.amtBold, `C${rBT}-C${rBD}`); heights[r] = 20; r += 1;
      rich(0, r, [{ t: 'Bank Deposit Remark: ', b: true }, { t: ctx.bankRemarkText || '' }], S.remBox);
      merge(r, 0, r, 2, S.remBox); heights[r] = 40; r += 1;
      rich(0, r, [{ t: "Tomorrow's Opening Cash " }, { t: '(Remaining Cash carried forward)', i: true }], S.desc); merge(r, 0, r, 1, S.desc);
      numc(2, r, Math.max(0, c.remaining), S.amtBold, `MAX(0,C${rBR})`); heights[r] = 20;
      rAfter = r;
    }

    // ---- Prepared By / Approved By
    const rSig = rAfter + 3;
    str(0, rSig, 'Prepared By', S.sigRole);
    str(2, rSig, 'Approved By', S.sigRole);
    heights[rSig] = 22;
    ['Name:', 'Signature:'].forEach((label, i) => {
      const r = rSig + 1 + i;
      str(0, r, label, S.sigLine);              // column B is left empty as the gap between the two blocks
      str(2, r, label, S.sigLine); merge(r, 2, r, 3, S.sigLine);
      heights[r] = 32;
    });
    const lastRow = rSig + 2;

    /* ---- XML parts ----------------------------------------------------- */
    const sheetRows = [];
    for (let r = 1; r <= lastRow; r++) {
      const cells = grid[r] ? Object.keys(grid[r]).map(Number).sort((a, b) => a - b).map((ci) => grid[r][ci]).join('') : '';
      const ht = heights[r] ? ` ht="${heights[r]}" customHeight="1"` : '';
      sheetRows.push(`<row r="${r}"${ht}>${cells}</row>`);
    }

    const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const hasLogo = !!(logo && logoDims);

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:D${lastRow}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="46" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/><col min="4" max="4" width="30" customWidth="1"/></cols>
<sheetData>${sheetRows.join('')}</sheetData>
<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>
<printOptions horizontalCentered="1"/>
<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>
${hasLogo ? '<drawing r:id="rId1"/>' : ''}
</worksheet>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;-#,##0;;@"/></numFmts>
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="Cash Audit" sheetId="1" r:id="rId1"/></sheets>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

    const files = [
      {
        name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hasLogo ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>`),
      },
      {
        name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      },
      { name: 'xl/workbook.xml', data: enc.encode(workbookXml) },
      {
        name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`),
      },
      { name: 'xl/styles.xml', data: enc.encode(stylesXml) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) },
    ];

    if (hasLogo) {
      const emu = (px) => Math.round(px * 9525);
      const colAWidthPx = 46 * 7 + 5, totalPx = (46 + 14 + 20 + 30) * 7 + 20;
      const offX = Math.max(0, Math.min(colAWidthPx - 10, Math.round((totalPx - LOGO_W) / 2)));
      files.push(
        {
          name: 'xl/worksheets/_rels/sheet1.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`),
        },
        {
          name: 'xl/drawings/drawing1.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${emu(offX)}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${emu(4)}</xdr:rowOff></xdr:from><xdr:ext cx="${emu(LOGO_W)}" cy="${emu(logoH)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="eDESK Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${NS_REL}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(LOGO_W)}" cy="${emu(logoH)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`),
        },
        {
          name: 'xl/drawings/_rels/drawing1.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/image" Target="../media/image1.png"/></Relationships>`),
        },
        { name: 'xl/media/image1.png', data: logo },
      );
    }

    return zipStore(files);
  }

  async function downloadAuditExcel(ctx) {
    ctx = ctx || state;
    if (!ctx || !ctx.ready) { toast('Please wait — the sales for this day are still loading.', 'error'); return; }

    let logo = null;
    try {
      const res = await fetch(LOGO_SRC);
      if (res.ok) logo = new Uint8Array(await res.arrayBuffer());
    } catch (e) { /* no logo - the sheet is still complete */ }

    const blob = buildXlsx(calc(ctx), logo, ctx);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eDESK_Cash_Audit_' + ctx.date + '.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
})();
