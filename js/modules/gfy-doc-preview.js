/**
 * js/modules/gfy-doc-preview.js
 * <gfy-doc-preview>：文档快速查看模块。
 *
 * 用法：
 *   <gfy-doc-preview slug="welcome-gwl" mode="card"></gfy-doc-preview>
 *   <gfy-doc-preview doc-id="12" mode="inline"></gfy-doc-preview>
 *   <gfy-doc-preview slug="..." open-link="false" height="360"></gfy-doc-preview>
 *
 * 属性：slug / doc-id / title / mode(card|inline) / height / show-meta(false 关闭) / open-link(false 关闭)
 * 静态方法：GfyDocPreview.open({ slug, id, title }) → 弹窗快速查看（返回 Promise<boolean>）
 */
import { esc, api, injectStyles, renderMarkdown, GfyElement, BASE_CSS } from './shared.js';

const CSS = BASE_CSS + `
.gfy-open{white-space:nowrap;text-decoration:none}
.preview-meta{display:flex;flex-wrap:wrap;gap:10px;color:var(--color-text-muted,#036b4d);font-size:12px;margin-bottom:10px}
.preview-body{overflow:auto}
:host([mode="inline"]) .gfy-head{border-bottom:0;padding-top:0}
`;

const EMPTY_TEXT = '未指定文档（给组件加上 slug 或 doc-id 属性）';

function fmtDate(value) {
    if (!value) return '';
    var s = String(value);
    return s.length >= 10 ? s.slice(0, 10) : s;
}

class GfyDocPreview extends GfyElement {
    static get observedAttributes() {
        return ['slug', 'doc-id', 'title', 'show-meta', 'open-link', 'height'];
    }

    attributeChangedCallback() {
        if (this._rendered) this.reload();
    }

    get slug() { return (this.getAttribute('slug') || '').trim(); }

    get docId() {
        var raw = (this.getAttribute('doc-id') || '').trim();
        return /^\d+$/.test(raw) ? raw : '';
    }

    render() {
        var self = this;
        injectStyles(this.shadowRoot, CSS);
        this._root = document.createElement('div');
        this._root.className = 'gfy-card';
        this._root.innerHTML = ''
            + '<div class="gfy-head">'
            + '<span class="gfy-title">文档</span>'
            + '<a class="gfy-open gfy-btn" target="_blank" rel="noopener noreferrer" hidden>打开全文</a>'
            + '</div>'
            + '<div class="gfy-body"><div class="preview-meta" hidden></div>'
            + '<div class="preview-body"><div class="gfy-skel" style="width:60%"></div>'
            + '<div class="gfy-skel" style="width:92%"></div><div class="gfy-skel" style="width:85%"></div></div></div>';
        this.shadowRoot.appendChild(this._root);
        this.reload();
        return Promise.resolve();
    }

    _linkFor(data) {
        if (this.getAttribute('open-link') === 'false') return '';
        var base = typeof window.BASE_PATH === 'string' ? window.BASE_PATH : '.';
        var slug = (data && data.slug) || this.slug;
        if (slug) return base + '/document.html?slug=' + encodeURIComponent(slug);
        if (data && data.id !== undefined && data.id !== null) return base + '/document.html?id=' + encodeURIComponent(data.id);
        return '';
    }

    async reload() {
        if (!this._root) return;
        var titleEl = this._root.querySelector('.gfy-title');
        var metaEl = this._root.querySelector('.preview-meta');
        var bodyEl = this._root.querySelector('.preview-body');
        var linkEl = this._root.querySelector('.gfy-open');
        var slug = this.slug;
        var id = this.docId;
        if (!slug && !id) {
            titleEl.textContent = this.getAttribute('title') || '文档';
            bodyEl.innerHTML = '<div class="gfy-empty">' + esc(EMPTY_TEXT) + '</div>';
            return;
        }
        bodyEl.innerHTML = '<div class="gfy-skel" style="width:60%"></div><div class="gfy-skel" style="width:92%"></div>';
        var res = await api('/api/v0/document/' + encodeURIComponent(slug || id), { silent: true });
        if (!res) {
            bodyEl.innerHTML = '<div class="gfy-error">加载失败：请确认已登录且文档存在（或当前账号无权查看）</div>';
            this.dispatchEvent(new CustomEvent('gfy-error', { bubbles: true, detail: { slug: slug, id: id } }));
            return;
        }
        if (res.code !== 200 || !res.data) {
            bodyEl.innerHTML = '<div class="gfy-error">' + esc(res.msg || '无法加载文档') + '</div>';
            return;
        }
        var data = res.data;
        this.data = data;
        titleEl.textContent = this.getAttribute('title') || data.title || '文档';
        var meta = [];
        if (this.getAttribute('show-meta') !== 'false') {
            if (data.author_username) meta.push('作者：' + data.author_username);
            if (data.folder_name) meta.push('目录：' + data.folder_name);
            if (data.updated_at) meta.push('更新：' + fmtDate(data.updated_at));
            if (data.view_count !== undefined && data.view_count !== null) meta.push('浏览：' + data.view_count);
        }
        metaEl.innerHTML = meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('');
        metaEl.hidden = !meta.length;
        bodyEl.innerHTML = '<div class="md">' + renderMarkdown(data.content || '') + '</div>';
        var h = parseInt(this.getAttribute('height') || '0', 10);
        bodyEl.style.maxHeight = h > 0 ? h + 'px' : '';
        var href = this._linkFor(data);
        if (href) { linkEl.href = href; linkEl.hidden = false; }
        else { linkEl.hidden = true; }
        this.dispatchEvent(new CustomEvent('gfy-loaded', { bubbles: true, detail: { slug: data.slug, id: data.id } }));
    }

    /** 弹窗快速查看（不离开当前页面） */
    static open(options) {
        options = options || {};
        var M = window.Modal;
        if (!M || typeof M._createModal !== 'function') {
            if (options.slug) window.open((window.BASE_PATH || '.') + '/document.html?slug=' + encodeURIComponent(options.slug));
            return Promise.resolve(false);
        }
        return new Promise(function (resolve) {
            var modal = M._createModal({
                title: options.title || '文档快速查看',
                content: '<div class="gfy-modal-host"></div>',
                buttons: [{ text: '关闭', cls: 'modal-btn-cancel', onClick: function () { M._closeModal(modal); resolve(true); } }],
            });
            M._showModal(modal);
            var host = modal.querySelector('.gfy-modal-host');
            if (host) {
                var view = document.createElement('gfy-doc-preview');
                view.setAttribute('mode', 'inline');
                view.setAttribute('open-link', 'false');
                if (options.slug) view.setAttribute('slug', options.slug);
                if (options.id !== undefined && options.id !== null) view.setAttribute('doc-id', String(options.id));
                if (options.title) view.setAttribute('title', options.title);
                host.appendChild(view);
            }
        });
    }
}

if (!customElements.get('gfy-doc-preview')) customElements.define('gfy-doc-preview', GfyDocPreview);

window.GfyDocPreview = GfyDocPreview;
export { GfyDocPreview };
