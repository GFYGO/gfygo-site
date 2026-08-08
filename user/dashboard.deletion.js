/**
 * dashboard.deletion.js
 * 账号注销功能
 */

/** 初始化注销功能 */
function initDeletion() {
    const cancelBtn = $('deletionCancelBtn');
    const sendCodeBtn = $('deletionSendCodeBtn');
    const confirmBtn = $('deletionConfirmBtn');
    const overlay = $('deletionOverlay');

    on(cancelBtn, 'click', closeDeletionModal);
    if (overlay) {
        on(overlay, 'click', (e) => {
            if (e.target === overlay) closeDeletionModal();
        });
    }
    on(sendCodeBtn, 'click', sendDeletionCode);
    on(confirmBtn, 'click', submitDeletionRequest);
}

/** 打开注销警告弹窗（5秒倒计时） */
function openDeletionModal() {
    const overlay = $('deletionOverlay');
    const countdown = $('deletionCountdown');
    const countdownNum = $('deletionCountdownNum');
    const emailGroup = $('deletionEmailGroup');
    const codeGroup = $('deletionCodeGroup');
    const emailInput = $('deletionEmailInput');
    const codeInput = $('deletionCodeInput');
    const sendCodeBtn = $('deletionSendCodeBtn');

    if (!overlay) return;

    overlay.classList.add('deletion-overlay--visible');
    countdown.style.display = '';
    emailGroup.style.display = 'none';
    codeGroup.style.display = 'none';
    if (emailInput) emailInput.value = '';
    if (codeInput) codeInput.value = '';
    if (sendCodeBtn) {
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = '发送验证码';
    }

    let seconds = 5;
    countdownNum.textContent = seconds;

    const timer = setInterval(() => {
        seconds--;
        countdownNum.textContent = seconds;
        if (seconds <= 0) {
            clearInterval(timer);
            countdown.style.display = 'none';
            emailGroup.style.display = 'flex';
        }
    }, 1000);

    overlay._deletionTimer = timer;
}

/** 关闭注销弹窗 */
function closeDeletionModal() {
    const overlay = $('deletionOverlay');
    if (!overlay) return;
    overlay.classList.remove('deletion-overlay--visible');
    if (overlay._deletionTimer) {
        clearInterval(overlay._deletionTimer);
        delete overlay._deletionTimer;
    }
}

/** 发送注销验证码到邮箱 */
async function sendDeletionCode() {
    const token = AuthGuard.getToken();
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }

    const emailInput = $('deletionEmailInput');
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) {
        showToast('请输入注册邮箱', 'error');
        return;
    }

    const sendCodeBtn = $('deletionSendCodeBtn');
    setBtnState(sendCodeBtn, true);
    sendCodeBtn.textContent = '发送中...';

    try {
        const r = await fetch(API_BASE_URL + '/api/v1/user/send-deletion-code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ email })
        });
        const d = await r.json();
        if (d.code === 200) {
            showToast('验证码已发送至您的邮箱，5分钟内有效', 'success');
            const emailGroup = $('deletionEmailGroup');
            const codeGroup = $('deletionCodeGroup');
            if (emailGroup) emailGroup.style.display = 'none';
            if (codeGroup) codeGroup.style.display = 'flex';
        } else {
            showToast(d.msg || '发送失败', 'error');
            setBtnState(sendCodeBtn, false, '发送验证码');
        }
    } catch (e) {
        showToast('网络请求失败', 'error');
        setBtnState(sendCodeBtn, false, '发送验证码');
    }
}

/** 提交注销请求 */
async function submitDeletionRequest() {
    const token = AuthGuard.getToken();
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }

    const emailInput = $('deletionEmailInput');
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) {
        showToast('请先输入注册邮箱', 'error');
        return;
    }

    const codeInput = $('deletionCodeInput');
    const code = codeInput ? codeInput.value.trim() : '';
    if (!code || code.length !== 6) {
        showToast('请输入6位验证码', 'error');
        return;
    }

    const confirmBtn = $('deletionConfirmBtn');
    setBtnState(confirmBtn, true);
    confirmBtn.textContent = '提交中...';

    try {
        const r = await fetch(API_BASE_URL + '/api/v1/user/request-deletion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ email, code })
        });
        const d = await r.json();
        if (d.code === 200) {
            showToast('注销请求已提交，14天内登录可取消', 'success');
            closeDeletionModal();
            renderDeletionStatus();
        } else {
            showToast(d.msg || '提交失败', 'error');
            setBtnState(confirmBtn, false, '确认注销');
        }
    } catch (e) {
        showToast('网络请求失败', 'error');
        setBtnState(confirmBtn, false, '确认注销');
    }
}

/** 取消注销请求 */
async function cancelDeletion() {
    const token = AuthGuard.getToken();
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }

    try {
        const r = await fetch(API_BASE_URL + '/api/v1/user/cancel-deletion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const d = await r.json();
        if (d.code === 200) {
            showToast('注销请求已取消', 'success');
            renderDeletionStatus();
        } else {
            showToast(d.msg || '取消失败', 'error');
        }
    } catch (e) {
        showToast('网络请求失败', 'error');
    }
}

/** 查询并渲染注销状态 */
async function renderDeletionStatus() {
    const statusArea = $('deletionStatusArea');
    const actionArea = $('deletionActionArea');
    if (!statusArea || !actionArea) return;

    const token = AuthGuard.getToken();
    if (!token) {
        statusArea.innerHTML = '';
        actionArea.innerHTML = '';
        return;
    }

    try {
        const r = await fetch(API_BASE_URL + '/api/v1/user/deletion-status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const d = await r.json();

        if (d.code !== 200 || !d.data) {
            statusArea.innerHTML = '';
            actionArea.innerHTML = `
                <button class="deletion-btn deletion-btn--danger" onclick="openDeletionModal()">
                    🗑 注销账号
                </button>
            `;
            return;
        }

        const req = d.data;
        const now = new Date();
        const expiresAt = new Date(req.expires_at);

        if (req.status === 'pending') {
            const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
            statusArea.innerHTML = `
                <div class="deletion-status-info deletion-status-info--pending">
                    <strong>⚠️ 注销待处理</strong><br>
                    申请时间：${req.requested_at ? new Date(req.requested_at).toLocaleString() : '未知'}<br>
                    剩余冷静期：<strong>${daysLeft} 天</strong>（${expiresAt.toLocaleDateString()} 后自动删除）<br>
                    期间登录即可自动取消注销。
                </div>
            `;
            actionArea.innerHTML = `
                <button class="deletion-btn deletion-btn--secondary" onclick="cancelDeletion()">
                    ↩ 取消注销
                </button>
            `;
        } else if (req.status === 'completed') {
            statusArea.innerHTML = `
                <div class="deletion-status-info deletion-status-info--completed">
                    ❌ 账号已注销（数据已删除）
                </div>
            `;
            actionArea.innerHTML = '';
        } else if (req.status === 'cancelled') {
            statusArea.innerHTML = `
                <div class="deletion-status-info deletion-status-info--cancelled">
                    ✅ 注销请求已取消，账号恢复正常。<br>
                    取消时间：${req.cancelled_at ? new Date(req.cancelled_at).toLocaleString() : '未知'}
                </div>
            `;
            actionArea.innerHTML = `
                <button class="deletion-btn deletion-btn--danger" onclick="openDeletionModal()">
                    🗑 再次申请注销
                </button>
            `;
        }
    } catch (e) {
        statusArea.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;">加载失败</p>';
        actionArea.innerHTML = '';
    }
}

// 暴露到全局供 HTML 内联事件使用
window.openDeletionModal = openDeletionModal;
window.cancelDeletion = cancelDeletion;
