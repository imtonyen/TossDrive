/** 在瀏覽器裡用 canvas 產生縮圖（寬最多 THUMB_MAX_W 像素的 JPEG），並取得原圖尺寸 */
import { THUMB_MAX_W, THUMB_MAX_H } from '../constants.js';
import { loadImage, drawScaled, fitScale } from '../utils/image.js';

export async function makeThumb(file) {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('無法取得圖片尺寸');
  const scale = fitScale(w, h, THUMB_MAX_W, THUMB_MAX_H);
  // 透明背景的 PNG 轉 JPEG 會變黑，先鋪白底
  const canvas = drawScaled(img, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), '#fff');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('縮圖產生失敗');
  return { blob, w, h };
}
