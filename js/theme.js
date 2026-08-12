/**
 * theme.js
 * 主题切换引擎
 * 共享模块：所有页面以普通 <script> 加载
 */

var THEME_LIST = ['green', 'light', 'gray', 'dark_green'];
var THEME_KEY = 'app_theme';

var ThemeEngine = {
    init: function() {
        var savedTheme = localStorage.getItem(THEME_KEY) || 'green';
        this.applyTheme(savedTheme);
    },

    applyTheme: function(themeName) {
        var body = document.body;
        THEME_LIST.forEach(function(theme) {
            body.classList.remove('theme-' + theme);
        });
        body.classList.add('theme-' + themeName);
        localStorage.setItem(THEME_KEY, themeName);
    },

    bindSwitchEvent: function() {
        var switcherBtn = document.getElementById('theme-selector');
        if (switcherBtn) {
            var self = this;
            switcherBtn.addEventListener('click', function() {
                var currentTheme = localStorage.getItem(THEME_KEY) || 'green';
                var currentIndex = THEME_LIST.indexOf(currentTheme);
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
            fetch(API_BASE_URL + '/api/v1/user/theme', {
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
