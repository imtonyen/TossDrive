/**
 * 互動：送出、選檔、拍照、拖曳、貼上、切換裝置標示、看大圖、背景暫停同步、關閉頁面提醒。
 * 登出需要動到很多模組，由 main.js 傳進來（ctx.logout），避免這裡反過來依賴 main.js。
 */
import { requestToken, tokenValid } from '../auth.js';
import { downloadMessage } from '../actions.js';
import { device } from '../device.js';
import { state } from '../state.js';
import { loadOlder, scheduleSync } from '../sync.js';
import { enqueueFiles, hasActiveUploads, sendText } from '../upload/queue.js';
import { $, toast } from '../utils/dom.js';
import { store } from '../utils/storage.js';
import { devIconName, devLabel, hydrateIcons, icon } from './icons.js';
import { closeLightbox, getLightboxMessage } from './lightbox.js';
import { setDot, showExpired, showLoginError } from './status.js';

function submitText() {
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autosize();
  sendText(text);
}

function autosize() {
  const t = $('text-input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 160) + 'px';
}

function hasFiles(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}

export function bindUI({ logout }) {
  hydrateIcons();

  /* ----- 登入 / 登出 / 載入更多 ----- */
  $('login-btn').addEventListener('click', () => {
    showLoginError('');
    if (!requestToken()) toast('Google 登入元件還在載入，請稍後再試');
  });
  $('reauth-btn').addEventListener('click', () => {
    if (!requestToken()) toast('Google 登入元件還在載入，請稍後再試');
  });
  $('logout-btn').addEventListener('click', logout);
  $('load-older').addEventListener('click', loadOlder);

  /* ----- 切換這台裝置的標示（手機 / 電腦） ----- */
  const devBtn = $('device-btn');
  const paintDevBtn = () => devBtn.replaceChildren(icon(devIconName(device.type)));
  paintDevBtn();
  devBtn.addEventListener('click', () => {
    device.type = device.type === 'phone' ? 'desktop' : 'phone';
    store.set('devtype', device.type);
    paintDevBtn();
    toast(`這台裝置現在標示為「${devLabel(device.type)}」（${device.name}）`);
  });

  /* ----- 輸入列 ----- */
  const input = $('text-input');
  const coarse = matchMedia('(pointer: coarse)').matches;
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    // 電腦：Enter 送出、Shift+Enter 換行；注音等輸入法選字中（isComposing / 229）不送出
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !coarse) {
      e.preventDefault();
      submitText();
    }
  });
  $('send-btn').addEventListener('click', () => { submitText(); input.focus(); });
  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('camera-btn').addEventListener('click', () => $('camera-input').click());
  for (const id of ['file-input', 'camera-input']) {
    $(id).addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';   // 清空，同一個檔案才能再選一次
      if (files.length) enqueueFiles(files);
    });
  }

  /* ----- 拖曳檔案到視窗（電腦） ----- */
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !state.chatStarted) return;
    e.preventDefault();
    dragDepth++;
    $('drop-overlay').hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('drop-overlay').hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop-overlay').hidden = true;
    if (state.chatStarted && e.dataTransfer.files.length) enqueueFiles(Array.from(e.dataTransfer.files));
  });

  /* ----- Ctrl+V 貼上截圖或檔案（貼文字照常進輸入框） ----- */
  document.addEventListener('paste', (e) => {
    if (!state.chatStarted || !e.clipboardData || !e.clipboardData.files.length) return;
    e.preventDefault();
    enqueueFiles(Array.from(e.clipboardData.files));
  });

  /* ----- 看大圖 ----- */
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox-download').addEventListener('click', () => {
    const m = getLightboxMessage();
    if (m) downloadMessage(m);
  });
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('lightbox').hidden) closeLightbox(); });

  /* ----- 頁面切到背景就暫停同步，回到前景馬上同步一次 ----- */
  document.addEventListener('visibilitychange', () => {
    if (!state.chatStarted || !state.booted) return;
    if (document.hidden) { setDot('idle', '背景暫停中'); return; }
    if (!tokenValid()) { showExpired(); return; }
    scheduleSync(0);
  });
  window.addEventListener('online', () => {
    if (state.chatStarted && state.booted && tokenValid()) scheduleSync(0);
  });

  /* ----- 還有檔案在上傳時，關閉頁面前提醒 ----- */
  window.addEventListener('beforeunload', (e) => {
    if (hasActiveUploads()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
