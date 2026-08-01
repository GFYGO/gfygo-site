/**
 * superadmin/dashboard.js - 超级管理员专属逻辑（占位）
 * 在共享 user/dashboard.js 之后执行，可访问已初始化的 DOM 和全局状态。
 * 当前为功能占位，后续填充超管专属功能（如公有文档管理、系统配置等）。
 */
(function () {
    'use strict';

    // 当前管理员等级（superadmin=5 超级管理员）
    const ADMIN_LEVEL = 5;
    const ADMIN_NAME = '超级管理员';

    // 暴露给全局供其他逻辑使用
    window.__adminLevel = ADMIN_LEVEL;
    window.__adminName = ADMIN_NAME;

    // 工作台面板占位文案定制
    const workspacePanel = document.getElementById('panel-workspace');
    if (workspacePanel) {
        const emptyText = workspacePanel.querySelector('.empty-state__text');
        if (emptyText) {
            emptyText.textContent = `${ADMIN_NAME}专属工作台功能开发中，敬请期待`;
        }
        const emptyIcon = workspacePanel.querySelector('.empty-state__icon');
        if (emptyIcon) {
            emptyIcon.textContent = '🛠️';
        }
    }

    console.log(`[superadmin] ${ADMIN_NAME}专属 JS 已加载 (level ${ADMIN_LEVEL})`);
})();
