/**
 * dashboard.profile.js
 * 「设置」面板里的 **个人资料编辑** + **头像裁剪上传** + **修改密码**
 *
 * Phase 2: ES Module — 共享资源通过 window 访问（$ / on / showToast / apiRequest / AuthGuard）
 *
 * 三条接口（全部 `/api/v0`，**需要 JWT**）：
 *   GET  /api/v0/user/profile   读取（user + profile 合并后的字典）
 *   PUT  /api/v0/user/profile   **局部更新**：没提到的字段不动，空串表示清空
 *   POST /api/v0/user/avatar    multipart（字段名 `file`）→ 服务端存盘并把 URL 写进资料
 *   PUT  /api/v0/user/password  {old_password, new_password} → 新的 access_token
 *
 * ## 几个刻意的决定
 *
 * 1. **懒加载**：`initProfile()` 只绑事件（DOM 一就绪就绑好，点按钮永远有反应）；
 *    真正的 `GET /profile` 由 `initProfilePanel()` 在**第一次打开设置面板**时才发
 *    （`dashboard.menu.js::STATIC_PANEL_HOOKS` 的 settings 钩子），不在页面加载时白跑一次。
 *
 * 2. **只提交改动过的字段**。PUT /profile 是局部更新（服务端用 `_UNSET` 哨兵区分
 *    「没提到」与「清空」），所以这里 diff 出 `_baseline` 与当前输入框的差异再提交 ——
 *    否则「保存资料」会把用户没碰过的字段一起覆盖一遍。
 *
 * 3. **裁剪在浏览器里做**（服务端刻意不带 Pillow，见 `user_service.upload_avatar`）：
 *    cover 裁成正方形 → 缩放到 512×512 → JPEG(质量 0.9) 的 Blob 再上传。
 *    读图走 `FileReader` 的 data URL，**不用 `URL.createObjectURL`**：
 *    dashboard 的 CSP 里 `img-src` 只有 `'self' data: https:`，
 *    blob: 图片在不同浏览器上对 `'self'` 的匹配并不一致，data: 是明确放行的。
 *
 * 4. **改密后必须落盘新 token**：后端改密会推进 `password_changed_at`，
 *    于是**当前这个 token 立刻失效**（`iat` 早于改密时刻）——不写回新 token
 *    用户就会被自己踢下线。
 */

import { refreshUserProfileLocal } from './dashboard.auth.js';

// ===== 从 window 获取共享资源（config.js / utils.js / toast.js 以普通 <script> 加载）=====
var AuthGuard = window.AuthGuard;
var API_BASE_URL = window.API_BASE_URL;
var $ = window.$;
var on = window.on;
var showToast = window.showToast;

/** 默认头像（与 dashboard.auth.js::initAuthModules 的兜底一致） */
var DEFAULT_AVATAR = (window.BASE_PATH || '.') + '/favicon.png';

/** 服务端上限（`MAX_AVATAR_SIZE`，见 services/user_service.py::upload_avatar） */
var MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** 裁剪后的正方形边长（像素） */
var AVATAR_SIZE = 512;
/** JPEG 导出质量 */
var JPEG_QUALITY = 0.9;
/** 性别白名单（与 UserProfile 的 gender 列一致） */
var GENDER_VALUES = ['', 'male', 'female', 'other'];
/** 参与 diff 的文本字段（avatar 单独走上传/移除，不在这里） */
var TEXT_FIELDS = ['nickname', 'gender', 'location', 'introduction', 'banner'];

// ===== 模块状态 =====
var _bound = false;             // 事件是否已绑定（幂等）
var _loaded = false;            // 资料是否已经从服务端拉过
var _loading = false;           // 是否正在拉资料（防并发重复请求）
var _baseline = {};             // 服务端当前值，用于 diff 出「改动过的字段」
var _pendingAvatarBlob = null;  // 裁好但还没上传的图片

// ============================================================
// 小工具
// ============================================================
function el(id) {
    return document.getElementById(id);
}

function readValue(id) {
    var node = el(id);
    return node && typeof node.value === 'string' ? node.value : '';
}

function setValue(id, value) {
    var node = el(id);
    if (node) node.value = value == null ? '' : String(value);
}

function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value == null ? '' : String(value);
}

/** 按钮忙碌态（沿用 utils.js::setBtnState 的语义，但连文案一起换） */
function setBusy(btn, busy, text) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (text) btn.textContent = text;
}

/** 统一请求：silent 由本模块自己提示，避免 apiRequest 再叠一层 Toast */
function request(path, options) {
    options = options || {};
    options.silent = true;
    return window.apiRequest(path, options);
}

/** 二次确认（有 Modal 用 Modal，没有就当作已确认） */
function confirmAction(message, options) {
    if (window.Modal && typeof window.Modal.confirm === 'function') {
        return window.Modal.confirm(message, options || {});
    }
    return Promise.resolve(true);
}

/** 从服务端 profile 字典里取基准值（字段缺失一律落成空串） */
function baselineFrom(profile) {
    var out = {};
    TEXT_FIELDS.forEach(function (key) {
        var v = profile ? profile[key] : '';
        out[key] = (v === null || v === undefined) ? '' : String(v);
    });
    return out;
}

// ============================================================
// 预览 / 表单回显
// ============================================================
function setAvatarPreview(src) {
    var img = el('profileAvatarPreview');
    if (!img) return;
    img.src = src || DEFAULT_AVATAR;
    img.onerror = function () { this.src = DEFAULT_AVATAR; };
}

function fillProfileForm(profile) {
    setValue('profileNickname', profile.nickname || '');
    setValue('profileGender', GENDER_VALUES.indexOf(profile.gender) >= 0 ? profile.gender : '');
    setValue('profileLocation', profile.location || '');
    setValue('profileIntroduction', profile.introduction || '');
    setValue('profileBannerUrl', profile.banner || '');
    setAvatarPreview(profile.avatar || DEFAULT_AVATAR);
}

/**
 * 保存 / 上传成功后：更新基准值 + 回显表单 + **就地重绘**侧边栏与个人主页。
 * 全程不刷新页面（用户改完昵称应该立刻看到侧边栏变了）。
 */
function applyProfileToVisibleUser(profile) {
    _baseline = baselineFrom(profile);
    fillProfileForm(profile);

    // 主路径：dashboard.auth.js 用最近一次渲染的 user 对象合并 profile 后重绘
    if (refreshUserProfileLocal && refreshUserProfileLocal(profile)) return;

    // 兜底：user 信息还没渲染过（/user/menu 失败等）——至少把名字与头像换掉
    var name = profile.display_name || profile.nickname || '';
    ['sidebarUsername', 'profileUsername'].forEach(function (id) {
        var node = el(id);
        if (node && name) node.textContent = name;
    });
    ['sidebarAvatar', 'profileAvatar'].forEach(function (id) {
        var node = el(id);
        if (node) {
            node.src = profile.avatar || DEFAULT_AVATAR;
            node.onerror = function () { this.src = DEFAULT_AVATAR; };
        }
    });
}

// ============================================================
// 资料加载（懒：第一次打开设置面板）
// ============================================================
async function loadProfile() {
    if (_loading) return;
    _loading = true;
    setText('profileFormStatus', '资料加载中...');
    try {
        var resp = await request('/api/v0/user/profile');
        if (resp && resp.code === 200 && resp.data) {
            _loaded = true;
            _baseline = baselineFrom(resp.data);
            fillProfileForm(resp.data);
            setText('profileFormStatus', '');
            // 拉完资料后重绘一次展示名。
            // ℹ️ 说明（免得后人以为这里是唯一的生效路径）：**页面加载时本来就会正确显示昵称** ——
            //    `GET /api/v0/user/menu` 的 `user_info.profile` 走 `UserProfile.to_dict()`，
            //    含 `display_name`，而 `dashboard.auth.js::renderUserProfile` 用的正是
            //    `profile.display_name || profile.nickname || user.username`。
            //    这里再同步一次是**幂等的防御**：本函数同时承担「老账号没有 profile 行」等
            //    边界情况下的兜底，且保证「编辑资料后立刻看到新名字」不依赖上面那条链路。
            if (refreshUserProfileLocal) refreshUserProfileLocal(resp.data);
        } else {
            setText('profileFormStatus', '资料加载失败：' + ((resp && resp.msg) || '请检查网络后重试'));
        }
    } finally {
        _loading = false;
    }
}

/**
 * 设置面板的初始化钩子（由 `dashboard.menu.js::STATIC_PANEL_HOOKS` 的 settings 项调用）。
 * 幂等：只拉一次资料；每次进入都重绑事件是无害的（`initProfile` 内部去重）。
 */
function initProfilePanel() {
    initProfile();
    if (_loaded || _loading) return Promise.resolve();
    return loadProfile();
}

// ============================================================
// 资料保存
// ============================================================
/** diff 出真正改动过的字段；校验不过时返回 null（已给出提示） */
function collectProfilePatch() {
    var current = {
        nickname: readValue('profileNickname').trim(),
        gender: readValue('profileGender'),
        location: readValue('profileLocation').trim(),
        introduction: readValue('profileIntroduction'),
        banner: readValue('profileBannerUrl').trim(),
    };

    if (current.nickname.length > 40) { showToast('昵称最多 40 个字符', 'error'); return null; }
    if (current.location.length > 64) { showToast('所在地最多 64 个字符', 'error'); return null; }
    if (current.introduction.length > 200) { showToast('简介最多 200 个字符', 'error'); return null; }
    if (GENDER_VALUES.indexOf(current.gender) < 0) { showToast('性别取值不合法', 'error'); return null; }

    var patch = {};
    TEXT_FIELDS.forEach(function (key) {
        // ⚠️ 空串是**有意义**的值（= 清空该项），所以判断的是「与基准不同」而不是「非空」
        if (current[key] !== (_baseline[key] === undefined ? '' : _baseline[key])) {
            patch[key] = current[key];
        }
    });
    return patch;
}

async function handleProfileSubmit(e) {
    e.preventDefault();
    if (!_loaded) {
        await loadProfile();
        if (!_loaded) {
            showToast('资料还没加载出来，请稍后重试', 'error');
            return;
        }
    }

    var patch = collectProfilePatch();
    if (!patch) return;
    if (Object.keys(patch).length === 0) {
        showToast('没有需要保存的改动', 'info');
        return;
    }

    var btn = el('profileSaveBtn');
    setBusy(btn, true, '保存中...');
    try {
        var resp = await request('/api/v0/user/profile', { method: 'PUT', body: patch });
        if (resp && resp.code === 200 && resp.data) {
            applyProfileToVisibleUser(resp.data);
            showToast(resp.msg || '资料已更新', 'success');
        } else {
            showToast((resp && resp.msg) || '保存失败，请稍后重试', 'error');
        }
    } finally {
        setBusy(btn, false, '保存资料');
    }
}

// ============================================================
// 头像：选择 → canvas 裁剪 → 上传
// ============================================================
/** 把用户选的文件读成 data URL（CSP 的 img-src 放行 data:，blob: 则不保证） */
function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('无法读取文件')); };
        reader.readAsDataURL(file);
    });
}

/** data URL → 已解码的 <img> */
function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('无法解码图片')); };
        img.src = dataUrl;
    });
}

/**
 * cover 裁剪成正方形并缩放到 512×512。
 *
 * "cover" 的算法：取原图**中心的正方形**（边长 = min(宽, 高)），
 * 再整体缩放到 512×512 —— 只做等比缩放 + 居中裁切，不拉伸、不变形。
 *
 * @returns {Promise<{blob: Blob, preview: string}>} JPEG Blob 与其 data URL 预览
 */
function cropToSquareBlob(file) {
    return readFileAsDataUrl(file).then(loadImage).then(function (img) {
        return new Promise(function (resolve, reject) {
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            if (!w || !h) { reject(new Error('图片尺寸异常')); return; }

            var canvas = document.createElement('canvas');
            canvas.width = AVATAR_SIZE;
            canvas.height = AVATAR_SIZE;
            var ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('浏览器不支持 canvas')); return; }

            // 中心正方形源区域 → 目标 512×512
            var side = Math.min(w, h);
            var sx = (w - side) / 2;
            var sy = (h - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

            var preview = '';
            try {
                preview = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
            } catch (err) {
                reject(new Error('导出预览失败'));
                return;
            }

            if (typeof canvas.toBlob !== 'function') {
                reject(new Error('当前浏览器不支持导出图片'));
                return;
            }
            canvas.toBlob(function (blob) {
                if (!blob) { reject(new Error('图片导出失败')); return; }
                resolve({ blob: blob, preview: preview });
            }, 'image/jpeg', JPEG_QUALITY);
        });
    });
}

function clearPendingAvatar() {
    _pendingAvatarBlob = null;
    var area = el('profileCropArea');
    if (area) area.style.display = 'none';
    var input = el('profileAvatarFile');
    if (input) input.value = '';
    // 「裁剪后仍超 2MB」那条分支会把上传按钮禁用掉，这里把所有清理路径统一恢复
    setBusy(el('profileAvatarUploadBtn'), false, '上传头像');
}

async function handleAvatarFileChange(e) {
    var file = e.target && e.target.files ? e.target.files[0] : null;
    if (!file) return;

    if (!/^image\//.test(file.type || '')) {
        showToast('请选择图片文件（JPG / PNG / GIF / WebP）', 'error');
        clearPendingAvatar();
        return;
    }

    setText('profileAvatarHint', '正在裁剪…');
    try {
        var result = await cropToSquareBlob(file);
        _pendingAvatarBlob = result.blob;

        // 预览 1：头像行的小图（data URL，CSP 的 img-src 放行 data:）
        setAvatarPreview(result.preview);

        // 预览 2：裁剪区里那块固定方形 canvas（把裁好的结果原样画上去）
        var canvas = el('profileAvatarCanvas');
        if (canvas && canvas.getContext) {
            canvas.width = AVATAR_SIZE;
            canvas.height = AVATAR_SIZE;
            var ctx = canvas.getContext('2d');
            var img = await loadImage(result.preview);
            ctx.drawImage(img, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        }
        var area = el('profileCropArea');
        if (area) area.style.display = '';

        // ⚠️ 缩放**之后**仍然超限才拒绝：服务端上限 2MB（按文件前 12 字节判魔数）
        if (result.blob.size > MAX_AVATAR_BYTES) {
            setText('profileAvatarHint',
                '裁剪后仍有 ' + Math.round(result.blob.size / 1024) + 'KB，超过 2MB 上限，请换一张更小的图片');
            _pendingAvatarBlob = null;
            // 上传按钮一并禁用：留着它只会让用户点了得到一条「请先选择图片」的误导提示
            setBusy(el('profileAvatarUploadBtn'), true, '上传头像');
            return;
        }
        setText('profileAvatarHint',
            '已裁剪为 ' + AVATAR_SIZE + '×' + AVATAR_SIZE + '（' + Math.round(result.blob.size / 1024)
            + 'KB），点「上传头像」生效');
        setBusy(el('profileAvatarUploadBtn'), false, '上传头像');
    } catch (err) {
        console.warn('[profile] 头像裁剪失败:', err);
        showToast('图片处理失败：' + ((err && err.message) || '未知错误'), 'error');
        clearPendingAvatar();
        setText('profileAvatarHint', '支持 JPG / PNG / GIF / WebP，自动裁剪为 512×512，最大 2MB');
    }
}

async function uploadPendingAvatar() {
    if (!_pendingAvatarBlob) {
        showToast('请先点「选择图片」挑一张图片', 'error');
        return;
    }
    if (_pendingAvatarBlob.size > MAX_AVATAR_BYTES) {
        showToast('图片超过 2MB 上限，请换一张更小的图片', 'error');
        return;
    }

    var token = AuthGuard.getToken();
    if (!token) {
        showToast('登录状态已失效，请重新登录', 'error');
        return;
    }

    var fd = new FormData();
    fd.append('file', _pendingAvatarBlob, 'avatar.jpg');

    var btn = el('profileAvatarUploadBtn');
    setBusy(btn, true, '上传中...');
    try {
        // ⚠️ 这里刻意**手写 fetch**（apiRequest 会把 body 当 JSON 序列化）：
        //    1) FormData 必须由浏览器自己生成 multipart boundary → **不要**手写 Content-Type；
        //    2) 只补一个 Authorization 头（v0 需要 JWT）。
        var resp = await fetch(API_BASE_URL + '/api/v0/user/avatar', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: fd,
        });

        if (resp.status === 401 || resp.status === 422) {
            AuthGuard.handleAuthError();
            return;
        }

        var data = await resp.json();
        if (resp.ok && data && data.code === 200 && data.data) {
            var avatar = data.data.avatar || '';
            _baseline.avatar = avatar;
            clearPendingAvatar();
            setText('profileAvatarHint', '支持 JPG / PNG / GIF / WebP，自动裁剪为 512×512，最大 2MB');
            setAvatarPreview(avatar || DEFAULT_AVATAR);
            // 就地更新侧边栏与个人主页的头像（不发整页刷新）
            if (!refreshUserProfileLocal || !refreshUserProfileLocal({ avatar: avatar })) {
                ['sidebarAvatar', 'profileAvatar'].forEach(function (id) {
                    var node = el(id);
                    if (node) node.src = avatar || DEFAULT_AVATAR;
                });
            }
            showToast(data.msg || '头像已更新', 'success');
        } else {
            showToast((data && data.msg) || '头像上传失败，请稍后重试', 'error');
        }
    } catch (err) {
        console.warn('[profile] 头像上传失败:', err);
        showToast('网络请求失败，请稍后重试', 'error');
    } finally {
        setBusy(btn, false, '上传头像');
    }
}

async function removeAvatar() {
    var ok = await confirmAction('移除头像后将回退到默认头像，确定继续吗？', {
        title: '移除头像', confirmText: '移除',
    });
    if (!ok) return;

    var btn = el('profileAvatarRemoveBtn');
    setBusy(btn, true, '处理中...');
    try {
        // 空串 = 清空该项（PUT /profile 的局部更新语义）
        var resp = await request('/api/v0/user/profile', { method: 'PUT', body: { avatar: '' } });
        if (resp && resp.code === 200) {
            _baseline.avatar = '';
            clearPendingAvatar();
            setAvatarPreview(DEFAULT_AVATAR);
            if (!refreshUserProfileLocal || !refreshUserProfileLocal({ avatar: '' })) {
                ['sidebarAvatar', 'profileAvatar'].forEach(function (id) {
                    var node = el(id);
                    if (node) node.src = DEFAULT_AVATAR;
                });
            }
            showToast('头像已移除', 'success');
        } else {
            showToast((resp && resp.msg) || '移除失败，请稍后重试', 'error');
        }
    } finally {
        setBusy(btn, false, '移除头像');
    }
}

// ============================================================
// 修改密码
// ============================================================
async function handlePasswordSubmit(e) {
    e.preventDefault();

    var oldPwd = readValue('passwordOld');
    var newPwd = readValue('passwordNew');
    var confirmPwd = readValue('passwordConfirm');

    if (!oldPwd) { showToast('请输入当前密码', 'error'); return; }
    if (newPwd.length < 6) { showToast('新密码长度不能少于 6 位', 'error'); return; }
    if (newPwd !== confirmPwd) { showToast('两次输入的新密码不一致', 'error'); return; }
    if (newPwd === oldPwd) { showToast('新密码不能与当前密码相同', 'error'); return; }

    var btn = el('passwordSaveBtn');
    setBusy(btn, true, '提交中...');
    try {
        var resp = await request('/api/v0/user/password', {
            method: 'PUT',
            body: { old_password: oldPwd, new_password: newPwd },
        });

        if (resp && resp.code === 200 && resp.data && resp.data.access_token) {
            // ⚠️⚠️ 关键：后端改密会让**所有旧 token 立刻失效**（password_changed_at 前进，
            //      当前 token 的 iat 早于它）—— 不把新 token 写进 localStorage，
            //      用户下一次请求就会 401 被静默踢下线。
            AuthGuard.setToken(resp.data.access_token, resp.data.expires_in);
            // 顺带把内存里的权限快照按新 token 重算（等级不变，但别留旧 token 的派生值）
            if (typeof window.getNowPermission === 'function') {
                window.__nowPermission = window.getNowPermission();
            }
            setValue('passwordOld', '');
            setValue('passwordNew', '');
            setValue('passwordConfirm', '');
            showToast('密码已修改，当前登录状态已自动续期', 'success');
        } else {
            showToast((resp && resp.msg) || '修改失败，请稍后重试', 'error');
        }
    } finally {
        setBusy(btn, false, '修改密码');
    }
}

// ============================================================
// 初始化
// ============================================================
/**
 * 绑定交互（幂等）。**只做绑定，不发请求** —— 数据由 `initProfilePanel()` 懒加载。
 * 与 dashboard.deletion.js::initDeletion 同一套写法：DOM 一就绪就绑好，
 * 即使资料还没加载出来，点按钮也有明确提示而不是没反应。
 */
function initProfile() {
    if (!_bound) {
        _bound = true;

        var form = el('profileForm');
        if (form) on(form, 'submit', handleProfileSubmit);

        var pickBtn = el('profileAvatarPickBtn');
        var fileInput = el('profileAvatarFile');
        if (pickBtn && fileInput) {
            on(pickBtn, 'click', function () { fileInput.click(); });
        }
        if (fileInput) on(fileInput, 'change', handleAvatarFileChange);

        var resetBtn = el('profileCropResetBtn');
        if (resetBtn) {
            on(resetBtn, 'click', function () {
                clearPendingAvatar();
                setText('profileAvatarHint', '支持 JPG / PNG / GIF / WebP，自动裁剪为 512×512，最大 2MB');
                setAvatarPreview((_baseline && _baseline.avatar) || DEFAULT_AVATAR);
            });
        }

        var uploadBtn = el('profileAvatarUploadBtn');
        if (uploadBtn) on(uploadBtn, 'click', uploadPendingAvatar);

        var removeBtn = el('profileAvatarRemoveBtn');
        if (removeBtn) on(removeBtn, 'click', removeAvatar);

        var pwdForm = el('passwordForm');
        if (pwdForm) on(pwdForm, 'submit', handlePasswordSubmit);
    }
}

// ===== ES Module exports =====
export { initProfile, initProfilePanel, loadProfile };

// ===== 兼容层（dashboard.menu.js 通过 window 调静态面板钩子）=====
window.initProfilePanel = initProfilePanel;
