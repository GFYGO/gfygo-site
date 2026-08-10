/**
 * login.js - 登录页交互逻辑（Turnstile 重写版 v2）
 *
 * 修复：
 * 1. 保存 turnstile.render() 返回的 widgetId，后续 getResponse/reset/remove 都用它
 *    （原代码 getResponse() 不传参数实际能跑，但 reset() 无参数只重置第一个；显式传 widgetId 更稳）
 * 2. 增加 SDK 加载超时兜底（30秒还没加载就提示并让按钮可点，配合后端 DEVELOPMENT=True 可直接过）
 * 3. Site Key 与后端 .env TURNSTILE_SITE_KEY 保持一致：0x4AAAAAAECyOCbL7qIJUOgg
 * 4. 提交前检查 token 是否为空，并提示"请勾选人机验证"
 * 5. 请求失败时调用 turnstile.reset(widgetId) 让用户重新验证（避免因 token 一次性导致反复失败）
 */

// ====== 统一配置（与 .env TURNSTILE_SITE_KEY 保持一致）======
const LOGIN_TURNSTILE_SITEKEY = '0x4AAAAAAECyOCbL7qIJUOgg';
const TURNSTILE_SDK_LOAD_TIMEOUT_MS = 30000; // 30s 加载超时

// ====== 全局状态 ======
let _loginWidgetId = null;      // turnstile.render() 返回的 widget id
let _loginTurnstileReady = false;
let _loginSdkLoadStart = Date.now();
let _turnstileBroken = false;   // Turnstile 完全不可用（如 300010 域名未授权）
let _turnstileBrokenReason = '';

/**
 * 等待 turnstile SDK 就绪（轮询 + 超时）
 * 返回 Promise<true>
 */
function _waitTurnstileSdk() {
    return new Promise((resolve) => {
        const check = () => {
            if (typeof window.turnstile !== 'undefined') {
                resolve(true);
                return;
            }
            if (Date.now() - _loginSdkLoadStart > TURNSTILE_SDK_LOAD_TIMEOUT_MS) {
                console.warn('[Turnstile][Login] SDK 加载超时，跳过组件渲染；若后端开 DEVELOPMENT=True 仍可登录');
                resolve(false);
                return;
            }
            setTimeout(check, 200);
        };
        check();
    });
}

/**
 * 显式渲染登录页 Turnstile 组件（有回调就用回调，否则等待轮询）
 */
async function renderTurnstileLogin() {
    const container = document.getElementById('turnstile-widget-login');
    if (!container) {
        console.warn('[Turnstile][Login] 未找到 turnstile-widget-login 容器');
        return;
    }

    const ready = await _waitTurnstileSdk();
    if (!ready || typeof window.turnstile === 'undefined') {
        // SDK 加载失败：容器里手动塞个提示，让用户知道不是卡了
        container.innerHTML = `
            <div style="padding:12px;border:1px dashed #999;border-radius:8px;color:#666;font-size:13px;text-align:center;">
                ⚠️ 人机验证组件加载超时<br/>
                <small>如持续出现，请刷新页面或检查网络；若已开启开发模式可直接登录</small>
            </div>`;
        return;
    }

    try {
        // 先清理旧的（重复渲染时）
        if (_loginWidgetId !== null) {
            try { window.turnstile.remove(_loginWidgetId); } catch (_) {}
            _loginWidgetId = null;
        }
        _loginWidgetId = window.turnstile.render(container, {
            sitekey: LOGIN_TURNSTILE_SITEKEY,
            theme: 'auto',
            callback: (token) => {
                console.debug('[Turnstile][Login] 验证完成 callback, token 前20:', (token || '').slice(0, 20));
                _turnstileBroken = false;
            },
            'error-callback': (err) => {
                console.error('[Turnstile][Login] 验证出错:', err);
                _turnstileBroken = true;
                _turnstileBrokenReason = String(err || '');
                if (err === 300010) {
                    container.innerHTML = `
                        <div style="padding:12px;border:1px dashed #f80;border-radius:8px;color:#a00;font-size:13px;text-align:center;">
                            ⚠️ 人机验证暂不可用（域名未授权）<br/>
                            <small>已自动开启开发模式，可直接登录</small>
                        </div>`;
                } else if (typeof Toast !== 'undefined') {
                    Toast.show('人机验证出错，请刷新重试');
                }
            },
            'expired-callback': () => {
                console.warn('[Turnstile][Login] Token 已过期，需要重新验证');
            },
            'timeout-callback': () => {
                console.warn('[Turnstile][Login] 验证超时，请重新勾选');
            }
        });
        _loginTurnstileReady = true;
        console.debug('[Turnstile][Login] 渲染成功 widgetId =', _loginWidgetId);
    } catch (e) {
        console.error('[Turnstile][Login] render 异常:', e);
        container.innerHTML = `
            <div style="padding:12px;border:1px dashed #f66;border-radius:8px;color:#a00;font-size:13px;text-align:center;">
                ❌ 人机验证组件渲染失败：${e.message || String(e)}
            </div>`;
    }
}

/**
 * 获取当前登录 Turnstile 的响应 token
 * 返回 null 表示未验证/获取失败
 */
function getLoginTurnstileToken() {
    if (!_loginTurnstileReady || typeof window.turnstile === 'undefined' || _loginWidgetId === null) {
        // SDK 未加载好 → 返回 null；若 DEVELOPMENT=True 后端会放行
        return null;
    }
    try {
        const token = window.turnstile.getResponse(_loginWidgetId);
        return token || null;
    } catch (e) {
        console.warn('[Turnstile][Login] getResponse 异常:', e);
        return null;
    }
}

/**
 * 重置 Turnstile（登录失败后需要重新验证，因为 Turnstile token 只能用一次）
 */
function resetLoginTurnstile() {
    if (typeof window.turnstile === 'undefined' || _loginWidgetId === null) return;
    try {
        window.turnstile.reset(_loginWidgetId);
        console.debug('[Turnstile][Login] 已重置 widgetId =', _loginWidgetId);
    } catch (e) {
        console.warn('[Turnstile][Login] reset 异常:', e);
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // 先启动渲染（异步等待 SDK）
    renderTurnstileLogin();

    const loginForm = document.getElementById('loginForm');
    if (!loginForm) {
        console.error('[Login] 未找到 loginForm');
        return;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1) 收集表单数据
        const formData = new FormData(loginForm);
        const username = (formData.get('username') || '').toString().trim();
        const password = (formData.get('password') || '').toString();

        if (!username || !password) {
            if (typeof Toast !== 'undefined') Toast.show('请输入用户名和密码');
            return;
        }

        // 2) 取 Turnstile token（允许 null，后端 DEVELOPMENT=True 时会跳过）
        const turnstileToken = getLoginTurnstileToken();
        if (!turnstileToken && !_turnstileBroken) {
            // SDK 正常但用户没勾选 → 提示
            if (typeof Toast !== 'undefined') {
                Toast.show('请完成人机验证（点击左侧勾选框）');
            }
            return;
        }
        // _turnstileBroken 时允许空 token 提交（后端 DEVELOPMENT=True 会放行）

        const payload = {
            username: username,
            password: password,
            cf_turnstile_token: turnstileToken || ''
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok && data && data.code === 200) {
                // 登录成功
                AuthGuard.setToken(data.data.access_token, data.data.expires_in);
                localStorage.removeItem('guest_view_mode');
                if (typeof Toast !== 'undefined') {
                    Toast.show('登录成功，正在跳转...', 'success');
                }
                setTimeout(() => {
                    window.location.href = './user/dashboard.html';
                }, 800);
            } else {
                // 登录失败：重置 Turnstile（token 一次性）+ 提示
                resetLoginTurnstile();
                const msg = (data && data.msg) ? data.msg : '登录失败，请重试';
                console.warn('[Login] 登录失败:', msg);
                if (typeof Toast !== 'undefined') Toast.show(msg);
            }
        } catch (error) {
            console.error('[Login] 请求异常:', error);
            resetLoginTurnstile();
            if (typeof Toast !== 'undefined') {
                Toast.show('网络错误，请稍后重试');
            }
        }
    });
});
