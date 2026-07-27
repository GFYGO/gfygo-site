/**
 * login.js
 * 登录页交互逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. 获取 Turnstile Token
        const turnstileToken = window.turnstile.getResponse();
        if (!turnstileToken) {
            alert('请完成人机验证');
            return;
        }

        // 2. 收集表单数据
        const formData = new FormData(loginForm);
        const payload = {
            username: formData.get('username'),
            password: formData.get('password'),
            cf_turnstile_token: turnstileToken
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
                AuthGuard.setToken(data.token, data.expires_in);
                window.location.href = 'dashboard.html';
            } else {
                // 5. 登录失败：根据状态码提示错误信息
                console.error(`登录失败 [${response.status}]:`, data.msg);
                alert(data.msg || '登录失败');
                
                // 登录失败后重置 Turnstile，允许用户重新验证
                window.turnstile.reset();
            }
        } catch (error) {
            console.error('登录请求异常:', error);
            alert('网络错误，请稍后重试');
            window.turnstile.reset();
        }
    });
});