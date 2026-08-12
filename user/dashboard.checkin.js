/**
 * dashboard.checkin.js
 * 日历打卡系统
 * Phase 2: ES Module — 共享资源通过 window 访问
 */

var AuthGuard = window.AuthGuard;
var $ = window.$;
var on = window.on;
var showToast = window.showToast;

const CHECKIN_KEY_PREFIX = 'checkin_record_';
let calendarState = null;

function getCheckinStorageKey(userId) {
    return `${CHECKIN_KEY_PREFIX}${userId}`;
}

function loadCheckinRecords(userId) {
    try {
        const raw = localStorage.getItem(getCheckinStorageKey(userId));
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function saveCheckinRecords(userId, records) {
    try {
        localStorage.setItem(getCheckinStorageKey(userId), JSON.stringify(records));
    } catch (e) {
        console.warn('保存打卡记录失败', e);
    }
}

function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

/** 初始化打卡日历 */
function initCheckinCalendar(userId) {
    const calEl = $('calDays');
    const titleEl = $('calTitle');
    const prevBtn = $('calPrev');
    const nextBtn = $('calNext');
    const checkinBtn = $('checkinBtn');
    if (!calEl || !titleEl || !prevBtn || !nextBtn || !checkinBtn) return;

    const today = new Date();
    calendarState = {
        userId: userId,
        viewYear: today.getFullYear(),
        viewMonth: today.getMonth(),
        today: today,
        records: loadCheckinRecords(userId)
    };

    on(prevBtn, 'click', () => {
        calendarState.viewMonth--;
        if (calendarState.viewMonth < 0) {
            calendarState.viewMonth = 11;
            calendarState.viewYear--;
        }
        renderCalendar();
    });
    on(nextBtn, 'click', () => {
        calendarState.viewMonth++;
        if (calendarState.viewMonth > 11) {
            calendarState.viewMonth = 0;
            calendarState.viewYear++;
        }
        renderCalendar();
    });
    on(checkinBtn, 'click', () => handleCheckin());

    renderCalendar();
}

/** 渲染日历 */
function renderCalendar() {
    const calEl = $('calDays');
    const titleEl = $('calTitle');
    const checkinBtn = $('checkinBtn');
    if (!calEl || !titleEl || !checkinBtn || !calendarState) return;

    const { viewYear, viewMonth, today, records } = calendarState;

    titleEl.textContent = `${viewYear}年${viewMonth + 1}月`;

    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startWeekday = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

    calEl.innerHTML = '';

    for (let i = startWeekday - 1; i >= 0; i--) {
        const dayNum = prevMonthLastDay - i;
        const span = document.createElement('span');
        span.className = 'calendar-day calendar-day--outside';
        span.textContent = dayNum;
        calEl.appendChild(span);
    }

    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    let alreadyCheckedToday = false;

    for (let d = 1; d <= daysInMonth; d++) {
        const span = document.createElement('span');
        span.className = 'calendar-day';
        span.textContent = d;

        const thisDate = new Date(viewYear, viewMonth, d);
        const key = dateKey(viewYear, viewMonth, d);

        if (isSameDay(thisDate, today)) {
            span.classList.add('calendar-day--today');
        }
        if (records[key]) {
            span.classList.add('calendar-day--checked');
            if (key === todayKey) alreadyCheckedToday = true;
        }

        calEl.appendChild(span);
    }

    const totalCells = startWeekday + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
        const span = document.createElement('span');
        span.className = 'calendar-day calendar-day--outside';
        span.textContent = i;
        calEl.appendChild(span);
    }

    if (alreadyCheckedToday) {
        checkinBtn.disabled = true;
        checkinBtn.textContent = '✓ 今日已打卡';
    } else {
        checkinBtn.disabled = false;
        checkinBtn.textContent = '打卡签到';
    }
}

/** 打卡操作 */
function handleCheckin() {
    if (!calendarState) return;
    const { userId, today, records } = calendarState;
    const key = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

    if (records[key]) {
        showToast('今日已打卡', 'info');
        return;
    }

    records[key] = true;
    saveCheckinRecords(userId, records);
    calendarState.records = records;

    renderCalendar();
    showToast('打卡成功！继续加油 💪', 'success');
}

/** 初始化打卡功能入口 */
function initCheckinButtons() {
    const token = AuthGuard.getToken();
    if (!token) return;

    try {
        const parts = token.split('.');
        if (parts.length >= 2) {
            let payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (payloadB64.length % 4) payloadB64 += '=';
            const payload = JSON.parse(atob(payloadB64));
            const userId = payload.sub || payload.user_id || payload.id;
            if (userId) {
                initCheckinCalendar(userId);
            }
        }
    } catch (e) {
        console.warn('初始化打卡失败', e);
    }
}

// ===== ES Module exports =====
export { initCheckinButtons, initCheckinCalendar };