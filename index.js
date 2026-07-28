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
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('profileSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const sidebarClose = document.getElementById('sidebarClose');

  if (!sidebar) return;

  // 汉堡菜单打开侧边栏
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.add('profile-sidebar--open');
      if (overlay) overlay.classList.add('sidebar-overlay--visible');
    });
  }

  // 关闭按钮
  if (sidebarClose) {
    sidebarClose.addEventListener('click', closeSidebar);
  }

  // 点击遮罩层关闭
  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  function closeSidebar() {
    sidebar.classList.remove('profile-sidebar--open');
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

  // 清空容器
  container.innerHTML = '';

  if (!notifications || notifications.length === 0) {
    container.style.display = 'none'; // 如果没有通知，可以隐藏容器
    return;
  }

  // 遍历通知数组，生成 DOM 元素
  notifications.forEach(notification => {
    const notificationEl = document.createElement('div');
    notificationEl.className = 'notification-item';
    notificationEl.innerHTML = `
      <h3>${notification.title}</h3>
      <p>${notification.content}</p>
    `;
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
  const authContainer = document.getElementById('auth-container');
  if (!authContainer) return;

  // 清空容器
  authContainer.innerHTML = '';

  // 获取导航栏中的登录/注册链接
  const navLoginLink = document.querySelector('.header__nav a[href*="login"]');
  const navRegisterLink = document.querySelector('.header__nav a[href*="register"]');

  if (userInfo) {
    // --- 已登录：显示头像 + 用户名 + 退出 ---
    const avatar = (userInfo.profile && userInfo.profile.avatar) ? userInfo.profile.avatar : '';
    const defaultAvatar = `${BASE_PATH}/favicon.png`;

    const userEl = document.createElement('div');
    userEl.className = 'user-info';
    userEl.innerHTML = `
      <img src="${avatar || defaultAvatar}" alt="${userInfo.username}" class="user-avatar" onerror="this.src='${defaultAvatar}'">
      <a href="${BASE_PATH}/user/dashboard.html" class="username">${userInfo.username}</a>
      <a href="#" class="logout-link" id="logoutBtn">退出</a>
    `;
    authContainer.appendChild(userEl);

    // 隐藏导航栏中的「登录/注册」
    if (navLoginLink) navLoginLink.style.display = 'none';
    if (navRegisterLink) navRegisterLink.style.display = 'none';

    // 绑定退出登录
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        AuthGuard.clearToken();
        window.location.href = `${BASE_PATH}/index.html`;
      });
    }
  } else {
    // --- 未登录：导航栏已有「登录/注册」，auth-container 留空 ---
    if (navLoginLink) navLoginLink.style.display = '';
    if (navRegisterLink) navRegisterLink.style.display = '';
  }
}