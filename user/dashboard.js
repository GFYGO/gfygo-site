/**
 * dashboard.js
 * 用户主页逻辑：鉴权校验 + 用户信息渲染 + 权限按钮 + 侧边栏交互
 * 
 * 重构要点：
 * 1. 模块化拆分：将大函数拆分为独立的功能模块
 * 2. 提取工具函数：统一DOM操作、API请求、时间格式化等
 * 3. 改善命名和注释：使用更清晰的函数名和完整的文档注释
 */

// =========================================
// 配置与常量
// =========================================

const CURRENT_USER = {
    pageLevel: 1,  // dashboard 页面权限固定为 1（普通用户）
    level: null    // 用户真实权限等级（从 API 获取）
};

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

const STATIC_TABS = ['workspace', 'home', 'notify', 'settings', 'personal-docs'];

// =========================================
// 工具函数模块
// =========================================

/**
 * HTML 转义，防止 XSS
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

/**
 * 兼容旧浏览器的复制方案
 * @param {string} text - 要复制的文本
 * @returns {boolean} 是否复制成功
 */
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

/**
 * 格式化时间为友好显示
 * @param {string} iso - ISO 格式的时间字符串
 * @returns {string} 格式化后的时间
 */
function formatFriendlyTime(iso) {
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

/**
 * DOM 操作工具：安全设置元素内容
 * @param {string} elementId - 元素 ID
 * @param {string|function} contentOrSetter - 内容或设置函数
 */
function safeSetElementContent(elementId, contentOrSetter) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (typeof contentOrSetter === 'function') {
        contentOrSetter(element);
    } else {
        element.textContent = contentOrSetter;
    }
}

/**
 * DOM 操作工具：安全设置元素属性
 * @param {string} elementId - 元素 ID
 * @param {string} attribute - 属性名
 * @param {string} value - 属性值
 */
function safeSetElementAttribute(elementId, attribute, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element[attribute] = value;
    }
}

// =========================================
// API 请求模块
// =========================================

/**
 * 统一 API 请求封装
 * @param {string} path - API 路径
 * @param {object} options - fetch 选项
 * @returns {Promise<object|null>} 响应数据或 null
 */
async function apiRequest(path, options = {}) {
    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return null;
    }

    try {
        const res = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'dashboard',
                ...(options.headers || {})
            }
        });

        if (res.status === 401) {
            AuthGuard.handleAuthError();
            return null;
        }

        return await res.json();
    } catch (e) {
        console.error('[API] 请求失败:', e);
        if (typeof Toast !== 'undefined') {
            Toast.show('网络请求失败', 'error');
        }
        return null;
    }
}

// =========================================
// 侧边栏交互模块
// =========================================

/**
 * 初始化侧边栏开关
 */
function initSidebarToggle() {
    const elements = {
        menuBtn: document.getElementById('menuToggle'),
        sidebar: document.getElementById('dashboardSidebar'),
        closeBtn: document.getElementById('sidebarClose'),
        overlay: document.getElementById('sidebarOverlay')
    };

    const openSidebar = () => {
        elements.sidebar?.classList.add('dashboard-sidebar--open');
        elements.overlay?.classList.add('sidebar-overlay--visible');
    };

    const closeSidebar = () => {
        elements.sidebar?.classList.remove('dashboard-sidebar--open');
        elements.overlay?.classList.remove('sidebar-overlay--visible');
    };

    elements.menuBtn?.addEventListener('click', openSidebar);
    elements.closeBtn?.addEventListener('click', closeSidebar);
    elements.overlay?.addEventListener('click', closeSidebar);
}

/**
 * 关闭移动端侧边栏
 */
function closeMobileSidebar() {
    safeSetElementContent('dashboardSidebar', el => {
        el.classList.remove('dashboard-sidebar--open');
    });
    safeSetElementContent('sidebarOverlay', el => {
        el.classList.remove('sidebar-overlay--visible');
    });
}

/**
 * 初始化设置按钮
 */
function initSettingsButton() {
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            switchTab('settings');
            closeMobileSidebar();
        });
    }
}

// =========================================
// 标签切换模块
// =========================================

const dynamicMenuCache = new Map();
const staticPanelLoaded = new Set();

/**
 * 初始化标签切换
 */
function initTabSwitching() {
    // 恢复上次保存的 tab，默认主页
    const savedTab = localStorage.getItem('dashboard_active_tab') || 'home';
    const hasPanel = document.getElementById(`panel-${savedTab}`);
    
    if (hasPanel) {
        switchTab(savedTab, true);
    } else {
        switchTab('home', true);
    }

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

/**
 * 绑定所有侧边栏导航项点击
 */
function bindTabClicks() {
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

/**
 * 切换标签页
 * @param {string} tab - 标签 ID
 * @param {boolean} skipSave - 是否跳过保存
 */
async function switchTab(tab, skipSave = false) {
    if (!skipSave) {
        localStorage.setItem('dashboard_active_tab', tab);
    }

    // 动态项懒加载
    if (dynamicMenuCache.has(tab) && !dynamicMenuCache.get(tab).loaded) {
        await loadPanelContent(tab);
    }

    // 静态 panel 首次加载逻辑
    handleStaticPanelLoad(tab);

    // 切换内容面板
    updateActivePanel(tab);

    // 更新侧边栏导航项激活状态
    updateActiveNavigation(tab);
}

/**
 * 处理静态面板首次加载
 * @param {string} tab - 标签 ID
 */
function handleStaticPanelLoad(tab) {
    if (tab === 'notify' && !staticPanelLoaded.has('notify')) {
        staticPanelLoaded.add('notify');
        loadNotifyList();
    }

    if (tab === 'personal-docs' && !staticPanelLoaded.has('personal-docs')) {
        staticPanelLoaded.add('personal-docs');
        initPersonalDocs();
    }
}

/**
 * 更新活动面板显示
 * @param {string} tab - 标签 ID
 */
function updateActivePanel(tab) {
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.style.display = 'none';
    });
    
    const targetPanel = document.getElementById(`panel-${tab}`);
    if (targetPanel) {
        targetPanel.style.display = '';
    }
}

/**
 * 更新导航项激活状态
 * @param {string} tab - 标签 ID
 */
function updateActiveNavigation(tab) {
    // 更新侧边栏导航项
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
// 动态菜单模块
// =========================================

/**
 * 加载动态菜单
 * @param {string} token - JWT token
 */
async function loadDynamicMenu(token) {
    const container = document.getElementById('dynamicMenuContainer');
    const divider = document.getElementById('dynamicMenuDivider');
    if (!container) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/user/menu`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'dashboard'
            }
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
            
            // 渲染 nav-item
            const navItem = createNavItemElement(item);
            container.appendChild(navItem);
            
            // 创建空 panel
            const panel = createPanelElement(item.tab_key);
            contentHost.appendChild(panel);
        });

        bindTabClicks();
        restoreDynamicTabState();
    } catch (e) {
        console.error('[menu] 加载动态菜单失败', e);
    }
}

/**
 * 创建导航项元素
 * @param {object} item - 菜单项数据
 * @returns {HTMLElement} 导航项元素
 */
function createNavItemElement(item) {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'sidebar__nav-item';
    a.dataset.tab = item.tab_key;
    a.innerHTML = `<span class="sidebar__nav-icon">${item.icon || '📄'}</span>
                   <span class="sidebar__nav-text">${item.label}</span>`;
    return a;
}

/**
 * 创建面板元素
 * @param {string} tabKey - 标签键
 * @returns {HTMLElement} 面板元素
 */
function createPanelElement(tabKey) {
    const panel = document.createElement('section');
    panel.className = 'tab-panel';
    panel.id = `panel-${tabKey}`;
    panel.style.display = 'none';
    panel.innerHTML = '<p class="loading-text">加载中...</p>';
    return panel;
}

/**
 * 恢复动态标签状态
 */
function restoreDynamicTabState() {
    const savedTab = localStorage.getItem('dashboard_active_tab');
    if (savedTab && dynamicMenuCache.has(savedTab)) {
        const currentActive = document.querySelector('.sidebar__nav-item.active')?.dataset.tab;
        if (currentActive !== savedTab) {
            switchTab(savedTab, true);
        }
    }
}

/**
 * 加载面板内容
 * @param {string} tab - 标签 ID
 */
async function loadPanelContent(tab) {
    const cache = dynamicMenuCache.get(tab);
    if (!cache || cache.loaded) return;

    const token = AuthGuard.getToken();
    if (!token) return;

    const panel = document.getElementById(`panel-${tab}`);
    if (!panel) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/user/menu/${cache.meta.id}/content`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'dashboard'
            }
        });
        const data = await res.json();

        if (data.code !== 200) {
            panel.innerHTML = '<p class="loading-text">内容加载失败</p>';
            return;
        }

        const d = data.data;
        panel.innerHTML = d.html_content || '';

        // 注入 CSS
        if (d.css_content) {
            const style = document.createElement('style');
            style.dataset.tabStyle = tab;
            style.textContent = d.css_content;
            panel.appendChild(style);
        }

        // 注入 JS
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
// 通知中心模块
// =========================================

/**
 * 加载通知列表
 */
async function loadNotifyList() {
    const list = document.getElementById('notifyList');
    if (!list) return;

    const token = AuthGuard.getToken();
    try {
        const headers = { 'X-Page-Type': 'dashboard' };
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

// =========================================
// 用户信息渲染模块
// =========================================

/**
 * 渲染用户资料
 * @param {object} user - 用户对象
 */
function renderUserProfile(user) {
    const profile = user.profile || {};
    const avatar = profile.avatar || DEFAULT_AVATAR;
    const banner = profile.banner || DEFAULT_BANNER;
    const roleName = ROLE_NAMES[user.permission_level] || '未知';

    // 设置头像（两处）
    safeSetElementAttribute('sidebarAvatar', 'src', avatar);
    safeSetElementAttribute('profileAvatar', 'src', avatar);

    // 头像加载失败时使用默认头像
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    if (sidebarAvatar) {
        sidebarAvatar.onerror = function() { this.src = DEFAULT_AVATAR; };
    }

    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar) {
        profileAvatar.onerror = function() { this.src = DEFAULT_AVATAR; };
    }

    // 设置文本内容
    safeSetElementContent('sidebarUsername', user.username);
    safeSetElementContent('sidebarUserRole', roleName);
    safeSetElementContent('profileUsername', user.username);
    safeSetElementContent('profileBadge', `Lv.${user.permission_level} ${roleName}`);
    safeSetElementContent('profileIntro', profile.introduction || '这个人很懒，什么都没留下');

    // 设置 banner
    const bannerImg = document.getElementById('bannerImg');
    if (bannerImg) {
        bannerImg.src = banner;
        bannerImg.onerror = function() {
            this.style.display = 'none';
        };
    }
}

/**
 * 渲染顶部导航认证信息
 * @param {object} user - 用户对象
 */
function renderTopNavAuth(user) {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) return;

    authContainer.innerHTML = '';

    const navLoginLinks = document.querySelectorAll('.header__nav a[href*="login"]');
    const navRegisterLinks = document.querySelectorAll('.header__nav a[href*="register"]');

    const avatar = (user.profile && user.profile.avatar) ? user.profile.avatar : '';
    const defaultAvatar = `${BASE_PATH}/favicon.png`;

    // 创建用户信息元素
    const userEl = createUserElement(user, avatar, defaultAvatar);
    authContainer.appendChild(userEl);

    // 隐藏登录/注册链接
    navLoginLinks.forEach(link => link.style.display = 'none');
    navRegisterLinks.forEach(link => link.style.display = 'none');

    // 绑定退出按钮
    bindLogoutButton();
}

/**
 * 创建用户元素
 * @param {object} user - 用户对象
 * @param {string} avatar - 头像 URL
 * @param {string} defaultAvatar - 默认头像 URL
 * @returns {HTMLElement} 用户元素
 */
function createUserElement(user, avatar, defaultAvatar) {
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

    return userEl;
}

/**
 * 绑定退出按钮事件
 */
function bindLogoutButton() {
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

// =========================================
// 权限按钮模块
// =========================================

/**
 * 渲染权限按钮
 * @param {number} permissionLevel - 权限等级
 */
function renderPermissionButtons(permissionLevel) {
    const container = document.getElementById('permissionButtons');
    if (!container) return;

    container.innerHTML = '';

    // Dashboard 页面：pageLevel 固定为 1，不显示管理员专属按钮
    if (CURRENT_USER.pageLevel <= 1) return;
    if (permissionLevel <= 1) return;

    const viewOverride = getViewOverride();
    const effectiveLevel = Number.isInteger(viewOverride) ? viewOverride : 1;

    // 创建权限等级按钮
    const levels = createPermissionLevels(permissionLevel);
    levels.forEach(level => {
        const btn = createPermissionButton(level, effectiveLevel);
        container.appendChild(btn);
    });

    // 更新视角覆盖提示
    updateViewOverrideBanner(effectiveLevel);
}

/**
 * 获取视角覆盖等级
 * @returns {number|null} 视角等级
 */
function getViewOverride() {
    const viewOverrideRaw = localStorage.getItem('view_as_level');
    return viewOverrideRaw ? parseInt(viewOverrideRaw, 10) : null;
}

/**
 * 创建权限等级数组
 * @param {number} permissionLevel - 用户权限等级
 * @returns {number[]} 权限等级数组
 */
function createPermissionLevels(permissionLevel) {
    const levels = [];
    if (permissionLevel >= 5) levels.push(0);
    levels.push(1);
    for (let level = 2; level <= permissionLevel; level++) {
        levels.push(level);
    }
    return levels;
}

/**
 * 创建权限按钮
 * @param {number} level - 权限等级
 * @param {number} effectiveLevel - 当前有效等级
 * @returns {HTMLElement} 按钮元素
 */
function createPermissionButton(level, effectiveLevel) {
    const btn = document.createElement('button');
    btn.className = 'perm-btn';
    
    if (level === effectiveLevel) {
        btn.classList.add('perm-btn--current');
    }
    
    btn.textContent = level;
    btn.title = `切换到 ${ROLE_NAMES[level] || `等级${level}`} 视角预览（仅前端渲染，不改变实际权限）`;
    btn.addEventListener('click', () => handlePermissionClick(level));
    
    return btn;
}

/**
 * 更新视角覆盖提示
 * @param {number} effectiveLevel - 当前有效等级
 */
function updateViewOverrideBanner(effectiveLevel) {
    const bannerEl = document.getElementById('viewOverrideBanner');
    if (!bannerEl) return;

    if (effectiveLevel !== 1) {
        bannerEl.style.display = 'block';
        bannerEl.innerHTML = `当前以 <strong>${ROLE_NAMES[effectiveLevel] || `等级${effectiveLevel}`}</strong> 视角预览（实际权限未改变） · <a href="#" id="clearViewOverrideBtn">返回真实视角</a>`;
        
        const clearBtn = document.getElementById('clearViewOverrideBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('view_as_level');
                window.location.reload();
            });
        }
    } else {
        bannerEl.style.display = 'none';
    }
}

/**
 * 处理权限点击
 * @param {number} level - 权限等级
 */
function handlePermissionClick(level) {
    if (level === 0) {
        // 访客视角预览
        localStorage.setItem('guest_view_mode', 'true');
        localStorage.removeItem('view_as_level');
        window.location.href = `${BASE_PATH}/index.html`;
        return;
    }

    localStorage.removeItem('guest_view_mode');

    if (level === 1) {
        localStorage.removeItem('view_as_level');
    } else {
        localStorage.setItem('view_as_level', String(level));
    }

    window.location.reload();
}

// =========================================
// 邮箱验证模块
// =========================================

let pendingEmailCode = null;

/**
 * 检查邮箱验证状态
 * @param {string} token - JWT token
 * @param {string} email - 邮箱地址
 */
async function checkEmailVerificationStatus(token, email) {
    if (!email) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/email-status`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'dashboard'
            }
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

/**
 * 显示邮箱验证区域
 * @param {string} email - 邮箱地址
 */
function showEmailVerificationSection(email) {
    const section = document.getElementById('emailVerificationSection');
    const descEl = document.getElementById('verificationDesc');

    if (!section) return;

    if (descEl) {
        descEl.textContent = `验证邮箱: ${email}`;
    }

    section.style.display = 'block';

    const verifyBtn = document.getElementById('verifyEmailBtn');
    const codeInput = document.getElementById('verificationCodeInput');
    const resendBtn = document.getElementById('resendCodeBtn');

    if (verifyBtn && codeInput) {
        verifyBtn.addEventListener('click', () => handleVerifyEmail(codeInput.value));
    }

    if (resendBtn) {
        resendBtn.addEventListener('click', handleResendCode);
    }

    // 处理 URL 中携带的验证码
    handlePendingEmailCode(codeInput);
}

/**
 * 处理待处理的邮箱验证码
 * @param {HTMLElement} codeInput - 验证码输入框
 */
function handlePendingEmailCode(codeInput) {
    if (!pendingEmailCode || !codeInput) return;

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

    pendingEmailCode = null;
}

/**
 * 处理邮箱验证
 * @param {string} code - 验证码
 */
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
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'dashboard'
            },
            body: JSON.stringify({ code })
        });

        const data = await response.json();
        if (response.ok && data.code === 200) {
            Toast.show('邮箱验证成功！', 'success');
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

/**
 * 处理重发验证码
 */
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
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'dashboard'
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

// =========================================
// 日历打卡模块
// =========================================

const CHECKIN_KEY_PREFIX = 'checkin_record_';
let calendarState = null;

/**
 * 获取打卡记录存储键
 * @param {number} userId - 用户 ID
 * @returns {string} 存储键
 */
function getCheckinStorageKey(userId) {
    return `${CHECKIN_KEY_PREFIX}${userId}`;
}

/**
 * 加载打卡记录
 * @param {number} userId - 用户 ID
 * @returns {object} 打卡记录对象
 */
function loadCheckinRecords(userId) {
    try {
        const raw = localStorage.getItem(getCheckinStorageKey(userId));
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

/**
 * 保存打卡记录
 * @param {number} userId - 用户 ID
 * @param {object} records - 打卡记录对象
 */
function saveCheckinRecords(userId, records) {
    try {
        localStorage.setItem(getCheckinStorageKey(userId), JSON.stringify(records));
    } catch (e) {
        console.warn('保存打卡记录失败', e);
    }
}

/**
 * 生成日期键
 * @param {number} y - 年
 * @param {number} m - 月
 * @param {number} d - 日
 * @returns {string} 日期键
 */
function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 判断是否同一天
 * @param {Date} a - 日期 a
 * @param {Date} b - 日期 b
 * @returns {boolean} 是否同一天
 */
function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

/**
 * 初始化日历打卡
 * @param {number} userId - 用户 ID
 */
function initCheckinCalendar(userId) {
    const elements = {
        calEl: document.getElementById('calDays'),
        titleEl: document.getElementById('calTitle'),
        prevBtn: document.getElementById('calPrev'),
        nextBtn: document.getElementById('calNext'),
        checkinBtn: document.getElementById('checkinBtn')
    };

    if (!elements.calEl || !elements.titleEl || !elements.prevBtn || !elements.nextBtn || !elements.checkinBtn) {
        return;
    }

    const today = new Date();
    calendarState = {
        userId: userId,
        viewYear: today.getFullYear(),
        viewMonth: today.getMonth(),
        today: today,
        records: loadCheckinRecords(userId)
    };

    elements.prevBtn.addEventListener('click', () => {
        calendarState.viewMonth--;
        if (calendarState.viewMonth < 0) {
            calendarState.viewMonth = 11;
            calendarState.viewYear--;
        }
        renderCalendar();
    });

    elements.nextBtn.addEventListener('click', () => {
        calendarState.viewMonth++;
        if (calendarState.viewMonth > 11) {
            calendarState.viewMonth = 0;
            calendarState.viewYear++;
        }
        renderCalendar();
    });

    elements.checkinBtn.addEventListener('click', handleCheckin);

    renderCalendar();
}

/**
 * 渲染日历
 */
function renderCalendar() {
    const calEl = document.getElementById('calDays');
    const titleEl = document.getElementById('calTitle');
    const checkinBtn = document.getElementById('checkinBtn');
    
    if (!calEl || !titleEl || !checkinBtn || !calendarState) return;

    const { viewYear, viewMonth, today, records } = calendarState;

    titleEl.textContent = `${viewYear}年${viewMonth + 1}月`;

    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startWeekday = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

    calEl.innerHTML = '';

    // 渲染上个月的补充日期
    renderPrevMonthDays(calEl, startWeekday, prevMonthLastDay);

    // 渲染本月日期
    const alreadyCheckedToday = renderCurrentMonthDays(calEl, viewYear, viewMonth, daysInMonth, today, records);

    // 渲染下个月的补充日期
    renderNextMonthDays(calEl, startWeekday, daysInMonth);

    // 更新打卡按钮状态
    updateCheckinButtonState(checkinBtn, alreadyCheckedToday);
}

/**
 * 渲染上个月的补充日期
 * @param {HTMLElement} container - 容器元素
 * @param {number} startWeekday - 开始的星期
 * @param {number} prevMonthLastDay - 上个月最后一天
 */
function renderPrevMonthDays(container, startWeekday, prevMonthLastDay) {
    for (let i = startWeekday - 1; i >= 0; i--) {
        const dayNum = prevMonthLastDay - i;
        const span = document.createElement('span');
        span.className = 'calendar-day calendar-day--outside';
        span.textContent = dayNum;
        container.appendChild(span);
    }
}

/**
 * 渲染本月日期
 * @param {HTMLElement} container - 容器元素
 * @param {number} viewYear - 年
 * @param {number} viewMonth - 月
 * @param {number} daysInMonth - 本月天数
 * @param {Date} today - 今天日期
 * @param {object} records - 打卡记录
 * @returns {boolean} 今天是否已打卡
 */
function renderCurrentMonthDays(container, viewYear, viewMonth, daysInMonth, today, records) {
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    let alreadyCheckedToday = false;

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

        container.appendChild(span);
    }

    return alreadyCheckedToday;
}

/**
 * 渲染下个月的补充日期
 * @param {HTMLElement} container - 容器元素
 * @param {number} startWeekday - 开始的星期
 * @param {number} daysInMonth - 本月天数
 */
function renderNextMonthDays(container, startWeekday, daysInMonth) {
    const totalCells = startWeekday + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    
    for (let i = 1; i <= trailing; i++) {
        const span = document.createElement('span');
        span.className = 'calendar-day calendar-day--outside';
        span.textContent = i;
        container.appendChild(span);
    }
}

/**
 * 更新打卡按钮状态
 * @param {HTMLElement} button - 按钮元素
 * @param {boolean} alreadyCheckedToday - 今天是否已打卡
 */
function updateCheckinButtonState(button, alreadyCheckedToday) {
    if (alreadyCheckedToday) {
        button.disabled = true;
        button.textContent = '✓ 今日已打卡';
    } else {
        button.disabled = false;
        button.textContent = '打卡签到';
    }
}

/**
 * 处理打卡
 */
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
// 主题切换模块
// =========================================

/**
 * 初始化主题选项
 * @param {string} token - JWT token
 */
function initThemeOptions(token) {
    const options = document.getElementById('themeOptions');
    if (!options) return;

    options.addEventListener('click', (e) => {
        const btn = e.target.closest('.theme-opt');
        if (!btn) return;

        const theme = btn.dataset.theme;
        
        if (typeof ThemeEngine !== 'undefined') {
            ThemeEngine.applyTheme(theme);
            if (token) ThemeEngine.syncThemeToServer(theme, token);
            if (typeof Toast !== 'undefined') {
                Toast.show('主题已切换', 'success');
            }
        }
    });
}

// =========================================
// 主初始化函数
// =========================================

document.addEventListener('DOMContentLoaded', async () => {
    initSidebarToggle();
    initSettingsButton();
    initTabSwitching();

    // 读取 URL 参数中的验证码
    pendingEmailCode = extractEmailCodeFromURL();

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
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Page-Type': 'dashboard'
            }
        });

        if (response.status === 401) {
            AuthGuard.handleAuthError();
            return;
        }

        const data = await response.json();
        if (response.ok && data.code === 200) {
            const user = data.data.user;
            CURRENT_USER.level = user.permission_level;
            pdocsCurrentUserId = user.id;

            renderUserProfile(user);
            renderPermissionButtons(user.permission_level);
            renderTopNavAuth(user);

            checkEmailVerificationStatus(token, user.email);

            loadDynamicMenu(token);
            initThemeOptions(token);
            initCheckinCalendar(user.id);
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
    }
});

/**
 * 从 URL 提取邮箱验证码
 * @returns {string|null} 验证码或 null
 */
function extractEmailCodeFromURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        
        if (code && /^\d{6}$/.test(code)) {
            // 清除 URL 参数
            const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
            return code;
        }
    } catch (e) {
        console.warn('解析 URL 参数失败', e);
    }
    return null;
}

// =========================================
// 个人文档模块（保持原逻辑，使用新的工具函数）
// =========================================

let pdocsEditingId = null;
let pdocsMarkedReady = false;
let pdocsMarkedLoading = null;
let pdocsFolders = [];
let pdocsCurrentFolderId = null;
let pdocsCurrentUserId = null;

/**
 * 个人文档统一请求封装
 * @param {string} path - API 路径
 * @param {object} options - fetch 选项
 * @returns {Promise<object|null>} 响应数据或 null
 */
async function pdocsRequest(path, options = {}) {
    return await apiRequest(`/api/v1/document${path}`, options);
}

/**
 * 动态加载 marked.js
 * @returns {Promise<void>}
 */
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

/**
 * HTML 转义（个人文档专用）
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function pdocsEscape(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/**
 * 格式化时间（个人文档专用）
 * @param {string} iso - ISO 格式时间
 * @returns {string} 格式化后的时间
 */
function pdocsFmtTime(iso) {
    return formatFriendlyTime(iso);
}

/**
 * 从 Markdown 提取摘要
 * @param {string} content - Markdown 内容
 * @returns {string} 摘要
 */
function pdocsExtractSummary(content) {
    if (!content) return '';
    const text = content.replace(/^#+\s.*$/gm, '').replace(/[*`>~_\-\[\]\(\)]/g, '').trim();
    const firstLine = text.split('\n').find(l => l.trim()) || '';
    return firstLine.slice(0, 100);
}

/**
 * 初始化个人文档
 */
function initPersonalDocs() {
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
    renderFolderBreadcrumb();
}

/**
 * 切换个人文档视图
 * @param {string} viewName - 视图名称
 */
function showPdocsView(viewName) {
    ['list', 'editor', 'trash'].forEach(v => {
        const el = document.getElementById(`pdocs-view-${v}`);
        if (el) el.style.display = (v === viewName) ? '' : 'none';
    });
    
    if (viewName === 'list') loadPersonalDocs();
    if (viewName === 'trash') loadPersonalTrash();
}

/**
 * 加载个人文档列表
 */
async function loadPersonalDocs() {
    const container = document.getElementById('pdocsListContainer');
    if (!container) return;
    
    container.innerHTML = '<p class="loading-text">加载中...</p>';

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

/**
 * 加载个人回收站列表
 */
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

/**
 * 渲染个人文档列表
 * @param {Array} docs - 文档数组
 */
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
            <p class="pdocs-doc-card__summary">${pdocsEscape((doc.summary && doc.summary.trim()) ? doc.summary : '无内容')}</p>
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

    // 绑定事件
    bindPdocsListActions(container);
}

/**
 * 绑定个人文档列表操作事件
 * @param {HTMLElement} container - 容器元素
 */
function bindPdocsListActions(container) {
    container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id, 10);
            
            if (action === 'edit') openPdocsEditor(id);
            else if (action === 'delete') softDeletePersonalDoc(id);
        });
    });

    container.querySelectorAll('.pdocs-move-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const docId = parseInt(sel.dataset.id, 10);
            const folderId = parseInt(sel.value, 10);
            movePersonalDoc(docId, folderId);
        });
    });

    container.querySelectorAll('.pdocs-doc-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = parseInt(card.dataset.docId, 10);
            openPdocsEditor(id);
        });
    });
}

/**
 * 渲染个人回收站列表
 * @param {Array} docs - 文档数组
 */
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

/**
 * 打开个人文档编辑器
 * @param {number|null} docId - 文档 ID（null 为新建）
 */
async function openPdocsEditor(docId) {
    pdocsEditingId = docId || null;
    showPdocsView('editor');

    const titleInput = document.getElementById('pdocsTitleInput');
    const contentInput = document.getElementById('pdocsContentInput');
    const preview = document.getElementById('pdocsPreview');

    if (!docId) {
        titleInput.value = '';
        contentInput.value = '';
        preview.style.display = 'none';
        preview.innerHTML = '';
        titleInput.focus();
        return;
    }

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

/**
 * 保存个人文档
 */
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
        visibility: 'private',
        permission_bits: '100000'
    };

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
    pdocsEditingId = data.data.id;

    const preview = document.getElementById('pdocsPreview');
    if (preview.style.display !== 'none') renderPdocsPreview();

    setTimeout(() => {
        showPdocsView('list');
    }, 800);
}

/**
 * 软删除个人文档
 * @param {number} docId - 文档 ID
 */
async function softDeletePersonalDoc(docId) {
    const confirmed = await Modal.confirm('确认将此文档移入回收站？', { title: '删除文档' });
    if (!confirmed) return;

    const data = await pdocsRequest(`/${docId}`, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
        return;
    }

    if (typeof Toast !== 'undefined') Toast.show('已移入回收站', 'success');
    loadPersonalDocs();
}

/**
 * 恢复个人文档
 * @param {number} docId - 文档 ID
 */
async function restorePersonalDoc(docId) {
    const data = await pdocsRequest(`/${docId}/restore`, { method: 'POST' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '恢复失败', 'error');
        return;
    }

    if (typeof Toast !== 'undefined') Toast.show('恢复成功', 'success');
    loadPersonalTrash();
}

/**
 * 彻底删除个人文档
 * @param {number} docId - 文档 ID
 */
async function permanentDeletePersonalDoc(docId) {
    const confirmed = await Modal.confirm('彻底删除后无法恢复，确认删除？', { title: '彻底删除' });
    if (!confirmed) return;

    const data = await pdocsRequest(`/${docId}/permanent`, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
        return;
    }

    if (typeof Toast !== 'undefined') Toast.show('已彻底删除', 'success');
    loadPersonalTrash();
}

/**
 * 切换预览显示
 */
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

/**
 * 渲染 Markdown 预览
 */
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
// 个人文件夹模块
// =========================================

/**
 * 加载个人文件夹列表
 */
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

/**
 * 渲染个人文件夹列表
 */
function renderPdocsFolders() {
    const container = document.getElementById('pdocsFoldersList');
    if (!container) return;

    const items = [];
    
    // 第一项：全部
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

    // 绑定事件
    bindPdocsFolderActions(container);
}

/**
 * 绑定个人文件夹操作事件
 * @param {HTMLElement} container - 容器元素
 */
function bindPdocsFolderActions(container) {
    container.querySelectorAll('.pdocs-folder-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            if (e.target.closest('.pdocs-folder-chip__btn')) return;

            const fid = chip.dataset.folderId;
            pdocsCurrentFolderId = fid === '' ? null : parseInt(fid, 10);
            
            renderPdocsFolders();
            renderFolderBreadcrumb();
            loadPersonalDocs();
        });
    });

    container.querySelectorAll('.pdocs-folder-chip__btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id, 10);
            
            if (action === 'rename') {
                const folder = pdocsFolders.find(f => f.id === id);
                const newName = await Modal.prompt('重命名文件夹:', folder ? folder.name : '', { title: '重命名文件夹' });
                if (newName !== null && newName.trim()) {
                    renamePersonalFolder(id, newName.trim());
                }
            } else if (action === 'delete') {
                deletePersonalFolder(id);
            }
        });
    });

    const addBtn = document.getElementById('pdocsFolderAddBtn');
    if (addBtn && !addBtn.dataset.pdocsBound) {
        addBtn.dataset.pdocsBound = '1';
        addBtn.addEventListener('click', addPersonalFolder);
    }
}

/**
 * 新建个人文件夹
 */
async function addPersonalFolder() {
    const name = await Modal.prompt('请输入文件夹名称:', '', { title: '新建文件夹' });
    if (name === null || !name.trim()) return;

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

/**
 * 重命名个人文件夹
 * @param {number} id - 文件夹 ID
 * @param {string} newName - 新名称
 */
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

/**
 * 删除个人文件夹
 * @param {number} id - 文件夹 ID
 */
async function deletePersonalFolder(id) {
    const confirmed = await Modal.confirm('删除文件夹后，文件夹内的文档将变为未归类，确认删除？', { title: '删除文件夹' });
    if (!confirmed) return;

    const data = await pdocsRequest(`/folders/${id}`, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
        return;
    }

    if (typeof Toast !== 'undefined') Toast.show('已删除文件夹', 'success');
    
    if (pdocsCurrentFolderId === id) pdocsCurrentFolderId = null;
    
    loadPersonalFolders();
    loadPersonalDocs();
}

/**
 * 移动文档到指定文件夹
 * @param {number} docId - 文档 ID
 * @param {number} folderId - 文件夹 ID
 */
async function movePersonalDoc(docId, folderId) {
    const body = JSON.stringify({ folder_id: folderId === 0 ? null : folderId });
    const data = await pdocsRequest(`/${docId}`, { method: 'PUT', body });

    if (!data || data.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show(data?.msg || '移动失败', 'error');
        return;
    }

    if (typeof Toast !== 'undefined') Toast.show('已移动', 'success');
    loadPersonalDocs();
}

/**
 * 渲染个人文档面包屑导航
 */
function renderFolderBreadcrumb() {
    const container = document.getElementById('pdocsBreadcrumb');
    if (!container) return;

    let pathText = '';
    if (pdocsCurrentFolderId === null) {
        pathText = '📋 全部文档';
    } else if (pdocsCurrentFolderId === 0) {
        pathText = '📋 全部 > 📁 未归类';
    } else {
        const folder = pdocsFolders.find(f => f.id === pdocsCurrentFolderId);
        if (folder) {
            pathText = `📋 全部 > 📁 ${pdocsEscape(folder.name)}`;
        } else {
            pathText = '📋 全部文档';
        }
    }

    container.innerHTML = `<div class="pdocs-breadcrumb">${pathText}</div>`;
}