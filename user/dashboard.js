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

// 动态菜单缓存：tab_key -> { meta, loaded: bool }
const dynamicMenuCache = new Map();
// 静态 tab（与后端动态项 tab_key 冲突时跳过）
const STATIC_TABS = ['workspace', 'home', 'notify', 'settings'];
// 静态 panel 首次加载标记
const staticPanelLoaded = new Set();

// URL 中携带的邮箱验证码（用于邮件链接跳转后自动填入）
let pendingEmailCode = null;

document.addEventListener('DOMContentLoaded', async () => {
    initSidebarToggle();
    initSettingsButton();
    initTabSwitching();

    // 读取 URL 参数中的验证码
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code && /^\d{6}$/.test(code)) {
            pendingEmailCode = code;
            // 清除 URL 参数（避免刷新重复触发）
            const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    } catch (e) {
        console.warn('解析 URL 参数失败', e);
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
            renderUserProfile(user);
            renderPermissionButtons(user.permission_level);
            renderTopNavAuth(user);

            // 检查邮箱验证状态
            checkEmailVerificationStatus(token, user.email);

            // 加载动态菜单（依赖已登录）
            loadDynamicMenu(token);
            // 绑定设置面板主题切换
            initThemeOptions(token);
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
            switchTab('settings');
            closeMobileSidebar();
        });
    }
}

function initTabSwitching() {
    // 默认显示主页
    switchTab('home');

    // 绑定静态项点击
    bindTabClicks();

    // 左下角头像点击切换到主页
    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.style.cursor = 'pointer';
        userTrigger.addEventListener('click', () => {
            switchTab('home');
            closeMobileSidebar();
        });
    }
}

function bindTabClicks() {
    // 绑定所有侧边栏导航项点击（含动态项渲染后新增的），避免重复绑定
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
    const sidebar = document.getElementById('dashboardSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
    if (overlay) overlay.classList.remove('sidebar-overlay--visible');
}

async function switchTab(tab) {
    // 动态项懒加载
    if (dynamicMenuCache.has(tab) && !dynamicMenuCache.get(tab).loaded) {
        await loadPanelContent(tab);
    }
    // 静态 panel 首次加载逻辑（通知中心）
    if (tab === 'notify' && !staticPanelLoaded.has('notify')) {
        staticPanelLoaded.add('notify');
        loadNotifyList();
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

    // 头像区域高亮（主页时激活）
    const userTrigger = document.getElementById('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.classList.toggle('is-active', tab === 'home');
    }

    // 底部设置按钮高亮（设置面板时激活）
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.classList.toggle('is-active', tab === 'settings');
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
            // tab_key 与静态项冲突时跳过
            if (STATIC_TABS.includes(item.tab_key)) {
                console.warn(`[menu] 动态项 tab_key 冲突，跳过: ${item.tab_key}`);
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
            // 创建空 panel（懒加载时填充内容）
            const panel = document.createElement('section');
            panel.className = 'tab-panel';
            panel.id = `panel-${item.tab_key}`;
            panel.style.display = 'none';
            panel.innerHTML = '<p class="loading-text">加载中...</p>';
            contentHost.appendChild(panel);
        });
        // 重新绑定 tab 切换（包含新动态项）
        bindTabClicks();
    } catch (e) {
        console.error('[menu] 加载动态菜单失败', e);
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
        // CSS：独立 <style> 节点追加，便于隔离与清理
        if (d.css_content) {
            const style = document.createElement('style');
            style.dataset.tabStyle = tab;
            style.textContent = d.css_content;
            panel.appendChild(style);
        }
        // JS：innerHTML 的 <script> 不会执行，需重建节点
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

// =========================================
// 通知中心 / 设置 面板逻辑
// =========================================

async function loadNotifyList() {
    const list = document.getElementById('notifyList');
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function initThemeOptions(token) {
    const options = document.getElementById('themeOptions');
    if (!options) return;
    options.addEventListener('click', (e) => {
        const btn = e.target.closest('.theme-opt');
        if (!btn) return;
        const theme = btn.dataset.theme;
        // 复用 theme.js 的 ThemeEngine
        if (typeof ThemeEngine !== 'undefined') {
            ThemeEngine.applyTheme(theme);
            if (token) ThemeEngine.syncThemeToServer(theme, token);
            if (typeof Toast !== 'undefined') Toast.show('主题已切换', 'success');
        }
    });
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

function renderPermissionButtons(permissionLevel) {
    const container = document.getElementById('permissionButtons');
    if (!container) return;

    container.innerHTML = '';

    if (permissionLevel <= 1) return;

    // 管理员用户：显示等级 1 + 从 2 到当前等级的按钮
    // 超级管理员（5）：额外显示等级 0
    const levels = [];
    if (permissionLevel >= 5) levels.push(0);
    levels.push(1);
    for (let level = 2; level <= permissionLevel; level++) {
        levels.push(level);
    }

    levels.forEach(level => {
        const btn = document.createElement('button');
        btn.className = 'perm-btn';
        if (level === 1) {
            btn.classList.add('perm-btn--current');
        }
        btn.textContent = level;
        btn.title = `进入 ${ROLE_NAMES[level] || `等级${level}`} 管理后台`;
        btn.addEventListener('click', () => handlePermissionClick(level));
        container.appendChild(btn);
    });
}

function handlePermissionClick(level) {
    if (level === 0) {
        // 访客视角预览：不清除 token，设置访客模式标记后跳转首页
        localStorage.setItem('guest_view_mode', 'true');
        window.location.href = `${BASE_PATH}/index.html`;
        return;
    }

    // 切换到其他权限等级：清除访客模式
    localStorage.removeItem('guest_view_mode');

    const dashboardPath = encodeURIComponent(window.location.pathname + window.location.search);
    const adminUrl = `${BASE_PATH}/admin/admin${level}.html?from=${dashboardPath}`;
    window.location.href = adminUrl;
}

// =========================================
// 邮箱验证相关函数
// =========================================

async function checkEmailVerificationStatus(token, email) {
    if (!email) {
        // 无邮箱用户不显示验证区域
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/email-status`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            if (!data.data.email_verified) {
                showEmailVerificationSection(email);
            }
        }
    } catch (error) {
        console.error('检查邮箱验证状态失败:', error);
    }
}

function showEmailVerificationSection(email) {
    const section = document.getElementById('emailVerificationSection');
    const descEl = document.getElementById('verificationDesc');

    if (!section) return;

    // 显示邮箱信息
    if (descEl) {
        descEl.textContent = `验证邮箱: ${email}`;
    }

    section.style.display = 'block';

    // 绑定验证按钮
    const verifyBtn = document.getElementById('verifyEmailBtn');
    const codeInput = document.getElementById('verificationCodeInput');
    const resendBtn = document.getElementById('resendCodeBtn');

    if (verifyBtn && codeInput) {
        verifyBtn.addEventListener('click', () => handleVerifyEmail(codeInput.value));
    }

    if (resendBtn) {
        resendBtn.addEventListener('click', handleResendCode);
    }

    // 若 URL 中携带了验证码：自动填入 + 复制到剪贴板
    if (pendingEmailCode && codeInput) {
        codeInput.value = pendingEmailCode;

        // 尝试复制到剪贴板
        let copied = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(pendingEmailCode).then(() => {
                    copied = true;
                }).catch(() => {
                    copied = fallbackCopy(pendingEmailCode);
                });
            } else {
                copied = fallbackCopy(pendingEmailCode);
            }
        } catch (e) {
            console.warn('复制验证码失败', e);
        }

        if (typeof Toast !== 'undefined') {
            setTimeout(() => {
                if (copied) {
                    Toast.show('验证码已自动填入并复制到剪贴板 ✓', 'success');
                } else {
                    Toast.show('验证码已自动填入，请手动复制', 'info');
                }
            }, 300);
        }

        // 一次性消费
        pendingEmailCode = null;
    }
}

// 兼容旧浏览器的复制方案
function fallbackCopy(text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (e) {
        return false;
    }
}

async function handleVerifyEmail(code) {
    if (!code || code.length !== 6) {
        Toast.show('请输入6位验证码');
        return;
    }

    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    const verifyBtn = document.getElementById('verifyEmailBtn');
    const codeInput = document.getElementById('verificationCodeInput');

    try {
        verifyBtn.disabled = true;
        verifyBtn.textContent = '验证中...';

        const response = await fetch(`${API_BASE_URL}/api/v1/auth/verify-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ code })
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            Toast.show('邮箱验证成功！', 'success');
            // 隐藏验证区域
            const section = document.getElementById('emailVerificationSection');
            if (section) section.style.display = 'none';
        } else {
            Toast.show(data.msg || '验证失败');
        }
    } catch (error) {
        console.error('邮箱验证失败:', error);
        Toast.show('网络错误，请重试');
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = '验证';
        codeInput.value = '';
    }
}

async function handleResendCode() {
    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    const resendBtn = document.getElementById('resendCodeBtn');

    try {
        resendBtn.disabled = true;
        resendBtn.textContent = '发送中...';

        const response = await fetch(`${API_BASE_URL}/api/v1/auth/resend-verification`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            Toast.show('验证码已发送至您的邮箱', 'success');
        } else {
            Toast.show(data.msg || '发送失败');
        }
    } catch (error) {
        console.error('重发验证码失败:', error);
        Toast.show('网络错误，请重试');
    } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = '重新发送验证码';
    }
}
