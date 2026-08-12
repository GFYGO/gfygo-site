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
        const res = await fetch(`${API_BASE_URL}/api/v1/user/menu`, { headers });
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
    const baseContainer = document.getElementById('dynamicMenuContainer');
    const baseDivider = document.getElementById('dynamicMenuDivider');
    if (baseContainer && data.base_items && data.base_items.length > 0) {
        baseContainer.innerHTML = data.base_items.map(item => `
            <a href="#" class="sidebar__nav-item" data-tab="${item.tab_key}">
                <span class="sidebar__nav-icon">${item.icon}</span>
                <span class="sidebar__nav-text">${item.label}</span>
            </a>
        `).join('');
        baseContainer.querySelectorAll('.sidebar__nav-item').forEach(bindTabClick);
    }

    const dynamicContainer = document.getElementById('dynamicMenuContainer');
    const dynamicDivider = document.getElementById('dynamicMenuDivider');
    if (dynamicContainer && data.dynamic_items && data.dynamic_items.length > 0) {
        if (data.base_items && data.base_items.length > 0) {
            dynamicDivider.style.display = '';
        }
        dynamicContainer.innerHTML += data.dynamic_items.map(item => `
            <a href="#" class="sidebar__nav-item dynamic-only" data-tab="${item.tab_key}">
                <span class="sidebar__nav-icon">${item.icon || '📄'}</span>
                <span class="sidebar__nav-text">${item.label}</span>
            </a>
        `).join('');
        dynamicContainer.querySelectorAll('.sidebar__nav-item.dynamic-only').forEach(bindTabClick);
    } else if (dynamicContainer && (!data.base_items || data.base_items.length === 0)) {
        dynamicContainer.innerHTML = '';
        dynamicDivider.style.display = 'none';
    }

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
}

function bindTabClick(item) {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabKey = item.dataset.tab;
        if (tabKey) switchTab(tabKey);
    });
}

async function switchTab(tabKey) {
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

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
        const res = await fetch(`${API_BASE_URL}/api/v1/user/dynamic-page/${encodeURIComponent(tabKey)}`, { headers });
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