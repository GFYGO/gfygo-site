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
const STATIC_TABS = ['workspace', 'home', 'notify', 'settings', 'personal-docs'];
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
            pdocsCurrentUserId = user.id;
            renderUserProfile(user);
            renderPermissionButtons(user.permission_level);
            renderTopNavAuth(user);

            // 检查邮箱验证状态
            checkEmailVerificationStatus(token, user.email);

            // 加载动态菜单（依赖已登录）
            loadDynamicMenu(token);
            // 绑定设置面板主题切换
            initThemeOptions(token);
            // 初始化日历打卡
            initCheckinCalendar(user.id);
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
    // 恢复上次保存的 tab，默认主页
    const savedTab = localStorage.getItem('dashboard_active_tab') || 'home';
    const hasPanel = document.getElementById(`panel-${savedTab}`);
    if (hasPanel) {
        switchTab(savedTab, true);
    } else {
        switchTab('home', true);
    }

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

async function switchTab(tab, skipSave = false) {
    if (!skipSave) {
        localStorage.setItem('dashboard_active_tab', tab);
    }

    // 动态项懒加载
    if (dynamicMenuCache.has(tab) && !dynamicMenuCache.get(tab).loaded) {
        await loadPanelContent(tab);
    }
    // 静态 panel 首次加载逻辑（通知中心）
    if (tab === 'notify' && !staticPanelLoaded.has('notify')) {
        staticPanelLoaded.add('notify');
        loadNotifyList();
    }
    // 个人文档首次加载
    if (tab === 'personal-docs' && !staticPanelLoaded.has('personal-docs')) {
        staticPanelLoaded.add('personal-docs');
        initPersonalDocs();
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

        // 若上次保存的 tab 是动态项，恢复切换
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

/* ========== 日历打卡系统 ========== */

const CHECKIN_KEY_PREFIX = 'checkin_record_';
let calendarState = null;

function getCheckinStorageKey(userId) {
    return `${CHECKIN_KEY_PREFIX}${userId}`;
}

function loadCheckinRecords(userId) {
    try {
        const raw = localStorage.getItem(getCheckinStorageKey(userId));
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function saveCheckinRecords(userId, records) {
    try {
        localStorage.setItem(getCheckinStorageKey(userId), JSON.stringify(records));
    } catch (e) {
        console.warn('保存打卡记录失败', e);
    }
}

function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function initCheckinCalendar(userId) {
    const calEl = document.getElementById('calDays');
    const titleEl = document.getElementById('calTitle');
    const prevBtn = document.getElementById('calPrev');
    const nextBtn = document.getElementById('calNext');
    const checkinBtn = document.getElementById('checkinBtn');
    if (!calEl || !titleEl || !prevBtn || !nextBtn || !checkinBtn) return;

    const today = new Date();
    calendarState = {
        userId: userId,
        viewYear: today.getFullYear(),
        viewMonth: today.getMonth(),
        today: today,
        records: loadCheckinRecords(userId)
    };

    prevBtn.addEventListener('click', () => {
        calendarState.viewMonth--;
        if (calendarState.viewMonth < 0) {
            calendarState.viewMonth = 11;
            calendarState.viewYear--;
        }
        renderCalendar();
    });
    nextBtn.addEventListener('click', () => {
        calendarState.viewMonth++;
        if (calendarState.viewMonth > 11) {
            calendarState.viewMonth = 0;
            calendarState.viewYear++;
        }
        renderCalendar();
    });
    checkinBtn.addEventListener('click', () => handleCheckin());

    renderCalendar();
}

function renderCalendar() {
    const calEl = document.getElementById('calDays');
    const titleEl = document.getElementById('calTitle');
    const checkinBtn = document.getElementById('checkinBtn');
    if (!calEl || !titleEl || !checkinBtn || !calendarState) return;

    const { viewYear, viewMonth, today, records } = calendarState;

    titleEl.textContent = `${viewYear}年${viewMonth + 1}月`;

    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startWeekday = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();

    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

    calEl.innerHTML = '';

    // 上个月的补充日期
    for (let i = startWeekday - 1; i >= 0; i--) {
        const dayNum = prevMonthLastDay - i;
        const span = document.createElement('span');
        span.className = 'calendar-day calendar-day--outside';
        span.textContent = dayNum;
        calEl.appendChild(span);
    }

    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    let alreadyCheckedToday = false;

    // 本月日期
    for (let d = 1; d <= daysInMonth; d++) {
        const span = document.createElement('span');
        span.className = 'calendar-day';
        span.textContent = d;

        const thisDate = new Date(viewYear, viewMonth, d);
        const key = dateKey(viewYear, viewMonth, d);

        if (isSameDay(thisDate, today)) {
            span.classList.add('calendar-day--today');
        }
        if (records[key]) {
            span.classList.add('calendar-day--checked');
            if (key === todayKey) alreadyCheckedToday = true;
        }

        calEl.appendChild(span);
    }

    // 下个月的补充日期，填满 7 列
    const totalCells = startWeekday + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
        const span = document.createElement('span');
        span.className = 'calendar-day calendar-day--outside';
        span.textContent = i;
        calEl.appendChild(span);
    }

    // 更新打卡按钮状态
    if (alreadyCheckedToday) {
        checkinBtn.disabled = true;
        checkinBtn.textContent = '✓ 今日已打卡';
    } else {
        checkinBtn.disabled = false;
        checkinBtn.textContent = '打卡签到';
    }
}

function handleCheckin() {
    if (!calendarState) return;
    const { userId, today, records } = calendarState;
    const key = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

    if (records[key]) {
        Toast.show('今日已打卡', 'info');
        return;
    }

    records[key] = true;
    saveCheckinRecords(userId, records);
    calendarState.records = records;

    renderCalendar();

    if (typeof Toast !== 'undefined') {
        Toast.show('打卡成功！继续加油 💪', 'success');
    }
}


// =========================================
// 个人文档相关函数
// =========================================

let pdocsEditingId = null;      // 当前编辑的文档 id（null=新建）
let pdocsMarkedReady = false;   // marked.js 是否已加载
let pdocsMarkedLoading = null;  // 加载中的 Promise（防重复）
let pdocsFolders = [];          // 当前用户的个人文件夹列表
let pdocsCurrentFolderId = null; // null=全部；0=未归类；正整数=该文件夹
let pdocsCurrentUserId = null;   // 从 auth/status 拿到，用于过滤个人文件夹

/** 统一请求封装（统一走 /api/v1/document 接口） */
async function pdocsRequest(path, options = {}) {
    const token = AuthGuard.getToken();
    if (!token) { AuthGuard.handleAuthError(); return null; }
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/document${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(options.headers || {})
            }
        });
        if (res.status === 401) { AuthGuard.handleAuthError(); return null; }
        return await res.json();
    } catch (e) {
        console.error('[pdocs] 请求失败:', e);
        if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
        return null;
    }
}

/** 动态加载 marked.js（用于 Markdown 预览） */
function ensureMarkedLoaded() {
    if (pdocsMarkedReady) return Promise.resolve();
    if (pdocsMarkedLoading) return pdocsMarkedLoading;
    pdocsMarkedLoading = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
        s.onload = () => { pdocsMarkedReady = true; resolve(); };
        s.onerror = () => { console.warn('[pdocs] marked.js 加载失败'); resolve(); };
        document.head.appendChild(s);
    });
    return pdocsMarkedLoading;
}

/** HTML 转义 */
function pdocsEscape(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/** 格式化时间 */
function pdocsFmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + ' 天前';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 从 Markdown 提取摘要（取第一段非空文本，截断 100 字） */
function pdocsExtractSummary(content) {
    if (!content) return '';
    const text = content.replace(/^#+\s.*$/gm, '').replace(/[*`>~_\-\[\]\(\)]/g, '').trim();
    const firstLine = text.split('\n').find(l => l.trim()) || '';
    return firstLine.slice(0, 100);
}

/** 初始化个人文档：绑定事件 + 加载列表 */
function initPersonalDocs() {
    // 绑定按钮事件（防重复）
    const bind = (id, handler) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.pdocsBound) {
            el.dataset.pdocsBound = '1';
            el.addEventListener('click', handler);
        }
    };
    bind('pdocsNewBtn', () => openPdocsEditor(null));
    bind('pdocsTrashBtn', () => showPdocsView('trash'));
    bind('pdocsTrashBackBtn', () => showPdocsView('list'));
    bind('pdocsBackBtn', () => showPdocsView('list'));
    bind('pdocsSaveBtn', savePersonalDoc);
    bind('pdocsPreviewToggleBtn', togglePdocsPreview);

    // 编辑器实时预览
    const contentInput = document.getElementById('pdocsContentInput');
    if (contentInput && !contentInput.dataset.pdocsBound) {
        contentInput.dataset.pdocsBound = '1';
        contentInput.addEventListener('input', () => {
            const preview = document.getElementById('pdocsPreview');
            if (preview.style.display !== 'none') renderPdocsPreview();
        });
    }

    loadPersonalDocs();
    loadPersonalFolders();
}

/** 切换子视图 */
function showPdocsView(viewName) {
    ['list', 'editor', 'trash'].forEach(v => {
        const el = document.getElementById(`pdocs-view-${v}`);
        if (el) el.style.display = (v === viewName) ? '' : 'none';
    });
    if (viewName === 'list') loadPersonalDocs();
    if (viewName === 'trash') loadPersonalTrash();
}

/** 加载文档列表（当前用户创建的正常文档） */
async function loadPersonalDocs() {
    const container = document.getElementById('pdocsListContainer');
    if (!container) return;
    container.innerHTML = '<p class="loading-text">加载中...</p>';

    // 根据 pdocsCurrentFolderId 拼接 folder_id query
    // null=不拼（全部）；0=未归类；正整数=该文件夹下
    let query = '';
    if (pdocsCurrentFolderId === 0 || (typeof pdocsCurrentFolderId === 'number' && pdocsCurrentFolderId > 0)) {
        query = `folder_id=${pdocsCurrentFolderId}`;
    }
    const data = await pdocsRequest('/mine' + (query ? '?' + query : ''));
    if (!data || data.code !== 200) {
        container.innerHTML = '<p class="loading-text">加载失败</p>';
        return;
    }
    renderPdocsList(data.data || []);
}

/** 加载回收站列表 */
async function loadPersonalTrash() {
    const container = document.getElementById('pdocsTrashContainer');
    if (!container) return;
    container.innerHTML = '<p class="loading-text">加载中...</p>';

    const data = await pdocsRequest('/trash');
    if (!data || data.code !== 200) {
        container.innerHTML = '<p class="loading-text">加载失败</p>';
        return;
    }
    renderPdocsTrash(data.data || []);
}

/** 渲染文档列表 */
function renderPdocsList(docs) {
    const container = document.getElementById('pdocsListContainer');
    if (!container) return;

    if (!docs.length) {
        container.innerHTML = `
            <div class="pdocs-empty">
                <div class="pdocs-empty__icon">📝</div>
                <p class="pdocs-empty__text">还没有文档，点击「新建文档」开始记录</p>
            </div>`;
        return;
    }

    container.innerHTML = docs.map(doc => `
        <div class="pdocs-doc-card" data-doc-id="${doc.id}">
            <div class="pdocs-doc-card__header">
                <span class="pdocs-doc-card__icon">${pdocsEscape(doc.icon || '📄')}</span>
                <h3 class="pdocs-doc-card__title">${pdocsEscape(doc.title)}</h3>
            </div>
            <p class="pdocs-doc-card__summary">${pdocsEscape(doc.summary || pdocsExtractSummary(doc.content) || '无内容')}</p>
            <div class="pdocs-doc-card__footer">
                <span class="pdocs-doc-card__time">更新于 ${pdocsFmtTime(doc.updated_at)}</span>
                <div class="pdocs-doc-card__actions">
                    <select class="pdocs-move-select" data-action="move" data-id="${doc.id}" title="移动到文件夹">
                        <option value="" disabled selected>📁 移动到...</option>
                        <option value="0">无文件夹</option>
                        ${pdocsFolders.map(f => `<option value="${f.id}" ${doc.folder_id === f.id ? 'selected' : ''}>${pdocsEscape(f.name)}</option>`).join('')}
                    </select>
                    <button class="pdocs-btn pdocs-btn--ghost pdocs-btn--sm" data-action="edit" data-id="${doc.id}">编辑</button>
                    <button class="pdocs-btn pdocs-btn--danger pdocs-btn--sm" data-action="delete" data-id="${doc.id}">删除</button>
                </div>
            </div>
        </div>
    `).join('');

    // 绑定卡片操作
    container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id, 10);
            if (action === 'edit') openPdocsEditor(id);
            else if (action === 'delete') softDeletePersonalDoc(id);
            // action === 'move' 由 select 的 change 事件处理
        });
    });

    // 绑定"移动到文件夹"下拉框
    container.querySelectorAll('.pdocs-move-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const docId = parseInt(sel.dataset.id, 10);
            const folderId = parseInt(sel.value, 10);
            movePersonalDoc(docId, folderId);
        });
    });

    // 点击卡片也可编辑
    container.querySelectorAll('.pdocs-doc-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = parseInt(card.dataset.docId, 10);
            openPdocsEditor(id);
        });
    });
}

/** 渲染回收站列表 */
function renderPdocsTrash(docs) {
    const container = document.getElementById('pdocsTrashContainer');
    if (!container) return;

    if (!docs.length) {
        container.innerHTML = `
            <div class="pdocs-empty">
                <div class="pdocs-empty__icon">🗑</div>
                <p class="pdocs-empty__text">回收站为空</p>
            </div>`;
        return;
    }

    container.innerHTML = docs.map(doc => `
        <div class="pdocs-trash-item">
            <div class="pdocs-trash-item__info">
                <span class="pdocs-trash-item__icon">${pdocsEscape(doc.icon || '📄')}</span>
                <div>
                    <h4 class="pdocs-trash-item__title">${pdocsEscape(doc.title)}</h4>
                    <span class="pdocs-trash-item__time">删除于 ${pdocsFmtTime(doc.deleted_at)}</span>
                </div>
            </div>
            <div class="pdocs-trash-item__actions">
                <button class="pdocs-btn pdocs-btn--secondary pdocs-btn--sm" data-action="restore" data-id="${doc.id}">恢复</button>
                <button class="pdocs-btn pdocs-btn--danger pdocs-btn--sm" data-action="permanent" data-id="${doc.id}">彻底删除</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id, 10);
            if (action === 'restore') restorePersonalDoc(id);
            else if (action === 'permanent') permanentDeletePersonalDoc(id);
        });
    });
}

/** 打开编辑器 */
async function openPdocsEditor(docId) {
    pdocsEditingId = docId || null;
    showPdocsView('editor');

    const titleInput = document.getElementById('pdocsTitleInput');
    const contentInput = document.getElementById('pdocsContentInput');
    const preview = document.getElementById('pdocsPreview');

    if (!docId) {
        // 新建
        titleInput.value = '';
        contentInput.value = '';
        preview.style.display = 'none';
        preview.innerHTML = '';
        titleInput.focus();
        return;
    }

    // 编辑已有：拉取详情
    titleInput.value = '加载中...';
    contentInput.value = '';
    const data = await pdocsRequest(`/${docId}`);
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show('加载文档失败', 'error');
        showPdocsView('list');
        return;
    }
    titleInput.value = data.data.title || '';
    contentInput.value = data.data.content || '';
    preview.style.display = 'none';
    preview.innerHTML = '';
    if (preview.style.display !== 'none') renderPdocsPreview();
}

/** 保存文档（新建或更新） */
async function savePersonalDoc() {
    const title = document.getElementById('pdocsTitleInput').value.trim();
    const content = document.getElementById('pdocsContentInput').value;

    if (!title) {
        if (typeof Toast !== 'undefined') Toast.show('请输入标题', 'warning');
        return;
    }

    const saveBtn = document.getElementById('pdocsSaveBtn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '保存中...';
    saveBtn.disabled = true;

    const bodyObj = {
        title,
        content,
        summary: pdocsExtractSummary(content),
        // 个人文档语义：私有 + 仅作者本人（等级1位）可见
        visibility: 'private',
        permission_bits: '100000'
    };
    // 新建文档时，若当前处于某个个人文件夹视图下，自动归属该文件夹
    if (!pdocsEditingId && typeof pdocsCurrentFolderId === 'number' && pdocsCurrentFolderId > 0) {
        bodyObj.folder_id = pdocsCurrentFolderId;
    }
    const body = JSON.stringify(bodyObj);

    let data;
    if (pdocsEditingId) {
        data = await pdocsRequest(`/${pdocsEditingId}`, { method: 'PUT', body });
    } else {
        data = await pdocsRequest('/', { method: 'POST', body });
    }

    saveBtn.textContent = originalText;
    saveBtn.disabled = false;

    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '保存失败', 'error');
        return;
    }

    if (typeof Toast !== 'undefined') Toast.show('保存成功', 'success');
    pdocsEditingId = data.data.id;  // 新建后记住 id，后续保存变成更新
    // 更新预览
    const preview = document.getElementById('pdocsPreview');
    if (preview.style.display !== 'none') renderPdocsPreview();
}

/** 软删除（移入回收站） */
async function softDeletePersonalDoc(docId) {
    const ok = typeof Modal !== 'undefined'
        ? await Modal.confirm('确认将此文档移入回收站？', { title: '删除文档', okText: '确认移入', cancelText: '取消', icon: '🗑️' })
        : confirm('确认将此文档移入回收站？');
    if (!ok) return;
    const data = await pdocsRequest(`/${docId}`, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
        return;
    }
    if (typeof Toast !== 'undefined') Toast.show('已移入回收站', 'success');
    loadPersonalDocs();
}

/** 恢复文档 */
async function restorePersonalDoc(docId) {
    const data = await pdocsRequest(`/${docId}/restore`, { method: 'POST' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '恢复失败', 'error');
        return;
    }
    if (typeof Toast !== 'undefined') Toast.show('恢复成功', 'success');
    loadPersonalTrash();
}

/** 彻底删除 */
async function permanentDeletePersonalDoc(docId) {
    const ok = typeof Modal !== 'undefined'
        ? await Modal.confirm('彻底删除后无法恢复，确认删除？', { title: '彻底删除', okText: '确认删除', cancelText: '取消', icon: '⚠️' })
        : confirm('彻底删除后无法恢复，确认删除？');
    if (!ok) return;
    const data = await pdocsRequest(`/${docId}/permanent`, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
        return;
    }
    if (typeof Toast !== 'undefined') Toast.show('已彻底删除', 'success');
    loadPersonalTrash();
}

/** 切换预览显示 */
function togglePdocsPreview() {
    const preview = document.getElementById('pdocsPreview');
    const contentInput = document.getElementById('pdocsContentInput');
    const isHidden = preview.style.display === 'none';

    if (isHidden) {
        preview.style.display = '';
        contentInput.style.flex = '1';
        renderPdocsPreview();
    } else {
        preview.style.display = 'none';
        contentInput.style.flex = '';
    }
}

/** 渲染 Markdown 预览 */
async function renderPdocsPreview() {
    const content = document.getElementById('pdocsContentInput').value;
    const preview = document.getElementById('pdocsPreview');
    await ensureMarkedLoaded();
    try {
        if (pdocsMarkedReady && window.marked) {
            preview.innerHTML = window.marked.parse(content || '*空内容*');
        } else {
            preview.innerHTML = `<pre>${pdocsEscape(content)}</pre>`;
        }
    } catch (e) {
        preview.innerHTML = `<pre>${pdocsEscape(content)}</pre>`;
    }
}


// =========================================
// 个人文件夹相关函数
// =========================================

/** 加载个人文件夹列表（过滤出 user_id === pdocsCurrentUserId 的项作为个人文件夹） */
async function loadPersonalFolders() {
    const data = await pdocsRequest('/folders');
    if (!data || data.code !== 200) {
        console.error('[pdocs] 加载文件夹失败:', data);
        return;
    }
    const all = Array.isArray(data.data) ? data.data : [];
    pdocsFolders = all.filter(f => f.user_id === pdocsCurrentUserId);
    renderPdocsFolders();
}

/** 渲染文件夹 chip 列表 */
function renderPdocsFolders() {
    const container = document.getElementById('pdocsFoldersList');
    if (!container) return;

    const items = [];
    // 第一个 chip：全部
    items.push(`
        <div class="pdocs-folder-chip ${pdocsCurrentFolderId === null ? 'is-active' : ''}" data-folder-id="">
            <span class="pdocs-folder-chip__name">📋 全部</span>
        </div>
    `);
    // 每个个人文件夹
    pdocsFolders.forEach(folder => {
        items.push(`
            <div class="pdocs-folder-chip ${pdocsCurrentFolderId === folder.id ? 'is-active' : ''}" data-folder-id="${folder.id}">
                <span class="pdocs-folder-chip__name">${pdocsEscape(folder.name)}</span>
                <span class="pdocs-folder-chip__actions">
                    <button class="pdocs-folder-chip__btn" data-action="rename" data-id="${folder.id}" title="重命名">✏️</button>
                    <button class="pdocs-folder-chip__btn" data-action="delete" data-id="${folder.id}" title="删除">🗑</button>
                </span>
            </div>
        `);
    });
    container.innerHTML = items.join('');

    // 绑定 chip 主体点击
    container.querySelectorAll('.pdocs-folder-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            // 点击的是 chip__btn 时不触发主体
            if (e.target.closest('.pdocs-folder-chip__btn')) return;
            const fid = chip.dataset.folderId;
            if (fid === '') {
                pdocsCurrentFolderId = null;
            } else {
                pdocsCurrentFolderId = parseInt(fid, 10);
            }
            renderPdocsFolders();
            loadPersonalDocs();
        });
    });

    // 绑定 rename / delete 按钮
    container.querySelectorAll('.pdocs-folder-chip__btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id, 10);
            if (action === 'rename') {
                const folder = pdocsFolders.find(f => f.id === id);
                const newName = typeof Modal !== 'undefined'
                    ? await Modal.prompt('重命名文件夹:', folder ? folder.name : '', { title: '重命名文件夹' })
                    : prompt('重命名文件夹:', folder ? folder.name : '');
                if (newName !== null && newName.trim()) {
                    renamePersonalFolder(id, newName.trim());
                }
            } else if (action === 'delete') {
                deletePersonalFolder(id);
            }
        });
    });

    // 绑定新建按钮（防重复）
    const addBtn = document.getElementById('pdocsFolderAddBtn');
    if (addBtn && !addBtn.dataset.pdocsBound) {
        addBtn.dataset.pdocsBound = '1';
        addBtn.addEventListener('click', addPersonalFolder);
    }
}

/** 新建个人文件夹 */
async function addPersonalFolder() {
    const name = typeof Modal !== 'undefined'
        ? await Modal.prompt('请输入文件夹名称:', '', { title: '新建文件夹' })
        : prompt('请输入文件夹名称:');
    if (!name || !name.trim()) return;
    const data = await pdocsRequest('/folders', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scope: 'personal' })
    });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '创建失败', 'error');
        return;
    }
    if (typeof Toast !== 'undefined') Toast.show('文件夹已创建', 'success');
    loadPersonalFolders();
}

/** 重命名个人文件夹 */
async function renamePersonalFolder(id, newName) {
    const data = await pdocsRequest(`/folders/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName })
    });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '重命名失败', 'error');
        return;
    }
    if (typeof Toast !== 'undefined') Toast.show('已重命名', 'success');
    loadPersonalFolders();
}

/** 删除个人文件夹 */
async function deletePersonalFolder(id) {
    const ok = typeof Modal !== 'undefined'
        ? await Modal.confirm('删除文件夹后，文件夹内的文档将变为未归类，确认删除？', { title: '删除文件夹', okText: '确认删除', cancelText: '取消', icon: '🗑️' })
        : confirm('删除文件夹后，文件夹内的文档将变为未归类，确认删除？');
    if (!ok) return;
    const data = await pdocsRequest(`/folders/${id}`, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
        return;
    }
    if (typeof Toast !== 'undefined') Toast.show('已删除文件夹', 'success');
    // 如果当前选中的就是被删除的文件夹，重置为"全部"
    if (pdocsCurrentFolderId === id) pdocsCurrentFolderId = null;
    loadPersonalFolders();
    loadPersonalDocs();
}

/** 移动文档到指定文件夹（folderId: 0=清空归属，正整数=该文件夹） */
async function movePersonalDoc(docId, folderId) {
    // 后端要求 body 中含 'folder_id' 键才更新；null 表示清空
    const body = JSON.stringify({ folder_id: folderId === 0 ? null : folderId });
    const data = await pdocsRequest(`/${docId}`, { method: 'PUT', body });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '移动失败', 'error');
        return;
    }
    if (typeof Toast !== 'undefined') Toast.show('已移动', 'success');
    loadPersonalDocs();
}
