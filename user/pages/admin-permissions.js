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
        function esc(s){ const d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }

        let currentType = 'level';
        let currentScopeId = '1';
        let currentContentType = 'document';   // content tab: document / folder
        let currentContentId = null;
        let currentPicker = null;
        let originalRules = [];
        let hasChanges = false;

        // === 标签切换 ===
        document.querySelectorAll('.perm-tab').forEach(t=>{
            t.onclick = ()=>{
                document.querySelectorAll('.perm-tab').forEach(x=>x.classList.remove('active'));
                t.classList.add('active');
                currentType = t.dataset.type;
                document.getElementById('levelSelector').style.display = currentType==='level'?'':'none';
                document.getElementById('userSelector').style.display = currentType==='user'?'':'none';
                document.getElementById('groupSelector').style.display = currentType==='group'?'':'none';
                document.getElementById('contentSelector').style.display = currentType==='content'?'':'none';
                if(currentType==='level'){
                    currentScopeId = document.querySelector('.perm-level-card.active')?.dataset.level || '1';
                    loadRules();
                } else if(currentType==='user'){
                    loadUsers();
                } else if(currentType==='group'){
                    loadGroups();
                } else {
                    loadContentList();
                }
            };
        });

        // === 等级卡片选择 ===
        document.querySelectorAll('.perm-level-card').forEach(card=>{
            card.onclick = ()=>{
                document.querySelectorAll('.perm-level-card').forEach(c=>c.classList.remove('active'));
                card.classList.add('active');
                currentScopeId = card.dataset.level;
                document.getElementById('currentScopeValue').textContent = card.querySelector('.perm-level-name').textContent;
                loadRules();
            };
        });
        document.querySelector('.perm-level-card[data-level="1"]').classList.add('active');
        document.getElementById('currentScopeValue').textContent = '普通用户';

        // === 用户列表 ===
        async function loadUsers(){
            const container = document.getElementById('userListContainer');
            container.innerHTML = '加载中...';
            const d = await j('/api/v0/admin/users');
            if(!d||d.code!==200){ container.innerHTML = '加载失败'; return; }
            container.innerHTML = '';
            const list = d.data || [];
            if(!list.length){ container.innerHTML = '<div class="perm-empty-hint">暂无用户</div>'; return; }
            list.forEach((u, idx)=>{
                const item = document.createElement('div');
                item.className = 'perm-user-item';
                if(idx === 0) item.classList.add('active');
                item.innerHTML = '<span class="perm-user-name">'+esc(u.username)+'</span>' +
                    '<span class="perm-user-level">Lv'+(u.permission_level||1)+'</span>';
                item.onclick = ()=>{
                    document.querySelectorAll('.perm-user-item').forEach(i=>i.classList.remove('active'));
                    item.classList.add('active');
                    currentScopeId = String(u.id);
                    document.getElementById('currentScopeValue').textContent = u.username + ' (Lv'+(u.permission_level||1)+')';
                    loadRules();
                };
                container.appendChild(item);
            });
            if(list.length > 0){
                const firstUser = list[0];
                currentScopeId = String(firstUser.id);
                document.getElementById('currentScopeValue').textContent = firstUser.username + ' (Lv'+(firstUser.permission_level||1)+')';
                loadRules();
            }
            const searchInput = document.getElementById('userSearchInput');
            if(searchInput.dataset.bound !== 'true'){
                searchInput.dataset.bound = 'true';
                searchInput.oninput = async ()=>{
                    const q = searchInput.value.trim();
                    const d2 = await j('/api/v0/admin/users?q='+encodeURIComponent(q));
                    if(d2.code===200){
                        container.innerHTML='';
                        (d2.data||[]).forEach(u=>{
                            const item = document.createElement('div');
                            item.className = 'perm-user-item';
                            item.innerHTML = '<span class="perm-user-name">'+esc(u.username)+'</span>' +
                                '<span class="perm-user-level">Lv'+(u.permission_level||1)+'</span>';
                            item.onclick = ()=>{
                                document.querySelectorAll('.perm-user-item').forEach(i=>i.classList.remove('active'));
                                item.classList.add('active');
                                currentScopeId = String(u.id);
                                document.getElementById('currentScopeValue').textContent = u.username + ' (Lv'+(u.permission_level||1)+')';
                                loadRules();
                            };
                            container.appendChild(item);
                        });
                    }
                };
            }
        }

        // === 组列表 ===
        async function loadGroups(){
            const container = document.getElementById('groupListContainer');
            container.innerHTML = '加载中...';
            const d = await j('/api/v0/admin/groups');
            if(!d||d.code!==200){ container.innerHTML = '加载失败'; return; }
            container.innerHTML = '';
            const list = d.data || [];
            if(!list.length){ container.innerHTML = '<div class="perm-empty-hint">暂无组，请先在用户档案中创建组</div>'; return; }
            list.forEach((g, idx)=>{
                const item = document.createElement('div');
                item.className = 'perm-group-item';
                if(idx === 0) item.classList.add('active');
                item.innerHTML = '<span class="perm-group-name">'+esc(g.name||g.id)+'</span>' +
                    '<span class="perm-group-id">'+esc(g.id)+'</span>';
                item.onclick = ()=>{
                    document.querySelectorAll('.perm-group-item').forEach(i=>i.classList.remove('active'));
                    item.classList.add('active');
                    currentScopeId = String(g.id);
                    document.getElementById('currentScopeValue').textContent = g.name || g.id;
                    loadRules();
                };
                container.appendChild(item);
            });
            if(list.length > 0){
                const firstGroup = list[0];
                currentScopeId = String(firstGroup.id);
                document.getElementById('currentScopeValue').textContent = firstGroup.name || firstGroup.id;
                loadRules();
            }
        }

        // === 内容列表（文档 / 文件夹） ===
        async function loadContentList(){
            const container = document.getElementById('contentListContainer');
            container.innerHTML = '加载中...';
            const d = currentContentType === 'folder'
                ? await j('/api/v0/document/folders')
                : await j('/api/v0/admin/documents');
            if(!d||d.code!==200){ container.innerHTML = '加载失败'; return; }
            container.innerHTML = '';
            const list = d.data || [];
            if(!list.length){ container.innerHTML = '<div class="perm-empty-hint">暂无内容</div>'; return; }
            list.forEach((it, idx)=>{
                const item = document.createElement('div');
                item.className = 'perm-content-item';
                if(idx === 0) item.classList.add('active');
                const name = currentContentType === 'folder' ? (it.name||'') : (it.title||it.slug||('#'+it.id));
                item.innerHTML = '<span class="perm-content-name">'+esc(name)+'</span>' +
                    '<span class="perm-content-id">#'+esc(it.id)+'</span>';
                item.onclick = ()=>{
                    document.querySelectorAll('.perm-content-item').forEach(i=>i.classList.remove('active'));
                    item.classList.add('active');
                    currentContentId = Number(it.id);
                    document.getElementById('currentScopeValue').textContent =
                        (currentContentType==='folder'?'文件夹':'文档') + ' #' + currentContentId + ' ' + esc(name);
                    loadRules();
                };
                container.appendChild(item);
            });
            if(list.length > 0){
                const first = list[0];
                currentContentId = Number(first.id);
                document.getElementById('currentScopeValue').textContent =
                    (currentContentType==='folder'?'文件夹':'文档') + ' #' + currentContentId;
                loadRules();
            }
        }

        // === 加载规则并初始化编辑器 ===
        async function loadRules(){
            const container = document.getElementById('permPickerContainer');
            if (!container) return;
            hasChanges = false;
            updateSaveButtons();

            let url;
            if(currentType === 'content'){
                if(currentContentId == null) return;
                url = '/api/v0/admin/permission-rules?scope=content&object_type='+currentContentType+'&id='+currentContentId;
            } else {
                url = '/api/v0/admin/permission-rules?scope='+currentType+'&id='+encodeURIComponent(currentScopeId);
            }
            const d = await j(url);
            if(!d||d.code!==200){
                container.innerHTML = '<div class="perm-placeholder">加载规则失败</div>';
                return;
            }
            const rules = (d.data || []).map(r => ({
                target: r.target, level: r.level, category: r.category, action: r.action, state: r.state
            }));
            originalRules = JSON.parse(JSON.stringify(rules));

            loadPickerScript().then(()=>{
                if(!window.PermissionPicker){
                    container.innerHTML = '<div class="perm-placeholder">权限编辑器加载失败</div>';
                    return;
                }
                container.innerHTML = '';
                currentPicker = new window.PermissionPicker(container, {
                    mode: 'rules',
                    rules: rules,
                    title: '权限规则 - ' + (document.getElementById('currentScopeValue')?.textContent || '未知'),
                    onChange: (curRules) => {
                        hasChanges = true;
                        updateSaveButtons();
                        updateSummary(curRules || []);
                    }
                });
                currentPicker.load().then(()=>{
                    updateSummary(rules);
                });
            });
        }

        function updateSummary(rules){
            rules = rules || [];
            const list = document.getElementById('permSummaryList');
            const statAllow = document.getElementById('statAllow');
            const statDeny = document.getElementById('statDeny');
            const statInherit = document.getElementById('statInherit');
            const badge = document.getElementById('permSummaryBadge');
            if(!statAllow||!statDeny||!statInherit) return;

            const allowCount = rules.filter(r=>r.state==='allow').length;
            const denyCount = rules.filter(r=>r.state==='deny').length;
            statAllow.textContent = allowCount;
            statDeny.textContent = denyCount;
            statInherit.textContent = Math.max(0, rules.length - allowCount - denyCount);

            // 变更 = 与原始规则集不同的规则
            const origStr = originalRules.map(r=>[r.target,r.level,r.category,r.action,r.state].join('.')).sort();
            const curStr = rules.map(r=>[r.target,r.level,r.category,r.action,r.state].join('.')).sort();
            const changed = curStr.filter(s=>!origStr.includes(s)).concat(origStr.filter(s=>!curStr.includes(s)));
            const changedCodes = Array.from(new Set(changed));
            badge.textContent = changedCodes.length;

            if(changedCodes.length > 0){
                list.innerHTML = changedCodes.map(s => {
                    return '<div class="perm-summary-item"><code class="perm-code-inline">'+esc(s)+'</code></div>';
                }).join('');
            } else {
                list.innerHTML = '<div class="perm-summary-empty" id="permSummaryEmpty">' +
                    '<div class="perm-summary-empty-icon">📝</div>' +
                    '<div class="perm-summary-empty-text">暂无更改<br>编辑规则后此处显示变更摘要</div></div>';
            }
        }

        function updateSaveButtons(){
            const saveBtn = document.getElementById('saveAllBtn');
            const discardBtn = document.getElementById('discardBtn');
            if(saveBtn) saveBtn.disabled = !hasChanges;
            if(discardBtn) discardBtn.disabled = !hasChanges;
        }

        // === 保存 ===
        document.getElementById('saveAllBtn').onclick = async ()=>{
            if(!currentPicker) return;
            const rules = currentPicker.getRules();
            if(!rules.length && originalRules.length === 0){
                alert('没有需要保存的更改');
                return;
            }
            const body = { scope: currentType, rules: rules };
            if(currentType === 'content'){
                if(currentContentId == null){ alert('请先选择内容'); return; }
                body.object_type = currentContentType;
                body.object_id = currentContentId;
            } else {
                body.scope_id = currentScopeId;
            }
            const res = await j('/api/v0/admin/permission-rules', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify(body)
            });
            if(res.code === 200){
                alert('保存成功，共 '+res.data.saved+' 条规则');
                originalRules = JSON.parse(JSON.stringify(rules));
                hasChanges = false;
                updateSaveButtons();
                updateSummary(rules);
            } else {
                alert('保存失败: '+(res.msg||'未知错误'));
            }
        };

        // === 丢弃更改 ===
        document.getElementById('discardBtn').onclick = ()=>{
            if(!currentPicker) return;
            currentPicker.setRules(originalRules);
            hasChanges = false;
            updateSaveButtons();
            updateSummary(originalRules);
        };

        // === 内容类型切换（文档 / 文件夹） ===
        const contentTypeBtns = document.querySelectorAll('#contentSelector .perm-ctype-btn');
        contentTypeBtns.forEach(b=>{
            b.onclick = ()=>{
                contentTypeBtns.forEach(x=>x.classList.remove('active'));
                b.classList.add('active');
                currentContentType = b.dataset.type;
                currentContentId = null;
                loadContentList();
            };
        });

        // === 加载 permission-picker ===
        function loadPickerScript(){
            return new Promise((resolve)=>{
                const links = document.querySelectorAll('link[rel="stylesheet"]');
                let cssLoaded = false;
                for(let l of links){
                    if(l.href && l.href.includes('permission-picker')){ cssLoaded = true; break; }
                }
                if(!cssLoaded){
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = (window.BASE_PATH||'') + '/user/permission-picker.css';
                    document.head.appendChild(link);
                }
                if(window.PermissionPicker){ resolve(); return; }
                const s = document.createElement('script');
                s.src = (window.BASE_PATH||'') + '/user/permission-picker.js';
                s.onload = resolve;
                s.onerror = function(){
                    const s2 = document.createElement('script');
                    s2.src = '/user/permission-picker.js';
                    s2.onload = resolve;
                    s2.onerror = function(){ resolve(); };
                    document.head.appendChild(s2);
                };
                document.head.appendChild(s);
            });
        }

        // === 加载 dashboard-perms.css ===
        (function(){
            const links = document.querySelectorAll('link[rel="stylesheet"]');
            let loaded = false;
            for(let l of links){
                if(l.href && l.href.includes('dashboard-perms')){ loaded = true; break; }
            }
            if(!loaded){
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = (window.BASE_PATH||'') + '/user/dashboard-perms.css';
                document.head.appendChild(link);
            }
        })();

        // 初始化
        loadRules();
    })();
