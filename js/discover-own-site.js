/**
 * discover-own-site.js
 * 「发现」→ 「展示内容管理」页（discover/own-site.html）的页面脚本。
 *
 * 契约：file-wiki/_discover-contract.md（§4.2 需登录接口 / §4.3 错误码文案 / §5 public 与展示两道闸门 /
 *       §7.2 页面装配 / §7.5 own-site 详细要求）。本文件是该契约在前端的**唯一**实现处。
 *
 * 这个页面做什么：
 *   * doc / group / org：列出「我有所有权 + 源内容已公开」的候选内容（含已提交的，带 item_id），
 *     未提交 → 「加入发现」（POST /own）；已提交 → 「编辑」（PUT /own/<id>）/「取消展示」（DELETE /own/<id>）。
 *   * tool：没有可回读的源对象，改为手工新建（ref_id/title/summary/icon/link_url/tags），
 *     下方列出「我的工具展示条目」（GET /own?section=tool）。
 *   * 所有写操作成功后重新拉取 GET /own?section=<key> 与 candidates，让状态与服务端一致。
 *
 * 刻意不做的事（都是契约里的硬性约束，不是遗漏）：
 *   * 不用任何框架 / 构建 / ES module：纯普通脚本（IIFE + 'use strict'）。
 *   * 不写内联脚本体、不写内联 on* 属性、不用 eval、也不用动态构造函数；
 *     不用浏览器原生弹窗（alert / 原生确认框 / 输入框）——删除操作用「两次点击」的页面内确认。
 *   * 不自己实现一份 HTML 转义（契约禁止 `esc()` 副本）：一律 `window.escapeHtml`（缺失时走
 *     `window.Discover.escapeHtml`，两者都没有就宁可不渲染文字也不注入）。
 *   * 不发裸 fetch：所有请求都经 `window.apiRequest`（自带 Bearer、401 跳登录）。
 *   * link_url 只是**预留字段**：本页只做输入与回显，绝不跳转、也不对它发任何请求。
 *
 * 与 fe-discover 的边界：本页复用 `window.Discover.SECTIONS` 与 `window.Discover.escapeHtml`，
 * 但**不假设它们一定存在**——缺失时用本文件内置的 4 板块兜底表，并在页面上显示一行可见提示，
 * 绝不抛异常导致白屏（契约 §7.5 / task 要求）。
 */
(function () {
    'use strict';

    // ============================================================
    // 常量
    // ============================================================

    /** 需登录接口前缀（契约 §4.2 的第 4~8 条，全部经 window.apiRequest） */
    var API_OWN = '/api/v0/discover/own';
    var API_CANDIDATES = '/api/v0/discover/own/candidates';

    /** 板块固定顺序（契约 §1），与后端 DISCOVER_SECTION_KEYS 同序 */
    var SECTION_ORDER = ['doc', 'group', 'org', 'tool'];

    /** window.Discover.SECTIONS 缺失时的兜底表：与后端常量逐字同值（契约 §1） */
    var FALLBACK_SECTIONS = [
        { key: 'doc', label: '文档', icon: '📚', path: 'discover/doc/index.html', detail: 'discover/doc/details.html' },
        { key: 'group', label: '组', icon: '👥', path: 'discover/group/index.html', detail: 'discover/group/details.html' },
        { key: 'org', label: '组织', icon: '🏛️', path: 'discover/org/index.html', detail: 'discover/org/details.html' },
        { key: 'tool', label: '工具', icon: '🧰', path: 'discover/tool/index.html', detail: 'discover/tool/details.html' }
    ];

    /** 板块 → ref_type（契约 §2：document / group / organization / manual） */
    var REF_TYPE_BY_SECTION = {
        doc: 'document',
        group: 'group',
        org: 'organization',
        tool: 'manual'
    };

    /** 手工新建的板块（契约 §4.2：tool 的 candidates 恒为空，走手工表单） */
    var MANUAL_SECTION = 'tool';

    /** tool 的 ref_id 规则（契约 §4.3，逐字来自后端校验） */
    var TOOL_REF_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/;

    /** tags 限制（契约 §2 / §4.3） */
    var TAGS_MAX = 8;
    var TAG_LEN_MAX = 24;

    /** 字段长度上限（契约 §4.3「参数过长」） */
    var LIMITS = { title: 200, summary: 500, icon: 50, cover_url: 512, link_url: 512 };

    /** 页面顶部必须出现的说明语义（契约 §7.5，HTML 里已逐字写好，这里做兜底校验用） */
    var LEAD_TEXT = '仅公开内容可被展示；公开不等于必须展示 —— 只有你在这里开启后才会出现在发现页。';

    /**
     * 文案表。
     * ⚠️ 凡是契约 §4.3 列出的 msg，一律**与后端逐字一致**：前端预校验用同一句，
     *    这样"前端拦下"和"后端拦下"用户看到的是同一句话。
     */
    var MSG = {
        tags: '标签最多 8 个、每个不超过 24 字',
        toolRef: '工具标识只能是小写字母、数字、- 和 _（2~50 位）',
        tooLong: '参数过长',
        badRef: '内容引用参数不合法',
        noSection: '板块不存在',
        noItemId: '缺少展示条目 id',
        noItem: '展示条目不存在',
        candidatesEmpty: '你还没有满足条件的公开内容。只有公开内容、且你有所有权时才能展示。',
        itemsEmpty: '还没有加入任何展示条目。在上面的「可展示的内容」里点「加入发现」即可。',
        toolItemsEmpty: '还没有工具展示条目。用上面的表单新建一条。',
        loadFailed: '加载失败，请稍后重试',
        requestFailed: '请求失败，请稍后重试',
        network: '网络连接失败，请检查网络后重试',
        loading: '加载中…',
        needLogin: '未登录，正在跳转登录页…',
        noAuthGuard: '页面依赖的登录模块（config.js 的 AuthGuard）未加载，无法确认登录状态，请刷新重试。',
        noApiRequest: '页面依赖的请求模块（config.js 的 apiRequest）未加载，请刷新重试。',
        fallbackFull: '检测到 window.Discover 未就绪，本页已改用内置的 4 个板块兜底（tab 与列表仍然可用）。',
        fallbackPartial: '检测到 window.Discover.SECTIONS 缺少部分板块，缺失的板块已用内置表补齐。',
        noEscape: '页面依赖的 escapeHtml 未加载；为避免注入风险，本页暂不渲染列表文字，请刷新重试。',
        armRemove: '再次点击「确认取消展示」即删除该展示条目。',
        manualOnly: '这个板块没有可回读的源内容，请用上方的手工新建表单。'
    };

    // ============================================================
    // 状态
    // ============================================================

    var state = {
        sections: [],          // 已规范化 + 补全的板块表（固定 4 项、固定顺序）
        usingFallback: false,  // 是否用了内置兜底表（供测试/排查）
        section: 'doc',        // 当前板块 key
        candidates: [],        // 当前板块的候选内容（GET /own/candidates）
        items: [],             // 当前板块的我的展示条目（GET /own）
        itemsById: Object.create(null),
        editing: null,         // 正在编辑的条目（来自 state.items）
        seq: 0,                // 请求令牌：防止快速切 tab 时旧响应覆盖新板块
        booted: false,
        eventsBound: false
    };

    /** 单调递增令牌：每个请求带上它，回来时对不上就丢弃（org.js 同款做法）。 */
    function nextSeq() {
        state.seq += 1;
        return state.seq;
    }

    var dom = Object.create(null);

    // ============================================================
    // 基础工具
    // ============================================================

    function $(id) {
        return document.getElementById(id);
    }

    /**
     * escText — 文本转义。
     * ⚠️ 这里**不是**再实现一份转义（契约 §7.2 禁止自写 esc()），只是转发到共享 utils。
     *    两者都缺失时返回空串：宁可少显示几个字，也不把未转义的后端字符串注入 DOM。
     *    注：`Discover.escapeHtml` 在 utils 缺失时会**抛错**（fe-discover 刻意如此），所以这里兜一层。
     */
    function escText(value) {
        var s = value === null || value === undefined ? '' : String(value);
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
        if (window.Discover && typeof window.Discover.escapeHtml === 'function') {
            try { return window.Discover.escapeHtml(s); } catch (e) { return ''; }
        }
        return '';
    }

    /**
     * hasEscape — 是否具备可用的转义能力。
     * 只认 `window.escapeHtml`（js/utils.js）：fe-discover 的 `Discover.escapeHtml` 是它的一层代理，
     * 代理本身在底层缺失时会抛错，不能算"可用"。
     */
    function hasEscape() {
        return typeof window.escapeHtml === 'function';
    }

    /** 统一提示（禁止 alert/confirm/prompt，契约 §7.2） */
    function toast(msg, type) {
        if (!msg) return;
        if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
        if (window.Toast && typeof window.Toast.show === 'function') { window.Toast.show(msg, type); }
    }

    function on(el, event, handler) {
        if (el && typeof el.addEventListener === 'function') el.addEventListener(event, handler);
    }

    function prevent(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
    }

    function readValue(el) {
        return el && el.value !== null && el.value !== undefined ? String(el.value) : '';
    }

    function setValue(el, value) {
        if (el) el.value = value === null || value === undefined ? '' : String(value);
    }

    /** 沿 parentNode 向上找第一个带某属性的元素（事件委托用；老浏览器没有 closest 也能走）。 */
    function closestWithAttr(target, attr) {
        var node = target;
        while (node && typeof node.getAttribute === 'function') {
            var v = node.getAttribute(attr);
            if (v !== null && v !== undefined) return node;
            node = node.parentNode;
        }
        return null;
    }

    function scrollToTop(node) {
        if (!node || typeof node.scrollIntoView !== 'function') return;
        try { node.scrollIntoView({ block: 'start' }); } catch (e) { try { node.scrollIntoView(); } catch (e2) { /* 忽略 */ } }
    }

    /**
     * charLength — 按「字」计数（代理对算 1 个字符，emoji 不会被算成 2 个）。
     * 后端限制是"每项 ≤ 24 字符"，前端用同一口径预校验。
     */
    function charLength(value) {
        var s = value === null || value === undefined ? '' : String(value);
        var n = 0;
        for (var i = 0; i < s.length; i++) {
            var code = s.charCodeAt(i);
            if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
                var next = s.charCodeAt(i + 1);
                if (next >= 0xDC00 && next <= 0xDFFF) i += 1;
            }
            n += 1;
        }
        return n;
    }

    /**
     * normalizeTags — 输入框（逗号分隔）或数组 → 字符串数组。
     * 兼容中英文逗号/顿号；去空白、去空项、去重（保持输入顺序）。
     * 去重放在长度校验**之前**：用户重复输入同一个标签不该被判超限。
     */
    function normalizeTags(raw) {
        var list;
        if (Array.isArray(raw)) list = raw.slice(0);
        else if (raw === null || raw === undefined) list = [];
        else list = String(raw).split(/[,，、]/);
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var s = String(list[i] === null || list[i] === undefined ? '' : list[i]).trim();
            if (!s) continue;
            if (out.indexOf(s) >= 0) continue;
            out.push(s);
        }
        return out;
    }

    /** validateTags — 返回错误文案（空串=通过）。文案与契约 §4.3 逐字一致。 */
    function validateTags(list) {
        if (!Array.isArray(list)) return MSG.tags;
        if (list.length > TAGS_MAX) return MSG.tags;
        for (var i = 0; i < list.length; i++) {
            if (charLength(list[i]) > TAG_LEN_MAX) return MSG.tags;
        }
        return '';
    }

    /** validatePayload — tags + 各字段长度；返回错误文案（空串=通过）。 */
    function validatePayload(payload) {
        var tagErr = validateTags(payload.tags);
        if (tagErr) return tagErr;
        var keys = Object.keys(LIMITS);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (payload[k] !== null && payload[k] !== undefined && charLength(payload[k]) > LIMITS[k]) {
                return MSG.tooLong;
            }
        }
        return '';
    }

    // ============================================================
    // 请求：统一走 window.apiRequest（禁止裸 fetch）
    // ============================================================

    function isAuthed() {
        if (!window.AuthGuard || typeof window.AuthGuard.getToken !== 'function') return false;
        try { return !!window.AuthGuard.getToken(); } catch (e) { return false; }
    }

    /**
     * callApi — 统一请求包装。
     *
     * 为什么传 `silent: true` 再自己 toast：`apiRequest` 只在 `Toast` 全局存在时才提示，
     * 而本页要保证「后端 msg 原样提示」在**任何**加载方式下都成立（含测试桩里被替换掉的
     * apiRequest）。自己提示还能保证一次失败只提示一次，不会重复弹两条。
     *
     * 返回：成功 → `{code:200,...}` 信封；失败/取消 → `null`（错误提示已经发过）。
     */
    function callApi(path, options) {
        var opts = options || {};
        if (typeof window.apiRequest !== 'function') {
            toast(MSG.noApiRequest);
            return Promise.resolve(null);
        }
        var requestOptions = { method: opts.method || 'GET', silent: true };
        if (opts.params) requestOptions.params = opts.params;
        if (opts.body) requestOptions.body = opts.body;

        return Promise.resolve(window.apiRequest(path, requestOptions)).then(function (res) {
            if (!res) {
                // null 有两义：网络失败，或 401（apiRequest 内部已跳登录页）。
                // token 已经没了 → 是 401，不再重复提示。
                if (isAuthed()) toast(MSG.network);
                return null;
            }
            if (res.code !== 200) {
                // 后端 msg 原样提示（401/403/400/404 的文案都来自契约 §4.3）
                toast(res.msg || MSG.requestFailed);
                return null;
            }
            return res;
        }, function () {
            toast(MSG.requestFailed);
            return null;
        });
    }

    /** GET /own?section=<key> → items 数组；失败返回 null（与"空列表"区分开）。 */
    function loadOwn(key) {
        return callApi(API_OWN, { params: { section: key } }).then(function (res) {
            if (!res || !res.data || !Array.isArray(res.data.items)) return null;
            return res.data.items;
        });
    }

    /** GET /own/candidates?section=<key> → candidates 数组；失败返回 null。 */
    function loadCandidates(key) {
        return callApi(API_CANDIDATES, { params: { section: key } }).then(function (res) {
            if (!res || !res.data || !Array.isArray(res.data.candidates)) return null;
            return res.data.candidates;
        });
    }

    // ============================================================
    // 板块表：优先 window.Discover.SECTIONS，缺失就内置兜底
    // ============================================================

    function fallbackByKey(key) {
        for (var i = 0; i < FALLBACK_SECTIONS.length; i++) {
            if (FALLBACK_SECTIONS[i].key === key) return FALLBACK_SECTIONS[i];
        }
        return null;
    }

    function isManual(key) {
        return key === MANUAL_SECTION;
    }

    function sectionByKey(key) {
        for (var i = 0; i < state.sections.length; i++) {
            if (state.sections[i].key === key) return state.sections[i];
        }
        return null;
    }

    function currentSection() {
        return sectionByKey(state.section) || state.sections[0] || null;
    }

    /**
     * resolveSections — 取板块表并规范化。
     * 防御三层：① window.Discover 整个缺失；② SECTIONS 缺失/为空；③ SECTIONS 少了某个板块。
     * 任何一种情况都用内置表补齐，并让页面显示一行可见提示（不抛异常、不白屏）。
     */
    function resolveSections() {
        var source = null;
        if (window.Discover && Array.isArray(window.Discover.SECTIONS) && window.Discover.SECTIONS.length) {
            source = window.Discover.SECTIONS;
        }

        var byKey = Object.create(null);
        if (source) {
            for (var i = 0; i < source.length; i++) {
                var s = source[i];
                if (s && typeof s.key === 'string' && !byKey[s.key]) byKey[s.key] = s;
            }
        }

        var missing = false;
        state.sections = SECTION_ORDER.map(function (key) {
            var fb = fallbackByKey(key);
            var live = byKey[key];
            if (!live) {
                missing = true;
                return { key: fb.key, label: fb.label, icon: fb.icon, path: fb.path, detail: fb.detail };
            }
            // 后端常量里的 path/detail 相对站点根；这里只做兜底，不让 undefined 漏进 DOM
            return {
                key: key,
                label: live.label ? String(live.label) : fb.label,
                icon: live.icon ? String(live.icon) : fb.icon,
                path: live.path ? String(live.path) : fb.path,
                detail: live.detail ? String(live.detail) : fb.detail
            };
        });

        if (!source) {
            state.usingFallback = true;
            setNotice(MSG.fallbackFull);
        } else if (missing) {
            state.usingFallback = true;
            setNotice(MSG.fallbackPartial);
        } else {
            state.usingFallback = false;
            setNotice('');   // 全部就绪：显式清掉提示（不依赖 hidden 属性初值）
        }
    }

    /** 当前板块的合法 key 白名单（供 addCandidate 校验调用方传进来的 section）。 */
    function knownSectionKey(key) {
        return !!sectionByKey(key);
    }

    // ============================================================
    // DOM 缓存 / 页面级提示
    // ============================================================

    function cacheDom() {
        dom.lead = $('ownSiteLead');
        dom.notice = $('ownSiteNotice');
        dom.status = $('ownSiteStatus');
        dom.tabs = $('ownSiteTabs');
        dom.hint = $('ownSiteSectionHint');

        dom.candidatesBlock = $('ownSiteCandidatesBlock');
        dom.candidates = $('ownSiteCandidates');

        dom.toolBlock = $('ownSiteToolBlock');
        dom.toolForm = $('ownSiteToolForm');
        dom.toolRefId = $('toolRefId');
        dom.toolTitle = $('toolTitle');
        dom.toolSummary = $('toolSummary');
        dom.toolIcon = $('toolIcon');
        dom.toolLinkUrl = $('toolLinkUrl');
        dom.toolTags = $('toolTags');
        dom.toolReset = $('ownSiteToolReset');

        dom.itemsBlock = $('ownSiteItemsBlock');
        dom.itemsTitle = $('ownSiteItemsTitle');
        dom.items = $('ownSiteItems');

        dom.editBlock = $('ownSiteEditBlock');
        dom.editHeading = $('ownSiteEditTitle');
        dom.editSource = $('ownSiteEditSource');
        dom.editForm = $('ownSiteEditForm');
        dom.editItemId = $('editItemId');
        dom.editTitle = $('editTitle');
        dom.editSummary = $('editSummary');
        dom.editIcon = $('editIcon');
        dom.editLinkRow = $('ownSiteEditLinkRow');
        dom.editLinkUrl = $('editLinkUrl');
        dom.editTags = $('editTags');
        dom.editIsDisplay = $('editIsDisplay');
        dom.editCancel = $('ownSiteEditCancel');
    }

    function setNotice(msg) {
        if (!dom.notice) return;
        if (msg) {
            dom.notice.textContent = msg;
            dom.notice.hidden = false;
        } else {
            dom.notice.textContent = '';
            dom.notice.hidden = true;
        }
    }

    function setStatus(msg) {
        if (!dom.status) return;
        dom.status.textContent = msg || '';
    }

    /** 顶部说明必须逐字出现（契约 §7.5）：HTML 里已写好，这里只在被改坏时兜底补上。 */
    function ensureLead() {
        if (!dom.lead) return;
        var text = dom.lead.textContent || '';
        if (text.indexOf('公开不等于必须展示') < 0) dom.lead.textContent = LEAD_TEXT;
    }

    // ============================================================
    // 渲染
    // ============================================================

    /**
     * 渲染用的样式词表
     * ⚠️ 本页**不允许**新增 / 修改 CSS 文件（css/discover.css 归 fe-discover），
     *    所以这里刻意复用 discover.css 已有的类（discover-boards / discover-board / discover-card /
     *    discover-tag / discover-action / discover-state），另加 `own-site__*` 钩子，
     *    方便 fe-discover 日后给本页补样式而不必改我的 DOM 结构。
     */
    var CLS = {
        TAB: 'discover-board own-site__tab',
        TAB_ICON: 'discover-board__icon',
        TAB_LABEL: 'discover-board__label',
        TAB_ACTIVE_STYLE: ' style="border-color: var(--color-primary); box-shadow: var(--shadow-md);"',
        CARD: 'discover-card own-site-item',
        CARD_HEAD: 'discover-card__head',
        CARD_ICON: 'discover-card__icon',
        CARD_BADGE: 'discover-card__badge own-site__badge',
        CARD_TITLE: 'discover-card__title',
        CARD_SUMMARY: 'discover-card__summary',
        CARD_TAGS: 'discover-card__tags',
        TAG: 'discover-tag own-site__tag',
        ACTIONS: 'discover-actions own-site-item__actions',
        BTN: 'discover-action own-site__btn',
        BTN_GHOST: 'discover-action discover-action--use own-site__btn',
        STATE: 'discover-state own-site__empty-state',
        STATE_ERROR: 'discover-state discover-state--error own-site__empty-state',
        STATE_TEXT: 'discover-state__text'
    };

    function renderTabs() {
        if (!dom.tabs) return;
        var html = [];
        for (var i = 0; i < state.sections.length; i++) {
            var s = state.sections[i];
            var active = s.key === state.section;
            html.push(
                '<button type="button" class="' + CLS.TAB + (active ? ' is-active' : '') + '"' +
                ' role="tab" id="ownSiteTab-' + escText(s.key) + '"' +
                ' data-section="' + escText(s.key) + '"' +
                ' aria-selected="' + (active ? 'true' : 'false') + '"' +
                (active ? CLS.TAB_ACTIVE_STYLE : '') + '>' +
                '<span class="' + CLS.TAB_ICON + '" aria-hidden="true">' + escText(s.icon) + '</span>' +
                '<span class="' + CLS.TAB_LABEL + '">' + escText(s.label) + '</span>' +
                '</button>'
            );
        }
        dom.tabs.innerHTML = html.join('');
    }

    /** 板块切换时：哪些块可见（tool 显示手工表单，其它显示候选列表）。 */
    function updateBlocks() {
        var manual = isManual(state.section);
        if (dom.candidatesBlock) dom.candidatesBlock.hidden = manual;
        if (dom.toolBlock) dom.toolBlock.hidden = !manual;
        if (dom.editLinkRow) dom.editLinkRow.hidden = !manual;
        if (dom.itemsTitle) dom.itemsTitle.textContent = manual ? '我的工具展示条目' : '我的展示条目';
    }

    function updateHint() {
        if (!dom.hint) return;
        var s = currentSection();
        if (!s) { dom.hint.textContent = ''; return; }
        var parts = ['当前板块：' + s.icon + ' ' + s.label];
        if (!isManual(s.key)) parts.push('可展示内容 ' + state.candidates.length + ' 项');
        parts.push('我的展示条目 ' + state.items.length + ' 项');
        dom.hint.textContent = parts.join(' · ');
    }

    /** 空态 / 错误态：复用 discover.css 的 discover-state 卡片，不新造一套样式。 */
    function emptyHtml(msg, isError) {
        return '<div class="' + (isError ? CLS.STATE_ERROR : CLS.STATE) + '">' +
            '<p class="' + CLS.STATE_TEXT + '">' + escText(msg) + '</p>' +
            '</div>';
    }

    function badgeHtml(label, tone) {
        return '<span class="' + CLS.CARD_BADGE + ' own-site__badge--' + escText(tone) + '">' +
            escText(label) + '</span>';
    }

    /**
     * actionBtn — 列表里的操作按钮。
     * 所有行为都写在 data-* 上、由容器上的**事件委托**分发（无内联 on*，契约 §7.2）。
     */
    function actionBtn(label, action, itemId, opts) {
        opts = opts || {};
        var cls = opts.danger ? CLS.BTN_GHOST + ' own-site__btn--danger' : (opts.primary ? CLS.BTN : CLS.BTN_GHOST);
        var attrs = ' data-action="' + escText(action) + '"';
        if (itemId !== null && itemId !== undefined && itemId !== '') attrs += ' data-item-id="' + escText(itemId) + '"';
        if (opts.refType !== null && opts.refType !== undefined) attrs += ' data-ref-type="' + escText(opts.refType) + '"';
        if (opts.refId !== null && opts.refId !== undefined) attrs += ' data-ref-id="' + escText(opts.refId) + '"';
        return '<button type="button" class="' + cls + '"' + attrs + '>' + escText(label) + '</button>';
    }

    function tagListHtml(tags) {
        if (!Array.isArray(tags) || !tags.length) return '';
        var out = [];
        for (var i = 0; i < tags.length; i++) {
            out.push('<span class="' + CLS.TAG + '">' + escText(tags[i]) + '</span>');
        }
        return out.join('');
    }

    /** 卡片骨架：图标 + 标题 + 简介 + （徽章/标签/来源）+ 操作按钮。 */
    function cardHtml(icon, title, summary, chipsHtml, sourceText, actionsHtml) {
        return '<article class="' + CLS.CARD + '">' +
            '<div class="' + CLS.CARD_HEAD + '">' +
            '<span class="' + CLS.CARD_ICON + '" aria-hidden="true">' + escText(icon) + '</span>' +
            '</div>' +
            '<h3 class="' + CLS.CARD_TITLE + '">' + escText(title) + '</h3>' +
            (summary ? '<p class="' + CLS.CARD_SUMMARY + '">' + escText(summary) + '</p>' : '') +
            '<div class="' + CLS.CARD_TAGS + '">' + chipsHtml +
            '<span class="' + CLS.TAG + ' own-site-item__source">' + escText(sourceText) + '</span>' +
            '</div>' +
            '<div class="' + CLS.ACTIONS + '">' + actionsHtml + '</div>' +
            '</article>';
    }

    function renderCandidates(failed) {
        var box = dom.candidates;
        if (!box) return;
        if (isManual(state.section)) { box.innerHTML = ''; return; }
        if (failed) { box.innerHTML = emptyHtml(MSG.loadFailed, true); return; }
        if (!state.candidates.length) { box.innerHTML = emptyHtml(MSG.candidatesEmpty); return; }

        var fallbackIcon = (currentSection() || {}).icon || '📄';
        var rows = [];
        for (var i = 0; i < state.candidates.length; i++) {
            var c = state.candidates[i] || {};
            var itemId = c.item_id === null || c.item_id === undefined || c.item_id === '' ? null : Number(c.item_id);
            var submitted = itemId !== null && isFinite(itemId);
            var title = c.title ? String(c.title) : '（源内容没有标题）';
            var summary = c.summary ? String(c.summary) : '';
            var icon = c.icon ? String(c.icon) : fallbackIcon;
            var refType = c.ref_type ? String(c.ref_type) : (REF_TYPE_BY_SECTION[state.section] || '');
            var refId = c.ref_id === null || c.ref_id === undefined ? '' : String(c.ref_id);

            var chips = [];
            if (!submitted) {
                chips.push(badgeHtml('未加入展示', 'muted'));
            } else {
                chips.push(badgeHtml(c.is_display ? '展示中' : '已加入 · 未展示', c.is_display ? 'ok' : 'warn'));
            }

            var actions = submitted
                ? actionBtn('编辑', 'edit', itemId, {}) + actionBtn('取消展示', 'remove', itemId, { danger: true })
                : actionBtn('加入发现', 'add', null, { primary: true, refType: refType, refId: refId });

            rows.push(cardHtml(icon, title, summary, chips.join(''), refType + ' / ' + refId, actions));
        }
        box.innerHTML = rows.join('');
    }

    function renderItems(failed) {
        var box = dom.items;
        if (!box) return;
        if (failed) { box.innerHTML = emptyHtml(MSG.loadFailed, true); return; }
        if (!state.items.length) {
            box.innerHTML = emptyHtml(isManual(state.section) ? MSG.toolItemsEmpty : MSG.itemsEmpty);
            return;
        }

        var fallbackIcon = (currentSection() || {}).icon || '📄';
        var rows = [];
        for (var i = 0; i < state.items.length; i++) {
            var it = state.items[i] || {};
            var id = it.id === null || it.id === undefined ? null : Number(it.id);
            var title = it.title ? String(it.title) : '';
            var refId = it.ref_id === null || it.ref_id === undefined ? '' : String(it.ref_id);
            if (!title) title = refId ? '（未填标题：' + refId + '）' : '（未填标题）';
            var summary = it.summary ? String(it.summary) : '';
            var icon = it.icon ? String(it.icon) : fallbackIcon;

            var chips = [];
            chips.push(badgeHtml(it.is_display ? '展示中' : '未展示', it.is_display ? 'ok' : 'warn'));
            if (it.is_public === false) chips.push(badgeHtml('条目未公开', 'warn'));
            // source_missing：源内容被改成私有 / 删除 / 停用 —— 条目还在，但发现页看不到（契约 §5 的副作用）
            if (it.source_missing) chips.push(badgeHtml('源内容已不可用', 'warn'));
            var tagsHtml = tagListHtml(it.tags);
            if (tagsHtml) chips.push(tagsHtml);

            var refType = it.ref_type ? String(it.ref_type) : (REF_TYPE_BY_SECTION[state.section] || '');

            rows.push(cardHtml(
                icon, title, summary, chips.join(''), refType + ' / ' + refId,
                actionBtn('编辑', 'edit', id, {}) + actionBtn('取消展示', 'remove', id, { danger: true })
            ));
        }
        box.innerHTML = rows.join('');
    }

    // ============================================================
    // 数据加载
    // ============================================================

    function indexItems(items) {
        var map = Object.create(null);
        for (var i = 0; i < (items || []).length; i++) {
            var it = items[i];
            if (it && it.id !== null && it.id !== undefined) map[String(it.id)] = it;
        }
        return map;
    }

    /**
     * loadSection — 拉取当前板块的 /own 与（非 tool 的）/candidates 并重渲染。
     * 两个请求都成功才算 ok；任一失败 → 列表区显示「加载失败」而不是伪装成空态。
     */
    function loadSection(key, seq) {
        var ownPromise = loadOwn(key);
        var candPromise = isManual(key) ? Promise.resolve(null) : loadCandidates(key);

        return Promise.all([ownPromise, candPromise]).then(function (out) {
            if (seq !== state.seq) return null;   // 已经切走：丢弃这次响应
            var ownItems = out[0];
            var cands = out[1];
            var failed = ownItems === null || (!isManual(key) && cands === null);

            state.items = ownItems || [];
            state.itemsById = indexItems(state.items);
            state.candidates = cands || [];
            renderCandidates(failed);
            renderItems(failed);
            updateHint();
            setStatus(failed ? MSG.loadFailed : '');
            return null;
        });
    }

    /** refresh — 重新拉取「GET /own?section=<key>」与 candidates（所有写操作成功后都走这里）。 */
    function refresh() {
        var key = state.section;
        var seq = nextSeq();
        return loadSection(key, seq);
    }

    /** 切板块的 URL 同步（刷新后还能停在同一个 tab）。 */
    function syncUrlSection(key) {
        try {
            if (!window.history || typeof window.history.replaceState !== 'function') return;
            if (!window.location || typeof window.location.href !== 'string') return;
            var url = new window.URL(window.location.href);
            if (url && url.searchParams && typeof url.searchParams.set === 'function') {
                url.searchParams.set('section', key);
                window.history.replaceState(window.history.state || null, '', url.toString());
            }
        } catch (e) { /* 忽略：URL 同步失败不影响功能 */ }
    }

    /** 进页默认 tab：优先 ?section=<key>（合法才用），否则第一个板块。 */
    function initialSection() {
        var wanted = '';
        try {
            if (window.location && typeof window.location.search === 'string') {
                var m = window.location.search.match(/[?&]section=([^&]+)/);
                if (m) wanted = decodeURIComponent(m[1]);
            }
        } catch (e) { wanted = ''; }
        if (wanted && knownSectionKey(wanted)) return wanted;
        return state.sections.length ? state.sections[0].key : SECTION_ORDER[0];
    }

    function selectSection(key) {
        var s = sectionByKey(key);
        if (!s) { toast(MSG.noSection); return Promise.resolve(null); }
        state.section = key;
        state.candidates = [];
        state.items = [];
        state.itemsById = Object.create(null);
        cancelEdit(true);
        renderTabs();
        updateBlocks();
        renderCandidates(false);
        renderItems(false);
        updateHint();
        syncUrlSection(key);
        setStatus(MSG.loading);
        return refresh();
    }

    // ============================================================
    // 写操作
    // ============================================================

    /**
     * addCandidate — 「加入发现」：POST /own，body 只需 section / ref_type / ref_id
     * （契约 §4.2：新建默认 is_display=true、is_public=true，所以其它字段不传）。
     */
    function addCandidate(refType, refId, sectionKey) {
        var section = sectionKey || state.section;
        if (!knownSectionKey(section)) { toast(MSG.noSection); return Promise.resolve(null); }
        if (isManual(section)) { toast(MSG.manualOnly); return Promise.resolve(null); }

        var expected = REF_TYPE_BY_SECTION[section] || '';
        var rt = refType === null || refType === undefined || refType === '' ? expected : String(refType);
        var rid = refId === null || refId === undefined ? '' : String(refId).trim();
        if (!rt || !rid || rt !== expected) { toast(MSG.badRef); return Promise.resolve(null); }

        return callApi(API_OWN, {
            method: 'POST',
            body: { section: section, ref_type: rt, ref_id: rid }
        }).then(function (res) {
            if (!res) return null;
            toast(res.msg || '已加入发现');
            return refresh();
        });
    }

    function openEdit(itemId) {
        var id = itemId === null || itemId === undefined || itemId === '' ? NaN : Number(itemId);
        if (!isFinite(id)) { toast(MSG.noItemId); return null; }
        var item = state.itemsById[String(id)];
        if (!item) { toast(MSG.noItem); return null; }

        state.editing = item;
        setValue(dom.editItemId, id);
        setValue(dom.editTitle, item.title || '');
        setValue(dom.editSummary, item.summary || '');
        setValue(dom.editIcon, item.icon || '');
        setValue(dom.editTags, Array.isArray(item.tags) ? item.tags.join(', ') : '');
        setValue(dom.editLinkUrl, item.link_url || '');
        if (dom.editIsDisplay) dom.editIsDisplay.checked = !!item.is_display;
        if (dom.editLinkRow) dom.editLinkRow.hidden = !isManual(state.section);
        if (dom.editHeading) dom.editHeading.textContent = '编辑展示条目 #' + id;
        if (dom.editSource) {
            var refType = item.ref_type ? String(item.ref_type) : (REF_TYPE_BY_SECTION[state.section] || '');
            var refId = item.ref_id === null || item.ref_id === undefined ? '' : String(item.ref_id);
            dom.editSource.textContent = '来源引用：' + refType + ' / ' + refId +
                '（来源不可修改；标题 / 简介 / 图标留空即实时回读源内容）';
        }
        if (dom.editBlock) dom.editBlock.hidden = false;
        scrollToTop(dom.editBlock);
        if (dom.editTitle && typeof dom.editTitle.focus === 'function') dom.editTitle.focus();
        return item;
    }

    function cancelEdit(silent) {
        state.editing = null;
        if (dom.editBlock) dom.editBlock.hidden = true;
        setValue(dom.editItemId, '');
        setValue(dom.editTitle, '');
        setValue(dom.editSummary, '');
        setValue(dom.editIcon, '');
        setValue(dom.editTags, '');
        setValue(dom.editLinkUrl, '');
        if (dom.editIsDisplay) dom.editIsDisplay.checked = false;
        if (!silent) toast('已取消编辑');
    }

    /**
     * submitEdit — PUT /own/<id>。
     * body 是契约 §4.2 允许子集的**完整一份**（title/summary/icon/tags/is_display，
     * tool 另加 link_url），所以"清空某个字段"也能如实提交（留空=跟随源内容）。
     */
    function submitEdit() {
        if (!state.editing) { toast(MSG.noItem); return Promise.resolve(null); }
        var id = Number(state.editing.id);
        if (!isFinite(id)) { toast(MSG.noItemId); return Promise.resolve(null); }

        var payload = {
            title: readValue(dom.editTitle).trim(),
            summary: readValue(dom.editSummary).trim(),
            icon: readValue(dom.editIcon).trim(),
            tags: normalizeTags(readValue(dom.editTags)),
            is_display: !!(dom.editIsDisplay && dom.editIsDisplay.checked)
        };
        if (isManual(state.section)) payload.link_url = readValue(dom.editLinkUrl).trim();

        var err = validatePayload(payload);
        if (err) { toast(err); return Promise.resolve(null); }

        return callApi(API_OWN + '/' + encodeURIComponent(id), { method: 'PUT', body: payload })
            .then(function (res) {
                if (!res) return null;
                toast(res.msg || '已更新');
                cancelEdit(true);
                return refresh();
            });
    }

    /** removeOwn — DELETE /own/<id>（契约 §4.2 第 8 条：取消展示 = 删除条目）。 */
    function removeOwn(itemId) {
        var id = itemId === null || itemId === undefined || itemId === '' ? NaN : Number(itemId);
        if (!isFinite(id) || id <= 0) { toast(MSG.noItemId); return Promise.resolve(null); }
        return callApi(API_OWN + '/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (res) {
            if (!res) return null;
            toast(res.msg || '已取消展示');
            if (state.editing && Number(state.editing.id) === id) cancelEdit(true);
            return refresh();
        });
    }

    // ============================================================
    // tool：手工新建 + 表单读写
    // ============================================================

    function readToolForm() {
        return {
            ref_id: readValue(dom.toolRefId),
            title: readValue(dom.toolTitle),
            summary: readValue(dom.toolSummary),
            icon: readValue(dom.toolIcon),
            link_url: readValue(dom.toolLinkUrl),
            tags: readValue(dom.toolTags)
        };
    }

    function resetToolForm() {
        setValue(dom.toolRefId, '');
        setValue(dom.toolTitle, '');
        setValue(dom.toolSummary, '');
        setValue(dom.toolIcon, '');
        setValue(dom.toolLinkUrl, '');
        setValue(dom.toolTags, '');
    }

    /**
     * submitTool — 工具板块手工新建：POST /own，
     * body 固定含 `section:'tool', ref_type:'manual'`（契约 §2 / §7.5）。
     * 也接受显式 payload（测试 / 脚本调用），不传则读表单。
     *
     * ⚠️ link_url 只是预留字段：这里只把它当字符串提交，绝不跳转、也不访问它。
     */
    function submitTool(payload) {
        var data = payload && typeof payload === 'object' ? payload : readToolForm();
        var refId = data.ref_id === null || data.ref_id === undefined ? '' : String(data.ref_id).trim();
        if (!TOOL_REF_RE.test(refId)) { toast(MSG.toolRef); return Promise.resolve(null); }

        var body = {
            section: MANUAL_SECTION,
            ref_type: 'manual',
            ref_id: refId,
            title: data.title === null || data.title === undefined ? '' : String(data.title).trim(),
            summary: data.summary === null || data.summary === undefined ? '' : String(data.summary).trim(),
            icon: data.icon === null || data.icon === undefined ? '' : String(data.icon).trim(),
            link_url: data.link_url === null || data.link_url === undefined ? '' : String(data.link_url).trim(),
            tags: normalizeTags(data.tags)
        };

        var err = validatePayload(body);
        if (err) { toast(err); return Promise.resolve(null); }

        return callApi(API_OWN, { method: 'POST', body: body }).then(function (res) {
            if (!res) return null;
            toast(res.msg || '已加入发现');
            resetToolForm();
            return refresh();
        });
    }

    // ============================================================
    // 事件（全部 addEventListener + 容器委托；无内联 on*）
    // ============================================================

    function handleTabsClick(e) {
        var btn = closestWithAttr(e && e.target, 'data-section');
        if (!btn) return;
        var key = btn.getAttribute('data-section');
        if (key && key !== state.section) selectSection(key);
    }

    function handleListClick(e) {
        var btn = closestWithAttr(e && e.target, 'data-action');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        var itemId = btn.getAttribute('data-item-id');

        if (action === 'add') {
            addCandidate(btn.getAttribute('data-ref-type'), btn.getAttribute('data-ref-id'));
        } else if (action === 'edit') {
            openEdit(itemId);
        } else if (action === 'remove') {
            armOrRemove(btn, itemId);
        }
    }

    /**
     * armOrRemove — 删除的两步确认。
     * 契约禁止浏览器原生确认框，但「取消展示」是不可撤销的删除，所以改成页面内两步：
     * 第一次点只把按钮改成「确认取消展示」并提示，第二次点才真的 DELETE。
     */
    function armOrRemove(btn, itemId) {
        if (btn.getAttribute('data-arm') !== '1') {
            btn.setAttribute('data-arm', '1');
            btn.textContent = '确认取消展示';
            if (btn.classList && typeof btn.classList.add === 'function') btn.classList.add('own-site__btn--danger');
            toast(MSG.armRemove);
            return;
        }
        removeOwn(itemId);
    }

    function bindEvents() {
        if (state.eventsBound) return;
        state.eventsBound = true;
        on(dom.tabs, 'click', handleTabsClick);
        on(dom.candidates, 'click', handleListClick);
        on(dom.items, 'click', handleListClick);
        on(dom.toolForm, 'submit', function (e) { prevent(e); submitTool(); });
        on(dom.toolReset, 'click', function () { resetToolForm(); });
        on(dom.editForm, 'submit', function (e) { prevent(e); submitEdit(); });
        on(dom.editCancel, 'click', function () { cancelEdit(false); });
    }

    // ============================================================
    // 启动
    // ============================================================

    function boot() {
        if (state.booted) return;
        state.booted = true;

        // ① 进页第一件事：确认登录（未登录由 AuthGuard 跳登录页，契约 §7.5）
        var authed = isAuthed();
        var guardReady = !!(window.AuthGuard && typeof window.AuthGuard.requireAuth === 'function');
        if (guardReady) window.AuthGuard.requireAuth();

        cacheDom();
        ensureLead();
        resolveSections();
        renderTabs();

        if (!guardReady) {
            setStatus(MSG.noAuthGuard);
            return;
        }
        if (!authed) {
            // 未登录：不发任何请求、不渲染任何列表（AuthGuard 已把页面导向登录页）
            setStatus(MSG.needLogin);
            return;
        }
        if (!hasEscape()) {
            // 没有转义工具时不渲染后端字符串（宁缺勿注入）
            setNotice(MSG.noEscape);
            setStatus(MSG.noEscape);
            return;
        }

        bindEvents();
        selectSection(initialSection());
    }

    // ============================================================
    // 对外门面（普通脚本挂 window；同时方便测试直接调用，避免依赖事件派发）
    // ============================================================

    window.DiscoverOwnSite = {
        state: state,
        boot: boot,
        sections: function () { return state.sections.slice(0); },
        sectionByKey: sectionByKey,
        isManual: isManual,
        selectSection: selectSection,
        refresh: refresh,
        loadSection: loadSection,
        addCandidate: addCandidate,
        openEdit: openEdit,
        submitEdit: submitEdit,
        cancelEdit: function () { cancelEdit(false); },
        removeOwn: removeOwn,
        submitTool: submitTool,
        resetToolForm: resetToolForm,
        readToolForm: readToolForm,
        normalizeTags: normalizeTags,
        validateTags: validateTags,
        validatePayload: validatePayload,
        charLength: charLength,
        callApi: callApi,
        usesFallbackSections: function () { return !!state.usingFallback; },
        FALLBACK_SECTIONS: FALLBACK_SECTIONS,
        REF_TYPE_BY_SECTION: REF_TYPE_BY_SECTION,
        TAGS_MAX: TAGS_MAX,
        TAG_LEN_MAX: TAG_LEN_MAX,
        MESSAGES: MSG
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
