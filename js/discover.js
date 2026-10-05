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
    // ⭐ 加入（2026-10-02）：`join` 是真动作，自测靠这三个复盘"点了到底发了什么"
    joinFromItem: joinFromItem,
    doJoin: doJoin,
    loadJoinPanel: loadJoinPanel,
    joinState: joinState,
    initPage: initPage
  };
})();
