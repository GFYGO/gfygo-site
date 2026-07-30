/**
 * 管理后台通用脚本
 * 处理侧边栏切换、模态框、标签页切换等通用功能
 */

(function() {
    'use strict';

    // ========== 侧边栏移动端切换 ==========
    const sidebar = document.getElementById('adminSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const menuToggle = document.getElementById('menuToggle');
    const sidebarClose = document.getElementById('sidebarClose');

    function openSidebar() {
        if (sidebar) sidebar.classList.add('admin-sidebar--open');
        if (sidebarOverlay) sidebarOverlay.classList.add('sidebar-overlay--visible');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        if (sidebar) sidebar.classList.remove('admin-sidebar--open');
        if (sidebarOverlay) sidebarOverlay.classList.remove('sidebar-overlay--visible');
        document.body.style.overflow = '';
    }

    if (menuToggle) {
        menuToggle.addEventListener('click', openSidebar);
    }

    if (sidebarClose) {
        sidebarClose.addEventListener('click', closeSidebar);
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // ========== 标签页切换 ==========
    const navItems = document.querySelectorAll('.sidebar__nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();

            // 移除所有 active
            navItems.forEach(nav => nav.classList.remove('active'));

            // 添加当前 active
            this.classList.add('active');

            // 获取目标 panel
            const tabId = this.getAttribute('data-tab');
            if (!tabId) return;

            // 隐藏所有 panel
            const panels = document.querySelectorAll('.tab-panel');
            panels.forEach(panel => panel.style.display = 'none');

            // 显示目标 panel
            const targetPanel = document.getElementById(`panel-${tabId}`);
            if (targetPanel) {
                targetPanel.style.display = 'block';
            }

            // 移动端自动关闭侧边栏
            if (window.innerWidth <= 768) {
                closeSidebar();
            }
        });
    });

    // ========== 模态框通用处理 ==========
    function setupModal(modalId, overlayId, closeId, cancelId) {
        const modal = document.getElementById(modalId);
        const overlay = document.getElementById(overlayId);
        const closeBtn = document.getElementById(closeId);
        const cancelBtn = document.getElementById(cancelId);

        const closeModal = () => {
            if (modal) modal.style.display = 'none';
        };

        if (overlay) overlay.addEventListener('click', closeModal);
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        return { modal, closeModal };
    }

    // 导出模态框设置函数供特定页面使用
    window.adminSetupModal = setupModal;

    // ========== 确认删除模态框（doc-admin.html） ==========
    if (document.getElementById('deleteConfirmModal')) {
        const { modal: deleteModal, closeModal } = setupModal(
            'deleteConfirmModal',
            'deleteConfirmModalOverlay',
            'deleteConfirmModalClose',
            'deleteCancelBtn'
        );

        // 存储删除确认回调
        let deleteCallback = null;

        window.showDeleteConfirm = (text, callback) => {
            const textEl = document.getElementById('deleteConfirmText');
            if (textEl) textEl.textContent = text;
            if (deleteModal) deleteModal.style.display = 'flex';
            deleteCallback = callback;
        };

        const confirmBtn = document.getElementById('deleteConfirmBtn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                closeModal();
                if (deleteCallback) deleteCallback();
            });
        }
    }

    // ========== 编辑文档模态框（doc-admin.html） ==========
    if (document.getElementById('editDocModal')) {
        setupModal('editDocModal', 'editDocModalOverlay', 'editDocModalClose', 'editDocCancelBtn');
    }

    // ========== 文件夹模态框（doc-admin.html） ==========
    if (document.getElementById('folderModal')) {
        setupModal('folderModal', 'folderModalOverlay', 'folderModalClose', 'folderCancelBtn');
    }

    // ========== 编辑用户模态框（user-admin.html） ==========
    if (document.getElementById('editUserModal')) {
        setupModal('editUserModal', 'editUserModalOverlay', 'editUserModalClose', 'editUserCancelBtn');
    }

    // ========== 确认操作模态框（user-admin.html） ==========
    if (document.getElementById('confirmModal')) {
        const { modal: confirmModal, closeModal } = setupModal(
            'confirmModal',
            'confirmModalOverlay',
            'confirmModalClose',
            'confirmCancelBtn'
        );

        let confirmCallback = null;

        window.showConfirmModal = (title, text, callback) => {
            const titleEl = document.getElementById('confirmModalTitle');
            const textEl = document.getElementById('confirmModalText');
            if (titleEl) titleEl.textContent = title;
            if (textEl) textEl.textContent = text;
            if (confirmModal) confirmModal.style.display = 'flex';
            confirmCallback = callback;
        };

        const confirmActionBtn = document.getElementById('confirmActionBtn');
        if (confirmActionBtn) {
            confirmActionBtn.addEventListener('click', () => {
                closeModal();
                if (confirmCallback) confirmCallback();
            });
        }
    }

    // ========== 表格数据加载状态 ==========
    function showTableLoading(tableBodyId) {
        const tbody = document.getElementById(tableBodyId);
        if (!tbody) return;
        const colspan = tbody.closest('table').querySelectorAll('thead th').length;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="admin-table__empty">加载中...</td></tr>`;
    }

    function showTableEmpty(tableBodyId, message = '暂无数据') {
        const tbody = document.getElementById(tableBodyId);
        if (!tbody) return;
        const colspan = tbody.closest('table').querySelectorAll('thead th').length;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="admin-table__empty">${message}</td></tr>`;
    }

    // 导出表格状态函数
    window.adminShowTableLoading = showTableLoading;
    window.adminShowTableEmpty = showTableEmpty;

    // ========== 模态框打开函数 ==========
    window.openModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'flex';
    };

    window.closeModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    };

    // ========== 状态文本映射 ==========
    const statusMap = {
        active: { text: '正常', class: 'status-badge--active' },
        inactive: { text: '未激活', class: 'status-badge--inactive' },
        banned: { text: '已封禁', class: 'status-badge--banned' },
        published: { text: '已发布', class: 'status-badge--published' },
        draft: { text: '草稿', class: 'status-badge--draft' },
        archived: { text: '已归档', class: 'status-badge--archived' }
    };

    window.getStatusBadge = (status) => {
        const info = statusMap[status] || { text: status, class: '' };
        return `<span class="status-badge ${info.class}">${info.text}</span>`;
    };

    // ========== 角色文本映射 ==========
    const roleMap = {
        admin: '管理员',
        user: '普通用户',
        guest: '访客'
    };

    window.getRoleText = (role) => roleMap[role] || role;

    // ========== ESC 键关闭模态框 ==========
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('.admin-modal');
            modals.forEach(modal => {
                if (modal.style.display !== 'none') {
                    modal.style.display = 'none';
                }
            });
        }
    });

    // ========== 工具函数：格式化日期 ==========
    window.formatDate = (dateString) => {
        if (!dateString) return '--';
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    };

    // ========== 占位组件渲染 ==========
    // 在 DOMContentLoaded 后自动渲染权限分配占位
    document.addEventListener('DOMContentLoaded', () => {
        // 权限分配占位（user-admin.html）
        const permissionPanel = document.getElementById('panel-permission-assign');
        if (permissionPanel) {
            const placeholderContainer = permissionPanel.querySelector('.admin-placeholder');
            if (placeholderContainer && typeof renderPlaceholder === 'function') {
                placeholderContainer.outerHTML = renderPlaceholder('权限分配', '功能正在开发中，敬请期待', '🔐');
            }
        }

        // 财务数据占位（finance-admin.html）
        const financePanel = document.getElementById('panel-finance-data');
        if (financePanel) {
            const placeholderContainer = financePanel.querySelector('.admin-placeholder');
            if (placeholderContainer && typeof renderPlaceholder === 'function') {
                placeholderContainer.outerHTML = renderPlaceholder('财务管理', '功能正在开发中，敬请期待', '💰');
            }
        }
    });

    console.log('[Admin] 管理后台脚本已加载');

})();