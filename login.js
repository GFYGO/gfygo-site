/**
 * login.js
 * 登录页交互逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');

    // 任务 FE-JS-02: 处理表单提交
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. 获取 Turnstile Token（带重试机制）
        if (typeof window.turnstile === 'undefined') {
            Toast.show('验证组件加载中，请稍后重试');
            return;
        }
        let turnstileToken = window.turnstile.getResponse();

        // 如果 Token 为空，尝试重新渲染 Turnstile
        if (!turnstileToken) {
            try {
                const turnstileEl = document.querySelector('.cf-turnstile');
                if (turnstileEl) {
                    window.turnstile.render(turnstileEl, {
                        'sitekey': turnstileEl.getAttribute('data-sitekey')
                    });
                    // 重新获取 Token
                    turnstileToken = window.turnstile.getResponse(turnstileEl);
                }
            } catch (e) {
                console.error('Turnstile 重新渲染失败:', e);
            }
        }

        if (!turnstileToken) {
            Toast.show('人机验证未完成，请完成验证后重试');
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
                const uid = (data.data && data.data.user && data.data.user.id) ? data.data.user.id : null;
                AuthGuard.setToken(data.data.access_token, data.data.expires_in, uid);

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
