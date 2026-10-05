# AGENTS.md — `gfygo-site/`（前端仓库）AI 操作索引

给 AI 助手：**纯静态、无构建**的前端仓库。动手前先按本表定位文档，不要通读。
工作区总入口：`../AGENTS.md`；文件级导航：`../file-wiki/AGENTS.md`（前端篇 = `09`–`15`）。

## 0. 快速事实

| 项 | 值 |
|---|---|
| 形态 | 手写 HTML / CSS / 原生 JS；**无框架、无构建、无 npm**；浏览器直接加载 |
| 托管 | **GitHub Pages**（公开仓库 `GFYGO/gfygo-site`，CNAME = `gwl.net.cn`） |
| 与后端 | **两个互不嵌套的独立仓库**；接口基址硬编码在 `js/config.js` → `https://back.gwl.net.cn` |
| 发布面 | 主站 5 页（`index` / `login` / `register` / `document` / `404`）＋ `user/dashboard.html` ＋ `org/index.html` ＋ `discover/` 11 页 ＋ `model/*` 4 页（⚠️ `model/test.*` **仍会发布**，见 `file-wiki/09` §2） |
| 加载约定 | 共享层普通 `<script>`（非 ES module）；dashboard 用 ES module 装配；动态页面脚本由**后端下发**（Blob 注入，不在本仓库） |
| 交付 | push `origin main` → GitHub Actions 自动发 Pages；⚠️ 改前端资源**必须提升对应 `?v=` 版本号**（三套，见下） |

## 1. 文档地图（何时读哪份）

| 文档 | 是什么 | 何时读（建议节） |
|---|---|---|
| `css/README.md`（本仓库） | 16 个 CSS 的加载关系（已按实际 `<link>` 重写） | 改样式 / 查「哪个 CSS 被谁加载」 |
| `../file-wiki/09-frontend-overview.md` | ⭐ 前端全局：发布面 / 加载顺序 / CSP / 版本号三套 | **碰前端任何东西前先读**；§2 发布面、§5 安全、§6 版本号 |
| `../file-wiki/12-frontend-dashboard.md` | ⭐ 仪表盘（全前端最复杂） | 改 `user/dashboard.*` 时 |
| `../file-wiki/13-frontend-org.md` | 组织页 + `permission-picker` | 改 `org/` 时 |
| `../file-wiki/15-frontend-callgraph.md` | ⭐ 调用关系总图 + 文件 × 接口全表 | 排查「谁加载了谁 / 谁调了哪个接口」；§1.5 版本号 |
| `../site-back/PROJECT_MEMORY.md` | 前端速查（二手资料） | §6.2 动态页面加载链路、§6.5 缓存版本号 |
| `../site-back/UNTRUSTED.md` | 「声明≠实现」清单（含前端条目） | 动相关代码前必读（H13 命名两套 / H16 零引用文件等） |

## 2. 按任务找（`file-wiki` = `../file-wiki/`）

| 任务 | 读 |
|---|---|
| 改主站页面（`index` / `login` / `register` / `document` / `404`） | `file-wiki/11-frontend-site-pages.md` §1–§6 ＋ `09` §6 |
| 改仪表盘（侧边栏 / 面板 / 个人文档） | `file-wiki/12-frontend-dashboard.md` ＋ `15` §2 |
| 改组织页 / 权限编辑器 | `file-wiki/13-frontend-org.md`（含 `X-Org-Class` 约定） |
| 改样式 / 查 CSS 加载 | `css/README.md` ＋ `file-wiki/14-frontend-css.md` §2（§6 是历史存档，勿据此说现状） |
| 改「发现页」（11 个静态页） | `file-wiki/11` §7 ＋ `10` §8 ＋ `09` §6 |
| 找「这个全局函数是谁挂的」 | `file-wiki/10-frontend-shared-js.md`（按全局名搜） |
| 查「谁调了哪个接口」 | `file-wiki/15` §5（文件 × `/api/v0/*` 全表） |
| 改完提升版本号 | `09` §6.2 ＋ `15` §1.5（⚠️ **同一个文件可能横跨多套版本号**） |
| 接口字段级核对 | `../site-back/API-WIKI.md` |

## 3. 硬性约束（会咬人的几条）

1. **不引入构建链**（无打包器 / 无 npm / 无框架）——这是刻意的仓库形态。
2. **缓存版本号必须提升**，且分三套（主站一套 / dashboard 一套 / 发现页一套）：
   改资源后不提升 → 部分访客拿旧缓存；**跨套共享的文件（如 `js/config.js`）要每套都改**。
   完整规则见 `file-wiki/09` §6.2、`15` §1.5。
3. **dashboard 的 CSP 无 `unsafe-inline` / `unsafe-eval`**：不要内联脚本 / 内联 `on*=` / `eval`；
   动态页面的脚本由**后端 `pages/**`（Blob 注入）**承担，不在本仓库。
4. **共享能力用全局，不要再造**：`window.escapeHtml` / `window.apiRequest` / `window.Modal` /
   `window.showToast`（定义在 `js/`；被全站加载，改它们要提升**所有**相关页面的版本号）。
5. **渲染转义**：一律 `escapeHtml` 或 `textContent`；不要把后端字符串直接塞 `innerHTML`。
6. **token 在 `localStorage`**（`AuthGuard` 管理）；登录态判断与 401 跳转走共享层，不要各页重复实现。
7. ⚠️ **`model/test.html` / `model/test.js` 仍会发布**（workflow 没有排除；`model/index.html` 有纯点击可达的入口）
   —— 不要把它们当作「已下线」或安全边界（后端鉴权仍完整）；结论出处：`file-wiki/09` §2/§5。

## 4. 常用验证命令（**在工作区根目录跑**；`tools/` 不在任何 git 仓库内）

```powershell
cd ..   # 回到工作区根 D:\HP(system)\Documents\GitHub\GFYGO
node tools/test-dashboard-pages.mjs     # 仪表盘加载契约 + 动态页脚本编译
node tools/test-dashboard-home.mjs      # 从 dashboard.html 解析真实 DOM 全流程装配
node tools/test-org-page.mjs            # 组织页（含「＋ 加入」卡片：public 自助加入 / 邀请码 / 单次链接 / 我的申请 / 收到的邀请）
node tools/test-permission-switch.mjs   # 权限视角切换
node tools/test-turnstile-auth.mjs      # Turnstile 认证链
node tools/test-discover-page.mjs       # ⭐ 发现页（171 项断言）
```

⚠️ 本机**没有浏览器自动化**（沙箱起不了无头浏览器）——视觉类问题只能人工在浏览器验证；
`tools/` 的回归都是 DOM-stub / 静态断言。

## 5. 目录速览（细节按需查 `file-wiki` 对应篇）

| 目录 | 一句话 | 导航篇 |
|---|---|---|
| 根 `*.html` + `js/` | 主站 5 页 + 共享脚本（config / sanitize / theme / toast / modal / utils / turnstile / discover） | `11`、`10` |
| `user/` | 仪表盘：`dashboard.html` + 11 个 `user/*.js` + 各 CSS + `permission-picker.*` | `12` |
| `org/` | 组织页：`index.html` / `org.css` / `org.js`（侧栏「我加入的组」标题旁有 ⭐ **「＋ 加入」** 卡片：public 自助加入 / 邀请码 / 单次链接 / 我的申请 / 我收到的邀请） | `13` ＋ `site-back/PROJECT_MEMORY.md` §5.6 |
| `discover/` | 发现页 11 个普通静态页（2026-10-02 新增） | `11` §7 |
| `css/` | 16 个 CSS + `README.md`（加载关系权威） | `14` |
| `model/` | Model 原型页（⚠️ `test.*` 仍发布） | `09` §2 |
| `.github/workflows/static.yml` | Pages 发布 workflow（改排除规则前先读 `09` §2） | `09` |