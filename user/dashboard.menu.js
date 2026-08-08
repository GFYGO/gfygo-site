/**
 * dashboard.menu.js
 * 动态菜单懒加载、Tab 切换
 */

// 动态菜单缓存
const dynamicMenuCache = new Map();
// 静态 tab（与后端动态项 tab_key 冲突时跳过）
const STATIC_TABS = ['workspace', 'home', 'notify', 'settings', 'personal-docs'];
// 静态 panel 首次加载标记
const staticPanelLoaded = new Set();

/** 初始化 Tab 切换 */
function initTabSwitching() {
    const savedTab = localStorage.getItem('dashboard_active_tab') || 'home';
    const hasPanel = $('panel-' + savedTab);
    if (hasPanel) {
        switchTab(savedTab, true);
    } else {
        switchTab('home', true);
    }

    bindTabClicks();
}

/** 绑定导航项点击 */
function bindTabClicks() {
    $$('.sidebar__nav-item[data-tab]').forEach(item => {
        if (item.dataset.bound === '1') return;
        item.dataset.bound = '1';
        on(item, 'click', (e) => {
            e.preventDefault();
            switchTab(item.dataset.tab);
            const overlay = $('sidebarOverlay');
            const sidebar = $('dashboardSidebar');
            if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
            if (overlay) overlay.classList.remove('sidebar-overlay--visible');
        });
    });
}

/** 切换 Tab */
async function switchTab(tab, skipSave = false) {
    if (!skipSave) {
        localStorage.setItem('dashboard_active_tab', tab);
    }

    if (dynamicMenuCache.has(tab) && !dynamicMenuCache.get(tab).loaded) {
        await loadPanelContent(tab);
    }
    if (tab === 'notify' && !staticPanelLoaded.has('notify')) {
        staticPanelLoaded.add('notify');
        loadNotifyList();
    }
    if (tab === 'personal-docs' && !staticPanelLoaded.has('personal-docs')) {
        staticPanelLoaded.add('personal-docs');
        if (typeof window.initPersonalDocs === 'function') {
            window.initPersonalDocs();
        }
    }
    if (tab === 'public-docs' && !staticPanelLoaded.has('public-docs')) {
        staticPanelLoaded.add('public-docs');
        if (typeof window.initPublicDocs === 'function') {
            window.initPublicDocs();
        }
    }

    $$('.tab-panel').forEach(panel => {
        panel.style.display = 'none';
    });
    const targetPanel = $('panel-' + tab);
    if (targetPanel) targetPanel.style.display = '';

    $$('.sidebar__nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tab);
    });

    const userTrigger = $('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.classList.toggle('is-active', tab === 'home');
    }

    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
        settingsBtn.classList.toggle('is-active', tab === 'settings');
    }

    if (tab === 'settings') {
        if (typeof window.renderDeletionStatus === 'function') {
            window.renderDeletionStatus();
        }
    }
}

/** 加载动态菜单 */
async function loadDynamicMenu(token) {
    const container = $('dynamicMenuContainer');
    const divider = $('dynamicMenuDivider');
    if (!container) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/user/menu`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.code !== 200 || !Array.isArray(data.data)) return;

        const items = data.data;
        if (items.length === 0) {
            divider.style.display = 'none';
            return;
        }
        divider.style.display = '';

        const contentHost = document.querySelector('.dashboard-content');
        items.forEach(item => {
            if (STATIC_TABS.includes(item.tab_key)) {
                console.warn(`[menu] 动态项 tab_key 冲突，跳过: ${item.tab_key}`);
                return;
            }
            dynamicMenuCache.set(item.tab_key, { meta: item, loaded: false });
            const a = document.createElement('a');
            a.href = '#';
            a.className = 'sidebar__nav-item';
            a.dataset.tab = item.tab_key;
            a.innerHTML = `<span class="sidebar__nav-icon">${item.icon || '📄'}</span>
                           <span class="sidebar__nav-text">${item.label}</span>`;
            container.appendChild(a);
            const panel = document.createElement('section');
            panel.className = 'tab-panel';
            panel.id = 'panel-' + item.tab_key;
            panel.style.display = 'none';
            panel.innerHTML = '<p class="loading-text">加载中...</p>';
            contentHost.appendChild(panel);
        });
        bindTabClicks();

        const savedTab = localStorage.getItem('dashboard_active_tab');
        if (savedTab && dynamicMenuCache.has(savedTab)) {
            const currentActive = document.querySelector('.sidebar__nav-item.active')?.dataset.tab;
            if (currentActive !== savedTab) {
                switchTab(savedTab, true);
            }
        }
    } catch (e) {
        console.error('[menu] 加载动态菜单失败', e);
    }
}

/** 懒加载面板内容 */
async function loadPanelContent(tab) {
    const cache = dynamicMenuCache.get(tab);
    if (!cache || cache.loaded) return;
    const token = AuthGuard.getToken();
    if (!token) return;
    const panel = $('panel-' + tab);
    if (!panel) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/user/menu/${cache.meta.id}/content`, {
            headers: { 'Authorization': `Bearer ${token}` }
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
        console.error('[menu] 加载 panel 内容失败', e);
        panel.innerHTML = '<p class="loading-text">内容加载失败</p>';
    }
}

/** 加载通知列表 */
async function loadNotifyList() {
    const list = $('notifyList');
    if (!list) return;
    const token = AuthGuard.getToken();
    try {
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE_URL}/api/v1/notify/global`, { headers });
        const data = await res.json();
        if (data.code !== 200 || !Array.isArray(data.data) || data.data.length === 0) {
            list.innerHTML = '<p class="loading-text">暂无通知</p>';
            return;
        }
        list.innerHTML = data.data.map(n => `
            <div class="notify-card">
                <h4 class="notify-card__title">${escapeHtml(n.title)}</h4>
                <p class="notify-card__content">${escapeHtml(n.content)}</p>
            </div>
        `).join('');
    } catch (e) {
        console.error('加载通知失败', e);
        list.innerHTML = '<p class="loading-text">通知加载失败</p>';
    }
}
