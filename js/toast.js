/**
 * toast.js
 * 轻量级通知组件
 */
const Toast = {
    container: null,
    maxToasts: 3,

    // 初始化容器
    init: function() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },

    // 显示通知
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

    // 移除通知
    remove: function(toast) {
        toast.classList.remove('toast-show');
        toast.addEventListener('transitionend', () => {
            if (toast.parentNode === this.container) {
                this.container.removeChild(toast);
            }
        }, { once: true });
        // 兜底：如果 transitionend 未触发，500ms 后强制移除
        setTimeout(() => {
            if (toast.parentNode === this.container) {
                this.container.removeChild(toast);
            }
        }, 500);
    }
};