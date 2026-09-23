/**
 * login.js - 登录页交互逻辑
 *
 * ⚠️ 本次修复的核心：**表单绑定与 Turnstile 是否可用必须解耦**。
 *    以前 bindForm() 只在 window.onTurnstileReady（= SDK 加载成功的回调）里被调用，
 *    于是只要 SDK 没加载成功（被广告拦截扩展拦下、网络不通、被墙、CSP 变动……），
 *    #loginForm 上就**根本没有 submit 监听**：点「登录」会退化成浏览器原生表单提交
 *    （GET 当前页 + 把用户名密码拼在 URL 上），表现就是「点了没反应 / 页面闪一下」，
 *    而且一句提示都没有 —— 比看到「人机验证失败」更难排查。
 *    现在：DOM 一就绪就绑定表单；Turnstile 只负责产出 token，挂不挂得上都不影响提交逻辑。
 *
 * Turnstile 的挂载、错误码提示、过期自动重发等逻辑都在 js/turnstile-widget.js。
 */

//: 站点密钥（与 site-back/.env 的 TURNSTILE_SITE_KEY、Cloudflare 后台的 widget 必须一致）
const LOGIN_SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';

//: 由 js/turnstile-widget.js 的 mount() 返回，负责取 token / 重置
let loginWidget = null;
let loginBound = false;

/** DOM 就绪回调（脚本在 body 末尾，通常 readyState 已经是 interactive） */
function onLoginDomReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

onLoginDomReady(function () {
    mountLoginWidget();
    bindLoginForm();     // ← 无条件绑定，不看 Turnstile 的脸色
});

/**
 * 挂载人机验证组件。
 * 挂不上也**不影响表单绑定**：提交时会由 requireLoginToken() 拦下并说明原因，
 * 同时组件下方会显示带「重新验证」按钮的提示条（见 turnstile-widget.js）。
 */
function mountLoginWidget() {
    const container = document.getElementById('turnstile-widget-login');
    if (!container) return;
    if (typeof TurnstileWidget === 'undefined') {
        // 连公共模块都没加载出来（极端情况）：至少把话说清楚，而不是静默失效
        if (typeof Toast !== 'undefined') Toast.show('人机验证脚本未加载，请刷新页面重试');
        return;
    }
    loginWidget = TurnstileWidget.mount(container, { sitekey: LOGIN_SITEKEY });
}

/**
 * 取一个可提交的 token；取不到时返回 null 并已经给出**具体原因**。
 * 区分「组件没挂上」「用户还没完成验证」「挑战报错」几种情况，
 * 不再把它们混成一句含糊的「登录失败」。
 */
function requireLoginToken() {
    if (!loginWidget) {
        if (typeof Toast !== 'undefined') Toast.show('人机验证未初始化，请刷新页面重试');
        return null;
    }
    const token = loginWidget.getToken();
    if (!token) {
        if (typeof Toast !== 'undefined') {
            Toast.show(loginWidget.state() === 'failed'
                ? '人机验证加载失败，请点组件下方的「重新验证」'
                : '请先完成人机验证');
        }
        return null;
    }
    return token;
}

function bindLoginForm() {
    const formEl = document.getElementById('loginForm');
    if (!formEl || loginBound) return;
    loginBound = true;

    formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(formEl);
        const username = (formData.get('username') || '').toString().trim();
        const password = (formData.get('password') || '').toString();

        if (!username || !password) {
            if (typeof Toast !== 'undefined') Toast.show('请输入用户名和密码');
            return;
        }

        const cfToken = requireLoginToken();
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
                // 失败原因以后端 msg 为准：site-back/utils/turnstile.py 会把
                // Turnstile 的 error-codes（timeout-or-duplicate 等）翻译成人话再返回
                if (typeof Toast !== 'undefined') Toast.show(data?.msg || '登录失败');
                // token 是一次性的：无论哪一步失败，下一次提交都必须换一张新的
                if (loginWidget) loginWidget.reset();
            }
        } catch {
            if (typeof Toast !== 'undefined') Toast.show('网络错误');
            if (loginWidget) loginWidget.reset();
        }
    });
}
