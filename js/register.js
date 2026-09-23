/**
 * register.js - 注册页交互逻辑
 *
 * ⚠️ 与 login.js 同样的核心修复：**表单/Tab 绑定与 Turnstile 是否可用解耦**。
 *    以前 initRegisterPage()（里面才绑定 Tab 与表单）只在 window.onTurnstileReady
 *    里被调用 —— SDK 一旦加载失败，三个注册表单全都没有 submit 监听，
 *    点「注册」只会触发浏览器原生提交，页面闪一下、没有任何提示。
 *
 * 另外两个只在注册页出现的问题：
 *   1. 以前 turnstileFailed 是一个全局布尔量，三个 Tab 共用：在「邮件注册」失败
 *      会把「手机号注册 / 临时访问」也一起判成失败，而且置位后再也不会复原。
 *      现在每个 Tab 有各自的 controller（见 js/turnstile-widget.js）。
 *   2. 以前在 SDK 加载完成**之前**切换 Tab，那次切换的 renderTurnstile 会因为
 *      window.turnstile 还不存在而直接 return；等 SDK 就绪后 onTurnstileReady 只
 *      渲染了 email，用户当前所在的 Tab 就永远没有组件，提交时被拦在
 *      「人机验证未加载」。现在 Tab 切到哪就挂哪个，且 SDK 就绪时会补挂当前 Tab。
 */

//: 站点密钥（与 site-back/.env 的 TURNSTILE_SITEKEY、Cloudflare 后台的 widget 必须一致）
const REGISTER_SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';

const TABS = ['email', 'phone', 'temp'];
let currentTab = 'email';
//: tabName → controller（js/turnstile-widget.js 的 mount 返回值）
const tabWidgets = {};
let registerInitialized = false;

function onRegisterDomReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

onRegisterDomReady(initRegisterPage);

function initRegisterPage() {
    if (registerInitialized) return;
    registerInitialized = true;

    // 先绑交互，再管 Turnstile —— 顺序很重要：SDK 挂掉时这三个表单依然要能校验、能提示
    document.querySelectorAll('.register-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    bindForms();
    mountTabWidget(currentTab);
}

// ====== Turnstile（每个 Tab 一个，互不影响） ======
/**
 * 挂载指定 Tab 的人机验证组件。
 * - 容器不可见时不挂（Turnstile 在 display:none 的容器里无法完成挑战，会一直转圈）
 * - 已经挂过的不重复挂（重复 render 会把正在进行的挑战拆掉重建）
 */
function mountTabWidget(tabName) {
    const container = document.getElementById('turnstile-widget-' + tabName);
    if (!container) return null;
    if (typeof TurnstileWidget === 'undefined') {
        Toast.show('人机验证脚本未加载，请刷新页面重试');
        return null;
    }
    if (!tabWidgets[tabName]) {
        tabWidgets[tabName] = TurnstileWidget.mount(container, { sitekey: REGISTER_SITEKEY });
    }
    return tabWidgets[tabName];
}

function currentWidget() {
    return tabWidgets[currentTab] || null;
}

function resetCf() {
    const widget = currentWidget();
    if (widget) widget.reset();
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

    // 该 Tab 之前已经挂过、但还没有 token —— 说明它是在挑战中途被切走
    // （容器 display:none 期间挑战可能停滞），现在可见了让它重新发起一次。
    // 本次刚挂上的新组件不需要这个动作：它本来就刚开始挑战。
    const existed = !!tabWidgets[tab];
    const widget = mountTabWidget(tab);
    if (existed && widget && !widget.getToken()) widget.reset();
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
            // token 是一次性的：失败后必须换一张新的再提交
            resetCf();
        }
    } catch {
        if (typeof Toast !== 'undefined') Toast.show('网络错误');
        resetCf();
    }
}

// ====== 表单绑定（无条件执行，与 SDK 无关） ======
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
 * 区分「组件没挂上 / 加载失败」「用户还没完成验证」，不再一律说「请完成人机验证」。
 */
function checkCfOrReturn() {
    const widget = currentWidget();
    if (!widget) {
        Toast.show('人机验证未初始化，请刷新页面重试');
        return null;
    }
    const cfToken = widget.getToken();
    if (!cfToken) {
        Toast.show(widget.state() === 'failed'
            ? '人机验证加载失败，请点组件下方的「重新验证」'
            : '请先完成人机验证');
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
        { email, username, password, cf_turnstile_token: cf },
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
        { phone, username, password, cf_turnstile_token: cf },
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
            body: JSON.stringify({ username, invite_code: inviteCode, cf_turnstile_token: cf })
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
        resetCf();
    }
}
