/**
 * modal.js
 * 自定义弹窗组件
 * Phase 1: 改为 ES Module，保留 window 兼容层
 */

const Modal = {
    confirm: function(message, options = {}) {
        return new Promise((resolve) => {
            const {
                title = '确认',
                confirmText = '确认',
                cancelText = '取消'
            } = options;

            const modal = this._createModal({
                title,
                content: `<p class="modal-message">${this._escapeHtml(message)}</p>`,
                buttons: [
                    {
                        text: cancelText,
                        class: 'modal-btn-cancel',
                        onClick: () => {
                            this._closeModal(modal);
                            resolve(false);
                        }
                    },
                    {
                        text: confirmText,
                        class: 'modal-btn-confirm',
                        onClick: () => {
                            this._closeModal(modal);
                            resolve(true);
                        }
                    }
                ]
            });

            this._showModal(modal);
        });
    },

    prompt: function(message, defaultValue = '', options = {}) {
        return new Promise((resolve) => {
            const {
                title = '请输入',
                confirmText = '确认',
                cancelText = '取消',
                placeholder = '',
                inputType = 'text'
            } = options;

            const escapedMessage = this._escapeHtml(message);
            const escapedDefault = this._escapeHtml(defaultValue);
            const escapedPlaceholder = this._escapeHtml(placeholder);

            const modal = this._createModal({
                title,
                content: `
                    <p class="modal-message">${escapedMessage}</p>
                    <input 
                        type="${inputType}" 
                        class="modal-input" 
                        value="${escapedDefault}" 
                        placeholder="${escapedPlaceholder}"
                    >
                `,
                buttons: [
                    {
                        text: cancelText,
                        class: 'modal-btn-cancel',
                        onClick: () => {
                            this._closeModal(modal);
                            resolve(null);
                        }
                    },
                    {
                        text: confirmText,
                        class: 'modal-btn-confirm',
                        onClick: () => {
                            const input = modal.querySelector('.modal-input');
                            const value = input ? input.value : '';
                            this._closeModal(modal);
                            resolve(value);
                        }
                    }
                ],
                onShow: (modalEl) => {
                    const input = modalEl.querySelector('.modal-input');
                    if (input) {
                        input.focus();
                        input.select();
                    }
                }
            });

            this._showModal(modal);
        });
    },

    alert: function(message, options = {}) {
        return new Promise((resolve) => {
            const {
                title = '提示',
                confirmText = '确定'
            } = options;

            const modal = this._createModal({
                title,
                content: `<p class="modal-message">${this._escapeHtml(message)}</p>`,
                buttons: [
                    {
                        text: confirmText,
                        class: 'modal-btn-confirm',
                        onClick: () => {
                            this._closeModal(modal);
                            resolve();
                        }
                    }
                ]
            });

            this._showModal(modal);
        });
    },

    _createModal: function({ title, content, buttons, onShow }) {
        const modalHtml = `
            <div class="modal-overlay">
                <div class="modal-container" role="dialog" aria-modal="true">
                    <div class="modal-header">
                        <h3 class="modal-title">${this._escapeHtml(title)}</h3>
                    </div>
                    <div class="modal-body">
                        ${content}
                    </div>
                    <div class="modal-footer">
                        ${buttons.map((btn, index) => `
                            <button 
                                type="button" 
                                class="modal-btn ${btn.class}" 
                                data-index="${index}"
                            >
                                ${this._escapeHtml(btn.text)}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        const container = document.createElement('div');
        container.className = 'modal-wrapper';
        container.innerHTML = modalHtml;

        buttons.forEach((btn, index) => {
            const btnEl = container.querySelector(`button[data-index="${index}"]`);
            if (btnEl && btn.onClick) {
                btnEl.addEventListener('click', btn.onClick);
            }
        });

        const overlay = container.querySelector('.modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    const cancelBtn = buttons.find(b => b.class === 'modal-btn-cancel');
                    if (cancelBtn && cancelBtn.onClick) {
                        cancelBtn.onClick();
                    } else {
                        const confirmBtn = buttons.find(b => b.class === 'modal-btn-confirm');
                        if (confirmBtn && confirmBtn.onClick) {
                            confirmBtn.onClick();
                        }
                    }
                }
            });
        }

        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                const cancelBtn = buttons.find(b => b.class === 'modal-btn-cancel');
                if (cancelBtn && cancelBtn.onClick) {
                    cancelBtn.onClick();
                }
            } else if (e.key === 'Enter') {
                const confirmBtn = buttons.find(b => b.class === 'modal-btn-confirm');
                if (confirmBtn && confirmBtn.onClick) {
                    confirmBtn.onClick();
                }
            }
        };

        container._handleKeydown = handleKeydown;
        container._onShow = onShow;

        return container;
    },

    _showModal: function(modal) {
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        document.addEventListener('keydown', modal._handleKeydown);

        requestAnimationFrame(() => {
            modal.querySelector('.modal-overlay').classList.add('modal-show');
        });

        if (modal._onShow) {
            modal._onShow(modal.querySelector('.modal-container'));
        }
    },

    _closeModal: function(modal) {
        document.removeEventListener('keydown', modal._handleKeydown);

        const overlay = modal.querySelector('.modal-overlay');
        if (overlay) {
            overlay.classList.remove('modal-show');
            overlay.classList.add('modal-hide');
        }

        setTimeout(() => {
            if (modal && modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            const modals = document.querySelectorAll('.modal-wrapper');
            if (modals.length === 0) {
                document.body.style.overflow = '';
            }
        }, 200);
    },

    _escapeHtml: function(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

export default Modal;
export { Modal };

// ===== 兼容层：迁移期保留 window 挂载 =====
window.Modal = Modal;
