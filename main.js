//变量
console.log("start")
var notice = document.querySelector('.notice');
const index_url = 'https://gwl.net.cn'
const back_url = 'https://back.gwl.net.cn'
const api_url = 'https://api.gwl.net.cn'
/////////////////////////////////////网络交互函数/////////////////////////////////////////////////
//GET
async function get(url,head) {
    console.log('GET',data,'to',url);
    fetch(url,{
        method:'GET',
        headers:head
    })
    .then(response => response.json())
    .then(data => {
        console.log('success:', data); // 处理响应数据
        return data;
    })
    .catch(error => {
        console.error('ERROR', error);
        return Node;
    });
}

//POST
async function post(url,head,body) {
    console.log('POST',head,'to',url);
    fetch(url, {
        method: 'POST', // 请求方法
        headers: JSON.stringify(head),
        body: JSON.stringify(body) // 请求体，发送的数据
    })
    .then(response => response.json()) // 解析响应为JSON
    .then(data => {
        console.log('success:', data); // 处理响应数据
        return data;
    })
    .catch(error => {
        console.error('ERROE:', error); // 处理错误
        return Node;
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

    if (data.notice == 'none' || data.notice == Node) {
        closeNotice(); // 如果通知信息为 "none"，则调用关闭通知的函数
    } else {
        noticeElement.getElementsByTagName('h3')[0].getElementsByTagName('span')[0].innerText = get(back_url, {'type': 'notice', 'notice': 'h'}); // 更新标题内容
        noticeElement.getElementsByTagName('a')[0].getElementsByTagName('span')[0].innerText = get(back_url, {'type': 'notice', 'notice': 'txt'}); // 更新链接文本
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

