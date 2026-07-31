/**
 * register.js
 * 注册页逻辑：三选项卡切换 + 三种注册方式提交
 */

const REGISTER_TABS = ['email', 'phone', 'temp'];
let currentTab = 'email';

// 显式渲染当前激活标签页的 Turnstile 组件
function renderActiveTurnstile() {
    const widgetId = 'turnstile-widget-' + currentTab;
    const container = document.getElementById(widgetId);
    if (!container) return;
    if (typeof window.turnstile === 'undefined') {
        setTimeout(renderActiveTurnstile, 300);
        return;
    }
    try {
        window.turnstile.render(container, {
            sitekey: '0x4AAAAAABs6a1WlAXmVstmB'
        });
    } catch (e) {
        console.warn('[Turnstile] render error:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initTabSwitching();
    initForms();
    renderActiveTurnstile();
});

function initTabSwitching() {
    const tabsContainer = document.getElementById('registerTabs');
    if (!tabsContainer) return;

    const tabs = tabsContainer.querySelectorAll('.register-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            if (targetTab === currentTab) return;
            switchTab(targetTab);
        });
    });
}

function switchTab(tabName) {
    if (!REGISTER_TABS.includes(tabName)) return;
    currentTab = tabName;

    document.querySelectorAll('.register-tab').forEach(tab => {
        tab.classList.toggle('register-tab--active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.register-form').forEach(form => {
        form.classList.remove('register-form--active');
    });

    const targetForm = document.getElementById(`${tabName}Form`);
    if (targetForm) {
        targetForm.classList.add('register-form--active');
    }

    // 销毁旧 widget 并重新渲染当前标签页的 widget
    resetTurnstile();
    renderActiveTurnstile();
}

function resetTurnstile() {
    if (typeof window.turnstile !== 'undefined') {
        try {
            // 销毁当前标签页的 widget，准备重新渲染
            const widgetId = 'turnstile-widget-' + currentTab;
            const container = document.getElementById(widgetId);
            if (container) {
                window.turnstile.remove(container);
            }
        } catch (e) { /* ignore */ }
    }
}

function getActiveTurnstileToken() {
    if (typeof window.turnstile === 'undefined') return null;
    const widgetId = 'turnstile-widget-' + currentTab;
    const container = document.getElementById(widgetId);
    if (!container) return null;
    try {
<<<<<<< HEAD
        return window.turnstile.getResponse(container);
=======
        return window.turnstile.getResponse(widget);
>>>>>>> parent of ec905ed (1)
    } catch (e) {
        return null;
    }
}

function initForms() {
    const emailForm = document.getElementById('emailForm');
    const phoneForm = document.getElementById('phoneForm');
    const tempForm = document.getElementById('tempForm');

    if (emailForm) {
        emailForm.addEventListener('submit', handleEmailRegister);
    }
    if (phoneForm) {
        phoneForm.addEventListener('submit', handlePhoneRegister);
    }
    if (tempForm) {
        tempForm.addEventListener('submit', handleTempAccess);
    }
}

function validatePasswordMatch(password, confirmPassword) {
    if (password !== confirmPassword) {
        Toast.show('两次输入的密码不一致');
        return false;
    }
    if (password.length < 6) {
        Toast.show('密码长度不能少于6位');
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
    // +86 开头，后接 11 位数字
    const re = /^\+86[0-9]{11}$/;
    if (!re.test(phone)) {
        Toast.show('请输入有效的手机号（+86开头）');
        return false;
    }
    return true;
}

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

async function handleEmailRegister(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);
    const email = formData.get('email').trim();
    const username = formData.get('username').trim();
    const password = formData.get('password');
    const confirmPassword = formData.get('confirm_password');
    const agree = formData.get('agree');
    const cfToken = getActiveTurnstileToken();

    if (!validateEmail(email)) return;
    if (!validateUsername(username)) return;
    if (!validatePasswordMatch(password, confirmPassword)) return;
    if (!agree) {
        Toast.show('请先阅读并同意服务条款和隐私政策');
        return;
    }
    if (!cfToken) {
        Toast.show('请完成人机验证');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/register/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                username,
                password,
                cf_turnstile_token: cfToken
            })
        });

        const data = await response.json();

        if (response.ok && data.code === 200) {
            Toast.show('注册成功，正在跳转登录...', 'success');
            setTimeout(() => {
                window.location.href = './login.html';
            }, 1500);
        } else {
            Toast.show(data.msg || '注册失败，请重试');
            resetTurnstile();
        }
    } catch (error) {
        console.error('邮箱注册请求异常:', error);
        Toast.show('网络错误，请稍后重试');
    }
}

async function handlePhoneRegister(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);
    const phone = formData.get('phone').trim();
    const username = formData.get('username').trim();
    const password = formData.get('password');
    const confirmPassword = formData.get('confirm_password');
    const agree = formData.get('agree');
    const cfToken = getActiveTurnstileToken();

    if (!validatePhone(phone)) return;
    if (!validateUsername(username)) return;
    if (!validatePasswordMatch(password, confirmPassword)) return;
    if (!agree) {
        Toast.show('请先阅读并同意服务条款和隐私政策');
        return;
    }
    if (!cfToken) {
        Toast.show('请完成人机验证');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/register/phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone,
                username,
                password,
                cf_turnstile_token: cfToken
            })
        });

        const data = await response.json();

        if (response.ok && data.code === 200) {
            Toast.show('注册成功，正在跳转登录...', 'success');
            setTimeout(() => {
                window.location.href = './login.html';
            }, 1500);
        } else {
            Toast.show(data.msg || '注册失败，请重试');
            resetTurnstile();
        }
    } catch (error) {
        console.error('手机号注册请求异常:', error);
        Toast.show('网络错误，请稍后重试');
    }
}

async function handleTempAccess(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);
    const username = formData.get('username').trim();
    const inviteCode = formData.get('invite_code').trim();
    const cfToken = getActiveTurnstileToken();

    if (!validateUsername(username)) return;
    if (!inviteCode) {
        Toast.show('请输入邀请码');
        return;
    }
    if (!cfToken) {
        Toast.show('请完成人机验证');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/temp-access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                invite_code: inviteCode,
                cf_turnstile_token: cfToken
            })
        });

        const data = await response.json();

        if (response.ok && data.code === 200) {
            AuthGuard.setToken(data.data.access_token, data.data.expires_in);
            Toast.show('登录成功，正在进入系统...', 'success');
            setTimeout(() => {
                window.location.href = './user/dashboard.html';
            }, 800);
        } else {
            Toast.show(data.msg || '临时访问失败，请重试');
            resetTurnstile();
        }
    } catch (error) {
        console.error('临时访问请求异常:', error);
        Toast.show('网络错误，请稍后重试');
    }
}
