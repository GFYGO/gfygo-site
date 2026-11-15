/**
 * creator/creator.js
 * 创作者工作台（creator/index.html）的页面逻辑。
 *
 * 一块屏幕里管三件事：
 *   1. 左栏文档树：公共文档（投稿目标）/ 我的草稿 / 最近修订 + 搜索 + 加载更多；
 *   2. 中栏编辑器：元信息 + Markdown 编辑 + 实时预览 + 修订历史抽屉 + 图片上传；
 *   3. 右栏两块面板：动态页面（user/pages + 已获取 skills）与交流（公开 / 个人通知）。
 *
 * 权限门控（**唯一判据是后端权限节点**）：
 *   * 有 *.create（通配创作）→ 可向公共文档投稿（新建 visibility=public）、修订
 *     （PUT 带 version）、编辑公共文档、改内容权限规则；
 *   * 没有 → 只读模式：能浏览公共文档、能编辑自己的私有草稿（Lv1 默认能力），
 *     不能投稿公共 / 不能改公共文档 / 不能改权限。
 *   前端优先用 GET /api/v0/creator/status 的权威结果；接口不可用时**退回 token 里的
 *   权限节点**（hasPermission('*.create')）；两条路都判不出来时一律按「无权限」处理，
 *   绝不默认放行（宁可多提示一次，也不静默越权）。
 *
 * 约束（与全站一致）：
 *   * 普通脚本，不用 import/export，不做动态代码求值（eval / 构造函数）；
 *   * 不写内联 on*=（CSP 会拦），事件全部在 init() 里绑；
 *   * 后端字符串一律 textContent 落 DOM；Markdown 预览必须经 window.sanitizeHtml
 *     白名单净化后才写 innerHTML（文档正文属于不可信内容）；
 *   * 动态页面的 html/css/js 用与 skill/skill.js **完全相同**的方式注入：
 *     内联 html + <style> 标签 + Blob URL 的 <script src=blob:>；收起时全清。
 */
(function () {
  'use strict';

  // ============================================================
  // 0. 常量
  // ============================================================
  var STATUS_PATH = '/api/v0/creator/status';
  var LIST_PATH = '/api/v0/document/list';
  var DOC_PATH = '/api/v0/document/';          // POST 走尾斜杠；GET/PUT 走 DOC_PATH + id
  var SEARCH_PATH = '/api/v0/search';
  var PAGES_PATH = '/api/v0/user/pages';
  var SKILLS_PATH = '/api/v0/skills/';
  var NOTIFY_GLOBAL = '/api/v0/notify/global';
  var NOTIFY_PERSONAL = '/api/v0/notify/personal';
  var NOTIFY_READ_ALL = '/api/v0/notify/read-all';

  // localStorage：面板宽度 / 面板显隐 / 预览显隐 / 当前来源 / 本机最近编辑过的文档
  var STORE = {
    left: 'creator.left_width',
    right: 'creator.right_width',
    panels: 'creator.panels_visible',
    preview: 'creator.preview_on',
    tab: 'creator.tree_tab',
    recent: 'creator.recent_edited'
  };

  var LEFT_MIN = 200, LEFT_MAX = 460, RIGHT_MIN = 240, RIGHT_MAX = 520;
  var PAGE_SIZE = 20;
  var RECENT_MAX = 20;

  // 文档图片分级上限（2026-11 的后端口径）：私有 512KiB / 组 1MiB / 公共不限
  var IMG_LIMIT_PRIVATE = 512 * 1024;
  var IMG_LIMIT_GROUP = 1024 * 1024;
  var COMPRESS_TARGET = 480 * 1024;            // 在线压缩目标：< 480KiB（给 multipart 留余量）
  var COMPRESS_EDGES = [2560, 1920, 1600, 1280];
  var COMPRESS_QUALITIES = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6];
  // canvas 压不动的格式（矢量 / 文档 / 相机 RAW）：只能提示用户自行压缩
  var NO_CANVAS_RE = /\.(svg|pdf|tiff?|raw|cr2|cr3|nef|arw|dng|orf|rw2|raf)$/i;

  // ============================================================
  // 1. 状态与 DOM 引用
  // ============================================================
  var state = {
    loggedIn: false,
    canCreate: false,             // *.create：投稿公共 / 编辑公共 / 改权限
    canEditPublic: false,
    canChangePermissions: false,
    statusDegraded: false,        // creator/status 不可用 → 走本地节点兜底
    statusData: null,
    treeTab: 'public',
    query: '',
    docs: [],
    page: 1,
    hasMore: false,
    doc: null,                    // 当前打开的文档（详情对象）
    editingId: null,
    version: null,
    dirty: false,
    revisions: [],
    pages: [],
    pageKey: null,
    pageStyleEl: null,
    pageScriptEl: null,
    pageBlobUrl: null,
    notifyGlobal: [],
    notifyPersonal: [],
    notifyGlobalError: '',
    notifyPersonalError: '',
    markedReady: false,
    markedPromise: null,
    panelsVisible: true,
    previewOn: true,
    lastFocus: null
  };

  var dom = {};

  // ============================================================
  // 2. 小工具
  // ============================================================
  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clearNode(node) {
    if (!node) return;
    // 一步清空子节点：浏览器里等价于逐个 removeChild，但老式 DOM 桩（tools/dom-stub.mjs）
    // 只实现了 innerHTML 的 setter —— 用 removeChild 循环在桩上会静默不清空。
    node.innerHTML = '';
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else if (typeof Toast !== 'undefined' && Toast.show) Toast.show(msg, type || 'info');
  }

  function modalConfirm(message, options) {
    if (window.Modal && typeof window.Modal.confirm === 'function') return window.Modal.confirm(message, options || {});
    return Promise.resolve(false);
  }

  function modalAlert(message, options) {
    if (window.Modal && typeof window.Modal.alert === 'function') return window.Modal.alert(message, options || {});
    toast(message, 'warning');
    return Promise.resolve();
  }

  function isLoggedIn() {
    try {
      return !!(window.AuthGuard && window.AuthGuard.getToken && window.AuthGuard.getToken());
    } catch (e) {
      return false;
    }
  }

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 隐私模式等写不进去时静默降级 */ }
  }

  function clampInt(raw, min, max) {
    var n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }

  function fmtTime(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    try {
      return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function visibilityLabel(doc) {
    var key = (doc && (doc.visibility || doc.scope)) || '';
    if (key === 'public') return '🌐 公共';
    if (key === 'group') return '👥 组';
    if (key === 'private') return '🔒 私有';
    return '';
  }

  function docMetaText(doc) {
    var parts = [];
    var vis = visibilityLabel(doc);
    if (vis) parts.push(vis);
    if (doc.version) parts.push('v' + doc.version);
    var t = doc.updated_at || doc.time || doc.created_at;
    if (t) parts.push(fmtTime(t));
    if (!parts.length && doc.summary) return doc.summary;
    return parts.join(' · ');
  }

  // ============================================================
  // 3. Markdown 预览（marked@12 CDN + sanitizeHtml）
  // ============================================================
  function ensureMarkedLoaded() {
    if (window.marked && typeof window.marked.parse === 'function') {
      state.markedReady = true;
      return Promise.resolve(true);
    }
    if (state.markedPromise) return state.markedPromise;
    state.markedPromise = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
      script.referrerPolicy = 'no-referrer';
      script.onload = function () {
        state.markedReady = !!(window.marked && window.marked.parse);
        state.markedPromise = null;
        resolve(state.markedReady);
      };
      script.onerror = function () {
        state.markedReady = false;
        state.markedPromise = null;
        resolve(false);
      };
      document.head.appendChild(script);
    });
    return state.markedPromise;
  }

  /**
   * Markdown → 可直接写 innerHTML 的安全 HTML。
   * 返回 null 表示「渲染器或净化器不可用」→ 调用方降级为 <pre> 纯文本，
   * **绝不**把原始 Markdown/HTML 直接塞进 DOM。
   */
  function renderMarkdownSafe(raw) {
    var text = (raw === null || raw === undefined) ? '' : String(raw);
    if (!window.marked || typeof window.marked.parse !== 'function') return null;
    if (typeof window.sanitizeHtml !== 'function') return null;
    var html;
    try {
      html = window.marked.parse(text || '（空文档）');
    } catch (e) {
      console.warn('[creator] marked 解析失败，降级为纯文本:', e);
      return null;
    }
    try {
      return window.sanitizeHtml(html);
    } catch (e) {
      console.warn('[creator] 净化失败，降级为纯文本:', e);
      return null;
    }
  }

  function renderPreviewText(text) {
    var body = dom.preview;
    if (!body) return;
    var safe = renderMarkdownSafe(text);
    if (safe === null) {
      clearNode(body);
      var pre = el('pre');
      pre.textContent = text || '（空文档）';
      body.appendChild(pre);
      return;
    }
    body.innerHTML = safe;
  }

  function renderPreview() {
    if (!dom.preview) return;
    if (dom.previewNote) dom.previewNote.hidden = true;
    renderPreviewText(dom.content ? dom.content.value : '');
  }

  var schedulePreview = debounce(function () {
    if (!state.markedReady) {
      ensureMarkedLoaded().then(function (ok) {
        if (ok) renderPreview();
      });
      return;
    }
    renderPreview();
  }, 220);

  // ============================================================
  // 4. 权限状态与门控
  // ============================================================
  function renderStatus() {
    if (!dom.status) return;
    dom.status.classList.remove('creator-status--ok', 'creator-status--warn');
    if (!state.loggedIn) {
      dom.status.textContent = '未登录 · 可浏览公共文档；登录后可编辑自己的私有草稿';
      return;
    }
    if (state.canCreate) {
      dom.status.classList.add('creator-status--ok');
      var d = state.statusData || {};
      dom.status.textContent = '创作者权限已就绪（' + (d.node || '*.create') + '）'
        + (d.public_total != null ? ' · 公共文档 ' + d.public_total + ' 篇' : '')
        + (d.my_draft_total != null ? ' · 我的草稿 ' + d.my_draft_total + ' 篇' : '');
      return;
    }
    dom.status.classList.add('creator-status--warn');
    dom.status.textContent = state.statusDegraded
      ? '只读模式（权限状态接口不可用，按本地权限节点判定：缺少 *.create）'
      : '只读模式：缺少 *.create（通配创作）权限';
  }

  function buildApplyLink(text) {
    var link = el('a', '', text);
    link.href = 'mailto:gfygo_@outlook.com?subject=' + encodeURIComponent('申请创作权限（*.create）');
    return link;
  }

  function renderBanner() {
    if (!dom.banner) return;
    clearNode(dom.banner);
    var show = false;
    var strong, text;

    if (!state.loggedIn) {
      show = true;
      strong = el('strong', '', '未登录');
      text = el('span', '', '：公共文档可以浏览，但保存 / 投稿 / 上传图片都需要登录。');
      dom.banner.appendChild(strong);
      dom.banner.appendChild(text);
      dom.banner.appendChild(buildApplyLink('登录后可编辑私有草稿；投稿公共文档需 *.create 权限，点此申请'));
    } else if (!state.canCreate) {
      show = true;
      strong = el('strong', '', '只读模式');
      text = el('span', '', '：当前账号没有 *.create（通配创作）权限 —— 可以浏览公共文档、编辑自己的私有草稿，'
        + '但不能向公共文档投稿、不能修改公共文档、不能修改内容权限规则。想成为创作者？');
      dom.banner.appendChild(strong);
      dom.banner.appendChild(text);
      dom.banner.appendChild(buildApplyLink('发邮件申请（gfygo_@outlook.com）'));
    } else if (state.statusDegraded) {
      show = true;
      strong = el('strong', '', '提示');
      text = el('span', '', '：创作权限状态接口暂时不可用，已按本地 token 里的权限节点判定（结果可能滞后）。');
      dom.banner.appendChild(strong);
      dom.banner.appendChild(text);
    }

    dom.banner.hidden = !show;
  }

  async function loadStatus() {
    if (!state.loggedIn) {
      state.canCreate = false;
      state.canEditPublic = false;
      state.canChangePermissions = false;
      renderStatus();
      renderBanner();
      applyGate();
      return;
    }
    var res = await apiRequest(STATUS_PATH, { silent: true });
    if (res && res.code === 200 && res.data) {
      var d = res.data;
      state.statusData = d;
      state.canCreate = !!d.can_create;
      state.canEditPublic = !!d.can_edit_public;
      state.canChangePermissions = !!d.can_change_permissions;
      state.statusDegraded = false;
    } else {
      // 接口还没上线 / 后端异常：退回 token 里的权限节点（hasPermission 读 now_permission.nodes）
      state.statusDegraded = true;
      state.canCreate = typeof window.hasPermission === 'function' ? !!window.hasPermission('*.create') : false;
      state.canEditPublic = state.canCreate;
      state.canChangePermissions = state.canCreate;
    }
    renderStatus();
    renderBanner();
    applyGate();
  }

  /** 当前文档在当前账号下能不能编辑（只读模式的判定就在这里落地） */
  function canEditCurrent() {
    if (!state.loggedIn) return false;
    if (!state.editingId) return true;             // 新草稿：登录即可写
    var doc = state.doc;
    if (!doc) return false;
    if (doc.visibility === 'group') return false;  // 组文档不在本页编辑（走组织页的组文档功能）
    if (doc.visibility === 'public') return !!(state.canCreate || state.canEditPublic);
    return true;                                   // 自己的私有草稿：Lv1 默认能力
  }

  function canEditPermissions() {
    if (!state.loggedIn || !state.editingId) return false;
    if (state.canChangePermissions) return true;
    var doc = state.doc;
    // 私有草稿的规则只作用于自己的文档，作者本人可改（后端同样按作者 / 超管判权）；
    // 公共文档的规则则是「公共可见性」的一部分，必须 *.create。
    return !!(doc && doc.visibility !== 'public');
  }

  /** 统一把门控结果刷到所有控件上（避免每个入口各写一份判断） */
  function applyGate() {
    var editable = canEditCurrent();
    [dom.title, dom.summary, dom.icon, dom.visibility, dom.folder].forEach(function (node) {
      if (node) node.disabled = !editable;
    });
    if (dom.content) {
      dom.content.readOnly = !editable;
      dom.content.setAttribute('aria-readonly', editable ? 'false' : 'true');
    }
    if (dom.bits) {
      Array.prototype.forEach.call(dom.bits.querySelectorAll('input[data-bit]'), function (box) {
        box.disabled = !editable;
      });
    }
    if (dom.toolbar) {
      Array.prototype.forEach.call(dom.toolbar.querySelectorAll('button[data-md]'), function (btn) {
        btn.disabled = !editable;
      });
    }
    if (dom.saveBtn) {
      dom.saveBtn.disabled = !editable;
      dom.saveBtn.title = editable ? '保存（Ctrl / Cmd + S）' : '只读：无法保存这篇文档';
    }
    if (dom.newBtn) {
      dom.newBtn.disabled = !state.loggedIn;
      dom.newBtn.title = state.loggedIn ? '新建一篇私有草稿' : '登录后可新建草稿';
    }
    if (dom.submitBtn) {
      var canSubmit = state.loggedIn && state.canCreate && editable;
      dom.submitBtn.disabled = !canSubmit;
      dom.submitBtn.title = canSubmit
        ? '把当前内容作为公共文档投稿'
        : (state.loggedIn ? '需要 *.create（通配创作）权限才能投稿公共文档' : '登录后可投稿');
    }
    if (dom.permsBtn) {
      var canPerm = canEditPermissions();
      dom.permsBtn.disabled = !canPerm;
      dom.permsBtn.title = canPerm ? '编辑这篇文档的内容权限规则' : '需要 *.create 权限或本篇文档的编辑权';
    }
    if (dom.visibility) {
      var publicOption = dom.visibility.querySelector('option[value="public"]');
      if (publicOption) publicOption.disabled = !state.canCreate;
      // 新文档没有 *.create 时不允许停在「公共」；已打开的公共文档保留显示（整体只读）
      if (!state.canCreate && !state.editingId && dom.visibility.value === 'public') {
        dom.visibility.value = 'private';
      }
    }
    if (dom.readAllBtn) dom.readAllBtn.disabled = !state.loggedIn;
    updateEditorHint();
  }

  // ============================================================
  // 5. 编辑器（表单读写 / 保存 / 投稿 / 冲突）
  // ============================================================
  function readBits() {
    var bits = ['0', '0', '0', '0', '0', '1'];   // 第 6 位是超管兜底位，恒为 1
    var boxes = document.querySelectorAll('#creatorBits input[data-bit]');
    Array.prototype.forEach.call(boxes, function (box) {
      var index = parseInt(box.getAttribute('data-bit'), 10) - 1;
      if (index >= 0 && index < 5 && box.checked) bits[index] = '1';
    });
    return bits.join('');
  }

  function writeBits(value) {
    var s = String(value || '100001');
    var boxes = document.querySelectorAll('#creatorBits input[data-bit]');
    Array.prototype.forEach.call(boxes, function (box) {
      var index = parseInt(box.getAttribute('data-bit'), 10) - 1;
      box.checked = index >= 0 && index < 5 && s.charAt(index) === '1';
    });
  }

  function readForm() {
    return {
      title: (dom.title && dom.title.value || '').trim(),
      summary: (dom.summary && dom.summary.value || '').trim(),
      icon: (dom.icon && dom.icon.value || '').trim() || '📄',
      content: (dom.content && dom.content.value) || '',
      visibility: (dom.visibility && dom.visibility.value) || 'private',
      permission_bits: readBits(),
      folder_id: (function () {
        var n = parseInt(dom.folder && dom.folder.value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })()
    };
  }

  function fillForm(doc) {
    doc = doc || {};
    if (dom.title) dom.title.value = doc.title || '';
    if (dom.summary) dom.summary.value = doc.summary || '';
    if (dom.icon) dom.icon.value = doc.icon || '📄';
    if (dom.content) dom.content.value = doc.content || '';
    if (dom.folder) dom.folder.value = doc.folder_id || 0;
    if (dom.visibility) {
      if (doc.visibility === 'public' || doc.visibility === 'group' || doc.visibility === 'private') {
        dom.visibility.value = doc.visibility;
      } else {
        dom.visibility.value = 'private';
      }
    }
    writeBits(doc.permission_bits || '100001');
    updateEditorHint();
  }

  function updateEditorHint() {
    if (!dom.hint) return;
    var parts = [];
    parts.push(state.editingId ? '文档 #' + state.editingId : '新文档（未保存）');
    if (state.version != null) parts.push('v' + state.version);
    if (state.dirty) parts.push('● 未保存');
    if (!canEditCurrent()) parts.push('🔒 只读');
    dom.hint.textContent = parts.join(' · ');
  }

  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      updateEditorHint();
    }
  }

  function setSaveBusy(busy, target) {
    var btn = target || dom.saveBtn;
    if (!btn) return;
    if (busy) {
      btn.disabled = true;
      btn.dataset.busy = '1';
      btn.textContent = '保存中…';
    } else {
      delete btn.dataset.busy;
      btn.textContent = btn === dom.submitBtn ? '📤 提交公共文档' : '💾 保存';
      applyGate();
    }
  }

  async function saveDoc(options) {
    options = options || {};
    if (!state.loggedIn) { toast('请先登录再保存', 'warning'); return; }
    if (!canEditCurrent()) { toast('当前文档只读：缺少 *.create 权限或不是你的草稿', 'warning'); return; }
    var payload = readForm();
    if (!payload.title) { toast('标题不能为空', 'warning'); if (dom.title) dom.title.focus(); return; }

    setSaveBusy(true, dom.saveBtn);
    var res;
    if (!state.editingId) {
      res = await apiRequest(DOC_PATH, { method: 'POST', body: payload, silent: true });
    } else {
      var body = {};
      Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
      if (state.version != null) body.version = state.version;
      res = await apiRequest(DOC_PATH + state.editingId, { method: 'PUT', body: body, silent: true });
    }
    setSaveBusy(false, dom.saveBtn);

    if (!res) return;
    if (res.code === 409) {
      if (options.force) {
        toast('仍然冲突：文档刚被别人改过，请重新打开后再保存', 'error');
        return;
      }
      await handleConflict(res);
      return;
    }
    if (res.code !== 200 || !res.data) {
      toast(res.msg || '保存失败', 'error');
      return;
    }
    await afterSave(res.data, res.msg);
  }

  /** 409 的响应体是文档域**唯一**带 data 的错误体：data.current_version 用来做「用我的覆盖」 */
  async function handleConflict(res) {
    var current = res && res.data && res.data.current_version;
    var ok = await modalConfirm(
      '服务器上的版本已更新（当前版本 ' + (current != null ? current : '未知') + '）。'
      + '「用我的覆盖」会把编辑器里的内容写进服务器，覆盖别人刚做的改动。',
      { title: '版本冲突', confirmText: '用我的覆盖', cancelText: '先不覆盖' }
    );
    if (!ok) {
      toast('已取消保存。建议重新打开文档，或点「修订历史」看看别人改了什么', 'info');
      return;
    }
    if (current == null) {
      toast('无法确认服务器当前版本，请重新打开文档后再保存', 'error');
      return;
    }
    state.version = current;   // 以「现在的最新版」为基线重发 = 覆盖
    await saveDoc({ force: true });
  }

  async function afterSave(doc, msg) {
    state.doc = doc || state.doc;
    if (doc && doc.id != null) state.editingId = doc.id;
    if (doc && doc.version != null) state.version = doc.version;
    state.dirty = false;
    if (doc) {
      if (dom.visibility && (doc.visibility === 'public' || doc.visibility === 'private' || doc.visibility === 'group')) {
        dom.visibility.value = doc.visibility;
      }
      writeBits(doc.permission_bits || readBits());
      pushRecent(doc);
    }
    applyGate();
    updateEditorHint();
    markActiveDoc(state.editingId);
    if (msg !== '无变更') await loadTree(true);
    toast(msg || '已保存', 'success');
  }

  async function submitPublic() {
    if (!state.loggedIn) { toast('请先登录', 'warning'); return; }
    if (!state.canCreate) {
      toast('缺少 *.create（通配创作）权限，不能投稿公共文档。申请请邮件 gfygo_@outlook.com', 'warning');
      return;
    }
    var payload = readForm();
    if (!payload.title) { toast('标题不能为空', 'warning'); if (dom.title) dom.title.focus(); return; }

    // 已经是公共文档 → 投稿就是保存（否则会额外造出一篇重复文档）
    if (state.editingId && state.doc && state.doc.visibility === 'public') {
      await saveDoc();
      return;
    }

    var ok = await modalConfirm(
      state.editingId
        ? '当前内容会作为一篇新的公共文档投稿（原来的私有草稿保留不动）。继续吗？'
        : '当前内容会作为一篇新的公共文档投稿。继续吗？',
      { title: '投稿到公共文档', confirmText: '投稿' }
    );
    if (!ok) return;

    payload.visibility = 'public';
    setSaveBusy(true, dom.submitBtn);
    var res = await apiRequest(DOC_PATH, { method: 'POST', body: payload, silent: true });
    setSaveBusy(false, dom.submitBtn);
    if (!res) return;
    if (res.code !== 200 || !res.data) { toast(res.msg || '投稿失败', 'error'); return; }

    var doc = res.data;
    var becamePublic = doc.visibility === 'public';
    state.doc = doc;
    state.editingId = doc.id;
    state.version = doc.version != null ? doc.version : null;
    state.dirty = false;
    fillForm(doc);
    applyGate();
    pushRecent(doc);
    markActiveDoc(doc.id);
    await loadTree(true);
    if (becamePublic) toast('已投稿到公共文档', 'success');
    else toast('后端按权限存成了私有文档（可能缺少 *.create）——请核对权限节点', 'warning');
  }

  // ============================================================
  // 6. 工具栏（Markdown 插入）
  // ============================================================
  function insertAtCursor(snippet) {
    var ta = dom.content;
    if (!ta) return;
    var start = ta.selectionStart || 0;
    var end = ta.selectionEnd || 0;
    var value = ta.value || '';
    ta.value = value.slice(0, start) + snippet + value.slice(end);
    var caret = start + snippet.length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
    markDirty();
    schedulePreview();
  }

  function wrapSelection(before, after, placeholder) {
    var ta = dom.content;
    if (!ta) return;
    var start = ta.selectionStart || 0;
    var end = ta.selectionEnd || 0;
    var value = ta.value || '';
    var selected = value.slice(start, end) || placeholder || '';
    var next = before + selected + after;
    ta.value = value.slice(0, start) + next + value.slice(end);
    var s = start + before.length;
    ta.setSelectionRange(s, s + selected.length);
    ta.focus();
    markDirty();
    schedulePreview();
  }

  function prefixLines(prefix) {
    var ta = dom.content;
    if (!ta) return;
    var start = ta.selectionStart || 0;
    var end = ta.selectionEnd || 0;
    var value = ta.value || '';
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var block = value.slice(lineStart, end);
    var next = block.split('\n').map(function (line) { return prefix + line; }).join('\n');
    ta.value = value.slice(0, lineStart) + next + value.slice(end);
    ta.setSelectionRange(lineStart, lineStart + next.length);
    ta.focus();
    markDirty();
    schedulePreview();
  }

  function applyMarkdownAction(action) {
    if (!canEditCurrent()) {
      toast('当前文档只读', 'warning');
      return;
    }
    if (action === 'h2') { prefixLines('## '); return; }
    if (action === 'bold') { wrapSelection('**', '**', '加粗文字'); return; }
    if (action === 'list') { prefixLines('- '); return; }
    if (action === 'code') {
      var ta = dom.content;
      var selection = ta ? ta.value.slice(ta.selectionStart || 0, ta.selectionEnd || 0) : '';
      if (selection.indexOf('\n') >= 0) {
        // 多行 → 围栏代码块；单行 → 行内代码。围栏用变量拼，读起来清爽
        var fence = '```';
        wrapSelection('\n' + fence + '\n', '\n' + fence + '\n', '');
      } else {
        wrapSelection('`', '`', 'code');
      }
      return;
    }
    if (action === 'image') {
      if (!state.editingId) { toast('请先保存文档，再插入图片', 'warning'); return; }
      if (dom.imageInput) dom.imageInput.click();
    }
  }

  // ============================================================
  // 7. 图片上传（分级上限 + canvas 在线压缩）
  // ============================================================
  function currentImageLimit() {
    var vis = state.doc ? state.doc.visibility : (dom.visibility ? dom.visibility.value : 'private');
    if (vis === 'group') return IMG_LIMIT_GROUP;
    if (vis === 'public') return null;        // 公共文档不限
    return IMG_LIMIT_PRIVATE;
  }

  function imageLimitLabel() {
    var limit = currentImageLimit();
    return limit ? Math.round(limit / 1024) + 'KiB' : '服务端上限';
  }

  function webpName(name) {
    var base = String(name || 'image').replace(/\.[^.\/\\]+$/, '');
    return (base || 'image') + '.webp';
  }

  /** 上传一张图片，返回 { ok, tooLarge, msg, data }（不抛异常，便于压缩后重试） */
  async function postMedia(file, name) {
    var token = window.AuthGuard ? window.AuthGuard.getToken() : null;
    if (!token) return { ok: false, msg: '登录已失效，请重新登录' };
    if (!state.editingId) return { ok: false, msg: '请先保存文档，再插入图片' };

    var fd = new FormData();
    fd.append('file', file, name || file.name || 'image');

    var res;
    try {
      res = await fetch(window.API_BASE_URL + DOC_PATH + state.editingId + '/media', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd
      });
    } catch (e) {
      return { ok: false, msg: '上传失败：网络错误' };
    }
    if (res.status === 401) {
      if (window.AuthGuard && window.AuthGuard.handleAuthError) window.AuthGuard.handleAuthError();
      return { ok: false, msg: '登录已失效，请重新登录' };
    }
    // 413 可能是 Nginx 自己的 HTML 错误页（不是我们的 JSON）→ 先看状态码再解析
    var payload = null;
    if (res.status !== 413) {
      try { payload = await res.json(); } catch (e) { payload = null; }
    }
    var msg = (payload && payload.msg) || '';
    if (res.status === 413 || /过大|超过/.test(msg)) {
      return { ok: false, tooLarge: true, msg: msg || '图片超过体积上限' };
    }
    if (!res.ok || !payload || payload.code !== 200 || !payload.data) {
      return { ok: false, msg: msg || '上传失败' };
    }
    return { ok: true, data: payload.data };
  }

  /**
   * 把图片压到 <= targetBytes（WebP，边长与质量逐级下降）。
   * 返回 Blob；浏览器解码不了（RAW / 不是真图片）时返回 null。
   * 为什么不用固定比例：手机直出 3~8MB，要过 512KiB 必须同时降边长与质量。
   */
  function compressImage(file, targetBytes) {
    return new Promise(function (resolve) {
      if (typeof document === 'undefined' || !document.createElement) { resolve(null); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
        resolve(value);
      }
      img.onload = function () {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext ? canvas.getContext('2d') : null;
        if (!ctx || !canvas.toBlob) { finish(null); return; }
        var srcW = img.naturalWidth || img.width || 0;
        var srcH = img.naturalHeight || img.height || 0;
        if (!srcW || !srcH) { finish(null); return; }
        var maxEdge = Math.max(srcW, srcH);
        var edgeIdx = 0;
        var qualityIdx = 0;
        var best = null;
        function step() {
          if (settled) return;
          var edge = COMPRESS_EDGES[Math.min(edgeIdx, COMPRESS_EDGES.length - 1)];
          var scale = Math.min(1, edge / maxEdge);
          var w = Math.max(1, Math.round(srcW * scale));
          var h = Math.max(1, Math.round(srcH * scale));
          canvas.width = w;
          canvas.height = h;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var quality = COMPRESS_QUALITIES[Math.min(qualityIdx, COMPRESS_QUALITIES.length - 1)];
          canvas.toBlob(function (blob) {
            if (settled) return;
            if (blob && (!best || blob.size < best.size)) best = blob;
            if (blob && blob.size < targetBytes) { finish(blob); return; }
            qualityIdx += 1;
            if (qualityIdx >= COMPRESS_QUALITIES.length) {
              qualityIdx = 0;
              edgeIdx += 1;
            }
            if (edgeIdx >= COMPRESS_EDGES.length) { finish(best); return; }
            step();
          }, 'image/webp', quality);
        }
        step();
      };
      img.onerror = function () { finish(null); };
      img.src = url;
    });
  }

  async function offerCompress(file) {
    var label = imageLimitLabel();
    var name = file && file.name ? file.name : '';
    var type = (file && file.type) || '';
    if (NO_CANVAS_RE.test(name) || /svg|tiff?|pdf/.test(type)) {
      await modalAlert(
        '这张图片超过 ' + label + '，而 ' + (type || '该格式')
        + ' 不支持在浏览器里压缩（矢量 / 文档 / 相机 RAW）。'
        + '请自行压缩或转成 JPG / PNG / WebP 后再上传。',
        { title: '需要自行压缩' }
      );
      return null;
    }
    var ok = await modalConfirm(
      '图片超过 ' + label + '，是否在线压缩？会转成 WebP（长边 2560 → 1920 → 1600 → 1280，质量 0.9 → 0.6），'
      + '压到 480KiB 以内后自动重试上传。',
      { title: '图片过大', confirmText: '压缩并上传', cancelText: '取消' }
    );
    if (!ok) return null;
    toast('正在压缩图片…', 'info');
    var blob = await compressImage(file, COMPRESS_TARGET);
    if (!blob) {
      await modalAlert(
        '浏览器无法解码这张图片（可能是相机 RAW，或文件不是真正的图片）。请用工具压缩后再上传。',
        { title: '无法压缩' }
      );
      return null;
    }
    return { blob: blob, name: webpName(name) };
  }

  async function uploadAndInsert(file) {
    if (!state.loggedIn) { toast('请先登录再上传图片', 'warning'); return; }
    if (!state.editingId) { toast('请先保存文档，再插入图片', 'warning'); return; }

    toast('正在上传图片…', 'info');
    var res = await postMedia(file);
    if (res && res.tooLarge) {
      var compressed = await offerCompress(file);
      if (!compressed) return;
      res = await postMedia(compressed.blob, compressed.name);
      if (res && res.tooLarge) {
        toast('压缩后仍然超过限制，请换一张更小的图片', 'error');
        return;
      }
    }
    if (!res || !res.ok) {
      if (res && res.msg) toast(res.msg, 'error');
      return;
    }
    var media = res.data || {};
    var alt = String((file && file.name) || '图片').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '');
    insertAtCursor('![' + alt + '](' + (media.url || '') + ')');
    toast('图片已插入正文', 'success');
  }

  // ============================================================
  // 8. 左栏文档树
  // ============================================================
  function setTreeBusy(busy) {
    if (dom.treeList) dom.treeList.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function treeLoading() {
    if (!dom.treeList) return;
    clearNode(dom.treeList);
    dom.treeList.appendChild(el('p', 'creator-loading', '正在加载文档…'));
  }

  function treeError(message) {
    if (!dom.treeList) return;
    clearNode(dom.treeList);
    var wrap = el('div', 'creator-error');
    wrap.appendChild(el('p', '', message));
    var retry = el('button', 'creator-btn creator-btn--ghost creator-btn--sm', '重试');
    retry.type = 'button';
    retry.addEventListener('click', function () { loadTree(true); });
    wrap.appendChild(retry);
    dom.treeList.appendChild(wrap);
  }

  function treeEmpty(message) {
    if (!dom.treeList) return;
    clearNode(dom.treeList);
    dom.treeList.appendChild(el('p', 'creator-empty', message));
  }

  function renderDocItem(doc) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'creator-doc';
    btn.setAttribute('role', 'listitem');
    if (state.editingId != null && String(doc.id) === String(state.editingId)) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'true');
    }
    btn.setAttribute('data-doc-id', String(doc.id));
    if (doc.slug) btn.setAttribute('data-doc-slug', doc.slug);

    btn.appendChild(el('span', 'creator-doc__icon', doc.icon || '📄'));
    var main = el('span', 'creator-doc__main');
    main.appendChild(el('span', 'creator-doc__title', doc.title || '（无标题）'));
    main.appendChild(el('span', 'creator-doc__meta', docMetaText(doc)));
    btn.appendChild(main);
    return btn;
  }

  function renderTree() {
    if (!dom.treeList) return;
    if (!state.docs.length) {
      treeEmpty(state.query
        ? '没有匹配「' + state.query + '」的文档，换个关键词试试。'
        : (state.treeTab === 'private' ? '你还没有私有草稿，点「＋ 新建草稿」开始写。' : '公共文档库里还没有文档。'));
      return;
    }
    clearNode(dom.treeList);
    state.docs.forEach(function (doc) { dom.treeList.appendChild(renderDocItem(doc)); });
  }

  function renderRecent() {
    var list = readRecent();
    if (!list.length) {
      treeEmpty('还没有本机编辑记录。打开或保存一篇文档后，这里会记录最近 20 篇（只存在本机浏览器）。');
      return;
    }
    if (!dom.treeList) return;
    clearNode(dom.treeList);
    list.forEach(function (item) { dom.treeList.appendChild(renderDocItem(item)); });
  }

  function updateLoadMore() {
    if (!dom.loadMoreWrap) return;
    var visible = state.treeTab !== 'recent' && state.hasMore;
    dom.loadMoreWrap.hidden = !visible;
  }

  function markActiveDoc(id) {
    if (!dom.treeList) return;
    Array.prototype.forEach.call(dom.treeList.querySelectorAll('[data-doc-id]'), function (node) {
      var active = id != null && String(node.getAttribute('data-doc-id')) === String(id);
      node.classList.toggle('is-active', active);
      if (active) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    });
  }

  function readRecent() {
    try {
      var raw = localStorage.getItem(STORE.recent);
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function pushRecent(doc) {
    if (!doc || doc.id == null) return;
    var list = readRecent().filter(function (item) { return String(item.id) !== String(doc.id); });
    list.unshift({
      id: doc.id,
      slug: doc.slug || '',
      title: doc.title || '',
      icon: doc.icon || '📄',
      visibility: doc.visibility || '',
      time: new Date().toISOString()
    });
    list = list.slice(0, RECENT_MAX);
    writeStore(STORE.recent, JSON.stringify(list));
    if (state.treeTab === 'recent') renderRecent();
  }

  async function fetchTreePage(page) {
    var scope = state.treeTab === 'private' ? 'private' : 'public';
    if (state.query) {
      // 搜索**不带 scope**：文档树的三个来源只是浏览口径，搜的是「我能看到的全部文档」，
      // 否则在「最近修订」页搜索会静默搜不到东西。
      var res = await apiRequest(SEARCH_PATH, {
        params: { q: state.query, types: 'document', page: page, size: PAGE_SIZE },
        silent: true
      });
      if (!res) return { error: '网络错误或登录状态已失效' };
      if (res.code !== 200 || !res.data) return { error: res.msg || '搜索失败' };
      return { items: res.data.items || [], hasMore: !!res.data.has_more };
    }
    var res2 = await apiRequest(LIST_PATH, {
      params: { scope: scope, page: page, size: PAGE_SIZE, folder_id: 0 },
      silent: true
    });
    if (!res2) return { error: '网络错误或登录状态已失效' };
    if (res2.code !== 200 || !res2.data) return { error: res2.msg || '文档列表加载失败' };
    return { items: res2.data.items || [], hasMore: !!res2.data.has_more };
  }

  async function loadTree(reset) {
    if (state.treeTab === 'recent') {
      updateLoadMore();
      renderRecent();
      return;
    }
    if (reset) {
      state.page = 1;
      state.docs = [];
    }
    setTreeBusy(true);
    if (reset) treeLoading();
    var result = await fetchTreePage(state.page);
    setTreeBusy(false);
    if (result.error) { treeError(result.error); updateLoadMore(); return; }
    state.docs = reset ? result.items.slice() : state.docs.concat(result.items);
    state.hasMore = !!result.hasMore;
    if (!reset && !result.items.length) state.hasMore = false;
    renderTree();
    updateLoadMore();
  }

  function setActiveTab() {
    if (!dom.treeTabs) return;
    Array.prototype.forEach.call(dom.treeTabs.querySelectorAll('[data-tree-tab]'), function (btn) {
      var active = btn.getAttribute('data-tree-tab') === state.treeTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  // ============================================================
  // 9. 打开文档 / 新建
  // ============================================================
  async function openDoc(doc, options) {
    options = options || {};
    if (!doc) return;
    if (state.dirty && !options.force) {
      var ok = await modalConfirm(
        '当前编辑器里有未保存的修改，切换文档会丢掉它们。继续吗？',
        { title: '未保存的修改', confirmText: '放弃并切换' }
      );
      if (!ok) return;
    }
    var path;
    if (state.loggedIn) {
      path = DOC_PATH + doc.id;
    } else if (doc.slug) {
      // 匿名只能走 slug 路由（/<int:doc_id> 需要 JWT，命中会 401 后被跳登录）
      path = DOC_PATH + encodeURIComponent(doc.slug);
    } else {
      toast('这篇文档需要登录后才能打开', 'warning');
      return;
    }

    setTreeBusy(true);
    var res = await apiRequest(path, { silent: true });
    setTreeBusy(false);
    if (!res || res.code !== 200 || !res.data) {
      toast((res && res.msg) || '文档加载失败', 'error');
      return;
    }
    var data = res.data;
    state.doc = data;
    state.editingId = data.id != null ? data.id : null;
    state.version = data.version != null ? data.version : null;
    state.dirty = false;
    fillForm(data);
    applyGate();
    markActiveDoc(state.editingId);
    pushRecent(data);
    renderPreview();
  }

  function startNewDoc() {
    if (!state.loggedIn) { toast('请先登录', 'warning'); return; }
    state.doc = null;
    state.editingId = null;
    state.version = null;
    state.dirty = false;
    fillForm({ permission_bits: '100001' });
    if (dom.visibility) dom.visibility.value = 'private';
    applyGate();
    markActiveDoc(null);
    renderPreview();
    if (dom.title) dom.title.focus();
    toast('已新建草稿，保存后才会出现在「我的草稿」里', 'info');
  }

  // ============================================================
  // 10. 修订历史
  // ============================================================
  async function openRevisions() {
    if (!state.editingId) { toast('请先打开一篇文档', 'warning'); return; }
    if (!state.loggedIn) { toast('登录后才能查看修订历史', 'warning'); return; }
    var res = await apiRequest(DOC_PATH + state.editingId + '/revisions', { silent: true });
    if (!res || res.code !== 200) { toast((res && res.msg) || '修订历史加载失败', 'error'); return; }
    state.revisions = Array.isArray(res.data) ? res.data : [];
    renderRevisions();
    openDrawer('revisions');
  }

  function renderRevisions() {
    if (!dom.revisionsList) return;
    clearNode(dom.revisionsList);
    var items = state.revisions;
    if (dom.revisionsEmpty) dom.revisionsEmpty.hidden = items.length > 0;
    items.forEach(function (rev) {
      var li = document.createElement('li');
      li.className = 'creator-rev';

      var head = el('div', 'creator-rev__head');
      head.appendChild(el('span', 'creator-rev__num', 'v' + rev.revision_num));
      head.appendChild(el('span', 'creator-rev__meta',
        '👤 ' + (rev.editor_username || '系统') + ' · ' + fmtTime(rev.created_at)));
      if (rev.has_content === false) {
        head.appendChild(el('span', 'creator-rev__noContent', '无正文快照'));
      }
      li.appendChild(head);

      if (rev.summary) li.appendChild(el('p', 'creator-rev__summary', '📝 ' + rev.summary));

      if (rev.has_content !== false) {
        var actions = el('div', 'creator-rev__actions');
        var viewBtn = el('button', 'creator-btn creator-btn--ghost creator-btn--sm', '查看');
        viewBtn.type = 'button';
        viewBtn.addEventListener('click', function () { viewRevision(rev.revision_num); });
        actions.appendChild(viewBtn);

        var restoreBtn = el('button', 'creator-btn creator-btn--sm', '恢复到此版本');
        restoreBtn.type = 'button';
        restoreBtn.disabled = !canEditCurrent();
        restoreBtn.addEventListener('click', function () { restoreRevision(rev.revision_num); });
        actions.appendChild(restoreBtn);
        li.appendChild(actions);
      }

      dom.revisionsList.appendChild(li);
    });
  }

  async function viewRevision(num) {
    var res = await apiRequest(DOC_PATH + state.editingId + '/revisions/' + num, { silent: true });
    if (!res || res.code !== 200 || !res.data) {
      toast((res && res.msg) || '这一版取不回来', 'error');
      return;
    }
    if (dom.previewNote) {
      dom.previewNote.hidden = false;
      dom.previewNote.textContent = '正在查看第 ' + num + ' 版（只读预览；编辑器里的内容没有被改动）';
    }
    renderPreviewText(res.data.content || '');
    closeDrawer('revisions');
    if (dom.previewWrap && dom.previewWrap.scrollIntoView) {
      try { dom.previewWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 忽略 */ }
    }
  }

  async function restoreRevision(num) {
    var ok = await modalConfirm(
      '把文档恢复到第 ' + num + ' 版？这会新增一条修订记录，历史不会丢。',
      { title: '恢复到这一版', confirmText: '恢复' }
    );
    if (!ok) return;
    var body = {};
    if (state.version != null) body.version = state.version;
    var res = await apiRequest(DOC_PATH + state.editingId + '/revisions/' + num, {
      method: 'POST', body: body, silent: true
    });
    if (!res || res.code !== 200 || !res.data) {
      toast((res && res.msg) || '恢复失败', 'error');
      return;
    }
    var doc = res.data;
    state.doc = doc;
    state.version = doc.version != null ? doc.version : null;
    state.dirty = false;
    fillForm(doc);
    applyGate();
    renderPreview();
    closeDrawer('revisions');
    toast('已恢复到第 ' + num + ' 版', 'success');
    await loadTree(true);
  }

  // ============================================================
  // 11. 内容权限规则
  // ============================================================
  async function openPerms() {
    if (!state.loggedIn) { toast('请先登录', 'warning'); return; }
    if (!state.editingId) { toast('请先打开并保存一篇文档', 'warning'); return; }
    if (!canEditPermissions()) { toast('没有修改这篇文档权限的权限', 'warning'); return; }
    var res = await apiRequest(DOC_PATH + state.editingId + '/permissions', { silent: true });
    if (!res || res.code !== 200) { toast((res && res.msg) || '权限规则加载失败', 'error'); return; }
    var rules = Array.isArray(res.data) ? res.data : [];
    if (dom.permsInput) {
      dom.permsInput.value = rules.map(function (rule) {
        if (rule && rule.rule) return rule.rule;
        return [rule.target, rule.level, rule.category, rule.action, rule.state].join('.');
      }).join('\n');
    }
    openDrawer('perms');
  }

  async function savePerms() {
    if (!state.editingId) return;
    if (!canEditPermissions()) { toast('没有修改权限的权限', 'warning'); return; }
    var lines = String(dom.permsInput ? dom.permsInput.value : '')
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0; });
    var res = await apiRequest(DOC_PATH + state.editingId + '/permissions', {
      method: 'PUT', body: { rules: lines }, silent: true
    });
    if (!res || res.code !== 200) {
      toast((res && res.msg) || '保存权限规则失败', 'error');
      return;
    }
    var saved = (res.data && res.data.saved != null) ? res.data.saved : lines.length;
    toast('已保存 ' + saved + ' 条规则', 'success');
    closeDrawer('perms');
  }

  // ============================================================
  // 12. 右上面板：动态页面（pages/ + 已获取 skills/）
  // ============================================================
  function renderPages(items, emptyText) {
    if (!dom.pagesList) return;
    clearNode(dom.pagesList);
    if (!items.length) {
      dom.pagesList.appendChild(el('p', 'creator-empty', emptyText || '暂无可用页面'));
      return;
    }
    items.forEach(function (item) {
      var key = item.tab_key || item.key || '';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'creator-page';
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('data-page-key', key);
      btn.appendChild(el('span', 'creator-page__icon', item.icon || '📄'));
      var main = el('span', 'creator-page__main');
      var name = el('span', 'creator-page__name', item.label || key || '未命名页面');
      if (item.is_skill) name.appendChild(el('span', 'creator-page__tag', ' (skill)'));
      main.appendChild(name);
      if (item.description) main.appendChild(el('span', 'creator-page__tag', item.description));
      btn.appendChild(main);
      btn.addEventListener('click', function () { openPage(item); });
      dom.pagesList.appendChild(btn);
    });
  }

  async function loadPages() {
    if (!state.loggedIn) {
      state.pages = [];
      renderPages([], '登录后可见：动态页面列表需要登录');
      return;
    }
    var res = await apiRequest(PAGES_PATH, { silent: true });
    if (!res || res.code !== 200) {
      renderPages([], (res && res.msg) || '动态页面列表加载失败');
      return;
    }
    var data = res.data;
    var items = Array.isArray(data) ? data : ((data && data.items) || []);
    state.pages = items;
    renderPages(items, items.length ? '' : '当前账号没有可用的动态页面');
  }

  function clearPageRunner() {
    if (dom.pageRunnerBody) clearNode(dom.pageRunnerBody);
    if (state.pageStyleEl && state.pageStyleEl.parentNode) state.pageStyleEl.parentNode.removeChild(state.pageStyleEl);
    state.pageStyleEl = null;
    if (state.pageScriptEl && state.pageScriptEl.parentNode) state.pageScriptEl.parentNode.removeChild(state.pageScriptEl);
    state.pageScriptEl = null;
    if (state.pageBlobUrl) {
      try { URL.revokeObjectURL(state.pageBlobUrl); } catch (e) { /* 忽略 */ }
      state.pageBlobUrl = null;
    }
    state.pageKey = null;
  }

  function runPageScript(code, key) {
    if (!code) return;
    try {
      state.pageBlobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    } catch (e) {
      console.error('[creator] 动态页面脚本 Blob 创建失败:', key, e);
      return;
    }
    var script = document.createElement('script');
    script.src = state.pageBlobUrl;
    script.setAttribute('data-creator-page-script', key);
    script.addEventListener('load', function () {
      // 脚本执行完即可释放 URL；元素留着，收起时统一清理
      try { URL.revokeObjectURL(state.pageBlobUrl); } catch (e) { /* 忽略 */ }
      state.pageBlobUrl = null;
    });
    document.body.appendChild(script);
    state.pageScriptEl = script;
  }

  async function openPage(item) {
    if (!dom.pageRunner || !dom.pageRunnerBody) return;
    var key = item.tab_key || item.key || '';
    if (!key) return;

    clearPageRunner();
    dom.pageRunner.hidden = false;
    if (dom.pageRunnerTitle) dom.pageRunnerTitle.textContent = (item.icon || '🧩') + ' ' + (item.label || key);
    var loading = el('p', 'creator-loading', '正在加载页面…');
    dom.pageRunnerBody.appendChild(loading);

    var res = await apiRequest(PAGES_PATH + '/' + encodeURIComponent(key), { silent: true });
    if (!res || res.code !== 200) {
      // dashboard 端取不到时再按技能端取一次（已获取的技能在仪表盘里也是这个回退口径）
      res = await apiRequest(SKILLS_PATH + encodeURIComponent(key), { silent: true });
    }
    if (!res || res.code !== 200 || !res.data) {
      clearNode(dom.pageRunnerBody);
      dom.pageRunnerBody.appendChild(el('p', 'creator-empty',
        (res && res.msg) || '页面加载失败（可能需要先获取，或没有访问权限）'));
      return;
    }

    var page = res.data;
    clearPageRunner();
    state.pageKey = key;

    // ⚠️ 与 skill/skill.js 逐字同款：服务端官方页面内容直接写 innerHTML，
    //    脚本走 Blob URL（CSP 已放行 blob:），样式进 <style>。
    //    这些内容不是用户输入（用户输入只走 Markdown 预览的 sanitizeHtml 路径）。
    dom.pageRunnerBody.innerHTML = page.html || '<p class="creator-empty">这个页面没有内容。</p>';
    if (page.css) {
      var style = document.createElement('style');
      style.setAttribute('data-creator-page-style', key);
      style.textContent = page.css;
      document.head.appendChild(style);
      state.pageStyleEl = style;
    }
    runPageScript(page.js, key);

    Array.prototype.forEach.call(dom.pagesList ? dom.pagesList.querySelectorAll('[data-page-key]') : [], function (node) {
      node.classList.toggle('is-active', node.getAttribute('data-page-key') === key);
    });
  }

  function closePageRunner() {
    clearPageRunner();
    if (dom.pageRunner) dom.pageRunner.hidden = true;
    if (dom.pagesList) {
      Array.prototype.forEach.call(dom.pagesList.querySelectorAll('[data-page-key]'), function (node) {
        node.classList.remove('is-active');
      });
    }
  }

  // ============================================================
  // 13. 右下面板：交流（公开 / 个人通知）
  // ============================================================
  function renderNotice(item, isPersonal) {
    var unread = item.is_read === false;
    var box = el('div', 'creator-notice');
    if (unread) box.classList.add('creator-notice--unread');

    var head = el('div', 'creator-notice__head');
    head.appendChild(el('span', 'creator-notice__name', item.title || '（无标题）'));
    head.appendChild(el('span', 'creator-notice__time', fmtTime(item.created_at)));
    box.appendChild(head);

    if (item.content) box.appendChild(el('div', 'creator-notice__text', item.content));

    if (isPersonal && item.link_url) {
      var link = el('a', 'creator-notice__link', '查看详情 →');
      // 只认站内相对路径，避免把后端字段变成外跳（与全站链接口径一致）
      if (/^\//.test(item.link_url) && item.link_url.charAt(1) !== '/') {
        link.href = item.link_url;
        box.appendChild(link);
      }
    }
    return box;
  }

  function renderNotifications() {
    if (dom.notifyGlobal) {
      clearNode(dom.notifyGlobal);
      if (state.notifyGlobalError) {
        dom.notifyGlobal.appendChild(notifyErrorBox(state.notifyGlobalError));
      } else if (!state.notifyGlobal.length) {
        dom.notifyGlobal.appendChild(el('p', 'creator-empty', '暂时没有公开通知。'));
      } else {
        state.notifyGlobal.forEach(function (item) {
          dom.notifyGlobal.appendChild(renderNotice(item, false));
        });
      }
    }
    if (dom.notifyPersonal) {
      clearNode(dom.notifyPersonal);
      if (!state.loggedIn) {
        dom.notifyPersonal.appendChild(el('p', 'creator-empty', '登录后可见。'));
      } else if (state.notifyPersonalError) {
        dom.notifyPersonal.appendChild(notifyErrorBox(state.notifyPersonalError));
      } else if (!state.notifyPersonal.length) {
        dom.notifyPersonal.appendChild(el('p', 'creator-empty', '还没有收到个人通知。'));
      } else {
        state.notifyPersonal.forEach(function (item) {
          dom.notifyPersonal.appendChild(renderNotice(item, true));
        });
      }
    }
  }

  async function loadNotifications() {
    var g = await apiRequest(NOTIFY_GLOBAL, { silent: true });
    state.notifyGlobal = (g && g.code === 200 && Array.isArray(g.data)) ? g.data : [];
    state.notifyGlobalError = (g && g.code === 200) ? '' : ((g && g.msg) || '公开通知加载失败');
    state.notifyPersonal = [];
    state.notifyPersonalError = '';
    if (state.loggedIn) {
      var p = await apiRequest(NOTIFY_PERSONAL, { silent: true });
      if (p && p.code === 200 && p.data) {
        state.notifyPersonal = p.data.items || [];
      } else {
        state.notifyPersonalError = (p && p.msg) || '我的通知加载失败';
      }
    }
    renderNotifications();
  }

  /** 错误态：一行说明 + 重试按钮（与文档树的错误态同一口径） */
  function notifyErrorBox(message) {
    var box = el('div', 'creator-error');
    box.appendChild(el('p', '', message));
    var retry = el('button', 'creator-btn creator-btn--ghost creator-btn--sm', '重试');
    retry.type = 'button';
    retry.addEventListener('click', loadNotifications);
    box.appendChild(retry);
    return box;
  }

  async function markAllRead() {
    if (!state.loggedIn) { toast('登录后才能标记已读', 'warning'); return; }
    var ids = state.notifyGlobal.map(function (item) { return item.id; });
    var res = await apiRequest(NOTIFY_READ_ALL, {
      method: 'POST', body: { global_ids: ids }, silent: true
    });
    if (!res || res.code !== 200) {
      toast((res && res.msg) || '标记已读失败', 'error');
      return;
    }
    toast('已全部标记为已读', 'success');
    loadNotifications();
  }

  // ============================================================
  // 14. 抽屉（修订历史 / 权限规则）
  // ============================================================
  var drawerMap = {};

  function openDrawer(name) {
    var drawer = drawerMap[name];
    if (!drawer) return;
    state.lastFocus = document.activeElement;
    drawer.hidden = false;
    var focusTarget = drawer.querySelector('textarea, input, button');
    if (focusTarget && focusTarget.focus) focusTarget.focus();
  }

  function closeDrawer(name) {
    var drawer = drawerMap[name];
    if (!drawer) return;
    drawer.hidden = true;
    if (state.lastFocus && state.lastFocus.focus) {
      try { state.lastFocus.focus(); } catch (e) { /* 忽略 */ }
    }
  }

  function anyDrawerOpen() {
    return Object.keys(drawerMap).some(function (k) { return drawerMap[k] && !drawerMap[k].hidden; });
  }

  // ============================================================
  // 15. 面板宽度 / 显隐（localStorage 记忆）
  // ============================================================
  function applyWidth(side, px) {
    if (!dom.workspace) return;
    var varName = side === 'left' ? '--creator-left' : '--creator-right';
    dom.workspace.style.setProperty(varName, px + 'px');
    var handle = side === 'left' ? dom.splitLeft : dom.splitRight;
    if (handle) handle.setAttribute('aria-valuenow', String(px));
  }

  function currentWidth(side) {
    if (!dom.workspace) return side === 'left' ? 280 : 340;
    var raw = getComputedStyle(dom.workspace).getPropertyValue(side === 'left' ? '--creator-left' : '--creator-right');
    var n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
    return side === 'left' ? 280 : 340;
  }

  function bindSplitter(handle, side) {
    if (!handle) return;
    var min = side === 'left' ? LEFT_MIN : RIGHT_MIN;
    var max = side === 'left' ? LEFT_MAX : RIGHT_MAX;
    var storeKey = side === 'left' ? STORE.left : STORE.right;
    var dragging = false;
    var startX = 0;
    var startWidth = 0;

    handle.addEventListener('pointerdown', function (event) {
      // 窄屏是纵向堆叠，横向拖拽没有意义（分隔条此时也已被 CSS 隐藏）
      if (window.matchMedia && window.matchMedia('(max-width: 1080px)').matches) return;
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth(side);
      handle.classList.add('is-dragging');
      document.body.classList.add('creator-resizing');
      if (handle.setPointerCapture) {
        try { handle.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      }
      event.preventDefault();
    });

    handle.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var delta = event.clientX - startX;
      var next = side === 'left' ? startWidth + delta : startWidth - delta;
      next = Math.min(max, Math.max(min, Math.round(next)));
      applyWidth(side, next);
    });

    function stopDrag() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.body.classList.remove('creator-resizing');
      writeStore(storeKey, String(currentWidth(side)));
    }
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);

    // 键盘可达：方向键微调（Shift 加速），Home / End 直达两端
    handle.addEventListener('keydown', function (event) {
      var step = event.shiftKey ? 40 : 16;
      var now = currentWidth(side);
      var next = null;
      if (event.key === 'ArrowLeft') next = side === 'left' ? now - step : now + step;
      else if (event.key === 'ArrowRight') next = side === 'left' ? now + step : now - step;
      else if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
      if (next === null) return;
      event.preventDefault();
      next = Math.min(max, Math.max(min, next));
      applyWidth(side, next);
      writeStore(storeKey, String(next));
    });
  }

  function setPanels(visible, persist) {
    state.panelsVisible = !!visible;
    if (dom.workspace) dom.workspace.classList.toggle('is-panels-hidden', !visible);
    if (dom.panelsBtn) dom.panelsBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    if (persist) writeStore(STORE.panels, visible ? '1' : '0');
  }

  function setPreview(visible, persist) {
    state.previewOn = !!visible;
    if (dom.panes) dom.panes.classList.toggle('is-preview-off', !visible);
    if (dom.previewBtn) dom.previewBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    if (persist) writeStore(STORE.preview, visible ? '1' : '0');
  }

  function applyStoredLayout() {
    var left = clampInt(readStore(STORE.left), LEFT_MIN, LEFT_MAX);
    var right = clampInt(readStore(STORE.right), RIGHT_MIN, RIGHT_MAX);
    if (left != null) applyWidth('left', left);
    if (right != null) applyWidth('right', right);
    setPanels(readStore(STORE.panels) !== '0', false);
    setPreview(readStore(STORE.preview) !== '0', false);

    var tab = readStore(STORE.tab);
    if (tab === 'public' || tab === 'private' || tab === 'recent') state.treeTab = tab;
    setActiveTab();
  }

  // ============================================================
  // 16. 事件绑定
  // ============================================================
  function bindTopbar() {
    if (dom.newBtn) dom.newBtn.addEventListener('click', startNewDoc);
    if (dom.saveBtn) dom.saveBtn.addEventListener('click', function () { saveDoc(); });
    if (dom.submitBtn) dom.submitBtn.addEventListener('click', submitPublic);
    if (dom.permsBtn) dom.permsBtn.addEventListener('click', openPerms);
    if (dom.revisionsBtn) dom.revisionsBtn.addEventListener('click', openRevisions);
    if (dom.previewBtn) {
      dom.previewBtn.addEventListener('click', function () { setPreview(!state.previewOn, true); });
    }
    if (dom.panelsBtn) {
      dom.panelsBtn.addEventListener('click', function () { setPanels(!state.panelsVisible, true); });
    }
    if (dom.refreshBtn) {
      dom.refreshBtn.addEventListener('click', function () {
        loadTree(true);
        loadPages();
        loadNotifications();
      });
    }
  }

  function bindTree() {
    if (dom.treeTabs) {
      dom.treeTabs.addEventListener('click', function (event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-tree-tab]') : null;
        if (!btn) return;
        var tab = btn.getAttribute('data-tree-tab');
        if (tab === state.treeTab) return;
        state.treeTab = tab;
        writeStore(STORE.tab, tab);
        setActiveTab();
        loadTree(true);
      });
    }

    var onSearch = debounce(function () {
      state.query = (dom.searchInput && dom.searchInput.value || '').trim();
      loadTree(true);
    }, 320);
    if (dom.searchInput) {
      dom.searchInput.addEventListener('input', onSearch);
      dom.searchInput.addEventListener('search', onSearch);
    }

    if (dom.treeList) {
      dom.treeList.addEventListener('click', function (event) {
        var node = event.target && event.target.closest ? event.target.closest('[data-doc-id]') : null;
        if (!node) return;
        var id = node.getAttribute('data-doc-id');
        var doc = null;
        for (var i = 0; i < state.docs.length; i++) {
          if (String(state.docs[i].id) === String(id)) { doc = state.docs[i]; break; }
        }
        if (!doc) {
          var recent = readRecent();
          for (var j = 0; j < recent.length; j++) {
            if (String(recent[j].id) === String(id)) { doc = recent[j]; break; }
          }
        }
        if (!doc) doc = { id: id, slug: node.getAttribute('data-doc-slug') || '' };
        openDoc(doc);
      });
    }

    if (dom.loadMoreBtn) {
      dom.loadMoreBtn.addEventListener('click', function () {
        if (!state.hasMore) return;
        state.page += 1;
        loadTree(false);
      });
    }
  }

  function bindEditor() {
    [dom.title, dom.summary, dom.icon, dom.folder].forEach(function (node) {
      if (node) node.addEventListener('input', markDirty);
    });
    if (dom.content) {
      dom.content.addEventListener('input', function () {
        markDirty();
        schedulePreview();
      });
      // Tab 插入两个空格：文本域里 Tab 直接跳走会让写代码块很难受
      dom.content.addEventListener('keydown', function (event) {
        if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
          if (!canEditCurrent()) return;
          event.preventDefault();
          insertAtCursor('  ');
        }
      });
    }
    if (dom.visibility) {
      dom.visibility.addEventListener('change', function () {
        if (dom.visibility.value === 'public' && !state.canCreate) {
          dom.visibility.value = 'private';
          toast('当前账号没有 *.create 权限，不能创建公共文档', 'warning');
          return;
        }
        if (dom.visibility.value === 'public' && !state.editingId) {
          // 新投稿默认让所有等级可看（默认位 '100001' 只放行 Lv1，投稿场景通常不合适）
          writeBits('111111');
        }
        markDirty();
        applyGate();
      });
    }
    if (dom.bits) {
      dom.bits.addEventListener('change', markDirty);
    }
    if (dom.toolbar) {
      dom.toolbar.addEventListener('click', function (event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-md]') : null;
        if (!btn) return;
        applyMarkdownAction(btn.getAttribute('data-md'));
      });
    }
    if (dom.imageInput) {
      dom.imageInput.addEventListener('change', function () {
        var file = dom.imageInput.files && dom.imageInput.files[0];
        dom.imageInput.value = '';     // 允许再次选同一张图
        if (file) uploadAndInsert(file);
      });
    }

    // 键盘快捷键：Ctrl/Cmd+S 保存，Ctrl/Cmd+B 加粗
    document.addEventListener('keydown', function (event) {
      var meta = event.ctrlKey || event.metaKey;
      if (!meta) return;
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        saveDoc();
      } else if (event.key === 'b' || event.key === 'B') {
        if (document.activeElement === dom.content) {
          event.preventDefault();
          applyMarkdownAction('bold');
        }
      }
    });
  }

  function bindDrawers() {
    drawerMap.revisions = $('creatorRevisionsDrawer');
    drawerMap.perms = $('creatorPermsDrawer');

    document.addEventListener('click', function (event) {
      var node = event.target && event.target.closest ? event.target.closest('[data-drawer-close]') : null;
      if (!node) return;
      closeDrawer(node.getAttribute('data-drawer-close'));
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && anyDrawerOpen()) {
        if (drawerMap.revisions && !drawerMap.revisions.hidden) closeDrawer('revisions');
        if (drawerMap.perms && !drawerMap.perms.hidden) closeDrawer('perms');
      }
    });

    if (dom.permsSave) dom.permsSave.addEventListener('click', savePerms);

    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty || !state.loggedIn) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
  }

  function bindDock() {
    if (dom.readAllBtn) dom.readAllBtn.addEventListener('click', markAllRead);
    if (dom.pagesRefresh) dom.pagesRefresh.addEventListener('click', loadPages);
    if (dom.pageRunnerClose) dom.pageRunnerClose.addEventListener('click', closePageRunner);
  }

  // ============================================================
  // 17. 初始化
  // ============================================================
  function cacheDom() {
    dom.workspace = $('creatorWorkspace');
    dom.status = $('creatorStatus');
    dom.banner = $('creatorBanner');
    dom.treeList = $('creatorTreeList');
    dom.treeTabs = $('creatorTreeTabs');
    dom.searchInput = $('creatorSearchInput');
    dom.loadMoreWrap = $('creatorLoadMoreWrap');
    dom.loadMoreBtn = $('creatorLoadMoreBtn');
    dom.refreshBtn = $('creatorRefreshBtn');
    dom.splitLeft = $('creatorSplitLeft');
    dom.splitRight = $('creatorSplitRight');
    dom.title = $('creatorTitle');
    dom.summary = $('creatorSummary');
    dom.icon = $('creatorIcon');
    dom.visibility = $('creatorVisibility');
    dom.folder = $('creatorFolder');
    dom.bits = $('creatorBits');
    dom.toolbar = document.querySelector('.creator-toolbar');
    dom.content = $('creatorContent');
    dom.panes = $('creatorPanes');
    dom.preview = $('creatorPreview');
    dom.previewWrap = $('creatorPreviewWrap');
    dom.previewNote = $('creatorPreviewNote');
    dom.hint = $('creatorEditorHint');
    dom.newBtn = $('creatorNewBtn');
    dom.saveBtn = $('creatorSaveBtn');
    dom.submitBtn = $('creatorSubmitBtn');
    dom.permsBtn = $('creatorPermsBtn');
    dom.previewBtn = $('creatorPreviewBtn');
    dom.panelsBtn = $('creatorPanelsBtn');
    dom.revisionsBtn = $('creatorRevisionsBtn');
    dom.revisionsList = $('creatorRevisionsList');
    dom.revisionsEmpty = $('creatorRevisionsEmpty');
    dom.permsInput = $('creatorPermsInput');
    dom.permsSave = $('creatorPermsSave');
    dom.pagesList = $('creatorPagesList');
    dom.pagesRefresh = $('creatorPagesRefresh');
    dom.pageRunner = $('creatorPageRunner');
    dom.pageRunnerTitle = $('creatorPageRunnerTitle');
    dom.pageRunnerBody = $('creatorPageRunnerBody');
    dom.pageRunnerClose = $('creatorPageRunnerClose');
    dom.notifyGlobal = $('creatorNotifyGlobal');
    dom.notifyPersonal = $('creatorNotifyPersonal');
    dom.readAllBtn = $('creatorReadAllBtn');
    dom.imageInput = $('creatorImageInput');
  }

  function init() {
    cacheDom();
    state.loggedIn = isLoggedIn();

    bindTopbar();
    bindTree();
    bindEditor();
    bindDrawers();
    bindDock();
    bindSplitter(dom.splitLeft, 'left');
    bindSplitter(dom.splitRight, 'right');
    applyStoredLayout();
    setActiveTab();

    renderStatus();
    renderBanner();
    applyGate();

    loadStatus();
    loadTree(true);
    loadPages();
    loadNotifications();

    ensureMarkedLoaded().then(function (ok) {
      if (ok) renderPreview();
      else if (dom.preview) {
        clearNode(dom.preview);
        dom.preview.appendChild(el('p', 'creator-error', 'Markdown 渲染器（marked）加载失败，预览不可用；编辑器本身仍可正常写作与保存。'));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
