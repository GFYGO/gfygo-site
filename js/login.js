/**
 * login.js - 登录页交互逻辑
 * 使用 onTurnstileReady 回调确保 SDK 加载完成后再渲染 widget
 */

const SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';
let widgetId = null;
let formEl = null;

// SDK 加载完成回调（由 login.html 的 script onload 参数触发）
window.onTurnstileReady = function() {
    renderWidget();
    bindForm();
};

// DOMContentLoaded 时若 SDK 已就绪则直接渲染，否则等 onload
document.addEventListener('DOMContentLoaded', () => {
    formEl = document.getElementById('loginForm');
    if (window.turnstile) {
        renderWidget();
        bindForm();
    }
});

function renderWidget() {
    const container = document.getElementById('turnstile-widget-login');
    if (!container) return;
    // 清空容器（防止缓存页面中残留旧 widget DOM）
    container.innerHTML = '';
    if (widgetId) {
        try { window.turnstile.remove(widgetId); } catch (_) {}
        widgetId = null;
    }
    widgetId = window.turnstile.render(container, {
        sitekey: SITEKEY,
        theme: 'auto'
    });
}

function bindForm() {
    if (!formEl) formEl = document.getElementById('loginForm');
    if (!formEl || formEl.dataset.bound === 'true') return;
    formEl.dataset.bound = 'true';

    formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(formEl);
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
}
