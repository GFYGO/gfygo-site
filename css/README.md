# GWL CSS 文件架构

## 核心文件（所有页面必加载）

- **`core.css`** — CSS 变量、4 套主题系统（green/light/gray/dark_green）、Reset、基础排版。所有页面第一个加载

## 通用文件（按需加载）

- **`styles.css`** — Header、Footer、首页 sections、登录表单、Theme Switcher、Header User Info、响应式布局
- **`components.css`** — Toast 通知、Modal 弹窗、全局通知弹窗（notification-toast）、权限等级切换按钮组
- **`feature-grid.css`** — 首页功能卡片网格（feature-grid / feature-tile）
- **`document.css`** — 文档中心页面（目录树、详情、编辑器、修订历史、面包屑、文件夹树）

## 页面专用文件

- **`login.css`** — 登录页专属样式
- **`register.css`** — 注册页专属样式

## Dashboard 文件（dashboard.html 加载）

- **`dashboard.css`** — Dashboard 布局、侧边栏、邮箱验证、主内容区、个人文档(pdocs)、EasyMDE 编辑器、注销账号、Admin 动态页面样式
- **`dashboard-admin.css`** — Admin 通用组件（表格、按钮、Switch、Tag、统计卡片、统计布局、权限编辑器、Checkbox 组、空状态、loading）
- **`dashboard-perms.css`** — 权限管理页面（LuckPerms 风格选择器、等级卡片、用户/组列表、权限摘要）
- **`dashboard-profile.css`** — 用户主页（横幅、头像、信息叠加、卡片网格、日历打卡）
- **`dashboard-workspace.css`** — 工作台空状态

### 其他

- **`permission-picker.css`** — PermissionPicker 组件（树形结构、三态节点、搜索、批量操作）
- **`model/styles.css`** — Model 原型页面专属样式（profile-layout）

## 页面加载关系

```
index.html          → core.css + styles.css + feature-grid.css
login.html          → core.css + styles.css + login.css
register.html       → core.css + styles.css + login.css + register.css
document.html       → core.css + styles.css + document.css
dashboard.html      → core.css + styles.css + components.css
                    + dashboard.css + dashboard-admin.css
                    + (按需动态加载: dashboard-perms.css, dashboard-profile.css, dashboard-workspace.css, permission-picker.css)
model/test.html     → core.css + styles.css
model/index.html    → core.css + styles.css
model/debug.html    → 全部内联（无外部 CSS 依赖）
```

## 添加新动态页面的步骤

1. **普通页面（非 admin）**：在 `css/` 下创建 `page-name.css`，在页面 HTML 中通过 `<link>` 加载
2. **Admin 页面**：在 `user/` 下创建 `dashboard-page-name.css`，通过 `loadPageCSS()` 动态加载
3. **优先使用通用类**：`.btn`、`.switch`、`.admin-table`、`.tag` 等定义在 `dashboard-admin.css` 中
4. **页面专属样式**：写在 HTML 的 `<style>` 块中，不要添加到通用 CSS 文件
5. **CSS 变量**：使用 `core.css` 中定义的变量（`--color-primary`、`--radius-md` 等），不要硬编码颜色值

## 动态加载 CSS 示例

```javascript
// 在 dashboard.menu.js 或类似位置使用
function loadPageCSS(url) {
    if (document.querySelector('link[href="' + url + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
}

// 加载权限管理页面样式
loadPageCSS('./dashboard-perms.css');
// 加载用户主页样式
loadPageCSS('./dashboard-profile.css');
```