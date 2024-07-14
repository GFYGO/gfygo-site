<<<<<<< Updated upstream
document.getElementById("https://rapid-cardinal-seriously.ngrok-free.app/") = index_url
var screenHeight = window.innerHeight;
get()

function get() {
    fetch('http://localhost:81')
        .then(response => response.json())
        .then(data => {
            console.log(); // 在控制台中打印
            // 可以在这里添加其他页面更新逻辑
        });
}


function main() {
    fetch('http://localhost:81/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(),
    })
    .then(response => response.json())
    .then(data => {
        console.log(data.message); // 在控制台中打印添加成功的消息
        // 可以在这里添加其他页面更新逻辑
    });
}
=======
//变量
console.log("start")
var notice = document.querySelector('.notice');
const index_url = 'https://gwl.net.cn'
const back_url = 'https://back.gwl.net.cn'
const api_url = 'https://api.gwl.net.cn'
/////////////////////////////////////网络交互函数/////////////////////////////////////////////////

function get(url,head) {
    fetch(url,{})
    .then(response => response.json())
    .then(data => {
        console.log('get',data,'from',url);
        return data
    })
    .catch(error => {
        console.error('请求出错：', error);
    });
}

function post(url,head) {
    fetch('http://localhost:5000/api/data', {
    method: 'POST', // 请求方法
    headers: {
        'Content-Type': 'application/json', // 请求头，指明发送的数据类型
    },
    body: JSON.stringify({ key: 'value' }) // 请求体，发送的数据
})
.then(response => response.json()) // 解析响应为JSON
.then(data => {
    console.log('成功:', data); // 处理响应数据
})
.catch(error => {
    console.error('错误:', error); // 处理错误
});
}


///////////////////////////////页面函数（下面）/////////////////////////////////////

//notice关闭按钮
function closeNotice() {
    document.getElementById('notice').style.display = 'none'; // 隐藏
}
//获取notice
function handleNotice() {
    let data = get(back_url,{'type':'notice'})
    var noticeElement = document.getElementById('notice');

    if (data.notice == 'none' )or(data.notice == Node) ;{
        closeNotice(); // 如果通知信息为 "none"，则调用关闭通知的函数
        } else {
        noticeElement.getElementsByTagName('h3')[0].getElementsByTagName('span')[0].innerText = get(back_url,{'type':'notice','notice':'h'}); // 更新标题内容
        noticeElement.getElementsByTagName('a')[0].getElementsByTagName('span')[0].innerText = get(back_url,{'type':'notice','notice':'txt'}); // 更新链接文本
    }
}
//刷新
function f2(){
    location.reload();
    mian_()
}
////////////////////////////main/////////////////////////////////////////////////////////
function mian_(){

    document.getElementById('notice_h').innerText = "wewrt5342"
    var noticeElement = document.getElementById('notice'); // 定义noticeElement
    noticeElement.querySelector('h3').innerText = "123"; // 更新标题内容
noticeElement.querySelector('a').innerText = "12345"; // 更新链接文本

    handleNotice()
}
mian_()

>>>>>>> Stashed changes
