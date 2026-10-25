/**
 * modal.js
 * 自定义弹窗组件
 * 共享模块：所有页面以普通 <script> 加载
 */

var Modal = {
    confirm: function(message, options) {
        options = options || {};
        var self = this;
        return new Promise(function(resolve) {
            var title = options.title || '确认';
            var confirmText = options.confirmText || '确认';
            var cancelText = options.cancelText || '取消';

            var modal = self._createModal({
                title: title,
                content: '<p class="modal-message">' + self._escapeHtml(message) + '</p>',
                buttons: [
                    {
                        text: cancelText,
                        cls: 'modal-btn-cancel',
                        onClick: function() {
                            self._closeModal(modal);
                            resolve(false);
                        }
                    },
                    {
                        text: confirmText,
                        cls: 'modal-btn-confirm',
                        onClick: function() {
                            self._closeModal(modal);
                            resolve(true);
                        }
                    }
                ]
            });

            self._showModal(modal);
        });
    },

    prompt: function(message, defaultValue, options) {
        defaultValue = defaultValue || '';
        options = options || {};
        var self = this;
        return new Promise(function(resolve) {
            var title = options.title || '请输入';
            var confirmText = options.confirmText || '确认';
            var cancelText = options.cancelText || '取消';
            var placeholder = options.placeholder || '';
            var inputType = options.inputType || 'text';

            var escapedMessage = self._escapeHtml(message);
            var escapedDefault = self._escapeHtml(defaultValue);
            var escapedPlaceholder = self._escapeHtml(placeholder);

            var modal = self._createModal({
                title: title,
                content: '<p class="modal-message">' + escapedMessage + '</p>' +
                    '<input type="' + inputType + '" class="modal-input" value="' + escapedDefault + '" placeholder="' + escapedPlaceholder + '">',
                buttons: [
                    {
                        text: cancelText,
                        cls: 'modal-btn-cancel',
                        onClick: function() {
                            self._closeModal(modal);
                            resolve(null);
                        }
                    },
                    {
                        text: confirmText,
                        cls: 'modal-btn-confirm',
                        onClick: function() {
                            var input = modal.querySelector('.modal-input');
                            var value = input ? input.value : '';
                            self._closeModal(modal);
                            resolve(value);
                        }
                    }
                ],
                onShow: function(modalEl) {
                    var input = modalEl.querySelector('.modal-input');
                    if (input) {
                        input.focus();
                        input.select();
                    }
                }
            });

            self._showModal(modal);
        });
    },

    alert: function(message, options) {
        options = options || {};
        var self = this;
        return new Promise(function(resolve) {
            var title = options.title || '提示';
            var confirmText = options.confirmText || '确定';

            var modal = self._createModal({
                title: title,
                content: '<p class="modal-message">' + self._escapeHtml(message) + '</p>',
                buttons: [
                    {
                        text: confirmText,
                        cls: 'modal-btn-confirm',
                        onClick: function() {
                            self._closeModal(modal);
                            resolve();
                        }
                    }
                ]
            });

            self._showModal(modal);
        });
    },

    _createModal: function(cfg) {
        var self = this;
        var title = this._escapeHtml(cfg.title);

        var buttonsHtml = cfg.buttons.map(function(btn, index) {
            return '<button type="button" class="modal-btn ' + btn.cls + '" data-index="' + index + '">' + self._escapeHtml(btn.text) + '</button>';
        }).join('');

        // ⭐ P2 可访问性（2026-10-15 审查）：
        //   * 标题与对话框建立 aria-labelledby 关联（此前 role=dialog 无 accessible name）；
        //   * 每个实例用唯一 id（同一时刻可能叠加两层弹窗，固定 id 会撞）。
        var titleId = 'modalTitle-' + (Modal._seq = (Modal._seq || 0) + 1);
        var modalHtml =
            '<div class="modal-overlay">' +
                '<div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">' +
                    '<div class="modal-header"><h3 class="modal-title" id="' + titleId + '">' + title + '</h3></div>' +
                    '<div class="modal-body">' + cfg.content + '</div>' +
                    '<div class="modal-footer">' + buttonsHtml + '</div>' +
                '</div>' +
            '</div>';

        var container = document.createElement('div');
        container.className = 'modal-wrapper';
        container.innerHTML = modalHtml;

        cfg.buttons.forEach(function(btn, index) {
            var btnEl = container.querySelector('button[data-index="' + index + '"]');
            if (btnEl && btn.onClick) {
                btnEl.addEventListener('click', btn.onClick);
            }
        });

        var overlay = container.querySelector('.modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) {
                    var cancelBtn = cfg.buttons.find(function(b) { return b.cls === 'modal-btn-cancel'; });
                    if (cancelBtn && cancelBtn.onClick) {
                        cancelBtn.onClick();
                    } else {
                        var confirmBtn = cfg.buttons.find(function(b) { return b.cls === 'modal-btn-confirm'; });
                        if (confirmBtn && confirmBtn.onClick) {
                            confirmBtn.onClick();
                        }
                    }
                }
            });
        }

        // ⭐ P1-3（2026-10-21 审查）：之前这里把 **document 上的 Enter** 无条件接到「确认」上。
        //   而打开时焦点落在 footer 的第一个按钮（取消），于是「打开确认框 → 按 Enter」
        //   会执行删除/撤销，而不看焦点在哪 —— 误删数据的交互缺陷。
        //   现在：Escape = 取消；Enter 只在输入框（prompt）里 = 确认；按钮上的
        //   Enter/Space 完全交给浏览器原生行为（焦点在「取消」就执行取消）。
        //   另外补 Tab 焦点陷阱（P2-12：弹层焦点不该跑到遮罩后面去）。
        var focusablesIn = function(el) {
            var list = el.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            return Array.prototype.filter.call(list, function(node) {
                return node && !node.disabled && node.getAttribute('aria-hidden') !== 'true';
            });
        };

        var handleKeydown = function(e) {
            if (e.key === 'Escape') {
                var cancelBtn = cfg.buttons.find(function(b) { return b.cls === 'modal-btn-cancel'; });
                if (cancelBtn && cancelBtn.onClick) {
                    e.preventDefault();
                    cancelBtn.onClick();
                }
                return;
            }
            if (e.key === 'Enter') {
                var active = document.activeElement;
                if (active && active.classList && active.classList.contains('modal-input')) {
                    var confirmBtn = cfg.buttons.find(function(b) { return b.cls === 'modal-btn-confirm'; });
                    if (confirmBtn && confirmBtn.onClick) {
                        e.preventDefault();
                        confirmBtn.onClick();
                    }
                }
                return; // 其余 Enter 一律交给按钮自身的原生行为
            }
            if (e.key === 'Tab') {
                var containerEl = container.querySelector('.modal-container');
                if (!containerEl || typeof containerEl.contains !== 'function') return;
                var list = focusablesIn(containerEl);
                if (list.length === 0) return;
                var first = list[0];
                var last = list[list.length - 1];
                var active = document.activeElement;
                var inside = containerEl.contains(active);
                if (e.shiftKey && (!inside || active === first)) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && (!inside || active === last)) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        container._handleKeydown = handleKeydown;
        container._onShow = cfg.onShow;

        return container;
    },

    _showModal: function(modal) {
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        document.addEventListener('keydown', modal._handleKeydown);

        // ⭐ P2 可访问性（2026-10-15 审查）：把焦点移进对话框，关闭后归还 ——
        //    此前键盘用户打开弹窗后焦点仍留在页面按钮上，Tab 会跑到弹窗后面去。
        modal._prevFocus = document.activeElement;
        try {
            var firstBtn = modal.querySelector('.modal-footer .modal-btn');
            var target = firstBtn || modal.querySelector('.modal-container');
            if (target && typeof target.focus === 'function') {
                if (!target.hasAttribute('tabindex') && target === modal.querySelector('.modal-container')) {
                    target.setAttribute('tabindex', '-1');
                }
                target.focus();
            }
        } catch (e) { /* 焦点失败不影响弹窗本身 */ }

        requestAnimationFrame(function() {
            modal.querySelector('.modal-overlay').classList.add('modal-show');
        });

        if (modal._onShow) {
            modal._onShow(modal.querySelector('.modal-container'));
        }
    },

    _closeModal: function(modal) {
        document.removeEventListener('keydown', modal._handleKeydown);

        // ⭐ P2：把焦点还给打开弹窗的那个元素（键盘用户不会"迷路"回页面顶部）
        try {
            var prev = modal && modal._prevFocus;
            if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
        } catch (e) { /* 忽略 */ }

        var overlay = modal.querySelector('.modal-overlay');
        if (overlay) {
            overlay.classList.remove('modal-show');
            overlay.classList.add('modal-hide');
        }

        setTimeout(function() {
            if (modal && modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            var modals = document.querySelectorAll('.modal-wrapper');
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

// ===== 全局挂载 =====
window.Modal = Modal;
