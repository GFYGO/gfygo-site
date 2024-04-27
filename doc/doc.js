//变量
console.log("start")
const fs = require('fs');
console.log("import sf")
const index_url = 'https://gwl.net.cn'
/////////////////////////////网络交互函数///////////////////////////////////////

function get(information) {
    fetch('',{
    headers:information => information.json()})
        .then(response => response.json())
        .then(data => {
            console.log(data.message); // 在控制台中打印
        return data
        });
}


function post(information) {
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
function getTXT(dir){
    var txt = fs.readFileSync(dir,'utf-8');
    console.log('read mian.txt')
    return txt
}


///////////////////main/////////////////////////////////////////////////////////
function mian(){
    document.getElementById('txt').innerText = getTXT('main.txt')
}
mian()

