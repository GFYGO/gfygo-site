/**
 * forgot.js - 「忘记密码」页交互逻辑
 *
 * 接口：`POST /api/v1/auth/forgot-password`（**公共**，无需 JWT，见 site-back/routes/auth_v1.py）
 *   body `{email, cf_turnstile_token}` → Turnstile **必需**（重置邮件是外发动作）
 *   200 的 `msg` 是**防账号枚举**的统一话术（邮箱没注册也是同一句）→ 原样展示给用户。
 *   400 邮箱格式错 / 人机验证失败；429 触发限流；500 邮件发送失败（唯一会区分账号存在与否的分支）。
 *
 * ⚠️ 与 login.js / register.js 同一条原则：**表单绑定与 Turnstile 是否可用解耦**。
 *    绑定写在 DOM 就绪里无条件执行，SDK 挂掉只会导致「取不到 token」时给出明确提示，
 *    而不是「点了按钮没反应」。
 *
 * Turnstile 的挂载 / 错误码提示 / token 过期自动重发都在 js/turnstile-widget.js。
 */

//: 站点密钥（与 site-back/.env 的 TURNSTILE_SITE_KEY、Cloudflare 后台的 widget 必须一致）
const FORGOT_SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';

//: 由 js/turnstile-widget.js 的 mount() 返回，负责取 token / 重置
let forgotWidget = null;
let forgotBound = false;

/** DOM 就绪回调（脚本在 body 末尾，通常 readyState 已经是 interactive） */
function onForgotDomReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

onForgotDomReady(function () {
    mountForgotWidget();
    bindForgotForm();     // ← 无条件绑定，不看 Turnstile 的脸色
});

/** 挂载人机验证组件（容器不在时静默跳过：极端情况下页面照常可用） */
function mountForgotWidget() {
    const container = document.getElementById('turnstile-widget-forgot');
    if (!container) return;
    if (typeof TurnstileWidget === 'undefined') {
        Toast.show('人机验证脚本未加载，请刷新页面重试');
        return;
    }
    forgotWidget = TurnstileWidget.mount(container, { sitekey: FORGOT_SITEKEY });
}

/**
 * 取一个可提交的 token；取不到时返回 null **并已经说明原因**
 * （区分「组件没挂上」「还没完成验证」「挑战报错」）。
 */
function requireForgotToken() {
    if (!forgotWidget) {
        Toast.show('人机验证未初始化，请刷新页面重试');
        return null;
    }
    const token = forgotWidget.getToken();
    if (!token) {
        Toast.show(forgotWidget.state() === 'failed'
            ? '人机验证加载失败，请点组件下方的「重新验证」'
            : '请先完成人机验证');
        return null;
    }
    return token;
}

/** 邮箱格式与 register.js 用同一条规则（服务端 utils/validators.py 更严，最终以服务端为准） */
function validForgotEmail(value) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        Toast.show('请输入有效的邮箱地址');
        return false;
    }
    return true;
}

/** 按钮忙碌态（本页不加载 js/utils.js，故自带一份最小实现） */
function setForgotBusy(btn, busy, text) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (text) btn.textContent = text;
}

/** 切换到「已发送」面板（文案用 textContent 写入：后端的 msg 绝不进 innerHTML） */
function showForgotDone(msg) {
    const formStep = document.getElementById('forgotStepForm');
    const doneStep = document.getElementById('forgotStepDone');
    const msgEl = document.getElementById('forgotDoneMsg');
    if (msgEl) {
        msgEl.textContent = msg || '如果该邮箱对应一个已注册账号，我们已发送重置邮件，请查收';
    }
    if (formStep) formStep.classList.remove('auth-step--active');
    if (doneStep) doneStep.classList.add('auth-step--active');
    // 表单已隐藏：把挑战销毁掉，避免后台留一个没人看的 iframe
    if (forgotWidget && typeof forgotWidget.destroy === 'function') forgotWidget.destroy();
}

function bindForgotForm() {
    const formEl = document.getElementById('forgotForm');
    if (!formEl || forgotBound) return;
    forgotBound = true;

    formEl.addEventListener('submit', async (e) => {
        e.preventDefault();

        const emailInput = document.getElementById('forgotEmail');
        const email = (emailInput && emailInput.value ? emailInput.value : '').trim();
        if (!email) {
            Toast.show('请输入注册邮箱');
            return;
        }
        if (!validForgotEmail(email)) return;

        const cfToken = requireForgotToken();
        if (cfToken === null) return;

        const submitBtn = document.getElementById('forgotSubmitBtn');
        setForgotBusy(submitBtn, true, '发送中...');

        try {
            // silent：错误提示由本页按 HTTP 语义统一给，避免 apiRequest 再叠一层 Toast。
            // noAuth：v1 是公共接口，本来就不认 JWT（带上也无害，这里明确不带）。
            const resp = await window.apiRequest('/api/v1/auth/forgot-password', {
                method: 'POST',
                body: { email: email, cf_turnstile_token: cfToken },
                noAuth: true,
                silent: true,
            });

            if (resp && resp.code === 200) {
                showForgotDone(resp.msg);
                return;
            }

            // 400 / 429 / 500：一律以后端 msg 为准（它已经把原因写成人话）
            if (resp && resp.msg) Toast.show(resp.msg);
            else if (resp === null) Toast.show('网络连接失败，请检查网络后重试');
            else Toast.show('发送失败，请稍后重试');

            // Turnstile token 是一次性的：失败后必须换一张新的再提交
            if (forgotWidget) forgotWidget.reset();
        } finally {
            setForgotBusy(submitBtn, false, '发送重置邮件');
        }
    });
}
