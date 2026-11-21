/**
 * 文字訊息資料庫：TossDrive 資料夾裡的 Google 試算表，一列 = 一則文字訊息。
 *
 * 欄位：A 訊息 ID ｜ B 時間（毫秒）｜ C 裝置 ID ｜ D 裝置類型 ｜ E 裝置名稱 ｜ F 文字 ｜ G 已刪除（1）
 * - 新增用 Sheets 的 append，多台裝置同時送也不會互相覆蓋。
 * - 刪除只在 G 欄打記號（不真的刪列），列的位置不會位移，也能在試算表裡手動救回來。
 * - 一律用 RAW 寫入，文字開頭是 = 也不會被當成公式。
 * - 每份試算表最多 CFG.TEXT_SHEET_MAX 則，滿了就開下一份（td_seq 遞增）。新訊息只寫最新一份，
 *   同步時只讀有變動的那一份，所以讀取量不會隨訊息總數成長。更早的試算表在往上捲時才載入。
 */
import { CFG, SHEETS_API, SHEET_MIME } from './constants.js';
import { api, trashFile } from './drive.js';
import { state, messages } from './state.js';
import { removeMessage, upsertMessage } from './messages.js';

const HEADER = ['訊息 ID', '時間（毫秒）', '裝置 ID', '裝置類型', '裝置名稱', '文字', '已刪除'];
const APPEND = { method: 'POST', params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' } };
const sheetsApi = (id, path, opts) => api('/spreadsheets/' + id + path, { base: SHEETS_API, ...opts });
const isDeleted = (r) => r[6] === 1 || r[6] === '1';
const maxRows = () => Math.max(1, Number(CFG.TEXT_SHEET_MAX) || 2000);

/* state.sheets：[{ id, seq, loaded, count }]，依 seq 由舊到新排列，最後一個就是新訊息要寫的那份 */
const active = () => state.sheets[state.sheets.length - 1];
const olderUnloaded = () => [...state.sheets].reverse().find((s) => !s.loaded);

/** 是否還有更早的文字訊息沒載入（「載入更早」按鈕要不要顯示） */
export const hasOlderTexts = () => state.sheets.some((s) => !s.loaded);

const seqOf = (f) => Number(f.appProperties && f.appProperties.td_seq) || 1;

/** 列出資料夾裡所有文字試算表，依 seq 排列；同一個 seq 有多份（同時建立）只取最早建立的 */
async function listSheets(modifiedTime) {
  const r = await api('/files', {
    params: {
      q: `'${state.rootId}' in parents and mimeType='${SHEET_MIME}' and trashed=false`
        + ` and appProperties has { key='td_role' and value='db' }`,
      fields: 'files(id,modifiedTime,appProperties)', orderBy: 'createdTime', pageSize: 1000, spaces: 'drive',
    },
  });
  const bySeq = new Map();
  for (const f of r.files) if (!bySeq.has(seqOf(f))) bySeq.set(seqOf(f), { id: f.id, seq: seqOf(f), modifiedTime: f.modifiedTime });
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** 建立第 seq 份試算表，回傳目前的清單 */
async function createSheet(seq) {
  const created = await api('/files', {
    method: 'POST',
    params: { fields: 'id' },
    body: {
      name: `${CFG.FOLDER_NAME} 文字訊息 ${String(seq).padStart(3, '0')}`, mimeType: SHEET_MIME,
      appProperties: { td_role: 'db', td_seq: String(seq) }, parents: [state.rootId],
    },
  });
  await sheetsApi(created.id, '/values/A1:append', { ...APPEND, body: { values: [HEADER] } });
  // 兩台裝置同時開新的一份時，取最早建立的那份，多出來的丟垃圾桶
  const list = await listSheets();
  const winner = list.find((s) => s.seq === seq);
  if (winner && winner.id !== created.id) trashFile(created.id).catch(() => {});
  return list;
}

async function readRows(id) {
  const r = await sheetsApi(id, '/values/A2:G', { params: { valueRenderOption: 'UNFORMATTED_VALUE' } });
  return r.values || [];
}

function rowToMessage(r, sheetId) {
  return {
    id: String(r[0]), type: 'text', name: '', mime: 'text/plain', size: 0,
    time: Number(r[1]) || Date.now(),
    devid: String(r[2] || ''), devtype: String(r[3] || ''), devname: String(r[4] || ''),
    text: r[5] === undefined ? '' : String(r[5]),
    thumbId: '', w: 0, h: 0, link: '',
    sheetId,
  };
}

/** 讀一份試算表，同步到畫面上的訊息。有新增、修改或移除就回傳 true */
async function syncSheet(s) {
  const rows = await readRows(s.id);
  const live = new Set();
  let changed = false;
  for (const r of rows) {
    if (!r[0] || isDeleted(r)) continue;
    const m = rowToMessage(r, s.id);
    live.add(m.id);
    const old = messages.get(m.id);
    if (!old || old.text !== m.text || old.time !== m.time) changed = true;
    upsertMessage(m);
  }
  for (const m of [...messages.values()]) {
    if (m.sheetId === s.id && !live.has(m.id) && removeMessage(m.id)) changed = true;
  }
  s.loaded = true;
  s.count = live.size;
  return changed;
}

/** 啟動時：找出（或建立）試算表，載入最新一份；訊息太少就多載入前一份 */
export async function initSheets() {
  let list = await listSheets();
  if (!list.length) list = await createSheet(1);
  state.sheets = list;
  await syncSheet(active());
  let n = active().count;
  for (let s = olderUnloaded(); s && n < CFG.PAGE_SIZE; s = olderUnloaded()) {
    await syncSheet(s);
    n += s.count;
  }
}

/** 往上捲：多載入一份更早的試算表 */
export async function loadOlderTexts() {
  const s = olderUnloaded();
  if (s) await syncSheet(s);
}

/** Drive Changes 看到某個試算表檔案有變動時呼叫。有畫面要更新就回傳 true */
export async function handleSheetChange(ch) {
  const f = ch.file;
  let s = state.sheets.find((x) => x.id === ch.fileId);
  if (ch.removed || (f && f.trashed)) {
    if (!s) return false;
    return dropSheet(s);
  }
  if (!s) {
    // 其他裝置開了新的一份（輪替）：加進清單
    if (!f || !f.parents || !f.parents.includes(state.rootId)) return false;
    if (!f.appProperties || f.appProperties.td_role !== 'db' || state.sheets.some((x) => x.seq === seqOf(f))) return false;
    s = { id: f.id, seq: seqOf(f), loaded: false, count: 0 };
    state.sheets.push(s);
    state.sheets.sort((a, b) => a.seq - b.seq);
  }
  // 還沒載入的舊試算表不用讀，往上捲時才會讀；最新那份一定要讀
  if (!s.loaded && s !== active()) return false;
  return syncSheet(s);
}

/** 試算表被丟垃圾桶（自動清理，或使用者自己刪掉）：畫面上對應的訊息一起移除 */
async function dropSheet(s) {
  let changed = false;
  for (const m of [...messages.values()]) if (m.sheetId === s.id && removeMessage(m.id)) changed = true;
  state.sheets = state.sheets.filter((x) => x !== s);
  // 同時開新一份造成的重複被丟掉時，確認留下來的那份已經在清單裡
  for (const x of await listSheets()) {
    if (!state.sheets.some((y) => y.id === x.id || y.seq === x.seq)) state.sheets.push({ ...x, loaded: false, count: 0 });
  }
  state.sheets.sort((a, b) => a.seq - b.seq);
  return changed;
}

/**
 * 一次新增多列：rows 每列是 [id, 時間, 裝置 ID, 裝置類型, 裝置名稱, 文字]。回傳寫入的那份試算表。
 * 寫完這一份滿了就接著開下一份（wait = true 時等開好才回傳；一般送出訊息不用等）。
 */
export async function appendRows(rows, wait = false) {
  if (!state.sheets.length) state.sheets = await createSheet(1);
  const s = active();
  const res = await sheetsApi(s.id, '/values/A1:append', { ...APPEND, body: { values: rows.map((r) => [...r, '']) } });
  const rotate = rotateIfFull(s, res).catch((e) => console.warn('開新的文字試算表失敗，下次送出時再試', e));
  if (wait) await rotate;
  return s;
}

/** 新增一則文字訊息，回傳訊息物件 */
export async function appendText({ id, time, text, device }) {
  const row = [id, time, device.id, device.type, device.name, text];
  const s = await appendRows([row]);
  return rowToMessage(row, s.id);
}

async function rotateIfFull(s, res) {
  // updatedRange 例如 "工作表1!A2001:G2001"：最後的數字是列號，扣掉標題列就是第幾則
  const m = /(\d+)$/.exec((res && res.updates && res.updates.updatedRange) || '');
  if (!m || Number(m[1]) - 1 < maxRows() || s !== active()) return;
  const list = await createSheet(s.seq + 1);
  for (const x of list) if (!state.sheets.some((y) => y.id === x.id || y.seq === x.seq)) state.sheets.push({ ...x, loaded: false, count: 0 });
  state.sheets.sort((a, b) => a.seq - b.seq);
  const next = state.sheets.find((x) => x.seq === s.seq + 1);
  if (next) await syncSheet(next);   // 通常是空的；順便標成已載入，之後的變動會由 Changes 通知
}

/** 在指定試算表裡，把這些訊息 ID 所在列的 G 欄打上已刪除記號 */
async function markRows(sheetId, rows, ids) {
  const data = [];
  rows.forEach((r, i) => { if (ids.has(String(r[0])) && !isDeleted(r)) data.push({ range: `G${i + 2}`, values: [['1']] }); });
  if (data.length) await sheetsApi(sheetId, '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
}

/** 刪除一則文字訊息 */
export async function deleteText(m) {
  await markRows(m.sheetId, await readRows(m.sheetId), new Set([m.id]));
}

/**
 * 自動清理：cutoff（毫秒）之前的文字訊息標成已刪除。
 * 整份都過期的舊試算表（最後修改時間早於 cutoff，而且不是最新一份）直接丟垃圾桶，不用一列一列處理。
 */
export async function expireTexts(cutoff) {
  const list = await listSheets();
  const newest = list.length ? list[list.length - 1].seq : 0;
  for (const s of list) {
    if (s.seq !== newest && Date.parse(s.modifiedTime) < cutoff) { await trashFile(s.id); continue; }
    const rows = await readRows(s.id);
    await markRows(s.id, rows, new Set(rows.filter((r) => Number(r[1]) < cutoff).map((r) => String(r[0]))));
  }
}
