/**
 * dashboard.auth.js
 * 用户认证、权限按钮、主题切换、邮箱验证
 * Phase 2: ES Module — 共享资源通过 window 访问
 */
import DashboardMenu from './dashboard.menu.js';

// ===== 从 window 获取共享资源 =====
var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL;
var BASE_PATH = window.BASE_PATH;
var $ = window.$;
var $$ = window.$$;
var on = window.on;
var showToast = window.showToast;
var setBtnState = window.setBtnState;
var fallbackCopy = window.fallbackCopy;
var Toast = window.Toast;
var ThemeEngine = window.ThemeEngine;

const ROLE_NAMES = {
    0: '未登录',
    1: '普通用户',
    2: '一级管理员',
    3: '二级管理员',
    4: '三级管理员',
    5: '超级管理员'
};

/** 侧边栏切换 */
function initSidebarToggle() {
    const menuBtn = $('menuToggle');
    const sidebar = $('dashboardSidebar');
    const closeBtn = $('sidebarClose');
    const overlay = $('sidebarOverlay');
    const dashboardNav = $('dashboardNav');

    const openSidebar = () => {
        sidebar.classList.add('dashboard-sidebar--open');
        overlay.classList.add('sidebar-overlay--visible');
    };

    const closeSidebar = () => {
        sidebar.classList.remove('dashboard-sidebar--open');
        overlay.classList.remove('sidebar-overlay--visible');
    };

    on(menuBtn, 'click', openSidebar);
    on(closeBtn, 'click', closeSidebar);
    on(overlay, 'click', (e) => { if (e.target === overlay) closeSidebar(); });

    const userTrigger = $('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.style.cursor = 'pointer';
        on(userTrigger, 'click', () => {
            if (DashboardMenu) DashboardMenu.switchTab('home');
            closeSidebar();
        });
    }
}

/** 设置按钮绑定 */
function initSettingsButton() {
    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
        on(settingsBtn, 'click', () => {
            if (DashboardMenu) DashboardMenu.switchTab('settings');
            const overlay = $('sidebarOverlay');
            const sidebar = $('dashboardSidebar');
            if (sidebar) sidebar.classList.remove('dashboard-sidebar--open');
            if (overlay) overlay.classList.remove('sidebar-overlay--visible');
        });
    }
}

/** 渲染用户信息 */
function renderUserProfile(user, DEFAULT_AVATAR, DEFAULT_BANNER) {
    const profile = user.profile || {};
    const avatar = profile.avatar || DEFAULT_AVATAR;
    const banner = profile.banner || DEFAULT_BANNER;
    const curLevel = user.current_level || 1;
    const maxLevel = user.max_level || 1;
    const roleName = ROLE_NAMES[curLevel] || '未知';

    const sidebarAvatar = $('sidebarAvatar');
    if (sidebarAvatar) {
        sidebarAvatar.src = avatar;
        sidebarAvatar.onerror = function() { this.src = DEFAULT_AVATAR; };
    }

    const sidebarUsername = $('sidebarUsername');
    if (sidebarUsername) sidebarUsername.textContent = user.username;

    const sidebarUserRole = $('sidebarUserRole');
    if (sidebarUserRole) sidebarUserRole.textContent = roleName;

    const profileAvatar = $('profileAvatar');
    if (profileAvatar) {
        profileAvatar.src = avatar;
        profileAvatar.onerror = function() { this.src = DEFAULT_AVATAR; };
    }

    const profileUsername = $('profileUsername');
    if (profileUsername) profileUsername.textContent = user.username;

    const profileBadge = $('profileBadge');
    if (profileBadge) {
        profileBadge.textContent = maxLevel > curLevel
            ? `Lv.${curLevel} ${roleName} (最高 Lv.${maxLevel})`
            : `Lv.${curLevel} ${roleName}`;
    }

    const profileIntro = $('profileIntro');
    if (profileIntro) {
        profileIntro.textContent = profile.introduction || '这个人很懒，什么都没留下';
    }

    const bannerImg = $('bannerImg');
    if (bannerImg) {
        bannerImg.src = banner;
        bannerImg.onerror = function() { this.style.display = 'none'; };
    }
}

/** 渲染顶部导航认证状态 */
function renderTopNavAuth(user) {
    const authContainer = $('auth-container');
    if (!authContainer) return;

    authContainer.innerHTML = '';

    const navLoginLinks = $$('.header__nav a[href*="login"]');
    const navRegisterLinks = $$('.header__nav a[href*="register"]');

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

    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
        on(logoutBtn, 'click', (e) => {
            e.preventDefault();
            AuthGuard.clearToken();
            localStorage.removeItem('guest_view_mode');
            window.location.replace(`${BASE_PATH}/login.html?_t=${Date.now()}`);
        });
    }
}

/**
 * 权限等级按钮渲染。
 *
 * ⚠️ 参数兼容两种签名（与 `js/index.js` 的同名函数保持一致）：
 *   * **对象** `{current_level, max_level}` —— 仪表盘自己的调用方（`initAuthModules`）；
 *   * **数字** 真实等级 —— `js/index.js::renderAuthStatus` 的调用方（主站页面）。
 *   两者都挂 `window.renderPermissionButtons`，历史上谁后加载谁生效：
 *   被主站那份覆盖后，仪表盘传的对象会被当成数字 → `realLevel` 变 NaN → **按钮整个消失**；
 *   反过来主站传的数字被这份当成对象 → `current_level` 恒 undefined → **高亮永远停在 Lv1**。
 *   所以这里做一次归一化，任何一份代码被后加载都能正确工作。
 */
function normalizePermissionArgs(input) {
    if (input && typeof input === 'object') {
        const current = parseInt(input.current_level != null ? input.current_level : input.level, 10);
        const max = parseInt(input.max_level != null ? input.max_level : input.real_level, 10);
        return {
            currentLevel: Number.isFinite(current) ? current : 1,
            maxLevel: Number.isFinite(max) ? max : 1,
        };
    }
    const real = parseInt(input, 10);
    const np = window.__nowPermission || {};
    const current = parseInt(np.level, 10);
    return {
        currentLevel: Number.isFinite(current) ? current : 1,
        maxLevel: Number.isFinite(real) ? real : 1,
    };
}

function renderPermissionButtons(userInfo) {
    const container = $('permissionButtons');
    if (!container) return;

    container.innerHTML = '';

    const normalized = normalizePermissionArgs(userInfo);
    const curLevel = normalized.currentLevel || 1;
    const maxLevel = normalized.maxLevel || 1;

    if (maxLevel <= 1) return;

    for (let lv = 1; lv <= maxLevel; lv++) {
        const btn = document.createElement('button');
        btn.className = 'perm-btn';
        // ⚠️ 高亮类名必须与 css/components.css 中的 `.perm-btn--current` 一致。
        // 这里曾误写成 `--active`，CSS 里没有该类 → 任何等级都不高亮，
        // 用户无法从界面判断「当前是哪一级」。
        if (lv === curLevel) btn.classList.add('perm-btn--current');
        btn.textContent = lv;
        btn.title = `${ROLE_NAMES[lv]}`;
        if (lv !== curLevel) {
            on(btn, 'click', () => switchLevel(lv));
        }
        container.appendChild(btn);
    }
}

/**
 * 主站（`js/index.js`）侧的切换入口。
 *
 * `js/index.js::handlePermissionClick` 会调用 `/auth/switch-permission` 然后**整页刷新**。
 * 仪表盘是单页应用，不需要整页刷新 —— 这里把它接到 `switchLevel()`：
 * 同一套请求 + 就地重绘 + 重载当前 Tab。这样无论 window 上挂的是哪一份实现，
 * 点击行为都正确（历史问题：两份实现的签名与刷新语义不同，互相覆盖后行为不一致）。
 */
async function handlePermissionClick(level) {
    await switchLevel(level);
}

/** 切换等级 */
async function switchLevel(targetLevel) {
    try {
        const token = AuthGuard.getToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(`${API_BASE_URL}/api/v0/auth/switch-permission`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ target_level: targetLevel })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            Toast.show(err.msg || '切换权限失败');
            return;
        }
        const data = await res.json();
        const np = data.data || {};
        AuthGuard.setToken(np.access_token, np.expires_in);

        // 运行时权限先落盘：等级切换后的所有渲染都必须读这份最新值。
        // 注意 context 阈值与后端一致是 >= 2（见 services/auth_service.py::switch_permission），
        // 历史上前端误写成 >= 4，会让 Lv2/Lv3 切完拿不到 admin 上下文。
        const newLevel = (np.now_permission && np.now_permission.level) || targetLevel;
        window.__nowPermission = np.now_permission
            || { level: newLevel, context: newLevel >= 2 ? 'admin' : null, nodes: [] };

        Toast.show(`已切换到 Lv.${targetLevel} ${ROLE_NAMES[targetLevel]}`, 'success');

        // 1. 立即按新等级重画按钮：高亮必须在「点完就有反馈」，
        //    不能等 /user/menu 返回 —— 否则 user_info 慢或失败时高亮会停在旧等级。
        //    此时还不知道真实最高等级，先按当前等级画，下面用服务端数据补全范围。
        renderPermissionButtons({ current_level: newLevel, max_level: newLevel });

        // 2. 重新拉一次 user_info（用户名/最高等级/按钮范围），成功则覆盖上面的临时范围
        if (typeof window.renderUserInfo === 'function') {
            const freshToken = AuthGuard.getToken();
            if (freshToken) await window.renderUserInfo(freshToken);
        }

        // 3. 重画侧边栏（管理菜单按新身份显隐）
        await DashboardMenu.loadMenu();

        // 4. ⭐ 重载当前正在看的 Tab —— 否则页面上还留着按旧等级渲染的内容，
        //    表现为「切了以后页面内容没跟着变」。
        await DashboardMenu.reloadCurrentTab();
    } catch (e) {
        console.warn('切换权限异常:', e);
        Toast.show('网络错误');
    }
}

/** 初始化主题切换 */
function initThemeOptions(token) {
    const options = $('themeOptions');
    if (!options) return;
    on(options, 'click', (e) => {
        const btn = e.target.closest('.theme-opt');
        if (!btn) return;
        const theme = btn.dataset.theme;
        ThemeEngine.applyTheme(theme);
        if (token) ThemeEngine.syncThemeToServer(theme, token);
        showToast('主题已切换', 'success');
    });
}

/** 邮箱验证 - 检查状态 */
async function checkEmailVerificationStatus(token, email) {
    if (!email) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v0/auth/email-status`, {
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

/** 邮箱验证 - 显示验证区域 */
let pendingEmailCode = null;
function showEmailVerificationSection(email) {
    const section = $('emailVerificationSection');
    const descEl = $('verificationDesc');

    if (!section) return;

    if (descEl) {
        descEl.textContent = `验证邮箱: ${email}`;
    }

    section.style.display = 'block';

    const verifyBtn = $('verifyEmailBtn');
    const codeInput = $('verificationCodeInput');
    const resendBtn = $('resendCodeBtn');

    if (verifyBtn && codeInput) {
        on(verifyBtn, 'click', () => handleVerifyEmail(codeInput.value));
    }

    if (resendBtn) {
        on(resendBtn, 'click', handleResendCode);
    }

    if (pendingEmailCode && codeInput) {
        codeInput.value = pendingEmailCode;

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

        setTimeout(() => {
            if (copied) {
                showToast('验证码已自动填入并复制到剪贴板', 'success');
            } else {
                showToast('验证码已自动填入，请手动复制', 'info');
            }
        }, 300);

        pendingEmailCode = null;
    }
}

/** 邮箱验证 - 处理验证 */
async function handleVerifyEmail(code) {
    if (!code || code.length !== 6) {
        showToast('请输入6位验证码');
        return;
    }

    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    const verifyBtn = $('verifyEmailBtn');
    const codeInput = $('verificationCodeInput');

    try {
        setBtnState(verifyBtn, true, '验证中...');

        const response = await fetch(`${API_BASE_URL}/api/v0/auth/verify-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ code })
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            showToast('邮箱验证成功！', 'success');
            const section = $('emailVerificationSection');
            if (section) section.style.display = 'none';
        } else {
            showToast(data.msg || '验证失败');
        }
    } catch (error) {
        console.error('邮箱验证失败:', error);
        showToast('网络错误，请重试');
    } finally {
        setBtnState(verifyBtn, false, '验证');
        if (codeInput) codeInput.value = '';
    }
}

/** 邮箱验证 - 重新发送 */
async function handleResendCode() {
    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    const resendBtn = $('resendCodeBtn');

    try {
        setBtnState(resendBtn, true, '发送中...');

        const response = await fetch(`${API_BASE_URL}/api/v0/auth/resend-verification`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            showToast('验证码已发送至您的邮箱', 'success');
        } else {
            showToast(data.msg || '发送失败');
        }
    } catch (error) {
        console.error('重发验证码失败:', error);
        showToast('网络错误，请重试');
    } finally {
        setBtnState(resendBtn, false, '重新发送验证码');
    }
}

/** 解析 URL 中的邮箱验证码 */
function parsePendingEmailCode() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code && /^\d{6}$/.test(code)) {
            pendingEmailCode = code;
            const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    } catch (e) {
        console.warn('解析 URL 参数失败', e);
    }
}

/** 认证模块初始化入口 */
function initAuthModules(token, user) {
    const defaultAvatar = window.DEFAULT_AVATAR || `${BASE_PATH}/favicon.png`;
    const defaultBanner = window.DEFAULT_BANNER || '';
    renderUserProfile(user, defaultAvatar, defaultBanner);
    renderPermissionButtons(user);
    renderTopNavAuth(user);
    checkEmailVerificationStatus(token, user.email);
    initThemeOptions(token);
}

/** 发送邮箱验证码 */
async function sendVerificationEmail() {
    await handleResendCode();
}

// ===== ES Module exports =====
export {
    initAuthModules, renderUserProfile, renderTopNavAuth, renderPermissionButtons,
    switchLevel, initSidebarToggle, initSettingsButton, sendVerificationEmail,
    handlePermissionClick, normalizePermissionArgs, ROLE_NAMES,
};

// ===== 兼容层 =====
// ⚠️ 与 `js/index.js` 一样使用 `||`：**先加载者胜**。
//    `dashboard.html` 不加载 index.js，所以这里挂上去的就是仪表盘自己的实现；
//    但这保证了将来若有页面同时加载两者，也不会出现「后加载的把另一份覆盖成签名不兼容的实现」。
window.renderPermissionButtons = window.renderPermissionButtons || renderPermissionButtons;
window.handlePermissionClick = window.handlePermissionClick || handlePermissionClick;