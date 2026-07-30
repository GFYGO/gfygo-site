/**
 * document.js
 * 文档系统前端逻辑：hash 路由、权限辅助、Markdown 渲染、目录树与修订历史
 */

// 内部缓存：分类/文档/当前用户信息（供多视图复用）
const __DOC = {
  categories: [],          // [{id, name, slug, sort_order}]
  docs: [],                // [{id, title, slug, permission_bits, visibility, author_group, ...}]
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
  folders: [],              // 公共文件夹列表
  currentFolderId: null,    // null=不过滤；0=未归类；正整数=该文件夹
  isAdmin: false            // 等级≥5 才为 true
};

const DOC_LEVEL_ROLES = {
  1: '普通注册用户',
  2: '进阶用户',
  3: '成员',
  4: '核心成员',
  5: '管理员',
  6: '超级管理员'
};

// =========================================
// 入口
// =========================================
document.addEventListener('DOMContentLoaded', () => {
  initDocSidebarControls();

  // 启动时并发：拿分类 / 拿列表 / 拿身份 / 拿公共文件夹
  Promise.all([
    fetchDocCategories(),
    fetchDocList(),
    fetchDocAuthState(),
    fetchDocFolders()
  ])
    .then(() => {
      // 先渲染文件夹 chips（用于 active 状态显示），再渲染依赖 docs 的目录树与首页卡片
      renderDocFolders();
      renderDocSidebarTree();
      renderHomeCategoryGrids();
      bindDocSearch();
      bindVisTabs();
      bindRevisionsToggle();
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
  if (!sidebar) return;

  function open() { sidebar.classList.add('is-open'); if (overlay) overlay.classList.add('doc-sidebar-overlay--visible'); }
  function close() { sidebar.classList.remove('is-open'); if (overlay) overlay.classList.remove('doc-sidebar-overlay--visible'); }

  if (toggleBtn) toggleBtn.addEventListener('click', open);
  if (closeBtn)  closeBtn.addEventListener('click', close);
  if (overlay)   overlay.addEventListener('click', close);

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

async function fetchDocCategories() {
  try {
    const r = await fetch(`${API_BASE_URL}/api/v1/document/categories`);
    const d = await r.json();
    if (r.ok && d.code === 200) {
      __DOC.categories = (d.data || []).sort((a, b) => a.sort_order - b.sort_order);
    } else {
      console.warn('[categories] 获取失败:', d.msg);
    }
  } catch (e) {
    console.error('[categories] 网络错误:', e);
  }
}

async function fetchDocList() {
  try {
    const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    // folder_id 过滤：null=不过滤；0=未归类；正整数=该文件夹
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
 * 拉取公共文件夹列表（JWT optional）
 */
async function fetchDocFolders() {
  try {
    const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const r = await fetch(`${API_BASE_URL}/api/v1/document/folders/public`, { headers });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      __DOC.folders = d.data || [];
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
      // 私有 tab：仅显示当前用户自己创建的私有文档
      visibleDocs = visibleDocs.filter(d => d.visibility === 'private' && uid && d.author_id === uid);
    } else {
      visibleDocs = visibleDocs.filter(d => d.visibility === __DOC.visFilter);
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

  // 按分类分组
  const byCat = {};
  const orphans = [];
  for (const doc of list) {
    const slug = doc.category_name ? __findCatSlugByName(doc.category_name) : null;
    if (slug) {
      (byCat[slug] = byCat[slug] || []).push(doc);
    } else {
      orphans.push(doc);
    }
  }

  let html = '';
  // 按分类顺序渲染
  for (const cat of __DOC.categories) {
    if (!byCat[cat.slug] || byCat[cat.slug].length === 0) continue;
    html += `<div class="doc-cat">
      <div class="doc-cat__title">${escapeHtml(cat.name)}</div>
      ${byCat[cat.slug].map(d => docItemHTML(d)).join('')}
    </div>`;
  }
  if (orphans.length) {
    html += `<div class="doc-cat">
      <div class="doc-cat__title">其他文档</div>
      ${orphans.map(d => docItemHTML(d)).join('')}
    </div>`;
  }
  root.innerHTML = html;
}
function __findCatSlugByName(name) {
  const c = __DOC.categories.find(x => x.name === name);
  return c ? c.slug : null;
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
// 5. 渲染：主页按分类 feature-grid 填充卡片
// =========================================
// 注：folder_id 过滤由后端完成（fetchDocList 内部按 __DOC.currentFolderId 拼 ?folder_id=），
// 此函数只基于已过滤的 __DOC.docs 渲染。
function renderHomeCategoryGrids() {
  const lvl = __DOC.user.permissionLevel;
  const uid = __DOC.user.id;
  let visibleDocs = __DOC.docs.filter(doc =>
    (uid && doc.author_id === uid) || canViewByBits(doc.permission_bits, doc.visibility, lvl)
  );
  // 可见类型 tab 过滤（与侧边栏保持一致）
  if (__DOC.visFilter) {
    if (__DOC.visFilter === 'private') {
      // 私有 tab：仅显示当前用户自己创建的私有文档
      visibleDocs = visibleDocs.filter(d => d.visibility === 'private' && uid && d.author_id === uid);
    } else {
      visibleDocs = visibleDocs.filter(d => d.visibility === __DOC.visFilter);
    }
  }

  const mountPoints = document.querySelectorAll('[data-category-slug]');
  let anyEmpty = true;
  mountPoints.forEach(grid => {
    const slug = grid.getAttribute('data-category-slug');
    const cat = __DOC.categories.find(c => c.slug === slug);
    const docs = visibleDocs.filter(d =>
      cat ? (d.category_name === cat.name) : false
    );
    if (docs.length === 0) {
      grid.innerHTML = '';
    } else {
      anyEmpty = false;
      grid.innerHTML = docs.map(d => {
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
  });
  const tip = document.getElementById('emptyCatTip');
  if (tip) tip.style.display = anyEmpty ? 'block' : 'none';
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
    tab.addEventListener('click', () => {
      const vis = tab.getAttribute('data-vis');
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
      // 保留搜索关键字一起重渲染
      const input = document.getElementById('docSearchInput');
      renderDocSidebarTree(input ? input.value : '');
      renderHomeCategoryGrids();
    });
  });
}

// =========================================
// 6.2 公共文件夹（侧栏 chips + 增删改）
// =========================================

/**
 * 切换文件夹筛选：重新拉取文档列表（后端按 folder_id 过滤）并刷新相关视图。
 * 所有文件夹点击切换都走这个函数，避免前端过滤漏掉边缘情况。
 */
async function applyDocFolderFilter() {
  await fetchDocList();
  renderDocSidebarTree();
  renderHomeCategoryGrids();
  renderDocFolders();
}

/**
 * 渲染侧栏文件夹 chips
 * - 第一项永远是 "📋 全部"（currentFolderId=null）
 * - 之后每个公共文件夹一个 .doc-folder-item
 * - 管理员可看到 ✏️ / 🗑 操作按钮
 */
function renderDocFolders() {
  const section = document.getElementById('docFoldersSection');
  const list = document.getElementById('docFoldersList');
  const addBtn = document.getElementById('docFolderAddBtn');
  if (!section || !list) return;

  // 管理员才显示新建按钮
  if (addBtn) addBtn.style.display = __DOC.isAdmin ? '' : 'none';

  // 没有公共文件夹且非管理员 → 隐藏整个区段
  if (__DOC.folders.length === 0 && !__DOC.isAdmin) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  // 管理员且无文件夹 → 显示空提示
  if (__DOC.folders.length === 0 && __DOC.isAdmin) {
    list.innerHTML = `<p class="doc-loading-text" style="padding:6px 8px;">暂无公共文件夹，点击 + 新建</p>`;
    bindDocFolderActions();
    return;
  }

  const items = [];
  // 第一项：全部
  const allActive = __DOC.currentFolderId === null ? ' is-active' : '';
  items.push(`<div class="doc-folder-item${allActive}" data-folder-id="" data-folder-name="">
    <span class="doc-folder-item__label">
      <span class="doc-folder-item__icon">📋</span>
      <span>全部</span>
    </span>
  </div>`);

  // 每个公共文件夹
  for (const f of __DOC.folders) {
    const active = __DOC.currentFolderId === f.id ? ' is-active' : '';
    const actions = __DOC.isAdmin
      ? `<span class="doc-folder-item__actions">
          <button class="doc-folder-item__btn" data-action="rename" data-id="${f.id}" data-name="${escapeAttr(f.name)}" title="重命名">✏️</button>
          <button class="doc-folder-item__btn" data-action="delete" data-id="${f.id}" title="删除">🗑</button>
        </span>`
      : '';
    items.push(`<div class="doc-folder-item${active}" data-folder-id="${f.id}" data-folder-name="${escapeAttr(f.name)}">
      <span class="doc-folder-item__label">
        <span class="doc-folder-item__icon">📁</span>
        <span>${escapeHtml(f.name)}</span>
      </span>
      ${actions}
    </div>`);
  }

  list.innerHTML = items.join('');
  bindDocFolderActions();
}

/**
 * 绑定文件夹区段的点击事件：
 * - + 按钮 → 新建
 * - ✏️ 按钮 → 重命名
 * - 🗑 按钮 → 删除
 * - chip 主体（非按钮区域） → 切换筛选
 */
function bindDocFolderActions() {
  const addBtn = document.getElementById('docFolderAddBtn');
  if (addBtn) {
    // 替换节点以避免重复绑定
    const clone = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(clone, addBtn);
    clone.addEventListener('click', () => addDocFolder());
  }

  document.querySelectorAll('.doc-folder-item').forEach(item => {
    // 克隆以清除旧监听
    const fresh = item.cloneNode(true);
    item.parentNode.replaceChild(fresh, item);

    // 操作按钮
    fresh.querySelectorAll('.doc-folder-item__btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = Number(btn.getAttribute('data-id'));
        const name = btn.getAttribute('data-name') || '';
        if (action === 'rename') {
          renameDocFolder(id, name);
        } else if (action === 'delete') {
          deleteDocFolder(id);
        }
      });
    });

    // chip 主体点击 → 切换筛选
    fresh.addEventListener('click', (e) => {
      // 点在按钮上则跳过
      if (e.target.closest('.doc-folder-item__btn')) return;
      const idRaw = fresh.getAttribute('data-folder-id');
      const newId = idRaw === '' ? null : Number(idRaw);
      // 点击已选中项不再重复请求
      if (newId === __DOC.currentFolderId) return;
      __DOC.currentFolderId = newId;
      applyDocFolderFilter().catch(err => console.error('[folder] 切换失败:', err));
    });
  });
}

/**
 * 新建公共文件夹（仅管理员）
 */
async function addDocFolder() {
  if (!__DOC.isAdmin) {
    alert('仅等级≥5 的管理员可创建公共文件夹');
    return;
  }
  const name = await Modal.prompt('请输入公共文件夹名称：', '', { title: '新建文件夹' });
  if (name === null || !name.trim()) return;
  const token = (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) ? AuthGuard.getToken() : null;
  if (!token) {
    alert('请先登录');
    return;
  }
  try {
    const r = await fetch(`${API_BASE_URL}/api/v1/document/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name: name.trim(), scope: 'public' })
    });
    const d = await r.json();
    if (r.ok && d.code === 200) {
      await fetchDocFolders();
      renderDocFolders();
    } else {
      console.error('[folder] 新建失败:', d.msg);
      alert('新建失败：' + (d.msg || '未知错误'));
    }
  } catch (e) {
    console.error('[folder] 新建网络错误:', e);
    alert('新建失败：网络错误');
  }
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
 * 删除后文件夹内文档将变为未归类。
 */
async function deleteDocFolder(id) {
  if (!__DOC.isAdmin) {
    alert('仅等级≥5 的管理员可删除公共文件夹');
    return;
  }
  const ok = await Modal.confirm('删除文件夹后，文件夹内的文档将变为未归类，确认删除？', { title: '删除文件夹' });
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
  const $title = document.getElementById('docTitle');
  const $meta = document.getElementById('docMeta');
  const $content = document.getElementById('docContent');
  if ($title) $title.textContent = doc.title || '（无标题）';

  // --- 元信息条 ---
  const lvl = __DOC.user.permissionLevel;
  const isAdminView = lvl && lvl >= 5;

  const pills = [];
  // 1. 可见性徽章
  const isPublic = doc.visibility === 'public';
  pills.push(`<span class="meta-pill doc-visibility-badge ${isPublic ? 'is-public' : ''}" title="${isAdminView ? '仅超级管理员可切换公开/私密' : ''}">
    <span>${isPublic ? '🌐 公开（访客可见）' : '🔒 私密（仅登录）'}</span>
  </span>`);

  // 2. 权限展示：分档
  if (isAdminView) {
    // 管理员版 - 6 行矩阵
    const rows = parsePermBits(doc.permission_bits).map(row => {
      const markClass = row.allow ? 'is-yes' : 'is-no';
      const markTxt = row.allow ? '✅ 可见' : '❌ 不可见';
      const forceClass = row.force ? ' is-force' : '';
      return `<div class="doc-perm-grid__row${forceClass}">
        <div class="doc-perm-grid__label">等级 ${row.level}</div>
        <div class="doc-perm-grid__role">${DOC_LEVEL_ROLES[row.level] || ''}</div>
        <div class="doc-perm-grid__mark ${markClass}">${markTxt}</div>
      </div>`;
    }).join('');
    pills.push(`<div class="doc-perm-grid">
      <div class="doc-perm-grid__raw" title="原始 6 位 permission_bits">${doc.permission_bits || '000000'}</div>
      ${rows}
    </div>`);
  } else {
    // 普通用户版 - 一句话摘要
    pills.push(`<span class="meta-pill doc-perm-summary">
      🔑 ${permToSummaryText(doc.permission_bits, doc.visibility)}
    </span>`);
  }

  // 3. 作者 / 组
  const author = doc.author_username || (__DOC.user && doc.author_id === null ? '系统' : (doc.author_id ? 'ID ' + doc.author_id : '系统'));
  pills.push(`<span class="meta-pill">👤 <strong>${escapeHtml(author)}</strong>${doc.author_group ? ` / ${escapeHtml(doc.author_group)} 组` : ''}</span>`);
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
        <span class="doc-rev__group">${escapeHtml(rev.editor_group || 'default')}</span>
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
