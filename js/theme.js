/**
 * theme.js
 * 主题切换引擎
 * Phase 1: 改为 ES Module，保留 window 兼容层
 */
import { AuthGuard, API_BASE_URL } from './config.js';

const THEME_LIST = ['green', 'light', 'gray', 'dark_green'];
const THEME_KEY = 'app_theme';

const ThemeEngine = {
    init: function() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'green';
        this.applyTheme(savedTheme);
    },

    applyTheme: function(themeName) {
        const body = document.body;
        THEME_LIST.forEach(theme => {
            body.classList.remove(`theme-${theme}`);
        });
        body.classList.add(`theme-${themeName}`);
        localStorage.setItem(THEME_KEY, themeName);
    },

    bindSwitchEvent: function() {
        const switcherBtn = document.getElementById('theme-selector');
        if (switcherBtn) {
            switcherBtn.addEventListener('click', () => {
                const currentTheme = localStorage.getItem(THEME_KEY) || 'green';
                const currentIndex = THEME_LIST.indexOf(currentTheme);
                const nextIndex = (currentIndex + 1) % THEME_LIST.length;
                const nextTheme = THEME_LIST[nextIndex];
                this.applyTheme(nextTheme);
                const token = AuthGuard.getToken();
                if (token) {
                    this.syncThemeToServer(nextTheme, token);
                }
            });
        }
    },

    syncThemeToServer: async function(theme, token) {
        try {
            await fetch(`${API_BASE_URL}/api/v1/user/theme`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ theme: theme })
            });
        } catch (error) {
            console.error("同步主题失败", error);
        }
    }
};

export default ThemeEngine;
export { ThemeEngine };

// ===== 初始化与兼容层 =====
function initTheme() {
    ThemeEngine.init();
    ThemeEngine.bindSwitchEvent();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}

window.ThemeEngine = ThemeEngine;
window.initTheme = initTheme;
