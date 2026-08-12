/**
 * utils.js
 * 通用工具函数：DOM 操作、Toast 封装、HTML 转义等
 * 共享模块：所有页面以普通 <script> 加载
 */

function $(id) {
    return document.getElementById(id);
}

function $$(selector, container) {
    return (container || document).querySelectorAll(selector);
}

function on(el, event, handler, opts) {
    if (el) el.addEventListener(event, handler, opts);
}

function createEl(tag, props) {
    props = props || {};
    const el = document.createElement(tag);
    for (const key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        const val = props[key];
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

function setBtnState(btn, loading, originalText) {
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        if (originalText) btn.textContent = originalText;
    } else {
        btn.disabled = false;
    }
}

function showToast(msg, type) {
    if (typeof Toast !== 'undefined' && Toast.show) {
        Toast.show(msg, type || 'info');
    }
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

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

// ===== 全局挂载 =====
window.$ = $;
window.$$ = $$;
window.on = on;
window.createEl = createEl;
window.setBtnState = setBtnState;
window.showToast = showToast;
window.escapeHtml = escapeHtml;
window.fallbackCopy = fallbackCopy;
