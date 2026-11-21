/** DOM 小工具：建立元素、提示訊息、複製、存檔、網址轉連結 */

export const $ = (id) => document.getElementById(id);

/** 建立 DOM 元素（一律用 textContent / append，不使用 innerHTML，避免 XSS） */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;   // 不用 setAttribute('style')，CSP 會擋掉 style 屬性，CSSOM 則不受限
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function hideToast() {
  $('toast').hidden = true;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // 舊瀏覽器或非 https 環境的備用做法
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('已複製');
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name || 'download' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** 把文字裡的網址變成可點的連結（回傳節點陣列） */
export function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"'`]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]}'"。，；：！？）」』、]+$/); // 結尾標點不算網址的一部分
    if (trail) url = url.slice(0, -trail[0].length);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
