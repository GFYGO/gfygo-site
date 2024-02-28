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
