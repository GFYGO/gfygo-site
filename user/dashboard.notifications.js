/**
 * dashboard.notifications.js
 * 「通知」静态面板（`dashboard.html` 的 `#panel-notifications`）。
 *
 * ⭐ 2026-10-18：从「只拉 /notify/global 的只读列表」升级为**通知中心**：
 *   * 全局通知每项带 `is_read`（后端按用户持久化）；
 *   * 个人定向通知 / 站内信（审批结果、被拉黑、加入成功、管理员私信）；
 *   * 「标为已读」/「全部已读」；
 *   * 侧边栏「通知」红点计数（`GET /notify/unread-count`，持久化，换设备一致）。
 *
 * 数据接口：
 *   GET  /api/v0/notify/global       → [ {..., is_read} ]
 *   GET  /api/v0/notify/personal     → { items:[...], unread:{...} }
 *   POST /api/v0/notify/read         → { global_ids?, personal_ids? }
 *   POST /api/v0/notify/read-all     → { global_ids? }
 *   GET  /api/v0/notify/unread-count → { unread:{total,global,personal} }
 *
 * 由 `dashboard.menu.js::renderTab()` 在显示该面板时调用
 * `window.initNotificationsPanel()`（每次进入都重新拉一次）。
 */

var _notifyState = {
    global: [],
    personal: [],
    unread: { total: 0, global: 0, personal: 0 },
    timer: null
};

function notifyEsc(value) {
    var esc = window.escapeHtml;
    return typeof esc === 'function' ? esc(value) : String(value == null ? '' : value);
}

function notifyApi(url, opts) {
    if (typeof window.apiRequest !== 'function') {
        return Promise.resolve({ code: 500, msg: '共享请求组件未加载' });
    }
    var options = Object.assign({ silent: true }, opts || {});
    return window.apiRequest(url, options);
}

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

function notifyDate(value) {
    var text = String(value || '');
    return text ? text.substring(0, 16).replace('T', ' ') : '';
}

/** 更新所有红点（侧边栏菜单项里的 [data-notify-badge]）。 */
function renderUnreadBadge(counts) {
    var total = counts && Number(counts.total) > 0 ? Number(counts.total) : 0;
    var nodes = document.querySelectorAll('[data-notify-badge]');
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (total > 0) {
            el.hidden = false;
            el.textContent = total > 99 ? '99+' : String(total);
            el.title = '有 ' + total + ' 条未读通知';
        } else {
            el.hidden = true;
            el.textContent = '';
            el.title = '';
        }
    }
    var summary = document.getElementById('notifyUnreadSummary');
    if (summary) {
        if (!counts || (!counts.total && !counts.global && !counts.personal)) {
            summary.textContent = '全部已读';
        } else {
            summary.textContent = '未读 ' + (counts.total || 0)
                + '（全局 ' + (counts.global || 0) + ' / 个人 ' + (counts.personal || 0) + '）';
        }
    }
    var readAll = document.getElementById('notifyReadAllBtn');
    if (readAll) readAll.disabled = !total;
}

/** 只刷新红点（切页 / 定时轮询 / 其它面板操作后都可调用）。 */
async function refreshNotifyBadge() {
    var d = await notifyApi('/api/v0/notify/unread-count');
    if (d && d.code === 200 && d.data && d.data.unread) {
        _notifyState.unread = d.data.unread;
        renderUnreadBadge(d.data.unread);
    }
}

function notifyCardHtml(n, kind) {
    var unread = !n.is_read;
    var isPersonal = kind === 'personal';
    var title = notifyEsc(n.title || (isPersonal ? '个人通知' : '系统通知'));
    var content = notifyEsc(n.content || '');
    var badges = '';
    if (unread) badges += '<span class="notify-card__badge">未读</span>';
    if (isPersonal) badges += '<span class="notify-card__badge notify-card__badge--personal">站内信</span>';
    var link = '';
    var linkUrl = String(n.link_url || '');
    // 只渲染站内相对路径 / http(s)，杜绝 javascript: 链接
    if (/^(https?:\/\/|\/|\.\.?\/|\?|#)/i.test(linkUrl)) {
        link = '<a class="notify-card__link" href="' + notifyEsc(linkUrl) + '">查看详情 →</a>';
    }
    var readBtn = unread
        ? '<button type="button" class="notify-card__read-btn" data-notify-read="1"'
            + ' data-notify-kind="' + kind + '" data-notify-id="' + notifyEsc(n.id) + '">标为已读</button>'
        : '';
    var meta = isPersonal
        ? ('个人通知 · ' + notifyEsc(notifyDate(n.created_at)))
        : ('全局通知 · ' + notifyEsc(notifyDate(n.created_at)));
    return '<div class="notify-card' + (unread ? ' notify-card--unread' : '') + '"'
        + ' data-notify-kind="' + kind + '" data-notify-id="' + notifyEsc(n.id) + '"'
        + ' data-notify-unread="' + (unread ? '1' : '0') + '">'
        + '<h4 class="notify-card__title">' + title + badges + '</h4>'
        + '<p class="notify-card__content">' + content + '</p>'
        + '<div class="notify-card__meta"><span>' + meta + '</span></div>'
        + (link || readBtn ? '<div class="notify-card__actions">' + link + readBtn + '</div>' : '')
        + '</div>';
}

function renderNotifyList() {
    var el = document.getElementById('notifyList');
    if (!el) return;
    var personal = _notifyState.personal;
    var global = _notifyState.global;
    if (!personal.length && !global.length) {
        el.innerHTML = stateHtml('empty', '暂无通知', '有新通知时会显示在这里');
        return;
    }
    var html = '';
    if (personal.length) {
        html += '<h3 class="notify-section-title">📬 个人通知</h3>';
        html += personal.map(function (n) { return notifyCardHtml(n, 'personal'); }).join('');
    }
    if (global.length) {
        html += '<h3 class="notify-section-title">📢 全局通知</h3>';
        html += global.map(function (n) { return notifyCardHtml(n, 'global'); }).join('');
    }
    el.innerHTML = html;
}

async function loadNotifications() {
    var el = document.getElementById('notifyList');
    if (!el) return;

    el.setAttribute('aria-busy', 'true');
    el.innerHTML = stateHtml('loading', '加载中...');

    var results = await Promise.all([
        notifyApi('/api/v0/notify/global'),
        notifyApi('/api/v0/notify/personal')
    ]);
    var g = results[0];
    var p = results[1];

    el.setAttribute('aria-busy', 'false');

    if (!g || g.code !== 200 || !p || p.code !== 200) {
        var msg = (g && g.msg) || (p && p.msg) || '请检查网络后重试';
        el.innerHTML = stateHtml('error', '通知加载失败', msg);
        await refreshNotifyBadge();
        return;
    }

    _notifyState.global = Array.isArray(g.data) ? g.data : [];
    _notifyState.personal = (p.data && Array.isArray(p.data.items)) ? p.data.items : [];
    if (p.data && p.data.unread) {
        _notifyState.unread = p.data.unread;
    }
    renderNotifyList();
    renderUnreadBadge(_notifyState.unread);
    // 与列表分开再拉一次计数：以服务端为准（列表可能只取了最近 N 条）
    await refreshNotifyBadge();
}

async function markNotifyRead(kind, id) {
    var body = kind === 'personal' ? { personal_ids: [id] } : { global_ids: [id] };
    var d = await notifyApi('/api/v0/notify/read', {
        method: 'POST', body: JSON.stringify(body)
    });
    if (!d || d.code !== 200) {
        if (window.showToast) window.showToast((d && d.msg) || '标记已读失败', 'error');
        return;
    }
    if (d.data && d.data.unread) {
        _notifyState.unread = d.data.unread;
        renderUnreadBadge(d.data.unread);
    }
    await loadNotifications();
}

async function markAllNotifyRead() {
    var ids = _notifyState.global.map(function (n) { return n.id; });
    var d = await notifyApi('/api/v0/notify/read-all', {
        method: 'POST', body: JSON.stringify({ global_ids: ids })
    });
    if (!d || d.code !== 200) {
        if (window.showToast) window.showToast((d && d.msg) || '全部已读失败', 'error');
        return;
    }
    if (d.data && d.data.unread) {
        _notifyState.unread = d.data.unread;
        renderUnreadBadge(d.data.unread);
    }
    if (window.showToast) window.showToast('已全部标为已读', 'success');
    await loadNotifications();
}

/** 事件委托：卡片本身 / 「标为已读」按钮都能触发；链接正常跳转。 */
function bindNotifyEvents() {
    var list = document.getElementById('notifyList');
    if (!list || list.dataset.notifyBound === '1') return;
    list.dataset.notifyBound = '1';
    list.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;
        var btn = e.target.closest('[data-notify-read]');
        if (btn) {
            e.preventDefault();
            markNotifyRead(btn.dataset.notifyKind, btn.dataset.notifyId);
            return;
        }
        var card = e.target.closest('.notify-card');
        if (!card || card.dataset.notifyUnread !== '1') return;
        markNotifyRead(card.dataset.notifyKind, card.dataset.notifyId);
    });

    var readAll = document.getElementById('notifyReadAllBtn');
    if (readAll && readAll.dataset.notifyBound !== '1') {
        readAll.dataset.notifyBound = '1';
        readAll.addEventListener('click', function () { markAllNotifyRead(); });
    }
}

/** 面板初始化钩子（由 dashboard.menu.js 在切到「通知」时调用） */
function initNotificationsPanel() {
    bindNotifyEvents();
    if (_notifyState.timer === null) {
        _notifyState.timer = window.setInterval(function () {
            if (!document.hidden) refreshNotifyBadge();
        }, 60000);
    }
    refreshNotifyBadge();
    return loadNotifications();
}

// ===== ES Module exports =====
export { initNotificationsPanel, loadNotifications, refreshNotifyBadge };

// ===== 兼容层（dashboard.menu.js 通过 window 调钩子）=====
window.initNotificationsPanel = initNotificationsPanel;
window.loadNotifications = loadNotifications;
window.refreshNotifyBadge = refreshNotifyBadge;
