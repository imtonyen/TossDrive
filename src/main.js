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
import {
  cancelAllUploads, hasUnfinishedUploads, removeUpload, restorePendingUploads, retryUpload, setPendingOwner,
} from './upload/queue.js';
import { clearPending } from './upload/persist.js';
import { bindUI } from './ui/events.js';
import { openLightbox } from './ui/lightbox.js';
import { configureRender, resetView, scheduleRender } from './ui/render.js';
import {
  hideExpired, setDot, showExpired, showFramedNotice, showLoginError, showView, updateLoginButton,
} from './ui/status.js';
import { $, toast } from './utils/dom.js';
import { sleep } from './utils/async.js';

/* ---------- 登入流程的回呼 ---------- */

function onExpired() {
  showExpired();
  scheduleRender();   // 上傳中的訊息要改顯示「登入已過期」
}

function onTokenAcquired() {
  hideExpired();
  scheduleRender();
  if (!state.chatStarted) enterChat();
  else scheduleSync(0);
}

function showEmail() {
  $('account-email').textContent = auth.email;
  $('account-email').title = auth.email;
}

/**
 * 在背景向 Google 確認目前登入的是哪個帳號，不擋住進聊天室。
 * 記住的 email 只是上次的提示（重新登入時可能換了帳號），補傳前一定要確認，才不會傳錯 Drive。
 */
async function verifyEmail() {
  for (let i = 0; i < 5 && state.chatStarted; i++) {
    try {
      const about = await api('/about', { params: { fields: 'user(emailAddress)' } });
      const email = (about.user && about.user.emailAddress) || '';
      if (!state.chatStarted || !email) return '';
      if (auth.email !== email) {
        auth.email = email;
        saveToken();
        showEmail();
        updateLoginButton();
      }
      setPendingOwner(email);
      return email;
    } catch (e) {
      await sleep(3000);
    }
  }
  return '';
}

/** 上次沒傳完的訊息：知道是哪個帳號後放回佇列（只補傳到同一個帳號） */
async function resumePending() {
  const email = await verifyEmail();
  if (email && state.chatStarted) await restorePendingUploads(email);
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
  showEmail();
  setDot('idle', '連線中…');
  resumePending().catch((e) => console.warn('補傳上次的訊息失敗', e));
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
  if (hasUnfinishedUploads() && !confirm('還有訊息還沒傳完，登出後會被丟掉。確定要登出嗎？')) return;
  cancelAllUploads();
  clearPending();
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

/** 版號從 package.json 讀（發版時只要改那一個地方），讀不到就不顯示 */
async function showVersion() {
  try {
    const res = await fetch('package.json', { cache: 'no-cache' });
    const { version } = await res.json();
    if (!version) return;
    for (const el of document.querySelectorAll('.app-version')) { el.textContent = 'v' + version; el.hidden = false; }
  } catch (e) { /* 離線或讀不到：不顯示 */ }
}

function init() {
  // 防點擊劫持：GitHub Pages 不能設 X-Frame-Options，<meta> CSP 也不支援 frame-ancestors，只能在這裡擋
  if (window.top !== window.self) { showFramedNotice(); return; }

  showVersion();
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
