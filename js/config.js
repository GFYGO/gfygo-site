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

/**
 * DashUrl — dashboard 页面状态 ↔ URL 查询参数
 * 约定：?tab=<tabKey>&folder=<文件夹id>&doc=<文档id>&mode=browse|editor
 * 用于：刷新后停留在当前页面 / 直达指定文档
 */
const DashUrl = {
  read() {
    const url = new URL(window.location.href);
    const num = (k) => {
      const v = url.searchParams.get(k);
      if (v === null || v === '' || isNaN(Number(v))) return null;
      return Number(v);
    };
    return {
      tab: url.searchParams.get('tab') || null,
      folder: num('folder'),
      doc: num('doc'),
      mode: url.searchParams.get('mode') || null,
    };
  },
  write(partial) {
    const url = new URL(window.location.href);
    Object.keys(partial).forEach((k) => {
      const v = partial[k];
      if (v === null || v === undefined || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, String(v));
    });
    window.history.replaceState(window.history.state || null, '', url.toString());
  },
};

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
window.DashUrl = DashUrl;
window.getUserId = getUserId;
window.apiRequest = apiRequest;

/**
 * apiRequest — 统一 API 请求封装
 * 自动处理 Token 附加、401 跳转、网络错误提示
 *
 * @param {string} path - API 路径（如 '/api/v0/auth/status'）
 * @param {object} [options] - fetch 选项
 * @param {object} [options.params] - URL 查询参数对象
 * @param {string} [options.method] - HTTP 方法（默认 GET）
 * @param {object} [options.body] - 请求体对象（自动 JSON 序列化）
 * @param {boolean} [options.silent] - 为 true 时不弹出错误 Toast
 * @param {boolean} [options.noAuth] - 为 true 时不附加 Authorization 头
 * @param {AbortSignal} [options.signal] - 取消信号
 * @returns {Promise<object|null>} 解析后的 JSON 对象（失败返回 null）
 *
 * @example
 * const data = await apiRequest('/api/v0/user/menu');
 * const result = await apiRequest('/api/v0/document/', { method: 'POST', body: { title: 'foo' } });
 */
async function apiRequest(path, options) {
  options = options || {};
  const { params, method, body, silent, noAuth, signal, ...fetchOpts } = options;

  // 1. 构造 URL
  let url = API_BASE_URL + path;
  if (params) {
    const qs = Object.keys(params)
      .filter(k => params[k] !== null && params[k] !== undefined)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    if (qs) url += '?' + qs;
  }

  // 2. 构造请求头
  const headers = { ...(fetchOpts.headers || {}) };
  if (!noAuth) {
    const token = AuthGuard.getToken();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
  }
  if (body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // 3. 构造 fetch 参数
  const fetchOptions = {
    ...fetchOpts,
    method: method || (body ? 'POST' : 'GET'),
    headers,
    signal,
  };
  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  // 4. 发起请求
  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (err) {
    if (err.name === 'AbortError') return null;
    if (!silent && typeof Toast !== 'undefined') {
      Toast.show('网络连接失败，请检查网络后重试');
    }
    console.error('[apiRequest] 网络错误:', err);
    return null;
  }

  // 5. 解析响应
  let data;
  try {
    data = await res.json();
  } catch (_) {
    if (!silent && typeof Toast !== 'undefined') {
      Toast.show('服务器返回格式异常');
    }
    return null;
  }

  // 6. 处理 HTTP 错误
  if (res.status === 401 || res.status === 422) {
    AuthGuard.handleAuthError();
    return null;
  }

  if (!res.ok || (data && data.code !== 200)) {
    if (!silent && typeof Toast !== 'undefined' && data && data.msg) {
      Toast.show(data.msg);
    }
    return data;
  }

  // 7. 成功返回
  return data;
}
