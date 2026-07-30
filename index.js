/**
 * index.js
 * 首页初始化脚本 + 全局公共逻辑（移动端菜单、侧边栏）
 */

document.addEventListener('DOMContentLoaded', () => {
  // 初始化移动端汉堡菜单
  initMobileMenu();

  // 初始化移动端侧边栏（dashboard 页面）
  initMobileSidebar();

  // 任务 FE-JS-01: 页面加载时并发请求
  Promise.all([
    fetchGlobalNotifications(),
    fetchAuthStatus()
  ]).catch(error => {
    // 捕获单个请求失败可能抛出的错误，避免影响其他功能
    console.error('首页初始化请求发生异常:', error);
  });
});

/**
 * 移动端汉堡菜单切换
 */
function initMobileMenu() {
  const menuToggle = document.getElementById('menuToggle');
  const headerNav = document.getElementById('headerNav');

  if (menuToggle && headerNav) {
    menuToggle.addEventListener('click', () => {
      headerNav.classList.toggle('header__nav--open');
    });

    // 点击导航链接后自动收起菜单
    headerNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        headerNav.classList.remove('header__nav--open');
      });
    });
  }
}

/**
 * 移动端侧边栏切换（dashboard 页面）
 */
function initMobileSidebar() {
  const sidebar = document.getElementById('dashboardSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const sidebarClose = document.getElementById('sidebarClose');

  if (!sidebar) return;

  if (sidebarClose) {
    sidebarClose.addEventListener('click', closeSidebar);
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  function closeSidebar() {
    sidebar.classList.remove('dashboard-sidebar--open');
    if (overlay) overlay.classList.remove('sidebar-overlay--visible');
  }
}

/**
 * 获取全局通知
 * 任务 FE-JS-03: 处理 /api/v1/notify/global 的响应并渲染
 */
async function fetchGlobalNotifications() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/notify/global`);
    const data = await response.json();
    if (response.ok && data.code === 200) {
      renderGlobalNotifications(data.data);
    } else {
      console.warn('获取全局通知失败:', data.msg);
    }
  } catch (error) {
    console.error('获取全局通知时发生网络错误:', error);
  }
}

/**
 * 检查登录状态
 * 任务 FE-JS-02: 处理 /api/v1/auth/status 的响应并渲染用户信息
 */
async function fetchAuthStatus() {
  // 所有 dashboard 类页面由 dashboard.js 独立处理认证状态，避免重复渲染冲突
  if (/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname)) {
    return;
  }

  // 访客视角预览模式：跳过 API 调用，直接渲染未登录状态
  if (localStorage.getItem('guest_view_mode') === 'true') {
    renderAuthStatus(null);
    return;
  }

  const token = AuthGuard.getToken();
  // 如果没有 token，则直接渲染未登录状态
  if (!token) {
    renderAuthStatus(null);
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (response.ok && data.code === 200) {
      renderAuthStatus(data.data.user);
      // 已登录用户访问登录/注册页面时，自动重定向到 dashboard
      const currentPath = window.location.pathname;
      if (currentPath.endsWith('/login.html') || currentPath.endsWith('/register.html')) {
        window.location.href = `${BASE_PATH}/user/dashboard.html`;
      }
    } else {
      // 如果 token 无效或过期，按未登录状态处理
      console.warn('认证状态检查失败:', data.msg);
      renderAuthStatus(null);
    }
  } catch (error) {
    console.error('检查认证状态时发生网络错误:', error);
    renderAuthStatus(null);
  }
}

/**
 * 渲染全局通知到页面
 * @param {Array} notifications 通知数据数组
 */
function renderGlobalNotifications(notifications) {
  const container = document.getElementById('global-notifications-container');
  if (!container) return;

  container.innerHTML = '';

  if (!notifications || notifications.length === 0) {
    container.style.display = 'none';
    return;
  }

  notifications.forEach(notification => {
    const notificationEl = document.createElement('div');
    notificationEl.className = 'notification-item';
    const h3 = document.createElement('h3');
    h3.textContent = notification.title;
    const p = document.createElement('p');
    p.textContent = notification.content;
    notificationEl.appendChild(h3);
    notificationEl.appendChild(p);
    container.appendChild(notificationEl);
  });
}

/**
 * 渲染右上角用户状态
 * 已登录 → 显示头像 + 用户名 + 退出链接，隐藏导航中的「登录/注册」
 * 未登录 → auth-container 留空（导航栏已有登录/注册链接）
 * @param {Object|null} userInfo 用户信息对象 (data.data.user)，未登录时为 null
 */
function renderAuthStatus(userInfo) {
  // 暂存当前用户实际权限等级，供非 dashboard 页切换按钮重绘时使用
  if (userInfo) {
    window.__currentUserPermissionLevel = userInfo.permission_level || 1;
  }

  const authContainer = document.getElementById('auth-container');
  if (!authContainer) return;

  authContainer.innerHTML = '';

  const navLoginLinks = document.querySelectorAll('.header__nav a[href*="login"]');
  const navRegisterLinks = document.querySelectorAll('.header__nav a[href*="register"]');

  if (userInfo) {
    const avatar = (userInfo.profile && userInfo.profile.avatar) ? userInfo.profile.avatar : '';
    const defaultAvatar = `${BASE_PATH}/favicon.png`;

    const userEl = document.createElement('div');
    userEl.className = 'user-info';

    const img = document.createElement('img');
    img.src = avatar || defaultAvatar;
    img.alt = userInfo.username;
    img.className = 'user-avatar';
    img.onerror = function() { this.src = defaultAvatar; };
    userEl.appendChild(img);

    const usernameLink = document.createElement('a');
    usernameLink.href = `${BASE_PATH}/user/dashboard.html`;
    usernameLink.className = 'username';
    usernameLink.textContent = userInfo.username;
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
        window.location.href = `${BASE_PATH}/index.html`;
      });
    }

    // 渲染权限切换按钮（仅管理员可见）
    renderPermissionButtons(userInfo ? userInfo.permission_level : 0);
  } else {
    navLoginLinks.forEach(link => link.style.display = '');
    navRegisterLinks.forEach(link => link.style.display = '');
    renderPermissionButtons(0);
  }
}

const ROLE_NAMES = {
  0: '未登录',
  1: '普通用户',
  2: '一级管理员',
  3: '二级管理员',
  4: '三级管理员',
  5: '超级管理员'
};

/**
 * 渲染右上角权限等级切换按钮
 *  - permissionLevel <= 1：不显示按钮（非管理员）
 *  - 视角等级语义：
 *      1 = 用户视角（默认）
 *      2~N = 该等级管理员视角
 *      0 = 访客视角（仅超管可见）
 *  - 行为：仅在各 dashboard 页面点击后跳转；其他页面仅切换 localStorage 视角，不做跳转
 */
function renderPermissionButtons(permissionLevel) {
  const container = document.getElementById('permissionButtons');
  if (!container) return;

  container.innerHTML = '';

  if (!permissionLevel || permissionLevel <= 1) return;

  const viewOverrideRaw = localStorage.getItem('view_as_level');
  const viewOverride = viewOverrideRaw ? parseInt(viewOverrideRaw, 10) : null;
  const effectiveLevel = Number.isInteger(viewOverride) ? viewOverride : 1;

  const levels = [];
  if (permissionLevel >= 5) levels.push(0);
  levels.push(1);
  for (let level = 2; level <= permissionLevel; level++) {
    levels.push(level);
  }

  levels.forEach(level => {
    const btn = document.createElement('button');
    btn.className = 'perm-btn';
    if (level === effectiveLevel) {
      btn.classList.add('perm-btn--current');
    }
    btn.textContent = level;
    btn.title = `切换到 ${ROLE_NAMES[level] || `等级${level}`} 视角`;
    btn.addEventListener('click', () => handlePermissionClick(level));
    container.appendChild(btn);
  });
}

function handlePermissionClick(level) {
  // 判断当前页面是否是 dashboard 类页面（需要跳转）
  const isDashboardPage = /\/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname);

  // 访客视角（level=0）
  if (level === 0) {
    localStorage.setItem('guest_view_mode', 'true');
    localStorage.removeItem('view_as_level');
    // 访问客模式一律跳首页（避免在 dashboard 里残留）
    window.location.href = `${BASE_PATH}/index.html`;
    return;
  }

  const adminPaths = {
    2: 'admin2',
    3: 'admin3',
    4: 'admin1',
    5: 'superadmin'
  };

  // ============== dashboard 页面：执行跳转 ==============
  if (isDashboardPage) {
    if (level === 1) {
      // 等级 1：回用户 dashboard
      localStorage.removeItem('view_as_level');
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

  // ============== 非 dashboard 页面：不跳转，只更新视角高亮（存 localStorage，刷新按钮重绘） ==============
  if (level === 1) {
    localStorage.removeItem('view_as_level');
  } else {
    localStorage.setItem('view_as_level', String(level));
  }
  localStorage.removeItem('guest_view_mode');

  // 重绘按钮高亮（不跳转）
  const userPerm = window.__currentUserPermissionLevel || level;
  renderPermissionButtons(userPerm);
}