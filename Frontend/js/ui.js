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

// --------- Excel (CSV) export - opens cleanly in Excel, good for sending to vendors ---------
function exportToExcel(filename, headers, rows) {
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
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
