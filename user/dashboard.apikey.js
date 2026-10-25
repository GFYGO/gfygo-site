/**
 * dashboard.apikey.js
 * 「设置」面板里的 **API 访问密钥**：状态 / 轮换 / 一次性展示 / 复制 / 撤销
 *
 * 接口（全部 /api/v0，需要 JWT）：
 *   GET    /api/v0/user/apikey          状态（has_key / hint，绝不返回完整 key）
 *   POST   /api/v0/user/apikey/rotate   轮换（返回一次明文，库里存 sha256）
 *   DELETE /api/v0/user/apikey          撤销（立即失效）
 *
 * 三个刻意的决定：
 *   1. 明文只在轮换响应里出现一次；本模块只把它放进 DOM，不写 localStorage /
 *      sessionStorage，也不 console.log。
 *   2. 再次进入设置页会清掉上一次的明文（initApiKeyPanel 在 _panelVisited 后调用
 *      clearOneTimeKey）——「只显示一次」是前端也要守的承诺，不只靠后端。
 *   3. 轮换 / 撤销前都二次确认：旧 key 立即失效，正在跑的脚本会 401。
 */
var $ = window.$;
var on = window.on;
var showToast = window.showToast;
var apiRequest = window.apiRequest;

var _bound = false;
var _loaded = false;
var _loading = false;
var _panelVisited = false;

function el(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value == null ? '' : String(value);
}

function setBusy(btn, busy, text) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (text) btn.textContent = text;
}

function request(path, options) {
    options = options || {};
    options.silent = true;
    return apiRequest(path, options);
}

function confirmAction(message, options) {
    if (window.Modal && typeof window.Modal.confirm === 'function') {
        return window.Modal.confirm(message, options || {});
    }
    // ⭐ P2-3（2026-10-21 审查）：Modal 加载失败时**不能**默认确认 ——
    //   轮换 / 撤销密钥是不可逆动作，必须 fail-closed。
    //   先退化为浏览器原生 confirm（同步但语义一致），拿不到就当作"取消"。
    try {
        if (typeof window.confirm === 'function') {
            return Promise.resolve(window.confirm(message));
        }
    } catch (e) { /* 忽略：下面按取消处理 */ }
    return Promise.resolve(false);
}

function clearOneTimeKey() {
    var box = el('apiKeyOnce');
    if (box) box.style.display = 'none';
    var code = el('apiKeyValue');
    if (code) code.textContent = '';
}

function renderStatus(data) {
    data = data || {};
    var uid = data.userid != null
        ? data.userid
        : ((window.getUserId && window.getUserId()) || '?');
    var status = el('apiKeyStatus');
    if (status) status.textContent = data.has_key ? '已配置' : '未配置';

    if (data.has_key) {
        setText('apiKeyHint',
            'userid ' + uid + ' · 密钥提示 ' + (data.hint || '（无提示）')
            + ' · 出于安全考虑，完整密钥不会再次显示');
    } else {
        setText('apiKeyHint',
            'userid ' + uid + ' · 还没有 API Key，点「轮换 API Key」生成一个');
    }

    var revokeBtn = el('apiKeyRevokeBtn');
    if (revokeBtn) revokeBtn.disabled = !data.has_key;
}

function showOneTimeKey(apikey, hint) {
    var code = el('apiKeyValue');
    if (code) code.textContent = apikey || '';
    var box = el('apiKeyOnce');
    if (box) box.style.display = '';
    setText('apiKeyStatusText', '已生成新密钥，请立即复制保存');
    if (hint) {
        var status = el('apiKeyStatus');
        if (status) status.textContent = '已配置';
    }
}

async function loadStatus() {
    if (_loading) return;
    _loading = true;
    setText('apiKeyStatus', '加载中...');
    try {
        var resp = await request('/api/v0/user/apikey');
        if (resp && resp.code === 200 && resp.data) {
            _loaded = true;
            renderStatus(resp.data);
        } else {
            setText('apiKeyStatus', '加载失败');
            setText('apiKeyHint', (resp && resp.msg) || '请稍后重试');
        }
    } catch (err) {
        setText('apiKeyStatus', '加载失败');
        setText('apiKeyHint', '网络请求失败，请稍后重试');
    } finally {
        _loading = false;
    }
}

async function handleRotate() {
    var ok = await confirmAction(
        '轮换后旧 API Key 会立即失效，所有还在使用旧密钥的脚本都会返回 401。确定继续吗？',
        { title: '轮换 API Key', confirmText: '轮换' });
    if (!ok) return;

    var btn = el('apiKeyRotateBtn');
    setBusy(btn, true, '生成中...');
    setText('apiKeyStatusText', '');
    try {
        var resp = await request('/api/v0/user/apikey/rotate', { method: 'POST' });
        if (resp && resp.code === 200 && resp.data && resp.data.apikey) {
            _loaded = true;
            showOneTimeKey(resp.data.apikey, resp.data.hint);
            renderStatus({
                userid: resp.data.userid,
                has_key: true,
                hint: resp.data.hint,
            });
            setText('apiKeyStatusText', '');
            showToast('新的 API Key 已生成，请立即保存', 'success');
        } else {
            setText('apiKeyStatusText', (resp && resp.msg) || '生成失败');
            showToast((resp && resp.msg) || '生成失败，请稍后重试', 'error');
        }
    } catch (err) {
        setText('apiKeyStatusText', '网络请求失败');
        showToast('网络请求失败，请稍后重试', 'error');
    } finally {
        setBusy(btn, false, '轮换 API Key');
    }
}

async function handleRevoke() {
    if (!_loaded) await loadStatus();

    var ok = await confirmAction(
        '撤销后这个 API Key 会立即失效，所有使用它的脚本都会返回 401。确定继续吗？',
        { title: '撤销 API Key', confirmText: '撤销' });
    if (!ok) return;

    var btn = el('apiKeyRevokeBtn');
    setBusy(btn, true, '撤销中...');
    setText('apiKeyStatusText', '');
    try {
        var resp = await request('/api/v0/user/apikey', { method: 'DELETE' });
        if (resp && resp.code === 200 && resp.data) {
            clearOneTimeKey();
            _loaded = true;
            renderStatus({ userid: resp.data.userid, has_key: false, hint: '' });
            setText('apiKeyStatusText', '已撤销');
            showToast('API Key 已撤销', 'success');
        } else {
            setText('apiKeyStatusText', (resp && resp.msg) || '撤销失败');
            showToast((resp && resp.msg) || '撤销失败，请稍后重试', 'error');
        }
    } catch (err) {
        setText('apiKeyStatusText', '网络请求失败');
        showToast('网络请求失败，请稍后重试', 'error');
    } finally {
        setBusy(btn, false, '撤销');
    }
}

function copyFallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try {
        ok = document.execCommand('copy');
    } catch (e) {
        ok = false;
    }
    document.body.removeChild(ta);
    showToast(ok ? '已复制' : '复制失败，请手动选中密钥', ok ? 'success' : 'error');
}

function handleCopy() {
    var code = el('apiKeyValue');
    var text = code ? code.textContent : '';
    if (!text) {
        showToast('没有可复制的密钥', 'error');
        return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () {
            showToast('已复制', 'success');
        }).catch(function () {
            copyFallback(text);
        });
    } else {
        copyFallback(text);
    }
}

function initApiKey() {
    if (_bound) return;
    _bound = true;

    var rotateBtn = el('apiKeyRotateBtn');
    if (rotateBtn) on(rotateBtn, 'click', handleRotate);

    var revokeBtn = el('apiKeyRevokeBtn');
    if (revokeBtn) on(revokeBtn, 'click', handleRevoke);

    var copyBtn = el('apiKeyCopyBtn');
    if (copyBtn) on(copyBtn, 'click', handleCopy);

    var hideBtn = el('apiKeyHideBtn');
    if (hideBtn) on(hideBtn, 'click', function () {
        clearOneTimeKey();
        setText('apiKeyStatusText', '已隐藏（密钥仍可用）');
    });
}

/**
 * 设置面板的初始化钩子（由 dashboard.profile.js::initProfilePanel 调用）。
 * 幂等：事件只绑一次；状态只拉一次；再次进入设置页会清掉上一次的明文。
 */
function initApiKeyPanel() {
    initApiKey();
    if (_panelVisited) clearOneTimeKey();
    _panelVisited = true;
    if (_loaded || _loading) return Promise.resolve();
    return loadStatus();
}

export { initApiKeyPanel, loadStatus };

window.initApiKeyPanel = initApiKeyPanel;
