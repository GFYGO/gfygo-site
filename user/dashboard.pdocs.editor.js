/**
 * dashboard.pdocs.editor.js
 * 个人文档「编辑器」子模块（P2-8 拆模块，2026-10-25）。
 *
 * 只在**第一次**点「新建 / 编辑」时由 dashboard.pdocs.js 动态 `import()`：
 * 含 EasyMDE 加载、图片上传、标签读写、冲突弹窗、预览。首屏不解析这些代码。
 *
 * 反向依赖：state / 请求 / Markdown 渲染等共享件从 dashboard.pdocs.js 导入
 * （那边对本文件的 import 是动态的，已求值完，ESM 循环安全）。
 */
import {
    PDocsState,
    pdocsRequest,
    pdocsRenderMarkdown,
    ensureMarkedLoaded,
    pdocsIsValidId,
    pdocsParseId,
    pdocsExtractSummary,
    pdocsSafeValue,
    showPdocsView,
} from './dashboard.pdocs.js';

var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL;
var $ = window.$;
var on = window.on;
var showToast = window.showToast;
var escapeHtml = window.escapeHtml;
var setBtnState = window.setBtnState;

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

// ===== 子模块导出（主模块的包装函数转调这些） =====
export {
    openPdocsEditor,
    savePersonalDoc,
    togglePdocsPreview,
    renderPdocsPreview,
    initPdocsEasyMDE,
    ensureEasyMDELoaded,
    pdocsUploadImage,
    pdocsInsertImage,
    pdocsSaveDocTags,
    pdocsLoadTagSuggestions,
    pdocsShowConflictDialog,
};
