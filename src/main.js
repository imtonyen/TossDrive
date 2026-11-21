/**
 * TossDrive 進入點
 * 把各模組接起來：註冊回呼、還原登入狀態、進入聊天室。
 *
 * 模組分工：
 *   constants / device / state          設定、裝置資訊、共用資料
 *   auth / drive                        登入（GIS）、Drive API
 *   messages / thumbs / cleanup         訊息資料、縮圖、自動清理
 *   sync                                首次載入、Changes 輪詢
 *   upload/*                            multipart、可續傳、縮圖產生、佇列
 *   ui/*                                渲染、訊息元件、看大圖、事件、圖示
 *   actions                             下載、刪除
 *   utils/*                             DOM、格式化、非同步、儲存
 */
import { CFG } from './constants.js';
import {
  auth, authErrorMessage, clearAuth, configureAuth, isGisLoaded, loadGis,
  restoreSavedToken, saveToken, setupTokenClient,
} from './auth.js';
import { api } from './drive.js';
import { state } from './state.js';
import { resetData } from './messages.js';
import { bootstrap, scheduleSync, stopSync } from './sync.js';
import { downloadMessage, deleteMessage } from './actions.js';
import { cancelAllUploads, hasUnfinishedUploads, removeUpload, retryUpload } from './upload/queue.js';
import { bindUI } from './ui/events.js';
import { openLightbox } from './ui/lightbox.js';
import { configureRender, resetView, scheduleRender } from './ui/render.js';
import { hideExpired, setDot, showExpired, showLoginError, showView, updateLoginButton } from './ui/status.js';
import { $, toast } from './utils/dom.js';
import { sleep } from './utils/async.js';

/* ---------- 登入流程的回呼 ---------- */

function onExpired() {
  showExpired();
  scheduleRender();   // 上傳中的訊息要改顯示「登入已過期」
}

async function onTokenAcquired() {
  if (!auth.email) {
    try {
      const about = await api('/about', { params: { fields: 'user(emailAddress)' } });
      auth.email = (about.user && about.user.emailAddress) || '';
      saveToken();
    } catch (e) { /* 取不到 email 不影響使用 */ }
  }
  hideExpired();
  scheduleRender();
  if (!state.chatStarted) enterChat();
  else scheduleSync(0);
}

function onFailure(code) {
  const msg = authErrorMessage(code);
  if (!state.chatStarted) showLoginError(msg);
  else toast(msg, 5000);
}

/* ---------- 進入 / 離開聊天室 ---------- */

async function enterChat() {
  if (state.chatStarted) return;
  state.chatStarted = true;
  showView('chat');
  $('account-email').textContent = auth.email;
  $('account-email').title = auth.email;
  setDot('idle', '連線中…');
  for (;;) {
    try {
      await bootstrap();
      return;
    } catch (e) {
      console.error('啟動失敗', e);
      $('loading-hint').hidden = false;
      $('loading-hint').textContent = `連線失敗：${e.message}。5 秒後自動重試…`;
      setDot('error', '連線失敗');
      await sleep(5000);
      $('loading-hint').textContent = '連線到 Google Drive 中…';
    }
  }
}

function logout() {
  if (hasUnfinishedUploads() && !confirm('還有檔案正在上傳，登出後會中斷。確定要登出嗎？')) return;
  cancelAllUploads();
  stopSync();
  clearAuth();
  resetData();
  resetView();
  state.chatStarted = false;
  hideExpired();
  showView('login');
  updateLoginButton();
}

/* ---------- 啟動 ---------- */

function init() {
  configureAuth({ onExpired, onTokenAcquired, onFailure });
  configureRender({
    onDownload: downloadMessage,
    onDelete: deleteMessage,
    onOpenImage: openLightbox,
    onRetry: retryUpload,
    onRemove: removeUpload,
  });
  bindUI({ logout });

  if (!CFG.CLIENT_ID || CFG.CLIENT_ID.includes('YOUR_CLIENT_ID')) {
    showView('login');
    updateLoginButton();
    showLoginError(authErrorMessage('config'));
    return;
  }

  // 憑證還有效（1 小時內重新整理）→ 直接進聊天室，不用再登入
  if (restoreSavedToken()) {
    enterChat();
  } else {
    showView('login');   // 過期或第一次 → 顯示「以 xxx 繼續」/「使用 Google 帳號登入」
  }
  updateLoginButton();

  loadGis(() => {
    setupTokenClient();
    updateLoginButton();
    if ($('login-error').textContent === authErrorMessage('gis')) showLoginError('');
  });
  setTimeout(() => { if (!isGisLoaded()) showLoginError(authErrorMessage('gis')); }, 10000);
}

init();
