/** 看大圖：先顯示縮圖，再換成依螢幕大小縮好的原圖 */
import { api } from '../drive.js';
import { localFiles } from '../state.js';
import { getThumbUrl } from '../thumbs.js';
import { $, toast } from '../utils/dom.js';
import { limitDownload } from '../utils/async.js';
import { fitImageUrl, devicePixels } from '../utils/image.js';
import { progressRing } from './progress-ring.js';

let current = null;       // 目前正在看的訊息
let fullUrl = '';         // 原圖的 object URL（關閉時釋放）

export const getLightboxMessage = () => current;

/** 原圖讀取中的旋轉圈（疊在畫面中央，有縮圖時蓋在縮圖上） */
let ring = null;
function showRing() {
  if (!ring) {
    ring = progressRing();
    ring.classList.add('lightbox-ring');
    $('lightbox').append(ring);
  }
  ring.hidden = false;
}
const hideRing = () => { if (ring) ring.hidden = true; };

export async function openLightbox(m) {
  current = m;
  const img = $('lightbox-img');
  $('lightbox-name').textContent = m.name;
  img.removeAttribute('src');
  $('lightbox').hidden = false;
  showRing();

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
    img.onload = img.onerror = () => { if (current === m && img.src === url) hideRing(); };
    img.src = url;
  } catch (e) {
    if (current === m) { hideRing(); toast('原圖載入失敗：' + e.message); }
  }
}

export function closeLightbox() {
  $('lightbox').hidden = true;
  hideRing();
  $('lightbox-img').removeAttribute('src');
  if (fullUrl) URL.revokeObjectURL(fullUrl);
  fullUrl = '';
  current = null;
}
