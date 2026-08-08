/**
 * admin.js
 * 管理员面板逻辑：鉴权校验 + 管理员信息渲染 + 侧边栏交互 + 各模块占位
 * 所有 API 请求统一携带 X-Permission-Context: admin
 */

const DEFAULT_AVATAR_ADMIN = './favicon.png';
const ADMIN_STORAGE_KEY = 'admin_active_tab';
const ADMIN_ROLE_NAMES = {
    1: '普通用户',
    2: '一级管理员',
    3: '二级管理员',
    4: '三级管理员',
    5: '超级管理员'
};

// 各 panel 首次加载标记
const adminPanelLoaded = new Set();

document.addEventListener('DOMContentLoaded', async () => {
    initSidebarToggle();
    initAdminTabSwitching();
    if (typeof initPermissionVisibility === 'function') {
        initPermissionVisibility();
    }

    // 访客视角模式：直接跳转首页
    if (localStorage.getItem('guest_view_mode') === 'true') {
        window.location.href = `${BASE_PATH}/index.html`;
        return;
    }

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

            // 管理员页面准入：必须 permission_level >= 2（否则直接跳转 dashboard）
            const lvl = user.permission_level || 1;
            if (lvl < 2) {
                showToast('您不是管理员，已跳转至个人主页', 'warn');
                setTimeout(() => {
                    window.location.href = `${BASE_PATH}/user/dashboard.html`;
                }, 800);
                return;
            }

            renderAdminUserProfile(user);
            renderTopNavAuth(user);
            initAdminThemeOptions();

            // 若等级 2-4，toast 提示权限节点等待上线
            if (lvl >= 2 && lvl <= 4) {
                showToast(
                    '权限节点式权限管理功能规划中，当前仅超级管理员可访问完整管理功能。',
                    'info',
                    { duration: 4500 }
                );
            }
        }
    } catch (error) {
        console.error('[ADMIN] 获取管理员信息失败:', error);
        showToast('管理员信息加载失败', 'error');
    }
});


// ==================== 侧边栏 / Tab ====================

function initSidebarToggle() {
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('dashboardSidebar');
    const closeBtn = document.getElementById('sidebarClose');
    const overlay = document.getElementById('sidebarOverlay');

    function openSidebar() {
        sidebar.classList.add('dashboard-sidebar--open');
        overlay.classList.add('sidebar-overlay--visible');
    }
    function closeSidebar() {
        sidebar.classList.remove('dashboard-sidebar--open');
        overlay.classList.remove('sidebar-overlay--visible');
    }
    if (menuBtn) menuBtn.addEventListener('click', openSidebar);
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);
}
function closeMobileSidebar() {
    const sb = document.getElementById('dashboardSidebar');
    const ov = document.getElementById('sidebarOverlay');
    if (sb) sb.classList.remove('dashboard-sidebar--open');
    if (ov) ov.classList.remove('sidebar-overlay--visible');
}

function initAdminTabSwitching() {
    const saved = localStorage.getItem(ADMIN_STORAGE_KEY) || 'overview';
    if (document.getElementById(`panel-${saved}`)) {
        switchAdminTab(saved, true);
    } else {
        switchAdminTab('overview', true);
    }
    bindAdminTabClicks();

    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.style.cursor = 'pointer';
        userTrigger.addEventListener('click', (e) => {
            // 只有点击未点到具体跳转按钮时才切概览
            if (e.target.closest('a')) return;
            switchAdminTab('overview');
            closeMobileSidebar();
        });
    }
}

function bindAdminTabClicks() {
    const items = document.querySelectorAll('.sidebar__nav-item[data-tab]');
    items.forEach(item => {
        if (item._adminTabBound) return;
        item._adminTabBound = true;
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = item.getAttribute('data-tab');
            if (tab) {
                switchAdminTab(tab);
                closeMobileSidebar();
            }
        });
    });
}

function switchAdminTab(tabName, skipSave = false) {
    // 权限检查：读取 sidebar item 的 data-permission
    const navItem = document.querySelector(`.sidebar__nav-item[data-tab="${tabName}"]`);
    const requiredNode = navItem?.dataset.permission;
    if (requiredNode && typeof hasPermission === 'function' && !hasPermission(requiredNode)) {
        showToast(`权限不足，无法访问「${navItem?.querySelector('.sidebar__nav-text')?.textContent || tabName}」`, 'error');
        return;
    }

    // 隐藏所有 tab panel
    document.querySelectorAll('.admin-content .tab-panel').forEach(p => p.style.display = 'none');
    // 清除所有 sidebar nav 激活态
    document.querySelectorAll('.sidebar__nav-item[data-tab]').forEach(i => {
        i.classList.remove('sidebar__nav-item--active');
    });
    // 显示目标 panel
    const target = document.getElementById(`panel-${tabName}`);
    if (target) target.style.display = 'block';
    // 激活对应 sidebar item
    if (navItem) navItem.classList.add('sidebar__nav-item--active');

    if (!skipSave) localStorage.setItem(ADMIN_STORAGE_KEY, tabName);

    // 首次激活对应 tab 时加载占位数据
    if (!adminPanelLoaded.has(tabName)) {
        adminPanelLoaded.add(tabName);
        loadAdminPanel(tabName);
    }
}


// ==================== 通用：管理员请求封装（admin 上下文） ====================

function adminRequest(path, options = {}) {
    const token = AuthGuard.getToken();
    const method = (options.method || 'GET').toUpperCase();
    const hasBody = options.body !== undefined && options.body !== null;
    // 只有带 body 的请求才设置 Content-Type，避免 GET 无 body 触发 WAF/nginx 400
    const headers = Object.assign({
        'X-Permission-Context': 'admin'
    }, options.headers || {});
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return fetch(`${API_BASE_URL}${path}`, Object.assign({}, options, { method, headers }));
}


// ==================== 用户信息渲染 ====================

function renderAdminUserProfile(user) {
    // 侧边栏头像 / 用户名 / 角色
    const avatarEl = document.getElementById('sidebarAvatar');
    const usernameEl = document.getElementById('sidebarUsername');
    const roleEl = document.getElementById('sidebarUserRole');
    if (avatarEl) {
        const baseAvatar = (user && user.profile && user.profile.avatar_url) || DEFAULT_AVATAR_ADMIN;
        avatarEl.src = baseAvatar;
        avatarEl.onerror = () => { avatarEl.src = DEFAULT_AVATAR_ADMIN; };
    }
    if (usernameEl) usernameEl.textContent = user.username || '管理员';
    if (roleEl) {
        const roleName = ADMIN_ROLE_NAMES[user.permission_level] || '未知等级';
        roleEl.textContent = `${roleName}（Lv.${user.permission_level || 1}）`;
    }
}


// ==================== 顶部导航 / 主题 ====================

function initAdminThemeOptions() {
    // 复用 dashboard 主题切换逻辑（同一套 theme 变量）
    const themeOpts = document.querySelectorAll('#themeOptions .theme-opt');
    const savedTheme = localStorage.getItem('theme') || 'light';
    themeOpts.forEach(opt => {
        if (opt.getAttribute('data-theme') === savedTheme) {
            opt.classList.add('theme-opt--active');
        }
        opt.addEventListener('click', () => {
            const t = opt.getAttribute('data-theme');
            applyTheme(t);
            themeOpts.forEach(o => o.classList.remove('theme-opt--active'));
            opt.classList.add('theme-opt--active');
            // 同步偏好到后端（可选）
            const token = AuthGuard.getToken();
            if (token) {
                fetch(`${API_BASE_URL}/api/v1/user/theme`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Permission-Context': 'admin'
                    },
                    body: JSON.stringify({ theme: t })
                }).catch(() => {});
            }
        });
    });
}


// ==================== 各 Tab 占位加载 ====================

function loadAdminPanel(tabName) {
    switch (tabName) {
        case 'overview':
            loadOverview();
            break;
        case 'users':
            loadUsersPanel();
            break;
        case 'documents':
            loadDocumentsPanel();
            break;
        case 'notifications':
            loadNotificationsPanel();
            break;
        case 'invites':
            loadInvitesPanel();
            break;
        case 'settings':
            // 主题已渲染；系统设置占位
            break;
        case 'permission-nodes':
            loadPermissionNodesPanel();
            break;
    }
}

function loadOverview() {
    const grid = document.getElementById('overviewStatsGrid');
    if (!grid) return;
    grid.innerHTML = '<p class="loading-text">统计加载中...</p>';

    adminRequest('/api/v1/admin/stats').then(async (res) => {
        if (res.status === 403) {
            const d = await res.json().catch(() => ({}));
            grid.innerHTML = '';
            renderPermPending(grid, d && d.msg);
            return;
        }
        if (!res.ok) {
            grid.innerHTML = '<p class="empty-state__text">统计加载失败</p>';
            return;
        }
        const r = await res.json();
        const data = (r && r.data) || {};
        const cards = [
            { label: '用户总数', value: data.users_count ?? '-', icon: '👥' },
            { label: '文档总数', value: data.docs_count ?? '-', icon: '📚' },
            { label: '文件夹总数', value: data.folders_count ?? '-', icon: '📁' },
            { label: '全局通知', value: data.notifications_count ?? '-', icon: '📣' },
            { label: '剩余邀请码', value: data.invite_codes_remaining ?? '-', icon: '🎟️' }
        ];
        grid.innerHTML = cards.map(c => `
            <div class="admin-stat-card">
                <div class="admin-stat-card__icon">${c.icon}</div>
                <div class="admin-stat-card__value">${c.value}</div>
                <div class="admin-stat-card__label">${c.label}</div>
                ${r && r.placeholder ? '<div class="placeholder-tag">占位</div>' : ''}
            </div>
        `).join('');
    }).catch(err => {
        console.error('[ADMIN] overview 统计加载失败:', err);
        grid.innerHTML = '<p class="empty-state__text">统计加载失败（网络错误）</p>';
    });
}

function loadUsersPanel() {
    const wrap = document.getElementById('usersTableWrap');
    if (!wrap) return;
    adminRequest('/api/v1/admin/users?page=1&size=20').then(async res => {
        if (res.status === 403) {
            const d = await res.json().catch(() => ({}));
            wrap.innerHTML = '';
            renderPermPending(wrap, d && d.msg);
            return;
        }
        if (!res.ok) {
            wrap.innerHTML = '<p class="empty-state__text">用户列表加载失败</p>';
            return;
        }
        const r = await res.json();
        const items = (r && r.data && r.data.items) || [];
        renderAdminTable(wrap, {
            columns: ['ID', '用户名', '邮箱', '等级', '创建时间'],
            rows: items.map(u => [
                u.id,
                u.username,
                u.email || '-',
                `Lv.${u.permission_level || 1}（${ADMIN_ROLE_NAMES[u.permission_level] || '未知'}）`,
                u.created_at ? (new Date(u.created_at)).toLocaleString() : '-'
            ]),
            placeholder: !!r.placeholder
        });
    }).catch(err => {
        console.error('[ADMIN] 用户加载失败:', err);
        wrap.innerHTML = '<p class="empty-state__text">用户列表加载失败（网络错误）</p>';
    });

    const refreshBtn = document.getElementById('usersRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadUsersPanel);
}

function loadDocumentsPanel() {
    const wrap = document.getElementById('docsTableWrap');
    if (!wrap) return;
    adminRequest('/api/v1/admin/documents?page=1&size=20').then(async res => {
        if (res.status === 403) {
            const d = await res.json().catch(() => ({}));
            wrap.innerHTML = '';
            renderPermPending(wrap, d && d.msg);
            return;
        }
        if (!res.ok) {
            wrap.innerHTML = '<p class="empty-state__text">文档列表加载失败</p>';
            return;
        }
        const r = await res.json();
        const items = (r && r.data && r.data.items) || [];
        renderAdminTable(wrap, {
            columns: ['ID', '标题', '作者ID', '可见性', '权限位', '分类', '更新时间'],
            rows: items.map(d => [
                d.id,
                `<a href="${BASE_PATH}/document.html?slug=${encodeURIComponent(d.slug || '')}" target="_blank">${escapeHtml(d.title || '-')}</a>`,
                d.author_id || '-',
                d.visibility || '-',
                d.permission_bits || '-',
                d.category_name || '-',
                d.updated_at ? (new Date(d.updated_at)).toLocaleString() : '-'
            ]),
            placeholder: !!r.placeholder
        });
    }).catch(err => {
        console.error('[ADMIN] 文档加载失败:', err);
        wrap.innerHTML = '<p class="empty-state__text">文档列表加载失败（网络错误）</p>';
    });
    const refreshBtn = document.getElementById('docsRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadDocumentsPanel);
}

function loadNotificationsPanel() {
    const wrap = document.getElementById('notifyTableWrap');
    if (!wrap) return;
    adminRequest('/api/v1/admin/notifications').then(async res => {
        if (res.status === 403) {
            const d = await res.json().catch(() => ({}));
            wrap.innerHTML = '';
            renderPermPending(wrap, d && d.msg);
            return;
        }
        if (!res.ok) {
            wrap.innerHTML = '<p class="empty-state__text">通知列表加载失败</p>';
            return;
        }
        const r = await res.json();
        const items = (r && r.data && r.data.items) || [];
        renderAdminTable(wrap, {
            columns: ['ID', '标题', '类型', '级别', '发布人', '创建时间', '状态'],
            rows: items.map(n => [
                n.id,
                escapeHtml(n.title || '-'),
                n.type || '-',
                n.level || '-',
                n.creator_username || '-',
                n.created_at ? (new Date(n.created_at)).toLocaleString() : '-',
                n.is_active ? '✅ 激活' : '❌ 停用'
            ]),
            placeholder: !!r.placeholder
        });
    }).catch(err => {
        console.error('[ADMIN] 通知加载失败:', err);
        wrap.innerHTML = '<p class="empty-state__text">通知列表加载失败（网络错误）</p>';
    });
    const newBtn = document.getElementById('notifyNewBtn');
    if (newBtn) {
        newBtn.addEventListener('click', () => {
            showToast('全局通知创建为占位实现（权限节点上线前不实际写入）', 'info');
        });
    }
}

function loadInvitesPanel() {
    const wrap = document.getElementById('invitesTableWrap');
    if (!wrap) return;
    adminRequest('/api/v1/admin/invite-codes').then(async res => {
        if (res.status === 403) {
            const d = await res.json().catch(() => ({}));
            wrap.innerHTML = '';
            renderPermPending(wrap, d && d.msg);
            return;
        }
        if (!res.ok) {
            wrap.innerHTML = '<p class="empty-state__text">邀请码列表加载失败</p>';
            return;
        }
        const r = await res.json();
        const items = (r && r.data && r.data.items) || [];
        renderAdminTable(wrap, {
            columns: ['ID', '邀请码', '创建人', '用途/备注', '已使用', '使用上限', '过期时间'],
            rows: items.map(c => [
                c.id,
                `<code>${escapeHtml(c.code || '-')}</code>`,
                c.created_by_username || '-',
                escapeHtml(c.purpose || c.notes || '-'),
                c.used_count ?? 0,
                c.max_uses || '-',
                c.expires_at ? (new Date(c.expires_at)).toLocaleString() : '永不过期'
            ]),
            placeholder: !!r.placeholder
        });
    }).catch(err => {
        console.error('[ADMIN] 邀请码加载失败:', err);
        wrap.innerHTML = '<p class="empty-state__text">邀请码列表加载失败（网络错误）</p>';
    });
    const newBtn = document.getElementById('invitesNewBtn');
    if (newBtn) {
        newBtn.addEventListener('click', () => {
            showToast('邀请码生成功能占位（权限节点上线前不实际写入）', 'info');
        });
    }
}

function loadPermissionNodesPanel() {
    const wrap = document.getElementById('permNodesExplain');
    if (!wrap) return;
    adminRequest('/api/v1/admin/permission-nodes').then(async res => {
        if (res.status === 403) {
            const d = await res.json().catch(() => ({}));
            wrap.innerHTML = '';
            renderPermPending(wrap, d && d.msg);
            return;
        }
        if (!res.ok) {
            wrap.innerHTML = '<p class="empty-state__text">权限节点说明加载失败</p>';
            return;
        }
        const r = await res.json();
        const mod = (r && r.data && r.data.expected_modules) || [];
        const status = (r && r.data && r.data.implementation_status) || '规划中';
        wrap.innerHTML = `
            <div class="perm-explain-card">
                <h3>实现状态：<span class="perm-status perm-status--${status === '规划中' ? 'pending' : 'active'}">${escapeHtml(status)}</span></h3>
                <h4>预期支持的权限节点：</h4>
                <ul class="perm-nodes-list">
                    ${mod.map(m => `<li>${escapeHtml(m)}</li>`).join('')}
                </ul>
                ${r && r.placeholder ? '<div class="placeholder-tag">占位</div>' : ''}
            </div>
        `;
    }).catch(err => {
        console.error('[ADMIN] 权限节点说明加载失败:', err);
        wrap.innerHTML = '<p class="empty-state__text">加载失败（网络错误）</p>';
    });
}


// ==================== 辅助：表格 / 占位渲染 / HTML 转义 ====================

function renderAdminTable(wrapper, { columns, rows, placeholder }) {
    const tableHtml = `
        ${placeholder ? '<div class="placeholder-tag placeholder-tag--top">占位</div>' : ''}
        <div class="admin-table-scroll">
            <table class="admin-table">
                <thead>
                    <tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.length === 0
                        ? `<tr><td colspan="${columns.length}" class="admin-table__empty">暂无数据</td></tr>`
                        : rows.map(r => `<tr>${r.map(cell => `<td>${cell ?? ''}</td>`).join('')}</tr>`).join('')
                    }
                </tbody>
            </table>
        </div>
    `;
    wrapper.innerHTML = tableHtml;
}

function renderPermPending(wrapper, msg) {
    wrapper.innerHTML = `
        <div class="empty-state empty-state--placeholder">
            <div class="empty-state__icon">🔐</div>
            <p class="empty-state__text">${escapeHtml(msg || '权限节点式权限管理功能规划中，当前仅超级管理员可访问管理面板。')}</p>
        </div>
    `;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderTopNavAuth(user) {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) return;
    authContainer.innerHTML = '';
    const navLoginLinks = document.querySelectorAll('.header__nav a[href*="login"]');
    const navRegisterLinks = document.querySelectorAll('.header__nav a[href*="register"]');
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
    const usernameLink = document.createElement('a');
    usernameLink.href = `${BASE_PATH}/user/dashboard.html`;
    usernameLink.className = 'username';
    usernameLink.textContent = user.username;
    userEl.appendChild(usernameLink);
    const logoutLink = document.createElement('a');
    logoutLink.href = '#';
    logoutLink.className = 'logout-link';
    logoutLink.id = 'logoutBtn';
    logoutLink.textContent = '退出';
    userEl.appendChild(logoutLink);
    authContainer.appendChild(userEl);
    navLoginLinks.forEach(link => link.style.display = 'none');
    navRegisterLinks.forEach(link => link.style.display = 'none');
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            AuthGuard.clearToken();
            localStorage.removeItem('guest_view_mode');
            window.location.href = `${BASE_PATH}/index.html`;
        });
    }
}
