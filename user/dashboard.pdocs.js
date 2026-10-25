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

// =========================================
// ⭐ B2（2026-10-06）：文档插图上传
//   后端：POST /api/v0/document/<id>/media（multipart，字段名 `file`）
//        上限 config.MAX_DOC_MEDIA_SIZE = **1MB**、类型按魔数白名单、存 WebP。
// =========================================

//: 与后端 `config.MAX_DOC_MEDIA_SIZE` 对齐；Nginx 默认 client_max_body_size 也是 1MB。
var PDOCS_IMAGE_LIMIT = 1024 * 1024;

/** 把文件名换成 `.webp` 后缀（内容由 canvas 编成 WebP）。 */
function pdocsWebpName(name) {
    var base = String(name || 'image.png').replace(/\.[^.\/\\]+$/, '');
    return (base || 'image') + '.webp';
}

/**
 * 把图片压到 <= maxBytes（默认 1MB），返回 `{ blob, name }`。
 *
 * ⚠️ 这**不是优化项**：手机拍照常见 3~8MB，而后端与 Nginx 的硬上限都是 1MB ——
 *    不压缩几乎必然 413。策略：canvas 逐级降质（0.85 → 0.7 → 0.55），
 *    仍超限则按比例缩边（×0.8，最多 6 轮）；最终仍超限就把结果交给后端，
 *    由后端给出统一文案（前端不自己编造"太大"的判定）。
 * 任何异常都退回原文件（让后端的魔数/体积校验去拒绝，而不是前端静默吞掉）。
 */
function pdocsShrinkImage(file, maxBytes) {
    var LIMIT = maxBytes || PDOCS_IMAGE_LIMIT;
    return new Promise(function (resolve) {
        var passthrough = function () { resolve({ blob: file, name: file && file.name }); };
        if (!file || !file.type || file.type.indexOf('image/') !== 0) { passthrough(); return; }
        // 已经是小 WebP 就不必重编码（重编码只会掉画质）
        if (file.size <= LIMIT && file.type === 'image/webp') { passthrough(); return; }
        if (typeof document === 'undefined' || !document.createElement) { passthrough(); return; }

        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            var canvas = document.createElement('canvas');
            var scale = 1;
            var quality = 0.85;
            var attempt = 0;
            var encode = function () {
                canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                if (!canvas.toBlob) { passthrough(); return; }
                canvas.toBlob(function (blob) {
                    if (!blob) { passthrough(); return; }
                    if (blob.size <= LIMIT || attempt >= 6) {
                        resolve({ blob: blob, name: pdocsWebpName(file.name) });
                        return;
                    }
                    attempt += 1;
                    if (quality > 0.56) { quality -= 0.15; } else { scale *= 0.8; quality = 0.8; }
                    encode();
                }, 'image/webp', quality);
            };
            encode();
        };
        img.onerror = function () { URL.revokeObjectURL(url); passthrough(); };
        img.src = url;
    });
}

/**
 * 上传一张图片，返回**可插入正文的绝对 URL**。
 *
 * ⚠️ 不能用 `pdocsRequest()`：它强制 `Content-Type: application/json` 且对 body 做
 *    `JSON.stringify` → FormData 会被串成 `{}`。这里照 `user/dashboard.profile.js`
 *    上传头像的写法**手写 fetch**。
 */
async function pdocsUploadImage(file) {
    var token = AuthGuard.getToken();
    if (!token) { AuthGuard.handleAuthError(); throw new Error('登录已失效，请重新登录'); }
    var docId = pdocsIsValidId(PDocsState.editingId) ? PDocsState.editingId : null;
    if (docId === null) throw new Error('请先保存文档，再插入图片');

    var out = await pdocsShrinkImage(file, PDOCS_IMAGE_LIMIT);
    var fd = new FormData();
    fd.append('file', out.blob, out.name || 'image.webp');

    var res;
    try {
        res = await fetch(`${API_BASE_URL}/api/v0/document/${docId}/media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });
    } catch (e) {
        throw new Error('上传失败：网络错误');
    }
    if (res.status === 401) { AuthGuard.handleAuthError(); throw new Error('登录已失效，请重新登录'); }
    // ⚠️ 413 可能是 **Nginx** 自己回的 HTML 错误页（不是我们的 JSON）→ 必须先看状态码再解析
    if (res.status === 413) throw new Error('图片超过 1MB（压缩后仍超限），请换小图');

    var data = null;
    try { data = await res.json(); } catch (e) { throw new Error('上传失败：服务端返回异常'); }
    if (!res.ok || !data || data.code !== 200 || !data.data) {
        throw new Error((data && data.msg) || '上传失败');
    }
    // 后端给的是**绝对 URL**（相对路径在 gwl.net.cn 前端域下会 404）
    return data.data.url;
}

/** 上传并插入 Markdown 图片语法（工具栏按钮 / 粘贴 / 拖拽 三处共用）。 */
async function pdocsInsertImage(file) {
    var ed = PDocsState.editorInstance;
    if (!ed) return;
    try {
        if (window.showToast) window.showToast('正在上传图片…', 'info');
        var url = await pdocsUploadImage(file);
        var alt = String((file && file.name) || '图片').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '');
        var md = '![' + alt + '](' + url + ')';
        if (ed.codemirror && ed.codemirror.replaceSelection) ed.codemirror.replaceSelection(md);
        else if (typeof ed.value === 'function') ed.value(ed.value() + '\n' + md);
        if (window.showToast) window.showToast('图片已插入', 'success');
    } catch (e) {
        if (window.showToast) window.showToast((e && e.message) || '图片上传失败', 'error');
    }
}

// =========================================
// ⭐ B3（2026-10-06）：统一标签
//   接口：GET /api/v0/tags/suggest?q=      → 联想（公开）
//         GET/PUT /api/v0/tags/document/<id> → 读/全量替换（PUT 需该文档的编辑权）
//   限制与文案与后端逐字一致：最多 8 个、每个不超过 24 字。
// =========================================

var PDOCS_MAX_TAGS = 8;
var PDOCS_MAX_TAG_LEN = 24;

/** `[{"id","name"}]` 或字符串数组 → 输入框文本（逗号 + 空格分隔）。 */
function pdocsTagsToText(tags) {
    if (!Array.isArray(tags)) return '';
    return tags.map(function (t) {
        return (t && typeof t === 'object') ? String(t.name || '') : String(t || '');
    }).filter(Boolean).join(', ');
}

/**
 * 输入框文本 → 标签数组。
 * 支持中英文逗号与顿号；去重（**按小写归一**，与后端 `normalize_name` 同口径）；
 * 超限（>8 个 / 单个 >24 字）时**截断并回报**，不静默丢。
 */
function pdocsParseTagsText(text) {
    var raw = String(text || '').split(/[,，、]/);
    var seen = Object.create(null);
    var out = [];
    var dropped = 0;
    for (var i = 0; i < raw.length; i++) {
        var name = raw[i].trim().replace(/\s+/g, ' ');
        if (!name) continue;
        if (name.length > PDOCS_MAX_TAG_LEN) { dropped += 1; continue; }
        var key = name.toLowerCase();
        if (seen[key]) continue;
        if (out.length >= PDOCS_MAX_TAGS) { dropped += 1; continue; }
        seen[key] = 1;
        out.push(name);
    }
    return { tags: out, dropped: dropped };
}

/** 联想：填 `<datalist>`（失败静默 —— 联想是增强，不该弹错误）。 */
async function pdocsLoadTagSuggestions(q) {
    var list = $('pdocsTagSuggestions');
    if (!list || typeof window.apiRequest !== 'function') return;
    try {
        var res = await window.apiRequest('/api/v0/tags/suggest',
            { params: { q: q || '', limit: 10 }, silent: true });
        if (!res || res.code !== 200 || !res.data || !Array.isArray(res.data.items)) return;
        list.innerHTML = res.data.items.map(function (t) {
            return '<option value="' + escapeHtml(t.name || '') + '"></option>';
        }).join('');
    } catch (e) { /* 联想失败不打扰用户 */ }
}

/** 读某文档当前的标签（失败返回 null，调用方保留输入框原值）。 */
async function pdocsFetchDocTags(docId) {
    if (typeof window.apiRequest !== 'function') return null;
    try {
        var res = await window.apiRequest('/api/v0/tags/document/' + docId, { silent: true });
        if (!res || res.code !== 200 || !res.data) return null;
        return res.data.tags || [];
    } catch (e) { return null; }
}

/** 保存时同步标签（**全量替换**）。失败只提示，不回滚文档保存。 */
async function pdocsSaveDocTags(docId, text) {
    if (!pdocsIsValidId(docId) || typeof window.apiRequest !== 'function') return true;
    var parsed = pdocsParseTagsText(text);
    var hint = $('pdocsTagsHint');
    if (hint && parsed.dropped) {
        hint.textContent = '已忽略 ' + parsed.dropped + ' 个（最多 ' + PDOCS_MAX_TAGS
            + ' 个、每个不超过 ' + PDOCS_MAX_TAG_LEN + ' 字）';
    }
    try {
        var res = await window.apiRequest('/api/v0/tags/document/' + docId,
            { method: 'PUT', body: { tags: parsed.tags }, silent: true });
        if (!res || res.code !== 200) {
            showToast((res && res.msg) || '标签保存失败（文档本身已保存）', 'warning');
            return false;
        }
        return true;
    } catch (e) {
        showToast('标签保存失败（文档本身已保存）', 'warning');
        return false;
    }
}

// ============================================================
// ⭐ P2-8（2026-10-21 审查）：EasyMDE 懒加载
//
// 之前 dashboard.html 无条件 <link>/<script> 引入 EasyMDE（CSS 13 KB + 数百 KB JS），
// 只看通知 / 工作台也要下载。现在改成**第一次真正需要编辑器时**才注入
// （进入「个人文档」面板 → initPdocsEasyMDE 时），与 marked.js 的加载方式一致。
//
// 失败（离线 / 扩展拦截 / CSP 变动）不阻断流程：返回 false，调用方走既有的
// 「降级为纯文本 + 一次可见提示」路径。
// ============================================================
const EASYMDE_VERSION = '2.18.0';
const EASYMDE_CSS_URL = 'https://cdn.jsdelivr.net/npm/easymde@' + EASYMDE_VERSION + '/dist/easymde.min.css';
const EASYMDE_JS_URL = 'https://cdn.jsdelivr.net/npm/easymde@' + EASYMDE_VERSION + '/dist/easymde.min.js';
let easyMDELoading = null;

/** 首次调用时注入 CSS + JS；成功后 resolve(true)，失败 resolve(false) 并允许重试。 */
function ensureEasyMDELoaded() {
    if (window.EasyMDE && typeof window.EasyMDE === 'function') return Promise.resolve(true);
    if (easyMDELoading) return easyMDELoading;
    easyMDELoading = new Promise(function (resolve) {
        if (!document.getElementById('easymde-css')) {
            var link = document.createElement('link');
            link.id = 'easymde-css';
            link.rel = 'stylesheet';
            link.href = EASYMDE_CSS_URL;
            document.head.appendChild(link);
        }
        var s = document.createElement('script');
        s.src = EASYMDE_JS_URL;
        s.async = true;
        s.onload = function () {
            resolve(typeof window.EasyMDE === 'function');
        };
        s.onerror = function () {
            console.warn('[pdocs] EasyMDE 脚本加载失败');
            easyMDELoading = null;   // 允许下次进入时再试一次
            resolve(false);
        };
        document.head.appendChild(s);
    });
    return easyMDELoading;
}

async function initPdocsEasyMDE() {
    const textarea = $('pdocsContentInput');
    if (!textarea || PDocsState.editorInstance) return;
    // 并发保护：加载期间可能又被调用一次（进面板 + 直接点「编辑」），不能建两个实例
    if (PDocsState.editorInitPending) return;
    PDocsState.editorInitPending = true;
    const ready = await ensureEasyMDELoaded();
    PDocsState.editorInitPending = false;
    if (!ready || typeof window.EasyMDE !== 'function') {
        pdocsWarnEditorFallbackOnce();
        return;
    }
    if (PDocsState.editorInstance) return;   // 加载期间另一个调用已经建好了实例
    try {
        PDocsState.editorInstance = new window.EasyMDE({
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
                // 预览同样走白名单净化，避免编辑不可信内容时自伤
                preview.innerHTML = pdocsRenderMarkdown(plainText);
                return preview;
            },
            placeholder: '使用 Markdown 编写文档...',
            minHeight: '400px',
            status: ['lines', 'words', 'cursor'],
            // ⭐ B2：工具栏「image」按钮 → 上传到本站（选项名是 EasyMDE **2.x** 的
            //    `uploadImage(file, onSuccess, onError)`；1.x 的 imageUploadFunction 已移除）
            uploadImage: async function (file, onSuccess, onError) {
                try {
                    onSuccess(await pdocsUploadImage(file));
                } catch (e) {
                    onError((e && e.message) || '图片上传失败');
                }
            }
        });
        // ⚠️ `uploadImage` **只接管工具栏按钮**，粘贴与拖拽必须自己挂（两处都要 preventDefault，
        //    否则 EasyMDE 会插入文件路径或什么都不做）
        try {
            const cm = PDocsState.editorInstance && PDocsState.editorInstance.codemirror;
            if (cm) {
                cm.on('paste', function (cmInstance, e) {
                    const items = (e.clipboardData && e.clipboardData.items) || [];
                    for (let i = 0; i < items.length; i++) {
                        const it = items[i];
                        if (it && it.type && it.type.indexOf('image/') === 0) {
                            e.preventDefault();
                            const f = it.getAsFile && it.getAsFile();
                            if (f) pdocsInsertImage(f);
                            return;
                        }
                    }
                });
                const wrap = cm.getWrapperElement && cm.getWrapperElement();
                if (wrap && wrap.addEventListener) {
                    wrap.addEventListener('drop', function (e) {
                        const files = (e.dataTransfer && e.dataTransfer.files) || [];
                        for (let i = 0; i < files.length; i++) {
                            const f = files[i];
                            if (f && f.type && f.type.indexOf('image/') === 0) {
                                e.preventDefault();
                                pdocsInsertImage(f);
                                return;
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[pdocs] 图片粘贴/拖拽绑定失败（不影响其它功能）:', e);
        }
    } catch (e) {
        // ⭐ P2（2026-10-15 审查）：原来只 `console.error` —— CDN 被拦（离线/广告拦截器/
        //    CSP 变动）时编辑器**静默降级**成纯文本 textarea，用户以为"工具栏坏了"。
        //    现在给一次可见提示（用 sessionStorage 去重：切 tab 会反复进这里）。
        console.error('[pdocs] EasyMDE 初始化失败:', e);
        pdocsWarnEditorFallbackOnce();
    }
}

/** 编辑器降级提示：每个会话只说一次（切 tab 会重新跑 initPdocsEasyMDE） */
function pdocsWarnEditorFallbackOnce() {
    var KEY = 'pdocs-easymde-fallback-warned';
    try {
        if (window.sessionStorage && sessionStorage.getItem(KEY) === '1') return;
        if (window.sessionStorage) sessionStorage.setItem(KEY, '1');
    } catch (e) { /* 隐私模式：拿不到 storage，那就每次都提示 */ }
    if (typeof showToast === 'function') {
        showToast('富文本编辑器未能加载（可能是网络或浏览器扩展拦截），已切换为纯文本编辑，功能不受影响', 'warning');
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
        pdocsClearSelection('docs');
        if (btn) { btn.disabled = true; btn.textContent = '加载中...'; }
        await loadPersonalDocs({ append: true });
        if (btn) { btn.disabled = false; btn.textContent = '加载更多'; }
    });
    bind('pdocsTrashMoreBtn', async () => {
        const btn = $('pdocsTrashMoreBtn');
        pdocsClearSelection('trash');
        if (btn) { btn.disabled = true; btn.textContent = '加载中...'; }
        await loadPersonalTrash({ append: true });
        if (btn) { btn.disabled = false; btn.textContent = '加载更多'; }
    });
    // ⭐ 2026-10-18：批量编辑开关（进入后才显示复选框；退出清空选择）
    bind('pdocsBatchBtn', () => pdocsSetBatchMode('docs', !PDocsState.batchMode));
    bind('pdocsTrashBatchBtn', () => pdocsSetBatchMode('trash', !PDocsState.trashBatchMode));
    // ⭐ C2 批量条（按钮都在列表容器**之外**，绑定一次即可，不会随列表重绘丢失）
    bind('pdocsBulkSelectPageBtn', () => pdocsToggleSelectPage('docs'));
    bind('pdocsBulkClearBtn', () => pdocsClearSelection('docs'));
    bind('pdocsBulkDeleteBtn', () => pdocsBulkTrash('docs', 'delete'));
    bind('pdocsBulkMoveBtn', pdocsBulkMove);
    bind('pdocsBulkVisibilityBtn', pdocsBulkVisibility);
    bind('pdocsTrashBulkSelectPageBtn', () => pdocsToggleSelectPage('trash'));
    bind('pdocsTrashBulkClearBtn', () => pdocsClearSelection('trash'));
    bind('pdocsTrashBulkRestoreBtn', () => pdocsBulkTrash('trash', 'restore'));
    bind('pdocsTrashBulkPermanentBtn', () => pdocsBulkTrash('trash', 'permanent'));
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

    initPdocsEasyMDE();
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
    pdocsClearSelection('docs');
    pdocsClearSelection('trash');
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
    renderPdocsBulkBar('docs');
}

/** 重置回收站分页（⭐ C2：同样清空多选） */
function resetPdocsTrashPaging() {
    PDocsState.trashPage = 1;
    PDocsState.trashHasMore = false;
    PDocsState.trashTotal = 0;
    PDocsState.trashSeq++;
    PDocsState.trashSelection.clear();
    renderPdocsBulkBar('trash');
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

// =========================================
// ⭐ C2 批量操作（2026-10-11，能力补齐 C2 / TODO.txt C4）
//   后端：POST /document/batch/trash  {action:'delete'|'restore'|'permanent', ids:[…]}
//         POST /document/batch/update {ids:[…], folder_id?, visibility?, owning?}
//   ⚠️ 语义是「**逐条判权 + 部分成功**」：越权/状态不符的条目回在 `data.results` 里
//      （`ok:false` + 中文 `reason`），**不是**整批失败 —— 200 且 `skipped>0` 是正常结果。
//   ⚠️ 上限 100 篇/次（后端 `MAX_BATCH_IDS`）；前端也先拦一次，避免白跑一趟。
//   ⚠️ **不做撤销**（决策 §8 #16：危险动作只有二次确认）。
//   ⚠️ 批量条必须在两个列表容器**之外**（容器 innerHTML 每次整体覆盖）。
// =========================================

var PDOCS_BATCH_MAX = 100;

/** 批量条的状态容器：`docs` → 文档列表；`trash` → 回收站。 */
function pdocsBulkRefs(kind) {
    if (kind === 'trash') {
        return {
            bar: $('pdocsTrashBulkBar'), count: $('pdocsTrashBulkCount'),
            selectBtn: $('pdocsTrashBulkSelectPageBtn'), set: PDocsState.trashSelection,
            items: PDocsState.currentTrash || [], total: PDocsState.trashTotal,
            batchMode: !!PDocsState.trashBatchMode,
            container: $('pdocsTrashContainer'), toggleBtn: $('pdocsTrashBatchBtn')
        };
    }
    return {
        bar: $('pdocsListBulkBar'), count: $('pdocsListBulkCount'),
        selectBtn: $('pdocsBulkSelectPageBtn'), set: PDocsState.selection,
        items: PDocsState.currentDocs || [], total: PDocsState.docsTotal,
        batchMode: !!PDocsState.batchMode,
        container: $('pdocsListContainer'), toggleBtn: $('pdocsBatchBtn')
    };
}

/** 同步批量条：可见性 + 计数文案 + 「全选本页」按钮文案。 */
function renderPdocsBulkBar(kind) {
    const ref = pdocsBulkRefs(kind);
    if (!ref.bar) return;
    const pageIds = ref.items.map(d => d.id).filter(pdocsIsValidId);
    const allPageSelected = pageIds.length > 0 && pageIds.every(id => ref.set.has(id));
    if (ref.selectBtn) ref.selectBtn.textContent = allPageSelected ? '取消全选本页' : '全选本页';
    // ⭐ 2026-10-18：批量模式下即使 0 选中也显示批量条（用户需要看到「全选本页 / 完成」入口）
    ref.bar.style.display = (ref.batchMode || ref.set.size) ? 'flex' : 'none';
    if (ref.count) {
        const loaded = ref.items.length;
        const total = (typeof ref.total === 'number' && ref.total >= loaded) ? ref.total : loaded;
        ref.count.textContent = `已选 ${ref.set.size} / 本页 ${loaded} / 共 ${total}`;
    }
}

/**
 * ⭐ 2026-10-18：进入 / 退出「批量编辑」模式。
 *
 * 进入后：列表容器加 `pdocs-batch-mode`（CSS 只显示复选框、隐藏快捷操作），
 * 条目点击不再打开文档；退出时清空选择并把批量条收起。
 */
function pdocsSetBatchMode(kind, on) {
    const ref = pdocsBulkRefs(kind);
    const next = !!on;
    if (kind === 'trash') PDocsState.trashBatchMode = next;
    else PDocsState.batchMode = next;
    ref.set.clear();
    if (ref.container) ref.container.classList.toggle('pdocs-batch-mode', next);
    if (ref.toggleBtn) {
        ref.toggleBtn.textContent = next ? '✓ 完成' : '☑️ 批量编辑';
        ref.toggleBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
        ref.toggleBtn.classList.toggle('pdocs-btn--primary', next);
    }
    // 批量条里的「完成」按钮与工具栏按钮同义（同一状态，不另建一套）
    if (kind === 'trash') renderPdocsTrash(PDocsState.currentTrash || []);
    else renderExplorerGrid();
    renderPdocsBulkBar(kind);
}

/** 勾选/取消勾选一篇（内存 Set 与批量条保持同步）。 */
function pdocsToggleSelection(kind, docId, checked) {
    if (!pdocsIsValidId(docId)) return;
    const ref = pdocsBulkRefs(kind);
    if (checked) ref.set.add(docId); else ref.set.delete(docId);
    renderPdocsBulkBar(kind);
}

/** 清空某一侧的多选（并同步批量条）。 */
function pdocsClearSelection(kind) {
    pdocsBulkRefs(kind).set.clear();
    renderPdocsBulkBar(kind);
}

/** 「全选本页」：只作用于**当前已加载的这一页**（分页下"全选"语义含糊，见设计 §4.2.4）。 */
function pdocsToggleSelectPage(kind) {
    const ref = pdocsBulkRefs(kind);
    const pageIds = ref.items.map(d => d.id).filter(pdocsIsValidId);
    const allSelected = pageIds.length > 0 && pageIds.every(id => ref.set.has(id));
    pageIds.forEach(id => { if (allSelected) ref.set.delete(id); else ref.set.add(id); });
    // 勾选态只存在于 DOM：整块重渲染（列表本来就是整体替换，不做局部手术）
    if (kind === 'trash') renderPdocsTrash(PDocsState.currentTrash || []);
    else renderExplorerGrid();
}

/** 批量条的 `ids`（去重 + 升序，便于稳定日志与断言）。 */
function pdocsBatchIds(set) {
    return Array.from(set).filter(pdocsIsValidId).sort((a, b) => a - b);
}

/** 把批量结果汇总成人话（含被跳过条目的**原文案**）。 */
function pdocsBatchSummary(data, verb) {
    const results = (data && Array.isArray(data.results)) ? data.results : [];
    const skipped = results.filter(r => !r.ok);
    const reasons = [];
    skipped.forEach(r => {
        if (r.reason && reasons.indexOf(r.reason) === -1) reasons.push(r.reason);
    });
    let msg = `${verb}：成功 ${data.succeeded} 篇`;
    if (data.unchanged) msg += `、${data.unchanged} 篇无变更`;
    if (skipped.length) msg += `、跳过 ${skipped.length} 篇（${reasons.slice(0, 2).join('；')}）`;
    return msg;
}

/** 批量结果的统一处理：失败提示 / 成功 toast / **重拉第 1 页并清空选择**。 */
async function pdocsAfterBatch(res, verb) {
    if (!res || res.code !== 200) {
        showToast((res && res.msg) || '批量操作失败', 'error');
        return false;
    }
    showToast(pdocsBatchSummary(res.data, verb),
        (res.data.skipped || res.data.unchanged) ? 'info' : 'success');
    // ⭐ 动作后：重拉第 1 页并清空选择（reset* 里已 clear，列表整体重渲染）
    resetPdocsDocsPaging();
    resetPdocsTrashPaging();
    await loadPersonalDocs();
    await loadPersonalTrash();
    return true;
}

/** 批量软删 / 恢复 / 彻底删除（`action` 由后端白名单校验）。 */
async function pdocsBulkTrash(kind, action) {
    const ref = pdocsBulkRefs(kind);
    const ids = pdocsBatchIds(ref.set);
    if (!ids.length) return;
    if (ids.length > PDOCS_BATCH_MAX) {
        showToast(`一次最多操作 ${PDOCS_BATCH_MAX} 篇，请缩小选择范围`, 'error');
        return;
    }
    if (action === 'permanent') {
        // ⭐ 危险动作二次确认：列出前 3 个标题 + 「等 N 篇」（设计 §4.2.4 第 6 条）
        const titles = ref.items.filter(d => ref.set.has(d.id)).map(d => d.title || '(无标题)');
        const shown = titles.slice(0, 3).map(t => `《${t}》`).join('、');
        const more = titles.length > 3 ? ` 等 ${titles.length} 篇` : '';
        const ok = await Modal.confirm(
            `确定要彻底删除 ${shown}${more} 吗？此操作不可恢复。`,
            { title: '彻底删除', confirmText: '彻底删除', danger: true });
        if (!ok) return;
    }
    const verb = action === 'delete' ? '已移入回收站'
        : (action === 'restore' ? '已恢复' : '已彻底删除');
    const res = await pdocsRequest('/batch/trash', {
        method: 'POST', body: JSON.stringify({ action, ids })
    });
    await pdocsAfterBatch(res, verb);
}

/** 批量改元数据（`folder_id` / `visibility` + `owning`）。 */
async function pdocsBulkUpdate(fields, verb) {
    const ids = pdocsBatchIds(PDocsState.selection);
    if (!ids.length) return;
    if (ids.length > PDOCS_BATCH_MAX) {
        showToast(`一次最多操作 ${PDOCS_BATCH_MAX} 篇，请缩小选择范围`, 'error');
        return;
    }
    const res = await pdocsRequest('/batch/update', {
        method: 'POST', body: JSON.stringify(Object.assign({ ids }, fields))
    });
    await pdocsAfterBatch(res, verb);
}

/** 「移动到…」：读批量条上的文件夹下拉（0 = 无文件夹，是**合法**目标）。 */
async function pdocsBulkMove() {
    const sel = $('pdocsBulkMoveSelect');
    if (!sel || sel.value === '') {
        showToast('请先选择目标文件夹', 'error');
        return;
    }
    const folderId = pdocsParseId(sel.value);
    if (folderId === null) {
        showToast('无法识别目标文件夹，请刷新页面后重试', 'error');
        return;
    }
    await pdocsBulkUpdate({ folder_id: folderId }, '已移动');
}

/** 「改可见性」：只提供公开/私有两种（组可见性需要组名，本页不猜）。 */
async function pdocsBulkVisibility() {
    const sel = $('pdocsBulkVisibilitySelect');
    const visibility = sel ? sel.value : '';
    if (visibility !== 'public' && visibility !== 'private') {
        showToast('请选择目标可见性', 'error');
        return;
    }
    // ⚠️ 可见性与归属必须**成对**发送：公开文档的 owning 是 '0'，私有是自己的 id；
    //    只发 visibility 会让 owning 保持旧值（超管路径下会落成"公开但挂在某人名下"）。
    const owning = (visibility === 'public') ? '0' : String(PDocsState.currentUserId);
    await pdocsBulkUpdate({ visibility, owning }, '已改可见性');
}

/** 把文件夹列表灌进批量条的下拉（每次渲染列表时同步）。 */
function renderPdocsBulkMoveOptions() {
    const sel = $('pdocsBulkMoveSelect');
    if (!sel) return;
    const current = sel.value;
    const opts = ['<option value="0">无文件夹（根目录）</option>'];
    PDocsState.folders.forEach(f => {
        opts.push(`<option value="${pdocsSafeValue(f.id)}">${escapeHtml(f.name)}</option>`);
    });
    sel.innerHTML = opts.join('');
    sel.value = current;
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
            pdocsToggleSelection('docs', pdocsParseId(cb.dataset.id), cb.checked);
        });
    });

    // 渲染完成后更新「加载更多」按钮与计数（它们在容器**之外**，不会被上面的 innerHTML 覆盖）
    renderPdocsListPager();
    // ⭐ C2：同步批量条的文件夹下拉与选中计数
    renderPdocsBulkMoveOptions();
    renderPdocsBulkBar('docs');
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
            pdocsToggleSelection('trash', pdocsParseId(cb.dataset.id), cb.checked);
        });
    });

    // 渲染完成后更新「加载更多」按钮与计数（容器之外的兄弟节点）
    renderPdocsTrashPager();
    // ⭐ C2：同步批量条的选中计数
    renderPdocsBulkBar('trash');
}

async function openPdocsEditor(docId) {
    // `null` / `undefined` = 新建；其余必须是合法主键（**0 合法**）。
    // ⚠️ 旧写法 `docId || null` + `docId ? 'editor' : null`：id=0 会退化成「新建」——
    //    用户看到空白编辑器（以为文档丢了），保存时还会 POST 出一篇**重复文档**。
    const isNew = (docId === null || docId === undefined);
    if (!isNew && !pdocsIsValidId(docId)) {
        showToast('无法识别该文档的 ID，请刷新页面后重试', 'error');
        return;
    }
    const editId = isNew ? null : docId;
    PDocsState.editingId = editId;
    if (window.DashUrl) window.DashUrl.write({ doc: editId, mode: editId === null ? null : 'editor' });
    showPdocsView('editor');

    const titleInput = $('pdocsTitleInput');
    const preview = $('pdocsPreview');

    // ⭐ P2-8（2026-10-21 审查）：EasyMDE 此时才按需加载 —— 必须等它就绪再写值，
    //   否则 editorInstance 还是 null，正文会被静默丢掉。
    if (!PDocsState.editorInstance) await initPdocsEasyMDE();

    // ⭐ B3：标签输入复位 + 联想绑定（幂等；`dataset` 标记防重复绑定）
    const tagsInput = $('pdocsTagsInput');
    const tagsHint = $('pdocsTagsHint');
    if (tagsHint) tagsHint.textContent = '';
    if (tagsInput) {
        tagsInput.value = '';
        if (!tagsInput.dataset.pdocsTagsBound) {
            tagsInput.dataset.pdocsTagsBound = '1';
            let tagTimer = null;
            tagsInput.addEventListener('input', () => {
                clearTimeout(tagTimer);
                // 联想词 = 光标所在的那一段（最后一个逗号之后）
                const seg = tagsInput.value.split(/[,，、]/).pop().trim();
                tagTimer = setTimeout(() => pdocsLoadTagSuggestions(seg), 250);
            });
            tagsInput.addEventListener('focus', () => pdocsLoadTagSuggestions(''));
        }
    }

    if (isNew) {
        titleInput.value = '';
        if (PDocsState.editorInstance) PDocsState.editorInstance.value('');
        // ⭐ C1：新建没有版本基线（保存走 POST）
        PDocsState.editingVersion = null;
        PDocsState.editingBaseContent = null;
        // 新建：没有"原可见性"，保存用 private 默认值（见 savePersonalDoc）
        PDocsState.editingVisibility = null;
        PDocsState.editingPermissionBits = null;
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
    // ⭐ C1 编辑锁：记下"我基于哪一版、哪份正文"——保存时回传，供后端判冲突/自动合并
    PDocsState.editingVersion = pdocsParseId(data.data.version);
    PDocsState.editingBaseContent = data.data.content || '';
    // ⭐ P2（2026-10-15 审查）：记住**原本**的可见性 / 权限位，保存时原样带回 ——
    //    否则在浏览视图里编辑一篇公开文档再保存会把它悄悄改成私有。
    PDocsState.editingVisibility = (data.data && data.data.visibility) || null;
    PDocsState.editingPermissionBits = (data.data && data.data.permission_bits) || null;
    preview.style.display = 'none';
    preview.innerHTML = '';
    // ⭐ B3：把已存标签填回输入框（单独一个请求；失败保留空值，不阻塞编辑）
    if (tagsInput) {
        const savedTags = await pdocsFetchDocTags(docId);
        tagsInput.value = pdocsTagsToText(savedTags || []);
    }
}

/**
 * ⭐ C1（2026-10-11）**保存冲突对话框**（编辑锁）。
 *
 * 后端在「你基于的版本 ≠ 当前版本」时回 **409**，响应体带 `data.current_version` /
 * `editor_username`（文档域里唯一带 `data` 的错误体）。
 *
 * ⚠️ 为什么自己拼一个弹窗、而不是给 `js/modal.js` 加一个 `choose()`：
 *    `modal.js` 是**全站共享**文件（主站/org/发现页都加载），动它要连带提升所有页面的
 *    `?v=`（`file-wiki/09` §6.2 的硬约束）。这个三按钮对话框只在两处编辑文档的地方用到，
 *    放在本文件里代价更小、影响面为零。
 *
 * @returns {Promise<'copy'|'overwrite'|'cancel'>}
 */
function pdocsShowConflictDialog(conflict, editorName) {
    return new Promise((resolve) => {
        const M = window.Modal;
        const cur = pdocsSafeValue(conflict && conflict.current_version, '?');
        const who = editorName ? `（最后修改者：${escapeHtml(String(editorName))}）` : '';
        const message =
            `<p class="modal-message">这篇文档刚被别人改过：当前版本 <b>${cur}</b>，` +
            `而你正在编辑的是版本 <b>${pdocsSafeValue(PDocsState.editingVersion, '?')}</b>${who}。</p>` +
            `<p class="modal-message">如果两边改的不是同一处，点「用我的覆盖」会把你的版本存上去` +
            `（对方的改动可能被覆盖）；点「另存为副本」最安全，不会动对方的内容。</p>`;

        if (!M || typeof M._createModal !== 'function') {
            // 极端兜底：Modal 没加载成功时，用 confirm 两选一（不引入原生 alert）
            (window.Modal && window.Modal.confirm
                ? window.Modal.confirm('这篇文档刚被别人改过。点「确定」用我的版本覆盖，点「取消」放弃保存。',
                    { title: '文档已被他人修改', confirmText: '用我的覆盖' })
                : Promise.resolve(false)
            ).then((ok) => resolve(ok ? 'overwrite' : 'cancel'));
            return;
        }

        const buttons = [
            {
                text: '放弃我的修改', cls: 'modal-btn-cancel',
                onClick: () => { M._closeModal(modal); resolve('cancel'); }
            },
            {
                text: '用我的覆盖', cls: 'modal-btn-danger',
                onClick: () => { M._closeModal(modal); resolve('overwrite'); }
            },
            {
                text: '另存为副本', cls: 'modal-btn-confirm',
                onClick: () => { M._closeModal(modal); resolve('copy'); }
            }
        ];
        const modal = M._createModal({ title: '文档已被他人修改', content: message, buttons });
        M._showModal(modal);
    });
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

    // ⭐ P2（2026-10-15 审查）：可见性 / 权限位**沿用原文**，只有新建才用默认值。
    //    原先写死 'private' → 超管编辑一篇公开文档再保存会把它变成私有。
    const bodyObj = {
        title,
        content,
        summary: pdocsExtractSummary(content),
        visibility: PDocsState.editingVisibility || 'private',
        permission_bits: PDocsState.editingPermissionBits || '100000'
    };
    // 「是否编辑中」用存在性判断：editingId = 0 是合法主键。
    // ⚠️ 旧写法 `if (PDocsState.editingId)` 在 id=0 时走 else 分支 → **POST 新建一篇重复文档**。
    const editingId = pdocsIsValidId(PDocsState.editingId) ? PDocsState.editingId : null;
    if (editingId === null && typeof PDocsState.currentFolderId === 'number' && PDocsState.currentFolderId > 0) {
        bodyObj.folder_id = PDocsState.currentFolderId;
    }

    // ⭐ C1 编辑锁：编辑既有文档时带上「我基于哪一版 + 我读到的那份正文」。
    //    版本号让后端能判冲突；base_content 让后端在改动行不重叠时**自动合并**。
    //    ⚠️ 不带 version 后端不判定（兼容路径）——所以能带就必须带。
    let forceVersion = null;
    if (editingId !== null) {
        if (pdocsIsValidId(PDocsState.editingVersion)) {
            bodyObj.version = PDocsState.editingVersion;
            if (typeof PDocsState.editingBaseContent === 'string') {
                bodyObj.base_content = PDocsState.editingBaseContent;
            }
        }
    }

    let data;
    if (editingId !== null) {
        data = await pdocsRequest('/' + editingId, { method: 'PUT', body: JSON.stringify(bodyObj) });
    } else {
        data = await pdocsRequest('/', { method: 'POST', body: JSON.stringify(bodyObj) });
    }

    // ⭐ C1：版本冲突 → 交给用户决定（另存为副本 / 用我的覆盖 / 放弃）。
    //    自动合并成功时后端回 200 + msg「已自动合并他人修改」，顺便提示一下。
    if (data && data.code === 409 && editingId !== null) {
        const choice = await pdocsShowConflictDialog(data.data || {}, (data.data || {}).editor_username);
        if (choice === 'cancel') {
            setBtnState(saveBtn, false);
            saveBtn.textContent = '保存';
            showToast('已放弃本次保存（你的改动还在编辑器里）', 'info');
            return;
        }
        if (choice === 'copy') {
            // 另存为副本：标题加后缀避免与原文重名（slug 由后端自动生成）
            const copyBody = JSON.stringify({
                title: title + '（副本）',
                content,
                summary: pdocsExtractSummary(content),
                visibility: 'private',
                permission_bits: '100000'
            });
            data = await pdocsRequest('/', { method: 'POST', body: copyBody });
            if (data && data.code === 200) showToast('已另存为副本，原文没有被改动', 'success');
        } else {
            // 用我的覆盖：拿**当前**版本号重发一次（这是一次显式的、用户确认过的覆盖）
            forceVersion = pdocsParseId((data.data || {}).current_version);
            bodyObj.version = forceVersion;
            delete bodyObj.base_content;   // 覆盖语义：不做合并
            data = await pdocsRequest('/' + editingId, { method: 'PUT', body: JSON.stringify(bodyObj) });
        }
    }

    setBtnState(saveBtn, false);
    saveBtn.textContent = '保存';

    if (!data || data.code !== 200) {
        showToast(data?.msg || '保存失败', 'error');
        return;
    }

    // 保存成功 → 用服务端返回的**新**版本号刷新基线（否则下一次保存必然误报冲突）
    if (data.data && pdocsIsValidId(data.data.id)) {
        PDocsState.editingId = data.data.id;
        PDocsState.editingVersion = pdocsParseId(data.data.version);
        PDocsState.editingBaseContent = data.data.content || content;
        // 保存成功后同步基线（后端可能规范化过字段）
        PDocsState.editingVisibility = (data.data && data.data.visibility) || PDocsState.editingVisibility;
        PDocsState.editingPermissionBits = (data.data && data.data.permission_bits) || PDocsState.editingPermissionBits;
    }
    if (data.msg === '已自动合并他人修改') {
        showToast('已自动合并他人修改（你们改的不是同一处）', 'success');
    } else {
        showToast(forceVersion !== null ? '已用你的版本覆盖' : '保存成功', 'success');
    }
    // ⭐ B3：标签随保存一起提交（**全量替换**；失败只提示，不回滚文档保存）
    const tagsEl = $('pdocsTagsInput');
    if (tagsEl) await pdocsSaveDocTags(PDocsState.editingId, tagsEl.value);
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
        // marked 输出经白名单净化后再写入（sanitize.js 缺失时降级为纯文本）
        preview.innerHTML = pdocsRenderMarkdown(content);
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
export { initPersonalDocs, initPersonalDocsPanel, loadPersonalDocs, PDocsState };

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