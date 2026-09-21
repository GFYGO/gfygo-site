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
    var LS_ORIENT = 'org_view_orient';
    //: 每个组类的「已打开页面 + 分屏方式」：{ "<组类id>": {split, orient, pages:[tabKey,...]} }
    //: 用户要求「页面没点 x 就一直保留」→ 关掉浏览器/刷新后照旧打开。
    //: 单屏把当前页挤掉时也走这里记住（见 toggleHiddenPage），下次还回得来。
    var LS_LAYOUT = 'org_layout_v1';
    //: 单屏下被挤掉、但**不算关闭**的页面（用户仍能在「已打开页面」卡片里一键换回来）
    var LS_HIDDEN = 'org_hidden_pages_v1';

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
        canView: true,      // 后端说我在本组类下有没有 org.view（空列表要区分原因）
        orient: 'horizontal', // 分屏方向：horizontal（左右）| vertical（上下）
        split: 1,           // 1 | 2 | 4
        activeSlot: 0,      // 「当前格」：新页面打开在这里
        panes: [],          // 每格：null 或 {tabKey, label, icon}
        pageCache: Object.create(null),
        pendingPage: Object.create(null),   // tabKey → Promise：同一页面并发只请求一次
        hiddenPages: [],    // 单屏下被挤掉、但仍「已打开」的页面（不算关闭）
        pendingRestore: false,  // 本次选组类是"自动选中"（刷新进来）→ 要恢复上次的页面
        restoreLeft: 0,     // 还要恢复几个（每个成功打开后 --）
        clonedEntry: false, // 本次布局来自存档副本（恢复期间禁止写存档，见 saveLayout）
        booted: false,
        pagesFor: null      // state.pages 属于哪个组类（未加载为 null）—— 防止旧组类按钮残留
    };

    /**
     * 单调递增的请求令牌：判断一个异步响应是否已经过时。
     * ⚠️ 不能用「挂在 pane 对象上的计数器」：切组类/重渲染会把 pane 换成新对象，
     * 计数从 1 重新开始，于是上一个组类的在途响应会被误认为当前响应，把 A 组类身份下
     * 拿到的页面内容注入到 B 组类的格子里。全局单调递增 + 身份比对才挡得住。
     */
    var reqSeq = 0;
    function nextSeq() { reqSeq += 1; return reqSeq; }

    function sameClass(cid) {
        return !!cid && cid === state.activeClass;
    }

    // ============================================================
    // 持久化：每个组类记住「已打开页面 + 分屏方式」
    //   用户要求：没点 × 的页面就一直保留（含刷新 / 下次进来）。
    //   按组类分开存：A 组织的页面布局不会串到 B 组织。
    // ============================================================

    function readJson(key, fallback) {
        try {
            var raw = window.localStorage.getItem(key);
            if (!raw) return fallback;
            var val = JSON.parse(raw);
            return (val && typeof val === 'object') ? val : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 忽略 */ }
    }

    function readLayout(cid) {
        var all = readJson(LS_LAYOUT, {});
        var entry = all[cid];
        return (entry && typeof entry === 'object') ? entry : null;
    }

    /** 存档深拷一份：恢复期间屏幕上还没有页面，绝不能拿它去覆盖存档。 */
    function cloneLayoutEntry(entry) {
        if (!entry) return null;
        return {
            split: entry.split,
            orient: entry.orient,
            pages: Array.isArray(entry.pages) ? entry.pages.slice(0) : []
        };
    }

    /** 记住当前组类的分屏方式与已打开页面（每次布局变化都调一次）。 */
    function saveLayout() {
        if (!state.activeClass) return;
        // 恢复期间：**不动存档**。屏幕上此刻是空的（刚 closeAllPages），
        // 写下去会把"已打开页面"与"后台页面"两份名单一起抹掉。
        if (state.clonedEntry || state.restoreLeft) return;
        var all = readJson(LS_LAYOUT, {});
        all[state.activeClass] = {
            split: state.split,
            orient: state.orient,
            pages: state.panes.filter(Boolean).map(function (p) { return p.tabKey; })
        };
        writeJson(LS_LAYOUT, all);
        saveHidden();
    }

    function saveHidden() {
        if (!state.activeClass) return;
        // ⚠️ 刷新后的首次进入：`selectClass` 会先 `closeAllPages`（格子本来就是空的），
        //    此刻写下去会把存档里"被挤到后台"的名单整个抹掉 —— 而 restorePages()
        //    还没读到它。所以恢复期间一律不写，等恢复完（restoreLeft 归零）再写。
        if (state.clonedEntry || state.pendingRestore || state.restoreLeft) return;
        var all = readJson(LS_HIDDEN, {});
        all[state.activeClass] = state.hiddenPages.slice(0, 8);
        writeJson(LS_HIDDEN, all);
    }

    function readHidden(cid) {
        var all = readJson(LS_HIDDEN, {});
        var list = all[cid];
        return Array.isArray(list) ? list.filter(function (k) { return typeof k === 'string'; }) : [];
    }

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
        var req;
        try {
            req = window.apiRequest(path, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body,
                silent: opts.silent
            });
        } catch (e) {
            req = Promise.reject(e);
        }
        return req.then(function (res) {
            if (res === null) return { code: 500, msg: '网络异常或登录已失效' };
            return res;
        }).catch(function (err) {
            // 兜底：把 reject 归一成响应对象，调用方不必各自写 catch
            // （否则左侧栏/功能格会永久停在「加载中...」）
            console.error('[ORG] 请求失败:', path, err);
            return { code: 500, msg: '网络异常或登录已失效' };
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
        on('closeAllPages', 'click', function () { closeAllPages(false); });

        // 分屏选择
        var splitPick = document.getElementById('splitPick');
        if (splitPick) {
            splitPick.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-split]');
                if (!btn) return;
                setSplit(parseInt(btn.dataset.split, 10), true);
            });
        }
        // 分屏方向（左右 / 上下）
        var orientPick = document.getElementById('orientPick');
        if (orientPick) {
            orientPick.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-orient]');
                if (!btn) return;
                setOrient(btn.dataset.orient, true);
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
        selectClass(wanted, true);   // 自动选中（URL / 上次记住的 / 第一个）→ 恢复该组类上次的布局
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
     *
     * `restoreLayout=true`（仅"自动选中"＝刷新进来时）表示要恢复**该组类上次**的
     * 已打开页面与分屏方式；手动切换组类时不恢复（沿用当前分屏，页面从空开始）。
     */
    function selectClass(cid, restoreLayout) {
        if (!cid || !/^[a-zA-Z]{3}$/.test(cid)) return;
        cid = cid.toLowerCase();
        if (state.activeClass === cid && state.booted) {
            hideCard('orgSwitchCard', 'orgSwitchBtn');
            return;
        }
        // 切走之前先保存**旧组类**的布局，否则那批页面就白开了
        if (state.activeClass && state.activeClass !== cid) saveLayout();

        state.activeClass = cid;
        rememberClass(cid);
        hideCard('orgSwitchCard', 'orgSwitchBtn');
        // ⚠️ 先把「当前组类的功能按钮 / 组类详情」清空再重渲染：
        //    否则 closeAllPages() 内部的 renderFeatures() 会拿**上一个组类**的
        //    state.pages 画按钮（还配上新 cid 的提示），而且那些按钮点下去会以
        //    新 X-Org-Class 请求旧 tab_key（403/404）。旧组类数据一律不留在屏幕上。
        state.pages = [];
        state.pagesFor = null;
        state.canView = true;
        state.classMeta = null;
        // ⚠️ 顺序：先读存档 → 再关掉全部页面（closeAllPages 会 saveLayout，
        //    那时必须已经在"恢复中"状态，否则会把新组类的空布局写进存档）
        var entry = restoreLayout ? cloneLayoutEntry(readLayout(cid)) : null;
        state.pendingRestore = !!restoreLayout;
        state.restoreLeft = 0;
        state.clonedEntry = !!entry;
        state.hiddenPages = [];
        closeAllPages(true);
        applySavedView(entry);
        renderFeatures();
        renderTabsCard();

        renderClassShell();
        // 身份守卫只认「回调执行时 activeClass 还是不是我」——切走再切回同一组类时，
        // 旧请求的结果依然有效（内容同一个组类，重复渲染无害），不需要令牌。
        orgFetch('/api/v0/org/class/' + encodeURIComponent(cid)).then(function (res) {
            if (!sameClass(cid)) return;   // 期间已切到别的组类 → 丢弃这次响应
            if (res && res.code === 200 && res.data) {
                state.classMeta = res.data;
            } else {
                state.classMeta = null;
            }
            renderOrgList();
            renderGroupList();
            renderClassHeader();
            loadFeatures(entry);
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
            // 文案要能区分"真的没组"和"后端没给"：后者通常是我不属于任何组，
            // 或者组类清单接口失败（见 renderClassesError）。
            setHtml('groupList', '<p class="org-muted">'
                + '这里还没有组。<br>'
                + '进入一个组织（左上方「切换组织」）后，你是该组织 owner 时，'
                + '它下辖的**全部组**都会列在这里；否则只列你加入的组与你是 owner 的组。'
                + '</p>');
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

    function loadFeatures(restoreEntry) {
        var grid = document.getElementById('featureGrid');
        var cid = state.activeClass;
        if (!cid) {
            // 没有当前组类：明确收尾，别把网格留在「加载中...」+ aria-busy=true
            state.pages = [];
            state.pagesFor = null;
            state.canView = true;
            if (grid) {
                grid.setAttribute('aria-busy', 'false');
                grid.innerHTML = '';
            }
            renderFeatures();
            return;
        }
        if (grid) {
            grid.setAttribute('aria-busy', 'true');
            grid.innerHTML = '<p class="loading-text" role="status">加载中...</p>';
        }
        orgFetch('/api/v0/org/class/' + encodeURIComponent(cid) + '/pages').then(function (res) {
            // ⭐ 身份守卫：响应回来时已经切到别的组类 → 整段丢弃
            //    （否则 A 组类的按钮会带着新组类的提示渲染出来，点击必然 403/404）
            if (!sameClass(cid)) return;
            if (grid) grid.setAttribute('aria-busy', 'false');
            if (!res || res.code !== 200 || !res.data) {
                // 失败也要清空：留着旧组类的 buttons 比空列表更糟
                state.pages = [];
                state.pagesFor = null;
                state.canView = true;
                renderFeatures((res && res.msg) || '功能列表加载失败');
                return;
            }
            if (res.data.class && !state.classMeta) state.classMeta = res.data.class;
            state.pages = Array.isArray(res.data.pages) ? res.data.pages : [];
            state.canView = res.data.can_view !== false;   // 老后端没有这个字段 → 按有权限处理
            state.pagesFor = cid;
            renderFeatures();
            renderClassHeader();
            // ⭐ 恢复上次打开的页面：必须等页面清单到手（要按 state.pages 校验 tab_key）
            if (state.pendingRestore) {
                state.pendingRestore = false;
                restorePages(cid, restoreEntry || null);
            }
        });
    }

    function renderFeatures(errorText) {
        var hint = document.getElementById('featureScopeHint');
        if (hint) hint.textContent = state.activeClass ? ('@' + state.activeClass) : '';
        if (errorText) {
            setHtml('featureGrid', '<p class="org-muted">' + esc(errorText) + '</p>');
            return;
        }
        if (!state.pages.length) {
            // 两种空态文案必须分开：没有 org.view 的成员看到「暂无可用的功能」
            // 会以为页面被删了，实际是需要别人给他配一条 view 规则。
            setHtml('featureGrid', state.canView
                ? ('<p class="org-muted">'
                    + '这个组类下暂无可用的功能。<br>'
                    + '（功能按钮由后端 `pages/` 目录里 `org_scope=org` 的页面决定；'
                    + '若你是本组类的 owner，权限设置不会挡住你 —— 说明确实还没有这样的页面。）'
                    + '</p>')
                : ('<p class="org-muted">'
                    + '当前组类下你没有查看权限（<code>org.view</code>），所以功能按钮被收起了。<br>'
                    + '请让本组类的 owner 或平台超管配置一条 '
                    + '<code>&lt;组类id&gt;.&lt;你的角色&gt;.org.view.allow</code> 规则。'
                    + '</p>'));
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
        markActivePane();
        renderViewCard();
        renderFeatures();
        saveLayout();
    }

    function clampOrient(value) {
        return value === 'vertical' ? 'vertical' : 'horizontal';
    }

    function setOrient(value, userAction) {
        var next = clampOrient(value);
        if (state.orient === next) {
            renderViewCard();
            return;
        }
        state.orient = next;
        try { window.localStorage.setItem(LS_ORIENT, next); } catch (e) { /* 忽略 */ }
        renderPanes();                  // 只改 grid 方向：内容会被 renderPanes 自动补回
        renderViewCard();
        if (userAction) {
            toast(next === 'vertical' ? '已切换为上下分屏' : '已切换为左右分屏', 'success');
        }
        saveLayout();
    }

    /** 从存档恢复分屏方式（只动 split/orient，不碰已打开的页面）。
     *
     * `entry` 由调用方一次读出并同时交给 `restorePages` —— 本函数内部会
     * `setSplit(..., false)`，它**不会**写存档；但为避免任何时序意外，
     * 恢复用的那份数据始终以调用方读到的为准。
     */
    function applySavedView(entry) {
        if (entry) {
            state.split = clampSplit(parseInt(entry.split, 10));
            state.orient = clampOrient(entry.orient);
            state.panes = [];
            while (state.panes.length < state.split) state.panes.push(null);
            if (state.activeSlot >= state.split) state.activeSlot = state.split - 1;
            renderPanes();
            markActivePane();
            renderViewCard();
            renderFeatures();
            return;
        }
        // 没有该组类的存档 → 用全局默认（旧键），方向默认左右
        setSplit(readSavedSplit(), false);
        setOrient(readSavedOrient(), false);
    }

    /**
     * 恢复上次的「已打开页面」。
     * 调用时机：**功能列表加载成功之后** —— 要按 `state.pages` 校验 tab_key
     * （页面被删掉/停用后，存档里的 tab_key 应该被安静丢掉，而不是恢复成一个空壳）。
     * 恢复是渐进的：`restoreLeft` 期间不覆盖存档，全部开完再写一次。
     */
    function restorePages(cid, entry) {
        var known = {};
        state.pages.forEach(function (p) { known[p.tab_key] = true; });
        var keys = ((entry && Array.isArray(entry.pages)) ? entry.pages : [])
            .filter(function (k) {
                return typeof k === 'string' && TAB_KEY_RE.test(k) && known[k];
            })
            .slice(0, state.split);

        state.hiddenPages = readHidden(cid).filter(function (k) {
            return keys.indexOf(k) < 0 && known[k];
        });
        if (!keys.length) {
            // 存档里没有要在前台恢复的页面（可能全是"后台页面"，也可能什么都没有）。
            // 写回一次：把屏幕上本来就不存在的东西从名单里剔干净。
            state.restoreLeft = 0;
            state.clonedEntry = false;
            renderTabsCard();
            saveLayout();
            return;
        }
        state.restoreLeft = keys.length;
        state.clonedEntry = false;   // 恢复真正开始 → 之后 saveLayout 一律以屏幕为准
        keys.forEach(function (key, idx) {
            setTimeout(function () {
                if (!sameClass(cid)) {          // 期间切走了 → 中止恢复
                    state.restoreLeft = 0;
                    return;
                }
                openPage(key, idx);             // 各自落回原来的槽位
                state.restoreLeft -= 1;
                renderTabsCard();
                if (state.restoreLeft <= 0) {
                    state.restoreLeft = 0;
                    // ⚠️ 归零之后才写：saveHidden 在恢复期间是静默的（见其注释）
                    saveLayout();
                }
            }, 0);
        });
    }

    function readSavedOrient() {
        try {
            var v = window.localStorage.getItem(LS_ORIENT);
            return v === 'vertical' ? 'vertical' : 'horizontal';
        } catch (e) {
            return 'horizontal';
        }
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
        container.dataset.orient = state.orient;   // 左右 / 上下（CSS 见 org.css 的 [data-orient]）

        var any = state.panes.some(Boolean);
        container.hidden = !any;
        var welcome = document.getElementById('orgWelcome');
        if (welcome) welcome.hidden = any;

        // ⚠️ 这里是**整块重建** DOM：每个格子的 body 都是新建的空壳。
        //    因此重建后必须对有内容的格子重新灌一次内容，否则任何重渲染
        //    （改分屏 / 开新页 / 关一格 / 全部关闭）都会把其它格子的正文清空 ——
        //    这正是「分屏看起来能用、其实一改分屏就只剩标题」的根因。
        //    loadPaneContent 走 pageCache，不会重复请求；在途请求也会被令牌拦住。
        var reload = [];
        container.innerHTML = '';
        for (var i = 0; i < state.split; i++) {
            container.appendChild(buildPaneEl(i));
            if (state.panes[i]) reload.push(i);
        }
        reload.forEach(function (slot) {
            loadPaneContent(slot, state.panes[slot].tabKey, false);
        });
    }

    function buildPaneEl(slot) {
        var pane = state.panes[slot];
        var el = document.createElement('section');
        // is-drop 只表示「当前格」这一种高亮（拖放机制已废弃：功能按钮没有 draggable，
        // 全文件也没有 dragstart —— 之前空格也挂 is-drop 只是把两种含义混在一起）
        el.className = 'org-pane' + (slot === state.activeSlot ? ' is-drop' : '');
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
        } else {
            // 有内容（或正在加载）：先给"加载中"占位，renderPanes 会立刻触发真实加载，
            // 不让重建后的格子出现空白无反馈的一帧。
            body.setAttribute('aria-busy', 'true');
            body.innerHTML = '<p class="loading-text" role="status">加载中...</p>';
        }
        el.appendChild(body);

        el.addEventListener('click', function () {
            state.activeSlot = slot;
            renderViewCard();
            markActivePane();
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
        var orientPick = document.getElementById('orientPick');
        if (orientPick) {
            orientPick.querySelectorAll('[data-orient]').forEach(function (btn) {
                btn.setAttribute('aria-checked', btn.dataset.orient === state.orient ? 'true' : 'false');
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
            hint.textContent = '当前 ' + state.split + ' 格（'
                + (state.orient === 'vertical' ? '上下' : '左右') + '），已用 ' + used + ' 格；'
                + '新页面会开在「当前格」（第 ' + (state.activeSlot + 1) + ' 格）——'
                + '当前格已占用时优先找空格，全满则替换当前格。'
                + (state.hiddenPages.length
                    ? ('另有 ' + state.hiddenPages.length + ' 个页面被挤到「已打开页面」卡片里（没丢）。')
                    : '');
        }
        renderTabsCard();
    }

    function renderTabsCard() {
        var list = document.getElementById('tabsList');
        var count = state.panes.filter(Boolean).length;
        setText('tabsCount', String(count + state.hiddenPages.length));
        if (!list) return;
        if (!count && !state.hiddenPages.length) {
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
        // 单屏下被新页面挤走的页面：**不算关闭**，点一下就换回前台（用户要求"没点 × 就一直在"）
        state.hiddenPages.forEach(function (tabKey) {
            var meta = findPage(tabKey);
            if (!meta) return;
            rows.push('<li class="org-tabrow org-tabrow--hidden" data-hidden="' + esc(tabKey) + '">'
                + '<span class="org-tabrow__slot">后台</span>'
                + '<span class="org-tabrow__label">' + esc(meta.icon || '📄') + ' '
                + esc(meta.label) + '</span>'
                + '<button type="button" class="org-tabrow__btn" data-act="show">切到前台</button>'
                + '</li>');
        });
        list.innerHTML = '<ul class="org-tablist">' + rows.join('') + '</ul>';
        list.querySelectorAll('.org-tabrow').forEach(function (row) {
            var slot = parseInt(row.dataset.slot, 10);
            var hiddenKey = row.dataset.hidden || '';
            row.addEventListener('click', function (e) {
                var act = e.target && e.target.dataset ? e.target.dataset.act : '';
                if (hiddenKey) {
                    e.stopPropagation();
                    toggleHiddenPage(hiddenKey);
                    return;
                }
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
        // 覆盖一个已占用的格子前，先释放它占的资源（脚本元素 / Blob URL / 该格的 <style>）。
        // 早先直接覆盖 state.panes[slot]：旧 pane 的 styleId 从此无人引用，
        // 那份 CSS 永久留在 <head> 里污染后面打开的页面。
        var replaced = state.panes[slot];
        if (replaced) {
            releasePane(slot);
            // 单屏（只有一格）时新页面必然挤掉旧的：那不算"用户关掉了它"，
            // 记进 hiddenPages —— 用户仍能在「已打开页面」卡片里一键换回来。
            if (state.split === 1 && replaced.tabKey !== tabKey) {
                rememberHidden(replaced.tabKey);
            }
        }
        state.activeSlot = slot;
        state.panes[slot] = {
            tabKey: tabKey,
            label: meta ? meta.label : tabKey,
            icon: meta ? (meta.icon || '📄') : '📄'
        };
        // 重新打开了同一个页面 → 从"被挤掉"名单里移除
        state.hiddenPages = state.hiddenPages.filter(function (k) { return k !== tabKey; });
        renderPanes();
        markActivePane();
        renderViewCard();
        renderFeatures();
        loadPaneContent(slot, tabKey, false);
        saveLayout();
    }

    /** 记下"被挤掉但没关"的页面（最多 8 个，最近的在前）。 */
    function rememberHidden(tabKey) {
        if (!tabKey) return;
        state.hiddenPages = [tabKey].concat(
            state.hiddenPages.filter(function (k) { return k !== tabKey; })
        ).slice(0, 8);
    }

    /**
     * 在单屏下把某个页面切到前台（或从"被挤掉"名单里彻底移除）。
     * 「已打开页面」卡片里的隐藏项点一下就换回来 —— 这正是"没点 × 就一直在"的落点。
     */
    function toggleHiddenPage(tabKey) {
        if (state.split > 1) {
            // 多屏时没有"被挤掉"概念：直接打开到空格/当前格
            openPage(tabKey);
            return;
        }
        // 单屏：把当前页挤下去，目标页拿到唯一的格子
        var current = state.panes[0];
        if (current && current.tabKey === tabKey) return;
        if (current) rememberHidden(current.tabKey);
        state.hiddenPages = state.hiddenPages.filter(function (k) { return k !== tabKey; });
        openPage(tabKey, 0);
    }

    function closeSlot(slot) {
        if (slot < 0 || slot >= state.panes.length) return;
        releasePane(slot);
        state.panes[slot] = null;
        renderPanes();
        renderViewCard();
        markActivePane();
        renderFeatures();
        saveLayout();
    }

    function closeAllPages(silent) {
        for (var i = 0; i < state.panes.length; i++) {
            if (state.panes[i]) releasePane(i);
            state.panes[i] = null;
        }
        state.pageCache = Object.create(null);
        state.pendingPage = Object.create(null);
        // 「全部关闭」是用户的明确意图：连"被挤掉"的名单一起清掉
        state.hiddenPages = [];
        renderPanes();
        renderViewCard();
        renderFeatures();
        saveLayout();
        if (!silent) toast('已关闭全部页面', 'info');
    }

    /** 释放一格占用的资源（脚本元素 + Blob URL + 页面样式）
     *
     * ⚠️ 样式节点按**格子**编号（orgPageStyle-<slot>）并记在 pane.styleId 上：
     * 早先按 tab_key 命名，同一页面被换到别的格子后旧 styleId 就再也没人删得掉，
     * 那份 CSS 会永久留在 <head> 里污染后开的页面。
     */
    function releasePane(slot) {
        var pane = state.panes[slot];
        var old = document.getElementById('orgPageScript-' + slot);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (pane && pane.blobUrl) {
            try { URL.revokeObjectURL(pane.blobUrl); } catch (e) { /* 忽略 */ }
        }
        var styleId = (pane && pane.styleId) || ('orgPageStyle-' + slot);
        var style = document.getElementById(styleId);
        if (style && style.parentNode) style.parentNode.removeChild(style);
        if (pane) pane.styleId = null;
    }

    function loadPaneContent(slot, tabKey, force) {
        var body = document.getElementById('orgPaneBody-' + slot);
        if (!body) return;
        var pane = state.panes[slot];
        if (!pane || pane.tabKey !== tabKey) return;
        // 每次加载领一个**全局单调递增**令牌，回调里比对 pane 上的令牌。
        // 不能用挂在 pane 上的计数器自增：切组类会把 pane 换成新对象、计数从 1 重来，
        // 上一个组类的在途响应就会被误判成"当前响应"，把别组内容注进这一格。
        var token = nextSeq();
        pane.loadToken = token;
        body.setAttribute('aria-busy', 'true');
        body.innerHTML = '<p class="loading-text" role="status">加载中...</p>';

        fetchPage(tabKey, force).then(function (page) {
            var paneNow = state.panes[slot];
            if (!paneNow || paneNow.tabKey !== tabKey || paneNow.loadToken !== token) return;  // 期间已切换
            var bodyNow = document.getElementById('orgPaneBody-' + slot);
            if (!bodyNow) return;
            bodyNow.setAttribute('aria-busy', 'false');

            if (page.__error) {
                bodyNow.innerHTML = pageErrorHtml(page);
                return;
            }
            paneNow.label = page.label || paneNow.label;
            paneNow.icon = page.icon || paneNow.icon;
            bodyNow.innerHTML = page.html || '<div class="empty-state">'
                + '<div class="empty-state__icon">📄</div>'
                + '<p class="empty-state__text">这个页面没有内容</p></div>';

            if (page.css) {
                // 每格一份样式，并记在 pane 上 → releasePane / 覆盖该格时能删干净
                var styleId = 'orgPageStyle-' + slot;
                var style = document.getElementById(styleId);
                if (!style) {
                    style = document.createElement('style');
                    style.id = styleId;
                    document.head.appendChild(style);
                }
                if (style.textContent !== page.css) style.textContent = page.css;
                paneNow.styleId = styleId;
            }

            runPaneScript(slot, tabKey, page.js || '').then(function () {
                var head = document.querySelector('.org-pane[data-slot="' + slot + '"] .org-pane__title');
                if (head) head.textContent = paneNow.label;
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
        // 单飞：同一页面的并发请求合成一次（renderPanes 会对多格同时补内容）
        var pending = state.pendingPage[tabKey];
        if (pending) return pending;
        var url = '/api/v0/org/class/' + encodeURIComponent(state.activeClass)
            + '/pages/' + encodeURIComponent(tabKey);
        var req;
        try {
            req = orgFetch(url);
        } catch (e) {
            req = Promise.reject(e);
        }
        var p = req.then(function (res) {
            if (res && res.code === 200 && res.data) {
                state.pageCache[tabKey] = res.data;
                return res.data;
            }
            return {
                __error: true,
                code: (res && res.code) || 500,
                msg: (res && res.msg) || '页面加载失败'
            };
        }).catch(function (err) {
            // 兜底：不让 reject 冒到调用方（否则格子永久停在「加载中...」）
            console.error('[ORG] 页面内容请求失败:', tabKey, err);
            return { __error: true, code: 500, msg: '页面加载失败' };
        }).then(function (out) {
            delete state.pendingPage[tabKey];
            return out;
        });
        state.pendingPage[tabKey] = p;
        return p;
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
        // 分屏方式与已打开页面**按组类**存档，等选中组类后由 selectClass(restoreLayout=true)
        // 一次性恢复（见 applySavedView / restorePages）。这里不用旧的全局值初始化，
        // 否则会先渲染一遍错误的格数，再被存档覆盖（闪一下）。
        setOrient(readSavedOrient(), false);
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
        setOrient: setOrient,
        toggleHiddenPage: toggleHiddenPage,
        restorePages: restorePages,
        saveLayout: saveLayout,
        readLayout: readLayout,
        renderViewCard: renderViewCard,
        renderTabsCard: renderTabsCard,
        loadFeatures: loadFeatures
    };
})();
