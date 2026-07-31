/**
 * config.js
 * 全局配置与路由守卫
 */

// ✅ 任务 FE-JS-01: 定义 API 基地址
// 修正：使用完整的 HTTPS 地址，避免在 GitHub Pages 等环境下出现相对路径请求错误
const API_BASE_URL = "https://back.gwl.net.cn";

// 路径前缀：子目录页面用 '..'，根目录页面用 '.'
// 支持 /user/, /admin1/, /admin2/, /admin3/, /superadmin/, /modle/ 等子目录
const BASE_PATH = (window.location.pathname.match(/\/(user|admin1|admin2|admin3|superadmin|modle)\//) ? '..' : '.');

// Token 相关常量
const TOKEN_KEY = 'auth_token';

// =========================================
// Token 轻量混淆（非强加密，目的是避免 devtools / 恶意插件直接看到明文 JWT）
// 真正的安全需配合 HttpOnly Cookie 或 CSP；这里仅提升攻击门槛
// =========================================
(function () {
  // 运行时生成的盐（不持久化）：与 location.origin 绑定，避免跨域串用
  const _salt = (location.origin || 'gfygo') + '::v1::' + (navigator.userAgent || '');
  function _xor(str, key) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  }
  function _encodeToken(rawToken) {
    if (!rawToken) return rawToken;
    try {
      const obf = _xor(rawToken, _salt);
      // btoa 仅接受 Latin-1，需先转 UTF-8 bytes
      const bytes = new TextEncoder().encode(obf);
      let bin = '';
      bytes.forEach(b => bin += String.fromCharCode(b));
      return 'v1:' + btoa(bin);
    } catch (e) {
      // 降级：不混淆
      return 'v0:' + rawToken;
    }
  }
  function _decodeToken(wrapped) {
    if (!wrapped) return null;
    if (typeof wrapped !== 'string') return null;
    if (wrapped.startsWith('v0:')) return wrapped.slice(3);
    if (!wrapped.startsWith('v1:')) return wrapped;
    try {
      const bin = atob(wrapped.slice(3));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const obf = new TextDecoder().decode(bytes);
      return _xor(obf, _salt);
    } catch (e) {
      return null;
    }
  }
  window.__gfygoTokenEncode = _encodeToken;
  window.__gfygoTokenDecode = _decodeToken;
})();

// 登出时统一清理的 localStorage 键（含前缀，支持按 userId 精确匹配）
const AUTH_RELATED_KEY_PATTERNS = [
  'auth_token',
  'guest_view_mode',
  'view_as_level',
  'dashboard_active_tab',
  'theme',
];

function _clearAllAuthRelatedLocalStorage() {
  try {
    AUTH_RELATED_KEY_PATTERNS.forEach(k => localStorage.removeItem(k));
    const userIdMatch = (localStorage.getItem('__gfygo_last_uid') || '').trim();
    // 清理打卡、草稿、按 userId 写入的所有键
    const keys = Object.keys(localStorage);
    keys.forEach(k => {
      if (/^checkin_record_/i.test(k)) localStorage.removeItem(k);
      if (/^pdocs_draft_/i.test(k)) localStorage.removeItem(k);
      if (userIdMatch && k.indexOf(userIdMatch) !== -1) {
        // 仅清理明显与认证/行为相关的键，不误删 theme 等（theme 已在上方明确列出）
        if (/^(checkin|pdocs|auth|guest|view_as|dashboard_|uid_)/i.test(k)) {
          localStorage.removeItem(k);
        }
      }
    });
  } catch (e) {
    // ignore
  }
}

/**
 * 任务 FE-JS-01: Token 读取与过期拦截逻辑
 */
const AuthGuard = {
  getToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      // 兼容旧格式：JSON 明文
      if (raw.startsWith('{')) {
        try {
          const tokenData = JSON.parse(raw);
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
      }
      // 新格式：前缀 + 混淆
      const tokenData = JSON.parse(window.__gfygoTokenDecode(raw));
      if (!tokenData) { this.clearToken(); return null; }
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
  setToken(token, expiresInSec, userId) {
    try {
      const expiresInMs = expiresInSec * 1000;
      const payload = {
        token,
        timestamp: Date.now(),
        expiresIn: expiresInMs,
      };
      const wrapped = window.__gfygoTokenEncode(JSON.stringify(payload));
      localStorage.setItem(TOKEN_KEY, wrapped);
      if (userId) {
        localStorage.setItem('__gfygo_last_uid', String(userId));
      }
    } catch (e) {
      // 极端情况（如 localStorage 被禁用），降级明文
      try {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({
          token, timestamp: Date.now(), expiresIn: expiresInSec * 1000
        }));
      } catch (_) { /* ignore */ }
    }
  },
  clearToken() {
    _clearAllAuthRelatedLocalStorage();
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