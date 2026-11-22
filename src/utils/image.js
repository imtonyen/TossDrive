/**
 * 圖片縮放：依顯示區域大小 × 螢幕像素密度，把大圖縮成剛好夠用的尺寸。
 * 手機瀏覽器（尤其 iPhone Safari）直接把幾千像素的原圖縮到螢幕大小時取樣很粗，
 * 文字、細線會出現鋸齒失真；改成用 canvas 每次縮一半、高品質平滑，結果清楚很多。
 */

const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;   // iOS canvas 面積上限約 16.7M 像素

/** 這些格式不縮：GIF 會失去動畫、SVG 本來就是向量圖 */
const SKIP_TYPES = /^image\/(gif|svg\+xml)$/i;

export function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('無法解碼圖片'));
    i.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

/** 把圖片畫到 tw × th 的 canvas：每次最多縮一半，避免一次縮太多造成鋸齒 */
export function drawScaled(img, tw, th, background) {
  let src = img;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  for (;;) {
    let nw = Math.max(tw, Math.floor(w / 2));
    let nh = Math.max(th, Math.floor(h / 2));
    if (nw * nh > MAX_CANVAS_PIXELS) {   // 超大圖第一步就縮到 canvas 放得下
      const k = Math.sqrt(MAX_CANVAS_PIXELS / (nw * nh));
      nw = Math.max(tw, Math.floor(nw * k));
      nh = Math.max(th, Math.floor(nh * k));
    }
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, nw, nh); }
    ctx.drawImage(src, 0, 0, nw, nh);
    if (src instanceof HTMLCanvasElement) src.width = src.height = 0;   // 盡快釋放中間 canvas 的記憶體（iOS 很吃緊）
    if (nw === tw && nh === th) return canvas;
    src = canvas;
    w = nw;
    h = nh;
  }
}

/** 縮放倍率：讓 w × h 剛好塞進 maxW × maxH（不放大） */
export function fitScale(w, h, maxW, maxH) {
  return Math.min(1, maxW / w, maxH / h);
}

/** 顯示區域（CSS 像素）換算成實際需要的圖片像素 */
export const devicePixels = (cssPx) => Math.ceil(cssPx * Math.min(window.devicePixelRatio || 1, 3));

/**
 * 回傳適合在 maxW × maxH（實際像素）範圍內顯示的圖片 object URL。
 * 原圖已經夠小、格式不適合縮、或解碼失敗時，直接用原圖。呼叫端負責 revoke。
 */
export async function fitImageUrl(blob, maxW, maxH) {
  if (SKIP_TYPES.test(blob.type || '')) return URL.createObjectURL(blob);
  try {
    const img = await loadImage(blob);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = fitScale(w, h, maxW, maxH);
    if (!w || !h || scale > 0.9) return URL.createObjectURL(blob);   // 差不多大就不必重新編碼
    const canvas = drawScaled(img, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    // JPEG 保持原格式（檔案小、編碼快）；其他格式可能有透明背景，用 PNG
    const type = /jpe?g/i.test(blob.type) ? 'image/jpeg' : 'image/png';
    const out = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
    canvas.width = canvas.height = 0;
    return URL.createObjectURL(out || blob);
  } catch {
    return URL.createObjectURL(blob);
  }
}
