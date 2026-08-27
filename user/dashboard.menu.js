/**
 * dashboard.menu.js
 * 动态菜单与 Tab 切换
 * Phase 2: ES Module — 共享资源通过 window 访问
 */
import { renderDeletionStatus } from './dashboard.deletion.js';

var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL;
var $ = window.$;

let _menuData = null;

async function loadMenu() {
    try {
        const token = AuthGuard.getToken();
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(`${API_BASE_URL}/api/v0/user/menu`, { headers });
        if(res.status === 401 || res.status === 422){
            AuthGuard.handleAuthError();
            return;
        }
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
    // 渲染基础菜单
    const baseContainer = document.getElementById('dynamicMenuContainer');
    const baseDivider = document.getElementById('dynamicMenuDivider');
    let hasBase = renderMenuItems(baseContainer, data.base_items, '', baseDivider);

    // 渲染动态菜单
    let hasDynamic = false;
    if (baseContainer && data.dynamic_items && data.dynamic_items.length > 0) {
        hasDynamic = renderMenuItems(baseContainer, data.dynamic_items, 'dynamic-only', baseDivider, hasBase);
    } else if (baseContainer && !hasBase) {
        baseContainer.innerHTML = '';
        if (baseDivider) baseDivider.style.display = 'none';
    }

    // 渲染管理员菜单
    const adminContainer = document.getElementById('adminMenuContainer');
    const adminDivider = document.getElementById('adminMenuDivider');
    if (adminContainer) {
        if (data.admin_items && data.admin_items.length > 0) {
            renderMenuItems(adminContainer, data.admin_items, 'admin-only', adminDivider);
        } else {
            adminContainer.innerHTML = '';
            if (adminDivider) adminDivider.style.display = 'none';
        }
    }
}

function renderMenuItems(container, items, extraClass, divider, showDivider) {
    if (!container || !items || items.length === 0) return showDivider || false;
    const cls = extraClass ? `sidebar__nav-item ${extraClass}` : 'sidebar__nav-item';
    container.innerHTML = items.map(item => `
        <a href="#" class="${cls}" data-tab="${item.tab_key}">
            <span class="sidebar__nav-icon">${item.icon || '📄'}</span>
            <span class="sidebar__nav-text">${item.label}</span>
        </a>
    `).join('');
    container.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
    if (divider && showDivider !== undefined) divider.style.display = showDivider ? '' : 'none';
    return true;
}

function bindTabClick(item) {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabKey = item.dataset.tab;
        if (tabKey) switchTab(tabKey, { reset: true });
    });
}

async function switchTab(tabKey, opts) {
    opts = opts || {};
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

    // URL 状态同步：用户点击时重置 folder/doc/mode（回到 tab 根），URL 恢复时保留
    if (window.DashUrl) {
        if (opts.reset) window.DashUrl.write({ tab: tabKey, folder: null, doc: null, mode: null });
        else window.DashUrl.write({ tab: tabKey });
    }

    const dynamicContainer = document.getElementById('dynamicContentContainer');
    if (dynamicContainer) dynamicContainer.innerHTML = '';

    document.querySelectorAll('.sidebar__nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabKey);
    });

    const panel = document.getElementById(`panel-${tabKey}`);
    if (panel) {
        panel.style.display = '';
        if (tabKey === 'settings') {
            renderDeletionStatus();
        }
        return;
    }

    await loadAndInjectPage(tabKey);
}

async function loadAndInjectPage(tabKey) {
    const dynamicContainer = document.getElementById('dynamicContentContainer');
    if (!dynamicContainer) return;

    dynamicContainer.innerHTML = '<p class="loading-text">加载中...</p>';

    try {
        const token = AuthGuard.getToken();
        const headers = {};
        if(token) headers['Authorization'] = 'Bearer '+token;
        const res = await fetch(`${API_BASE_URL}/api/v0/user/dynamic-page/${encodeURIComponent(tabKey)}`, { headers });
        if(res.status === 401 || res.status === 422){
            AuthGuard.handleAuthError();
            return;
        }
        if (!res.ok) {
            dynamicContainer.innerHTML = '<p class="empty-state__text">加载失败</p>';
            return;
        }
        const r = await res.json();
        if (r.code === 200 && r.data) {
            const d = r.data;
            let html = d.html_content || '';
            dynamicContainer.innerHTML = html;

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
                    try { eval(s.textContent); } catch(e) { console.error('[SCRIPT]', e); }
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

// ===== ES Module exports =====
const DashboardMenu = { loadMenu, renderMenu, switchTab, getCurrentMenuData };
export default DashboardMenu;
export { loadMenu, renderMenu, switchTab, getCurrentMenuData, DashboardMenu };

// ===== 兼容层 =====
window.DashboardMenu = DashboardMenu;