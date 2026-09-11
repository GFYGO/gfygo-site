(function(){
        const API = window.API_BASE_URL || '';
        function token(){ return (window.AuthGuard && window.AuthGuard.getToken) ? (window.AuthGuard.getToken() || '') : ''; }
        function j(url, opts){
            opts = opts||{};
            opts.headers = opts.headers||{};
            const t = token();
            if(t) opts.headers['Authorization']='Bearer '+t;
            // 所有 admin 页面请求必须携带 admin 上下文头
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
        function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

        // ========== 状态管理 ==========
        let _items = [];          // 当前页面数据
        let _edits = {};          // 未保存修改 { id: {field: value} }
        let _hasChanges = false;

        function getRowData(id){
            const item = _items.find(i => i.id === id);
            if(!item) return null;
            const edit = _edits[id] || {};
            const merged = Object.assign({}, item, edit);
            return merged;
        }

        function setEdit(id, field, value){
            if(!_edits[id]) _edits[id] = {};
            const item = _items.find(i => i.id === id);
            if(!item) return;
            if(item[field] === value){
                delete _edits[id][field];
                if(Object.keys(_edits[id]).length === 0) delete _edits[id];
            } else {
                _edits[id][field] = value;
            }
            _hasChanges = Object.keys(_edits).length > 0;
            updateBulkBar();
        }

        function isFieldChanged(id, field){
            return _edits[id] && _edits[id][field] !== undefined;
        }

        function updateBulkBar(){
            const bar = document.getElementById('menuBulkBar');
            if(_hasChanges){
                bar.style.display = 'flex';
                document.querySelectorAll('#menuTbody tr').forEach(tr => {
                    const id = parseInt(tr.dataset.id);
                    if(_edits[id]) tr.classList.add('row-changed');
                    else tr.classList.remove('row-changed');
                });
            } else {
                bar.style.display = 'none';
                document.querySelectorAll('#menuTbody tr').forEach(tr => tr.classList.remove('row-changed'));
            }
        }

        // ========== 权限选择器 ==========
        function loadPermPickerCSS(){
            const links = document.querySelectorAll('link[rel="stylesheet"]');
            for(let l of links){
                if(l.href && l.href.includes('permission-picker')) return;
            }
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = (window.BASE_PATH||'.') + '/user/permission-picker.css';
            document.head.appendChild(link);
        }
        loadPermPickerCSS();

        function loadPermPickerJS(){
            return new Promise((resolve)=>{
                if(window.PermissionPicker){ resolve(); return; }
                const s = document.createElement('script');
                s.src = (window.BASE_PATH||'.') + '/user/permission-picker.js';
                s.onload = resolve;
                s.onerror = function(){
                    console.warn('[permission-picker] 加载失败，使用prompt降级');
                    resolve();
                };
                document.head.appendChild(s);
            });
        }

        let _currentPermCallback = null;

        function openPermPicker(currentNode, onSave){
            const modal = document.getElementById('permPickerModal');
            modal.style.display = 'flex';
            _currentPermCallback = onSave;

            loadPermPickerJS().then(()=>{
                if(!window.PermissionPicker){
                    const node = prompt('权限节点（如 admin.stats.view）:', currentNode||'');
                    if(node !== null && onSave) onSave(node.trim());
                    modal.style.display = 'none';
                    return;
                }
                const container = document.getElementById('permPickerContainer');
                const initState = {};
                if(currentNode) initState[currentNode] = 'allow';
                const picker = new window.PermissionPicker(container, {
                    value: initState,
                    showLevelSelector: false,
                    showSearch: true,
                    allowSingleSelect: true,
                    showBulkOps: false,
                    title: '选择权限节点',
                    onChange: function(){}
                });
                picker.load().then(()=>{
                    window._currentPicker = picker;
                });
            });
        }

        function closePermPicker(){
            document.getElementById('permPickerModal').style.display = 'none';
            window._currentPicker = null;
            _currentPermCallback = null;
        }

        document.getElementById('closePermPicker').onclick = closePermPicker;
        document.getElementById('cancelPermPicker').onclick = closePermPicker;
        document.getElementById('clearPermPicker').onclick = ()=>{
            if(_currentPermCallback) _currentPermCallback('');
            closePermPicker();
        };
        document.getElementById('savePermPicker').onclick = ()=>{
            const picker = window._currentPicker;
            const state = picker ? picker.getValue() : {};
            const nodes = Object.keys(state);
            const nodeStr = nodes.length > 0 ? nodes[0] : '';
            if(_currentPermCallback) _currentPermCallback(nodeStr);
            closePermPicker();
        };

        document.getElementById('pickPermNodeBtn').onclick = ()=>{
            openPermPicker(document.getElementById('newPermNode').value, (node)=>{
                document.getElementById('newPermNode').value = node || '';
            });
        };

        // ========== 页面渲染 ==========
        async function load(){
            const d = await j('/api/v0/admin/menu-items');
            if(!d||d.code!==200){
                document.getElementById('menuEmpty').style.display='block';
                document.getElementById('menuEmpty').querySelector('.empty-state__text').textContent = '加载页面数据失败';
                return;
            }
            _items = d.data || [];
            _edits = {};
            _hasChanges = false;
            updateBulkBar();
            renderTable();
        }

        function renderTable(){
            const tb = document.getElementById('menuTbody');
            const empty = document.getElementById('menuEmpty');
            const keyword = (document.getElementById('menuSearchInput').value || '').trim().toLowerCase();
            const list = _items.filter(it => {
                if(!keyword) return true;
                const node = it.permission_node || '';
                return (it.label && it.label.toLowerCase().includes(keyword)) ||
                       (it.tab_key && it.tab_key.toLowerCase().includes(keyword)) ||
                       (node && node.toLowerCase().includes(keyword));
            });

            tb.innerHTML = '';
            if(list.length === 0){
                empty.style.display = 'block';
                empty.querySelector('.empty-state__text').textContent = keyword ? '没有匹配的页面' : '暂无页面数据';
                return;
            }
            empty.style.display = 'none';

            list.forEach(it => {
                const row = getRowData(it.id);
                const tr = document.createElement('tr');
                tr.dataset.id = it.id;
                if(_edits[it.id]) tr.classList.add('row-changed');

                const labelChanged = isFieldChanged(it.id, 'label');
                const iconChanged = isFieldChanged(it.id, 'icon');
                const keyChanged = isFieldChanged(it.id, 'tab_key');
                const levelChanged = isFieldChanged(it.id, 'required_permission');
                const nodeChanged = isFieldChanged(it.id, 'permission_node');
                const sortChanged = isFieldChanged(it.id, 'sort_order');
                const adminChanged = isFieldChanged(it.id, 'is_admin');
                const activeChanged = isFieldChanged(it.id, 'is_active');

                tr.innerHTML =
                    '<td class="cell-id">'+it.id+'</td>' +
                    '<td>' +
                        '<input type="text" class="cell-input'+(iconChanged?' cell-changed':'')+'" data-f="icon" data-id="'+it.id+'" value="'+esc(row.icon||'📄')+'" style="width:42px;text-align:center" title="emoji图标">' +
                    '</td>' +
                    '<td>' +
                        '<input type="text" class="cell-input'+(labelChanged?' cell-changed':'')+'" data-f="label" data-id="'+it.id+'" value="'+esc(row.label)+'" style="width:120px">' +
                    '</td>' +
                    '<td>' +
                        '<input type="text" class="cell-input cell-code'+(keyChanged?' cell-changed':'')+'" data-f="tab_key" data-id="'+it.id+'" value="'+esc(row.tab_key)+'" style="width:130px">' +
                    '</td>' +
                    '<td>' +
                        '<select class="cell-select'+(levelChanged?' cell-changed':'')+'" data-f="required_permission" data-id="'+it.id+'">' +
                            [1,2,3,4,5].map(l => '<option value="'+l+'"'+(l===row.required_permission?' selected':'')+'>Lv'+l+'</option>').join('') +
                        '</select>' +
                    '</td>' +
                    '<td>' +
                        '<button class="cell-perm-btn'+(nodeChanged?' cell-changed':'')+'" data-act="edit-perm" data-id="'+it.id+'" data-node="'+esc(row.permission_node||'')+'">' +
                            (row.permission_node ? '<code>'+esc(row.permission_node)+'</code>' : '<span class="muted">点击选择</span>') +
                        '</button>' +
                    '</td>' +
                    '<td>' +
                        '<input type="number" class="cell-input'+(sortChanged?' cell-changed':'')+'" data-f="sort_order" data-id="'+it.id+'" value="'+(row.sort_order||0)+'" style="width:60px">' +
                    '</td>' +
                    '<td>' +
                        '<label class="switch"><input type="checkbox"'+(adminChanged?' class-changed':'')+' class="cell-check" data-f="is_admin" data-id="'+it.id+'"'+(row.is_admin?' checked':'')+'><span class="slider"></span></label>' +
                    '</td>' +
                    '<td>' +
                        '<label class="switch"><input type="checkbox"'+(activeChanged?' class-changed':'')+' class="cell-check" data-f="is_active" data-id="'+it.id+'"'+(row.is_active?' checked':'')+'><span class="slider"></span></label>' +
                    '</td>' +
                    '<td>' +
                        '<button class="btn btn-xs btn-danger" data-act="del" data-id="'+it.id+'">🗑</button>' +
                    '</td>';
                tb.appendChild(tr);
            });

            bindTableEvents();
        }

        function bindTableEvents(){
            // 文本/数字输入框 - 失焦保存
            document.querySelectorAll('#menuTbody input.cell-input').forEach(el => {
                el.oninput = () => {
                    setEdit(parseInt(el.dataset.id), el.dataset.f, el.value);
                };
            });
            // 下拉选择
            document.querySelectorAll('#menuTbody select.cell-select').forEach(el => {
                el.onchange = () => {
                    setEdit(parseInt(el.dataset.id), el.dataset.f, parseInt(el.value));
                };
            });
            // 复选框
            document.querySelectorAll('#menuTbody input.cell-check').forEach(el => {
                el.onchange = () => {
                    setEdit(parseInt(el.dataset.id), el.dataset.f, el.checked);
                };
            });
            // 操作按钮
            document.querySelectorAll('#menuTbody button[data-act]').forEach(b => {
                if(b.dataset.act === 'del'){
                    b.onclick = () => del(b.dataset.id);
                } else if(b.dataset.act === 'edit-perm'){
                    b.onclick = () => editPerm(b.dataset.id, b.dataset.node);
                }
            });
        }

        // ========== 操作函数 ==========
        async function del(id){
            if(!confirm('确定删除此页面？此操作不可恢复')) return;
            const d = await j('/api/v0/admin/menu-items/'+id, {method:'DELETE'});
            if(d && d.code === 200){
                if(_edits[id]) delete _edits[id];
                load();
            } else if(d && d.msg){
                alert(d.msg);
            }
        }

        function editPerm(id, currentNode){
            openPermPicker(currentNode, (node) => {
                setEdit(parseInt(id), 'permission_node', node || null);
                renderTable();
            });
        }

        async function saveAll(){
            if(!_hasChanges) return;
            const ids = Object.keys(_edits);
            let ok = 0, fail = 0;
            for(const idStr of ids){
                const id = parseInt(idStr);
                const itemEdits = _edits[id];
                const body = {};
                for(const f in itemEdits) body[f] = itemEdits[f];
                const d = await j('/api/v0/admin/menu-items/'+id, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });
                if(d && d.code === 200){
                    ok++;
                } else {
                    fail++;
                }
            }
            if(fail === 0){
                alert('✓ 保存成功，共更新 '+ok+' 项');
                load();
            } else {
                alert('⚠ 部分保存失败：成功 '+ok+' 项，失败 '+fail+' 项');
                load();
            }
        }

        function discardAll(){
            if(!_hasChanges) return;
            _edits = {};
            _hasChanges = false;
            updateBulkBar();
            renderTable();
        }

        // ========== 事件绑定 ==========
        document.getElementById('menuSearchInput').oninput = () => renderTable();
        document.getElementById('saveBulkBtn').onclick = saveAll;
        document.getElementById('discardBulkBtn').onclick = discardAll;

        document.getElementById('refreshPagesBtn').onclick = async () => {
            const d = await j('/api/v0/user/pages/refresh', {method:'POST'});
            if(d.code === 200){
                alert('🔍 扫描完成：新增 '+d.data.added+' 个页面，更新 '+d.data.updated+' 个页面');
                load();
            } else {
                alert(d.msg || '刷新失败');
            }
        };

        document.getElementById('addPageBtn').onclick = () => {
            document.getElementById('addPageForm').style.display = 'flex';
        };
        document.getElementById('cancelNewPage').onclick = () => {
            document.getElementById('addPageForm').style.display = 'none';
        };
        document.getElementById('submitNewPage').onclick = async () => {
            const tabKey = document.getElementById('newTabKey').value.trim();
            const label = document.getElementById('newLabel').value.trim();
            if(!tabKey || !label){ alert('Tab Key 和显示名必填'); return; }
            const permNode = document.getElementById('newPermNode').value.trim();
            const d = await j('/api/v0/admin/menu-items', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    tab_key: tabKey,
                    label: label,
                    icon: document.getElementById('newIcon').value || '📄',
                    required_permission: parseInt(document.getElementById('newPermLevel').value),
                    permission_node: permNode || null,
                    sort_order: parseInt(document.getElementById('newSort').value),
                    is_admin: document.getElementById('newIsAdmin').checked,
                    html_content: document.getElementById('newHtml').value,
                })
            });
            if(d && d.code === 200){
                document.getElementById('addPageForm').style.display = 'none';
                load();
            } else {
                alert((d && d.msg) || '创建失败');
            }
        };

        load();
    })();
