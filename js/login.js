/**
 * login.js - 登录页交互逻辑
 * 使用 onTurnstileReady 回调确保 SDK 加载完成后再渲染 widget
 */

const SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';
let widgetId = null;
let formEl = null;

// SDK 加载完成回调（由动态注入的 Turnstile SDK 通过 onload 参数触发）
window.onTurnstileReady = function() {
    renderWidget();
    bindForm();
};

// 回调定义完成后再动态注入 Turnstile SDK，避免 SDK 先加载完成导致回调丢失
let turnstileSdkInjected = false;
// SDK / widget 加载失败的标记（扩展拦截、网络不通、挑战失败等）
let turnstileFailed = false;

function loadTurnstileSdk() {
    // 防止重复注入（同一页面已存在 SDK 脚本时直接跳过）
    if (turnstileSdkInjected) return;
    if (document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) return;
    turnstileSdkInjected = true;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady&render=explicit';
    s.async = true;
    s.defer = true;
    // 脚本加载失败（被扩展/网络拦截）→ 标记，提交时给出明确提示而不是发空 token
    s.onerror = () => { turnstileFailed = true; };
    document.head.appendChild(s);
    // 兜底：SDK 迟迟不触发 onTurnstileReady（既没成功也没触发 onerror）也算失败
    setTimeout(() => {
        if (!window.turnstile) turnstileFailed = true;
    }, 10000);
}
loadTurnstileSdk();

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
    // 容器不存在 / SDK 未就绪 → 保持 turnstileFailed=true，提交时会被拦下
    if (!container || !window.turnstile) { turnstileFailed = true; return; }
    // 清空容器（防止缓存页面中残留旧 widget DOM）
    container.innerHTML = '';
    if (widgetId) {
        try { window.turnstile.remove(widgetId); } catch (_) {}
        widgetId = null;
    }
    try {
        widgetId = window.turnstile.render(container, {
            sitekey: SITEKEY,
            theme: 'auto'
        });
    } catch (e) {
        // SDK 在但渲染抛错（如挑战初始化失败）→ 同样视为不可用
        widgetId = null;
        turnstileFailed = true;
        return;
    }
    // render 返回 falsy 说明 widget 没真正建起来
    turnstileFailed = !widgetId;
}

/**
 * 前置检查：返回可提交的 cf token，或 null（并已经给出提示）。
 * 覆盖三种"人机验证不可用"的情形，避免把空 token 发给后端后
 * 只收到一句含糊的「登录失败」：
 *   1. SDK / widget 没加载成功（扩展拦截、网络不通、挑战失败 300* 等）
 *   2. 用户还没完成验证
 */
function requireCfToken() {
    if (turnstileFailed || !window.turnstile || !widgetId) {
        if (typeof Toast !== 'undefined') {
            Toast.show('人机验证未加载：请关闭广告拦截类扩展后刷新页面重试');
        }
        return null;
    }
    const token = window.turnstile.getResponse(widgetId) || '';
    if (!token) {
        if (typeof Toast !== 'undefined') Toast.show('请完成人机验证');
        return null;
    }
    return token;
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

        const cfToken = requireCfToken();
        if (cfToken === null) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/v0/auth/login`, {
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
