/**
 * permission-picker.js - 图形化权限节点选择器
 * 用于 admin-menu / admin-permissions 等页面的权限节点编辑
 *
 * Usage:
 *   const picker = new PermissionPicker(container, {
 *     value: ['admin.stats.view', 'admin.notify.view'],
 *     onChange: (nodes) => { ... }
 *   });
 *   picker.load(); // 加载权限节点并渲染
 */

class PermissionPicker {
    constructor(container, options) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;
        this.options = Object.assign({
            value: [],
            onChange: null,
            apiUrl: (window.API_BASE_URL || '') + '/api/v1/user/admin/permission-nodes'
        }, options || {});
        this.selected = new Set(this.options.value || []);
        this.nodes = [];
        this.groups = {};
    }

    async load() {
        this.container.innerHTML = '<p class="pp-loading">加载权限节点...</p>';
        try {
            const token = localStorage.getItem('token') || '';
            const res = await fetch(this.options.apiUrl, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const d = await res.json();
            if (d.code === 200 && d.data) {
                this.nodes = d.data;
                this.groupByModule();
                this.render();
            } else {
                this.container.innerHTML = '<p class="pp-error">加载权限节点失败</p>';
            }
        } catch (e) {
            this.container.innerHTML = '<p class="pp-error">加载权限节点失败</p>';
        }
        return this;
    }

    groupByModule() {
        this.groups = {};
        this.nodes.forEach(n => {
            const mod = n.module || 'other';
            if (!this.groups[mod]) this.groups[mod] = [];
            this.groups[mod].push(n);
        });
    }

    render() {
        const modules = Object.keys(this.groups).sort();
        this.container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'pp-wrapper';

        modules.forEach(mod => {
            const section = document.createElement('div');
            section.className = 'pp-section';

            const header = document.createElement('div');
            header.className = 'pp-header';
            const count = this.groups[mod].filter(n => this.selected.has(n.node_code)).length;
            header.innerHTML = '<span class="pp-module-name">' + this._escape(mod) + '</span>'
                + '<span class="pp-module-count">' + count + '/' + this.groups[mod].length + '</span>';
            section.appendChild(header);

            const list = document.createElement('div');
            list.className = 'pp-list';
            this.groups[mod].forEach(n => {
                const item = document.createElement('label');
                item.className = 'pp-item' + (this.selected.has(n.node_code) ? ' pp-item--selected' : '');
                item.innerHTML = '<input type="checkbox" value="' + this._escape(n.node_code) + '"'
                    + (this.selected.has(n.node_code) ? ' checked' : '')
                    + '><span class="pp-item-name">' + this._escape(n.display_name || n.node_code) + '</span>'
                    + (n.description ? '<span class="pp-item-desc">' + this._escape(n.description) + '</span>' : '');
                item.querySelector('input').addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.selected.add(n.node_code);
                    } else {
                        this.selected.delete(n.node_code);
                    }
                    this._onChange();
                    // 更新计数
                    const c = this.groups[mod].filter(x => this.selected.has(x.node_code)).length;
                    header.querySelector('.pp-module-count').textContent = c + '/' + this.groups[mod].length;
                });
                list.appendChild(item);
            });
            section.appendChild(list);
            wrapper.appendChild(section);
        });

        this.container.appendChild(wrapper);
    }

    getValue() {
        return Array.from(this.selected);
    }

    setValue(nodes) {
        this.selected = new Set(nodes || []);
        if (this.nodes.length > 0) this.render();
    }

    _onChange() {
        if (typeof this.options.onChange === 'function') {
            this.options.onChange(this.getValue());
        }
    }

    _escape(s) {
        const div = document.createElement('div');
        div.textContent = s || '';
        return div.innerHTML;
    }
}

window.PermissionPicker = PermissionPicker;
