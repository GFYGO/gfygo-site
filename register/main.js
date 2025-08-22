// 变量
console.log("start");
const back_url = 'https://back.gwl.net.cn';

// 获取表单
const regForm = document.getElementById('reg_form');
const usernameMsg = document.getElementById('username');
const emailMsg = document.getElementById('email'); 
const pwdMsg = document.getElementById('pwd');


// 获取原有的通用提示元素 (如果后端需要，可以保留)
// const usernameMsg = document.getElementById('username');
// const emailMsg = document.getElementById('email');
// const pwdMsg = document.getElementById('pwd');

// 成功提示区域
const successMessage = document.getElementById('success-message');
const checkKeyDisplay = document.getElementById('check-key-display');

// --- 动态创建或获取错误显示元素 ---

// 为用户名错误信息预留的元素 (假设HTML中有 <span id="username-error"></span>)
let usernameErrorMsg = document.getElementById('username-error');
// 如果没有，则在用户名输入框前动态创建
if (!usernameErrorMsg) {
    const usernameInput = regForm.querySelector('input[name="username"]');
    if (usernameInput) {
        usernameErrorMsg = document.createElement('span');
        usernameErrorMsg.id = 'username-error';
        usernameErrorMsg.style.color = 'red';
        usernameInput.parentNode.insertBefore(usernameErrorMsg, usernameInput);
    }
}

// 为邮箱错误信息预留的元素 (假设HTML中有 <span id="email-error"></span>)
let emailErrorMsg = document.getElementById('email-error');
// 如果没有，则在邮箱输入框前动态创建
if (!emailErrorMsg) {
    const emailInput = regForm.querySelector('input[name="email"]');
    if (emailInput) {
        emailErrorMsg = document.createElement('span');
        emailErrorMsg.id = 'email-error';
        emailErrorMsg.style.color = 'red';
        emailInput.parentNode.insertBefore(emailErrorMsg, emailInput);
    }
}

// 为密码错误信息预留的元素 (假设HTML中有 <span id="password-error"></span>)
let passwordErrorMsg = document.getElementById('password-error');
// 如果没有，则在密码输入框前动态创建
if (!passwordErrorMsg) {
    const passwordInput = regForm.querySelector('input[name="password"]');
    if (passwordInput) {
        passwordErrorMsg = document.createElement('span');
        passwordErrorMsg.id = 'password-error';
        passwordErrorMsg.style.color = 'red';
        passwordInput.parentNode.insertBefore(passwordErrorMsg, passwordInput);
    }
}

// 用于显示通用错误信息（如人机验证失败、网络错误）的元素，放在提交按钮上方
let generalErrorMsg = document.getElementById('general-error-before-submit');
// 如果没有，则在提交按钮前动态创建
if (!generalErrorMsg) {
    const submitButton = regForm.querySelector('button[type="submit"]');
    if (submitButton) {
        generalErrorMsg = document.createElement('div');
        generalErrorMsg.id = 'general-error-before-submit';
        generalErrorMsg.style.color = 'red';
        generalErrorMsg.style.marginTop = '10px';
        generalErrorMsg.style.marginBottom = '10px';
        submitButton.parentNode.insertBefore(generalErrorMsg, submitButton);
    }
}

// --- 提交处理 ---
regForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const submitBtn = regForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';

    // --- 清除旧的错误信息 ---
    if (usernameErrorMsg) usernameErrorMsg.textContent = '';
    if (emailErrorMsg) emailErrorMsg.textContent = '';
    if (passwordErrorMsg) passwordErrorMsg.textContent = '';
    if (generalErrorMsg) {
        generalErrorMsg.textContent = '';
        generalErrorMsg.style.display = 'none'; // 隐藏通用错误区域
    }

    try {
        // 收集表单数据
        const formData = new FormData(regForm);


        // 2. 发送 POST 请求
        const response = await fetch('https://back.gwl.net.cn/register/', {

            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.status === 'success') {
            // 显示成功信息
            showCheckKey(result.check_key);
        } else if (result.status === 'error') {
            // 根据错误字段显示错误信息到指定位置
            const errorMessage = result.message || '操作失败';
            switch (result.wrong) {
                case 'username':
                    if (usernameErrorMsg) {
                        usernameErrorMsg.textContent = errorMessage;
                    } else {
                        // Fallback: 如果找不到特定元素，可以考虑显示在通用区域或控制台
                        console.warn('Username error element not found. Message:', errorMessage);
                        if(generalErrorMsg) {
                             generalErrorMsg.textContent = `用户名错误: ${errorMessage}`;
                             generalErrorMsg.style.display = 'block';
                        }
                    }
                    break;
                case 'email':
                    if (emailErrorMsg) {
                        emailErrorMsg.textContent = errorMessage;
                    } else {
                        console.warn('Email error element not found. Message:', errorMessage);
                        if(generalErrorMsg) {
                             generalErrorMsg.textContent = `邮箱错误: ${errorMessage}`;
                             generalErrorMsg.style.display = 'block';
                        }
                    }
                    break;
                case 'password':
                    if (passwordErrorMsg) {
                        passwordErrorMsg.textContent = errorMessage;
                    } else {
                        console.warn('Password error element not found. Message:', errorMessage);
                        if(generalErrorMsg) {
                             generalErrorMsg.textContent = `密码错误: ${errorMessage}`;
                             generalErrorMsg.style.display = 'block';
                        }
                    }
                    break;
                case 'cf_key': // 人机验证错误
                    if (generalErrorMsg) {
                        generalErrorMsg.textContent = '人机验证未通过，请确保已完成验证。';
                        generalErrorMsg.style.display = 'block';
                    } else {
                        console.warn('General error element not found for cf_key.');
                    }
                    break;
                default:
                    // 其他未指定字段的错误显示在通用区域
                    if (generalErrorMsg) {
                        generalErrorMsg.textContent = `注册失败：${errorMessage}`;
                        generalErrorMsg.style.display = 'block';
                    } else {
                         console.warn('General error element not found. Message:', errorMessage);
                    }
                    console.warn('Unknown error field:', result.field, 'Message:', errorMessage);
            }
        } else {
            // 处理非标准格式响应
            if (generalErrorMsg) {
                generalErrorMsg.textContent = '服务器响应异常，请稍后重试。';
                generalErrorMsg.style.display = 'block';
            }
            console.warn('Unexpected response format:', result);
        }
    } catch (error) {
        console.error('注册请求失败:', error);
        // 网络错误或解析错误显示在通用区域
        if (generalErrorMsg) {
            generalErrorMsg.textContent = '网络错误，请检查连接后重试。';
            generalErrorMsg.style.display = 'block';
        }
    } finally {
        // 恢复按钮状态
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
});

// 独立函数：显示 check_key 和成功信息
function showCheckKey(checkKey) {
    // 隐藏注册表单
    if (regForm) regForm.style.display = 'none';
    // 显示成功信息区域
    if (successMessage) successMessage.style.display = 'block';
    // 填入 check_key
    if (checkKeyDisplay) checkKeyDisplay.textContent = checkKey;
}




