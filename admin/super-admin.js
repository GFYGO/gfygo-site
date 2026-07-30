/**
 * super-admin.js
 * 超级管理员页面逻辑：鉴权校验 + 用户管理 + 文档管理
 */

// 当前用户状态
const currentUser = {
    pageLevel: null,  // 管理员页面：pageLevel 跟随用户真实等级
    level: null
};

const ROLE_NAMES = {
    0: '未登录',
    1: '普通用户',
    2: '一级管理员',
    3: '二级管理员',
    4: '三级管理员',
    5: '超级管理员'
};

const VISIBILITY_NAMES = {
    'public': '公共',
    'group': '组',
    'private': '私有'
};

// 分页状态
const usersPagination = { page: 1, pageSize: 20, total: 0 };
const docsPagination = { page: 1, pageSize: 20, total: 0 };

// 搜索防抖定时器
let userSearchTimer = null;
let docSearchTimer = null;

// =========================================
// 初始化
// =========================================

document.addEventListener('DOMContentLoaded', async () => {
    initSidebarToggle();
    initTabSwitching();

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
                'X-Page-Type': 'admin'
            }
        });

        if (response.status === 401) {
            AuthGuard.handleAuthError();
            return;
        }

        const data = await response.json();
        if (response.ok && data.code === 200) {
            const user = data.data.user;
            currentUser.level = user.permission_level;
            currentUser.pageLevel = currentUser.level;

            // 权限校验：仅超级管理员可访问
            if (currentUser.pageLevel < 5) {
                if (typeof Toast !== 'undefined') {
                    Toast.show('您没有权限访问此页面', 'error');
                }
                setTimeout(() => {
                    window.location.href = `${BASE_PATH}/user/dashboard.html`;
                }, 1000);
                return;
            }

            renderAdminProfile(user);
            renderTopNavAuth(user);
            loadUsersList();
            loadDocsList();
            renderPlaceholderPanels();
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
    }
});

// =========================================
// 侧边栏交互
// =========================================

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

    // 左下角用户头像点击返回个人主页
    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.addEventListener('click', () => {
            window.location.href = `${BASE_PATH}/user/dashboard.html`;
        });
    }
}

function initTabSwitching() {
    // 绑定侧边栏导航项点击
    document.querySelectorAll('.sidebar__nav-item[data-tab]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(item.dataset.tab);
            closeMobileSidebar();
        });
    });
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('dashboardSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
    if (overlay) overlay.classList.remove('sidebar-overlay--visible');
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
}

// =========================================
// 渲染管理员信息
// =========================================

function renderAdminProfile(user) {
    const profile = user.profile || {};
    const avatar = profile.avatar || '../favicon.png';

    const sidebarAvatar = document.getElementById('sidebarAvatar');
    if (sidebarAvatar) {
        sidebarAvatar.src = avatar;
        sidebarAvatar.onerror = function() { this.src = '../favicon.png'; };
    }

    const sidebarUsername = document.getElementById('sidebarUsername');
    if (sidebarUsername) sidebarUsername.textContent = user.username;

    const sidebarUserRole = document.getElementById('sidebarUserRole');
    if (sidebarUserRole) sidebarUserRole.textContent = ROLE_NAMES[user.permission_level] || '未知';
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

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            AuthGuard.clearToken();
            window.location.href = `${BASE_PATH}/index.html`;
        });
    }
}

// =========================================
// 工具函数
// =========================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function formatTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showLoading(tableBodyId, colSpan) {
    const tbody = document.getElementById(tableBodyId);
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="loading-cell">加载中...</td></tr>`;
    }
}

function showError(tableBodyId, colSpan, message) {
    const tbody = document.getElementById(tableBodyId);
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="loading-cell">${escapeHtml(message)}</td></tr>`;
    }
}

// =========================================
// 用户管理模块
// =========================================

async function loadUsersList(search = '') {
    const token = AuthGuard.getToken();
    if (!token) return;

    showLoading('usersTableBody', 6);

    try {
        const query = new URLSearchParams({
            page: usersPagination.page,
            page_size: usersPagination.pageSize
        });
        if (search) query.set('search', search);

        const response = await fetch(`${API_BASE_URL}/api/v1/admin/users?${query}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            }
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            usersPagination.total = data.data.total || 0;
            renderUsersTable(data.data.users || []);
            renderUsersPagination();
        } else {
            showError('usersTableBody', 6, data.msg || '加载失败');
        }
    } catch (error) {
        console.error('加载用户列表失败:', error);
        showError('usersTableBody', 6, '网络请求失败');
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">暂无用户数据</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr data-user-id="${user.id}">
            <td>${user.id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.email || '-')}</td>
            <td><span class="perm-badge perm-badge--${user.permission_level}">Lv.${user.permission_level}</span></td>
            <td>${formatTime(user.created_at)}</td>
            <td class="admin-table__actions">
                <button class="admin-btn admin-btn--secondary admin-btn--sm" data-action="edit-user" data-id="${user.id}">编辑</button>
                <button class="admin-btn admin-btn--danger admin-btn--sm" data-action="delete-user" data-id="${user.id}">删除</button>
            </td>
        </tr>
    `).join('');

    // 绑定操作按钮事件
    tbody.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const userId = parseInt(btn.dataset.id, 10);
            if (action === 'edit-user') openUserEditModal(userId);
            else if (action === 'delete-user') deleteUser(userId);
        });
    });
}

function renderUsersPagination() {
    const container = document.getElementById('usersPagination');
    if (!container) return;

    const { page, pageSize, total } = usersPagination;
    const totalPages = Math.ceil(total / pageSize) || 1;

    if (totalPages <= 1) {
        container.innerHTML = `<span class="admin-pagination__info">共 ${total} 条</span>`;
        return;
    }

    let html = `<button class="admin-pagination__btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>`;

    // 显示页码（最多显示 5 个）
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let i = start; i <= end; i++) {
        html += `<button class="admin-pagination__btn ${i === page ? 'is-active' : ''}" data-page="${i}">${i}</button>`;
    }

    html += `<button class="admin-pagination__btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>`;
    html += `<span class="admin-pagination__info">共 ${total} 条 / ${totalPages} 页</span>`;

    container.innerHTML = html;

    container.querySelectorAll('.admin-pagination__btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
            usersPagination.page = parseInt(btn.dataset.page, 10);
            loadUsersList(document.getElementById('userSearchInput')?.value || '');
        });
    });
}

// 用户搜索
function initUserSearch() {
    const searchInput = document.getElementById('userSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(userSearchTimer);
            userSearchTimer = setTimeout(() => {
                usersPagination.page = 1;
                loadUsersList(e.target.value.trim());
            }, 300);
        });
    }

    const refreshBtn = document.getElementById('refreshUsersBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            usersPagination.page = 1;
            loadUsersList(searchInput?.value || '');
        });
    }
}

// 用户编辑弹窗
function openUserEditModal(userId) {
    const token = AuthGuard.getToken();
    if (!token) return;

    // 获取用户详情
    fetch(`${API_BASE_URL}/api/v1/admin/users/${userId}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-Page-Type': 'admin'
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show(data.msg || '获取用户信息失败', 'error');
            return;
        }
        const user = data.data;
        document.getElementById('editUserId').value = user.id;
        document.getElementById('editUsername').value = user.username || '';
        document.getElementById('editEmail').value = user.email || '';
        document.getElementById('editPermission').value = user.permission_level || 1;
        document.getElementById('userEditModalTitle').textContent = `编辑用户: ${escapeHtml(user.username)}`;
        document.getElementById('userEditModal').style.display = '';
    })
    .catch(err => {
        console.error('获取用户详情失败:', err);
        if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
    });
}

function closeUserEditModal() {
    document.getElementById('userEditModal').style.display = 'none';
}

async function saveUserEdit() {
    const token = AuthGuard.getToken();
    if (!token) return;

    const userId = document.getElementById('editUserId').value;
    const username = document.getElementById('editUsername').value.trim();
    const email = document.getElementById('editEmail').value.trim();
    // 权限修改为占位功能，不实际提交

    if (!username) {
        if (typeof Toast !== 'undefined') Toast.show('请输入用户名', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            },
            body: JSON.stringify({ username, email })
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            if (typeof Toast !== 'undefined') Toast.show('保存成功', 'success');
            closeUserEditModal();
            loadUsersList(document.getElementById('userSearchInput')?.value || '');
        } else {
            if (typeof Toast !== 'undefined') Toast.show(data.msg || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存用户失败:', error);
        if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
    }
}

async function deleteUser(userId) {
    const confirmed = await Modal.confirm('确认删除此用户？此操作不可恢复。', { title: '删除用户' });
    if (!confirmed) return;

    const token = AuthGuard.getToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/admin/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            }
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            if (typeof Toast !== 'undefined') Toast.show('用户已删除', 'success');
            loadUsersList(document.getElementById('userSearchInput')?.value || '');
        } else {
            if (typeof Toast !== 'undefined') Toast.show(data.msg || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除用户失败:', error);
        if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
    }
}

// =========================================
// 文档管理模块
// =========================================

async function loadDocsList(search = '') {
    const token = AuthGuard.getToken();
    if (!token) return;

    showLoading('docsTableBody', 6);

    try {
        const query = new URLSearchParams({
            page: docsPagination.page,
            page_size: docsPagination.pageSize,
            visibility: 'public'  // 仅显示公共文档
        });
        if (search) query.set('search', search);

        const response = await fetch(`${API_BASE_URL}/api/v1/admin/documents?${query}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            }
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            docsPagination.total = data.data.total || 0;
            renderDocsTable(data.data.documents || []);
            renderDocsPagination();
        } else {
            showError('docsTableBody', 6, data.msg || '加载失败');
        }
    } catch (error) {
        console.error('加载文档列表失败:', error);
        showError('docsTableBody', 6, '网络请求失败');
    }
}

function renderDocsTable(docs) {
    const tbody = document.getElementById('docsTableBody');
    if (!tbody) return;

    if (!docs.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">暂无公共文档</td></tr>';
        return;
    }

    tbody.innerHTML = docs.map(doc => `
        <tr data-doc-id="${doc.id}">
            <td>${doc.id}</td>
            <td>${escapeHtml(doc.title)}</td>
            <td>${escapeHtml(doc.author_name || '-')}</td>
            <td><span class="visibility-badge visibility-badge--${doc.visibility}">${VISIBILITY_NAMES[doc.visibility] || doc.visibility}</span></td>
            <td>${formatTime(doc.updated_at)}</td>
            <td class="admin-table__actions">
                <button class="admin-btn admin-btn--secondary admin-btn--sm" data-action="edit-doc" data-id="${doc.id}">编辑</button>
                <button class="admin-btn admin-btn--danger admin-btn--sm" data-action="delete-doc" data-id="${doc.id}">删除</button>
            </td>
        </tr>
    `).join('');

    // 绑定操作按钮事件
    tbody.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const docId = parseInt(btn.dataset.id, 10);
            if (action === 'edit-doc') openDocEditModal(docId);
            else if (action === 'delete-doc') deleteDoc(docId);
        });
    });
}

function renderDocsPagination() {
    const container = document.getElementById('docsPagination');
    if (!container) return;

    const { page, pageSize, total } = docsPagination;
    const totalPages = Math.ceil(total / pageSize) || 1;

    if (totalPages <= 1) {
        container.innerHTML = `<span class="admin-pagination__info">共 ${total} 条</span>`;
        return;
    }

    let html = `<button class="admin-pagination__btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>`;

    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let i = start; i <= end; i++) {
        html += `<button class="admin-pagination__btn ${i === page ? 'is-active' : ''}" data-page="${i}">${i}</button>`;
    }

    html += `<button class="admin-pagination__btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>`;
    html += `<span class="admin-pagination__info">共 ${total} 条 / ${totalPages} 页</span>`;

    container.innerHTML = html;

    container.querySelectorAll('.admin-pagination__btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
            docsPagination.page = parseInt(btn.dataset.page, 10);
            loadDocsList(document.getElementById('docSearchInput')?.value || '');
        });
    });
}

// 文档搜索
function initDocSearch() {
    const searchInput = document.getElementById('docSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(docSearchTimer);
            docSearchTimer = setTimeout(() => {
                docsPagination.page = 1;
                loadDocsList(e.target.value.trim());
            }, 300);
        });
    }

    const refreshBtn = document.getElementById('refreshDocsBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            docsPagination.page = 1;
            loadDocsList(searchInput?.value || '');
        });
    }
}

// 文档编辑弹窗
function openDocEditModal(docId) {
    const token = AuthGuard.getToken();
    if (!token) return;

    fetch(`${API_BASE_URL}/api/v1/document/${docId}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-Page-Type': 'admin'
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show(data.msg || '获取文档信息失败', 'error');
            return;
        }
        const doc = data.data;
        document.getElementById('editDocId').value = doc.id;
        document.getElementById('editDocTitle').value = doc.title || '';
        document.getElementById('editDocVisibility').value = doc.visibility || 'public';
        document.getElementById('editDocContent').value = doc.content || '';
        document.getElementById('docEditModalTitle').textContent = `编辑文档: ${escapeHtml(doc.title)}`;
        document.getElementById('docEditModal').style.display = '';
    })
    .catch(err => {
        console.error('获取文档详情失败:', err);
        if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
    });
}

function closeDocEditModal() {
    document.getElementById('docEditModal').style.display = 'none';
}

async function saveDocEdit() {
    const token = AuthGuard.getToken();
    if (!token) return;

    const docId = document.getElementById('editDocId').value;
    const title = document.getElementById('editDocTitle').value.trim();
    const visibility = document.getElementById('editDocVisibility').value;
    const content = document.getElementById('editDocContent').value;

    if (!title) {
        if (typeof Toast !== 'undefined') Toast.show('请输入标题', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/document/${docId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            },
            body: JSON.stringify({ title, visibility, content })
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            if (typeof Toast !== 'undefined') Toast.show('保存成功', 'success');
            closeDocEditModal();
            loadDocsList(document.getElementById('docSearchInput')?.value || '');
        } else {
            if (typeof Toast !== 'undefined') Toast.show(data.msg || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存文档失败:', error);
        if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
    }
}

async function deleteDoc(docId) {
    const confirmed = await Modal.confirm('确认删除此文档？此操作不可恢复。', { title: '删除文档' });
    if (!confirmed) return;

    const token = AuthGuard.getToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/document/${docId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'admin'
            }
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            if (typeof Toast !== 'undefined') Toast.show('文档已删除', 'success');
            loadDocsList(document.getElementById('docSearchInput')?.value || '');
        } else {
            if (typeof Toast !== 'undefined') Toast.show(data.msg || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除文档失败:', error);
        if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
    }
}

// =========================================
// 初始化事件绑定
// =========================================

document.addEventListener('DOMContentLoaded', () => {
    // 用户管理事件
    initUserSearch();
    document.getElementById('userEditCancelBtn')?.addEventListener('click', closeUserEditModal);
    document.getElementById('userEditSaveBtn')?.addEventListener('click', saveUserEdit);

    // 文档管理事件
    initDocSearch();
    document.getElementById('docEditCancelBtn')?.addEventListener('click', closeDocEditModal);
    document.getElementById('docEditSaveBtn')?.addEventListener('click', saveDocEdit);

    // 点击弹窗外部关闭
    document.getElementById('userEditModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'userEditModal') closeUserEditModal();
    });
    document.getElementById('docEditModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'docEditModal') closeDocEditModal();
    });
});

// =========================================
// 占位组件渲染
// =========================================

function renderPlaceholderPanels() {
    // 系统设置占位
    const settingsPanel = document.getElementById('panel-settings');
    if (settingsPanel) {
        const placeholderContainer = settingsPanel.querySelector('.admin-placeholder');
        if (placeholderContainer && typeof renderPlaceholder === 'function') {
            placeholderContainer.outerHTML = renderPlaceholder('系统设置', '功能正在开发中，敬请期待', '⚙️');
        }
    }

    // 财务管理占位
    const financePanel = document.getElementById('panel-finance');
    if (financePanel) {
        const placeholderContainer = financePanel.querySelector('.admin-placeholder');
        if (placeholderContainer && typeof renderPlaceholder === 'function') {
            placeholderContainer.outerHTML = renderPlaceholder('财务管理', '功能正在开发中，敬请期待', '💰');
        }
    }
}