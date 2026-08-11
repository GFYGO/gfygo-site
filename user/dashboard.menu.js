/**
 * dashboard.menu.js - 动态菜单与 Tab 切换
 * 由 dashboard.js 调用初始化
 */

let _menuData = null;

async function loadMenu() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/user/menu`, {
            headers: { 'Authorization': `Bearer ${AuthGuard.getToken()}` }
        });
        if (!res.ok) throw new Error('Failed to load menu');
        _menuData = await res.json();
        if (_menuData.code === 200) {
            renderMenu(_menuData.data);
        }
        return _menuData.data;
    } catch (e) {
        console.error('[MENU] 加载菜单失败:', e);
        return null;
    }
}

function renderMenu(data) {
    // 渲染 admin 专属菜单
    const adminContainer = document.getElementById('adminMenuContainer');
    const adminDivider = document.getElementById('adminMenuDivider');
    if (adminContainer && data.admin_items && data.admin_items.length > 0) {
        adminDivider.style.display = '';
        adminContainer.innerHTML = data.admin_items.map(item => `
            <a href="#" class="sidebar__nav-item admin-only" data-tab="${item.tab_key}">
                <span class="sidebar__nav-icon">${item.icon}</span>
                <span class="sidebar__nav-text">${item.label}</span>
            </a>
        `).join('');
        adminContainer.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
    } else if (adminContainer) {
        adminContainer.innerHTML = '';
        adminDivider.style.display = 'none';
    }

    // 渲染动态菜单
    const dynamicContainer = document.getElementById('dynamicMenuContainer');
    const dynamicDivider = document.getElementById('dynamicMenuDivider');
    if (dynamicContainer && data.dynamic_items && data.dynamic_items.length > 0) {
        dynamicDivider.style.display = '';
        dynamicContainer.innerHTML = data.dynamic_items.map(item => `
            <a href="#" class="sidebar__nav-item dynamic-only" data-tab="${item.tab_key}">
                <span class="sidebar__nav-icon">${item.icon || '📄'}</span>
                <span class="sidebar__nav-text">${item.label}</span>
            </a>
        `).join('');
        dynamicContainer.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
    } else if (dynamicContainer) {
        dynamicContainer.innerHTML = '';
        dynamicDivider.style.display = 'none';
    }
}

function bindTabClick(item) {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabKey = item.dataset.tab;
        if (tabKey) switchTab(tabKey);
    });
}

async function switchTab(tabKey) {
    // 隐藏所有静态 panel
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

    // 清空动态内容
    const dynamicContainer = document.getElementById('dynamicContentContainer');
    if (dynamicContainer) dynamicContainer.innerHTML = '';

    // 高亮导航项
    document.querySelectorAll('.sidebar__nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabKey);
    });

    // 静态面板
    const panel = document.getElementById(`panel-${tabKey}`);
    if (panel) {
        panel.style.display = '';
        if (tabKey === 'workspace' && window.initCheckinModule) {
            window.initCheckinModule();
        }
        if (tabKey === 'notifications' && typeof window.loadNotifyList === 'function') {
            window.loadNotifyList();
        }
        if (tabKey === 'docs' && typeof window.initPersonalDocs === 'function') {
            window.initPersonalDocs();
        }
        if (tabKey === 'settings' && typeof window.renderDeletionStatus === 'function') {
            window.renderDeletionStatus();
        }
        return;
    }

    // 动态面板（admin 专属或 AI 生成）
    const data = _menuData ? _menuData.data : null;
    const isAdmin = data && (data.admin_items || []).some(i => i.tab_key === tabKey);
    const isDynamic = data && (data.dynamic_items || []).some(i => i.tab_key === tabKey);

    if (isAdmin || isDynamic) {
        await loadAndInjectPage(tabKey);
    }
}

async function loadAndInjectPage(tabKey) {
    const dynamicContainer = document.getElementById('dynamicContentContainer');
    if (!dynamicContainer) return;

    dynamicContainer.innerHTML = '<p class="loading-text">加载中...</p>';

    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/user/dynamic-page/${encodeURIComponent(tabKey)}`, {
            headers: { 'Authorization': `Bearer ${AuthGuard.getToken()}` }
        });
        if (!res.ok) {
            dynamicContainer.innerHTML = '<p class="empty-state__text">加载失败</p>';
            return;
        }
        const r = await res.json();
        if (r.code === 200 && r.data) {
            const d = r.data;
            let html = d.html_content || '';
            dynamicContainer.innerHTML = html;

            // 执行内联 <script> 标签（innerHTML 不会自动执行）
            const scripts = dynamicContainer.querySelectorAll('script');
            scripts.forEach(s => {
                const newScript = document.createElement('script');
                if (s.src) {
                    newScript.src = s.src;
                } else {
                    newScript.textContent = s.textContent;
                }
                document.head.appendChild(newScript);
                if (!s.src) {
                    // 内联脚本：立即执行一次后移除
                    try { eval(s.textContent); } catch(e) { console.error('[ADMIN SCRIPT]', e); }
                    document.head.removeChild(newScript);
                }
            });

            if (d.css_content) {
                const style = document.createElement('style');
                style.textContent = d.css_content;
                document.head.appendChild(style);
            }

            if (d.js_content) {
                try { eval(d.js_content); } catch(e) { console.error(e); }
            }

            document.dispatchEvent(new CustomEvent('dashboard:tab-switched', { detail: { tabKey } }));
        } else {
            dynamicContainer.innerHTML = '<p class="empty-state__text">' + (r.msg || '加载失败') + '</p>';
        }
    } catch (e) {
        console.error('[MENU] 加载页面失败:', e);
        dynamicContainer.innerHTML = '<p class="empty-state__text">加载失败</p>';
    }
}

function getCurrentMenuData() {
    return _menuData ? _menuData.data : null;
}

// ====== Admin 页面初始化 ======
// 注：admin 页面的所有逻辑已内联在各 HTML 文件的 <script> 中，
// dashboard:tab-switched 事件仅用于必要的全局联动。
document.addEventListener('dashboard:tab-switched', (e) => {
    const tabKey = e.detail?.tabKey;
    if (!tabKey) return;
    // 如需全局联动（如刷新菜单），可在此添加
});

// 暴露到 window
window.DashboardMenu = { loadMenu, renderMenu, switchTab, getCurrentMenuData };