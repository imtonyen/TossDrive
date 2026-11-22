/** 看大圖：先顯示縮圖，再換成依螢幕大小縮好的原圖 */
import { api } from '../drive.js';
import { localFiles } from '../state.js';
import { getThumbUrl } from '../thumbs.js';
import { $, toast } from '../utils/dom.js';
import { limitDownload } from '../utils/async.js';
import { fitImageUrl, devicePixels } from '../utils/image.js';

let current = null;       // 目前正在看的訊息
let fullUrl = '';         // 原圖的 object URL（關閉時釋放）

export const getLightboxMessage = () => current;

export async function openLightbox(m) {
  current = m;
  const img = $('lightbox-img');
  $('lightbox-name').textContent = m.name;
  img.removeAttribute('src');
  $('lightbox').hidden = false;

  // 先顯示縮圖，再換成原圖
  getThumbUrl(m).then((url) => { if (current === m && !fullUrl) img.src = url; }).catch(() => {});
  try {
    const blob = localFiles.has(m.id)
      ? localFiles.get(m.id)
      : await limitDownload(() => api('/files/' + m.id, { params: { alt: 'media' }, as: 'blob' }));
    if (current !== m) return;
    // 不直接顯示原圖：依螢幕大小縮成剛好夠用的尺寸，手機上才不會鋸齒失真（下載仍是原圖）
    const url = await fitImageUrl(blob, devicePixels(window.innerWidth), devicePixels(window.innerHeight - 64));
    if (current !== m) { URL.revokeObjectURL(url); return; }
    fullUrl = url;
    img.src = url;
  } catch (e) {
    if (current === m) toast('原圖載入失敗：' + e.message);
  }
}

export function closeLightbox() {
  $('lightbox').hidden = true;
  $('lightbox-img').removeAttribute('src');
  if (fullUrl) URL.revokeObjectURL(fullUrl);
  fullUrl = '';
  current = null;
}
