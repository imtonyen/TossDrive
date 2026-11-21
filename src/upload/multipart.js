/** multipart 上傳：中繼資料 + 檔案內容一次送出（≤ 5MB，以及縮圖、文字訊息） */
import { FILE_FIELDS, UPLOAD_API } from '../constants.js';
import { xhrAuthed } from './xhr.js';

/** onProgress(0~1) 可省略 */
export async function multipartUpload(meta, blob, mime, signal, onProgress) {
  const boundary = 'tossdrive' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(meta),
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const res = await xhrAuthed({
    method: 'POST',
    url: `${UPLOAD_API}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
    signal,
    onProgress: onProgress ? (loaded) => onProgress(Math.min(loaded / body.size, 1)) : null,
  });
  return JSON.parse(res.text);
}
