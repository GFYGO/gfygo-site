/**
 * toast.js
 * 轻量级通知组件
 * Phase 1: 改为 ES Module，保留 window 兼容层
 */

const Toast = {
    container: null,
    maxToasts: 3,

    init: function() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },

    show: function(message, type = 'error') {
        this.init();

        const toasts = this.container.querySelectorAll('.toast');
        if (toasts.length >= this.maxToasts) {
            this.container.removeChild(toasts[0]);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const messageSpan = document.createElement('span');
        messageSpan.className = 'toast-message';
        messageSpan.textContent = message;
        toast.appendChild(messageSpan);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.innerHTML = '&times;';
        toast.appendChild(closeBtn);

        closeBtn.onclick = () => this.remove(toast);

        this.container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });

        setTimeout(() => {
            this.remove(toast);
        }, 3000);
    },

    remove: function(toast) {
        toast.classList.remove('toast-show');
        toast.addEventListener('transitionend', () => {
            if (toast.parentNode === this.container) {
                this.container.removeChild(toast);
            }
        }, { once: true });
        setTimeout(() => {
            if (toast.parentNode === this.container) {
                this.container.removeChild(toast);
            }
        }, 500);
    }
};

export default Toast;
export { Toast };

// ===== 兼容层：迁移期保留 window 挂载 =====
window.Toast = Toast;
