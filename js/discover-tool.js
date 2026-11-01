/**
 * discover-tool.js — 「工具广场」专用页面逻辑（只被 discover/tool/*.html 加载）
 *
 * 为什么单独一个文件：js/discover.js 是 11 个发现页共用的通用渲染（板块流 / 详情 / 加入），
 * 工具板块的展示需求不一样 —— 发布者（官方 / 第三方 / 用户）、搜索与标签筛选、
 * 直接打开外部工具、以及**不显示**「来源类型 / 来源标识 / 展示时间」这类文档域字段。
 * 改共用文件会把 doc / group / org 三个板块一起拖下水，所以按 own-site 的先例单独成文件。
 *
 * 页面契约（静态页 → 本文件，靠 body[data-discover-page] 分派）：
 *   body[data-discover-page="tool-board"]   #discoverToolFilters（筛选条容器）
 *                                           #discoverFeed（卡片网格）
 *                                           #discoverMeta（工具条右侧计数，可缺）
 *                                           #discoverToolStats（hero 下方发布者统计，可缺）
 *   body[data-discover-page="tool-detail"]  #discoverDetail（详情容器），读 ?id=<item_id>
 *
 * 依赖顺序：config → utils → sanitize → theme → toast → index → discover → discover-tool
 * 数据来源：GET /api/v0/discover/feed?section=tool&page=N&size=100（Discover.feed）
 *           GET /api/v0/discover/item/<id>（Discover.detailState）
 *           第三方工具由后端 data/third_party_tools.json 启动时同步，前端不写死任何工具清单。
 * 约束：后端下发的字符串一律经 Discover.escapeHtml 转义；本文件不发任何写请求。
 */
(function () {
  'use strict';

  var D = window.Discover;
  if (!D || typeof D.feed !== 'function' || typeof D.detailPath !== 'function') {
    throw new Error('discover-tool.js 需要先加载 js/discover.js');
  }

  var esc = D.escapeHtml;
  var PUBLISHER_LABELS = D.PUBLISHER_LABELS || { official: '官方', third_party: '第三方', user: '用户' };
  // 展示顺序：先官方、再第三方、最后用户（与「越靠前越像站点自己维护」的直觉一致）
  var PUBLISHER_ORDER = ['official', 'third_party', 'user'];

  var TOOL_SECTION = 'tool';
  var FEED_SIZE = 100;        // 后端 FEED_SIZE_MAX；一次取满一页，减少轮次
  var FEED_PAGE_MAX = 10;     // 兜底：最多翻 10 页（1000 个工具），防止 has_more 异常时死循环
  var RELATED_LIMIT = 4;
  var TAG_LIMIT = 12;

  var state = {
    items: [],          // 全部工具（按后端顺序去重后）
    total: 0,           // 后端报的符合条件的总数
    loaded: false,
    loading: false,
    error: '',
    truncated: false,
    search: '',
    publisher: 'all',
    tag: '',
    presetApplied: false
  };

  var bound = { board: false, detail: false };
  var detailItem = null;

  // ===== §0 小工具 =====

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
  }

  function qs(root, sel) {
    return root ? root.querySelector(sel) : null;
  }

  function qsa(root, sel) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    return Array.prototype.slice.call(root.querySelectorAll(sel));
  }

  function bodyKind() {
    var body = document.body;
    if (!body) return '';
    var value = body.getAttribute ? body.getAttribute('data-discover-page') : '';
    if (!value && body.dataset) value = body.dataset.discoverPage;
    return typeof value === 'string' ? value : '';
  }

  /** 读 URL 查询参数（URL 不可用时退回正则；不抛） */
  function readParam(name) {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get(name);
    } catch (e) {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(String(window.location.search || ''));
      if (!m) return null;
      try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e2) { return m[1]; }
    }
  }

  function publisherOf(item) {
    var key = item && item.publisher_type ? String(item.publisher_type) : '';
    return PUBLISHER_LABELS[key] ? key : '';
  }

  function publisherLabel(item) {
    var key = publisherOf(item);
    return key ? PUBLISHER_LABELS[key] : '';
  }

  function linkUrlOf(item) {
    var url = item && item.link_url ? String(item.link_url) : '';
    return /^https?:\/\//i.test(url) ? url : '';
  }

  /** 外部地址 → 主机名（无地址 / 非法地址 → ''，调用方显示「站内工具」） */
  function hostOf(url) {
    if (!url) return '';
    try {
      return new URL(url).host || '';
    } catch (e) {
      var m = /^https?:\/\/([^\/?#]+)/i.exec(String(url));
      return m ? m[1] : '';
    }
  }

  /** 收录时间只留日期（后端是 'YYYY-MM-DDTHH:MM:SS'） */
  function dateOf(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }

  /** 工具自己的图标：emoji 直接用；URL / 空 → 统一用 🧰（不把远端图片塞进卡片） */
  function iconText(item) {
    var icon = item && item.icon ? String(item.icon).trim() : '';
    if (!icon || /^https?:\/\//i.test(icon)) return '🧰';
    return icon;
  }

  function tagsOf(item) {
    return (item && Array.isArray(item.tags) ? item.tags : [])
      .map(function (tag) { return String(tag == null ? '' : tag).trim(); })
      .filter(Boolean)
      .slice(0, 8);
  }

  function findItem(id) {
    var key = String(id);
    for (var i = 0; i < state.items.length; i++) {
      if (String(state.items[i].id) === key) return state.items[i];
    }
    return null;
  }

  // ===== §1 统一样式片段（空态 / 卡片 / 徽标） =====

  /**
   * 空态 / 加载态 / 错误态：复用 discover.css 的 .discover-state* 三件套。
   * button 传 { attr, label } 时才渲染按钮（retry / reset 由事件委托处理）。
   */
  function stateHtml(text, hint, button) {
    var html = '<div class="discover-state' + (button && button.attr === 'data-tool-retry' ? ' discover-state--error' : '') + '" role="status">';
    html += '<p class="discover-state__text">' + esc(text) + '</p>';
    if (hint) html += '<p class="discover-state__hint">' + esc(hint) + '</p>';
    if (button && button.attr) {
      html += '<button type="button" class="discover-state__retry" ' + button.attr + '>' + esc(button.label || '重新加载') + '</button>';
    }
    html += '</div>';
    return html;
  }

  function backLineHtml() {
    var href = D.sectionPath(TOOL_SECTION) || 'index.html';
    return '<p class="discover-tool-detail__backline"><a class="discover-tool-detail__back" href="'
      + esc(href) + '">← 返回工具广场</a></p>';
  }

  function tagsHtml(item, linkable) {
    var tags = tagsOf(item);
    if (!tags.length) return '';
    var html = '<div class="discover-tool-tags">';
    for (var i = 0; i < tags.length; i++) {
      if (linkable) {
        html += '<a class="discover-tag" href="' + esc(D.sectionPath(TOOL_SECTION) + '?tag=' + encodeURIComponent(tags[i]))
          + '">' + esc(tags[i]) + '</a>';
      } else {
        html += '<span class="discover-tag">' + esc(tags[i]) + '</span>';
      }
    }
    html += '</div>';
    return html;
  }

  function chipHtml(attrName, value, label, count, active) {
    var html = '<button type="button" class="discover-tool-chip' + (active ? ' is-active' : '') + '" '
      + attrName + '="' + esc(value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">'
      + esc(label);
    if (count !== null && count !== undefined) {
      html += '<span class="discover-tool-chip__count">' + Number(count) + '</span>';
    }
    html += '</button>';
    return html;
  }

  /**
   * 单张工具卡片。结构刻意与通用 .discover-card 分开：工具是「能打开来用」的，
   * 所以卡片底部的主动作是按钮（data-open-tool），标题链接只负责进详情。
   */
  function toolCardHtml(item) {
    if (!item || typeof item !== 'object') return '';
    var id = String(item.id);
    var href = D.detailPath(TOOL_SECTION, item.id);
    if (!href) return '';
    var url = linkUrlOf(item);
    var host = hostOf(url);
    var title = item.title ? String(item.title) : '未命名工具';
    var summary = item.summary ? String(item.summary) : '暂无简介';

    var html = '<article class="discover-tool-card" data-tool-id="' + esc(id) + '">';
    html += '<div class="discover-tool-card__head">';
    html += '<span class="discover-tool-card__icon" aria-hidden="true">' + esc(iconText(item)) + '</span>';
    html += '<div class="discover-tool-card__titles">';
    html += '<a class="discover-tool-card__title" href="' + esc(href) + '">' + esc(title) + '</a>';
    html += '<span class="discover-tool-card__host">' + esc(host || '站内工具') + '</span>';
    html += '</div>';
    html += D.publisherBadge(item);
    html += '</div>';
    html += '<p class="discover-tool-card__desc">' + esc(summary) + '</p>';
    html += tagsHtml(item, false);
    html += '<div class="discover-tool-card__actions">';
    html += '<button type="button" class="discover-tool-btn discover-tool-btn--primary" data-open-tool="'
      + esc(id) + '">打开工具</button>';
    html += '<a class="discover-tool-btn" href="' + esc(href) + '">查看详情</a>';
    html += '</div>';
    html += '</article>';
    return html;
  }

  // ===== §2 筛选 / 排序 / 计数 =====

  function publisherCounts() {
    var counts = {};
    for (var i = 0; i < state.items.length; i++) {
      var key = publisherOf(state.items[i]);
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  /** 标签按出现次数降序（次数相同按名称）取前 TAG_LIMIT 个 */
  function tagEntries() {
    var map = {};
    for (var i = 0; i < state.items.length; i++) {
      var tags = tagsOf(state.items[i]);
      for (var j = 0; j < tags.length; j++) {
        var key = tags[j].toLowerCase();
        if (!map[key]) map[key] = { name: tags[j], count: 0 };
        map[key].count++;
      }
    }
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    return list.slice(0, TAG_LIMIT);
  }

  function matchesFilter(item) {
    if (state.publisher !== 'all' && publisherOf(item) !== state.publisher) return false;
    if (state.tag) {
      var tags = tagsOf(item).map(function (t) { return t.toLowerCase(); });
      if (tags.indexOf(String(state.tag).toLowerCase()) < 0) return false;
    }
    var q = String(state.search || '').trim().toLowerCase();
    if (!q) return true;
    var hay = [
      item.title, item.summary, item.ref_id, item.ref_type,
      publisherLabel(item), linkUrlOf(item), hostOf(linkUrlOf(item)),
      tagsOf(item).join(' ')
    ].map(function (x) { return String(x == null ? '' : x); }).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function filteredItems() {
    return state.items.filter(matchesFilter);
  }

  function isFiltering() {
    return !!(String(state.search || '').trim() || state.publisher !== 'all' || state.tag);
  }

  // ===== §3 工具广场（board） =====

  function renderFilters(container) {
    if (!container) return;
    var counts = publisherCounts();
    var tags = tagEntries();
    var html = '';

    html += '<div class="discover-tool-filters__row">';
    html += '<label class="discover-tool-filters__search" for="toolSearch">';
    html += '<span class="discover-tool-filters__label">搜索</span>';
    html += '<input type="search" id="toolSearch" class="discover-tool-filters__input" autocomplete="off"'
      + ' placeholder="' + esc('按名称 / 说明 / 标签搜索工具') + '" value="' + esc(state.search) + '">';
    html += '</label>';
    html += '<button type="button" class="discover-tool-chip discover-tool-chip--reset" data-tool-reset hidden>重置筛选</button>';
    html += '</div>';

    html += '<div class="discover-tool-filters__row">';
    html += '<span class="discover-tool-filters__label">发布者</span>';
    html += chipHtml('data-tool-publisher', 'all', '全部', state.items.length, state.publisher === 'all');
    for (var i = 0; i < PUBLISHER_ORDER.length; i++) {
      var key = PUBLISHER_ORDER[i];
      var count = counts[key] || 0;
      if (!count) continue;
      html += chipHtml('data-tool-publisher', key, PUBLISHER_LABELS[key], count, state.publisher === key);
    }
    html += '</div>';

    if (tags.length) {
      html += '<div class="discover-tool-filters__row">';
      html += '<span class="discover-tool-filters__label">标签</span>';
      for (var t = 0; t < tags.length; t++) {
        html += chipHtml('data-tool-tag', tags[t].name, tags[t].name, tags[t].count, state.tag === tags[t].name);
      }
      html += '</div>';
    }

    container.innerHTML = html;
  }

  /** 只同步「选中态 / 重置按钮显隐」，不重建控件（重建会让搜索框丢焦点） */
  function syncFilters() {
    qsa(document, '[data-tool-publisher]').forEach(function (el) {
      var active = el.getAttribute('data-tool-publisher') === state.publisher;
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
      el.classList.toggle('is-active', active);
    });
    qsa(document, '[data-tool-tag]').forEach(function (el) {
      var active = el.getAttribute('data-tool-tag') === state.tag;
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
      el.classList.toggle('is-active', active);
    });
    qsa(document, '[data-tool-reset]').forEach(function (el) {
      // 空态里的「重置筛选」按钮（discover-state__retry）始终显示；筛选条里的那个按需显示
      el.hidden = !isFiltering() && el.classList.contains('discover-tool-chip--reset');
    });
  }

  function updateMeta(items) {
    var meta = qs(document, '#discoverMeta');
    if (meta) {
      var text;
      if (state.loading) {
        text = '正在加载工具…';
      } else if (state.error && !state.items.length) {
        text = '加载失败';
      } else if (!state.items.length) {
        text = '暂无工具';
      } else {
        var parts = ['共 ' + state.items.length + ' 个工具'];
        var counts = publisherCounts();
        for (var i = 0; i < PUBLISHER_ORDER.length; i++) {
          var key = PUBLISHER_ORDER[i];
          if (counts[key]) parts.push(PUBLISHER_LABELS[key] + ' ' + counts[key]);
        }
        if (isFiltering()) parts.push('当前筛选 ' + items.length + ' 个');
        if (state.truncated) parts.push('仅加载前 ' + state.items.length + ' 个');
        text = parts.join(' · ');
      }
      meta.textContent = text;
    }

    var stats = qs(document, '#discoverToolStats');
    if (stats) {
      if (!state.items.length) {
        stats.textContent = '';
      } else {
        var counts2 = publisherCounts();
        var bits = [];
        for (var j = 0; j < PUBLISHER_ORDER.length; j++) {
          var k = PUBLISHER_ORDER[j];
          if (counts2[k]) bits.push(PUBLISHER_LABELS[k] + ' ' + counts2[k]);
        }
        stats.textContent = bits.length ? ('已收录 ' + state.items.length + ' 个工具：' + bits.join(' · ')) : '';
      }
    }
  }

  function renderList() {
    var grid = qs(document, '#discoverFeed');
    var items = filteredItems();

    if (grid) {
      if (state.loading) {
        grid.innerHTML = stateHtml('正在加载工具…', '工具清单由后端清单文件同步。', null);
      } else if (state.error && !state.items.length) {
        grid.innerHTML = stateHtml(state.error, '网络恢复后再试一次。', { attr: 'data-tool-retry', label: '重新加载' });
      } else if (!state.items.length) {
        grid.innerHTML = stateHtml('暂时还没有收录的工具',
          '第三方工具由后端 data/third_party_tools.json 维护；用户工具需在展示页开启公开后才会出现在这里。', null);
      } else if (!items.length) {
        grid.innerHTML = stateHtml('没有符合筛选条件的工具', '换个关键词，或重置筛选看全部。',
          { attr: 'data-tool-reset', label: '重置筛选' });
      } else {
        var html = '';
        for (var i = 0; i < items.length; i++) html += toolCardHtml(items[i]);
        grid.innerHTML = html;
      }
    }
    updateMeta(items);
  }

  /** 重置筛选：重建筛选条（搜索框清空），回到「全部」 */
  function resetFilters() {
    state.search = '';
    state.publisher = 'all';
    state.tag = '';
    renderFilters(qs(document, '#discoverToolFilters'));
    renderList();
    syncFilters();
  }

  function presetFromQuery() {
    if (state.presetApplied) return;
    state.presetApplied = true;
    var q = readParam('q');
    if (q) state.search = q;
    var publisher = readParam('publisher');
    if (publisher && PUBLISHER_LABELS[publisher]) state.publisher = publisher;
    var tag = readParam('tag');
    if (tag) state.tag = tag;
  }

  /**
   * 拉全量工具清单：一页 100 条，has_more 就继续翻（上限 FEED_PAGE_MAX 页）。
   * 失败时保留已取到的部分；一条都没取到才显示错误态。
   */
  async function loadBoard(force) {
    if (state.loading) return;
    if (force) {
      state.items = [];
      state.total = 0;
      state.error = '';
      state.truncated = false;
      state.loaded = false;
    }
    state.loading = true;
    renderList();

    var items = [];
    var seen = {};
    var total = 0;
    var hasMore = false;
    var scanTruncated = false;
    var failed = false;

    for (var page = 1; page <= FEED_PAGE_MAX; page++) {
      var data = await D.feed({ section: TOOL_SECTION, page: page, size: FEED_SIZE });
      if (!data) { failed = true; break; }
      total = Number(data.total) || total;
      if (data.scan_truncated) scanTruncated = true;
      var list = Array.isArray(data.items) ? data.items : [];
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!item || item.id === undefined || item.id === null) continue;
        var key = String(item.id);
        if (seen[key]) continue;
        seen[key] = true;
        items.push(item);
      }
      hasMore = !!data.has_more;
      if (!hasMore) break;
    }

    state.items = items;
    state.total = total || items.length;
    state.truncated = !!(hasMore || scanTruncated);
    state.error = failed ? '工具列表加载失败，请稍后重试' : '';
    state.loading = false;
    state.loaded = true;

    renderFilters(qs(document, '#discoverToolFilters'));
    renderList();
    syncFilters();
  }

  function openToolById(id) {
    var item = findItem(id);
    if (!item) return;
    // runAction('use') 对 http(s) 地址开新标签；没有地址（角色/官方占位）时给统一提示
    D.runAction('use', item);
  }

  function bindBoard(grid, filters) {
    if (bound.board) return;
    bound.board = true;

    if (filters) {
      filters.addEventListener('input', function (e) {
        var target = e.target;
        if (!target || target.id !== 'toolSearch') return;
        state.search = String(target.value == null ? '' : target.value);
        renderList();
        syncFilters();
      });
      filters.addEventListener('click', function (e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('[data-tool-reset]')) {
          e.preventDefault();
          resetFilters();
          return;
        }
        var pub = target.closest('[data-tool-publisher]');
        if (pub) {
          e.preventDefault();
          state.publisher = pub.getAttribute('data-tool-publisher') || 'all';
          renderList();
          syncFilters();
          return;
        }
        var tag = target.closest('[data-tool-tag]');
        if (tag) {
          e.preventDefault();
          var value = tag.getAttribute('data-tool-tag') || '';
          state.tag = state.tag === value ? '' : value;
          renderList();
          syncFilters();
        }
      });
    }

    if (grid) {
      grid.addEventListener('click', function (e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') return;
        var openBtn = target.closest('[data-open-tool]');
        if (openBtn) {
          e.preventDefault();
          openToolById(openBtn.getAttribute('data-open-tool'));
          return;
        }
        if (target.closest('[data-tool-retry]')) {
          e.preventDefault();
          loadBoard(true);
        }
      });
    }
  }

  async function initBoard() {
    var grid = qs(document, '#discoverFeed');
    var filters = qs(document, '#discoverToolFilters');
    if (!grid && !filters) return false;

    bindBoard(grid, filters);
    presetFromQuery();

    if (state.loaded || state.loading) {
      renderFilters(filters);
      renderList();
      syncFilters();
      return true;
    }
    await loadBoard(false);
    return true;
  }

  // ===== §4 工具详情（detail） =====

  function factHtml(label, value) {
    return '<div class="discover-tool-detail__fact"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>';
  }

  function publisherFact(item) {
    var key = publisherOf(item);
    var label = key ? PUBLISHER_LABELS[key] : '未标注';
    if (key === 'third_party') return esc(label + ' · 后端清单收录');
    if (key === 'official') return esc(label + ' · 站点维护');
    if (key === 'user') {
      var owner = item.owner_username ? String(item.owner_username) : '';
      return esc(label + ' · ' + (owner ? owner + ' 分享' : '用户分享'));
    }
    return esc(label);
  }

  function addressFact(item) {
    var url = linkUrlOf(item);
    if (!url) return '<span class="discover-tool-detail__muted">暂未提供外部地址</span>';
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">'
      + esc(hostOf(url) || url) + '</a>';
  }

  function detailHtml(item) {
    var href = D.sectionPath(TOOL_SECTION) || 'index.html';
    var title = item.title ? String(item.title) : '未命名工具';
    var summary = item.summary ? String(item.summary) : '暂无简介';
    var description = item.content_preview ? String(item.content_preview) : summary;
    var host = hostOf(linkUrlOf(item));

    var html = '<article class="discover-tool-detail" data-tool-id="' + esc(String(item.id)) + '">';
    html += backLineHtml();
    html += '<header class="discover-tool-detail__head">';
    html += '<span class="discover-tool-detail__icon" aria-hidden="true">' + esc(iconText(item)) + '</span>';
    html += '<div class="discover-tool-detail__heading">';
    html += '<p class="discover-tool-detail__eyebrow">';
    html += D.publisherBadge(item);
    html += '<span class="discover-tool-detail__host">' + esc(host || '站内工具') + '</span>';
    html += '</p>';
    html += '<h1 class="discover-tool-detail__title">' + esc(title) + '</h1>';
    html += '<p class="discover-tool-detail__summary">' + esc(summary) + '</p>';
    html += '</div></header>';

    html += '<div class="discover-tool-detail__actions">';
    html += '<button type="button" class="discover-tool-btn discover-tool-btn--primary" data-open-tool="'
      + esc(String(item.id)) + '">打开工具</button>';
    html += '<button type="button" class="discover-tool-btn" data-copy-tool="' + esc(String(item.id)) + '">复制链接</button>';
    html += '<a class="discover-tool-btn" href="' + esc(href) + '">返回工具广场</a>';
    html += '</div>';

    html += '<section class="discover-tool-detail__section" aria-label="工具说明">';
    html += '<h2 class="discover-tool-detail__section-title">工具说明</h2>';
    html += '<p class="discover-tool-detail__text">' + esc(description) + '</p>';
    html += tagsHtml(item, true);
    html += '</section>';

    html += '<section class="discover-tool-detail__section" aria-label="工具信息">';
    html += '<h2 class="discover-tool-detail__section-title">工具信息</h2>';
    html += '<dl class="discover-tool-detail__facts">';
    html += factHtml('发布者', publisherFact(item));
    html += factHtml('工具地址', addressFact(item));
    html += factHtml('工具标识', esc(item.ref_id ? String(item.ref_id) : '—'));
    html += factHtml('收录时间', esc(dateOf(item.created_at) || '—'));
    html += '</dl></section>';

    html += '<section class="discover-tool-detail__section" aria-label="同类工具">';
    html += '<h2 class="discover-tool-detail__section-title">同类工具</h2>';
    html += '<div class="discover-tool-related" id="discoverToolRelatedGrid">';
    html += '<p class="discover-tool-detail__hint">正在加载同类工具…</p>';
    html += '</div></section>';

    html += '</article>';
    return html;
  }

  function renderRelated(container, current, data) {
    if (!container) return;
    if (!data) {
      container.innerHTML = '<p class="discover-tool-detail__hint">同类工具暂时取不到。</p>';
      return;
    }
    var currentPublisher = publisherOf(current);
    var others = (Array.isArray(data.items) ? data.items : []).filter(function (item) {
      return item && String(item.id) !== String(current.id);
    });
    // 同发布者排在前面（第三方之间更可能「像一类工具」），其余按后端原始顺序
    others.sort(function (a, b) {
      var da = publisherOf(a) === currentPublisher ? 0 : 1;
      var db = publisherOf(b) === currentPublisher ? 0 : 1;
      return da - db;
    });
    others = others.slice(0, RELATED_LIMIT);
    if (!others.length) {
      container.innerHTML = '<p class="discover-tool-detail__hint">暂时没有同类工具。</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < others.length; i++) html += toolCardHtml(others[i]);
    container.innerHTML = html;
  }

  function setTitle(text) {
    document.title = (text ? text + ' | ' : '') + '工具详情 | 发现 | GWL';
  }

  function copyDetailLink() {
    if (!detailItem) return;
    var url = linkUrlOf(detailItem);
    if (!url) {
      toast('该工具暂未提供外部地址');
      return;
    }
    var nav = window.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      nav.clipboard.writeText(url).then(function () {
        toast('工具地址已复制');
      }, function () {
        toast('复制失败，请手动复制');
      });
    } else {
      toast('复制失败，请手动复制');
    }
  }

  function bindDetail(container) {
    if (bound.detail) return;
    bound.detail = true;
    container.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest('[data-open-tool]')) {
        e.preventDefault();
        if (detailItem) D.runAction('use', detailItem);
        return;
      }
      if (target.closest('[data-copy-tool]')) {
        e.preventDefault();
        copyDetailLink();
        return;
      }
      if (target.closest('[data-tool-detail-retry]')) {
        e.preventDefault();
        initDetail();
      }
    });
  }

  async function loadRelated(container, item) {
    var grid = qs(container, '#discoverToolRelatedGrid');
    if (!grid) return;
    var data = await D.feed({ section: TOOL_SECTION, page: 1, size: FEED_SIZE });
    // 详情页只关心「别把当前这条也列进来」，数据失败就给出静态提示，不打断详情阅读
    renderRelated(grid, item, data);
  }

  async function initDetail() {
    var container = qs(document, '#discoverDetail');
    if (!container) return false;
    bindDetail(container);
    container.innerHTML = stateHtml('正在加载工具…', '正在读取工具详情。', null);
    detailItem = null;

    var id = readParam('id');
    var result = await D.detailState(id);

    if (result.status === 'invalid-id') {
      setTitle('');
      container.innerHTML = backLineHtml() + stateHtml('缺少有效的工具编号',
        '工具详情页需要 ?id=<工具编号>，请从工具广场进入。', null);
      return true;
    }
    if (result.status === 'not-found') {
      setTitle('');
      container.innerHTML = backLineHtml() + stateHtml('工具不存在或未公开',
        '这个工具可能已下架，或还没有在展示页开启公开。', null);
      return true;
    }
    if (result.status !== 'ok' || !result.item) {
      setTitle('');
      container.innerHTML = backLineHtml() + stateHtml('加载失败，请稍后重试',
        '工具详情暂时取不到。', { attr: 'data-tool-detail-retry', label: '重新加载' });
      return true;
    }

    var item = result.item;
    if (item.type && item.type !== TOOL_SECTION) {
      setTitle('');
      container.innerHTML = backLineHtml() + stateHtml('该编号不是工具内容',
        '请从工具广场进入工具详情。', null);
      return true;
    }

    detailItem = item;
    container.innerHTML = detailHtml(item);
    setTitle(item.title ? String(item.title) : '');
    await loadRelated(container, item);
    return true;
  }

  // ===== §5 入口 =====

  function init() {
    var kind = bodyKind();
    if (kind === 'tool-board') return initBoard();
    if (kind === 'tool-detail') return initDetail();
    return Promise.resolve(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }

  window.DiscoverTool = {
    init: init,
    // 自测 / 排查只读：当前页面的筛选与加载状态（不要当 API 依赖）
    state: state,
    TOOL_SECTION: TOOL_SECTION
  };
})();
