/**
 * dashboard.menu.js
 * 侧边栏菜单与 Tab 切换 —— 动态页面重构后的版本
 *
 * ## 菜单来源
 *   - **4 个基础项写死在前端**（工作台/通知/个人文档/第三方工具）：对所有登录用户可见，
 *     且后端页面接口不可用时依然显示（保证侧边栏不会整条空白）；
 *   - **其余页面由后端驱动**：`GET /api/v0/user/pages` 只返回**元数据**（标题/图标/排序/分组），
 *     服务端已按权限过滤 —— 前端**不再做二次权限过滤**（历史教训：前端过滤会吃掉服务端已授权的项）。
 *
 * ## 懒加载
 *   1. 列表阶段只取标题（`/user/pages`）；
 *   2. 点击某个标签才取该页内容（`/user/pages/<tab_key>` → html/css/js），
 *      服务端对每个页面**逐页鉴权**（不存在 → 404；无权限 → 403）；
 *   3. html 用 innerHTML 注入 #dynamicContentContainer，css 注入 <style>，
 *      js 以 **Blob URL + <script src=blob:>** 执行（不使用 eval / new Function / 内联脚本）。
 *
 * ⚠️ 由此 CSP 必须放行 `script-src ... blob:`（见 dashboard.html 的 CSP meta）。
 * ⚠️ 页面脚本每次打开标签都会重新执行一次（与重构前行为一致）；html/css 按页面版本缓存。
 */
import { renderDeletionStatus } from './dashboard.deletion.js';

var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL || '';

// tab_key 白名单：只允许字母、数字、下划线、短横线（与服务端 utils/page_files.TAB_KEY_RE 一致）
var TAB_KEY_RE = /^[a-zA-Z0-9_-]+$/;

var PAGE_MISSING_HTML = '<div class="empty-state">'
    + '<div class="empty-state__icon">📄</div>'
    + '<p class="empty-state__text">页面不存在或未安装</p>'
    + '</div>';

// ===== 基础菜单（前端写死，不检查权限，后端不可用时也照常显示）=====
var PRIMARY_MENU = [
    { tab_key: 'workspace',     label: '工作台',     icon: '🏠' },
    { tab_key: 'notifications', label: '通知',       icon: '🔔' },
    { tab_key: 'docs',          label: '个人文档',   icon: '📚' },
    { tab_key: 'tools',         label: '第三方工具', icon: '🔧' },
];

// 构建版本号：便于在浏览器控制台一眼确认「当前跑的是哪一版」
//   window.__DASHBOARD_BUILD__
//   document.querySelector('script[src*="dashboard.menu.js"]').src
var BUILD_VERSION = '20260920b';
window.__DASHBOARD_BUILD__ = BUILD_VERSION;

var _menuData = null;
var _pageCache = Object.create(null);   // tabKey -> 页面内容对象（含 version）
var _pageScriptEl = null;               // 当前页面注入的 <script>
var _pageBlobUrl = null;                // 当前页面脚本的 Blob URL
var _pageLoadSeq = 0;                   // 并发保护：只有最后一次切换可以写 DOM
var _currentTab = null;
var _backendListFailed = false;

// ============================================================
// 网络
// ============================================================

function authHeaders(extra) {
    var headers = extra || {};
    var token = (AuthGuard && AuthGuard.getToken) ? (AuthGuard.getToken() || '') : '';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

/** 统一请求：返回 {code,msg,data}；401/422 交给 AuthGuard 处理 */
function fetchJSON(url) {
    return fetch(API_BASE_URL + url, { headers: authHeaders() })
        .then(function (res) {
            if (res.status === 401 || res.status === 422) {
                if (AuthGuard && AuthGuard.handleAuthError) AuthGuard.handleAuthError();
                return { code: 401, msg: '登录状态已失效' };
            }
            return res.json();
        })
        .catch(function (e) {
            console.error('[MENU] 请求失败:', url, e);
            return { code: 500, msg: '网络异常' };
        });
}

// ============================================================
// 菜单
// ============================================================

/**
 * 渲染侧边栏菜单：基础项（写死）+ 后端页面（已按权限过滤）。
 * 后端列表失败时**只提示、不清空**，基础项照常可用。
 */
async function loadMenu() {
    var backendItems = [];
    _backendListFailed = false;

    var res = await fetchJSON('/api/v0/user/pages');
    if (res && res.code === 200 && Array.isArray(res.data)) {
        backendItems = res.data;
    } else {
        _backendListFailed = true;
        console.warn('[MENU] 动态页面列表加载失败:', res && res.msg);
    }

    // 基础项优先：后端也定义了同名 tab_key 时不重复渲染（内容仍走同一个内容接口）
    var baseKeys = Object.create(null);
    PRIMARY_MENU.forEach(function (item) { baseKeys[item.tab_key] = true; });

    var dynamicItems = [];
    var adminItems = [];
    backendItems.forEach(function (item) {
        if (!item || typeof item.tab_key !== 'string' || !TAB_KEY_RE.test(item.tab_key)) return;
        if (baseKeys[item.tab_key]) return;
        (item.is_admin ? adminItems : dynamicItems).push(item);
    });

    _menuData = {
        code: res ? res.code : 500,
        msg: (res && res.msg) || '',
        data: {
            base_items: PRIMARY_MENU.slice(),
            dynamic_items: dynamicItems,
            admin_items: adminItems,
            user_info: (_menuData && _menuData.data && _menuData.data.user_info) || null,
            backend_list_failed: _backendListFailed,
        },
    };
    renderMenu(_menuData.data);
    return _menuData.data;
}

function renderMenu(data) {
    // 基础页面 + 后端页面共用 #dynamicMenuContainer。
    // ⚠️ 必须一次性写入（历史 bug：分两次 innerHTML 赋值会让基础项被整体覆盖）。
    var baseContainer = document.getElementById('dynamicMenuContainer');
    var baseDivider = document.getElementById('dynamicMenuDivider');
    var baseItems = asMenuItems(data.base_items);
    var dynamicItems = asMenuItems(data.dynamic_items);

    var hasNonAdmin = false;
    if (baseContainer) {
        baseContainer.innerHTML = menuItemsHtml(baseItems, '')
            + menuItemsHtml(dynamicItems, 'dynamic-only')
            + (data.backend_list_failed
                ? '<div class="sidebar__nav-notice">动态页面列表加载失败（仅显示基础页面）</div>'
                : '');
        baseContainer.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
        hasNonAdmin = (baseItems.length + dynamicItems.length) > 0;
    }

    // 管理页面分组
    var adminContainer = document.getElementById('adminMenuContainer');
    var adminItems = asMenuItems(data.admin_items);
    var hasAdmin = false;
    if (adminContainer) {
        if (adminItems.length > 0) {
            adminContainer.innerHTML = menuItemsHtml(adminItems, 'admin-only');
            adminContainer.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
            hasAdmin = true;
        } else {
            adminContainer.innerHTML = '';
        }
    }

    // 分隔线只在「两组都有内容」时显示
    if (baseDivider) baseDivider.style.display = (hasNonAdmin && hasAdmin) ? '' : 'none';
    var adminDivider = document.getElementById('adminMenuDivider');
    if (adminDivider) adminDivider.style.display = 'none';

    if (!hasNonAdmin && !hasAdmin) {
        renderMenuNotice('菜单渲染异常（未生成任何菜单项），请刷新页面重试');
    }

    return hasNonAdmin || hasAdmin;
}

/** 规范化后端返回的菜单数组（鉴权一律以服务端为准，这里不做任何权限过滤） */
function asMenuItems(items) {
    return Array.isArray(items) ? items : [];
}

/** 菜单整体异常时的可见提示（别让侧边栏静默空白） */
function renderMenuNotice(msg) {
    var container = document.getElementById('dynamicMenuContainer');
    var adminContainer = document.getElementById('adminMenuContainer');
    if (container) {
        container.innerHTML = '<div class="sidebar__nav-notice">' + escapeMenuText(msg) + '</div>';
    }
    if (adminContainer) adminContainer.innerHTML = '';
}

function escapeMenuText(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 生成一组菜单项的 HTML（元数据来自服务端，一律转义后再拼接） */
function menuItemsHtml(items, extraClass) {
    if (!items || items.length === 0) return '';
    var cls = extraClass ? 'sidebar__nav-item ' + extraClass : 'sidebar__nav-item';
    return items.map(function (item) {
        return '<a href="#" class="' + cls + '" data-tab="' + escapeMenuText(item.tab_key) + '">'
            + '<span class="sidebar__nav-icon">' + escapeMenuText(item.icon || '📄') + '</span>'
            + '<span class="sidebar__nav-text">' + escapeMenuText(item.label) + '</span>'
            + '</a>';
    }).join('');
}

function bindTabClick(item) {
    item.addEventListener('click', function (e) {
        e.preventDefault();
        var tabKey = item.dataset.tab;
        if (tabKey) switchTab(tabKey, { reset: true });
    });
}

// ============================================================
// Tab 切换
// ============================================================

async function switchTab(tabKey, opts) {
    opts = opts || {};
    _currentTab = tabKey;

    if (window.DashUrl) {
        if (opts.reset) window.DashUrl.write({ tab: tabKey, folder: null, doc: null, mode: null });
        else window.DashUrl.write({ tab: tabKey });
    }

    await renderTab(tabKey, !!opts.force);
}

/**
 * 重新加载当前 tab（不改变 URL 参数、不重置 folder/doc/mode）。
 * 权限等级切换后调用：让页面内容按新等级重新取一次并重新执行脚本。
 */
async function reloadCurrentTab() {
    if (!_currentTab) return;
    await renderTab(_currentTab, true);
}

/** 把指定 tab 渲染出来（切换与重载共用同一条路径，避免两处逻辑漂移） */
async function renderTab(tabKey, force) {
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.style.display = 'none'; });

    var dynamicContainer = document.getElementById('dynamicContentContainer');
    if (dynamicContainer) dynamicContainer.innerHTML = '';

    document.querySelectorAll('.sidebar__nav-item').forEach(function (item) {
        item.classList.toggle('active', item.dataset.tab === tabKey);
    });

    // 面板内静态页（个人主页 / 设置）
    var panel = document.getElementById('panel-' + tabKey);
    if (panel) {
        // 作废仍在飞行中的页面请求：否则慢响应回来会把内容写进已清空的容器，
        // 覆盖在静态面板下面（表现为「切到设置页却看到上一个 Tab 的残留内容」）。
        _pageLoadSeq++;
        releasePageScript();
        panel.style.display = '';
        if (tabKey === 'settings') renderDeletionStatus();
        return;
    }

    await loadAndInjectPage(tabKey, force);
}

// ============================================================
// 页面内容：取回 → 注入 → 执行
// ============================================================

/** 取页面内容（带内存缓存；force=true 时强制重新拉取） */
async function fetchPageContent(tabKey, force) {
    if (!force && _pageCache[tabKey]) return _pageCache[tabKey];
    var res = await fetchJSON('/api/v0/user/pages/' + encodeURIComponent(tabKey));
    if (res && res.code === 200 && res.data) {
        _pageCache[tabKey] = res.data;
        return res.data;
    }
    return { __error: true, code: (res && res.code) || 500, msg: (res && res.msg) || '页面加载失败' };
}

function pageErrorHtml(page) {
    var code = page && page.code;
    var title = code === 403 ? '权限不足' : (code === 404 ? '页面不存在或未安装' : '页面加载失败');
    var detail = (page && page.msg) ? page.msg : '';
    return '<div class="empty-state">'
        + '<div class="empty-state__icon">' + (code === 403 ? '🔒' : '📄') + '</div>'
        + '<p class="empty-state__text">' + escapeMenuText(title) + '</p>'
        + (detail ? '<p class="empty-state__hint">' + escapeMenuText(detail) + '</p>' : '')
        + '</div>';
}

/** 注入页面样式（同名 style 标签只保留一份） */
function ensurePageStyles(tabKey, css) {
    var id = 'dynamicPageStyle-' + tabKey;
    var el = document.getElementById(id);
    if (!css) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        return;
    }
    if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
}

function releasePageScript() {
    if (_pageScriptEl && _pageScriptEl.parentNode) {
        _pageScriptEl.parentNode.removeChild(_pageScriptEl);
    }
    _pageScriptEl = null;
    if (_pageBlobUrl) {
        try { URL.revokeObjectURL(_pageBlobUrl); } catch (e) { /* 忽略 */ }
        _pageBlobUrl = null;
    }
}

/**
 * 执行页面脚本：把后端下发的 JS 包成 Blob，用真实 <script src=blob:> 加载。
 * 不使用 eval / new Function / 内联 <script>（CSP 已禁），也不把 token 放进 URL。
 */
function runPageScript(tabKey, js) {
    releasePageScript();
    if (!js || !String(js).trim()) return Promise.resolve(true);

    var url;
    try {
        url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    } catch (e) {
        console.error('[MENU] 页面脚本 Blob 创建失败:', tabKey, e);
        return Promise.resolve(false);
    }
    _pageBlobUrl = url;

    return new Promise(function (resolve) {
        var script = document.createElement('script');
        script.id = 'dynamicPageScript';
        script.src = url;
        script.onload = function () {
            // 脚本已执行完，Blob URL 可以立即释放
            if (_pageBlobUrl === url) {
                try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
                _pageBlobUrl = null;
            }
            resolve(true);
        };
        script.onerror = function () {
            console.warn('[MENU] 页面脚本执行失败（可能被 CSP 拦截）:', tabKey);
            resolve(false);
        };
        _pageScriptEl = script;
        document.head.appendChild(script);
    });
}

async function loadAndInjectPage(tabKey, force) {
    var container = document.getElementById('dynamicContentContainer');
    if (!container) return;

    var seq = ++_pageLoadSeq;
    container.innerHTML = '<p class="loading-text">加载中...</p>';

    if (typeof tabKey !== 'string' || !TAB_KEY_RE.test(tabKey)) {
        console.error('[MENU] 非法 tabKey:', tabKey);
        container.innerHTML = PAGE_MISSING_HTML;
        return;
    }

    var page = await fetchPageContent(tabKey, force);
    if (seq !== _pageLoadSeq) return;      // 期间已切换到其它 tab

    if (page.__error) {
        container.innerHTML = pageErrorHtml(page);
        return;
    }

    container.innerHTML = page.html || PAGE_MISSING_HTML;
    ensurePageStyles(tabKey, page.css || '');

    await runPageScript(tabKey, page.js || '');
    if (seq !== _pageLoadSeq) return;

    document.dispatchEvent(new CustomEvent('dashboard:tab-switched', {
        detail: { tabKey: tabKey, page: page },
    }));
}

function getCurrentMenuData() {
    return _menuData ? _menuData.data : null;
}

/** 清空页面缓存（例如管理端刚同步过页面后调用） */
function clearPageCache() {
    _pageCache = Object.create(null);
}

// ===== ES Module exports =====
const DashboardMenu = {
    loadMenu, renderMenu, switchTab, reloadCurrentTab,
    getCurrentMenuData, clearPageCache, BUILD_VERSION,
};
export default DashboardMenu;
export {
    loadMenu, renderMenu, switchTab, reloadCurrentTab,
    getCurrentMenuData, clearPageCache, DashboardMenu,
};

// ===== 兼容层 =====
window.DashboardMenu = DashboardMenu;
