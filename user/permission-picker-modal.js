/**
 * permission-picker-modal.js —— 通用「权限节点选择」弹窗
 *
 * 目的：把「填权限」从手输节点码（如 `admin.stats.view`）统一成**权限编辑卡片**
 *       （与 admin-menu / admin-permissions 用的是同一个 `user/permission-picker.js`），
 *       任何动态页都能一行接入：
 *
 *   window.PermissionPickerModal.open({
 *       title: '选择权限节点',
 *       multiple: false,             // true = 多选，false = 单选
 *       value: ['admin.stats.view'], // 初始值（节点码数组 / 单个节点码 / 空）
 *       hint: '留空 = 不限制',
 *   }).then(function (nodes) {
 *       // nodes === null  → 取消
 *       // nodes === []    → 用户点了「清除」
 *       // 其它            → 选中的节点码数组
 *   });
 *
 * 设计约束（与 admin 动态页一致）：
 *   * 本文件是**普通脚本**（IIFE），不要写 import / export；动态页以 Blob URL 执行脚本。
 *   * 卡片本体复用 `user/permission-picker.js` + `user/permission-picker.css`，按需注入，
 *     不改变这两个文件的行为；弹窗自身的少量样式在本文件内注入。
 *   * 只读 window.BASE_PATH 拼资源路径（动态页都在站点子路径下）。
 */
(function () {
    if (window.PermissionPickerModal) return;

    var OVERLAY_CLASS = 'ppm-overlay';
    var STYLE_ID = 'ppm-runtime-style';
    var CSS_FLAG = 'data-ppm-css';

    function basePath() {
        return window.BASE_PATH || '.';
    }

    function escText(value) {
        var d = document.createElement('div');
        d.textContent = value == null ? '' : String(value);
        return d.innerHTML;
    }

    function injectCSS() {
        if (!document.querySelector('link[' + CSS_FLAG + ']')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = basePath() + '/user/permission-picker.css';
            link.setAttribute(CSS_FLAG, '1');
            document.head.appendChild(link);
        }
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.' + OVERLAY_CLASS + '{position:fixed;inset:0;z-index:10050;display:flex;',
            'align-items:center;justify-content:center;padding:16px;',
            'background:rgba(0,0,0,.45);}',
            '.' + OVERLAY_CLASS + ' .ppm-card{width:100%;max-width:600px;max-height:86vh;',
            'display:flex;flex-direction:column;overflow:hidden;',
            'background:var(--color-bg-white,#fff);color:var(--color-text-main,#064e3b);',
            'border-radius:var(--radius-lg,16px);',
            'box-shadow:0 20px 60px rgba(0,0,0,.25);}',
            '.' + OVERLAY_CLASS + ' .ppm-head{display:flex;align-items:center;',
            'justify-content:space-between;gap:12px;padding:16px 20px;',
            'border-bottom:1px solid var(--color-border,#a7f3d0);}',
            '.' + OVERLAY_CLASS + ' .ppm-title{margin:0;font-size:1.05rem;font-weight:700;}',
            '.' + OVERLAY_CLASS + ' .ppm-close{background:none;border:none;cursor:pointer;',
            'font-size:1.4rem;line-height:1;color:inherit;opacity:.7;padding:4px 8px;}',
            '.' + OVERLAY_CLASS + ' .ppm-close:hover{opacity:1;}',
            '.' + OVERLAY_CLASS + ' .ppm-body{padding:16px 20px;overflow-y:auto;',
            'min-height:320px;max-height:62vh;}',
            '.' + OVERLAY_CLASS + ' .ppm-hint{margin:0 0 10px;font-size:.82rem;',
            'color:var(--color-text-muted,#047857);}',
            '.' + OVERLAY_CLASS + ' .ppm-foot{display:flex;align-items:center;gap:10px;',
            'padding:12px 20px;border-top:1px solid var(--color-border,#a7f3d0);}',
            '.' + OVERLAY_CLASS + ' .ppm-count{margin-right:auto;font-size:.82rem;',
            'color:var(--color-text-muted,#047857);}',
            '.' + OVERLAY_CLASS + ' .ppm-empty{padding:24px;text-align:center;',
            'color:var(--color-text-muted,#047857);}',
        ].join('');
        document.head.appendChild(style);
    }

    /** 按需加载卡片本体（admin-menu 同款路径） */
    function loadPickerJS() {
        return new Promise(function (resolve, reject) {
            if (window.PermissionPicker) { resolve(); return; }
            var s = document.createElement('script');
            s.src = basePath() + '/user/permission-picker.js';
            s.onload = function () { resolve(); };
            s.onerror = function () {
                reject(new Error('permission-picker.js 加载失败'));
            };
            document.head.appendChild(s);
        });
    }

    function toState(value) {
        var list = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
        var state = {};
        list.forEach(function (code) {
            var text = String(code == null ? '' : code).trim();
            if (text) state[text] = 'allow';
        });
        return state;
    }

    var current = null;

    function close() {
        if (!current) return;
        document.removeEventListener('keydown', current.onKey, true);
        var overlay = current.overlay;
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        current = null;
    }

    /**
     * 打开权限节点选择弹窗。
     * @param {Object} options {title, multiple, value, hint}
     * @returns {Promise<string[]|null>} 选中节点码数组；取消返回 null
     */
    function open(options) {
        var opts = options || {};
        injectCSS();

        return loadPickerJS().then(function () {
            return new Promise(function (resolve) {
                close();

                var overlay = document.createElement('div');
                overlay.className = OVERLAY_CLASS;
                overlay.setAttribute('role', 'dialog');
                overlay.setAttribute('aria-modal', 'true');
                overlay.innerHTML =
                    '<div class="ppm-card">' +
                        '<div class="ppm-head">' +
                            '<h3 class="ppm-title">' + escText(opts.title || '选择权限节点') + '</h3>' +
                            '<button type="button" class="ppm-close" data-ppm="cancel" aria-label="关闭">×</button>' +
                        '</div>' +
                        '<div class="ppm-body">' +
                            (opts.hint ? '<p class="ppm-hint">' + escText(opts.hint) + '</p>' : '') +
                            '<div class="ppm-picker"></div>' +
                        '</div>' +
                        '<div class="ppm-foot">' +
                            '<span class="ppm-count" data-ppm="count"></span>' +
                            '<button type="button" class="btn btn-secondary" data-ppm="clear">清除</button>' +
                            '<button type="button" class="btn btn-secondary" data-ppm="cancel">取消</button>' +
                            '<button type="button" class="btn btn-primary" data-ppm="ok">确定</button>' +
                        '</div>' +
                    '</div>';
                document.body.appendChild(overlay);

                var finished = false;
                var loadFailed = false;

                function finish(value) {
                    if (finished) return;
                    finished = true;
                    close();
                    resolve(value);
                }

                function selected() {
                    // 加载失败时返回**原始值**而不是空数组：点「确定」不应把已有设置抹掉
                    if (loadFailed) {
                        return Array.isArray(opts.value) ? opts.value.slice()
                            : (opts.value ? [opts.value] : []);
                    }
                    var state = picker.getValue() || {};
                    return Object.keys(state);
                }

                function updateCount() {
                    if (loadFailed) {
                        var el0 = overlay.querySelector('[data-ppm="count"]');
                        if (el0) el0.textContent = '加载失败';
                        return;
                    }
                    var nodes = selected();
                    var el = overlay.querySelector('[data-ppm="count"]');
                    if (!el) return;
                    el.textContent = nodes.length ? ('已选 ' + nodes.length + ' 项') : '未选择';
                }

                function onKey(e) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        finish(null);
                    }
                }

                var picker = new window.PermissionPicker(overlay.querySelector('.ppm-picker'), {
                    mode: 'node',
                    value: toState(opts.value),
                    allowSingleSelect: !opts.multiple,
                    title: '',
                    onChange: function () { updateCount(); }
                });

                overlay.addEventListener('click', function (e) {
                    var target = e.target;
                    if (target === overlay) { finish(null); return; }
                    var act = target && target.getAttribute ? target.getAttribute('data-ppm') : null;
                    if (act === 'cancel') finish(null);
                    else if (act === 'clear') finish([]);
                    else if (act === 'ok') finish(selected());
                });

                current = { overlay: overlay, onKey: onKey };
                document.addEventListener('keydown', onKey, true);

                picker.load().then(function () {
                    // 节点列表为空 = 接口失败 / 无权限：不要静默当成「没有可选项」，
                    // 否则用户点「确定」会把已有值清成 []。
                    if (!picker.nodes || !picker.nodes.length) {
                        loadFailed = true;
                        var body = overlay.querySelector('.ppm-picker');
                        if (body) {
                            body.innerHTML = '<div class="ppm-empty">权限节点列表加载失败（无权限或网络异常），请稍后重试。</div>';
                        }
                        var okBtn = overlay.querySelector('[data-ppm="ok"]');
                        if (okBtn) okBtn.disabled = true;
                    }
                    updateCount();
                    var btn = overlay.querySelector('.ppm-close');
                    if (btn && btn.focus) btn.focus();
                });
            });
        });
    }

    window.PermissionPickerModal = { open: open, close: close };
})();
