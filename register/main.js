//变量
console.log("start")
var notice = document.querySelector('.notice');
const index_url = 'https://gwl.net.cn'
const back_url = 'https://back.gwl.net.cn'
/////////////////////////////////////网络交互函数/////////////////////////////////////////////////

function get(url,information) {
    fetch(url,{
    headers:information => information.json()})
        .then(response => response.json())
        .then(data => {
            console.log(data.message); // 在控制台中打印
        return data //
        });
}

function post(url,information) {
    fetch(url, {
        method: 'POST',
        body: information
    })
    .then(response => response.json())
    .then(data => {
        console.log(data.message); // 在控制台中打印添加成功的消息
        return data //
    });
}


///////////////////////////////页面函数（下面）/////////////////////////////////////

// //notice关闭按钮
// function closeNotice() {
//     document.getElementById('notice').style.display = 'none'; // 隐藏
// }
// //获取notice
// function handleNotice() {
//     let data = get(back_url,{'type':'notice'})
//     var noticeElement = document.getElementById('notice');

//     if (data.notice == 'none') {
//         closeNotice(); // 如果通知信息为 "none"，则调用关闭通知的函数
//     } else {
//         noticeElement.getElementsByTagName('h3')[0].getElementsByTagName('span')[0].innerText = get(back_url,{'type':'notice','notice':'h'}); // 更新标题内容
//         noticeElement.getElementsByTagName('a')[0].getElementsByTagName('span')[0].innerText = get(back_url,{'type':'notice','notice':'txt'}); // 更新链接文本
//     }
// }

// 假设你有一个全局变量 back_url
// const back_url = 'https://your-backend.com';

// 获取表单元素
const regForm = document.getElementById('reg_form');
const usernameMsg = document.getElementById('username');
const emailMsg = document.getElementById('email'); // 注意：HTML 中 id 是 "eamil" (拼写错误？应为 "email")
const pwdMsg = document.getElementById('pwd');

// 监听表单提交
regForm.addEventListener('submit', async function(event) {
    event.preventDefault(); // 阻止默认提交

    // 显示加载状态 (可选)
    const submitBtn = regForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';

    // 清除之前的错误消息
    usernameMsg.textContent = '';
    emailMsg.textContent = '';
    pwdMsg.textContent = '';

    try {
        // 1. 收集表单数据
        const formData = new FormData(regForm); // 传入表单元素 regForm

        // 2. 发送 POST 请求
        const response = await fetch(back_url + '/register/', {
            method: 'POST',
            body: formData
        });

        // 3. 解析 JSON 响应
        const result = await response.json();

        // 4. 处理服务器响应
        if (result.status === 'success') {
            // 注册成功 - 调用任务3的函数来展示 check_key 并隐藏表单
            showCheckKey(result.check_key);
        } else if (result.status === 'error') {
            // 注册失败 - 根据错误类型显示消息
            switch(result.wrong) {
                case 'email':
                    emailMsg.textContent = '邮箱格式错误或发送验证邮件失败，请检查。';
                    break;
                case 'cf_key':
                    // 可以提示用户 Turnstile 验证失败
                    alert('人机验证未通过，请重试。');
                    // 通常需要重新加载 Turnstile 挑战
                    // grecaptcha.reset(); // 如果是 reCAPTCHA
                    // 对于 Turnstile, 可能需要重新初始化或刷新
                    break;
                case 'same_username':
                    usernameMsg.textContent = '用户名已存在，请更换。';
                    break;
                default:
                    // 处理其他可能的错误，如 'password', 'username' 长度/类型问题
                    // 根据你的 Python 代码，`wrong` 字段是具体出错的值
                    // 你可以根据字段名来判断，但这里简化处理
                    if (result.wrong.includes('@')) {
                        emailMsg.textContent = '邮箱格式或内容无效。';
                    } else if (result.wrong.length < 3 || result.wrong.length > 64) {
                        if (result.wrong === formData.get('username')) {
                            usernameMsg.textContent = '用户名长度需在 1-64 个字符之间。';
                        } else if (result.wrong === formData.get('password')) {
                            pwdMsg.textContent = '密码长度需在 1-64 个字符之间。';
                        }
                    } else {
                        alert(`注册失败: ${result.wrong}`);
                    }
                    break;
            }
        } else {
            // 未知状态
            alert('服务器返回了未知状态。');
        }
    } catch (error) {
        // 处理网络错误等
        console.error('注册请求失败:', error);
        alert('网络错误，请检查连接后重试。');
    } finally {
        // 恢复按钮状态
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        const successMessage = document.getElementById('success-message');
const checkKeyDisplay = document.getElementById('check-key-display');

/**
 * 显示 check_key 并隐藏注册表单
 * @param {string} checkKey - 从服务器返回的 check_key
 */
function showCheckKey(checkKey) {
    // 1. 隐藏注册表单
    regForm.style.display = 'none'; // 或者使用 regForm.classList.add('hidden');

    // 2. 显示成功信息区域
    successMessage.style.display = 'block'; // 或者使用 successMessage.classList.remove('hidden');

    // 3. 填充 check_key
    checkKeyDisplay.textContent = checkKey;

    // 4. (可选) 滚动到成功信息区域
    // successMessage.scrollIntoView({ behavior: 'smooth' });
}
    }
});
