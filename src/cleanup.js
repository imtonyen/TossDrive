/** 自動清理：依 RETENTION_DAYS 把過期的訊息和縮圖移到垃圾桶 */
import { CFG, FOLDER_MIME } from './constants.js';
import { api, trashFile } from './drive.js';
import { state } from './state.js';
import { limitDownload } from './utils/async.js';
import { store } from './utils/storage.js';

export async function maybeCleanup() {
  const days = Number(CFG.RETENTION_DAYS) || 0;
  if (days <= 0) return;
  // 沒有伺服器可以定時跑，所以由任一台裝置打開網頁時執行，每台裝置每天最多一次
  if (Date.now() - Number(store.get('cleanup') || 0) < 86400000) return;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const q = `('${state.rootId}' in parents or '${state.thumbsId}' in parents) and trashed=false`
    + ` and createdTime < '${cutoff}' and mimeType != '${FOLDER_MIME}'`;
  let pageToken;
  do {
    const r = await api('/files', { params: { q, pageSize: 100, pageToken, fields: 'nextPageToken,files(id)', spaces: 'drive' } });
    await Promise.all(r.files.map((f) => limitDownload(() => trashFile(f.id))));
    pageToken = r.nextPageToken;
  } while (pageToken);
  store.set('cleanup', String(Date.now()));
}
