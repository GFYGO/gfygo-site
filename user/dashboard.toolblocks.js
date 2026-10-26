/**
 * dashboard.toolblocks.js
 * 用户工具块树渲染器（ui.* / lowcode 共用）：只按白名单 createElement，
 * 文本一律 textContent，不解析作者 HTML、不执行作者 JS。
 */
var BIND_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

function escapeText(value) {
    return String(value == null ? '' : value);
}

function lookup(ctx, path) {
    var parts = String(path || '').split('.');
    var cur = ctx;
    for (var i = 0; i < parts.length; i++) {
        if (!cur || typeof cur !== 'object') return '';
        cur = cur[parts[i]];
        if (cur === undefined || cur === null) return '';
    }
    return cur;
}

export function bindText(template, ctx) {
    if (typeof template !== 'string') return escapeText(template);
    return template.replace(BIND_RE, function (_m, path) {
        var value = lookup(ctx || {}, path);
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return '';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return String(value);
    });
}

function setStyle(el, props) {
    props = props || {};
    if (props.color) el.style.color = props.color;
    if (props.bg) el.style.backgroundColor = props.bg;
    if (props.size) el.style.fontSize = props.size;
    if (props.bold) el.style.fontWeight = '600';
    if (props.italic) el.style.fontStyle = 'italic';
    if (props.align) el.style.textAlign = props.align;
    if (props.w) el.style.width = props.w;
    if (props.h) el.style.height = props.h;
    if (props.padding) el.style.padding = props.padding;
    if (props.margin) el.style.margin = props.margin;
    if (props.gap) el.style.gap = props.gap;
    if (props.radius) el.style.borderRadius = props.radius;
    if (props.border && props.border !== '0px') {
        el.style.border = props.border + ' solid var(--tool-border, #d0d7de)';
    }
    if (props.dir) el.style.flexDirection = props.dir;
    if (props.justify) {
        el.style.justifyContent = ({
            start: 'flex-start', center: 'center', end: 'flex-end',
            between: 'space-between',
        })[props.justify] || 'flex-start';
    }
    if (props.wrap === false) el.style.flexWrap = 'nowrap';
    if (props.wrap === true) el.style.flexWrap = 'wrap';
}

function container(tag, props, cls) {
    var el = document.createElement(tag);
    el.className = cls || 'toolblock';
    el.style.display = 'flex';
    el.style.boxSizing = 'border-box';
    if (tag !== 'FORM') el.style.flexDirection = 'row';
    setStyle(el, props);
    return el;
}

function textEl(template, props) {
    var el = document.createElement('div');
    el.className = 'toolblock toolblock--text';
    el.setAttribute('data-tool-bind-template', String(template || ''));
    el.textContent = '';
    setStyle(el, props);
    return el;
}

function renderInlineMarkdown(text) {
    // 极简安全 markdown：只生成文本 + 少量元素，不解析原始 HTML。
    var frag = document.createDocumentFragment();
    var pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60)/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        var token = match[0];
        if (token.indexOf('**') === 0) {
            var b = document.createElement('strong');
            b.textContent = token.slice(2, -2);
            frag.appendChild(b);
        } else if (token.charAt(0) === '\x60') {
            var c = document.createElement('code');
            c.textContent = token.slice(1, -1);
            frag.appendChild(c);
        } else {
            var i = document.createElement('em');
            i.textContent = token.slice(1, -1);
            frag.appendChild(i);
        }
        last = pattern.lastIndex;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
}

function renderMarkdown(text) {
    var root = document.createElement('div');
    root.className = 'toolblock toolblock--md';
    var lines = String(text || '').split(/\r?\n/);
    var code = [];
    var inCode = false;
    var list = null;
    function flushList() {
        if (list) { root.appendChild(list); list = null; }
    }
    lines.forEach(function (line) {
        if (/^\x60\x60\x60/.test(line)) {
            if (inCode) {
                var pre = document.createElement('pre');
                var codeEl = document.createElement('code');
                codeEl.textContent = code.join('\n');
                pre.appendChild(codeEl);
                root.appendChild(pre);
                code = [];
                inCode = false;
            } else {
                flushList();
                inCode = true;
            }
            return;
        }
        if (inCode) { code.push(line); return; }
        var m = line.match(/^(#{1,6})\s+(.*)$/);
        if (m) {
            flushList();
            var h = document.createElement('h' + m[1].length);
            h.appendChild(renderInlineMarkdown(m[2]));
            root.appendChild(h);
            return;
        }
        if (/^>\s?/.test(line)) {
            flushList();
            var q = document.createElement('blockquote');
            q.appendChild(renderInlineMarkdown(line.replace(/^>\s?/, '')));
            root.appendChild(q);
            return;
        }
        if (/^[-*]\s+/.test(line)) {
            if (!list) list = document.createElement('ul');
            var li = document.createElement('li');
            li.appendChild(renderInlineMarkdown(line.replace(/^[-*]\s+/, '')));
            list.appendChild(li);
            return;
        }
        if (!line.trim()) { flushList(); return; }
        flushList();
        var p = document.createElement('p');
        p.appendChild(renderInlineMarkdown(line));
        root.appendChild(p);
    });
    if (inCode && code.length) {
        var pre2 = document.createElement('pre');
        var codeEl2 = document.createElement('code');
        codeEl2.textContent = code.join('\n');
        pre2.appendChild(codeEl2);
        root.appendChild(pre2);
    }
    flushList();
    return root;
}

function renderNode(node, ctx) {
    if (!node || typeof node !== 'object') return null;
    var type = node.type;
    var props = node.props || {};
    var children = node.children || [];
    var el;
    if (type === 'txt_block') {
        el = textEl(props.text, props);
    } else if (type === 'md_block') {
        el = renderMarkdown(props.text);
        setStyle(el, props);
    } else if (type === 'button') {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'toolblock toolblock--button';
        el.setAttribute('data-tool-action', props.action || '');
        setStyle(el, props);
        var label = children.length ? children[0] : null;
        var labelText = label ? (label.props || {}).text : '';
        el.setAttribute('data-tool-bind-template', String(labelText || ''));
        el.textContent = '';
        if (!props.size && !props.color) {
            el.style.color = '#fff';
            el.style.backgroundColor = 'var(--color-primary, #2563eb)';
            el.style.border = 'none';
            el.style.borderRadius = '6px';
            el.style.padding = '6px 12px';
            el.style.cursor = 'pointer';
        }
    } else if (type === 'input') {
        el = document.createElement('input');
        el.className = 'toolblock toolblock--input';
        el.type = props.type || 'text';
        el.name = props.name || '';
        el.id = 'tool-input-' + (props.name || '');
        el.setAttribute('data-tool-input', props.name || '');
        if (props.placeholder) el.placeholder = props.placeholder;
        if (props.value !== undefined) el.value = props.value;
        if (props.disabled) el.disabled = true;
        setStyle(el, props);
    } else if (type === 'form' || type === 'list' || type === 'frame' || type === 'block') {
        el = container('div', props, 'toolblock toolblock--' + type);
        if (type === 'list' && props.cols) {
            el.style.display = 'grid';
            el.style.gridTemplateColumns = 'repeat(' + Math.max(1, Math.min(6, Number(props.cols) || 1)) + ', minmax(0, 1fr))';
        }
        if (type === 'frame') {
            el.style.overflow = props.scroll === false ? 'hidden' : 'auto';
        }
        children.forEach(function (child) {
            var childEl = renderNode(child, ctx);
            if (childEl) el.appendChild(childEl);
        });
    } else if (type === 'bin_block') {
        el = document.createElement('div');
        el.className = 'toolblock toolblock--bin';
        el.textContent = '（二进制数据暂不支持预览）';
        setStyle(el, props);
    } else {
        el = document.createElement('div');
        el.className = 'toolblock toolblock--unknown';
        el.textContent = '（未知块：' + escapeText(type) + '）';
    }
    return el;
}

export function renderBlocks(container, blocks, ctx) {
    if (!container) return;
    container.textContent = '';
    (blocks || []).forEach(function (node) {
        var el = renderNode(node, ctx || {});
        if (el) container.appendChild(el);
    });
    updateBindings(container, ctx || {});
}

export function updateBindings(root, ctx) {
    if (!root) return;
    var nodes = root.querySelectorAll('[data-tool-bind-template]');
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var template = el.getAttribute('data-tool-bind-template') || '';
        el.textContent = bindText(template, ctx || {});
    }
}

export function collectInputs(root) {
    var out = {};
    if (!root) return out;
    var nodes = root.querySelectorAll('[data-tool-input]');
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var name = el.getAttribute('data-tool-input');
        if (!name) continue;
        if (el.type === 'checkbox') out[name] = !!el.checked;
        else if (el.type === 'number') out[name] = el.value === '' ? null : Number(el.value);
        else out[name] = el.value;
    }
    return out;
}

export function collectConfig(root) {
    var out = {};
    if (!root) return out;
    var nodes = root.querySelectorAll('[data-tool-config-key]');
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var key = el.getAttribute('data-tool-config-key');
        if (!key) continue;
        if (el.type === 'checkbox') out[key] = !!el.checked;
        else if (el.type === 'number') out[key] = el.value === '' ? 0 : Number(el.value);
        else out[key] = el.value;
    }
    return out;
}

export default { renderBlocks, updateBindings, collectInputs, collectConfig, bindText };
