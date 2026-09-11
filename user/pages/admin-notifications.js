(function(){
        const API = window.API_BASE_URL || '';
        function token(){ return (window.AuthGuard && window.AuthGuard.getToken) ? (window.AuthGuard.getToken() || '') : ''; }
        function j(url, opts){
            opts = opts||{};
            opts.headers = opts.headers||{};
            const t = token();
            if(t) opts.headers['Authorization']='Bearer '+t;
            if(!opts.headers['X-Permission-Context']) {
                opts.headers['X-Permission-Context'] = 'admin';
            }
            return fetch(API+url, opts)
                .then(r => {
                    if(r.status === 401 || r.status === 422){
                        if(window.AuthGuard) window.AuthGuard.handleAuthError();
                        return {code: 401};
                    }
                    return r.json();
                })
                .catch(()=>({code:500}));
        }
        async function load(){
            const d = await j('/api/v0/admin/notifications');
            if(!d||d.code!==200) return;
            const tb = document.getElementById('notifyTbody');
            if(!tb) return;
            tb.innerHTML='';
            (d.data||[]).forEach(n=>{
                const tr = document.createElement('tr');
                tr.innerHTML = '<td>'+n.id+'</td>'
                    +'<td>'+esc(n.title)+'</td>'
                    +'<td>'+esc(n.content).substring(0,40)+'</td>'
                    +'<td>'+esc(Array.isArray(n.visible_permission) ? n.visible_permission.map(l=>l===0?'Guest':'Lv'+l).join(',') : n.visible_permission)+'</td>'
                    +'<td>'+fmtTime(n.start_time)+' ~ '+fmtTime(n.end_time)+'</td>'
                    +'<td>'+(n.is_active?'<span class="tag tag-green">启用</span>':'<span class="tag tag-gray">禁用</span>')+'</td>'
                    +'<td>'
                        +'<button class="btn btn-sm" data-act="edit" data-id="'+n.id+'">编辑</button> '
                        +'<button class="btn btn-sm btn-danger" data-act="del" data-id="'+n.id+'">删除</button>'
                    +'</td>';
                tb.appendChild(tr);
            });
            tb.querySelectorAll('button[data-act]').forEach(b=>{
                b.onclick = () => b.dataset.act==='del' ? del(b.dataset.id) : edit(b.dataset.id);
            });
        }
        async function del(id){
            if(!confirm('确定删除此通知？')) return;
            await j('/api/v0/admin/notifications/'+id,{method:'DELETE'});
            load();
        }
        async function edit(id){
            const title = prompt('标题:');
            if(title===null) return;
            const content = prompt('内容:');
            if(content===null) return;
            await j('/api/v0/admin/notifications/'+id,{
                method:'PUT',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({title,content})
            });
            load();
        }
        function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
        function fmtTime(s){ if(!s)return '-'; return s.substring(5,16); }
        // form
        const form = document.getElementById('notifyForm');
        form.onsubmit = async e=>{
            e.preventDefault();
            const fd = new FormData(form);
            const perms = [];
            form.querySelectorAll('input[name="perm"]:checked').forEach(c=>perms.push(parseInt(c.value)));
            const vpnStr = (fd.get('visible_permission_nodes') || '').trim();
            const vpnList = vpnStr ? vpnStr.split(',').map(s => s.trim()).filter(Boolean) : [];
            const body = {
                title: fd.get('title')||'系统通知',
                content: fd.get('content'),
                visible_permission: perms,
                visible_permission_nodes: vpnList,
                start_time: fd.get('start_time') ? new Date(fd.get('start_time')).toISOString() : null,
                end_time: fd.get('end_time') ? new Date(fd.get('end_time')).toISOString() : null,
            };
            if(!body.content){ alert('请输入通知内容'); return; }
            await j('/api/v0/admin/notifications',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body)
            });
            form.reset();
            load();
        };
        document.getElementById('resetBtn').onclick = ()=>form.reset();
        document.getElementById('refreshNotifyBtn').onclick = load;
        load();
    })();
