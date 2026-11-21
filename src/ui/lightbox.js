/** 看大圖：先顯示縮圖，再換成原圖 */
import { api } from '../drive.js';
import { localFiles } from '../state.js';
import { getThumbUrl } from '../thumbs.js';
import { $, toast } from '../utils/dom.js';
import { limitDownload } from '../utils/async.js';

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
    let url;
    if (localFiles.has(m.id)) {
      url = URL.createObjectURL(localFiles.get(m.id));
    } else {
      const blob = await limitDownload(() => api('/files/' + m.id, { params: { alt: 'media' }, as: 'blob' }));
      url = URL.createObjectURL(blob);
    }
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
