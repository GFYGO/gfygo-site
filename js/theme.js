/**
 * theme.js
 * 主题切换引擎
 * 共享模块：所有页面以普通 <script> 加载
 */

var THEME_LIST = ['green', 'light', 'gray', 'dark_green'];
var THEME_KEY = 'app_theme';

/**
 * 安全读取本地主题：浏览器禁用/阻断 localStorage 时退化为 null（使用默认主题）
 */
function readStoredTheme() {
    try {
        return localStorage.getItem(THEME_KEY);
    } catch (e) {
        console.warn('[theme] 读取本地主题失败，使用默认主题:', e);
        return null;
    }
}

/**
 * 安全写入本地主题：写入失败只降级（不持久化），不影响主题切换本身
 */
function writeStoredTheme(themeName) {
    try {
        localStorage.setItem(THEME_KEY, themeName);
    } catch (e) {
        console.warn('[theme] 保存本地主题失败（本次切换仍然生效）:', e);
    }
}

var ThemeEngine = {
    init: function() {
        var savedTheme = readStoredTheme() || 'green';
        this.applyTheme(savedTheme);
    },

    applyTheme: function(themeName) {
        var body = document.body;
        if (!body) return;
        THEME_LIST.forEach(function(theme) {
            body.classList.remove('theme-' + theme);
        });
        body.classList.add('theme-' + themeName);
        writeStoredTheme(themeName);
    },

    bindSwitchEvent: function() {
        if (this._switchBound) return;
        this._switchBound = true;
        var switcherBtn = document.getElementById('theme-selector');
        if (switcherBtn) {
            var self = this;
            switcherBtn.addEventListener('click', function() {
                var currentTheme = readStoredTheme() || 'green';
                var currentIndex = THEME_LIST.indexOf(currentTheme);
                if (currentIndex < 0) currentIndex = 0;
                var nextIndex = (currentIndex + 1) % THEME_LIST.length;
                var nextTheme = THEME_LIST[nextIndex];
                self.applyTheme(nextTheme);
                var token = (typeof AuthGuard !== 'undefined') ? AuthGuard.getToken() : null;
                if (token) {
                    self.syncThemeToServer(nextTheme, token);
                }
            });
        }
    },

    syncThemeToServer: function(theme, token) {
        try {
            fetch(API_BASE_URL + '/api/v0/user/theme', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ theme: theme })
            });
        } catch (error) {
            console.error("同步主题失败", error);
        }
    }
};

function initTheme() {
    ThemeEngine.init();
    ThemeEngine.bindSwitchEvent();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}

// ===== 全局挂载 =====
window.ThemeEngine = ThemeEngine;
window.initTheme = initTheme;
