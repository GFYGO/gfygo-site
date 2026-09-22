/**
 * register.js - 注册页交互逻辑
 * 使用 onTurnstileReady 回调确保 SDK 加载完成后再渲染 widget
 */

const SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';
const TABS = ['email', 'phone', 'temp'];
let currentTab = 'email';
const widgetIds = {};

// SDK 加载完成回调（由动态注入的 Turnstile SDK 通过 onload 参数触发）
window.onTurnstileReady = function() {
    initRegisterPage();
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

// DOMContentLoaded 时若 SDK 已就绪则直接初始化
document.addEventListener('DOMContentLoaded', () => {
    if (window.turnstile) {
        initRegisterPage();
    }
});

function initRegisterPage() {
    document.querySelectorAll('.register-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    bindForms();
    renderTurnstile('email');
}

// ====== Turnstile ======
function renderTurnstile(tabName) {
    const container = document.getElementById('turnstile-widget-' + tabName);
    // 容器不存在 / SDK 未就绪 → 保持 turnstileFailed=true，提交时会被拦下
    if (!container || !window.turnstile) { turnstileFailed = true; return; }
    container.innerHTML = '';
    if (widgetIds[tabName]) {
        try { window.turnstile.remove(widgetIds[tabName]); } catch (_) {}
    }
    try {
        widgetIds[tabName] = window.turnstile.render(container, {
            sitekey: SITEKEY,
            theme: 'auto'
        });
    } catch (e) {
        // SDK 在但渲染抛错（如挑战初始化失败）→ 同样视为不可用
        widgetIds[tabName] = null;
        turnstileFailed = true;
        return;
    }
    // render 返回 falsy 说明 widget 没真正建起来
    turnstileFailed = !widgetIds[tabName];
}

function getCfToken() {
    const wid = widgetIds[currentTab];
    if (!wid || !window.turnstile) return '';
    return window.turnstile.getResponse(wid) || '';
}

function resetCf() {
    const wid = widgetIds[currentTab];
    if (wid && window.turnstile) window.turnstile.reset(wid);
}

// ====== 表单校验 ======
function validUsername(v) {
    if (v.length < 3 || v.length > 20) { Toast.show('用户名长度3-20个字符'); return false; }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(v)) { Toast.show('用户名只能包含字母、数字、下划线和中文'); return false; }
    return true;
}
function validPassword(p, cp) {
    if (p !== cp) { Toast.show('两次输入的密码不一致'); return false; }
    if (p.length < 6) { Toast.show('密码长度不能少于6位'); return false; }
    return true;
}
function validEmail(v) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { Toast.show('请输入有效的邮箱地址'); return false; }
    return true;
}
function validPhone(v) {
    if (!/^\+86[0-9]{11}$/.test(v)) { Toast.show('请输入有效的手机号（+86开头）'); return false; }
    return true;
}

// ====== Tab 切换 ======
function switchTab(tab) {
    if (!TABS.includes(tab) || tab === currentTab) return;
    currentTab = tab;
    document.querySelectorAll('.register-tab').forEach(t =>
        t.classList.toggle('register-tab--active', t.dataset.tab === tab));
    document.querySelectorAll('.register-form').forEach(f =>
        f.classList.toggle('register-form--active', f.id === tab + 'Form'));
    renderTurnstile(tab);
}

// ====== 提交 ======
async function submitRegister(path, payload, successMsg, redirectUrl) {
    try {
        const resp = await fetch(`${API_BASE_URL}/api/v0/auth/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (resp.ok && data?.code === 200) {
            if (typeof Toast !== 'undefined') Toast.show(successMsg, 'success');
            setTimeout(() => window.location.href = redirectUrl, 1200);
        } else {
            if (typeof Toast !== 'undefined') Toast.show(data?.msg || '请求失败');
            resetCf();
        }
    } catch {
        if (typeof Toast !== 'undefined') Toast.show('网络错误');
        resetCf();
    }
}

// ====== 表单绑定 ======
function bindForms() {
    const forms = [
        ['emailForm', handleEmail],
        ['phoneForm', handlePhone],
        ['tempForm', handleTemp]
    ];
    for (const [id, fn] of forms) {
        const el = document.getElementById(id);
        if (el && el.dataset.bound !== 'true') {
            el.dataset.bound = 'true';
            el.addEventListener('submit', fn);
        }
    }
}

/**
 * 前置检查：返回可提交的 cf token，或 null（并已经给出提示）。
 * 覆盖三种"人机验证不可用"的情形，避免把空 token 发给后端后
 * 只收到一句含糊的失败提示：
 *   1. SDK / widget 没加载成功（扩展拦截、网络不通、挑战失败 300* 等）
 *   2. 用户还没完成验证
 */
function checkCfOrReturn() {
    if (turnstileFailed || !window.turnstile || !widgetIds[currentTab]) {
        Toast.show('人机验证未加载：请关闭广告拦截类扩展后刷新页面重试');
        return null;
    }
    const cfToken = getCfToken();
    if (!cfToken) {
        Toast.show('请完成人机验证');
        return null;
    }
    return cfToken;
}

async function handleEmail(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = (fd.get('email') || '').toString().trim();
    const username = (fd.get('username') || '').toString().trim();
    const password = (fd.get('password') || '').toString();
    const cp = (fd.get('confirm_password') || '').toString();
    if (!validEmail(email)) return;
    if (!validUsername(username)) return;
    if (!validPassword(password, cp)) return;
    if (!fd.get('agree')) { Toast.show('请同意服务条款'); return; }
    const cf = checkCfOrReturn();
    if (cf === null) return;
    await submitRegister('register/email',
        { email, username, password, cf_turnstile_token: cf || '' },
        '注册成功，请登录', './login.html');
}

async function handlePhone(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const phone = (fd.get('phone') || '').toString().trim();
    const username = (fd.get('username') || '').toString().trim();
    const password = (fd.get('password') || '').toString();
    const cp = (fd.get('confirm_password') || '').toString();
    if (!validPhone(phone)) return;
    if (!validUsername(username)) return;
    if (!validPassword(password, cp)) return;
    if (!fd.get('agree')) { Toast.show('请同意服务条款'); return; }
    const cf = checkCfOrReturn();
    if (cf === null) return;
    await submitRegister('register/phone',
        { phone, username, password, cf_turnstile_token: cf || '' },
        '注册成功，请登录', './login.html');
}

async function handleTemp(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = (fd.get('username') || '').toString().trim();
    const inviteCode = (fd.get('invite_code') || '').toString().trim();
    if (!validUsername(username)) return;
    if (!inviteCode) { Toast.show('请输入邀请码'); return; }
    const cf = checkCfOrReturn();
    if (cf === null) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/api/v0/auth/temp-access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, invite_code: inviteCode, cf_turnstile_token: cf || '' })
        });
        const data = await resp.json();
        if (resp.ok && data?.code === 200) {
            AuthGuard.setToken(data.data.access_token, data.data.expires_in);
            if (typeof Toast !== 'undefined') Toast.show('登录成功', 'success');
            setTimeout(() => window.location.href = './user/dashboard.html', 500);
        } else {
            if (typeof Toast !== 'undefined') Toast.show(data?.msg || '临时访问失败');
            resetCf();
        }
    } catch {
        if (typeof Toast !== 'undefined') Toast.show('网络错误');
    }
}
