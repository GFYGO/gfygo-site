/**
 * test.js — 前端测试面板核心逻辑
 * 功能：展示所有前端缓存数据 + 按钮触发各项 API/UI 功能
 */
(function () {
    'use strict';

    /** 安全读取对象属性，避免因变量未定义而报错 */
    function safeGet(obj, path, fallback) {
        try {
            const parts = path.split('.');
            let cur = obj;
            for (const p of parts) {
                if (cur === null || cur === undefined || cur[p] === undefined) return fallback;
                cur = cur[p];
            }
            return cur !== undefined && cur !== null ? cur : fallback;
        } catch { return fallback; }
    }

    /** 格式化 JSON 为可读字符串 */
    function fmtJSON(obj) {
        try {
            return JSON.stringify(obj, null, 2);
        } catch {
            try { return String(obj); } catch { return '(无法序列化)'; }
        }
    }

    /** 安全获取 Map/Set 内容 */
    function fmtMap(map) {
        if (!map || typeof map.entries !== 'function') return String(map);
        const obj = {};
        for (const [k, v] of map.entries()) {
            obj[k] = v;
        }
        return fmtJSON(obj);
    }

    function fmtSet(set) {
        if (!set || typeof set.values !== 'function') return String(set);
        return fmtJSON(Array.from(set));
    }

    // =========================================
    // 缓存数据采集
    // =========================================

    /** 采集 localStorage 所有缓存 */
    function collectLocalStorage() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            try {
                const val = localStorage.getItem(key);
                try { data[key] = JSON.parse(val); } catch { data[key] = val; }
            } catch { data[key] = '(读取失败)'; }
        }
        return data;
    }

    /** 采集全局配置 */
    function collectGlobalConfig() {
        const data = {
            API_BASE_URL: safeGet(window, 'API_BASE_URL', '未定义'),
            BASE_PATH: safeGet(window, 'BASE_PATH', '未定义'),
            TOKEN_KEY: safeGet(window, 'TOKEN_KEY', '未定义'),
            AuthGuard: {
                hasToken: safeGet(window, 'AuthGuard.getToken', null) ? (function() { try { return !!AuthGuard.getToken(); } catch { return false; } })() : 'AuthGuard 未定义'
            },
            __nowPermission: safeGet(window, '__nowPermission', '未定义'),
        };
        // 尝试获取 token 值
        try {
            if (typeof AuthGuard !== 'undefined' && AuthGuard.getToken) {
                const token = AuthGuard.getToken();
                data.AuthGuard.token = token ? token.substring(0, 30) + '...' : null;
                data.AuthGuard.tokenPayload = (function() {
                    try {
                        const raw = AuthGuard.getToken();
                        if (!raw) return null;
                        const parts = raw.split('.');
                        if (parts.length < 2) return null;
                        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                        while (b64.length % 4) b64 += '=';
                        return JSON.parse(atob(b64));
                    } catch { return '(解析失败)'; }
                })();
            }
        } catch { data.AuthGuard.error = 'AuthGuard 访问异常'; }
        return data;
    }

    /** 采集内存状态 */
    function collectMemoryState() {
        const data = {
            ROLE_NAMES: safeGet(window, 'ROLE_NAMES', '未定义'),
            __adminLevel: safeGet(window, '__adminLevel', null),
            __adminName: safeGet(window, '__adminName', null),
            DEFAULT_BANNER: safeGet(window, 'DEFAULT_BANNER', null),
            DEFAULT_AVATAR: safeGet(window, 'DEFAULT_AVATAR', null),
            pendingEmailCode: safeGet(window, 'pendingEmailCode', null),
            STATIC_TABS: safeGet(window, 'STATIC_TABS', null),
        };
        // ThemeEngine 状态
        try {
            if (typeof ThemeEngine !== 'undefined') {
                data.ThemeEngine = {
                    currentTheme: ThemeEngine.currentTheme || ThemeEngine.getCurrentTheme ? ThemeEngine.getCurrentTheme() : null
                };
            }
        } catch { data.ThemeEngine = '访问异常'; }
        // dynamicMenuCache
        try {
            if (typeof dynamicMenuCache !== 'undefined') {
                data.dynamicMenuCache = (function() {
                    const obj = {};
                    dynamicMenuCache.forEach((v, k) => { obj[k] = v; });
                    return obj;
                })();
            }
        } catch { data.dynamicMenuCache = '未定义'; }
        // staticPanelLoaded
        try {
            if (typeof staticPanelLoaded !== 'undefined') {
                data.staticPanelLoaded = Array.from(staticPanelLoaded);
            }
        } catch { data.staticPanelLoaded = '未定义'; }
        return data;
    }

    /** 采集 __DOC 文档中心状态 */
    function collectDocState() {
        try {
            if (typeof __DOC === 'undefined') return { status: '未加载（当前页面没有 document.js）' };
            const doc = __DOC;
            return {
                docsCount: Array.isArray(doc.docs) ? doc.docs.length : 0,
                foldersCount: Array.isArray(doc.folders) ? doc.folders.length : 0,
                currentFolderId: doc.currentFolderId,
                visFilter: doc.visFilter,
                currentSlug: doc.currentSlug,
                isAdmin: doc.isAdmin,
                user: doc.user,
                revisionsCount: Array.isArray(doc.revisions) ? doc.revisions.length : 0,
                markedReady: doc.markedReady,
            };
        } catch { return { status: '访问异常' }; }
    }

    /** 采集 Dashboard 文档状态 */
    function collectDashboardState() {
        const data = {};
        // 个人文档状态
        try {
            if (typeof pdocsEditingId !== 'undefined') {
                data.pdocsEditingId = pdocsEditingId;
                data.pdocsMarkedReady = pdocsMarkedReady;
                data.pdocsFoldersCount = Array.isArray(pdocsFolders) ? pdocsFolders.length : 0;
                data.pdocsCurrentFolderId = pdocsCurrentFolderId;
                data.pdocsCurrentUserId = pdocsCurrentUserId;
                data.pdocsCurrentDocs = pdocsCurrentDocs ? pdocsCurrentDocs.length + ' 条文档' : null;
                data.pdocsEditorInstance = pdocsEditorInstance ? '已初始化' : null;
            }
        } catch { data.pdocs = '未定义'; }
        // 公有文档状态
        try {
            if (typeof pubdocsEditorInstance !== 'undefined') {
                data.pubdocsEditorInstance = pubdocsEditorInstance ? '已初始化' : null;
            }
        } catch { /* ignore */ }
        // superadmin 公有文档状态
        try {
            if (typeof pubdocsEditingId !== 'undefined') {
                data.pubdocsEditingId = pubdocsEditingId;
                data.pubdocsFoldersCount = Array.isArray(pubdocsFolders) ? pubdocsFolders.length : 0;
                data.pubdocsCurrentFolderId = pubdocsCurrentFolderId;
            }
        } catch { /* ignore */ }
        if (Object.keys(data).length === 0) {
            data.status = '未加载（当前页面没有 dashboard.js）';
        }
        return data;
    }

    /** 刷新所有缓存视图 */
    function refreshAll() {
        setText('cacheLocalStorage', fmtJSON(collectLocalStorage()));
        setText('cacheGlobalConfig', fmtJSON(collectGlobalConfig()));
        setText('cacheMemoryState', fmtJSON(collectMemoryState()));
        setText('cacheDocState', fmtJSON(collectDocState()));
        setText('cacheDashboardState', fmtJSON(collectDashboardState()));
    }

    /** 切换缓存区域的折叠/展开 */
    window.toggleSection = function (header) {
        const body = header.nextElementSibling;
        if (body) {
            body.style.display = body.style.display === 'none' ? '' : 'none';
        }
    };

    function setText(id, text) {
        const el = document.getElementById(id);
        if (!el) return;
        const pre = el.querySelector('pre');
        if (pre) pre.textContent = text;
    }

    function appendApiOutput(title, data) {
        const el = document.getElementById('apiOutput');
        if (!el) return;
        const pre = el.querySelector('pre');
        if (!pre) return;
        const now = new Date().toLocaleTimeString();
        const separator = '\n' + '─'.repeat(50) + '\n';
        const block = `[${now}] ${title}\n${fmtJSON(data)}`;
        // 保留最新 20 条
        const lines = (pre.textContent + separator + block).split('\n');
        const MAX_LINES = 500;
        const trimmed = lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
        pre.textContent = trimmed.join('\n');
        pre.scrollTop = pre.scrollHeight;
    }

    function showError(msg) {
        appendApiOutput('⚠️ 错误', { error: msg });
    }

    // =========================================
    // 通用请求辅助
    // =========================================

    /** 发起带认证的 GET 请求 */
    async function authedGet(url, withAdminCtx) {
        const token = AuthGuard.getToken();
        const headers = { 'Authorization': `Bearer ${token}` };
        if (withAdminCtx) { headers['X-Permission-Context'] = 'admin'; }
        const r = await fetch(url, { headers });
        return r.json();
    }

    /** 发起带认证的 POST/PUT/DELETE 请求 */
    async function authedJson(method, url, body, withAdminCtx) {
        const token = AuthGuard.getToken();
        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
        if (withAdminCtx) { headers['X-Permission-Context'] = 'admin'; }
        const opts = { method, headers };
        if (body !== undefined) { opts.body = JSON.stringify(body); }
        const r = await fetch(url, opts);
        return r.json();
    }

    // =========================================
    // 公共 API 测试函数
    // =========================================

    window.testApi = {
        async authStatus() {
            appendApiOutput('➡️ GET /auth/status', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v0/auth/status', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /auth/status', d);
            } catch (e) { showError(e.message); }
        },

        async authProfile() {
            appendApiOutput('➡️ GET /user/profile', { loading: true });
            try {
                const token = AuthGuard.getToken();
                if (!token) { showError('未登录，无 token'); return; }
                const r = await fetch(API_BASE_URL + '/api/v0/user/profile', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await r.json();
                appendApiOutput('✅ GET /user/profile', d);
            } catch (e) { showError(e.message); }
        },

        async authLogout() {
            appendApiOutput('➡️ POST /auth/logout', { loading: true });
            try {
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/auth/logout');
                appendApiOutput('✅ POST /auth/logout', d);
            } catch (e) { showError(e.message); }
        },

        async authEmailStatus() {
            appendApiOutput('➡️ GET /auth/email-status', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/auth/email-status');
                appendApiOutput('✅ GET /auth/email-status', d);
            } catch (e) { showError(e.message); }
        },

        async switchPerm(level) {
            appendApiOutput('➡️ POST /auth/switch-permission → Lv' + level, { loading: true });
            try {
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/auth/switch-permission', { target_level: level });
                // 切换成功后刷新 token（如果后端返回了新 token）
                if (d.code === 200 && d.data && d.data.token) {
                    AuthGuard.setToken(d.data.token);
                    appendApiOutput('🔄 Token 已刷新', { new_level: level });
                }
                appendApiOutput('✅ POST /auth/switch-permission Lv' + level, d);
                refreshAll();
            } catch (e) { showError(e.message); }
        },

        async tempAccess() {
            appendApiOutput('➡️ POST /auth/temp-access', { loading: true });
            try {
                const username = prompt('输入临时访问用户名：');
                if (!username) { showError('已取消'); return; }
                const code = prompt('输入邀请码：');
                if (!code) { showError('已取消'); return; }
                const r = await fetch(API_BASE_URL + '/api/v0/auth/temp-access', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, invite_code: code })
                });
                const d = await r.json();
                appendApiOutput('✅ POST /auth/temp-access', d);
            } catch (e) { showError(e.message); }
        },

        async globalNotifications() {
            appendApiOutput('➡️ GET /notify/global', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v0/notify/global', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /notify/global', d);
            } catch (e) { showError(e.message); }
        },

        async adminNotifications() {
            appendApiOutput('➡️ GET /admin/notifications', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/notifications', true);
                appendApiOutput('✅ GET /admin/notifications', d);
            } catch (e) { showError(e.message); }
        },

        // ---- 文档 ----

        async docList() {
            appendApiOutput('➡️ GET /document/list (default)', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v0/document/list', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /document/list', d);
            } catch (e) { showError(e.message); }
        },

        async docPublic() {
            appendApiOutput('➡️ GET /document/list?scope=public', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v0/document/list?scope=public', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /document/list?scope=public', d);
            } catch (e) { showError(e.message); }
        },

        async docMine() {
            appendApiOutput('➡️ GET /document/mine', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/document/mine');
                appendApiOutput('✅ GET /document/mine', d);
            } catch (e) { showError(e.message); }
        },

        async docTrash() {
            appendApiOutput('➡️ GET /document/trash', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/document/trash');
                appendApiOutput('✅ GET /document/trash', d);
            } catch (e) { showError(e.message); }
        },

        async docFolders() {
            appendApiOutput('➡️ GET /document/folders?scope=public', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v0/document/folders?scope=public', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /document/folders', d);
            } catch (e) { showError(e.message); }
        },

        async docDetail() {
            const slug = document.getElementById('docSlugInput').value.trim();
            if (!slug) { showError('请输入文档 slug'); return; }
            appendApiOutput('➡️ GET /document/' + slug, { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v0/document/' + encodeURIComponent(slug), { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /document/' + slug, d);
            } catch (e) { showError(e.message); }
        },

        async docCreate() {
            appendApiOutput('➡️ POST /document/', { loading: true });
            try {
                const title = prompt('输入文档标题：', '测试文档 ' + Date.now());
                if (!title) { showError('已取消'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/document/', {
                    title, content: '这是通过测试面板创建的文档。', visibility: 'private'
                });
                appendApiOutput('✅ POST /document/', d);
            } catch (e) { showError(e.message); }
        },

        async docRevisions() {
            appendApiOutput('➡️ GET /document/<id>/revisions', { loading: true });
            try {
                const id = prompt('输入文档 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedGet(API_BASE_URL + '/api/v0/document/' + id + '/revisions');
                appendApiOutput('✅ GET /document/' + id + '/revisions', d);
            } catch (e) { showError(e.message); }
        },

        async docRestore() {
            appendApiOutput('➡️ POST /document/<id>/restore', { loading: true });
            try {
                const id = prompt('输入要恢复的文档 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/document/' + id + '/restore');
                appendApiOutput('✅ POST /document/' + id + '/restore', d);
            } catch (e) { showError(e.message); }
        },

        async docDelete() {
            appendApiOutput('➡️ DELETE /document/<id>', { loading: true });
            try {
                const id = prompt('输入要删除的文档 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('DELETE', API_BASE_URL + '/api/v0/document/' + id);
                appendApiOutput('✅ DELETE /document/' + id, d);
            } catch (e) { showError(e.message); }
        },

        // ---- 文件夹 ----

        async docFolderCreate() {
            appendApiOutput('➡️ POST /document/folders', { loading: true });
            try {
                const name = prompt('输入文件夹名称：', '测试文件夹');
                if (!name) { showError('已取消'); return; }
                const scope = prompt('输入 scope (private/public/group)：', 'private');
                if (!scope) { showError('已取消'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/document/folders', { name, scope });
                appendApiOutput('✅ POST /document/folders', d);
            } catch (e) { showError(e.message); }
        },

        async docFolderPath() {
            appendApiOutput('➡️ GET /document/folders/<id>/path', { loading: true });
            try {
                const id = prompt('输入文件夹 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedGet(API_BASE_URL + '/api/v0/document/folders/' + id + '/path');
                appendApiOutput('✅ GET /document/folders/' + id + '/path', d);
            } catch (e) { showError(e.message); }
        },

        // ---- 用户 ----

        async userMenu() {
            appendApiOutput('➡️ GET /user/menu', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/user/menu');
                appendApiOutput('✅ GET /user/menu', d);
            } catch (e) { showError(e.message); }
        },

        async userStats() {
            appendApiOutput('➡️ GET /user/stats', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/user/stats');
                appendApiOutput('✅ GET /user/stats', d);
            } catch (e) { showError(e.message); }
        },

        async userTheme() {
            appendApiOutput('➡️ PUT /user/theme', { loading: true });
            try {
                const theme = prompt('输入主题名 (green/light/gray/dark_green)：', 'light');
                if (!theme) { showError('已取消'); return; }
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/user/theme', { theme });
                appendApiOutput('✅ PUT /user/theme', d);
                refreshAll();
            } catch (e) { showError(e.message); }
        },

        async userDeletionStatus() {
            appendApiOutput('➡️ GET /user/deletion-status', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/user/deletion-status');
                appendApiOutput('✅ GET /user/deletion-status', d);
            } catch (e) { showError(e.message); }
        },

        async userCancelDeletion() {
            appendApiOutput('➡️ POST /user/cancel-deletion', { loading: true });
            try {
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/user/cancel-deletion');
                appendApiOutput('✅ POST /user/cancel-deletion', d);
            } catch (e) { showError(e.message); }
        },

        // ---- 管理 ----

        async adminUsers() {
            appendApiOutput('➡️ GET /admin/users', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/users', true);
                appendApiOutput('✅ GET /admin/users', d);
            } catch (e) { showError(e.message); }
        },

        async adminStats() {
            appendApiOutput('➡️ GET /admin/stats', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/stats', true);
                appendApiOutput('✅ GET /admin/stats', d);
            } catch (e) { showError(e.message); }
        },

        async adminMenuItems() {
            appendApiOutput('➡️ GET /admin/menu-items', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/menu-items', true);
                appendApiOutput('✅ GET /admin/menu-items', d);
            } catch (e) { showError(e.message); }
        },

        async adminPermNodes() {
            appendApiOutput('➡️ GET /admin/permission-nodes', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/permission-nodes', true);
                appendApiOutput('✅ GET /admin/permission-nodes', d);
            } catch (e) { showError(e.message); }
        },

        async adminInviteCodes() {
            appendApiOutput('➡️ GET /admin/invite-codes', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/invite-codes', true);
                appendApiOutput('✅ GET /admin/invite-codes', d);
            } catch (e) { showError(e.message); }
        },

        async adminGroups() {
            appendApiOutput('➡️ GET /admin/groups', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/groups', true);
                appendApiOutput('✅ GET /admin/groups', d);
            } catch (e) { showError(e.message); }
        },

        async adminDocuments() {
            appendApiOutput('➡️ GET /admin/documents', { loading: true });
            try {
                const d = await authedGet(API_BASE_URL + '/api/v0/admin/documents', true);
                appendApiOutput('✅ GET /admin/documents', d);
            } catch (e) { showError(e.message); }
        },

        async adminCreateNotification() {
            appendApiOutput('➡️ POST /admin/notifications', { loading: true });
            try {
                const title = prompt('通知标题：', '测试通知');
                if (!title) { showError('已取消'); return; }
                const content = prompt('通知内容：', '这是通过测试面板创建的通知。');
                if (!content) { showError('已取消'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/admin/notifications',
                    { title, content }, true);
                appendApiOutput('✅ POST /admin/notifications', d);
            } catch (e) { showError(e.message); }
        },

        async adminPermAssignments() {
            appendApiOutput('➡️ GET /admin/permission-assignments', { loading: true });
            try {
                const t = prompt('类型 (level/user/group)：', 'level');
                if (!t) { showError('已取消'); return; }
                const id = prompt('scope_id：', '1');
                if (id === null) { showError('已取消'); return; }
                const lv = prompt('level：', '1');
                const url = API_BASE_URL + '/api/v0/admin/permission-assignments?type=' + encodeURIComponent(t) + '&id=' + encodeURIComponent(id) + (lv ? '&level=' + encodeURIComponent(lv) : '');
                const d = await authedGet(url, true);
                appendApiOutput('✅ GET /admin/permission-assignments', d);
            } catch (e) { showError(e.message); }
        },

        async adminUserDetail() {
            appendApiOutput('➡️ GET /admin/users?q=', { loading: true });
            try {
                const q = prompt('搜索用户名（留空显示全部）：');
                if (q === null) { showError('已取消'); return; }
                const url = API_BASE_URL + '/api/v0/admin/users' + (q ? '?q=' + encodeURIComponent(q) : '');
                const d = await authedGet(url, true);
                appendApiOutput('✅ GET /admin/users', d);
            } catch (e) { showError(e.message); }
        },

        // ===== 新增的 Auth 方法 =====

        async authRegisterEmail() {
            appendApiOutput('➡️ POST /auth/register/email', { loading: true });
            try {
                const email = prompt('邮箱地址：');
                if (!email) { showError('已取消'); return; }
                const username = prompt('用户名：');
                if (!username) { showError('已取消'); return; }
                const password = prompt('密码：');
                if (!password) { showError('已取消'); return; }
                const r = await fetch(API_BASE_URL + '/api/v0/auth/register/email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, username, password })
                });
                const d = await r.json();
                appendApiOutput('✅ POST /auth/register/email', d);
            } catch (e) { showError(e.message); }
        },

        async authRegisterPhone() {
            appendApiOutput('➡️ POST /auth/register/phone', { loading: true });
            try {
                const phone = prompt('手机号：');
                if (!phone) { showError('已取消'); return; }
                const username = prompt('用户名：');
                if (!username) { showError('已取消'); return; }
                const password = prompt('密码：');
                if (!password) { showError('已取消'); return; }
                const r = await fetch(API_BASE_URL + '/api/v0/auth/register/phone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, username, password })
                });
                const d = await r.json();
                appendApiOutput('✅ POST /auth/register/phone', d);
            } catch (e) { showError(e.message); }
        },

        async authVerifyEmail() {
            appendApiOutput('➡️ POST /auth/verify-email', { loading: true });
            try {
                const code = prompt('输入邮箱验证码：');
                if (!code) { showError('已取消'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/auth/verify-email', { code });
                appendApiOutput('✅ POST /auth/verify-email', d);
            } catch (e) { showError(e.message); }
        },

        async authResendVerification() {
            appendApiOutput('➡️ POST /auth/resend-verification', { loading: true });
            try {
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/auth/resend-verification');
                appendApiOutput('✅ POST /auth/resend-verification', d);
            } catch (e) { showError(e.message); }
        },

        // ===== 新增的 Document 方法 =====

        async docById() {
            appendApiOutput('➡️ GET /document/<id>', { loading: true });
            try {
                const id = prompt('输入文档 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedGet(API_BASE_URL + '/api/v0/document/' + id);
                appendApiOutput('✅ GET /document/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async docUpdate() {
            appendApiOutput('➡️ PUT /document/<id>', { loading: true });
            try {
                const id = prompt('输入文档 ID：');
                if (!id) { showError('已取消'); return; }
                const title = prompt('新标题（留空不修改）：');
                const content = prompt('新内容（留空不修改）：');
                const body = {};
                if (title) body.title = title;
                if (content) body.content = content;
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/document/' + id, body);
                appendApiOutput('✅ PUT /document/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async docPermanentDelete() {
            appendApiOutput('➡️ DELETE /document/<id>/permanent', { loading: true });
            try {
                const id = prompt('输入要彻底删除的文档 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('DELETE', API_BASE_URL + '/api/v0/document/' + id + '/permanent');
                appendApiOutput('✅ DELETE /document/' + id + '/permanent', d);
            } catch (e) { showError(e.message); }
        },

        async docGetPermissions() {
            appendApiOutput('➡️ GET /document/<id>/permissions', { loading: true });
            try {
                const id = prompt('输入文档 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedGet(API_BASE_URL + '/api/v0/document/' + id + '/permissions');
                appendApiOutput('✅ GET /document/' + id + '/permissions', d);
            } catch (e) { showError(e.message); }
        },

        async docPutPermissions() {
            appendApiOutput('➡️ PUT /document/<id>/permissions', { loading: true });
            try {
                const id = prompt('输入文档 ID：');
                if (!id) { showError('已取消'); return; }
                const rulesStr = prompt('输入规则数组（JSON 格式，如 ["*.*.doc.public.view.deny"]）：', '["*.*.doc.public.view.deny"]');
                if (!rulesStr) { showError('已取消'); return; }
                let rules;
                try { rules = JSON.parse(rulesStr); } catch { showError('JSON 格式错误'); return; }
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/document/' + id + '/permissions', { rules });
                appendApiOutput('✅ PUT /document/' + id + '/permissions', d);
            } catch (e) { showError(e.message); }
        },

        // ===== 新增的文件夹方法 =====

        async docFoldersPublic() {
            appendApiOutput('➡️ GET /document/folders/public', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v0/document/folders/public', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /document/folders/public', d);
            } catch (e) { showError(e.message); }
        },

        async docFolderUpdate() {
            appendApiOutput('➡️ PUT /document/folders/<id>', { loading: true });
            try {
                const id = prompt('输入文件夹 ID：');
                if (!id) { showError('已取消'); return; }
                const name = prompt('新名称（留空不修改）：');
                const body = {};
                if (name) body.name = name;
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/document/folders/' + id, body);
                appendApiOutput('✅ PUT /document/folders/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async docFolderDelete() {
            appendApiOutput('➡️ DELETE /document/folders/<id>', { loading: true });
            try {
                const id = prompt('输入要删除的文件夹 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('DELETE', API_BASE_URL + '/api/v0/document/folders/' + id);
                appendApiOutput('✅ DELETE /document/folders/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async docFolderGetPermissions() {
            appendApiOutput('➡️ GET /document/folders/<id>/permissions', { loading: true });
            try {
                const id = prompt('输入文件夹 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedGet(API_BASE_URL + '/api/v0/document/folders/' + id + '/permissions');
                appendApiOutput('✅ GET /document/folders/' + id + '/permissions', d);
            } catch (e) { showError(e.message); }
        },

        async docFolderPutPermissions() {
            appendApiOutput('➡️ PUT /document/folders/<id>/permissions', { loading: true });
            try {
                const id = prompt('输入文件夹 ID：');
                if (!id) { showError('已取消'); return; }
                const rulesStr = prompt('输入规则数组（JSON 格式）：', '["*.*.doc.group.*.deny"]');
                if (!rulesStr) { showError('已取消'); return; }
                let rules;
                try { rules = JSON.parse(rulesStr); } catch { showError('JSON 格式错误'); return; }
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/document/folders/' + id + '/permissions', { rules });
                appendApiOutput('✅ PUT /document/folders/' + id + '/permissions', d);
            } catch (e) { showError(e.message); }
        },

        // ===== 新增的用户方法 =====

        async userMenuContent() {
            appendApiOutput('➡️ GET /user/menu/<id>/content', { loading: true });
            try {
                const id = prompt('输入菜单项 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedGet(API_BASE_URL + '/api/v0/user/menu/' + id + '/content');
                appendApiOutput('✅ GET /user/menu/' + id + '/content', d);
            } catch (e) { showError(e.message); }
        },

        async userDynamicPage() {
            appendApiOutput('➡️ GET /user/dynamic-page/<key>', { loading: true });
            try {
                const key = prompt('输入 tab_key：');
                if (!key) { showError('已取消'); return; }
                const d = await authedGet(API_BASE_URL + '/api/v0/user/dynamic-page/' + encodeURIComponent(key));
                appendApiOutput('✅ GET /user/dynamic-page/' + key, d);
            } catch (e) { showError(e.message); }
        },

        async userPagesRefresh() {
            appendApiOutput('➡️ POST /user/pages/refresh', { loading: true });
            try {
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/user/pages/refresh');
                appendApiOutput('✅ POST /user/pages/refresh', d);
            } catch (e) { showError(e.message); }
        },

        async userSendDeletionCode() {
            appendApiOutput('➡️ POST /user/send-deletion-code', { loading: true });
            try {
                const email = prompt('输入邮箱地址：');
                if (!email) { showError('已取消'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/user/send-deletion-code', { email });
                appendApiOutput('✅ POST /user/send-deletion-code', d);
            } catch (e) { showError(e.message); }
        },

        async userRequestDeletion() {
            appendApiOutput('➡️ POST /user/request-deletion', { loading: true });
            try {
                const email = prompt('输入邮箱地址：');
                if (!email) { showError('已取消'); return; }
                const code = prompt('输入验证码：');
                if (!code) { showError('已取消'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/user/request-deletion', { email, code });
                appendApiOutput('✅ POST /user/request-deletion', d);
            } catch (e) { showError(e.message); }
        },

        // ===== 新增的管理员方法 =====

        async adminDocDelete() {
            appendApiOutput('➡️ DELETE /admin/documents/<id>', { loading: true });
            try {
                const id = prompt('输入文档 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('DELETE', API_BASE_URL + '/api/v0/admin/documents/' + id, undefined, true);
                appendApiOutput('✅ DELETE /admin/documents/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async adminUpdateNotification() {
            appendApiOutput('➡️ PUT /admin/notifications/<id>', { loading: true });
            try {
                const id = prompt('输入通知 ID：');
                if (!id) { showError('已取消'); return; }
                const title = prompt('新标题（留空不修改）：');
                const content = prompt('新内容（留空不修改）：');
                const body = {};
                if (title) body.title = title;
                if (content) body.content = content;
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/admin/notifications/' + id, body, true);
                appendApiOutput('✅ PUT /admin/notifications/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async adminDeleteNotification() {
            appendApiOutput('➡️ DELETE /admin/notifications/<id>', { loading: true });
            try {
                const id = prompt('输入通知 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('DELETE', API_BASE_URL + '/api/v0/admin/notifications/' + id, undefined, true);
                appendApiOutput('✅ DELETE /admin/notifications/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async adminCreateInviteCode() {
            appendApiOutput('➡️ POST /admin/invite-codes', { loading: true });
            try {
                const durationDays = prompt('有效期天数（默认 7）：', '7');
                if (!durationDays) { showError('已取消'); return; }
                const body = { duration_days: parseInt(durationDays) };
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/admin/invite-codes', body, true);
                appendApiOutput('✅ POST /admin/invite-codes', d);
            } catch (e) { showError(e.message); }
        },

        async adminUpdateInviteCode() {
            appendApiOutput('➡️ PUT /admin/invite-codes/<id>', { loading: true });
            try {
                const id = prompt('输入邀请码 ID：');
                if (!id) { showError('已取消'); return; }
                const isActive = prompt('是否激活 (true/false)：', 'true');
                const body = { is_active: isActive === 'true' };
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/admin/invite-codes/' + id, body, true);
                appendApiOutput('✅ PUT /admin/invite-codes/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async adminDisableInviteCode() {
            appendApiOutput('➡️ DELETE /admin/invite-codes/<id>', { loading: true });
            try {
                const id = prompt('输入邀请码 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('DELETE', API_BASE_URL + '/api/v0/admin/invite-codes/' + id, undefined, true);
                appendApiOutput('✅ DELETE /admin/invite-codes/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async adminPermRules() {
            appendApiOutput('➡️ GET /admin/permission-rules', { loading: true });
            try {
                const scope = prompt('规则范围 (level/user/group/content)：', 'level');
                if (!scope) { showError('已取消'); return; }
                let url = API_BASE_URL + '/api/v0/admin/permission-rules?scope=' + encodeURIComponent(scope);
                if (scope === 'content') {
                    const ot = prompt('object_type (document/folder)：');
                    if (!ot) { showError('已取消'); return; }
                    const oid = prompt('object_id：');
                    if (!oid) { showError('已取消'); return; }
                    url += '&object_type=' + encodeURIComponent(ot) + '&id=' + encodeURIComponent(oid);
                } else {
                    const id = prompt('scope_id（留空查全部）：');
                    if (id) url += '&id=' + encodeURIComponent(id);
                }
                const d = await authedGet(url, true);
                appendApiOutput('✅ GET /admin/permission-rules', d);
            } catch (e) { showError(e.message); }
        },

        async adminSavePermRules() {
            appendApiOutput('➡️ POST /admin/permission-rules', { loading: true });
            try {
                const scope = prompt('规则范围 (level/user/group/content)：', 'level');
                if (!scope) { showError('已取消'); return; }
                const body = { scope };
                if (scope === 'content') {
                    const ot = prompt('object_type (document/folder)：');
                    if (!ot) { showError('已取消'); return; }
                    const oid = prompt('object_id：');
                    if (!oid) { showError('已取消'); return; }
                    body.object_type = ot;
                    body.object_id = parseInt(oid);
                } else {
                    const sid = prompt('scope_id：');
                    if (!sid) { showError('已取消'); return; }
                    body.scope_id = sid;
                }
                const rulesStr = prompt('输入规则数组（JSON）：', '["*.*.doc.public.view.deny"]');
                if (!rulesStr) { showError('已取消'); return; }
                try { body.rules = JSON.parse(rulesStr); } catch { showError('JSON 格式错误'); return; }
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/admin/permission-rules', body, true);
                appendApiOutput('✅ POST /admin/permission-rules', d);
            } catch (e) { showError(e.message); }
        },

        async adminCreateMenuItem() {
            appendApiOutput('➡️ POST /admin/menu-items', { loading: true });
            try {
                const tabKey = prompt('tab_key：');
                if (!tabKey) { showError('已取消'); return; }
                const label = prompt('显示名称：');
                if (!label) { showError('已取消'); return; }
                const body = { tab_key: tabKey, label };
                const d = await authedJson('POST', API_BASE_URL + '/api/v0/admin/menu-items', body, true);
                appendApiOutput('✅ POST /admin/menu-items', d);
            } catch (e) { showError(e.message); }
        },

        async adminUpdateMenuItem() {
            appendApiOutput('➡️ PUT /admin/menu-items/<id>', { loading: true });
            try {
                const id = prompt('输入菜单项 ID：');
                if (!id) { showError('已取消'); return; }
                const label = prompt('新名称（留空不修改）：');
                const body = {};
                if (label) body.label = label;
                const d = await authedJson('PUT', API_BASE_URL + '/api/v0/admin/menu-items/' + id, body, true);
                appendApiOutput('✅ PUT /admin/menu-items/' + id, d);
            } catch (e) { showError(e.message); }
        },

        async adminDeleteMenuItem() {
            appendApiOutput('➡️ DELETE /admin/menu-items/<id>', { loading: true });
            try {
                const id = prompt('输入菜单项 ID：');
                if (!id) { showError('已取消'); return; }
                const d = await authedJson('DELETE', API_BASE_URL + '/api/v0/admin/menu-items/' + id, undefined, true);
                appendApiOutput('✅ DELETE /admin/menu-items/' + id, d);
            } catch (e) { showError(e.message); }
        }
    };

    // =========================================
    // UI 工具测试函数
    // =========================================

    window.testUtils = {
        clearToken() {
            try {
                AuthGuard.clearToken();
                appendApiOutput('✅ Token 已清除', { success: true });
                refreshAll();
            } catch (e) { showError(e.message); }
        },

        showToken() {
            try {
                const token = AuthGuard.getToken();
                if (token) {
                    appendApiOutput('🔑 当前 Token', {
                        preview: token.substring(0, 40) + '...',
                        length: token.length,
                        payload: (function() {
                            try {
                                const parts = token.split('.');
                                let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                                while (b64.length % 4) b64 += '=';
                                return JSON.parse(atob(b64));
                            } catch { return '(解析失败)'; }
                        })()
                    });
                } else {
                    appendApiOutput('🔑 当前 Token', { status: '无 Token（未登录）' });
                }
            } catch (e) { showError(e.message); }
        },

        showToast(type, msg) {
            if (typeof Toast !== 'undefined' && Toast.show) {
                Toast.show(msg, type);
                appendApiOutput('✅ Toast 已触发', { type: type, message: msg });
            } else {
                showError('Toast 未定义');
            }
        },

        async showModalConfirm() {
            if (typeof Modal !== 'undefined' && Modal.confirm) {
                const result = await Modal.confirm('这是一个测试确认框，点击确定继续。', { title: '测试确认框' });
                appendApiOutput('✅ Modal 确认框结果', { confirmed: result });
            } else {
                showError('Modal 未定义');
            }
        },

        async showModalPrompt() {
            if (typeof Modal !== 'undefined' && Modal.prompt) {
                const result = await Modal.prompt('请输入测试文本：', '默认值', { title: '测试输入框' });
                appendApiOutput('✅ Modal 输入框结果', { value: result });
            } else {
                showError('Modal 未定义');
            }
        },

        copyText() {
            try {
                const testStr = 'GWL 测试文本 #' + Date.now();
                if (typeof fallbackCopy !== 'undefined') {
                    const ok = fallbackCopy(testStr);
                    appendApiOutput('✅ 复制测试', { text: testStr, success: ok, method: 'fallbackCopy' });
                } else {
                    navigator.clipboard.writeText(testStr).then(() => {
                        appendApiOutput('✅ 复制测试', { text: testStr, success: true, method: 'navigator.clipboard' });
                    }).catch(e => {
                        appendApiOutput('⚠️ 复制测试', { text: testStr, success: false, error: e.message });
                    });
                }
            } catch (e) { showError(e.message); }
        },

        testFormat() {
            try {
                const now = new Date();
                const results = {
                    'toLocaleString()': now.toLocaleString(),
                    'toLocaleDateString()': now.toLocaleDateString(),
                    'toISOString()': now.toISOString(),
                    'toTimeString()': now.toTimeString(),
                    'getTime()': now.getTime(),
                    'locale zh-CN': now.toLocaleString('zh-CN'),
                    'locale en-US': now.toLocaleString('en-US'),
                    'relative': (function() {
                        const min = Math.round((Date.now() - now.getTime()) / 60000);
                        return min + ' 分钟前';
                    })()
                };
                appendApiOutput('✅ 时间格式化测试', results);
            } catch (e) { showError(e.message); }
        },

        testNetwork() {
            try {
                const info = {
                    online: navigator.onLine,
                    userAgent: navigator.userAgent.substring(0, 120),
                    language: navigator.language,
                    languages: navigator.languages,
                    platform: navigator.platform,
                    cookiesEnabled: navigator.cookieEnabled,
                    hardwareConcurrency: navigator.hardwareConcurrency,
                    deviceMemory: navigator.deviceMemory,
                    maxTouchPoints: navigator.maxTouchPoints,
                };
                appendApiOutput('✅ 网络/浏览器信息', info);
            } catch (e) { showError(e.message); }
        },

        testLocalStorage() {
            try {
                const key = '_test_' + Date.now();
                localStorage.setItem(key, JSON.stringify({ test: true, time: new Date().toISOString() }));
                const read = JSON.parse(localStorage.getItem(key));
                localStorage.removeItem(key);
                appendApiOutput('✅ localStorage 读写测试', {
                    writeKey: key,
                    readValue: read,
                    cleanup: '已删除测试键',
                    allKeys: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
                });
                refreshAll();
            } catch (e) { showError(e.message); }
        },

        testBrowserInfo() {
            try {
                const info = {
                    userAgent: navigator.userAgent,
                    appVersion: navigator.appVersion,
                    platform: navigator.platform,
                    vendor: navigator.vendor,
                    language: navigator.language,
                    cookieEnabled: navigator.cookieEnabled,
                    onLine: navigator.onLine,
                    hardwareConcurrency: navigator.hardwareConcurrency,
                    deviceMemory: navigator.deviceMemory,
                    maxTouchPoints: navigator.maxTouchPoints,
                };
                const screenInfo = {
                    width: screen.width,
                    height: screen.height,
                    availWidth: screen.availWidth,
                    availHeight: screen.availHeight,
                    colorDepth: screen.colorDepth,
                    pixelDepth: screen.pixelDepth,
                };
                const locationInfo = {
                    href: location.href,
                    origin: location.origin,
                    pathname: location.pathname,
                    search: location.search,
                    hash: location.hash,
                    host: location.host,
                    hostname: location.hostname,
                    port: location.port,
                    protocol: location.protocol,
                };
                appendApiOutput('✅ 浏览器环境信息', { navigator: info, screen: screenInfo, location: locationInfo });
            } catch (e) { showError(e.message); }
        },

        testUrlParse() {
            try {
                const testUrl = document.getElementById('urlInput')?.value || 'https://gwl.net.cn/api/v0/document/list?scope=public&page=1#section';
                const url = new URL(testUrl);
                appendApiOutput('✅ URL 解析测试', {
                    input: testUrl,
                    protocol: url.protocol,
                    hostname: url.hostname,
                    port: url.port,
                    pathname: url.pathname,
                    search: url.search,
                    hash: url.hash,
                    params: Object.fromEntries(url.searchParams.entries()),
                    origin: url.origin,
                });
            } catch (e) { showError(e.message); }
        },

        testFormValidation() {
            try {
                const tests = [
                    { input: '', rule: '非空', pass: false },
                    { input: 'user@example.com', rule: '邮箱', pass: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test('user@example.com') },
                    { input: '13800138000', rule: '手机号(11位)', pass: /^1\d{10}$/.test('13800138000') },
                    { input: 'abc123', rule: '字母数字', pass: /^[a-zA-Z0-9]+$/.test('abc123') },
                    { input: '<script>', rule: '防XSS', pass: /<script/.test('<script>') },
                    { input: '你好世界', rule: '中文字符', pass: /^[\u4e00-\u9fa5]+$/.test('你好世界') },
                    { input: '  ', rule: '空白字符', pass: /^\s+$/.test('  ') },
                ];
                const results = {};
                tests.forEach(t => { results[t.rule + ' (' + t.input + ')'] = t.pass; });
                appendApiOutput('✅ 表单验证测试', results);
            } catch (e) { showError(e.message); }
        },

        toggleTheme() {
            try {
                if (typeof ThemeEngine !== 'undefined') {
                    const current = ThemeEngine.currentTheme || 'light';
                    const next = current === 'dark' ? 'light' : 'dark';
                    ThemeEngine.setTheme(next);
                    appendApiOutput('✅ 主题已切换', { from: current, to: next });
                    refreshAll();
                } else {
                    const html = document.documentElement;
                    const current = html.getAttribute('data-theme') || 'light';
                    const next = current === 'dark' ? 'light' : 'dark';
                    html.setAttribute('data-theme', next);
                    appendApiOutput('✅ 主题已切换（兜底）', { from: current, to: next });
                }
            } catch (e) { showError(e.message); }
        },

        setTheme(theme) {
            try {
                if (typeof ThemeEngine !== 'undefined') {
                    ThemeEngine.setTheme(theme);
                    appendApiOutput('✅ 主题已设置', { theme: theme });
                } else {
                    document.documentElement.setAttribute('data-theme', theme);
                    appendApiOutput('✅ 主题已设置（兜底）', { theme: theme });
                }
            } catch (e) { showError(e.message); }
        },

        listSession() {
            try {
                const data = {};
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    try {
                        const val = sessionStorage.getItem(key);
                        try { data[key] = JSON.parse(val); } catch { data[key] = val; }
                    } catch { data[key] = '(读取失败)'; }
                }
                appendApiOutput('🗄 sessionStorage 内容', {
                    count: sessionStorage.length,
                    data: Object.keys(data).length > 0 ? data : '(空)'
                });
            } catch (e) { showError(e.message); }
        },

        clearSession() {
            try {
                const count = sessionStorage.length;
                sessionStorage.clear();
                appendApiOutput('🗑 sessionStorage 已清空', { clearedCount: count });
            } catch (e) { showError(e.message); }
        },

        refreshCache() {
            refreshAll();
            appendApiOutput('🔄 缓存视图已刷新', { timestamp: new Date().toISOString() });
        },

        clearAll() {
            const el = document.getElementById('apiOutput');
            if (el) {
                const pre = el.querySelector('pre');
                if (pre) pre.textContent = '点击左侧按钮发送 API 请求，结果将显示在此处。';
            }
        }
    };

    // =========================================
    // 初始化
    // =========================================

    document.addEventListener('DOMContentLoaded', function () {
        // 延迟执行，确保其他 JS 已加载完毕
        setTimeout(refreshAll, 500);
        // 每次页面可见时刷新（用于在其他页面操作后切回此页）
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) refreshAll();
        });
    });

})();