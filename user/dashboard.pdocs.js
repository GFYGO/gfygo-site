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

const PDocsState = {
    editingId: null,
    // ⭐ C1（2026-10-11）编辑锁：打开文档时记下**当时**的 version 与正文，
    //    保存时把 version 回传（后端不一致会回 409），正文作为 `base_content`
    //    让后端能在"改动行不重叠"时**自动合并**而不是直接判冲突。
    //    ⚠️ 不带这两个字段时后端不判定（兼容旧前端），所以任何"清空"都必须
    //    把 editingVersion 置回 null —— 否则会把上一篇的版本号发给下一篇。
    editingVersion: null,
    editingBaseContent: null,
    // ⭐ P2（2026-10-15 审查）：编辑既有文档时记住它**原本**的可见性与权限位。
    //    个人文档面板的保存原先把 `visibility:'private'` 写死 —— 超管在浏览视图里
    //    打开一篇**公开**文档再保存，就会把它悄悄改成私有（后端对 level>=5 直接放行）。
    //    现在：编辑既有文档时沿用原值；只有新建才用 private/100000 默认值。
    editingVisibility: null,
    editingPermissionBits: null,
    markedReady: false,
    markedLoading: null,
    folders: [],
    currentFolderId: null,
    currentUserId: null,
    currentDocs: null,
    // ⚠️ 服务端分页（`/document/mine`）的**文档列表**页码状态：
    //    docsPage  = 已经加载到第几页（1 起，后端也是 1 起）
    //    docsHasMore = 后端是否还有下一页（**只有它为 true 才显示「加载更多」**）
    //    docsTotal = 后端报告的当前文件夹文档总数（用于「已加载 M / 共 T」）
    docsPage: 1,
    docsHasMore: false,
    docsTotal: 0,
    // 请求序号：换文件夹 / 重新加载会让在途的旧响应失效，避免把上一个文件夹的第 2 页拼进来
    docsSeq: 0,
    // 回收站（`/document/trash`）的分页状态，与文档列表**各自独立**
    currentTrash: null,
    trashPage: 1,
    trashHasMore: false,
    trashTotal: 0,
    trashSeq: 0,
    editorInstance: null,
    browserDocId: null,
    browserDocSlug: null,
    // ⭐ C2 批量操作（2026-10-11）：多选状态放**内存**（Set），不放 DOM ——
    //    两个列表容器的 innerHTML 每次渲染都被整体覆盖，DOM 里存不住选中态。
    //    ⚠️ 翻页 / 切视图 / 换文件夹 / 重载一律清空：否则会出现
    //    「在第 1 页选了 5 篇，翻到第 3 页点删除」→ 删掉看不见的东西。
    selection: new Set(),
    trashSelection: new Set(),
    // ⭐ 2026-10-18：「批量编辑」按钮的开关。
    //    默认 **false**：复选框隐藏、条目点击照常打开文档；
    //    点按钮后切到 true：**只能**用复选框选择文件，条目点击 / 快捷操作全部禁用。
    batchMode: false,
    trashBatchMode: false
};
window.PDocsState = PDocsState;

// =========================================
// ⭐ P2-8（2026-10-25）：按视图拆模块 + 懒加载
//   编辑器（EasyMDE / 标签 / 图片 / 冲突弹窗 / 预览）与批量操作分别在
//   **第一次用到时**才 `import()`：首屏只解析本文件（列表 / 浏览 / 回收站 / 文件夹）。
//   子模块反向 import 本文件的 state 与共享助手 —— 本文件已求值完，ESM 循环安全。
// =========================================
let pdocsEditorModule = null;
let pdocsEditorLoading = null;
function ensurePdocsEditor() {
    if (pdocsEditorModule) return Promise.resolve(pdocsEditorModule);
    if (!pdocsEditorLoading) {
        pdocsEditorLoading = import('./dashboard.pdocs.editor.js').then(
            (m) => { pdocsEditorModule = m; return m; },
            (e) => { pdocsEditorLoading = null; throw e; }   // 失败可重试（下次点击再 import）
        );
    }
    return pdocsEditorLoading;
}

/** 子模块加载失败不要让点击「什么也没发生」：提示一次并把 null 交回调用方。 */
async function loadPdocsEditor() {
    try {
        return await ensurePdocsEditor();
    } catch (e) {
        console.error('[pdocs] 编辑器子模块加载失败', e);
        showToast('编辑器加载失败，请刷新页面重试', 'error');
        return null;
    }
}

let pdocsBulkModule = null;
let pdocsBulkLoading = null;
function ensurePdocsBulk() {
    if (pdocsBulkModule) return Promise.resolve(pdocsBulkModule);
    if (!pdocsBulkLoading) {
        pdocsBulkLoading = import('./dashboard.pdocs.bulk.js').then(
            (m) => { pdocsBulkModule = m; return m; },
            (e) => { pdocsBulkLoading = null; throw e; }
        );
    }
    return pdocsBulkLoading;
}

// 批量条 / 多选是纯增强：子模块还没加载时列表照常渲染，点「批量编辑」才加载并重绘。
function renderBulkBarIfReady(kind) {
    if (pdocsBulkModule) pdocsBulkModule.renderPdocsBulkBar(kind);
}
function toggleSelectionIfReady(kind, docId, checked) {
    if (pdocsBulkModule) pdocsBulkModule.pdocsToggleSelection(kind, docId, checked);
}
function clearSelectionIfReady(kind) {
    if (pdocsBulkModule) pdocsBulkModule.pdocsClearSelection(kind);
}
function withBulk(action) {
    return ensurePdocsBulk().then(action, (e) => {
        console.error('[pdocs] 批量子模块加载失败', e);
        showToast('批量操作加载失败，请刷新页面重试', 'error');
    });
}

// 对外仍是同名函数（dashboard.js 的深链接恢复、既有 bind 都不用改）：内部转调子模块。
async function openPdocsEditor(docId) {
    const m = await loadPdocsEditor();
    if (!m) return;
    return m.openPdocsEditor(docId);
}
async function savePersonalDoc() {
    const m = await loadPdocsEditor();
    if (!m) return;
    return m.savePersonalDoc();
}
async function togglePdocsPreview() {
    const m = await loadPdocsEditor();
    if (!m) return;
    return m.togglePdocsPreview();
}

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

/**
 * 渲染 Markdown 为「可直接写入 innerHTML」的安全 HTML
 * - marked 解析后必须经 sanitize.js 白名单净化（文档正文不可信，防存储型 XSS）
 * - sanitize.js 尚未加载时降级为转义纯文本，绝不注入原始 HTML
 * @param {string} raw Markdown 原文
 * @returns {string} 安全 HTML
 */
function pdocsRenderMarkdown(raw) {
    const text = (raw === null || raw === undefined) ? '' : String(raw);
    const fallback = `<pre>${escapeHtml(text || '*空内容*')}</pre>`;
    if (!PDocsState.markedReady || !window.marked || typeof window.marked.parse !== 'function') {
        return fallback;
    }
    let html;
    try {
        html = window.marked.parse(text || '*空内容*');
    } catch (e) {
        console.warn('[pdocs] Markdown 解析失败，降级为纯文本:', e);
        return fallback;
    }
    if (typeof window.sanitizeHtml !== 'function') {
        console.warn('[pdocs] sanitize.js 未加载，Markdown 降级为纯文本');
        return fallback;
    }
    return window.sanitizeHtml(html);
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

/**
 * 把后端标量（数字 id / 字符串）渲染成**可安全插入 HTML 属性**的文本。
 *
 * ⚠️ 不要把数字直接交给 `escapeHtml`：`js/utils.js::escapeHtml` 的实现是
 *    `String(str || '')` —— 数字 `0` 是 falsy，**合法的 id=0 会被吞成空串**。
 *    于是 id=0 的文档 / 文件夹被渲染成 `data-id=""`，点击时 id 被当成「没有 id」。
 *    `escapeHtml` 是全站共享的固有行为，本轮不动它，改在**调用侧**。
 *    同一根因的另一处线上表现见 `site-back/pages/admin-public-docs/site.js::safeText`
 *    （那里渲染成 `null` 会请求 `GET /api/v0/document/null` → 404）。
 *
 * 这里先按**存在性**判缺失（null / undefined / 空串），再 `String()` 后交给 escapeHtml：
 * 传进去的是字符串 `'0'`（truthy），不会被吞，转义保护一分不少。
 *
 * @param {*} value         后端字段（数字 / 字符串 / null）
 * @param {string} fallback 缺失时的占位（属性用 ''，展示用 '-' 之类）
 * @returns {string} 可安全插入 HTML 的文本
 */
function pdocsSafeValue(value, fallback = '') {
    if (value === null || value === undefined || value === '') return fallback;
    return escapeHtml(String(value));
}

/**
 * 从 `data-*` 里读一个合法的**非负整数**主键（`0` 合法）。
 *
 * ⚠️ **存在性判断，不是真值判断**：
 *    * 旧写法 `parseInt(btn.dataset.id, 10)` 在 `data-id=""` 时得到 **NaN**；
 *    * 旧写法 `docId || null` 会把 `0` 当成「没有 id」。
 *    两者叠加就是「点 id=0 文档的编辑 → 打开空白新建编辑器，保存还会 POST 出重复文档」。
 *    这里只接受 `^\d+$`：空串 / 非数字 / 负数 / 小数 / 科学计数法一律返回 `null`，
 *    调用方据此给出**可见**提示并**不发请求**（绝不带 NaN/null 去请求 `/document/NaN`）。
 *
 * @param {*} raw `data-*` 读出来的值（字符串 / 数字 / undefined）
 * @returns {number|null} 合法主键（**0 合法**）或 null
 */
function pdocsParseId(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) return null;
    const num = parseInt(text, 10);
    if (!Number.isSafeInteger(num) || num < 0) return null;
    return num;
}

/** id 是否是可用主键（**0 合法**）——状态判断用，避免 `if (id)` 吞掉 0。 */
function pdocsIsValidId(id) {
    return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0;
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

/**
 * 静态面板「个人文档」的进入钩子（由 dashboard.menu.js 在切到 docs 时调用）。
 *
 * 面板现在写死在 `dashboard.html`（`#panel-docs`），不再由后端下发 ——
 * 而「后端下发」时代每次进入都会注入一份**全新的 HTML**，视图自然会回到列表页。
 * 面板常驻 DOM 之后必须显式复位，否则上次离开时停在「浏览 / 编辑器 / 回收站」，
 * 再点「个人文档」会看到那个旧视图。
 *
 * ⚠️ 只切视图、**不写 URL**：深链接（?tab=docs&doc=…）要在随后的
 * `dashboard:tab-switched` 事件里由 dashboard.js 恢复，这里清 URL 会把参数吃掉。
 */
function initPersonalDocsPanel() {
    ['list', 'browse', 'editor', 'trash'].forEach((v) => {
        const el = $('pdocs-view-' + v);
        if (el) el.style.display = (v === 'list') ? '' : 'none';
    });
    initPersonalDocs();
}

// =========================================
// ⭐ B5（2026-10-06）：导出
//   接口：GET /api/v0/document/<id>/export.md  （单篇 Markdown；能看就能导）
//         GET /api/v0/user/export.zip         （个人全量数据；需登录）
// ⚠️ 这两个是**下载**而不是 JSON 接口 → **不能**用 `pdocsRequest`（它按 JSON 解析响应）：
//    必须 fetch 拿 blob，再用 `Content-Disposition` 里的文件名触发保存。
// =========================================
async function pdocsDownload(url, fallbackName) {
    const token = AuthGuard.getToken();
    if (!token) { AuthGuard.handleAuthError(); throw new Error('登录已失效，请重新登录'); }
    let res;
    try {
        res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) {
        throw new Error('导出失败：网络错误');
    }
    if (res.status === 401) { AuthGuard.handleAuthError(); throw new Error('登录已失效，请重新登录'); }
    if (!res.ok) {
        // 失败时后端回 JSON（400/429/500）；413 可能是 **Nginx** 的 HTML 错误页 → 两种都兜住
        let msg = res.status === 413 ? '导出内容过大' : ('导出失败（HTTP ' + res.status + '）');
        try { const d = await res.json(); msg = d.msg || msg; } catch (e) { /* 不是 JSON */ }
        throw new Error(msg);
    }
    const blob = await res.blob();
    let name = fallbackName || 'download';
    const cd = res.headers.get('Content-Disposition') || '';
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

async function exportPdocsDocMarkdown(docId) {
    const btn = $('pdocsBrowserExportBtn');
    if (btn) { btn.disabled = true; btn.textContent = '导出中...'; }
    try {
        const name = await pdocsDownload(
            `${API_BASE_URL}/api/v0/document/${docId}/export.md?images=absolute`, 'document.md');
        showToast('已导出 ' + name, 'success');
    } catch (e) {
        showToast((e && e.message) || '导出失败', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⬇ 导出 .md'; }
    }
}

async function exportPdocsAllData() {
    const btn = $('pdocsExportAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = '打包中...'; }
    try {
        const name = await pdocsDownload(`${API_BASE_URL}/api/v0/user/export.zip`,
                                         'gfygo-export.zip');
        showToast('已导出 ' + name, 'success');
    } catch (e) {
        showToast((e && e.message) || '导出失败', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⬇ 导出全部数据'; }
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
    // 「加载更多」：必须在上面 bind() 里绑定（按钮是 #pdocsListContainer / #pdocsTrashContainer
    // 的**兄弟节点**，容器 innerHTML 被整体覆盖时不会连带丢监听器）
    bind('pdocsListMoreBtn', async () => {
        const btn = $('pdocsListMoreBtn');
        // ⭐ C2：翻页（加载更多）也要清空多选 —— 设计 §4.2.4 的硬要求
        clearSelectionIfReady('docs');
        if (btn) { btn.disabled = true; btn.textContent = '加载中...'; }
        await loadPersonalDocs({ append: true });
        if (btn) { btn.disabled = false; btn.textContent = '加载更多'; }
    });
    bind('pdocsTrashMoreBtn', async () => {
        const btn = $('pdocsTrashMoreBtn');
        clearSelectionIfReady('trash');
        if (btn) { btn.disabled = true; btn.textContent = '加载中...'; }
        await loadPersonalTrash({ append: true });
        if (btn) { btn.disabled = false; btn.textContent = '加载更多'; }
    });
    // ⭐ 2026-10-18：批量编辑开关（进入后才显示复选框；退出清空选择）
    bind('pdocsBatchBtn', () => withBulk((m) => m.pdocsSetBatchMode('docs', !PDocsState.batchMode)));
    bind('pdocsTrashBatchBtn', () => withBulk((m) => m.pdocsSetBatchMode('trash', !PDocsState.trashBatchMode)));
    // ⭐ C2 批量条（按钮都在列表容器**之外**，绑定一次即可，不会随列表重绘丢失）
    //    P2-8：批量子模块在首次点击时才加载（withBulk → ensurePdocsBulk）。
    bind('pdocsBulkSelectPageBtn', () => withBulk((m) => m.pdocsToggleSelectPage('docs')));
    bind('pdocsBulkClearBtn', () => withBulk((m) => m.pdocsClearSelection('docs')));
    bind('pdocsBulkDeleteBtn', () => withBulk((m) => m.pdocsBulkTrash('docs', 'delete')));
    bind('pdocsBulkMoveBtn', () => withBulk((m) => m.pdocsBulkMove()));
    bind('pdocsBulkVisibilityBtn', () => withBulk((m) => m.pdocsBulkVisibility()));
    bind('pdocsTrashBulkSelectPageBtn', () => withBulk((m) => m.pdocsToggleSelectPage('trash')));
    bind('pdocsTrashBulkClearBtn', () => withBulk((m) => m.pdocsClearSelection('trash')));
    bind('pdocsTrashBulkRestoreBtn', () => withBulk((m) => m.pdocsBulkTrash('trash', 'restore')));
    bind('pdocsTrashBulkPermanentBtn', () => withBulk((m) => m.pdocsBulkTrash('trash', 'permanent')));
    bind('pdocsTrashBackBtn', () => showPdocsView('list'));
    // ⭐ B5：导出（单篇 Markdown / 个人全量 zip）
    bind('pdocsBrowserExportBtn', () => {
        if (pdocsIsValidId(PDocsState.browserDocId)) exportPdocsDocMarkdown(PDocsState.browserDocId);
    });
    bind('pdocsExportAllBtn', exportPdocsAllData);
    bind('pdocsBackBtn', () => showPdocsView('list'));
    bind('pdocsUpBtn', () => goUpOneLevel());
    bind('pdocsFolderAddBtn', addPersonalFolder);
    bind('pdocsSaveBtn', savePersonalDoc);
    bind('pdocsPreviewToggleBtn', togglePdocsPreview);
    bind('pdocsImportBtn', togglePdocsImportMenu);
    bind('pdocsImportMdBtn', () => {
        closePdocsImportMenu();
        const input = $('pdocsImportFileInput');
        if (input) input.click();
    });
    bind('pdocsBrowserBackBtn', () => showPdocsView('list'));
    bind('pdocsBrowserEditBtn', () => {
        // 存在性判断：id=0 是合法主键，`if (PDocsState.browserDocId)` 会让按钮静默失效
        if (pdocsIsValidId(PDocsState.browserDocId)) openPdocsEditor(PDocsState.browserDocId);
    });
    bind('pdocsBrowserDeleteBtn', () => {
        if (pdocsIsValidId(PDocsState.browserDocId)) softDeletePersonalDoc(PDocsState.browserDocId);
    });
    bind('pdocsBrowserOpenInDocBtn', () => {
        const { browserDocId: docId, browserDocSlug: slug } = PDocsState;
        if (slug) {
            window.open(`${window.BASE_PATH || '.'}/document.html?slug=${encodeURIComponent(slug)}`, '_blank');
        } else if (pdocsIsValidId(docId)) {
            // ⚠️ 这一支本来就**不带任何 id/slug 参数**（只打开文档页），本轮只把真值判断换成
            //    存在性判断，让 id=0 与非 0 文档走同一条路，不改变该支语义（是否该带参数见汇报的「存疑」项）。
            window.open(`${window.BASE_PATH || '.'}/document.html`, '_blank');
        }
    });

    // 导入文件：监听文件选择
    const importFileInput = $('pdocsImportFileInput');
    if (importFileInput && !importFileInput.dataset.pdocsBound) {
        importFileInput.dataset.pdocsBound = '1';
        importFileInput.addEventListener('change', async () => {
            const file = importFileInput.files && importFileInput.files[0];
            importFileInput.value = '';
            await handlePdocsImportFile(file);
        });
    }
    // 点击下拉外区域关闭
    if (!PDocsState._importOutsideBound) {
        PDocsState._importOutsideBound = true;
        document.addEventListener('click', (e) => {
            const dd = $('pdocsImportDropdown');
            if (dd && !dd.contains(e.target)) closePdocsImportMenu();
        });
    }

    // ⭐ P2-8（2026-10-25）：不再预初始化编辑器 —— 编辑器子模块（含 EasyMDE）
    //    在第一次「新建 / 编辑」时才 import，进面板不再额外下载数百 KB。
    // 面板初始化 = 全新一轮加载：两个列表的页码先复位（在途的旧响应也会被 seq 作废）
    resetPdocsDocsPaging();
    resetPdocsTrashPaging();
    loadPersonalDocs();
    loadPersonalFolders();
}

function togglePdocsImportMenu() {
    const menu = $('pdocsImportMenu');
    if (menu) menu.classList.toggle('is-open');
}

function closePdocsImportMenu() {
    const menu = $('pdocsImportMenu');
    if (menu) menu.classList.remove('is-open');
}

async function handlePdocsImportFile(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const fname = (file.name || '').trim();
        // 标题：取正文首个 # 一级标题；否则用文件名
        let title = fname.replace(/\.(md|markdown|txt)$/i, '').trim() || '未命名文档';
        const heading = text.match(/^\s*#\s+(.+?)\s*$/m);
        if (heading && heading[1].trim()) {
            title = heading[1].trim();
        }
        title = title.slice(0, 200);

        const body = {
            title,
            content: text,
            summary: pdocsExtractSummary(text),
            visibility: 'private',
            permission_bits: '100000'
        };
        if (typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0) {
            body.folder_id = PDocsState.currentFolderId;
        }

        const data = await pdocsRequest('/', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (data && data.code === 200) {
            showToast(`已导入「${title}」`, 'success');
            loadPersonalDocs();
        } else {
            showToast(data?.msg || '导入失败', 'error');
        }
    } catch (e) {
        console.error('[pdocs] 导入文件失败:', e);
        showToast('导入文件失败：文件读取错误', 'error');
    }
}

function showPdocsView(viewName) {
    ['list', 'browse', 'editor', 'trash'].forEach(v => {
        const el = $('pdocs-view-' + v);
        if (el) el.style.display = (v === viewName) ? '' : 'none';
    });
    // ⭐ C2：切视图一律清空两侧多选（否则会把列表视图里选的 id 带进回收站的批量条）
    PDocsState.batchMode = false;
    PDocsState.trashBatchMode = false;
    const docsBox = $('pdocsListContainer');
    const trashBox = $('pdocsTrashContainer');
    if (docsBox) docsBox.classList.remove('pdocs-batch-mode');
    if (trashBox) trashBox.classList.remove('pdocs-batch-mode');
    // 批量按钮文案随状态复位（否则切视图后仍显示「✓ 完成」）
    const docsBatchBtn = $('pdocsBatchBtn');
    if (docsBatchBtn) {
        docsBatchBtn.textContent = '☑️ 批量编辑';
        docsBatchBtn.setAttribute('aria-pressed', 'false');
        docsBatchBtn.classList.remove('pdocs-btn--primary');
    }
    const trashBatchBtn = $('pdocsTrashBatchBtn');
    if (trashBatchBtn) {
        trashBatchBtn.textContent = '☑️ 批量编辑';
        trashBatchBtn.setAttribute('aria-pressed', 'false');
        trashBatchBtn.classList.remove('pdocs-btn--primary');
    }
    clearSelectionIfReady('docs');
    clearSelectionIfReady('trash');
    if (viewName === 'list') {
        if (window.DashUrl) window.DashUrl.write({ doc: null, mode: null });
        resetPdocsDocsPaging();   // 每次进入列表视图都从第 1 页重新加载
        loadPersonalDocs();
    }
    if (viewName === 'trash') {
        if (window.DashUrl) window.DashUrl.write({ doc: null, mode: null });
        resetPdocsTrashPaging();   // 每次进入回收站都从第 1 页重新加载
        loadPersonalTrash();
    }
}

/** 每页条数：后端 size 默认 20、上限 100；这里显式传 20，行为与旧版一次性全量最接近。 */
const PDOCS_PAGE_SIZE = 20;

/**
 * 归一化 `/document/mine` 与 `/document/trash` 的响应 data。
 *
 * 后端契约（2026-10-11「双形状收口」之后，决策 Q8=B / `UNTRUSTED.md` J4）：
 *   * **恒返回包络** `data = { items, page, size, total, has_more }`；不传 `page`/`size`
 *     时 `page=1`、`size=20`（后端 `utils/paging.py`）。
 *   * 裸数组分支是**部署窗口保护**（Pages 前端先于后端「人工重启」生效），**不是契约**；
 *     此时当作「只有第一页、没有更多」，total 退回已加载条数。收口稳定后可删。
 *
 * @param {*} raw 响应里的 `data` 字段
 * @returns {{items: Array, total: number, hasMore: boolean, paginated: boolean}}
 */
function pdocsNormalizePage(raw) {
    if (Array.isArray(raw)) {
        return { items: raw, total: raw.length, hasMore: false, paginated: false };
    }
    if (raw && typeof raw === 'object') {
        const items = Array.isArray(raw.items) ? raw.items : [];
        const total = Number(raw.total);
        return {
            items,
            total: (Number.isFinite(total) && total >= items.length) ? total : items.length,
            hasMore: raw.has_more === true,
            paginated: true
        };
    }
    return { items: [], total: 0, hasMore: false, paginated: false };
}

/** 重置文档列表分页（换文件夹 / 重新进入面板 / 删除 / 导入 → 必须回到第 1 页）
 *  ⭐ C2：同时**清空多选**（换数据集后旧的选中 id 可能已不在列表里）。
 */
function resetPdocsDocsPaging() {
    PDocsState.docsPage = 1;
    PDocsState.docsHasMore = false;
    PDocsState.docsTotal = 0;
    PDocsState.docsSeq++;   // 让在途的旧响应（上一个文件夹 / 上一页）作废
    PDocsState.selection.clear();
    renderBulkBarIfReady('docs');
}

/** 重置回收站分页（⭐ C2：同样清空多选） */
function resetPdocsTrashPaging() {
    PDocsState.trashPage = 1;
    PDocsState.trashHasMore = false;
    PDocsState.trashTotal = 0;
    PDocsState.trashSeq++;
    PDocsState.trashSelection.clear();
    renderBulkBarIfReady('trash');
}

/**
 * 加载个人文档列表。
 *
 * @param {{append?: boolean}} [options] append=true 时是「加载更多」：请求**下一页**并
 *        把结果 concat 到已加载集合后面；否则是**替换**（第 1 页），页码状态一并重置。
 */
async function loadPersonalDocs(options = {}) {
    const append = options.append === true;
    // 根目录（null 或 0）传 folder_id=0 只显示根目录文档；正整数传指定文件夹
    let folderId = null;
    const fid = PDocsState.currentFolderId;
    if (fid === null || fid === undefined) {
        folderId = 0;
    } else if (typeof fid === 'number' && fid >= 0) {
        folderId = fid;
    }

    const page = append ? PDocsState.docsPage + 1 : 1;
    const params = [`page=${page}`, `size=${PDOCS_PAGE_SIZE}`];
    if (folderId !== null) params.push(`folder_id=${folderId}`);

    const seq = ++PDocsState.docsSeq;
    const data = await pdocsRequest('/mine?' + params.join('&'));
    if (seq !== PDocsState.docsSeq) return;   // 已被更新的请求取代（换文件夹 / 重新加载）

    if (!data || data.code !== 200) {
        if (!append) {
            // 保持既有语义：首次 / 切换加载失败 → 列表为空（额外给一条可见提示，不再静默）
            PDocsState.currentDocs = [];
            resetPdocsDocsPaging();
            renderExplorerGrid();
        }
        showToast((data && data.msg) || '加载文档列表失败', 'error');
        return;
    }

    const pageData = pdocsNormalizePage(data.data);
    // ⚠️ 后端是**稳定序**（id 降序）：追加时只做 concat，绝不重排跨页数据；
    //    渲染阶段的按标题排序只作用于「已加载集合」，因此不重不漏、顺序稳定。
    const prev = (append && Array.isArray(PDocsState.currentDocs)) ? PDocsState.currentDocs : [];
    PDocsState.currentDocs = append ? prev.concat(pageData.items) : pageData.items;
    PDocsState.docsPage = append ? page : 1;
    PDocsState.docsHasMore = pageData.hasMore;
    PDocsState.docsTotal = pageData.total;
    renderExplorerGrid();
}

/**
 * 加载回收站列表（与文档列表同一套「替换 / 追加」语义，页码状态各自独立）。
 * @param {{append?: boolean}} [options]
 */
async function loadPersonalTrash(options = {}) {
    const append = options.append === true;
    const container = $('pdocsTrashContainer');
    if (!container) return;
    if (!append) container.innerHTML = '<p class="loading-text">加载中...</p>';

    const page = append ? PDocsState.trashPage + 1 : 1;
    const seq = ++PDocsState.trashSeq;
    const data = await pdocsRequest(`/trash?page=${page}&size=${PDOCS_PAGE_SIZE}`);
    if (seq !== PDocsState.trashSeq) return;   // 已被更新的请求取代

    if (!data || data.code !== 200) {
        if (!append) {
            PDocsState.currentTrash = [];
            resetPdocsTrashPaging();
            container.innerHTML = '<p class="loading-text">加载失败</p>';
            renderPdocsTrashPager();
        }
        showToast((data && data.msg) || '加载回收站失败', 'error');
        return;
    }

    const pageData = pdocsNormalizePage(data.data);
    const prev = (append && Array.isArray(PDocsState.currentTrash)) ? PDocsState.currentTrash : [];
    PDocsState.currentTrash = append ? prev.concat(pageData.items) : pageData.items;
    PDocsState.trashPage = append ? page : 1;
    PDocsState.trashHasMore = pageData.hasMore;
    PDocsState.trashTotal = pageData.total;
    renderPdocsTrash(PDocsState.currentTrash);
}

/** 「已加载 M / 共 T」文案（total 缺失时退回已加载条数，绝不显示 0） */
function pdocsPagerText(loaded, total) {
    const t = (typeof total === 'number' && isFinite(total) && total >= loaded) ? total : loaded;
    return `已加载 ${loaded} / 共 ${t}`;
}

/**
 * 渲染一个分页条（计数 + 「加载更多」）。
 *
 * ⚠️ 这两个元素**必须**在 `#pdocsListContainer` / `#pdocsTrashContainer` **之外**（HTML 里是兄弟节点）：
 *    那两个容器的 innerHTML 每次渲染都被**整体覆盖**，按钮放进去会被抹掉、监听器也一起丢。
 *
 * @param {{wrap: Element|null, count: Element|null, moreBtn: Element|null,
 *          loaded: number, total: number, hasMore: boolean}} opts
 */
function renderPdocsPager(opts) {
    const loaded = opts.loaded || 0;
    const hasMore = opts.hasMore === true;
    if (opts.count) opts.count.textContent = pdocsPagerText(loaded, opts.total);
    if (opts.moreBtn) {
        opts.moreBtn.style.display = hasMore ? '' : 'none';
        opts.moreBtn.disabled = false;
        opts.moreBtn.textContent = '加载更多';
    }
    // 一条都没加载时整体隐藏（空态文案已经说明情况），避免出现「已加载 0 / 共 0」
    if (opts.wrap) opts.wrap.style.display = (loaded > 0) ? '' : 'none';
}

/** 文档列表分页条 */
function renderPdocsListPager() {
    renderPdocsPager({
        wrap: $('pdocsListPager'),
        count: $('pdocsListCount'),
        moreBtn: $('pdocsListMoreBtn'),
        loaded: Array.isArray(PDocsState.currentDocs) ? PDocsState.currentDocs.length : 0,
        total: PDocsState.docsTotal,
        hasMore: PDocsState.docsHasMore
    });
}

/** 回收站分页条 */
function renderPdocsTrashPager() {
    renderPdocsPager({
        wrap: $('pdocsTrashPager'),
        count: $('pdocsTrashCount'),
        moreBtn: $('pdocsTrashMoreBtn'),
        loaded: Array.isArray(PDocsState.currentTrash) ? PDocsState.currentTrash.length : 0,
        total: PDocsState.trashTotal,
        hasMore: PDocsState.trashHasMore
    });
}

function renderExplorerGrid() {
    const container = $('pdocsListContainer');
    if (!container) return;
    // 批量模式：只显示复选框（CSS），并禁用条目点击 / 快捷操作
    container.classList.toggle('pdocs-batch-mode', !!PDocsState.batchMode);

    const inFolder = (typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0);
    const upBtn = $('pdocsUpBtn');
    if (upBtn) upBtn.style.visibility = inFolder ? '' : 'hidden';

    if (PDocsState.currentDocs === null) {
        container.innerHTML = '<p class="loading-text">加载中...</p>';
        renderPdocsListPager();
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
                <div class="pdocs-explorer-item__icon" aria-hidden="true">⬆️</div>
                <button type="button" class="pdocs-explorer-item__name pdocs-explorer-item__open">返回上一级</button>
            </div>`);
    }

    subFolders.forEach(f => {
        items.push(`
            <div class="pdocs-explorer-item pdocs-explorer-item--folder" data-folder-id="${pdocsSafeValue(f.id)}" title="${escapeHtml(f.name)}">
                <div class="pdocs-explorer-item__icon" aria-hidden="true">📁</div>
                <button type="button" class="pdocs-explorer-item__name pdocs-explorer-item__open">${escapeHtml(f.name)}</button>
                <div class="pdocs-explorer-item__actions">
                    <button class="pdocs-explorer-item__btn" data-action="rename-folder" data-id="${pdocsSafeValue(f.id)}" title="重命名">✏️</button>
                    <button class="pdocs-explorer-item__btn" data-action="delete-folder" data-id="${pdocsSafeValue(f.id)}" title="删除">🗑</button>
                </div>
            </div>`);
    });

    docs.forEach(doc => {
        items.push(`
            <div class="pdocs-explorer-item pdocs-explorer-item--doc" data-doc-id="${pdocsSafeValue(doc.id)}" title="${escapeHtml(doc.title)}">
                <input type="checkbox" class="pdocs-explorer-item__check" data-action="select" data-id="${pdocsSafeValue(doc.id)}" ${PDocsState.selection.has(doc.id) ? 'checked' : ''} aria-label="选择这篇文档">
                <div class="pdocs-explorer-item__icon" aria-hidden="true">${escapeHtml(doc.icon || '📄')}</div>
                <button type="button" class="pdocs-explorer-item__name pdocs-explorer-item__open" title="浏览这篇文档">${escapeHtml(doc.title)}</button>
                <div class="pdocs-explorer-item__meta">${pdocsFmtTime(doc.updated_at)}</div>
                <div class="pdocs-explorer-item__actions">
                    <select class="pdocs-explorer-move" data-action="move" data-id="${pdocsSafeValue(doc.id)}" title="移动到文件夹">
                        <option value="" disabled selected>📁</option>
                        <option value="0">无文件夹</option>
                        ${PDocsState.folders.map(f => `<option value="${pdocsSafeValue(f.id)}" ${doc.folder_id === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
                    </select>
                    <button class="pdocs-explorer-item__btn" data-action="browse" data-id="${pdocsSafeValue(doc.id)}" title="浏览">👁</button>
                    <button class="pdocs-explorer-item__btn" data-action="edit" data-id="${pdocsSafeValue(doc.id)}" title="编辑">✏️</button>
                    <button class="pdocs-explorer-item__btn" data-action="delete" data-id="${pdocsSafeValue(doc.id)}" title="删除">🗑</button>
                </div>
            </div>`);
    });

    if (!items.length) {
        container.innerHTML = `
            <div class="pdocs-empty">
                <div class="pdocs-empty__icon">${inFolder ? '📂' : '📝'}</div>
                <p class="pdocs-empty__text">${inFolder ? '此文件夹为空' : '还没有文档，点击「新建文档」开始记录'}</p>
            </div>`;
        renderPdocsListPager();
        return;
    }

    container.innerHTML = items.join('');

    $$('.pdocs-explorer-item--folder', container).forEach(el => {
        on(el, 'click', (e) => {
            if (PDocsState.batchMode) return;   // 批量模式：只允许复选框选择
            if (e.target.closest('.pdocs-explorer-item__btn')) return;
            const fid = pdocsParseId(el.dataset.folderId);
            if (fid === null) {
                // 失败不要静默：旧写法 parseInt('') → NaN → navigateToFolder(NaN) 静默回根目录
                showToast('无法识别该文件夹的 ID，请刷新页面后重试', 'error');
                return;
            }
            navigateToFolder(fid);
        });
    });

    const upEl = container.querySelector('.pdocs-explorer-item--up');
    if (upEl) on(upEl, 'click', () => goUpOneLevel());

    $$('.pdocs-explorer-item--doc', container).forEach(el => {
        on(el, 'click', (e) => {
            if (PDocsState.batchMode) return;   // 批量模式：只允许复选框选择
            if (e.target.closest('.pdocs-explorer-item__btn') || e.target.closest('.pdocs-explorer-move')
                || e.target.closest('.pdocs-explorer-item__check')) return;
            const id = pdocsParseId(el.dataset.docId);
            if (id === null) {
                showToast('无法识别该文档的 ID，请刷新页面后重试', 'error');
                return;
            }
            openPdocsBrowser(id);
        });
    });

    $$('.pdocs-explorer-item__btn', container).forEach(btn => {
        on(btn, 'click', (e) => {
            e.stopPropagation();
            if (PDocsState.batchMode) return;   // 批量模式：快捷操作禁用
            const action = btn.dataset.action;
            // ⚠️ 旧写法 `parseInt(btn.dataset.id, 10)`：id=0 被渲染成 data-id=""（见 pdocsSafeValue）
            //    时得到 NaN，于是「编辑」走进了**空白新建**而不是编辑。这里严格校验，
            //    id 缺失 / 非法时给可见提示且**不发任何请求**。
            const id = pdocsParseId(btn.dataset.id);
            if (id === null) {
                console.error('[pdocs] 按钮缺少合法的 data-id，已取消操作:', action, btn.outerHTML || '');
                showToast('操作失败：这一项缺少有效的 ID，请刷新页面后重试', 'error');
                return;
            }
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
            if (PDocsState.batchMode) return;   // 批量模式：快捷操作禁用
            const docId = pdocsParseId(sel.dataset.id);
            // 下拉的 value="0" =「无文件夹」，是**合法**目标，0 必须保留（真值判断会把它当缺失）
            const folderId = pdocsParseId(sel.value);
            if (docId === null || folderId === null) {
                showToast('无法识别文档或目标文件夹，请刷新页面后重试', 'error');
                return;
            }
            movePersonalDoc(docId, folderId);
        });
        on(sel, 'click', (e) => e.stopPropagation());
    });

    // ⭐ C2：多选复选框（点击不冒泡到条目，否则会连带打开浏览视图）
    $$('.pdocs-explorer-item__check', container).forEach(cb => {
        on(cb, 'click', (e) => e.stopPropagation());
        on(cb, 'change', (e) => {
            e.stopPropagation();
            toggleSelectionIfReady('docs', pdocsParseId(cb.dataset.id), cb.checked);
        });
    });

    // 渲染完成后更新「加载更多」按钮与计数（它们在容器**之外**，不会被上面的 innerHTML 覆盖）
    renderPdocsListPager();
    // ⭐ C2：同步批量条的文件夹下拉与选中计数
    if (pdocsBulkModule) pdocsBulkModule.renderPdocsBulkMoveOptions();
    renderBulkBarIfReady('docs');
}

function navigateToFolder(folderId) {
    PDocsState.currentFolderId = (typeof folderId === 'number' && folderId > 0) ? folderId : null;
    PDocsState.currentDocs = null;
    resetPdocsDocsPaging();   // 换文件夹 = 换数据集：必须回到第 1 页
    if (window.DashUrl) window.DashUrl.write({ folder: PDocsState.currentFolderId, doc: null, mode: null });
    renderExplorerGrid();
    renderPdocsBreadcrumb();
    loadPersonalDocs();
}

function goUpOneLevel() {
    if (typeof PDocsState.currentFolderId !== 'number' || PDocsState.currentFolderId <= 0) return;
    const parent = PDocsState.folders.find(f => f.id === PDocsState.currentFolderId);
    const parentId = (parent && parent.parent_id) ? parent.parent_id : null;
    // 上一级同样是另一个数据集 —— 页码重置由 navigateToFolder() 统一负责
    navigateToFolder(parentId);
}

async function openPdocsBrowser(docId) {
    // 存在性判断，不是真值判断：`if (!docId)` 会把合法主键 0 当成「没有 id」
    if (!pdocsIsValidId(docId)) {
        showToast('无法识别该文档的 ID，请刷新页面后重试', 'error');
        return;
    }
    PDocsState.browserDocId = docId;
    PDocsState.browserDocSlug = null;
    if (window.DashUrl) window.DashUrl.write({ doc: docId, mode: 'browse' });
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
            <span>作者：${pdocsSafeValue(doc.author_username || doc.author_id, '-')}</span>
            <span>${vis}</span>
            <span>创建于 ${pdocsFmtTime(doc.created_at)}</span>
            <span>更新于 ${pdocsFmtTime(doc.updated_at)}</span>
        `;
    }
    if (contentEl) {
        await ensureMarkedLoaded();
        try {
            // marked 输出经白名单净化后再写入（sanitize.js 缺失时降级为纯文本）
            contentEl.innerHTML = pdocsRenderMarkdown(doc.content);
        } catch (e) {
            contentEl.innerHTML = `<pre>${escapeHtml(doc.content || '')}</pre>`;
        }
    }
}

function renderPdocsTrash(docs) {
    const container = $('pdocsTrashContainer');
    if (!container) return;
    container.classList.toggle('pdocs-batch-mode', !!PDocsState.trashBatchMode);

    if (!docs.length) {
        container.innerHTML = `
            <div class="pdocs-empty">
                <div class="pdocs-empty__icon">🗑</div>
                <p class="pdocs-empty__text">回收站为空</p>
            </div>`;
        renderPdocsTrashPager();
        return;
    }

    container.innerHTML = docs.map(doc => `
        <div class="pdocs-trash-item">
            <div class="pdocs-trash-item__info">
                <input type="checkbox" class="pdocs-explorer-item__check" data-action="select" data-id="${pdocsSafeValue(doc.id)}" ${PDocsState.trashSelection.has(doc.id) ? 'checked' : ''} aria-label="选择这篇文档">
                <span class="pdocs-trash-item__icon">${escapeHtml(doc.icon || '📄')}</span>
                <div>
                    <h4 class="pdocs-trash-item__title">${escapeHtml(doc.title)}</h4>
                    <span class="pdocs-trash-item__time">删除于 ${pdocsFmtTime(doc.deleted_at)}</span>
                </div>
            </div>
            <div class="pdocs-trash-item__actions">
                <button class="pdocs-btn pdocs-btn--secondary pdocs-btn--sm" data-action="restore" data-id="${pdocsSafeValue(doc.id)}">恢复</button>
                <button class="pdocs-btn pdocs-btn--danger pdocs-btn--sm" data-action="permanent" data-id="${pdocsSafeValue(doc.id)}">彻底删除</button>
            </div>
        </div>
    `).join('');

    $$('[data-action]', container).forEach(btn => {
        on(btn, 'click', () => {
            const action = btn.dataset.action;
            const id = pdocsParseId(btn.dataset.id);
            if (action === 'select') return;      // ⭐ C2：多选复选框由下面的绑定负责
            if (PDocsState.trashBatchMode) return;   // 批量模式：只允许复选框选择
            if (id === null) {
                console.error('[pdocs] 回收站按钮缺少合法的 data-id，已取消操作:', action);
                showToast('操作失败：这一项缺少有效的 ID，请刷新页面后重试', 'error');
                return;
            }
            if (action === 'restore') restorePersonalDoc(id);
            else if (action === 'permanent') permanentDeletePersonalDoc(id);
        });
    });

    // ⭐ C2：回收站多选复选框
    $$('.pdocs-explorer-item__check', container).forEach(cb => {
        on(cb, 'click', (e) => e.stopPropagation());
        on(cb, 'change', (e) => {
            e.stopPropagation();
            toggleSelectionIfReady('trash', pdocsParseId(cb.dataset.id), cb.checked);
        });
    });

    // 渲染完成后更新「加载更多」按钮与计数（容器之外的兄弟节点）
    renderPdocsTrashPager();
    // ⭐ C2：同步批量条的选中计数
    renderBulkBarIfReady('trash');
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
    // 归一化比较：后端 user_id 为数字，currentUserId 可能是数字或 JWT 字符串
    const myId = String(PDocsState.currentUserId);
    PDocsState.folders = all.filter(f => String(f.user_id) === myId);
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
            items.push(`<button class="pdocs-breadcrumb__item ${isLast ? 'is-active' : ''}" data-folder-id="${pdocsSafeValue(f.id)}">${escapeHtml(f.name)}</button>`);
        });
    }

    container.innerHTML = `<div class="pdocs-breadcrumb">${items.join('')}</div>`;

    $$('[data-folder-id]', container).forEach(btn => {
        on(btn, 'click', () => {
            const fid = btn.dataset.folderId;
            if (fid === '__root__') {
                navigateToFolder(null);
            } else {
                const folderId = pdocsParseId(fid);
                if (folderId === null) {
                    showToast('无法识别该文件夹的 ID，请刷新页面后重试', 'error');
                    return;
                }
                navigateToFolder(folderId);
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
export {
    initPersonalDocs,
    initPersonalDocsPanel,
    loadPersonalDocs,
    PDocsState,
    // P2-8（2026-10-25）：子模块（editor / bulk）反向依赖这些共享件
    pdocsRequest,
    pdocsRenderMarkdown,
    ensureMarkedLoaded,
    pdocsIsValidId,
    pdocsParseId,
    pdocsExtractSummary,
    pdocsFmtTime,
    pdocsSafeValue,
    showPdocsView,
    loadPersonalTrash,
    loadPersonalFolders,
    resetPdocsDocsPaging,
    resetPdocsTrashPaging,
    renderExplorerGrid,
    renderPdocsTrash,
};

// ===== 兼容层：挂载初始化函数到 window =====
//   initPersonalDocs      —— 绑定 + 加载（幂等），任何调用方都可用
//   initPersonalDocsPanel  —— 静态面板（#panel-docs）每次进入时调用：
//                             复位到列表视图 + 初始化（见 dashboard.menu.js::STATIC_PANEL_HOOKS）
window.initPersonalDocs = initPersonalDocs;
window.initPersonalDocsPanel = initPersonalDocsPanel;
window.loadPersonalDocs = loadPersonalDocs;

// ===== 导出导航动作（供 dashboard.js 从 URL 恢复时调用） =====
window.PDocsActions = {
    navigateToFolder,
    goUpOneLevel,
    openPdocsBrowser,
    openPdocsEditor,
    showPdocsView,
    loadPersonalDocs,
    loadPersonalFolders,
};