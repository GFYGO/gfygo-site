/**
 * turnstile-widget.js
 * Cloudflare Turnstile 的统一挂载 / 自愈逻辑（login.html 与 register.html 共用）
 *
 * 为什么要有这个文件（而不是像以前那样 login.js / register.js 里各写一份）：
 *
 *   1. **挑战失败时页面什么都不显示**。以前 render() 不传任何回调，按 Cloudflare 文档，
 *      没有 error-callback 时 Turnstile 只会往控制台抛/记一条信息 —— 用户看到的就是
 *      「挑战一直转圈、永远不结束」，既不知道原因也没有重试入口。这是本次要修的主症状。
 *   2. **token 5 分钟就过期**（Cloudflare 文档：token 有效期 300 秒、且只能核销一次）。
 *      以前没有 expired-callback，用户在登录页停留超过 5 分钟后提交，拿到的是过期 token，
 *      后端必然回「人机验证失败」。这里到期自动重发挑战。
 *   3. **同一个容器被渲染两次**。以前 onTurnstileReady 与 DOMContentLoaded 都会调
 *      renderWidget()，而函数开头是 `container.innerHTML = ''` —— 如果 SDK 在
 *      DOMContentLoaded 之前就绪（脚本被缓存时很常见），第二次调用会把**正在进行中**
 *      的挑战 DOM 清空再重渲染，挑战被拆掉重建，很容易停在转圈状态。
 *      这里保证「同一个容器只挂一次」，重复调用是幂等的。
 *   4. 以前 `turnstileFailed` 是个全局布尔量，注册页三个 Tab 共用一个：
 *      在 A Tab 渲染失败会把 B Tab 也判成失败；而且一旦置位就再也不会复原。
 *      这里把状态放进每个容器各自的 controller。
 *
 * 对外只暴露 window.TurnstileWidget：
 *   TurnstileWidget.mount(containerEl, { sitekey, onChange, onToken }) -> controller
 *   controller.getToken()   取当前 token（'' 表示还没有）
 *   controller.isReady()    widget 是否已经真正挂上
 *   controller.reset()      作废当前 token 并重新发起挑战
 *   controller.destroy()    移除 widget（切 Tab / 页面离开时用）
 *   controller.state()      'sdk-loading' | 'pending' | 'ready' | 'expired' | 'timeout' | 'failed'
 *
 * ⚠️ 本文件**不负责表单绑定**。表单绑定必须与 SDK 是否加载成功无关，
 *    否则 SDK 挂掉时连「点了登录没反应」这种更糟的故障都会出现（见 login.js 的说明）。
 */
(function (global) {
    'use strict';

    var SDK_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        + '?render=explicit&onload=__gwlTurnstileSdkReady';
    var SDK_READY_NAME = '__gwlTurnstileSdkReady';

    // 超时可在页面侧覆盖：在加载本文件**之前**设置 window.TURNSTILE_TIMEOUTS = {sdk, challenge}
    // （运维按网络情况调参用；回归测试也用它把 15s/25s 压到毫秒级）
    var TIMEOUT_OVERRIDE = global.TURNSTILE_TIMEOUTS || {};
    // SDK 脚本多久没加载出来就认为被拦截 / 网络不通
    var SDK_LOAD_TIMEOUT_MS = Number(TIMEOUT_OVERRIDE.sdk) > 0 ? Number(TIMEOUT_OVERRIDE.sdk) : 15000;
    // SDK 起来了但迟迟拿不到 token（挑战卡住）→ 给用户一个明确的出口
    var CHALLENGE_TIMEOUT_MS = Number(TIMEOUT_OVERRIDE.challenge) > 0
        ? Number(TIMEOUT_OVERRIDE.challenge) : 25000;
    // 前 N 次错误交给 Turnstile 自己重试（它默认 retry=auto），之后才向用户报错
    var MAX_SILENT_ERRORS = 2;

    // Turnstile 错误码 → 可执行的中文说明
    // 码表来源：https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
    var ERROR_TEXT = {
        '110100': '站点密钥无效，请联系管理员检查 Turnstile 配置。',
        '110110': '站点密钥不存在，请联系管理员检查 Turnstile 配置。',
        '110200': '当前域名未在 Turnstile 的域名白名单里，请联系管理员把本域名加进去。',
        '110600': '人机验证超时。请检查电脑的日期时间是否正确，然后重试。',
        '110620': '等待操作超时。请重新完成验证。',
        '200100': '人机验证失败（时间或缓存异常）。请检查系统时间，或用无痕窗口重试。',
        '200500': '无法加载人机验证组件：浏览器连不上 challenges.cloudflare.com。'
            + '请关闭代理 / VPN、关闭广告拦截类扩展后重试，或换一个网络（如手机热点）。',
        '400020': '站点密钥无效，请联系管理员检查 Turnstile 配置。',
        '400070': '站点密钥已被停用，请联系管理员。'
    };

    function describeError(code) {
        var key = String(code == null ? '' : code);
        if (ERROR_TEXT[key]) return ERROR_TEXT[key];
        // 300* / 600* 是「通用挑战失败」，Cloudflare 归因为疑似机器人行为或网络受限
        if (/^300/.test(key) || /^600/.test(key)) {
            return '人机验证未通过（错误码 ' + key + '）。'
                + '请关闭代理 / VPN 与广告拦截类扩展，或更换网络后重试。';
        }
        return '人机验证失败（错误码 ' + (key || '未知') + '）。请刷新页面或更换网络后重试。';
    }

    // ============================================================
    // SDK 加载：全站只注入一次，失败可重试
    // ============================================================
    var sdkState = 'idle';          // idle | loading | ready | failed
    var sdkTimer = null;
    var sdkWaiters = [];

    function resolveSdkWaiters(ok) {
        var list = sdkWaiters;
        sdkWaiters = [];
        for (var i = 0; i < list.length; i++) {
            try { list[i](ok); } catch (e) { /* 单个等待者出错不影响其它 */ }
        }
    }

    // 由 SDK 的 ?onload= 参数调用 —— 必须在注入 <script> 之前就挂在 window 上
    global[SDK_READY_NAME] = function () {
        sdkState = 'ready';
        if (sdkTimer) { clearTimeout(sdkTimer); sdkTimer = null; }
        resolveSdkWaiters(true);
    };

    function injectSdk() {
        if (sdkState === 'ready' || sdkState === 'loading') return;
        sdkState = 'loading';

        // 页面里已经有一份可用的 SDK（比如别的脚本先注入了）→ 直接认它
        if (global.turnstile) {
            global[SDK_READY_NAME]();
            return;
        }

        var s = document.createElement('script');
        s.src = SDK_SRC;
        s.async = true;
        // 只挂 onerror（脚本被扩展/网络拦截）。真正的就绪信号走 ?onload= 回调 ——
        // 动态插入的 <script> 的 defer 属性是无效的，之前写 s.defer = true 没有意义。
        s.onerror = function () {
            if (sdkState === 'ready') return;
            sdkState = 'failed';
            if (sdkTimer) { clearTimeout(sdkTimer); sdkTimer = null; }
            resolveSdkWaiters(false);
        };
        document.head.appendChild(s);

        if (sdkTimer) clearTimeout(sdkTimer);
        sdkTimer = setTimeout(function () {
            sdkTimer = null;
            // 既不 onload 也不 onerror（被静默拦截 / 卡在 DNS）→ 同样算失败
            if (sdkState !== 'ready') {
                sdkState = 'failed';
                resolveSdkWaiters(false);
            }
        }, SDK_LOAD_TIMEOUT_MS);
    }

    /** 等 SDK 就绪；ok=false 表示确定加载不出来（可再次调用 preload 重试） */
    function whenSdkReady(cb) {
        if (sdkState === 'ready') { cb(true); return; }
        if (sdkState === 'failed') { cb(false); return; }
        sdkWaiters.push(cb);
        injectSdk();
    }

    /** 重新尝试注入 SDK（供「重新验证」按钮使用：清掉失败态与残留脚本标签） */
    function retrySdk() {
        // SDK 已经跑起来了就不要去动它的 <script>：Turnstile 的自升级逻辑
        // 要靠这个标签（找不到标签它会跳过 _upgrade），删了反而添乱。
        if (!global.turnstile) {
            var stale = document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]');
            for (var i = 0; i < stale.length; i++) {
                if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
            }
        }
        sdkState = 'idle';
        injectSdk();
    }

    // ============================================================
    // 提示条：附加在 widget 容器**旁边**，绝不能写进容器内部
    // （Turnstile 往容器里放 iframe，innerHTML 一冲就把挑战弄没了）
    // ============================================================
    function ensureNotice(container) {
        var host = container.parentNode || container;
        var found = null;
        var kids = host.children || [];
        for (var i = 0; i < kids.length; i++) {
            if (kids[i].classList && kids[i].classList.contains('turnstile-notice')) {
                found = kids[i];
                break;
            }
        }
        if (found) return found;

        var box = document.createElement('div');
        box.className = 'turnstile-notice';
        box.setAttribute('role', 'status');

        var text = document.createElement('p');
        text.className = 'turnstile-notice__text';
        box.appendChild(text);

        if (host.appendChild) host.appendChild(box);
        return box;
    }

    // ============================================================
    // 单个容器的 controller
    // ============================================================
    function createController(container, options) {
        options = options || {};
        var sitekey = options.sitekey || '';
        var onChange = typeof options.onChange === 'function' ? options.onChange : function () {};
        var onToken = typeof options.onToken === 'function' ? options.onToken : function () {};

        var widgetId = null;        // ⚠️ 可能是数字 0 —— 判定一律用 != null，不要用取反
        var state = 'sdk-loading';
        var token = '';
        var errorCount = 0;
        var watchdog = null;
        var destroyed = false;
        var noticeBox = null;

        function setState(next) {
            if (state === next) return;
            state = next;
            try { onChange(controller, state); } catch (e) { /* 页面回调出错不能拖垮 widget */ }
        }

        function clearWatchdog() {
            if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        }

        function startWatchdog() {
            clearWatchdog();
            watchdog = setTimeout(function () {
                watchdog = null;
                if (destroyed || token) return;
                if (state === 'failed') return;
                // 只提示、不自动重置：用户可能正在做交互式挑战，
                // 自动 reset 会把他刚做的操作抹掉。给按钮，让他自己决定。
                setState('timeout');
                showNotice('人机验证还没有完成。如果长时间没有反应，请点「重新验证」。', true);
            }, CHALLENGE_TIMEOUT_MS);
        }

        function hideNotice() {
            if (noticeBox && noticeBox.parentNode) noticeBox.parentNode.removeChild(noticeBox);
            noticeBox = null;
        }

        function showNotice(message, withRetry) {
            if (destroyed) return;
            noticeBox = ensureNotice(container);
            noticeBox.className = 'turnstile-notice'
                + (state === 'failed' ? ' turnstile-notice--error' : ' turnstile-notice--info');
            var textEl = noticeBox.querySelector('.turnstile-notice__text');
            if (textEl) textEl.textContent = message;

            var oldBtn = noticeBox.querySelector('.turnstile-notice__btn');
            if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);

            if (withRetry) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'turnstile-notice__btn';
                btn.textContent = '重新验证';
                btn.addEventListener('click', function () { controller.reset(); });
                noticeBox.appendChild(btn);
            }
        }

        function renderWidget() {
            if (destroyed || widgetId != null) return;   // 幂等：同一个容器只挂一次
            if (!container || !global.turnstile) return;

            try {
                widgetId = global.turnstile.render(container, {
                    sitekey: sitekey,
                    theme: 'auto',
                    language: 'zh-cn',                 // 组件自身的提示也用中文
                    'retry': 'auto',                   // 出错自动重试（默认值，写出来是为了可读）
                    'error-callback': function (code) {
                        errorCount += 1;
                        // 前几次交给 Turnstile 自己重试（返回 falsy = 由它处理），
                        // 连续失败才向用户报错，避免网络抖一下就吓唬人。
                        if (errorCount <= MAX_SILENT_ERRORS) {
                            setState('pending');
                            return false;
                        }
                        setState('failed');
                        showNotice(describeError(code), true);
                        return true;                   // 已自行提示，别让 Turnstile 再抛异常
                    },
                    'timeout-callback': function () {
                        // 访问者迟迟没有完成交互式挑战：把控制权交回用户
                        setState('timeout');
                        showNotice('等待操作超时，请点「重新验证」重新完成人机验证。', true);
                    },
                    'expired-callback': function () {
                        // token 只有 300 秒；到期后必须换一张新的，否则提交必然被后端拒
                        restartChallenge('人机验证已过期，正在重新验证…');
                    },
                    'callback': function (t) {
                        token = t || '';
                        errorCount = 0;
                        clearWatchdog();
                        hideNotice();
                        setState(token ? 'ready' : 'pending');
                        onToken(token);
                    }
                });
            } catch (e) {
                widgetId = null;
                setState('failed');
                showNotice('人机验证组件初始化失败：' + (e && e.message ? e.message : e)
                    + '。请刷新页面重试。', true);
                return;
            }

            // ⚠️ render() 在部分版本里返回数字 0，用 !widgetId 会把正常挂载判成失败
            if (widgetId == null) {
                setState('failed');
                showNotice('人机验证组件未能挂载。请刷新页面，或关闭广告拦截类扩展后重试。', true);
                return;
            }

            setState('pending');
            startWatchdog();
        }

        /**
         * 作废当前 token 并重新发起挑战。
         * @param {string} pendingMessage 显示在提示条上的文案（'' = 不显示提示条）
         */
        function restartChallenge(pendingMessage) {
            if (destroyed) return;
            token = '';
            errorCount = 0;

            if (global.turnstile && widgetId != null) {
                try { global.turnstile.reset(widgetId); } catch (e) { /* 忽略 */ }
                setState('pending');
                if (pendingMessage) showNotice(pendingMessage, false);
                else hideNotice();
                startWatchdog();
                return;
            }

            // widget 根本没挂上 → 重新走一遍「注入 SDK + render」
            // ⚠️ SDK 正在加载中就不要 retrySdk()：那会把在途的 <script> 换掉再注入一份
            if (sdkState !== 'loading') retrySdk();
            whenSdkReady(function (ok) {
                if (destroyed) return;
                if (!ok) {
                    setState('failed');
                    showNotice('仍无法加载人机验证组件：浏览器连不上 challenges.cloudflare.com。'
                        + '请关闭代理 / VPN 或更换网络后重试。', true);
                    return;
                }
                renderWidget();
            });
        }

        var controller = {
            getToken: function () {
                if (destroyed) return '';
                // 以 SDK 的实时答案为准（它会随 reset / 过期自动清空），
                // 只有在 SDK 不可用时才退回回调里存下的 token。
                if (global.turnstile && widgetId != null) {
                    try {
                        var live = global.turnstile.getResponse(widgetId);
                        if (live) return live;
                    } catch (e) { /* 落到下面的兜底 */ }
                }
                return token || '';
            },
            isReady: function () { return widgetId != null; },
            state: function () { return state; },
            reset: function () { restartChallenge('正在重新验证…'); },
            destroy: function () {
                destroyed = true;
                clearWatchdog();
                hideNotice();
                if (global.turnstile && widgetId != null) {
                    try { global.turnstile.remove(widgetId); } catch (e) { /* 忽略 */ }
                }
                widgetId = null;
                token = '';
            }
        };

        // 挂载
        whenSdkReady(function (ok) {
            if (destroyed) return;
            if (!ok) {
                setState('failed');
                showNotice('无法加载人机验证组件：浏览器连不上 challenges.cloudflare.com'
                    + '（或被广告拦截类扩展拦下）。请检查网络、关闭代理 / VPN 后点「重新验证」。', true);
                return;
            }
            renderWidget();
        });

        return controller;
    }

    var TurnstileWidget = {
        mount: createController,
        preload: injectSdk,
        describeError: describeError,
        /** 仅供测试/排查：当前 SDK 状态 */
        sdkState: function () { return sdkState; }
    };

    global.TurnstileWidget = TurnstileWidget;
})(window);
