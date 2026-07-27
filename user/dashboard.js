/**
 * dashboard.js
 * 个人主页交互逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 路由守卫：检查登录状态
    AuthGuard.requireAuth();

    // 2. 获取并渲染用户信息
    await loadUserProfile();

    // 3. 初始化主题切换器
    initThemeSelector();
});

/**
 * 调用 /api/v1/user/profile 接口获取用户信息并渲染到页面
 */
async function loadUserProfile() {
    const token = AuthGuard.getToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/user/profile`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (response.ok && data.code === 200) {
            renderUserProfile(data.data);
            // 根据后端返回的用户偏好设置主题
            ThemeEngine.setTheme(data.data.theme);
        } else if (response.status === 401 || response.status === 422) {
            // Token 无效或过期
            AuthGuard.handleAuthError();
        } else {
            Toast.show(data.msg || '获取用户信息失败');
        }
    } catch (error) {
        console.error('获取用户信息异常:', error);
        Toast.show('网络错误，无法加载用户信息');
    }
}

/**
 * 将用户数据渲染到 dashboard.html 的对应元素中
 * @param {Object} user 用户数据对象
 */
function renderUserProfile(user) {
    const usernameEl = document.getElementById('user-username');
    const avatarEl = document.getElementById('user-avatar');

    if (usernameEl) usernameEl.textContent = user.username;
    if (avatarEl) avatarEl.src = user.avatar || './default-avatar.png'; // 使用默认头像作为后备
}

/**
 * 初始化主题切换按钮的事件监听
 */
function initThemeSelector() {
    const themeSelector = document.getElementById('theme-selector');
    if (!themeSelector) return;

    const themes = ['theme-light', 'theme-dark', 'theme-blue', 'theme-green'];
    let currentThemeIndex = 0;

    themeSelector.addEventListener('click', async () => {
        // 循环切换主题
        currentThemeIndex = (currentThemeIndex + 1) % themes.length;
        const newTheme = themes[currentThemeIndex];
        
        // 1. 前端切换主题
        ThemeEngine.setTheme(newTheme);

        // 2. 调用后端 API 保存主题偏好
        const token = AuthGuard.getToken();
        if (!token) return;

        try {
            await fetch(`${API_BASE_URL}/api/v1/user/theme`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ theme: newTheme })
            });
            // 可以根据需要添加成功提示，例如 Toast.show('主题已更新', 'success');
        } catch (error) {
            console.error('更新主题偏好失败:', error);
            // 如果后端更新失败，可以考虑回滚前端的主题切换
        }
    });
}