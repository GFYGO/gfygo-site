# 前端画面开发指南 (UI_DEV_GUIDE)

## 1. 颜色与视觉变量 (Design Tokens)
所有颜色、阴影必须在 `:root` 中通过 CSS 变量调用：
- **主色调**: `--color-primary: #4f46e5` (Indigo)
- **背景色**: 
  - 全局底色: `--color-bg-body: #f8fafc`
  - 卡片/面板: `--color-bg-white: #ffffff`
  - 交替区块: `--color-bg-section-alt: #f1f5f9`
- **阴影层级**: 提供 `--shadow-sm`, `--shadow-md`, `--shadow-lg`，用于卡片悬浮和侧边栏抽屉。
- **毛玻璃效果**: Header 使用了 `backdrop-filter: blur(8px)` 提升现代感。

## 2. 组件样式说明
- **BEM 命名规范**: 严格遵循 `block__element--modifier`。例如：`.home-section__title`。
- **登录页 Turnstile**: `#turnstile-container` 已预留 `min-height: 65px`，后端/业务逻辑开发者可直接将 Cloudflare Turnstile 实例挂载至此 DOM 节点。
- **个人主页侧边栏**: 
  - PC端：使用 `position: sticky; top: var(--header-height);` 实现滚动冻结。
  - 移动端：CSS 中默认 `display: none`。业务逻辑需监听汉堡菜单(`#menuToggle`)点击，为 `#profileSidebar` 添加 `profile-sidebar--open` 类名，同时为 `#sidebarOverlay` 添加 `sidebar-overlay--visible` 类名以展示抽屉和遮罩。

## 3. 布局规范
- **首页板块**: 统一使用 Flexbox 居中，字号与留白已做放大处理（`2.5rem` 标题，`80px` 上下间距）。
- **响应式断点**: 核心断点为 `768px`。低于此宽度时，多列布局转为单列，侧边栏转为抽屉模式，顶部导航隐藏。
- **微交互**: 按钮和输入框已添加 `transition` 和 `focus` 状态样式（如聚焦时的外发光 `box-shadow`）。

## 4. 后续维护注意事项
1. 纯 CSS 实现，无任何第三方 UI 框架依赖，轻量且易于二次定制。
2. 登录表单的 `<form id="loginForm">` 已预留，请勿在 HTML 中编写 `onclick` 等内联事件，统一由 JS 模块通过 `addEventListener('submit', ...)` 接管。