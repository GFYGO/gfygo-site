/**
 * permission-picker.js - LuckPerms 风格图形化权限节点编辑器
 *
 * Features:
 *   - 树形权限节点浏览器（按模块/命名空间分组）
 *   - 搜索过滤
 *   - 三态切换（允许/继承/禁止）
 *   - 等级选择器（Lv1-Lv5）
 *   - 批量操作（全选、清除、复制等级）
 *   - 实时状态可视化
 *
 * Usage:
 *   const picker = new PermissionPicker(container, {
 *     value: { 'admin.notify.view': 'allow' },
 *     level: 5,
 *     showLevelSelector: true,
 *     showSearch: true,
 *     allowSingleSelect: false,
 *     onChange: (state) => { ... }
 *   });
 *   picker.load();
 */

class PermissionPicker {
    constructor(container, options) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;
        this.options = Object.assign({
            value: {},
            level: null,
            showLevelSelector: true,
            showSearch: true,
            allowSingleSelect: false,
            showBulkOps: true,
            title: '权限节点',
            apiUrl: (window.API_BASE_URL || '') + '/api/v1/user/admin/permission-nodes',
            onChange: null,
        }, options || {});

        this.state = {};
        if (this.options.value && typeof this.options.value === 'object') {
            this.state = Object.assign({}, this.options.value);
        }
        this.level = this.options.level;
        this.nodes = [];
        this.tree = {};
        this.filteredNodes = null;
    }

    async load() {
        this.container.innerHTML = '<div class="pp-loading"><div class="pp-spinner"></div><span>加载权限节点...</span></div>';
        try {
            const token = (window.AuthGuard && window.AuthGuard.getToken)
                ? (window.AuthGuard.getToken() || '')
                : '';

            if (!token) {
                this.container.innerHTML = '<div class="pp-error">未登录，请先登录系统</div>';
                if (window.AuthGuard) window.AuthGuard.handleAuthError();
                return this;
            }

            const headers = { 'Authorization': 'Bearer ' + token };
            const res = await fetch(this.options.apiUrl, { headers });

            if (res.status === 401 || res.status === 422) {
                if (window.AuthGuard) window.AuthGuard.handleAuthError();
                this.container.innerHTML = '<div class="pp-error">登录状态已失效，请重新登录</div>';
                return this;
            }

            if (res.status === 403) {
                this.container.innerHTML = '<div class="pp-error">权限不足，无法查看权限节点</div>';
                return this;
            }

            if (!res.ok) {
                let msg = '加载权限节点失败 (HTTP ' + res.status + ')';
                try {
                    const errData = await res.json();
                    if (errData && errData.msg) msg = errData.msg;
                } catch (_) {}
                this.container.innerHTML = '<div class="pp-error">' + msg + '</div>';
                return this;
            }

            const d = await res.json();
            if (d.code === 200 && d.data) {
                this.nodes = d.data;
                this.buildTree();
                this.render();
            } else {
                this.container.innerHTML = '<div class="pp-error">' + (d.msg || '加载权限节点失败') + '</div>';
            }
        } catch (e) {
            this.container.innerHTML = '<div class="pp-error">网络请求失败：' + (e.message || '未知错误') + '</div>';
        }
        return this;
    }

    buildTree() {
        this.tree = {};
        for (const node of this.nodes) {
            const parts = (node.node_code || '').split('.');
            let cursor = this.tree;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!cursor[part]) {
                    cursor[part] = {
                        _children: {},
                        _leaf: null,
                    };
                }
                if (i === parts.length - 1) {
                    cursor[part]._leaf = node;
                }
                cursor = cursor[part]._children;
            }
        }
    }

    render() {
        this.container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'pp-root';

        if (this.options.title) {
            const title = document.createElement('div');
            title.className = 'pp-title-bar';
            title.innerHTML = '<span class="pp-title">' + this._escape(this.options.title) + '</span>' +
                '<span class="pp-selected-count" id="ppCount">已选 0 项</span>';
            wrapper.appendChild(title);
        }

        if (this.options.showSearch) {
            const search = document.createElement('div');
            search.className = 'pp-search';
            search.innerHTML = '<input type="text" placeholder="搜索权限节点..." id="ppSearchInput">' +
                '<button class="pp-search-clear" id="ppSearchClear" style="display:none">✕</button>';
            wrapper.appendChild(search);

            const searchInput = search.querySelector('#ppSearchInput');
            const searchClear = search.querySelector('#ppSearchClear');

            searchInput.addEventListener('input', () => {
                const q = searchInput.value.toLowerCase().trim();
                this.filteredNodes = q ? this.filterNodes(q) : null;
                this.renderTree(wrapper);
                searchClear.style.display = q ? 'inline' : 'none';
            });

            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                this.filteredNodes = null;
                this.renderTree(wrapper);
                searchClear.style.display = 'none';
                searchInput.focus();
            });
        }

        if (this.options.showLevelSelector) {
            const levelBar = document.createElement('div');
            levelBar.className = 'pp-level-bar';
            levelBar.innerHTML = '<span class="pp-level-label">等级:</span>' +
                '<div class="pp-level-selector" id="ppLevelSelector">' +
                '<button class="pp-level-btn" data-level="1">Lv1</button>' +
                '<button class="pp-level-btn" data-level="2">Lv2</button>' +
                '<button class="pp-level-btn" data-level="3">Lv3</button>' +
                '<button class="pp-level-btn" data-level="4">Lv4</button>' +
                '<button class="pp-level-btn" data-level="5">Lv5</button>' +
                '</div>';
            wrapper.appendChild(levelBar);

            const levelSelector = levelBar.querySelector('#ppLevelSelector');
            const levelButtons = levelSelector.querySelectorAll('.pp-level-btn');

            if (this.level !== null) {
                this._highlightLevel(levelButtons);
            }

            levelButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    this.level = parseInt(btn.dataset.level);
                    this._highlightLevel(levelButtons);
                    this.renderTree(wrapper);
                    this._onChange();
                });
            });
        }

        if (this.options.showBulkOps) {
            const ops = document.createElement('div');
            ops.className = 'pp-bulk-ops';
            ops.innerHTML =
                '<button class="pp-bulk-btn" data-op="expand">展开全部</button>' +
                '<button class="pp-bulk-btn" data-op="collapse">收起全部</button>' +
                '<span class="pp-bulk-divider"></span>' +
                '<button class="pp-bulk-btn" data-op="allow-all">全部允许</button>' +
                '<button class="pp-bulk-btn" data-op="inherit-all">全部继承</button>' +
                '<button class="pp-bulk-btn" data-op="deny-all">全部禁止</button>' +
                '<button class="pp-bulk-btn" data-op="clear">清除选择</button>';
            wrapper.appendChild(ops);

            ops.querySelectorAll('.pp-bulk-btn').forEach(btn => {
                btn.addEventListener('click', () => this._handleBulkOp(btn.dataset.op, wrapper));
            });
        }

        const treeContainer = document.createElement('div');
        treeContainer.className = 'pp-tree';
        wrapper.appendChild(treeContainer);

        this._renderTreeInto(treeContainer);

        this.container.appendChild(wrapper);
        this._updateCount();
    }

    _highlightLevel(buttons) {
        buttons.forEach(btn => {
            if (parseInt(btn.dataset.level) === this.level) {
                btn.classList.add('pp-level-btn--active');
            } else {
                btn.classList.remove('pp-level-btn--active');
            }
        });
    }

    _renderTreeInto(container) {
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'pp-tree-root';
        this._renderTreeNode(this.tree, '', root);
        container.appendChild(root);

        if (!this.nodes.length) {
            container.innerHTML = '<div class="pp-empty">暂无权限节点</div>';
        }
    }

    _renderTreeNode(node, path, container) {
        const keys = Object.keys(node._children || {}).sort();

        for (const key of keys) {
            const child = node._children[key];
            const childPath = path ? (path + '.' + key) : key;
            const hasChildren = Object.keys(child._children || {}).length > 0;
            const isLeaf = child._leaf !== null;

            if (isLeaf && !hasChildren) {
                this._renderLeaf(childPath, child._leaf, container);
            } else {
                const groupEl = document.createElement('div');
                groupEl.className = 'pp-group';
                groupEl.dataset.path = childPath;

                const header = document.createElement('div');
                header.className = 'pp-group-header';
                header.innerHTML =
                    '<span class="pp-arrow">▶</span>' +
                    '<span class="pp-group-name">' + this._escape(key) + '</span>' +
                    '<span class="pp-group-count" id="cnt_' + this._hashPath(childPath) + '"></span>';

                header.addEventListener('click', (e) => {
                    if (e.target.closest('.pp-node-row')) return;
                    groupEl.classList.toggle('pp-group--open');
                    this._updateGroupCount(childPath);
                });

                const body = document.createElement('div');
                body.className = 'pp-group-body';

                this._renderTreeNode(child, childPath, body);

                groupEl.appendChild(header);
                groupEl.appendChild(body);
                container.appendChild(groupEl);

                // Auto-expand root groups
                if (path === '') {
                    groupEl.classList.add('pp-group--open');
                }

                this._updateGroupCount(childPath);
            }
        }
    }

    _renderLeaf(nodeCode, nodeData, container) {
        const currentState = this.state[nodeCode] || 'inherit';

        const row = document.createElement('div');
        row.className = 'pp-node-row pp-node-row--' + currentState;
        row.dataset.nodeCode = nodeCode;

        const displayName = nodeData.display_name || nodeCode;
        const moduleLabel = nodeData.module || '';

        row.innerHTML =
            '<span class="pp-node-icon">' + this._getStateIcon(currentState) + '</span>' +
            '<span class="pp-node-info">' +
            '<span class="pp-node-name">' + this._escape(displayName) + '</span>' +
            '<span class="pp-node-code">' + this._escape(nodeCode) + '</span>' +
            (nodeData.description ? '<span class="pp-node-desc">' + this._escape(nodeData.description) + '</span>' : '') +
            '</span>' +
            '<span class="pp-node-actions">' +
            '<button class="pp-state-btn pp-state-btn--allow" data-state="allow" title="允许">✓</button>' +
            '<button class="pp-state-btn pp-state-btn--inherit" data-state="inherit" title="继承">○</button>' +
            '<button class="pp-state-btn pp-state-btn--deny" data-state="deny" title="禁止">✗</button>' +
            '</span>';

        // Highlight current state button
        row.querySelectorAll('.pp-state-btn').forEach(btn => {
            if (btn.dataset.state === currentState) {
                btn.classList.add('pp-state-btn--active');
            }
        });

        row.querySelectorAll('.pp-state-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newState = btn.dataset.state;
                this._setNodeState(nodeCode, newState);
                this._updateNodeRow(row, nodeCode, newState);
                this._updateCount();
                this._updateParentCounts(row);
                this._onChange();
            });
        });

        // Click row cycle: inherit -> allow -> deny -> inherit
        row.addEventListener('click', (e) => {
            if (e.target.closest('.pp-state-btn')) return;
            if (this.options.allowSingleSelect) {
                // Single select mode: only allow/inherit
                const cycle = { 'inherit': 'allow', 'allow': 'inherit', 'deny': 'inherit' };
                const next = cycle[currentState] || 'allow';
                this._setNodeState(nodeCode, next);
                this._updateNodeRow(row, nodeCode, next);
                this._updateCount();
                this._updateParentCounts(row);
                this._onChange();
            }
        });

        container.appendChild(row);
    }

    _updateNodeRow(row, nodeCode, state) {
        row.className = 'pp-node-row pp-node-row--' + state;
        row.querySelector('.pp-node-icon').textContent = this._getStateIcon(state);
        row.querySelectorAll('.pp-state-btn').forEach(btn => {
            btn.classList.toggle('pp-state-btn--active', btn.dataset.state === state);
        });
    }

    _setNodeState(nodeCode, state) {
        if (state === 'inherit') {
            delete this.state[nodeCode];
        } else {
            this.state[nodeCode] = state;
        }
    }

    _getStateIcon(state) {
        switch (state) {
            case 'allow': return '✓';
            case 'deny': return '✗';
            default: return '○';
        }
    }

    _updateGroupCount(path) {
        const countEl = document.getElementById('cnt_' + this._hashPath(path));
        if (!countEl) return;

        let count = 0;
        const prefix = path + '.';
        for (const code in this.state) {
            if (code.startsWith(prefix)) {
                count++;
            }
        }
        if (count > 0) {
            countEl.textContent = count + ' 项';
            countEl.style.display = 'inline';
        } else {
            countEl.style.display = 'none';
        }
    }

    _updateParentCounts(row) {
        let parent = row.closest('.pp-group');
        while (parent) {
            const path = parent.dataset.path;
            if (path) this._updateGroupCount(path);
            parent = parent.parentElement ? parent.parentElement.closest('.pp-group') : null;
        }
    }

    _updateCount() {
        const countEl = document.getElementById('ppCount');
        if (countEl) {
            const count = Object.keys(this.state).length;
            countEl.textContent = '已选 ' + count + ' 项';
        }
    }

    _handleBulkOp(op, wrapper) {
        switch (op) {
            case 'expand':
                this.container.querySelectorAll('.pp-group').forEach(g => g.classList.add('pp-group--open'));
                break;
            case 'collapse':
                this.container.querySelectorAll('.pp-group').forEach(g => g.classList.remove('pp-group--open'));
                break;
            case 'allow-all':
                this._bulkSetAll('allow');
                break;
            case 'inherit-all':
                this._bulkSetAll('inherit');
                break;
            case 'deny-all':
                this._bulkSetAll('deny');
                break;
            case 'clear':
                this.state = {};
                break;
        }
        this._renderTreeInto(wrapper.querySelector('.pp-tree'));
        this._updateCount();
        this._onChange();
    }

    _bulkSetAll(state) {
        if (state === 'inherit') {
            this.state = {};
        } else {
            for (const node of this.nodes) {
                this.state[node.node_code] = state;
            }
        }
    }

    filterNodes(query) {
        const q = query.toLowerCase();
        return this.nodes.filter(n => {
            const code = (n.node_code || '').toLowerCase();
            const name = (n.display_name || '').toLowerCase();
            const desc = (n.description || '').toLowerCase();
            return code.includes(q) || name.includes(q) || desc.includes(q);
        });
    }

    _hashPath(path) {
        let hash = 0;
        for (let i = 0; i < path.length; i++) {
            hash = ((hash << 5) - hash) + path.charCodeAt(i);
            hash |= 0;
        }
        return 'g_' + Math.abs(hash);
    }

    getValue() {
        return Object.assign({}, this.state);
    }

    getNodesList() {
        return Object.keys(this.state);
    }

    getLevel() {
        return this.level;
    }

    setValue(state) {
        this.state = {};
        if (state && typeof state === 'object') {
            this.state = Object.assign({}, state);
        }
        if (this.nodes.length > 0) this.render();
    }

    setLevel(level) {
        this.level = level;
        if (this.nodes.length > 0) this.render();
    }

    _onChange() {
        if (typeof this.options.onChange === 'function') {
            this.options.onChange(this.getValue(), this.level);
        }
    }

    _escape(s) {
        const div = document.createElement('div');
        div.textContent = s || '';
        return div.innerHTML;
    }
}

window.PermissionPicker = PermissionPicker;
