/**
 * gfygo-site/js/image-lightbox.js
 * 图片灯箱（2026-11-15，B1）普通脚本 / IIFE，**无依赖、无内联事件、无 eval**。
 *
 * 用法（调用方自己做存在性判断，缺了不报错）：
 *   window.ImageLightbox && window.ImageLightbox.open(img.src, img.alt);
 *   window.ImageLightbox && window.ImageLightbox.close();
 *
 * 形态：全屏遮罩 + 大图 + **三种可直接粘贴的写法**（Markdown / HTML / 裸 URL），
 *       每行一个「复制」按钮（navigator.clipboard 不可用时回退 execCommand('copy')）。
 *
 * 安全：
 *   * 所有文本一律走 textContent（不拼 innerHTML）——图片 URL 来自后端 / 正文，
 *     这里不做任何 HTML 解释；生成的「HTML 写法」是对 URL / alt 的**转义后文本**，
 *     只进剪贴板，不进 DOM。
 *   * 不读 token、不带 Authorization：图片是公开的 /api/v0/document/media/<token>。
 *
 * 可访问性：role=dialog / aria-modal=true / aria-labelledby；Esc 关闭；点遮罩关闭；
 *           打开时记住并移走焦点，关闭后**归还**焦点；Tab 在弹层内循环。
 */
(function () {
    'use strict';

    if (window.ImageLightbox) return;   // 幂等：重复引入（多页共用）不重复建 DOM

    var ID = 'docImageLightbox';
    var overlay = null;
    var dialog = null;
    var titleEl = null;
    var imgEl = null;
    var statusEl = null;
    var rowsEl = null;
    var closeBtn = null;
    var refs = { markdown: '', html: '', url: '' };
    var lastFocus = null;
    var opened = false;

    function h(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function escapeHtmlAttr(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function snippetMarkdown(src, alt) {
        var label = String(alt === undefined || alt === null ? '' : alt)
            .replace(/[\[\]]/g, '')
            .trim() || '图片';
        return '![' + label + '](' + src + ')';
    }

    function snippetHtml(src, alt) {
        var label = String(alt === undefined || alt === null ? '' : alt).trim() || '图片';
        return '<img src="' + escapeHtmlAttr(src) + '" alt="' + escapeHtmlAttr(label) + '">';
    }

    /** 复制纯文本：优先异步剪贴板 API，失败/不可用时回退 execCommand。 */
    function copyText(text) {
        var fallback = function () {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            var ok = false;
            try {
                ta.select();
                ok = document.execCommand('copy');
            } catch (e) {
                ok = false;
            }
            document.body.removeChild(ta);
            return ok;
        };
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                return navigator.clipboard.writeText(text).then(function () { return true; },
                    function () { return fallback(); });
            }
        } catch (e) { /* 落到回退 */ }
        return Promise.resolve(fallback());
    }

    function makeRow(key, label, hint) {
        var row = h('div', 'doc-lightbox__ref');
        row.appendChild(h('span', 'doc-lightbox__ref-label', label));
        var code = h('code', 'doc-lightbox__code', '');
        code.setAttribute('data-ref', key);
        row.appendChild(code);
        var btn = h('button', 'doc-lightbox__copy', '复制');
        btn.type = 'button';
        btn.setAttribute('aria-label', '复制' + hint);
        btn.addEventListener('click', function () {
            var text = refs[key] || '';
            if (!text) return;
            copyText(text).then(function (ok) {
                btn.textContent = ok ? '已复制' : '复制失败';
                btn.classList.toggle('is-copied', !!ok);
                window.setTimeout(function () {
                    btn.textContent = '复制';
                    btn.classList.remove('is-copied');
                }, 1600);
                if (!ok && typeof window.showToast === 'function') {
                    window.showToast('复制失败，请手动选中链接复制', 'warning');
                }
            });
        });
        row.appendChild(btn);
        return row;
    }

    function build() {
        if (overlay) return;

        overlay = h('div', 'doc-lightbox');
        overlay.id = ID;
        overlay.hidden = true;

        dialog = h('div', 'doc-lightbox__dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', ID + '-title');
        dialog.tabIndex = -1;

        var head = h('div', 'doc-lightbox__head');
        titleEl = h('span', 'doc-lightbox__title', '图片');
        titleEl.id = ID + '-title';
        head.appendChild(titleEl);

        closeBtn = h('button', 'doc-lightbox__close', '\u00d7');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', '关闭图片预览');
        closeBtn.addEventListener('click', function () { close(); });
        head.appendChild(closeBtn);
        dialog.appendChild(head);

        var figure = h('div', 'doc-lightbox__figure');
        imgEl = h('img', 'doc-lightbox__img');
        imgEl.alt = '';
        imgEl.decoding = 'async';
        imgEl.referrerPolicy = 'no-referrer';
        figure.appendChild(imgEl);
        statusEl = h('p', 'doc-lightbox__status', '正在加载图片…');
        statusEl.setAttribute('role', 'status');
        figure.appendChild(statusEl);
        dialog.appendChild(figure);

        rowsEl = h('div', 'doc-lightbox__refs');
        rowsEl.appendChild(makeRow('markdown', 'Markdown', 'Markdown 图片写法'));
        rowsEl.appendChild(makeRow('html', 'HTML', 'HTML img 写法'));
        rowsEl.appendChild(makeRow('url', '链接', '图片链接'));
        dialog.appendChild(rowsEl);

        overlay.appendChild(dialog);
        overlay.addEventListener('click', function (e) {
            // 只有点在遮罩本身（不是弹层内容）上才关闭
            if (e.target === overlay) close();
        });
        imgEl.addEventListener('load', function () {
            statusEl.textContent = '';
            statusEl.hidden = true;
        });
        imgEl.addEventListener('error', function () {
            statusEl.hidden = false;
            statusEl.textContent = '图片加载失败（可能已被删除、链接失效或无网络）';
        });

        document.body.appendChild(overlay);
    }

    function focusables() {
        var list = [];
        if (closeBtn) list.push(closeBtn);
        if (rowsEl) {
            var btns = rowsEl.querySelectorAll('.doc-lightbox__copy');
            for (var i = 0; i < btns.length; i++) list.push(btns[i]);
        }
        return list;
    }

    function onKeydown(e) {
        if (!opened) return;
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            close();
            return;
        }
        if (e.key !== 'Tab') return;
        // 弹层内 Tab 循环，避免焦点跑回背后的页面
        var list = focusables();
        if (!list.length) return;
        var first = list[0];
        var last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function setRefs(src, alt) {
        refs.markdown = snippetMarkdown(src, alt);
        refs.html = snippetHtml(src, alt);
        refs.url = String(src);
        if (!rowsEl) return;
        var codes = rowsEl.querySelectorAll('.doc-lightbox__code');
        for (var i = 0; i < codes.length; i++) {
            var key = codes[i].getAttribute('data-ref');
            codes[i].textContent = refs[key] || '';
        }
        var btns = rowsEl.querySelectorAll('.doc-lightbox__copy');
        for (var j = 0; j < btns.length; j++) {
            btns[j].textContent = '复制';
            btns[j].classList.remove('is-copied');
        }
    }

    /**
     * 打开灯箱。
     * @param {string} src  图片地址（后端返回的绝对 URL 或同源相对路径）
     * @param {string} [alt] 图片替代文本（正文里的 alt，可为空）
     */
    function open(src, alt) {
        if (!src) return;
        build();
        var text = String(src);
        var label = String(alt === undefined || alt === null ? '' : alt).trim();
        if (!opened) lastFocus = document.activeElement;
        opened = true;

        titleEl.textContent = label || '图片';
        imgEl.alt = label;
        statusEl.hidden = false;
        statusEl.textContent = '正在加载图片…';
        // 先清空再赋值：同一个 src 连点时浏览器不会重新触发 load 事件（状态会卡在加载中）
        imgEl.removeAttribute('src');
        imgEl.src = text;
        setRefs(text, label);

        overlay.hidden = false;
        overlay.classList.add('is-open');
        document.body.classList.add('doc-lightbox-open');
        document.addEventListener('keydown', onKeydown, true);
        try { dialog.focus(); } catch (e) { /* 忽略 */ }
    }

    function close() {
        if (!overlay) return;
        opened = false;
        overlay.classList.remove('is-open');
        overlay.hidden = true;
        document.body.classList.remove('doc-lightbox-open');
        document.removeEventListener('keydown', onKeydown, true);
        if (imgEl) imgEl.removeAttribute('src');
        // 焦点归还：只在原元素仍在文档里时（否则会抛/静默失败）
        try {
            if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
                lastFocus.focus();
            }
        } catch (e) { /* 忽略 */ }
        lastFocus = null;
    }

    window.ImageLightbox = {
        open: open,
        close: close,
        isOpen: function () { return opened; }
    };
})();
