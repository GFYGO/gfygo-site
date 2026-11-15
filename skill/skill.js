/**
 * skill/skill.js
 * 技能广场（/skill/index.html）的页面逻辑。
 *
 * 技能 = 服务器官方维护的动态页面（site-back/skills/<tab_key>/），与仪表盘的
 * pages/、组织页的 org-func/ 同一套目录契约。本页做四件事：
 *   1. 列目录（GET /api/v0/skills，**未登录也请求** —— 目录是公开的）；
 *   2. 获取 / 取消获取（POST|DELETE /api/v0/skills/<tab_key>/acquire，需登录）；
 *   3. 打开一个技能（GET /api/v0/skills/<tab_key>，把 html/css/js 注入使用区）；
 *      未登录只能打开 anonymous_ok（Lv0）的技能，其余在**前端就先拦下**提示登录，
 *      避免打到后端拿 401 再被 AuthGuard 弹去登录页；
 *   4. 删除技能（DELETE /api/v0/skills/<tab_key>，仅超管）：两段确认，
 *      第二段决定 purge（是否连服务器文件一起删）。
 *
 * 约束（与仪表盘一致）：
 *   * 普通脚本，不用 import/export；不用 eval / new Function；
 *   * 页面内容里的 js 通过 Blob URL + <script src=blob:> 执行（CSP 已放行 blob:）；
 *   * 后端文本只用 textContent / escapeHtml 落 DOM，不当 HTML 注入；
 *   * 确认框一律走共享 Modal（本页在 index.html 里加载 js/modal.js），
 *     不自己造弹层（焦点陷阱 / Esc / 焦点归还都在 Modal 里）。
 */
(function () {
    'use strict';

    var state = {
        items: [],
        filter: 'all',
        query: '',
        loggedIn: false,
        canManage: false,
        runnerTab: null,
        styleEl: null,
        scriptEl: null,
        blobUrl: null,
        busy: {}
    };

    function $(id) { return document.getElementById(id); }

    function esc(str) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(String(str == null ? '' : str));
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(msg, type) {
        if (typeof Toast !== 'undefined' && Toast.show) Toast.show(msg, type || 'info');
    }

    function isLoggedIn() {
        try {
            return !!(window.AuthGuard && window.AuthGuard.getToken && window.AuthGuard.getToken());
        } catch (e) {
            return false;
        }
    }

    // ============================================================
    // 渲染
    // ============================================================

    function visibleItems() {
        var q = state.query.trim().toLowerCase();
        return state.items.filter(function (it) {
            if (state.filter === 'acquired' && !it.acquired) return false;
            if (!q) return true;
            return (it.label || '').toLowerCase().indexOf(q) >= 0
                || (it.description || '').toLowerCase().indexOf(q) >= 0
                || (it.tab_key || '').toLowerCase().indexOf(q) >= 0;
        });
    }

    function renderCard(item) {
        var card = document.createElement('article');
        card.className = 'skill-card';
        card.setAttribute('data-tab-key', item.tab_key);

        // Lv0（后端 anonymous_ok = required_level <= 0）是「免登录」的唯一判据；
        // 注意不能用 item.required_level || 1 兜底：0 会被当成假值再抬回 Lv1。
        var badges = item.anonymous_ok
            ? '<span class="skill-badge skill-badge--open">Lv0 / 免登录</span>'
            : '<span class="skill-badge">Lv' + esc(item.required_level == null ? 1 : item.required_level) + '</span>';
        if (item.acquired) badges += '<span class="skill-badge skill-badge--owned">已获取</span>';
        if (item.has_backend) badges += '<span class="skill-badge">含后端接口</span>';

        card.innerHTML =
            '<div class="skill-card__head">' +
                '<div class="skill-card__icon" aria-hidden="true">' + esc(item.icon || '🧩') + '</div>' +
                '<div class="skill-card__title">' +
                    '<h2 class="skill-card__name">' + esc(item.label || item.tab_key) + '</h2>' +
                    '<span class="skill-card__key">' + esc(item.tab_key) + '</span>' +
                '</div>' +
            '</div>' +
            '<p class="skill-card__desc">' + esc(item.description || '官方技能') + '</p>' +
            '<div class="skill-card__badges">' + badges + '</div>' +
            '<div class="skill-card__actions">' +
                '<button type="button" class="skill-btn" data-skill-act="open">打开</button>' +
                (item.acquired
                    ? '<button type="button" class="skill-btn skill-btn--ghost" data-skill-act="release">取消获取</button>'
                    : '<button type="button" class="skill-btn" data-skill-act="acquire">获取</button>') +
                // 删除是超管入口：只改运营状态 / 文件，普通用户看不到也不该看到
                (state.canManage
                    ? '<button type="button" class="skill-btn skill-btn--danger" data-skill-act="delete">删除</button>'
                    : '') +
            '</div>';

        card.querySelector('[data-skill-act="open"]').addEventListener('click', function () {
            openSkill(item);
        });
        var acq = card.querySelector('[data-skill-act="acquire"]');
        if (acq) acq.addEventListener('click', function () { acquire(item, acq); });
        var rel = card.querySelector('[data-skill-act="release"]');
        if (rel) rel.addEventListener('click', function () { release(item, rel); });
        var del = card.querySelector('[data-skill-act="delete"]');
        if (del) del.addEventListener('click', function () { removeSkill(item, del); });

        return card;
    }

    function render() {
        var grid = $('skillGrid');
        var empty = $('skillEmpty');
        var meta = $('skillMeta');
        if (!grid) return;

        var items = visibleItems();
        grid.innerHTML = '';
        items.forEach(function (it) { grid.appendChild(renderCard(it)); });

        if (empty) {
            empty.hidden = items.length > 0;
            empty.textContent = state.items.length === 0
                ? '还没有可用的技能。等官方上架后再来看看。'
                : '没有匹配的技能，换个关键词试试。';
        }
        if (meta) {
            var owned = state.items.filter(function (it) { return it.acquired; }).length;
            var openable = state.items.filter(function (it) { return it.anonymous_ok; }).length;
            meta.textContent = state.loggedIn
                ? '共 ' + state.items.length + ' 个技能 · 已获取 ' + owned + ' 个'
                : '共 ' + state.items.length + ' 个技能 · ' + openable + ' 个免登录可试用';
        }
    }

    // ============================================================
    // 目录加载
    // ============================================================

    async function loadCatalog() {
        var grid = $('skillGrid');
        if (grid) grid.setAttribute('aria-busy', 'true');
        var res = await apiRequest('/api/v0/skills');
        if (grid) grid.removeAttribute('aria-busy');

        if (!res || res.code !== 200 || !res.data) {
            state.items = [];
            render();
            return;
        }
        state.items = res.data.items || [];
        state.canManage = !!res.data.can_manage;
        render();
    }

    // ============================================================
    // 获取 / 取消
    // ============================================================

    function setBusy(btn, busy) {
        if (!btn) return;
        btn.disabled = !!busy;
    }

    /**
     * confirmDialog — 统一确认框：优先共享 Modal，缺失时退化为原生 confirm。
     * 为什么不各页自己写：Modal 里有焦点陷阱 / Esc 取消 / 焦点归还（P1-3、P2-12），
     * 原生 confirm 只是兜底（CSP 不拦 confirm，且它不会把用户困在页面里）。
     * @returns {Promise<boolean>}
     */
    function confirmDialog(message, options) {
        if (window.Modal && typeof window.Modal.confirm === 'function') {
            return window.Modal.confirm(message, options || {}).then(function (ok) { return !!ok; });
        }
        return Promise.resolve(window.confirm(message));
    }

    async function acquire(item, btn) {
        if (!isLoggedIn()) { toast('请先登录再获取技能', 'warning'); return; }
        setBusy(btn, true);
        var res = await apiRequest('/api/v0/skills/' + encodeURIComponent(item.tab_key) + '/acquire',
            { method: 'POST', silent: true });
        setBusy(btn, false);
        if (!res) return;
        if (res.code === 200) {
            item.acquired = true;
            render();
            toast('已获取「' + (item.label || item.tab_key) + '」，可在仪表盘侧边栏使用', 'success');
        } else {
            toast(res.msg || '获取失败', 'error');
        }
    }

    async function release(item, btn) {
        if (!isLoggedIn()) { toast('请先登录', 'warning'); return; }
        var ok = true;
        if (window.Modal && window.Modal.confirm) {
            ok = await Modal.confirm('取消获取后，这个技能会从你的仪表盘侧边栏移除。确定取消「'
                + (item.label || item.tab_key) + '」吗？', { title: '取消获取' });
        }
        if (!ok) return;
        setBusy(btn, true);
        var res = await apiRequest('/api/v0/skills/' + encodeURIComponent(item.tab_key) + '/acquire',
            { method: 'DELETE', silent: true });
        setBusy(btn, false);
        if (!res) return;
        if (res.code === 200) {
            item.acquired = false;
            render();
            toast('已取消获取', 'success');
        } else {
            toast(res.msg || '取消失败', 'error');
        }
    }

    // ============================================================
    // 删除技能（超管）：两段确认，第二段决定 purge
    // ============================================================
    // 为什么必须两段：第一段说明「这会下架 + 清掉所有人的获取关系」，
    // 第二段才是危险选项 —— 是否连服务器目录一起删（不可恢复）。
    // Modal.confirm 没有勾选框，于是用「同时删除文件 / 仅下架」两个按钮表达
    // 同一个二选一；不要去自造第三套弹窗（焦点陷阱等都在 Modal 里维护）。
    async function removeSkill(item, btn) {
        if (!state.canManage) return;
        var name = item.label || item.tab_key;

        var ok = await confirmDialog(
            '删除技能「' + name + '」会立刻把它从技能广场下架，并清除「所有用户」对它的获取记录，'
            + '已获取的人侧边栏里也会消失。确定继续吗？',
            { title: '删除技能（第 1/2 步）', confirmText: '继续' });
        if (!ok) return;

        var purge = await confirmDialog(
            '第 2/2 步：是否同时删除服务器上的技能文件（skills/' + item.tab_key + '/）？'
            + '「同时删除文件」会永久删除该目录与数据库记录，无法恢复；'
            + '「仅下架」只改运营状态、文件保留，之后可以重新同步上架。',
            { title: '是否删除服务器文件', confirmText: '同时删除文件', cancelText: '仅下架' });

        setBusy(btn, true);
        var res = await apiRequest('/api/v0/skills/' + encodeURIComponent(item.tab_key),
            { method: 'DELETE', body: { purge: !!purge }, silent: true });
        setBusy(btn, false);
        if (!res) return;
        if (res.code !== 200) {
            toast(res.msg || '删除失败', 'error');
            return;
        }
        var files = res.data && res.data.files_removed;
        toast(purge
            ? '已删除「' + name + '」及服务器文件' + (files ? '（' + files + ' 个文件）' : '')
            : '已下架「' + name + '」（服务器文件已保留）', 'success');
        if (state.runnerTab === item.tab_key) closeRunner();
        await loadCatalog();
    }

    // ============================================================
    // 打开技能（内容注入）
    // ============================================================

    function clearRunner() {
        var body = $('skillRunnerBody');
        if (body) body.innerHTML = '';
        if (state.styleEl && state.styleEl.parentNode) state.styleEl.parentNode.removeChild(state.styleEl);
        state.styleEl = null;
        if (state.scriptEl && state.scriptEl.parentNode) state.scriptEl.parentNode.removeChild(state.scriptEl);
        state.scriptEl = null;
        if (state.blobUrl) {
            try { URL.revokeObjectURL(state.blobUrl); } catch (e) { /* 忽略 */ }
            state.blobUrl = null;
        }
        state.runnerTab = null;
    }

    function closeRunner() {
        clearRunner();
        var runner = $('skillRunner');
        if (runner) runner.hidden = true;
    }

    function runPageScript(code, key) {
        if (!code) return;
        try {
            state.blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        } catch (e) {
            console.error('[SKILL] 页面脚本 Blob 创建失败:', key, e);
            return;
        }
        var script = document.createElement('script');
        script.src = state.blobUrl;
        script.setAttribute('data-skill-script', key);
        script.addEventListener('load', function () {
            // 脚本执行完即可释放 URL；元素留着，方便收起时统一清理
            try { URL.revokeObjectURL(state.blobUrl); } catch (e) { /* 忽略 */ }
            state.blobUrl = null;
        });
        document.body.appendChild(script);
        state.scriptEl = script;
    }

    async function openSkill(item) {
        var runner = $('skillRunner');
        var body = $('skillRunnerBody');
        if (!runner || !body) return;

        // 未登录：只有 Lv0（anonymous_ok）能开。**前端先拦**，别让后端 401 触发
        // AuthGuard.handleAuthError 把用户整页跳去登录（那会丢掉他正在看的列表）。
        if (!isLoggedIn() && !item.anonymous_ok) {
            toast('该技能需要登录后使用', 'warning');
            return;
        }

        runner.hidden = false;
        $('skillRunnerName').textContent = item.label || item.tab_key;
        $('skillRunnerIcon').textContent = item.icon || '🧩';
        body.innerHTML = '<p class="skill-empty">正在加载技能…</p>';

        var res = await apiRequest('/api/v0/skills/' + encodeURIComponent(item.tab_key));
        if (!res || res.code !== 200 || !res.data) {
            body.innerHTML = '<p class="skill-empty">'
                + esc((res && res.msg) || '技能加载失败，可能未获取或无权访问。') + '</p>';
            return;
        }

        clearRunner();
        state.runnerTab = item.tab_key;
        var page = res.data;

        body.innerHTML = page.html || '<p class="skill-empty">这个技能没有内容。</p>';

        if (page.css) {
            var style = document.createElement('style');
            style.setAttribute('data-skill-style', item.tab_key);
            style.textContent = page.css;
            document.head.appendChild(style);
            state.styleEl = style;
        }
        runPageScript(page.js, item.tab_key);

        if (runner.scrollIntoView) runner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ============================================================
    // 事件绑定
    // ============================================================

    function bindEvents() {
        var search = $('skillSearch');
        if (search) {
            search.addEventListener('input', function () {
                state.query = search.value || '';
                render();
            });
        }

        document.querySelectorAll('[data-skill-filter]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.filter = btn.getAttribute('data-skill-filter') || 'all';
                document.querySelectorAll('[data-skill-filter]').forEach(function (b) {
                    var on = b === btn;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                render();
            });
        });

        var close = $('skillRunnerClose');
        if (close) close.addEventListener('click', closeRunner);
    }

    function init() {
        state.loggedIn = isLoggedIn();
        bindEvents();
        // 目录接口是 optional JWT：**未登录也加载**（技能广场是公开入口）。
        // 匿名看到的卡片里，非 Lv0 的「打开」会提示登录、「获取」也会提示登录。
        loadCatalog();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
