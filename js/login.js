/**
 * login.js - 登录页交互逻辑
 * 简洁版：render → getResponse → submit
 */

const SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';
let widgetId = null;

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('turnstile-widget-login');
    if (container && window.turnstile) {
        widgetId = window.turnstile.render(container, {
            sitekey: SITEKEY,
            theme: 'auto'
        });
    }

    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(loginForm);
        const username = (formData.get('username') || '').toString().trim();
        const password = (formData.get('password') || '').toString();

        if (!username || !password) {
            if (typeof Toast !== 'undefined') Toast.show('请输入用户名和密码');
            return;
        }

        const cfToken = widgetId ? (window.turnstile?.getResponse(widgetId) || '') : '';
        if (!cfToken && window.turnstile) {
            if (typeof Toast !== 'undefined') Toast.show('请完成人机验证');
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, cf_turnstile_token: cfToken })
            });
            const data = await response.json();

            if (response.ok && data?.code === 200) {
                AuthGuard.setToken(data.data.access_token, data.data.expires_in);
                if (typeof Toast !== 'undefined') Toast.show('登录成功', 'success');
                setTimeout(() => window.location.href = './user/dashboard.html', 500);
            } else {
                if (widgetId) window.turnstile?.reset(widgetId);
                if (typeof Toast !== 'undefined') Toast.show(data?.msg || '登录失败');
            }
        } catch {
            if (typeof Toast !== 'undefined') Toast.show('网络错误');
        }
    });
});
