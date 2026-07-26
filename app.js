/**
 * 全局常量与配置
 */
// 严格遵循架构师定义的API接口契约，禁止自行捏造接口地址
const API_BASE_URL = '/api/v1'; 

// 主题配置常量（支持4种颜色）
const THEME_CONFIG = {
    light: { '--bg-color': '#ffffff', '--text-color': '#333333' },
    dark: { '--bg-color': '#1a1a1a', '--text-color': '#f0f0f0' },
    blue: { '--bg-color': '#e6f7ff', '--text-color': '#003a8c' },
    green: { '--bg-color': '#f6ffed', '--text-color': '#135200' }
};

const TOKEN_KEY = 'auth_token';
const THEME_KEY = 'user_theme';
// 50小时过期校验（毫秒）
const TOKEN_EXPIRE_MS = 50 * 60 * 60 * 1000; 

/**
 * 工具函数：Token 校验与管理
 */
const AuthManager = {
    getToken() {
        const tokenData = JSON.parse(localStorage.getItem(TOKEN_KEY));
        if (!tokenData) return null;
        
        // 50小时过期校验逻辑
        if (Date.now() - tokenData.timestamp > TOKEN_EXPIRE_MS) {
            this.clearToken();
            return null;
        }
        return tokenData.token;
    },
    setToken(token) {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, timestamp: Date.now() }));
    },
    clearToken() {
        localStorage.removeItem(TOKEN_KEY);
    }
};

/**
 * 任务 FE-LOG-01: 主题引擎
 * 读取 LocalStorage 并应用 CSS 变量
 */
const ThemeEngine = {
    init() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
        this.applyTheme(savedTheme);
    },
    applyTheme(themeName) {
        const themeVars = THEME_CONFIG[themeName];
        if (!themeVars) return;

        // 动态应用 CSS 变量
        Object.entries(themeVars).forEach(([key, value]) => {
            document.documentElement.style.setProperty(key, value);
        });
        // 持久化主题偏好
        localStorage.setItem(THEME_KEY, themeName);
    }
};

/**
 * 任务 FE-LOG-02: 登录与 Turnstile SDK 集成
 */
async function handleLogin(event) {
    event.preventDefault();
    const turnstileToken = window.turnstile?.getResponse();
    
    // 无 Turnstile Token 无法提交
    if (!turnstileToken) {
        alert('请完成人机验证');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username: event.target.username.value, 
                password: event.target.password.value, 
                turnstileToken 
            })
        });
        const data = await response.json();
        
        if (response.ok) {
            AuthManager.setToken(data.token);
            window.location.href = '/profile.html'; // 登录成功跳转
        } else {
            alert(data.message || '登录失败');
        }
    } catch (error) {
        console.error('登录请求异常:', error);
    }
}

/**
 * 任务 FE-LOG-03: 个人主页数据渲染
 */
async function loadUserProfile() {
    const token = AuthManager.getToken();
    if (!token) {
        window.location.href = '/login.html'; // 未登录或Token过期重定向
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/user/profile`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 401) {
            AuthManager.clearToken();
            window.location.href = '/login.html';
            return;
        }

        const profile = await response.json();
        
        // 动态渲染用户名、头像
        document.getElementById('user-avatar').src = profile.avatarUrl;
        document.getElementById('user-name').textContent = profile.username;
        
        // 同步后端下发的主题偏好
        if (profile.preferredTheme) {
            ThemeEngine.applyTheme(profile.preferredTheme);
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
    }
}

// 页面初始化入口
document.addEventListener('DOMContentLoaded', () => {
    ThemeEngine.init();
    
    // 根据当前页面路由绑定对应逻辑
    if (window.location.pathname.includes('profile')) {
        loadUserProfile();
    }
});