/**
 * login.js
 * 登录页交互逻辑
 */

// 显式渲染 Turnstile 验证组件
function renderTurnstileLogin() {
    const container = document.getElementById('turnstile-widget-login');
    if (!container) return;
    if (typeof window.turnstile === 'undefined') {
        // 如果 API 尚未加载，延迟重试
        setTimeout(renderTurnstileLogin, 300);
        return;
    }
    try {
        window.turnstile.render(container, {
            sitekey: '0x4AAAAAAECyOCbL7qIJUOgg'
        });
    } catch (e) {
        console.warn('[Turnstile] render error:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderTurnstileLogin();
    const loginForm = document.getElementById('loginForm');

    // 任务 FE-JS-02: 处理表单提交
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. 获取 Turnstile Token
        if (typeof window.turnstile === 'undefined') {
            Toast.show('验证组件加载中，请稍后重试');
            return;
        }
        const turnstileToken = window.turnstile.getResponse();

        if (!turnstileToken) {
            Toast.show('请完成人机验证');
            return;
        }

        // 2. 收集表单数据
        const formData = new FormData(loginForm);
        const payload = {
            username: formData.get('username'),
            password: formData.get('password'),
            cf_turnstile_token: turnstileToken // 现在可以确保这个值是有效的
        };

        try {
            // 3. 发送登录请求
            const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok && data.code === 200) {
                // 4. 登录成功：存储 Token 并跳转
                AuthGuard.setToken(data.data.access_token, data.data.expires_in);

                // 清除访客视角模式，确保后续页面正常渲染登录状态
                localStorage.removeItem('guest_view_mode');

                Toast.show('登录成功，正在跳转...', 'success');
                setTimeout(() => {
                    window.location.href = './user/dashboard.html';
                }, 800);
            } else {
                // 5. 登录失败：提示错误信息
                Toast.show(data.msg || '登录失败，请重试');
                // 重置 Turnstile
                window.turnstile.reset();
            }
        } catch (error) {
            console.error('登录请求异常:', error);
            Toast.show('网络错误，请稍后重试');
        }
    });
});
