/**
 * discover.js
 * 「发现（Discover）」共享前端模块 —— 普通脚本（IIFE，非 ES module），挂到 window.Discover。
 *
 * 契约：file-wiki/_discover-contract.md
 *   §1   板块常量（前端写死，与 site-back/utils/discover_rules.py 同值）
 *   §3   板块 → 动作映射 + 预留提示文案（逐字一致）
 *   §7.3 window.Discover 门面
 *   §7.4 页面清单与职责
 *
 * ⚠️ 本文件同时负责 11 个发现页的初始化（页面里不允许写内联脚本标签），
 *    页面通过 body 上的 data 属性声明自己是哪一类：
 *      body[data-discover-page="index"]                              聚合页（板块导航 + 全板块流）
 *      body[data-discover-page="section"]                            通用板块页（读 ?key=）
 *      body[data-discover-page="board"][data-discover-key="doc"]     静态板块页（key 写死，不读 query）
 *      body[data-discover-page="detail"][data-discover-key="doc"]    详情页（读 ?id=）
 *
 * ⚠️ 「前端写死板块表、按后端返回的 item.type / item.actions 渲染」：本文件不猜类型，
 *    一律读后端字段；未知 action 静默忽略（不渲染按钮、不发请求）。
 */
(function () {
  'use strict';

  // ===== §1 板块常量（前端写死，与后端常量逐字同值）=====
  var SECTIONS = [
    { key: 'doc',   label: '文档', icon: '📚', path: 'discover/doc/index.html',   detail: 'discover/doc/details.html' },
    { key: 'group', label: '组',   icon: '👥', path: 'discover/group/index.html', detail: 'discover/group/details.html' },
    { key: 'org',   label: '组织', icon: '🏛️', path: 'discover/org/index.html',   detail: 'discover/org/details.html' },
    { key: 'tool',  label: '工具', icon: '🧰', path: 'discover/tool/index.html',  detail: 'discover/tool/details.html' }
  ];

  // ===== §3 预留提示文案（与后端 / 契约逐字一致，两处一致）=====
  var ACTION_PLACEHOLDER = {
    use: '工具功能预留中，暂未接入真实接口',
    join: '加入功能预留中，请通过组织页的邀请码 / 点名邀请加入'
  };

  // 支持的动作 → 按钮文案（view/use/join 之外的动作一律静默忽略）
  var ACTION_LABELS = { view: '查看', use: '使用', join: '加入' };

  // 前端固定文案（非后端下发，无需转义；仍统一走 escapeHtml 以免将来被替换成动态值）
  var TEXT = {
    loading: '加载中…',
    empty: '暂时还没有公开的展示内容',
    emptyHint: '只有公开内容，且由所有者在展示页开启后，才会出现在这里。',
    error: '加载失败，请稍后重试',
    retry: '重新加载',
    missingId: '缺少展示内容 id',
    missingIdHint: '请从发现页的卡片进入详情。',
    notFound: '展示内容不存在或未公开',
    noSection: '板块不存在',
    noSectionHint: '请从发现页选择一个有效的板块。',
    noView: '暂无可查看的内容',
    noActions: '该内容暂无可执行的操作。',
    untitled: '未命名内容'
  };

  var FEED_API = '/api/v0/discover/feed';
  var ITEM_API = '/api/v0/discover/item/';
  var FEED_LIMIT_DEFAULT = 12;   // 与后端默认一致
  var FEED_LIMIT_MIN = 1;
  var FEED_LIMIT_MAX = 60;       // 与后端夹取范围一致
  var SKELETON_COUNT = 6;

  // ===== 基础工具 =====

  /**
   * escapeHtml — 直接代理 js/utils.js 的 window.escapeHtml。
   * 契约 §7.2：渲染后端字符串一律走它，**不要**在本文件里再写一份 esc()。
   * 缺失时直接抛错（暴露脚本顺序装配问题），绝不静默放过未转义字符串。
   */
  function escapeHtml(str) {
    if (typeof window.escapeHtml !== 'function') {
      throw new Error('window.escapeHtml 未加载：请检查脚本顺序（utils.js 必须在 discover.js 之前）');
    }
    return window.escapeHtml(str);
  }

  /**
   * 站点根前缀 = window.BASE_PATH（由 js/config.js 按 **URL 目录深度**计算，不是白名单正则）：
   *   `/discover/index.html`、`/discover/section.html`（一层深）→ `'..'`
   *   `/discover/<板块>/index.html`、`/discover/<板块>/details.html`（**两层深**）→ `'../..'`
   *   `/index.html`（站点根）→ `'.'`
   * 所以本文件**只负责 `BASE_PATH + '/' + 站点根相对路径`**，绝不再自己数 `..`
   * （历史上 discover 子目录用固定 `..` 会让「查看」跳转、sectionPath/detailPath 全部 404，
   *   见 PROJECT_MEMORY §6.1 与 tools/test-discover-page.mjs 的 [a] 组回归）。
   */
  function basePath() {
    return (typeof window.BASE_PATH === 'string' && window.BASE_PATH) ? window.BASE_PATH : '.';
  }

  /** 统一提示入口（utils.js::showToast → toast.js） */
  function toast(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
      return;
    }
    if (window.Toast && typeof window.Toast.show === 'function') {
      window.Toast.show(msg, 'info');
    }
  }

  /** 正整数 id 归一化：缺失 / 非数字 / <=0 一律返回 null */
  function toPositiveInt(value) {
    if (value === null || value === undefined) return null;
    var str = String(value).trim();
    if (!/^\d+$/.test(str)) return null;
    var num = Number(str);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  }

  /** 读 URL 查询参数（URL 不可用时返回 null，不抛） */
  function readQuery(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch (e) {
      return null;
    }
  }

  /** 读 body 上的 data-discover-* 声明（缺失时返回 ''） */
  function bodyData(name) {
    var body = document.body;
    if (!body || !body.dataset) return '';
    var value = body.dataset[name];
    return typeof value === 'string' ? value : '';
  }

  // ===== §1 板块查询 =====

  /** sectionByKey(key) -> 板块对象 | null */
  function sectionByKey(key) {
    if (typeof key !== 'string' || !key) return null;
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].key === key) return SECTIONS[i];
    }
    return null;
  }

  /**
   * sectionPath(key) -> 可直接放进 href 的**已拼 BASE_PATH** 的链接（契约 §7.3 修订 v1.1）。
   *   `/discover/index.html` 上 → `'../discover/doc/index.html'` → 解析为 `/discover/doc/index.html`
   *   `/discover/<板块>/*.html` 上 → `'../../discover/doc/index.html'` → 同样解析为 `/discover/doc/index.html`
   * 未知 key 返回 ''（调用方据此走「板块不存在」分支）。
   */
  function sectionPath(key) {
    var section = sectionByKey(key);
    if (!section) return '';
    return basePath() + '/' + section.path;
  }

  /**
   * detailPath(key, itemId) -> 可直接放进 href 的**已拼 BASE_PATH** 的链接。
   *   `/discover/index.html` 上 → `'../discover/doc/details.html?id=12'`
   *   `/discover/<板块>/*.html` 上 → `'../../discover/doc/details.html?id=12'`
   * id 非法时仍返回详情页地址（不带 ?id=），由详情页显示「缺少展示内容 id」。
   */
  function detailPath(key, itemId) {
    var section = sectionByKey(key);
    if (!section) return '';
    var id = toPositiveInt(itemId);
    var url = basePath() + '/' + section.detail;
    return id === null ? url : url + '?id=' + id;
  }

  /** 未知板块类型时的兜底链接 → 通用板块页（会显示「板块不存在」空态） */
  function fallbackPath(type) {
    var key = typeof type === 'string' && type ? type : '';
    return basePath() + '/discover/section.html?key=' + encodeURIComponent(key);
  }

  // ===== §4 公开接口 =====

  /** 夹取 limit：非法 → 返回 null（交给后端默认值），合法 → 夹到 [1,60] */
  function normalizeLimit(limit) {
    var num = Number(limit);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.min(FEED_LIMIT_MAX, Math.max(FEED_LIMIT_MIN, Math.floor(num)));
  }

  /**
   * feed({section, limit}) -> Promise<{section,total,items}|null>
   * null = 网络失败 / 响应格式异常 / 非 200（由 renderFeed 显示错误态）。
   */
  async function feed(opts) {
    if (typeof window.apiRequest !== 'function') return null;
    opts = opts || {};
    var section = (typeof opts.section === 'string' && opts.section) ? opts.section : 'all';
    var params = { section: section };
    var limit = normalizeLimit(opts.limit);
    if (limit !== null) params.limit = limit;

    var res = await window.apiRequest(FEED_API, { params: params, silent: true });
    if (!res || Number(res.code) !== 200 || !res.data || typeof res.data !== 'object') return null;
    var data = res.data;
    return {
      section: (typeof data.section === 'string' && data.section) ? data.section : section,
      total: Number.isFinite(Number(data.total)) ? Number(data.total) : 0,
      items: Array.isArray(data.items) ? data.items : []
    };
  }

  /**
   * detailState(itemId) -> Promise<{status:'ok'|'invalid-id'|'not-found'|'error', item}>
   * 详情页靠 status 区分三种空态（契约 §7.4：缺少 id / 404 / 网络失败）。
   */
  async function detailState(itemId) {
    var id = toPositiveInt(itemId);
    if (id === null) return { status: 'invalid-id', item: null };
    if (typeof window.apiRequest !== 'function') return { status: 'error', item: null };

    var res = await window.apiRequest(ITEM_API + id, { silent: true });
    if (res && Number(res.code) === 200 && res.data && res.data.item) {
      return { status: 'ok', item: res.data.item };
    }
    // 不可见 / 不存在：后端 404 + 「展示内容不存在或未公开」
    if (res && Number(res.code) === 404) return { status: 'not-found', item: null };
    return { status: 'error', item: null };
  }

  /** detail(itemId) -> Promise<item|null>（契约 §7.3：失败一律 null） */
  async function detail(itemId) {
    var result = await detailState(itemId);
    return result.status === 'ok' ? result.item : null;
  }

  // ===== §7.3 渲染 =====

  /**
   * cardHtml(item, opts) -> 整卡 <a href=detailPath> 的 HTML 字符串（后端字符串全部转义）
   * opts.showSection === false 时不渲染板块标签（板块页内冗余，聚合页需要）。
   */
  function cardHtml(item, opts) {
    if (!item || typeof item !== 'object') return '';
    opts = opts || {};

    var type = (typeof item.type === 'string' && item.type) ? item.type : item.section;
    var section = sectionByKey(type) || sectionByKey(item.section);
    var href = section ? detailPath(section.key, item.id) : fallbackPath(type);
    if (!href) return '';

    var icon = item.icon || (section ? section.icon : '') || '🔎';
    var label = section ? section.label : (item.section_label || '');
    var showSection = opts.showSection !== false;

    var html = '';
    html += '<a class="discover-card" href="' + escapeHtml(href) + '">';
    html += '<div class="discover-card__head">';
    html += '<span class="discover-card__icon" aria-hidden="true">' + escapeHtml(icon) + '</span>';
    if (showSection && label) {
      var badge = section ? (section.icon + ' ' + label) : label;
      html += '<span class="discover-card__badge">' + escapeHtml(badge) + '</span>';
    }
    html += '</div>';

    html += '<h3 class="discover-card__title">' + escapeHtml(item.title || TEXT.untitled) + '</h3>';
    if (item.summary) {
      html += '<p class="discover-card__summary">' + escapeHtml(item.summary) + '</p>';
    }

    var tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.length) {
      html += '<div class="discover-card__tags">';
      for (var i = 0; i < tags.length; i++) {
        html += '<span class="discover-tag">' + escapeHtml(tags[i]) + '</span>';
      }
      html += '</div>';
    }

    html += '<div class="discover-card__meta">';
    if (item.owner_username) {
      html += '<span class="discover-card__owner">' + escapeHtml(item.owner_username) + '</span>';
    }
    var views = Number(item.view_count);
    if (Number.isFinite(views) && views >= 0) {
      html += '<span class="discover-card__views">' + views + ' 次浏览</span>';
    }
    html += '</div>';
    html += '</a>';
    return html;
  }

  /** actionsOf(item) -> 数组：只保留 view/use/join，未知 action 静默忽略且去重 */
  function actionsOf(item) {
    if (!item || !Array.isArray(item.actions)) return [];
    var out = [];
    for (var i = 0; i < item.actions.length; i++) {
      var action = item.actions[i];
      if (typeof action !== 'string') continue;
      if (!Object.prototype.hasOwnProperty.call(ACTION_LABELS, action)) continue;
      if (out.indexOf(action) === -1) out.push(action);
    }
    return out;
  }

  /** renderActions(container, item) -> 渲染按钮并绑定 runAction；返回实际渲染的动作数组 */
  function renderActions(container, item) {
    if (!container) return [];
    var actions = actionsOf(item);
    container.innerHTML = '';
    for (var i = 0; i < actions.length; i++) {
      (function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'discover-action discover-action--' + action;
        btn.setAttribute('data-action', action);
        btn.textContent = ACTION_LABELS[action];
        btn.addEventListener('click', function () { runAction(action, item); });
        container.appendChild(btn);
      })(actions[i]);
    }
    return actions;
  }

  /**
   * runAction(action, item) —— 统一动作分发。
   *   view → 跳转 BASE_PATH + '/' + source_url（为空则 toast「暂无可查看的内容」）
   *   use  → 只 showToast 占位文案，**不发任何网络请求**
   *   join → 只 showToast 占位文案，**不发任何网络请求**
   *   其它 → 静默忽略（不渲染按钮、不提示、不发请求）
   */
  function runAction(action, item) {
    if (action === 'view') {
      var sourceUrl = (item && typeof item.source_url === 'string') ? item.source_url : '';
      if (!sourceUrl) {
        toast(TEXT.noView);
        return;
      }
      window.location.href = basePath() + '/' + sourceUrl;
      return;
    }
    if (action === 'use') {
      toast(ACTION_PLACEHOLDER.use);
      return;
    }
    if (action === 'join') {
      toast(ACTION_PLACEHOLDER.join);
      return;
    }
    // 未知 action：静默忽略
  }

  // ===== 状态片段（骨架 / 空态 / 错误态）=====

  function stateHtml(kind, text, hint, withRetry) {
    var icon = kind === 'error' ? '⚠️' : (kind === 'empty' ? '🗂️' : '⏳');
    var html = '<div class="discover-state discover-state--' + kind + '">';
    html += '<div class="discover-state__icon" aria-hidden="true">' + icon + '</div>';
    html += '<p class="discover-state__text">' + escapeHtml(text) + '</p>';
    if (hint) html += '<p class="discover-state__hint">' + escapeHtml(hint) + '</p>';
    if (withRetry) html += '<button type="button" class="discover-state__retry">' + escapeHtml(TEXT.retry) + '</button>';
    html += '</div>';
    return html;
  }

  function skeletonHtml() {
    var html = '';
    for (var i = 0; i < SKELETON_COUNT; i++) {
      html += '<div class="discover-skeleton" aria-hidden="true">';
      html += '<span class="discover-skeleton__line discover-skeleton__line--icon"></span>';
      html += '<span class="discover-skeleton__line discover-skeleton__line--title"></span>';
      html += '<span class="discover-skeleton__line"></span>';
      html += '<span class="discover-skeleton__line discover-skeleton__line--short"></span>';
      html += '</div>';
    }
    return html;
  }

  function bindRetry(container, handler) {
    var btn = container.querySelector('.discover-state__retry');
    if (btn) btn.addEventListener('click', handler);
  }

  // ===== 页面装配（§7.4）=====

  /**
   * renderFeed(container, opts) -> Promise<{section,total,items}|null>
   * 一站式：骨架 → 拉数据 → 卡片网格 / 空态 / 错误态（错误态带「重新加载」）。
   */
  async function renderFeed(container, opts) {
    if (!container) return null;
    opts = opts || {};
    container.innerHTML = skeletonHtml();

    var data = await feed(opts);
    if (!data) {
      container.innerHTML = stateHtml('error', TEXT.error, '', true);
      bindRetry(container, function () { renderFeed(container, opts); });
      return null;
    }
    if (!data.items.length) {
      container.innerHTML = stateHtml('empty', TEXT.empty, TEXT.emptyHint, false);
      return data;
    }

    var html = '';
    for (var i = 0; i < data.items.length; i++) {
      html += cardHtml(data.items[i], opts);
    }
    container.innerHTML = html;
    return data;
  }

  function boardNavHtml() {
    var html = '';
    for (var i = 0; i < SECTIONS.length; i++) {
      var section = SECTIONS[i];
      html += '<a class="discover-board" href="' + escapeHtml(sectionPath(section.key)) + '">';
      html += '<span class="discover-board__icon" aria-hidden="true">' + escapeHtml(section.icon) + '</span>';
      html += '<span class="discover-board__label">' + escapeHtml(section.label) + '</span>';
      html += '<span class="discover-board__desc">浏览公开的' + escapeHtml(section.label) + '</span>';
      html += '</a>';
    }
    return html;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateMeta(id, data) {
    if (!data) return;
    setText(id, '共 ' + data.total + ' 条公开内容');
  }

  /** 聚合页：板块导航 + feed({section:'all', limit:24})，卡片显示板块标签 */
  function initIndexPage() {
    var navEl = document.getElementById('discoverBoardNav');
    if (navEl) navEl.innerHTML = boardNavHtml();

    var feedEl = document.getElementById('discoverFeed');
    if (!feedEl) return;
    renderFeed(feedEl, { section: 'all', limit: 24, showSection: true }).then(function (data) {
      updateMeta('discoverMeta', data);
    });
  }

  /**
   * 板块页：useFixedKey=true 时 key 来自 body[data-discover-key]（写死，不读 query）；
   * 否则读 ?key=（section.html 通用兜底页）。
   */
  function initSectionPage(useFixedKey) {
    var key = useFixedKey ? bodyData('discoverKey') : (readQuery('key') || '');
    var section = sectionByKey(key);

    if (!section) {
      setText('discoverTitle', TEXT.noSection);
      setText('discoverDesc', TEXT.noSectionHint);
      document.title = TEXT.noSection + ' | 发现 | GWL';
      var invalidEl = document.getElementById('discoverFeed');
      if (invalidEl) invalidEl.innerHTML = stateHtml('empty', TEXT.noSection, TEXT.noSectionHint, false);
      return;
    }

    setText('discoverTitle', section.icon + ' ' + section.label);
    setText('discoverDesc', '这里汇总所有公开的「' + section.label + '」展示内容。');
    document.title = section.label + ' | 发现 | GWL';

    var feedEl = document.getElementById('discoverFeed');
    if (!feedEl) return;
    renderFeed(feedEl, { section: section.key, limit: 24, showSection: false }).then(function (data) {
      updateMeta('discoverMeta', data);
    });
  }

  /** 详情页：读 ?id=，按 item.actions 渲染按钮 */
  function initDetailPage() {
    var container = document.getElementById('discoverDetail');
    if (!container) return;

    var itemId = toPositiveInt(readQuery('id'));
    if (itemId === null) {
      container.innerHTML = stateHtml('empty', TEXT.missingId, TEXT.missingIdHint, false);
      return;
    }
    loadDetail(container, itemId);
  }

  async function loadDetail(container, itemId) {
    container.innerHTML = stateHtml('loading', TEXT.loading, '', false);
    var result = await detailState(itemId);

    if (result.status === 'ok') {
      renderDetail(container, result.item);
      return;
    }
    if (result.status === 'not-found') {
      container.innerHTML = stateHtml('empty', TEXT.notFound, '', false);
      return;
    }
    container.innerHTML = stateHtml('error', TEXT.error, '', true);
    bindRetry(container, function () { loadDetail(container, itemId); });
  }

  function tagsHtml(item) {
    var tags = Array.isArray(item.tags) ? item.tags : [];
    if (!tags.length) return '';
    var html = '<div class="discover-detail__tags">';
    for (var i = 0; i < tags.length; i++) {
      html += '<span class="discover-tag">' + escapeHtml(tags[i]) + '</span>';
    }
    html += '</div>';
    return html;
  }

  function factsHtml(item) {
    var rows = '';
    if (item.ref_type) rows += '<div class="discover-detail__fact"><dt>来源类型</dt><dd>' + escapeHtml(item.ref_type) + '</dd></div>';
    if (item.ref_id) rows += '<div class="discover-detail__fact"><dt>来源标识</dt><dd>' + escapeHtml(item.ref_id) + '</dd></div>';
    if (item.created_at) rows += '<div class="discover-detail__fact"><dt>展示时间</dt><dd>' + escapeHtml(item.created_at) + '</dd></div>';
    if (item.updated_at) rows += '<div class="discover-detail__fact"><dt>最近更新</dt><dd>' + escapeHtml(item.updated_at) + '</dd></div>';
    if (!rows) return '';
    return '<dl class="discover-detail__facts">' + rows + '</dl>';
  }

  function renderDetail(container, item) {
    if (!item || typeof item !== 'object') {
      container.innerHTML = stateHtml('empty', TEXT.notFound, '', false);
      return;
    }

    var type = (typeof item.type === 'string' && item.type) ? item.type : item.section;
    var section = sectionByKey(type) || sectionByKey(item.section);
    var icon = item.icon || (section ? section.icon : '') || '🔎';
    var label = section ? section.label : (item.section_label || '');
    var title = item.title || TEXT.untitled;

    var html = '<article class="discover-detail">';
    html += '<div class="discover-detail__head">';
    html += '<span class="discover-detail__icon" aria-hidden="true">' + escapeHtml(icon) + '</span>';
    html += '<div class="discover-detail__heading">';
    html += '<h1 class="discover-detail__title">' + escapeHtml(title) + '</h1>';
    html += '<div class="discover-detail__meta">';
    if (label) html += '<span class="discover-detail__badge">' + escapeHtml(label) + '</span>';
    if (item.owner_username) html += '<span>由 ' + escapeHtml(item.owner_username) + ' 展示</span>';
    var views = Number(item.view_count);
    if (Number.isFinite(views) && views >= 0) html += '<span>' + views + ' 次浏览</span>';
    html += '</div></div></div>';

    if (item.summary) html += '<p class="discover-detail__summary">' + escapeHtml(item.summary) + '</p>';
    html += tagsHtml(item);

    if (item.content_preview) {
      html += '<section class="discover-detail__section">';
      html += '<h2 class="discover-detail__section-title">内容预览</h2>';
      html += '<p class="discover-detail__preview">' + escapeHtml(item.content_preview) + '</p>';
      html += '</section>';
    }

    html += '<section class="discover-detail__section">';
    html += '<h2 class="discover-detail__section-title">操作</h2>';
    html += '<div class="discover-actions" id="discoverDetailActions"></div>';
    html += '<p class="discover-detail__hint">「查看」跳转到源内容；「使用」「加入」为预留功能，点击只给出提示。</p>';
    html += '</section>';

    html += factsHtml(item);
    html += '</article>';
    container.innerHTML = html;

    var actionsEl = document.getElementById('discoverDetailActions');
    if (actionsEl) {
      var actions = renderActions(actionsEl, item);
      if (!actions.length) {
        actionsEl.innerHTML = '<p class="discover-detail__hint">' + escapeHtml(TEXT.noActions) + '</p>';
      }
    }
    document.title = title + ' | 发现 | GWL';
  }

  /** 按 body 上的 data 属性决定这一页做什么（普通脚本，DOM 就绪后自动跑） */
  function initPage() {
    var kind = bodyData('discoverPage');
    if (!kind) return;
    if (kind === 'index') initIndexPage();
    else if (kind === 'section') initSectionPage(false);
    else if (kind === 'board') initSectionPage(true);
    else if (kind === 'detail') initDetailPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
  } else {
    initPage();
  }

  // ===== §7.3 对外门面（fe-ownsite 复用）=====
  window.Discover = {
    // —— 契约列出的键 ——
    SECTIONS: SECTIONS,
    sectionByKey: sectionByKey,
    sectionPath: sectionPath,
    detailPath: detailPath,
    feed: feed,
    detail: detail,
    cardHtml: cardHtml,
    actionsOf: actionsOf,
    renderActions: renderActions,
    runAction: runAction,
    renderFeed: renderFeed,
    escapeHtml: escapeHtml,
    ACTION_PLACEHOLDER: ACTION_PLACEHOLDER,
    // —— 额外的辅助键（契约未列，页面/自测复用）——
    detailState: detailState,   // 详情页靠它区分 缺少 id / 404 / 网络失败
    ACTION_LABELS: ACTION_LABELS,
    TEXT: TEXT,
    initPage: initPage
  };
})();
