/**
 * 一次性搬移：把舊版存成 .txt 檔的文字訊息搬進試算表。
 * 用法：網址後面加 ?migrate=texts 打開（例如 https://帳號.github.io/TossDrive/?migrate=texts），
 * 會先問一次，確認才開始。搬完後這支檔案和 sync.js 裡的呼叫都可以刪掉。
 *
 * - 新訊息的 ID 是 'm' + 原檔案 ID，重跑也不會重複顯示。
 * - 先寫進試算表，成功才把原檔移到垃圾桶（30 天內可在 Drive 還原），所以中途失敗不會掉訊息，重新打開網址就會接續。
 * - 超過試算表一格上限（SHEET_TEXT_MAX）的超長文字，維持 .txt 檔，不搬。
 */
import { SHEET_TEXT_MAX } from './constants.js';
import { api, trashFile } from './drive.js';
import { state } from './state.js';
import { appendRows } from './textdb.js';
import { limitDownload } from './utils/async.js';
import { hideToast, toast } from './utils/dom.js';

const BATCH = 100;

async function listLegacyTexts() {
  const out = [];
  let pageToken;
  do {
    const r = await api('/files', {
      params: {
        q: `'${state.rootId}' in parents and trashed=false and appProperties has { key='td_type' and value='text' }`,
        orderBy: 'createdTime', pageSize: 1000, pageToken, spaces: 'drive',
        fields: 'nextPageToken,files(id,createdTime,description,appProperties)',
      },
    });
    out.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

const getText = (f) => (f.appProperties.td_inline === '1'
  ? Promise.resolve(f.description || '')
  : limitDownload(() => api('/files/' + f.id, { params: { alt: 'media' }, as: 'text' })));

export async function maybeMigrateTexts() {
  if (new URLSearchParams(location.search).get('migrate') !== 'texts') return;
  history.replaceState(null, '', location.pathname);   // 網址上的參數拿掉，重新整理就不會再問

  const files = await listLegacyTexts();
  if (!files.length) { alert('沒有舊的 .txt 文字訊息需要搬移。'); return; }
  if (!confirm(`找到 ${files.length} 則舊的 .txt 文字訊息。\n要搬進文字訊息試算表嗎？\n（原本的 .txt 會移到 Google Drive 垃圾桶，30 天內可以救回來）`)) return;

  let moved = 0;
  let skipped = 0;   // 超長文字
  let failed = 0;    // 下載失敗，沒搬也沒刪
  for (let i = 0; i < files.length; i += BATCH) {
    toast(`搬移中… ${i} / ${files.length}`, 600000);
    const batch = files.slice(i, i + BATCH);
    const texts = await Promise.all(batch.map((f) => getText(f).catch(() => null)));
    const ok = [];
    batch.forEach((f, j) => {
      if (texts[j] === null) failed++;
      else if (texts[j].length > SHEET_TEXT_MAX) skipped++;
      else ok.push({ f, text: texts[j] });
    });
    if (!ok.length) continue;
    // 先寫進試算表；成功了才丟垃圾桶
    await appendRows(ok.map(({ f, text }) => {
      const p = f.appProperties;
      return ['m' + f.id, Date.parse(f.createdTime) || Date.now(), p.td_devid || '', p.td_dev || '', p.td_devname || '', text];
    }), true);
    await Promise.all(ok.map(({ f }) => limitDownload(() => trashFile(f.id))));
    moved += ok.length;
  }
  hideToast();
  alert(`搬移完成：${moved} 則已搬進試算表`
    + (skipped ? `\n${skipped} 則超長文字維持 .txt 檔` : '')
    + (failed ? `\n${failed} 則下載失敗，沒有搬也沒有刪除，重新打開 ?migrate=texts 可以再試` : ''));
  location.reload();
}
