/**
 * config.js
 * 全局配置与路由守卫
 * Phase 1: 改为 ES Module，同时保留 window 兼容层
 */

// ✅ 任务 FE-JS-01: 定义 API 基地址
const API_BASE_URL = "https://back.gwl.net.cn";

// 路径前缀：子目录页面用 '..'，根目录页面用 '.'
const BASE_PATH = (window.location.pathname.match(/\/(user|model)\//) ? '..' : '.');

// Token 相关常量
const TOKEN_KEY = 'auth_token';

/**
 * Token 读取与过期拦截逻辑
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
  handleAuthError() {
    this.clearToken();
    window.location.href = `${BASE_PATH}/login.html`;
  }
};

/**
 * 从 JWT claims 解析 now_permission
 */
function getNowPermission() {
  const raw = AuthGuard.getToken();
  if (!raw) return { level: 0, context: null, nodes: [] };
  try {
    const parts = raw.split('.');
    if (parts.length < 2) return { level: 0, context: null, nodes: [] };
    let payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payloadB64.length % 4) payloadB64 += '=';
    const payload = JSON.parse(atob(payloadB64));
    return payload.now_permission || { level: 0, context: null, nodes: [] };
  } catch (e) {
    return { level: 0, context: null, nodes: [] };
  }
}

// 全局运行时权限状态
const nowPermission = getNowPermission();

/**
 * 检查当前用户是否拥有指定权限节点
 */
function hasPermission(nodeCode) {
  const np = window.__nowPermission || nowPermission;
  return (np.nodes || []).includes(nodeCode);
}

/**
 * 根据 data-permission 属性自动显隐元素
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

// ===== ES Module exports =====
export { API_BASE_URL, BASE_PATH, TOKEN_KEY, AuthGuard, getNowPermission, hasPermission, initPermissionVisibility };

// ===== 兼容层：迁移期保留 window 挂载 =====
window.API_BASE_URL = API_BASE_URL;
window.AuthGuard = AuthGuard;
window.hasPermission = hasPermission;
window.initPermissionVisibility = initPermissionVisibility;
window.__nowPermission = nowPermission;