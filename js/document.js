/**
 * document.js
 * 文档系统前端逻辑：hash 路由、权限辅助、Markdown 渲染、目录树与修订历史
 */

// 内部缓存：分类/文档/当前用户信息（供多视图复用）
const __DOC = {
  
  docs: [],                // [{id, title, slug, permission_bits, visibility, owning, ...}]
  categories: [],          // 三目录重构后已废弃，保留空数组兜底避免 for...of 报错
  user: {
    isLoggedIn: false,
    permissionLevel: null, // null/undefined = 匿名
    username: '',
    group: 'default'
  },
  currentSlug: null,       // 当前详情页 slug（用于 active 高亮）
  currentDocId: null,      // ⭐ B5：当前详情页的文档 id（导出用；slug 不能直接换 id）
  revisions: [],           // 当前文档修订缓存
  markedReady: false,      // marked.js 是否已加载
  markedLoading: false,    // marked.js 是否正在加载中（防止并发脚本注入）
  dompurifyReady: false,   // DOMPurify 是否已加载
  visFilter: 'public',     // 侧栏可见类型筛选：public / group / private
  folders: [],              // 文件夹列表：匿名时仅公共文件夹；登录时=个人(personal)+公共(public)合并
  currentFolderId: 0,       // 0=根目录（默认）；正整数=该文件夹
  isAdmin: false,           // 等级≥5 才为 true
  // ⭐ B3（2026-10-06）：当前生效的**标签筛选**（空串 = 不筛）。服务端 `?tags=` 生效。
  tagsFilter: '',
  // ⭐ B4：服务端标题搜索的运行态（`docSearchState()` 惰性初始化）与在途请求句柄
  search: null,
  searchAbort: null,
  // ⭐ 服务端分页状态（2026-10-06，B1）：`docs` 是**已累积的页**，不再是"全集"
  //   ⚠️ 切 tab / 点文件夹 / 面包屑 / 返回首页一律**替换**（重置 page=1），
  //      只有点「加载更多」才追加 —— 否则会累积上一个筛选条件下的脏数据。
  page: 1,                  // 已加载到第几页（1 起算）
  size: 20,                 // 每页条数（后端默认 20、上限 100）
  total: 0,                 // 后端给的「过滤后总数」（不是当前已加载条数）
  hasMore: false,           // 是否还有下一页
  loadingMore: false        // 防连点
};

const DOC_LEVEL_ROLES = {
  0: '未登录访客',
  1: 'user',
  2: 'admin1',
  3: 'admin2',
  4: 'admin3',
  5: 'superadmin'
};

// =========================================
// 入口
// =========================================
document.addEventListener('DOMContentLoaded', () => {
  initDocSidebarControls();

  // 启动时并发：拿分类 / 拿列表 / 拿身份 / 拿公共文件夹
  Promise.all([
    fetchDocList(),
    fetchDocAuthState(),
    fetchDocFolders()
  ])
    .then(() => {
      // 先渲染文件夹（用于 active 状态显示），再渲染依赖 docs 的目录树与首页卡片
      renderDocFolders();
      renderDocSidebarTree();
      renderHomeCategoryGrids();
      bindDocSearch();
      bindVisTabs();
      bindRevisionsToggle();
      bindRevisionModal();
      updateVisEmptyPlaceholders();
      bindDocLoadMore();
      renderDocLoadMore();
      bindDocTagFilter();
      bindDocExport();
      renderDocBreadcrumb();
      // 最后按当前 URL 决定去哪（支持 ?slug= / ?id= 直达 与 #/doc/<slug> 路由）
      applyQueryRouteOrHash();
      window.addEventListener('hashchange', routeByHash);
    })
    .catch(err => {
      console.error('[document.js] 初始化失败:', err);
    });
});

// =========================================
// 1. 侧边栏开/关 & 移动端控制
// =========================================
function initDocSidebarControls() {
  const sidebar = document.getElementById('docSidebar');
  const overlay = document.getElementById('docSidebarOverlay');
  const toggleBtn = document.getElementById('docSidebarToggle');
  const closeBtn = document.getElementById('docSidebarClose');
  const backHomeBtn = document.getElementById('backToHomeBtn');
  if (!sidebar) return;

  function open() { sidebar.classList.add('is-open'); if (overlay) overlay.classList.add('doc-sidebar-overlay--visible'); }
  function close() { sidebar.classList.remove('is-open'); if (overlay) overlay.classList.remove('doc-sidebar-overlay--visible'); }

  if (toggleBtn) toggleBtn.addEventListener('click', open);
  if (closeBtn)  closeBtn.addEventListener('click', close);
  if (overlay)   overlay.addEventListener('click', close);

  // 顶部「文档中心首页」按钮:重置所有筛选状态(tab/folder/搜索)并切回主页视图。
  // 与详情页主区的「← 返回文档主页」(#docBackBtn) 区分:后者只切回主页视图,保留筛选状态。
  if (backHomeBtn) {
    backHomeBtn.addEventListener('click', async () => {
      // 统一筛选状态机:重置到默认状态(visFilter=public, folderId=null, 搜索框空)
      resetToDefaultFilter();
      // a 标签默认跳转会改 hash → 触发 routeByHash → showDocHome(切回主页视图)
      // 重新拉取数据 + 全量重渲染
      await applyDocFolderFilter();
      // 移动端:收起侧边栏
      close();
    });
  }

  // 点击目录项时，移动端自动收起
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.doc-item');
    if (item && window.innerWidth <= 768) close();
  });
}

// =========================================
// 2. 权限辅助函数（按计划实现）
// =========================================

/**
 * 将 6 位 permission_bits 解析为 [{level, allow, force}]
 * 位索引 0..4 对应等级 1..5；第 6 位（索引5）为保留位
 * 约定：level 5（超级管理员）永远 force=true allow=true（与后端兜底对齐）
 */
function parsePermBits(bits) {
  if (typeof bits !== 'string' || !/^[01]{6}$/.test(bits)) {
    console.warn('[parsePermBits] 脏 permission_bits，降级成全0:', bits);
    bits = '000000';
  }
  const out = [];
  for (let i = 0; i < 5; i++) {
    const level = i + 1;
    const isSuper = level === 5;
    out.push({
      level,
      allow: isSuper ? true : bits[i] === '1',
      force: isSuper
    });
  }
  // 第 6 位为保留位
  out.push({ level: 6, allow: bits[5] === '1', force: false });
  return out;
}

/**
 * 当前身份是否可以查看某文档（前端预过滤，后端仍会二次校验）
 * userLevel: null=匿名 / 1~5
 * 与后端 _check_view_permission 保持一致：
 *   - private: 仅作者/超管（前端无法判作者，一律过滤，后端放行作者）
 *   - group: 后端已按组员过滤，前端直接放行返回的组文档
 *   - public: 按 permission_bits 位检查
 */
function canViewByBits(bits, visibility, userLevel) {
  // 私有文档：仅作者本人 & 超管可看，前端无法判断作者，所以一律过滤掉（后端二次校验会放行作者）
  if (visibility === 'private') return false;
  // 组文档：后端已按组成员过滤，返回的都是可见的
  if (visibility === 'group') return true;
  // 等级5（超级管理员）直接 true（与后端兜底一致）
  if (userLevel && userLevel >= 5) return true;

  if (!userLevel) {
    // 匿名：visibility 必须 public 且 等级1位为 1
    return visibility === 'public' && (bits && bits[0] === '1');
  }
  const idx = Math.min(4, Math.max(0, userLevel - 1));
  return bits && bits[idx] === '1';
}

/**
 * 计算文档应展示的 tab（公有 / 组 / 私有）
 * - private 文档 → 私有 tab（仍按 visibility）
 * - 非 private 文档：owning='0' → 公有 tab；owning!='0' → 组 tab
 */
function owningToTab(doc) {
  if (doc.visibility === 'private') return 'private';
  return doc.owning === '0' ? 'public' : 'group';
}

/**
 * 一句话友好权限摘要（给普通用户看的）
 */
function permToSummaryText(bits, visibility) {
  const arr = parsePermBits(bits).filter(a => a.level <= 5);
  // 找到第一个允许的最低等级 & 最高允许的等级
  const allowLevels = arr.filter(a => a.allow).map(a => a.level);
  const isPublic = visibility === 'public';

  if (allowLevels.filter(l => l <= 5).length === 5) {
    return isPublic ? '所有人可见（登录 + 访客）' : '所有登录用户可见';
  }
  if (allowLevels.length === 1 && allowLevels[0] === 5) {
    return '仅超级管理员可见';
  }
  // 找最低 level -> 最高 level 的连续区间
  const minL = Math.min(...allowLevels);
  const maxL = Math.max(...allowLevels);
  const allInRange = [];
  for (let l = minL; l <= maxL; l++) allInRange.push(l);
  const continuous = allInRange.every(l => allowLevels.includes(l)) && allInRange.length === allowLevels.length;
  if (continuous) {
    let txt = `等级 ${minL}${minL !== maxL ? ` ~ ${maxL}` : ''} 可见`;
    if (isPublic && minL === 1) txt = `${txt}（含访客）`;
    return txt;
  }
  return `仅等级 ${allowLevels.join('、')} 可见`;
}

// =========================================
// 3. 数据获取
// =========================================

/**
 * 拉取文档列表（服务端分页 + 双形状兼容）。
 *
 * @param {{append?: boolean}} [opts]
 *   `append=true`  → 取**下一页**并追加到 `__DOC.docs`；
 *   省略/false     → 取第 1 页并**替换**（切 tab / 点文件夹 / 面包屑 / 返回首页都走这条）。
 *
 * ⭐ 2026-10-06（B1）：请求显式带 `page`/`size`。后端**两个都不传时才返回裸数组**
 * （刻意保留的兼容分支：线上 GitHub Pages 可能仍持旧 JS），所以这里两种形状都能吃：
 *   * `Array`            → 视为「只有一页」，`hasMore=false`；
 *   * `{items,page,...}` → 累积/替换 + `total` / `has_more`。
 */
async function fetchDocList(opts) {
  const append = !!(opts && opts.append);
  try {
    const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    // folder_id 过滤：null=不过滤；0=根目录；正整数=该文件夹
    // scope 过滤：三目录（public/group/private）后端按 scope 决定返回哪一目录根下的数据
    // 若 currentFolderId 为具体正整数文件夹：用该文件夹的真实 scope（避免点击组/私有文件夹时默认 public 导致空数据）
    let actualScope = __DOC.visFilter || 'public';
    if (typeof __DOC.currentFolderId === 'number' && __DOC.currentFolderId > 0) {
      const f = __DOC.folders.find(x => x.id === __DOC.currentFolderId);
      if (f && f.scope) actualScope = f.scope;
    }
    const page = append ? (__DOC.page + 1) : 1;
    let url = `${API_BASE_URL}/api/v0/document/list`;
    const qp = [];
    qp.push(`scope=${encodeURIComponent(actualScope)}`);
    // 根目录（0）传 folder_id=0 只显示根目录文档；正整数传指定文件夹
    if (typeof __DOC.currentFolderId === 'number' && __DOC.currentFolderId >= 0) {
      qp.push(`folder_id=${encodeURIComponent(__DOC.currentFolderId)}`);
    }
    qp.push(`page=${encodeURIComponent(page)}`);
    qp.push(`size=${encodeURIComponent(__DOC.size)}`);
    // ⭐ B3：标签筛选（服务端过滤，与分页/判权同一套语义）
    if (__DOC.tagsFilter) qp.push(`tags=${encodeURIComponent(__DOC.tagsFilter)}`);
    if (qp.length) url += '?' + qp.join('&');
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      const data = d.data;
      if (Array.isArray(data)) {
        // ⚠️ 旧后端兼容分支 —— **部署窗口保护，不是契约**：
        // 后端 2026-10-11 起 `/document/list` 恒返回分页包络（决策 Q8=B / UNTRUSTED J4），
        // 但 Pages 前端先于后端「人工重启」生效，这段窗口里新 JS 会读到旧后端的裸数组。
        // 收口稳定后此分支不可达，可在后续版本删除。
        __DOC.docs = data;
        __DOC.page = 1;
        __DOC.total = data.length;
        __DOC.hasMore = false;
      } else if (data && Array.isArray(data.items)) {
        __DOC.docs = append ? __DOC.docs.concat(data.items) : data.items.slice();
        __DOC.page = (typeof data.page === 'number' && data.page > 0) ? data.page : page;
        if (typeof data.size === 'number' && data.size > 0) __DOC.size = data.size;
        __DOC.total = (typeof data.total === 'number') ? data.total : __DOC.docs.length;
        __DOC.hasMore = !!data.has_more;
      } else {
        __DOC.docs = [];
        __DOC.page = 1;
        __DOC.total = 0;
        __DOC.hasMore = false;
      }
      return true;
    }
    console.warn('[list] 获取失败:', d.msg);
    return false;
  } catch (e) {
    console.error('[list] 网络错误:', e);
    return false;
  }
}

/**
 * 轻量获取当前登录用户的 permission_level
 * 失败视为匿名（permissionLevel = null）
 */
async function fetchDocAuthState() {
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    __DOC.user = { isLoggedIn: false, permissionLevel: null, username: '', group: 'default' };
    __DOC.isAdmin = false;
    return;
  }
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/auth/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    if (r.ok && d.code === 200 && d.data && d.data.user) {
      const u = d.data.user;
      // 运行时等级优先读 now_permission（默认 1）；真实等级用于超管判断
      const npLevel = (window.__nowPermission && window.__nowPermission.level) || 1;
      __DOC.user = {
        isLoggedIn: true,
        id: u.id,
        permissionLevel: npLevel,
        username: u.username || '',
        group: (u.profile && u.profile.group) ? u.profile.group : 'default'
      };
      // 等级≥5 才能管理公共文件夹（超管判断仍用真实等级）
      __DOC.isAdmin = (u.permission_level || 0) >= 5;
    } else {
      __DOC.user = { isLoggedIn: false, permissionLevel: null, username: '', group: 'default' };
      __DOC.isAdmin = false;
    }
  } catch (e) {
    console.error('[auth] 网络错误，按匿名处理:', e);
    __DOC.user = { isLoggedIn: false, permissionLevel: null, username: '', group: 'default' };
    __DOC.isAdmin = false;
  }
}

/**
 * 拉取文件夹列表
 *  - 已登录：调用 /folders（默认返回当前用户 personal 文件夹 + 公共文件夹）
 *  - 匿名（无 token）：调用 /folders/public（仅返回公共文件夹）
 */
async function fetchDocFolders() {
  try {
    const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    // 已登录时走 /folders（支持 personal + public；匿名需 401 兜底）
    // scope=三目录过滤，后端按 scope 决定返回 public/ group/ private 哪一目录下的文件夹
    // 若 currentFolderId 为具体正整数文件夹：用该文件夹的真实 scope（避免点击组/私有文件夹时默认 public 导致空树）
    let actualScope = __DOC.visFilter || 'public';
    if (typeof __DOC.currentFolderId === 'number' && __DOC.currentFolderId > 0) {
      const f = __DOC.folders.find(x => x.id === __DOC.currentFolderId);
      if (f && f.scope) actualScope = f.scope;
    }
    const _scope = encodeURIComponent(actualScope);
    const url = token
      ? `${API_BASE_URL}/api/v0/document/folders?scope=${_scope}`
      : `${API_BASE_URL}/api/v0/document/folders/public?scope=${_scope}`;
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      __DOC.folders = d.data || [];
    } else if (r.status === 401) {
      // 401：token 无效，尝试匿名 fallback
      try {
        const r2 = await fetch(`${API_BASE_URL}/api/v0/document/folders/public`);
        const d2 = await r2.json();
        if (r2.ok && d2.code === 200) {
          __DOC.folders = d2.data || [];
        } else {
          console.warn('[folders] 匿名 fallback 失败:', d2.msg);
        }
      } catch (e2) { console.warn('[folders] 匿名 fallback 网络错误:', e2); }
    } else {
      console.warn('[folders] 获取失败:', d.msg);
    }
  } catch (e) {
    console.warn('[folders] 网络错误:', e);
  }
}

// =========================================
// 4. 渲染：侧边栏目录树
// =========================================
// 注：folder_id 过滤由后端完成（fetchDocList 内部按 __DOC.currentFolderId 拼 ?folder_id=），
// 此函数只基于已过滤的 __DOC.docs 渲染，无需再做 folder 过滤。
function renderDocSidebarTree(keyword = '') {
  const root = document.getElementById('docSidebarTree');
  if (!root) return;

  // ⭐ B4：搜索模式优先（服务端结果 / 服务端不可用时的本地降级结果）
  const searchState = docSearchState();
  if (searchState.active && searchState.kw) {
    renderDocSearchResults(root, searchState);
    return;
  }

  // 先做权限过滤（前端预过滤）
  const lvl = __DOC.user.permissionLevel;
  const uid = __DOC.user.id;
  let visibleDocs = __DOC.docs.filter(doc =>
    (uid && doc.owning == String(uid)) || canViewByBits(doc.permission_bits, doc.visibility, lvl)
  );

  // 可见类型 tab 过滤（public / group / private）
  if (__DOC.visFilter) {
    if (__DOC.visFilter === 'private') {
      // 私有 tab：仅显示当前用户拥有的文档（owning == 用户ID）
      visibleDocs = visibleDocs.filter(d => d.owning == String(uid));
    } else {
      // 公共/组 tab：按 owning 分类（非 private 文档）
      visibleDocs = visibleDocs.filter(d => d.visibility !== 'private' && owningToTab(d) === __DOC.visFilter);
    }
  }

  // 搜索过滤（标题 or 摘要）
  const kw = keyword.trim().toLowerCase();
  const list = !kw ? visibleDocs : visibleDocs.filter(d =>
    (d.title || '').toLowerCase().includes(kw) || (d.summary || '').toLowerCase().includes(kw)
  );

  if (list.length === 0) {
    // ⚠️ 空态判据用 `total`（后端给的过滤后总数），不是 `docs.length`：
    //    分页后 `docs` 只是"已加载的页"，用长度判会与"没有更多"混淆。
    const reason = __DOC.total === 0 ? '暂无可访问的文档'
      : (kw ? `没有匹配「${escapeHtml(kw)}」的文档` : `当前「${({public:'公共',group:'组',private:'私有'})[__DOC.visFilter] || '全部'}」分类下暂无文档`);
    root.innerHTML = `<p class="doc-loading-text">${reason}</p>`;
    return;
  }

  // 扁平列表渲染（已移除分类分组）
  root.innerHTML = list.map(d => docItemHTML(d)).join('');
}
function docItemHTML(d) {
  const active = __DOC.currentSlug === d.slug ? ' is-active' : '';
  const href = `#/doc/${encodeURIComponent(d.slug)}`;
  return `<a href="${href}" class="doc-item${active}" data-slug="${escapeAttr(d.slug)}">
    <span class="doc-item__icon">${escapeHtml(d.icon || '📄')}</span>
    <span>${escapeHtml(d.title)}</span>
  </a>`;
}

// =========================================
// 5. 渲染：主页文档卡片（扁平列表，已移除分类）
// =========================================
function renderHomeCategoryGrids() {
  const lvl = __DOC.user.permissionLevel;
  const uid = __DOC.user.id;
  let visibleDocs = __DOC.docs.filter(doc =>
    (uid && doc.owning == String(uid)) || canViewByBits(doc.permission_bits, doc.visibility, lvl)
  );
  // 可见类型 tab 过滤（与侧边栏保持一致）
  if (__DOC.visFilter) {
    if (__DOC.visFilter === 'private') {
      visibleDocs = visibleDocs.filter(d => d.owning == String(uid));
    } else {
      visibleDocs = visibleDocs.filter(d => d.visibility !== 'private' && owningToTab(d) === __DOC.visFilter);
    }
  }

  const grid = document.getElementById('docHomeGrid');
  if (!grid) return;
  if (visibleDocs.length === 0) {
    grid.innerHTML = '<p class="doc-empty-tip">当前目录暂无文档。</p>';
    return;
  }
  grid.innerHTML = visibleDocs.map(d => {
    const href = `#/doc/${encodeURIComponent(d.slug)}`;
    return `<a class="feature-tile" href="${href}">
      <div class="feature-tile__img">${escapeHtml(d.icon || '📚')}</div>
      <div class="feature-tile__content">
        <div class="feature-tile__title">${escapeHtml(d.title)}</div>
        <div class="feature-tile__desc">${escapeHtml(d.summary || '')}</div>
      </div>
    </a>`;
  }).join('');
}

// =========================================
// 5.1 服务端分页：「加载更多」（2026-10-06，B1）
// =========================================
// ⚠️ 按钮**不能放进 `#docSidebarTree` / `#docHomeGrid`**：这两个容器都是
//    `innerHTML` 整体替换的（见 renderDocSidebarTree / renderHomeCategoryGrids），
//    按钮放进去会被下一次渲染冲掉。所以按钮在 `document.html` 里是它们的**兄弟节点**：
//      * `#docLoadMoreHome`（「文档列表」section 内、`#docHomeGrid` 之后）
//      * `#docLoadMoreSide`（侧栏 `#docSidebarTree` 之后）
//    两处都能点，谁可见就点谁（文档详情视图下主页那块是隐藏的）。
function renderDocLoadMore() {
  const loaded = __DOC.docs.length;
  const total = (typeof __DOC.total === 'number') ? __DOC.total : loaded;
  const pairs = [
    ['docLoadMoreHome', 'docLoadMoreHomeBtn'],
    ['docLoadMoreSide', 'docLoadMoreSideBtn']
  ];
  pairs.forEach(pair => {
    const wrap = document.getElementById(pair[0]);
    const btn = document.getElementById(pair[1]);
    if (!wrap || !btn) return;
    if (!__DOC.hasMore) {
      // 只有一页 / 已到底 / 没数据 → 整块隐藏，避免"点了没反应"
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    const info = wrap.querySelector('.doc-load-more__info');
    if (info) info.textContent = `已加载 ${loaded} / ${total} 篇`;
    btn.disabled = !!__DOC.loadingMore;
    btn.textContent = __DOC.loadingMore ? '加载中…' : '加载更多';
  });
}

async function loadMoreDocs() {
  if (__DOC.loadingMore || !__DOC.hasMore) return;
  __DOC.loadingMore = true;
  renderDocLoadMore();
  const ok = await fetchDocList({ append: true });
  __DOC.loadingMore = false;
  if (!ok) docToast('加载更多失败，请稍后重试', 'error');
  // 三处视图必须**同源重渲**（侧栏 / 主页网格 / 空态），否则条数会不一致
  const input = document.getElementById('docSearchInput');
  renderDocSidebarTree(input ? input.value : '');
  renderHomeCategoryGrids();
  updateVisEmptyPlaceholders();
  renderDocLoadMore();
}

function bindDocLoadMore() {
  ['docLoadMoreHomeBtn', 'docLoadMoreSideBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn && !btn.dataset.docLoadMoreBound) {
      btn.dataset.docLoadMoreBound = '1';
      btn.addEventListener('click', loadMoreDocs);
    }
  });
}

// =========================================
// 5.2 ⭐ 统一标签（2026-10-06，B3）
// =========================================
// 详情页展示**只读**标签；点标签 = 把列表按该标签筛选（服务端 `?tags=`，与分页/判权同一套语义）。
// 接口：`GET /api/v0/tags/document/<id>`（公开 —— 能看文档就能看它的标签）。
// ⚠️ 详情接口本身**不带** tags：不给文档序列化器加字段（避免键集漂移与 N+1），
//    所以这里单独发一个请求，失败就当没有标签（不影响阅读）。
function renderDocTagFilterBar() {
  const bar = document.getElementById('docTagFilter');
  const nameEl = document.getElementById('docTagFilterName');
  if (!bar) return;
  if (!__DOC.tagsFilter) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  if (nameEl) nameEl.textContent = __DOC.tagsFilter;
}

async function renderDocDetailTags(docId) {
  const row = document.getElementById('docTagsRow');
  if (!row || typeof docId !== 'number') return;
  row.style.display = 'none';
  row.innerHTML = '';
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/tags/document/${docId}`);
    const d = await r.json();
    if (!r.ok || d.code !== 200 || !d.data || !Array.isArray(d.data.tags) || !d.data.tags.length) return;
    row.innerHTML = '<span class="doc-tags-row__label">🏷</span>' + d.data.tags.map(t =>
      `<button type="button" class="doc-tag-chip" data-tag="${escapeAttr(t.name)}">${escapeHtml(t.name)}</button>`
    ).join('');
    row.style.display = '';
    row.querySelectorAll('.doc-tag-chip').forEach(btn => {
      btn.addEventListener('click', () => setDocTagFilter(btn.getAttribute('data-tag') || ''));
    });
  } catch (e) {
    console.warn('[tags] 标签读取失败（不影响阅读）:', e);
  }
}

async function setDocTagFilter(name) {
  const next = String(name || '').trim();
  // 再点同一个标签 = 取消筛选（与可见类型 tab「再点取消」的手感一致）
  __DOC.tagsFilter = (__DOC.tagsFilter && __DOC.tagsFilter === next) ? '' : next;
  __DOC.currentFolderId = 0;
  await applyDocFolderFilter();
  renderDocTagFilterBar();
}

function bindDocTagFilter() {
  const btn = document.getElementById('docTagFilterClearBtn');
  if (btn && !btn.dataset.docTagFilterBound) {
    btn.dataset.docTagFilterBound = '1';
    btn.addEventListener('click', async () => {
      __DOC.tagsFilter = '';
      __DOC.currentFolderId = 0;
      await applyDocFolderFilter();
      renderDocTagFilterBar();
    });
  }
  renderDocTagFilterBar();
}

// =========================================
// 6.1 ⭐ 服务端标题搜索（2026-10-06，B4）
// =========================================
// 接口：`GET /api/v0/search?q=&types=document&scope=&tags=&page=1&size=`
// ⚠️ 后端契约是**只搜标题**（文档标题 / 组织名 / 组名 / 发现条目标题）；
//    这里只取 `types=document`，与三个可见类型 tab 通过 `scope` 对齐。
// ⚠️ **本地过滤保留为降级路径**（服务端不可用时自动回退），但界面必须**明说**
//    现在是"在已加载列表里本地过滤"——否则用户会以为"结果就这么多"。
function docSearchState() {
  if (!__DOC.search) {
    __DOC.search = { active: false, kw: '', items: [], total: 0, fallback: false, truncated: false };
  }
  return __DOC.search;
}

function clearDocSearchState() {
  const st = docSearchState();
  st.active = false;
  st.kw = '';
  st.items = [];
  st.total = 0;
  st.fallback = false;
  st.truncated = false;
  if (__DOC.searchAbort) {
    try { __DOC.searchAbort.abort(); } catch (e) { /* 忽略 */ }
    __DOC.searchAbort = null;
  }
}

async function runDocSearch(keyword) {
  const kw = String(keyword || '').trim();
  if (__DOC.searchAbort) {
    // 取消上一次在途请求 —— 防竞态：慢的旧请求回来会覆盖新结果
    try { __DOC.searchAbort.abort(); } catch (e) { /* 忽略 */ }
    __DOC.searchAbort = null;
  }
  if (!kw) {
    clearDocSearchState();
    renderDocSidebarTree('');
    return;
  }

  const st = docSearchState();
  __DOC.searchAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const params = new URLSearchParams({
    q: kw, types: 'document', page: '1', size: String(__DOC.size)
  });
  if (__DOC.visFilter) params.set('scope', __DOC.visFilter);
  if (__DOC.tagsFilter) params.set('tags', __DOC.tagsFilter);

  try {
    const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const r = await fetch(`${API_BASE_URL}/api/v0/search/?${params.toString()}`, {
      headers,
      signal: __DOC.searchAbort ? __DOC.searchAbort.signal : undefined
    });
    const d = await r.json();
    if (!r.ok || d.code !== 200 || !d.data) throw new Error(d.msg || '搜索失败');
    st.active = true;
    st.kw = kw;
    st.fallback = false;
    st.items = (d.data.items || []).filter(it => it && it.type === 'document');
    st.total = (typeof d.data.total === 'number') ? d.data.total : st.items.length;
    st.truncated = !!d.data.scan_truncated;
  } catch (e) {
    if (e && e.name === 'AbortError') return;      // 主动取消：不是失败，也别动界面
    console.warn('[search] 服务端搜索不可用，降级为本地过滤:', e);
    st.active = true;
    st.kw = kw;
    st.fallback = true;                            // 界面会显示"本地过滤"提示
    st.items = [];
    st.total = 0;
    st.truncated = false;
  }
  renderDocSidebarTree(kw);
}

function renderDocSearchResults(root, st) {
  let list;
  let note;
  if (st.fallback) {
    const k = st.kw.toLowerCase();
    list = __DOC.docs.filter(d =>
      (d.title || '').toLowerCase().includes(k) || (d.summary || '').toLowerCase().includes(k));
    note = '<p class="doc-search-note doc-search-note--fallback">'
      + '服务端搜索不可用，正在<b>已加载列表</b>里本地过滤（结果可能不全）</p>';
  } else {
    list = st.items;
    const more = st.total > list.length
      ? `（匹配 ${st.total} 条，这里显示前 ${list.length} 条）` : '';
    const cut = st.truncated ? '，候选过多已截断' : '';
    note = `<p class="doc-search-note">标题搜索「${escapeHtml(st.kw)}」：${list.length} 条${more}${cut}</p>`;
  }
  if (!list.length) {
    root.innerHTML = note
      + `<p class="doc-loading-text">没有匹配「${escapeHtml(st.kw)}」的文档标题</p>`;
    return;
  }
  root.innerHTML = note + list.map(d => docItemHTML(d)).join('');
}

// =========================================
// 5.3 ⭐ 导出（2026-10-06，B5）
// =========================================
// 接口：`GET /api/v0/document/<id>/export.md?images=absolute|relative|none`
// ⚠️ 这是**下载**不是 JSON 接口 → 不能用普通 `fetch().json()`：
//    要拿 blob + 从 `Content-Disposition` 解析文件名（后端用 RFC 5987 编码中文名）。
// ⚠️ 私有/组文档需要 JWT（`<img>`/`<a>` 带不了 Authorization）→ 必须走 fetch。
async function docDownload(url, fallbackName) {
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  let r;
  try {
    r = await fetch(url, { headers });
  } catch (e) {
    throw new Error('导出失败：网络错误');
  }
  if (!r.ok) {
    let msg = (r.status === 413) ? '导出内容过大' : ('导出失败（HTTP ' + r.status + '）');
    try { const d = await r.json(); msg = d.msg || msg; } catch (e) { /* 非 JSON（可能是 Nginx 错误页） */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  let name = fallbackName || 'download';
  const cd = r.headers.get('Content-Disposition') || '';
  const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (utf8 && utf8[1]) name = decodeURIComponent(utf8[1]);
  else if (plain && plain[1]) name = plain[1];

  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(href); } catch (e) { /* 忽略 */ } }, 4000);
  return name;
}

async function exportCurrentDocMarkdown() {
  const id = __DOC.currentDocId;
  if (typeof id !== 'number') { docToast('请先打开一篇文档', 'warning'); return; }
  const btn = document.getElementById('docExportMdBtn');
  if (btn) { btn.disabled = true; btn.textContent = '导出中…'; }
  try {
    const name = await docDownload(
      `${API_BASE_URL}/api/v0/document/${id}/export.md?images=absolute`, 'document.md');
    docToast(`已导出 ${name}`, 'success');
  } catch (e) {
    docToast((e && e.message) || '导出失败', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ 导出 Markdown'; }
  }
}

function bindDocExport() {
  const btn = document.getElementById('docExportMdBtn');
  if (btn && !btn.dataset.docExportBound) {
    btn.dataset.docExportBound = '1';
    btn.addEventListener('click', exportCurrentDocMarkdown);
  }
}

// =========================================
// 6. 搜索
// =========================================
function bindDocSearch() {
  const input = document.getElementById('docSearchInput');
  if (!input) return;
  let t = null;
  input.addEventListener('input', e => {
    clearTimeout(t);
    // 250ms（原本地过滤是 150ms）：服务端搜索要一次网络往返，防抖长一点更省
    t = setTimeout(() => runDocSearch(e.target.value || ''), 250);
  });
}

// =========================================
// 6.1 可见类型 tab（公共 / 组 / 私有）
// =========================================
function bindVisTabs() {
  const wrap = document.getElementById('docVisTabs');
  if (!wrap) return;
  const tabs = wrap.querySelectorAll('.doc-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const vis = tab.getAttribute('data-vis');
      // 统一筛选状态机:切 tab 时 folder 重置为根目录,清空搜索框
      __DOC.currentFolderId = 0;
      const input = document.getElementById('docSearchInput');
      if (input) input.value = '';
      // 再次点击已激活的 tab 视为取消筛选（回到全部）
      if (__DOC.visFilter === vis) {
        __DOC.visFilter = '';
        tabs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
      } else {
        __DOC.visFilter = vis;
        tabs.forEach(t => {
          const on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
      }
      // folderId 变了,需重新拉数据 + 全量重渲染（applyDocFolderFilter 内部会调用 renderDocSidebarTree/renderHomeCategoryGrids/renderDocFolders 等）
      await applyDocFolderFilter();
    });
  });
}

/**
 * 切换 visFilter 后，主页的空态占位显隐（私有/组 空时才显示；公共/默认不显示占位因为有分类区块）
 */
function updateVisEmptyPlaceholders() {
  const lvl = __DOC.user.permissionLevel;
  const uid = __DOC.user.id;
  let visibleDocs = __DOC.docs.filter(doc =>
    (uid && doc.owning == String(uid)) || canViewByBits(doc.permission_bits, doc.visibility, lvl)
  );
  if (__DOC.visFilter === 'private') {
    visibleDocs = visibleDocs.filter(d => d.owning == String(uid));
  } else if (__DOC.visFilter) {
    visibleDocs = visibleDocs.filter(d => d.visibility !== 'private' && owningToTab(d) === __DOC.visFilter);
  }
  const has = visibleDocs.length > 0;
  const privEmpty = document.getElementById('visPrivateEmpty');
  const grpEmpty = document.getElementById('visGroupEmpty');
  if (privEmpty) privEmpty.style.display = (__DOC.visFilter === 'private' && !has) ? '' : 'none';
  if (grpEmpty)  grpEmpty.style.display  = (__DOC.visFilter === 'group'   && !has) ? '' : 'none';
}

// =========================================
// 6.2 公共文件夹（侧栏树形 + 面包屑 + 增删改）
// =========================================

/**
 * 构建文件夹树：返回 [rootLevelNodes]，每个节点扩展 children=[...]
 */
function buildDocFolderTree(flat) {
  const map = new Map(flat.map(f => [f.id, { ...f, children: [] }]));
  const roots = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortFn = (a, b) => (a.name || '').localeCompare(b.name || '');
  roots.sort(sortFn);
  for (const node of map.values()) node.children.sort(sortFn);
  return roots;
}

/**
 * 渲染单个树节点 HTML（可展开/折叠）
 */
function renderDocFolderTreeNode(node, depth = 0) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isActive = __DOC.currentFolderId === node.id;
  return `
    <div class="doc-folder-node" data-folder-id="${escapeAttr(node.id)}" style="padding-left:${10 + depth * 16}px">
      <div class="doc-folder-node__row ${isActive ? 'is-active' : ''}">
        <span class="doc-folder-node__arrow ${hasChildren ? 'is-expandable' : ''}" data-action="toggle" title="${hasChildren ? '展开/折叠' : ''}">▶</span>
        <span class="doc-folder-node__icon">📁</span>
        <span class="doc-folder-node__name">${escapeHtml(node.name)}</span>
        <span class="doc-folder-node__actions">
          ${__DOC.isAdmin ? `
            <button class="doc-folder-item__btn" data-action="rename" data-id="${escapeAttr(node.id)}" data-name="${escapeAttr(node.name)}" title="重命名">✏️</button>
            <button class="doc-folder-item__btn" data-action="delete" data-id="${escapeAttr(node.id)}" title="删除">🗑</button>
          ` : ''}
        </span>
      </div>
      <div class="doc-folder-node__children" style="display:none">
        ${hasChildren ? node.children.map(c => renderDocFolderTreeNode(c, depth + 1)).join('') : ''}
      </div>
    </div>
  `;
}

/**
 * 渲染全局面包屑（doc-main 顶部 & 详情页顶部 两处位置）
 */
async function renderDocBreadcrumb(folderId = __DOC.currentFolderId, docFolderId = null) {
  const mainWrap = document.getElementById('docMainPathBreadcrumb');
  if (mainWrap) {
    if (folderId === null || folderId === undefined || folderId === 0) {
      mainWrap.innerHTML = '';
    } else {
      mainWrap.innerHTML = `<div class="doc-path-breadcrumb"><span class="doc-loading-text">加载路径中...</span></div>`;
      mainWrap.innerHTML = await __buildDocBreadcrumbHTML(folderId);
      __bindDocBreadcrumbClicks(mainWrap);
    }
  }

  const detailWrap = document.getElementById('docDetailPathBreadcrumb');
  if (detailWrap) {
    if (!docFolderId) {
      detailWrap.innerHTML = '';
    } else {
      detailWrap.innerHTML = `<div class="doc-path-breadcrumb"><span class="doc-loading-text">加载路径中...</span></div>`;
      detailWrap.innerHTML = await __buildDocBreadcrumbHTML(docFolderId);
      __bindDocBreadcrumbClicks(detailWrap, true);
    }
  }
}

async function __buildDocBreadcrumbHTML(folderId) {
  let chain = [];
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/document/folders/${folderId}/path`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    const d = await r.json();
    if (r.ok && d.code === 200 && Array.isArray(d.data)) chain = d.data;
  } catch (e) { /* ignore */ }

  if (!chain.length) {
    const byId = new Map(__DOC.folders.map(f => [f.id, f]));
    let cur = byId.get(folderId);
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
  }

  const items = [];
  items.push(`<button class="doc-path-breadcrumb__item" data-folder-id="__all__">📋 文档中心</button>`);
  chain.forEach((f, idx) => {
    items.push(`<span class="doc-path-breadcrumb__sep">/</span>`);
    const isLast = idx === chain.length - 1;
    items.push(`<button class="doc-path-breadcrumb__item ${isLast ? 'is-active' : ''}" data-folder-id="${escapeAttr(f.id)}">${escapeHtml(f.name)}</button>`);
  });
  return `<div class="doc-path-breadcrumb">${items.join('')}</div>`;
}

function __bindDocBreadcrumbClicks(container, scrollToTop = false) {
  container.querySelectorAll('[data-folder-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fid = btn.dataset.folderId;
      if (fid === '__all__') {
        // 点「📋 文档中心」= 重置到默认状态(与 backToHomeBtn 一致)
        resetToDefaultFilter();
      } else {
        // 点具体 folder = 切到 folder 维度,清空 tab + 搜索
        resetVisFilterAndSearchUI();
        __DOC.currentFolderId = Number(fid);
      }
      const vDetail = document.getElementById('viewDetail');
      if (vDetail && vDetail.style.display !== 'none') {
        window.location.hash = '#/';
      }
      await applyDocFolderFilter();
      if (scrollToTop) window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/**
 * 切换文件夹筛选：重新拉取文档列表 + 刷新面包屑 + 空态
 * 注:内部读取搜索框当前值传给 renderDocSidebarTree,保证搜索关键字不丢失
 */
async function applyDocFolderFilter() {
  // ⭐ 这里**必须**走替换分支（fetchDocList 默认 append=false）→ 重置到第 1 页。
  //    切 tab / 点文件夹 / 面包屑 / 返回首页全部经由本函数。
  await fetchDocList();
  await fetchDocFolders();
  const input = document.getElementById('docSearchInput');
  const kw = input ? input.value : '';
  // ⭐ B4：输入框被清空（切 tab / 复位筛选都会清）→ 退出搜索模式，回到正常列表
  if (!kw) clearDocSearchState();
  renderDocSidebarTree(kw);
  renderHomeCategoryGrids();
  renderDocFolders();
  updateVisEmptyPlaceholders();
  renderDocLoadMore();
  renderDocTagFilterBar();
  renderDocBreadcrumb();
}

/**
 * 渲染侧栏文件夹（树形，替代原 chip 结构）
 */
function renderDocFolders() {
  const section = document.getElementById('docFoldersSection');
  const list = document.getElementById('docFoldersList');
  if (!section || !list) return;

  // 按 visFilter 过滤文件夹（使用 scope 字段）：
  //   - public tab  : scope==='public'
  //   - group tab   : scope==='group'（后端已按用户所属组过滤）
  //   - private tab : scope==='private' && user_id === 当前用户
  //   - 无筛选（''）：显示全部可见
  const uid = __DOC.user.id;
  let filteredFolders = __DOC.folders;
  if (__DOC.visFilter === 'public') {
    filteredFolders = __DOC.folders.filter(f => f.scope === 'public');
  } else if (__DOC.visFilter === 'group') {
    filteredFolders = __DOC.folders.filter(f => f.scope === 'group');
  } else if (__DOC.visFilter === 'private') {
    filteredFolders = __DOC.folders.filter(f => f.scope === 'private' && uid && f.user_id === uid);
  }

  if (filteredFolders.length === 0 && !__DOC.isAdmin) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  let html = `
    <div class="doc-folder-quick">
      <div class="doc-folder-node__row ${__DOC.currentFolderId === 0 ? 'is-active' : ''}" data-folder-id="__all__" style="padding-left:10px">
        <span class="doc-folder-node__arrow"></span>
        <span class="doc-folder-node__icon">🏠</span>
        <span class="doc-folder-node__name">根目录</span>
        <span class="doc-folder-node__actions"></span>
      </div>
    </div>
  `;

  if (filteredFolders.length === 0) {
    list.innerHTML = html;
    bindDocFolderActions();
    return;
  }

  const roots = buildDocFolderTree(filteredFolders);
  html += roots.map(r => renderDocFolderTreeNode(r, 0)).join('');
  list.innerHTML = html;
  bindDocFolderActions();
}

/**
 * 统一筛选状态机辅助:清空 visFilter + 搜索框,并把 tab UI 全部去激活。
 * 用于"切换到文件夹筛选维度"时,把 tab 维度重置干净。
 */
function resetVisFilterAndSearchUI() {
  __DOC.visFilter = '';
  const input = document.getElementById('docSearchInput');
  if (input) input.value = '';
  const tabs = document.querySelectorAll('#docVisTabs .doc-tab');
  tabs.forEach(t => {
    t.classList.remove('is-active');
    t.setAttribute('aria-selected', 'false');
  });
}

/**
 * 统一筛选状态机辅助:重置到默认状态(visFilter=public, folderId=null, 搜索框空,「公共」tab 激活)。
 * 用于「文档中心首页」类入口(backToHomeBtn / 面包屑「文档中心」)。
 */
function resetToDefaultFilter() {
  __DOC.currentFolderId = 0;
  __DOC.visFilter = 'public';
  const input = document.getElementById('docSearchInput');
  if (input) input.value = '';
  const tabs = document.querySelectorAll('#docVisTabs .doc-tab');
  tabs.forEach(t => {
    const on = t.getAttribute('data-vis') === 'public';
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
}

/**
 * 绑定文件夹区段的点击事件（树形版）
 */
function bindDocFolderActions() {
  const list = document.getElementById('docFoldersList');
  if (!list) return;

  list.querySelectorAll('[data-folder-id="__all__"]').forEach(row => {
    row.addEventListener('click', async () => {
      if (__DOC.currentFolderId === 0) return;
      // 点「根目录」(folderId=0) = 仅查看根目录下的文件,保留 visFilter + 搜索
      __DOC.currentFolderId = 0;
      await applyDocFolderFilter();
    });
  });

  list.querySelectorAll('.doc-folder-node > .doc-folder-node__row').forEach(row => {
    row.addEventListener('click', async (e) => {
      if (e.target.closest('.doc-folder-item__btn')) return;
      if (e.target.closest('[data-action="toggle"]')) return;
      const node = row.closest('.doc-folder-node');
      if (!node) return;
      const fid = Number(node.dataset.folderId);
      if (fid === __DOC.currentFolderId) return;
      // 统一筛选状态机:folder 与 tab 互斥,切 folder 时清空 visFilter + 搜索框
      resetVisFilterAndSearchUI();
      __DOC.currentFolderId = fid;
      await applyDocFolderFilter();
    });
  });

  list.querySelectorAll('[data-action="toggle"]').forEach(arrow => {
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      const node = arrow.closest('.doc-folder-node');
      if (!node) return;
      const childrenEl = node.querySelector(':scope > .doc-folder-node__children');
      if (!childrenEl) return;
      const expanded = arrow.classList.contains('is-expanded');
      if (expanded) {
        childrenEl.style.display = 'none';
        arrow.classList.remove('is-expanded');
      } else {
        childrenEl.style.display = '';
        arrow.classList.add('is-expanded');
      }
    });
  });

  list.querySelectorAll('.doc-folder-item__btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const id = Number(btn.getAttribute('data-id'));
      const name = btn.getAttribute('data-name') || '';
      if (action === 'rename') renameDocFolder(id, name);
      else if (action === 'delete') deleteDocFolder(id);
    });
  });
}

/**
 * 重命名公共文件夹（仅管理员）
 */
async function renameDocFolder(id, oldName) {
  if (!__DOC.isAdmin) {
    docToast('仅等级≥5 的管理员可重命名公共文件夹', 'warning');
    return;
  }
  const name = await Modal.prompt('请输入新的文件夹名称：', oldName || '', { title: '重命名文件夹' });
  if (name === null || !name.trim() || name.trim() === oldName) return;
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    docToast('请先登录', 'warning');
    return;
  }
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/document/folders/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name: name.trim() })
    });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      await fetchDocFolders();
      renderDocFolders();
    } else {
      console.error('[folder] 重命名失败:', d.msg);
      docToast('重命名失败：' + (d.msg || '未知错误'), 'error');
    }
  } catch (e) {
    console.error('[folder] 重命名网络错误:', e);
    docToast('重命名失败：网络错误', 'error');
  }
}

/**
 * 删除公共文件夹（仅管理员）
 * 删除后文件夹内的文档将变为根目录（未归类）。
 */
async function deleteDocFolder(id) {
  if (!__DOC.isAdmin) {
    docToast('仅等级≥5 的管理员可删除公共文件夹', 'warning');
    return;
  }
  const ok = await Modal.confirm('删除文件夹后，文件夹内的文档将移至根目录，确认删除？', { title: '删除文件夹' });
  if (!ok) return;
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    docToast('请先登录', 'warning');
    return;
  }
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/document/folders/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      // 如果当前正在查看被删除的文件夹，重置为根目录
      if (__DOC.currentFolderId === id) {
        __DOC.currentFolderId = 0;
      }
      await fetchDocFolders();
      await applyDocFolderFilter();
    } else {
      console.error('[folder] 删除失败:', d.msg);
      docToast('删除失败：' + (d.msg || '未知错误'), 'error');
    }
  } catch (e) {
    console.error('[folder] 删除网络错误:', e);
    docToast('删除失败：网络错误', 'error');
  }
}

// =========================================
// 7. Hash 路由
// =========================================
function applyQueryRouteOrHash() {
  // 优先：?slug=<slug> 直达文档（并同步为 hash，便于刷新/分享）
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  if (slug) {
    const target = '#/doc/' + encodeURIComponent(slug);
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target);
    }
    routeByHash();
    return;
  }
  // 其次：?id=<docId>（需登录，通过 id 取 slug 后跳转）
  const id = params.get('id');
  if (id) {
    const token = (window.AuthGuard && window.AuthGuard.getToken) ? window.AuthGuard.getToken() : null;
    if (token) {
      fetch(`${API_BASE_URL}/api/v0/document/${encodeURIComponent(id)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(d => {
          if (d.code === 200 && d.data && d.data.slug) {
            const target = '#/doc/' + encodeURIComponent(d.data.slug);
            window.history.replaceState(null, '', target);
          }
          routeByHash();
        })
        .catch(() => routeByHash());
      return;
    }
    routeByHash();
    return;
  }
  routeByHash();
}

function routeByHash() {
  const hash = window.location.hash || '';
  // 详情：#/doc/<slug>
  const m = hash.match(/^#\/doc\/([^/?#]+)/);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    showDocDetail(slug);
    return;
  }
  // 其他（#/ 或 空）都展示主页
  showDocHome();
}

function showDocHome() {
  __DOC.currentSlug = null;
  const vHome = document.getElementById('viewHome');
  const vDetail = document.getElementById('viewDetail');
  if (vHome) vHome.style.display = '';
  if (vDetail) vDetail.style.display = 'none';
  // 同步 active
  document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('is-active'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function showDocDetail(slug) {
  __DOC.currentSlug = slug;
  const vHome = document.getElementById('viewHome');
  const vDetail = document.getElementById('viewDetail');
  if (vHome) vHome.style.display = 'none';
  if (vDetail) vDetail.style.display = '';

  // 重置状态
  hideDocStates();
  const $title = document.getElementById('docTitle');
  const $meta = document.getElementById('docMeta');
  const $content = document.getElementById('docContent');
  const $revs = document.getElementById('docRevisions');
  if ($title) $title.textContent = '加载中...';
  if ($meta) $meta.innerHTML = '<span class="doc-loading-text">加载元信息中...</span>';
  if ($content) $content.innerHTML = '<p class="doc-loading-text">正在加载文档正文...</p>';
  if ($revs) $revs.style.display = 'none';

  // 详情 + 修订历史 并发
  try {
    const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const detailRsp = await fetch(`${API_BASE_URL}/api/v0/document/${encodeURIComponent(slug)}`, { headers });
    const d = await detailRsp.json();

    if (detailRsp.status === 404 || (d.code === 404)) {
      showDocState404();
      return;
    }
    if (detailRsp.status === 403 || d.code === 403) {
      showDocState403();
      return;
    }
    if (!detailRsp.ok || d.code !== 200) {
      throw new Error(d.msg || '详情请求失败');
    }

    const doc = d.data;
    renderDocDetailView(doc);
    // ⭐ B3：标签单独一个请求（详情接口不带 tags，避免给列表/详情序列化器加字段）
    renderDocDetailTags(doc.id);

    // 侧边栏 active 同步
    document.querySelectorAll('.doc-item').forEach(el => {
      el.classList.toggle('is-active', el.getAttribute('data-slug') === doc.slug);
    });

    // 并发请求修订历史
    fetchAndRenderRevisions(doc.id).catch(err => console.warn('[revisions] 加载失败:', err));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error('[detail] 错误:', e);
    if ($content) $content.innerHTML = `<p class="doc-loading-text">加载文档失败：${escapeHtml(e.message || '未知错误')}。请刷新重试。</p>`;
  }
}

// =========================================
// 8. 详情渲染（元信息 + Markdown 正文）
// =========================================

/**
 * ⭐ C3（2026-10-11）：把「作者名」补成指向公开主页的链接。
 *
 * 站内各处手里只有 `author_id`（详情接口不带 slug），所以先问 `by-id` 要 slug：
 *   * `200` 且 `user.slug` 有值 → 替换成 `<a href="./u.html?u=<slug>">`；
 *   * `404`（作者**没有开启公开主页**）→ **保持纯文本**（不显示死链、不报错）。
 *
 * ⚠️ 按 `author_id` 缓存（`__authorProfileSlugCache`）：同一页渲染多篇时只发一次请求；
 *    查过的 id 哪怕是 `null` 也记下来，避免反复 404。
 * ⚠️ 匿名也可访问该接口（后端 `optional=True`），所以这里不带 token 也成立。
 */
var __authorProfileSlugCache = Object.create(null);

function linkAuthorName(el, authorId) {
  if (!el || authorId === null || authorId === undefined) return;
  var key = String(authorId);
  var apply = function (slug) {
    if (!slug) return;
    // 元素可能已被后续渲染替换掉 —— 必须重新确认它还在文档里
    if (!el.isConnected) return;
    var text = el.textContent || '';
    var a = document.createElement('a');
    a.href = './u.html?u=' + encodeURIComponent(slug);
    a.title = '查看 ' + text + ' 的公开主页';
    a.textContent = text;
    el.textContent = '';
    el.appendChild(a);
  };
  if (key in __authorProfileSlugCache) {
    apply(__authorProfileSlugCache[key]);
    return;
  }
  __authorProfileSlugCache[key] = null;      // 占位：并发渲染时只发一次
  fetch(API_BASE_URL + '/api/v0/user/profile/by-id/' + encodeURIComponent(key))
    .then(function (r) { return r.json().catch(function () { return null; }); })
    .then(function (d) {
      var slug = (d && d.code === 200 && d.data && d.data.user) ? d.data.user.slug : null;
      __authorProfileSlugCache[key] = slug || null;
      apply(slug);
    })
    .catch(function () { /* 网络失败：保持纯文本，不打扰用户 */ });
}

function renderDocDetailView(doc) {
  // 详情页专属面包屑（按文档所属文件夹渲染）
  renderDocBreadcrumb(null, doc.folder_id || doc.folderId || null);

  const $title = document.getElementById('docTitle');
  const $meta = document.getElementById('docMeta');
  const $content = document.getElementById('docContent');
  if ($title) $title.textContent = doc.title || '（无标题）';
  // ⭐ B5：记下当前文档 id（导出单篇 Markdown 要用；id 可能是 0，所以用存在性判断）
  __DOC.currentDocId = (typeof doc.id === 'number') ? doc.id : null;

  // 组根目录只读警示横幅：slug=group-readme 或 is_readonly=true 或 (visibility=group && folder_id 为空)
  const isGroupRoot = doc.slug === 'group-readme' || doc.is_readonly === true ||
                      (doc.visibility === 'group' && (doc.folder_id === null || doc.folder_id === undefined));
  const $banner = document.getElementById('docGroupReadmeBanner');
  if ($banner) $banner.style.display = isGroupRoot ? '' : 'none';

  // --- 元信息条 ---
  const lvl = __DOC.user.permissionLevel;
  const uid = __DOC.user.id;
  const isAdminView = lvl && lvl >= 5;

  const pills = [];
  // 1. 可见性徽章 + 归属 pill
  const isPublic = doc.visibility === 'public';
  const isGroup = doc.visibility === 'group';
  const isPrivate = doc.visibility === 'private';
  const __bits = doc.permission_bits || '000000';

  let visText, visClass = '';
  if (isPublic) {
    const visitorCanView = __bits[0] === '1';
    visText = visitorCanView ? '🌐 公开（访客可见）' : '🌐 公开（需登录）';
    visClass = 'is-public';
  } else if (isGroup) {
    visText = '👥 组文档';
    visClass = 'is-group';
  } else {
    visText = '🔒 私密';
    visClass = 'is-private';
  }
  pills.push(`<span class="meta-pill doc-visibility-badge ${visClass}">
    <span>${visText}</span>
  </span>`);

  // 1.1 紫色 🔒 ownership pill：私有文档且当前用户为拥有者
  if (isPrivate && uid && doc.owning == String(uid)) {
    pills.push(`<span class="meta-pill doc-ownership-pill" title="您是此文档的拥有者">🔒 我的私有文档</span>`);
  }
  // 1.2 组名 pill（组文档显示所属组名）
  if (isGroup && doc.owning && doc.owning !== '0') {
    pills.push(`<span class="meta-pill doc-group-pill" title="所属组">👥 组：${escapeHtml(doc.owning)}</span>`);
  }
  // 1.3 只读 pill（组根目录文件）
  if (isGroupRoot) {
    pills.push(`<span class="meta-pill doc-readonly-pill" title="此文件不可编辑">🚫 只读</span>`);
  }

  // 2. 权限展示
  //    - 公开文档：展示完整权限矩阵（含访客行）
  //    - 组文档：仅显示组成员可见提示
  //    - 私有文档：仅显示作者可见提示
  if (isPublic) {
    const __userLevel = lvl || 0; // null/undefined=匿名 => 0
    const __maxRow = Math.max(0, __userLevel - 1);
    const showRows = [];
    for (let row = 0; row <= __maxRow; row++) {
      let allow = false;
      let force = false;
      if (row === 0) {
        // 访客行：公开且 bit[0]=='1'
        allow = __bits[0] === '1';
      } else if (row === 5) {
        // superadmin 行：强制允许
        allow = true;
        force = true;
      } else {
        allow = __bits[row] === '1';
      }
      const mc = allow ? 'is-yes' : 'is-no';
      const mt = allow ? '✅ 可见' : '❌ 不可见';
      const forceClass = force ? ' is-force' : '';
      const label = row === 0 ? '访客' : `等级 ${row}`;
      showRows.push(`<div class="doc-perm-grid__row${forceClass}">
        <div class="doc-perm-grid__label">${label}</div>
        <div class="doc-perm-grid__role">${DOC_LEVEL_ROLES[row] || ''}</div>
        <div class="doc-perm-grid__mark ${mc}">${mt}</div>
      </div>`);
    }
    pills.push(`<div class="doc-perm-grid">${showRows.join('')}</div>`);
  } else if (isGroup) {
    // 组文档：仅显示组成员可见提示（不暴露权限矩阵）
    pills.push(`<span class="meta-pill doc-perm-summary">
      👥 组文档 · 仅组成员可见
    </span>`);
  } else {
    // 私有文档：仅显示作者可见提示（不暴露权限矩阵）
    pills.push(`<span class="meta-pill doc-perm-summary">
      🔒 私有文档 · 仅作者本人可见
    </span>`);
  }

  // 3. 作者 + 归属（owning：'0'=公有 / 纯数字=用户ID / 非数字=组名）
  const author = doc.author_username || (__DOC.user && doc.author_id === null ? '系统' : (doc.author_id ? 'ID ' + doc.author_id : '系统'));
  const __ov = doc.owning;
  let __ovText = '';
  if (__ov && __ov !== '0') {
    __ovText = /^\d+$/.test(__ov) ? ` · 归属用户 ID ${escapeHtml(__ov)}` : ` · 归属组 ${escapeHtml(__ov)}`;
  }
  pills.push(`<span class="meta-pill">👤 <strong><span data-author-name="1">${escapeHtml(author)}</span></strong>${__ovText}</span>`);
  // 4. 创作时间
  pills.push(`<span class="meta-pill">📅 创建 <strong>${escapeHtml(fmtTime(doc.created_at))}</strong></span>`);
  // 5. 最新修改时间（Document.updated_at 冗余展示）
  pills.push(`<span class="meta-pill">✏️ 修改 <strong>${escapeHtml(fmtTime(doc.updated_at || doc.created_at))}</strong></span>`);
  // 6. 浏览量
  pills.push(`<span class="meta-pill">👁 <strong>${escapeHtml(String(doc.view_count == null ? 0 : doc.view_count))}</strong> 次阅读</span>`);
  // 7. 内容权限规则入口（作者 / 超管）
  const isDocOwner = uid && doc.author_id == uid;
  if (isDocOwner || __DOC.isAdmin) {
    pills.push(`<button class="meta-pill doc-rules-toggle" id="docRulesToggle" title="编辑内容权限规则" style="cursor:pointer">🔐 权限规则</button>`);
  }

  if ($meta) $meta.innerHTML = pills.join('');

  // ⭐ C3（2026-10-11）：作者名 → 公开主页链接（`u.html?u=<slug>`）。
  //    为什么要「先渲染纯文本、再异步替换」：`by-id` 接口是异步的，而这一整块是同步拼 HTML 的。
  //    ⚠️ 按 `author_id` 缓存 + 只发一次；**404（作者没开主页）就永远保持纯文本**，不显示死链。
  if ($meta && doc.author_id !== null && doc.author_id !== undefined) {
    linkAuthorName($meta.querySelector('[data-author-name]'), doc.author_id);
  }

  // 绑定权限规则面板开关
  const rulesToggle = document.getElementById('docRulesToggle');
  if (rulesToggle) rulesToggle.addEventListener('click', () => toggleDocRules(doc));

  // --- Markdown 正文 ---
  if ($content) {
    const raw = doc.content || '';
    ensureMarkedLoaded()
      .then(ok => {
        if (ok) {
          // marked 输出经白名单净化后再写入（sanitize.js 缺失时降级为纯文本）
          $content.innerHTML = renderMarkdownSafe(raw);
        } else {
          $content.innerHTML = `<p class="doc-loading-text" style="background:var(--color-bg-section-alt);padding:12px;border-radius:8px;">
            ⚠️ Markdown 渲染器加载失败，下方为原始文本：
          </p><pre>${escapeHtml(raw || '')}</pre>`;
        }
      });
  }
}

// =========================================
// 9. marked.js CDN 动态加载
// =========================================
function ensureMarkedLoaded() {
  if (__DOC.markedReady) return Promise.resolve(true);
  if (window.marked && typeof window.marked.parse === 'function') {
    __DOC.markedReady = true;
    return Promise.resolve(true);
  }
  if (__DOC.markedLoading) {
    // 正在加载，轮询
    return new Promise(resolve => {
      let ticks = 0;
      const t = setInterval(() => {
        ticks++;
        if (window.marked && typeof window.marked.parse === 'function') {
          __DOC.markedReady = true; __DOC.markedLoading = false; clearInterval(t); resolve(true);
        } else if (ticks > 50) {
          clearInterval(t); resolve(false);
        }
      }, 120);
    });
  }
  __DOC.markedLoading = true;
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => { __DOC.markedReady = true; __DOC.markedLoading = false; resolve(true); };
    s.onerror = () => { __DOC.markedLoading = false; resolve(false); };
    document.head.appendChild(s);
  });
}

/**
 * 渲染 Markdown 为「可直接写入 innerHTML」的安全 HTML
 * - marked 解析后必须经 sanitize.js 白名单净化（文档正文属于不可信内容，防存储型 XSS）
 * - sanitize.js 尚未加载（HTML 引入顺序未就绪）时降级为转义纯文本，绝不注入原始 HTML
 * @param {string} raw Markdown 原文
 * @returns {string} 安全 HTML
 */
function renderMarkdownSafe(raw) {
  const text = (raw === null || raw === undefined) ? '' : String(raw);
  const fallback = `<pre>${escapeHtml(text || '（空文档）')}</pre>`;
  if (!window.marked || typeof window.marked.parse !== 'function') return fallback;
  let html;
  try {
    html = window.marked.parse(text || '（空文档）');
  } catch (err) {
    console.warn('[marked] 解析失败，降级:', err);
    return fallback;
  }
  if (typeof window.sanitizeHtml !== 'function') {
    console.warn('[document.js] sanitize.js 未加载，Markdown 降级为纯文本');
    return fallback;
  }
  return window.sanitizeHtml(html);
}

// =========================================
// 10. 修订历史
// =========================================
async function fetchAndRenderRevisions(docId) {
  const $wrap = document.getElementById('docRevisions');
  const $list = document.getElementById('docRevisionTimeline');
  const $count = document.getElementById('docRevCount');
  if (!$wrap) return;

  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  const r = await fetch(`${API_BASE_URL}/api/v0/document/${docId}/revisions`, { headers });
  const d = await r.json();
  if (!r.ok || d.code !== 200) {
    $wrap.style.display = 'none';
    return;
  }
  __DOC.revisions = d.data || [];
  if (__DOC.revisions.length === 0) { $wrap.style.display = 'none'; return; }
  $wrap.style.display = '';
  if ($count) $count.textContent = String(__DOC.revisions.length);
  if ($list) {
    // ⭐ C1（2026-10-11）：每条加「查看」按钮 —— 在此之前修订历史**只看得到元数据**，
    //    正文永远取不回（`DocumentRevision.to_dict()` 刻意不含快照）。
    //    `has_content === false` 的是种子/历史数据（快照是 NULL），置灰并说明。
    $list.innerHTML = __DOC.revisions.map(rev => `<li class="doc-rev__item">
      <div class="doc-rev__head">
        <span class="doc-rev__badge">${escapeHtml(rev.revision_num)}</span>
        <span class="doc-rev__time">⏱ ${escapeHtml(fmtTime(rev.created_at))}</span>
        <span class="doc-rev__editor">👤 ${escapeHtml(rev.editor_username || '系统')}</span>
        ${rev.has_content === false
          ? '<span class="doc-rev__noContent" title="该修订没有保存正文快照（历史数据）">无正文</span>'
          : `<button type="button" class="doc-rev__view" data-rev="${escapeAttr(rev.revision_num)}">查看</button>`}
      </div>
      ${rev.summary ? `<p class="doc-rev__summary">📝 ${escapeHtml(rev.summary)}</p>` : ''}
    </li>`).join('');
    // 事件委托只绑一次（列表每次都是整体替换 innerHTML）
    if (!$list.dataset.revBound) {
      $list.dataset.revBound = '1';
      $list.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-rev]') : null;
        if (!btn) return;
        openRevisionModal(btn.dataset.rev);
      });
    }
  }
}

// =========================================
// 10.1 修订查看 / 恢复（C1 编辑锁，2026-10-11）
//
// 后端：
//   GET  /api/v0/document/<id>/revisions/<rev>   取某一版全文（能看就能取）
//   POST /api/v0/document/<id>/revisions/<rev>   恢复到这一版（能改才能恢复；可逆）
// ⚠️ 本页**不加载** js/utils.js / js/modal.js → 弹层用本页自己的 DOM + docToast。
// =========================================

//: 当前弹层里展示的修订（恢复时要拿它的 revision_num / content / current_version）
__DOC.revisionView = null;

function _revModalEls() {
  return {
    modal: document.getElementById('docRevModal'),
    title: document.getElementById('docRevModalTitle'),
    meta: document.getElementById('docRevModalMeta'),
    body: document.getElementById('docRevModalBody'),
    restore: document.getElementById('docRevRestoreBtn'),
  };
}

function closeRevisionModal() {
  const { modal } = _revModalEls();
  __DOC.revisionView = null;
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

async function openRevisionModal(revNum) {
  const els = _revModalEls();
  if (!els.modal) return;
  const docId = __DOC.currentDocId;
  if (typeof docId !== 'number') { docToast('无法确定文档 id，请刷新页面后重试'); return; }

  els.modal.style.display = '';
  document.body.style.overflow = 'hidden';
  els.title.textContent = `修订 #${revNum}`;
  els.meta.textContent = '加载中...';
  els.body.innerHTML = '<p class="doc-revmodal__loading">加载中...</p>';
  if (els.restore) els.restore.style.display = 'none';

  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  let d = null;
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/document/${docId}/revisions/${encodeURIComponent(revNum)}`, { headers });
    d = await r.json();
  } catch (e) {
    console.warn('[revisions] 取修订失败:', e);
  }
  if (!d || d.code !== 200) {
    els.meta.textContent = '';
    els.body.innerHTML = `<p class="doc-revmodal__error">${escapeHtml((d && d.msg) || '读取该修订失败')}</p>`;
    return;
  }

  __DOC.revisionView = {
    revision_num: d.data.revision_num,
    content: d.data.content || '',
    current_version: (typeof d.data.current_version === 'number') ? d.data.current_version : null,
  };
  els.title.textContent = `修订 #${d.data.revision_num}`;
  els.meta.textContent = `⏱ ${fmtTime(d.data.created_at)} · 👤 ${d.data.editor_username || '系统'}`
    + (d.data.summary ? ` · 📝 ${d.data.summary}` : '')
    + ` · 当前版本 ${d.data.current_version}`;
  els.body.innerHTML = `<div class="doc-revmodal__content doc-markdown">${renderMarkdownSafe(d.data.content)}</div>`;
  if (els.restore) {
    els.restore.style.display = d.data.can_restore ? '' : 'none';
  }
}

async function restoreViewedRevision() {
  const view = __DOC.revisionView;
  const docId = __DOC.currentDocId;
  if (!view || typeof docId !== 'number') return;
  // ⚠️ 这里用原生 confirm 是**刻意的**：本页（`document.html`）不加载 `js/utils.js`
  //    也**不加载** `js/modal.js`（`window.Modal` 不存在）—— 与 `docToast()` 的取舍同源。
  if (!window.confirm(`确认把正文恢复到修订 #${view.revision_num} 吗？\n\n当前正文会先被存成一条新修订，所以这个操作可以再恢复回来。`)) return;

  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) { docToast('请先登录', 'warning'); return; }
  const body = {};
  // ⭐ C1 乐观锁：带上当前版本号；不一致后端会回 409（不会静默覆盖别人）
  if (typeof view.current_version === 'number') body.version = view.current_version;

  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/document/${docId}/revisions/${encodeURIComponent(view.revision_num)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d || d.code !== 200) {
      docToast((d && d.msg) || '恢复失败', 'error');
      return;
    }
    docToast(d.msg || '已恢复', 'success');
    closeRevisionModal();
    // 重新拉详情 + 修订列表。⚠️ 不能只调 `routeByHash()`：hash 没变，浏览器不会触发
    // `hashchange`，什么都没发生。直接按当前 slug 重跑详情流程。
    if (__DOC.currentSlug) {
      showDocDetail(__DOC.currentSlug).catch(err => console.warn('[revisions] 刷新失败:', err));
    }
  } catch (e) {
    console.warn('[revisions] 恢复失败:', e);
    docToast('恢复失败：网络错误', 'error');
  }
}

function bindRevisionModal() {
  const { modal, body } = _revModalEls();
  if (!modal || modal.dataset.revModalBound) return;
  modal.dataset.revModalBound = '1';
  let raw = false;
  const original = () => (__DOC.revisionView ? __DOC.revisionView.content : '');
  modal.addEventListener('click', (e) => {
    const hit = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'rev-close') { closeRevisionModal(); return; }
    if (act === 'rev-raw') {
      raw = !raw;
      const html = raw
        ? `<pre class="doc-revmodal__raw">${escapeHtml(original())}</pre>`
        : `<div class="doc-revmodal__content doc-markdown">${renderMarkdownSafe(original())}</div>`;
      if (body) body.innerHTML = html;
      hit.textContent = raw ? '查看渲染' : '查看原文';
      return;
    }
    if (act === 'rev-restore') { restoreViewedRevision(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRevisionModal();
  });
}

function bindRevisionsToggle() {
  const btn = document.getElementById('docRevisionsToggle');
  const list = document.getElementById('docRevisionTimeline');
  const wrap = document.getElementById('docRevisions');
  if (!btn || !list || !wrap) return;
  btn.addEventListener('click', () => {
    const open = wrap.classList.toggle('is-open');
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
}

// =========================================
// 10.5 内容权限规则（作者 / 超管）
// =========================================
async function toggleDocRules(doc) {
  const panel = document.getElementById('docRulesPanel');
  if (!panel) return;
  if (panel.style.display !== 'none' && panel.style.display !== '') {
    panel.style.display = 'none';
    return;
  }
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    docToast('请先登录', 'warning');
    return;
  }
  __DOC._rulesDocId = doc.id;
  panel.style.display = '';
  const input = document.getElementById('docRulesInput');
  input.value = '加载中...';
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/document/${doc.id}/permissions`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    if (d.code === 200) {
      input.value = (d.data || []).map(x => `${x.target}.${x.level}.${x.category}.${x.action}.${x.state}`).join('\n');
    } else {
      input.value = '';
      docToast('加载规则失败：' + (d.msg || '未知错误'), 'error');
    }
  } catch (e) {
    input.value = '';
    docToast('加载规则失败：网络错误', 'error');
  }
}

async function saveDocRules() {
  const id = __DOC._rulesDocId;
  if (!id) return;
  const input = document.getElementById('docRulesInput');
  const lines = (input.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    docToast('请先登录', 'warning');
    return;
  }
  try {
    const r = await fetch(`${API_BASE_URL}/api/v0/document/${id}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ rules: lines })
    });
    const d = await r.json();
    if (d.code === 200) {
      docToast('已保存 ' + ((d.data && d.data.saved) || 0) + ' 条规则', 'success');
    } else {
      docToast('保存失败：' + (d.msg || '未知错误'), 'error');
    }
  } catch (e) {
    docToast('保存失败：网络错误', 'error');
  }
}

function initDocRulesPanel() {
  const saveBtn = document.getElementById('docRulesSave');
  const cancelBtn = document.getElementById('docRulesCancel');
  if (saveBtn) saveBtn.addEventListener('click', saveDocRules);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const panel = document.getElementById('docRulesPanel');
      if (panel) panel.style.display = 'none';
    });
  }
}
document.addEventListener('DOMContentLoaded', initDocRulesPanel);

// =========================================
// 11. 错误态（404 / 403）
// =========================================
function hideDocStates() {
  ['docState404', 'docState403'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const $title = document.getElementById('docTitle');
  const $meta = document.getElementById('docMeta');
  const $content = document.getElementById('docContent');
  const $revs = document.getElementById('docRevisions');
  if ($title) $title.style.display = '';
  if ($meta) $meta.style.display = '';
  if ($content) $content.style.display = '';
  if ($revs) $revs.style.display = 'none';
  // 重置警示横幅（由 renderDocDetailView 重新决定显隐）
  const $banner = document.getElementById('docGroupReadmeBanner');
  if ($banner) $banner.style.display = 'none';
}

function showDocState404() {
  hideDocStates();
  const $title = document.getElementById('docTitle');
  const $meta = document.getElementById('docMeta');
  const $content = document.getElementById('docContent');
  if ($title) $title.style.display = 'none';
  if ($meta) $meta.style.display = 'none';
  if ($content) $content.style.display = 'none';
  const s = document.getElementById('docState404'); if (s) s.style.display = '';
}

function showDocState403() {
  hideDocStates();
  const $title = document.getElementById('docTitle');
  const $meta = document.getElementById('docMeta');
  const $content = document.getElementById('docContent');
  if ($title) $title.style.display = 'none';
  if ($meta) $meta.style.display = 'none';
  if ($content) $content.style.display = 'none';
  const s = document.getElementById('docState403');
  const desc = document.getElementById('docState403Desc');
  const loginBtn = document.getElementById('docStateLoginBtn');
  if (s) s.style.display = '';
  if (__DOC.user.isLoggedIn) {
    if (desc) desc.textContent = `您的等级为 ${__DOC.user.permissionLevel || 1}，该文档需要更高等级才能查看。如需查看请联系超级管理员。`;
    if (loginBtn) loginBtn.style.display = 'none';
  } else {
    if (desc) desc.textContent = '该文档未对访客开放，您需要登录后再试。';
    if (loginBtn) loginBtn.style.display = '';
  }
}

// =========================================
// 工具
// =========================================

/**
 * 页面内提示：优先复用本页已加载的 Toast（js/toast.js 暴露 window.Toast）。
 * document.html 不加载 utils.js，因此不能依赖 window.showToast；
 * 只有在 Toast 完全不可用时才退回原生 alert，保证提示不丢失。
 */
function docToast(msg, type) {
  if (window.Toast && typeof window.Toast.show === 'function') {
    window.Toast.show(msg, type || 'error');
    return;
  }
  if (typeof showToast === 'function') {
    showToast(msg, type);
    return;
  }
  try { alert(msg); } catch (e) { console.warn('[docToast]', msg); }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
function escapeAttr(str) { return escapeHtml(str); }

function fmtTime(iso) {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  } catch { return String(iso); }
}
