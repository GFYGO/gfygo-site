# GWL CSS 文件架构

> 本文是**说明文档**，权威以各 HTML 里实际的 `<link rel="stylesheet">` 与各页面脚本的实际注入为准。
> 下面这份清单与「页面加载关系」已按 2026-09 的真实文件、真实引用逐条复核（复核命令见文末）。

## 核心文件（所有页面必加载）

- **`css/core.css`** — CSS 变量、4 套主题系统（green/light/gray/dark_green）、Reset、基础排版。所有页面第一个加载

## 通用文件（多页面共用）

- **`css/styles.css`** — Header、Footer、首页 sections、登录表单、Theme Switcher、Header User Info、响应式布局
- **`css/components.css`** — Toast 通知、Modal 弹窗、全局通知弹窗（notification-toast）、权限等级切换按钮组
- **`css/feature-grid.css`** — 首页功能卡片网格（feature-grid / feature-tile）
- **`css/document.css`** — 文档中心页面（目录树、详情、编辑器、修订历史、面包屑、文件夹树）

## 页面专用文件

- **`css/login.css`** — 登录页专属样式
- **`css/register.css`** — 注册页专属样式
- **`org/org.css`** — 组织页（`org/index.html`）唯一样式来源
- **`model/styles.css`** — Model 原型页面专属样式（`profile-layout`）⚠️ 全仓**无静态 `<link>`、也无脚本注入**（见文末证据）

## Dashboard 文件（都在 `user/` 目录下）

- **`user/dashboard.css`** — Dashboard 布局、侧边栏、邮箱验证、主内容区、个人文档(pdocs)、EasyMDE 编辑器、注销账号、Admin 动态页面样式
- **`user/dashboard-admin.css`** — Admin 通用组件（表格、按钮、Switch、Tag、统计卡片、统计布局、权限编辑器、Checkbox 组、空状态、loading）
- **`user/dashboard-profile.css`** — 用户主页（横幅、头像、信息叠加、卡片网格、日历打卡）。
  由 `user/dashboard.html` 的**静态 `<link>`** 加载（不是「按需动态加载」）；它是「个人主页（`#panel-home`）」的**唯一**样式来源
- **`user/dashboard-perms.css`** — 权限管理页面（LuckPerms 风格选择器、等级卡片、用户/组列表、权限摘要）。
  **不在任何 HTML 的静态 `<link>` 里**，由后端下发的动态页面脚本运行时注入（见下「运行时注入的 CSS」）
- **`user/permission-picker.css`** — PermissionPicker 组件（树形结构、三态节点、搜索、批量操作）。
  同样由后端下发的动态页面脚本运行时注入
- **`user/dashboard-workspace.css`** — 工作台空状态 ⚠️ **全仓零引用（死文件）**：没有任何 HTML 的 `<link>`、也没有任何脚本引用它；
  `.workspace-empty*` 只在该文件自己内部出现。删除或改动它之前，先确认是否还有使用者

## 页面加载关系

按每个 HTML 里实际的 `<link rel="stylesheet">` 逐文件 grep 得到（`?v=` 版本号此处略去）：

```
index.html            → css/core.css + css/styles.css + css/components.css + css/feature-grid.css
login.html            → css/core.css + css/styles.css + css/login.css + css/components.css
register.html         → css/core.css + css/styles.css + css/login.css + css/register.css + css/components.css
document.html         → css/core.css + css/styles.css + css/document.css + css/components.css
404.html              → css/core.css + css/styles.css + css/components.css
user/dashboard.html   → css/core.css + css/styles.css + css/components.css
                        + user/dashboard.css + user/dashboard-profile.css + user/dashboard-admin.css
                        + EasyMDE 样式（CDN：https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.css）
org/index.html        → css/core.css + css/styles.css + css/components.css + org/org.css
model/index.html      → css/core.css + css/styles.css + css/components.css
model/test.html       → css/core.css + css/styles.css + css/components.css
model/template.html   → css/core.css + css/styles.css + css/components.css
model/debug.html      → 无外部 CSS 依赖，样式全部内联在 <style> 块中
```

要点：

- `gfygo-site` 下共 **11 个 HTML**，其中 **10 个**都加载 `css/components.css`（唯一例外是 `model/debug.html`），不要漏列。
- `404.html` 与 `org/index.html` 此前未出现在本表里，已补上。
- `user/dashboard.html` 的静态 `<link>` 里**没有** `dashboard-perms.css` / `permission-picker.css`（见下节）。
- `user/dashboard-workspace.css` 不出现在任何一行——它没有任何加载者。

## 运行时注入的 CSS

`user/dashboard.html` 只静态加载上表列出的那 **6 个本地 CSS**（另有 EasyMDE 的 CDN 样式）。另外两个文件由**后端下发的动态页面脚本**在浏览器里运行时注入：

| 注入的文件 | 注入者 | 写法 |
|---|---|---|
| `user/permission-picker.css` | `site-back/pages/admin-menu/site.js`（`loadPermPickerCSS()`）、`site-back/pages/admin-permissions/site.js` | `document.createElement('link')`，`href = (window.BASE_PATH \|\| '.') + '/user/permission-picker.css'` |
| `user/dashboard-perms.css` | `site-back/pages/admin-permissions/site.js` | 同上，`href = (window.BASE_PATH \|\| '') + '/user/dashboard-perms.css'` |

两处都**先遍历已有的 `link[rel="stylesheet"]` 按 `href` 子串查重**，未命中才插入 `document.head`；**没有**一个全局的 CSS 加载工具函数。

> ⚠️ 本文旧版曾在这里给出一个**自造的**动态加载工具函数示例（函数名由 `load` + `PageCSS` 拼成），
> 它与真实代码不符：**该标识符在仓库里 grep 不到**（旧版只在本文自己里出现）。已删除该示例，
> 避免有人照抄一个不存在的函数——真实写法只有上表这两处逐页内联的 `createElement('link')` 注入。

## 添加新页面的步骤

1. **主站静态页面**：在 `css/` 下创建 `page-name.css`，在页面 HTML 里用**静态 `<link>`** 加载（记得同步提升 `?v=` 版本号）
2. **后端下发的动态页面**：样式放在该页面目录里（`site-back/pages/<tab_key>/site.css` 或按文件名升序拼接的 `NN-name.css`），由同步机制随页面内容下发；只有需要复用 `user/` 下已有共享 CSS 时，才照 `admin-permissions` / `admin-menu` 的写法在页面脚本里注入 `link`
3. **优先使用通用类**：`.btn`、`.switch`、`.admin-table`、`.tag` 等定义在 `user/dashboard-admin.css` 中
4. **页面专属样式**：写在 HTML 的 `<style>` 块中，不要添加到通用 CSS 文件
5. **CSS 变量**：使用 `core.css` 中定义的变量（`--color-primary`、`--radius-md` 等），不要硬编码颜色值

## 文件位置一览

| 目录 | 文件 | 数量 |
|---|---|---|
| `css/` | `core.css`、`styles.css`、`components.css`、`feature-grid.css`、`document.css`、`login.css`、`register.css` | 7 |
| `user/` | `dashboard.css`、`dashboard-admin.css`、`dashboard-perms.css`、`dashboard-profile.css`、`dashboard-workspace.css`、`permission-picker.css` | 6 |
| `org/` | `org.css` | 1 |
| `model/` | `styles.css` | 1 |

## 复核命令

```bash
# 1) 各 HTML 实际加载了哪些样式表（本 README「页面加载关系」的依据）
grep -rn 'rel="stylesheet"' gfygo-site --include=*.html

# 2) 没有任何通用 CSS 加载工具函数：样式注入只有 createElement('link') 这几处
grep -rn "createElement('link')" gfygo-site site-back

# 3) dashboard-workspace.css 是否真的零引用（除文件自身外应零命中）
grep -rn 'dashboard-workspace' gfygo-site

# 4) 运行时注入的真实写法
grep -rn "permission-picker.css\|dashboard-perms.css" site-back/pages

# 5) model/styles.css 的加载方（`rel="stylesheet"` 清单里没有它，JS 里也没有它 → 无加载方）
grep -rn 'rel="stylesheet"' gfygo-site --include=*.html | grep 'model/'
grep -rn 'styles\.css' gfygo-site --include=*.js
```
