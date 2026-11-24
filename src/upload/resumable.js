/**
 * 可續傳上傳（> 5MB）：每次送 8MB，斷線自動重試並從中斷處接續。
 * 上傳位址（session URI）本身就帶有授權資訊，所以傳資料時不帶憑證，
 * 這樣上傳到一半憑證過期也不會中斷。
 *
 * item 需要有：abort（AbortController）、sessionUri、offset；這兩個欄位會被更新，
 * 這樣失敗後按「重試」可以接著傳，不用從頭來。
 */
import { CHUNK_SIZE, FILE_FIELDS, UPLOAD_API } from '../constants.js';
import { sleep } from '../utils/async.js';
import { responseError, xhr, xhrAuthed } from './xhr.js';

/** onSession()：拿到新的上傳位址時呼叫（存到本機，重新整理後可以接著傳） */
export async function resumableUpload(meta, file, mime, item, onProgress, onSession) {
  const signal = item.abort.signal;

  // 向 Google 查詢「已經收到多少」。Range 標頭讀不到時，保守地從最後確認的位置接續。
  const queryOffset = async () => {
    const res = await xhr({
      method: 'PUT', url: item.sessionUri, signal,
      headers: { 'Content-Range': `bytes */${file.size}` },
    });
    if (res.status === 200 || res.status === 201) return { done: JSON.parse(res.text) };
    if (res.status === 308) {
      const range = res.header('Range');
      return { offset: range ? parseInt(range.split('-')[1], 10) + 1 : item.offset };
    }
    throw responseError(res);
  };

  // 上次傳到一半（重試或重新整理後）：先問 Google 收到多少；位址過期就重新開始
  if (item.sessionUri) {
    try {
      const q = await queryOffset();
      if (q.done) return q.done;
      item.offset = q.offset;
      onProgress(item.offset / file.size);
    } catch (e) {
      if (e.aborted || e.network) throw e;
      item.sessionUri = null;
    }
  }

  if (!item.sessionUri) {
    const res = await xhrAuthed({
      method: 'POST',
      url: `${UPLOAD_API}/files?uploadType=resumable&fields=${encodeURIComponent(FILE_FIELDS)}`,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(file.size),
      },
      body: JSON.stringify(meta),
      signal,
    });
    item.sessionUri = res.header('Location');
    if (!item.sessionUri) throw new Error('無法取得上傳位址');
    item.offset = 0;
    if (onSession) onSession();
  }

  let retries = 0;
  while (item.offset < file.size) {
    const start = item.offset;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    try {
      const res = await xhr({
        method: 'PUT', url: item.sessionUri, signal,
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` },
        body: file.slice(start, end),
        onProgress: (loaded) => onProgress((start + loaded) / file.size),
      });
      if (res.status === 200 || res.status === 201) return JSON.parse(res.text);
      if (res.status === 308) {
        const range = res.header('Range');
        item.offset = range ? parseInt(range.split('-')[1], 10) + 1 : end;
        onProgress(item.offset / file.size);
        retries = 0;
        continue;
      }
      if (res.status === 404 || res.status === 410) {   // 上傳位址過期，重新開始
        item.sessionUri = null;
        throw Object.assign(new Error('上傳階段已失效，請重試'), { sessionExpired: true });
      }
      if (res.status >= 500 || res.status === 429) throw Object.assign(new Error('伺服器忙碌'), { network: true });
      throw responseError(res);
    } catch (e) {
      if (e.aborted || e.sessionExpired || !(e.network || e.status >= 500 || e.status === 429)) throw e;
      if (++retries > 6) throw e;
      await sleep(Math.min(1000 * 2 ** retries, 15000));
      const q = await queryOffset().catch(() => ({ offset: item.offset }));
      if (q.done) return q.done;
      item.offset = q.offset;
    }
  }
  // 理論上最後一段就會拿到 200；萬一已經送完卻沒拿到結果，查詢一次
  const q = await queryOffset();
  if (q.done) return q.done;
  throw new Error('上傳未完成');
}
