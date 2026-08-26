/**
 * permission-picker.js - 权限编辑器（规则模式 + 节点模式）
 *
 * 规则模式（mode:'rules'，默认）：5 字段规则列表 <对象id>.<级别>.<类别>.<权限>.<状态>
 *   - 各字段可用 '*' 通配；类别/权限从节点字典下拉
 *   - getRules() / setRules(rules) / getValue()(规则数组)
 *
 * 节点模式（mode:'node'，兼容 admin-menu 单节点选择）：节点树 → getValue() 返回 {node_code: state}
 */
(function() {
    if (window.__PermissionPickerLoaded) return;
    window.__PermissionPickerLoaded = true;

    var AuthGuard = window.AuthGuard;
    var API_BASE_URL = window.API_BASE_URL;

    const LEVEL_OPTS = ['*', '1', '2', '3', '4', '5'];
    const STATE_OPTS = ['allow', 'deny'];
    const STATE_LABEL = { allow: '允许', deny: '禁止' };

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    class PermissionPicker {
        constructor(container, options) {
            this.container = typeof container === 'string'
                ? document.querySelector(container)
                : container;
            this.options = Object.assign({
                mode: 'rules',          // 'rules' | 'node'
                rules: [],              // 规则模式初始值 [{target,level,category,action,state}]
                value: {},              // 节点模式初始值 {node_code: 'allow'}
                allowSingleSelect: false,
                title: '权限编辑器',
                apiUrl: API_BASE_URL + '/api/v0/admin/permission-nodes',
                onChange: null,
            }, options || {});

            this.rules = Array.isArray(this.options.rules)
                ? this.options.rules.map(r => Object.assign({}, r))
                : [];
            this.state = Object.assign({}, this.options.value || {});
            this.nodes = [];
            this.loaded = false;
        }

        async load() {
            this.container.innerHTML = '<div class="pp-loading"><span class="pp-spinner"></span><span>加载权限节点...</span></div>';
            try {
                const token = AuthGuard.getToken ? AuthGuard.getToken() : null;
                if (token) {
                    const res = await fetch(this.options.apiUrl, {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (res.ok) {
                        const d = await res.json();
                        if (d.code === 200 && Array.isArray(d.data)) this.nodes = d.data;
                    }
                }
            } catch (e) { /* 网络失败用空字典降级 */ }
            this.loaded = true;
            this._render();
            return this;
        }

        _emit() {
            if (typeof this.options.onChange === 'function') {
                this.options.onChange(this.options.mode === 'node' ? this.getValue() : this.getRules());
            }
        }

        // ================================================
        // 规则模式（5 字段规则列表）
        // ================================================

        _categories() {
            const set = new Set();
            (this.nodes || []).forEach(n => {
                const c = (n.node_code || '').lastIndexOf('.');
                if (c > 0) set.add(n.node_code.slice(0, c));
            });
            return ['*', ...Array.from(set).sort()];
        }

        _actions() {
            const set = new Set();
            (this.nodes || []).forEach(n => {
                const c = (n.node_code || '').lastIndexOf('.');
                if (c > 0) set.add(n.node_code.slice(c + 1));
            });
            return ['*', ...Array.from(set).sort()];
        }

        _renderRulesMode() {
            this.container.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.className = 'pp-root pr-root';

            if (this.options.title) {
                const title = document.createElement('div');
                title.className = 'pp-title-bar';
                title.innerHTML = '<span class="pp-title">' + esc(this.options.title) + '</span>' +
                    '<span class="pp-selected-count" id="ppCount">0 条规则</span>';
                wrap.appendChild(title);
            }

            const ops = document.createElement('div');
            ops.className = 'pp-bulk-ops pr-toolbar';
            ops.innerHTML =
                '<button class="pp-bulk-btn" data-op="add">＋ 添加规则</button>' +
                '<span class="pp-bulk-divider"></span>' +
                '<button class="pp-bulk-btn" data-op="clear">清空</button>' +
                '<span class="pr-hint">格式：&lt;对象id&gt;.&lt;级别&gt;.&lt;类别&gt;.&lt;权限&gt;.&lt;状态&gt;，字段可 *</span>';
            wrap.appendChild(ops);

            const list = document.createElement('div');
            list.className = 'pr-list';
            wrap.appendChild(list);

            const addRow = (rule) => {
                const r = Object.assign({ target: '*', level: '*', category: '*', action: '*', state: 'allow' }, rule || {});
                const row = document.createElement('div');
                row.className = 'pr-row';

                const tInput = document.createElement('input');
                tInput.className = 'pr-fld pr-target';
                tInput.value = r.target || '*';
                tInput.placeholder = '* 或用户/组id';

                const lvSel = this._sel('pr-fld pr-level', LEVEL_OPTS, r.level);
                const catSel = this._sel('pr-fld pr-cat', this._categories(), r.category);
                const actSel = this._sel('pr-fld pr-act', this._actions(), r.action);
                const stSel = this._sel('pr-fld pr-state', STATE_OPTS, r.state, STATE_LABEL);

                const del = document.createElement('button');
                del.className = 'pr-del';
                del.textContent = '✕';
                del.title = '删除该规则（等效于状态设为继承）';
                del.addEventListener('click', () => { row.remove(); this._updateRuleCount(); this._emit(); });

                const sync = () => {
                    const state = stSel.value;
                    if (state === 'inherit' || state === '*') { row.remove(); }
                    this._updateRuleCount();
                    this._emit();
                };
                [tInput, lvSel, catSel, actSel, stSel].forEach(el => el.addEventListener('change', sync));
                tInput.addEventListener('input', () => this._emit());

                row.appendChild(tInput);
                row.appendChild(lvSel);
                row.appendChild(catSel);
                row.appendChild(actSel);
                row.appendChild(stSel);
                row.appendChild(del);
                list.appendChild(row);
            };

            ops.querySelector('[data-op="add"]').addEventListener('click', () => {
                addRow(null);
                this._updateRuleCount();
                this._emit();
            });
            ops.querySelector('[data-op="clear"]').addEventListener('click', () => {
                list.innerHTML = '';
                this._updateRuleCount();
                this._emit();
            });

            (this.rules.length ? this.rules : [{}]).forEach(addRow);
            this.container.appendChild(wrap);
            this._updateRuleCount();
        }

        _sel(cls, values, current, labels) {
            const s = document.createElement('select');
            s.className = cls;
            values.forEach(v => {
                const o = document.createElement('option');
                o.value = v;
                o.textContent = (labels && labels[v]) || v;
                if (String(v) === String(current)) o.selected = true;
                s.appendChild(o);
            });
            return s;
        }

        _readRuleRows() {
            const out = [];
            this.container.querySelectorAll('.pr-row').forEach(row => {
                const target = (row.querySelector('.pr-target').value || '*').trim();
                const level = row.querySelector('.pr-level').value;
                const category = row.querySelector('.pr-cat').value;
                const action = row.querySelector('.pr-act').value;
                const state = row.querySelector('.pr-state').value;
                if (state === 'allow' || state === 'deny') {
                    out.push({ target, level, category, action, state });
                }
            });
            return out;
        }

        _updateRuleCount() {
            const el = document.getElementById('ppCount');
            if (el) el.textContent = this._readRuleRows().length + ' 条规则';
        }

        // ================================================
        // 节点模式（兼容旧：单/多节点选择）
        // ================================================

        _renderNodeMode() {
            this.container.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.className = 'pp-root';

            if (this.options.title) {
                const title = document.createElement('div');
                title.className = 'pp-title-bar';
                title.innerHTML = '<span class="pp-title">' + esc(this.options.title) + '</span>' +
                    '<span class="pp-selected-count" id="ppCount">已选 ' + Object.keys(this.state).length + ' 项</span>';
                wrap.appendChild(title);
            }

            const search = document.createElement('div');
            search.className = 'pp-search';
            search.innerHTML = '<input type="text" placeholder="搜索权限节点..." id="ppSearchInput">';
            wrap.appendChild(search);

            const tree = document.createElement('div');
            tree.className = 'pp-tree';
            wrap.appendChild(tree);

            const renderList = (query) => {
                const q = (query || '').toLowerCase().trim();
                const list = (this.nodes || []).filter(n =>
                    !q || (n.node_code || '').toLowerCase().includes(q) || (n.display_name || '').toLowerCase().includes(q)
                );
                tree.innerHTML = '';
                if (!list.length) {
                    tree.innerHTML = '<div class="pp-empty">暂无权限节点</div>';
                    return;
                }
                // 按 module 分组
                const groups = {};
                list.forEach(n => {
                    const mod = n.module || 'other';
                    (groups[mod] = groups[mod] || []).push(n);
                });
                Object.keys(groups).sort().forEach(mod => {
                    const g = document.createElement('div');
                    g.className = 'pp-group pp-group--open';
                    const header = document.createElement('div');
                    header.className = 'pp-group-header';
                    header.innerHTML = '<span class="pp-arrow">▼</span><span class="pp-group-name">' + esc(mod) + '</span>';
                    header.addEventListener('click', () => g.classList.toggle('pp-group--open'));
                    g.appendChild(header);
                    const body = document.createElement('div');
                    body.className = 'pp-group-body';
                    groups[mod].sort((a, b) => (a.node_code || '').localeCompare(b.node_code || '')).forEach(n => {
                        const st = this.state[n.node_code] || 'inherit';
                        const row = document.createElement('div');
                        row.className = 'pp-node-row pp-node-row--' + st;
                        row.dataset.nodeCode = n.node_code;
                        row.innerHTML =
                            '<span class="pp-node-icon">' + (st === 'allow' ? '✓' : st === 'deny' ? '✗' : '○') + '</span>' +
                            '<span class="pp-node-info"><span class="pp-node-name">' + esc(n.display_name || n.node_code) + '</span>' +
                            '<span class="pp-node-code">' + esc(n.node_code) + '</span></span>';
                        row.addEventListener('click', () => {
                            if (this.options.allowSingleSelect) {
                                this.state = {};
                                this.state[n.node_code] = 'allow';
                            } else {
                                if (this.state[n.node_code] === 'allow') delete this.state[n.node_code];
                                else this.state[n.node_code] = 'allow';
                            }
                            renderList(search.querySelector('input').value);
                            const c = document.getElementById('ppCount');
                            if (c) c.textContent = '已选 ' + Object.keys(this.state).length + ' 项';
                            this._emit();
                        });
                        body.appendChild(row);
                    });
                    g.appendChild(body);
                    tree.appendChild(g);
                });
            };

            search.querySelector('input').addEventListener('input', e => renderList(e.target.value));
            this.container.appendChild(wrap);
            renderList('');
        }

        // ================================================
        // 公共 API
        // ================================================

        getRules() {
            if (this.options.mode === 'rules' && this.container.querySelector('.pr-list')) {
                return this._readRuleRows();
            }
            return this.rules.slice();
        }

        setRules(rules) {
            this.rules = Array.isArray(rules) ? rules.map(r => Object.assign({}, r)) : [];
            if (this.loaded) this._render();
        }

        getValue() {
            if (this.options.mode === 'rules') {
                const arr = this.getRules();
                const map = {};
                arr.forEach(r => {
                    if (r.category !== '*' || r.action !== '*') {
                        map[(r.category === '*' ? '' : r.category + '.') + (r.action === '*' ? '' : r.action) || '*'] = r.state;
                    } else {
                        map['*'] = r.state;
                    }
                });
                return map;
            }
            return Object.assign({}, this.state);
        }

        getNodesList() {
            return this.options.mode === 'rules' ? this.getRules() : Object.keys(this.state);
        }

        setValue(state) {
            this.state = Object.assign({}, state || {});
            if (this.options.mode === 'node' && this.loaded) this._render();
        }
    }

    window.PermissionPicker = PermissionPicker;
})();
