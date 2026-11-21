/** 上傳用的 XHR 封裝（fetch 拿不到上傳進度，所以上傳改用 XMLHttpRequest） */
import { getToken, markInvalid } from '../auth.js';
import { HttpError } from '../drive.js';

/** 送出請求。不丟 HTTP 錯誤，由呼叫端看 status；網路中斷 / 取消會丟出帶旗標的 Error。 */
export function xhr({ method, url, headers, body, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open(method, url);
    for (const [k, v] of Object.entries(headers || {})) req.setRequestHeader(k, v);
    if (onProgress) req.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    req.onload = () => resolve({ status: req.status, text: req.responseText, header: (n) => req.getResponseHeader(n) });
    req.onerror = () => reject(Object.assign(new Error('網路連線中斷'), { network: true }));
    req.ontimeout = req.onerror;
    req.onabort = () => reject(Object.assign(new Error('已取消'), { aborted: true }));
    if (signal) {
      if (signal.aborted) { req.abort(); return; }
      signal.addEventListener('abort', () => req.abort(), { once: true });
    }
    req.send(body);
  });
}

export function responseError(res) {
  let msg = '上傳失敗';
  try { msg = JSON.parse(res.text).error.message || msg; } catch (e) { /* 用預設訊息 */ }
  return Object.assign(new HttpError(res.status, `${msg} (${res.status})`), { http: true });
}

/** 帶憑證的 XHR：401 時等重新連線後重試 */
export async function xhrAuthed(opts, okStatuses = [200, 201]) {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const res = await xhr({ ...opts, headers: { ...opts.headers, Authorization: 'Bearer ' + token } });
    if (res.status === 401 && attempt < 2) { markInvalid(); continue; }
    if (!okStatuses.includes(res.status)) throw responseError(res);
    return res;
  }
}
