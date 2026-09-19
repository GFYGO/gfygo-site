/**
 * dashboard.notifications.js
 * 「通知」静态面板（`dashboard.html` 的 `#panel-notifications`）的数据加载。
 *
 * 为什么在这里：通知是侧边栏里**前端写死**的 4 个基础页之一
 * （`dashboard.menu.js::PRIMARY_MENU`），页面内容不由后端下发 ——
 * 只有**数据**走 `GET /api/v0/notify/global`。
 *
 * 由 `dashboard.menu.js::renderTab()` 在显示该面板时调用 `window.initNotificationsPanel()`
 * （见那边的 `STATIC_PANEL_HOOKS`）：每次进入都重新拉一次，与「后端下发时代
 * 每次注入新 HTML 都会重跑脚本」的行为一致。
 *
 * Phase 2: ES Module — 共享资源通过 window 访问（escapeHtml / apiRequest）。
 * ⚠️ 这两个助手在模块加载后可能才就绪（加载顺序），所以**在调用时**再取，不在模块顶层缓存。
 */

/**
 * 统一的 加载 / 空 / 错误 态。
 * 类名见 dashboard.css 的 .empty-state 系列（全站共用，勿另起类名）。
 */
function stateHtml(kind, text, hint) {
    var esc = window.escapeHtml;
    if (kind === 'loading') {
        return '<p class="loading-text" role="status">' + esc(text) + '</p>';
    }
    return '<div class="empty-state">'
        + '<div class="empty-state__icon">' + (kind === 'error' ? '⚠️' : '🔔') + '</div>'
        + '<p class="empty-state__text">' + esc(text) + '</p>'
        + (hint ? '<p class="empty-state__hint">' + esc(hint) + '</p>' : '')
        + '</div>';
}

function cardHtml(n) {
    var esc = window.escapeHtml;
    var status = n.is_active
        ? '<span class="tag tag-green">启用</span>'
        : '<span class="tag tag-gray">已过期</span>';
    return '<div class="notify-card">'
        + '<h4 class="notify-card__title">' + esc(n.title || '系统通知') + '</h4>'
        + '<p class="notify-card__content">' + esc(n.content || '') + '</p>'
        + '<div class="notify-card__meta">'
        + '<span>' + esc(String(n.created_at || '').substring(0, 10)) + '</span>'
        + status
        + '</div></div>';
}

async function loadNotifications() {
    var el = document.getElementById('notifyList');
    if (!el) return;

    el.setAttribute('aria-busy', 'true');
    el.innerHTML = stateHtml('loading', '加载中...');

    // silent：失败态由本面板自己渲染，不再叠一层 Toast
    var d = await window.apiRequest('/api/v0/notify/global', { silent: true });

    el.setAttribute('aria-busy', 'false');

    if (!d || d.code !== 200) {
        el.innerHTML = stateHtml('error', '通知加载失败', (d && d.msg) || '请检查网络后重试');
        return;
    }

    var list = Array.isArray(d.data) ? d.data : [];
    if (list.length === 0) {
        el.innerHTML = stateHtml('empty', '暂无通知', '有新通知时会显示在这里');
        return;
    }

    el.innerHTML = list.map(cardHtml).join('');
}

/** 面板初始化钩子（由 dashboard.menu.js 在切到「通知」时调用） */
function initNotificationsPanel() {
    return loadNotifications();
}

// ===== ES Module exports =====
export { initNotificationsPanel, loadNotifications };

// ===== 兼容层（dashboard.menu.js 通过 window 调钩子）=====
window.initNotificationsPanel = initNotificationsPanel;
window.loadNotifications = loadNotifications;
