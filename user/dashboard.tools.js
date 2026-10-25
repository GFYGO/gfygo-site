/**
 * dashboard.tools.js
 * 「第三方工具」静态面板（`dashboard.html` 的 `#panel-tools`）。
 *
 * ⭐ 2026-10-18：
 *   * 卡片按首页的 `.feature-grid / .feature-tile` 样式渲染；
 *   * 点击卡片**在本页嵌入** iframe 打开（和动态页面一样不跳走）；
 *   * 清单来自后端 `data/third_party_tools.json`（`GET /api/v0/tools/`），
 *     不依赖数据库；后端启动时会把它同步到发现页（广场）。
 *   * 记住上次打开的工具（localStorage），并在卡片上标出。
 *
 * 关于 Cookie / 登录状态：iframe 里是第三方站点自己的源，它的 Cookie 由浏览器
 * 按该站点域名保存；本站不读取、不代存，也不加 sandbox（加了反而会禁用其存储）。
 */

var _toolsState = {
    tools: null,
    current: null,
    bound: false
};

var TOOLS_LAST_KEY = 'gwl_tools_last_id';

function toolsEsc(value) {
    var esc = window.escapeHtml;
    return typeof esc === 'function' ? esc(value) : String(value == null ? '' : value);
}

function toolsApi(url) {
    if (typeof window.apiRequest !== 'function') {
        return Promise.resolve({ code: 500, msg: '共享请求组件未加载' });
    }
    return window.apiRequest(url, { silent: true });
}

function getLastToolId() {
    try { return window.localStorage.getItem(TOOLS_LAST_KEY) || ''; } catch (e) { return ''; }
}

function setLastToolId(id) {
    try { window.localStorage.setItem(TOOLS_LAST_KEY, id || ''); } catch (e) { /* 忽略 */ }
}

function toolsGridHtml(tools) {
    if (!tools.length) {
        return '<div class="empty-state">'
            + '<div class="empty-state__icon">🔧</div>'
            + '<p class="empty-state__text">后端工具清单为空</p>'
            + '<p class="empty-state__hint">工具清单暂不可用，请稍后重试。</p>'
            + '</div>';
    }
    var last = getLastToolId();
    return tools.map(function (t) {
        var badge = (t.id === last) ? '<span class="tools-tile__last">上次打开</span>' : '';
        return '<button type="button" class="feature-tile tools-tile" data-tool-id="' + toolsEsc(t.id) + '">'
            + '<span class="feature-tile__img" aria-hidden="true">' + toolsEsc(t.icon || '🔧') + '</span>'
            + '<span class="feature-tile__content">'
            + '<span class="feature-tile__title">' + toolsEsc(t.name || t.id) + badge + '</span>'
            + '<span class="feature-tile__desc">' + toolsEsc(t.description || t.url || '') + '</span>'
            + '</span></button>';
    }).join('');
}

function renderToolsGrid() {
    var grid = document.getElementById('toolsGrid');
    if (!grid) return;
    if (_toolsState.tools === null) {
        grid.innerHTML = '<p class="loading-text" role="status">加载中...</p>';
        return;
    }
    grid.innerHTML = toolsGridHtml(_toolsState.tools);
    var buttons = grid.querySelectorAll('[data-tool-id]');
    for (var i = 0; i < buttons.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                openTool(btn.dataset.toolId);
            });
        })(buttons[i]);
    }
}

function findTool(id) {
    var tools = _toolsState.tools || [];
    for (var i = 0; i < tools.length; i++) {
        if (tools[i].id === id) return tools[i];
    }
    return null;
}

function showToolsView(view) {
    var gridView = document.getElementById('toolsGridView');
    var embedView = document.getElementById('toolsEmbedView');
    if (gridView) gridView.style.display = view === 'grid' ? '' : 'none';
    if (embedView) embedView.style.display = view === 'embed' ? '' : 'none';
}

/** 打开一个工具：本页内嵌入 iframe。 */
function openTool(id) {
    if (_toolsState.tools === null) {
        loadTools().then(function () { openTool(id); });
        return;
    }
    var tool = findTool(id);
    if (!tool) {
        if (window.showToast) window.showToast('工具不存在或已从清单移除', 'error');
        return;
    }
    _toolsState.current = tool;
    setLastToolId(tool.id);
    var title = document.getElementById('toolsEmbedTitle');
    if (title) title.textContent = (tool.icon || '🔧') + ' ' + (tool.name || tool.id);
    var link = document.getElementById('toolsExternalLink');
    if (link) link.href = tool.url;
    var frame = document.getElementById('toolsFrame');
    if (frame) {
        frame.title = tool.name || tool.id;
        frame.src = tool.url;
    }
    showToolsView('embed');
    renderToolsGrid();  // 更新「上次打开」标记
}

function backToToolsGrid() {
    var frame = document.getElementById('toolsFrame');
    if (frame) frame.src = 'about:blank';
    _toolsState.current = null;
    showToolsView('grid');
}

function reloadToolFrame() {
    var frame = document.getElementById('toolsFrame');
    if (!frame) return;
    if (_toolsState.current) {
        frame.src = _toolsState.current.url;
    } else {
        frame.src = frame.src;
    }
}

function bindToolsEvents() {
    if (_toolsState.bound) return;
    _toolsState.bound = true;
    var back = document.getElementById('toolsBackBtn');
    if (back) back.addEventListener('click', backToToolsGrid);
    var reload = document.getElementById('toolsReloadBtn');
    if (reload) reload.addEventListener('click', reloadToolFrame);

    // 允许其它模块（工作台工具卡）直接打开：window.GWLTools.open(id)
    window.GWLTools = {
        open: openTool,
        back: backToToolsGrid,
        reload: reloadToolFrame,
        list: function () { return (_toolsState.tools || []).slice(); }
    };
}

async function loadTools(force) {
    var grid = document.getElementById('toolsGrid');
    if (grid && _toolsState.tools === null) {
        grid.innerHTML = '<p class="loading-text" role="status">加载中...</p>';
    }
    if (_toolsState.tools !== null && !force) {
        renderToolsGrid();
        return;
    }
    var d = await toolsApi('/api/v0/tools/');
    if (!d || d.code !== 200 || !d.data || !Array.isArray(d.data.tools)) {
        _toolsState.tools = [];
        if (grid) {
            grid.innerHTML = '<div class="empty-state">'
                + '<div class="empty-state__icon">⚠️</div>'
                + '<p class="empty-state__text">工具清单加载失败</p>'
                + '<p class="empty-state__hint">' + toolsEsc((d && d.msg) || '请检查网络后重试') + '</p>'
                + '</div>';
        }
        return;
    }
    _toolsState.tools = d.data.tools;
    var source = document.getElementById('toolsSource');
    if (source) {
        // ⭐ P2-14（2026-10-21 审查）：用户界面不再出现后端文件名（data/third_party_tools.json）
        source.textContent = '共 ' + d.data.tools.length + ' 个工具';
    }
    renderToolsGrid();
}

/** 面板初始化钩子（由 dashboard.menu.js 在切到「第三方工具」时调用） */
function initToolsPanel() {
    bindToolsEvents();
    return loadTools(false);
}

// ===== ES Module exports =====
export { initToolsPanel, loadTools };

// ===== 兼容层 =====
window.initToolsPanel = initToolsPanel;
window.loadTools = loadTools;
