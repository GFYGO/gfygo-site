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

        // 限制最大数量
        const toasts = this.container.querySelectorAll('.toast');
        if (toasts.length >= this.maxToasts) {
            this.container.removeChild(toasts[0]);
        }

        // 创建 DOM
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-message">${message}</span>
            <button class="toast-close" aria-label="关闭">&times;</button>
        `;

        // 绑定关闭事件
        toast.querySelector('.toast-close').onclick = () => this.remove(toast);

        // 添加到容器
        this.container.appendChild(toast);

        // 触发重绘以激活 CSS 动画
        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });

        // 3秒后自动移除
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
        });
    }
};