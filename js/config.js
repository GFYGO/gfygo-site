/**
 * config.js
 * 全局配置与路由守卫
 * 共享模块：所有页面以普通 <script> 加载
 */

const API_BASE_URL = "https://back.gwl.net.cn";
const BASE_PATH = (window.location.pathname.match(/\/(user|model)\//) ? '..' : '.');
const TOKEN_KEY = 'auth_token';
// 无法判定有效期时的保守兜底：后端签发 token 的默认寿命（50 小时），绝不视为「永不过期」
const DEFAULT_TOKEN_TTL_MS = 50 * 60 * 60 * 1000;

/**
 * decodeJwtPayload — 解析 JWT 的 payload 段（base64url → JSON）
 * getNowPermission / getUserId / setToken 共用，避免重复实现
 * @param {string} token
 * @returns {object|null} 解析失败返回 null（不抛异常）
 */
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payloadB64.length % 4) payloadB64 += '=';
    const payload = JSON.parse(atob(payloadB64));
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * resolveTokenTtlMs — 计算 token 有效期（毫秒）
 * 优先级：显式 expiresInSec → JWT payload 的 exp 声明
 * @param {string} token
 * @param {number} [expiresInSec] 后端返回的有效期（秒）
 * @param {number} [baseTs] 计算剩余有效期的基准时间戳（默认当前时间）
 * @returns {number|null} 毫秒数（可能为负=已过期）；两者都无法判定时返回 null
 */
function resolveTokenTtlMs(token, expiresInSec, baseTs) {
  const sec = Number(expiresInSec);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  const payload = decodeJwtPayload(token);
  const exp = payload ? Number(payload.exp) : NaN;
  if (Number.isFinite(exp) && exp > 0) {
    return exp * 1000 - (Number.isFinite(baseTs) ? baseTs : Date.now());
  }
  return null;
}

const AuthGuard = {
  getToken: function() {
    try {
      const tokenData = JSON.parse(localStorage.getItem(TOKEN_KEY));
      if (!tokenData || !tokenData.token) return null;
      const timestamp = Number(tokenData.timestamp);
      let ttlMs = Number(tokenData.expiresIn);
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        // 旧数据/异常数据（expiresIn 为 NaN、null 或缺失）：改用 JWT exp 兜底，
        // 仍然判不出来就按「已过期」处理，绝不把 token 当成永不过期
        ttlMs = resolveTokenTtlMs(tokenData.token, null, Number.isFinite(timestamp) ? timestamp : Date.now());
      }
      if (!Number.isFinite(ttlMs) || ttlMs <= 0 ||
          !Number.isFinite(timestamp) || Date.now() - timestamp > ttlMs) {
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
    // 兼容旧数据形状：{ token, timestamp, expiresIn }，expiresIn 单位毫秒
    const now = Date.now();
    let ttlMs = resolveTokenTtlMs(token, expiresInSec, now);
    // 显式有效期与 JWT exp 都没有时，用保守默认值而不是 NaN（NaN 会让 token 永不过期）
    if (ttlMs === null) ttlMs = DEFAULT_TOKEN_TTL_MS;
    const tokenData = {
      token: token,
      timestamp: now,
      expiresIn: ttlMs
    };
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
    } catch (e) {
      console.warn('[AuthGuard] 写入 token 失败（本地存储不可用）:', e);
    }
  },
  clearToken: function() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      console.warn('[AuthGuard] 清除 token 失败（本地存储不可用）:', e);
    }
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
  const payload = decodeJwtPayload(AuthGuard.getToken());
  if (!payload) return { level: 0, context: null, nodes: [] };
  return payload.now_permission || { level: 0, context: null, nodes: [] };
}

function getUserId() {
  const payload = decodeJwtPayload(AuthGuard.getToken());
  if (!payload) return null;
  if (payload.uid != null && payload.uid !== '') return payload.uid;
  if (payload.sub != null && payload.sub !== '') return payload.sub;
  return null;
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
