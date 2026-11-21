/** Google Drive API v3：共用呼叫函式、資料夾、垃圾桶 */
import { API, FOLDER_MIME } from './constants.js';
import { getToken, markInvalid } from './auth.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function httpErrorFrom(res) {
  let msg = res.statusText || '請求失敗';
  try {
    const j = await res.json();
    if (j && j.error && j.error.message) msg = j.error.message;
  } catch (e) { /* 不是 JSON 就用預設訊息 */ }
  return new HttpError(res.status, `${msg} (${res.status})`);
}

/**
 * 共用的 Drive API 呼叫：自動帶憑證；401 時標記憑證失效並等使用者重新連線後重試。
 * opts.as：json（預設）/ blob / text / none
 */
export async function api(path, opts = {}) {
  const { method = 'GET', params, body, as = 'json', signal } = opts;
  let url = API + path;
  if (params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) sp.set(k, String(v));
    url += '?' + sp;
  }
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const headers = { Authorization: 'Bearer ' + token };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, signal, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && attempt < 2) { markInvalid(); continue; }
    if (!res.ok) throw await httpErrorFrom(res);
    if (as === 'blob') return res.blob();
    if (as === 'text') return res.text();
    if (as === 'none') return null;
    return res.json();
  }
}

/** 找（或建立）專屬資料夾，用隱藏屬性 td_role 辨識，資料夾被搬走也找得到 */
export async function findOrCreateFolder(role, parentId, name) {
  const find = async () => {
    const q = [
      `mimeType='${FOLDER_MIME}'`,
      'trashed=false',
      `appProperties has { key='td_role' and value='${role}' }`,
    ];
    if (parentId) q.push(`'${parentId}' in parents`);
    const r = await api('/files', {
      params: { q: q.join(' and '), fields: 'files(id)', orderBy: 'createdTime', pageSize: 10, spaces: 'drive' },
    });
    return r.files.length ? r.files[0].id : null;
  };
  const found = await find();
  if (found) return found;
  await api('/files', {
    method: 'POST',
    params: { fields: 'id' },
    body: {
      name, mimeType: FOLDER_MIME, appProperties: { td_role: role },
      ...(parentId ? { parents: [parentId] } : {}),
    },
  });
  // 兩台裝置同時第一次登入時可能各建了一個，重新查詢取最早建立的那個，大家就會收斂到同一個
  return find();
}

/** 把檔案移到垃圾桶（30 天內可在 Drive 還原） */
export function trashFile(id) {
  return api('/files/' + id, { method: 'PATCH', params: { fields: 'id' }, body: { trashed: true } });
}
