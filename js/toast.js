/**
 * toast.js
 * 轻量级通知组件
 * 共享模块：所有页面以普通 <script> 加载
 */

var Toast = {
    container: null,
    maxToasts: 3,

    init: function() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            // ⭐ P2 可访问性（2026-10-15 审查）：屏幕阅读器此前完全读不到轻提示。
            //    role=status + aria-live=polite：内容变化会被朗读，但不打断当前朗读。
            this.container.setAttribute('role', 'status');
            this.container.setAttribute('aria-live', 'polite');
            this.container.setAttribute('aria-atomic', 'false');
            document.body.appendChild(this.container);
        }
    },

    show: function(message, type) {
        type = type || 'error';
        this.init();

        var toasts = this.container.querySelectorAll('.toast');
        if (toasts.length >= this.maxToasts) {
            this.container.removeChild(toasts[0]);
        }

        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;

        var messageSpan = document.createElement('span');
        messageSpan.className = 'toast-message';
        messageSpan.textContent = message;
        toast.appendChild(messageSpan);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.innerHTML = '&times;';
        toast.appendChild(closeBtn);

        var self = this;
        closeBtn.onclick = function() { self.remove(toast); };

        this.container.appendChild(toast);

        requestAnimationFrame(function() {
            toast.classList.add('toast-show');
        });

        setTimeout(function() {
            self.remove(toast);
        }, 3000);
    },

    remove: function(toast) {
        var self = this;
        toast.classList.remove('toast-show');
        toast.addEventListener('transitionend', function() {
            if (toast.parentNode === self.container) {
                self.container.removeChild(toast);
            }
        }, { once: true });
        setTimeout(function() {
            if (toast.parentNode === self.container) {
                self.container.removeChild(toast);
            }
        }, 500);
    }
};

// ===== 全局挂载 =====
window.Toast = Toast;
