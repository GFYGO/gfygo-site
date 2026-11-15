/**
 * avatar-menu.js
 * 右上角用户菜单（头像下拉面板）—— **全站唯一实现**
 *
 * 为什么要有这份文件（2026-11-15）：
 *   面板原先只长在 `js/index.js::renderAuthStatus` 里，而仪表盘
 *   （`user/dashboard.html`）根本不加载 js/index.js，顶栏用户区由
 *   `user/dashboard.auth.js::renderTopNavAuth` 自己画 —— 于是同一个顶栏，
 *   主站点头像会弹面板、仪表盘点头像**没有任何反应**。
 *   把面板抽成这个普通 script（IIFE，无构建、无 import）之后，两边都调用同一份：
 *     * 主站：`js/index.js::renderAuthStatus` → `window.AvatarMenu.build/bind`
 *     * 仪表盘：`user/dashboard.auth.js::renderTopNavAuth` → 同一对 API
 *
 * 对外 API（挂 `window.AvatarMenu`）：
 *   build(userInfo)            → 建面板节点（**只建节点、不插 DOM**，由调用方 appendChild）
 *   bind(triggers, panel)      → 把头像 / 用户名接成开关（补 ARIA + 点击/键盘事件）
 *   open() / close(restore)    → 展开 / 收起（restore=true 时把焦点还回头像）
 *   toggle()
 *   teardown()                 → 拆掉 document 级监听并清空运行时状态（重建面板前必须先调）
 *   isOpen()
 *
 * 约束（与仓库约定一致）：
 *   * 后端字符串（昵称 / 用户名 / 邮箱 / 通知标题）一律 `textContent` 落 DOM，不拼 innerHTML；
 *   * 面板 appendChild 到 `#auth-container`（core.css 里是 position: relative），
 *     一定是「贴着头像向下展开」，不用 JS 算坐标；
 *   * 依赖只在**调用时**从 window 取（BASE_PATH / apiRequest / ThemeEngine / AuthGuard），
 *     所以本文件可以在 config.js 之后的任意位置加载，加载顺序不影响正确性；
 *   * 请求失败静默降级：不弹全局 Toast，只在面板里给一句静态提示。
 */
(function () {
  'use strict';

  // 已经加载过就直接复用（两条 script 标签 / 重复引入不该把状态清空）
  if (window.AvatarMenu) return;

  // 主题轮换顺序与 js/theme.js::THEME_LIST 保持一致（那边是未挂 window 的 var，不能直接依赖）
  var THEMES = ['green', 'light', 'gray', 'dark_green'];
  var THEME_LABELS = {
    green: '绿色',
    light: '白色',
    gray: '灰色',
    dark_green: '深色'
  };

  // 等级名兜底：与 js/index.js / user/dashboard.auth.js 的 ROLE_NAMES 逐字一致的第三份副本。
  // 之所以要带兜底：仪表盘的 ROLE_NAMES 是 ES module 作用域里的 const，**没有挂 window**，
  // 而主站把它挂在 window.ROLE_NAMES 上 —— 这里先读 window，取不到再用这份。
  var FALLBACK_ROLE_NAMES = {
    0: '未登录',
    1: '普通用户',
    2: '一级管理员',
    3: '二级管理员',
    4: '三级管理员',
    5: '超级管理员'
  };

  // 面板运行时状态（单例：一个页面同时只会有一个顶栏面板）
  var state = {
    panel: null,
    triggers: [],
    open: false,
    notifyLoaded: false,
    notifyLoading: false,
    items: [],
    unreadPersonal: 0,
    notifyList: null,
    badge: null,
    readAllBtn: null,
    themeBtn: null,
    onDocPointerDown: null,
    onDocKeyDown: null
  };

  function basePath() {
    return window.BASE_PATH || '';
  }

  function roleNameOf(level) {
    var names = window.ROLE_NAMES || FALLBACK_ROLE_NAMES;
    return names[level] || ('等级 ' + level);
  }

  /** 建节点的小工具：文本一律走 textContent（等价于渲染前 escapeHtml，但没有漏转义的可能） */
  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function themeLabel(theme) {
    return THEME_LABELS[theme] || THEME_LABELS.green;
  }

  /** 当前主题：读 body 上的 theme-* 类（theme.js 应用后的唯一真相），不去猜 localStorage 键名 */
  function currentTheme() {
    var body = document.body;
    if (body && body.classList) {
      for (var i = 0; i < THEMES.length; i++) {
        if (body.classList.contains('theme-' + THEMES[i])) return THEMES[i];
      }
    }
    return 'green';
  }

  /** 时间显示口径与 user/dashboard.notifications.js::notifyDate 一致（只取到分钟） */
  function formatTime(value) {
    var text = String(value || '');
    return text ? text.substring(0, 16).replace('T', ' ') : '';
  }

  /** 取等级：主站 /auth/status 给 permission_level，仪表盘 /user/menu 给 current_level */
  function levelOf(userInfo) {
    var raw = userInfo.permission_level;
    if (raw === undefined || raw === null) raw = userInfo.current_level;
    var level = parseInt(raw, 10);
    return Number.isFinite(level) ? level : 1;
  }

  /**
   * 构建下拉面板（只建节点、不插 DOM，由调用方 appendChild 到 auth-container）
   * @param {Object} userInfo /api/v0/auth/status 的 data.user，或 /api/v0/user/menu 的 user_info
   * @returns {HTMLElement} 面板根节点
   */
  function build(userInfo) {
    userInfo = userInfo || {};
    var profile = userInfo.profile || {};
    var defaultAvatar = basePath() + '/favicon.png';
    var level = levelOf(userInfo);
    var roleName = roleNameOf(level);
    // 显示名口径与仪表盘侧边栏一致：display_name → nickname → username
    var displayName = profile.display_name || profile.nickname || userInfo.username || '';

    var panel = node('div', 'user-menu');
    panel.id = 'user-menu-panel';
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', '用户菜单');

    // ---- ① 资料区：头像 / 显示名 / @用户名 / 等级 / 邮箱与验证状态 ----
    var profileBox = node('div', 'user-menu__profile');
    profileBox.setAttribute('role', 'none');
    var profileAvatar = document.createElement('img');
    profileAvatar.className = 'user-menu__avatar';
    profileAvatar.src = profile.avatar || defaultAvatar;
    profileAvatar.alt = '';
    profileAvatar.onerror = function () { this.src = defaultAvatar; };
    profileBox.appendChild(profileAvatar);

    var identity = node('div', 'user-menu__identity');
    identity.appendChild(node('span', 'user-menu__name', displayName));
    identity.appendChild(node('span', 'user-menu__handle', '@' + (userInfo.username || '')));
    identity.appendChild(node('span', 'user-menu__meta', '等级：' + roleName));
    var email = String(userInfo.email || '');
    if (email) {
      identity.appendChild(node('span', 'user-menu__meta',
        email + '（' + (userInfo.email_verified ? '已验证' : '未验证') + '）'));
    }
    profileBox.appendChild(identity);
    panel.appendChild(profileBox);

    // ---- ② 快捷入口（站内相对路径，随 BASE_PATH 适配任意层级页面）----
    var shortcuts = [
      { label: '仪表盘', href: basePath() + '/user/dashboard.html' },
      { label: '创作者', href: basePath() + '/creator/index.html' },
      { label: '技能广场', href: basePath() + '/skill/index.html' },
      { label: '组织', href: basePath() + '/org/index.html' },
      { label: '发现', href: basePath() + '/discover/index.html' }
    ];
    var shortcutSection = node('div', 'user-menu__section');
    shortcutSection.setAttribute('role', 'none');
    shortcutSection.appendChild(node('p', 'user-menu__title', '快捷入口'));
    shortcuts.forEach(function (item) {
      var link = node('a', 'user-menu__item', item.label);
      link.href = item.href;
      link.setAttribute('role', 'menuitem');
      shortcutSection.appendChild(link);
    });
    panel.appendChild(shortcutSection);

    // ---- ③ 通知区：首次展开才懒加载（见 ensureNotifications）----
    var notifySection = node('div', 'user-menu__section');
    notifySection.setAttribute('role', 'none');
    var notifyHead = node('div', 'user-menu__section-head');
    notifyHead.appendChild(node('p', 'user-menu__title', '通知'));
    var badge = node('span', 'user-menu__badge');
    badge.hidden = true;
    notifyHead.appendChild(badge);
    var readAllBtn = node('button', 'user-menu__action', '全部已读');
    readAllBtn.type = 'button';
    readAllBtn.disabled = true;
    notifyHead.appendChild(readAllBtn);
    var notifyList = node('div', 'user-menu__notices');
    notifyList.setAttribute('role', 'none');
    notifySection.appendChild(notifyHead);
    notifySection.appendChild(notifyList);
    panel.appendChild(notifySection);

    state.notifyList = notifyList;
    state.badge = badge;
    state.readAllBtn = readAllBtn;
    readAllBtn.addEventListener('click', readAll);

    // ---- ④ 主题切换 ----
    var themeSection = node('div', 'user-menu__section');
    themeSection.setAttribute('role', 'none');
    var themeBtn = node('button', 'user-menu__item user-menu__theme');
    themeBtn.type = 'button';
    themeBtn.setAttribute('role', 'menuitem');
    themeSection.appendChild(themeBtn);
    panel.appendChild(themeSection);
    state.themeBtn = themeBtn;
    bindTheme(themeBtn);

    // ---- ⑤ 退出登录 ----
    var logoutSection = node('div', 'user-menu__section');
    logoutSection.setAttribute('role', 'none');
    var logoutItem = node('a', 'user-menu__item user-menu__logout', '退出登录');
    logoutItem.href = '#';
    logoutItem.setAttribute('role', 'menuitem');
    logoutSection.appendChild(logoutItem);
    panel.appendChild(logoutSection);
    logoutItem.addEventListener('click', function (event) {
      event.preventDefault();
      closePanel(false);
      // 与顶栏「退出」走**同一条路径**（logoutBtn 自己会 clearToken 再跳登录页），
      // 避免两处实现随时间漂移；只有它不在 DOM 里时才自己兜底。
      var legacyLogout = document.getElementById('logoutBtn');
      if (legacyLogout && typeof legacyLogout.click === 'function') {
        legacyLogout.click();
        return;
      }
      if (window.AuthGuard) window.AuthGuard.clearToken();
      window.location.replace(basePath() + '/login.html?_t=' + Date.now());
    });

    return panel;
  }

  /**
   * 主题切换按钮：先看 theme.js 提供了什么再决定路径
   *  - 有 theme-selector（全站页面都有）：触发它的 click —— theme.js 已绑定
   *    「轮换到下一个主题 + 同步到服务端」，复用才不会出现「面板换了、服务端没换」；
   *  - 没有该按钮（如后端下发的动态页面）：回退到 ThemeEngine.applyTheme 自己轮换。
   */
  function bindTheme(button) {
    function syncLabel() {
      button.textContent = '主题：' + themeLabel(currentTheme()) + '（点击切换）';
    }
    syncLabel();

    button.addEventListener('click', function () {
      var before = currentTheme();
      var switcher = document.getElementById('theme-selector');
      if (switcher) {
        if (typeof switcher.click === 'function') {
          switcher.click();
        } else if (typeof switcher.dispatchEvent === 'function') {
          switcher.dispatchEvent(new Event('click', { bubbles: true }));
        }
      }
      // 点击没生效（theme.js 未加载 / 未绑定）时兜底轮换，保证按钮不会「按了没反应」
      if (currentTheme() === before
          && window.ThemeEngine && typeof window.ThemeEngine.applyTheme === 'function') {
        var index = THEMES.indexOf(before);
        if (index < 0) index = 0;
        window.ThemeEngine.applyTheme(THEMES[(index + 1) % THEMES.length]);
      }
      syncLabel();
    });
  }

  /** 单条通知节点（标题 + 时间；未读时左侧红点） */
  function noticeNode(item) {
    var unread = !!(item && item.is_read === false);
    var row = node('div', 'user-menu__notice' + (unread ? ' user-menu__notice--unread' : ''));
    if (unread) {
      row.appendChild(node('span', 'user-menu__dot'));
    }
    var body = node('div', 'user-menu__notice-body');
    body.appendChild(node('span', 'user-menu__notice-title', (item && item.title) || '系统通知'));
    var time = formatTime(item && item.created_at);
    if (time) body.appendChild(node('span', 'user-menu__notice-time', time));
    row.appendChild(body);
    return row;
  }

  /**
   * 渲染通知列表 + 红点 + 「全部已读」可用性
   * @param {string} [emptyText] 无数据 / 失败时的提示文案
   */
  function renderNotices(emptyText) {
    var listEl = state.notifyList;
    if (!listEl) return;
    // 用 innerHTML='' 清空（与 renderAuthStatus 清容器的写法一致）：
    // textContent='' 在真实浏览器里也清子节点，但 DOM 桩里不会 → 回归测试会看到重复行
    listEl.innerHTML = '';

    var items = state.items || [];
    if (!items.length) {
      listEl.appendChild(node('p', 'user-menu__hint', emptyText || '暂无通知'));
    } else {
      // 只画最近 5 条（后端已按新→旧返回，这里不再排序）
      items.slice(0, 5).forEach(function (item) {
        listEl.appendChild(noticeNode(item));
      });
    }

    var unread = Number(state.unreadPersonal) || 0;
    if (state.badge) {
      if (unread > 0) {
        state.badge.hidden = false;
        state.badge.textContent = unread > 99 ? '99+' : String(unread);
        state.badge.title = '有 ' + unread + ' 条未读个人通知';
      } else {
        state.badge.hidden = true;
        state.badge.textContent = '';
        state.badge.title = '';
      }
    }
    if (state.readAllBtn) {
      state.readAllBtn.disabled = items.length === 0 || unread === 0;
    }
  }

  /**
   * 懒加载个人通知：**首次展开面板时**才请求（进站不白打一个接口）
   * GET /api/v0/notify/personal 返回 { items:[...], unread:{total,global,personal} }
   * 失败静默降级：不弹全局 Toast，只在面板里给一句提示。
   */
  function ensureNotifications() {
    if (state.notifyLoaded || state.notifyLoading) return;
    var listEl = state.notifyList;
    if (!listEl) return;

    state.notifyLoading = true;
    listEl.innerHTML = '';
    listEl.appendChild(node('p', 'user-menu__hint', '加载中…'));

    // silent:true —— 面板是「顺带看一眼」，失败不该打断当前页面的操作
    var request = (typeof window.apiRequest === 'function')
      ? window.apiRequest('/api/v0/notify/personal', { silent: true })
      : Promise.resolve(null);

    function finish(result) {
      state.notifyLoading = false;
      state.notifyLoaded = true;
      // 等待期间面板可能被重建（renderAuthStatus 重跑）：只认当前列表节点
      if (state.notifyList !== listEl) return;
      var data = (result && result.code === 200 && result.data) ? result.data : null;
      if (!data) {
        state.items = [];
        state.unreadPersonal = 0;
        renderNotices('通知暂时不可用');
        return;
      }
      state.items = Array.isArray(data.items) ? data.items : [];
      var unread = (data.unread && typeof data.unread === 'object') ? data.unread : {};
      state.unreadPersonal = Number(unread.personal) || 0;
      renderNotices();
    }

    request.then(finish).catch(function () { finish(null); });
  }

  /**
   * 「全部已读」：POST /api/v0/notify/read-all
   * 面板只展示个人通知、拿不到全局通知的 id 清单，按约定传 { global_ids: [] }，
   * 后端据此只把本人个人通知置为已读。
   */
  function readAll() {
    if (typeof window.apiRequest !== 'function') return;
    if (state.readAllBtn) state.readAllBtn.disabled = true;

    window.apiRequest('/api/v0/notify/read-all', {
      method: 'POST',
      body: { global_ids: [] },
      silent: true
    }).then(function (result) {
      if (!result || result.code !== 200) {
        // 失败静默：只把按钮恢复可点，不弹 Toast
        if (state.readAllBtn) state.readAllBtn.disabled = false;
        return;
      }
      (state.items || []).forEach(function (item) {
        if (item) item.is_read = true;
      });
      state.unreadPersonal = 0;
      if (result.data && result.data.unread) {
        var personal = Number(result.data.unread.personal);
        if (Number.isFinite(personal)) state.unreadPersonal = personal;
      }
      renderNotices();
    }).catch(function () {
      if (state.readAllBtn) state.readAllBtn.disabled = false;
    });
  }

  /** 展开面板：补 ARIA、挂全局监听、懒加载通知、焦点移入首个菜单项 */
  function openPanel() {
    var panel = state.panel;
    if (!panel || state.open) return;
    state.open = true;
    panel.classList.add('user-menu--open');
    state.triggers.forEach(function (trigger) {
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
    });

    attachGlobalListeners();
    ensureNotifications();

    // 焦点移进面板：键盘用户 Tab 进来就在面板内，
    // Esc 收起时再由 closePanel(true) 把焦点还回头像。
    var firstItem = panel.querySelector('[role="menuitem"]');
    if (firstItem && typeof firstItem.focus === 'function') {
      try { firstItem.focus(); } catch (e) { /* 焦点失败不影响展开 */ }
    }
  }

  /**
   * 收起面板
   * @param {boolean} restoreFocus 是否把焦点还回头像。Esc / 再次点头像时为 true；
   *        点页面外部关掉时不抢焦点，否则会把焦点从用户刚点的地方拽走。
   */
  function closePanel(restoreFocus) {
    if (!state.open) return;
    state.open = false;
    if (state.panel) state.panel.classList.remove('user-menu--open');
    state.triggers.forEach(function (trigger) {
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
    if (restoreFocus) {
      var avatarTrigger = state.triggers[0];
      if (avatarTrigger && typeof avatarTrigger.focus === 'function') {
        try { avatarTrigger.focus(); } catch (e) { /* 忽略 */ }
      }
    }
  }

  function toggle() {
    if (state.open) closePanel(true);
    else openPanel();
  }

  /**
   * 判断 node 是否在 root 之内。
   * 不用 Element.contains：一是行为等价（沿 parentNode 上溯），二是回归测试的 DOM 桩
   * （tools/dom-stub.mjs）没有实现 Element.contains，写了会直接抛错、把关闭逻辑测成"点了没反应"。
   */
  function contains(root, nodeEl) {
    var current = nodeEl;
    while (current) {
      if (current === root) return true;
      current = current.parentNode;
    }
    return false;
  }

  /** 点外部 / Esc 关闭：document 上只挂一次（重复调用直接返回） */
  function attachGlobalListeners() {
    if (state.onDocPointerDown) return;

    state.onDocPointerDown = function (event) {
      if (!state.open) return;
      var target = event.target;
      if (!target) return;
      if (state.panel && contains(state.panel, target)) return;
      for (var i = 0; i < state.triggers.length; i++) {
        var trigger = state.triggers[i];
        if (trigger && contains(trigger, target)) return;
      }
      closePanel(false);
    };

    state.onDocKeyDown = function (event) {
      if (!state.open) return;
      if (event.key === 'Escape' || event.key === 'Esc') {
        closePanel(true);
      }
    };

    // 捕获阶段监听：面板 / 触发器之外的任何点击都能关掉（不必关心其它脚本的 stopPropagation）
    document.addEventListener('pointerdown', state.onDocPointerDown, true);
    document.addEventListener('keydown', state.onDocKeyDown, true);
  }

  /**
   * 拆掉上一轮面板挂的 document 级监听并清空状态。
   * 为什么必须显式拆：renderAuthStatus / renderTopNavAuth 都会被重复调用，
   * 而清空容器只会删节点，document 上的监听会留着 →
   * 监听泄漏 + 关闭逻辑对着已删除的面板跑。
   */
  function teardown() {
    if (state.onDocPointerDown) {
      document.removeEventListener('pointerdown', state.onDocPointerDown, true);
      state.onDocPointerDown = null;
    }
    if (state.onDocKeyDown) {
      document.removeEventListener('keydown', state.onDocKeyDown, true);
      state.onDocKeyDown = null;
    }
    state.panel = null;
    state.triggers = [];
    state.open = false;
    state.notifyLoaded = false;
    state.notifyLoading = false;
    state.items = [];
    state.unreadPersonal = 0;
    state.notifyList = null;
    state.badge = null;
    state.readAllBtn = null;
    state.themeBtn = null;
  }

  function toTriggerArray(triggers) {
    if (!triggers) return [];
    if (Object.prototype.toString.call(triggers) === '[object Array]') return triggers;
    return [triggers];
  }

  /**
   * 把「头像 / 用户名」接成面板开关（保持既有 DOM 结构，只补 ARIA 与事件）
   * @param {HTMLElement|HTMLElement[]} triggers 头一个必须是头像 img.user-avatar（Esc 后焦点还给它）
   * @param {HTMLElement} panel build() 返回的面板根节点
   */
  function bind(triggers, panel) {
    var list = toTriggerArray(triggers).filter(Boolean);
    if (!panel || !list.length) return;
    state.triggers = list;
    state.panel = panel;

    list.forEach(function (trigger, index) {
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', panel.id);

      if (index === 0) {
        // 头像本身不是可聚焦控件：补成按钮语义，键盘可 Tab 到、Enter / Space 展开
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('tabindex', '0');
        trigger.setAttribute('aria-label', '用户菜单');
      }

      trigger.addEventListener('click', function (event) {
        // 用户名的 href 仍指向仪表盘（中键 / 上下文菜单可用），左键改为展开面板
        event.preventDefault();
        toggle();
      });

      trigger.addEventListener('keydown', function (event) {
        if (event.repeat) return;
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
        // 阻止 a[href] 的默认「回车即导航」，否则面板刚开就被跳转打断
        event.preventDefault();
        toggle();
      });
    });
  }

  window.AvatarMenu = {
    build: build,
    bind: bind,
    open: openPanel,
    close: closePanel,
    toggle: toggle,
    teardown: teardown,
    isOpen: function () { return state.open; }
  };
})();
