/** 同步：首次載入、載入更早訊息、Changes 輪詢、背景暫停、錯誤退避 */
import { CFG, FILE_FIELDS, FOLDER_MIME, SHEET_MIME } from './constants.js';
import { tokenValid } from './auth.js';
import { api, findOrCreateFolder } from './drive.js';
import { state, gate } from './state.js';
import { fileToMessage, removeMessage, upsertMessage } from './messages.js';
import { maybeCleanup } from './cleanup.js';
import { maybeMigrateTexts } from './migrate.js';
import { handleSheetChange, hasOlderTexts, initSheets, loadOlderTexts } from './textdb.js';
import { render } from './ui/render.js';
import { setDot, showExpired } from './ui/status.js';
import { $, toast } from './utils/dom.js';

const sync = { pageToken: null, timer: null, running: false, failures: 0 };

export function stopSync() {
  clearTimeout(sync.timer);
  sync.pageToken = null;
  sync.failures = 0;
}

async function listMessages(pageToken) {
  return api('/files', {
    params: {
      q: `'${state.rootId}' in parents and trashed=false and mimeType != '${FOLDER_MIME}' and mimeType != '${SHEET_MIME}'`,
      orderBy: 'createdTime desc',
      pageSize: CFG.PAGE_SIZE,
      pageToken,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      spaces: 'drive',
    },
  });
}

/** 啟動時：建立資料夾 → 記下 Changes 起點 → 載入最新一頁訊息 → 開始輪詢 */
export async function bootstrap() {
  $('loading-hint').hidden = false;
  state.rootId = await findOrCreateFolder('root', null, CFG.FOLDER_NAME);
  state.thumbsId = await findOrCreateFolder('thumbs', state.rootId, '_thumbs（縮圖）');
  $('drive-link').href = 'https://drive.google.com/drive/folders/' + state.rootId;

  // 先取 Changes 起點、再列訊息，這樣兩者之間發生的變動不會漏掉
  sync.pageToken = (await api('/changes/startPageToken', { params: { spaces: 'drive' } })).startPageToken;
  const page = await listMessages();
  for (const f of page.files) upsertMessage(fileToMessage(f));
  await initSheets();
  state.nextPageToken = page.nextPageToken || null;
  state.booted = true;
  $('loading-hint').hidden = true;
  render({ bottom: true });
  gate.resolve();
  setDot('ok', '同步正常');
  scheduleSync(CFG.POLL_INTERVAL_MS);
  maybeCleanup().catch((e) => console.warn('自動清理失敗', e));
  maybeMigrateTexts().catch((e) => { console.warn('搬移舊文字訊息失敗', e); toast('搬移失敗：' + e.message, 6000); });
}

/** 往上捲：載入更早的訊息，維持原本看的位置 */
export async function loadOlder() {
  if (!state.nextPageToken && !hasOlderTexts()) return;
  const btn = $('load-older');
  btn.disabled = true;
  try {
    const timeline = $('timeline');
    // 檔案（一頁一頁）和文字（一份試算表一份試算表）分開往前載入，兩邊都載好才重繪，位置才不會跳
    const page = state.nextPageToken ? await listMessages(state.nextPageToken) : null;
    await loadOlderTexts();
    const prevHeight = timeline.scrollHeight;
    const prevTop = timeline.scrollTop;
    if (page) {
      for (const f of page.files) upsertMessage(fileToMessage(f));
      state.nextPageToken = page.nextPageToken || null;
    }
    render();
    timeline.scrollTop = prevTop + (timeline.scrollHeight - prevHeight);
  } catch (e) {
    toast('載入失敗：' + e.message);
  } finally {
    btn.disabled = false;
  }
}

export function scheduleSync(delay) {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncTick, delay);
}

async function syncTick() {
  if (!state.booted || sync.running) return;
  if (document.hidden) { setDot('idle', '背景暫停中'); return; } // 回到前景時會再啟動
  if (!tokenValid()) { showExpired(); return; }                  // 重新連線後會再啟動
  sync.running = true;
  try {
    await pullChanges();
    sync.failures = 0;
    setDot('ok', '同步正常');
    scheduleSync(CFG.POLL_INTERVAL_MS);
  } catch (e) {
    sync.failures++;
    console.warn('同步失敗', e);
    setDot('error', '同步失敗：' + e.message);
    // 指數退避：3 秒 → 6 → 12 → … 最長 60 秒，恢復後回到 3 秒
    scheduleSync(Math.min(60000, CFG.POLL_INTERVAL_MS * 2 ** sync.failures));
  } finally {
    sync.running = false;
  }
}

/** 問 Drive「上次之後有什麼變動」 */
async function pullChanges() {
  let token = sync.pageToken;
  let changed = false;
  const sheetChanges = new Map();   // 試算表檔案 ID → 最新的變動
  for (;;) {
    const r = await api('/changes', {
      params: {
        pageToken: token,
        pageSize: 100,
        includeRemoved: true,
        restrictToMyDrive: true,
        spaces: 'drive',
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      },
    });
    for (const ch of r.changes || []) {
      const f = ch.file;
      if ((f && f.mimeType === SHEET_MIME) || state.sheets.some((s) => s.id === ch.fileId)) {
        sheetChanges.set(ch.fileId, ch);   // 文字訊息試算表有變動：一份只讀一次
        continue;
      }
      const inRoot = f && f.parents && f.parents.includes(state.rootId);
      if (ch.removed || !f || f.trashed || !inRoot || f.mimeType === FOLDER_MIME) {
        // 移到垃圾桶、永久刪除、移出資料夾 → 從畫面移除
        if (removeMessage(ch.fileId)) changed = true;
      } else {
        upsertMessage(fileToMessage(f));
        changed = true;
      }
    }
    if (r.nextPageToken) token = r.nextPageToken;
    else { sync.pageToken = r.newStartPageToken; break; }
  }
  for (const ch of sheetChanges.values()) if (await handleSheetChange(ch)) changed = true;
  if (changed) render();
}
