/**
 * 訊息元件：文字、圖片（延遲載入縮圖）、檔案卡片、操作按鈕、上傳中的訊息。
 * 這裡只負責「長什麼樣子」；按鈕按下去要做什麼，由呼叫端傳入的 handlers 決定：
 *   { onDownload(m), onDelete(m), onOpenImage(m), onRetry(u), onRemove(u) }
 */
import { device } from '../device.js';
import { tokenValid } from '../auth.js';
import { getText } from '../messages.js';
import { getThumbUrl } from '../thumbs.js';
import { $, h, linkify, copyText } from '../utils/dom.js';
import { fmtSize, fmtTime } from '../utils/format.js';
import { icon, devIconName, fileIcon } from './icons.js';

/* ---------- 圖片延遲載入：元素快進入畫面時才下載縮圖 ---------- */
let imgObserver = null;

function observeImage(box, loader) {
  if (!imgObserver) {
    imgObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        imgObserver.unobserve(e.target);
        if (e.target._load) e.target._load();
      }
    }, { root: $('timeline'), rootMargin: '300px' });
  }
  box._load = loader;
  imgObserver.observe(box);
}

/* ---------- 小零件 ---------- */
function fileCard(name, size, iconName) {
  return h('div', { class: 'file-card' },
    h('div', { class: 'file-icon' }, icon(iconName)),
    h('div', { class: 'file-info' },
      h('div', { class: 'file-name', text: name }),
      h('div', { class: 'file-size', text: fmtSize(size) })));
}

function act(iconName, label, onClick, danger) {
  return h('button', { class: 'act' + (danger ? ' danger' : ''), onclick: onClick }, icon(iconName), label);
}

/** 縮圖框的大小：依原圖比例預留版面，避免圖片載入時畫面跳動 */
function imgBoxStyle(w, h2) {
  if (!w || !h2) { w = 4; h2 = 3; }
  const width = Math.round(Math.min(280, (360 * w) / h2));
  return `width:${width}px;aspect-ratio:${w} / ${h2}`;
}

function buildImageBox(m, onOpen) {
  const img = h('img', { alt: m.name, draggable: 'false' });
  const box = h('div', { class: 'img-box placeholder', 'data-label': '', style: imgBoxStyle(m.w, m.h), onclick: () => onOpen(m) }, img);
  observeImage(box, () => {
    box.className = 'img-box loading';
    box.dataset.label = '載入中…';
    getThumbUrl(m).then((url) => {
      img.src = url;
      box.className = 'img-box';
    }).catch(() => {
      box.className = 'img-box error';
      box.dataset.label = '無法載入';
    });
  });
  return box;
}

/* ---------- 已存在 Drive 的訊息 ---------- */
export function buildMessage(m, hd) {
  const mine = m.devid === device.id;
  const meta = h('div', { class: 'meta' }, icon(devIconName(m.devtype)), ` ${m.devname || '未知裝置'} · ${fmtTime(m.time)}`);
  let body;
  const actions = [];

  if (m.type === 'text') {
    const text = getText(m);
    body = text === undefined
      ? h('div', { class: 'text muted', text: '載入中…' })
      : h('div', { class: 'text' }, linkify(text));
    if (text !== undefined) actions.push(act('copy', '複製', () => copyText(text)));
  } else if (m.type === 'image') {
    body = h('div', {}, buildImageBox(m, hd.onOpenImage), h('div', { class: 'caption', text: `${m.name} · ${fmtSize(m.size)}` }));
    actions.push(act('download', '下載', () => hd.onDownload(m)));
  } else {
    body = fileCard(m.name, m.size, fileIcon(m.mime, m.name));
    actions.push(act('download', '下載', () => hd.onDownload(m)));
  }
  actions.push(act('trash', '刪除', () => hd.onDelete(m), true));

  const bubble = h('div', { class: 'bubble' }, meta, body, h('div', { class: 'actions' }, actions));
  return { el: h('div', { class: 'msg ' + (mine ? 'mine' : 'theirs') }, bubble) };
}

/* ---------- 上傳中 / 失敗的訊息 ---------- */
export const pendingSig = (u) => JSON.stringify([u.status, u.error, u.name, !tokenValid()]);

export function pendingStatusText(u) {
  if (u.status === 'failed') return '失敗：' + (u.error || '未知錯誤');
  if (u.status === 'queued') return '等待上傳…';
  if (!tokenValid()) return '登入已過期，重新連線後會繼續';
  return u.kind === 'file' ? `上傳中 ${Math.round(u.progress * 100)}%` : '傳送中…';
}

export function buildPending(u, hd) {
  const refs = {};
  const meta = h('div', { class: 'meta' }, icon(devIconName(device.type)), ` ${device.name} · ${fmtTime(u.createdAt)}`);
  const body = [];
  if (u.kind === 'text') {
    body.push(h('div', { class: 'text' }, linkify(u.text)));
  } else if (u.previewUrl) {
    body.push(h('img', { class: 'pending-preview', src: u.previewUrl, alt: '' }));
    body.push(h('div', { class: 'caption', text: `${u.name} · ${fmtSize(u.size)}` }));
  } else {
    body.push(fileCard(u.name, u.size, fileIcon(u.mime, u.name)));
  }
  if (u.kind === 'file' && u.status !== 'failed') {
    refs.fill = h('div', { class: 'progress-fill', style: `width:${Math.round(u.progress * 100)}%` });
    body.push(h('div', { class: 'progress' }, refs.fill));
  }
  refs.status = h('div', { class: 'pending-status' + (u.status === 'failed' ? ' failed' : ''), text: pendingStatusText(u) });
  body.push(refs.status);

  const actions = u.status === 'failed'
    ? [act('retry', '重試', () => hd.onRetry(u)), act('x', '移除', () => hd.onRemove(u), true)]
    : [act('x', '取消', () => hd.onRemove(u), true)];
  const bubble = h('div', { class: 'bubble' }, meta, body, h('div', { class: 'actions' }, actions));
  return { el: h('div', { class: 'msg mine pending' }, bubble), refs };
}
