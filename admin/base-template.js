/**
 * base-template.js
 * 管理员后台基础逻辑：权限校验 + 动态菜单 + 导航切换
 */

// 管理员页面权限状态：pageLevel 跟随用户真实等级
const currentUser = {
    pageLevel: null,  // 将在鉴权后设置为 currentUser.level
    level: null       // 用户真实权限等级（从 API 获取）
};

const DEFAULT_AVATAR = '../favicon.png';

const ROLE_NAMES = {
    0: '未登录',
    1: '普通用户',
    2: '一级管理员',
    3: '二级管理员',
    4: '三级管理员',
    5: '超级管理员'
};

// 动态菜单缓存：tab_key -> { meta, loaded: bool }
const dynamicMenuCache = new Map();
// 静态 tab（与后端动态项 tab_key 冲突时跳过）
const STATIC_TABS = ['system', 'users', 'permissions', 'content', 'documents', 'announcements', 'reports', 'logs', 'overview', 'profile'];

document.addEventListener('DOMContentLoaded', async () => {
    initSidebarToggle();
    initTabSwitching();
    initLogoutButton();

    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/status`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'  // 管理员页面请求头
            }
        });

        if (response.status === 401) {
            AuthGuard.handleAuthError();
            return;
        }

        const data = await response.json();
        if (response.ok && data.code === 200) {
            const user = data.data.user;
            // 保存用户真实权限等级
            currentUser.level = user.permission_level;
            // 管理员页面：pageLevel = level（激活管理员权限）
            currentUser.pageLevel = currentUser.level;

            // 权限校验：仅管理员可访问（等级 >= 2）
            if (currentUser.pageLevel < 2) {
                if (typeof Toast !== 'undefined') {
                    Toast.show('您没有权限访问管理员页面', 'error');
                }
                setTimeout(() => {
                    window.location.href = `${BASE_PATH}/user/dashboard.html`;
                }, 1500);
                return;
            }

            renderUserProfile(user);
            renderAdminMenu(currentUser.pageLevel);
            renderPermissionButtons(currentUser.pageLevel);
            renderTopNavAuth(user);

            // 加载动态菜单
            loadDynamicMenu(token);
            // 绑定主题切换
            initThemeOptions(token);
            // 加载概览统计数据
            loadOverviewStats(token);
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
        if (typeof Toast !== 'undefined') {
            Toast.show('获取用户信息失败，请重试', 'error');
        }
    }
});

function initSidebarToggle() {
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('adminSidebar');
    const closeBtn = document.getElementById('sidebarClose');
    const overlay = document.getElementById('sidebarOverlay');

    function openSidebar() {
        sidebar.classList.add('admin-sidebar--open');
        overlay.classList.add('sidebar-overlay--visible');
    }

    function closeSidebar() {
        sidebar.classList.remove('admin-sidebar--open');
        overlay.classList.remove('sidebar-overlay--visible');
    }

    if (menuBtn) menuBtn.addEventListener('click', openSidebar);
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);
}

function initTabSwitching() {
    // 默认显示概览
    const savedTab = localStorage.getItem('admin_active_tab') || 'overview';
    const hasPanel = document.getElementById(`panel-${savedTab}`);
    if (hasPanel) {
        switchTab(savedTab, true);
    } else {
        switchTab('overview', true);
    }

    // 绑定静态项点击
    bindTabClicks();

    // 左下角头像点击切换到个人设置
    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.style.cursor = 'pointer';
        userTrigger.addEventListener('click', () => {
            switchTab('profile');
            closeMobileSidebar();
        });
    }
}

function bindTabClicks() {
    document.querySelectorAll('.sidebar__nav-item[data-tab]').forEach(item => {
        if (item.dataset.bound === '1') return;
        item.dataset.bound = '1';
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(item.dataset.tab);
            closeMobileSidebar();
        });
    });
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('admin-sidebar--open');
    if (overlay) overlay.classList.remove('sidebar-overlay--visible');
}

async function switchTab(tab, skipSave = false) {
    if (!skipSave) {
        localStorage.setItem('admin_active_tab', tab);
    }

    // 动态项懒加载
    if (dynamicMenuCache.has(tab) && !dynamicMenuCache.get(tab).loaded) {
        await loadPanelContent(tab);
    }

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

    // 头像区域高亮（个人设置时激活）
    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.classList.toggle('is-active', tab === 'profile');
    }
}

// =========================================
// 根据权限显示/隐藏菜单项
// =========================================

function renderAdminMenu(level) {
    // 超级管理员（等级5）
    if (level >= 5) {
        document.querySelectorAll('.admin-only--super').forEach(el => {
            el.style.display = '';
        });
    }
    // 三级管理员及以上（等级 >= 4）
    if (level >= 4) {
        document.querySelectorAll('.admin-only--level3').forEach(el => {
            el.style.display = '';
        });
    }
    // 二级管理员及以上（等级 >= 3）
    if (level >= 3) {
        document.querySelectorAll('.admin-only--level2').forEach(el => {
            el.style.display = '';
        });
    }
    // 一级管理员及以上（等级 >= 2）
    if (level >= 2) {
        document.querySelectorAll('.admin-only--level1').forEach(el => {
            el.style.display = '';
        });
    }
}

// =========================================
// 动态菜单相关函数
// =========================================

async function loadDynamicMenu(token) {
    const container = document.getElementById('dynamicMenuContainer');
    const divider = document.getElementById('dynamicMenuDivider');
    if (!container) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/admin/menu`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            }
        });
        const data = await res.json();
        if (data.code !== 200 || !Array.isArray(data.data)) return;

        const items = data.data;
        if (items.length === 0) {
            divider.style.display = 'none';
            return;
        }
        divider.style.display = '';

        const contentHost = document.querySelector('.admin-content');
        items.forEach(item => {
            // tab_key 与静态项冲突时跳过
            if (STATIC_TABS.includes(item.tab_key)) {
                console.warn(`[admin menu] 动态项 tab_key 冲突，跳过: ${item.tab_key}`);
                return;
            }
            // 缓存元数据
            dynamicMenuCache.set(item.tab_key, { meta: item, loaded: false });
            // 渲染 nav-item
            const a = document.createElement('a');
            a.href = '#';
            a.className = 'sidebar__nav-item';
            a.dataset.tab = item.tab_key;
            a.innerHTML = `<span class="sidebar__nav-icon">${item.icon || '📄'}</span>
                           <span class="sidebar__nav-text">${item.label}</span>`;
            container.appendChild(a);
            // 创建空 panel
            const panel = document.createElement('section');
            panel.className = 'tab-panel';
            panel.id = `panel-${item.tab_key}`;
            panel.style.display = 'none';
            panel.innerHTML = '<p class="loading-text">加载中...</p>';
            contentHost.appendChild(panel);
        });
        bindTabClicks();

        // 恢复上次保存的 tab
        const savedTab = localStorage.getItem('admin_active_tab');
        if (savedTab && dynamicMenuCache.has(savedTab)) {
            const currentActive = document.querySelector('.sidebar__nav-item.active')?.dataset.tab;
            if (currentActive !== savedTab) {
                switchTab(savedTab, true);
            }
        }
    } catch (e) {
        console.error('[admin menu] 加载动态菜单失败', e);
    }
}

async function loadPanelContent(tab) {
    const cache = dynamicMenuCache.get(tab);
    if (!cache || cache.loaded) return;
    const token = AuthGuard.getToken();
    if (!token) return;
    const panel = document.getElementById(`panel-${tab}`);
    if (!panel) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/admin/menu/${cache.meta.id}/content`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            }
        });
        const data = await res.json();
        if (data.code !== 200) {
            panel.innerHTML = '<p class="loading-text">内容加载失败</p>';
            return;
        }
        const d = data.data;
        panel.innerHTML = d.html_content || '';
        if (d.css_content) {
            const style = document.createElement('style');
            style.dataset.tabStyle = tab;
            style.textContent = d.css_content;
            panel.appendChild(style);
        }
        if (d.js_content) {
            const script = document.createElement('script');
            script.textContent = d.js_content;
            panel.appendChild(script);
        }
        cache.loaded = true;
    } catch (e) {
        console.error('[admin menu] 加载 panel 内容失败', e);
        panel.innerHTML = '<p class="loading-text">内容加载失败</p>';
    }
}

// =========================================
// 用户信息渲染
// =========================================

function renderUserProfile(user) {
    const profile = user.profile || {};
    const avatar = profile.avatar || DEFAULT_AVATAR;
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

    const welcomeUsername = document.getElementById('welcomeUsername');
    if (welcomeUsername) welcomeUsername.textContent = user.username;
}

function renderTopNavAuth(user) {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) return;

    authContainer.innerHTML = '';

    const avatar = (user.profile && user.profile.avatar) ? user.profile.avatar : '';
    const defaultAvatar = `${BASE_PATH}/favicon.png`;

    const userEl = document.createElement('div');
    userEl.className = 'user-info';

    const img = document.createElement('img');
    img.src = avatar || defaultAvatar;
    img.alt = user.username;
    img.className = 'user-avatar';
    img.onerror = function() { this.src = defaultAvatar; };
    userEl.appendChild(img);

    const usernameSpan = document.createElement('span');
    usernameSpan.className = 'username';
    usernameSpan.textContent = user.username;
    userEl.appendChild(usernameSpan);

    authContainer.appendChild(userEl);
}

// =========================================
// 权限按钮渲染（管理员页面专用）
// =========================================

function renderPermissionButtons(permissionLevel) {
    const container = document.getElementById('permissionButtons');
    if (!container) return;

    container.innerHTML = '';

    // 管理员页面：显示从 1 到当前等级的按钮
    // 仅管理员（等级 >= 2）才显示
    if (permissionLevel < 2) return;

    // 读取视角覆盖等级
    const viewOverrideRaw = localStorage.getItem('view_as_level');
    const viewOverride = viewOverrideRaw ? parseInt(viewOverrideRaw, 10) : null;
    const effectiveLevel = Number.isInteger(viewOverride) ? viewOverride : permissionLevel;

    // 超级管理员（5）：额外显示等级 0
    const levels = [];
    if (permissionLevel >= 5) levels.push(0);
    for (let level = 1; level <= permissionLevel; level++) {
        levels.push(level);
    }

    levels.forEach(level => {
        const btn = document.createElement('button');
        btn.className = 'perm-btn';
        if (level === effectiveLevel) {
            btn.classList.add('perm-btn--current');
        }
        btn.textContent = level;
        btn.title = `切换到 ${ROLE_NAMES[level] || `等级${level}`} 视角预览`;
        btn.addEventListener('click', () => handlePermissionClick(level));
        container.appendChild(btn);
    });
}

function handlePermissionClick(level) {
    if (level === 0) {
        // 访客视角预览
        localStorage.setItem('guest_view_mode', 'true');
        localStorage.removeItem('view_as_level');
        window.location.href = `${BASE_PATH}/index.html`;
        return;
    }

    localStorage.removeItem('guest_view_mode');

    if (level === currentUser.level) {
        // 返回真实等级
        localStorage.removeItem('view_as_level');
    } else {
        localStorage.setItem('view_as_level', String(level));
    }

    window.location.reload();
}

// =========================================
// 概览统计数据加载
// =========================================

async function loadOverviewStats(token) {
    try {
        // 并行请求统计数据
        const [usersRes, docsRes, reportsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/v1/admin/stats/users`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Page-Type': 'admin' }
            }).catch(() => null),
            fetch(`${API_BASE_URL}/api/v1/admin/stats/documents`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Page-Type': 'admin' }
            }).catch(() => null),
            fetch(`${API_BASE_URL}/api/v1/admin/stats/reports`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Page-Type': 'admin' }
            }).catch(() => null)
        ]);

        if (usersRes && usersRes.ok) {
            const data = await usersRes.json();
            if (data.code === 200) {
                const el = document.getElementById('statUsers');
                if (el) el.textContent = data.data.count || '--';
            }
        }

        if (docsRes && docsRes.ok) {
            const data = await docsRes.json();
            if (data.code === 200) {
                const el = document.getElementById('statDocs');
                if (el) el.textContent = data.data.count || '--';
            }
        }

        if (reportsRes && reportsRes.ok) {
            const data = await reportsRes.json();
            if (data.code === 200) {
                const el = document.getElementById('statReports');
                if (el) el.textContent = data.data.pending || '--';
            }
        }
    } catch (e) {
        console.warn('[admin] 加载统计数据失败', e);
    }
}

// =========================================
// 主题设置 & 退出登录
// =========================================

function initThemeOptions(token) {
    const options = document.getElementById('themeOptions');
    if (!options) return;
    options.addEventListener('click', (e) => {
        const btn = e.target.closest('.theme-opt');
        if (!btn) return;
        const theme = btn.dataset.theme;
        if (typeof ThemeEngine !== 'undefined') {
            ThemeEngine.applyTheme(theme);
            if (token) ThemeEngine.syncThemeToServer(theme, token);
            if (typeof Toast !== 'undefined') Toast.show('主题已切换', 'success');
        }
    });
}

function initLogoutButton() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const confirmed = await Modal.confirm('确认退出登录？', { title: '退出确认' });
            if (!confirmed) return;
            AuthGuard.clearToken();
            localStorage.removeItem('guest_view_mode');
            localStorage.removeItem('view_as_level');
            if (typeof Toast !== 'undefined') {
                Toast.show('已退出登录', 'success');
            }
            setTimeout(() => {
                window.location.href = `${BASE_PATH}/index.html`;
            }, 500);
        });
    }
}

// =========================================
// HTML 转义工具
// =========================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

// =========================================
// 占位组件渲染
// =========================================

/**
 * 渲染占位卡片
 * @param {string} title - 标题
 * @param {string} description - 描述文字
 * @param {string} icon - 图标（可选，默认 🚧）
 * @returns {string} HTML 字符串
 */
function renderPlaceholder(title, description, icon = '🚧') {
    return `
        <div class="placeholder-card">
            <div class="placeholder-icon">${icon}</div>
            <h3 class="placeholder-title">${escapeHtml(title)}</h3>
            <p class="placeholder-description">${escapeHtml(description)}</p>
        </div>
    `;
}