let CURRENT_USER = null;

async function requireAuth(allowedRoles = ['admin', 'worker']) {
    const res = await API._request(API.authBase + 'session_check.php', 'GET');
    if (!res.success) {
        window.location.href = 'login.html';
        return null;
    }
    CURRENT_USER = res.data;

    if (!allowedRoles.includes(CURRENT_USER.role)) {
        window.location.href = 'dashboard.html';
        return null;
    }

    paintUserChip();
    applyRoleVisibility();
    showFlashMessage();
    return CURRENT_USER;
}

function showFlashMessage() {
    const msg = sessionStorage.getItem('flashMessage');
    if (msg) {
        sessionStorage.removeItem('flashMessage');
        toast(msg);
    }
}

function paintUserChip() {
    const nameEls = document.querySelectorAll('.js-user-name');
    const roleEls = document.querySelectorAll('.js-user-role');
    const avatarEls = document.querySelectorAll('.js-user-avatar');
    const initials = (CURRENT_USER.full_name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    nameEls.forEach(e => e.textContent = CURRENT_USER.full_name);
    roleEls.forEach(e => e.textContent = CURRENT_USER.role);
    avatarEls.forEach(e => e.textContent = initials);
}

function applyRoleVisibility() {
    if (CURRENT_USER.role !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }
}

function logout() {
    API._request(API.authBase + 'logout.php', 'POST').finally(() => {
        window.location.href = 'login.html';
    });
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = getOrCreateSidebarOverlay();
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('open');
}

function getOrCreateSidebarOverlay() {
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.addEventListener('click', closeSidebar);
        document.body.appendChild(overlay);
    }
    return overlay;
}

document.addEventListener('click', (e) => {
    const logoutEl = e.target.closest && e.target.closest('.js-logout');
    if (logoutEl) {
        e.preventDefault(); // stops the href="#" from jumping the page to the top
        logout();
        return;
    }
    if (e.target.closest && e.target.closest('.js-menu-toggle')) toggleSidebar();
    if (e.target.closest && e.target.closest('.nav-link:not(.js-logout)')) closeSidebar();
});

/**
 * Keep the sidebar's scroll position steady across page navigations.
 * Every page load is a fresh document, so without this the sidebar
 * would always reset to the top even if you'd scrolled down to click
 * a link further down the list. We remember the scroll offset in
 * sessionStorage and restore it as soon as the sidebar exists, then
 * keep it updated as the person scrolls.
 */
(function persistSidebarScroll() {
    const KEY = 'sidebarScrollTop';
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const saved = sessionStorage.getItem(KEY);
    if (saved !== null) sidebar.scrollTop = parseInt(saved, 10) || 0;

    sidebar.addEventListener('scroll', () => {
        sessionStorage.setItem(KEY, sidebar.scrollTop);
    });
})();