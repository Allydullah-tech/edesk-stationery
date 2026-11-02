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
  // When a new version of the app takes over, reload once so the user sees
  // the latest files automatically (no manual refresh / clearing data).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('service-worker.js', { updateViaCache: 'none' })
      .then((reg) => {
        const checkForUpdate = () => reg.update().catch(() => {});
        checkForUpdate();
        // Installed PWAs stay open in the background - re-check when reopened
        // or brought back to the foreground, and every 10 minutes.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
        setInterval(checkForUpdate, 10 * 60 * 1000);
      })
      .catch(() => {});
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

  /* ------------------------------------------------------------------
     Mobile navigation (phones / tablets <= 880px; desktop keeps the sidebar)
     A horizontal dock keeps the most-used pages one tap away. The round
     button in the middle blooms EVERY page into a circle (two rings).
     Pages are read from the sidebar links, so routes and permissions
     (admin-only items) always match the sidebar.
     ------------------------------------------------------------------ */
  var DOCK_PICKS = ['dashboard.html', 'sales.html', 'products.html', 'debts.html'];
  var DOCK_LABELS = { 'dashboard.html': 'Home' };
  var nav = null;

  function navCollect() {
    var known = (typeof CURRENT_USER !== 'undefined') && CURRENT_USER;
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('.sidebar a.nav-link:not(.js-logout)'), function (a) {
      var href = a.getAttribute('href');
      if (!href || href === '#') return;
      if (a.closest('.hidden')) return;                  // not allowed for this user
      if (!known && a.closest('.admin-only')) return;    // role not known yet: never show admin pages early
      var ic = a.querySelector('.ic');
      out.push({ href: href, label: a.textContent.replace(/\s+/g, ' ').trim(), icon: ic ? ic.innerHTML : '' });
    });
    return out;
  }

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function buildNav() {
    if (!document.querySelector('.sidebar') || document.querySelector('.dock')) return;

    var dock = document.createElement('nav');
    dock.className = 'dock no-print';
    dock.setAttribute('aria-label', 'Main navigation');

    var menu = document.createElement('div');
    menu.className = 'radial no-print';
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = '<div class="radial-backdrop"></div>' +
      '<div class="radial-stage"><i class="radial-ring r1"></i><i class="radial-ring r2"></i>' +
      '<div class="radial-core"><small>You are here</small><b></b></div><div class="radial-items"></div></div>';

    document.body.appendChild(menu);
    document.body.appendChild(dock);
    document.body.classList.add('has-bottom-nav');
    nav = { dock: dock, menu: menu, items: menu.querySelector('.radial-items'), core: menu.querySelector('.radial-core b'), open: false, data: [], ready: false };

    menu.querySelector('.radial-backdrop').addEventListener('click', function () { setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.open) setMenu(false); });
    window.addEventListener('pageshow', function () { setMenu(false); });
    window.addEventListener('resize', function () { if (nav.ready) placeRing(); });
    menu.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.radial-item')) setMenu(false, true); });

    // Keep the bar out of the way while typing (on-screen keyboard) so it never covers a form.
    var typing = function (el) {
      return el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]),textarea,select');
    };
    document.addEventListener('focusin', function (e) { if (typing(e.target)) document.body.classList.add('nav-hidden'); });
    document.addEventListener('focusout', function () {
      setTimeout(function () { if (!typing(document.activeElement)) document.body.classList.remove('nav-hidden'); }, 60);
    });
  }

  function setMenu(open, keepState) {
    if (!nav) return;
    nav.open = !!open;
    document.body.classList.toggle('radial-open', nav.open);
    nav.menu.setAttribute('aria-hidden', String(!nav.open));
    var hub = nav.dock.querySelector('.dock-hub');
    if (hub) { hub.setAttribute('aria-expanded', String(nav.open)); hub.setAttribute('aria-label', nav.open ? 'Close all pages' : 'Open all pages'); }
    Array.prototype.forEach.call(nav.items.children, function (el) { el.tabIndex = nav.open ? 0 : -1; });
  }

  function populateNav() {
    if (!nav) return;
    var data = navCollect();
    if (!data.length) return;
    var page = (location.pathname.split('/').pop() || '').toLowerCase();
    nav.data = data;

    // --- horizontal dock: two important pages, the round button, two more ---
    var picks = DOCK_PICKS.map(function (h) { return data.filter(function (d) { return d.href === h; })[0]; }).filter(Boolean);
    function dockLink(it) {
      var cur = it.href.toLowerCase() === page;
      return '<a class="dock-link' + (cur ? ' is-current' : '') + '" href="' + it.href + '"' + (cur ? ' aria-current="page"' : '') + '>' +
        '<span class="ic">' + it.icon + '</span><span class="dl">' + esc(DOCK_LABELS[it.href] || it.label.split(' ')[0]) + '</span></a>';
    }
    var hubHtml = '<button type="button" class="dock-hub" aria-expanded="false" aria-label="Open all pages">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="7" r="2.6"/><circle cx="7" cy="17" r="2.6"/><circle cx="17" cy="17" r="2.6"/></svg></button>';
    nav.dock.innerHTML = picks.slice(0, 2).map(dockLink).join('') + hubHtml + picks.slice(2, 4).map(dockLink).join('');
    nav.dock.querySelector('.dock-hub').addEventListener('click', function () { setMenu(!nav.open); });

    // --- circle with every page ---
    nav.items.innerHTML = data.map(function (it, i) {
      var cur = it.href.toLowerCase() === page;
      return '<a class="radial-item' + (cur ? ' is-current' : '') + '" href="' + it.href + '" tabindex="-1"' + (cur ? ' aria-current="page"' : '') +
        ' style="--i:' + i + '"><span class="ri"><span class="ic">' + it.icon + '</span></span><span class="rl">' + esc(it.label) + '</span></a>';
    }).join('');
    var curItem = data.filter(function (d) { return d.href.toLowerCase() === page; })[0];
    nav.core.textContent = curItem ? curItem.label : 'Menu';
    nav.ready = true;
    placeRing();
    nav.dock.classList.add('is-ready');
  }

  /** Lay the pages out on two concentric rings (inner ring first, clockwise from the top). */
  function placeRing() {
    var els = nav.items.children, n = els.length;
    if (!n) return;
    var outerR = Math.max(96, Math.min(150, window.innerWidth / 2 - 40));
    var innerR = outerR * 0.58;
    var inner = n <= 5 ? n : Math.round(n * 0.27), outer = n - inner;
    nav.menu.querySelector('.r1').style.cssText = 'width:' + (innerR * 2) + 'px;height:' + (innerR * 2) + 'px;';
    nav.menu.querySelector('.r2').style.cssText = 'width:' + (outerR * 2) + 'px;height:' + (outerR * 2) + 'px;';
    for (var i = 0; i < n; i++) {
      var ring = i < inner, k = ring ? i : i - inner, cnt = ring ? inner : outer, r = ring ? innerR : outerR;
      var a = (k / cnt) * 2 * Math.PI - Math.PI / 2 + (ring ? 0 : Math.PI / cnt);   // outer ring is offset half a step
      els[i].style.setProperty('--x', (Math.cos(a) * r).toFixed(1) + 'px');
      els[i].style.setProperty('--y', (Math.sin(a) * r).toFixed(1) + 'px');
    }
  }

  function initNav() {
    buildNav();
    if (!nav) return;
    // Wait until the person's role is known so admin-only pages never flash up for staff.
    document.addEventListener('edesk:authready', populateNav);
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) populateNav();
    else setTimeout(function () { if (!nav.ready) populateNav(); }, 2500);
  }

  var queued = false;
  function queueLabel() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; labelTables(); });
  }

  function init() {
    labelTables();
    initNav();
    new MutationObserver(queueLabel).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
