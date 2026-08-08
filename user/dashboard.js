/**
 * dashboard.js
 * 精简入口：全局初始化、用户信息、侧边栏、退出
 *
 * 注意：API_BASE_URL 已由 config.js 定义，此处不重复声明。
 */

// DOMContentLoaded 后初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化 Toast
    if (typeof initToast === 'function') initToast();
    // 初始化 Modal
    if (typeof initModal === 'function') initModal();

    // 鉴权检查
    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.redirectToLogin();
        return;
    }

    // 渲染用户信息并加载权限
    await renderUserInfo(token);

    // 初始化侧边栏
    initSidebar();

    // 初始化设置按钮
    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
        on(settingsBtn, 'click', () => {
            if (typeof switchTab === 'function') switchTab('settings');
        });
    }

    // 初始化注销相关
    if (typeof initDeletion === 'function') {
        initDeletion();
        renderDeletionStatus();
    }

    // 初始化 Tab 切换
    if (typeof initTabSwitching === 'function') initTabSwitching();

    // 初始化个人文档全局引用
    if (typeof window.initPersonalDocs !== 'function') {
        window.initPersonalDocs = function() {
            if (typeof loadPersonalDocs === 'function') loadPersonalDocs();
        };
    }

    // 绑定全局退出按钮
    on($('logoutBtn'), 'click', () => {
        AuthGuard.clearToken();
        showToast('已退出登录', 'success');
        setTimeout(() => {
            window.location.href = `${BASE_PATH || './'}index.html`;
        }, 800);
    });

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

    // 绑定用户菜单
    const userTrigger = $('sidebarUserTrigger');
    const userMenu = $('userMenu');
    if (userTrigger && userMenu) {
        on(userTrigger, 'click', (e) => {
            e.stopPropagation();
            userMenu.classList.toggle('user-menu--visible');
        });
        on(document, 'click', (e) => {
            if (!userMenu.contains(e.target) && !userTrigger.contains(e.target)) {
                userMenu.classList.remove('user-menu--visible');
            }
        });
    }

    // 绑定打卡相关按钮
    if (typeof initCheckinButtons === 'function') initCheckinButtons();

    // 绑定验证码按钮
    verifyEmailBtn = $('verifyEmailBtn');
    on(verifyEmailBtn, 'click', sendVerifyEmail);

    // 动态菜单
    if (typeof loadDynamicMenu === 'function') loadDynamicMenu(token);
});

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

/** 发送邮箱验证码（复用 auth 模块） */
let verifyEmailBtn;

async function sendVerifyEmail() {
    if (typeof sendVerificationEmail === 'function') {
        await sendVerificationEmail();
    }
}
