/** 對單則訊息的操作：下載、刪除 */
import { DIRECT_DOWNLOAD_MAX } from './constants.js';
import { api, trashFile } from './drive.js';
import { deleteText } from './textdb.js';
import { localFiles } from './state.js';
import { removeMessage, upsertMessage } from './messages.js';
import { render } from './ui/render.js';
import { hideToast, saveBlob, toast } from './utils/dom.js';

export async function downloadMessage(m) {
  try {
    if (localFiles.has(m.id)) { saveBlob(localFiles.get(m.id), m.name); return; }
    if (m.size > DIRECT_DOWNLOAD_MAX) {
      // 太大的檔案不在網頁裡下載（會吃光記憶體），改用 Drive 的下載連結
      window.open(m.link || `https://drive.google.com/uc?export=download&id=${m.id}`, '_blank', 'noopener');
      toast('檔案較大，已改用 Google Drive 下載（需登入同一個 Google 帳號）', 4000);
      return;
    }
    toast('下載中…', 8000);
    const blob = await api('/files/' + m.id, {
      params: { alt: 'media' }, as: 'blob',
      onProgress: (frac) => { if (frac !== null) toast(`下載中… ${Math.round(frac * 100)}%`, 8000); },
    });
    saveBlob(blob, m.name);
    hideToast();
  } catch (e) {
    toast('下載失敗：' + e.message);
  }
}

export async function deleteMessage(m) {
  if (!confirm('刪除這則訊息？\n（檔案會移到 Google Drive 垃圾桶，30 天內都救得回來，其他裝置也會同步消失）')) return;
  removeMessage(m.id);
  render();
  try {
    if (m.sheetId) await deleteText(m);
    else await trashFile(m.id);
    if (m.thumbId) trashFile(m.thumbId).catch(() => {});
  } catch (e) {
    upsertMessage(m);  // 刪除失敗，放回畫面
    render();
    toast('刪除失敗：' + e.message);
  }
}
