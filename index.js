/**
 * index.js
 * 首页初始化脚本
 */

document.addEventListener('DOMContentLoaded', () => {
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
 * 已登录 → 显示头像 + 用户名 + 退出链接
 * 未登录 → 显示「登录/注册」链接
 * @param {Object|null} userInfo 用户信息对象 (data.data.user)，未登录时为 null
 */
function renderAuthStatus(userInfo) {
  const authContainer = document.getElementById('auth-container');
  if (!authContainer) return;

  // 清空容器
  authContainer.innerHTML = '';

  if (userInfo) {
    // 从 profile 中取头像，无则用默认 favicon
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
    // 未登录状态
    const loginLink = document.createElement('a');
    loginLink.href = `${BASE_PATH}/login.html`;
    loginLink.textContent = '登录/注册';
    loginLink.className = 'login-link';
    authContainer.appendChild(loginLink);
  }
}