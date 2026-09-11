/**
 * dashboard.menu.js
 * 动态菜单与 Tab 切换
 * Phase 2: ES Module — 共享资源通过 window 访问
 *
 * 安全约定：动态页面一律来自同源静态文件 ./pages/<tabKey>.{html,js,css}。
 * 不再从后端 / 数据库注入 html_content / js_content（历史上是存储型 XSS / RCE 通道），
 * 也不再用 eval / new Function / 动态重建内联 <script>。
 */
import { renderDeletionStatus } from './dashboard.deletion.js';

var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL;
var $ = window.$;

// tab_key 白名单：只允许字母、数字、下划线、短横线，杜绝路径遍历
var TAB_KEY_RE = /^[a-zA-Z0-9_-]+$/;
var PAGE_MISSING_HTML = '<div class="empty-state">'
    + '<div class="empty-state__icon">📄</div>'
    + '<p class="empty-state__text">页面不存在或未安装</p>'
    + '</div>';

// 静态页面资源的缓存版本号：与各 HTML 里的 ?v= 保持一致，
// 否则 GitHub Pages CDN（默认 max-age≈600s）会让改动延迟生效。
var PAGE_ASSET_VERSION = '20260911c';
var PAGE_ASSET_QS = '?v=' + PAGE_ASSET_VERSION;
// 便于在浏览器控制台一眼确认「当前跑的是哪一版」：
//   window.__DASHBOARD_BUILD__        → 例如 "20260911c"
//   document.querySelector('script[src*="dashboard.menu.js"]').src
window.__DASHBOARD_BUILD__ = PAGE_ASSET_VERSION;

let _menuData = null;
let _pageScriptEl = null;   // 当前动态页面注入的 <script>，切换时先移除
let _pageLoadSeq = 0;       // 并发保护：只允许最后一次切换写入 DOM

async function loadMenu() {
    try {
        const token = AuthGuard.getToken();
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(`${API_BASE_URL}/api/v0/user/menu`, { headers });
        if(res.status === 401 || res.status === 422){
            AuthGuard.handleAuthError();
            return;
        }
        if (!res.ok) {
            console.error('[MENU] 加载菜单失败: HTTP', res.status);
            renderMenuNotice('菜单加载失败（HTTP ' + res.status + '），请刷新页面重试');
            return null;
        }
        _menuData = await res.json();
        if (_menuData.code === 200) {
            renderMenu(_menuData.data);
        } else {
            console.error('[MENU] 菜单接口返回异常:', _menuData);
            renderMenuNotice('菜单加载失败：' + (_menuData.msg || ('code ' + _menuData.code)));
        }
        return _menuData.data;
    } catch (e) {
        console.error('[MENU] 加载菜单失败:', e);
        renderMenuNotice('菜单加载失败，请刷新页面重试');
        return null;
    }
}

function renderMenu(data) {
    // 基础页面 + 动态页面共用同一个挂载点 #dynamicMenuContainer（见 dashboard.html 注释）。
    // ⚠️ 必须一次性写入：以前分两次调用 renderMenuItems 渲染，
    // 第二次的 innerHTML 赋值会把基础项整体覆盖掉，导致侧边栏只剩动态项
    // （症状：工作台/通知/个人文档/第三方工具整组消失）。这里改为拼好再一次性写入。
    const baseContainer = document.getElementById('dynamicMenuContainer');
    const baseDivider = document.getElementById('dynamicMenuDivider');
    const baseItems = asMenuItems(data.base_items);
    const dynamicItems = asMenuItems(data.dynamic_items);

    let hasNonAdmin = false;
    if (baseContainer) {
        baseContainer.innerHTML = menuItemsHtml(baseItems, '')
            + menuItemsHtml(dynamicItems, 'dynamic-only');
        baseContainer.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
        hasNonAdmin = (baseItems.length + dynamicItems.length) > 0;
    }

    // 渲染管理员菜单
    const adminContainer = document.getElementById('adminMenuContainer');
    const adminDivider = document.getElementById('adminMenuDivider');
    const adminItems = asMenuItems(data.admin_items);
    let hasAdmin = false;
    if (adminContainer) {
        if (adminItems.length > 0) {
            adminContainer.innerHTML = menuItemsHtml(adminItems, 'admin-only');
            adminContainer.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
            hasAdmin = true;
        } else {
            adminContainer.innerHTML = '';
        }
    }

    // 分隔线只在「非管理员组」和「管理员组」都有内容时显示
    if (baseDivider) baseDivider.style.display = (hasNonAdmin && hasAdmin) ? '' : 'none';
    if (adminDivider) adminDivider.style.display = 'none';

    // 一组都没有 → 明确提示，避免侧边栏静默空白（历史上这个「静默」让排查绕了远路）
    if (!hasNonAdmin && !hasAdmin) {
        renderMenuNotice('暂无可用菜单项（请检查 menu_items 配置）');
    }

    return hasNonAdmin || hasAdmin;
}

/**
 * 规范化后端返回的菜单数组。
 *
 * ⚠️ 这里**不再做 permission_node 前端二次过滤**：
 *   后端 UserService.get_menu_list() 已经按「权限节点 / 等级 / is_admin + permission_level」判定过可见性，
 *   前端再按 token 里的 nodes 过滤是重复且危险的 —— 一旦 token 的节点快照与菜单项的
 *   permission_node 对不上（自定义菜单项、节点表漂移、旧 token），
 *   管理员菜单会在界面上「凭空消失」，而服务端其实已经授权。鉴权始终以服务端为准。
 */
function asMenuItems(items) {
    return Array.isArray(items) ? items : [];
}

/** 菜单加载失败/为空时的可见提示（别让侧边栏静默空白，否则只能靠控制台排查） */
function renderMenuNotice(msg) {
    const container = document.getElementById('dynamicMenuContainer');
    const adminContainer = document.getElementById('adminMenuContainer');
    if (container) {
        container.innerHTML = '<div style="padding:12px;font-size:13px;'
            + 'color:var(--color-text-muted);line-height:1.5;">'
            + escapeMenuText(msg) + '</div>';
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

/** 生成一组菜单项的 HTML（菜单元数据来自后端 menu_items 表，一律转义后再拼接） */
function menuItemsHtml(items, extraClass) {
    if (!items || items.length === 0) return '';
    const cls = extraClass ? `sidebar__nav-item ${extraClass}` : 'sidebar__nav-item';
    return items.map(item => `
        <a href="#" class="${cls}" data-tab="${escapeMenuText(item.tab_key)}">
            <span class="sidebar__nav-icon">${escapeMenuText(item.icon || '📄')}</span>
            <span class="sidebar__nav-text">${escapeMenuText(item.label)}</span>
        </a>
    `).join('');
}

function renderMenuItems(container, items, extraClass, divider, showDivider) {
    if (!container || !items || items.length === 0) return showDivider || false;
    container.innerHTML = menuItemsHtml(items, extraClass);
    container.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
    if (divider && showDivider !== undefined) divider.style.display = showDivider ? '' : 'none';
    return true;
}

function bindTabClick(item) {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabKey = item.dataset.tab;
        if (tabKey) switchTab(tabKey, { reset: true });
    });
}

async function switchTab(tabKey, opts) {
    opts = opts || {};
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

    // URL 状态同步：用户点击时重置 folder/doc/mode（回到 tab 根），URL 恢复时保留
    if (window.DashUrl) {
        if (opts.reset) window.DashUrl.write({ tab: tabKey, folder: null, doc: null, mode: null });
        else window.DashUrl.write({ tab: tabKey });
    }

    const dynamicContainer = document.getElementById('dynamicContentContainer');
    if (dynamicContainer) dynamicContainer.innerHTML = '';

    document.querySelectorAll('.sidebar__nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabKey);
    });

    const panel = document.getElementById(`panel-${tabKey}`);
    if (panel) {
        panel.style.display = '';
        if (tabKey === 'settings') {
            renderDeletionStatus();
        }
        return;
    }

    await loadAndInjectPage(tabKey);
}

/**
 * 确保页面样式表只加载一次。
 * 先 HEAD 探测文件是否存在；探测失败时也尝试加载（404 的 <link> 无害）。
 */
function ensurePageStylesheet(tabKey) {
    const id = 'dynamicPageStyle-' + tabKey;
    if (document.getElementById(id)) return;
    const href = './pages/' + tabKey + '.css' + PAGE_ASSET_QS;
    fetch(href, { method: 'HEAD' })
        .then(res => { if (res && res.ok) appendPageStylesheet(id, href); })
        .catch(() => { appendPageStylesheet(id, href); });
}

function appendPageStylesheet(id, href) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

/**
 * 探测静态资源是否存在。
 * 探测本身失败（网络异常/opaque 响应）时按「存在」处理，交给 <script>/<link> 自己报错。
 */
function pageAssetExists(url) {
    return fetch(url, { method: 'HEAD' })
        .then(res => !!(res && res.ok))
        .catch(() => true);
}

/**
 * 注入页面脚本：先 HEAD 探测（没有 .js 的页面就不打一个 404 到控制台），
 * 再以真实 <script src> 加载并等待 load / error —— 这样每次打开 tab 都会重新执行一次
 * （与旧行为一致）。不使用 eval / new Function / 动态重建内联 <script>。
 */
async function loadPageScript(tabKey) {
    const url = './pages/' + tabKey + '.js' + PAGE_ASSET_QS;

    if (_pageScriptEl && _pageScriptEl.parentNode) {
        _pageScriptEl.parentNode.removeChild(_pageScriptEl);
    }
    _pageScriptEl = null;

    if (!(await pageAssetExists(url))) {
        console.warn('[MENU] 页面无脚本文件（正常，可能是纯展示页）:', tabKey);
        return false;
    }

    return new Promise(resolve => {
        const script = document.createElement('script');
        script.id = 'dynamicPageScript';
        script.src = url;
        script.onload = () => resolve(true);
        script.onerror = () => {
            console.warn('[MENU] 页面脚本加载失败:', tabKey);
            resolve(false);
        };
        _pageScriptEl = script;
        document.head.appendChild(script);
    });
}

async function loadAndInjectPage(tabKey) {
    const dynamicContainer = document.getElementById('dynamicContentContainer');
    if (!dynamicContainer) return;

    const seq = ++_pageLoadSeq;
    dynamicContainer.innerHTML = '<p class="loading-text">加载中...</p>';

    // 只允许白名单内的 tabKey 参与 URL 拼接，杜绝路径遍历
    if (typeof tabKey !== 'string' || !TAB_KEY_RE.test(tabKey)) {
        console.error('[MENU] 非法 tabKey:', tabKey);
        if (seq === _pageLoadSeq) dynamicContainer.innerHTML = PAGE_MISSING_HTML;
        return;
    }

    ensurePageStylesheet(tabKey);

    try {
        const res = await fetch('./pages/' + tabKey + '.html' + PAGE_ASSET_QS);
        if (seq !== _pageLoadSeq) return;   // 期间已切换到其它 tab
        if (!res.ok) {
            dynamicContainer.innerHTML = PAGE_MISSING_HTML;
            return;
        }
        const html = await res.text();
        if (seq !== _pageLoadSeq) return;

        // 同源静态仓库文件，标记可信，直接注入（页面依赖自身结构，不做净化）
        dynamicContainer.innerHTML = html;

        await loadPageScript(tabKey);
        if (seq !== _pageLoadSeq) return;

        document.dispatchEvent(new CustomEvent('dashboard:tab-switched', { detail: { tabKey } }));
    } catch (e) {
        console.error('[MENU] 加载页面失败:', e);
        if (seq === _pageLoadSeq) dynamicContainer.innerHTML = PAGE_MISSING_HTML;
    }
}

function getCurrentMenuData() {
    return _menuData ? _menuData.data : null;
}

// ===== ES Module exports =====
const DashboardMenu = { loadMenu, renderMenu, switchTab, getCurrentMenuData };
export default DashboardMenu;
export { loadMenu, renderMenu, switchTab, getCurrentMenuData, DashboardMenu };

// ===== 兼容层 =====
window.DashboardMenu = DashboardMenu;