/**
 * modal.js
 * 自定义弹窗组件，替换原生 confirm / prompt / alert
 * 采用 Promise 模式：Modal.confirm(msg) / Modal.prompt(msg, defaultVal) / Modal.alert(msg)
 *
 * 使用示例：
 *   const ok = await Modal.confirm('确认删除？');
 *   if (ok) { ... }
 *
 *   const name = await Modal.prompt('请输入名称：', '默认值');
 *   if (name !== null) { ... }
 *
 *   await Modal.alert('提示信息');
 */
const Modal = (function () {
    const overlayEl = document.createElement('div');
    overlayEl.className = 'modal-overlay';
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML = `
        <div class="modal-dialog" role="dialog" aria-modal="true" tabindex="-1">
            <div class="modal__header">
                <div class="modal__icon" data-modal-icon></div>
                <div class="modal__title" data-modal-title>提示</div>
                <button class="modal__close" type="button" aria-label="关闭" data-modal-close>&times;</button>
            </div>
            <div class="modal__body">
                <div class="modal__message" data-modal-message></div>
                <div class="modal__input-wrap" data-modal-input-wrap hidden>
                    <input type="text" class="modal__input" data-modal-input autocomplete="off" />
                </div>
            </div>
            <div class="modal__footer">
                <button class="modal__btn modal__btn--cancel" type="button" data-modal-cancel>取消</button>
                <button class="modal__btn modal__btn--confirm" type="button" data-modal-ok>确定</button>
            </div>
        </div>
    `;

    const titleEl = overlayEl.querySelector('[data-modal-title]');
    const iconEl = overlayEl.querySelector('[data-modal-icon]');
    const msgEl = overlayEl.querySelector('[data-modal-message]');
    const inputWrapEl = overlayEl.querySelector('[data-modal-input-wrap]');
    const inputEl = overlayEl.querySelector('[data-modal-input]');
    const okBtn = overlayEl.querySelector('[data-modal-ok]');
    const cancelBtn = overlayEl.querySelector('[data-modal-cancel]');
    const closeBtn = overlayEl.querySelector('[data-modal-close]');
    const dialogEl = overlayEl.querySelector('.modal-dialog');

    let resolver = null;
    let mode = null; // 'confirm' | 'prompt' | 'alert'
    let lastFocus = null;

    function ensureMounted() {
        if (!overlayEl.parentNode) document.body.appendChild(overlayEl);
    }

    function bindOnce() {
        if (bindOnce._done) return;
        bindOnce._done = true;
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) onCancel();
        });
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                onOk();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        });
        overlayEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.activeElement !== inputEl) {
                e.preventDefault();
                onCancel();
            }
        });
    }

    function open(config) {
        mode = config.mode;
        ensureMounted();
        bindOnce();
        lastFocus = document.activeElement;

        // 标题 / 图标
        titleEl.textContent = config.title || defaultTitle(mode);
        iconEl.textContent = config.icon || defaultIcon(mode);
        iconEl.dataset.modalIconType = mode;

        // 消息
        msgEl.textContent = config.message || '';

        // 输入框
        if (mode === 'prompt') {
            inputWrapEl.hidden = false;
            inputEl.value = config.defaultValue != null ? String(config.defaultValue) : '';
            cancelBtn.style.display = '';
        } else {
            inputWrapEl.hidden = true;
            inputEl.value = '';
            if (mode === 'alert') {
                cancelBtn.style.display = 'none';
            } else {
                cancelBtn.style.display = '';
            }
        }

        // 按钮文字
        okBtn.textContent = config.okText || defaultOkText(mode);
        cancelBtn.textContent = config.cancelText || '取消';

        // 显示
        overlayEl.classList.add('modal-overlay--show');
        overlayEl.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        dialogEl.focus();

        // prompt 模式聚焦输入框并选中文字
        if (mode === 'prompt') {
            requestAnimationFrame(() => {
                inputEl.focus();
                inputEl.select();
            });
        } else {
            requestAnimationFrame(() => okBtn.focus());
        }

        return new Promise((resolve) => {
            resolver = resolve;
        });
    }

    function close() {
        overlayEl.classList.remove('modal-overlay--show');
        overlayEl.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        if (lastFocus && typeof lastFocus.focus === 'function') {
            lastFocus.focus();
        }
        resolver = null;
        mode = null;
    }

    function onOk() {
        if (!resolver) return;
        let result;
        if (mode === 'prompt') {
            result = inputEl.value;
        } else {
            result = true;
        }
        const fn = resolver;
        close();
        fn(result);
    }

    function onCancel() {
        if (!resolver) return;
        let result;
        if (mode === 'prompt') {
            result = null;
        } else if (mode === 'confirm') {
            result = false;
        } else {
            result = undefined;
        }
        const fn = resolver;
        close();
        fn(result);
    }

    function defaultTitle(m) {
        return m === 'confirm' ? '确认操作'
            : m === 'prompt' ? '请输入'
            : '提示';
    }

    function defaultIcon(m) {
        return m === 'confirm' ? '⚠️'
            : m === 'prompt' ? '✏️'
            : 'ℹ️';
    }

    function defaultOkText(m) {
        return m === 'confirm' ? '确认'
            : m === 'prompt' ? '提交'
            : '知道了';
    }

    return {
        /**
         * 确认弹窗
         * @param {string} message
         * @param {{title?:string, okText?:string, cancelText?:string, icon?:string}} [opts]
         * @returns {Promise<boolean>} 确认=true，取消=false
         */
        confirm(message, opts = {}) {
            return open({ mode: 'confirm', message, ...opts });
        },

        /**
         * 输入弹窗
         * @param {string} message
         * @param {string} [defaultValue]
         * @param {{title?:string, okText?:string, cancelText?:string, icon?:string}} [opts]
         * @returns {Promise<string|null>} 提交=输入字符串，取消=null
         */
        prompt(message, defaultValue, opts = {}) {
            return open({ mode: 'prompt', message, defaultValue, ...opts });
        },

        /**
         * 提示弹窗（无取消按钮）
         * @param {string} message
         * @param {{title?:string, okText?:string, icon?:string}} [opts]
         * @returns {Promise<void>}
         */
        alert(message, opts = {}) {
            return open({ mode: 'alert', message, ...opts });
        },

        /** 立即关闭（用于异常兜底） */
        forceClose() {
            if (resolver) onCancel();
        }
    };
})();
