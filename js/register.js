/**
 * register.js - 注册页交互逻辑
 * 简洁版：render → getResponse → submit
 */

const SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';
const TABS = ['email', 'phone', 'temp'];
let currentTab = 'email';
const widgetIds = {};

// ====== Turnstile ======
function renderTurnstile(tabName) {
    const container = document.getElementById('turnstile-widget-' + tabName);
    if (!container || !window.turnstile) return;
    if (widgetIds[tabName]) {
        try { window.turnstile.remove(widgetIds[tabName]); } catch (_) {}
    }
    widgetIds[tabName] = window.turnstile.render(container, {
        sitekey: SITEKEY,
        theme: 'auto'
    });
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
    if (p.length < 8) { Toast.show('密码长度不能少于8位'); return false; }
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
        const resp = await fetch(`${API_BASE_URL}/api/v1/auth/${path}`, {
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
    const ef = document.getElementById('emailForm');
    const pf = document.getElementById('phoneForm');
    const tf = document.getElementById('tempForm');
    if (ef) ef.addEventListener('submit', handleEmail);
    if (pf) pf.addEventListener('submit', handlePhone);
    if (tf) tf.addEventListener('submit', handleTemp);
}

function checkCfOrReturn() {
    const cfToken = getCfToken();
    if (!cfToken && window.turnstile) {
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
        const resp = await fetch(`${API_BASE_URL}/api/v1/auth/temp-access`, {
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

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.register-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    bindForms();
    renderTurnstile('email');
});
