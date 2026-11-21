/**
 * 登入（Google Identity Services）
 * 憑證保存與過期判斷、重新連線、等待憑證的佇列。
 * 本模組不碰畫面也不呼叫 Drive：需要通知畫面或載入資料時，透過 configureAuth() 註冊的回呼。
 */
import { CFG } from './constants.js';
import { store } from './utils/storage.js';

export const auth = {
  token: '',
  expiresAt: 0,
  email: '',
  forced: false,   // 被 API 回 401 時標記為失效（即使時間還沒到）
  waiters: [],     // 正在等憑證的 Promise
};

let handlers = {};
let tokenClient = null;
let gisLoaded = false;
let expiryTimer = null;

/**
 * 註冊回呼：
 *  - onExpired()          憑證過期（顯示提示條）
 *  - onTokenAcquired()    取得新憑證（可 async；載入 email、進聊天室或恢復同步）
 *  - onFailure(code)      登入失敗
 */
export function configureAuth(h) {
  handlers = h;
}

export const tokenValid = () => !!auth.token && !auth.forced && Date.now() < auth.expiresAt - 30000;
export const isGisLoaded = () => gisLoaded;

/** 取得可用的憑證；過期時通知畫面並等使用者重新連線 */
export async function getToken() {
  while (!tokenValid()) {
    if (handlers.onExpired) handlers.onExpired();
    await new Promise((resolve) => auth.waiters.push(resolve));
  }
  return auth.token;
}

/** API 回 401 時呼叫：把目前憑證視為失效 */
export function markInvalid() {
  auth.forced = true;
}

function armExpiryTimer() {
  clearTimeout(expiryTimer);
  const ms = auth.expiresAt - 30000 - Date.now();
  expiryTimer = setTimeout(() => { if (!tokenValid() && handlers.onExpired) handlers.onExpired(); }, Math.max(ms, 0));
}

export function saveToken() {
  store.set('token', JSON.stringify({ token: auth.token, expiresAt: auth.expiresAt }));
  if (auth.email) store.set('email', auth.email);
}

/** 啟動時還原上次的憑證；還有效回傳 true（1 小時內重新整理不用再登入） */
export function restoreSavedToken() {
  auth.email = store.get('email') || '';
  let saved = null;
  try { saved = JSON.parse(store.get('token') || 'null'); } catch (e) { /* 損毀就當沒有 */ }
  if (saved && saved.token && saved.expiresAt - 30000 > Date.now()) {
    auth.token = saved.token;
    auth.expiresAt = saved.expiresAt;
    armExpiryTimer();
    return true;
  }
  return false;
}

/** 登出：只清除這台裝置的登入狀態，不撤銷授權（不影響其他裝置） */
export function clearAuth() {
  clearTimeout(expiryTimer);
  store.remove('token');
  store.remove('email');
  auth.token = '';
  auth.email = '';
  auth.expiresAt = 0;
  auth.forced = false;
}

/** 載入 Google 登入元件，完成後呼叫 onLoaded */
export function loadGis(onLoaded) {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.defer = true;
  s.onload = () => { gisLoaded = true; onLoaded(); };
  document.head.append(s);
}

export function setupTokenClient() {
  if (tokenClient || !gisLoaded) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CFG.CLIENT_ID,
    scope: CFG.SCOPES,
    callback: onTokenResponse,
    error_callback: (err) => fail(err && err.type ? err.type : 'unknown'),
  });
}

/** 呼叫 Google 的授權視窗（必須由使用者點擊觸發，否則會被瀏覽器擋彈窗） */
export function requestToken() {
  if (!tokenClient) return false;
  tokenClient.requestAccessToken(auth.email ? { hint: auth.email } : {});
  return true;
}

function fail(code) {
  if (handlers.onFailure) handlers.onFailure(code);
}

async function onTokenResponse(resp) {
  if (resp.error) { fail(resp.error); return; }
  // Google 允許使用者只勾部分權限，這裡確認 Drive 權限有被勾選
  if (!google.accounts.oauth2.hasGrantedAllScopes(resp, CFG.SCOPES)) { fail('scope'); return; }

  auth.token = resp.access_token;
  auth.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
  auth.forced = false;
  saveToken();
  armExpiryTimer();

  if (handlers.onTokenAcquired) await handlers.onTokenAcquired();
  auth.waiters.splice(0).forEach((resolve) => resolve());
}

export function authErrorMessage(code) {
  switch (code) {
    case 'access_denied':
      return '存取被拒絕。請確認：① 你的帳號已加入 OAuth 同意畫面的「測試使用者」名單；② 授權時有勾選 Google Drive 的權限。';
    case 'popup_closed':
      return '登入視窗被關閉了，請再點一次。';
    case 'popup_failed_to_open':
      return '瀏覽器擋住了彈出視窗，請允許本網站的彈出視窗後再試一次。';
    case 'scope':
      return '你沒有勾選 Google Drive 的權限。請重新登入，並在授權畫面勾選所有權限。';
    case 'config':
      return '尚未設定 CLIENT_ID。請先編輯 config.js，填入 Google Cloud Console 建立的 OAuth 用戶端 ID（詳見 README.md）。';
    case 'gis':
      return '無法載入 Google 登入元件。請檢查網路，或關閉廣告攔截器後重新整理。';
    default:
      return '登入失敗（' + code + '），請再試一次。';
  }
}
