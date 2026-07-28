

// 定义支持的主题列表，方便循环切换
const THEME_LIST = ['green', 'light', 'gray', 'dark_green'];
const THEME_KEY_ = 'app_theme'; // 定义 localStorage 的 Key

const ThemeEngine = {
    // 初始化主题
    init: function() {
        // 优先读取 LocalStorage，其次默认为 'green' (绿色)
        const savedTheme = localStorage.getItem(THEME_KEY_) || 'green';
        this.applyTheme(savedTheme);
    },

    // 应用主题
    applyTheme: function(themeName) {
        const body = document.body;
        
        // 移除所有可能的主题类
        THEME_LIST.forEach(theme => {
            body.classList.remove(`theme-${theme}`);
        });
        
        // 添加新主题类
        const themeClass = `theme-${themeName}`;
        body.classList.add(themeClass);
        
        // 更新 LocalStorage
        localStorage.setItem(THEME_KEY_, themeName);
        
        // 更新 UI 控件状态 (如果是下拉框)
        const selector = document.getElementById('theme-selector');
        if (selector && selector.tagName === 'SELECT') {
            selector.value = themeName;
        }
    },

    // 绑定切换事件 (适配右下角悬浮按钮)
    bindSwitchEvent: function() {
        const switcherBtn = document.getElementById('theme-selector');
        if (switcherBtn) {
            // 监听点击事件
            switcherBtn.addEventListener('click', () => {
                // 获取当前主题
                const currentTheme = localStorage.getItem(THEME_KEY_) || 'green';

                // 计算下一个主题的索引
                const currentIndex = THEME_LIST.indexOf(currentTheme);
                const nextIndex = (currentIndex + 1) % THEME_LIST.length;
                const nextTheme = THEME_LIST[nextIndex];

                // 应用新主题
                this.applyTheme(nextTheme);

                // 如果是已登录状态，同步到后端
                const token = (typeof AuthGuard !== 'undefined') ? AuthGuard.getToken() : null;
                if (token) {
                    this.syncThemeToServer(nextTheme, token);
                }
            });
        }
    },

    // 同步主题到后端
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

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    ThemeEngine.init();
    ThemeEngine.bindSwitchEvent();
});

window.ThemeEngine = ThemeEngine;