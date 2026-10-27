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
    '.toolview__cli-actions{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;}',
    '.toolview__cli-action-btn{border:1px solid var(--tool-border,#d0d7de);background:transparent;border-radius:4px;padding:2px 10px;font:inherit;cursor:pointer;}',
    '.toolview__cli-action-btn[aria-pressed="true"]{background:rgba(37,99,235,.12);border-color:#2563eb;color:#2563eb;font-weight:600;}',
    '.toolview__cli-prompt{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:rgba(127,127,127,.06);border:1px solid var(--tool-border,#d0d7de);border-radius:4px;padding:8px;}',
    '.toolview__cli-sign{font:700 14px/1 ui-monospace,Consolas,monospace;color:#2563eb;}',
    '.toolview__cli-cmd{font:13px/1.4 ui-monospace,Consolas,monospace;opacity:.9;}',
    '.toolview__cli-fields{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}',
    '.toolview__cli-field{display:flex;align-items:center;gap:4px;font-size:13px;}',
    '.toolview__cli-field label{white-space:nowrap;}',
    '.toolview__cli-field input,.toolview__cli-field select{min-width:6em;max-width:14em;}',
    '.toolview__cli-req{color:#b42318;}',
    '.toolview__cli-params{font-size:12px;opacity:.75;margin:6px 0 0;}',
    '.toolview__cli-params code{font-family:ui-monospace,Consolas,monospace;}',
    '.toolview__cli-empty{font-size:12px;opacity:.65;}',
    '.toolview__cli-outhead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 4px;font:12px/1.4 ui-monospace,Consolas,monospace;opacity:.75;}',
    '.toolview__cli-copy{padding:1px 8px;font-size:12px;}',
    '.toolview__cli-output{background:#0d1117;color:#e6edf3;padding:8px;border-radius:4px;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Consolas,monospace;}',
    '.toolview__cli-output:focus{outline:2px solid #2563eb;outline-offset:2px;}',
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
                if (state.cli && state.cli.fail) state.cli.fail(action, input, '网络异常');
                return;
            }
            if (res.code !== 200) {
                setStatus(state, (res.msg || '执行失败'), true);
                if (state.cli && state.cli.fail) state.cli.fail(action, input, res.msg || '执行失败');
                return;
            }
            var result = res.data || {};
            state.ctx.input = input;
            state.ctx.result = (result.render === 'fields' || result.render === 'table')
                ? (result.data || {}) : { data: result.data };
            if (state.cli && typeof state.cli.append === 'function') {
                state.cli.append(action, input, result);
            } else {
                var target = root.querySelector('[data-tool-out="' + cssEscape(action) + '"]')
                    || root.querySelector('.toolview__output');
                renderResult(target, result);
            }
            updateBindings(root, state.ctx);
            setStatus(state, '成功 ' + (result.duration_ms || 0) + 'ms' + (result.truncated ? '（已截断）' : ''), false);
        })
        .catch(function (err) {
            if (button) button.disabled = false;
            if (err && err.message === 'input_invalid') return;
            setStatus(state, '执行失败', true);
            if (state.cli && state.cli.fail) state.cli.fail(action, input, '执行失败');
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

function cliTypeLabel(rule) {
    var t = (rule && rule.type) || 'string';
    if (t === 'string') return '字符串';
    if (t === 'number') return '数字';
    if (t === 'int') return '整数';
    if (t === 'boolean') return '布尔';
    if (t === 'enum') return '枚举';
    return t;
}

function cliDescribeParams(spec) {
    var rules = (spec && spec.input) || {};
    var keys = Object.keys(rules);
    if (!keys.length) return '无参数 · 按 Enter 运行 · ↑/↓ 调出历史';
    var parts = keys.map(function (key) {
        var rule = rules[key] || {};
        var text = key + '（' + cliTypeLabel(rule);
        if (rule.type === 'enum' && rule.enum && rule.enum.length) text += '：' + rule.enum.join('|');
        text += rule.required ? '，必填' : '，可选';
        if (rule.type === 'number' || rule.type === 'int') {
            if (rule.min !== undefined) text += ' ≥' + rule.min;
            if (rule.max !== undefined) text += ' ≤' + rule.max;
        }
        if (rule.type === 'string') {
            if (rule.min_length !== undefined) text += ' ≥' + rule.min_length + ' 字';
            if (rule.max_length !== undefined) text += ' ≤' + rule.max_length + ' 字';
        }
        return text + '）';
    });
    return '参数：' + parts.join('；') + ' · Enter 运行 · ↑/↓ 调出历史';
}

function cliValueText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);
    var text = String(value);
    if (text === '' || /\s/.test(text)) return JSON.stringify(text);
    return text;
}

function cliEcho(action, input) {
    var keys = Object.keys(input || {});
    var parts = keys.map(function (key) { return key + '=' + cliValueText(input[key]); });
    return '$ ' + action + (parts.length ? ' ' + parts.join(' ') : '');
}

function cliFieldsText(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    var keys = Object.keys(data);
    if (!keys.length) return '（空）';
    var width = 0;
    keys.forEach(function (key) { if (key.length > width) width = key.length; });
    return keys.map(function (key) {
        var value = data[key];
        var text = value === null || value === undefined ? ''
            : (typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
        return key + ' '.repeat(Math.max(1, width - key.length + 2)) + text;
    }).join('\n');
}

function cliTableText(rows) {
    if (!Array.isArray(rows) || !rows.length) return '（空表）';
    var cols = [];
    rows.forEach(function (row) {
        Object.keys(row || {}).forEach(function (key) {
            if (cols.indexOf(key) < 0) cols.push(key);
        });
    });
    if (!cols.length) return '（空表）';
    var cells = rows.map(function (row) {
        return cols.map(function (key) {
            var value = (row || {})[key];
            if (value === null || value === undefined) return '';
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
        });
    });
    var widths = cols.map(function (col, index) {
        var w = col.length;
        cells.forEach(function (line) { if (line[index].length > w) w = line[index].length; });
        return w;
    });
    function padRow(line) {
        return line.map(function (cell, index) {
            return index === line.length - 1 ? cell : cell + ' '.repeat(widths[index] - cell.length + 2);
        }).join('');
    }
    var head = padRow(cols);
    var sep = padRow(cols.map(function (col, index) { return '-'.repeat(widths[index]); }));
    return [head, sep].concat(cells.map(padRow)).join('\n');
}

function cliResultText(result) {
    result = result || {};
    var lines = [];
    if (result.title) lines.push(String(result.title));
    var data = result.data;
    if (result.render === 'text') {
        lines.push(typeof data === 'string' ? data
            : (data === undefined || data === null ? '' : JSON.stringify(data, null, 2)));
    } else if (result.render === 'fields') {
        var fields = cliFieldsText(data);
        lines.push(fields === null ? (JSON.stringify(data, null, 2) || '') : fields);
    } else if (result.render === 'table') {
        lines.push(Array.isArray(data) ? cliTableText(data) : (JSON.stringify(data, null, 2) || ''));
    } else {
        lines.push(JSON.stringify(data, null, 2) || '');
    }
    if (result.truncated) lines.push('（已截断）');
    return lines.join('\n');
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

    var actions = ((payload.manifest && payload.manifest.actions) || [])
        .filter(function (action) { return action && action.name; });
    var status = el('p', 'toolview__status');
    status.setAttribute('role', 'status');
    var output = el('pre', 'toolview__cli-output');
    output.setAttribute('role', 'log');
    output.setAttribute('aria-live', 'polite');
    output.setAttribute('aria-atomic', 'false');
    output.setAttribute('tabindex', '0');
    output.setAttribute('data-tool-cli-output', '1');
    var cliState = { active: actions.length ? actions[0].name : '', lines: [], used: false, runs: [], historyIndex: -1 };

    function paint() {
        output.textContent = cliState.lines.join('\n');
        output.scrollTop = output.scrollHeight;
    }
    function pushLines(lines) {
        if (!cliState.used) {
            cliState.used = true;
            cliState.lines = [];
        }
        lines.forEach(function (line) { cliState.lines.push(line); });
        var overflow = cliState.lines.length - 800;
        if (overflow > 0) cliState.lines.splice(0, overflow);
        paint();
    }
    function record(action, input) {
        cliState.runs.push({ action: action, input: input || {} });
        if (cliState.runs.length > 50) cliState.runs.shift();
        cliState.historyIndex = -1;
    }
    state.cli = {
        append: function (action, input, result) {
            record(action, input);
            pushLines([cliEcho(action, input), cliResultText(result)]);
        },
        fail: function (action, input, message) {
            record(action, input);
            pushLines([cliEcho(action, input), '错误：' + (message || '执行失败')]);
        },
    };

    var cmd = el('span', 'toolview__cli-cmd', cliState.active);
    var fieldsWrap = el('div', 'toolview__cli-fields');
    var runBtn = el('button', 'toolview__cli-run', '运行');
    runBtn.type = 'button';
    var params = el('p', 'toolview__cli-params');
    var actionsBar = el('div', 'toolview__cli-actions');
    actionsBar.setAttribute('role', 'group');
    actionsBar.setAttribute('aria-label', '选择动作');
    var actionBtns = [];

    function buildField(key, rule) {
        rule = rule || {};
        var wrap = el('div', 'toolview__cli-field');
        var id = 'tool-cli-' + key;
        var label = el('label', '', rule.label || key);
        label.setAttribute('for', id);
        wrap.appendChild(label);
        if (rule.required) {
            var req = el('span', 'toolview__cli-req', '*');
            req.setAttribute('aria-hidden', 'true');
            req.title = '必填';
            wrap.appendChild(req);
        }
        var ctrl;
        if (rule.type === 'boolean') {
            ctrl = el('select');
            [['false', '否'], ['true', '是']].forEach(function (pair) {
                var option = el('option', '', pair[1]);
                option.value = pair[0];
                ctrl.appendChild(option);
            });
        } else if (rule.type === 'enum' && Array.isArray(rule.enum)) {
            ctrl = el('select');
            if (!rule.required) {
                var empty = el('option', '', '（不填）');
                empty.value = '';
                ctrl.appendChild(empty);
            }
            rule.enum.forEach(function (value) {
                var option = el('option', '', String(value));
                option.value = String(value);
                ctrl.appendChild(option);
            });
        } else {
            ctrl = el('input');
            if (rule.type === 'int' || rule.type === 'number') {
                ctrl.type = 'number';
                ctrl.step = 'any';
                if (rule.min !== undefined) ctrl.min = String(rule.min);
                if (rule.max !== undefined) ctrl.max = String(rule.max);
            } else {
                ctrl.type = 'text';
                if (rule.max_length !== undefined) ctrl.maxLength = rule.max_length;
                if (rule.min_length !== undefined) ctrl.minLength = rule.min_length;
            }
        }
        ctrl.id = id;
        ctrl.setAttribute('data-tool-input', key);
        ctrl.placeholder = rule.placeholder || (rule.required ? '必填' : '可选');
        wrap.appendChild(ctrl);
        return wrap;
    }

    function selectAction(name) {
        cliState.active = name;
        cmd.textContent = name;
        runBtn.setAttribute('data-tool-action', name);
        actionBtns.forEach(function (btn) {
            var on = btn.getAttribute('data-tool-cli-action') === name;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        fieldsWrap.textContent = '';
        var spec = actionSpec(payload, name) || {};
        var rules = spec.input || {};
        var keys = Object.keys(rules);
        keys.forEach(function (key) { fieldsWrap.appendChild(buildField(key, rules[key])); });
        if (!keys.length) fieldsWrap.appendChild(el('span', 'toolview__cli-empty', '（无参数）'));
        params.textContent = cliDescribeParams(spec);
    }

    actions.forEach(function (action) {
        var btn = el('button', 'toolview__cli-action-btn', action.title || action.name);
        btn.type = 'button';
        btn.setAttribute('data-tool-cli-action', action.name);
        btn.title = action.name + '：' + cliDescribeParams(action);
        actionsBar.appendChild(btn);
        actionBtns.push(btn);
    });
    actionsBar.addEventListener('click', function (event) {
        var node = event.target;
        while (node && node !== actionsBar) {
            if (node.getAttribute && node.getAttribute('data-tool-cli-action')) {
                selectAction(node.getAttribute('data-tool-cli-action'));
                return;
            }
            node = node.parentNode;
        }
    });

    function runActive() {
        if (!cliState.active || runBtn.disabled) return;
        runAction(payload, cliState.active, root, state);
    }

    function restoreRun(run, keepIndex) {
        if (!run) return;
        if (run.action !== cliState.active) {
            selectAction(run.action);
            cliState.historyIndex = keepIndex;
        }
        Object.keys(run.input || {}).forEach(function (key) {
            var node = fieldsWrap.querySelector('[data-tool-input="' + cssEscape(key) + '"]');
            if (!node) return;
            var value = run.input[key];
            if (node.tagName === 'SELECT') {
                node.value = value === true ? 'true' : value === false ? 'false'
                    : String(value === undefined || value === null ? '' : value);
            } else {
                node.value = value === undefined || value === null ? '' : String(value);
            }
        });
    }

    fieldsWrap.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            runActive();
            return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            if (!cliState.runs.length) return;
            event.preventDefault();
            var next = cliState.historyIndex + (event.key === 'ArrowUp' ? 1 : -1);
            if (next < -1) next = -1;
            if (next > cliState.runs.length - 1) next = cliState.runs.length - 1;
            cliState.historyIndex = next;
            if (next >= 0) restoreRun(cliState.runs[cliState.runs.length - 1 - next], next);
        }
    });

    if (actions.length) {
        var prompt = el('div', 'toolview__cli-prompt');
        prompt.setAttribute('role', 'group');
        prompt.setAttribute('aria-label', '输入参数');
        prompt.appendChild(el('span', 'toolview__cli-sign', '$'));
        prompt.appendChild(cmd);
        prompt.appendChild(fieldsWrap);
        prompt.appendChild(runBtn);
        cli.appendChild(actionsBar);
        cli.appendChild(prompt);
        cli.appendChild(params);
        selectAction(cliState.active);
    } else {
        cli.appendChild(el('p', 'toolview__cli-params', '这个工具还没有动作，无法运行。'));
    }

    cliState.lines.push('# 选择动作、填写参数后按 Enter 运行；↑/↓ 调出历史');
    paint();

    var outHead = el('div', 'toolview__cli-outhead');
    outHead.appendChild(el('span', '', '── 输出 ──'));
    var copyBtn = el('button', 'toolview__cli-copy', '复制');
    copyBtn.type = 'button';
    copyBtn.title = '复制输出内容';
    copyBtn.onclick = function () {
        var text = output.textContent || '';
        if (!text) {
            setStatus(state, '还没有输出可复制', true);
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                setStatus(state, '已复制输出', false);
            }, function () {
                setStatus(state, '复制失败：请选中输出区手动复制', true);
            });
        } else {
            setStatus(state, '请选中输出区手动复制', false);
        }
    };
    outHead.appendChild(copyBtn);
    cli.appendChild(outHead);
    cli.appendChild(output);
    cli.appendChild(status);
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
window.ToolView = { mount: mount, version: '20261027a' };
