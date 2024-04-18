//变量
console.log("start")
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
    document.getElementById('txt') = main.txt
}


///////////////////main/////////////////////////////////////////////////////////
function mian(){
    
}
mian()

