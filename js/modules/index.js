/**
 * js/modules/index.js —— 前端模块（Web Components）统一入口。
 *
 * 引入方式（普通静态页）：
 *   <script type="module" src="/js/modules/index.js?v=20261101b"></script>
 *
 * 引入后可用：
 *   - <gfy-doc-preview>        文档快速查看（卡片 / 嵌入）
 *   - <gfy-doc-picker>         文档选择（卡片 / 嵌入）
 *   - <gfy-permission-editor>  权限节点编辑（卡片 / 嵌入）
 *   - window.GfyModules.{DocPreview,DocPicker,PermissionEditor}
 */
import './shared.js';
import { GfyDocPreview } from './gfy-doc-preview.js';
import { GfyDocPicker } from './gfy-doc-picker.js';
import { GfyPermissionEditor } from './gfy-permission-editor.js';

window.GfyModules = window.GfyModules || {};
window.GfyModules.DocPreview = GfyDocPreview;
window.GfyModules.DocPicker = GfyDocPicker;
window.GfyModules.PermissionEditor = GfyPermissionEditor;
window.GfyModules.version = '1.0.0';

export { GfyDocPreview, GfyDocPicker, GfyPermissionEditor };
