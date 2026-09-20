/**
 * org.js — 组织页（gfygo-site/org/index.html）
 *
 * ## 这一页在做什么
 *   组织（organizations）下辖组（groups），两者合称**组类**，id 都是 3 位字母。
 *   本页是组类的**工作台**：
 *     * 左上角「切换组织」      —— 我加入/拥有的组织（弹出卡片列表）
 *     * 其下「我加入的组」      —— 组与组织一样是组类，都可作为当前组类
 *     * 再下「功能」            —— **一行 4 个**的功能按钮，来自后端
 *                                 （`GET /api/v0/org/class/<cid>/pages`）
 *     * 中间                   —— 按钮页面的承载区，可分成 1 / 2 / 4 格
 *     * 右上角「⚙️ 视图」       —— 分屏格数与「当前格」（弹出卡片）
 *     * 左上角「🗂️ 已打开页面」 —— 已打开页面的切换 / 关闭（弹出卡片）
 *
 * ## 功能按钮为什么是"动态页面"
 *   与个人仪表盘完全同源：后端 `site-back/pages/<tab_key>/` 是唯一内容源，
 *   同步进 `menu_items`，本页只取 `org_scope='org'` 的那一批。
 *   因此**以后要扩展功能 ＝ 往后端加一个目录**，本文件一行都不用改。
 *   页面内容的 html/css/js 以 innerHTML / <style> / Blob <script> 注入
 *   （不使用 eval / new Function / 内联脚本；CSP 已为动态页面放行 `blob:`）。
 *
 * ## 组类身份怎么传给后端
 *   每个请求都带 `X-Org-Class: <3字母id>`。后端据此把该组类写进
 *   `now_permission.class_id`，于是权限节点 `<组类id>.<角色名>.<类别>.<权限>`
 *   得以匹配（组类的 owner 直接放行 —— 该组类的权限设置对其无效）。
 *   ⚠️ 后端会**校验我是否属于这个组类**；不属于则身份不会被采用（等价于没有组类身份）。
 *
 * ## 刻意不做的事
 *   * 不在前端做权限推断：按钮是否出现**完全由后端列表接口决定**
 *     （历史教训：前端二次过滤会吃掉服务端已授权的项，见 PROJECT_MEMORY §0.4）。
 *   * 不引入任何框架 / 构建：本文件是普通脚本（非 ES module）。
 */
(function () {
    'use strict';

    var TAB_KEY_RE = /^[a-zA-Z0-9_-]{1,50}$/;
    var LS_LAST_CLASS = 'org_last_class_id';
    var LS_SPLIT = 'org_view_split';

    // ============================================================
    // 状态
    // ============================================================

    var state = {
        token: null,
        classes: [],        // 平铺清单（组织 + 组）
        orgs: [],           // 组织（含下属组）
        activeClass: null,  // 当前组类 id
        classMeta: null,    // 当前组类详情（来自 /class/<cid>）
        pages: [],          // 当前组类的功能按钮（后端下发）
        split: 1,           // 1 | 2 | 4
        activeSlot: 0,      // 「当前格」：新页面打开在这里
        panes: [],          // 每格：null 或 {tabKey, label, icon}
        pageCache: Object.create(null),
        booted: false
    };

    function pageBase() {
        return (window.API_BASE_URL || '');
    }

    // ============================================================
    // 网络：所有请求都带 X-Org-Class
    // ============================================================

    function orgHeaders(extra) {
        var headers = extra || {};
        if (state.activeClass) headers['X-Org-Class'] = state.activeClass;
        return headers;
    }

    /** 统一请求：返回 {code,msg,data}；401/422 交给 AuthGuard */
    function orgFetch(path, opts) {
        opts = opts || {};
        var headers = orgHeaders(opts.headers);
        return window.apiRequest(path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body,
            silent: opts.silent
        }).then(function (res) {
            if (res === null) return { code: 500, msg: '网络异常或登录已失效' };
            return res;
        });
    }

    /** 后端返回的 data 里若有 status（组织表是否就绪），在前端显式提示 */
    function noteStatus(data) {
        if (data && data.status && data.status.tables_ready === false) {
            toast(data.status.hint || '组织数据表尚未就绪', 'info');
        }
    }

    function toast(msg, type) {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    }

    function esc(value) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ============================================================
    // 启动
    // ============================================================

    function boot() {
        state.token = window.AuthGuard ? window.AuthGuard.getToken() : null;
        bindChrome();
        renderViewCard();
        renderPanes();

        if (!state.token) {
            renderLoggedOut();
            return;
        }
        renderOrgAuthArea();
        loadClasses();
    }

    /** 顶栏两个弹出卡片 + 视图卡片的事件绑定（只绑一次） */
    function bindChrome() {
        bindPopcard('tabsToggle', 'tabsCard');
        bindPopcard('viewToggle', 'viewCard');
        bindPopcard('orgSwitchBtn', 'orgSwitchCard');

        on('tabsCardClose', 'click', function () { hideCard('tabsCard', 'tabsToggle'); });
        on('viewCardClose', 'click', function () { hideCard('viewCard', 'viewToggle'); });
        on('closeAllPages', 'click', closeAllPages);

        // 分屏选择
        var splitPick = document.getElementById('splitPick');
        if (splitPick) {
            splitPick.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-split]');
                if (!btn) return;
                setSplit(parseInt(btn.dataset.split, 10), true);
            });
        }
        on('closeCurrentSlot', 'click', function () { closeSlot(state.activeSlot); });
        on('resetView', 'click', function () {
            setSplit(1, true);
            state.activeSlot = 0;
            renderViewCard();
            toast('视图已复位为单屏', 'success');
        });

        // 点击页面空白处收起弹出卡片
        document.addEventListener('click', function (e) {
            ['tabsCard', 'viewCard', 'orgSwitchCard'].forEach(function (id) {
                var card = document.getElementById(id);
                if (!card || card.hidden) return;
                var wrap = card.parentNode;
                if (wrap && !wrap.contains(e.target)) {
                    card.hidden = true;
                    syncAria(id, false);
                }
            });
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            ['tabsCard', 'viewCard', 'orgSwitchCard'].forEach(function (id) {
                var card = document.getElementById(id);
                if (card && !card.hidden) { card.hidden = true; syncAria(id, false); }
            });
        });
    }

    function on(id, event, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    /** 弹出卡片：按钮 ↔ 卡片（点按钮切换，点卡片内不收起） */
    function bindPopcard(btnId, cardId) {
        var btn = document.getElementById(btnId);
        var card = document.getElementById(cardId);
        if (!btn || !card) return;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var willOpen = card.hidden;
            card.hidden = !willOpen;
            syncAria(cardId, willOpen);
        });
        card.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    function syncAria(cardId, open) {
        var btn = document.getElementById(cardId === 'tabsCard' ? 'tabsToggle'
            : cardId === 'viewCard' ? 'viewToggle' : 'orgSwitchBtn');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function hideCard(cardId, btnId) {
        var card = document.getElementById(cardId);
        if (card) card.hidden = true;
        var btn = document.getElementById(btnId);
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    // ============================================================
    // 未登录 / 顶栏用户区
    // ============================================================

    function renderLoggedOut() {
        ['orgCurrentId', 'orgCurrentName'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.textContent = id === 'orgCurrentId' ? '---' : '未登录';
        });
        setHtml('orgSwitchList', '<p class="org-muted">登录后才能看到你加入的组织。</p>');
        setHtml('groupList', '<p class="org-muted">登录后才能看到你加入的组。</p>');
        setHtml('featureGrid', '<p class="org-muted">登录后才显示功能按钮。</p>');
        var auth = document.getElementById('auth-container');
        if (auth) {
            auth.innerHTML = '<a class="org-btn" href="' + esc(window.BASE_PATH || '..') + '/login.html">登录</a>';
        }
        var hint = document.getElementById('viewHint');
        if (hint) hint.textContent = '登录后可用。';
    }

    /** 顶栏用户区 + 权限切换按钮（复用主站的 renderAuthStatus / renderPermissionButtons） */
    function renderOrgAuthArea() {
        if (typeof window.renderAuthStatus !== 'function') return;
        window.apiRequest('/api/v0/auth/status', { silent: true }).then(function (res) {
            if (!res || res.code !== 200 || !res.data) return;
            var user = res.data.user || res.data;
            window.renderAuthStatus(user);
            if (typeof window.renderPermissionButtons === 'function') {
                window.renderPermissionButtons({
                    current_level: user.permission_level || 1,
                    max_level: user.permission_level || 1
                });
            }
        });
    }

    // ============================================================
    // 组类加载
    // ============================================================

    function loadClasses() {
        orgFetch('/api/v0/org/classes').then(function (res) {
            if (!res || res.code !== 200 || !res.data) {
                renderClassesError((res && res.msg) || '组类列表加载失败');
                return;
            }
            noteStatus(res.data);
            state.classes = Array.isArray(res.data.classes) ? res.data.classes : [];
            return orgFetch('/api/v0/org/orgs').then(function (res2) {
                if (res2 && res2.code === 200 && res2.data) {
                    state.orgs = Array.isArray(res2.data.orgs) ? res2.data.orgs : [];
                } else {
                    state.orgs = [];
                }
                pickInitialClass();
            });
        });
    }

    function renderClassesError(msg) {
        setHtml('orgSwitchList', '<p class="org-muted">' + esc(msg) + '</p>');
        setHtml('groupList', '<p class="org-muted">' + esc(msg) + '</p>');
        setHtml('featureGrid', '<p class="org-muted">' + esc(msg) + '</p>');
        var nameEl = document.getElementById('orgCurrentName');
        if (nameEl) nameEl.textContent = '加载失败';
    }

    /** 选一个初始组类：URL ?class= > 上次记住的 > 第一个组织 > 第一个组 */
    function pickInitialClass() {
        if (!state.classes.length) {
            renderClassShell();
            return;
        }
        var wanted = readClassFromUrl() || readLastClass();
        var known = {};
        state.classes.forEach(function (c) { known[c.id] = true; });
        if (!wanted || !known[wanted]) {
            var firstOrg = state.classes.filter(function (c) { return c.kind === 'org'; })[0];
            wanted = (firstOrg || state.classes[0]).id;
        }
        selectClass(wanted);
    }

    function readClassFromUrl() {
        try {
            var v = new URL(window.location.href).searchParams.get('class');
            return v && /^[a-zA-Z]{3}$/.test(v) ? v.toLowerCase() : null;
        } catch (e) {
            return null;
        }
    }

    function readLastClass() {
        try {
            var v = window.localStorage.getItem(LS_LAST_CLASS);
            return v && /^[a-zA-Z]{3}$/.test(v) ? v.toLowerCase() : null;
        } catch (e) {
            return null;
        }
    }

    function rememberClass(cid) {
        try { window.localStorage.setItem(LS_LAST_CLASS, cid); } catch (e) { /* 忽略 */ }
        try {
            var url = new URL(window.location.href);
            url.searchParams.set('class', cid);
            window.history.replaceState(window.history.state || null, '', url.toString());
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 切换当前组类。
     * 会清空已打开的页面 —— 那些页面是按**上一个组类**的权限拉下来的，
     * 留在屏幕上等于展示越权内容（宁可不留，也不要用错权限渲染的残留）。
     */
    function selectClass(cid) {
        if (!cid || !/^[a-zA-Z]{3}$/.test(cid)) return;
        cid = cid.toLowerCase();
        if (state.activeClass === cid && state.booted) {
            hideCard('orgSwitchCard', 'orgSwitchBtn');
            return;
        }
        state.activeClass = cid;
        rememberClass(cid);
        hideCard('orgSwitchCard', 'orgSwitchBtn');
        closeAllPages(true);

        renderClassShell();
        orgFetch('/api/v0/org/class/' + encodeURIComponent(cid)).then(function (res) {
            if (res && res.code === 200 && res.data) {
                state.classMeta = res.data;
            } else {
                state.classMeta = null;
            }
            renderOrgList();
            renderGroupList();
            renderClassHeader();
            loadFeatures();
            state.booted = true;
        });
    }

    function renderClassShell() {
        var current = findClass(state.activeClass);
        setText('orgCurrentId', state.activeClass || '---');
        setText('orgCurrentName', current ? current.name : (state.activeClass ? state.activeClass : '暂无组类'));
        renderOrgList();
        renderGroupList();
        renderClassHeader();

        if (!state.classes.length) {
            setHtml('orgSwitchList', '<p class="org-muted">'
                + '你还没有加入任何组织或组。<br>请让管理员在后台创建组织/组，并把你的账号加入某个组。'
                + '</p>');
            setHtml('groupList', '<p class="org-muted">暂无。</p>');
            setHtml('featureGrid', '<p class="org-muted">暂无可用的功能。</p>');
            var hint = document.getElementById('viewHint');
            if (hint) hint.textContent = '还没有可用的组类，因此没有功能按钮。';
        }
    }

    function findClass(cid) {
        for (var i = 0; i < state.classes.length; i++) {
            if (state.classes[i].id === cid) return state.classes[i];
        }
        return null;
    }

    // ============================================================
    // 左导航渲染
    // ============================================================

    function renderOrgList() {
        var rows = [];
        var seen = {};
        state.orgs.forEach(function (org) {
            seen[org.id] = true;
            rows.push(orgRow(org));
        });
        // /orgs 没返回但 /classes 里有组织条目（例如只有 owner 而没有成员记录）
        state.classes.forEach(function (c) {
            if (c.kind !== 'org' || seen[c.id]) return;
            rows.push(orgRow({ id: c.id, name: c.name, owner: c.owner, role: c.role, groups: [] }));
        });
        if (!rows.length) {
            setHtml('orgSwitchList', '<p class="org-muted">你还没有加入任何组织。</p>');
            return;
        }
        setHtml('orgSwitchList', rows.join(''));
        var list = document.getElementById('orgSwitchList');
        if (list) {
            list.querySelectorAll('[data-class-id]').forEach(function (el) {
                el.addEventListener('click', function () { selectClass(el.dataset.classId); });
            });
        }
    }

    function orgRow(org) {
        var active = org.id === state.activeClass ? ' is-active' : '';
        var tags = '';
        if (org.owner) tags += '<span class="org-tag org-tag--owner">owner</span>';
        else if (org.role) tags += '<span class="org-tag">' + esc(org.role) + '</span>';
        var count = Array.isArray(org.groups) ? org.groups.length : 0;
        return '<button type="button" class="org-group' + active + '" data-class-id="' + esc(org.id) + '">'
            + '<span class="org-group__id">' + esc(org.id) + '</span>'
            + '<span class="org-group__name">' + esc(org.name) + '</span>'
            + tags
            + '<span class="org-tag">' + count + ' 组</span>'
            + '</button>';
    }

    function renderGroupList() {
        var groups = state.classes.filter(function (c) { return c.kind === 'group'; });
        if (!groups.length) {
            setHtml('groupList', '<p class="org-muted">你还没有加入任何组。</p>');
            return;
        }
        var html = groups.map(function (g) {
            var active = g.id === state.activeClass ? ' is-active' : '';
            var tags = g.owner ? '<span class="org-tag org-tag--owner">owner</span>'
                : '<span class="org-tag">' + esc(g.role || 'member') + '</span>';
            return '<button type="button" class="org-group' + active + '" data-class-id="' + esc(g.id) + '">'
                + '<span class="org-group__id">' + esc(g.id) + '</span>'
                + '<span class="org-group__name">' + esc(g.name) + '</span>'
                + tags
                + '</button>';
        }).join('');
        setHtml('groupList', html);
        var list = document.getElementById('groupList');
        if (list) {
            list.querySelectorAll('[data-class-id]').forEach(function (el) {
                el.addEventListener('click', function () { selectClass(el.dataset.classId); });
            });
        }
    }

    function renderClassHeader() {
        var meta = document.getElementById('orgMeta');
        if (!meta) return;
        var c = findClass(state.activeClass);
        var snap = state.classMeta;
        if (!c && !snap) { meta.textContent = ''; return; }
        var kind = (snap && snap.kind) || (c && c.kind) || 'group';
        var role = (snap && snap.role) || (c && c.role) || 'member';
        var parts = [];
        parts.push('<span class="org-tag org-tag--kind">' + esc(kind === 'org' ? '组织' : '组') + '</span>');
        parts.push('<span class="org-tag' + ((snap && snap.owner) ? ' org-tag--owner' : '') + '">'
            + esc(role) + '</span>');
        if (snap && snap.org_id) parts.push('<span class="org-tag">上级 ' + esc(snap.org_id) + '</span>');
        if (snap && snap.view_node) parts.push('<span class="org-tag" title="权限节点">'
            + esc(snap.view_node) + '</span>');
        meta.innerHTML = parts.join(' ');
    }

    // ============================================================
    // 功能按钮（一行 4 个，后端下发）
    // ============================================================

    function loadFeatures() {
        var grid = document.getElementById('featureGrid');
        if (grid) {
            grid.setAttribute('aria-busy', 'true');
            grid.innerHTML = '<p class="loading-text" role="status">加载中...</p>';
        }
        var cid = state.activeClass;
        if (!cid) return;
        orgFetch('/api/v0/org/class/' + encodeURIComponent(cid) + '/pages').then(function (res) {
            if (grid) grid.setAttribute('aria-busy', 'false');
            if (!res || res.code !== 200 || !res.data) {
                setHtml('featureGrid', '<p class="org-muted">'
                    + esc((res && res.msg) || '功能列表加载失败') + '</p>');
                return;
            }
            if (res.data.class && !state.classMeta) state.classMeta = res.data.class;
            state.pages = Array.isArray(res.data.pages) ? res.data.pages : [];
            renderFeatures();
            renderClassHeader();
        });
    }

    function renderFeatures() {
        var hint = document.getElementById('featureScopeHint');
        if (hint) hint.textContent = state.activeClass ? ('@' + state.activeClass) : '';
        if (!state.pages.length) {
            setHtml('featureGrid', '<p class="org-muted">'
                + '这个组类下暂无可用的功能。<br>'
                + '（功能按钮由后端 `pages/` 目录里 `org_scope=org` 的页面决定；'
                + '若你是本组类的 owner，权限设置不会挡住你 —— 说明确实还没有这样的页面。）'
                + '</p>');
            return;
        }
        var html = state.pages.map(function (p) {
            var open = isOpen(p.tab_key) ? ' is-open' : '';
            return '<button type="button" class="org-feature' + open + '" data-tab="' + esc(p.tab_key) + '"'
                + ' title="' + esc(p.description || p.label) + '">'
                + '<span class="org-feature__icon" aria-hidden="true">' + esc(p.icon || '📄') + '</span>'
                + '<span class="org-feature__label">' + esc(p.label) + '</span>'
                + '</button>';
        }).join('');
        setHtml('featureGrid', html);
        var grid = document.getElementById('featureGrid');
        if (grid) {
            grid.querySelectorAll('[data-tab]').forEach(function (el) {
                el.addEventListener('click', function () { openPage(el.dataset.tab); });
            });
        }
    }

    function findPage(tabKey) {
        for (var i = 0; i < state.pages.length; i++) {
            if (state.pages[i].tab_key === tabKey) return state.pages[i];
        }
        return null;
    }

    function isOpen(tabKey) {
        return state.panes.some(function (p) { return p && p.tabKey === tabKey; });
    }

    // ============================================================
    // 分屏与格
    // ============================================================

    function clampSplit(n) {
        return (n === 2 || n === 4) ? n : 1;
    }

    function setSplit(n, userAction) {
        n = clampSplit(parseInt(n, 10));
        // 缩小格数：超出范围的页面**先尝试搬到空格**，搬不动才关闭（绝不静默丢弃）
        if (n < state.panes.length) {
            var moved = 0;
            var closed = 0;
            for (var i = n; i < state.panes.length; i++) {
                var pane = state.panes[i];
                if (!pane) continue;
                var target = firstEmptySlot(n);
                if (target >= 0) {
                    state.panes[target] = pane;
                    moved++;
                } else {
                    releasePane(i);
                    closed++;
                }
                state.panes[i] = null;
            }
            if (userAction && (moved || closed)) {
                toast('已调整分屏：移动 ' + moved + ' 个页面'
                    + (closed ? ('，关闭 ' + closed + ' 个（空间不足）') : ''), 'info');
            }
        }
        state.split = n;
        state.panes = state.panes.slice(0, n);
        while (state.panes.length < n) state.panes.push(null);
        if (state.activeSlot >= n) state.activeSlot = n - 1;
        try { window.localStorage.setItem(LS_SPLIT, String(n)); } catch (e) { /* 忽略 */ }
        renderPanes();
        renderViewCard();
    }

    function readSavedSplit() {
        try {
            var v = parseInt(window.localStorage.getItem(LS_SPLIT), 10);
            return clampSplit(v);
        } catch (e) {
            return 1;
        }
    }

    function firstEmptySlot(limit) {
        var end = typeof limit === 'number' ? limit : state.split;
        for (var i = 0; i < end; i++) {
            if (!state.panes[i]) return i;
        }
        return -1;
    }

    /** 新页面开在哪里：当前格为空 → 当前格；否则第一个空格；都满 → 当前格（替换） */
    function targetSlotFor() {
        if (!state.panes[state.activeSlot]) return state.activeSlot;
        var empty = firstEmptySlot();
        return empty >= 0 ? empty : state.activeSlot;
    }

    function renderPanes() {
        var container = document.getElementById('orgPanes');
        if (!container) return;
        container.dataset.split = String(state.split);

        var any = state.panes.some(Boolean);
        container.hidden = !any;
        var welcome = document.getElementById('orgWelcome');
        if (welcome) welcome.hidden = any;

        container.innerHTML = '';
        for (var i = 0; i < state.split; i++) {
            container.appendChild(buildPaneEl(i));
        }
    }

    function buildPaneEl(slot) {
        var pane = state.panes[slot];
        var el = document.createElement('section');
        el.className = 'org-pane' + (pane ? '' : ' is-drop') + (slot === state.activeSlot ? ' is-drop' : '');
        el.dataset.slot = String(slot);

        var head = document.createElement('div');
        head.className = 'org-pane__head' + (pane ? '' : ' is-empty');

        var icon = document.createElement('span');
        icon.className = 'org-pane__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = pane ? (pane.icon || '📄') : '·';
        head.appendChild(icon);

        var title = document.createElement('span');
        title.className = 'org-pane__title';
        title.textContent = pane ? pane.label : ('空格 ' + (slot + 1) + '（点左侧功能打开）');
        head.appendChild(title);

        if (pane) {
            var close = document.createElement('button');
            close.className = 'org-pane__close';
            close.setAttribute('aria-label', '关闭这一格');
            close.innerHTML = '&times;';
            close.addEventListener('click', function (e) {
                e.stopPropagation();
                closeSlot(slot);
            });
            head.appendChild(close);
        }
        el.appendChild(head);

        var body = document.createElement('div');
        body.className = 'org-pane__body';
        body.id = 'orgPaneBody-' + slot;
        if (!pane) {
            body.innerHTML = '<div class="empty-state">'
                + '<div class="empty-state__icon">➕</div>'
                + '<p class="empty-state__text">这一格是空的</p>'
                + '<p class="empty-state__hint">点左侧功能把它填进来；'
                + '用右上角「⚙️ 视图」可以把这一格设为「当前格」。</p>'
                + '</div>';
        }
        el.appendChild(body);

        el.addEventListener('click', function () {
            state.activeSlot = slot;
            renderViewCard();
            markActivePane();
        });
        el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('is-drop'); });
        el.addEventListener('dragleave', function () { el.classList.remove('is-drop'); });
        el.addEventListener('drop', function (e) {
            e.preventDefault();
            el.classList.remove('is-drop');
            var tabKey = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
            if (tabKey) openPage(tabKey, slot);
        });
        return el;
    }

    function markActivePane() {
        var container = document.getElementById('orgPanes');
        if (!container) return;
        container.querySelectorAll('.org-pane').forEach(function (el) {
            var isActive = parseInt(el.dataset.slot, 10) === state.activeSlot;
            el.style.outline = isActive ? '2px solid var(--color-primary)' : '';
            el.style.outlineOffset = isActive ? '-2px' : '';
        });
    }

    function renderViewCard() {
        var splitPick = document.getElementById('splitPick');
        if (splitPick) {
            splitPick.querySelectorAll('[data-split]').forEach(function (btn) {
                var on = parseInt(btn.dataset.split, 10) === state.split;
                btn.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        }
        var slotPick = document.getElementById('slotPick');
        if (slotPick) {
            var html = '';
            for (var i = 0; i < state.split; i++) {
                var pane = state.panes[i];
                html += '<button type="button" class="org-slotpick__opt" data-slot="' + i + '"'
                    + ' role="radio" aria-checked="' + (i === state.activeSlot ? 'true' : 'false') + '">'
                    + (i + 1) + (pane ? ' ●' : '')
                    + '</button>';
            }
            slotPick.innerHTML = html;
            slotPick.querySelectorAll('[data-slot]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    state.activeSlot = parseInt(btn.dataset.slot, 10);
                    renderViewCard();
                    markActivePane();
                });
            });
        }
        var hint = document.getElementById('viewHint');
        if (hint) {
            var used = state.panes.filter(Boolean).length;
            hint.textContent = '当前 ' + state.split + ' 格，已用 ' + used + ' 格；'
                + '新页面会开在「当前格」（第 ' + (state.activeSlot + 1) + ' 格）——'
                + '当前格已占用时优先找空格，全满则替换当前格。';
        }
        renderTabsCard();
    }

    function renderTabsCard() {
        var list = document.getElementById('tabsList');
        var count = state.panes.filter(Boolean).length;
        setText('tabsCount', String(count));
        if (!list) return;
        if (!count) {
            list.innerHTML = '<p class="org-muted">还没有打开任何页面。</p>';
            return;
        }
        var rows = [];
        for (var i = 0; i < state.panes.length; i++) {
            var pane = state.panes[i];
            if (!pane) continue;
            rows.push('<li class="org-tabrow' + (i === state.activeSlot ? ' is-active' : '')
                + '" data-slot="' + i + '">'
                + '<span class="org-tabrow__slot">#' + (i + 1) + '</span>'
                + '<span class="org-tabrow__label">' + esc(pane.icon || '📄') + ' '
                + esc(pane.label) + '</span>'
                + '<button type="button" class="org-tabrow__btn" data-act="focus">定位</button>'
                + '<button type="button" class="org-tabrow__btn" data-act="close" aria-label="关闭">&times;</button>'
                + '</li>');
        }
        list.innerHTML = '<ul class="org-tablist">' + rows.join('') + '</ul>';
        list.querySelectorAll('.org-tabrow').forEach(function (row) {
            var slot = parseInt(row.dataset.slot, 10);
            row.addEventListener('click', function (e) {
                var act = e.target && e.target.dataset ? e.target.dataset.act : '';
                if (act === 'close') {
                    e.stopPropagation();
                    closeSlot(slot);
                    return;
                }
                state.activeSlot = slot;
                renderViewCard();
                markActivePane();
                hideCard('tabsCard', 'tabsToggle');
            });
        });
    }

    // ============================================================
    // 页面打开 / 关闭
    // ============================================================

    function openPage(tabKey, slotOverride) {
        if (typeof tabKey !== 'string' || !TAB_KEY_RE.test(tabKey)) return;
        var meta = findPage(tabKey);

        // 已经开着 → 定位到它（不重复打开）
        for (var i = 0; i < state.panes.length; i++) {
            if (state.panes[i] && state.panes[i].tabKey === tabKey) {
                state.activeSlot = i;
                renderViewCard();
                markActivePane();
                renderFeatures();
                return;
            }
        }

        var slot = typeof slotOverride === 'number' && slotOverride >= 0 && slotOverride < state.split
            ? slotOverride : targetSlotFor();
        state.activeSlot = slot;
        state.panes[slot] = {
            tabKey: tabKey,
            label: meta ? meta.label : tabKey,
            icon: meta ? (meta.icon || '📄') : '📄'
        };
        renderPanes();
        renderViewCard();
        markActivePane();
        renderFeatures();
        loadPaneContent(slot, tabKey, false);
    }

    function closeSlot(slot) {
        if (slot < 0 || slot >= state.panes.length) return;
        releasePane(slot);
        state.panes[slot] = null;
        renderPanes();
        renderViewCard();
        markActivePane();
        renderFeatures();
    }

    function closeAllPages(silent) {
        for (var i = 0; i < state.panes.length; i++) {
            if (state.panes[i]) releasePane(i);
            state.panes[i] = null;
        }
        state.pageCache = Object.create(null);
        renderPanes();
        renderViewCard();
        renderFeatures();
        if (!silent) toast('已关闭全部页面', 'info');
    }

    /** 释放一格占用的资源（脚本元素 + Blob URL + 页面样式） */
    function releasePane(slot) {
        var pane = state.panes[slot];
        var old = document.getElementById('orgPageScript-' + slot);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (pane && pane.blobUrl) {
            try { URL.revokeObjectURL(pane.blobUrl); } catch (e) { /* 忽略 */ }
        }
        if (pane && pane.styleId) {
            var style = document.getElementById(pane.styleId);
            if (style && style.parentNode) style.parentNode.removeChild(style);
        }
    }

    function loadPaneContent(slot, tabKey, force) {
        var body = document.getElementById('orgPaneBody-' + slot);
        if (!body) return;
        body.innerHTML = '<p class="loading-text" role="status">加载中...</p>';
        var seq = (state.panes[slot] || {}).seq = ((state.panes[slot] || {}).seq || 0) + 1;

        fetchPage(tabKey, force).then(function (page) {
            var pane = state.panes[slot];
            if (!pane || pane.tabKey !== tabKey || pane.seq !== seq) return;   // 期间已切换
            var bodyNow = document.getElementById('orgPaneBody-' + slot);
            if (!bodyNow) return;

            if (page.__error) {
                bodyNow.innerHTML = pageErrorHtml(page);
                return;
            }
            pane.label = page.label || pane.label;
            pane.icon = page.icon || pane.icon;
            bodyNow.innerHTML = page.html || '<div class="empty-state">'
                + '<div class="empty-state__icon">📄</div>'
                + '<p class="empty-state__text">这个页面没有内容</p></div>';

            if (page.css) {
                var styleId = 'orgPageStyle-' + tabKey;
                var style = document.getElementById(styleId);
                if (!style) {
                    style = document.createElement('style');
                    style.id = styleId;
                    document.head.appendChild(style);
                }
                if (style.textContent !== page.css) style.textContent = page.css;
                pane.styleId = styleId;
            }

            runPaneScript(slot, tabKey, page.js || '').then(function () {
                var head = document.querySelector('.org-pane[data-slot="' + slot + '"] .org-pane__title');
                if (head) head.textContent = pane.label;
                renderTabsCard();
                renderFeatures();
            });

            document.dispatchEvent(new CustomEvent('org:page-opened', {
                detail: { slot: slot, tabKey: tabKey, classId: state.activeClass, page: page }
            }));
        });
    }

    function fetchPage(tabKey, force) {
        if (!force && state.pageCache[tabKey]) return Promise.resolve(state.pageCache[tabKey]);
        var url = '/api/v0/org/class/' + encodeURIComponent(state.activeClass)
            + '/pages/' + encodeURIComponent(tabKey);
        return orgFetch(url).then(function (res) {
            if (res && res.code === 200 && res.data) {
                state.pageCache[tabKey] = res.data;
                return res.data;
            }
            return {
                __error: true,
                code: (res && res.code) || 500,
                msg: (res && res.msg) || '页面加载失败'
            };
        });
    }

    function pageErrorHtml(page) {
        var code = page && page.code;
        var title = code === 403 ? '权限不足'
            : code === 404 ? '页面不存在或未安装' : '页面加载失败';
        return '<div class="empty-state">'
            + '<div class="empty-state__icon">' + (code === 403 ? '🔒' : '📄') + '</div>'
            + '<p class="empty-state__text">' + esc(title) + '</p>'
            + (page && page.msg ? '<p class="empty-state__hint">' + esc(page.msg) + '</p>' : '')
            + '</div>';
    }

    /** 执行页面脚本：Blob URL + <script src=blob:>（与仪表盘同一套机制） */
    function runPaneScript(slot, tabKey, js) {
        var old = document.getElementById('orgPageScript-' + slot);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (!js || !String(js).trim()) return Promise.resolve(true);

        var url;
        try {
            url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
        } catch (e) {
            console.error('[ORG] 页面脚本 Blob 创建失败:', tabKey, e);
            return Promise.resolve(false);
        }
        var pane = state.panes[slot];
        if (pane) pane.blobUrl = url;

        return new Promise(function (resolve) {
            var script = document.createElement('script');
            script.id = 'orgPageScript-' + slot;
            script.src = url;
            script.onload = function () {
                if (pane && pane.blobUrl === url) {
                    try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
                    pane.blobUrl = null;
                }
                resolve(true);
            };
            script.onerror = function () {
                console.warn('[ORG] 页面脚本执行失败（可能被 CSP 拦截）:', tabKey);
                resolve(false);
            };
            document.head.appendChild(script);
        });
    }

    // ============================================================
    // 小工具
    // ============================================================

    function setHtml(id, html) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    // ============================================================
    // 入口
    // ============================================================

    function start() {
        setSplit(readSavedSplit(), false);
        boot();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // 供测试 / 其它脚本使用
    window.OrgPage = {
        state: state,
        selectClass: selectClass,
        openPage: openPage,
        closeSlot: closeSlot,
        closeAllPages: closeAllPages,
        setSplit: setSplit,
        renderViewCard: renderViewCard,
        loadFeatures: loadFeatures
    };
})();
