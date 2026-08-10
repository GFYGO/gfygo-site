/**
 * dashboard.permission.js - 权限解析器（前端版）
 * 对应后端 utils/permission.py 中的解析函数
 */

function parseScope(scopeId) {
    if (!scopeId) return { type: null, id: null };
    const sid = String(scopeId).trim().toLowerCase();
    if (sid === 'default' || sid === 'level') return { type: 'level', id: null };
    if (/^\d+$/.test(sid)) return { type: 'user', id: parseInt(sid, 10) };
    if (/^[a-z]{3}$/.test(sid)) return { type: 'group', id: sid };
    return { type: null, id: null };
}

function parseFullPermissionId(permId) {
    if (!permId) return null;
    const parts = permId.split('.');
    if (parts.length < 4) return null;

    const scopeRaw = parts[0];
    const level = parseInt(parts[1], 10);
    const category = parts[2];
    const action = parts[3];

    if (isNaN(level) || level < 1 || level > 5) return null;

    const scope = parseScope(scopeRaw);
    if (scope.type === null) return null;

    return {
        scope_type: scope.type,
        scope_id: scope.id,
        level: level,
        category: category,
        action: action,
        node_code: `${category}.${action}`
    };
}

function resolveScopeDisplay(type, id) {
    if (type === 'level') {
        const map = { 1: '普通用户', 2: '认证用户', 3: '高级用户', 4: '管理员', 5: '超级管理员' };
        return map[id] || `等级 ${id}`;
    }
    if (type === 'user') return `用户 #${id}`;
    if (type === 'group') return `组 ${id.toUpperCase()}`;
    return '未知';
}

function resolveNodeName(nodeCode) {
    const nodeMap = {
        'admin.notify.view': '查看通知', 'admin.notify.create': '创建通知',
        'admin.notify.edit': '编辑通知', 'admin.notify.delete': '删除通知',
        'admin.user.view': '查看用户', 'admin.user.edit': '编辑用户',
        'admin.user.delete': '删除用户',
        'admin.doc.view': '查看文档', 'admin.doc.delete': '删除文档',
        'admin.invite.view': '查看邀请码', 'admin.invite.create': '创建邀请码',
        'admin.invite.manage': '管理邀请码',
        'admin.system.config': '系统配置',
        'admin.permission.view': '查看权限', 'admin.permission.assign': '分配权限',
        'admin.menu.view': '查看页面', 'admin.menu.edit': '编辑页面', 'admin.menu.manage': '管理页面',
        'admin.stats.view': '查看统计',
        'doc.public.view': '查看公共文档', 'doc.public.create': '创建公共文档',
        'doc.public.edit': '编辑公共文档', 'doc.public.delete': '删除公共文档',
        'doc.private.view': '查看私有文档', 'doc.private.create': '创建私有文档',
        'doc.private.edit': '编辑私有文档', 'doc.private.delete': '删除私有文档',
    };
    return nodeMap[nodeCode] || nodeCode;
}

window.DashboardPermission = { parseScope, parseFullPermissionId, resolveScopeDisplay, resolveNodeName };