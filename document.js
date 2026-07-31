/**
 * document.js
 * 文档系统前端逻辑：hash 路由、权限辅助、Markdown 渲染、目录树与修订历史
 */

// 内部缓存：分类/文档/当前用户信息（供多视图复用）
const __DOC = {
  
  docs: [],                // [{id, title, slug, permission_bits, visibility, owning, ...}]
  user: {
    isLoggedIn: false,
    permissionLevel: null, // null/undefined = 匿名
    username: '',
    group: 'default'
  },
  currentSlug: null,       // 当前详情页 slug（用于 active 高亮）
  revisions: [],           // 当前文档修订缓存
  markedReady: false,      // marked.js 是否已加载
  markedLoading: false,    // marked.js 是否正在加载中（防止并发脚本注入）
  visFilter: 'public',     // 侧栏可见类型筛选：public / group / private
  folders: [],              // 文件夹列表：匿名时仅公共文件夹；登录时=个人(personal)+公共(public)合并
  currentFolderId: null,    // null=不过滤；0=根目录；正整数=该文件夹
  isAdmin: false            // 等级≥5 才为 true
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
      renderDocRootList();
      bindDocSearch();
      bindVisTabs();
      bindRevisionsToggle();
      updateVisEmptyPlaceholders();
      renderDocBreadcrumb();
      // 最后按当前 hash 决定去哪
      routeByHash();
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
 */
function canViewByBits(bits, visibility, userLevel) {
  // 私有文档：仅作者本人 & 超管可看，前端无法判断作者，所以一律过滤掉（后端二次校验会放行作者）
  if (visibility === 'private') return false;
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

async function fetchDocList() {
  try {
    const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    // folder_id 过滤：null=不过滤；0=根目录；正整数=该文件夹
    let url = `${API_BASE_URL}/api/v1/document/list`;
    if (__DOC.currentFolderId !== null && __DOC.currentFolderId !== undefined) {
      url += `?folder_id=${encodeURIComponent(__DOC.currentFolderId)}`;
    }
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      __DOC.docs = d.data || [];
    } else {
      console.warn('[list] 获取失败:', d.msg);
    }
  } catch (e) {
    console.error('[list] 网络错误:', e);
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
    const r = await fetch(`${API_BASE_URL}/api/v1/auth/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    if (r.ok && d.code === 200 && d.data && d.data.user) {
      const u = d.data.user;
      __DOC.user = {
        isLoggedIn: true,
        id: u.id,
        permissionLevel: u.permission_level || 1,
        username: u.username || '',
        group: (u.profile && u.profile.group) ? u.profile.group : 'default'
      };
      // 等级≥5 才能管理公共文件夹
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
    const url = token
      ? `${API_BASE_URL}/api/v1/document/folders`
      : `${API_BASE_URL}/api/v1/document/folders/public`;
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      __DOC.folders = d.data || [];
    } else if (r.status === 401) {
      // 401：token 无效，尝试匿名 fallback
      try {
        const r2 = await fetch(`${API_BASE_URL}/api/v1/document/folders/public`);
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

  // 先做权限过滤（前端预过滤）
  const lvl = __DOC.user.permissionLevel;
  const uid = __DOC.user.id;
  let visibleDocs = __DOC.docs.filter(doc =>
    (uid && doc.author_id === uid) || canViewByBits(doc.permission_bits, doc.visibility, lvl)
  );

  // 可见类型 tab 过滤（public / group / private）
  if (__DOC.visFilter) {
    if (__DOC.visFilter === 'private') {
      visibleDocs = visibleDocs.filter(d => d.visibility === 'private' && uid && d.author_id === uid);
    } else {
      visibleDocs = visibleDocs.filter(d => d.visibility !== 'private' && owningToTab(d) === __DOC.visFilter);
    }
  }

  // 搜索过滤（标题 or 摘要）
  const kw = keyword.trim().toLowerCase();
  const list = !kw ? visibleDocs : visibleDocs.filter(d =>
    (d.title || '').toLowerCase().includes(kw) || (d.summary || '').toLowerCase().includes(kw)
  );

  if (list.length === 0) {
    const reason = __DOC.docs.length === 0 ? '暂无可访问的文档'
      : (kw ? `没有匹配「${kw}」的文档` : `当前「${({public:'公共',group:'组',private:'私有'})[__DOC.visFilter] || '全部'}」分类下暂无文档`);
    root.innerHTML = `<p class="doc-loading-text">${reason}</p>`;
    return;
  }

  // 扁平列表（无分类分组）
  let html = list.map(d => docItemHTML(d)).join('');
  root.innerHTML = html;
}
function docItemHTML(d) {
  const active = __DOC.currentSlug === d.slug ? ' is-active' : '';
  const href = `#/doc/${encodeURIComponent(d.slug)}`;
  return `<a href="${href}" class="doc-item${active}" data-slug="${escapeAttr(d.slug)}">
    <span class="doc-item__icon">${d.icon || '📄'}</span>
    <span>${escapeHtml(d.title)}</span>
  </a>`;
}

// =========================================
// 5. 渲染：主页文档列表（扁平卡片网格）
// =========================================
function renderDocRootList() {
  const lvl = __DOC.user.permissionLevel;
  const uid = __DOC.user.id;
  let visibleDocs = __DOC.docs.filter(doc =>
    (uid && doc.author_id === uid) || canViewByBits(doc.permission_bits, doc.visibility, lvl)
  );
  // 可见类型 tab 过滤（与侧边栏保持一致）
  if (__DOC.visFilter) {
    if (__DOC.visFilter === 'private') {
      visibleDocs = visibleDocs.filter(d => d.visibility === 'private' && uid && d.author_id === uid);
    } else {
      visibleDocs = visibleDocs.filter(d => d.visibility !== 'private' && owningToTab(d) === __DOC.visFilter);
    }
  }

  const grid = document.getElementById('docRootGrid');
  if (!grid) return;

  if (visibleDocs.length === 0) {
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = visibleDocs.map(d => {
    const href = `#/doc/${encodeURIComponent(d.slug)}`;
    return `<a class="feature-tile" href="${href}">
      <div class="feature-tile__img">${d.icon || '📚'}</div>
      <div class="feature-tile__content">
        <div class="feature-tile__title">${escapeHtml(d.title)}</div>
        <div class="feature-tile__desc">${escapeHtml(d.summary || '')}</div>
      </div>
    </a>`;
  }).join('');
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
    t = setTimeout(() => renderDocSidebarTree(e.target.value || ''), 150);
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
      // 统一筛选状态机:tab 与 folder 互斥,切 tab 时清空 folder 筛选与搜索框
      __DOC.currentFolderId = null;
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
    (uid && doc.author_id === uid) || canViewByBits(doc.permission_bits, doc.visibility, lvl)
  );
  if (__DOC.visFilter === 'private') {
    visibleDocs = visibleDocs.filter(d => d.visibility === 'private' && uid && d.author_id === uid);
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
    <div class="doc-folder-node" data-folder-id="${node.id}" style="padding-left:${10 + depth * 16}px">
      <div class="doc-folder-node__row ${isActive ? 'is-active' : ''}">
        <span class="doc-folder-node__arrow ${hasChildren ? 'is-expandable' : ''}" data-action="toggle" title="${hasChildren ? '展开/折叠' : ''}">▶</span>
        <span class="doc-folder-node__icon">📁</span>
        <span class="doc-folder-node__name">${escapeHtml(node.name)}</span>
        <span class="doc-folder-node__actions">
          ${__DOC.isAdmin ? `
            <button class="doc-folder-item__btn" data-action="rename" data-id="${node.id}" data-name="${escapeAttr(node.name)}" title="重命名">✏️</button>
            <button class="doc-folder-item__btn" data-action="delete" data-id="${node.id}" title="删除">🗑</button>
          ` : ''}
        </span>
      </div>
      <div class="doc-folder-node__children" style="${hasChildren ? '' : 'display:none'}">
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
    const r = await fetch(`${API_BASE_URL}/api/v1/document/folders/${folderId}/path`, {
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
    items.push(`<button class="doc-path-breadcrumb__item ${isLast ? 'is-active' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`);
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
  await fetchDocList();
  const input = document.getElementById('docSearchInput');
  const kw = input ? input.value : '';
  renderDocSidebarTree(kw);
  renderDocRootList();
  renderDocFolders();
  updateVisEmptyPlaceholders();
  renderDocBreadcrumb();
}

/**
 * 渲染侧栏文件夹（树形，替代原 chip 结构）
 */
function renderDocFolders() {
  const section = document.getElementById('docFoldersSection');
  const list = document.getElementById('docFoldersList');
  if (!section || !list) return;

  // 按 visFilter 过滤文件夹：
  //   - public / group tab：仅显示公共文件夹（user_id === null）
  //   - private tab：仅显示个人文件夹（user_id === 当前用户）
  //   - 无筛选（''）：显示全部（个人 + 公共）
  const uid = __DOC.user.id;
  let filteredFolders = __DOC.folders;
  if (__DOC.visFilter === 'public' || __DOC.visFilter === 'group') {
    filteredFolders = __DOC.folders.filter(f => f.user_id === null || f.user_id === undefined);
  } else if (__DOC.visFilter === 'private') {
    filteredFolders = __DOC.folders.filter(f => uid && f.user_id === uid);
  }

  if (filteredFolders.length === 0 && !__DOC.isAdmin) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  let html = `
    <div class="doc-folder-quick">
      <div class="doc-folder-node__row ${__DOC.currentFolderId === null ? 'is-active' : ''}" data-folder-id="__all__" style="padding-left:10px">
        <span class="doc-folder-node__arrow"></span>
        <span class="doc-folder-node__icon">📋</span>
        <span class="doc-folder-node__name">全部文档</span>
        <span class="doc-folder-node__actions"></span>
      </div>
      <div class="doc-folder-node__row ${__DOC.currentFolderId === 0 ? 'is-active' : ''}" data-folder-id="__uncategorized__" style="padding-left:10px">
        <span class="doc-folder-node__arrow"></span>
        <span class="doc-folder-node__icon">🗂</span>
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
  __DOC.currentFolderId = null;
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

  list.querySelectorAll('[data-folder-id="__all__"], [data-folder-id="__uncategorized__"]').forEach(row => {
    row.addEventListener('click', async () => {
      const fid = row.dataset.folderId;
      const newId = (fid === '__all__') ? null : 0;
      if (newId === __DOC.currentFolderId) return;
      // 点「全部文档」(folderId=null) = 清空 folder 筛选,与 tab 维度兼容,保留 visFilter + 搜索
      // 点「根目录」(folderId=0) = 切到 folder 维度的具体值,清空 tab + 搜索
      if (fid !== '__all__') {
        resetVisFilterAndSearchUI();
      }
      __DOC.currentFolderId = newId;
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
      if (!childrenEl || childrenEl.style.display === 'none') return;
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
    alert('仅等级≥5 的管理员可重命名公共文件夹');
    return;
  }
  const name = await Modal.prompt('请输入新的文件夹名称：', oldName || '', { title: '重命名文件夹' });
  if (name === null || !name.trim() || name.trim() === oldName) return;
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    alert('请先登录');
    return;
  }
  try {
    const r = await fetch(`${API_BASE_URL}/api/v1/document/folders/${id}`, {
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
      alert('重命名失败：' + (d.msg || '未知错误'));
    }
  } catch (e) {
    console.error('[folder] 重命名网络错误:', e);
    alert('重命名失败：网络错误');
  }
}

/**
 * 删除公共文件夹（仅管理员）
 * 删除后文件夹内的文档将变为根目录（未归类）。
 */
async function deleteDocFolder(id) {
  if (!__DOC.isAdmin) {
    alert('仅等级≥5 的管理员可删除公共文件夹');
    return;
  }
  const ok = await Modal.confirm('删除文件夹后，文件夹内的文档将移至根目录，确认删除？', { title: '删除文件夹' });
  if (!ok) return;
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    alert('请先登录');
    return;
  }
  try {
    const r = await fetch(`${API_BASE_URL}/api/v1/document/folders/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      // 如果当前正在查看被删除的文件夹，重置为"全部"
      if (__DOC.currentFolderId === id) {
        __DOC.currentFolderId = null;
      }
      await fetchDocFolders();
      await applyDocFolderFilter();
    } else {
      console.error('[folder] 删除失败:', d.msg);
      alert('删除失败：' + (d.msg || '未知错误'));
    }
  } catch (e) {
    console.error('[folder] 删除网络错误:', e);
    alert('删除失败：网络错误');
  }
}

// =========================================
// 7. Hash 路由
// =========================================
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
    const detailRsp = await fetch(`${API_BASE_URL}/api/v1/document/${encodeURIComponent(slug)}`, { headers });
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
function renderDocDetailView(doc) {
  // 详情页专属面包屑（按文档所属文件夹渲染）
  renderDocBreadcrumb(null, doc.folder_id || doc.folderId || null);

  const $title = document.getElementById('docTitle');
  const $meta = document.getElementById('docMeta');
  const $content = document.getElementById('docContent');
  if ($title) $title.textContent = doc.title || '（无标题）';

  // --- 元信息条 ---
  const lvl = __DOC.user.permissionLevel;
  const isAdminView = lvl && lvl >= 5;

  const pills = [];
  // 1. 可见性徽章（公开文档需进一步判断 bit[0] 决定访客是否真正可见）
  const isPublic = doc.visibility === 'public';
  const __bits = doc.permission_bits || '000000';
  const visitorCanView = isPublic && __bits[0] === '1';
  const visText = isPublic
    ? (visitorCanView ? '🌐 公开（访客可见）' : '🌐 公开（需登录）')
    : '🔒 私密（仅登录）';
  pills.push(`<span class="meta-pill doc-visibility-badge ${isPublic ? 'is-public' : ''}" title="${isAdminView ? '仅超级管理员可切换公开/私密' : ''}">
    <span>${visText}</span>
  </span>`);

  // 2. 权限展示：所有用户统一看过滤矩阵
  //    等级映射（permission_bits 索引 0..5）：
  //      0=未登录访客, 1=user, 2=admin1, 3=admin2, 4=admin3, 5=superadmin(强制允许)
  //    用户 permissionLevel N → 仅可见 0..(N-1) 行（低于自己权限的查看情况）
  //      - 匿名(null)/等级1 → maxRow=0（仅访客行）
  //      - 等级2 → maxRow=1，... 等级6 → maxRow=5（全部，superadmin 行强制 ✅）
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
  } else {
    // 私密文档：仅显示一句话（不暴露权限矩阵）
    pills.push(`<span class="meta-pill doc-perm-summary">
      🔒 私密文档 · 仅作者本人可见
    </span>`);
  }

  // 3. 作者 + 归属（owning：'0'=公有 / 纯数字=用户ID / 非数字=组名）
  const author = doc.author_username || (__DOC.user && doc.author_id === null ? '系统' : (doc.author_id ? 'ID ' + doc.author_id : '系统'));
  const __ov = doc.owning;
  let __ovText = '';
  if (__ov && __ov !== '0') {
    __ovText = /^\d+$/.test(__ov) ? ` · 归属用户 ID ${escapeHtml(__ov)}` : ` · 归属组 ${escapeHtml(__ov)}`;
  }
  pills.push(`<span class="meta-pill">👤 <strong>${escapeHtml(author)}</strong>${__ovText}</span>`);
  // 4. 创作时间
  pills.push(`<span class="meta-pill">📅 创建 <strong>${fmtTime(doc.created_at)}</strong></span>`);
  // 5. 最新修改时间（Document.updated_at 冗余展示）
  pills.push(`<span class="meta-pill">✏️ 修改 <strong>${fmtTime(doc.updated_at || doc.created_at)}</strong></span>`);
  // 6. 浏览量
  pills.push(`<span class="meta-pill">👁 <strong>${doc.view_count ?? 0}</strong> 次阅读</span>`);

  if ($meta) $meta.innerHTML = pills.join('');

  // --- Markdown 正文 ---
  if ($content) {
    const raw = doc.content || '';
    ensureMarkedLoaded()
      .then(ok => {
        if (ok && window.marked && typeof window.marked.parse === 'function') {
          try {
            $content.innerHTML = window.marked.parse(raw || '（空文档）');
          } catch (err) {
            console.warn('[marked] 解析失败，降级:', err);
            $content.innerHTML = `<pre>${escapeHtml(raw || '')}</pre>`;
          }
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
<<<<<<< HEAD

  // M8: SRI integrity hash（marked 12.0.0 / dompurify 3.1.6，值来自浏览器实际计算）
  const tasks = [];
  if (!hasMarked) tasks.push(loadScriptWithSRI({
    src: 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js',
    integrity: 'sha384-NNQgBjjuhtXzPmmy4gurS5X7P4uTt1DThyevz4Ua0IVK5+kazYQI1W27JHjbbxQz',
    check: () => !!(window.marked && typeof window.marked.parse === 'function')
  }).then(ok => { if (ok) __DOC.markedReady = true; return ok; }));
  if (!hasPurify) tasks.push(loadScriptWithSRI({
    src: 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
    integrity: 'sha384-+VfUPEb0PdtChMwmBcBmykRMDd+v6D/oFmB3rZM/puCMDYcIvF968OimRh4KQY9a',
    check: () => !!(window.DOMPurify && typeof window.DOMPurify.sanitize === 'function')
  }).then(ok => { if (ok) __DOC.dompurifyReady = true; return ok; }));

  if (tasks.length === 0) return Promise.resolve(true);
  return Promise.all(tasks).then(results => results.every(Boolean) || hasMarked || __DOC.markedReady);
}

/** 通用：带 SRI 完整性校验的脚本加载器 */
function loadScriptWithSRI({ src, integrity, check }) {
=======
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
>>>>>>> parent of 2780429 (big_fix3.5)
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => { __DOC.markedReady = true; __DOC.markedLoading = false; resolve(true); };
    s.onerror = () => { __DOC.markedLoading = false; resolve(false); };
    document.head.appendChild(s);
  });
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
  const r = await fetch(`${API_BASE_URL}/api/v1/document/${docId}/revisions`, { headers });
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
    $list.innerHTML = __DOC.revisions.map(rev => `<li class="doc-rev__item">
      <div class="doc-rev__head">
        <span class="doc-rev__badge">${rev.revision_num}</span>
        <span class="doc-rev__time">⏱ ${fmtTime(rev.created_at)}</span>
        <span class="doc-rev__editor">👤 ${escapeHtml(rev.editor_username || '系统')}</span>
      </div>
      ${rev.summary ? `<p class="doc-rev__summary">📝 ${escapeHtml(rev.summary)}</p>` : ''}
    </li>`).join('');
  }
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
