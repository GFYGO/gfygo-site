/**
 * theme.js
 * 主题切换引擎
 */

const ThemeEngine = {
    // 初始化主题
    init: function() {
        // 优先读取 LocalStorage，其次默认为 'light'
        const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
        this.applyTheme(savedTheme);
    },

    // 应用主题
    applyTheme: function(themeName) {
        const body = document.body;
        
        // 移除所有可能的主题类
        body.classList.remove('theme-light', 'theme-dark', 'theme-green', 'theme-dark_green');
        
        // 添加新主题类
        const themeClass = `theme-${themeName}`;
        body.classList.add(themeClass);
        
        // 更新 LocalStorage
        localStorage.setItem(THEME_KEY, themeName);
        
        // 更新 UI 控件状态 (如果有下拉框)
        const selector = document.getElementById('theme-selector');
        if (selector) selector.value = themeName;
    },

    // 绑定切换事件
    bindSwitchEvent: function() {
        const selector = document.getElementById('theme-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                this.applyTheme(e.target.value);
                
                // 如果是已登录状态，同步到后端
                const token = window.AuthUtil.getToken();
                if (token) {
                    this.syncThemeToServer(e.target.value, token);
                }
            });
        }
    },

    // 同步主题到后端
    syncThemeToServer: async function(theme, token) {
        try {
            await fetch(`${window.API_BASE_URL}/api/v1/user/theme`, {
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

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    ThemeEngine.init();
    ThemeEngine.bindSwitchEvent();
});

window.ThemeEngine = ThemeEngine;