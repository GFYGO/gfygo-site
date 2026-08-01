/**
 * superadmin-public-docs.js
 * 超级管理员 - 公有文档管理模块
 * 管理公共文档（scope=public）和文件夹，所有请求使用 X-Permission-Context: admin
 *
 * 使用方式：在 superadmin/dashboard.html 加载模板后，注入侧边栏项和面板，再加载本脚本
 */

(function () {
  'use strict';

  // ==================== 状态 ====================
  const STATE = {
    folders: [],           // 当前层级文件夹列表
    docs: [],              // 当前层级文档列表
    currentFolderId: null, // 当前文件夹 ID（null=根级）
    currentDoc: null,      // 当前浏览/编辑的文档
    view: 'list',          // list | browse | editor
    activeTab: null,       // 当前激活的 tab 名
    markedReady: false,
    markedLoading: null,
  };

  // ==================== 工具函数 ====================

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function extractSummary(content) {
    if (!content) return '';
    const text = content.replace(/^#+\s.*$/gm, '').replace(/[*`>~_\-\[\]\(\)]/g, '').trim();
    const firstLine = text.split('\n').find(l => l.trim()) || '';
    return firstLine.slice(0, 100);
  }

  /** 确保 marked.js 加载（缓存友好，避免与 dashboard.js 重复加载冲突） */
  function ensureMarkedLoaded() {
    if (STATE.markedReady) return Promise.resolve();
    // 检查是否已由其他模块加载
    if (typeof marked !== 'undefined') {
      STATE.markedReady = true;
      return Promise.resolve();
    }
    if (STATE.markedLoading) return STATE.markedLoading;
    STATE.markedLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
      s.onload = () => { STATE.markedReady = true; resolve(); };
      s.onerror = () => { console.warn('[pubdocs] marked.js 加载失败'); resolve(); };
      document.head.appendChild(s);
    });
    return STATE.markedLoading;
  }

  // ==================== API 请求 ====================

  async function apiRequest(path, options = {}) {
    const token = AuthGuard.getToken();
    if (!token) { AuthGuard.handleAuthError(); return null; }
    try {
      const method = (options.method || 'GET').toUpperCase();
      const hasBody = options.body !== undefined && options.body !== null;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'X-Permission-Context': 'admin',
      };
      if (hasBody) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${API_BASE_URL}/api/v1/document${path}`, {
        ...options,
        method,
        headers: { ...headers, ...(options.headers || {}) },
      });
      if (res.status === 401) { AuthGuard.handleAuthError(); return null; }
      return await res.json();
    } catch (e) {
      console.error('[pubdocs] 请求失败:', e);
      if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
      return null;
    }
  }

  // ==================== 初始化：注入侧边栏项和面板 ====================

  function injectSidebarItem() {
    const nav = document.querySelector('.sidebar__nav');
    if (!nav) return;
    // 检查是否已注入
    if (document.querySelector('.sidebar__nav-item[data-tab="public-docs"]')) return;

    // 在"个人文档"之后插入
    const personalDocsItem = nav.querySelector('.sidebar__nav-item[data-tab="personal-docs"]');
    const divider = document.getElementById('dynamicMenuDivider');

    const item = document.createElement('a');
    item.href = '#';
    item.className = 'sidebar__nav-item';
    item.setAttribute('data-tab', 'public-docs');
    item.innerHTML = '<span class="sidebar__nav-icon">🌐</span><span class="sidebar__nav-text">公有文档</span>';

    if (personalDocsItem && personalDocsItem.nextElementSibling) {
      nav.insertBefore(item, personalDocsItem.nextElementSibling);
    } else if (divider) {
      nav.insertBefore(item, divider);
    } else {
      nav.appendChild(item);
    }
  }

  function injectPanel() {
    if (document.getElementById('panel-public-docs')) return;
    const content = document.querySelector('.dashboard-content');
    if (!content) return;

    const panel = document.createElement('section');
    panel.className = 'tab-panel';
    panel.id = 'panel-public-docs';
    panel.style.display = 'none';
    panel.innerHTML = `
      <!-- 面包屑 -->
      <div class="pdocs-breadcrumb" id="pubdocsBreadcrumb"></div>

      <!-- 列表视图 -->
      <div class="pdocs-view" id="pubdocs-view-list">
        <div class="pdocs-toolbar">
          <h2 class="panel-title">🌐 公有文档管理</h2>
          <div class="pdocs-toolbar-actions">
            <button class="pdocs-btn pdocs-btn--secondary" id="pubdocsUpBtn" title="返回上一级">↑ 返回上一级</button>
            <button class="pdocs-btn pdocs-btn--secondary" id="pubdocsFolderAddBtn" title="新建文件夹">📁 新建文件夹</button>
            <button class="pdocs-btn pdocs-btn--primary" id="pubdocsNewBtn">+ 新建文档</button>
          </div>
        </div>
        <div class="pdocs-explorer-grid" id="pubdocsListContainer">
          <p class="loading-text">加载中...</p>
        </div>
      </div>

      <!-- 浏览视图 -->
      <div class="pdocs-view" id="pubdocs-view-browse" style="display: none;">
        <div class="pdocs-browser-toolbar">
          <button class="pdocs-btn pdocs-btn--secondary" id="pubdocsBrowserBackBtn">← 返回列表</button>
          <div class="pdocs-browser-titlebar">
            <span class="pdocs-browser-icon" id="pubdocsBrowserIcon">📄</span>
            <span class="pdocs-browser-title" id="pubdocsBrowserTitle">加载中...</span>
          </div>
          <div class="pdocs-browser-actions">
            <button class="pdocs-btn pdocs-btn--ghost" id="pubdocsBrowserOpenInDocBtn" title="在文档中心打开">🔗 外部打开</button>
            <button class="pdocs-btn pdocs-btn--secondary" id="pubdocsBrowserEditBtn">✏️ 编辑</button>
            <button class="pdocs-btn pdocs-btn--danger" id="pubdocsBrowserDeleteBtn">🗑 删除</button>
          </div>
        </div>
        <div class="pdocs-browser-meta" id="pubdocsBrowserMeta"></div>
        <div class="pdocs-browser-body">
          <div id="pubdocsBrowserContent" class="pdocs-browser-content markdown-body"></div>
        </div>
      </div>

      <!-- 编辑器视图 -->
      <div class="pdocs-view" id="pubdocs-view-editor" style="display: none;">
        <div class="pdocs-editor-toolbar">
          <button class="pdocs-btn pdocs-btn--secondary" id="pubdocsEditorBackBtn">← 返回</button>
          <input type="text" class="pdocs-title-input" id="pubdocsTitleInput" placeholder="文档标题" maxlength="200">
          <button class="pdocs-btn pdocs-btn--ghost" id="pubdocsPreviewToggleBtn">👁 预览</button>
          <button class="pdocs-btn pdocs-btn--primary" id="pubdocsSaveBtn">💾 保存</button>
        </div>
        <div class="pdocs-editor-body">
          <textarea class="pdocs-content-input" id="pubdocsContentInput" placeholder="使用 Markdown 编写文档..."></textarea>
          <div class="pdocs-preview" id="pubdocsPreview" style="display: none;"></div>
        </div>
      </div>
    `;
    content.appendChild(panel);
  }

  // ==================== 视图切换 ====================

  function showView(viewName) {
    STATE.view = viewName;
    ['list', 'browse', 'editor'].forEach(v => {
      const el = document.getElementById(`pubdocs-view-${v}`);
      if (el) el.style.display = v === viewName ? 'block' : 'none';
    });
  }

  // ==================== 数据加载 ====================

  async function loadPublicFolders() {
    const params = new URLSearchParams({ scope: 'public' });
    if (STATE.currentFolderId) params.set('parent_id', STATE.currentFolderId);
    const r = await apiRequest(`/folders?${params.toString()}`);
    if (r && r.code === 200) {
      STATE.folders = (r.data && r.data.folders) || [];
    } else {
      STATE.folders = [];
    }
  }

  async function loadPublicDocs() {
    const params = new URLSearchParams({ scope: 'public' });
    if (STATE.currentFolderId) params.set('folder_id', STATE.currentFolderId);
    const r = await apiRequest(`/list?${params.toString()}`);
    if (r && r.code === 200) {
      STATE.docs = (r.data && r.data.docs) || [];
    } else {
      STATE.docs = [];
    }
  }

  async function refreshPublicData() {
    await Promise.all([loadPublicFolders(), loadPublicDocs()]);
    renderPublicList();
    renderBreadcrumb();
  }

  // ==================== 面包屑 ====================

  async function renderBreadcrumb() {
    const container = document.getElementById('pubdocsBreadcrumb');
    if (!container) return;
    let chain = [];
    if (STATE.currentFolderId) {
      const r = await apiRequest(`/folders/${STATE.currentFolderId}/path`);
      if (r && r.code === 200) {
        chain = (r.data && r.data.path) || [];
      } else {
        chain = [];
      }
    }
    const html = chain.map((f, i) => {
      const isLast = i === chain.length - 1;
      return isLast
        ? `<span class="pdocs-breadcrumb-item pdocs-breadcrumb-item--active">${escapeHtml(f.name)}</span>`
        : `<a href="#" class="pdocs-breadcrumb-item" data-folder-id="${f.id}">${escapeHtml(f.name)}</a>`;
    }).join(' <span class="pdocs-breadcrumb-sep">›</span> ');
    container.innerHTML = chain.length > 0
      ? `<span class="pdocs-breadcrumb-item" data-folder-id="">📁 公有文档</span> <span class="pdocs-breadcrumb-sep">›</span> ${html}`
      : '<span class="pdocs-breadcrumb-item pdocs-breadcrumb-item--active">📁 公有文档</span>';

    // 绑定面包屑点击
    container.querySelectorAll('[data-folder-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        STATE.currentFolderId = el.getAttribute('data-folder-id') || null;
        refreshPublicData();
      });
    });
  }

  // ==================== 列表渲染 ====================

  function renderPublicList() {
    const container = document.getElementById('pubdocsListContainer');
    if (!container) return;

    const items = [];

    // 文件夹项
    STATE.folders.forEach(f => {
      items.push(`
        <div class="pdocs-explorer-item pdocs-explorer-item--folder" data-folder-id="${f.id}">
          <div class="pdocs-explorer-item__icon">📁</div>
          <div class="pdocs-explorer-item__name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="pdocs-explorer-item__actions">
            <button class="pdocs-explorer-item__action" data-action="rename-folder" data-id="${f.id}" title="重命名">✏️</button>
            <button class="pdocs-explorer-item__action" data-action="delete-folder" data-id="${f.id}" title="删除">🗑</button>
          </div>
        </div>
      `);
    });

    // 文档项
    STATE.docs.forEach(d => {
      const permBadge = d.permission_bits ? `<span class="pdocs-perm-badge">权限: ${escapeHtml(d.permission_bits)}</span>` : '';
      items.push(`
        <div class="pdocs-explorer-item pdocs-explorer-item--doc" data-doc-id="${d.id}">
          <div class="pdocs-explorer-item__icon">${escapeHtml(d.icon || '📄')}</div>
          <div class="pdocs-explorer-item__name" title="${escapeHtml(d.title)}">${escapeHtml(d.title)}</div>
          <div class="pdocs-explorer-item__meta">${escapeHtml(d.summary || extractSummary(d.content))}</div>
          <div class="pdocs-explorer-item__actions">
            ${permBadge}
            <button class="pdocs-explorer-item__action" data-action="edit-doc" data-id="${d.id}" title="编辑">✏️</button>
            <button class="pdocs-explorer-item__action" data-action="delete-doc" data-id="${d.id}" title="删除">🗑</button>
          </div>
        </div>
      `);
    });

    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">📂</div><p class="empty-state__text">该目录为空</p></div>';
    } else {
      container.innerHTML = items.join('');
    }

    // 绑定事件
    // 文件夹点击进入
    container.querySelectorAll('.pdocs-explorer-item--folder').forEach(el => {
      el.addEventListener('dblclick', () => {
        STATE.currentFolderId = el.dataset.folderId;
        refreshPublicData();
      });
    });
    // 文档点击浏览
    container.querySelectorAll('.pdocs-explorer-item--doc').forEach(el => {
      el.addEventListener('dblclick', () => {
        const docId = el.dataset.docId;
        browseDoc(docId);
      });
    });
    // 操作按钮
    container.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        const id = el.dataset.id;
        switch (action) {
          case 'rename-folder': promptRenameFolder(id); break;
          case 'delete-folder': confirmDeleteFolder(id); break;
          case 'edit-doc': editDoc(id); break;
          case 'delete-doc': confirmDeleteDoc(id); break;
        }
      });
    });
  }

  // ==================== 文档浏览 ====================

  async function browseDoc(docId) {
    const r = await apiRequest(`/${docId}`);
    if (!r || r.code !== 200) {
      if (typeof Toast !== 'undefined') Toast.show('加载文档失败', 'error');
      return;
    }
    STATE.currentDoc = r.data;
    showView('browse');

    // 填充信息
    document.getElementById('pubdocsBrowserIcon').textContent = STATE.currentDoc.icon || '📄';
    document.getElementById('pubdocsBrowserTitle').textContent = STATE.currentDoc.title || '无标题';
    document.getElementById('pubdocsBrowserMeta').innerHTML = `
      <span class="pdocs-meta-tag">作者: ${escapeHtml(STATE.currentDoc.author_username || '系统')}</span>
      <span class="pdocs-meta-tag">可见性: ${STATE.currentDoc.visibility || 'public'}</span>
      <span class="pdocs-meta-tag">权限位: ${STATE.currentDoc.permission_bits || '111111'}</span>
      <span class="pdocs-meta-tag">更新: ${fmtTime(STATE.currentDoc.updated_at)}</span>
      <span class="pdocs-meta-tag">浏览: ${STATE.currentDoc.view_count || 0} 次</span>
    `;

    // 渲染 Markdown
    const contentEl = document.getElementById('pubdocsBrowserContent');
    if (STATE.currentDoc.content) {
      await ensureMarkedLoaded();
      if (STATE.markedReady && typeof marked !== 'undefined') {
        try {
          contentEl.innerHTML = marked.parse(STATE.currentDoc.content);
        } catch (e) {
          contentEl.textContent = STATE.currentDoc.content;
        }
      } else {
        contentEl.textContent = STATE.currentDoc.content;
      }
    } else {
      contentEl.innerHTML = '<p class="empty-state__text">（空文档）</p>';
    }

    // 外部打开链接
    const openBtn = document.getElementById('pubdocsBrowserOpenInDocBtn');
    if (openBtn) {
      openBtn.onclick = () => {
        window.open(`../document.html#/doc/${STATE.currentDoc.slug}`, '_blank');
      };
    }
  }

  // ==================== 文档编辑 ====================

  async function editDoc(docId) {
    let doc;
    if (STATE.currentDoc && STATE.currentDoc.id == docId) {
      doc = STATE.currentDoc;
    } else {
      const r = await apiRequest(`/${docId}`);
      if (!r || r.code !== 200) {
        if (typeof Toast !== 'undefined') Toast.show('加载文档失败', 'error');
        return;
      }
      doc = r.data;
    }
    STATE.currentDoc = doc;
    showView('editor');

    document.getElementById('pubdocsTitleInput').value = doc.title || '';
    document.getElementById('pubdocsContentInput').value = doc.content || '';
    document.getElementById('pubdocsPreview').style.display = 'none';
    document.getElementById('pubdocsPreview').innerHTML = '';
  }

  async function saveDoc() {
    const title = document.getElementById('pubdocsTitleInput').value.trim();
    const content = document.getElementById('pubdocsContentInput').value;
    if (!title) {
      if (typeof Toast !== 'undefined') Toast.show('请输入文档标题', 'warning');
      return;
    }

    const isNew = !STATE.currentDoc || !STATE.currentDoc.id;
    let r;
    if (isNew) {
      // 创建新文档
      const slug = 'pub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      r = await apiRequest('/', {
        method: 'POST',
        body: JSON.stringify({
          slug,
          title,
          content,
          summary: extractSummary(content),
          visibility: 'public',
          permission_bits: '111111',
          owning: '0',
          folder_id: STATE.currentFolderId,
        }),
      });
    } else {
      // 更新已有文档
      r = await apiRequest(`/${STATE.currentDoc.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title,
          content,
          summary: extractSummary(content),
          visibility: 'public',
          permission_bits: '111111',
        }),
      });
    }

    if (r && r.code === 200) {
      if (typeof Toast !== 'undefined') Toast.show(isNew ? '文档创建成功' : '文档保存成功', 'success');
      STATE.currentDoc = null;
      showView('list');
      await refreshPublicData();
    } else {
      if (typeof Toast !== 'undefined') Toast.show(r && r.msg ? r.msg : '保存失败', 'error');
    }
  }

  async function confirmDeleteDoc(docId) {
    if (typeof Modal !== 'undefined') {
      const confirmed = await Modal.confirm('确定要删除此文档吗？（将移入回收站）', { title: '删除文档' });
      if (!confirmed) return;
    } else {
      if (!confirm('确定要删除此文档吗？')) return;
    }
    const r = await apiRequest(`/${docId}`, { method: 'DELETE' });
    if (r && r.code === 200) {
      if (typeof Toast !== 'undefined') Toast.show('文档已删除', 'success');
      STATE.currentDoc = null;
      showView('list');
      await refreshPublicData();
    } else {
      if (typeof Toast !== 'undefined') Toast.show(r && r.msg ? r.msg : '删除失败', 'error');
    }
  }

  // ==================== 文件夹操作 ====================

  async function promptRenameFolder(folderId) {
    const folder = STATE.folders.find(f => f.id == folderId);
    const oldName = folder ? folder.name : '';
    let newName;
    if (typeof Modal !== 'undefined') {
      newName = await Modal.prompt('请输入新文件夹名称：', oldName, { title: '重命名文件夹', placeholder: '文件夹名称' });
    } else {
      newName = prompt('请输入新文件夹名称：', oldName);
    }
    if (!newName || newName === oldName) return;
    const r = await apiRequest(`/folders/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (r && r.code === 200) {
      if (typeof Toast !== 'undefined') Toast.show('文件夹已重命名', 'success');
      await refreshPublicData();
    } else {
      if (typeof Toast !== 'undefined') Toast.show(r && r.msg ? r.msg : '重命名失败', 'error');
    }
  }

  async function confirmDeleteFolder(folderId) {
    if (typeof Modal !== 'undefined') {
      const confirmed = await Modal.confirm('确定要删除此文件夹吗？（文件夹必须为空）', { title: '删除文件夹' });
      if (!confirmed) return;
    } else {
      if (!confirm('确定要删除此文件夹吗？')) return;
    }
    const r = await apiRequest(`/folders/${folderId}`, { method: 'DELETE' });
    if (r && r.code === 200) {
      if (typeof Toast !== 'undefined') Toast.show('文件夹已删除', 'success');
      // 如果当前文件夹被删除，返回上一级
      if (STATE.currentFolderId == folderId) {
        STATE.currentFolderId = null;
      }
      await refreshPublicData();
    } else {
      if (typeof Toast !== 'undefined') Toast.show(r && r.msg ? r.msg : '删除失败', 'error');
    }
  }

  async function createFolder() {
    let name;
    if (typeof Modal !== 'undefined') {
      name = await Modal.prompt('请输入文件夹名称：', '', { title: '新建文件夹', placeholder: '文件夹名称' });
    } else {
      name = prompt('请输入文件夹名称：');
    }
    if (!name) return;
    const r = await apiRequest('/folders', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        scope: 'public',
        parent_id: STATE.currentFolderId,
        user_id: null,
      }),
    });
    if (r && r.code === 200) {
      if (typeof Toast !== 'undefined') Toast.show('文件夹创建成功', 'success');
      await refreshPublicData();
    } else {
      if (typeof Toast !== 'undefined') Toast.show(r && r.msg ? r.msg : '创建失败', 'error');
    }
  }

  // ==================== 事件绑定 ====================

  function bindEvents() {
    // 返回上一级
    const upBtn = document.getElementById('pubdocsUpBtn');
    if (upBtn && !upBtn.dataset.pubdocsBound) {
      upBtn.dataset.pubdocsBound = '1';
      upBtn.addEventListener('click', () => {
        // 获取父文件夹 ID
        if (!STATE.currentFolderId) return;
        // 需要从路径链获取父级
        (async () => {
          const r = await apiRequest(`/folders/${STATE.currentFolderId}/path`);
          if (r && r.code === 200) {
            const chain = (r.data && r.data.path) || [];
            // path 链从根到当前，要返回上一级需取倒数第二个
            STATE.currentFolderId = chain.length >= 2 ? chain[chain.length - 2].id : null;
          } else {
            STATE.currentFolderId = null;
          }
          await refreshPublicData();
        })();
      });
    }

    // 新建文件夹
    const addBtn = document.getElementById('pubdocsFolderAddBtn');
    if (addBtn && !addBtn.dataset.pubdocsBound) {
      addBtn.dataset.pubdocsBound = '1';
      addBtn.addEventListener('click', createFolder);
    }

    // 新建文档
    const newBtn = document.getElementById('pubdocsNewBtn');
    if (newBtn && !newBtn.dataset.pubdocsBound) {
      newBtn.dataset.pubdocsBound = '1';
      newBtn.addEventListener('click', () => {
        STATE.currentDoc = null;
        document.getElementById('pubdocsTitleInput').value = '';
        document.getElementById('pubdocsContentInput').value = '';
        document.getElementById('pubdocsPreview').style.display = 'none';
        showView('editor');
      });
    }

    // 浏览视图 - 返回列表
    const backBtn = document.getElementById('pubdocsBrowserBackBtn');
    if (backBtn && !backBtn.dataset.pubdocsBound) {
      backBtn.dataset.pubdocsBound = '1';
      backBtn.addEventListener('click', () => {
        STATE.currentDoc = null;
        showView('list');
      });
    }

    // 浏览视图 - 编辑
    const editBtn = document.getElementById('pubdocsBrowserEditBtn');
    if (editBtn && !editBtn.dataset.pubdocsBound) {
      editBtn.dataset.pubdocsBound = '1';
      editBtn.addEventListener('click', () => {
        if (STATE.currentDoc) editDoc(STATE.currentDoc.id);
      });
    }

    // 浏览视图 - 删除
    const deleteBtn = document.getElementById('pubdocsBrowserDeleteBtn');
    if (deleteBtn && !deleteBtn.dataset.pubdocsBound) {
      deleteBtn.dataset.pubdocsBound = '1';
      deleteBtn.addEventListener('click', () => {
        if (STATE.currentDoc) confirmDeleteDoc(STATE.currentDoc.id);
      });
    }

    // 编辑器 - 返回
    const editorBackBtn = document.getElementById('pubdocsEditorBackBtn');
    if (editorBackBtn && !editorBackBtn.dataset.pubdocsBound) {
      editorBackBtn.dataset.pubdocsBound = '1';
      editorBackBtn.addEventListener('click', () => {
        STATE.currentDoc = null;
        showView('list');
      });
    }

    // 编辑器 - 预览切换
    const previewToggle = document.getElementById('pubdocsPreviewToggleBtn');
    if (previewToggle && !previewToggle.dataset.pubdocsBound) {
      previewToggle.dataset.pubdocsBound = '1';
      previewToggle.addEventListener('click', async () => {
        const previewEl = document.getElementById('pubdocsPreview');
        if (previewEl.style.display === 'none') {
          await ensureMarkedLoaded();
          const content = document.getElementById('pubdocsContentInput').value;
          if (STATE.markedReady && typeof marked !== 'undefined') {
            previewEl.innerHTML = marked.parse(content);
          } else {
            previewEl.textContent = content;
          }
          previewEl.style.display = 'block';
          previewToggle.textContent = '✏️ 编辑';
        } else {
          previewEl.style.display = 'none';
          previewToggle.textContent = '👁 预览';
        }
      });
    }

    // 编辑器 - 保存
    const saveBtn = document.getElementById('pubdocsSaveBtn');
    if (saveBtn && !saveBtn.dataset.pubdocsBound) {
      saveBtn.dataset.pubdocsBound = '1';
      saveBtn.addEventListener('click', saveDoc);
    }
  }

  // ==================== 公共：初始化 ====================

  window.initSuperadminPublicDocs = function () {
    // 注入侧边栏项和面板
    injectSidebarItem();
    injectPanel();
    bindEvents();

    // 监听 tab 切换，当切换到 public-docs 时加载数据
    const origSwitchTab = window.switchTab;
    if (typeof origSwitchTab === 'function') {
      const original = origSwitchTab;
      window.switchTab = function (tab, skipSave) {
        original.call(this, tab, skipSave);
        if (tab === 'public-docs') {
          showView('list');
          STATE.currentFolderId = null;
          STATE.currentDoc = null;
          refreshPublicData();
        }
      };
    }
  };

  // 自动初始化（在 dashboard.js 加载完成后执行）
  if (document.readyState === 'complete') {
    window.initSuperadminPublicDocs();
  } else {
    window.addEventListener('load', () => {
      // 给 dashboard.js 一些时间完成初始化
      setTimeout(window.initSuperadminPublicDocs, 500);
    });
  }
})();