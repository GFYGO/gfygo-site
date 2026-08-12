/**
 * dashboard.js
 * 精简入口：全局初始化、用户信息、侧边栏、退出
 * Phase 2: ES Module — 共享资源通过 window 访问
 */
import { initAuthModules, sendVerificationEmail } from './dashboard.auth.js';
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
    // 初始化基础模块
    Toast.init();
    ThemeEngine.init();
    ThemeEngine.bindSwitchEvent();

    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    // 1. 渲染用户信息 + 加载菜单
    await renderUserInfo(token);

    // 2. 加载并渲染菜单
    await DashboardMenu.loadMenu();

    // 3. 初始化侧边栏
    initSidebar();

    // 4. 根据权限节点自动显隐元素
    initPermissionVisibility();

    // 5. 绑定事件
    bindGlobalEvents();

    // 6. 切换到默认 Tab (workspace)
    DashboardMenu.switchTab('workspace');

    // 初始化设置按钮
    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
        on(settingsBtn, 'click', function() {
            DashboardMenu.switchTab('settings');
        });
    }

    // 初始化注销相关
    initDeletion();
    renderDeletionStatus();

    // 初始化个人文档全局引用
    if (typeof window.initPersonalDocs !== 'function') {
        window.initPersonalDocs = function() { loadPersonalDocs(); };
    }

    // 初始化打卡模块全局引用
    if (typeof window.initCheckinModule !== 'function') {
        window.initCheckinModule = function() { initCheckinButtons(); };
    }

    // 绑定验证码按钮
    const verifyEmailBtnEl = $('verifyEmailBtn');
    if (verifyEmailBtnEl) {
        on(verifyEmailBtnEl, 'click', function() { sendVerificationEmail(); });
    }
});

/** 绑定全局事件 */
function bindGlobalEvents() {
    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
        on(logoutBtn, 'click', function() {
            AuthGuard.clearToken();
            showToast('已退出登录', 'success');
            setTimeout(function() {
                window.location.replace((BASE_PATH || './') + '/login.html?_t=' + Date.now());
            }, 800);
        });
    }

    const toggleBtn = $('sidebarToggleBtn');
    if (toggleBtn) {
        on(toggleBtn, 'click', function() {
            const sidebar = $('dashboardSidebar');
            const overlay = $('sidebarOverlay');
            if (sidebar) sidebar.classList.toggle('dashboard-sidebar--open');
            if (overlay) overlay.classList.toggle('sidebar-overlay--visible');
        });
    }

    const userTrigger = $('sidebarUserTrigger');
    if (userTrigger) {
        on(userTrigger, 'click', function() {
            DashboardMenu.switchTab('home');
        });
    }
}

/** 侧边栏初始化 */
function initSidebar() {
    const overlay = $('sidebarOverlay');
    if (overlay) {
        on(overlay, 'click', function() {
            const sidebar = $('dashboardSidebar');
            if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
            overlay.classList.remove('sidebar-overlay--visible');
        });
    }
}

// ===== ES Module exports =====
export { renderUserInfo, initSidebar, bindGlobalEvents };
window.renderUserInfo = renderUserInfo;
