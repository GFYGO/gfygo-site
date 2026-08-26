/**
 * config.js
 * 全局配置与路由守卫
 * 共享模块：所有页面以普通 <script> 加载
 */

const API_BASE_URL = "https://back.gwl.net.cn";
const BASE_PATH = (window.location.pathname.match(/\/(user|model)\//) ? '..' : '.');
const TOKEN_KEY = 'auth_token';

const AuthGuard = {
  getToken: function() {
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
  setToken: function(token, expiresInSec) {
    const expiresInMs = expiresInSec * 1000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      token: token,
      timestamp: Date.now(),
      expiresIn: expiresInMs
    }));
  },
  clearToken: function() {
    localStorage.removeItem(TOKEN_KEY);
  },
  requireAuth: function() {
    if (!this.getToken()) {
      window.location.href = BASE_PATH + '/login.html';
    }
  },
  handleAuthError: function() {
    this.clearToken();
    window.location.href = BASE_PATH + '/login.html';
  }
};

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

function getUserId() {
  const raw = AuthGuard.getToken();
  if (!raw) return null;
  try {
    const parts = raw.split('.');
    if (parts.length < 2) return null;
    let payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payloadB64.length % 4) payloadB64 += '=';
    const payload = JSON.parse(atob(payloadB64));
    if (payload.uid != null && payload.uid !== '') return payload.uid;
    if (payload.sub != null && payload.sub !== '') return payload.sub;
    return null;
  } catch (e) {
    return null;
  }
}

const nowPermission = getNowPermission();

function hasPermission(nodeCode) {
  const np = window.__nowPermission || nowPermission;
  return (np.nodes || []).includes(nodeCode);
}

function initPermissionVisibility() {
  document.querySelectorAll('[data-permission]').forEach(function(el) {
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

// ===== 全局挂载 =====
window.API_BASE_URL = API_BASE_URL;
window.BASE_PATH = BASE_PATH;
window.TOKEN_KEY = TOKEN_KEY;
window.AuthGuard = AuthGuard;
window.getNowPermission = getNowPermission;
window.hasPermission = hasPermission;
window.initPermissionVisibility = initPermissionVisibility;
window.__nowPermission = nowPermission;
