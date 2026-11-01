/**
 * js/modules/gfy-permission-editor.js
 * <gfy-permission-editor>：权限节点编辑模块（三态：继承 / 允许 / 拒绝）。
 *
 * 用法：
 *   <gfy-permission-editor scope="level" scope-id="3"></gfy-permission-editor>
 *   <gfy-permission-editor scope="user" scope-id="7" mode="inline"></gfy-permission-editor>
 *   <gfy-permission-editor scope="content" object-type="document" object-id="12"></gfy-permission-editor>
 *
 * 说明：
 *   - 节点字典来自 GET /api/v0/admin/permission-nodes（按 module 分组）；
 *   - 已挂载规则来自 GET /api/v0/admin/permission-rules；
 *   - 保存走 POST /api/v0/admin/permission-rules（**全量替换**，需要 admin.permission.assign）；
 *   - 本组件只编辑 target='*' 且 level='*' 的规则；其余通配规则原样保留（不丢失）；
 *   - 属性 admin="false" 时不发 X-Permission-Context: admin（默认发送）。
 */
import { esc, api, toast, injectStyles, moduleLabel, GfyElement, BASE_CSS } from './shared.js';

const CSS = BASE_CSS + `
.perm-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.perm-tools .gfy-muted{flex:1}
.perm-group{border:1px solid var(--color-border,#a7f3d0);border-radius:var(--radius-md,8px);margin-bottom:12px;overflow:hidden}
.perm-group-head{padding:7px 11px;background:var(--color-bg-secondary,#f0fdf4);font-weight:700;font-size:12.5px;color:var(--color-text-muted,#036b4d)}
.perm-row{display:flex;align-items:center;gap:10px;padding:7px 11px;border-top:1px solid var(--color-border,#a7f3d0)}
.perm-row:first-child{border-top:0}
.perm-code{font-family:ui-monospace,Consolas,monospace;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.perm-name{font-size:12px;color:var(--color-text-muted,#036b4d);max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.perm-states{display:flex;gap:4px;flex:0 0 auto}
.perm-state{border:1px solid var(--color-border,#a7f3d0);background:var(--color-bg-white,#fff);color:inherit;border-radius:999px;padding:3px 9px;font-size:12px}
.perm-state[aria-pressed="true"]{color:#fff;border-color:var(--color-primary,#10b981);background:var(--color-primary,#10b981)}
.perm-state[data-state="deny"][aria-pressed="true"]{background:var(--color-danger,#b91c1c);border-color:var(--color-danger,#b91c1c)}
.perm-save{background:var(--color-primary,#10b981);border-color:var(--color-primary,#10b981);color:#fff}
`;

const STATES = ['inherit', 'allow', 'deny'];
const STATE_TEXT = { inherit: '继承', allow: '允许', deny: '拒绝' };

function ruleKey(category, action) { return String(category) + '.' + String(action); }

class GfyPermissionEditor extends GfyElement {
    constructor() {
        super();
        this._nodes = [];
        this._managed = new Map();       // 'category.action' -> allow|deny
        this._passthrough = [];          // 不能在此编辑的规则（通配/非通配主体）
        this._dirty = false;
        this._loading = false;
        this._bound = false;
    }

    get scope() {
        var s = (this.getAttribute('scope') || 'level').trim();
        return ['level', 'user', 'group', 'content'].indexOf(s) >= 0 ? s : 'level';
    }

    get readOnly() { return this.getAttribute('readonly') === 'true'; }

    get headers() {
        return this.getAttribute('admin') === 'false' ? {} : { 'X-Permission-Context': 'admin' };
    }

    get mount() {
        if (this.scope === 'content') {
            return {
                scope: 'content',
                object_type: this.getAttribute('object-type') || '',
                object_id: parseInt(this.getAttribute('object-id') || '0', 10) || 0,
            };
        }
        return { scope: this.scope, scope_id: (this.getAttribute('scope-id') || '').trim() };
    }

    render() {
        injectStyles(this.shadowRoot, CSS);
        this._root = document.createElement('div');
        this._root.className = 'gfy-card';
        this._root.innerHTML = ''
            + '<div class="gfy-head"><span class="gfy-title">' + esc(this.getAttribute('title') || '权限节点编辑') + '</span>'
            + '<button type="button" class="gfy-btn gfy-btn--primary perm-save" disabled>保存</button></div>'
            + '<div class="gfy-body"><div class="perm-tools"><span class="gfy-muted perm-summary">加载中…</span>'
            + '<button type="button" class="gfy-btn perm-reset">重置</button></div>'
            + '<div class="perm-list"><div class="gfy-skel" style="width:65%"></div><div class="gfy-skel" style="width:90%"></div></div></div>';
        this.shadowRoot.appendChild(this._root);
        this._bind();
        this.reload();
        return Promise.resolve();
    }

    _bind() {
        if (this._bound) return;
        this._bound = true;
        var self = this;
        this._root.querySelector('.perm-save').addEventListener('click', function () { self.save(); });
        this._root.querySelector('.perm-reset').addEventListener('click', function () { self.reload(); });
        this._root.querySelector('.perm-list').addEventListener('click', function (e) {
            var btn = e.target.closest('.perm-state');
            if (!btn || self.readOnly) return;
            var cat = btn.getAttribute('data-cat');
            var act = btn.getAttribute('data-act');
            var state = btn.getAttribute('data-state');
            var key = ruleKey(cat, act);
            if (state === 'inherit') self._managed.delete(key);
            else self._managed.set(key, state);
            self._dirty = true;
            self._renderStates();
            self._renderSummary();
        });
    }

    async reload() {
        if (!this._root || this._loading) return;
        this._loading = true;
        this._managed.clear();
        this._passthrough = [];
        this._dirty = false;
        var list = this._root.querySelector('.perm-list');
        list.innerHTML = '<div class="gfy-skel" style="width:65%"></div><div class="gfy-skel" style="width:90%"></div>';
        var self = this;
        var params = { scope: this.scope };
        if (this.scope === 'content') {
            params.object_type = this.mount.object_type;
            params.id = this.mount.object_id;
        } else if (this.mount.scope_id) {
            params.id = this.mount.scope_id;
        }
        var results = await Promise.all([
            api('/api/v0/admin/permission-nodes', { headers: this.headers, silent: true }),
            api('/api/v0/admin/permission-rules', { params: params, headers: this.headers, silent: true }),
        ]);
        this._loading = false;
        var nodesRes = results[0], rulesRes = results[1];
        if (!nodesRes || nodesRes.code !== 200) {
            list.innerHTML = '<div class="gfy-error">' + esc((nodesRes && nodesRes.msg) || '权限节点加载失败：需要 admin.permission.view') + '</div>';
            return;
        }
        this._nodes = nodesRes.data || [];
        if (!rulesRes || rulesRes.code !== 200) {
            list.innerHTML = '<div class="gfy-error">' + esc((rulesRes && rulesRes.msg) || '权限规则加载失败') + '</div>';
            return;
        }
        this._applyRules(rulesRes.data || []);
        this._renderNodes();
        this._renderSummary();
    }

    _applyRules(rules) {
        var self = this;
        rules.forEach(function (r) {
            var cat = String(r.category || '');
            var act = String(r.action || '');
            var wildcard = String(r.target) !== '*' || String(r.level) !== '*' || cat === '*' || act === '*';
            if (wildcard) { self._passthrough.push(r); return; }
            if (r.state === 'allow' || r.state === 'deny') self._managed.set(ruleKey(cat, act), r.state);
        });
    }

    _renderNodes() {
        var self = this;
        var list = this._root.querySelector('.perm-list');
        if (!this._nodes.length) { list.innerHTML = '<div class="gfy-empty">没有可编辑的权限节点</div>'; return; }
        var groups = {};
        this._nodes.forEach(function (n) {
            var m = n.module || 'other';
            (groups[m] = groups[m] || []).push(n);
        });
        var html = '';
        Object.keys(groups).forEach(function (m) {
            html += '<div class="perm-group"><div class="perm-group-head">' + esc(moduleLabel(m)) + '（' + groups[m].length + '）</div>';
            groups[m].forEach(function (n) {
                var code = String(n.node_code || '');
                var dot = code.lastIndexOf('.');
                var cat = dot > 0 ? code.slice(0, dot) : code;
                var act = dot > 0 ? code.slice(dot + 1) : '';
                var key = ruleKey(cat, act);
                var current = self._managed.get(key) || 'inherit';
                html += '<div class="perm-row" data-cat="' + esc(cat) + '" data-act="' + esc(act) + '">'
                    + '<span class="perm-code" title="' + esc(code) + '">' + esc(code) + '</span>'
                    + '<span class="perm-name" title="' + esc(n.display_name || '') + '">' + esc(n.display_name || '') + '</span>'
                    + '<span class="perm-states">';
                STATES.forEach(function (st) {
                    html += '<button type="button" class="perm-state" data-cat="' + esc(cat) + '" data-act="' + esc(act) + '" data-state="' + st + '" aria-pressed="' + (current === st) + '"'
                        + (self.readOnly ? ' disabled' : '') + '>' + STATE_TEXT[st] + '</button>';
                });
                html += '</span></div>';
            });
            html += '</div>';
        });
        list.innerHTML = html;
        if (this.readOnly) this._root.querySelector('.perm-save').disabled = true;
    }

    _renderStates() {
        var self = this;
        this._root.querySelectorAll('.perm-row').forEach(function (row) {
            var cat = row.getAttribute('data-cat');
            var act = row.getAttribute('data-act');
            var current = self._managed.get(ruleKey(cat, act)) || 'inherit';
            row.querySelectorAll('.perm-state').forEach(function (btn) {
                btn.setAttribute('aria-pressed', String(btn.getAttribute('data-state') === current));
            });
        });
    }

    _renderSummary() {
        if (!this._root) return;
        var allow = 0, deny = 0;
        this._managed.forEach(function (v) { if (v === 'allow') allow++; else if (v === 'deny') deny++; });
        var parts = ['允许 ' + allow, '拒绝 ' + deny, '继承 ' + (this._nodes.length - allow - deny)];
        if (this._passthrough.length) parts.push('不可编辑规则 ' + this._passthrough.length);
        this._root.querySelector('.perm-summary').textContent = parts.join(' · ');
        this._root.querySelector('.perm-save').disabled = this.readOnly || !this._dirty || this._loading;
    }

    _collectRules() {
        var rules = this._passthrough.slice();
        this._managed.forEach(function (state, key) {
            var dot = key.lastIndexOf('.');
            rules.push({ target: '*', level: '*', category: key.slice(0, dot), action: key.slice(dot + 1), state: state });
        });
        return rules;
    }

    async save() {
        if (this.readOnly || !this._dirty) return;
        var btn = this._root.querySelector('.perm-save');
        btn.disabled = true;
        var body = { scope: this.scope, rules: this._collectRules() };
        if (this.scope === 'content') {
            body.object_type = this.mount.object_type;
            body.object_id = this.mount.object_id;
        } else {
            body.scope_id = this.mount.scope_id;
        }
        var res = await api('/api/v0/admin/permission-rules', { method: 'POST', body: body, headers: this.headers, silent: true });
        if (res && res.code === 200) {
            this._dirty = false;
            toast((res.data && res.data.saved !== undefined ? '已保存 ' + res.data.saved + ' 条规则' : '保存成功'), 'success');
            this.dispatchEvent(new CustomEvent('gfy-saved', { bubbles: true, detail: res.data || {} }));
            await this.reload();
        } else {
            toast((res && res.msg) || '保存失败', 'error');
            btn.disabled = false;
        }
    }

    getRules() { return this._collectRules(); }
}

if (!customElements.get('gfy-permission-editor')) customElements.define('gfy-permission-editor', GfyPermissionEditor);

window.GfyPermissionEditor = GfyPermissionEditor;
export { GfyPermissionEditor };
