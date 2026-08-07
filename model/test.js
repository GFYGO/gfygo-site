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
    // 公共 API 测试函数
    // =========================================

    window.testApi = {
        async authStatus() {
            appendApiOutput('➡️ GET /auth/status', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v1/auth/status', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /auth/status', d);
            } catch (e) { showError(e.message); }
        },

        async authProfile() {
            appendApiOutput('➡️ GET /user/profile', { loading: true });
            try {
                const token = AuthGuard.getToken();
                if (!token) { showError('未登录，无 token'); return; }
                const r = await fetch(API_BASE_URL + '/api/v1/user/profile', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await r.json();
                appendApiOutput('✅ GET /user/profile', d);
            } catch (e) { showError(e.message); }
        },

        async globalNotifications() {
            appendApiOutput('➡️ GET /notify/global', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v1/notify/global', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /notify/global', d);
            } catch (e) { showError(e.message); }
        },

        async docList() {
            appendApiOutput('➡️ GET /document/list', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v1/document/list?scope=public', { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /document/list', d);
            } catch (e) { showError(e.message); }
        },

        async docFolders() {
            appendApiOutput('➡️ GET /document/folders', { loading: true });
            try {
                const token = AuthGuard.getToken();
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                const r = await fetch(API_BASE_URL + '/api/v1/document/folders?scope=public', { headers });
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
                const r = await fetch(API_BASE_URL + '/api/v1/document/' + encodeURIComponent(slug), { headers });
                const d = await r.json();
                appendApiOutput('✅ GET /document/' + slug, d);
            } catch (e) { showError(e.message); }
        }
    };

    // =========================================
    // 工具函数
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

        toggleTheme() {
            try {
                if (typeof ThemeEngine !== 'undefined') {
                    const current = ThemeEngine.currentTheme || 'light';
                    const next = current === 'dark' ? 'light' : 'dark';
                    ThemeEngine.setTheme(next);
                    appendApiOutput('✅ 主题已切换', { from: current, to: next });
                    refreshAll();
                } else {
                    // 兜底：直接切换 body class
                    const html = document.documentElement;
                    const isDark = html.getAttribute('data-theme') === 'dark';
                    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
                    appendApiOutput('✅ 主题已切换（兜底）', { to: isDark ? 'light' : 'dark' });
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