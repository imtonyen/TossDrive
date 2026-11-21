/** 畫面外殼：切換登入 / 聊天室畫面、同步狀態燈、登入過期提示條、登入按鈕與錯誤訊息 */
import { CFG } from '../constants.js';
import { auth, isGisLoaded } from '../auth.js';
import { state } from '../state.js';
import { $, h } from '../utils/dom.js';

/**
 * 被別的網站用 iframe 嵌入時（點擊劫持）：不啟動 App，只顯示「請直接開啟」。
 * 所有畫面在 HTML 裡預設都是 hidden，所以 iframe 擋掉 JS 時也只會是一片空白。
 */
export function showFramedNotice() {
  document.body.replaceChildren(
    h('section', { class: 'login' },
      h('div', { class: 'login-card' },
        h('h1', { text: 'TossDrive' }),
        h('p', { class: 'login-desc', text: '基於安全考量，TossDrive 不能嵌在其他網頁裡使用。' }),
        h('a', { class: 'btn-primary', href: location.href, target: '_blank', rel: 'noopener noreferrer', text: '在新分頁開啟' }))));
}

export function showView(name) {
  $('login-view').hidden = name !== 'login';
  $('chat-view').hidden = name !== 'chat';
}

/** 右上角同步狀態燈：ok（綠）/ error（紅）/ idle（灰） */
export function setDot(kind, title) {
  const dot = $('sync-dot');
  dot.className = 'sync-dot' + (kind === 'ok' ? ' ok' : kind === 'error' ? ' error' : '');
  dot.title = title || '同步狀態';
}

export function showExpired() {
  if (!state.chatStarted) return;
  $('auth-banner').hidden = false;
  setDot('idle', '登入已過期');
}

export function hideExpired() {
  $('auth-banner').hidden = true;
}

export function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.hidden = !msg;
}

export function updateLoginButton() {
  const btn = $('login-btn');
  if (!CFG.CLIENT_ID || CFG.CLIENT_ID.includes('YOUR_CLIENT_ID')) {
    btn.disabled = true;
    btn.textContent = '尚未設定 CLIENT_ID';
  } else if (!isGisLoaded()) {
    btn.disabled = true;
    btn.textContent = '正在載入 Google 登入…';
  } else {
    btn.disabled = false;
    btn.textContent = auth.email ? `以 ${auth.email} 繼續` : '使用 Google 帳號登入';
  }
}
