/**
 * dashboard.auth.js
 * 用户认证、权限按钮、主题切换、邮箱验证
 */

// 角色名映射
if (!window.ROLE_NAMES) {
    window.ROLE_NAMES = {
        0: '未登录',
        1: '普通用户',
        2: '一级管理员',
        3: '二级管理员',
        4: '三级管理员',
        5: '超级管理员'
    };
}

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

    // 侧边栏用户头像点击回到主页
    const userTrigger = $('sidebarUserTrigger');
    if (userTrigger) {
        userTrigger.style.cursor = 'pointer';
        on(userTrigger, 'click', () => {
            const event = new CustomEvent('dashboard:navigate', { detail: 'home' });
            document.dispatchEvent(event);
            closeSidebar();
        });
    }
}

/** 设置按钮绑定 */
function initSettingsButton() {
    const settingsBtn = $('settingsBtn');
    if (settingsBtn) {
        on(settingsBtn, 'click', () => {
            const event = new CustomEvent('dashboard:navigate', { detail: 'settings' });
            document.dispatchEvent(event);
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
    const roleName = window.ROLE_NAMES[user.permission_level] || '未知';

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
    if (profileBadge) profileBadge.textContent = `Lv.${user.permission_level} ${roleName}`;

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
            window.location.href = `${BASE_PATH}/index.html`;
        });
    }
}

/** 权限按钮渲染 */
window.renderPermissionButtons = window.renderPermissionButtons || function(realLevel) {
    const container = $('permissionButtons');
    if (!container) return;

    container.innerHTML = '';

    if (!realLevel || realLevel <= 1) return;

    const np = window.__nowPermission || { level: 1 };
    const currentLevel = np.level || 1;

    const levels = [1];
    for (let level = 2; level <= realLevel; level++) {
        levels.push(level);
    }

    levels.forEach(level => {
        const btn = document.createElement('button');
        btn.className = 'perm-btn';
        if (level === currentLevel) {
            btn.classList.add('perm-btn--current');
        }
        btn.textContent = level;
        btn.title = `切换到 ${window.ROLE_NAMES[level] || `等级${level}`}`;
        on(btn, 'click', () => window.handlePermissionClick(level));
        container.appendChild(btn);
    });

    const bannerEl = $('viewOverrideBanner');
    if (bannerEl) {
        if (currentLevel !== 1) {
            bannerEl.style.display = 'block';
            bannerEl.innerHTML = `已切换到 <strong>${window.ROLE_NAMES[currentLevel] || `等级${currentLevel}`}</strong> · <a href="#" id="clearViewOverrideBtn">返回等级 1</a>`;
            const clearBtn = $('clearViewOverrideBtn');
            if (clearBtn) {
                on(clearBtn, 'click', (e) => {
                    e.preventDefault();
                    if (typeof window.handlePermissionClick === 'function') window.handlePermissionClick(1);
                });
            }
        } else {
            bannerEl.style.display = 'none';
        }
    }
};

/** 权限切换处理 */
window.handlePermissionClick = window.handlePermissionClick || async function(level) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/auth/switch-permission`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AuthGuard.getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ target_level: level })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.warn('切换权限失败:', err.msg || res.status);
            return;
        }
        const data = await res.json();
        const np = (data.data || {});
        AuthGuard.setToken(np.access_token, np.expires_in);
        window.__nowPermission = np.now_permission || { level, context: null, nodes: [] };
    } catch (e) {
        console.warn('切换权限请求异常:', e);
        return;
    }

    const isDashboardPage = /\/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname);
    const adminPaths = { 2: 'admin1', 3: 'admin2', 4: 'admin3', 5: 'superadmin' };

    if (isDashboardPage) {
        if (level === 1) {
            localStorage.removeItem('guest_view_mode');
            window.location.href = `${BASE_PATH}/user/dashboard.html`;
            return;
        }
        const folder = adminPaths[level];
        if (folder) {
            localStorage.removeItem('guest_view_mode');
            window.location.href = `${BASE_PATH}/${folder}/dashboard.html`;
        }
        return;
    }

    window.location.reload();
};

/** 初始化主题切换 */
function initThemeOptions(token) {
    const options = $('themeOptions');
    if (!options) return;
    on(options, 'click', (e) => {
        const btn = e.target.closest('.theme-opt');
        if (!btn) return;
        const theme = btn.dataset.theme;
        if (typeof ThemeEngine !== 'undefined') {
            ThemeEngine.applyTheme(theme);
            if (token) ThemeEngine.syncThemeToServer(theme, token);
            showToast('主题已切换', 'success');
        }
    });
}

/** 邮箱验证 - 检查状态 */
async function checkEmailVerificationStatus(token, email) {
    if (!email) return;

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

        const response = await fetch(`${API_BASE_URL}/api/v1/auth/resend-verification`, {
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
    if (typeof window.renderPermissionButtons === 'function') {
        window.renderPermissionButtons(user.permission_level);
    }
    renderTopNavAuth(user);
    checkEmailVerificationStatus(token, user.email);
    initThemeOptions(token);
}

/** 发送邮箱验证码（供 dashboard.js 的 verifyEmailBtn 调用） */
async function sendVerificationEmail() {
    await handleResendCode();
}
