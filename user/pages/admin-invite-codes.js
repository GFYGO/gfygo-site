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
            const d = await j('/api/v0/admin/invite-codes');
            if(!d||d.code!==200) return;
            const tb = document.getElementById('inviteTbody');
            tb.innerHTML='';
            (d.data||[]).forEach(c=>{
                const tr = document.createElement('tr');
                const limit = c.usage_type==='count' ? (c.max_uses+'次') : (c.duration_days+'天');
                tr.innerHTML = '<td>'+c.id+'</td>'
                    +'<td><code>'+esc(c.code)+'</code></td>'
                    +'<td>'+esc(c.permission_node)+'</td>'
                    +'<td>'+limit+'</td>'
                    +'<td>'+c.used_count+'</td>'
                    +'<td>'+fmtTime(c.expires_at)+'</td>'
                    +'<td>'+(c.is_active?'<span class="tag tag-green">有效</span>':'<span class="tag tag-gray">已禁用</span>')+'</td>'
                    +'<td>'+esc(c.created_by_username)+'</td>'
                    +'<td>'+(c.is_active
                        ?'<button class="btn btn-sm btn-danger" data-act="del" data-id="'+c.id+'">禁用</button>'
                        :'<button class="btn btn-sm btn-primary" data-act="enable" data-id="'+c.id+'">启用</button>'
                    )+'</td>';
                tb.appendChild(tr);
            });
            tb.querySelectorAll('button[data-id]').forEach(b=>{
                b.onclick = () => del(b.dataset.id);
            });
            tb.querySelectorAll('button[data-act="enable"]').forEach(b=>{
                b.onclick = () => enable(b.dataset.id);
            });
        }
        async function del(id){
            if(!confirm('确定禁用此邀请码？')) return;
            await j('/api/v0/admin/invite-codes/'+id,{method:'DELETE'});
            load();
        }
        async function enable(id){
            await j('/api/v0/admin/invite-codes/'+id,{
                method:'PUT',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({is_active:true})
            });
            load();
        }
        function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
        function fmtTime(s){ if(!s)return '永久'; return s.substring(0,16); }
        const form = document.getElementById('inviteForm');
        const usageSel = document.getElementById('usageType');
        const maxUses = document.getElementById('maxUses');
        const durationDays = document.getElementById('durationDays');
        usageSel.onchange = ()=>{
            if(usageSel.value==='count'){
                maxUses.disabled=false; durationDays.disabled=true; durationDays.value='';
            } else {
                maxUses.disabled=true; maxUses.value=''; durationDays.disabled=false;
            }
        };
        form.onsubmit = async e=>{
            e.preventDefault();
            const fd = new FormData(form);
            const body = {
                permission_node: fd.get('permission_node')||'',
                target_username_type: fd.get('target_username_type')||'username',
                usage_type: fd.get('usage_type')||'count',
                max_uses: parseInt(fd.get('max_uses'))||1,
                duration_days: parseInt(fd.get('duration_days'))||7,
                expires_at: fd.get('expires_at') ? new Date(fd.get('expires_at')).toISOString() : null,
            };
            if(body.usage_type==='count' && !fd.get('max_uses')){ alert('请输入次数'); return; }
            if(body.usage_type==='duration' && !fd.get('duration_days')){ alert('请输入天数'); return; }
            const d = await j('/api/v0/admin/invite-codes',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body)
            });
            if(d.code===200){
                alert('邀请码已生成: ' + d.data.code + '\n请复制保存此邀请码');
                form.reset();
                load();
            }
        };
        document.getElementById('refreshInviteBtn').onclick = load;
        load();
    })();
