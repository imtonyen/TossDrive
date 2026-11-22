/**
 * 上傳佇列：文字立刻送出，檔案排隊一個一個傳（避免手機網路塞車）。
 * 管理上傳中的訊息（進度、取消、失敗重試），完成後換成 Drive 上的正式訊息。
 */
import { INLINE_TEXT_MAX, MULTIPART_MAX, SHEET_TEXT_MAX } from '../constants.js';
import { trashFile } from '../drive.js';
import { device } from '../device.js';
import { state, uploads, textCache, localFiles, gate } from '../state.js';
import { fileToMessage, upsertMessage } from '../messages.js';
import { appendText } from '../textdb.js';
import { setLocalThumb } from '../thumbs.js';
import { render, scheduleRender, updateProgress } from '../ui/render.js';
import { stamp } from '../utils/format.js';
import { multipartUpload } from './multipart.js';
import { resumableUpload } from './resumable.js';
import { makeThumb } from './thumbnail.js';

let queueRunning = false;
let nextLocalId = 1;

/** 還有沒有正在上傳或排隊中的項目（關閉頁面前提醒用） */
export const hasActiveUploads = () => uploads.some((u) => u.status === 'uploading' || u.status === 'queued');
export const hasUnfinishedUploads = () => uploads.some((u) => u.status !== 'failed');

function deviceProps(type) {
  return { td_type: type, td_dev: device.type, td_devname: device.name, td_devid: device.id };
}

function setProgress(item, frac) {
  item.progress = Math.max(0, Math.min(1, frac));
  updateProgress(item);
}

function newItem(props) {
  return {
    localId: nextLocalId++, status: 'queued', progress: 0, error: '', createdAt: Date.now(),
    name: '', size: 0, mime: '', previewUrl: '', previewPromise: null, dropped: false, abort: null, cancelled: false,
    sessionUri: null, offset: 0, thumbId: '', thumbBlobUrl: '', w: 0, h: 0,
    ...props,
  };
}

/* ---------- 對外：送出文字、加入檔案 ---------- */

/** 把一則文字訊息放進上傳（文字會立刻送出，不排隊） */
export function sendText(text) {
  const item = newItem({ kind: 'text', text, type: 'text', msgId: 'm' + crypto.randomUUID().replaceAll('-', '') });
  uploads.push(item);
  render({ bottom: true });
  runItem(item);
}

/** 把檔案放進佇列 */
export function enqueueFiles(files) {
  for (let f of files) {
    // 手機拍照 / 貼上截圖的檔名常是 image.jpg / image.png，改成有時間的名稱方便辨識
    if (/^image\.\w+$/i.test(f.name) || !f.name) {
      const ext = (f.name.split('.')[1] || (f.type.split('/')[1] || 'bin')).replace('jpeg', 'jpg');
      f = new File([f], `${f.type.startsWith('image/') ? '照片' : '檔案'}_${stamp()}.${ext}`, { type: f.type, lastModified: f.lastModified });
    }
    const isImage = (f.type || '').startsWith('image/');
    uploads.push(newItem({
      kind: 'file', file: f, name: f.name, size: f.size, mime: f.type || 'application/octet-stream',
      type: isImage ? 'image' : 'file',
    }));
  }
  render({ bottom: true });
  runQueue();
}

/* ---------- 執行 ---------- */

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const item = uploads.find((u) => u.kind === 'file' && u.status === 'queued');
      if (!item) break;
      await runItem(item);
    }
  } finally {
    queueRunning = false;
  }
}

async function runItem(item) {
  item.status = 'uploading';
  item.error = '';
  item.abort = new AbortController();
  scheduleRender();
  try {
    await gate.promise;   // 資料夾準備好才能上傳
    const m = item.kind === 'text' ? await uploadText(item) : fileToMessage(await uploadFile(item));
    completeItem(item, m);
  } catch (e) {
    if (item.cancelled || e.aborted) return;   // 使用者取消，畫面上已經移除
    console.warn('上傳失敗', e);
    item.status = 'failed';
    item.error = e.message || '未知錯誤';
    scheduleRender();
  }
}

/** 文字存進試算表；同一則重試時用同一個 ID，就算前一次其實送出去了，畫面上也不會重複 */
async function uploadText(item) {
  if (item.text.length <= SHEET_TEXT_MAX) {
    return appendText({ id: item.msgId, time: item.createdAt, text: item.text, device });
  }
  return fileToMessage(await uploadLongText(item));
}

/** 超過試算表一格上限的超長文字，退回存成 .txt 檔 */
async function uploadLongText(item) {
  const text = item.text;
  const inline = text.length <= INLINE_TEXT_MAX;
  const meta = {
    name: `訊息_${stamp()}.txt`,
    mimeType: 'text/plain',
    parents: [state.rootId],
    appProperties: { ...deviceProps('text'), td_inline: inline ? '1' : '0' },
  };
  if (inline) meta.description = text;   // 短文字同時存在說明欄位，列出訊息時一起拿到，不用逐一下載
  return multipartUpload(meta, new Blob([text], { type: 'text/plain' }), 'text/plain; charset=UTF-8', item.abort.signal);
}

async function uploadFile(item) {
  const file = item.file;
  const props = deviceProps(item.type);
  const onProgress = (frac) => setProgress(item, frac);

  // 照片：先產生縮圖、上傳到 _thumbs，再上傳原圖
  if (item.type === 'image' && !item.thumbId) {
    try {
      const t = await makeThumb(file);
      const thumbJson = await multipartUpload({
        name: `${file.name}.thumb.jpg`,
        mimeType: 'image/jpeg',
        parents: [state.thumbsId],
        appProperties: { td_role: 'thumb' },
      }, t.blob, 'image/jpeg', item.abort.signal);
      item.thumbId = thumbJson.id;
      item.thumbBlobUrl = URL.createObjectURL(t.blob);  // 上傳完成後直接用這個顯示，不用重新下載
      item.w = t.w;
      item.h = t.h;
    } catch (e) {
      if (e.aborted || e.http || e.network) throw e;
      item.type = 'file';   // 瀏覽器解不開的圖片（例如 HEIC）當一般檔案傳
      props.td_type = 'file';
    }
  }
  if (item.type === 'image') {
    props.td_type = 'image';
    props.td_thumb = item.thumbId;
    props.td_w = String(item.w);
    props.td_h = String(item.h);
  }

  const meta = { name: file.name, mimeType: item.mime, parents: [state.rootId], appProperties: props };
  if (file.size <= MULTIPART_MAX) {
    return multipartUpload(meta, file, item.mime, item.abort.signal, onProgress);
  }
  return resumableUpload(meta, file, item.mime, item, onProgress);
}

/* ---------- 完成、取消、重試 ---------- */

function completeItem(item, m) {
  if (item.thumbBlobUrl) {
    if (m.thumbId) setLocalThumb(m.thumbId, item.thumbBlobUrl);
    else URL.revokeObjectURL(item.thumbBlobUrl);
  }
  if (item.file) localFiles.set(m.id, item.file);
  if (m.type === 'text' && item.kind === 'text' && m.text === undefined) textCache.set(m.id, item.text);
  upsertMessage(m);
  dropItem(item);
  render({ bottom: true });
}

function dropItem(item) {
  const i = uploads.indexOf(item);
  if (i >= 0) uploads.splice(i, 1);
  item.dropped = true;   // 預覽圖還在產生的話，產生完會自己釋放
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

/** 取消或移除：中斷上傳、把已上傳的縮圖丟垃圾桶 */
export function removeUpload(item) {
  item.cancelled = true;
  if (item.abort) item.abort.abort();
  if (item.thumbId) trashFile(item.thumbId).catch(() => {});
  if (item.thumbBlobUrl) URL.revokeObjectURL(item.thumbBlobUrl);
  dropItem(item);
  render();
}

/** 登出時中斷全部上傳 */
export function cancelAllUploads() {
  for (const u of [...uploads]) {
    u.cancelled = true;
    u.dropped = true;
    if (u.abort) u.abort.abort();
    if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
    if (u.thumbBlobUrl) URL.revokeObjectURL(u.thumbBlobUrl);
  }
  uploads.length = 0;
}

export function retryUpload(item) {
  item.status = 'queued';
  item.error = '';
  item.cancelled = false;
  item.progress = item.sessionUri ? item.offset / (item.size || 1) : 0;
  scheduleRender();
  if (item.kind === 'text') runItem(item);
  else runQueue();
}
