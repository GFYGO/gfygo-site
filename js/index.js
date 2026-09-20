/**
 * index.js
 * 首页初始化脚本 + 全局公共逻辑（移动端菜单、侧边栏）
 */

function initIndex() {
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
}

// 管理员页面通过 fetch 动态加载脚本，DOMContentLoaded 可能已触发
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIndex);
} else {
  initIndex();
}

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
 * 任务 FE-JS-03: 处理 /api/v0/notify/global 的响应并渲染
 */
async function fetchGlobalNotifications() {
  // dashboard / 组织页 有自己的通知加载逻辑，此处跳过
  if (/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname)
      || /\/org\/index\.html$/i.test(window.location.pathname)) {
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/v0/notify/global`);
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
 * 任务 FE-JS-02: 处理 /api/v0/auth/status 的响应并渲染用户信息
 */
async function fetchAuthStatus() {
  // 所有 dashboard 类页面由 dashboard.js 独立处理认证状态，避免重复渲染冲突
  if (/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname)) {
    return;
  }
  // 组织页自己渲染顶栏用户区（org.js::renderOrgAuthArea），这里跳过以免两套逻辑互相覆盖
  if (/\/org\/index\.html$/i.test(window.location.pathname)) {
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
    const response = await fetch(`${API_BASE_URL}/api/v0/auth/status`, {
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

  container.style.display = 'flex';
  
  notifications.forEach(notification => {
    const notificationEl = document.createElement('div');
    notificationEl.className = 'notification-item';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', '关闭通知');
    closeBtn.addEventListener('click', function() {
      notificationEl.style.transition = 'opacity 0.2s';
      notificationEl.style.opacity = '0';
      setTimeout(function() {
        notificationEl.remove();
        if (container.children.length === 0) {
          container.style.display = 'none';
        }
      }, 200);
    });
    
    const titleEl = document.createElement('h3');
    titleEl.textContent = notification.title;
    const p = document.createElement('p');
    p.textContent = notification.content;
    
    notificationEl.appendChild(closeBtn);
    notificationEl.appendChild(titleEl);
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
        window.location.replace(`${BASE_PATH}/login.html?_t=${Date.now()}`);
      });
    }

    // 渲染权限切换按钮（仅管理员可见）
    if (typeof window.renderPermissionButtons === 'function') {
      window.renderPermissionButtons(userInfo ? userInfo.permission_level : 0);
    }
  } else {
    navLoginLinks.forEach(link => link.style.display = '');
    navRegisterLinks.forEach(link => link.style.display = '');
    if (typeof window.renderPermissionButtons === 'function') {
      window.renderPermissionButtons(0);
    }
  }
}

// 角色名映射：全局单例挂载（不用 const 别名，避免与 dashboard.js 同名声明冲突）
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

/**
 * 渲染右上角权限等级切换按钮
 *  - realLevel（真实等级，来自 /auth/status）<= 1：不显示按钮
 *  - 当前运行时等级来自 window.__nowPermission.level（默认 1，可切换）
 *  - 行为：调用 /auth/switch-permission 真实切换 level（可升可降，不越权 realLevel）
 *
 * ⚠️ 兼容两种签名：这里传的是**数字**（真实等级），而
 *    `user/dashboard.auth.js` 也导出同名函数、传的是**对象** `{current_level, max_level}`。
 *    两者都挂在 `window.renderPermissionButtons` 上，历史上谁后加载谁生效 →
 *    在主页面上被调成对象版就会把「数字」当成对象读，`current_level` 恒为 undefined，
 *    表现为**无论切到哪一级，高亮都停在 Lv1**（切换看着像没生效）。
 *    因此这里用 `normalizePermissionArgs()` 统一取值：谁后加载都不会读错参数。
 */
function normalizePermissionArgs(input) {
  if (input && typeof input === 'object') {
    const current = parseInt(input.current_level != null ? input.current_level : input.level, 10);
    const max = parseInt(input.max_level != null ? input.max_level : input.real_level, 10);
    return {
      realLevel: Number.isFinite(max) ? max : 1,
      currentLevel: Number.isFinite(current) ? current : 1,
    };
  }
  const real = parseInt(input, 10);
  const np = window.__nowPermission || {};
  const current = parseInt(np.level, 10);
  return {
    realLevel: Number.isFinite(real) ? real : 1,
    currentLevel: Number.isFinite(current) ? current : 1,
  };
}

window.renderPermissionButtons = window.renderPermissionButtons || function (levelOrInfo) {
  const container = document.getElementById('permissionButtons');
  if (!container) return;

  const normalized = normalizePermissionArgs(levelOrInfo);
  const realLevel = normalized.realLevel;

  container.innerHTML = '';

  // 未登录 / 普通用户：没有可切换的等级
  if (!realLevel || realLevel <= 1) return;

  // 当前运行时等级（优先用参数里的，其次读 now_permission）
  const currentLevel = normalized.currentLevel || 1;

  // 显示等级 1 到真实等级的按钮（可升可降）
  const levels = [1];
  for (let level = 2; level <= realLevel; level++) {
    levels.push(level);
  }

  levels.forEach(level => {
    const btn = document.createElement('button');
    btn.className = 'perm-btn';
    if (level === currentLevel) {
      // ⚠️ 类名契约：CSS 只定义了 `.perm-btn--current`（components.css），
      //    写成 `--active` 会让任何等级都不高亮（历史 bug，见 PROJECT_MEMORY §0.7）。
      btn.classList.add('perm-btn--current');
    }
    btn.textContent = level;
    btn.title = `切换到 ${window.ROLE_NAMES[level] || `等级${level}`}`;
    btn.addEventListener('click', () => {
      if (typeof window.handlePermissionClick === 'function') window.handlePermissionClick(level);
    });
    container.appendChild(btn);
  });
};

/**
 * 切换等级后让按钮高亮立即跟随新等级。
 *
 * 之前这里**根本没有重绘**：切完只改了 token 与 `window.__nowPermission`，
 * 屏幕上的按钮还是按旧等级画的 → 用户看到「点了没反应 / 高亮没变」。
 * 重绘时以「服务端返回的新等级为当前等级、真实最高等级保持不变」为准。
 */
function refreshPermissionButtonsAfterSwitch(newLevel) {
  const realLevel = parseInt(window.__currentUserPermissionLevel, 10);
  const max = Number.isFinite(realLevel) && realLevel >= 1 ? realLevel : newLevel;
  try {
    window.renderPermissionButtons({ current_level: newLevel, max_level: max });
  } catch (e) {
    console.warn('重绘权限按钮失败:', e);
  }
}

window.handlePermissionClick = window.handlePermissionClick || async function (level) {
  // 调用切换 API（真实切换 now_permission.level，可升可降）
  try {
    const token = AuthGuard.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`${API_BASE_URL}/api/v0/auth/switch-permission`, {
      method: 'POST',
      headers: headers,
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
    // ⚠️ 前端兜底的 context 阈值必须与后端一致：`services/auth_service.py::switch_permission`
    //    是 `target_level >= 2 → 'admin'`。历史上这里写成 `>= 4`，
    //    导致 Lv2/Lv3 切完之后管理接口全被判成「缺少 admin 权限上下文」。
    window.__nowPermission = np.now_permission || { level, context: level >= 2 ? 'admin' : null, nodes: [] };
  } catch (e) {
    console.warn('切换权限请求异常:', e);
    return;
  }

  // 立即重绘：高亮必须在「点完就有反馈」，不能等下一次整页刷新
  refreshPermissionButtonsAfterSwitch(level);

  // 判断当前页面是否是 dashboard 类页面（需要跳转）
  const isDashboardPage = /\/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname);

  if (isDashboardPage) {
    localStorage.removeItem('guest_view_mode');
    window.location.href = `${BASE_PATH}/user/dashboard.html`;
    return;
  }

  // 非 dashboard 页面：刷新以重新渲染按权限控制的 UI
  window.location.reload();
};