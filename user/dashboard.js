/**
 * dashboard.js
 * 精简入口：全局初始化、用户信息、侧边栏、退出
 * Phase 2: ES Module — 共享资源通过 window 访问
 */
import { initAuthModules, sendVerificationEmail, initSidebarToggle, initSettingsButton } from './dashboard.auth.js';
import DashboardMenu from './dashboard.menu.js';
import { initCheckinButtons } from './dashboard.checkin.js';
import { initDeletion, renderDeletionStatus } from './dashboard.deletion.js';
import { loadPersonalDocs } from './dashboard.pdocs.js';

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

    // 7. 切换到默认 Tab (workspace)
    DashboardMenu.switchTab('workspace');

    // 初始化注销相关
    initDeletion();
    renderDeletionStatus();

    // 初始化个人文档全局引用 & 设置 currentUserId
    if (menuData && menuData.user_info) {
        const ui = menuData.user_info;
        const userObj = ui.id || ui.user_id || (window.getUserId ? window.getUserId() : null) || null;
        if (userObj) {
            try {
                const { initPersonalDocs, PDocsState: pds } = await import('./dashboard.pdocs.js');
                if (pds) pds.currentUserId = userObj;
                if (initPersonalDocs) initPersonalDocs();
            } catch(e) {
                console.warn('[pdocs] 加载个人文档模块失败:', e);
                if (window.PDocsState) window.PDocsState.currentUserId = userObj;
                if (typeof window.initPersonalDocs === 'function') {
                    window.initPersonalDocs();
                }
            }
        }
    }
    if (typeof window.initPersonalDocs !== 'function') {
        window.initPersonalDocs = function() { loadPersonalDocs(); };
    }

    // 初始化打卡模块全局引用
    if (typeof window.initCheckinModule !== 'function') {
        window.initCheckinModule = function() { initCheckinButtons(); };
    }
});

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
export { renderUserInfo, bindGlobalEvents };
window.renderUserInfo = renderUserInfo;
