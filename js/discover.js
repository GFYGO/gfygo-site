/**
 * discover.js
 * 「发现（Discover）」共享前端模块 —— 普通脚本（IIFE，非 ES module），挂到 window.Discover。
 *
 * 契约：file-wiki/_discover-contract.md
 *   §1   板块常量（前端写死，与 site-back/utils/discover_rules.py 同值）
 *   §3   板块 → 动作映射 + 提示文案（逐字一致）
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
 *
 * ⭐ 2026-10-02「组类加入功能」：`join` **不再是占位**（原来只弹提示、零请求）。
 *    现在点「加入」会真的调 `POST /api/v0/org/classes/<组id>/join`：
 *      * 组织条目（`ref_type='organization'`）→ 不直接加入（组织不是成员关系的目标），
 *        改为**滚到「加入组织」区**，那里按 `GET /api/v0/org/joinable?class_id=<组织id>`
 *        列出可加入的公开组，逐个「加入」；
 *      * 组条目（`ref_type='group'`）→ 直接加入（公开组即时入组；私有组转成**申请**，
 *        等管理员批准）。
 *    `use` 仍是占位（工具板块没有真实接口）。
 *
 * ⭐ 2026-10-06「服务端分页（B1）」：
 *    * `feed({section, limit})` —— **旧路径，逐字不变**（随机抽样一页；`total` ≠ `items.length`）。
 *    * `feed({section, page, size})` —— 分页路径（稳定序，`has_more` / `scan_truncated` 透传）。
 *    * 内容流入口统一为 `startFeed()`：首屏 `renderFeed`（整体替换）+ 「加载更多」`appendFeed`
 *      （**只追加**，翻页失败不会冲掉已渲染的卡片）。按钮由 JS 动态挂到 `#discoverMeta`
 *      所在工具栏 → **11 个静态页零 HTML 改动**（只提升 `js/discover.js` 的 `?v=`）。
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

  // ===== §3 提示文案（与后端 / 契约逐字一致，两处一致）=====
  // ⚠️ `use` 仍是**纯提示**（工具板块没有真实接口）。
  //    `join` 自 2026-10-02 起是**真动作**（见本文件头部的说明）：文案只用于
  //    "组织条目点加入 → 指路下方的加入区"，以及"该板块没有真实加入入口"的兜底。
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
    untitled: '未命名内容',
    // ⭐ 加入（2026-10-02）
    joinNeedLogin: '登录后才能加入，正在跳转登录页…',
    joinLoading: '正在读取可加入的组…',
    joinLoadFailed: '可加入的组读取失败，请稍后重试',
    joinNone: '这个组织眼下没有可直接加入的公开组。',
    joinNoneHint: '私有组需要邀请码或单次链接：请到组织页点「＋ 加入」用邀请码 / 链接 / 提交申请。',
    joinPrivate: '这个组是私有的，点「申请加入」会提交给管理员审批。',
    joinAlready: '你已经是这个组的成员了。',
    joinOk: '已加入',
    joinRequested: '已提交加入申请，等管理员批准',
    joinFailed: '加入失败，请稍后重试'
  };

  var FEED_API = '/api/v0/discover/feed';
  var ITEM_API = '/api/v0/discover/item/';
  //: ⭐ 加入相关（2026-10-02）：与组织页「＋ 加入」卡片调的是同一批接口
  var JOINABLE_API = '/api/v0/org/joinable';
  var JOIN_API = '/api/v0/org/classes/';
  var FEED_LIMIT_DEFAULT = 12;   // 与后端默认一致
  var FEED_LIMIT_MIN = 1;
  var FEED_LIMIT_MAX = 60;       // 与后端夹取范围一致
  //: ⭐ B1「服务端分页」：`page`/`size` 是**另一套**参数（见 feed()，两套不混着发）
  var FEED_SIZE_DEFAULT = 12;    // 与后端 size 默认一致
  var FEED_SIZE_MIN = 1;
  var FEED_SIZE_MAX = 100;       // 与后端 size 上限一致（⚠️ 与 limit 的 60 不是同一个上限）
  var FEED_PAGE_SIZE = 24;       // 发现页首屏每页条数（沿用原来写死的 limit:24）
  var SKELETON_COUNT = 6;

  /**
   * 加入相关的运行态（2026-10-02）。详情页一次只渲染一个条目，所以是模块级的：
   *   `classId` —— 当前详情条目的**源组类 id**（`ref_id`，3 位字母）；
   *                组织条目下它既是"加入区的 scope"，也是 `doJoin()` 成功后重拉清单的依据。
   *   `busy`    —— 有请求在途时按钮置灰，防连点（后端虽幂等，但连点会发一串请求）
   */
  var joinState = { classId: '', busy: false };

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

  /**
   * boolOf(value) -> 布尔。后端可能回 `true` / `1` / `'true'`，
   * 其余（`undefined` / `0` / `'false'` / 乱值）一律 false —— 用于
   * `has_more` / `scan_truncated` 这两个**只可能为真**的标记，缺省即"没有"。
   */
  function boolOf(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
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

  /** 夹取 size（分页用）：非法 → 返回 null（交给后端默认 12），合法 → 夹到 [1,100] */
  function normalizeSize(size) {
    var num = Number(size);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.min(FEED_SIZE_MAX, Math.max(FEED_SIZE_MIN, Math.floor(num)));
  }

  /**
   * feed({section, limit})       → **旧路径**（随机抽样一页，行为逐字不变）
   * feed({section, page, size})  → ⭐ B1 分页路径（稳定序 sort_weight↓ + id↑，不再随机）
   *
   * 返回 Promise<{section,total,items,page,size,has_more,scan_truncated}|null>；
   *   null = 网络失败 / 响应格式异常 / 非 200（由 renderFeed 显示错误态）。
   *
   * ⚠️ 两套参数**不同时发**：给了 `page`/`size` 就只发 `page`/`size`（不发 `limit`），
   *    否则只发 `limit` —— 后端"传任一 page/size 即分页"的判定因此不会含糊。
   * ⚠️ `total` 在两套路径下都是"符合条件的**总数**"，**不等于** items.length
   *    （旧路径随机抽 12 条、total 可能几百）—— 别拿它当"已加载条数"，
   *    所以这里额外把 `page`/`size`/`has_more`/`scan_truncated` 一并透传给调用方。
   * ⚠️ 拿不到 `page`/`size`/`has_more` 的响应（旧后端）→ 当作"只有一页、has_more=false"，
   *    「加载更多」会显示"没有更多了"，不会去翻不存在的下一页。
   */
  async function feed(opts) {
    if (typeof window.apiRequest !== 'function') return null;
    opts = opts || {};
    var section = (typeof opts.section === 'string' && opts.section) ? opts.section : 'all';
    var params = { section: section };

    var page = toPositiveInt(opts.page);
    var size = normalizeSize(opts.size);
    var paged = (page !== null) || (size !== null);
    if (paged) {
      if (page !== null) params.page = page;
      if (size !== null) params.size = size;
    } else {
      var limit = normalizeLimit(opts.limit);
      if (limit !== null) params.limit = limit;
    }

    var res = await window.apiRequest(FEED_API, { params: params, silent: true });
    if (!res || Number(res.code) !== 200 || !res.data) return null;
    var data = res.data;

    // ⭐ 兼容分支：`data` 直接是**数组**（旧形态 / 别的部署）→ 当作"只有一页"：
    //    total = 本页条数、has_more = false（不能凭空造出"还有下一页"）。
    if (Array.isArray(data)) {
      return {
        section: section,
        total: data.length,
        items: data,
        page: 1,
        size: data.length,
        has_more: false,
        scan_truncated: false
      };
    }
    if (typeof data !== 'object') return null;

    var items = Array.isArray(data.items) ? data.items : [];
    var servedPage = toPositiveInt(data.page);
    var servedSize = normalizeSize(data.size);
    return {
      section: (typeof data.section === 'string' && data.section) ? data.section : section,
      total: Number.isFinite(Number(data.total)) ? Number(data.total) : items.length,
      items: items,
      // 后端回显的 page/size 优先；没回显就用本次请求的（旧路径两者都没有 → 1 / 本页条数）
      page: servedPage !== null ? servedPage : (page !== null ? page : 1),
      size: servedSize !== null ? servedSize : (size !== null ? size : items.length),
      has_more: boolOf(data.has_more),
      scan_truncated: boolOf(data.scan_truncated)
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
   *   use  → 只 showToast 占位文案，**不发任何网络请求**（工具板块没有真实接口）
   *   join → ⭐ **真动作**（2026-10-02）：组织条目滚到「加入组织」区；
   *          组条目直接 `POST /org/classes/<ref_id>/join`（公开组即时入组 /
   *          私有组转待审批申请）。其余情况给指路提示。
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
      joinFromItem(item);
      return;
    }
    // 未知 action：静默忽略
  }

  // ===== ⭐ 加入（2026-10-02「完成组类加入功能」）=====
  //
  //   后端的规则（权威表见 site-back/services/org_join_service.py 的模块 docstring）：
  //     * **public** 组类 → 直接入组，唯一的检查是**黑名单**；
  //     * **private** 组类 → `POST .../join` 不写成员关系，而是落一条**待审批申请**；
  //       （另外两条路是邀请码 / 单次链接，在组织页的「＋ 加入」卡片里）
  //     * **组织不是成员关系的目标**（`user_memberships.group_id` 是 `groups.id` 的外键）：
  //       所以组织条目不能"直接加入"，只能加入它**下辖的公开组**。

  /** 是否已登录（`AuthGuard` 在 config.js；缺失时退化为读 localStorage 的原始键） */
  function hasToken() {
    try {
      if (window.AuthGuard && typeof window.AuthGuard.getToken === 'function') {
        return !!window.AuthGuard.getToken();
      }
      var raw = window.localStorage.getItem(window.TOKEN_KEY || 'auth_token');
      if (!raw) return false;
      var data = JSON.parse(raw);
      return !!(data && data.token);
    } catch (e) {
      return false;
    }
  }

  /** 需要登录时提示并跳登录页（带 ?redirect= 回到当前详情页） */
  function requireLogin() {
    toast(TEXT.joinNeedLogin);
    var back = '';
    try {
      back = window.location.pathname + window.location.search;
    } catch (e) { /* 忽略 */ }
    window.location.href = basePath() + '/login.html' + (back ? ('?redirect=' + encodeURIComponent(back)) : '');
  }

  /** 组类 id 形态（与后端 `normalize_class_id` 同语义：3 位字母） */
  function classIdOf(item) {
    var raw = (item && item.ref_id != null) ? String(item.ref_id).trim() : '';
    return /^[A-Za-z]{3}$/.test(raw) ? raw.toLowerCase() : '';
  }

  /** 条目是不是「组」板块（`ref_type='group'`；后端 `ref_type_for` 保证与 section 一致） */
  function isGroupItem(item) {
    return !!item && String(item.ref_type || '').toLowerCase() === 'group';
  }

  /**
   * 「加入」按钮的入口：组织 → 滚到加入区；组 → 直接加入；其它 → 指路组织页。
   * 未登录一律先跳登录（`POST .../join` 需要 JWT，别让用户点了没反应）。
   */
  function joinFromItem(item) {
    var cid = classIdOf(item);
    if (!cid) {
      toast(ACTION_PLACEHOLDER.join);
      return;
    }
    if (!hasToken()) {
      requireLogin();
      return;
    }
    if (isGroupItem(item)) {
      doJoin(cid, null);
      return;
    }
    var panel = document.getElementById('discoverJoin');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      loadJoinPanel(cid);
      return;
    }
    // 理论上组织详情的 items 里有 join，就一定有这块区域；兜底给一句指路
    toast(ACTION_PLACEHOLDER.join);
    window.location.href = basePath() + '/org/index.html?class=' + encodeURIComponent(cid);
  }

  /**
   * ⭐ 真的调加入接口。
   *   `POST /api/v0/org/classes/<cid>/join` →
   *     public：`{mode:'joined'}`（或 `already_member`）
   *     private：`{mode:'requested'}`（已提交申请；重复提交会回显已有申请）
   * 成功后刷新加入区（成员关系变了，"能不能加入"的清单要重算）。
   */
  function doJoin(cid, btn) {
    if (joinState.busy) return;
    if (typeof window.apiRequest !== 'function') return;
    joinState.busy = true;
    setButtonsDisabled(true);

    window.apiRequest(JOIN_API + encodeURIComponent(cid) + '/join', {
      method: 'POST',
      body: { class_id: cid },
      silent: true
    }).then(function (res) {
      joinState.busy = false;
      setButtonsDisabled(false);
      if (!res || Number(res.code) !== 200 || !res.data) {
        toast((res && res.msg) ? String(res.msg) : TEXT.joinFailed);
        return;
      }
      var data = res.data;
      if (data.mode === 'requested') {
        toast(TEXT.joinRequested);
      } else if (data.already_member) {
        toast(TEXT.joinAlready);
      } else {
        var name = (data.group && data.group.name) ? data.group.name : cid;
        toast(TEXT.joinOk + '「' + name + '」');
      }
      loadJoinPanel(joinState.classId);
    }).catch(function () {
      joinState.busy = false;
      setButtonsDisabled(false);
      toast(TEXT.joinFailed);
    });
  }

  /** 请求在途时把所有加入按钮置灰（防连点；不改变任何文案） */
  function setButtonsDisabled(disabled) {
    var panel = document.getElementById('discoverJoin');
    if (!panel || !panel.querySelectorAll) return;
    var btns = panel.querySelectorAll('[data-join-class]');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !!disabled;
  }

  /**
   * 详情页的「加入组织」区（只在**组织**条目上渲染；组条目用顶部的「加入」按钮就够）。
   * 内容由 `loadJoinPanel()` 填 —— 这里只放容器，避免详情首屏多打一个请求。
   */
  function joinSectionHtml(item) {
    if (isGroupItem(item)) return '';       // 组条目：顶部「加入」按钮直接调接口就够
    var cid = classIdOf(item);
    if (!cid) return '';                    // 非组类条目（文档 / 工具）：没有加入区
    var html = '<section class="discover-detail__section">';
    html += '<h2 class="discover-detail__section-title">加入组织</h2>';
    html += '<div class="discover-join" id="discoverJoin" data-join-scope="' + escapeHtml(cid) + '">';
    html += '<p class="discover-detail__hint">' + escapeHtml(TEXT.joinLoading) + '</p>';
    html += '</div>';
    html += '<p class="discover-detail__hint">' + escapeHtml(TEXT.joinNoneHint) + '</p>';
    html += '</section>';
    return html;
  }

  /** 拉「这个组织下可加入的公开组」并渲染（`GET /org/joinable?class_id=<组织id>`） */
  async function loadJoinPanel(cid) {
    var panel = document.getElementById('discoverJoin');
    if (!panel) return;
    var scope = cid || panel.getAttribute('data-join-scope') || joinState.classId || '';
    if (!scope) return;
    // ⭐ 记下"这块区域是哪个组织" —— `doJoin()` 成功后要按 scope 重拉清单，
    //    不能依赖调用点把 cid 原样再传一遍（那样两处很容易漂移）。
    joinState.classId = scope;
    if (typeof window.apiRequest !== 'function') {
      panel.innerHTML = '<p class="discover-detail__hint">' + escapeHtml(TEXT.joinLoadFailed) + '</p>';
      return;
    }
    panel.innerHTML = '<p class="discover-detail__hint">' + escapeHtml(TEXT.joinLoading) + '</p>';
    var res = await window.apiRequest(JOINABLE_API, {
      params: { class_id: scope },
      silent: true
    });
    if (!res || Number(res.code) !== 200 || !Array.isArray(res.data)) {
      panel.innerHTML = '<p class="discover-detail__hint">' + escapeHtml(TEXT.joinLoadFailed) + '</p>';
      return;
    }
    panel.innerHTML = joinListHtml(res.data);
    bindJoinButtons(panel);
  }

  /** 公开组清单 → 一行一个「加入」按钮；空清单 → 说明私有组怎么进 */
  function joinListHtml(groups) {
    if (!groups.length) {
      return '<p class="discover-detail__hint">' + escapeHtml(TEXT.joinNone) + '</p>';
    }
    var html = '';
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i] || {};
      var gid = (g.id != null) ? String(g.id) : '';
      if (!/^[a-zA-Z]{3}$/.test(gid)) continue;
      var name = g.name ? String(g.name) : gid;
      html += '<div class="discover-join__row">';
      html += '<span class="discover-join__main">';
      html += '<span class="discover-join__name">' + escapeHtml(name)
        + ' <code class="discover-join__id">' + escapeHtml(gid.toLowerCase()) + '</code></span>';
      if (g.description) {
        html += '<span class="discover-join__desc">' + escapeHtml(String(g.description)) + '</span>';
      }
      html += '</span>';
      html += '<button type="button" class="discover-action discover-action--join"'
        + ' data-join-class="' + escapeHtml(gid.toLowerCase()) + '">'
        + escapeHtml(ACTION_LABELS.join) + '</button>';
      html += '</div>';
    }
    return html;
  }

  /** 给加入区里的每个按钮绑事件（委托会在重渲染后失效，这里逐个绑） */
  function bindJoinButtons(panel) {
    if (!panel || !panel.querySelectorAll) return;
    var btns = panel.querySelectorAll('[data-join-class]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        var gid = btn.getAttribute('data-join-class') || '';
        btn.addEventListener('click', function () { doJoin(gid, btn); });
      })(btns[i]);
    }
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

  /**
   * appendHtml(container, html) —— **追加**子节点，一个已有节点都不动。
   *
   * 为什么不用 `container.insertAdjacentHTML('beforeend', ...)`：先在游离的 div 里解析、
   * 再逐个 `appendChild`，语义一样，但只依赖 `appendChild`（页面/测试桩都实现了它），
   * 不让"追加"这一语义绑在一个冷门 API 上。
   */
  function appendHtml(container, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var nodes = [];
    for (var i = 0; i < tmp.children.length; i++) nodes.push(tmp.children[i]);
    for (var j = 0; j < nodes.length; j++) container.appendChild(nodes[j]);
  }

  /**
   * ⭐ appendFeed(container, opts) -> Promise<data|null>
   * 「加载更多」专用：**只追加**卡片，**绝不整体替换** container 的 innerHTML。
   *
   * 为什么不复用 renderFeed()：它在上面那行 `container.innerHTML = html` 处**整体替换**
   *   —— 分页失败（或第 2 页只回了 0 条）时，那一行会把**已经渲染好的卡片全冲掉**
   *   （用户翻到第 3 页失败 → 前两页白看）。首屏仍旧走 renderFeed（骨架 / 空态 /
   *   错误态的替换语义保持不变）。
   *
   * 失败（null）时**容器保持原样**，由调用方（分页按钮）显示失败态。
   */
  async function appendFeed(container, opts) {
    if (!container) return null;
    opts = opts || {};
    var data = await feed(opts);
    if (!data) return null;

    var html = '';
    for (var i = 0; i < data.items.length; i++) {
      html += cardHtml(data.items[i], opts);
    }
    if (html) appendHtml(container, html);   // 空页：一个节点都不加（不留空节点）
    return data;
  }

  // ===== ⭐ 分页装配（B1「服务端分页」：首屏替换 + 「加载更多」追加）=====

  /**
   * 「加载更多」按钮的文案 —— 三态沿用 `stateHtml()`（上方）的既有措辞：
   *   loading → `TEXT.loading`（'加载中…'）
   *   failed  → `TEXT.error`（'加载失败，请稍后重试'；再点一下就是重试）
   *   done    → 与空态同风格的灰字（按钮 disabled，不再重复请求）
   * ⚠️ 按钮的样式类复用 `stateHtml()` 里那个按钮的 `.discover-state__retry`
   *    → **不必改 css/discover.css**，11 个页面的 `css/*.css` 版本号因此保持不动。
   */
  var MORE_TEXT = {
    more: '加载更多',
    loading: TEXT.loading,
    done: '没有更多了',
    failed: TEXT.error
  };

  /**
   * 当前分页态（一个页面只有一个内容流，模块级够用；`startFeed()` 每次整体重置）。
   *   `page`   已加载到第几页 —— 0 = 首屏还没成功（用来区分"首屏失败"与"翻页失败"，
   *            两者重试的东西不一样：前者整页重来，后者只补一页）
   *   `loaded` 已渲染条数（M）—— **不拿 total 冒充**（见 updateMeta 的说明）
   *   `btn`    动态创建的那个按钮（HTML 里没有它 → 11 个静态页零改动）
   */
  var pager = {
    container: null, section: 'all', showSection: true, size: FEED_SIZE_DEFAULT,
    page: 0, loaded: 0, total: 0, hasMore: false, busy: false,
    metaId: 'discoverMeta', btn: null
  };

  /**
   * 动态创建「加载更多」按钮并挂到 `#discoverMeta` 所在的工具栏里。
   * 挂不上（页面上没有这个工具栏 / 没有 meta）就返回 null —— 调用方据此静默跳过，
   * 不因为"少个按钮"而中断首屏渲染。
   */
  function mountMoreButton(metaId) {
    var meta = document.getElementById(metaId);
    var host = (meta && meta.parentNode) ? meta.parentNode : null;
    if (!host) return null;

    // 重复初始化（同一页理论上只跑一次；桩里 initPage 可能被调多次）不叠加按钮
    var old = host.querySelector('.discover-more');
    if (old) {
      if (typeof old.remove === 'function') old.remove();
      else if (old.parentNode) old.parentNode.removeChild(old);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'discover-state__retry discover-more';
    btn.textContent = MORE_TEXT.more;
    btn.disabled = true;      // 首屏结果没回来之前不可点
    btn.hidden = true;        // 也不知道有没有下一页 → 先不显示
    btn.addEventListener('click', onMoreClick);
    host.appendChild(btn);
    return btn;
  }

  /**
   * 按钮四态：`hidden`（首屏结果未知/首屏失败交给容器里的错误态）/ `loading` /
   * `done` / `failed` / 其余一律当 `more`。
   * 一律改 `textContent`（不拼 innerHTML），不写任何内联 `on*=`。
   */
  function setMoreState(kind) {
    var btn = pager.btn;
    if (!btn) return;
    if (kind === 'hidden') {
      btn.hidden = true;
      btn.disabled = true;
      return;
    }
    btn.hidden = false;
    if (kind === 'loading') {
      btn.disabled = true;
      btn.textContent = MORE_TEXT.loading;
      return;
    }
    if (kind === 'done') {
      btn.disabled = true;
      btn.textContent = MORE_TEXT.done;
      return;
    }
    if (kind === 'failed') {
      btn.disabled = false;
      btn.textContent = MORE_TEXT.failed;
      return;
    }
    btn.disabled = false;
    btn.textContent = MORE_TEXT.more;
  }

  /** 第 page 页的 feed 参数（⚠️ 只发 page/size，绝不把旧路径的 limit 掺进来） */
  function pageOpts(page) {
    return {
      section: pager.section,
      page: page,
      size: pager.size,
      showSection: pager.showSection
    };
  }

  /** 首屏（第 1 页）：走 renderFeed —— 骨架 / 卡片 / 空态 / 错误态的替换语义不变 */
  async function loadFirstPage() {
    if (!pager.container) return null;
    setMoreState('loading');
    var data = await renderFeed(pager.container, pageOpts(1));
    if (!data) {
      // 首屏就失败：容器里已经有带「重新加载」的错误态，工具条这个按钮也切成失败态
      // （点它 = 重来一次首屏，见 onMoreClick），两者殊途同归。
      pager.page = 0;
      pager.loaded = 0;
      setMoreState('failed');
      return null;
    }
    pager.page = data.page;
    pager.loaded = data.items.length;
    pager.total = data.total;
    pager.hasMore = data.has_more === true;
    updateMeta(pager.metaId, data);                        // 首屏文案不变：共 T 条公开内容
    setMoreState(pager.hasMore ? 'more' : 'done');
    return data;
  }

  /** 下一页：走 appendFeed（**只追加**），失败时已渲染的卡片原样留在页面上 */
  async function loadNextPage() {
    if (!pager.container || pager.busy || !pager.hasMore) return null;
    pager.busy = true;
    setMoreState('loading');
    var data = await appendFeed(pager.container, pageOpts(pager.page + 1));
    pager.busy = false;
    if (!data) {
      setMoreState('failed');
      return null;
    }

    var served = toPositiveInt(data.page);
    pager.page = served !== null ? served : (pager.page + 1);
    pager.loaded += data.items.length;
    pager.total = data.total;
    // 后端说"还有"却回了空页 → 再点下去只会原地打转，就此收尾
    pager.hasMore = (data.has_more === true) && data.items.length > 0;
    updateMeta(pager.metaId, data, pager.loaded);          // ⭐ 已加载 M / 共 T
    setMoreState(pager.hasMore ? 'more' : 'done');
    return data;
  }

  /** 按钮点击：首屏还没成功过 → 整页重来；否则只补下一页 */
  function onMoreClick() {
    if (pager.busy) return;
    // 按钮本身就是"在途 / 已到底"的信号（loading 与 done 都是 disabled）：
    // 浏览器不会给 disabled 按钮派 click，这里再挡一道，防程序化触发把请求打重。
    if (pager.btn && pager.btn.disabled) return;
    if (pager.page === 0) { loadFirstPage(); return; }
    loadNextPage();
  }

  /**
   * ⭐ 发现页内容流的唯一入口（`initIndexPage` / `initSectionPage` 都走它）：
   *   首屏 `renderFeed`（替换）+ 「加载更多」`appendFeed`（追加）。
   * `opts.size` = 每页条数（第一页也走 size，不再用旧的 `limit:24`）。
   */
  function startFeed(container, opts) {
    if (!container) return null;
    opts = opts || {};
    var size = normalizeSize(opts.size);
    // ⚠️ 逐字段重置（**不换对象**）：`window.Discover.pager` 拿的是同一个引用，
    //    换成新对象会让门面上那个键永远停在初始态（自测/排查会被误导）。
    pager.container = container;
    pager.section = (typeof opts.section === 'string' && opts.section) ? opts.section : 'all';
    pager.showSection = opts.showSection !== false;
    pager.size = size === null ? FEED_SIZE_DEFAULT : size;
    pager.page = 0;
    pager.loaded = 0;
    pager.total = 0;
    pager.hasMore = false;
    pager.busy = false;
    pager.metaId = (typeof opts.metaId === 'string' && opts.metaId) ? opts.metaId : 'discoverMeta';
    pager.btn = mountMoreButton(pager.metaId);
    return loadFirstPage();
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

  /**
   * 工具栏状态条文案。
   *   updateMeta(id, data)         → 首屏：「共 T 条公开内容」（既有语义不变）
   *   updateMeta(id, data, loaded) → ⭐ 加载更多之后：「已加载 M / 共 T」
   *
   * ⚠️ `M` **必须由调用方按实际渲染条数传进来**，不能拿 `total` 顶替：
   *    旧路径（不带 page/size）下 `total` 是"过滤后**总数**"，随机抽样时
   *    `total`（几百）远大于 `items.length`（12）—— 两者一混，
   *    "已加载 375 / 共 375" 这种假进度就出来了。
   */
  function updateMeta(id, data, loaded) {
    if (!data) return;
    if (Number.isFinite(Number(loaded))) {
      setText(id, '已加载 ' + Number(loaded) + ' / 共 ' + data.total);
      return;
    }
    setText(id, '共 ' + data.total + ' 条公开内容');
  }

  /** 聚合页：板块导航 + 内容流（首屏 size:24 第一页 + 「加载更多」按 page 追加），卡片显示板块标签 */
  function initIndexPage() {
    var navEl = document.getElementById('discoverBoardNav');
    if (navEl) navEl.innerHTML = boardNavHtml();

    var feedEl = document.getElementById('discoverFeed');
    if (!feedEl) return;
    // ⭐ B1 分页：`limit:24` → `size:24` 的第一页（`startFeed` 里已含 page:1）
    startFeed(feedEl, { section: 'all', size: FEED_PAGE_SIZE, showSection: true });
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
    // ⭐ B1 分页：同上（第一页走 size；下一页由动态创建的「加载更多」按钮按 page 追加）
    startFeed(feedEl, { section: section.key, size: FEED_PAGE_SIZE, showSection: false });
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
    html += '<p class="discover-detail__hint">' + escapeHtml(actionsHintOf(item)) + '</p>';
    html += '</section>';

    html += joinSectionHtml(item);

    html += factsHtml(item);
    html += '</article>';
    container.innerHTML = html;

    // ⭐ 加入态的基线（`join` 是"点了就发请求"的真动作，需要知道目标组类）
    joinState.classId = classIdOf(item);

    var actionsEl = document.getElementById('discoverDetailActions');
    if (actionsEl) {
      var actions = renderActions(actionsEl, item);
      if (!actions.length) {
        actionsEl.innerHTML = '<p class="discover-detail__hint">' + escapeHtml(TEXT.noActions) + '</p>';
      }
    }
    // 加入区：组织条目**进页面就先拉一次**（用户可能直接奔着"有哪些组能加入"来）；
    // 失败只把错误写进那一块，不影响详情其余部分。
    if (document.getElementById('discoverJoin')) loadJoinPanel(joinState.classId);
    document.title = title + ' | 发现 | GWL';
  }

  /**
   * 「操作」区下方那句说明 —— 按**这个条目实际有哪些动作**给，别再说"预留功能"
   * （`join` 自 2026-10-02 起是真动作，说"只给出提示"就是错的）。
   */
  function actionsHintOf(item) {
    var actions = actionsOf(item);
    if (!actions.length) return '';
    if (isGroupItem(item) && actions.indexOf('join') >= 0) {
      return '「查看」跳转到源内容；「加入」会真的加入本组（公开组即时入组，私有组转成待审批申请）。';
    }
    if (actions.indexOf('join') >= 0) {
      return '「查看」跳转到源内容；「加入」会滚到下方的「加入组织」，那里列出可以加入的公开组。';
    }
    if (actions.indexOf('use') >= 0) {
      return '「查看」跳转到源内容；「使用」为预留功能，点击只给出提示。';
    }
    return '「查看」跳转到源内容。';
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
    // ⭐ 分页（B1 服务端分页）：`appendFeed` 只追加、不替换；`startFeed` 是 11 个
    //    发现页内容流的入口（首屏替换 + 动态「加载更多」按钮）；`pager` 是它的运行态
    appendFeed: appendFeed,
    startFeed: startFeed,
    updateMeta: updateMeta,
    pager: pager,
    // ⭐ 加入（2026-10-02）：`join` 是真动作，自测靠这三个复盘"点了到底发了什么"
    joinFromItem: joinFromItem,
    doJoin: doJoin,
    loadJoinPanel: loadJoinPanel,
    joinState: joinState,
    initPage: initPage
  };
})();
