/**
 * skill/skill.js
 * 技能广场（/skill/index.html）的页面逻辑。
 *
 * 技能 = 服务器官方维护的动态页面（site-back/skills/<tab_key>/），与仪表盘的
 * pages/、组织页的 org-func/ 同一套目录契约。本页只做三件事：
 *   1. 列目录（GET /api/v0/skills）；
 *   2. 获取 / 取消获取（POST|DELETE /api/v0/skills/<tab_key>/acquire）；
 *   3. 打开一个技能（GET /api/v0/skills/<tab_key>，把 html/css/js 注入使用区）。
 *
 * 约束（与仪表盘一致）：
 *   * 普通脚本，不用 import/export；不用 eval / new Function；
 *   * 页面内容里的 js 通过 Blob URL + <script src=blob:> 执行（CSP 已放行 blob:）；
 *   * 后端文本只用 textContent / escapeHtml 落 DOM，不当 HTML 注入。
 */
(function () {
    'use strict';

    var state = {
        items: [],
        filter: 'all',
        query: '',
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

        var badges = '<span class="skill-badge">Lv' + esc(item.required_level || 1) + '</span>';
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
            '</div>';

        card.querySelector('[data-skill-act="open"]').addEventListener('click', function () {
            openSkill(item);
        });
        var acq = card.querySelector('[data-skill-act="acquire"]');
        if (acq) acq.addEventListener('click', function () { acquire(item, acq); });
        var rel = card.querySelector('[data-skill-act="release"]');
        if (rel) rel.addEventListener('click', function () { release(item, rel); });

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
            meta.textContent = '共 ' + state.items.length + ' 个技能 · 已获取 ' + owned + ' 个';
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
        bindEvents();
        if (!isLoggedIn()) {
            var meta = $('skillMeta');
            if (meta) meta.textContent = '登录后可获取技能';
            var empty = $('skillEmpty');
            if (empty) {
                empty.hidden = false;
                empty.textContent = '技能目录需要登录后查看，请先登录。';
            }
            return;
        }
        loadCatalog();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
