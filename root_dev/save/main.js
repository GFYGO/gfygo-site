//变量
var index_url = document.getElementById("https://rapid-cardinal-seriously.ngrok-free.app/"); // 为何要把URL作为元素的id？
var screenHeight = window.innerHeight;
/////////////////////////////网络交互函数///////////////////////////////////////

function get(type) {
    fetch('http://localhost:81', {
        headers: {
            'information': type // 将信息作为头部传递给服务器
        }
    })
    .then(response => response.json())
    .then(data => {
        console.log(data); // 在控制台中打印响应数据
        document.getElementById('get_return').innerText = data.get_return;
        // 可以在这里添加其他页面更新逻辑
    });
}


// function main() {
//     fetch('http://localhost:81/', {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/json',
//         },
//         body: JSON.stringify(),
//     })
//     .then(response => response.json())
//     .then(data => {
//         console.log(data.message); // 在控制台中打印添加成功的消息
//         // 可以在这里添加其他页面更新逻辑
//     });
// }
function post() {
    fetch('http://localhost:81/postData', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}) // 在JSON.stringify中提供需要发送的数据
    })
    .then(response => response.json())
    .then(data => {
        console.log(data.message); // 在控制台中打印成功的消息
        // 可以在这里添加其他页面更新逻辑
    });
}
///////////////////////////////页面函数（下面）/////////////////////////////////////

//notice关闭按钮
function closeNotice() {
    var notice = document.querySelector('.notice');
    notice.style.display = 'none'; // 隐藏通知
}

//////////////////////////////////////////////////页面代码//////////////////////////////////////////////////
get(notice)
notice = data.get_return;
///////////////////main/////////////////////////////////////////////////////////
function mian(){
    if (notice === 'none') {
    closeNotice(); // 如果通知信息为 "none"，则调用关闭通知的函数
    } 
    else {
    document.getElementById('get_return').innerText = notice; // 将通知信息更新到页面上
    }
}
mian()

