/**
 * dashboard.workspace.js
 * 「工作台」静态面板（`dashboard.html` 的 `#panel-workspace`）。
 *
 * ⭐ 2026-10-18：
 *   * 卡片用 **CSS 瀑布流**（columns）排列；
 *   * 右上角「⚙️ 设置布局」跳到设置面板的「工作台卡片」区块；
 *   * 显示哪些卡片 / 顺序由**用户设置**决定，保存在
 *     `user_profiles.workspace_layout`（`PUT /api/v0/user/profile`），跨设备一致。
 *
 * 卡片内容尽量用已有接口（最近文档 / 未读通知 / 第三方工具 / 个人资料）；
 * 单个卡片数据失败只影响它自己，不会让整个工作台空掉。
 */

var WORKSPACE_WIDGETS = [
    { id: 'quick',         title: '⚡ 快捷入口',   desc: '文档 / 发现 / 组织 / 第三方工具' },
    { id: 'docs',          title: '📚 最近文档',   desc: '最近更新的 5 篇个人文档' },
    { id: 'notifications', title: '🔔 未读通知',   desc: '全局通知 + 个人站内信' },
    { id: 'checkin',       title: '📅 今日打卡',   desc: '本机打卡状态' },
    { id: 'tools',         title: '🔧 常用工具',   desc: '后端清单里的第三方工具' },
    { id: 'discover',      title: '✨ 发现广场',   desc: '公开文档 / 组 / 组织 / 工具' },
    { id: 'profile',       title: '👤 我的资料',   desc: '昵称、公开主页与设置入口' },
    { id: 'learning',      title: '📖 昨日学习',   desc: '学习记录（即将上线）' }
];

var _wsState = {
    profile: null,
    layout: { order: WORKSPACE_WIDGETS.map(function (w) { return w.id; }), hidden: [] },
    draft: null,
    data: { docs: null, unread: null, tools: null },
    loading: false
};

function wsEsc(value) {
    var esc = window.escapeHtml;
    return typeof esc === 'function' ? esc(value) : String(value == null ? '' : value);
}

function wsApi(url, opts) {
    if (typeof window.apiRequest !== 'function') {
        return Promise.resolve({ code: 500, msg: '共享请求组件未加载' });
    }
    return window.apiRequest(url, Object.assign({ silent: true }, opts || {}));
}

function wsKnownIds() {
    return WORKSPACE_WIDGETS.map(function (w) { return w.id; });
}

/** 合并服务端布局与注册表：未知 id 丢弃，缺省 id 追加到末尾。 */
function resolveLayout(raw) {
    var known = wsKnownIds();
    var order = [];
    var hidden = [];
    if (raw && typeof raw === 'object') {
        var rawOrder = Array.isArray(raw.order) ? raw.order : [];
        rawOrder.forEach(function (id) {
            var key = String(id || '').trim().toLowerCase();
            if (known.indexOf(key) !== -1 && order.indexOf(key) === -1) order.push(key);
        });
        var rawHidden = Array.isArray(raw.hidden) ? raw.hidden : [];
        rawHidden.forEach(function (id) {
            var key = String(id || '').trim().toLowerCase();
            if (known.indexOf(key) !== -1 && hidden.indexOf(key) === -1) hidden.push(key);
        });
    }
    known.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });
    return { order: order, hidden: hidden };
}

function layoutVisibleIds() {
    return _wsState.layout.order.filter(function (id) {
        return _wsState.layout.hidden.indexOf(id) === -1;
    });
}

function widgetById(id) {
    for (var i = 0; i < WORKSPACE_WIDGETS.length; i++) {
        if (WORKSPACE_WIDGETS[i].id === id) return WORKSPACE_WIDGETS[i];
    }
    return null;
}

function cardShell(id, inner, extraClass) {
    var widget = widgetById(id) || { title: id };
    return '<article class="workspace-card ' + (extraClass || '') + '" data-widget="' + wsEsc(id) + '">'
        + '<div class="workspace-card__head"><h3 class="workspace-card__title">' + wsEsc(widget.title) + '</h3></div>'
        + '<div class="workspace-card__body">' + inner + '</div>'
        + '</article>';
}

function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');
}

function checkinCardInner() {
    var uid = _wsState.profile && _wsState.profile.id;
    var checked = false;
    try {
        var raw = uid ? window.localStorage.getItem('checkin_record_' + uid) : null;
        var records = raw ? JSON.parse(raw) : {};
        checked = !!records[todayKey()];
    } catch (e) { /* 忽略 */ }
    return '<p>' + (checked ? '今天已经打过卡了，继续保持 💪' : '今天还没有打卡。') + '</p>'
        + '<p><span class="workspace-status ' + (checked ? 'workspace-status--ok' : 'workspace-status--warn') + '">'
        + (checked ? '今日已打卡' : '今日未打卡') + '</span></p>'
        + '<p><a href="#panel-home">去个人主页打卡 →</a></p>';
}

function quickCardInner() {
    return '<div class="workspace-quick">'
        + '<a href="?tab=docs">📚 个人文档</a>'
        + '<a href="?tab=notifications">🔔 通知</a>'
        + '<a href="?tab=tools">🔧 第三方工具</a>'
        + '<a href="../discover/index.html">✨ 发现广场</a>'
        + '<a href="../org/index.html">🏛️ 组织</a>'
        + '</div>';
}

function docsCardInner() {
    var docs = _wsState.data.docs;
    if (docs === null) return '<p class="loading-text">加载中...</p>';
    if (!Array.isArray(docs) || !docs.length) return '<p>还没有个人文档。</p>';
    return '<ul class="workspace-card__list">' + docs.map(function (d) {
        var href = '?tab=docs&doc=' + encodeURIComponent(d.id);
        return '<li><a href="' + href + '">' + wsEsc(d.icon || '📄') + ' ' + wsEsc(d.title || '（无标题）')
            + '</a></li>';
    }).join('') + '</ul><p><a href="?tab=docs">查看全部 →</a></p>';
}

function notificationsCardInner() {
    var unread = _wsState.data.unread;
    if (!unread) return '<p class="loading-text">加载中...</p>';
    var total = Number(unread.total) || 0;
    return '<p><span class="workspace-big-number">' + (total > 99 ? '99+' : total) + '</span> 条未读</p>'
        + '<p>全局 ' + (Number(unread.global) || 0) + ' 条 / 个人 ' + (Number(unread.personal) || 0) + ' 条</p>'
        + '<p><a href="?tab=notifications">查看通知 →</a></p>';
}

function toolsCardInner() {
    var tools = _wsState.data.tools;
    if (tools === null) return '<p class="loading-text">加载中...</p>';
    if (!Array.isArray(tools) || !tools.length) return '<p>后端工具清单为空。</p>';
    return '<ul class="workspace-card__list">' + tools.slice(0, 4).map(function (t) {
        return '<li><a href="?tab=tools" data-open-tool="' + wsEsc(t.id) + '">'
            + wsEsc(t.icon || '🔧') + ' ' + wsEsc(t.name || t.id) + '</a></li>';
    }).join('') + '</ul><p><a href="?tab=tools">全部工具 →</a></p>';
}

function discoverCardInner() {
    return '<p>浏览公开的文档、组、组织与工具。</p>'
        + '<p><a href="../discover/index.html">进入发现广场 →</a></p>';
}

function profileCardInner() {
    var p = _wsState.profile;
    if (!p) return '<p class="loading-text">加载中...</p>';
    var name = p.display_name || p.nickname || p.username || '未登录';
    return '<p><b>' + wsEsc(name) + '</b></p>'
        + '<p>账号：' + wsEsc(p.username || '-') + '</p>'
        + '<p>公开主页：' + (p.is_public ? '已开启' : '未开启') + '</p>'
        + '<p><a href="?tab=settings">编辑资料 / 设置 →</a></p>';
}

function learningCardInner() {
    return '<p>学习记录功能即将上线。</p>'
        + '<p class="workspace-card__hint">当前先记录文档与打卡数据。</p>';
}

function renderWorkspace() {
    var box = document.getElementById('workspaceMasonry');
    if (!box) return;
    var ids = layoutVisibleIds();
    if (!ids.length) {
        box.innerHTML = '<div class="empty-state">'
            + '<div class="empty-state__icon">🛠️</div>'
            + '<p class="empty-state__text">工作台没有显示任何卡片</p>'
            + '<p class="empty-state__hint">点右上角「设置布局」，在设置里勾选要显示的卡片。</p>'
            + '</div>';
        return;
    }
    box.innerHTML = ids.map(function (id) {
        if (id === 'quick') return cardShell(id, quickCardInner());
        if (id === 'docs') return cardShell(id, docsCardInner());
        if (id === 'notifications') return cardShell(id, notificationsCardInner());
        if (id === 'checkin') return cardShell(id, checkinCardInner());
        if (id === 'tools') return cardShell(id, toolsCardInner());
        if (id === 'discover') return cardShell(id, discoverCardInner());
        if (id === 'profile') return cardShell(id, profileCardInner());
        if (id === 'learning') return cardShell(id, learningCardInner());
        return '';
    }).join('');

    // 工具卡片的链接：点一次直接进入「第三方工具」并打开对应工具
    var toolLinks = box.querySelectorAll('[data-open-tool]');
    for (var i = 0; i < toolLinks.length; i++) {
        (function (link) {
            link.addEventListener('click', function (e) {
                var id = link.dataset.openTool;
                if (!id || !window.GWLTools || typeof window.GWLTools.open !== 'function') return;
                e.preventDefault();
                if (window.DashboardMenu && window.DashboardMenu.switchTab) {
                    window.DashboardMenu.switchTab('tools', { reset: true });
                }
                window.setTimeout(function () { window.GWLTools.open(id); }, 120);
            });
        })(toolLinks[i]);
    }
}

async function loadWorkspaceData() {
    if (_wsState.loading) return;
    _wsState.loading = true;
    try {
        if (!_wsState.profile) {
            var p = await wsApi('/api/v0/user/profile');
            if (p && p.code === 200 && p.data) {
                _wsState.profile = p.data;
                _wsState.layout = resolveLayout(p.data.workspace_layout);
                _wsState.draft = null;
            } else {
                // 资料加载失败也给出默认布局，设置区块不要永远停在「加载中」
                _wsState.layout = resolveLayout(null);
                _wsState.draft = null;
            }
            renderSettingsList();
        }
        renderWorkspace();

        var tasks = [];
        if (_wsState.data.docs === null) {
            tasks.push(wsApi('/api/v0/document/list?scope=private&page=1&size=5').then(function (d) {
                if (d && d.code === 200 && d.data && Array.isArray(d.data.items)) {
                    _wsState.data.docs = d.data.items;
                } else {
                    _wsState.data.docs = [];
                }
            }));
        }
        if (_wsState.data.unread === null) {
            tasks.push(wsApi('/api/v0/notify/unread-count').then(function (d) {
                _wsState.data.unread = (d && d.code === 200 && d.data && d.data.unread)
                    ? d.data.unread : { total: 0, global: 0, personal: 0 };
            }));
        }
        if (_wsState.data.tools === null) {
            tasks.push(wsApi('/api/v0/tools/').then(function (d) {
                _wsState.data.tools = (d && d.code === 200 && d.data && Array.isArray(d.data.tools))
                    ? d.data.tools : [];
            }));
        }
        await Promise.all(tasks);
        renderWorkspace();
    } finally {
        _wsState.loading = false;
    }
}

// ============================================================
// 设置面板：工作台卡片（显示 / 顺序）
// ============================================================

function draftLayout() {
    if (!_wsState.draft) {
        _wsState.draft = {
            order: _wsState.layout.order.slice(),
            hidden: _wsState.layout.hidden.slice()
        };
    }
    return _wsState.draft;
}

function renderSettingsList() {
    var box = document.getElementById('workspaceSettingsList');
    if (!box) return;
    var draft = draftLayout();
    if (!draft.order.length) {
        box.innerHTML = '<p class="loading-text">加载中...</p>';
        return;
    }
    box.innerHTML = draft.order.map(function (id, index) {
        var widget = widgetById(id);
        if (!widget) return '';
        var enabled = draft.hidden.indexOf(id) === -1;
        return '<div class="workspace-setting-row" data-widget-row="' + wsEsc(id) + '">'
            + '<label class="workspace-setting-row__toggle">'
            + '<input type="checkbox" data-ws-toggle="' + wsEsc(id) + '"' + (enabled ? ' checked' : '') + '>'
            + ' 显示</label>'
            + '<span class="workspace-setting-row__name">' + wsEsc(widget.title)
            + '<span class="workspace-setting-row__desc">' + wsEsc(widget.desc) + '</span></span>'
            + '<span class="workspace-setting-row__order">'
            + '<button type="button" data-ws-move="up" data-ws-id="' + wsEsc(id) + '"'
            + (index === 0 ? ' disabled' : '') + ' title="上移">↑</button>'
            + '<button type="button" data-ws-move="down" data-ws-id="' + wsEsc(id) + '"'
            + (index === draft.order.length - 1 ? ' disabled' : '') + ' title="下移">↓</button>'
            + '</span></div>';
    }).join('');
}

function bindSettingsEvents() {
    var box = document.getElementById('workspaceSettingsList');
    if (!box || box.dataset.wsBound === '1') return;
    box.dataset.wsBound = '1';
    box.addEventListener('change', function (e) {
        var cb = e.target.closest('input[data-ws-toggle]');
        if (!cb) return;
        var id = cb.dataset.wsToggle;
        var draft = draftLayout();
        var index = draft.hidden.indexOf(id);
        if (cb.checked && index !== -1) draft.hidden.splice(index, 1);
        if (!cb.checked && index === -1) draft.hidden.push(id);
    });
    box.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-ws-move]');
        if (!btn) return;
        var id = btn.dataset.wsId;
        var dir = btn.dataset.wsMove;
        var draft = draftLayout();
        var index = draft.order.indexOf(id);
        if (index === -1) return;
        var target = dir === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= draft.order.length) return;
        draft.order.splice(index, 1);
        draft.order.splice(target, 0, id);
        renderSettingsList();
    });

    var saveBtn = document.getElementById('workspaceSettingsSaveBtn');
    if (saveBtn && saveBtn.dataset.wsBound !== '1') {
        saveBtn.dataset.wsBound = '1';
        saveBtn.addEventListener('click', saveWorkspaceLayout);
    }
    var resetBtn = document.getElementById('workspaceSettingsResetBtn');
    if (resetBtn && resetBtn.dataset.wsBound !== '1') {
        resetBtn.dataset.wsBound = '1';
        resetBtn.addEventListener('click', resetWorkspaceLayout);
    }
    var jumpBtn = document.getElementById('workspaceSettingsBtn');
    if (jumpBtn && jumpBtn.dataset.wsBound !== '1') {
        jumpBtn.dataset.wsBound = '1';
        jumpBtn.addEventListener('click', function () {
            if (window.DashboardMenu && window.DashboardMenu.switchTab) {
                window.DashboardMenu.switchTab('settings', { reset: true });
            }
            window.setTimeout(function () {
                var section = document.getElementById('workspaceSettingsSection');
                if (section && section.scrollIntoView) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 150);
        });
    }
}

function setWsStatus(text, kind) {
    var el = document.getElementById('workspaceSettingsStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'error' ? '#b91c1c' : (kind === 'success' ? '#15803d' : '');
}

async function saveWorkspaceLayout() {
    var draft = draftLayout();
    setWsStatus('保存中...');
    var d = await wsApi('/api/v0/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ workspace_layout: { order: draft.order, hidden: draft.hidden } })
    });
    if (!d || d.code !== 200) {
        setWsStatus((d && d.msg) || '保存失败，请稍后重试', 'error');
        return;
    }
    _wsState.layout = { order: draft.order.slice(), hidden: draft.hidden.slice() };
    _wsState.draft = null;
    if (d.data) _wsState.profile = d.data;
    renderWorkspace();
    renderSettingsList();
    setWsStatus('已保存', 'success');
    if (window.showToast) window.showToast('工作台布局已保存', 'success');
}

async function resetWorkspaceLayout() {
    setWsStatus('恢复中...');
    var d = await wsApi('/api/v0/user/profile', {
        method: 'PUT', body: JSON.stringify({ workspace_layout: null })
    });
    if (!d || d.code !== 200) {
        setWsStatus((d && d.msg) || '恢复失败，请稍后重试', 'error');
        return;
    }
    _wsState.layout = resolveLayout(null);
    _wsState.draft = null;
    if (d.data) _wsState.profile = d.data;
    renderWorkspace();
    renderSettingsList();
    setWsStatus('已恢复默认布局', 'success');
}

/** 工作台面板初始化钩子（由 dashboard.menu.js 在切到「工作台」时调用） */
function initWorkspacePanel() {
    bindSettingsEvents();
    return loadWorkspaceData();
}

// 设置面板打开时，同步渲染「工作台卡片」区块。
// ⚠️ 这里**不再自己 GET /user/profile**：设置面板的 profile 模块本来就会拉一次，
//    工作台只订阅它广播的 `dashboard:profile-loaded`（否则同一次打开会发两次请求）。
document.addEventListener('dashboard:tab-switched', function (e) {
    if (!e.detail || e.detail.tabKey !== 'settings') return;
    bindSettingsEvents();
    renderSettingsList();
});

document.addEventListener('dashboard:profile-loaded', function (e) {
    var profile = e && e.detail;
    if (!profile) return;
    _wsState.profile = profile;
    _wsState.layout = resolveLayout(profile.workspace_layout);
    _wsState.draft = null;
    renderSettingsList();
    renderWorkspace();
});

// ===== ES Module exports =====
export { initWorkspacePanel, renderWorkspace };

// ===== 兼容层 =====
window.initWorkspacePanel = initWorkspacePanel;
window.renderWorkspace = renderWorkspace;
