/**
 * dashboard.js
 * 精简入口：全局初始化、用户信息、侧边栏、退出
 *
 * 注意：API_BASE_URL 已由 config.js 定义，此处不重复声明。
 */

/** 获取并渲染用户信息（从 /api/v1/user/menu 获取 user_info） */
async function renderUserInfo(token) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/user/menu`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok && data.code === 200) {
            const userInfo = data.data.user_info || data.data;
            if (typeof initAuthModules === 'function') {
                initAuthModules(token, userInfo);
            }
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
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化 Toast
    if (typeof initToast === 'function') initToast();
    // 初始化 Modal
    if (typeof initModal === 'function') initModal();

    // 鉴权检查
    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    // 1. 渲染用户信息 + 加载菜单
    const menuData = await renderUserInfo(token);

    // 2. 加载并渲染菜单（动态 + admin）
    if (window.DashboardMenu) {
        await window.DashboardMenu.loadMenu();
    }

    // 3. 初始化侧边栏
    initSidebar();

    // 4. 根据权限节点自动显隐元素
    if (typeof initPermissionVisibility === 'function') {
        initPermissionVisibility();
    }

    // 5. 绑定事件
    bindGlobalEvents();

    // 6. 切换到默认 Tab (workspace)
    if (window.DashboardMenu) {
        window.DashboardMenu.switchTab('workspace');
    }

    // 初始化设置按钮
    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
        on(settingsBtn, 'click', () => {
            if (window.DashboardMenu) window.DashboardMenu.switchTab('settings');
        });
    }

    // 初始化注销相关
    if (typeof initDeletion === 'function') {
        initDeletion();
        renderDeletionStatus();
    }

    // 初始化个人文档全局引用
    if (typeof window.initPersonalDocs !== 'function') {
        window.initPersonalDocs = function() {
            if (typeof loadPersonalDocs === 'function') loadPersonalDocs();
        };
    }

    // 初始化打卡模块全局引用（供 workspace.html / home panel 调用）
    if (typeof window.initCheckinModule !== 'function') {
        window.initCheckinModule = function() {
            if (typeof initCheckinButtons === 'function') initCheckinButtons();
        };
    }

    // 绑定验证码按钮
    let verifyEmailBtnEl = $('verifyEmailBtn');
    if (verifyEmailBtnEl) {
        on(verifyEmailBtnEl, 'click', () => {
            if (typeof sendVerificationEmail === 'function') {
                sendVerificationEmail();
            }
        });
    }
});

/** 绑定全局事件 */
function bindGlobalEvents() {
    // 绑定退出按钮
    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
        on(logoutBtn, 'click', () => {
            AuthGuard.clearToken();
            showToast('已退出登录', 'success');
            setTimeout(() => {
                window.location.replace(`${BASE_PATH || './'}login.html?_t=${Date.now()}`);
            }, 800);
        });
    }

    // 绑定侧边栏切换
    const toggleBtn = $('sidebarToggleBtn');
    if (toggleBtn) {
        on(toggleBtn, 'click', () => {
            const sidebar = $('dashboardSidebar');
            const overlay = $('sidebarOverlay');
            if (sidebar) sidebar.classList.toggle('dashboard-sidebar--open');
            if (overlay) overlay.classList.toggle('sidebar-overlay--visible');
        });
    }

    // 绑定侧边栏用户头像点击（回到主页 home）
    const userTrigger = $('sidebarUserTrigger');
    if (userTrigger) {
        on(userTrigger, 'click', () => {
            if (window.DashboardMenu) window.DashboardMenu.switchTab('home');
        });
    }
}

/** 侧边栏初始化 */
function initSidebar() {
    const overlay = $('sidebarOverlay');
    if (overlay) {
        on(overlay, 'click', () => {
            const sidebar = $('dashboardSidebar');
            if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
            overlay.classList.remove('sidebar-overlay--visible');
        });
    }
}