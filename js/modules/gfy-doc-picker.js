/**
 * js/modules/gfy-doc-picker.js
 * <gfy-doc-picker>：文档选择模块（可用于批量操作、封面挑选、权限规则挂载等）。
 *
 * 用法：
 *   <gfy-doc-picker scope="public" mode="card" multiple="true"></gfy-doc-picker>
 *   <gfy-doc-picker scope="private" folder-id="-1" size="20" selected="3,9"></gfy-doc-picker>
 *
 * 属性：scope(public|private|group) / folder-id（默认 -1 = 全部，0 = 根目录）
 *       / size（默认 20）/ multiple（默认 true）/ selected（逗号分隔 id）
 *       / title / mode(card|inline)
 * 事件：gfy-change  detail = { ids: number[], items: [{id,title,slug}] }
 * 方法：getSelection() / setSelection(ids) / reload()
 */
import { esc, api, injectStyles, debounce, GfyElement, BASE_CSS } from './shared.js';

const CSS = BASE_CSS + `
.pick-search{display:flex;gap:8px;margin-bottom:10px}
.pick-list{max-height:340px;overflow:auto;border:1px solid var(--color-border,#a7f3d0);border-radius:var(--radius-md,8px)}
.pick-row{display:flex;gap:10px;padding:9px 11px;border-bottom:1px solid var(--color-border,#a7f3d0);cursor:pointer}
.pick-row:last-child{border-bottom:0}
.pick-row:hover{background:var(--color-bg-hover,rgba(0,0,0,.04))}
.pick-row input{margin-top:3px}
.pick-main{min-width:0;flex:1}
.pick-name{font-weight:600;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pick-sum{color:var(--color-text-muted,#036b4d);font-size:12px;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.pick-foot{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.pick-foot .gfy-muted{flex:1}
.pick-tag{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--color-bg-secondary,#f0fdf4);color:var(--color-text-muted,#036b4d)}
`;

class GfyDocPicker extends GfyElement {
    constructor() {
        super();
        this._items = [];
        this._selected = new Map();
        this._page = 1;
        this._hasMore = false;
        this._keyword = '';
        this._loading = false;
        this._bound = false;
    }

    get multiple() { return this.getAttribute('multiple') !== 'false'; }

    get scope() {
        var s = (this.getAttribute('scope') || 'public').trim();
        return ['public', 'private', 'group'].indexOf(s) >= 0 ? s : 'public';
    }

    get folderId() {
        var raw = (this.getAttribute('folder-id') || '-1').trim();
        return /^-?\d+$/.test(raw) ? raw : '-1';
    }

    get size() {
        var n = parseInt(this.getAttribute('size') || '20', 10);
        return n > 0 && n <= 100 ? n : 20;
    }

    render() {
        var self = this;
        injectStyles(this.shadowRoot, CSS);
        this._root = document.createElement('div');
        this._root.className = 'gfy-card';
        this._root.innerHTML = ''
            + '<div class="gfy-head"><span class="gfy-title">' + esc(this.getAttribute('title') || '选择文档') + '</span>'
            + '<button type="button" class="gfy-btn pick-reload">刷新</button></div>'
            + '<div class="gfy-body">'
            + '<div class="pick-search"><input type="search" class="gfy-input pick-keyword" placeholder="在已加载结果中过滤…">'
            + '<button type="button" class="gfy-btn pick-clear">清空</button></div>'
            + '<div class="pick-list"><div class="gfy-skel" style="width:70%"></div><div class="gfy-skel" style="width:88%"></div></div>'
            + '<div class="pick-foot"><span class="gfy-muted pick-count">未选择</span>'
            + '<button type="button" class="gfy-btn pick-more" hidden>加载更多</button></div>'
            + '</div>';
        this.shadowRoot.appendChild(this._root);
        this._bind();
        var preset = (this.getAttribute('selected') || '').split(',');
        preset.forEach(function (raw) {
            if (/^\d+$/.test(raw.trim())) self._selected.set(parseInt(raw.trim(), 10), { id: parseInt(raw.trim(), 10), title: '#' + raw.trim(), slug: '' });
        });
        this._renderCount();
        this.reload();
        return Promise.resolve();
    }

    _bind() {
        if (this._bound) return;
        this._bound = true;
        var self = this;
        this._root.querySelector('.pick-reload').addEventListener('click', function () { self.reload(); });
        this._root.querySelector('.pick-clear').addEventListener('click', function () {
            self._selected.clear();
            self._renderList();
            self._renderCount();
            self._emit();
        });
        this._root.querySelector('.pick-keyword').addEventListener('input', debounce(function (e) {
            self._keyword = (e.target.value || '').trim().toLowerCase();
            self._renderList();
        }, 200));
        this._root.querySelector('.pick-more').addEventListener('click', function () { self._load(self._page + 1); });
        this._root.querySelector('.pick-list').addEventListener('click', function (e) {
            var row = e.target.closest('.pick-row');
            if (!row) return;
            var id = parseInt(row.getAttribute('data-id'), 10);
            if (!Number.isFinite(id)) return;
            var item = self._items.filter(function (it) { return it.id === id; })[0] || { id: id, title: '#' + id, slug: '' };
            if (self._selected.has(id)) self._selected.delete(id);
            else {
                if (!self.multiple) self._selected.clear();
                self._selected.set(id, { id: id, title: item.title, slug: item.slug });
            }
            self._renderList();
            self._renderCount();
            self._emit();
        });
        var input = this._root.querySelector('.pick-keyword');
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                var visible = self._visibleItems();
                if (visible.length === 1) {
                    var only = visible[0];
                    if (!self._selected.has(only.id)) {
                        if (!self.multiple) self._selected.clear();
                        self._selected.set(only.id, { id: only.id, title: only.title, slug: only.slug });
                        self._renderList(); self._renderCount(); self._emit();
                    }
                }
            }
        });
    }

    _visibleItems() {
        var kw = this._keyword;
        if (!kw) return this._items;
        return this._items.filter(function (it) {
            return (String(it.title || '') + ' ' + String(it.summary || '')).toLowerCase().indexOf(kw) >= 0;
        });
    }

    _renderList() {
        if (!this._root) return;
        var self = this;
        var list = this._root.querySelector('.pick-list');
        var items = this._visibleItems();
        if (!items.length) {
            list.innerHTML = '<div class="gfy-empty">' + (this._items.length ? '没有匹配的文档' : '没有可用文档') + '</div>';
            return;
        }
        list.innerHTML = items.map(function (it) {
            var checked = self._selected.has(it.id) ? ' checked' : '';
            return '<label class="pick-row" data-id="' + it.id + '">'
                + '<input type="checkbox"' + checked + ' tabindex="-1">'
                + '<span class="pick-main"><span class="pick-name">' + esc(it.title || ('#' + it.id)) + '</span>'
                + '<span class="pick-sum">' + esc(it.summary || '（无简介）') + '</span></span>'
                + '<span class="pick-tag">' + esc(it.visibility === 'public' ? '公共' : (it.visibility === 'group' ? '组' : '私有')) + '</span>'
                + '</label>';
        }).join('');
    }

    _renderCount() {
        if (!this._root) return;
        var el = this._root.querySelector('.pick-count');
        var ids = Array.from(this._selected.keys());
        el.textContent = ids.length ? ('已选择 ' + ids.length + ' 篇：' + ids.slice(0, 5).map(function (id) { return '#' + id; }).join('、') + (ids.length > 5 ? ' …' : '')) : '未选择';
        var more = this._root.querySelector('.pick-more');
        more.hidden = !this._hasMore;
    }

    _emit() {
        var ids = Array.from(this._selected.keys());
        var items = ids.map(function (id) { return this._selected.get(id); }, this);
        this.dispatchEvent(new CustomEvent('gfy-change', { bubbles: true, detail: { ids: ids, items: items } }));
    }

    async reload() {
        this._items = [];
        this._page = 1;
        this._hasMore = false;
        await this._load(1);
    }

    async _load(page) {
        if (!this._root || this._loading) return;
        this._loading = true;
        var self = this;
        var list = this._root.querySelector('.pick-list');
        if (page === 1) {
            list.innerHTML = '<div class="gfy-skel" style="width:70%"></div><div class="gfy-skel" style="width:88%"></div>';
        }
        var res = await api('/api/v0/document/list', {
            params: { scope: this.scope, folder_id: this.folderId, page: page, size: this.size },
            silent: true,
        });
        this._loading = false;
        if (!res || res.code !== 200 || !res.data) {
            list.innerHTML = '<div class="gfy-error">' + esc((res && res.msg) || '加载失败：请确认已登录') + '</div>';
            return;
        }
        var newItems = res.data.items || [];
        this._page = page;
        if (page === 1) this._items = newItems;
        else this._items = this._items.concat(newItems);
        this._items.forEach(function (it) {
            if (self._selected.has(it.id)) self._selected.set(it.id, { id: it.id, title: it.title, slug: it.slug });
        });
        this._hasMore = !!res.data.has_more;
        this._renderList();
        this._renderCount();
        this.dispatchEvent(new CustomEvent('gfy-loaded', { bubbles: true, detail: { total: res.data.total, items: this._items.length } }));
    }

    getSelection() { return Array.from(this._selected.values()); }

    setSelection(ids) {
        this._selected.clear();
        (ids || []).forEach(function (id) {
            var n = parseInt(id, 10);
            if (Number.isFinite(n)) this._selected.set(n, { id: n, title: '#' + n, slug: '' });
        }, this);
        this._renderList(); this._renderCount(); this._emit();
    }
}

if (!customElements.get('gfy-doc-picker')) customElements.define('gfy-doc-picker', GfyDocPicker);

window.GfyDocPicker = GfyDocPicker;
export { GfyDocPicker };
