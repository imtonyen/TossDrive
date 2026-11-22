/** 縮圖：下載、本機快取（object URL）、釋放 */
import { MULTIPART_MAX, IMG_BOX_W, IMG_BOX_MAX_H } from './constants.js';
import { api } from './drive.js';
import { thumbPromises } from './state.js';
import { limitDownload } from './utils/async.js';
import { fitImageUrl, devicePixels } from './utils/image.js';

/** 取得縮圖的本機 URL（有快取、有同時下載數量限制） */
export function getThumbUrl(m) {
  const key = m.thumbId || 'o:' + m.id;
  if (thumbPromises.has(key)) return thumbPromises.get(key);
  const p = limitDownload(async () => {
    let blob = null;
    if (m.thumbId) {
      try { blob = await api('/files/' + m.thumbId, { params: { alt: 'media' }, as: 'blob' }); }
      catch (e) { if (e.status !== 404) throw e; }
    }
    // 沒有縮圖（例如手動丟進資料夾的圖片）→ 檔案不大就下載原圖
    if (!blob) {
      if (m.size > MULTIPART_MAX) throw new Error('沒有縮圖');
      blob = await api('/files/' + m.id, { params: { alt: 'media' }, as: 'blob' });
    }
    // 依這台裝置的圖片框大小 × 螢幕密度縮成剛好的尺寸（已經夠小就原樣使用）
    return fitImageUrl(blob, devicePixels(IMG_BOX_W), devicePixels(IMG_BOX_MAX_H));
  });
  p.catch(() => thumbPromises.delete(key));
  thumbPromises.set(key, p);
  return p;
}

/** 上傳完成後直接用本機剛產生的縮圖顯示，不用重新下載 */
export function setLocalThumb(thumbId, url) {
  thumbPromises.set(thumbId, Promise.resolve(url));
}

export function releaseThumb(thumbId) {
  const p = thumbPromises.get(thumbId);
  if (!p) return;
  p.then((u) => URL.revokeObjectURL(u), () => {});
  thumbPromises.delete(thumbId);
}

export function releaseAllThumbs() {
  for (const p of thumbPromises.values()) p.then((u) => URL.revokeObjectURL(u), () => {});
  thumbPromises.clear();
}
