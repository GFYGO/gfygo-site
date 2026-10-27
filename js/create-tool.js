/**
 * create-tool.js
 * 创作工具页：草稿 CRUD、Lua/UI 编辑、预览试运行、发布。
 *
 * 约束：
 *   * 所有请求走 window.apiRequest（自带 JWT / 401 跳登录）；
 *   * 预览走服务端草稿内容接口，渲染复用 dashboard.toolview.js；
 *   * 不 eval 作者 Lua，不把 token 拼进 URL。
 */
(function () {
    'use strict';

    var state = {
        tools: [],
        current: null,
        platform: null,
        versions: [],
        dirty: false,
        saving: false,
        saveFails: 0,
        previewHandle: null,
        loading: false,
    };

    function $(id) { return document.getElementById(id); }

    function api(path, options) {
        return window.apiRequest(path, options);
    }

    function toast(message, type) {
        if (window.Toast && window.Toast.show) window.Toast.show(message, type || 'info');
    }

    /**
     * 把服务端失败响应压成一句人话。
     * 以前只取 res.msg，于是 `400 {msg:"Lua 语法错误", data:{hint:"..."}}` 在页面上
     * 只剩「Lua 语法错误」四个字（真正原因在 hint 里被丢了），线上只剩控制台一条 400。
     * 顺序：msg → data.errors[].path+message（字段级）→ data.hint（编译报错等）。
     */
    function failMessage(res, fallback) {
        var data = (res && res.data) || {};
        var msg = String((res && res.msg) || fallback || '请求失败');
        var errors = data.errors;
        if (errors && errors.length) {
            msg += '：' + errors.slice(0, 3).map(function (e) {
                return (e.path || '') + ' ' + (e.message || '');
            }).join('；');
        } else if (data.hint && msg.indexOf(data.hint) === -1) {
            msg += '：' + data.hint;
        }
        return msg;
    }

    function setDirty(value) {
        state.dirty = !!value;
        var label = $('ctSaveBtn');
        if (label) label.textContent = state.dirty ? '保存草稿 *' : '保存草稿';
    }

    function parseJson(text, label) {
        try {
            return JSON.parse(text || 'null');
        } catch (e) {
            throw new Error(label + ' 不是合法 JSON：' + e.message);
        }
    }

    function currentManifest() {
        if (!state.current || !state.current.manifest) return {};
        return JSON.parse(JSON.stringify(state.current.manifest));
    }

    function setStatusBadge(status) {
        var node = $('ctStatus');
        if (!node) return;
        var map = {
            draft: '草稿', published: '已发布', pending_review: '审核中',
            suspended: '已下架', disabled: '已停用',
        };
        node.textContent = map[status] || status || '—';
        node.className = 'ct-badge ct-badge--' + (status || 'draft');
        var ver = $('ctVersionLabel');
        if (ver) ver.textContent = state.current ? ('v' + (state.current.version || '0.0.0')) : '';
    }

    // ============================================================
    // 列表 / 选择
    // ============================================================

    function renderToolList() {
        var box = $('ctToolList');
        if (!box) return;
        box.textContent = '';
        if (!state.tools.length) {
            box.appendChild(textEl('p', 'ct-muted', '还没有工具。点「＋ 新建」创建第一个。'));
            return;
        }
        state.tools.forEach(function (tool) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ct-tool-item' + (state.current && state.current.id === tool.id ? ' is-active' : '');
            btn.setAttribute('data-tool-id', String(tool.id));
            var name = textEl('span', 'ct-tool-item__name', (tool.icon || '🔧') + ' ' + (tool.name || tool.tool_key));
            var meta = textEl('span', 'ct-tool-item__meta',
                (tool.status || 'draft') + ' · v' + (tool.version || '0.0.0'));
            btn.appendChild(name);
            btn.appendChild(meta);
            btn.addEventListener('click', function () { selectTool(tool.id); });
            box.appendChild(btn);
        });
    }

    async function loadTools(selectId) {
        var res = await api('/api/v0/tool', { silent: true });
        if (!res || res.code !== 200) {
            toast((res && res.msg) || '工具列表加载失败');
            return;
        }
        state.tools = (res.data && res.data.items) || [];
        renderToolList();
        if (selectId) {
            await selectTool(selectId);
            return;
        }
        var query = new URLSearchParams(window.location.search).get('tool');
        if (query && /^\d+$/.test(query)) {
            await selectTool(Number(query));
            return;
        }
        if (state.tools.length && !state.current) await selectTool(state.tools[0].id);
    }

    async function selectTool(id) {
        if (state.dirty && !window.confirm('当前草稿有未保存修改，切换会丢失。继续？')) return;
        var res = await api('/api/v0/tool/' + id, { silent: true });
        if (!res || res.code !== 200) {
            toast(failMessage(res, '工具加载失败'));
            return;
        }
        state.current = res.data;
        fillForm(state.current);
        setDirty(false);
        renderToolList();
        await loadVersions();
        refreshPreview();
    }

    function fillForm(tool) {
        var m = tool.manifest || {};
        var meta = m.meta || {};
        $('ctName').value = meta.name || tool.name || '';
        $('ctIcon').value = meta.icon || tool.icon || '🔧';
        $('ctSummary').value = meta.summary || '';
        $('ctTags').value = (meta.tags || []).join(', ');
        $('ctVersion').value = meta.version || '0.0.0';
        $('ctEntry').value = (m.entry && m.entry.function) || 'main';
        $('ctActions').value = JSON.stringify(m.actions || [], null, 2);
        $('ctConfig').value = JSON.stringify(m.config_schema || [], null, 2);
        $('ctLua').value = tool.lua_source || '';
        var ui = tool.ui || m.ui || {};
        var mode = ui.mode || 'none';
        var radios = document.querySelectorAll('input[name="ctUiMode"]');
        for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === mode;
        $('ctHtml').value = ui.html || '';
        $('ctCss').value = ui.css || '';
        $('ctUiFunction').value = ui.function || 'ui';
        toggleUiBoxes();
        renderCaps();
        setStatusBadge(tool.status);
        $('ctPublishedVersion').textContent = tool.published_version_id ? ('v' + (tool.version || '')) : '—';
        $('ctHash').textContent = tool.content_hash || '—';
        $('ctPublicDir').textContent = tool.allow_public_dir ? '已开启' : '未开启';
        document.title = (meta.name || tool.name || '创作工具') + ' | GWL';
    }

    function textEl(tag, cls, value) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (value !== undefined) node.textContent = value;
        return node;
    }

    // ============================================================
    // 能力
    // ============================================================

    function renderCaps() {
        var box = $('ctCaps');
        if (!box) return;
        box.textContent = '';
        var manifest = currentManifest();
        var declared = {};
        (manifest.capabilities || []).forEach(function (cap) {
            if (cap && cap.id) declared[cap.id] = cap;
        });
        var caps = (state.platform && state.platform.capabilities) || [];
        caps.forEach(function (cap) {
            var label = document.createElement('label');
            if (!cap.enabled) label.className = 'is-disabled';
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('data-cap-id', cap.id);
            input.checked = !!declared[cap.id];
            input.disabled = !cap.enabled;
            label.appendChild(input);
            var info = document.createElement('span');
            info.appendChild(textEl('span', '', cap.title || cap.id));
            info.appendChild(textEl('small', '',
                cap.id + ' · ' + (cap.kind || 'read') + ' · v' + (cap.api_version || 1)
                + (cap.enabled ? '' : '（平台未启用）')));
            label.appendChild(info);
            box.appendChild(label);
        });
    }

    function checkedCapabilities() {
        var out = [];
        var nodes = document.querySelectorAll('#ctCaps input[data-cap-id]:checked');
        for (var i = 0; i < nodes.length; i++) {
            var id = nodes[i].getAttribute('data-cap-id');
            var platformCap = null;
            var caps = (state.platform && state.platform.capabilities) || [];
            for (var j = 0; j < caps.length; j++) if (caps[j].id === id) platformCap = caps[j];
            out.push({ id: id, api_version: (platformCap && platformCap.api_version) || 1 });
        }
        return out;
    }

    /**
     * 平台降级常驻提示（role=status，不打断阅读）。
     * 这两条以前只存在于接口响应里：用户看到的是「保存一个 400 / 执行一个 503」，
     * 却不知道是服务器缺依赖或平台清单坏了。
     */
    function renderPlatformWarn() {
        var node = $('ctPlatformWarn');
        if (!node) return;
        var platform = state.platform || {};
        var notes = [];
        if (platform.degraded) {
            notes.push('平台清单读取失败（服务器 data/tool_platform.json 缺失或格式不对），'
                + '能力与 UI 写法已按「全关」处理，保存会被校验拒绝。');
        }
        if (platform.lua_available === false) {
            notes.push('服务器未安装 lupa：可编辑、可保存，但执行与发布会返回 503。'
                + '在服务器执行 pip install -r requirements.txt 后重启后端即可。');
        }
        node.textContent = notes.join(' ');
        node.hidden = notes.length === 0;
    }

    // ============================================================
    // 收集 / 保存
    // ============================================================

    function collect() {
        if (!state.current) throw new Error('请先选择工具');
        var manifest = currentManifest();
        var actions = parseJson($('ctActions').value || '[]', '动作');
        var config = parseJson($('ctConfig').value || '[]', '配置字段');
        if (!Array.isArray(actions)) throw new Error('动作必须是 JSON 数组');
        if (!Array.isArray(config)) throw new Error('配置字段必须是 JSON 数组');
        var meta = manifest.meta || {};
        meta.key = state.current.tool_key;
        meta.name = $('ctName').value.trim();
        meta.icon = $('ctIcon').value.trim();
        meta.summary = $('ctSummary').value.trim();
        meta.tags = $('ctTags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        meta.version = $('ctVersion').value.trim() || '0.1.0';
        manifest.meta = meta;
        manifest.entry = manifest.entry || { file: 'inline:main.lua' };
        manifest.entry.function = $('ctEntry').value.trim() || 'main';
        manifest.actions = actions;
        manifest.config_schema = config;
        manifest.capabilities = checkedCapabilities();
        manifest.runtime = { lua: '5.4' };
        manifest.schema_version = 1;

        var checked = document.querySelector('input[name="ctUiMode"]:checked');
        var mode = checked ? checked.value : 'none';
        var oldUi = manifest.ui || {};
        manifest.ui = {
            mode: mode,
            function: ($('ctUiFunction').value || 'ui').trim(),
            html: $('ctHtml').value,
            css: $('ctCss').value,
            blocks: oldUi.blocks || [],
            title: oldUi.title || '',
        };
        return {
            manifest: manifest,
            lua_source: $('ctLua').value,
            ui: manifest.ui,
        };
    }

    async function save(silent) {
        if (!state.current || state.saving) return false;
        var payload;
        try {
            payload = collect();
        } catch (e) {
            toast(e.message);
            return false;
        }
        state.saving = true;
        var res = await api('/api/v0/tool/' + state.current.id, {
            method: 'PUT', body: payload, silent: true,
        });
        state.saving = false;
        if (!res || res.code !== 200) {
            var msg = failMessage(res, '保存失败');
            state.saveFails += 1;
            if (silent) {
                // 自动保存不刷屏：第 1 次与「主动暂停」各提示一次
                if (state.saveFails === 1) toast(msg);
                else if (state.saveFails === 3) {
                    toast('自动保存已暂停（连续 3 次失败）：' + msg + '；修好后点「保存草稿」重试');
                }
            } else {
                toast(msg);
            }
            return false;
        }
        state.saveFails = 0;
        state.current = res.data;
        setDirty(false);
        setStatusBadge(state.current.status);
        $('ctPublishedVersion').textContent = state.current.published_version_id ? ('v' + (state.current.version || '')) : '—';
        $('ctHash').textContent = state.current.content_hash || '—';
        if (!silent) toast((res && res.msg) || '草稿已保存', 'success');
        var index = state.tools.findIndex(function (t) { return t.id === state.current.id; });
        if (index >= 0) state.tools[index] = state.current;
        renderToolList();
        return true;
    }

    async function publish() {
        if (!state.current) return;
        var ok = await save(true);
        if (!ok) return;
        var res = await api('/api/v0/tool/' + state.current.id + '/publish', {
            method: 'POST', body: {}, silent: true,
        });
        if (!res || res.code !== 200) {
            toast(failMessage(res, '发布失败'));
            return;
        }
        toast(res.msg || '已发布', 'success');
        await selectTool(state.current.id);
    }

    async function removeTool() {
        if (!state.current) return;
        if (!window.confirm('删除后进入回收站（保留至少 14 天）。继续？')) return;
        var res = await api('/api/v0/tool/' + state.current.id, { method: 'DELETE', silent: true });
        if (!res || res.code !== 200) {
            toast(failMessage(res, '删除失败'));
            return;
        }
        state.current = null;
        setDirty(false);
        $('ctPreview').textContent = '';
        await loadTools();
        toast('已移入回收站', 'success');
    }

    // ============================================================
    // 版本 / 预览
    // ============================================================

    async function loadVersions() {
        var box = $('ctVersions');
        if (!box || !state.current) return;
        var res = await api('/api/v0/tool/' + state.current.id + '/versions', { silent: true });
        if (!res || res.code !== 200) {
            box.textContent = '版本列表加载失败';
            return;
        }
        state.versions = (res.data && res.data.items) || [];
        box.textContent = '';
        if (!state.versions.length) {
            box.appendChild(textEl('p', 'ct-muted', '尚未发布'));
            return;
        }
        state.versions.forEach(function (v) {
            var row = textEl('div', 'ct-version');
            row.appendChild(textEl('span', '', 'v' + v.version + (v.current ? '（当前）' : '') + (v.pending ? '（待审）' : '')));
            row.appendChild(textEl('span', 'ct-muted', (v.published_at || '').replace('T', ' ').slice(0, 19)));
            box.appendChild(row);
        });
    }

    function ensureToolView() {
        return new Promise(function (resolve, reject) {
            var tries = 0;
            (function poll() {
                if (window.ToolView && typeof window.ToolView.mount === 'function') return resolve();
                if (tries++ > 80) return reject(new Error('预览渲染器未加载'));
                setTimeout(poll, 50);
            })();
        });
    }

    async function refreshPreview() {
        if (!state.current) return;
        if (state.dirty) {
            var ok = await save(true);
            if (!ok) return;
        }
        var res = await api('/api/v0/tool/' + state.current.id + '/content?draft=1', { silent: true });
        if (!res || res.code !== 200) {
            $('ctPreview').textContent = failMessage(res, '预览加载失败');
            return;
        }
        try {
            await ensureToolView();
        } catch (e) {
            $('ctPreview').textContent = '预览渲染器未加载';
            return;
        }
        if (state.previewHandle && state.previewHandle.dispose) {
            try { state.previewHandle.dispose(); } catch (e) { /* ignore */ }
        }
        var box = $('ctPreview');
        box.textContent = '';
        try {
            state.previewHandle = window.ToolView.mount(box, res.data);
        } catch (e) {
            box.textContent = '预览失败：' + (e && e.message ? e.message : e);
        }
    }

    // ============================================================
    // 模板
    // ============================================================

    function insertLuaTemplate() {
        $('ctLua').value = [
            'function main(ctx)',
            '  local name = ctx.user.username',
            '  return { render = "text", data = "你好，" .. name }',
            'end',
            '',
        ].join('\n');
        setDirty(true);
        toast('已插入 Lua 示例', 'success');
    }

    function insertUiTemplate() {
        var actions;
        try {
            actions = parseJson($('ctActions').value || '[]', '动作');
        } catch (e) {
            actions = [];
        }
        if (!Array.isArray(actions) || !actions.length) {
            actions = [{
                name: 'hello', title: '问候', function: 'main',
                input: { who: { type: 'string', required: true, label: '名字' } },
                render: ['text'],
            }];
            $('ctActions').value = JSON.stringify(actions, null, 2);
        }
        var checked = document.querySelector('input[name="ctUiMode"][value="lua"]');
        if (checked) checked.checked = true;
        toggleUiBoxes();
        $('ctUiFunction').value = 'ui';
        $('ctLua').value = [
            'function main(ctx)',
            '  return { render = "text", data = "你好 " .. tostring(ctx.input.who) }',
            'end',
            '',
            'function ui(ctx)',
            '  ui.form({',
            '    ui.text_block("你好，{{config.who}}", "size=+2;bold=true;color=red"),',
            '    ui.input("who", "placeholder=名字;w=200"),',
            '    ui.button("问候", "hello", "bg=#2563eb;color=white"),',
            '    ui.frame({ ui.text_block("结果：{{result.data}}") }, "h=120;scroll=true")',
            '  })',
            'end',
        ].join('\n');
        if (!($('ctConfig').value || '').trim() || $('ctConfig').value.trim() === '[]') {
            $('ctConfig').value = JSON.stringify([
                { key: 'who', label: '谁', type: 'string', default: '世界', user_editable: true },
            ], null, 2);
        }
        setDirty(true);
        toast('已插入 ui.* 示例；保存后看右侧预览', 'success');
    }

    // ============================================================
    // UI 交互
    // ============================================================

    function toggleUiBoxes() {
        var checked = document.querySelector('input[name="ctUiMode"]:checked');
        var mode = checked ? checked.value : 'none';
        $('ctCustomBox').hidden = mode !== 'custom';
        $('ctLuaUiBox').hidden = mode !== 'lua';
    }

    function switchTab(name) {
        var tabs = document.querySelectorAll('.ct-tab');
        var panels = document.querySelectorAll('.ct-panel');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-tab') === name ? 'true' : 'false');
        }
        for (var j = 0; j < panels.length; j++) {
            panels[j].hidden = panels[j].getAttribute('data-panel') !== name;
        }
    }

    function bind() {
        var tabButtons = document.querySelectorAll('.ct-tab');
        for (var i = 0; i < tabButtons.length; i++) {
            tabButtons[i].addEventListener('click', function () {
                switchTab(this.getAttribute('data-tab'));
            });
        }
        var editor = document.querySelector('.ct-editor');
        editor.addEventListener('input', function (e) {
            if (e.target && e.target.name === 'ctUiMode') toggleUiBoxes();
            setDirty(true);
        });
        editor.addEventListener('change', function (e) {
            if (e.target && e.target.name === 'ctUiMode') toggleUiBoxes();
            setDirty(true);
        });
        $('ctSaveBtn').addEventListener('click', function () { save(false); });
        $('ctPublishBtn').addEventListener('click', publish);
        $('ctPublishBtn2').addEventListener('click', publish);
        $('ctDeleteBtn').addEventListener('click', removeTool);
        $('ctPreviewBtn').addEventListener('click', function () { refreshPreview(); });
        $('ctLuaTemplate').addEventListener('click', insertLuaTemplate);
        $('ctUiTemplate').addEventListener('click', insertUiTemplate);
        $('ctNewToggle').addEventListener('click', function () {
            var form = $('ctNewForm');
            form.hidden = !form.hidden;
            if (!form.hidden) $('ctNewKey').focus();
        });
        $('ctNewForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            var key = $('ctNewKey').value.trim();
            var name = $('ctNewName').value.trim() || key;
            if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(key)) {
                toast('工具标识必须是小写字母/数字/下划线/连字符，2~32 位');
                return;
            }
            var res = await api('/api/v0/tool', {
                method: 'POST', body: { tool_key: key, name: name }, silent: true,
            });
            if (!res || res.code !== 200) {
                toast((res && res.msg) || '创建失败');
                return;
            }
            $('ctNewForm').hidden = true;
            $('ctNewKey').value = '';
            $('ctNewName').value = '';
            await loadTools(res.data.id);
            toast('草稿已创建', 'success');
        });
        window.addEventListener('beforeunload', function (e) {
            if (!state.dirty) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }


    // ============================================================
    // 分享导入（?import=<token>）
    // ============================================================

    var IMPORT_TOKEN_RE = /^[A-Za-z0-9]{4,64}$/;

    function importToken() {
        var raw = new URLSearchParams(window.location.search).get('import');
        if (!raw) return null;
        raw = raw.trim();
        return IMPORT_TOKEN_RE.test(raw) ? raw : null;
    }

    function importActionText(mode) {
        return mode === 'fork' ? '派生为我自己的工具' : '安装该工具';
    }

    function importMetaLine(d) {
        var tool = d.tool || {};
        var owner = d.owner || {};
        var parts = [];
        parts.push('标识 ' + (tool.tool_key || '?'));
        if (tool.version) parts.push('v' + tool.version);
        if (owner.display_name || owner.username) {
            parts.push('作者 ' + (owner.display_name || owner.username));
        }
        parts.push('方式 ' + (d.get_mode === 'fork' ? '派生' : '安装'));
        parts.push('已用 ' + (d.used_count || 0) + (d.max_uses ? '/' + d.max_uses : ' 次（不限）'));
        parts.push(d.expires_at ? '有效期至 ' + String(d.expires_at).slice(0, 10) : '长期有效');
        if (d.installed) parts.push('你已安装');
        return parts.join(' · ');
    }

    function renderImport(token) {
        var box = $('ctImportBox');
        if (!box) return;
        box.hidden = false;
        box.textContent = '';
        box.appendChild(textEl('p', 'ct-import__title', '正在读取分享信息…'));
        api('/api/v0/tool/share/' + encodeURIComponent(token), { silent: true }).then(function (res) {
            box.textContent = '';
            if (!res || res.code !== 200) {
                box.classList.add('ct-import--error');
                box.appendChild(textEl('p', 'ct-import__title', failMessage(res, '分享链接不可用')));
                var quit = textEl('button', 'btn-secondary', '关闭');
                quit.type = 'button';
                quit.addEventListener('click', function () { box.hidden = true; });
                box.appendChild(quit);
                return;
            }
            box.classList.remove('ct-import--error');
            var d = res.data || {};
            var tool = d.tool || {};
            var mode = d.get_mode === 'fork' ? 'fork' : 'install';
            box.appendChild(textEl('p', 'ct-import__title',
                '分享的工具：' + (tool.icon || '🔧') + ' ' + (tool.name || tool.tool_key || '')));
            box.appendChild(textEl('p', 'ct-import__meta', importMetaLine(d)));
            box.appendChild(textEl('p', 'ct-import__hint', mode === 'fork'
                ? '接受后会复制成你自己的私有草稿（作者与源码都不会变），可以在创作工具里改写后再发布。'
                : '接受后会加入你的工具列表；是否启用、排序与个人配置在「工具管理」里调整。'));
            var actions = textEl('div', 'ct-import__actions');
            var accept = textEl('button', 'btn-primary', importActionText(mode));
            accept.type = 'button';
            var dash = textEl('a', 'btn-secondary', '去工具管理');
            dash.href = '/user/dashboard.html#panel-tool-manage';
            var close = textEl('button', 'btn-secondary', '关闭');
            close.type = 'button';
            close.addEventListener('click', function () { box.hidden = true; });
            accept.addEventListener('click', async function () {
                accept.disabled = true;
                var res2 = await api('/api/v0/tool/import', {
                    method: 'POST', body: { kind: 'code', token: token }, silent: true,
                });
                if (!res2 || res2.code !== 200) {
                    accept.disabled = false;
                    if (window.Toast && window.Toast.show) window.Toast.show(failMessage(res2, '导入失败'), 'error');
                    return;
                }
                var data = res2.data || {};
                if (data.mode === 'fork') {
                    if (window.Toast && window.Toast.show) window.Toast.show('已派生为你的私有草稿', 'success');
                    window.location.href = '/create-tool.html?tool=' + encodeURIComponent(String(data.tool_id));
                    return;
                }
                accept.textContent = '已安装';
                if (window.Toast && window.Toast.show) {
                    window.Toast.show(data.already_installed ? '这个工具你已经安装过了' : '安装完成', 'success');
                }
                if (data.tab_key) {
                    var link = textEl('a', 'btn-secondary', '打开工具');
                    link.href = '/user/dashboard.html#panel-' + data.tab_key;
                    actions.insertBefore(link, actions.firstChild);
                }
            });
            actions.appendChild(accept);
            actions.appendChild(dash);
            actions.appendChild(close);
            box.appendChild(actions);
        });
    }

    function initImport() {
        var token = null;
        try {
            token = importToken();
        } catch (err) {
            token = null;
        }
        if (!token) return;
        renderImport(token);
    }

    async function init() {
        if (window.AuthGuard && window.AuthGuard.requireAuth) window.AuthGuard.requireAuth();
        bind();
        initImport();
        var res = await api('/api/v0/tool/platform', { silent: true });
        if (res && res.code === 200) state.platform = res.data;
        renderPlatformWarn();
        await loadTools();
        setInterval(function () {
            if (!state.dirty || !state.current || state.saving) return;
            // 连续失败 3 次就暂停自动保存：否则每 30 秒再砸一条同样的 4xx，
            // 真正的原因被刷屏（线上 5 条 400 就是这么来的）。
            // 点「保存草稿」（非 silent）成功即恢复。
            if (state.saveFails >= 3) return;
            save(true);
        }, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
