/**
 * config.js
 * 全局配置与路由守卫
 */

// 任务 FE-JS-01: 定义 API 基地址
const API_BASE_URL = "https://back.gwl.net.cn";

// Token 相关常量
const TOKEN_KEY = 'auth_token';

/**
 * 任务 FE-JS-01: Token 读取与过期拦截逻辑
 */
const AuthGuard = {
    getToken() {
        const tokenData = JSON.parse(localStorage.getItem(TOKEN_KEY));
        if (!tokenData) return null;

        // 动态过期校验逻辑
        if (Date.now() - tokenData.timestamp > tokenData.expiresIn) {
            this.clearToken();
            return null;
        }
        return tokenData.token;
    },

    /**
     * 存储 Token
     * @param {string} token JWT Token
     * @param {number} expiresInSec 有效期，单位：秒
     */
    setToken(token, expiresInSec) {
        const expiresInMs = expiresInSec * 1000;
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ 
            token, 
            timestamp: Date.now(), 
            expiresIn: expiresInMs 
        }));
    },

    clearToken() {
        localStorage.removeItem(TOKEN_KEY);
    },

    requireAuth() {
        if (!this.getToken()) {
            window.location.href = 'login.html';
        }
    },

    /**
     * 处理全局鉴权异常 (如 401, 422)
     */
    handleAuthError() {
        this.clearToken();
        window.location.href = 'login.html';
    }
};