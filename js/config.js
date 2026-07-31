/**
 * config.js
 * 全局配置与路由守卫
 */

// ✅ 任务 FE-JS-01: 定义 API 基地址
// 修正：使用完整的 HTTPS 地址，避免在 GitHub Pages 等环境下出现相对路径请求错误
const API_BASE_URL = "https://back.gwl.net.cn";

// 路径前缀：子目录页面用 '..'，根目录页面用 '.'
// 支持 /user/, /admin1/, /admin2/, /admin3/, /superadmin/, /model/ 等子目录
const BASE_PATH = (window.location.pathname.match(/\/(user|admin1|admin2|admin3|superadmin|model)\//) ? '..' : '.');

// Token 相关常量
const TOKEN_KEY = 'auth_token';

/**
 * 任务 FE-JS-01: Token 读取与过期拦截逻辑
 */
const AuthGuard = {
  getToken() {
    try {
      const tokenData = JSON.parse(localStorage.getItem(TOKEN_KEY));
      if (!tokenData) return null;
      if (Date.now() - tokenData.timestamp > tokenData.expiresIn) {
        this.clearToken();
        return null;
      }
      return tokenData.token;
    } catch (e) {
      this.clearToken();
      return null;
    }
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
      window.location.href = `${BASE_PATH}/login.html`;
    }
  },
  /**
   * 处理全局鉴权异常 (如 401, 422)
   */
  handleAuthError() {
    this.clearToken();
    window.location.href = `${BASE_PATH}/login.html`;
  }
};