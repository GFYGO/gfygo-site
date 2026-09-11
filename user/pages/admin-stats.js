(function(){
        async function loadStats(){
            const d = await fetchJSON('/api/v0/user/stats');
            if(!d || d.code !== 200) return;
            const s = d.data;
            setText('stat-user-count', s.user_count);
            setText('stat-doc-count', s.doc_count);
            setText('stat-view-count', s.view_count);
            setText('stat-today-users', s.today_active);
            drawCharts(s);
        }
        function setText(id, v){
            const el = document.getElementById(id);
            if(el) el.textContent = v ?? '--';
        }
        function drawCharts(s){
            // 后端字段缺失/形状变化时不要让整个 Tab 崩掉（历史上这里直接 .map 会抛异常，
            // 导致仪表盘图形区整块不渲染）
            const regs = Array.isArray(s.daily_registrations) ? s.daily_registrations : [];
            const docs = Array.isArray(s.daily_documents) ? s.daily_documents : [];
            const levels = Array.isArray(s.level_distribution) ? s.level_distribution : [];
            const regData = {
                labels: regs.map(d=>d.date),
                vals: regs.map(d=>d.count)
            };
            const docData = {
                labels: docs.map(d=>d.date),
                vals: docs.map(d=>d.count)
            };
            drawBar('chart-registrations', regData, '#2ea043');
            drawBar('chart-documents', docData, '#2563eb');
            const levelColors = ['#9ca3af','#60a5fa','#34d399','#fbbf24','#ef4444'];
            drawPie('chart-levels', levels.map((d,i)=>({
                label:'Lv'+d.level, value:d.count, color:levelColors[i]||'#6b7280'
            })));
        }
        function drawBar(id, data, color){
            const c = document.getElementById(id);
            if(!c || !data || !data.vals || data.vals.length === 0) return;
            const ctx = c.getContext('2d');
            const w = c.width, h = c.height;
            ctx.clearRect(0,0,w,h);
            const pad = 30;
            const cw = w - pad*2, ch = h - pad*2;
            const max = Math.max(...data.vals, 1);
            const bw = cw / data.vals.length * 0.7;
            const gap = cw / data.vals.length * 0.3;
            data.vals.forEach((v,i) => {
                const x = pad + i*(bw+gap) + gap/2;
                const bh = (v/max)*ch;
                const y = pad + ch - bh;
                ctx.fillStyle = color;
                ctx.fillRect(x, y, bw, bh);
                ctx.fillStyle = '#6b7280';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(data.labels[i], x+bw/2, h-8);
            });
        }
        function drawPie(id, items){
            const c = document.getElementById(id);
            if(!c) return;
            const ctx = c.getContext('2d');
            const w = c.width, h = c.height;
            ctx.clearRect(0,0,w,h);
            const cx = w/2, cy = h/2;
            const r = Math.min(w,h)/2 - 20;
            const total = items.reduce((a,b)=>a+b.value,0);
            let start = -Math.PI/2;
            items.forEach(it => {
                const angle = (it.value/total)*Math.PI*2;
                ctx.beginPath();
                ctx.moveTo(cx,cy);
                ctx.arc(cx,cy,r,start,start+angle);
                ctx.closePath();
                ctx.fillStyle = it.color;
                ctx.fill();
                start += angle;
            });
            // legend
            let ly = 10;
            items.forEach(it => {
                ctx.fillStyle = it.color;
                ctx.fillRect(w-80, ly, 10, 10);
                ctx.fillStyle = '#374151';
                ctx.font = '11px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(it.label+'('+it.value+'%)', w-65, ly+9);
                ly += 16;
            });
        }
        function fetchJSON(url){
            const token = (window.AuthGuard && window.AuthGuard.getToken) ? (window.AuthGuard.getToken() || '') : '';
            const headers = {};
            if(token) headers['Authorization'] = 'Bearer '+token;
            headers['X-Permission-Context'] = 'admin';
            return fetch((window.API_BASE_URL||'')+url, { headers })
                .then(r => {
                    if(r.status === 401 || r.status === 422){
                        if(window.AuthGuard) window.AuthGuard.handleAuthError();
                        return {code: 401};
                    }
                    return r.json();
                })
                .catch(()=>({code:500}));
        }
        loadStats();
    })();
