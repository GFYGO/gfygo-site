/**
 * js/modules/shared.js
 * GFYGO 前端模块化（Web Components）公共层：
 *   - 统一转义 / 请求 / Toast 小工具
 *   - 卡片(card) / 内嵌(inline) 两种形态的基类
 *   - 安全迷你 Markdown 渲染器（不执行原始 HTML）
 *
 * 约束：纯静态站、无构建；组件全部走 Shadow DOM，样式不外溢。
 */

export function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

/** 统一请求入口：优先复用站点共享的 window.apiRequest（自带 JWT / 401 跳登录）。 */
export function api(path, options) {
    if (typeof window.apiRequest !== 'function') {
        return Promise.resolve(null);
    }
    return window.apiRequest(path, options || {});
}

export function toast(message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type || 'info');
}

export function injectStyles(root, css) {
    var style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
}

export function debounce(fn, wait) {
    var timer = null;
    return function () {
        var args = arguments, self = this;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(self, args); }, wait || 250);
    };
}

/** 模块中文名（权限节点 / 文档列表共用） */
export function moduleLabel(module) {
    var map = {
        doc: '文档', admin: '管理端', user: '用户', org: '组织', group: '组',
        menu: '菜单/页面', tool: '工具', ai: 'AI', notify: '通知', system: '系统',
    };
    return map[module] || module || '其他';
}

/**
 * 安全迷你 Markdown：先整体转义，再解析标题/列表/引用/代码/行内样式/链接。
 * 不输出任何原始 HTML；图片降级为说明文字；链接仅放行 http(s)/站内相对地址。
 */
export function renderMarkdown(source) {
    var text = String(source || '').replace(/\r\n?/g, '\n');
    var codeBlocks = [];
    text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, function (m, code) {
        codeBlocks.push('<pre><code>' + esc(code) + '</code></pre>');
        return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
    });
    text = esc(text);

    function inline(t) {
        var out = t.replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; });
        out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, function (m, alt) {
            return '<span class="md-img-alt">[图片' + (alt ? '：' + alt : '') + ']</span>';
        });
        out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
            if (!/^(https?:\/\/|\/|\.\.?\/|#)/i.test(url)) return label;
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
        });
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        return out;
    }

    var lines = text.split('\n');
    var html = [];
    var i = 0;
    while (i < lines.length) {
        var line = lines[i];
        if (/^\u0000CB\d+\u0000$/.test(line)) {
            html.push(codeBlocks[parseInt(line.slice(3, -1), 10)] || '');
            i++; continue;
        }
        if (!line.trim()) { i++; continue; }
        var h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) { html.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
        if (/^\s*([-*_])\s*\1\s*\1[\s\S]*$/.test(line)) { html.push('<hr>'); i++; continue; }
        if (/^\s*>/.test(line)) {
            var quote = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
            html.push('<blockquote>' + inline(quote.join(' ')) + '</blockquote>');
            continue;
        }
        if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
            var ordered = /^\s*\d+[.)]\s+/.test(line);
            var items = [];
            while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')); i++;
            }
            var tag = ordered ? 'ol' : 'ul';
            html.push('<' + tag + '>' + items.map(function (it) { return '<li>' + inline(it) + '</li>'; }).join('') + '</' + tag + '>');
            continue;
        }
        var para = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*([-*+]|\d+[.)])\s+|\u0000CB\d+\u0000$)/.test(lines[i])) {
            para.push(lines[i]); i++;
        }
        if (para.length) html.push('<p>' + inline(para.join(' ')) + '</p>');
        else i++;
    }
    return html.join('\n');
}

/** 组件基类：统一 Shadow DOM、mode=card|inline、幂等渲染入口。 */
export class GfyElement extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._rendered = false;
    }

    get mode() {
        return this.getAttribute('mode') === 'inline' ? 'inline' : 'card';
    }

    get isInline() { return this.mode === 'inline'; }

    connectedCallback() {
        if (this._rendered) return;
        this._rendered = true;
        Promise.resolve(this.render()).catch(function (err) {
            console.error('[gfy-module] 渲染失败:', err);
        });
    }

    render() {}
}

export const BASE_CSS = `
:host{display:block;color:var(--color-text,#064e3b);line-height:1.6;font-size:14px}
*{box-sizing:border-box}
button{font-family:inherit;font-size:13px;cursor:pointer}
.gfy-card{background:var(--color-bg-white,#fff);border:1px solid var(--color-border,#a7f3d0);border-radius:var(--radius-lg,16px);box-shadow:var(--shadow-sm,0 1px 3px rgba(0,0,0,.06));overflow:hidden}
:host([mode="inline"]) .gfy-card{border:0;box-shadow:none;background:transparent;border-radius:0}
.gfy-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--color-border,#a7f3d0);background:var(--color-bg-secondary,#f0fdf4)}
:host([mode="inline"]) .gfy-head{background:transparent;padding-left:0;padding-right:0}
.gfy-title{font-weight:700;font-size:15px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gfy-body{padding:14px}
:host([mode="inline"]) .gfy-body{padding:8px 0}
.gfy-muted{color:var(--color-text-muted,#036b4d);font-size:12px}
.gfy-btn{border:1px solid var(--color-border,#a7f3d0);background:var(--color-bg-white,#fff);color:inherit;border-radius:var(--radius-sm,6px);padding:5px 10px}
.gfy-btn:hover{background:var(--color-bg-hover,rgba(0,0,0,.04))}
.gfy-btn[disabled]{opacity:.5;cursor:not-allowed}
.gfy-btn--primary{background:var(--color-primary,#10b981);border-color:var(--color-primary,#10b981);color:#fff}
.gfy-input{width:100%;padding:7px 10px;border:1px solid var(--color-border,#a7f3d0);border-radius:var(--radius-sm,6px);background:var(--color-bg-white,#fff);color:inherit;font-family:inherit;font-size:13px}
.gfy-input:focus{outline:2px solid var(--color-primary,#10b981);outline-offset:1px}
.gfy-error{padding:12px;border:1px dashed var(--color-danger,#b91c1c);border-radius:var(--radius-md,8px);color:var(--color-danger,#b91c1c);font-size:13px}
.gfy-empty{padding:18px;text-align:center;color:var(--color-text-muted,#036b4d);font-size:13px}
.gfy-skel{height:12px;border-radius:6px;background:var(--color-bg-secondary,#f0fdf4);margin:8px 0;animation:gfyPulse 1.2s ease-in-out infinite}
@keyframes gfyPulse{0%,100%{opacity:.55}50%{opacity:1}}
.md{font-size:14px;line-height:1.75;overflow-wrap:anywhere}
.md h1,.md h2,.md h3,.md h4{line-height:1.3;margin:1.1em 0 .5em}
.md h1{font-size:1.5em}.md h2{font-size:1.3em}.md h3{font-size:1.15em}
.md p{margin:.6em 0}
.md ul,.md ol{margin:.6em 0;padding-left:1.5em}
.md blockquote{margin:.8em 0;padding:.4em .9em;border-left:3px solid var(--color-primary,#10b981);background:var(--color-bg-secondary,#f0fdf4);color:var(--color-text-muted,#036b4d)}
.md pre{overflow:auto;padding:10px 12px;border-radius:var(--radius-md,8px);background:var(--color-bg-secondary,#f0fdf4);font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
.md code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;background:var(--color-bg-secondary,#f0fdf4);padding:1px 4px;border-radius:4px}
.md pre code{background:transparent;padding:0}
.md a{color:var(--color-primary,#059669)}
.md hr{border:0;border-top:1px solid var(--color-border,#a7f3d0);margin:1.2em 0}
.md .md-img-alt{color:var(--color-text-muted,#036b4d);font-style:italic}
`;
