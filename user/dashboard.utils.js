/**
 * dashboard.utils.js
 * 通用工具函数：DOM 操作、Toast 封装、HTML 转义等
 */

/** 简化 document.getElementById */
function $(id) {
    return document.getElementById(id);
}

/** 简化 querySelectorAll */
function $$(selector, container = document) {
    return container.querySelectorAll(selector);
}

/** 简化 addEventListener */
function on(el, event, handler, opts) {
    if (el) el.addEventListener(event, handler, opts);
}

/** 创建 DOM 元素并设置属性/事件 */
function createEl(tag, props = {}) {
    const el = document.createElement(tag);
    for (const [key, val] of Object.entries(props)) {
        if (key === 'class') el.className = val;
        else if (key === 'html') el.innerHTML = val;
        else if (key === 'text') el.textContent = val;
        else if (key.startsWith('on') && typeof val === 'function') {
            el.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (val !== undefined && val !== null) {
            el.setAttribute(key, val);
        }
    }
    return el;
}

/** 统一按钮 loading 状态管理 */
function setBtnState(btn, loading, originalText) {
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        if (originalText) btn.textContent = originalText;
    } else {
        btn.disabled = false;
    }
}

/** 封装 Toast 调用（兼容 undefined） */
function showToast(msg, type) {
    if (typeof Toast !== 'undefined' && Toast.show) {
        Toast.show(msg, type || 'info');
    }
}

/** HTML 转义 */
function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/** 兼容旧浏览器的复制方案 */
function fallbackCopy(text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (e) {
        return false;
    }
}
