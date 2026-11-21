/**
 * 時間軸渲染
 * 訊息元素會重複使用（以內容簽章判斷），圖片不會重新載入；
 * 只在順序不對時才搬動元素；新訊息進來時，只有原本就在底部才自動捲到底。
 */
import { api } from '../drive.js';
import { state, messages, uploads, textCache, textLoading } from '../state.js';
import { getText } from '../messages.js';
import { hasOlderTexts } from '../textdb.js';
import { $, h } from '../utils/dom.js';
import { limitDownload } from '../utils/async.js';
import { dayKey, dayLabel } from '../utils/format.js';
import { buildMessage, buildPending, pendingSig, pendingStatusText } from './message-view.js';

let handlers = {};
const els = new Map();   // key → { el, sig, refs }
let renderQueued = null;

/** 註冊按鈕的處理函式：{ onDownload, onDelete, onOpenImage, onRetry, onRemove } */
export function configureRender(hd) {
  handlers = hd;
}

/** 以 sig（內容簽章）判斷要不要重建元素；簽章沒變就原樣重用 */
function reuse(key, sig, build) {
  let c = els.get(key);
  if (!c || c.sig !== sig) {
    c = { sig, ...build() };
    els.set(key, c);
  }
  return c;
}

/** 長文字（沒有存在說明欄位）需要另外下載內容 */
function ensureText(m) {
  if (m.text !== undefined || textCache.has(m.id) || textLoading.has(m.id)) return;
  textLoading.add(m.id);
  limitDownload(() => api('/files/' + m.id, { params: { alt: 'media' }, as: 'text' }))
    .then((t) => textCache.set(m.id, t))
    .catch(() => textCache.set(m.id, '無法載入這則訊息的內容'))
    .finally(() => { textLoading.delete(m.id); scheduleRender(); });
}

/** 排程重繪（同一個畫面幀內的多次要求會合併） */
export function scheduleRender(opts) {
  renderQueued = Object.assign(renderQueued || {}, opts || {});
  if (renderQueued.raf) return;
  renderQueued.raf = requestAnimationFrame(() => {
    const o = renderQueued;
    renderQueued = null;
    render(o);
  });
}

export function render({ bottom = false } = {}) {
  const timeline = $('timeline');
  const container = $('messages');
  const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 120;

  const list = [...messages.values()].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
  const nodes = [];
  const used = new Set();
  let lastDay = '';
  const addSep = (ts) => {
    const k = dayKey(ts);
    if (k === lastDay) return;
    lastDay = k;
    const key = 'd:' + k;
    const c = reuse(key, dayLabel(ts), () => ({ el: h('div', { class: 'day-sep', text: dayLabel(ts) }) }));
    used.add(key);
    nodes.push(c.el);
  };

  for (const m of list) {
    addSep(m.time);
    const key = 'm:' + m.id;
    const text = m.type === 'text' ? getText(m) : '';
    const sig = JSON.stringify([m.type, m.name, m.size, m.time, m.devid, m.devname, m.devtype, text, m.thumbId, m.w, m.h]);
    const c = reuse(key, sig, () => buildMessage(m, handlers));
    used.add(key);
    nodes.push(c.el);
    if (m.type === 'text') ensureText(m);
  }
  for (const u of uploads) {
    addSep(u.createdAt);
    const key = 'p:' + u.localId;
    const c = reuse(key, pendingSig(u), () => buildPending(u, handlers));
    used.add(key);
    nodes.push(c.el);
  }

  // 只在順序不對時才搬動元素
  nodes.forEach((n, i) => {
    if (container.children[i] !== n) container.insertBefore(n, container.children[i] || null);
  });
  while (container.children.length > nodes.length) container.lastChild.remove();
  for (const k of [...els.keys()]) if (!used.has(k)) els.delete(k);

  $('load-older').hidden = !(state.nextPageToken || hasOlderTexts());
  $('empty-hint').hidden = !(state.booted && nodes.length === 0);

  if (bottom || nearBottom) timeline.scrollTop = timeline.scrollHeight;
}

/** 進度條更新：只改進度條，不重建整個元素 */
export function updateProgress(u) {
  const c = els.get('p:' + u.localId);
  if (!c || !c.refs) return;
  if (c.refs.fill) c.refs.fill.style.width = Math.round(u.progress * 100) + '%';
  c.refs.status.textContent = pendingStatusText(u);
}

/** 登出時清空畫面上的元素 */
export function resetView() {
  els.clear();
  $('messages').replaceChildren();
}
