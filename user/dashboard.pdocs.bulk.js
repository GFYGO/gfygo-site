/**
 * dashboard.pdocs.bulk.js
 * 个人文档「批量操作」子模块（P2-8 拆模块，2026-10-25）。
 *
 * 只在**第一次**点「批量编辑」时由 dashboard.pdocs.js 动态 `import()`；
 * 未加载时列表照常渲染，批量条与多选是纯增强（主模块用 renderBulkBarIfReady 等守卫）。
 */
import {
    PDocsState,
    pdocsRequest,
    pdocsIsValidId,
    pdocsParseId,
    pdocsSafeValue,
    resetPdocsDocsPaging,
    resetPdocsTrashPaging,
    loadPersonalDocs,
    loadPersonalTrash,
    renderExplorerGrid,
    renderPdocsTrash,
} from './dashboard.pdocs.js';

var $ = window.$;
var showToast = window.showToast;
var escapeHtml = window.escapeHtml;

// =========================================
// ⭐ C2 批量操作（2026-10-11，能力补齐 C2 / TODO.txt C4）
//   后端：POST /document/batch/trash  {action:'delete'|'restore'|'permanent', ids:[…]}
//         POST /document/batch/update {ids:[…], folder_id?, visibility?, owning?}
//   ⚠️ 语义是「**逐条判权 + 部分成功**」：越权/状态不符的条目回在 `data.results` 里
//      （`ok:false` + 中文 `reason`），**不是**整批失败 —— 200 且 `skipped>0` 是正常结果。
//   ⚠️ 上限 100 篇/次（后端 `MAX_BATCH_IDS`）；前端也先拦一次，避免白跑一趟。
//   ⚠️ **不做撤销**（决策 §8 #16：危险动作只有二次确认）。
//   ⚠️ 批量条必须在两个列表容器**之外**（容器 innerHTML 每次整体覆盖）。
// =========================================

var PDOCS_BATCH_MAX = 100;

/** 批量条的状态容器：`docs` → 文档列表；`trash` → 回收站。 */
function pdocsBulkRefs(kind) {
    if (kind === 'trash') {
        return {
            bar: $('pdocsTrashBulkBar'), count: $('pdocsTrashBulkCount'),
            selectBtn: $('pdocsTrashBulkSelectPageBtn'), set: PDocsState.trashSelection,
            items: PDocsState.currentTrash || [], total: PDocsState.trashTotal,
            batchMode: !!PDocsState.trashBatchMode,
            container: $('pdocsTrashContainer'), toggleBtn: $('pdocsTrashBatchBtn')
        };
    }
    return {
        bar: $('pdocsListBulkBar'), count: $('pdocsListBulkCount'),
        selectBtn: $('pdocsBulkSelectPageBtn'), set: PDocsState.selection,
        items: PDocsState.currentDocs || [], total: PDocsState.docsTotal,
        batchMode: !!PDocsState.batchMode,
        container: $('pdocsListContainer'), toggleBtn: $('pdocsBatchBtn')
    };
}

/** 同步批量条：可见性 + 计数文案 + 「全选本页」按钮文案。 */
function renderPdocsBulkBar(kind) {
    const ref = pdocsBulkRefs(kind);
    if (!ref.bar) return;
    const pageIds = ref.items.map(d => d.id).filter(pdocsIsValidId);
    const allPageSelected = pageIds.length > 0 && pageIds.every(id => ref.set.has(id));
    if (ref.selectBtn) ref.selectBtn.textContent = allPageSelected ? '取消全选本页' : '全选本页';
    // ⭐ 2026-10-18：批量模式下即使 0 选中也显示批量条（用户需要看到「全选本页 / 完成」入口）
    ref.bar.style.display = (ref.batchMode || ref.set.size) ? 'flex' : 'none';
    if (ref.count) {
        const loaded = ref.items.length;
        const total = (typeof ref.total === 'number' && ref.total >= loaded) ? ref.total : loaded;
        ref.count.textContent = `已选 ${ref.set.size} / 本页 ${loaded} / 共 ${total}`;
    }
}

/**
 * ⭐ 2026-10-18：进入 / 退出「批量编辑」模式。
 *
 * 进入后：列表容器加 `pdocs-batch-mode`（CSS 只显示复选框、隐藏快捷操作），
 * 条目点击不再打开文档；退出时清空选择并把批量条收起。
 */
function pdocsSetBatchMode(kind, on) {
    const ref = pdocsBulkRefs(kind);
    const next = !!on;
    if (kind === 'trash') PDocsState.trashBatchMode = next;
    else PDocsState.batchMode = next;
    ref.set.clear();
    if (ref.container) ref.container.classList.toggle('pdocs-batch-mode', next);
    if (ref.toggleBtn) {
        ref.toggleBtn.textContent = next ? '✓ 完成' : '☑️ 批量编辑';
        ref.toggleBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
        ref.toggleBtn.classList.toggle('pdocs-btn--primary', next);
    }
    // 批量条里的「完成」按钮与工具栏按钮同义（同一状态，不另建一套）
    if (kind === 'trash') renderPdocsTrash(PDocsState.currentTrash || []);
    else renderExplorerGrid();
    renderPdocsBulkBar(kind);
}

/** 勾选/取消勾选一篇（内存 Set 与批量条保持同步）。 */
function pdocsToggleSelection(kind, docId, checked) {
    if (!pdocsIsValidId(docId)) return;
    const ref = pdocsBulkRefs(kind);
    if (checked) ref.set.add(docId); else ref.set.delete(docId);
    renderPdocsBulkBar(kind);
}

/** 清空某一侧的多选（并同步批量条）。 */
function pdocsClearSelection(kind) {
    pdocsBulkRefs(kind).set.clear();
    renderPdocsBulkBar(kind);
}

/** 「全选本页」：只作用于**当前已加载的这一页**（分页下"全选"语义含糊，见设计 §4.2.4）。 */
function pdocsToggleSelectPage(kind) {
    const ref = pdocsBulkRefs(kind);
    const pageIds = ref.items.map(d => d.id).filter(pdocsIsValidId);
    const allSelected = pageIds.length > 0 && pageIds.every(id => ref.set.has(id));
    pageIds.forEach(id => { if (allSelected) ref.set.delete(id); else ref.set.add(id); });
    // 勾选态只存在于 DOM：整块重渲染（列表本来就是整体替换，不做局部手术）
    if (kind === 'trash') renderPdocsTrash(PDocsState.currentTrash || []);
    else renderExplorerGrid();
}

/** 批量条的 `ids`（去重 + 升序，便于稳定日志与断言）。 */
function pdocsBatchIds(set) {
    return Array.from(set).filter(pdocsIsValidId).sort((a, b) => a - b);
}

/** 把批量结果汇总成人话（含被跳过条目的**原文案**）。 */
function pdocsBatchSummary(data, verb) {
    const results = (data && Array.isArray(data.results)) ? data.results : [];
    const skipped = results.filter(r => !r.ok);
    const reasons = [];
    skipped.forEach(r => {
        if (r.reason && reasons.indexOf(r.reason) === -1) reasons.push(r.reason);
    });
    let msg = `${verb}：成功 ${data.succeeded} 篇`;
    if (data.unchanged) msg += `、${data.unchanged} 篇无变更`;
    if (skipped.length) msg += `、跳过 ${skipped.length} 篇（${reasons.slice(0, 2).join('；')}）`;
    return msg;
}

/** 批量结果的统一处理：失败提示 / 成功 toast / **重拉第 1 页并清空选择**。 */
async function pdocsAfterBatch(res, verb) {
    if (!res || res.code !== 200) {
        showToast((res && res.msg) || '批量操作失败', 'error');
        return false;
    }
    showToast(pdocsBatchSummary(res.data, verb),
        (res.data.skipped || res.data.unchanged) ? 'info' : 'success');
    // ⭐ 动作后：重拉第 1 页并清空选择（reset* 里已 clear，列表整体重渲染）
    resetPdocsDocsPaging();
    resetPdocsTrashPaging();
    await loadPersonalDocs();
    await loadPersonalTrash();
    return true;
}

/** 批量软删 / 恢复 / 彻底删除（`action` 由后端白名单校验）。 */
async function pdocsBulkTrash(kind, action) {
    const ref = pdocsBulkRefs(kind);
    const ids = pdocsBatchIds(ref.set);
    if (!ids.length) return;
    if (ids.length > PDOCS_BATCH_MAX) {
        showToast(`一次最多操作 ${PDOCS_BATCH_MAX} 篇，请缩小选择范围`, 'error');
        return;
    }
    if (action === 'permanent') {
        // ⭐ 危险动作二次确认：列出前 3 个标题 + 「等 N 篇」（设计 §4.2.4 第 6 条）
        const titles = ref.items.filter(d => ref.set.has(d.id)).map(d => d.title || '(无标题)');
        const shown = titles.slice(0, 3).map(t => `《${t}》`).join('、');
        const more = titles.length > 3 ? ` 等 ${titles.length} 篇` : '';
        const ok = await Modal.confirm(
            `确定要彻底删除 ${shown}${more} 吗？此操作不可恢复。`,
            { title: '彻底删除', confirmText: '彻底删除', danger: true });
        if (!ok) return;
    }
    const verb = action === 'delete' ? '已移入回收站'
        : (action === 'restore' ? '已恢复' : '已彻底删除');
    const res = await pdocsRequest('/batch/trash', {
        method: 'POST', body: JSON.stringify({ action, ids })
    });
    await pdocsAfterBatch(res, verb);
}

/** 批量改元数据（`folder_id` / `visibility` + `owning`）。 */
async function pdocsBulkUpdate(fields, verb) {
    const ids = pdocsBatchIds(PDocsState.selection);
    if (!ids.length) return;
    if (ids.length > PDOCS_BATCH_MAX) {
        showToast(`一次最多操作 ${PDOCS_BATCH_MAX} 篇，请缩小选择范围`, 'error');
        return;
    }
    const res = await pdocsRequest('/batch/update', {
        method: 'POST', body: JSON.stringify(Object.assign({ ids }, fields))
    });
    await pdocsAfterBatch(res, verb);
}

/** 「移动到…」：读批量条上的文件夹下拉（0 = 无文件夹，是**合法**目标）。 */
async function pdocsBulkMove() {
    const sel = $('pdocsBulkMoveSelect');
    if (!sel || sel.value === '') {
        showToast('请先选择目标文件夹', 'error');
        return;
    }
    const folderId = pdocsParseId(sel.value);
    if (folderId === null) {
        showToast('无法识别目标文件夹，请刷新页面后重试', 'error');
        return;
    }
    await pdocsBulkUpdate({ folder_id: folderId }, '已移动');
}

/** 「改可见性」：只提供公开/私有两种（组可见性需要组名，本页不猜）。 */
async function pdocsBulkVisibility() {
    const sel = $('pdocsBulkVisibilitySelect');
    const visibility = sel ? sel.value : '';
    if (visibility !== 'public' && visibility !== 'private') {
        showToast('请选择目标可见性', 'error');
        return;
    }
    // ⚠️ 可见性与归属必须**成对**发送：公开文档的 owning 是 '0'，私有是自己的 id；
    //    只发 visibility 会让 owning 保持旧值（超管路径下会落成"公开但挂在某人名下"）。
    const owning = (visibility === 'public') ? '0' : String(PDocsState.currentUserId);
    await pdocsBulkUpdate({ visibility, owning }, '已改可见性');
}

/** 把文件夹列表灌进批量条的下拉（每次渲染列表时同步）。 */
function renderPdocsBulkMoveOptions() {
    const sel = $('pdocsBulkMoveSelect');
    if (!sel) return;
    const current = sel.value;
    const opts = ['<option value="0">无文件夹（根目录）</option>'];
    PDocsState.folders.forEach(f => {
        opts.push(`<option value="${pdocsSafeValue(f.id)}">${escapeHtml(f.name)}</option>`);
    });
    sel.innerHTML = opts.join('');
    sel.value = current;
}

// ===== 子模块导出（主模块按需转调） =====
export {
    PDOCS_BATCH_MAX,
    pdocsBulkRefs,
    renderPdocsBulkBar,
    pdocsSetBatchMode,
    pdocsToggleSelection,
    pdocsClearSelection,
    pdocsToggleSelectPage,
    pdocsBatchIds,
    pdocsBatchSummary,
    pdocsAfterBatch,
    pdocsBulkTrash,
    pdocsBulkUpdate,
    pdocsBulkMove,
    pdocsBulkVisibility,
    renderPdocsBulkMoveOptions,
};
