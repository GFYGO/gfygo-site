/**
 * sanitize.js
 * 无依赖的白名单 HTML 净化器（用于 marked 渲染结果等不可信 HTML）
 * 共享模块：所有页面以普通 <script> 加载，需在使用方脚本之前引入
 *
 * 暴露（window）：
 *   - sanitizeHtml(html)         → 安全 HTML 字符串（供 innerHTML 使用）
 *   - sanitizeHtmlFragment(html) → 安全 DocumentFragment（供 replaceChildren/appendChild 使用）
 *   除上述两个函数外，其余内部表/函数均不挂到 window。
 *
 * 策略：
 *   1. 只用 DOMParser 离线解析（inert 文档），绝不经过任何 live 元素的 innerHTML
 *   2. 标签白名单：未列出的标签「脱壳」（保留子节点与文本），危险标签整棵子树删除
 *   3. 属性白名单：逐标签校验，其余（on*、style、srcdoc、formaction、data-*…）一律丢弃
 *   4. href/src 做协议白名单校验：先由 DOM 完成实体解码，再去掉 ASCII 控制字符/空白，
 *      最后判协议，拦截 javascript:/vbscript:/data:text/html 及 java&#115;cript: 之类混淆写法
 *   5. 任何异常都降级为「转义后的纯文本」，绝不把原始 HTML 原样返回
 */

(function (global) {
  'use strict';

  // =========================================
  // 1. 白名单表
  // =========================================

  // 所有白名单标签通用属性
  var COMMON_ATTRS = ['class', 'id', 'title', 'lang'];

  // 逐标签追加属性（属性名统一按小写比较）
  var TAG_ATTRS = {
    a: ['href', 'target'],
    img: ['src', 'alt', 'width', 'height', 'align'],
    ol: ['start'],
    table: ['align', 'width', 'height'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align'],
    time: ['datetime'],
    ins: ['datetime'],
    del: ['datetime'],
    input: ['type', 'checked', 'disabled']
  };

  /** 仅查自有属性，避免 constructor / toString 之类原型链键被当成白名单命中 */
  function hasOwn(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  // 标签白名单：覆盖 Markdown 常见输出
  var ALLOWED_TAGS = Object.create(null);
  ('p br hr h1 h2 h3 h4 h5 h6 strong b em i u s del ins mark small sub sup span div ' +
    'ul ol li dl dt dd blockquote pre code a img table thead tbody tfoot tr th td caption ' +
    'figure figcaption details summary kbd samp var abbr cite q time input')
    .split(' ').forEach(function (tag) { ALLOWED_TAGS[tag] = true; });

  // 危险标签：整棵子树无条件删除（含 SVG/MathML，规避脚本/样式注入与 mXSS）
  var DROP_TAGS = Object.create(null);
  ('script style iframe object embed link meta base basefont bgsound form svg math template ' +
    'noscript noframes frame frameset applet audio video source track canvas portal marquee ' +
    'title head xmp plaintext listing param keygen dialog foreignobject annotation-xml desc')
    .split(' ').forEach(function (tag) { DROP_TAGS[tag] = true; });

  // 允许的 URL 协议（相对路径/锚点另算，见 sanitizeUrl）
  var SAFE_SCHEMES = { http: true, https: true, mailto: true, tel: true };

  // src 允许的 data URL 位图类型（显式排除 data:image/svg+xml 这一脚本载体）
  var DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)[;,]/i;

  var ALIGN_VALUES = { left: true, right: true, center: true, justify: true, top: true, middle: true, bottom: true };
  var LANG_RE = /^[A-Za-z0-9][A-Za-z0-9\-]{0,19}$/;
  var SPAN_RE = /^\d{1,3}$/;
  var START_RE = /^-?\d{1,6}$/;
  var DIMENSION_RE = /^\d{1,4}(?:\.\d{1,2})?(?:px|%)?$/i;

  // =========================================
  // 2. URL 校验
  // =========================================

  /**
   * 生成用于协议判断的「探针」字符串。
   * 浏览器解析 URL 时会忽略 ASCII 控制字符与空白（如 java\tscript:），
   * 因此判定前必须先把它们去掉，避免混淆绕过。
   */
  function urlProbe(raw) {
    return String(raw).replace(/[\u0000-\u0020\u007f]+/g, '');
  }

  /**
   * 校验 href / src
   * @param {string} raw 原始属性值（DOMParser 已完成实体解码）
   * @param {boolean} allowDataImage 是否允许 data:image/...（仅 img src）
   * @returns {string|null} 合法返回原值，非法返回 null（调用方丢弃该属性）
   */
  function sanitizeUrl(raw, allowDataImage) {
    if (raw === null || raw === undefined) return null;
    var value = String(raw);
    var probe = urlProbe(value);
    if (!probe) return null;

    var m = probe.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
    if (!m) {
      // 无协议前缀：相对路径、./ ../ 协议相对（//host）、?query、#anchor 均放行
      return value;
    }

    var scheme = m[1].toLowerCase();
    if (hasOwn(SAFE_SCHEMES, scheme)) return value;
    if (allowDataImage && scheme === 'data') {
      return DATA_IMAGE_RE.test(probe) ? value : null;
    }
    // javascript: / vbscript: / data:text/html / blob: / file: 等一律丢弃
    return null;
  }

  // =========================================
  // 3. 属性净化
  // =========================================

  /**
   * 按白名单清理单个元素的属性（就地修改）
   */
  function cleanAttributes(el, tag) {
    var extra = hasOwn(TAG_ATTRS, tag) ? TAG_ATTRS[tag] : [];
    var attrs = Array.prototype.slice.call(el.attributes || []);
    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      var name = String(attr.name || '').toLowerCase();
      // on* 事件、style、srcdoc、formaction、xlink:href、data-* 等不在白名单内 → 直接丢弃
      if (COMMON_ATTRS.indexOf(name) === -1 && extra.indexOf(name) === -1) {
        el.removeAttribute(attr.name);
        continue;
      }

      var value = attr.value == null ? '' : String(attr.value);
      var keep = true;

      if (name === 'href') {
        keep = sanitizeUrl(value, false) !== null;
      } else if (name === 'src') {
        keep = sanitizeUrl(value, true) !== null;
      } else if (name === 'target') {
        // 只放行常见跳转目标；_blank 会在下方补 rel
        keep = (value === '_blank' || value === '_self' || value === '_top');
      } else if (name === 'colspan' || name === 'rowspan') {
        keep = SPAN_RE.test(value) && Number(value) > 0;
      } else if (name === 'start') {
        keep = START_RE.test(value);
      } else if (name === 'width' || name === 'height') {
        keep = DIMENSION_RE.test(value);
      } else if (name === 'align') {
        keep = hasOwn(ALIGN_VALUES, value.toLowerCase());
      } else if (name === 'lang') {
        keep = LANG_RE.test(value);
      } else if (name === 'datetime') {
        keep = value.length <= 64;
      } else if (name === 'checked' || name === 'disabled') {
        // 布尔属性：统一写成空值，避免 checked="false" 之类歧义
        el.setAttribute(name, '');
        continue;
      }
      // class / id / title：保留原值（序列化时会自动转义）

      if (!keep) el.removeAttribute(attr.name);
    }

    // 新窗口链接必须带 rel，防止 tabnabbing（rel 不在作者可控白名单内）
    if (tag === 'a') {
      if (el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
      } else {
        el.removeAttribute('rel');
      }
    }
  }

  /** Markdown 任务列表复选框：仅允许 type=checkbox + disabled */
  function isSafeCheckbox(el) {
    var type = String(el.getAttribute('type') || '').toLowerCase();
    return type === 'checkbox' && el.hasAttribute('disabled');
  }

  // =========================================
  // 4. 树遍历：删除 / 脱壳 / 递归
  // =========================================

  /**
   * 脱壳：删除元素本身但保留其子节点（用于未列入白名单的未知标签）
   */
  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    cleanNode(el); // 先净化子树（删除危险后代、继续脱壳未知后代）
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  }

  /**
   * 递归净化 container 的所有子节点
   */
  function cleanNode(container) {
    if (!container) return;
    var children = Array.prototype.slice.call(container.childNodes || []);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType === 1) {
        var tag = String(child.tagName || child.nodeName || '').toLowerCase();
        if (hasOwn(DROP_TAGS, tag)) {
          // 危险标签：整棵子树删除
          container.removeChild(child);
        } else if (hasOwn(ALLOWED_TAGS, tag)) {
          cleanAttributes(child, tag);
          if (tag === 'input' && !isSafeCheckbox(child)) {
            // 非任务列表复选框：脱壳（input 无子节点，等价于删除）
            unwrap(child);
          } else {
            cleanNode(child);
          }
        } else {
          // 未列入白名单的未知标签：脱壳，保留文本内容
          unwrap(child);
        }
      } else if (child.nodeType === 8 || child.nodeType === 7) {
        // 注释（含条件注释）与处理指令：删除
        container.removeChild(child);
      }
      // 文本节点 / CDATA 原样保留，保证中文与代码块内容不被改写
    }
  }

  /**
   * 解析并净化，返回离线文档的 <body> 元素
   */
  function cleanToBody(html) {
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    var body = doc.body;
    if (!body) return null;
    // body 自身属性（如 <body onload=...> 会被解析器带进来）一并清空
    var bodyAttrs = Array.prototype.slice.call(body.attributes || []);
    for (var i = 0; i < bodyAttrs.length; i++) {
      body.removeAttribute(bodyAttrs[i].name);
    }
    cleanNode(body);
    return body;
  }

  // =========================================
  // 5. 兜底转义与对外接口
  // =========================================

  /** 纯文本转义（异常/降级路径使用，绝不返回可执行标记） */
  function escapeText(text) {
    return String(text === null || text === undefined ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * 净化 HTML 字符串
   * @param {string} html 不可信 HTML
   * @returns {string} 安全 HTML（异常时返回转义后的纯文本）
   */
  function sanitizeHtml(html) {
    if (html === null || html === undefined || html === '') return '';
    try {
      if (typeof DOMParser === 'undefined') return escapeText(html);
      var body = cleanToBody(html);
      if (!body) return escapeText(html);
      return body.innerHTML;
    } catch (err) {
      // 净化过程出任何意外：降级为纯文本，绝不返回原始 HTML
      try { console.warn('[sanitize] 净化失败，降级为纯文本:', err); } catch (e) { /* ignore */ }
      return escapeText(html);
    }
  }

  /**
   * 净化并返回 DocumentFragment（避免把 HTML 字符串再交给 innerHTML 二次解析）
   * @param {string} html 不可信 HTML
   * @returns {DocumentFragment|null} 环境不支持时返回 null
   */
  function sanitizeHtmlFragment(html) {
    if (typeof document === 'undefined' || !document.createDocumentFragment) return null;
    var frag = document.createDocumentFragment();
    if (html === null || html === undefined || html === '') return frag;
    try {
      var body = (typeof DOMParser === 'undefined') ? null : cleanToBody(html);
      if (!body) {
        frag.appendChild(document.createTextNode(String(html)));
        return frag;
      }
      while (body.firstChild) {
        // 先取副本再移除原节点，避免死循环（importNode 不会改变 body）
        var imported = document.importNode(body.firstChild, true);
        body.removeChild(body.firstChild);
        frag.appendChild(imported);
      }
    } catch (err) {
      try { console.warn('[sanitize] 净化失败，降级为纯文本:', err); } catch (e) { /* ignore */ }
      frag.appendChild(document.createTextNode(String(html)));
    }
    return frag;
  }

  // ===== 全局挂载 =====
  global.sanitizeHtml = sanitizeHtml;
  global.sanitizeHtmlFragment = sanitizeHtmlFragment;
})(typeof window !== 'undefined' ? window : this);
