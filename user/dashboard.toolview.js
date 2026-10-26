/**
 * dashboard.toolview.js
 * 用户工具面板：Shadow DOM 挂载、custom/lua/none 三种渲染、动作调用与结果渲染。
 *
 * 安全边界：
 *   * custom 先 sanitizeToolHtml/Css，再挂 Shadow DOM；
 *   * lua/lowcode 只按块白名单 createElement，文本 textContent；
 *   * 任何模式都不执行作者 JS、不 eval、不 new Function。
 */
import {
    renderBlocks, updateBindings, collectInputs, collectConfig,
} from './dashboard.toolblocks.js';

var BASE_CSS = [
    ':host{display:block;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--tool-fg,#1f2328);}',
    '.toolview{padding:16px;max-width:100%;box-sizing:border-box;}',
    '.toolview__head{display:flex;align-items:center;gap:8px;margin-bottom:12px;}',
    '.toolview__title{font-size:18px;font-weight:600;}',
    '.toolview__ver{font-size:12px;opacity:.65;}',
    '.toolview__status{font-size:12px;opacity:.8;min-height:1.4em;}',
    '.toolview__status--error{color:#b42318;}',
    '.toolview__output{margin-top:8px;max-width:100%;overflow:auto;}',
    '.toolview__output pre,.toolview__output table{font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;}',
    '.toolview__output table{border-collapse:collapse;width:100%;}',
    '.toolview__output th,.toolview__output td{border:1px solid var(--tool-border,#d0d7de);padding:4px 8px;text-align:left;vertical-align:top;}',
    '.toolview button,.toolview input,.toolview select,.toolview textarea{font:inherit;}',
    '.toolview button{cursor:pointer;}',
    '.toolview input,.toolview select,.toolview textarea{padding:4px 8px;border:1px solid var(--tool-border,#d0d7de);border-radius:4px;background:var(--tool-bg,#fff);color:inherit;}',
    '.toolview table{border-collapse:collapse;}',
    '.toolview th,.toolview td{border:1px solid var(--tool-border,#d0d7de);padding:4px 8px;}',
    '.toolview__config{margin-top:12px;border-top:1px dashed var(--tool-border,#d0d7de);padding-top:8px;}',
    '.toolview__config-row{display:flex;align-items:center;gap:8px;margin:4px 0;}',
    '.toolview__config-row label{min-width:8em;}',
    '.toolview__cli{background:var(--tool-bg,#fff);border:1px solid var(--tool-border,#d0d7de);border-radius:6px;padding:12px;}',
    '.toolview__cli-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}',
    '.toolview__cli-output{background:#0d1117;color:#e6edf3;padding:8px;border-radius:4px;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Consolas,monospace;}',
    '.toolblock{box-sizing:border-box;}',
    '.toolblock--button{border:0;}',
    '.toolblock--md h1,.toolblock--md h2,.toolblock--md h3{margin:.4em 0;}',
    '.toolblock--md pre{background:rgba(127,127,127,.12);padding:8px;overflow:auto;}',
    '.toolblock--md blockquote{border-left:3px solid var(--tool-border,#d0d7de);margin:.4em 0;padding-left:8px;opacity:.9;}',
].join('');

function text(value) {
    return String(value == null ? '' : value);
}

function el(tag, cls, value) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = text(value);
    return node;
}

function actionSpec(payload, name) {
    var actions = (payload.manifest && payload.manifest.actions) || [];
    for (var i = 0; i < actions.length; i++) {
        if (actions[i] && actions[i].name === name) return actions[i];
    }
    return null;
}

function convertInput(spec, raw) {
    // 与服务端同一口径的轻量转换；失败返回 {error}
    if (!spec) return { value: raw };
    var typ = spec.type;
    try {
        if (typ === 'int') {
            if (raw === null || raw === undefined || raw === '') return { error: '必填' };
            var n = Number(raw);
            if (!Number.isInteger(n)) return { error: '必须是整数' };
            if (spec.min !== undefined && n < spec.min) return { error: '不能小于 ' + spec.min };
            if (spec.max !== undefined && n > spec.max) return { error: '不能大于 ' + spec.max };
            return { value: n };
        }
        if (typ === 'number') {
            if (raw === null || raw === undefined || raw === '') return { error: '必填' };
            var f = Number(raw);
            if (!Number.isFinite(f)) return { error: '必须是数字' };
            return { value: f };
        }
        if (typ === 'boolean') return { value: raw === true || raw === 'true' || raw === '1' };
        if (typ === 'enum') {
            if ((spec.enum || []).indexOf(raw) === -1) return { error: '值不在允许范围' };
            return { value: raw };
        }
        var s = text(raw);
        if (spec.max_length !== undefined && s.length > spec.max_length) return { error: '长度超限' };
        if (spec.min_length !== undefined && s.length < spec.min_length) return { error: '长度不足' };
        return { value: s };
    } catch (e) {
        return { error: '输入不合法' };
    }
}

function parseArgValue(raw, root) {
    var value = String(raw || '').trim();
    if (value.indexOf('literal:') === 0) return value.slice(8);
    if (value.indexOf('input#') === 0) {
        var id = value.slice(6);
        var node = root.getElementById ? root.getElementById(id) : root.querySelector('#' + cssEscape(id));
        if (!node) return '';
        if (node.type === 'checkbox') return !!node.checked;
        return node.value;
    }
    if (value.indexOf('config:') === 0) {
        var key = value.slice(7);
        var cfg = root.querySelector('[data-tool-config-key="' + cssEscape(key) + '"]');
        if (!cfg) return '';
        if (cfg.type === 'checkbox') return !!cfg.checked;
        return cfg.value;
    }
    return value;
}

function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
}

function parseArgs(spec, root) {
    var out = {};
    if (!spec) return out;
    String(spec).split(',').forEach(function (part) {
        part = part.trim();
        if (!part) return;
        var idx = part.indexOf(':');
        if (idx < 0) return;
        var key = part.slice(0, idx).trim();
        var raw = part.slice(idx + 1).trim();
        if (key) out[key] = parseArgValue(raw, root);
    });
    return out;
}

function makeTable(rows, labels) {
    var table = el('table');
    var tbody = el('tbody');
    rows.forEach(function (row) {
        var tr = el('tr');
        var th = el('th', '', labels && labels[row[0]] ? labels[row[0]] : row[0]);
        var td = el('td', '', row[1]);
        tr.appendChild(th);
        tr.appendChild(td);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
}

function renderResult(target, result) {
    if (!target) return;
    target.textContent = '';
    if (!result) return;
    var render = result.render;
    var data = result.data;
    if (result.title) {
        target.appendChild(el('div', 'toolview__result-title', result.title));
    }
    if (render === 'fields' && data && typeof data === 'object' && !Array.isArray(data)) {
        var rows = Object.keys(data).map(function (key) { return [key, data[key]]; });
        target.appendChild(makeTable(rows, result.labels || {}));
        return;
    }
    if (render === 'table' && Array.isArray(data)) {
        if (!data.length) {
            target.appendChild(el('p', '', '（空）'));
            return;
        }
        var table = el('table');
        var thead = el('thead');
        var headRow = el('tr');
        Object.keys(data[0] || {}).forEach(function (key) {
            headRow.appendChild(el('th', '', key));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = el('tbody');
        data.forEach(function (row) {
            var tr = el('tr');
            Object.keys(data[0] || {}).forEach(function (key) {
                tr.appendChild(el('td', '', row[key]));
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        target.appendChild(table);
        return;
    }
    if (render === 'text' && typeof data === 'string') {
        var pre = el('pre', '', data);
        target.appendChild(pre);
        return;
    }
    var json = data;
    try {
        json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } catch (e) {
        json = text(data);
    }
    target.appendChild(el('pre', '', json));
}

function makeConfigField(field, current) {
    var row = el('div', 'toolview__config-row');
    var label = el('label', '', field.label || field.key);
    label.setAttribute('for', 'tool-cfg-' + field.key);
    row.appendChild(label);
    var typ = field.type;
    var value = current != null ? current : field.default;
    var input;
    if (typ === 'boolean') {
        input = el('input');
        input.type = 'checkbox';
        input.checked = !!value;
    } else if (typ === 'number') {
        input = el('input');
        input.type = 'number';
        input.value = value == null ? '' : value;
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
    } else if (typ === 'select' && Array.isArray(field.options)) {
        input = el('select');
        field.options.forEach(function (opt) {
            var o = el('option', '', opt.label || opt.value || opt);
            o.value = opt.value != null ? opt.value : opt;
            if (o.value === value) o.selected = true;
            input.appendChild(o);
        });
    } else if (typ === 'multiselect' && Array.isArray(field.options)) {
        input = el('select');
        input.multiple = true;
        field.options.forEach(function (opt) {
            var o = el('option', '', opt.label || opt.value || opt);
            o.value = opt.value != null ? opt.value : opt;
            if (Array.isArray(value) && value.indexOf(o.value) !== -1) o.selected = true;
            input.appendChild(o);
        });
    } else if (typ === 'text') {
        input = el('textarea');
        input.rows = 3;
        input.value = value == null ? '' : value;
    } else {
        input = el('input');
        input.type = typ === 'color' ? 'color' : typ === 'date' ? 'date' : 'text';
        input.value = value == null ? '' : value;
    }
    input.id = 'tool-cfg-' + field.key;
    input.setAttribute('data-tool-config-key', field.key);
    input.setAttribute('data-tool-field-type', typ || 'string');
    row.appendChild(input);
    return row;
}

function mountConfig(root, payload) {
    var schema = (payload.manifest && payload.manifest.config_schema) || [];
    if (!schema.length) return;
    var form = root.querySelector('[data-tool-config]');
    if (!form) {
        var details = el('details', 'toolview__config');
        details.appendChild(el('summary', '', '配置'));
        var box = el('div');
        form = box;
        details.appendChild(box);
        var host = root.querySelector('.toolview');
        if (host) host.appendChild(details);
    } else {
        form.textContent = '';
    }
    schema.forEach(function (field) {
        if (!field || !field.key) return;
        if (field.user_editable === false) return;
        form.appendChild(makeConfigField(field, payload.config ? payload.config[field.key] : undefined));
    });
}

function buildCtx(payload) {
    return {
        input: {},
        result: {},
        config: payload.config || {},
        user: payload.user || {},
        state: {},
        now: '',
    };
}

function runAction(payload, action, root, state) {
    var spec = actionSpec(payload, action);
    if (!spec) {
        setStatus(state, '动作不存在', true);
        return Promise.resolve();
    }
    var button = root.querySelector('[data-tool-action="' + cssEscape(action) + '"]');
    var args = button ? parseArgs(button.getAttribute('data-tool-arg'), root) : {};
    var all = collectInputs(root);
    var input = {};
    var rules = spec.input || {};
    var invalid = false;
    Object.keys(rules).forEach(function (key) {
        if (args[key] !== undefined) input[key] = args[key];
        else if (all[key] !== undefined) input[key] = all[key];
        var missing = input[key] === undefined || input[key] === null || input[key] === '';
        if (missing && !rules[key].required) {
            if (rules[key].type === 'boolean') input[key] = false;
            return;
        }
        var converted = convertInput(rules[key], input[key]);
        if (converted.error) {
            setStatus(state, (rules[key].label || key) + '：' + converted.error, true);
            invalid = true;
            return;
        }
        input[key] = converted.value;
    });
    if (invalid) return Promise.resolve();
    var config = Object.assign({}, payload.config || {}, collectConfig(root));
    setStatus(state, '运行中…', false);
    if (button) button.disabled = true;
    var url = '/api/v0/tool/' + payload.id + '/run/' + encodeURIComponent(action)
        + (payload.draft ? '?preview=1' : '');
    return window.apiRequest(url, { method: 'POST', body: { input: input, config: config }, silent: true })
        .then(function (res) {
            if (button) button.disabled = false;
            if (!res) {
                setStatus(state, '网络异常', true);
                return;
            }
            if (res.code !== 200) {
                setStatus(state, (res.msg || '执行失败'), true);
                return;
            }
            var result = res.data || {};
            state.ctx.input = input;
            state.ctx.result = (result.render === 'fields' || result.render === 'table')
                ? (result.data || {}) : { data: result.data };
            var target = root.querySelector('[data-tool-out="' + cssEscape(action) + '"]')
                || root.querySelector('.toolview__output');
            renderResult(target, result);
            updateBindings(root, state.ctx);
            setStatus(state, '成功 ' + (result.duration_ms || 0) + 'ms' + (result.truncated ? '（已截断）' : ''), false);
        })
        .catch(function (err) {
            if (button) button.disabled = false;
            if (err && err.message === 'input_invalid') return;
            setStatus(state, '执行失败', true);
        });
}

function setStatus(state, msg, isError) {
    state.status.textContent = msg || '';
    state.status.classList.toggle('toolview__status--error', !!isError);
}

function renderCustom(root, payload, state) {
    var html = '';
    var css = '';
    try {
        html = window.sanitizeToolHtml ? window.sanitizeToolHtml(payload.html || '') : '';
        css = window.sanitizeToolCss ? window.sanitizeToolCss(payload.css || '') : '';
    } catch (e) {
        html = '';
        css = '';
    }
    var style = document.createElement('style');
    style.textContent = BASE_CSS + '\n' + css;
    root.appendChild(style);
    var host = el('div', 'toolview');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', (payload.name || '工具') + '（工具）');
    var head = el('div', 'toolview__head');
    head.appendChild(el('span', 'toolview__title', payload.name || '工具'));
    head.appendChild(el('span', 'toolview__ver', 'v' + (payload.version || '')));
    host.appendChild(head);
    var content = el('div', 'toolview__content');
    content.innerHTML = html; // 已净化
    // 作者 HTML 里的 form 只用于 data-tool-config；永远不产生提交行为
    var forms = content.querySelectorAll('form');
    for (var fi = 0; fi < forms.length; fi++) {
        forms[fi].addEventListener('submit', function (ev) { ev.preventDefault(); });
    }
    host.appendChild(content);
    var statusEl = content.querySelector('[data-tool-status]');
    if (!statusEl) {
        statusEl = el('p', 'toolview__status');
        host.appendChild(statusEl);
    }
    if (!content.querySelector('[data-tool-out]')) {
        var outEl = el('div', 'toolview__output');
        host.appendChild(outEl);
    }
    root.appendChild(host);
    state.status = statusEl;
    mountConfig(host, payload);
    return host;
}

function renderLua(root, payload, state) {
    var style = document.createElement('style');
    style.textContent = BASE_CSS;
    root.appendChild(style);
    var host = el('div', 'toolview');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', (payload.name || '工具') + '（工具）');
    var head = el('div', 'toolview__head');
    head.appendChild(el('span', 'toolview__title', payload.name || '工具'));
    head.appendChild(el('span', 'toolview__ver', 'v' + (payload.version || '')));
    host.appendChild(head);
    var blocks = el('div', 'toolview__blocks');
    host.appendChild(blocks);
    host.appendChild(el('p', 'toolview__status'));
    host.appendChild(el('div', 'toolview__output'));
    root.appendChild(host);
    state.status = host.querySelector('.toolview__status');
    try {
        renderBlocks(blocks, payload.ui_tree || [], state.ctx);
    } catch (e) {
        // 块渲染失败 → 降级命令行样式
        root.textContent = '';
        return renderNone(root, payload, state);
    }
    mountConfig(host, payload);
    return host;
}

function renderNone(root, payload, state) {
    var style = document.createElement('style');
    style.textContent = BASE_CSS;
    root.appendChild(style);
    var host = el('div', 'toolview');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', (payload.name || '工具') + '（工具）');
    var cli = el('div', 'toolview__cli');
    var head = el('div', 'toolview__cli-head');
    head.appendChild(el('span', 'toolview__title', (payload.name || '工具') + ' v' + (payload.version || '')));
    cli.appendChild(head);
    var actions = (payload.manifest && payload.manifest.actions) || [];
    var status = el('p', 'toolview__status');
    var output = el('pre', 'toolview__cli-output');
    actions.forEach(function (action) {
        var box = el('div', 'toolview__cli-action');
        box.appendChild(el('div', '', '$ ' + (action.title || action.name)));
        var rules = action.input || {};
        Object.keys(rules).forEach(function (key) {
            var rule = rules[key] || {};
            var wrap = el('div', 'toolview__config-row');
            wrap.appendChild(el('label', '', rule.label || key));
            var input = el('input');
            input.type = rule.type === 'int' || rule.type === 'number' ? 'number' : 'text';
            input.setAttribute('data-tool-input', key);
            input.placeholder = rule.placeholder || '';
            wrap.appendChild(input);
            box.appendChild(wrap);
        });
        var button = el('button', '', '运行');
        button.type = 'button';
        button.setAttribute('data-tool-action', action.name);
        box.appendChild(button);
        var out = el('div', 'toolview__output');
        out.setAttribute('data-tool-out', action.name);
        box.appendChild(out);
        cli.appendChild(box);
    });
    cli.appendChild(status);
    cli.appendChild(output);
    host.appendChild(cli);
    root.appendChild(host);
    state.status = status;
    state.output = output;
    mountConfig(host, payload);
    return host;
}

export function mount(container, payload) {
    if (!container) throw new Error('container required');
    payload = payload || {};
    container.textContent = '';
    var root = container;
    var shadow = null;
    var hostEl = container;
    if (container.attachShadow) {
        // 同一容器可能被重复 mount（切 tab / 刷新预览）；open shadow root 可复用
        shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
        shadow.textContent = '';
        root = shadow;
    }
    var state = { status: null, ctx: buildCtx(payload), disposed: false };
    var content;
    if (payload.ui_mode === 'custom') content = renderCustom(root, payload, state);
    else if (payload.ui_mode === 'lua') content = renderLua(root, payload, state);
    else content = renderNone(root, payload, state);

    var onClick = function (event) {
        if (state.disposed) return;
        var path = event.composedPath ? event.composedPath() : [event.target];
        var button = null;
        for (var i = 0; i < path.length; i++) {
            var node = path[i];
            if (node && node.getAttribute && node.getAttribute('data-tool-action')) {
                button = node;
                break;
            }
        }
        if (!button) return;
        event.preventDefault();
        var action = button.getAttribute('data-tool-action');
        runAction(payload, action, root, state);
    };
    root.addEventListener('click', onClick);
    return {
        dispose: function () {
            state.disposed = true;
            try { root.removeEventListener('click', onClick); } catch (e) { /* ignore */ }
            if (shadow) {
                try { shadow.textContent = ''; } catch (e) { /* ignore */ }
            } else if (container) {
                container.textContent = '';
            }
        },
        element: hostEl,
    };
}

export default { mount };
window.ToolView = { mount: mount, version: '20261026g' };
