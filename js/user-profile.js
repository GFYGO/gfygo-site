/**
 * user-profile.js — 「公开用户主页 / 他人主页」的渲染逻辑（`u.html` 专用）
 *
 * 设计：`CAPABILITY-GAPS-DESIGN-2.md` §4.3.4；地址形式：
 *   * `u.html?u=<slug>`            → `GET /api/v0/user/profile/<slug>`（对外可分享的主入口）
 *   * `u.html?id=<user_id>`        → `GET /api/v0/user/profile/by-id/<id>`（**站内**用：
 *                                    作者名链接手里只有 `author_id`，拿不到 slug）
 *   两者同时出现时 **`u` 优先**（见 readTarget）。
 *
 * 接口（两条都是**公开**的，匿名必须能看；响应逐字相同，见 `services/user_public.py`）：
 *   data = { user{id,username,display_name,avatar,introduction,location,created_at,
 *                 joined_at,is_me,slug,is_public},
 *            stats{public_docs,public_groups,discover_items},
 *            groups[{id,name,kind,role}], discover_available:false }
 *   404（未开启公开主页 / 不存在 / slug 非法 → **同一条**）：
 *        {"code":404,"msg":"该用户没有开启公开主页"} —— 本页把它当**空态**原样展示，不是崩溃。
 *   `?include_groups=0` 会让 `groups` 为空数组，但 `stats.public_groups` 计数照给。
 *
 * 文档列表：`GET /api/v0/document/list?scope=public&author_id=<id>&page=<n>&size=20`
 *   **恒返回分页包络** `{items,page,size,total,has_more}`（后端 2026-10-11 收口，决策 Q8=B）。
 *   错误响应**没有 `data` 键** → 一律先判 `data` 再取字段。
 *
 * 约定（硬性）：
 *   * 普通 `<script>` 加载（**非** ES module）；只把能力挂到 `window.UserProfile`。
 *   * 网络一律走共享层 `window.apiRequest`（自带 Authorization 头、401 跳登录、错误提示），
 *     本文件**不**自己 `fetch`；提示走共享层 `window.showToast`。
 *   * 本页**不加载** `js/document.js`，所以文档卡片的观感在 buildDocCard 里**自己写一份**
 *     （对齐 `document.js::docItemHTML` / `renderHomeCategoryGrids` 的 .feature-tile 观感）。
 *   * 渲染一律用 `textContent`（不用 `escapeHtml` 拼字符串）：既避免 XSS，也顺带绕开
 *     `escapeHtml` 对数字 `0` 会返回空串的坑（`site-back/UNTRUSTED.md` §H19）。
 *   * 后端字段名大小写 / 存在性一律容错（`String(v || '')` 在 **0** 上会丢值，故不用它判空）。
 *
 * 页面结构 / 类名与 `u.html` 一一对应（改一处要同步另一处）：
 *   #upPageState / #upPageStateText · #upProfile · #upAvatar · #upDisplayName · #upUsername
 *   #upEditLink · #upIntro · #upLocation · #upFactId · #upFactJoined · #upStats
 *   #upDocsSection · #upDocsHint · #upDocsGrid · #upLoadMore · #upLoadMoreInfo · #upLoadMoreBtn
 *   #upGroupsSection · #upGroupsChips
 */
(function (window, document) {
  'use strict';

  /** 列表分页大小（契约：显式传参 + 「加载更多」按钮驱动） */
  var PAGE_SIZE = 20;
  /** 站点根前缀：`u.html` 在顶层，`js/config.js::resolveBasePath` 会算出 `'.'` */
  var BASE = window.BASE_PATH || '.';
  /** 默认头像：与 `js/index.js::renderAuthStatus` / `user/dashboard.auth.js` 同一口径 */
  var DEFAULT_AVATAR = BASE + '/favicon.png';

  /** 角色名（与 `site-back` 的 membership.role 取值对应；未知值原样显示） */
  var ROLE_LABELS = { owner: '创建者', admin: '管理员', member: '成员' };

  /** 组类 kind → 发现页详情路径（两个文件都已存在，链接前已核对） */
  var KIND_DETAIL_PATH = { group: './discover/group/details.html', org: './discover/org/details.html' };
  /** kind → 徽标文案 */
  var KIND_LABELS = { group: '组', org: '组织' };

  /** 复用的页面状态文案 */
  var MSG_MISSING_PARAM = '缺少用户参数';
  var MSG_MISSING_PARAM_HINT = '请通过 u.html?u=<主页地址> 或 u.html?id=<用户 ID> 打开他人的公开主页。';
  var MSG_LOAD_FAILED = '加载失败，请稍后重试';
  var MSG_LOADING = '正在加载…';
  var TITLE_SUFFIX = ' | GWL';

  // =========================================
  // 1. 小工具（DOM）
  // =========================================

  /** 按 id 取元素（本页容器都是 id 直取，不引入选择器工具） */
  function byId(id) {
    return document.getElementById(id);
  }

  /** 建元素：标签 + 类名 + 文本（文本一律走 textContent） */
  function mk(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null && text !== '') el.textContent = String(text);
    return el;
  }

  /** `null` / `undefined` 归零，其余原样（**不要**用 `v || ''`：会把数字 0 也吞掉） */
  function str(v) {
    return (v === null || v === undefined) ? '' : String(v);
  }

  /** 去掉首尾空白；非字符串一律返回空串 */
  function trimStr(v) {
    if (typeof v === 'string') return v.trim();
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /**
   * 空值合并：第一个「非 null / undefined / 空串」的值。
   * ⚠️ 刻意**不用** `a || b || c` 的写法链在数字上——不过这里的候选都是字符串，仍显式写清楚意图。
   */
  function firstText() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v !== null && v !== undefined && String(v) !== '') return String(v);
    }
    return '';
  }

  /** 安全设置 `img.src`（仅允许 http(s) / 相对路径；`javascript:`、`data:text/html` 一律丢弃） */
  function setImageSrc(img, url) {
    var raw = trimStr(url);
    if (!raw) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(raw) && !/^https?:/i.test(raw)) return false;
    img.src = raw;
    return true;
  }

  /** 头像 src 白名单之外的降级：换成站点默认头像（favicon.png） */
  function setDefaultAvatarImage(img) {
    img.onerror = null;
    img.src = DEFAULT_AVATAR;
  }

  /**
   * 头像缺失（或地址不可用）时的兜底：**不请求网络**，就地画一个首字母圆形头像。
   * 与全站默认头像（`${BASE_PATH}/favicon.png`）取同一主色，视觉上属于同一套。
   */
  function buildInitialAvatar(label) {
    var ch = trimStr(label).charAt(0);
    if (!ch) ch = '👤';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 96 96');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '默认头像');
    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '48');
    circle.setAttribute('cy', '48');
    circle.setAttribute('r', '48');
    circle.setAttribute('fill', 'var(--color-bg-section-alt)');
    var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '48');
    text.setAttribute('y', '48');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-size', '40');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', 'var(--color-primary)');
    // textContent：用户名永远不会被当成标记解析
    text.textContent = ch;
    svg.appendChild(circle);
    svg.appendChild(text);
    return svg;
  }

  /**
   * ISO 时间串 → `YYYY-MM`（只做字符串切片，**不**过 `Date`：
   * 后端存的是 UTC naive datetime，转本地时区会让月末跨月）。
   * 形状不认识时返回空串（调用方兜底成「未知」）。
   */
  function formatYearMonth(iso) {
    var s = trimStr(iso);
    if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
    return '';
  }

  // =========================================
  // 2. 页面状态（加载中 / 缺参 / 404 空态 / 失败）
  // =========================================

  /** 隐藏主页主体，显示整页状态块 */
  function showPageState(text, hint, isError) {
    state.profile = null;
    var profile = byId('upProfile');
    if (profile) profile.hidden = true;
    var box = byId('upPageState');
    var textEl = byId('upPageStateText');
    if (!box) return;
    box.hidden = false;
    var icon = box.querySelector('.up-state__icon');
    if (isError && !icon) {
      box.insertBefore(mk('span', 'up-state__icon', '⚠️'), box.firstChild);
    } else if (!isError && icon) {
      box.removeChild(icon);
    }
    box.classList.toggle('up-state--error', !!isError);
    if (textEl) textEl.textContent = text;
    var existingHint = box.querySelector('.up-state__hint');
    if (trimStr(hint)) {
      if (!existingHint) box.appendChild(mk('p', 'up-state__hint', hint));
      else existingHint.textContent = hint;
    } else if (existingHint) {
      box.removeChild(existingHint);
    }
  }

  /** 显示主页主体（数据到位后调用） */
  function showProfileCard() {
    var box = byId('upPageState');
    if (box) box.hidden = true;
    var profile = byId('upProfile');
    if (profile) profile.hidden = false;
  }

  /** 浏览器标签页标题：加载完成后补上这个人是谁 */
  function setDocumentTitle(name) {
    var n = trimStr(name);
    if (!n) {
      document.title = '用户主页' + TITLE_SUFFIX;
      return;
    }
    document.title = n + ' 的主页' + TITLE_SUFFIX;
  }

  // =========================================
  // 3. 读地址参数
  // =========================================

  /**
   * 解析 `?u=` / `?id=`（`u` 优先）。
   * @returns {{kind:'slug'|'id'|'none', value:string, rawId:string}}
   */
  function readTarget() {
    var params = new window.URLSearchParams(window.location.search);
    var rawU = trimStr(params.get('u'));
    var rawId = trimStr(params.get('id'));
    if (rawU) {
      try {
        // 一次解码：`%20` 之类还原成真实 slug（`URLSearchParams` 已解过一层，这里是兜底）
        return { kind: 'slug', value: decodeURIComponent(rawU), rawId: rawId };
      } catch (e) {
        return { kind: 'slug', value: rawU, rawId: rawId };
      }
    }
    if (/^\d+$/.test(rawId)) return { kind: 'id', value: rawId, rawId: rawId };
    return { kind: 'none', value: '', rawId: rawId };
  }

  // =========================================
  // 4. 接口访问（一律走 window.apiRequest）
  // =========================================

  /**
   * 取公开主页。
   * @returns {Promise<{ok:boolean, status:number, msg:string, data:object|null}>}
   *   `ok=false` + `status=404` → 后端「没有开启公开主页」；`ok=false` + `status=0` → 网络/解析失败。
   */
  function fetchProfile(target) {
    var path = target.kind === 'id'
      ? '/api/v0/user/profile/by-id/' + encodeURIComponent(target.value)
      : '/api/v0/user/profile/' + encodeURIComponent(target.value);
    return window.apiRequest(path, { silent: true }).then(function (res) {
      if (!res || typeof res !== 'object') {
        return { ok: false, status: 0, msg: MSG_LOAD_FAILED, data: null };
      }
      var code = Number(res.code);
      if (code === 200 && res.data && res.data.user) {
        return { ok: true, status: 200, msg: '', data: res.data };
      }
      return {
        ok: false,
        status: Number.isFinite(code) ? code : 0,
        msg: trimStr(res.msg) || MSG_LOAD_FAILED,
        data: null
      };
    });
  }

  /**
   * 取某个作者的公开文档（分页包络）。
   * ⚠️ 错误响应**没有 `data` 键** → 先判 `data` 与 `items` 再取字段（别直接 `.items.map`）。
   * @returns {Promise<{ok:boolean, items:Array, page:number, total:number, hasMore:boolean}>}
   */
  function fetchAuthorDocs(authorId, page, size) {
    return window.apiRequest('/api/v0/document/list', {
      params: { scope: 'public', author_id: authorId, page: page, size: size },
      silent: true
    }).then(function (res) {
      var empty = { ok: false, items: [], page: page, total: 0, hasMore: false };
      if (!res || typeof res !== 'object' || Number(res.code) !== 200) return empty;
      var data = res.data;
      if (!data || !Array.isArray(data.items)) return empty; // 无 data / 形状不符 → 当「没有文档」
      return {
        ok: true,
        items: data.items,
        page: (typeof data.page === 'number' && data.page > 0) ? data.page : page,
        total: (typeof data.total === 'number') ? data.total : data.items.length,
        hasMore: !!data.has_more
      };
    });
  }

  // =========================================
  // 5. 模块状态
  // =========================================

  var state = {
    profile: null,      // 最近一次成功的 data（用于渲染；showPageState 会清空）
    page: 1,            // 已加载到第几页
    total: 0,           // 后端给出的公开文档总数
    hasMore: false,     // 是否还有下一页
    loadingMore: false, // 「加载更多」请求进行中
    docsLoaded: false,  // 是否已经成功渲染过「公开文档」区（用于决定是否显示整页空态）
    groups: []          // groups 清单（chip 渲染用）
  };

  // =========================================
  // 6. 渲染：头部 + 统计
  // =========================================

  /** 头像：有地址就 <img>（失败降级默认头像），没有就画首字母 SVG */
  function renderAvatar(user) {
    var box = byId('upAvatar');
    if (!box) return;
    var label = firstText(user.display_name, user.username, user.id);
    while (box.firstChild) box.removeChild(box.firstChild);
    if (trimStr(user.avatar)) {
      var img = document.createElement('img');
      img.className = 'up-avatar__img';
      img.alt = label;
      // ⚠️ 不用内联 onerror（CSP / 仓库硬规）：只挂 addEventListener
      img.addEventListener('error', function () { setDefaultAvatarImage(img); });
      if (setImageSrc(img, user.avatar)) {
        box.appendChild(img);
        return;
      }
    }
    box.appendChild(buildInitialAvatar(label));
  }

  /** 渲染整张主页卡片（头部 / 统计 / 组 chips）；文档区单独走 renderDocs */
  function renderProfile(data) {
    var user = (data && data.user) || {};
    var stats = (data && data.stats) || {};
    var displayName = firstText(user.display_name, user.username, '未命名用户');
    var username = trimStr(user.username);

    renderAvatar(user);
    setDocumentTitle(displayName);

    var nameEl = byId('upDisplayName');
    if (nameEl) nameEl.textContent = displayName;
    var usernameEl = byId('upUsername');
    if (usernameEl) usernameEl.textContent = username ? '@' + username : '';

    // 「✏️ 编辑主页」：只有本人（后端算好的 is_me）才显示
    var editLink = byId('upEditLink');
    if (editLink) editLink.hidden = !user.is_me;

    var introEl = byId('upIntro');
    if (introEl) introEl.textContent = trimStr(user.introduction);
    var locationEl = byId('upLocation');
    if (locationEl) locationEl.textContent = trimStr(user.location) ? '📍 ' + user.location : '';

    var idEl = byId('upFactId');
    if (idEl) idEl.textContent = trimStr(user.id) || '未知';
    var joinedEl = byId('upFactJoined');
    if (joinedEl) joinedEl.textContent = formatYearMonth(user.joined_at) || '未知';

    var statsEl = byId('upStats');
    if (statsEl) {
      // 数字 0 必须显示成 0（`escapeHtml` 的 `String(v || '')` 会吞掉它 → 这里走 textContent）
      var docCount = (typeof stats.public_docs === 'number') ? stats.public_docs : 0;
      var groupCount = (typeof stats.public_groups === 'number') ? stats.public_groups : 0;
      statsEl.textContent = docCount + ' 篇公开文档 · ' + groupCount + ' 个公开组';
    }

    state.groups = Array.isArray(data && data.groups) ? data.groups : [];
    renderGroups();
  }

  // =========================================
  // 7. 渲染：加入的公开组（chips）
  // =========================================

  /** 单个 chip：kind 有对应详情页 → <a>；否则退化成 <span>（不造死链） */
  function buildGroupChip(group) {
    if (!group || typeof group !== 'object') return null;
    var id = trimStr(group.id);
    if (!id) return null;
    var kind = trimStr(group.kind).toLowerCase();
    var name = firstText(group.name, group.title, '未命名');
    var href = KIND_DETAIL_PATH[kind] ? KIND_DETAIL_PATH[kind] + '?id=' + encodeURIComponent(id) : '';
    var chip = document.createElement(href ? 'a' : 'span');
    chip.className = 'up-chip';
    if (href) chip.href = href;
    var kindLabel = KIND_LABELS[kind];
    if (kindLabel) chip.appendChild(mk('span', 'up-chip__kind', kindLabel));
    // name 走 textContent（后端字符串，绝不进 innerHTML）
    chip.appendChild(mk('span', 'up-chip__name', name));
    var role = trimStr(group.role);
    if (role) chip.appendChild(mk('span', 'up-chip__role', '· ' + (ROLE_LABELS[role] || role)));
    return chip;
  }

  /** 渲染组 chips；没有公开组时整块隐藏（空态由整页空态统一负责） */
  function renderGroups() {
    var section = byId('upGroupsSection');
    var box = byId('upGroupsChips');
    if (!section || !box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!state.groups.length) {
      section.hidden = true;
      return;
    }
    var frag = document.createDocumentFragment();
    var chipCount = 0;
    state.groups.forEach(function (g) {
      var chip = buildGroupChip(g);
      if (chip) {
        frag.appendChild(chip);
        chipCount++;
      }
    });
    box.appendChild(frag);
    section.hidden = chipCount === 0;
  }

  // =========================================
  // 8. 渲染：公开文档卡片（观感对齐 document.js 的文档卡片，本页自带一份）
  // =========================================

  /**
   * 单张文档卡片 → `<a href="./document.html?slug=…">`。
   * 图标 / 标题 / 摘要（没有摘要就退到「更新于 YYYY-MM-DD」）全部 textContent。
   */
  function buildDocCard(doc) {
    if (!doc || typeof doc !== 'object') return null;
    var slug = trimStr(doc.slug);
    if (!slug) return null;
    var href = './document.html?slug=' + encodeURIComponent(slug);
    var title = firstText(doc.title, '（未命名文档）');

    var card = document.createElement('a');
    card.className = 'up-doc';
    card.href = href;
    card.title = title;
    card.appendChild(mk('div', 'up-doc__icon', firstText(doc.icon, '📄')));

    var content = mk('div', 'up-doc__content');
    content.appendChild(mk('div', 'up-doc__title', title));
    var summary = trimStr(doc.summary);
    if (summary) {
      content.appendChild(mk('div', 'up-doc__desc', summary));
    } else {
      var updated = trimStr(doc.updated_at).slice(0, 10);
      content.appendChild(mk('div', 'up-doc__desc up-doc__desc--muted', updated ? '更新于 ' + updated : '暂无摘要'));
    }
    card.appendChild(content);
    return card;
  }

  /** 「加载更多」块：`has_more` 为假就整块隐藏（避免「点了没反应」） */
  function renderLoadMore() {
    var wrap = byId('upLoadMore');
    var btn = byId('upLoadMoreBtn');
    var info = byId('upLoadMoreInfo');
    if (!wrap || !btn) return;
    if (!state.hasMore) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    var loaded = state.loadedCount || 0;
    var total = (typeof state.total === 'number') ? state.total : loaded;
    if (info) info.textContent = '已加载 ' + loaded + ' / ' + total + ' 篇';
    btn.disabled = !!state.loadingMore;
    btn.textContent = state.loadingMore ? '加载中…' : '加载更多';
  }

  /**
   * 渲染「公开文档」区（整块替换 → 「加载更多」块必须在该容器**之外**，见 u.html）。
   * @param {Array} items 已加载的全部条目（首页 + 追加页）
   */
  function renderDocs(items) {
    var section = byId('upDocsSection');
    var grid = byId('upDocsGrid');
    var hint = byId('upDocsHint');
    if (!section || !grid) return;

    while (grid.firstChild) grid.removeChild(grid.firstChild);
    var frag = document.createDocumentFragment();
    var rendered = 0;
    items.forEach(function (doc) {
      var card = buildDocCard(doc);
      if (card) {
        frag.appendChild(card);
        rendered++;
      }
    });
    grid.appendChild(frag);
    state.loadedCount = rendered;

    if (hint) hint.hidden = true;
    if (rendered === 0) {
      section.hidden = true;
    } else {
      section.hidden = false;
      renderLoadMore();
    }
  }

  /** 文档区加载失败（网络层）时的提示；不阻塞头部渲染 */
  function renderDocsError() {
    var section = byId('upDocsSection');
    var hint = byId('upDocsHint');
    var grid = byId('upDocsGrid');
    var wrap = byId('upLoadMore');
    if (grid) while (grid.firstChild) grid.removeChild(grid.firstChild);
    if (wrap) wrap.hidden = true;
    if (!section) return;
    if (hint) {
      hint.hidden = false;
      hint.textContent = '公开文档加载失败，请稍后重试';
    }
    section.hidden = false;
  }

  // =========================================
  // 9. 加载流程
  // =========================================

  /** 拉取「公开文档」第一页并渲染 */
  function loadDocsFirstPage() {
    var profile = state.profile;
    var user = (profile && profile.user) || {};
    var authorId = trimStr(user.id);
    if (!authorId) {
      renderDocs([]);
      return Promise.resolve();
    }
    state.page = 1;
    return fetchAuthorDocs(authorId, 1, PAGE_SIZE).then(function (res) {
      if (!res.ok) {
        renderDocsError();
        return;
      }
      state.page = res.page;
      state.total = res.total;
      state.hasMore = res.hasMore;
      renderDocs(res.items);
    });
  }

  /** 「加载更多」：按 `page` / `size` 追加下一页，并驱动 `has_more` */
  function loadMore() {
    if (state.loadingMore || !state.hasMore || !state.profile) return;
    var authorId = trimStr(((state.profile || {}).user || {}).id);
    if (!authorId) return;
    state.loadingMore = true;
    renderLoadMore();
    var nextPage = state.page + 1;
    fetchAuthorDocs(authorId, nextPage, PAGE_SIZE).then(function (res) {
      state.loadingMore = false;
      if (!res.ok) {
        window.showToast('加载更多失败，请稍后重试', 'error');
        renderLoadMore();
        return;
      }
      state.page = res.page;
      state.total = res.total;
      state.hasMore = res.hasMore;
      var grid = byId('upDocsGrid');
      var frag = document.createDocumentFragment();
      var added = 0;
      res.items.forEach(function (doc) {
        var card = buildDocCard(doc);
        if (card) {
          frag.appendChild(card);
          added++;
        }
      });
      if (grid) grid.appendChild(frag);
      state.loadedCount = (state.loadedCount || 0) + added;
      // 追加页一条都没渲染出卡片（slug 全缺失之类）时不要显示「加载更多」，
      // 否则按钮会永远停在那里点了没反应。
      if (added === 0) state.hasMore = false;
      renderLoadMore();
    });
  }

  /** 组装「文档」+「组」都为空时的整页空态文案 */
  function emptyEverythingText() {
    return '这个人还没有公开任何东西';
  }

  /**
   * 首屏：解析地址 → 取主页 → 渲染 → 取文档第一页 → 必要时整页空态。
   */
  function load() {
    var target = readTarget();
    if (target.kind === 'none') {
      // 需求 8：既没有 u 也没有 id（或 id 不是正整数）→ 缺参提示，不发任何请求
      showPageState(MSG_MISSING_PARAM, MSG_MISSING_PARAM_HINT, false);
      setDocumentTitle('');
      return Promise.resolve();
    }

    showPageState(MSG_LOADING, '', false);
    setDocumentTitle('');
    state.profile = null;
    state.page = 1;
    state.total = 0;
    state.hasMore = false;
    state.loadingMore = false;
    state.loadedCount = 0;
    state.docsLoaded = false;
    state.groups = [];

    return fetchProfile(target).then(function (res) {
      if (!res.ok) {
        // 需求 7：404（未开启公开主页 / 不存在 / slug 非法）→ 原样展示后端文案的干净空态
        if (res.status === 404) {
          showPageState(res.msg || '该用户没有开启公开主页', '', false);
        } else {
          showPageState(MSG_LOAD_FAILED, res.msg || '', true);
        }
        setDocumentTitle('');
        return;
      }
      state.profile = res.data;
      renderProfile(res.data);
      showProfileCard();
      return loadDocsFirstPage().then(function () {
        // 需求 6：什么都空（没有公开文档、也没有公开组）→ 整页空态
        var stats = (res.data && res.data.stats) || {};
        var docCount = (typeof stats.public_docs === 'number') ? stats.public_docs : state.loadedCount;
        if (!state.groups.length && !state.hasMore && docCount === 0) {
          showPageState(emptyEverythingText(), '', false);
          setDocumentTitle('');
        }
      });
    });
  }

  // =========================================
  // 10. 装配（幂等）+ 全局挂载
  // =========================================

  /** 绑定「加载更多」；`document.readyState === 'loading'` 时等 DOMContentLoaded */
  function init() {
    var btn = byId('upLoadMoreBtn');
    if (btn && !btn.dataset.upLoadMoreBound) {
      btn.dataset.upLoadMoreBound = '1';
      btn.addEventListener('click', loadMore);
    }
    return load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ===== 全局挂载（普通 <script>，非 ES module；测试可显式驱动 load()）=====
  window.UserProfile = {
    load: load,
    loadMore: loadMore,
    readTarget: readTarget,
    // 下面这些是**渲染入口**，供 DOM 桩回归（`tools/test-user-profile-page.mjs` 一类的
    // 无浏览器测试）显式驱动；正常页面执行路径只走 `load()` / `loadMore()`。
    renderProfile: renderProfile,
    renderDocs: renderDocs,
    renderGroups: renderGroups,
    renderLoadMore: renderLoadMore,
    _internals: {
      fetchProfile: fetchProfile,
      fetchAuthorDocs: fetchAuthorDocs,
      buildDocCard: buildDocCard,
      buildGroupChip: buildGroupChip,
      formatYearMonth: formatYearMonth,
      PAGE_SIZE: PAGE_SIZE,
      DEFAULT_AVATAR: DEFAULT_AVATAR
    }
  };
})(window, document);
