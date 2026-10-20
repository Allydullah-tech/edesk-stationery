/**
 * EDESK STATIONERY - UI helpers: toast, modal, currency, PWA install prompt.
 */
function toast(message, type = 'success') {
  let box = document.getElementById('toast-container');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-container';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : 'success');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function money(n) {
  n = Number(n) || 0;
  return 'TZS ' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d + (d.length <= 10 ? 'T00:00:00' : ''));
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Close modal when clicking the dark overlay itself
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// --------- Password show/hide toggle (applies to every password field automatically) ---------
function setupPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.toggleWired) return;
    input.dataset.toggleWired = '1';

    // Wrap the input so the eye button can sit inside it, without disturbing the .field layout
    const wrap = document.createElement('div');
    wrap.className = 'password-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = '<svg class="ui-icon"><use href="assets/icons.svg#eye"></use></svg>';

    btn.addEventListener('click', () => {
      const nowShowing = input.type === 'password';
      input.type = nowShowing ? 'text' : 'password';
      btn.innerHTML = nowShowing
        ? '<svg class="ui-icon"><use href="assets/icons.svg#eye-off"></use></svg>'
        : '<svg class="ui-icon"><use href="assets/icons.svg#eye"></use></svg>';
      btn.setAttribute('aria-label', nowShowing ? 'Hide password' : 'Show password');
    });

    wrap.appendChild(btn);
  });
}
document.addEventListener('DOMContentLoaded', setupPasswordToggles);

// --------- Excel export - real .xlsx with the amber header row ---------
// Every "Download as Excel" in the system goes through exportToExcel(). It
// builds a proper .xlsx whose column-header rows have the same amber
// background as the Low Stock / Purchases template. If the Excel library
// cannot be loaded (e.g. no internet the first time), it falls back to the
// old plain CSV so a download is never lost.
const EXCEL_HEADER_FILL = 'FFC000';
const XLSX_STYLE_URL = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';

let _xlsxLoading = null;
function loadXlsxStyle() {
  // A page may carry the plain SheetJS build (it cannot write colours). Only
  // skip loading when the styled build is already on the page.
  const hasStyled = Array.prototype.some.call(document.scripts, sc => (sc.src || '').indexOf('xlsx-js-style') !== -1);
  if (hasStyled && typeof XLSX !== 'undefined') return Promise.resolve(true);
  if (_xlsxLoading) return _xlsxLoading;
  _xlsxLoading = new Promise(resolve => {
    const sc = document.createElement('script');
    sc.src = XLSX_STYLE_URL;
    sc.onload = () => resolve(typeof XLSX !== 'undefined');
    sc.onerror = () => { _xlsxLoading = null; resolve(typeof XLSX !== 'undefined' && hasStyled); };
    document.head.appendChild(sc);
  });
  return _xlsxLoading;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportToCsvFallback(filename, headers, rows) {
  let csv = headers.length ? headers.join(',') + '\n' : '';
  rows.forEach(r => {
    csv += r.map(v => {
      v = (v === null || v === undefined) ? '' : String(v);
      if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    }).join(',') + '\n';
  });
  saveBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), filename.replace(/\.xlsx$/i, '.csv'));
}

async function exportToExcel(filename, headers, rows) {
  filename = filename.replace(/\.csv$/i, '.xlsx');

  const ok = await loadXlsxStyle();
  if (!ok) { exportToCsvFallback(filename, headers, rows); return; }

  const clean = v => (v === null || v === undefined) ? '' : v;
  const aoa = [];
  if (headers.length) aoa.push(headers.map(clean));
  rows.forEach(r => aoa.push(r.map(clean)));

  // Which rows are column-header rows (get the amber background):
  //  - the main header row passed in, and
  //  - in multi-section sheets (Dashboard, Business Report), the all-text row right
  //    under a single-cell ALL-CAPS section title such as "LOW STOCK ALERTS".
  const headerRows = new Set();
  if (headers.length) headerRows.add(0);
  const isTitle = r => r && r.length === 1 && typeof r[0] === 'string' && r[0].trim() !== '' && r[0] === r[0].toUpperCase() && /[A-Z]/.test(r[0]);
  for (let i = 0; i < aoa.length - 1; i++) {
    const next = aoa[i + 1];
    // Header rows are all text labels; a row holding a number is data (e.g. SUMMARY's "Total Sales").
    if (isTitle(aoa[i]) && next.length > 1 && next.every(v => typeof v === 'string' && v.trim() !== '' && !/^-?[\d.,\s]+$/.test(v))) headerRows.add(i + 1);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  headerRows.forEach(ri => {
    aoa[ri].forEach((_, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c })];
      if (cell) cell.s = { fill: { patternType: 'solid', fgColor: { rgb: EXCEL_HEADER_FILL } }, font: { color: { rgb: '000000' } } };
    });
  });

  // Reports start with a title line ("eDESK STATIONERY - Business Report") and
  // pass no header row: give that title cell the amber background (only the
  // title itself, it does not run across the other columns).
  if (!headers.length && aoa.length && aoa[0].length === 1 && String(aoa[0][0]).trim() !== '' && ws.A1) {
    ws.A1.s = { fill: { patternType: 'solid', fgColor: { rgb: EXCEL_HEADER_FILL } }, font: { bold: true, color: { rgb: '000000' } } };
  }

  // Column widths sized to the content (capped), so nothing is cut off.
  const widths = [];
  aoa.forEach(r => r.forEach((v, c) => {
    const len = String(v).length;
    if (!widths[c] || len > widths[c]) widths[c] = len;
  }));
  ws['!cols'] = widths.map(w => ({ wch: Math.min(Math.max(w + 2, 10), 45) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filename);
}

// --------- Shared "Download" menu: lets the person choose PDF or Excel ---------
function openDownloadMenu(triggerBtn, onPdf, onExcel) {
  document.querySelectorAll('.download-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'download-menu';
  menu.innerHTML = `
    <button type="button" data-action="pdf"><svg class="ui-icon"><use href="assets/icons.svg#download"></use></svg> Download as PDF</button>
    <button type="button" data-action="excel"><svg class="ui-icon"><use href="assets/icons.svg#download"></use></svg> Download as Excel</button>
  `;
  document.body.appendChild(menu);

  const rect = triggerBtn.getBoundingClientRect();
  menu.style.top = (window.scrollY + rect.bottom + 6) + 'px';
  menu.style.left = (window.scrollX + rect.right - menu.offsetWidth) + 'px';

  // Keep it on-screen if that math pushes it off the left edge
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.left < 8) menu.style.left = '8px';
  });

  menu.querySelector('[data-action="pdf"]').addEventListener('click', () => { menu.remove(); onPdf(); });
  menu.querySelector('[data-action="excel"]').addEventListener('click', () => { menu.remove(); onExcel(); });

  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== triggerBtn && !triggerBtn.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

// --------- PWA install prompt (shared across pages) ---------
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.querySelectorAll('.js-install-btn').forEach(b => b.classList.remove('hidden'));
});
function triggerInstall() {
  if (!deferredInstallPrompt) { toast('App is already installed or install is not available on this browser.'); return; }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt = null;
}
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('.js-install-btn')) triggerInstall();
});

// --------- Register service worker for offline/installable support ---------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// --------- Remember scroll position per page ---------
// Sidebar links load a brand-new page each time, so the browser has no
// memory of where you were. This saves your scroll position for the page
// you're leaving, and restores it if you come back to that same page later
// in this session - so navigating around doesn't feel like it keeps
// snapping you back to the top.
(function () {
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  const scrollKey = 'scrollPos:' + location.pathname;

  const saveScrollPos = () => sessionStorage.setItem(scrollKey, String(window.scrollY));
  window.addEventListener('pagehide', saveScrollPos);
  window.addEventListener('beforeunload', saveScrollPos);

  const saved = sessionStorage.getItem(scrollKey);
  if (saved !== null) {
    // Restore after layout has fully settled, not before.
    window.addEventListener('load', () => {
      window.scrollTo(0, parseInt(saved, 10) || 0);
    });
  }
})();


// --------- Responsive layer: phone-friendly tables + bottom navigation bar ---------
// Tables: each cell gets a data-label (its column heading) so CSS can show rows as
// stacked cards on phones. Works for rows added later by the page scripts too.
(function () {
  function labelTables() {
    document.querySelectorAll('.table-wrap table').forEach(function (table) {
      if (table.closest('.modal') || table.classList.contains('no-cards')) return;
      var headRow = table.querySelector('thead tr');
      if (!headRow) return;

      var labels = [];
      Array.prototype.forEach.call(headRow.children, function (th) {
        var span = th.colSpan || 1;
        for (var i = 0; i < span; i++) labels.push(i === 0 ? th.textContent.trim() : '');
      });

      table.classList.add('rt');
      var wrap = table.closest('.table-wrap');
      if (wrap) wrap.classList.add('rt-wrap');

      table.querySelectorAll('tbody tr').forEach(function (tr) {
        var col = 0;
        Array.prototype.forEach.call(tr.children, function (td) {
          var span = td.colSpan || 1;
          if (span === 1) {
            var label = labels[col] || '';
            if (td.getAttribute('data-label') !== label) td.setAttribute('data-label', label);
          }
          col += span;
        });
      });
    });
  }

  function buildBottomNav() {
    if (!document.querySelector('.sidebar') || document.querySelector('.bottom-nav')) return;
    var items = [
      ['dashboard.html', 'home', 'Home'],
      ['sales.html', 'receipt', 'Sales'],
      ['products.html', 'package', 'Products'],
      ['purchases.html', 'cart', 'Purchases']
    ];
    var page = (location.pathname.split('/').pop() || '').toLowerCase();
    var nav = document.createElement('nav');
    nav.className = 'bottom-nav no-print';
    nav.setAttribute('aria-label', 'Quick navigation');
    nav.innerHTML = items.map(function (it) {
      return '<a href="' + it[0] + '"' + (page === it[0] ? ' class="active"' : '') + '>' +
        '<svg class="ui-icon"><use href="assets/icons.svg#' + it[1] + '"></use></svg><span>' + it[2] + '</span></a>';
    }).join('') +
      '<button type="button" class="bn-menu" aria-label="Open menu">' +
      '<svg class="ui-icon"><use href="assets/icons.svg#menu"></use></svg><span>Menu</span></button>';
    document.body.appendChild(nav);
    document.body.classList.add('has-bottom-nav');
    nav.querySelector('.bn-menu').addEventListener('click', function () {
      if (typeof toggleSidebar === 'function') toggleSidebar();
    });
  }

  var queued = false;
  function queueLabel() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; labelTables(); });
  }

  function init() {
    labelTables();
    buildBottomNav();
    new MutationObserver(queueLabel).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
