//变量
console.log("start")
var notice = document.querySelector('.notice');
const index_url = 'https://gwl.net.cn'
const back_url = 'https://back.gwl.net.cn'
// /////////////////////////////////////网络交互函数/////////////////////////////////////////////////

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
        headers: information=>information.json(),
        body: JSON.stringify(information),
    })
    .then(response => response.json())
    .then(data => {
        console.log(data.message); // 在控制台中打印添加成功的消息
        return data //
    });
}


// ///////////////////////////////页面函数（下面）/////////////////////////////////////

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
// //刷新
// function f2(){
//     location.reload();
//     mian_()
// }
// ////////////////////////////main/////////////////////////////////////////////////////////
// function mian_(){

//     document.getElementById('notice_h').innerText = "wewrt5342"
//     var noticeElement = document.getElementById('notice'); // 定义noticeElement
//     noticeElement.querySelector('h3').innerText = "123"; // 更新标题内容
// noticeElement.querySelector('a').innerText = "12345"; // 更新链接文本

//     handleNotice()
// }
// mian_()

document.getElementById('reg_form').addEventListener('submit', async function(e) {
    e.preventDefault(); // 阻止默认提交

    const username = this.username.value.trim();
    const password = this.password.value;
    
    // 简单校验
    if (!username || !password) {
        document.getElementById('username').textContent = ' 请填写完整信息';
        return;
    }

    // 清除之前的错误提示
    document.getElementById('username').textContent = '';
    document.getElementById('pwd').textContent = '';

    // 准备表单数据
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    try {
        const response = await fetch('https://back.gwl.net.cn/login/', {
            method: 'POST',
            body: formData,
            credentials: 'include'  // 允许携带 Cookie（如果需要）
        });

        const result = await response.json();

        if (result.status === 'success') {
            const checkId = result.check_id;

            // ✅ 将 check_id 保存到 Cookie
            setCookie('check_id', checkId, 14); // 保存 7 天

            alert('登录成功！');
            // 可选：跳转到首页或用户中心
            window.location.href = '/'; // 或其他页面

        } else if (result.status === 'error') {
            if (result.wrong === 'wrong_username') {
                document.getElementById('username').textContent = ' 用户名不存在';
            } else if (result.wrong_times !== undefined) {
                document.getElementById('pwd').textContent = ` 密码错误，已尝试 ${result.wrong_times} 次`;
            }
        }

    } catch (error) {
        console.error('请求出错:', error);
        document.getElementById('pwd').textContent = ' 网络错误或无法连接到服务器';
    }
});

// ✅ 通用的设置 Cookie 函数
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    // 设置路径为根路径，确保整个站点都能访问
    document.cookie = `${name}=${value}; ${expires}; path=/; Secure; SameSite=Lax`;
}
