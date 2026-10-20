/* ============================================================
   公共 UI 组件层：图标 / 导航 / 提示 / 状态徽章
   ============================================================ */

let CURRENT_USER = null;

/* ---------------- 图标（内联 SVG，零外部依赖） ---------------- */
const ICON = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5a5 5 0 0 0-9.6-1.8A5 5 0 0 0 3 8.5c0 5 9 12 9 12s9-7 9-12z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4.6a2 2 0 0 1 2-2h7.4a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 0 0-12 0c0 6-3 7-3 7h18s-3-1-3-7z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8.3-8 9-4.5-.7-8-4-8-9V6l8-3z"/><path d="M9 12l2.2 2.2L15.5 10"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3.8a2.2 2.2 0 0 1 3.1 3.1L7.5 17.7 3 19l1.3-4.5L15.2 3.8z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.6" cy="9.6" r="1.6"/><path d="M3.5 17.5l4.8-4.3a2 2 0 0 1 2.7 0l5 4.6"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l2.6-7A2 2 0 0 1 7.5 4.6h9A2 2 0 0 1 18.4 6L21 13v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4z"/><path d="M3 13h5l1.4 2.4h5.2L16 13h5"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10" width="15" height="11" rx="2.3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2z"/></svg>',
};

/* --------------- 导航 ---------------- */
function navItem(href, label, activeKey) {
    const active = (activeKey === href) ? ' active' : '';
    return `<a class="nav-link${active}" href="${href}">${label}</a>`;
}

function currentPage() {
    return location.pathname.split('/').pop() || 'index.html';
}

function renderNav(activeKey) {
    const el = document.getElementById('nav');
    if (!el) return;

    const page = activeKey || currentPage();
    let links, right;

    if (CURRENT_USER) {
        const isAdmin = CURRENT_USER.role === 'ADMIN';
        links =
            navItem('index.html', '信息广场', page) +
            navItem('publish.html', '发布信息', page) +
            navItem('claims.html', '认领中心', page);
        right =
            `<span class="nav-user">
                <span class="nav-avatar">${esc((CURRENT_USER.nickname || 'U').slice(0, 1).toUpperCase())}</span>
                <b>${esc(CURRENT_USER.nickname)}</b>
                <span style="opacity:.55">·</span>
                <span>${isAdmin ? '管理员' : '用户'}</span>
             </span>
            <a class="nav-link${page === 'notifications.html' ? ' active' : ''}" href="notifications.html">通知<span id="nav-unread"></span></a>
            ${isAdmin ? navItem('admin.html', '管理后台', page) : ''}
            ${navItem('stats.html', '统计', page)}
            <a class="nav-link" href="#" onclick="logout();return false;">退出</a>`;
    } else {
        links = navItem('index.html', '信息广场', page);
        right =
            `${navItem('stats.html', '数据统计', page)}
             <a class="btn btn-sm" href="login.html">登录 / 注册</a>`;
    }

    el.innerHTML =
        `<a class="brand" href="index.html">
            <span class="logo-mark">${ICON.logo}</span>
            <span>校园失物招领</span>
        </a>
        <button class="nav-toggle" aria-label="菜单" onclick="document.getElementById('nav').classList.toggle('open')">${ICON.menu}</button>
        ${links}
        <span class="nav-right">${right}</span>`;

    refreshUnreadBadge();
}

async function refreshUnreadBadge() {
    if (!CURRENT_USER) return;
    try {
        const d = await api.get('/api/notifications/unread-count');
        const slot = document.getElementById('nav-unread');
        if (slot && d && d.unread > 0) {
            slot.innerHTML = `<span class="nav-badge" style="margin-left:6px">${d.unread > 99 ? '99+' : d.unread}</span>`;
        }
    } catch (e) { /* 静默 */ }
}

async function loadUser() {
    try {
        /* silent401：公开页面（首页/登录页/统计页）不必因未登录而跳转 */
        CURRENT_USER = await api.get('/api/user/profile', { silent401: true });
    } catch (e) {
        CURRENT_USER = null;
    }
    return CURRENT_USER;
}

async function logout() {
    try { await api.post('/api/user/logout'); } catch (e) { /* ignore */ }
    location.href = 'index.html';
}

/* --------------- 工具函数 ---------------- */
function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(s) {
    if (!s) return '';
    return String(s).replace('T', ' ').substring(0, 16);
}

/* 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 3 天前 */
function fmtRelative(s) {
    if (!s) return '';
    const t = new Date(String(s).replace(' ', 'T')).getTime();
    if (isNaN(t)) return fmtTime(s);
    const diff = Date.now() - t;
    if (diff < 0) return fmtTime(s);
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
    if (diff < 2 * 86400e3) return '昨天';
    if (diff < 30 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
    return fmtTime(s).substring(0, 10);
}

const STATUS_LABEL = { PENDING: '待认领', CLAIMING: '认领处理中', RESOLVED: '已归还/已解决', CLOSED: '已关闭' };
const CLAIM_STATUS_LABEL = { PENDING: '处理中', APPROVED: '已确认', REJECTED: '已拒绝', MORE_INFO: '要求补充' };
const TYPE_LABEL = { LOST: '寻物', FOUND: '招领' };
const CATEGORY_LIST = ['生活用品', '证件卡片', '电子数码', '书籍资料', '衣物配饰', '其他'];

function statusBadge(status) {
    const map = { PENDING: 'badge-cyan', CLAIMING: 'badge-orange', RESOLVED: 'badge-green', CLOSED: 'badge-gray' };
    return `<span class="badge ${map[status] || 'badge-gray'}">${STATUS_LABEL[status] || esc(status)}</span>`;
}

function typeBadge(type) {
    return `<span class="badge ${type === 'LOST' ? 'badge-red' : 'badge-violet'}">${TYPE_LABEL[type] || esc(type)}</span>`;
}

function claimStatusBadge(s) {
    const map = { PENDING: 'badge-orange', APPROVED: 'badge-green', REJECTED: 'badge-red', MORE_INFO: 'badge-blue' };
    return `<span class="badge ${map[s] || 'badge-gray'}">${CLAIM_STATUS_LABEL[s] || esc(s)}</span>`;
}

/* --------------- Toast ---------------- */
function toast(msg, ok) {
    const t = document.createElement('div');
    t.className = 'toast ' + (ok === false ? 'toast-err' : 'toast-ok');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
        t.classList.add('out');
        setTimeout(() => t.remove(), 260);
    }, 2500);
}

/* --------------- 空状态 ---------------- */
function emptyState(text, icon) {
    return `<div class="empty">${ICON[icon || 'inbox']}<p>${esc(text)}</p></div>`;
}

/* --------------- 页面守卫 ---------------- */
async function requireLogin(redirectTo) {
    await loadUser();
    if (!CURRENT_USER) {
        const back = redirectTo || (currentPage() + location.search);
        location.href = 'login.html?redirect=' + encodeURIComponent(back) + '&reason=auth';
        return false;
    }
    return true;
}

async function requireAdmin() {
    const ok = await requireLogin();
    if (!ok) return false;
    if (CURRENT_USER.role !== 'ADMIN') {
        toast('无权限：该页面仅管理员可访问', false);
        setTimeout(() => { location.href = 'index.html'; }, 1000);
        return false;
    }
    return true;
}
