/**
 * reset.js - 「重置密码」页交互逻辑
 *
 * 三条接口，全部是 `/api/v1/auth/*`（**公共，无需 JWT**，见 site-back/routes/auth_v1.py）：
 *   GET  /api/v1/auth/reset-token      ?token=...  → {valid, reason?, email?(打码), expires_at?}
 *                                     ⚠️ 永远 HTTP 200：用 `valid` 字段而不是状态码判断
 *   POST /api/v1/auth/verify-reset-code {email, code} → {reset_token, expires_at, username}
 *   POST /api/v1/auth/reset-password    {token, new_password} → {username}
 *
 * 两种进入方式：
 *   1. `/reset.html?token=<64 hex>`（邮件里的链接）→ 先校验 token，再显示改密表单；
 *   2. `/reset.html`（无 token）→ 显示「邮箱 + 6 位验证码」，换取 token 后**在本页原地**
 *      显示同一个改密表单（不跳转、不刷新、也不把 token 放进 URL）。
 *
 * ⚠️ token 只存在 JS 变量里（`resetToken`）。本页**不写** localStorage / sessionStorage：
 *    这是一台可能不属于用户的电脑，重置凭据不该留在磁盘上。
 */

//: 当前持有的重置凭据（内存变量；为空表示还没拿到 / 已用掉）
let resetToken = '';
//: DOM 事件是否已绑定（防重复绑定）
let resetBound = false;

/** DOM 就绪回调（脚本在 body 末尾，通常 readyState 已经是 interactive） */
function onResetDomReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

onResetDomReady(function () {
    bindResetForms();
    const token = readResetTokenFromUrl();
    if (token) {
        showResetStep('loading');
        loadResetTokenState(token);
    } else {
        showResetStep('code');
    }
});

/** 从 URL 取 `?token=`（只读，不改写地址栏） */
function readResetTokenFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        return (params.get('token') || '').trim();
    } catch (e) {
        console.warn('[reset] 解析 URL 失败:', e);
        return '';
    }
}

/**
 * 一次只显示一个步骤面板。
 * 用类切换而不是 [hidden] 属性：`hidden` 会被任何 `display:block` 的 CSS 规则覆盖，
 * 步骤面板一旦有样式就会「全部同时显示」。
 */
function showResetStep(name) {
    const map = {
        loading: 'resetStepLoading',
        code: 'resetStepCode',
        password: 'resetStepPassword',
        invalid: 'resetStepInvalid',
        done: 'resetStepDone',
    };
    Object.keys(map).forEach(function (key) {
        const el = document.getElementById(map[key]);
        if (!el) return;
        el.classList.toggle('auth-step--active', key === name);
    });
}

/** 按钮忙碌态（本页不加载 js/utils.js，故自带一份最小实现） */
function setResetBusy(btn, busy, text) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (text) btn.textContent = text;
}

/** 提示条 / 文案统一走 textContent：后端的 msg 与打码邮箱都不进 innerHTML */
function setResetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? '' : String(value);
}

function validResetEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** 进入「设置新密码」表单；target 是展示用的账号标识（打码邮箱或用户填的邮箱） */
function enterResetPasswordStep(target) {
    setResetText('resetTargetHint', target || '该账号');
    showResetStep('password');
}

/** 凭据不可用：显示 API 给的 reason（原样）+ 重新申请的入口，**不显示改密表单** */
function showResetInvalid(reason) {
    resetToken = '';
    setResetText('resetInvalidReason', reason || '重置链接无效或已被使用');
    showResetStep('invalid');
}

function showResetDone(msg) {
    setResetText('resetDoneMsg', msg || '密码已重置，请使用新密码登录');
    showResetStep('done');
}

/**
 * 校验 URL 里的 token（`GET /api/v1/auth/reset-token`）。
 * 该接口**始终 200**，成功与否看 `data.valid`。
 */
async function loadResetTokenState(token) {
    const resp = await window.apiRequest('/api/v1/auth/reset-token', {
        params: { token: token },
        noAuth: true,
        silent: true,
    });

    // resp === null 是网络层失败（apiRequest 在 fetch 抛错时返回 null）；
    // 响应形状异常与网络失败都归到「不可用」：宁可让用户重新申请一封邮件，
    // 也不要在**不确定凭据是否有效**时让他填密码。
    if (!resp) {
        showResetInvalid('无法连接服务器校验重置链接，请检查网络后重试');
        return;
    }
    const info = resp.data ? resp.data : null;
    if (!info) {
        showResetInvalid(resp.msg || '重置链接校验失败，请稍后重试');
        return;
    }
    if (!info.valid) {
        showResetInvalid(info.reason);
        return;
    }

    resetToken = token;
    // ⚠️ `email` 由服务端**打码**（如 a***e@x.com）：无鉴权接口不能变成账号查询器，
    //    前端原样展示，绝不尝试还原。
    enterResetPasswordStep(info.email);
}

/** 用邮件里的 6 位验证码换取重置 token（token 留在内存里，不进 URL） */
async function handleResetCodeSubmit(e) {
    e.preventDefault();

    const emailEl = document.getElementById('resetEmail');
    const codeEl = document.getElementById('resetCode');
    const email = (emailEl && emailEl.value ? emailEl.value : '').trim();
    const code = (codeEl && codeEl.value ? codeEl.value : '').trim();

    if (!email) {
        Toast.show('请输入注册邮箱');
        return;
    }
    if (!validResetEmail(email)) {
        Toast.show('请输入有效的邮箱地址');
        return;
    }
    if (!/^\d{6}$/.test(code)) {
        Toast.show('请输入 6 位数字验证码');
        return;
    }

    const btn = document.getElementById('resetCodeSubmitBtn');
    setResetBusy(btn, true, '验证中...');
    try {
        const resp = await window.apiRequest('/api/v1/auth/verify-reset-code', {
            method: 'POST',
            body: { email: email, code: code },
            noAuth: true,
            silent: true,
        });

        if (resp && resp.code === 200 && resp.data && resp.data.reset_token) {
            resetToken = resp.data.reset_token;
            if (typeof Toast !== 'undefined') Toast.show(resp.msg || '验证成功，请设置新密码', 'success');
            // 展示用户自己填的邮箱（这条路径服务端不回邮箱，只回 username）
            enterResetPasswordStep(email);
            return;
        }

        // 400「验证码无效或已过期」/ 429 限流 / 500：一律用后端 msg
        Toast.show((resp && resp.msg) || '验证失败，请稍后重试');
    } finally {
        setResetBusy(btn, false, '验证并继续');
    }
}

/** 用重置凭据落新密码 */
async function handleResetPasswordSubmit(e) {
    e.preventDefault();

    const pwdEl = document.getElementById('resetNewPassword');
    const confirmEl = document.getElementById('resetConfirmPassword');
    const pwd = pwdEl && pwdEl.value ? pwdEl.value : '';
    const confirm = confirmEl && confirmEl.value ? confirmEl.value : '';

    // 客户端前置校验：服务端最小长度也是 6（utils/validators.validate_password）
    if (pwd.length < 6) {
        Toast.show('密码长度不能少于 6 位');
        return;
    }
    if (pwd !== confirm) {
        Toast.show('两次输入的密码不一致');
        return;
    }
    if (!resetToken) {
        showResetInvalid('重置凭据已丢失，请重新获取重置邮件');
        return;
    }

    const btn = document.getElementById('resetPasswordSubmitBtn');
    setResetBusy(btn, true, '提交中...');
    try {
        const resp = await window.apiRequest('/api/v1/auth/reset-password', {
            method: 'POST',
            body: { token: resetToken, new_password: pwd },
            noAuth: true,
            silent: true,
        });

        if (resp && resp.code === 200) {
            resetToken = '';
            if (pwdEl) pwdEl.value = '';
            if (confirmEl) confirmEl.value = '';
            showResetDone(resp.msg);
            return;
        }

        Toast.show((resp && resp.msg) || '重置失败，请稍后重试');

        // ⚠️ 失败原因不去猜 msg 文案（弱密码 / 凭据失效都会 400）。
        //    再问一次 /reset-token：只有服务端说「凭据不能用了」才切到失效面板，
        //    否则用户只是密码太短，应该留在表单里改。
        const check = await window.apiRequest('/api/v1/auth/reset-token', {
            params: { token: resetToken },
            noAuth: true,
            silent: true,
        });
        if (check && check.data && check.data.valid === false) {
            showResetInvalid(check.data.reason);
        }
    } finally {
        setResetBusy(btn, false, '重置密码');
    }
}

/** 绑定两个表单（无条件执行，与任何第三方 SDK 无关） */
function bindResetForms() {
    if (resetBound) return;
    resetBound = true;

    const codeForm = document.getElementById('resetCodeForm');
    if (codeForm) codeForm.addEventListener('submit', handleResetCodeSubmit);

    const pwdForm = document.getElementById('resetPasswordForm');
    if (pwdForm) pwdForm.addEventListener('submit', handleResetPasswordSubmit);

    // 验证码框只允许数字（粘贴带空格时也顺手清掉）
    const codeEl = document.getElementById('resetCode');
    if (codeEl) {
        codeEl.addEventListener('input', function () {
            codeEl.value = String(codeEl.value || '').replace(/\D/g, '').slice(0, 6);
        });
    }
}
