/**
 * config.js
 * 全局配置与路由守卫
 */

// ✅ 任务 FE-JS-01: 定义 API 基地址
// 修正：使用完整的 HTTPS 地址，避免在 GitHub Pages 等环境下出现相对路径请求错误
const API_BASE_URL = "https://back.gwl.net.cn";

// 路径前缀：子目录页面用 '..'，根目录页面用 '.'
// 支持 /user/, /model/ 等子目录
const BASE_PATH = (window.location.pathname.match(/\/(user|model)\//) ? '..' : '.');

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

/**
 * 从 JWT claims 解析 now_permission（运行时权限对象）。
 * 旧 token 无 now_permission claims 时返回 level=0（访客语义，触发降级路径）。
 * @returns {{level:number, context:string|null, nodes:Array}}
 */
function getNowPermission() {
  const raw = AuthGuard.getToken();
  if (!raw) return { level: 0, context: null, nodes: [] };
  try {
    const parts = raw.split('.');
    if (parts.length < 2) return { level: 0, context: null, nodes: [] };
    // base64url → base64 + padding
    let payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payloadB64.length % 4) payloadB64 += '=';
    const payload = JSON.parse(atob(payloadB64));
    return payload.now_permission || { level: 0, context: null, nodes: [] };
  } catch (e) {
    return { level: 0, context: null, nodes: [] };
  }
}

// 全局运行时权限状态（页面加载时初始化，权限切换后由 handlePermissionClick 更新）
window.__nowPermission = getNowPermission();

/**
 * 检查当前用户是否拥有指定权限节点
 * @param {string} nodeCode 权限节点代码，如 'admin.notify.view'
 * @returns {boolean}
 */
function hasPermission(nodeCode) {
  const np = window.__nowPermission || getNowPermission();
  return (np.nodes || []).includes(nodeCode);
}

/**
 * 根据 data-permission 属性自动显隐元素
 * 页面加载时调用一次，权限切换后重新调用
 */
function initPermissionVisibility() {
  document.querySelectorAll('[data-permission]').forEach(el => {
    const node = el.dataset.permission;
    if (!node) return;
    if (!hasPermission(node)) {
      el.style.display = 'none';
      el.setAttribute('data-permission-hidden', 'true');
    } else if (el.hasAttribute('data-permission-hidden')) {
      el.style.display = '';
      el.removeAttribute('data-permission-hidden');
    }
  });
}

// 全局暴露
window.hasPermission = hasPermission;
window.initPermissionVisibility = initPermissionVisibility;