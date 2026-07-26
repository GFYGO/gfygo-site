/**
 * config.js
 * 全局配置文件与路由守卫逻辑
 */

// 1. 全局常量定义
const API_BASE_URL = "https://back.gwl.net.cn";
const TOKEN_KEY = "auth_token";
const THEME_KEY = "user_theme";
// 50小时过期时间 (毫秒)
const TOKEN_EXPIRE_DURATION = 50 * 60 * 60 * 1000; 

// 2. 工具函数：Token 管理
const AuthUtil = {
    // 获取 Token 并校验有效期
    getToken: function() {
        const tokenStr = localStorage.getItem(TOKEN_KEY);
        if (!tokenStr) return null;

        try {
            const tokenObj = JSON.parse(tokenStr);
            const now = Date.now();
            
            // 校验是否超过 50 小时
            if (now - tokenObj.timestamp > TOKEN_EXPIRE_DURATION) {
                console.warn("Token 已过期 (超过50小时)");
                this.clearToken();
                return null;
            }
            return tokenObj.token;
        } catch (e) {
            console.error("Token 解析失败", e);
            this.clearToken();
            return null;
        }
    },
    
    // 存储 Token
    setToken: function(token) {
        const tokenObj = {
            token: token,
            timestamp: Date.now()
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenObj));
    },
    
    // 清除 Token
    clearToken: function() {
        localStorage.removeItem(TOKEN_KEY);
    }
};

// 3. 路由守卫逻辑
// 在需要保护的页面加载时执行
function checkAuth() {
    const token = AuthUtil.getToken();
    const currentPath = window.location.pathname;

    // 如果没有 Token 且不在登录页，强制跳转
    if (!token && !currentPath.includes('login.html')) {
        window.location.href = 'login.html';
        return false;
    }
    
    // 如果有 Token 且在登录页，强制跳转主页 (防止重复登录)
    if (token && currentPath.includes('login.html')) {
        window.location.href = 'dashboard.html';
        return false;
    }

    return true;
}

// 导出供其他模块使用 (模拟模块化)
window.API_BASE_URL = API_BASE_URL;
window.AuthUtil = AuthUtil;
window.checkAuth = checkAuth;