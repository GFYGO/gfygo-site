//变量
console.log("start")
const fs = require('fs');
console.log("import sf")
const index_url = 'https://gwl.net.cn'
const back_url = 'https://back.gwl.net.cn'
/////////////////////////////网络交互函数///////////////////////////////////////

function get(url,information) {
    fetch('',{
    headers:information => information.json()})
        .then(response => response.json())
        .then(data => {
            console.log(data.message); // 在控制台中打印
        return data
        });
}


function post(url,information) {
    fetch('https://back.gwl.net.cn', {
        method: 'POST',
        headers: information=>information.json(),
        body: JSON.stringify(information),
    })
    .then(response => response.json())
    .then(data => {
        console.log(data.message); // 在控制台中打印添加成功的消息
        return data
    });
}


///////////////////////////////页面函数（下面）/////////////////////////////////////



///////////////////main/////////////////////////////////////////////////////////
function mian(){
    document.getElementById('txt').innerText = get(index_url+'/main.txt')
}
mian()

