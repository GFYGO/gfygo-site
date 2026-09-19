/**
 * dashboard.js
 * 精简入口：全局初始化、用户信息、侧边栏、退出
 * Phase 2: ES Module — 共享资源通过 window 访问
 */
import { initAuthModules, sendVerificationEmail, initSidebarToggle, initSettingsButton } from './dashboard.auth.js';
import DashboardMenu from './dashboard.menu.js';
import { initCheckinButtons } from './dashboard.checkin.js';
import { initDeletion, renderDeletionStatus } from './dashboard.deletion.js';
import { PDocsState } from './dashboard.pdocs.js';

// ===== 从 window 获取共享资源（config.js / toast.js / theme.js / utils.js 以普通 <script> 加载）=====
var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL;
var BASE_PATH = window.BASE_PATH;
var initPermissionVisibility = window.initPermissionVisibility;
var $ = window.$;
var on = window.on;
var showToast = window.showToast;
var Toast = window.Toast;
var ThemeEngine = window.ThemeEngine;
var Modal = window.Modal;

/** 获取并渲染用户信息（从 /api/v0/user/menu 获取 user_info） */
async function renderUserInfo(token) {
    try {
        const res = await fetch(API_BASE_URL + '/api/v0/user/menu', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (res.ok && data.code === 200) {
            const userInfo = data.data.user_info || data.data;
            initAuthModules(token, userInfo);
            return data.data;
        } else {
            console.warn('加载用户信息失败:', data.msg);
            return null;
        }
    } catch (e) {
        console.error('获取用户信息异常:', e);
        return null;
    }
}

// DOMContentLoaded 后初始化
document.addEventListener('DOMContentLoaded', async function() {
    Toast.init();
    ThemeEngine.init();
    ThemeEngine.bindSwitchEvent();
    bindThemeOptButtons();

    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    // 1. 渲染用户信息 + 加载菜单
    const menuData = await renderUserInfo(token);

    // 1a. 把 user id 写进个人文档状态**再**切 Tab。
    //     `#panel-docs` 是静态面板，切到它时的钩子会立刻拉文件夹（loadPersonalFolders
    //     需要 currentUserId）—— 晚写会让 ?tab=docs 的首屏跳过文件夹加载（历史坑：
    //     该状态原本在 switchTab 之后才赋值，靠「先请求页面内容」的延迟蒙对时序）。
    primePersonalDocsUserId(menuData);

    // 1b. 注册「个人主页」面板的初始化钩子。
    //     必须在 switchTab() 之前注册 —— dashboard.menu.js 在渲染 home 面板时会回调它，
    //     晚注册会让首屏停在「未初始化」的打卡日历上（历史 bug：该函数从来没被调用过）。
    registerHomePanelHooks();

    // 2. 加载并渲染菜单
    await DashboardMenu.loadMenu();

    // 3. 统一初始化侧边栏（含 toggle、overlay、userTrigger）
    initSidebarToggle();

    // 4. 初始化设置按钮（含侧边栏关闭）
    initSettingsButton();

    // 5. 根据权限节点自动显隐元素
    initPermissionVisibility();

    // 6. 绑定退出/验证码等全局事件
    bindGlobalEvents();

    // 6b. 个人文档的深链接恢复（?tab=docs&folder=..&doc=..）。
    //     ⚠️ 必须**在第一次 switchTab 之前**注册：`docs` 是静态面板，它的
    //     'dashboard:tab-switched' 是在 switchTab 的**同步阶段**派发的（不像动态页要等网络），
    //     晚注册会漏掉首屏那一次 → 直接打开文档链接只会停在列表页。
    bindDocsUrlRestore();

    // 7. 切换到默认 Tab（若 URL 带 ?tab= 则优先恢复该页）
    const urlState = window.DashUrl ? window.DashUrl.read() : null;
    const initialTab = (urlState && urlState.tab) || 'workspace';
    DashboardMenu.switchTab(initialTab, { reset: false });

    // 初始化注销相关
    initDeletion();
    renderDeletionStatus();

    // 初始化打卡模块全局引用
    if (typeof window.initCheckinModule !== 'function') {
        window.initCheckinModule = function() { initCheckinButtons(); };
    }
});

/**
 * 注册「个人文档深链接恢复」监听器。
 *
 * 个人文档面板的**加载**由 `dashboard.menu.js::STATIC_PANEL_HOOKS` 驱动；
 * 这里只负责把 URL 里的 `folder` / `doc` / `mode` 还原成视图
 * （面板常驻 DOM，不再像后端下发时代那样每次注入新 HTML 后重新解析）。
 */
function bindDocsUrlRestore() {
    document.addEventListener('dashboard:tab-switched', function onTabSwitched(e) {
        if (!e.detail || e.detail.tabKey !== 'docs') return;
        const st = window.DashUrl ? window.DashUrl.read() : null;
        const actions = window.PDocsActions;
        if (!st || !actions) return;
        if (st.doc) {
            // 先定位文件夹（返回列表时停留在原文件夹），再打开文档
            if (st.folder) actions.navigateToFolder(st.folder);
            if (st.mode === 'editor') actions.openPdocsEditor(st.doc);
            else actions.openPdocsBrowser(st.doc);
        } else if (st.folder) {
            actions.navigateToFolder(st.folder);
        }
    });
}

/**
 * 注册静态面板的初始化钩子（幂等）。
 *
 * `dashboard.menu.js::renderTab()` 在显示 `#panel-<tab>` 时会调用 `window.initCheckinModule()`，
 * 用它驱动「个人主页」里的打卡日历。**必须在第一次 switchTab 之前调用**，否则首屏的
 * home 面板拿不到钩子；之后重复调用是安全的（`initCheckinCalendar` 内部有防重入）。
 */
function registerHomePanelHooks() {
    if (typeof window.initCheckinModule !== 'function') {
        window.initCheckinModule = function() { initCheckinButtons(); };
    }
}

/**
 * 把当前用户 id 写进个人文档状态（`PDocsState.currentUserId`）。
 *
 * ⚠️ 必须在**第一次 switchTab 之前**调用：`#panel-docs` 现在是写死在 dashboard.html 里的
 * 静态面板，切到它的钩子（`initPersonalDocsPanel`）会立刻拉文件夹，而
 * `loadPersonalFolders()` 在 `currentUserId` 为空时**直接跳过**（只打一条 console.warn）。
 * 旧实现把这一步放在 switchTab 之后，靠「切 Tab 要先请求页面内容」的网络延迟蒙对时序。
 */
function primePersonalDocsUserId(menuData) {
    const ui = menuData && menuData.user_info;
    if (!ui) return;
    const userObj = ui.id || ui.user_id || (window.getUserId ? window.getUserId() : null) || null;
    if (userObj && PDocsState) PDocsState.currentUserId = userObj;
}

/** 绑定设置面板中的主题选择按钮 */
function bindThemeOptButtons() {
    const buttons = document.querySelectorAll('.theme-opt');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            if (theme && ThemeEngine) {
                ThemeEngine.applyTheme(theme);
                const token = AuthGuard.getToken();
                if (token) {
                    ThemeEngine.syncThemeToServer(theme, token);
                }
            }
        });
    });
}

/** 绑定全局事件（退出按钮已由 renderTopNavAuth 处理，userTrigger 已由 initSidebarToggle 处理） */
function bindGlobalEvents() {
    const verifyEmailBtnEl = $('verifyEmailBtn');
    if (verifyEmailBtnEl) {
        on(verifyEmailBtnEl, 'click', function() { sendVerificationEmail(); });
    }
}

// ===== ES Module exports =====
export { renderUserInfo, bindGlobalEvents, registerHomePanelHooks, primePersonalDocsUserId, bindDocsUrlRestore };
window.renderUserInfo = renderUserInfo;
