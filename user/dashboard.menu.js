/**
 * dashboard.menu.js
 * 侧边栏菜单与 Tab 切换
 * Phase 2: ES Module — 共享资源通过 window 访问
 *
 * 【菜单来源：前端写死，不再依赖后端 /user/menu 的菜单数据】
 *   - 4 个基础项（工作台/通知/个人文档/第三方工具）：对所有登录用户可见，**不做任何权限检查**；
 *   - 5 个管理项：仅当当前身份具备管理能力（token 里有 admin.* 节点，或等级 ≥ 2）时显示。
 *   服务端 `/api/v0/user/menu` 仍会被 dashboard.js 调用（用于 user_info / 权限按钮），
 *   但**菜单渲染与它无关** —— DB 里的 menu_items 为空、接口异常都不会再让侧边栏空掉。
 *
 * 安全约定：页面一律来自同源静态文件 ./pages/<tabKey>.{html,js,css}。
 * 不再从后端 / 数据库注入 html_content / js_content（历史上是存储型 XSS / RCE 通道），
 * 也不再用 eval / new Function / 动态重建内联 <script>。
 */
import { renderDeletionStatus } from './dashboard.deletion.js';

var AuthGuard = window.AuthGuard;
var $ = window.$;

// tab_key 白名单：只允许字母、数字、下划线、短横线，杜绝路径遍历
var TAB_KEY_RE = /^[a-zA-Z0-9_-]+$/;
var PAGE_MISSING_HTML = '<div class="empty-state">'
    + '<div class="empty-state__icon">📄</div>'
    + '<p class="empty-state__text">页面不存在或未安装</p>'
    + '</div>';

// ===== 侧边栏菜单定义（前端写死）=====
// 基础项：所有登录用户均可见，不检查权限
var PRIMARY_MENU = [
    { tab_key: 'workspace',     label: '工作台',     icon: '🏠' },
    { tab_key: 'notifications', label: '通知',       icon: '🔔' },
    { tab_key: 'docs',          label: '个人文档',   icon: '📚' },
    { tab_key: 'tools',         label: '第三方工具', icon: '🔧' },
];
// 管理项：仅对具备管理能力的身份显示（切换视角到 Lv1 不影响，见 isAdminUser 注释）
var ADMIN_MENU = [
    { tab_key: 'admin-stats',         label: '仪表盘',     icon: '📊', permission_node: 'admin.stats.view' },
    { tab_key: 'admin-notifications', label: '通知管理',   icon: '📢', permission_node: 'admin.notify.view' },
    { tab_key: 'admin-invite-codes',  label: '邀请码管理', icon: '🎫', permission_node: 'admin.invite.view' },
    { tab_key: 'admin-permissions',   label: '权限设置',   icon: '🔐', permission_node: 'admin.permission.view' },
    { tab_key: 'admin-menu',          label: '页面设置',   icon: '⚙️', permission_node: 'admin.menu.view' },
];

// 静态页面资源的缓存版本号：与各 HTML 里的 ?v= 保持一致，
// 否则 GitHub Pages CDN（默认 max-age≈600s）会让改动延迟生效。
var PAGE_ASSET_VERSION = '20260911d';
var PAGE_ASSET_QS = '?v=' + PAGE_ASSET_VERSION;
// 便于在浏览器控制台一眼确认「当前跑的是哪一版」：
//   window.__DASHBOARD_BUILD__        → 例如 "20260911c"
//   document.querySelector('script[src*="dashboard.menu.js"]').src
window.__DASHBOARD_BUILD__ = PAGE_ASSET_VERSION;

let _menuData = null;
let _pageScriptEl = null;   // 当前动态页面注入的 <script>，切换时先移除
let _pageLoadSeq = 0;       // 并发保护：只允许最后一次切换写入 DOM

/**
 * 当前身份是否具备管理能力。
 * 判定依据（只看 token 里的 now_permission，纯前端显隐；真正的鉴权在服务端）：
 *   1. 节点里存在任意 admin.* 节点（最可靠：后端签发 token 时写入）；
 *   2. 或等级 >= 2。
 * 注意：超管的 nodes 恒为全量（见 utils/permission.compute_effective_nodes），
 * 所以「切换视角到 Lv1」不会把管理菜单切没，用户仍能切回去。
 */
function isAdminUser() {
    const np = window.__nowPermission || {};
    const nodes = Array.isArray(np.nodes) ? np.nodes : [];
    if (nodes.some(function (n) { return typeof n === 'string' && n.indexOf('admin.') === 0; })) return true;
    const lv = Number(np.level);
    return Number.isFinite(lv) && lv >= 2;
}

/**
 * 渲染侧边栏菜单。
 * **不再请求后端菜单数据**：基础项写死在前端（所有登录用户可见、不校验权限），
 * 管理项按 isAdminUser() 显隐。后端 /user/menu 的服务端过滤/DB menu_items 状态
 * 都不再影响侧边栏能否显示（历史上 DB menu_items 为空会让整条侧边栏空白）。
 */
async function loadMenu() {
    const baseItems = PRIMARY_MENU.slice();
    const adminItems = isAdminUser() ? ADMIN_MENU.slice() : [];

    _menuData = {
        code: 200,
        msg: 'ok',
        data: {
            base_items: baseItems,
            dynamic_items: [],          // 后端动态页机制已废弃，侧边栏不再展示
            admin_items: adminItems,
            user_info: (_menuData && _menuData.data && _menuData.data.user_info) || null,
        },
    };
    renderMenu(_menuData.data);
    return _menuData.data;
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

    // 兜底：正常不会触发（基础项写死在前端），留作渲染异常时的可见提示
    if (!hasNonAdmin && !hasAdmin) {
        renderMenuNotice('菜单渲染异常（未生成任何菜单项），请刷新页面重试');
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