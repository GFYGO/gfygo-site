/**
 * superadmin/dashboard.js - 超级管理员专属逻辑
 * 在共享 user/dashboard.js 之后执行，可访问已初始化的 DOM 和全局状态。
 * 功能：公有文档管理（文档/文件夹 CRUD + 浏览 + 编辑）
 */
(function () {
    'use strict';

    const ADMIN_LEVEL = 5;
    const ADMIN_NAME = '超级管理员';

    window.__adminLevel = ADMIN_LEVEL;
    window.__adminName = ADMIN_NAME;

    // 工作台面板占位文案定制
    const workspacePanel = document.getElementById('panel-workspace');
    if (workspacePanel) {
        const emptyText = workspacePanel.querySelector('.empty-state__text');
        if (emptyText) emptyText.textContent = `${ADMIN_NAME}专属工作台功能开发中，敬请期待`;
        const emptyIcon = workspacePanel.querySelector('.empty-state__icon');
        if (emptyIcon) emptyIcon.textContent = '🛠️';
    }

    // 显示公有文档侧边栏入口
    const navItem = document.getElementById('publicDocsNavItem');
    if (navItem) navItem.style.display = '';

    // 重新绑定 tab 点击（确保新加入的侧边栏项可点击）
    if (typeof bindTabClicks === 'function') bindTabClicks();

    // =========================================
    // 公有文档管理（资源管理器模型，复用 pdocs 的 CSS 类）
    // =========================================

    let pubdocsEditingId = null;
    let pubdocsFolders = [];
    let pubdocsCurrentFolderId = null;
    let pubdocsCurrentDocs = null;

    /** 请求封装（走 admin 上下文） */
    async function pubdocsRequest(path, options = {}) {
        const token = AuthGuard.getToken();
        if (!token) { AuthGuard.handleAuthError(); return null; }
        try {
            const method = (options.method || 'GET').toUpperCase();
            const hasBody = options.body !== undefined && options.body !== null;
            const baseHeaders = {
                'Authorization': `Bearer ${token}`,
                'X-Permission-Context': 'admin',
            };
            if (hasBody) baseHeaders['Content-Type'] = 'application/json';
            const res = await fetch(`${API_BASE_URL}/api/v1/document${path}`, {
                ...options,
                method,
                headers: { ...baseHeaders, ...(options.headers || {}) }
            });
            if (res.status === 401) { AuthGuard.handleAuthError(); return null; }
            return await res.json();
        } catch (e) {
            console.error('[pubdocs] 请求失败:', e);
            if (typeof Toast !== 'undefined') Toast.show('网络请求失败', 'error');
            return null;
        }
    }

    /** 初始化 EasyMDE 编辑器（公有文档） */
    function initPubdocsEasyMDE() {
        const textarea = document.getElementById('pubdocsContentInput');
        if (!textarea || pubdocsEditorInstance) return;
        try {
            pubdocsEditorInstance = new EasyMDE({
                element: textarea,
                spellChecker: false,
                autosave: { enabled: false },
                toolbar: [
                    'bold', 'italic', 'strikethrough', 'heading', 'heading-smaller', 'heading-bigger', '|',
                    'code', 'quote', 'unordered-list', 'ordered-list', '|',
                    'link', 'image', 'table', 'horizontal-rule', '|',
                    'preview', 'side-by-side', 'fullscreen', '|',
                    'guide'
                ],
                previewRender: async function(plainText, preview) {
                    await ensureMarkedLoaded();
                    if (pdocsMarkedReady && window.marked) {
                        preview.innerHTML = window.marked.parse(plainText || '*空内容*');
                    } else {
                        preview.innerHTML = `<pre>${escapeHtml(plainText)}</pre>`;
                    }
                    return preview;
                },
                placeholder: '使用 Markdown 编写公有文档...',
                minHeight: '400px',
                status: ['lines', 'words', 'cursor']
            });
        } catch (e) {
            console.error('[pubdocs] EasyMDE 初始化失败:', e);
        }
    }

    /** 初始化公有文档 */
    window.initPublicDocs = function () {
        const bind = (id, handler) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.pubdocsBound) {
                el.dataset.pubdocsBound = '1';
                el.addEventListener('click', handler);
            }
        };
        bind('pubdocsNewBtn', () => openPubdocsEditor(null));
        bind('pubdocsBackBtn', () => showPubdocsView('list'));
        bind('pubdocsUpBtn', () => goPubdocsUpOneLevel());
        bind('pubdocsFolderAddBtn', addPubdocsFolder);
        bind('pubdocsSaveBtn', savePubdocsDoc);
        bind('pubdocsPreviewToggleBtn', togglePubdocsPreview);
        bind('pubdocsBrowserBackBtn', () => showPubdocsView('list'));
        bind('pubdocsBrowserEditBtn', () => {
            const docId = window._pubdocsBrowserDocId;
            if (docId) openPubdocsEditor(docId);
        });
        bind('pubdocsBrowserDeleteBtn', () => {
            const docId = window._pubdocsBrowserDocId;
            if (docId) deletePubdocsDoc(docId);
        });
        bind('pubdocsBrowserOpenInDocBtn', () => {
            const slug = window._pubdocsBrowserDocSlug;
            if (slug) window.open(`${BASE_PATH}/document.html?slug=${encodeURIComponent(slug)}`, '_blank');
        });

        // 初始化 EasyMDE 编辑器
        initPubdocsEasyMDE();

        loadPubdocsDocs();
        loadPubdocsFolders();
    };

    /** 切换子视图 */
    function showPubdocsView(viewName) {
        ['list', 'browse', 'editor'].forEach(v => {
            const el = document.getElementById(`pubdocs-view-${v}`);
            if (el) el.style.display = (v === viewName) ? '' : 'none';
        });
        if (viewName === 'list') loadPubdocsDocs();
    }

    /** 加载公有文档列表 */
    async function loadPubdocsDocs() {
        const folderQuery = (typeof pubdocsCurrentFolderId === 'number' && pubdocsCurrentFolderId > 0)
            ? `folder_id=${pubdocsCurrentFolderId}`
            : `folder_id=0`;
        const data = await pubdocsRequest(`/list?scope=public&${folderQuery}`);
        pubdocsCurrentDocs = (data && data.code === 200 && Array.isArray(data.data)) ? data.data : [];
        renderPubdocsGrid();
    }

    /** 加载公有文件夹列表 */
    async function loadPubdocsFolders() {
        const data = await pubdocsRequest('/folders?scope=public');
        if (!data || data.code !== 200) {
            console.error('[pubdocs] 加载文件夹失败:', data);
            return;
        }
        pubdocsFolders = Array.isArray(data.data) ? data.data : [];
        renderPubdocsGrid();
        renderPubdocsBreadcrumb();
    }

    /** 渲染资源管理器网格 */
    function renderPubdocsGrid() {
        const container = document.getElementById('pubdocsListContainer');
        if (!container) return;

        const inFolder = (typeof pubdocsCurrentFolderId === 'number' && pubdocsCurrentFolderId > 0);
        const upBtn = document.getElementById('pubdocsUpBtn');
        if (upBtn) upBtn.style.visibility = inFolder ? '' : 'hidden';

        if (pubdocsCurrentDocs === null) {
            container.innerHTML = '<p class="loading-text">加载中...</p>';
            return;
        }

        const subFolders = pubdocsFolders.filter(f => {
            if (inFolder) return f.parent_id === pubdocsCurrentFolderId;
            return !f.parent_id || f.parent_id === 0;
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const docs = [...pubdocsCurrentDocs].sort((a, b) => (a.title || '').localeCompare(b.title || ''));

        const items = [];

        if (inFolder) {
            items.push(`
                <div class="pdocs-explorer-item pdocs-explorer-item--up" data-action="up" title="返回上一级">
                    <div class="pdocs-explorer-item__icon">⬆️</div>
                    <div class="pdocs-explorer-item__name">返回上一级</div>
                </div>`);
        }

        subFolders.forEach(f => {
            items.push(`
                <div class="pdocs-explorer-item pdocs-explorer-item--folder" data-folder-id="${f.id}" title="${escapeHtml(f.name)}">
                    <div class="pdocs-explorer-item__icon">📁</div>
                    <div class="pdocs-explorer-item__name">${escapeHtml(f.name)}</div>
                    <div class="pdocs-explorer-item__actions">
                        <button class="pdocs-explorer-item__btn" data-action="rename-folder" data-id="${f.id}" title="重命名">✏️</button>
                        <button class="pdocs-explorer-item__btn" data-action="delete-folder" data-id="${f.id}" title="删除">🗑</button>
                    </div>
                </div>`);
        });

        docs.forEach(doc => {
            items.push(`
                <div class="pdocs-explorer-item pdocs-explorer-item--doc" data-doc-id="${doc.id}" title="${escapeHtml(doc.title)}">
                    <div class="pdocs-explorer-item__icon">${escapeHtml(doc.icon || '📄')}</div>
                    <div class="pdocs-explorer-item__name">${escapeHtml(doc.title)}</div>
                    <div class="pdocs-explorer-item__meta">${pdocsFmtTime(doc.updated_at)}</div>
                    <div class="pdocs-explorer-item__actions">
                        <button class="pdocs-explorer-item__btn" data-action="browse" data-id="${doc.id}" title="浏览">👁</button>
                        <button class="pdocs-explorer-item__btn" data-action="edit" data-id="${doc.id}" title="编辑">✏️</button>
                        <button class="pdocs-explorer-item__btn" data-action="delete" data-id="${doc.id}" title="删除">🗑</button>
                    </div>
                </div>`);
        });

        if (!items.length) {
            container.innerHTML = `
                <div class="pdocs-empty">
                    <div class="pdocs-empty__icon">${inFolder ? '📂' : '🌐'}</div>
                    <p class="pdocs-empty__text">${inFolder ? '此文件夹为空' : '还没有公有文档，点击「新建文档」开始创建'}</p>
                </div>`;
            return;
        }

        container.innerHTML = items.join('');

        container.querySelectorAll('.pdocs-explorer-item--folder').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.pdocs-explorer-item__btn')) return;
                const fid = parseInt(el.dataset.folderId, 10);
                navigatePubdocsToFolder(fid);
            });
        });

        const upEl = container.querySelector('.pdocs-explorer-item--up');
        if (upEl) upEl.addEventListener('click', () => goPubdocsUpOneLevel());

        container.querySelectorAll('.pdocs-explorer-item--doc').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.pdocs-explorer-item__btn')) return;
                const id = parseInt(el.dataset.docId, 10);
                openPubdocsBrowser(id);
            });
        });

        container.querySelectorAll('.pdocs-explorer-item__btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const id = parseInt(btn.dataset.id, 10);
                if (action === 'browse') openPubdocsBrowser(id);
                else if (action === 'edit') openPubdocsEditor(id);
                else if (action === 'delete') deletePubdocsDoc(id);
                else if (action === 'rename-folder') {
                    const folder = pubdocsFolders.find(f => f.id === id);
                    Modal.prompt('重命名文件夹:', folder ? folder.name : '', { title: '重命名文件夹' }).then(newName => {
                        if (newName !== null && newName.trim()) renamePubdocsFolder(id, newName.trim());
                    });
                } else if (action === 'delete-folder') {
                    deletePubdocsFolder(id);
                }
            });
        });
    }

    /** 导航到指定文件夹 */
    function navigatePubdocsToFolder(folderId) {
        pubdocsCurrentFolderId = (typeof folderId === 'number' && folderId > 0) ? folderId : null;
        pubdocsCurrentDocs = null;
        renderPubdocsGrid();
        renderPubdocsBreadcrumb();
        loadPubdocsDocs();
    }

    /** 返回上一级 */
    function goPubdocsUpOneLevel() {
        if (typeof pubdocsCurrentFolderId !== 'number' || pubdocsCurrentFolderId <= 0) return;
        const parent = pubdocsFolders.find(f => f.id === pubdocsCurrentFolderId);
        const parentId = (parent && parent.parent_id) ? parent.parent_id : null;
        navigatePubdocsToFolder(parentId);
    }

    /** 渲染面包屑 */
    async function renderPubdocsBreadcrumb() {
        const container = document.getElementById('pubdocsPathBreadcrumb');
        if (!container) return;

        const isRoot = !(typeof pubdocsCurrentFolderId === 'number' && pubdocsCurrentFolderId > 0);
        const items = [];

        items.push(`<button class="pdocs-breadcrumb__item ${isRoot ? 'is-active' : ''}" data-folder-id="__root__">🌐 公有文档</button>`);

        if (!isRoot) {
            let chain = [];
            try {
                const res = await pubdocsRequest(`/folders/${pubdocsCurrentFolderId}/path`);
                if (res && res.code === 200 && Array.isArray(res.data)) {
                    chain = res.data;
                }
            } catch (e) { /* ignore */ }

            if (!chain.length) {
                const byId = new Map(pubdocsFolders.map(f => [f.id, f]));
                const tmp = [];
                let cur = byId.get(pubdocsCurrentFolderId);
                while (cur) {
                    tmp.unshift(cur);
                    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
                }
                chain = tmp;
            }

            chain.forEach((f, idx) => {
                const isLast = idx === chain.length - 1;
                items.push(`<span class="pdocs-breadcrumb__sep">›</span>`);
                items.push(`<button class="pdocs-breadcrumb__item ${isLast ? 'is-active' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`);
            });
        }

        container.innerHTML = `<div class="pdocs-breadcrumb">${items.join('')}</div>`;

        container.querySelectorAll('[data-folder-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const fid = btn.dataset.folderId;
                if (fid === '__root__') navigatePubdocsToFolder(null);
                else navigatePubdocsToFolder(parseInt(fid, 10));
            });
        });
    }

    /** 打开浏览视图 */
    async function openPubdocsBrowser(docId) {
        if (!docId) return;
        window._pubdocsBrowserDocId = docId;
        window._pubdocsBrowserDocSlug = null;
        showPubdocsView('browse');

        const titleEl = document.getElementById('pubdocsBrowserTitle');
        const iconEl = document.getElementById('pubdocsBrowserIcon');
        const metaEl = document.getElementById('pubdocsBrowserMeta');
        const contentEl = document.getElementById('pubdocsBrowserContent');

        if (titleEl) titleEl.textContent = '加载中...';
        if (iconEl) iconEl.textContent = '📄';
        if (metaEl) metaEl.innerHTML = '';
        if (contentEl) contentEl.innerHTML = '<p class="loading-text">加载中...</p>';

        const data = await pubdocsRequest(`/${docId}`);
        if (!data || data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show('加载文档失败', 'error');
            showPubdocsView('list');
            return;
        }
        const doc = data.data || {};
        window._pubdocsBrowserDocSlug = doc.slug || null;

        if (titleEl) titleEl.textContent = doc.title || '（无标题）';
        if (iconEl) iconEl.textContent = doc.icon || '📄';
        if (metaEl) {
            metaEl.innerHTML = `
                <span>作者：${escapeHtml(doc.author_username || doc.author_id || '-')}</span>
                <span>🌐 公有</span>
                <span>创建于 ${pdocsFmtTime(doc.created_at)}</span>
                <span>更新于 ${pdocsFmtTime(doc.updated_at)}</span>
            `;
        }
        if (contentEl) {
            await ensureMarkedLoaded();
            try {
                if (pdocsMarkedReady && window.marked) {
                    contentEl.innerHTML = window.marked.parse(doc.content || '*空内容*');
                } else {
                    contentEl.innerHTML = `<pre>${escapeHtml(doc.content || '')}</pre>`;
                }
            } catch (e) {
                contentEl.innerHTML = `<pre>${escapeHtml(doc.content || '')}</pre>`;
            }
        }
    }

    /** 打开编辑器 */
    async function openPubdocsEditor(docId) {
        pubdocsEditingId = docId || null;
        showPubdocsView('editor');

        const titleInput = document.getElementById('pubdocsTitleInput');
        const preview = document.getElementById('pubdocsPreview');

        // 确保 EasyMDE 已初始化
        if (!pubdocsEditorInstance) initPubdocsEasyMDE();

        if (!docId) {
            titleInput.value = '';
            if (pubdocsEditorInstance) pubdocsEditorInstance.value('');
            preview.style.display = 'none';
            preview.innerHTML = '';
            titleInput.focus();
            return;
        }

        titleInput.value = '加载中...';
        if (pubdocsEditorInstance) pubdocsEditorInstance.value('');
        const data = await pubdocsRequest(`/${docId}`);
        if (!data || data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show('加载文档失败', 'error');
            showPubdocsView('list');
            return;
        }
        titleInput.value = data.data.title || '';
        if (pubdocsEditorInstance) pubdocsEditorInstance.value(data.data.content || '');
        preview.style.display = 'none';
        preview.innerHTML = '';
    }

    /** 保存文档 */
    async function savePubdocsDoc() {
        const title = document.getElementById('pubdocsTitleInput').value.trim();
        // 优先从 EasyMDE 实例获取内容，兜底用 textarea
        const content = pubdocsEditorInstance
            ? pubdocsEditorInstance.value()
            : document.getElementById('pubdocsContentInput').value;

        if (!title) {
            if (typeof Toast !== 'undefined') Toast.show('请输入标题', 'warning');
            return;
        }

        const saveBtn = document.getElementById('pubdocsSaveBtn');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '保存中...';
        saveBtn.disabled = true;

        const bodyObj = {
            title,
            content,
            summary: pdocsExtractSummary(content),
            visibility: 'public',
            owning: '0',
            permission_bits: '100001'
        };
        if (!pubdocsEditingId && typeof pubdocsCurrentFolderId === 'number' && pubdocsCurrentFolderId > 0) {
            bodyObj.folder_id = pubdocsCurrentFolderId;
        }
        const body = JSON.stringify(bodyObj);

        let data;
        if (pubdocsEditingId) {
            data = await pubdocsRequest(`/${pubdocsEditingId}`, { method: 'PUT', body });
        } else {
            data = await pubdocsRequest('/', { method: 'POST', body });
        }

        saveBtn.textContent = originalText;
        saveBtn.disabled = false;

        if (!data || data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show(data?.msg || '保存失败', 'error');
            return;
        }

        if (typeof Toast !== 'undefined') Toast.show('保存成功', 'success');
        pubdocsEditingId = data.data.id;
        const preview = document.getElementById('pubdocsPreview');
        if (preview && preview.style.display !== 'none') renderPubdocsPreview();
    }

    /** 删除文档 */
    async function deletePubdocsDoc(docId) {
        const confirmed = await Modal.confirm('确认删除此公有文档？', { title: '删除文档' });
        if (!confirmed) return;
        const data = await pubdocsRequest(`/${docId}`, { method: 'DELETE' });
        if (!data || data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
            return;
        }
        if (typeof Toast !== 'undefined') Toast.show('已删除', 'success');
        showPubdocsView('list');
    }

    /** 切换预览 */
    function togglePubdocsPreview() {
        const preview = document.getElementById('pubdocsPreview');
        const isHidden = preview.style.display === 'none';
        if (isHidden) {
            preview.style.display = '';
            // EasyMDE 容器也适当调整
            const editorContainer = document.querySelector('#pubdocs-view-editor .EasyMDEContainer');
            if (editorContainer) editorContainer.style.flex = '1';
            renderPubdocsPreview();
        } else {
            preview.style.display = 'none';
            const editorContainer = document.querySelector('#pubdocs-view-editor .EasyMDEContainer');
            if (editorContainer) editorContainer.style.flex = '';
        }
    }

    /** 渲染预览 */
    async function renderPubdocsPreview() {
        // 优先从 EasyMDE 获取内容，兜底用 textarea
        const content = pubdocsEditorInstance
            ? pubdocsEditorInstance.value()
            : document.getElementById('pubdocsContentInput').value;
        const preview = document.getElementById('pubdocsPreview');
        if (!preview) return;
        await ensureMarkedLoaded();
        try {
            if (pdocsMarkedReady && window.marked) {
                preview.innerHTML = window.marked.parse(content || '*空内容*');
            } else {
                preview.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
            }
        } catch (e) {
            preview.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
        }
    }

    /** 新建公有文件夹 */
    async function addPubdocsFolder() {
        const name = await Modal.prompt('请输入文件夹名称:', '', { title: '新建公有文件夹' });
        if (name === null || !name.trim()) return;

        let parentId = null;
        if (typeof pubdocsCurrentFolderId === 'number' && pubdocsCurrentFolderId > 0) {
            parentId = pubdocsCurrentFolderId;
        }

        const body = { name: name.trim(), scope: 'public' };
        if (parentId !== null) body.parent_id = parentId;

        const data = await pubdocsRequest('/folders', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (!data || data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show(data?.msg || '创建失败', 'error');
            return;
        }
        if (typeof Toast !== 'undefined') Toast.show('文件夹已创建', 'success');
        loadPubdocsFolders();
    }

    /** 重命名文件夹 */
    async function renamePubdocsFolder(id, newName) {
        const data = await pubdocsRequest(`/folders/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: newName })
        });
        if (!data || data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show(data?.msg || '重命名失败', 'error');
            return;
        }
        if (typeof Toast !== 'undefined') Toast.show('已重命名', 'success');
        loadPubdocsFolders();
    }

    /** 删除文件夹 */
    async function deletePubdocsFolder(id) {
        const confirmed = await Modal.confirm('删除文件夹后，文件夹内的文档将移至根目录，确认删除？', { title: '删除文件夹' });
        if (!confirmed) return;
        const data = await pubdocsRequest(`/folders/${id}`, { method: 'DELETE' });
        if (!data || data.code !== 200) {
            if (typeof Toast !== 'undefined') Toast.show(data?.msg || '删除失败', 'error');
            return;
        }
        if (typeof Toast !== 'undefined') Toast.show('已删除文件夹', 'success');
        if (pubdocsCurrentFolderId === id) pubdocsCurrentFolderId = null;
        loadPubdocsFolders();
        loadPubdocsDocs();
    }

    console.log(`[superadmin] ${ADMIN_NAME}专属 JS 已加载 (level ${ADMIN_LEVEL})`);
})();
