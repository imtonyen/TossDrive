/** 在瀏覽器裡用 canvas 產生縮圖（長邊約 480px 的 JPEG），並取得原圖尺寸 */
import { THUMB_MAX_EDGE } from '../constants.js';

export async function makeThumb(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('無法解碼圖片'));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('無法取得圖片尺寸');
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';  // 透明背景的 PNG 轉 JPEG 會變黑，先鋪白底
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!blob) throw new Error('縮圖產生失敗');
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
