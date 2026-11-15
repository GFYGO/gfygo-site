/**
 * index.js
 * 首页初始化脚本 + 全局公共逻辑（移动端菜单、侧边栏）
 */

function initIndex() {
  // 初始化移动端汉堡菜单
  initMobileMenu();

  // 初始化移动端侧边栏（dashboard 页面）
  initMobileSidebar();

  // 任务 FE-JS-01: 页面加载时并发请求
  Promise.all([
    fetchGlobalNotifications(),
    fetchAuthStatus()
  ]).catch(error => {
    // 捕获单个请求失败可能抛出的错误，避免影响其他功能
    console.error('首页初始化请求发生异常:', error);
  });
}

// 管理员页面通过 fetch 动态加载脚本，DOMContentLoaded 可能已触发
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIndex);
} else {
  initIndex();
}

/**
 * 移动端汉堡菜单切换
 */
function initMobileMenu() {
  const menuToggle = document.getElementById('menuToggle');
  const headerNav = document.getElementById('headerNav');

  if (menuToggle && headerNav) {
    // ⭐ P2-10（2026-10-21 审查）：折叠按钮要播报展开状态，Esc 能收起
    const setOpen = (open) => {
      headerNav.classList.toggle('header__nav--open', open);
      if (menuToggle.hasAttribute('aria-expanded')) {
        menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    };

    menuToggle.addEventListener('click', () => {
      setOpen(!headerNav.classList.contains('header__nav--open'));
    });

    // 点击导航链接后自动收起菜单
    headerNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        setOpen(false);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && headerNav.classList.contains('header__nav--open')) {
        setOpen(false);
        menuToggle.focus();
      }
    });
  }
}

/**
 * 移动端侧边栏切换（dashboard 页面）
 */
function initMobileSidebar() {
  const sidebar = document.getElementById('dashboardSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const sidebarClose = document.getElementById('sidebarClose');

  if (!sidebar) return;

  if (sidebarClose) {
    sidebarClose.addEventListener('click', closeSidebar);
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  function closeSidebar() {
    sidebar.classList.remove('dashboard-sidebar--open');
    if (overlay) overlay.classList.remove('sidebar-overlay--visible');
  }
}

/**
 * 获取全局通知
 * 任务 FE-JS-03: 处理 /api/v0/notify/global 的响应并渲染
 */
async function fetchGlobalNotifications() {
  // dashboard / 组织页 有自己的通知加载逻辑，此处跳过
  // 注：下方正则里的 admin1/admin2/admin3/superadmin 是早期「按等级分目录」方案的
  //     历史兼容路径；今日前端仓库只有 user/dashboard.html，不存在这四个目录。
  //     保留这些替代名只为不破坏历史路径的短路判断，不代表这些目录存在。
  if (/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname)
      || /\/org\/index\.html$/i.test(window.location.pathname)) {
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/v0/notify/global`);
    const data = await response.json();
    if (response.ok && data.code === 200) {
      renderGlobalNotifications(data.data);
    } else {
      console.warn('获取全局通知失败:', data.msg);
    }
  } catch (error) {
    console.error('获取全局通知时发生网络错误:', error);
  }
}

/**
 * 检查登录状态
 * 任务 FE-JS-02: 处理 /api/v0/auth/status 的响应并渲染用户信息
 */
async function fetchAuthStatus() {
  // 所有 dashboard 类页面由 dashboard.js 独立处理认证状态，避免重复渲染冲突
  // 注：admin1/admin2/admin3/superadmin 为历史兼容目录名（今日前端只有 user/），
  //     详见 fetchGlobalNotifications() 上方的说明。
  if (/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname)) {
    return;
  }
  // 组织页自己渲染顶栏用户区（org.js::renderOrgAuthArea），这里跳过以免两套逻辑互相覆盖
  if (/\/org\/index\.html$/i.test(window.location.pathname)) {
    return;
  }

  // 访客视角预览模式：跳过 API 调用，直接渲染未登录状态
  if (localStorage.getItem('guest_view_mode') === 'true') {
    renderAuthStatus(null);
    return;
  }

  const token = AuthGuard.getToken();
  // 如果没有 token，则直接渲染未登录状态
  if (!token) {
    renderAuthStatus(null);
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/v0/auth/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (response.ok && data.code === 200) {
      renderAuthStatus(data.data.user);
      // 已登录用户访问登录/注册页面时，自动重定向到 dashboard
      const currentPath = window.location.pathname;
      if (currentPath.endsWith('/login.html') || currentPath.endsWith('/register.html')) {
        window.location.href = `${BASE_PATH}/user/dashboard.html`;
      }
    } else {
      // 如果 token 无效或过期，按未登录状态处理
      console.warn('认证状态检查失败:', data.msg);
      renderAuthStatus(null);
    }
  } catch (error) {
    console.error('检查认证状态时发生网络错误:', error);
    renderAuthStatus(null);
  }
}

/**
 * 渲染全局通知到页面
 * @param {Array} notifications 通知数据数组
 */
function renderGlobalNotifications(notifications) {
  const container = document.getElementById('global-notifications-container');
  if (!container) return;

  container.innerHTML = '';

  // ⭐ 2026-10-25（P2 复核）：容器改成常驻的 `role="log"` live region，这里不再写
  //    内联 `display`（空容器零高度，本来就看不见）。原因有二：
  //    ① `styles.css` 在 ≤768px 已把 `#global-notifications-container` 设为
  //       `display:none`，内联 `display:flex` 会盖掉它（旧代码为此外挂了 matchMedia 判断）；
  //    ② 把容器 `display:none` 会让 live region 离开可访问树，读屏听不到新通知。
  function notificationsAllowed() {
    try {
      return !(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    } catch (e) {
      return true;
    }
  }

  if (!notifications || notifications.length === 0 || !notificationsAllowed()) {
    return;
  }

  notifications.forEach(notification => {
    const notificationEl = document.createElement('div');
    notificationEl.className = 'notification-item';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', '关闭通知');
    closeBtn.addEventListener('click', function() {
      notificationEl.style.transition = 'opacity 0.2s';
      notificationEl.style.opacity = '0';
      setTimeout(function() {
        notificationEl.remove();
      }, 200);
    });
    
    const titleEl = document.createElement('h3');
    titleEl.textContent = notification.title;
    const p = document.createElement('p');
    p.textContent = notification.content;
    
    notificationEl.appendChild(closeBtn);
    notificationEl.appendChild(titleEl);
    notificationEl.appendChild(p);
    container.appendChild(notificationEl);
  });
}

/* ============================================================
   右上角用户菜单（头像下拉面板 · SPA 化，2026-11-15）
   ------------------------------------------------------------
   为什么要有：顶栏点用户名原先**整页跳到仪表盘**，而「看资料 / 去常用页面 /
   看通知 / 换主题 / 退出」这些高频动作都得先跳走再找入口。这里把它们收进一个
   贴着头像展开的面板，点外部或 Esc 收起，全程不刷新页面。

   约定：
   * 面板 appendChild 到 auth-container（该容器在 core.css 里是 position: relative），
     所以面板一定是「贴着头像向下展开」，不用 JS 算坐标；
   * 所有后端字符串（昵称 / 邮箱 / 通知标题）一律 textContent 落到 DOM，
     不做 innerHTML 拼接 —— 从根上避免转义漏项；
   * 请求失败静默降级：不弹全局 Toast，只在面板里给一句静态提示。
   ============================================================ */

// 主题轮换顺序与 js/theme.js::THEME_LIST 保持一致（那边是未挂 window 的 var，不能直接依赖）
var AVATAR_MENU_THEMES = ['green', 'light', 'gray', 'dark_green'];
var AVATAR_MENU_THEME_LABELS = {
  green: '绿色',
  light: '白色',
  gray: '灰色',
  dark_green: '深色'
};

// 面板运行时状态（单例：一个页面同时只会有一个顶栏面板）
var _avatarMenuState = {
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

/** 建节点的小工具：文本一律走 textContent（等价于渲染前 escapeHtml，但没有漏转义的可能） */
function avatarMenuNode(tag, className, text) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function avatarMenuThemeLabel(theme) {
  return AVATAR_MENU_THEME_LABELS[theme] || AVATAR_MENU_THEME_LABELS.green;
}

/** 当前主题：读 body 上的 theme-* 类（theme.js 应用后的唯一真相），不去猜 localStorage 键名 */
function avatarMenuCurrentTheme() {
  var body = document.body;
  if (body && body.classList) {
    for (var i = 0; i < AVATAR_MENU_THEMES.length; i++) {
      if (body.classList.contains('theme-' + AVATAR_MENU_THEMES[i])) return AVATAR_MENU_THEMES[i];
    }
  }
  return 'green';
}

/** 时间显示口径与 user/dashboard.notifications.js::notifyDate 一致（只取到分钟） */
function avatarMenuFormatTime(value) {
  var text = String(value || '');
  return text ? text.substring(0, 16).replace('T', ' ') : '';
}

/**
 * 构建下拉面板（只建节点、不插 DOM，由 renderAuthStatus appendChild 到 auth-container）
 * @param {Object} userInfo /api/v0/auth/status 的 data.user
 * @returns {HTMLElement} 面板根节点
 */
function buildAvatarMenu(userInfo) {
  var profile = userInfo.profile || {};
  var defaultAvatar = BASE_PATH + '/favicon.png';
  // 等级口径同 renderAuthStatus：缺省按 Lv1（普通用户）
  var level = parseInt(userInfo.permission_level, 10);
  if (!Number.isFinite(level)) level = 1;
  var roleName = (window.ROLE_NAMES && window.ROLE_NAMES[level]) || ('等级 ' + level);

  var panel = avatarMenuNode('div', 'user-menu');
  panel.id = 'user-menu-panel';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', '用户菜单');

  // ---- ① 资料区：头像 / 显示名 / @用户名 / 等级 / 邮箱与验证状态 ----
  var profileBox = avatarMenuNode('div', 'user-menu__profile');
  profileBox.setAttribute('role', 'none');
  var profileAvatar = document.createElement('img');
  profileAvatar.className = 'user-menu__avatar';
  profileAvatar.src = profile.avatar || defaultAvatar;
  profileAvatar.alt = '';
  profileAvatar.onerror = function () { this.src = defaultAvatar; };
  profileBox.appendChild(profileAvatar);

  var identity = avatarMenuNode('div', 'user-menu__identity');
  // 显示名优先昵称，其次用户名（与仪表盘按同一口径展示）
  identity.appendChild(avatarMenuNode('span', 'user-menu__name', profile.nickname || userInfo.username || ''));
  identity.appendChild(avatarMenuNode('span', 'user-menu__handle', '@' + (userInfo.username || '')));
  identity.appendChild(avatarMenuNode('span', 'user-menu__meta', '等级：' + roleName));
  var email = String(userInfo.email || '');
  if (email) {
    identity.appendChild(avatarMenuNode('span', 'user-menu__meta',
      email + '（' + (userInfo.email_verified ? '已验证' : '未验证') + '）'));
  }
  profileBox.appendChild(identity);
  panel.appendChild(profileBox);

  // ---- ② 快捷入口（站内相对路径，随 BASE_PATH 适配任意层级页面）----
  var shortcuts = [
    { label: '仪表盘', href: BASE_PATH + '/user/dashboard.html' },
    { label: '创作者', href: BASE_PATH + '/creator/index.html' },
    { label: '技能广场', href: BASE_PATH + '/skill/index.html' },
    { label: '组织', href: BASE_PATH + '/org/index.html' },
    { label: '发现', href: BASE_PATH + '/discover/index.html' }
  ];
  var shortcutSection = avatarMenuNode('div', 'user-menu__section');
  shortcutSection.setAttribute('role', 'none');
  shortcutSection.appendChild(avatarMenuNode('p', 'user-menu__title', '快捷入口'));
  shortcuts.forEach(function (item) {
    var link = avatarMenuNode('a', 'user-menu__item', item.label);
    link.href = item.href;
    link.setAttribute('role', 'menuitem');
    shortcutSection.appendChild(link);
  });
  panel.appendChild(shortcutSection);

  // ---- ③ 通知区：首次展开才懒加载（见 avatarMenuEnsureNotifications）----
  var notifySection = avatarMenuNode('div', 'user-menu__section');
  notifySection.setAttribute('role', 'none');
  var notifyHead = avatarMenuNode('div', 'user-menu__section-head');
  notifyHead.appendChild(avatarMenuNode('p', 'user-menu__title', '通知'));
  var badge = avatarMenuNode('span', 'user-menu__badge');
  badge.hidden = true;
  notifyHead.appendChild(badge);
  var readAllBtn = avatarMenuNode('button', 'user-menu__action', '全部已读');
  readAllBtn.type = 'button';
  readAllBtn.disabled = true;
  notifyHead.appendChild(readAllBtn);
  var notifyList = avatarMenuNode('div', 'user-menu__notices');
  notifyList.setAttribute('role', 'none');
  notifySection.appendChild(notifyHead);
  notifySection.appendChild(notifyList);
  panel.appendChild(notifySection);

  _avatarMenuState.notifyList = notifyList;
  _avatarMenuState.badge = badge;
  _avatarMenuState.readAllBtn = readAllBtn;
  readAllBtn.addEventListener('click', avatarMenuReadAll);

  // ---- ④ 主题切换 ----
  var themeSection = avatarMenuNode('div', 'user-menu__section');
  themeSection.setAttribute('role', 'none');
  var themeBtn = avatarMenuNode('button', 'user-menu__item user-menu__theme');
  themeBtn.type = 'button';
  themeBtn.setAttribute('role', 'menuitem');
  themeSection.appendChild(themeBtn);
  panel.appendChild(themeSection);
  _avatarMenuState.themeBtn = themeBtn;
  avatarMenuBindTheme(themeBtn);

  // ---- ⑤ 退出登录 ----
  var logoutSection = avatarMenuNode('div', 'user-menu__section');
  logoutSection.setAttribute('role', 'none');
  var logoutItem = avatarMenuNode('a', 'user-menu__item user-menu__logout', '退出登录');
  logoutItem.href = '#';
  logoutItem.setAttribute('role', 'menuitem');
  logoutSection.appendChild(logoutItem);
  panel.appendChild(logoutSection);
  logoutItem.addEventListener('click', function (event) {
    event.preventDefault();
    avatarMenuClose(false);
    // 与顶栏「退出」走**同一条路径**（logoutBtn 自己会 clearToken 再跳登录页），
    // 避免两处实现随时间漂移；只有它不在 DOM 里时才自己兜底。
    var legacyLogout = document.getElementById('logoutBtn');
    if (legacyLogout && typeof legacyLogout.click === 'function') {
      legacyLogout.click();
      return;
    }
    AuthGuard.clearToken();
    window.location.replace(BASE_PATH + '/login.html?_t=' + Date.now());
  });

  return panel;
}

/**
 * 主题切换按钮：先看 theme.js 提供了什么再决定路径
 *  - 有 theme-selector（全站页面都有）：触发它的 click —— theme.js 已绑定
 *    「轮换到下一个主题 + 同步到服务端」，复用才不会出现「面板换了、服务端没换」；
 *  - 没有该按钮（如后端下发的动态页面）：回退到 ThemeEngine.applyTheme 自己轮换。
 */
function avatarMenuBindTheme(button) {
  function syncLabel() {
    button.textContent = '主题：' + avatarMenuThemeLabel(avatarMenuCurrentTheme()) + '（点击切换）';
  }
  syncLabel();

  button.addEventListener('click', function () {
    var before = avatarMenuCurrentTheme();
    var switcher = document.getElementById('theme-selector');
    if (switcher) {
      // 走 theme.js 已绑定的 click；click() 不在时（DOM 桩 / 极老浏览器）退回派发事件
      if (typeof switcher.click === 'function') {
        switcher.click();
      } else if (typeof switcher.dispatchEvent === 'function') {
        switcher.dispatchEvent(new Event('click', { bubbles: true }));
      }
    }
    // 点击没生效（theme.js 未加载 / 未绑定）时兜底轮换，保证按钮不会「按了没反应」
    if (avatarMenuCurrentTheme() === before
        && window.ThemeEngine && typeof window.ThemeEngine.applyTheme === 'function') {
      var index = AVATAR_MENU_THEMES.indexOf(before);
      if (index < 0) index = 0;
      window.ThemeEngine.applyTheme(AVATAR_MENU_THEMES[(index + 1) % AVATAR_MENU_THEMES.length]);
    }
    syncLabel();
  });
}

/** 单条通知节点（标题 + 时间；未读时左侧红点） */
function avatarMenuNoticeNode(item) {
  var unread = !!(item && item.is_read === false);
  var row = avatarMenuNode('div', 'user-menu__notice' + (unread ? ' user-menu__notice--unread' : ''));
  if (unread) {
    row.appendChild(avatarMenuNode('span', 'user-menu__dot'));
  }
  var body = avatarMenuNode('div', 'user-menu__notice-body');
  body.appendChild(avatarMenuNode('span', 'user-menu__notice-title', (item && item.title) || '系统通知'));
  var time = avatarMenuFormatTime(item && item.created_at);
  if (time) body.appendChild(avatarMenuNode('span', 'user-menu__notice-time', time));
  row.appendChild(body);
  return row;
}

/**
 * 渲染通知列表 + 红点 + 「全部已读」可用性
 * @param {string} [emptyText] 无数据 / 失败时的提示文案
 */
function avatarMenuRenderNotices(emptyText) {
  var state = _avatarMenuState;
  var listEl = state.notifyList;
  if (!listEl) return;
  // 用 innerHTML='' 清空（与 renderAuthStatus 清容器的写法一致）：
  // textContent='' 在真实浏览器里也清子节点，但 DOM 桩里不会 → 回归测试会看到重复行
  listEl.innerHTML = '';

  var items = state.items || [];
  if (!items.length) {
    listEl.appendChild(avatarMenuNode('p', 'user-menu__hint', emptyText || '暂无通知'));
  } else {
    // 只画最近 5 条（后端已按新→旧返回，这里不再排序）
    items.slice(0, 5).forEach(function (item) {
      listEl.appendChild(avatarMenuNoticeNode(item));
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
function avatarMenuEnsureNotifications() {
  var state = _avatarMenuState;
  if (state.notifyLoaded || state.notifyLoading) return;
  var listEl = state.notifyList;
  if (!listEl) return;

  state.notifyLoading = true;
  listEl.innerHTML = '';
  listEl.appendChild(avatarMenuNode('p', 'user-menu__hint', '加载中…'));

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
      avatarMenuRenderNotices('通知暂时不可用');
      return;
    }
    state.items = Array.isArray(data.items) ? data.items : [];
    var unread = (data.unread && typeof data.unread === 'object') ? data.unread : {};
    state.unreadPersonal = Number(unread.personal) || 0;
    avatarMenuRenderNotices();
  }

  request.then(finish).catch(function () { finish(null); });
}

/**
 * 「全部已读」：POST /api/v0/notify/read-all
 * 面板只展示个人通知、拿不到全局通知的 id 清单，按约定传 { global_ids: [] }，
 * 后端据此只把本人个人通知置为已读。
 */
function avatarMenuReadAll() {
  var state = _avatarMenuState;
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
    avatarMenuRenderNotices();
  }).catch(function () {
    if (state.readAllBtn) state.readAllBtn.disabled = false;
  });
}

/** 展开面板：补 ARIA、挂全局监听、懒加载通知、焦点移入首个菜单项 */
function avatarMenuOpen() {
  var state = _avatarMenuState;
  var panel = state.panel;
  if (!panel || state.open) return;
  state.open = true;
  panel.classList.add('user-menu--open');
  state.triggers.forEach(function (trigger) {
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  });

  avatarMenuAttachGlobalListeners();
  avatarMenuEnsureNotifications();

  // 焦点移进面板：键盘用户 Tab 进来就在面板内，
  // Esc 收起时再由 avatarMenuClose(true) 把焦点还回头像。
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
function avatarMenuClose(restoreFocus) {
  var state = _avatarMenuState;
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

function avatarMenuToggle() {
  if (_avatarMenuState.open) avatarMenuClose(true);
  else avatarMenuOpen();
}

/**
 * 判断 node 是否在 root 之内。
 * 不用 Element.contains：一是行为等价（沿 parentNode 上溯），二是回归测试的 DOM 桩
 * （tools/dom-stub.mjs）没有实现 Element.contains，写了会直接抛错、把关闭逻辑测成"点了没反应"。
 */
function avatarMenuContains(root, node) {
  var current = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode;
  }
  return false;
}

/** 点外部 / Esc 关闭：document 上只挂一次（重复调用直接返回） */
function avatarMenuAttachGlobalListeners() {
  var state = _avatarMenuState;
  if (state.onDocPointerDown) return;

  state.onDocPointerDown = function (event) {
    if (!state.open) return;
    var target = event.target;
    if (!target) return;
    if (state.panel && avatarMenuContains(state.panel, target)) return;
    for (var i = 0; i < state.triggers.length; i++) {
      var trigger = state.triggers[i];
      if (trigger && avatarMenuContains(trigger, target)) return;
    }
    avatarMenuClose(false);
  };

  state.onDocKeyDown = function (event) {
    if (!state.open) return;
    if (event.key === 'Escape' || event.key === 'Esc') {
      avatarMenuClose(true);
    }
  };

  // 捕获阶段监听：面板 / 触发器之外的任何点击都能关掉（不必关心其它脚本的 stopPropagation）
  document.addEventListener('pointerdown', state.onDocPointerDown, true);
  document.addEventListener('keydown', state.onDocKeyDown, true);
}

/**
 * 拆掉上一轮面板挂的 document 级监听并清空状态。
 * 为什么必须显式拆：renderAuthStatus 会被重复调用（组织页 org.js 也调它），
 * 而清空容器只会删节点，document 上的监听会留着 →
 * 监听泄漏 + 关闭逻辑对着已删除的面板跑。
 */
function avatarMenuTeardown() {
  var state = _avatarMenuState;
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

/**
 * 把「头像 / 用户名」接成面板开关（保持既有 DOM 结构，只补 ARIA 与事件）
 * @param {HTMLElement} avatarTrigger img.user-avatar
 * @param {HTMLElement} usernameTrigger a.username
 * @param {HTMLElement} panel 面板根节点
 */
function bindAvatarMenuTriggers(avatarTrigger, usernameTrigger, panel) {
  var state = _avatarMenuState;
  state.triggers = [avatarTrigger, usernameTrigger].filter(Boolean);
  state.panel = panel;

  state.triggers.forEach(function (trigger, index) {
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
      avatarMenuToggle();
    });

    trigger.addEventListener('keydown', function (event) {
      if (event.repeat) return;
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      // 阻止 a[href] 的默认「回车即导航」，否则面板刚开就被跳转打断
      event.preventDefault();
      avatarMenuToggle();
    });
  });
}

/**
 * 渲染右上角用户状态
 * 已登录 → 显示头像 + 用户名 + 退出链接（DOM 契约不变），并追加**用户下拉面板**
 *          （资料 / 快捷入口 / 通知 / 主题 / 退出；点头像或用户名展开，不跳页）
 * 未登录 → auth-container 留空（导航栏已有登录/注册链接）
 * @param {Object|null} userInfo 用户信息对象 (data.data.user)，未登录时为 null
 */
function renderAuthStatus(userInfo) {
  // ⚠️ 重建前先拆上一轮面板：本函数会被重复调用（组织页 org.js 也调它），
  //    清空容器只删节点，document 上的监听必须自己摘，否则泄漏。
  avatarMenuTeardown();

  // 暂存当前用户实际权限等级，供非 dashboard 页切换按钮重绘时使用
  if (userInfo) {
    window.__currentUserPermissionLevel = userInfo.permission_level || 1;
  }

  const authContainer = document.getElementById('auth-container');
  if (!authContainer) return;

  authContainer.innerHTML = '';

  const navLoginLinks = document.querySelectorAll('.header__nav a[href*="login"]');
  const navRegisterLinks = document.querySelectorAll('.header__nav a[href*="register"]');

  if (userInfo) {
    const avatar = (userInfo.profile && userInfo.profile.avatar) ? userInfo.profile.avatar : '';
    const defaultAvatar = `${BASE_PATH}/favicon.png`;

    const userEl = document.createElement('div');
    userEl.className = 'user-info';

    const img = document.createElement('img');
    img.src = avatar || defaultAvatar;
    img.alt = userInfo.username;
    // class 契约：user-avatar 必须保留（回归测试按 img.user-avatar 断言），
    // 额外补的 user-menu-trigger 只负责光标/展开态样式
    img.className = 'user-avatar user-menu-trigger';
    img.onerror = function() { this.src = defaultAvatar; };
    userEl.appendChild(img);

    const usernameLink = document.createElement('a');
    usernameLink.href = `${BASE_PATH}/user/dashboard.html`;
    usernameLink.className = 'username user-menu-trigger';
    usernameLink.textContent = userInfo.username;
    userEl.appendChild(usernameLink);

    const logoutLink = document.createElement('a');
    logoutLink.href = '#';
    logoutLink.className = 'logout-link';
    logoutLink.id = 'logoutBtn';
    logoutLink.textContent = '退出';
    userEl.appendChild(logoutLink);

    authContainer.appendChild(userEl);

    // ⭐ 用户下拉面板：appendChild 到 auth-container（该容器是 position: relative，
    //    见 css/core.css），点头像 / 用户名在本页展开，不跳页。
    //    #auth-container 里同时保留 .user-info / img.user-avatar / a.username / #logoutBtn，
    //    既有契约（回归断言）不受影响。
    const userMenuPanel = buildAvatarMenu(userInfo);
    authContainer.appendChild(userMenuPanel);
    bindAvatarMenuTriggers(img, usernameLink, userMenuPanel);

    navLoginLinks.forEach(link => link.style.display = 'none');
    navRegisterLinks.forEach(link => link.style.display = 'none');

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        AuthGuard.clearToken();
        window.location.replace(`${BASE_PATH}/login.html?_t=${Date.now()}`);
      });
    }

    // 渲染权限切换按钮（仅管理员可见）
    if (typeof window.renderPermissionButtons === 'function') {
      window.renderPermissionButtons(userInfo ? userInfo.permission_level : 0);
    }
  } else {
    navLoginLinks.forEach(link => link.style.display = '');
    navRegisterLinks.forEach(link => link.style.display = '');
    if (typeof window.renderPermissionButtons === 'function') {
      window.renderPermissionButtons(0);
    }
  }
}

// 角色名映射：全局单例挂载（不用 const 别名，避免与 dashboard.js 同名声明冲突）
if (!window.ROLE_NAMES) {
  window.ROLE_NAMES = {
    0: '未登录',
    1: '普通用户',
    2: '一级管理员',
    3: '二级管理员',
    4: '三级管理员',
    5: '超级管理员'
  };
}

/**
 * 渲染右上角权限等级切换按钮
 *  - realLevel（真实等级，来自 /auth/status）<= 1：不显示按钮
 *  - 当前运行时等级来自 window.__nowPermission.level（默认 1，可切换）
 *  - 行为：调用 /auth/switch-permission 真实切换 level（可升可降，不越权 realLevel）
 *
 * ⚠️ 兼容两种签名：这里传的是**数字**（真实等级），而
 *    `user/dashboard.auth.js` 也导出同名函数、传的是**对象** `{current_level, max_level}`。
 *    两者都挂在 `window.renderPermissionButtons` 上，历史上谁后加载谁生效 →
 *    在主页面上被调成对象版就会把「数字」当成对象读，`current_level` 恒为 undefined，
 *    表现为**无论切到哪一级，高亮都停在 Lv1**（切换看着像没生效）。
 *    因此这里用 `normalizePermissionArgs()` 统一取值：谁后加载都不会读错参数。
 */
function normalizePermissionArgs(input) {
  if (input && typeof input === 'object') {
    const current = parseInt(input.current_level != null ? input.current_level : input.level, 10);
    const max = parseInt(input.max_level != null ? input.max_level : input.real_level, 10);
    return {
      realLevel: Number.isFinite(max) ? max : 1,
      currentLevel: Number.isFinite(current) ? current : 1,
    };
  }
  const real = parseInt(input, 10);
  const np = window.__nowPermission || {};
  const current = parseInt(np.level, 10);
  return {
    realLevel: Number.isFinite(real) ? real : 1,
    currentLevel: Number.isFinite(current) ? current : 1,
  };
}

window.renderPermissionButtons = window.renderPermissionButtons || function (levelOrInfo) {
  const container = document.getElementById('permissionButtons');
  if (!container) return;

  const normalized = normalizePermissionArgs(levelOrInfo);
  const realLevel = normalized.realLevel;

  container.innerHTML = '';

  // 未登录 / 普通用户：没有可切换的等级
  if (!realLevel || realLevel <= 1) return;

  // 当前运行时等级（优先用参数里的，其次读 now_permission）
  const currentLevel = normalized.currentLevel || 1;

  // 显示等级 1 到真实等级的按钮（可升可降）
  const levels = [1];
  for (let level = 2; level <= realLevel; level++) {
    levels.push(level);
  }

  levels.forEach(level => {
    const btn = document.createElement('button');
    btn.className = 'perm-btn';
    if (level === currentLevel) {
      // ⚠️ 类名契约：CSS 只定义了 `.perm-btn--current`（components.css），
      //    写成 `--active` 会让任何等级都不高亮（历史 bug，见 PROJECT_MEMORY §9.3）。
      btn.classList.add('perm-btn--current');
    }
    btn.textContent = level;
    btn.title = `切换到 ${window.ROLE_NAMES[level] || `等级${level}`}`;
    btn.addEventListener('click', () => {
      if (typeof window.handlePermissionClick === 'function') window.handlePermissionClick(level);
    });
    container.appendChild(btn);
  });
};

/**
 * 切换等级后让按钮高亮立即跟随新等级。
 *
 * 之前这里**根本没有重绘**：切完只改了 token 与 `window.__nowPermission`，
 * 屏幕上的按钮还是按旧等级画的 → 用户看到「点了没反应 / 高亮没变」。
 * 重绘时以「服务端返回的新等级为当前等级、真实最高等级保持不变」为准。
 */
function refreshPermissionButtonsAfterSwitch(newLevel) {
  const realLevel = parseInt(window.__currentUserPermissionLevel, 10);
  const max = Number.isFinite(realLevel) && realLevel >= 1 ? realLevel : newLevel;
  try {
    window.renderPermissionButtons({ current_level: newLevel, max_level: max });
  } catch (e) {
    console.warn('重绘权限按钮失败:', e);
  }
}

window.handlePermissionClick = window.handlePermissionClick || async function (level) {
  // 调用切换 API（真实切换 now_permission.level，可升可降）
  try {
    const token = AuthGuard.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`${API_BASE_URL}/api/v0/auth/switch-permission`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ target_level: level })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('切换权限失败:', err.msg || res.status);
      return;
    }
    const data = await res.json();
    const np = (data.data || {});
    AuthGuard.setToken(np.access_token, np.expires_in);
    // ⚠️ 前端兜底的 context 阈值必须与后端一致：`services/auth_service.py::switch_permission`
    //    是 `target_level >= 2 → 'admin'`。历史上这里写成 `>= 4`，
    //    导致 Lv2/Lv3 切完之后管理接口全被判成「缺少 admin 权限上下文」。
    window.__nowPermission = np.now_permission || { level, context: level >= 2 ? 'admin' : null, nodes: [] };
  } catch (e) {
    console.warn('切换权限请求异常:', e);
    return;
  }

  // 立即重绘：高亮必须在「点完就有反馈」，不能等下一次整页刷新
  refreshPermissionButtonsAfterSwitch(level);

  // 判断当前页面是否是 dashboard 类页面（需要跳转）
  // 注：admin1/admin2/admin3/superadmin 为历史兼容目录名（今日前端只有 user/）；
  //     无论命中哪个替代名，真实跳转目标都是 ${BASE_PATH}/user/dashboard.html（见下）。
  const isDashboardPage = /\/(user|admin1|admin2|admin3|superadmin)\/dashboard\.html$/i.test(window.location.pathname);

  if (isDashboardPage) {
    localStorage.removeItem('guest_view_mode');
    window.location.href = `${BASE_PATH}/user/dashboard.html`;
    return;
  }

  // 非 dashboard 页面：刷新以重新渲染按权限控制的 UI
  window.location.reload();
};