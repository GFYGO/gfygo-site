# 前端逻辑开发文档 (FRONTEND_LOGIC_GUIDE)

## 1. 核心状态流转图

[页面加载] 
   │
   ├── 初始化 ThemeEngine 
   │      └── 读取 LocalStorage (user_theme) -> 应用 CSS 变量
   │
   ├── 路由: /login
   │      └── 用户提交表单
   │             ├── 校验 Turnstile Token (无则阻断)
   │             ├── Fetch POST /api/v1/auth/login
   │             └── 成功 -> AuthManager.setToken() -> 跳转 /profile
   │
   └── 路由: /profile
          └── loadUserProfile()
                 ├── 校验 Token (AuthManager.getToken)
                 │      └── 无Token / 超过50小时 -> 清除Token -> 重定向 /login
                 ├── Fetch GET /api/v1/user/profile (携带 Bearer Token)
                 ├── DOM 渲染 (头像, 用户名)
                 └── 同步后端主题偏好 -> ThemeEngine.applyTheme()

## 2. 核心函数说明

| 模块 | 函数/对象 | 说明 |
| :--- | :--- | :--- |
| 全局 | `API_BASE_URL` | 统一API基地址常量，严禁硬编码接口地址 |
| 主题 | `ThemeEngine.init()` | 页面加载时调用，从 LocalStorage 读取并应用主题 |
| 主题 | `ThemeEngine.applyTheme(name)` | 遍历配置对象，通过 `setProperty` 动态注入 CSS 变量 |
| 鉴权 | `AuthManager.getToken()` | 获取 Token 并自动执行 50 小时过期校验 |
| 鉴权 | `AuthManager.setToken(token)` | 将 Token 与当前时间戳打包存入 LocalStorage |
| 交互 | `handleLogin(event)` | 拦截表单默认提交，校验 Turnstile 后发起登录请求 |
| 交互 | `loadUserProfile()` | 携带 Token 请求用户信息，渲染 DOM 并同步主题 |

## 3. API 调用错误处理机制

1. **网络异常 (Catch Block)**: 所有 Fetch 请求均包裹在 `try...catch` 中，捕获网络断开或 CORS 错误，并输出至控制台。
2. **业务错误 (Non-2xx)**: 检查 `response.ok`，若为 false，解析后端返回的 JSON 并弹出提示（如 `data.message`）。
3. **鉴权失效 (401 Unauthorized)**: 在 `loadUserProfile` 中专门拦截 401 状态码，主动调用 `AuthManager.clearToken()` 清除本地凭证，并强制重定向至登录页。
4. **Token 过期**: 在前端读取 Token 时，通过比对 `Date.now()` 与存储的时间戳，若超过 50 小时（`TOKEN_EXPIRE_MS`），直接视为无效并清理。