/**
 * dashboard.js
 * 用户主页逻辑：鉴权校验 + 用户信息渲染 + 权限按钮 + 侧边栏交互
 */

const DEFAULT_BANNER = 'https://picsum.photos/1200/300';
const DEFAULT_AVATAR = '../favicon.png';

const ROLE_NAMES = {
    0: '未登录',
    1: '普通用户',
    2: '一级管理员',
    3: '二级管理员',
    4: '三级管理员',
    5: '超级管理员'
};

document.addEventListener('DOMContentLoaded', async () => {
    initSidebarToggle();
    initSettingsButton();
    initTabSwitching();

    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/status`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            AuthGuard.handleAuthError();
            return;
        }

        const data = await response.json();
        if (response.ok && data.code === 200) {
            const user = data.data.user;
            renderUserProfile(user);
            renderPermissionButtons(user.permission_level);
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
    }
});

function initSidebarToggle() {
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('dashboardSidebar');
    const closeBtn = document.getElementById('sidebarClose');
    const overlay = document.getElementById('sidebarOverlay');
    const dashboardNav = document.getElementById('dashboardNav');

    function openSidebar() {
        sidebar.classList.add('dashboard-sidebar--open');
        if (dashboardNav) dashboardNav.classList.add('header__nav--open');
        overlay.classList.add('sidebar-overlay--visible');
    }

    function closeSidebar() {
        sidebar.classList.remove('dashboard-sidebar--open');
        if (dashboardNav) dashboardNav.classList.remove('header__nav--open');
        overlay.classList.remove('sidebar-overlay--visible');
    }

    if (menuBtn) menuBtn.addEventListener('click', openSidebar);
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);
}

function initSettingsButton() {
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            if (typeof Toast !== 'undefined') {
                Toast.show('设置功能开发中...', 'info');
            } else {
                alert('设置功能开发中...');
            }
        });
    }
}

function initTabSwitching() {
    // 默认显示主页
    switchTab('home');

    // 侧边栏导航项点击切换
    document.querySelectorAll('.sidebar__nav-item[data-tab]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.dataset.tab;
            switchTab(tab);
            // 移动端点击后关闭侧边栏
            const sidebar = document.getElementById('dashboardSidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
            if (overlay) overlay.classList.remove('sidebar-overlay--visible');
        });
    });

    // 左下角头像点击切换到主页
    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.style.cursor = 'pointer';
        userTrigger.addEventListener('click', () => {
            switchTab('home');
            const sidebar = document.getElementById('dashboardSidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
            if (overlay) overlay.classList.remove('sidebar-overlay--visible');
        });
    }
}

function switchTab(tab) {
    // 切换内容面板
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.style.display = 'none';
    });
    const targetPanel = document.getElementById(`panel-${tab}`);
    if (targetPanel) targetPanel.style.display = '';

    // 更新侧边栏导航项激活状态
    document.querySelectorAll('.sidebar__nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tab);
    });

    // 头像区域高亮（主页时激活）
    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.classList.toggle('is-active', tab === 'home');
    }
}

function renderUserProfile(user) {
    const profile = user.profile || {};
    const avatar = profile.avatar || DEFAULT_AVATAR;
    const banner = profile.banner || DEFAULT_BANNER;
    const roleName = ROLE_NAMES[user.permission_level] || '未知';

    const sidebarAvatar = document.getElementById('sidebarAvatar');
    if (sidebarAvatar) {
        sidebarAvatar.src = avatar;
        sidebarAvatar.onerror = function() { this.src = DEFAULT_AVATAR; };
    }

    const sidebarUsername = document.getElementById('sidebarUsername');
    if (sidebarUsername) sidebarUsername.textContent = user.username;

    const sidebarUserRole = document.getElementById('sidebarUserRole');
    if (sidebarUserRole) sidebarUserRole.textContent = roleName;

    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar) {
        profileAvatar.src = avatar;
        profileAvatar.onerror = function() { this.src = DEFAULT_AVATAR; };
    }

    const profileUsername = document.getElementById('profileUsername');
    if (profileUsername) profileUsername.textContent = user.username;

    const profileBadge = document.getElementById('profileBadge');
    if (profileBadge) profileBadge.textContent = `Lv.${user.permission_level} ${roleName}`;

    const profileIntro = document.getElementById('profileIntro');
    if (profileIntro) {
        profileIntro.textContent = profile.introduction || '这个人很懒，什么都没留下';
    }

    const bannerImg = document.getElementById('bannerImg');
    if (bannerImg) {
        bannerImg.src = banner;
        bannerImg.onerror = function() {
            this.style.display = 'none';
        };
    }
}

function renderPermissionButtons(permissionLevel) {
    const container = document.getElementById('permissionButtons');
    if (!container) return;

    container.innerHTML = '';

    if (permissionLevel <= 1) return;

    for (let level = 2; level <= permissionLevel; level++) {
        const btn = document.createElement('button');
        btn.className = 'perm-btn';
        if (level === permissionLevel) {
            btn.classList.add('perm-btn--current');
        }
        btn.textContent = level;
        btn.title = `进入 ${ROLE_NAMES[level] || `等级${level}`} 管理后台`;
        btn.addEventListener('click', () => handlePermissionClick(level));
        container.appendChild(btn);
    }
}

function handlePermissionClick(level) {
    const dashboardPath = encodeURIComponent(window.location.pathname + window.location.search);
    const adminUrl = `${BASE_PATH}/admin/admin${level}.html?from=${dashboardPath}`;
    window.location.href = adminUrl;
}
