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
        headers: information=>information.json(),
        body: JSON.stringify(information),
    })
    .then(response => response.json())
    .then(data => {
        console.log(data.message); // 在控制台中打印添加成功的消息
        return data //
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

    if (data.notice == 'none') {
        closeNotice(); // 如果通知信息为 "none"，则调用关闭通知的函数
    } else {
        noticeElement.getElementsByTagName('h3')[0].getElementsByTagName('span')[0].innerText = get(back_url,{'type':'notice','notice':'h'}); // 更新标题内容
        noticeElement.getElementsByTagName('a')[0].getElementsByTagName('span')[0].innerText = get(back_url,{'type':'notice','notice':'txt'}); // 更新链接文本
    }
}


