/**
 * register.js - 注册页交互逻辑（Turnstile 重写版 v2）
 *
 * 修复的 BUG：
 * 1. 🔴 getActiveTurnstileToken() 中 window.turnstile.getResponse(widget) → widget 变量未定义
 *    → 永远抛异常返回 null，导致所有注册永远卡在"请完成人机验证"
 * 2. 🔴 resetTurnstile() 中 window.turnstile.remove(container) → 传的是 DOM container，
 *    但 Turnstile API remove() 需要的是 render() 返回的 widgetId，导致 remove 抛错且
 *    切 tab 后重复渲染出现多个 widget 重叠
 * 3. 🔴 Site Key 与后端/登录页不统一（原来写死 0x4AAAAAABs6a1WlAXmVstmB，
 *    与 .env TURNSTILE_SITE_KEY 不一致，导致后端用的 secret key 不匹配注册页 token，
 *    验证永远返回 success=false）
 *
 * 改进：
 * - 维护 _regWidgets = { email: widgetId, phone: widgetId, temp: widgetId }
 *   每次 render 都存好 widgetId，getResponse / reset / remove 都用 widgetId
 * - 统一 Site Key = 0x4AAAAAAECyOCbL7qIJUOgg（和 .env + 登录页一致）
 * - SDK 加载超时 / 渲染失败时，容器内塞红色提示
 * - 切 tab 时 remove 旧 tab 的 widget 再 render 新 tab，避免多个 widget 重叠
 */

// ====== 统一配置（必须与 .env TURNSTILE_SITE_KEY 保持一致）======
const REG_TURNSTILE_SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';
const REG_SDK_TIMEOUT_MS = 30000;
const REGISTER_TABS = ['email', 'phone', 'temp'];

// ====== 全局状态 ======
let currentTab = 'email';
const _regWidgets = { email: null, phone: null, temp: null };  // 每个 tab 的 widgetId
let _regSdkReady = false;
const _regSdkStart = Date.now();
let _regTurnstileBroken = false;  // Turnstile 完全不可用（如 300010）


// =========================================
// Turnstile SDK 就绪等待
// =========================================
function _regWaitSdk() {
    return new Promise((resolve) => {
        const check = () => {
            if (typeof window.turnstile !== 'undefined') {
                _regSdkReady = true;
                resolve(true);
                return;
            }
            if (Date.now() - _regSdkStart > REG_SDK_TIMEOUT_MS) {
                console.warn('[Turnstile][Reg] SDK 加载超时；若后端 DEVELOPMENT=True 仍可注册');
                resolve(false);
                return;
            }
            setTimeout(check, 200);
        };
        check();
    });
}


// =========================================
// 渲染当前 tab 的 Turnstile
// =========================================
async function renderActiveTurnstile() {
    const tabName = currentTab;
    const widgetIdDom = 'turnstile-widget-' + tabName;
    const container = document.getElementById(widgetIdDom);
    if (!container) return;

    const sdkOk = await _regWaitSdk();
    if (!sdkOk || typeof window.turnstile === 'undefined') {
        container.innerHTML = `
            <div style="padding:12px;border:1px dashed #999;border-radius:8px;color:#666;font-size:13px;text-align:center;">
                ⚠️ 人机验证组件加载超时<br/>
                <small>如持续出现请刷新；若后端已开启开发模式，可忽略并直接提交</small>
            </div>`;
        return;
    }

    try {
        // 先清理同容器旧的 widget（避免重复 render）
        if (_regWidgets[tabName] !== null) {
            try { window.turnstile.remove(_regWidgets[tabName]); } catch (_) {}
            _regWidgets[tabName] = null;
        }
        _regWidgets[tabName] = window.turnstile.render(container, {
            sitekey: REG_TURNSTILE_SITEKEY,
            theme: 'auto',
            callback: (tok) => {
                console.debug(`[Turnstile][Reg][${tabName}] callback ok, len=${(tok || '').length}`);
                _regTurnstileBroken = false;
            },
            'error-callback': (err) => {
                console.error(`[Turnstile][Reg][${tabName}] error:`, err);
                _regTurnstileBroken = true;
                if (err === 300010) {
                    container.innerHTML = `
                        <div style="padding:12px;border:1px dashed #f80;border-radius:8px;color:#a00;font-size:13px;text-align:center;">
                            ⚠️ 人机验证暂不可用（域名未授权）<br/>
                            <small>已自动开启开发模式，可直接提交</small>
                        </div>`;
                } else if (typeof Toast !== 'undefined') {
                    Toast.show(`人机验证出错，请刷新重试`);
                }
            },
            'expired-callback': () => {
                console.warn(`[Turnstile][Reg][${tabName}] token 过期，请重新勾选`);
            }
        });
        console.debug(`[Turnstile][Reg][${tabName}] render 成功 widgetId=`, _regWidgets[tabName]);
    } catch (e) {
        console.error(`[Turnstile][Reg][${tabName}] render 异常:`, e);
        container.innerHTML = `
            <div style="padding:12px;border:1px dashed #f66;border-radius:8px;color:#a00;font-size:13px;text-align:center;">
                ❌ 验证组件渲染失败：${e.message || String(e)}
            </div>`;
    }
}


// =========================================
// 重置/销毁 当前 tab 的 Turnstile
// =========================================
function resetTurnstile() {
    const tabName = currentTab;
    const wid = _regWidgets[tabName];
    if (typeof window.turnstile === 'undefined' || wid === null) return;
    try {
        // reset：保留 widget，让用户重新勾选（表单校验失败/后端失败场景）
        window.turnstile.reset(wid);
        console.debug(`[Turnstile][Reg][${tabName}] reset widgetId=${wid}`);
    } catch (e) {
        console.warn(`[Turnstile][Reg][${tabName}] reset 异常:`, e);
    }
}

function _removeTurnstileForTab(tabName) {
    const wid = _regWidgets[tabName];
    if (typeof window.turnstile === 'undefined' || wid === null) return;
    try {
        window.turnstile.remove(wid);
        console.debug(`[Turnstile][Reg][${tabName}] removed widgetId=${wid}`);
    } catch (e) {
        /* ignore */
    } finally {
        _regWidgets[tabName] = null;
    }
}


// =========================================
// 获取当前激活 tab 的 Turnstile token
// =========================================
function getActiveTurnstileToken() {
    const tabName = currentTab;
    if (typeof window.turnstile === 'undefined') return null;
    const wid = _regWidgets[tabName];
    if (wid === null) return null;
    try {
        const tok = window.turnstile.getResponse(wid);
        return tok || null;
    } catch (e) {
        console.warn(`[Turnstile][Reg][${tabName}] getResponse 异常:`, e);
        return null;
    }
}


// =========================================
// Tab 切换
// =========================================
function switchTab(tabName) {
    if (!REGISTER_TABS.includes(tabName)) return;
    if (tabName === currentTab) return;

    // 切走前：remove 旧 tab widget（避免多个 widget 同时渲染）
    _removeTurnstileForTab(currentTab);

    currentTab = tabName;

    // UI 切换
    document.querySelectorAll('.register-tab').forEach(tab => {
        tab.classList.toggle('register-tab--active', tab.dataset.tab === tabName);
    });
    document.querySelectorAll('.register-form').forEach(form => {
        form.classList.remove('register-form--active');
    });
    const targetForm = document.getElementById(`${tabName}Form`);
    if (targetForm) targetForm.classList.add('register-form--active');

    // 渲染新 tab widget
    renderActiveTurnstile();
}


// =========================================
// 初始化
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    initTabSwitching();
    initForms();
    renderActiveTurnstile();
});

function initTabSwitching() {
    const tabsContainer = document.getElementById('registerTabs');
    if (!tabsContainer) return;
    tabsContainer.querySelectorAll('.register-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            if (target) switchTab(target);
        });
    });
}


// =========================================
// 表单校验工具
// =========================================
function validateUsername(username) {
    if (username.length < 3 || username.length > 20) {
        Toast.show('用户名长度需在3-20个字符之间');
        return false;
    }
    const re = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/;
    if (!re.test(username)) {
        Toast.show('用户名只能包含字母、数字、下划线和中文');
        return false;
    }
    return true;
}
function validatePasswordMatch(password, confirmPassword) {
    if (password !== confirmPassword) {
        Toast.show('两次输入的密码不一致');
        return false;
    }
    if (password.length < 8) {
        Toast.show('密码长度不能少于 8 位（后端要求）');
        return false;
    }
    return true;
}
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(email)) {
        Toast.show('请输入有效的邮箱地址');
        return false;
    }
    return true;
}
function validatePhone(phone) {
    const re = /^\+86[0-9]{11}$/;
    if (!re.test(phone)) {
        Toast.show('请输入有效的手机号（+86开头，共13位）');
        return false;
    }
    return true;
}


// =========================================
// 统一注册请求封装
// =========================================
async function _submitRegister(path, payload, successMsg, redirectTo) {
    try {
        const resp = await fetch(`${API_BASE_URL}/api/v1/auth/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (resp.ok && data && data.code === 200) {
            if (typeof Toast !== 'undefined') Toast.show(successMsg, 'success');
            setTimeout(() => { window.location.href = redirectTo; }, 1200);
            return true;
        } else {
            const msg = (data && data.msg) ? data.msg : '请求失败，请重试';
            if (typeof Toast !== 'undefined') Toast.show(msg);
            resetTurnstile(); // 失败重置，让用户重新勾选
            return false;
        }
    } catch (e) {
        console.error('[Reg] 请求异常:', e);
        if (typeof Toast !== 'undefined') Toast.show('网络错误，请稍后重试');
        resetTurnstile();
        return false;
    }
}


// =========================================
// 三个表单绑定
// =========================================
function initForms() {
    const ef = document.getElementById('emailForm');
    const pf = document.getElementById('phoneForm');
    const tf = document.getElementById('tempForm');
    if (ef) ef.addEventListener('submit', handleEmailRegister);
    if (pf) pf.addEventListener('submit', handlePhoneRegister);
    if (tf) tf.addEventListener('submit', handleTempAccess);
}

async function handleEmailRegister(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = (fd.get('email') || '').toString().trim();
    const username = (fd.get('username') || '').toString().trim();
    const password = (fd.get('password') || '').toString();
    const confirmPassword = (fd.get('confirm_password') || '').toString();
    const agree = fd.get('agree');
    const cfToken = getActiveTurnstileToken();

    if (!validateEmail(email)) return;
    if (!validateUsername(username)) return;
    if (!validatePasswordMatch(password, confirmPassword)) return;
    if (!agree) { Toast.show('请先阅读并同意服务条款和隐私政策'); return; }
    if (!cfToken && typeof window.turnstile !== 'undefined' && !_regTurnstileBroken) {
        Toast.show('请先完成人机验证（点击左侧勾选框）');
        return;
    }

    await _submitRegister('register/email', {
        email, username, password,
        cf_turnstile_token: cfToken || ''
    }, '注册成功，验证码已发送至邮箱，请登录后完成邮箱验证', './login.html');
}

async function handlePhoneRegister(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const phone = (fd.get('phone') || '').toString().trim();
    const username = (fd.get('username') || '').toString().trim();
    const password = (fd.get('password') || '').toString();
    const confirmPassword = (fd.get('confirm_password') || '').toString();
    const agree = fd.get('agree');
    const cfToken = getActiveTurnstileToken();

    if (!validatePhone(phone)) return;
    if (!validateUsername(username)) return;
    if (!validatePasswordMatch(password, confirmPassword)) return;
    if (!agree) { Toast.show('请先阅读并同意服务条款和隐私政策'); return; }
    if (!cfToken && typeof window.turnstile !== 'undefined' && !_regTurnstileBroken) {
        Toast.show('请先完成人机验证（点击左侧勾选框）');
        return;
    }

    await _submitRegister('register/phone', {
        phone, username, password,
        cf_turnstile_token: cfToken || ''
    }, '注册成功，正在跳转登录...', './login.html');
}

async function handleTempAccess(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = (fd.get('username') || '').toString().trim();
    const inviteCode = (fd.get('invite_code') || '').toString().trim();
    const cfToken = getActiveTurnstileToken();

    if (!validateUsername(username)) return;
    if (!inviteCode) { Toast.show('请输入邀请码'); return; }
    if (!cfToken && typeof window.turnstile !== 'undefined' && !_regTurnstileBroken) {
        Toast.show('请先完成人机验证（点击左侧勾选框）');
        return;
    }

    try {
        const resp = await fetch(`${API_BASE_URL}/api/v1/auth/temp-access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                invite_code: inviteCode,
                cf_turnstile_token: cfToken || ''
            })
        });
        const data = await resp.json();
        if (resp.ok && data && data.code === 200) {
            AuthGuard.setToken(data.data.access_token, data.data.expires_in);
            if (typeof Toast !== 'undefined') Toast.show('登录成功，正在进入系统...', 'success');
            setTimeout(() => { window.location.href = './user/dashboard.html'; }, 800);
        } else {
            const msg = (data && data.msg) ? data.msg : '临时访问失败，请重试';
            if (typeof Toast !== 'undefined') Toast.show(msg);
            resetTurnstile();
        }
    } catch (e) {
        console.error('[Reg][Temp] 请求异常:', e);
        if (typeof Toast !== 'undefined') Toast.show('网络错误，请稍后重试');
        resetTurnstile();
    }
}
