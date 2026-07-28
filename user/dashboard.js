/**
 * dashboard.js
 * 用户主页逻辑：鉴权校验 + 侧边栏用户信息渲染
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 鉴权校验：无 token 则跳转登录页
    const token = AuthGuard.getToken();
    if (!token) {
        AuthGuard.handleAuthError();
        return;
    }

    // 2. 拉取用户信息并渲染侧边栏
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
            renderSidebarUser(data.data.user);
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
    }
});

/**
 * 渲染侧边栏用户头像和用户名
 * @param {Object} user 用户信息对象
 */
function renderSidebarUser(user) {
    const avatarImg = document.querySelector('.profile-avatar img');
    const usernameSpan = document.querySelector('.profile-username');

    const avatar = (user.profile && user.profile.avatar) ? user.profile.avatar : '../favicon.png';

    if (avatarImg) {
        avatarImg.src = avatar;
        avatarImg.onerror = function() { this.src = '../favicon.png'; };
    }
    if (usernameSpan) {
        usernameSpan.textContent = user.username;
    }
}
