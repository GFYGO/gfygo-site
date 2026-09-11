(function(){
    function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
    async function loadNotifyList(){
        const el = document.getElementById('notifyList');
        if(!el) return;
        try{
            const token = (window.AuthGuard && window.AuthGuard.getToken) ? (window.AuthGuard.getToken() || '') : '';
            const headers = {};
            if(token) headers['Authorization'] = 'Bearer '+token;
            const r = await fetch((window.API_BASE_URL||'')+'/api/v0/notify/global', { headers });
            if(r.status === 401 || r.status === 422){
                if(window.AuthGuard) window.AuthGuard.handleAuthError();
                return;
            }
            const d = await r.json();
            if(!d || d.code !== 200 || !d.data || !d.data.length){
                el.innerHTML = '<p class="empty-state__text">暂无通知</p>';
                return;
            }
            el.innerHTML = d.data.map(n =>
                '<div class="notify-card">'
                +'<h4 class="notify-card__title">'+esc(n.title||'系统通知')+'</h4>'
                +'<p class="notify-card__content">'+esc(n.content||'')+'</p>'
                +'<div class="notify-card__meta">'
                +'<span>'+esc((n.created_at||'').substring(0,10))+'</span>'
                +(n.is_active ? '<span class="tag tag-green">启用</span>' : '<span class="tag tag-gray">已过期</span>')
                +'</div></div>'
            ).join('');
        }catch(e){
            el.innerHTML = '<p class="empty-state__text">加载失败</p>';
        }
    }
    loadNotifyList();
})();
