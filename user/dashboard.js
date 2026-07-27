/**
 * dashboard.js
 * 个人主页数据渲染与交互
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 任务 FE-JS-01: 路由守卫，检查登录状态
    AuthGuard.requireAuth();

    // 任务 FE-JS-04: 初始化主题引擎
    ThemeEngine.init();

    // 任务 FE-JS-03: 渲染用户信息
    await loadUserProfile();
});

async function loadUserProfile() {
    const token = AuthGuard.getToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/user/profile`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // 处理全局鉴权异常 (401, 422)
        if (response.status === 401 || response.status === 422) {
            AuthGuard.handleAuthError();
            return;
        }

        const data = await response.json();

        if (response.ok && data.code === 200) {
            const userData = data.data;
            
            // 动态渲染用户名和头像
            document.getElementById('userName').textContent = userData.username;
            document.getElementById('userAvatar').src = userData.avatar;

            // 任务 FE-JS-04: 同步后端下发的主题偏好
            if (userData.theme) {
                ThemeEngine.setTheme(userData.theme);
            }
        } else {
            console.error('获取用户信息失败:', data.msg);
        }
    } catch (error) {
        console.error('请求异常:', error);
    }
}