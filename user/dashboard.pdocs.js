/**
 * dashboard.pdocs.js
 * 个人文档管理（CRUD、文件夹、编辑器、面包屑）
 * Phase 2: ES Module — 共享资源通过 window 访问
 */

var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL;
var $ = window.$;
var $$ = window.$$;
var on = window.on;
var showToast = window.showToast;
var escapeHtml = window.escapeHtml;
var setBtnState = window.setBtnState;

const PDocsState = {
    editingId: null,
    markedReady: false,
    markedLoading: null,
    folders: [],
    currentFolderId: null,
    currentUserId: null,
    currentDocs: null,
    editorInstance: null,
    browserDocId: null,
    browserDocSlug: null
};
window.PDocsState = PDocsState;

function ensureMarkedLoaded() {
    if (PDocsState.markedReady) return Promise.resolve();
    if (PDocsState.markedLoading) return PDocsState.markedLoading;
    PDocsState.markedLoading = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
        s.onload = () => { PDocsState.markedReady = true; resolve(); };
        s.onerror = () => { console.warn('[pdocs] marked.js 加载失败'); resolve(); };
        document.head.appendChild(s);
    });
    return PDocsState.markedLoading;
}

function pdocsFmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + ' 天前';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pdocsExtractSummary(content) {
    if (!content) return '';
    const text = content.replace(/^#+\s.*$/gm, '').replace(/[*`>~_\-\[\]\(\)]/g, '').trim();
    const firstLine = text.split('\n').find(l => l.trim()) || '';
    return firstLine.slice(0, 100);
}

async function pdocsRequest(path, options = {}) {
    const token = AuthGuard.getToken();
    if (!token) { AuthGuard.handleAuthError(); return null; }
    try {
        const method = (options.method || 'GET').toUpperCase();
        const hasBody = options.body !== undefined && options.body !== null;
        const baseHeaders = {
            'Authorization': `Bearer ${token}`,
        };
        if (hasBody) baseHeaders['Content-Type'] = 'application/json';
        const res = await fetch(`${API_BASE_URL}/api/v0/document${path}`, {
            ...options,
            method,
            headers: { ...baseHeaders, ...(options.headers || {}) }
        });
        if (res.status === 401) { AuthGuard.handleAuthError(); return null; }
        return await res.json();
    } catch (e) {
        console.error('[pdocs] 请求失败:', e);
        showToast('网络请求失败', 'error');
        return null;
    }
}

function initPdocsEasyMDE() {
    const textarea = $('pdocsContentInput');
    if (!textarea || PDocsState.editorInstance) return;
    try {
        PDocsState.editorInstance = new EasyMDE({
            element: textarea,
            spellChecker: false,
            autosave: { enabled: false },
            toolbar: [
                'bold', 'italic', 'strikethrough', 'heading', 'heading-smaller', 'heading-bigger', '|',
                'code', 'quote', 'unordered-list', 'ordered-list', '|',
                'link', 'image', 'table', 'horizontal-rule', '|',
                'preview', 'side-by-side', 'fullscreen', '|', 'guide'
            ],
            previewRender: async function(plainText, preview) {
                await ensureMarkedLoaded();
                if (PDocsState.markedReady && window.marked) {
                    preview.innerHTML = window.marked.parse(plainText || '*空内容*');
                } else {
                    preview.innerHTML = `<pre>${escapeHtml(plainText)}</pre>`;
                }
                return preview;
            },
            placeholder: '使用 Markdown 编写文档...',
            minHeight: '400px',
            status: ['lines', 'words', 'cursor']
        });
    } catch (e) {
        console.error('[pdocs] EasyMDE 初始化失败:', e);
    }
}

function initPersonalDocs() {
    const bind = (id, handler) => {
        const el = $(id);
        if (el && !el.dataset.pdocsBound) {
            el.dataset.pdocsBound = '1';
            on(el, 'click', handler);
        }
    };
    bind('pdocsNewBtn', () => openPdocsEditor(null));
    bind('pdocsTrashBtn', () => showPdocsView('trash'));
    bind('pdocsTrashBackBtn', () => showPdocsView('list'));
    bind('pdocsBackBtn', () => showPdocsView('list'));
    bind('pdocsUpBtn', () => goUpOneLevel());
    bind('pdocsFolderAddBtn', addPersonalFolder);
    bind('pdocsSaveBtn', savePersonalDoc);
    bind('pdocsPreviewToggleBtn', togglePdocsPreview);
    bind('pdocsBrowserBackBtn', () => showPdocsView('list'));
    bind('pdocsBrowserEditBtn', () => {
        if (PDocsState.browserDocId) openPdocsEditor(PDocsState.browserDocId);
    });
    bind('pdocsBrowserDeleteBtn', () => {
        if (PDocsState.browserDocId) softDeletePersonalDoc(PDocsState.browserDocId);
    });
    bind('pdocsBrowserOpenInDocBtn', () => {
        const { browserDocId: docId, browserDocSlug: slug } = PDocsState;
        if (slug) {
            window.open(`${window.BASE_PATH || '.'}/document.html?slug=${encodeURIComponent(slug)}`, '_blank');
        } else if (docId) {
            window.open(`${window.BASE_PATH || '.'}/document.html`, '_blank');
        }
    });

    initPdocsEasyMDE();
    loadPersonalDocs();
    loadPersonalFolders();
}

function showPdocsView(viewName) {
    ['list', 'browse', 'editor', 'trash'].forEach(v => {
        const el = $('pdocs-view-' + v);
        if (el) el.style.display = (v === viewName) ? '' : 'none';
    });
    if (viewName === 'list') loadPersonalDocs();
    if (viewName === 'trash') loadPersonalTrash();
}

async function loadPersonalDocs() {
    const folderQuery = (typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0)
        ? `folder_id=${PDocsState.currentFolderId}`
        : `folder_id=0`;
    const data = await pdocsRequest('/mine?' + folderQuery);
    PDocsState.currentDocs = (data && data.code === 200 && Array.isArray(data.data)) ? data.data : [];
    renderExplorerGrid();
}

async function loadPersonalTrash() {
    const container = $('pdocsTrashContainer');
    if (!container) return;
    container.innerHTML = '<p class="loading-text">加载中...</p>';
    const data = await pdocsRequest('/trash');
    if (!data || data.code !== 200) {
        container.innerHTML = '<p class="loading-text">加载失败</p>';
        return;
    }
    renderPdocsTrash(data.data || []);
}

function renderExplorerGrid() {
    const container = $('pdocsListContainer');
    if (!container) return;

    const inFolder = (typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0);
    const upBtn = $('pdocsUpBtn');
    if (upBtn) upBtn.style.visibility = inFolder ? '' : 'hidden';

    if (PDocsState.currentDocs === null) {
        container.innerHTML = '<p class="loading-text">加载中...</p>';
        return;
    }

    const subFolders = PDocsState.folders.filter(f => {
        if (inFolder) return f.parent_id === PDocsState.currentFolderId;
        return !f.parent_id || f.parent_id === 0;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const docs = [...PDocsState.currentDocs].sort((a, b) => (a.title || '').localeCompare(b.title || ''));

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
                    <select class="pdocs-explorer-move" data-action="move" data-id="${doc.id}" title="移动到文件夹">
                        <option value="" disabled selected>📁</option>
                        <option value="0">无文件夹</option>
                        ${PDocsState.folders.map(f => `<option value="${f.id}" ${doc.folder_id === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
                    </select>
                    <button class="pdocs-explorer-item__btn" data-action="browse" data-id="${doc.id}" title="浏览">👁</button>
                    <button class="pdocs-explorer-item__btn" data-action="edit" data-id="${doc.id}" title="编辑">✏️</button>
                    <button class="pdocs-explorer-item__btn" data-action="delete" data-id="${doc.id}" title="删除">🗑</button>
                </div>
            </div>`);
    });

    if (!items.length) {
        container.innerHTML = `
            <div class="pdocs-empty">
                <div class="pdocs-empty__icon">${inFolder ? '📂' : '📝'}</div>
                <p class="pdocs-empty__text">${inFolder ? '此文件夹为空' : '还没有文档，点击「新建文档」开始记录'}</p>
            </div>`;
        return;
    }

    container.innerHTML = items.join('');

    $$('.pdocs-explorer-item--folder', container).forEach(el => {
        on(el, 'click', (e) => {
            if (e.target.closest('.pdocs-explorer-item__btn')) return;
            const fid = parseInt(el.dataset.folderId, 10);
            navigateToFolder(fid);
        });
    });

    const upEl = container.querySelector('.pdocs-explorer-item--up');
    if (upEl) on(upEl, 'click', () => goUpOneLevel());

    $$('.pdocs-explorer-item--doc', container).forEach(el => {
        on(el, 'click', (e) => {
            if (e.target.closest('.pdocs-explorer-item__btn') || e.target.closest('.pdocs-explorer-move')) return;
            const id = parseInt(el.dataset.docId, 10);
            openPdocsBrowser(id);
        });
    });

    $$('.pdocs-explorer-item__btn', container).forEach(btn => {
        on(btn, 'click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id, 10);
            if (action === 'browse') openPdocsBrowser(id);
            else if (action === 'edit') openPdocsEditor(id);
            else if (action === 'delete') softDeletePersonalDoc(id);
            else if (action === 'rename-folder') {
                const folder = PDocsState.folders.find(f => f.id === id);
                Modal.prompt('重命名文件夹:', folder ? folder.name : '', { title: '重命名文件夹' }).then(newName => {
                    if (newName !== null && newName.trim()) renamePersonalFolder(id, newName.trim());
                });
            } else if (action === 'delete-folder') {
                deletePersonalFolder(id);
            }
        });
    });

    $$('.pdocs-explorer-move', container).forEach(sel => {
        on(sel, 'change', (e) => {
            e.stopPropagation();
            const docId = parseInt(sel.dataset.id, 10);
            const folderId = parseInt(sel.value, 10);
            movePersonalDoc(docId, folderId);
        });
        on(sel, 'click', (e) => e.stopPropagation());
    });
}

function navigateToFolder(folderId) {
    PDocsState.currentFolderId = (typeof folderId === 'number' && folderId > 0) ? folderId : null;
    PDocsState.currentDocs = null;
    renderExplorerGrid();
    renderPdocsBreadcrumb();
    loadPersonalDocs();
}

function goUpOneLevel() {
    if (typeof PDocsState.currentFolderId !== 'number' || PDocsState.currentFolderId <= 0) return;
    const parent = PDocsState.folders.find(f => f.id === PDocsState.currentFolderId);
    const parentId = (parent && parent.parent_id) ? parent.parent_id : null;
    navigateToFolder(parentId);
}

async function openPdocsBrowser(docId) {
    if (!docId) return;
    PDocsState.browserDocId = docId;
    PDocsState.browserDocSlug = null;
    showPdocsView('browse');

    const titleEl = $('pdocsBrowserTitle');
    const iconEl = $('pdocsBrowserIcon');
    const metaEl = $('pdocsBrowserMeta');
    const contentEl = $('pdocsBrowserContent');

    if (titleEl) titleEl.textContent = '加载中...';
    if (iconEl) iconEl.textContent = '📄';
    if (metaEl) metaEl.innerHTML = '';
    if (contentEl) contentEl.innerHTML = '<p class="loading-text">加载中...</p>';

    const data = await pdocsRequest('/' + docId);
    if (!data || data.code !== 200) {
        showToast('加载文档失败', 'error');
        showPdocsView('list');
        return;
    }
    const doc = data.data || {};
    PDocsState.browserDocSlug = doc.slug || null;

    if (titleEl) titleEl.textContent = doc.title || '（无标题）';
    if (iconEl) iconEl.textContent = doc.icon || '📄';
    if (metaEl) {
        const vis = { public: '🌐 公有', private: '🔒 私有' }[doc.visibility] || '🔒 私有';
        metaEl.innerHTML = `
            <span>作者：${escapeHtml(doc.author_username || doc.author_id || '-')}</span>
            <span>${vis}</span>
            <span>创建于 ${pdocsFmtTime(doc.created_at)}</span>
            <span>更新于 ${pdocsFmtTime(doc.updated_at)}</span>
        `;
    }
    if (contentEl) {
        await ensureMarkedLoaded();
        try {
            if (PDocsState.markedReady && window.marked) {
                contentEl.innerHTML = window.marked.parse(doc.content || '*空内容*');
            } else {
                contentEl.innerHTML = `<pre>${escapeHtml(doc.content || '')}</pre>`;
            }
        } catch (e) {
            contentEl.innerHTML = `<pre>${escapeHtml(doc.content || '')}</pre>`;
        }
    }
}

function renderPdocsTrash(docs) {
    const container = $('pdocsTrashContainer');
    if (!container) return;

    if (!docs.length) {
        container.innerHTML = `
            <div class="pdocs-empty">
                <div class="pdocs-empty__icon">🗑</div>
                <p class="pdocs-empty__text">回收站为空</p>
            </div>`;
        return;
    }

    container.innerHTML = docs.map(doc => `
        <div class="pdocs-trash-item">
            <div class="pdocs-trash-item__info">
                <span class="pdocs-trash-item__icon">${escapeHtml(doc.icon || '📄')}</span>
                <div>
                    <h4 class="pdocs-trash-item__title">${escapeHtml(doc.title)}</h4>
                    <span class="pdocs-trash-item__time">删除于 ${pdocsFmtTime(doc.deleted_at)}</span>
                </div>
            </div>
            <div class="pdocs-trash-item__actions">
                <button class="pdocs-btn pdocs-btn--secondary pdocs-btn--sm" data-action="restore" data-id="${doc.id}">恢复</button>
                <button class="pdocs-btn pdocs-btn--danger pdocs-btn--sm" data-action="permanent" data-id="${doc.id}">彻底删除</button>
            </div>
        </div>
    `).join('');

    $$('[data-action]', container).forEach(btn => {
        on(btn, 'click', () => {
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id, 10);
            if (action === 'restore') restorePersonalDoc(id);
            else if (action === 'permanent') permanentDeletePersonalDoc(id);
        });
    });
}

async function openPdocsEditor(docId) {
    PDocsState.editingId = docId || null;
    showPdocsView('editor');

    const titleInput = $('pdocsTitleInput');
    const preview = $('pdocsPreview');

    if (!PDocsState.editorInstance) initPdocsEasyMDE();

    if (!docId) {
        titleInput.value = '';
        if (PDocsState.editorInstance) PDocsState.editorInstance.value('');
        preview.style.display = 'none';
        preview.innerHTML = '';
        titleInput.focus();
        return;
    }

    titleInput.value = '加载中...';
    if (PDocsState.editorInstance) PDocsState.editorInstance.value('');
    const data = await pdocsRequest('/' + docId);
    if (!data || data.code !== 200) {
        showToast('加载文档失败', 'error');
        showPdocsView('list');
        return;
    }
    titleInput.value = data.data.title || '';
    if (PDocsState.editorInstance) PDocsState.editorInstance.value(data.data.content || '');
    preview.style.display = 'none';
    preview.innerHTML = '';
}

async function savePersonalDoc() {
    const title = $('pdocsTitleInput').value.trim();
    const content = PDocsState.editorInstance
        ? PDocsState.editorInstance.value()
        : $('pdocsContentInput').value;

    if (!title) {
        showToast('请输入标题', 'warning');
        return;
    }

    const saveBtn = $('pdocsSaveBtn');
    setBtnState(saveBtn, true);
    saveBtn.textContent = '保存中...';

    const bodyObj = {
        title,
        content,
        summary: pdocsExtractSummary(content),
        visibility: 'private',
        permission_bits: '100000'
    };
    if (!PDocsState.editingId && typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0) {
        bodyObj.folder_id = PDocsState.currentFolderId;
    }
    const body = JSON.stringify(bodyObj);

    let data;
    if (PDocsState.editingId) {
        data = await pdocsRequest('/' + PDocsState.editingId, { method: 'PUT', body });
    } else {
        data = await pdocsRequest('/', { method: 'POST', body });
    }

    setBtnState(saveBtn, false);
    saveBtn.textContent = '保存';

    if (!data || data.code !== 200) {
        showToast(data?.msg || '保存失败', 'error');
        return;
    }

    showToast('保存成功', 'success');
    PDocsState.editingId = data.data.id;
    const preview = $('pdocsPreview');
    if (preview && preview.style.display !== 'none') renderPdocsPreview();
}

async function softDeletePersonalDoc(docId) {
    const confirmed = await Modal.confirm('确认将此文档移入回收站？', { title: '删除文档' });
    if (!confirmed) return;
    const data = await pdocsRequest('/' + docId, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        showToast(data?.msg || '删除失败', 'error');
        return;
    }
    showToast('已移入回收站', 'success');
    loadPersonalDocs();
}

async function restorePersonalDoc(docId) {
    const data = await pdocsRequest('/' + docId + '/restore', { method: 'POST' });
    if (!data || data.code !== 200) {
        showToast(data?.msg || '恢复失败', 'error');
        return;
    }
    showToast('恢复成功', 'success');
    loadPersonalTrash();
}

async function permanentDeletePersonalDoc(docId) {
    const confirmed = await Modal.confirm('彻底删除后无法恢复，确认删除？', { title: '彻底删除' });
    if (!confirmed) return;
    const data = await pdocsRequest('/' + docId + '/permanent', { method: 'DELETE' });
    if (!data || data.code !== 200) {
        showToast(data?.msg || '删除失败', 'error');
        return;
    }
    showToast('已彻底删除', 'success');
    loadPersonalTrash();
}

function togglePdocsPreview() {
    const preview = $('pdocsPreview');
    const isHidden = preview.style.display === 'none';
    if (isHidden) {
        preview.style.display = '';
        const editorContainer = document.querySelector('#pdocs-view-editor .EasyMDEContainer');
        if (editorContainer) editorContainer.style.flex = '1';
        renderPdocsPreview();
    } else {
        preview.style.display = 'none';
        const editorContainer = document.querySelector('#pdocs-view-editor .EasyMDEContainer');
        if (editorContainer) editorContainer.style.flex = '';
    }
}

async function renderPdocsPreview() {
    const content = PDocsState.editorInstance
        ? PDocsState.editorInstance.value()
        : $('pdocsContentInput').value;
    const preview = $('pdocsPreview');
    if (!preview) return;
    await ensureMarkedLoaded();
    try {
        if (PDocsState.markedReady && window.marked) {
            preview.innerHTML = window.marked.parse(content || '*空内容*');
        } else {
            preview.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
        }
    } catch (e) {
        preview.innerHTML = `<pre>${escapeHtml(content || '')}</pre>`;
    }
}

async function loadPersonalFolders() {
    if (PDocsState.currentUserId === null || PDocsState.currentUserId === undefined) {
        console.warn('[pdocs] loadPersonalFolders 跳过：currentUserId 未就绪');
        return;
    }
    const data = await pdocsRequest('/folders');
    if (!data || data.code !== 200) {
        console.error('[pdocs] 加载文件夹失败:', data);
        return;
    }
    const all = Array.isArray(data.data) ? data.data : [];
    PDocsState.folders = all.filter(f => f.user_id === PDocsState.currentUserId);
    renderExplorerGrid();
    renderPdocsBreadcrumb();
}

async function renderPdocsBreadcrumb() {
    const container = $('pdocsPathBreadcrumb');
    if (!container) return;

    const isRoot = !(typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0);
    const items = [];

    items.push(`<button class="pdocs-breadcrumb__item ${isRoot ? 'is-active' : ''}" data-folder-id="__root__">📁 个人文档</button>`);

    if (!isRoot) {
        let chain = [];
        try {
            const res = await pdocsRequest('/folders/' + PDocsState.currentFolderId + '/path');
            if (res && res.code === 200 && Array.isArray(res.data)) {
                chain = res.data;
            }
        } catch (e) { /* ignore */ }

        if (!chain.length) {
            const byId = new Map(PDocsState.folders.map(f => [f.id, f]));
            const tmp = [];
            let cur = byId.get(PDocsState.currentFolderId);
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

    $$('[data-folder-id]', container).forEach(btn => {
        on(btn, 'click', () => {
            const fid = btn.dataset.folderId;
            if (fid === '__root__') {
                navigateToFolder(null);
            } else {
                navigateToFolder(parseInt(fid, 10));
            }
        });
    });
}

async function addPersonalFolder() {
    const name = await Modal.prompt('请输入文件夹名称:', '', { title: '新建文件夹' });
    if (name === null || !name.trim()) return;

    let parentId = null;
    if (typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0) {
        parentId = PDocsState.currentFolderId;
    }

    const body = { name: name.trim(), scope: 'private' };
    if (parentId !== null) body.parent_id = parentId;

    const data = await pdocsRequest('/folders', {
        method: 'POST',
        body: JSON.stringify(body)
    });
    if (!data || data.code !== 200) {
        showToast(data?.msg || '创建失败', 'error');
        return;
    }
    showToast('文件夹已创建', 'success');
    loadPersonalFolders();
}

async function renamePersonalFolder(id, newName) {
    const data = await pdocsRequest('/folders/' + id, {
        method: 'PUT',
        body: JSON.stringify({ name: newName })
    });
    if (!data || data.code !== 200) {
        showToast(data?.msg || '重命名失败', 'error');
        return;
    }
    showToast('已重命名', 'success');
    loadPersonalFolders();
}

async function deletePersonalFolder(id) {
    const confirmed = await Modal.confirm('删除文件夹后，文件夹内的文档将移至根目录，确认删除？', { title: '删除文件夹' });
    if (!confirmed) return;
    const data = await pdocsRequest('/folders/' + id, { method: 'DELETE' });
    if (!data || data.code !== 200) {
        showToast(data?.msg || '删除失败', 'error');
        return;
    }
    showToast('已删除文件夹', 'success');
    if (PDocsState.currentFolderId === id) PDocsState.currentFolderId = null;
    loadPersonalFolders();
    loadPersonalDocs();
}

async function movePersonalDoc(docId, folderId) {
    const body = JSON.stringify({ folder_id: folderId === 0 ? null : folderId });
    const data = await pdocsRequest('/' + docId, { method: 'PUT', body });
    if (!data || data.code !== 200) {
        showToast(data?.msg || '移动失败', 'error');
        return;
    }
    showToast('已移动', 'success');
    loadPersonalDocs();
}

// ===== ES Module exports =====
export { initPersonalDocs, loadPersonalDocs, PDocsState };

// ===== 兼容层：挂载完整初始化函数到 window（page/docs.html 动态注入后调用） =====
window.initPersonalDocs = initPersonalDocs;
window.loadPersonalDocs = loadPersonalDocs;