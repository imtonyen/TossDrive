/**
 * 還沒傳完的訊息存在這台裝置的 IndexedDB（瀏覽器內建的本機資料庫，不會上傳到任何地方），
 * 關掉頁面或重新整理後，下次打開會接著傳。傳完、取消、登出時刪掉。
 *
 * 每筆記錄標註所屬帳號（owner = email），只會補傳到同一個帳號的 Drive。
 * 同時開兩個分頁時，用 Web Locks 讓每筆只由一個分頁負責，避免重複上傳。
 * IndexedDB 不能用（隱私模式、空間不足）時就只存在記憶體，不影響送出。
 */
const DB_NAME = 'tossdrive';
const STORE = 'pending';
const FIELDS = ['pid', 'owner', 'kind', 'text', 'msgId', 'type', 'file', 'name', 'size', 'mime', 'createdAt', 'sessionUri', 'thumbId', 'w', 'h'];

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'pid' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { console.warn('無法使用本機暫存', e); return null; });
  }
  return dbPromise;
}

/** 對 store 做一件事，完成（或失敗）後 resolve；資料庫不能用時什麼都不做 */
async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    let result;
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = t.onabort = () => { console.warn('本機暫存失敗', t.error); resolve(undefined); };
    } catch (e) {
      console.warn('本機暫存失敗', e);
      resolve(undefined);
    }
  });
}

const toRecord = (item) => Object.fromEntries(FIELDS.map((k) => [k, item[k] === undefined ? null : item[k]]));

/** 新增或更新一筆（送出時、縮圖傳好時、拿到續傳位址時） */
export function savePending(item) {
  return tx('readwrite', (s) => s.put(toRecord(item)));
}

export function deletePending(pid) {
  return tx('readwrite', (s) => s.delete(pid));
}

/** 登出時全部清掉 */
export function clearPending() {
  return tx('readwrite', (s) => s.clear());
}

/** 第一次登入時送出的訊息，email 還沒查到：查到後補上 */
export async function assignOwner(email) {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  const orphans = all.filter((r) => !r.owner);
  if (!orphans.length) return;
  await tx('readwrite', (s) => { for (const r of orphans) s.put({ ...r, owner: email }); });
}

/** 讀出這個帳號還沒傳完的訊息（依送出時間排序），只回傳這個分頁搶到鎖的那些 */
export async function loadPending(email) {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  const mine = all.filter((r) => r.owner === email).sort((a, b) => a.createdAt - b.createdAt);
  const out = [];
  for (const r of mine) {
    const release = await holdLock(r.pid);
    if (release) out.push({ ...r, releaseLock: release });
  }
  return out;
}

/**
 * 取得這筆的鎖，回傳釋放用的函式；別的分頁正在負責就回傳 null。
 * 分頁關掉時瀏覽器會自動釋放。不支援 Web Locks 的瀏覽器一律當作拿到。
 */
export function holdLock(pid) {
  if (!navigator.locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    navigator.locks.request('tossdrive-pending-' + pid, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(null); return undefined; }
      return new Promise((release) => resolve(release));
    }).catch(() => resolve(() => {}));
  });
}
