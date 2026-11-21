/** 訊息資料：Drive 檔案轉成訊息物件、新增或更新、移除、清空 */
import { state, messages, uploads, textCache, textLoading, localFiles, gate } from './state.js';
import { releaseThumb, releaseAllThumbs } from './thumbs.js';

/** Drive 檔案 → 訊息物件 */
export function fileToMessage(f) {
  const p = f.appProperties || {};
  const mime = f.mimeType || '';
  // 不是 TossDrive 建立的檔案（用完整 drive 權限手動丟進資料夾的）也能顯示
  const type = p.td_type || (mime.startsWith('image/') ? 'image' : 'file');
  const inline = p.td_inline === '1';
  return {
    id: f.id,
    type,
    name: f.name || '',
    mime,
    size: Number(f.size || 0),
    time: Date.parse(f.createdTime) || Date.now(),
    devid: p.td_devid || '',
    devtype: p.td_dev || '',
    devname: p.td_devname || '',
    text: type === 'text' && inline ? (f.description || '') : undefined,
    thumbId: p.td_thumb || '',
    w: Number(p.td_w) || 0,
    h: Number(p.td_h) || 0,
    link: f.webContentLink || '',
  };
}

/** 文字內容：短文字在訊息裡，長文字要等另外下載（見 ui/render.js 的 ensureText） */
export const getText = (m) => (m.text !== undefined ? m.text : textCache.get(m.id));

export function upsertMessage(m) {
  messages.set(m.id, m);
}

export function removeMessage(id) {
  const m = messages.get(id);
  if (!m) return false;
  messages.delete(id);
  localFiles.delete(id);
  textCache.delete(id);
  if (m.thumbId) releaseThumb(m.thumbId);
  return true;
}

/** 登出時清空所有資料（畫面上的元素由 ui/render.js 的 resetView 清） */
export function resetData() {
  releaseAllThumbs();
  messages.clear();
  uploads.length = 0;
  textCache.clear();
  textLoading.clear();
  localFiles.clear();
  state.rootId = state.thumbsId = '';
  state.sheets = [];
  state.nextPageToken = null;
  state.booted = false;
  gate.reset();
}
