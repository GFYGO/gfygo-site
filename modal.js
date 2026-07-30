/**
 * Modal - 自定义弹窗组件
 * 替换原生 confirm 和 prompt，不改变任何功能逻辑
 */

const Modal = {
  /**
   * 显示确认对话框（替换 confirm）
   * @param {string} message - 提示消息
   * @param {object} options - 可选配置 { title, confirmText, cancelText }
   * @returns {Promise<boolean>} - 返回用户选择结果
   */
  confirm(message, options = {}) {
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

  /**
   * 显示输入对话框（替换 prompt）
   * @param {string} message - 提示消息
   * @param {string} defaultValue - 默认值
   * @param {object} options - 可选配置 { title, confirmText, cancelText, placeholder, inputType }
   * @returns {Promise<string|null>} - 返回用户输入值或 null
   */
  prompt(message, defaultValue = '', options = {}) {
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
          // 自动聚焦输入框并选中默认值
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

  /**
   * 显示警告对话框（替换 alert）
   * @param {string} message - 提示消息
   * @param {object} options - 可选配置 { title, confirmText }
   * @returns {Promise<void>}
   */
  alert(message, options = {}) {
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

  /**
   * 创建弹窗 DOM 结构
   * @private
   */
  _createModal({ title, content, buttons, onShow }) {
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

    // 绑定按钮事件
    buttons.forEach((btn, index) => {
      const btnEl = container.querySelector(`button[data-index="${index}"]`);
      if (btnEl && btn.onClick) {
        btnEl.addEventListener('click', btn.onClick);
      }
    });

    // 点击遮罩层关闭（等同于取消）
    const overlay = container.querySelector('.modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          // 查找取消按钮并触发
          const cancelBtn = buttons.find(b => b.class === 'modal-btn-cancel');
          if (cancelBtn && cancelBtn.onClick) {
            cancelBtn.onClick();
          } else {
            // 如果没有取消按钮，点击确认按钮
            const confirmBtn = buttons.find(b => b.class === 'modal-btn-confirm');
            if (confirmBtn && confirmBtn.onClick) {
              confirmBtn.onClick();
            }
          }
        }
      });
    }

    // 键盘事件处理
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        // ESC 键触发取消
        const cancelBtn = buttons.find(b => b.class === 'modal-btn-cancel');
        if (cancelBtn && cancelBtn.onClick) {
          cancelBtn.onClick();
        }
      } else if (e.key === 'Enter') {
        // Enter 键触发确认
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

  /**
   * 显示弹窗
   * @private
   */
  _showModal(modal) {
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    // 添加键盘监听
    document.addEventListener('keydown', modal._handleKeydown);

    // 触发动画
    requestAnimationFrame(() => {
      modal.querySelector('.modal-overlay').classList.add('modal-show');
    });

    // 执行 onShow 回调
    if (modal._onShow) {
      modal._onShow(modal.querySelector('.modal-container'));
    }
  },

  /**
   * 关闭弹窗
   * @private
   */
  _closeModal(modal) {
    // 移除键盘监听
    document.removeEventListener('keydown', modal._handleKeydown);

    // 触发关闭动画
    const overlay = modal.querySelector('.modal-overlay');
    if (overlay) {
      overlay.classList.remove('modal-show');
      overlay.classList.add('modal-hide');
    }

    // 动画结束后移除 DOM
    setTimeout(() => {
      if (modal && modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
      // 检查是否还有其他弹窗
      const modals = document.querySelectorAll('.modal-wrapper');
      if (modals.length === 0) {
        document.body.style.overflow = '';
      }
    }, 200);
  },

  /**
   * HTML 转义
   * @private
   */
  _escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// 全局导出
window.Modal = Modal;