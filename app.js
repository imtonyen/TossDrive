/**
 * TossDrive 主程式
 * ------------------------------------------------------------
 * 純前端：Google 登入（GIS）→ 直接呼叫 Drive API v3 讀寫自己的 Drive。
 * 一個檔案 = 一則訊息，資料夾結構與欄位說明請見 PLAN.md 第 2 節。
 *
 * 程式分成幾個區塊（和 PLAN.md 第 7 節的模組規劃對應）：
 *   1. 工具函式      2. 裝置資訊      3. 登入（GIS）    4. Drive API
 *   5. 訊息資料      6. 同步          7. 渲染           8. 訊息元件
 *   9. 上傳         10. 互動         11. 自動清理       12. 啟動
 */
(function () {
  'use strict';

  /* =====================================================================
   * 設定（沒填的項目使用預設值）
   * ===================================================================== */
  const CFG = Object.assign({
    CLIENT_ID: '',
    SCOPES: 'https://www.googleapis.com/auth/drive.file',
    FOLDER_NAME: 'TossDrive',
    POLL_INTERVAL_MS: 3000,
    RETENTION_DAYS: 0,
    PAGE_SIZE: 40,
  }, window.TOSSDRIVE_CONFIG || {});

  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  // 列出 / 上傳檔案時要求回傳的欄位
  const FILE_FIELDS = 'id,name,mimeType,size,createdTime,description,appProperties,parents,trashed,webContentLink';

  const INLINE_TEXT_MAX = 1000;            // 這個字數以內的文字同時存在「說明」欄位
  const MULTIPART_MAX = 5 * 1024 * 1024;   // ≤ 5MB 用 multipart，否則可續傳
  const CHUNK_SIZE = 8 * 1024 * 1024;      // 可續傳每段大小（必須是 256KB 的倍數）
  const DIRECT_DOWNLOAD_MAX = 100 * 1024 * 1024; // 超過就改用 Drive 的下載連結
  const THUMB_MAX_EDGE = 480;              // 縮圖長邊像素
  const MAX_CONCURRENT_DOWNLOADS = 4;

  /* =====================================================================
   * 1. 工具函式
   * ===================================================================== */
  const $ = (id) => document.getElementById(id);

  /** 建立 DOM 元素（一律用 textContent / append，不使用 innerHTML，避免 XSS） */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');

  /** localStorage 包一層，隱私模式或被禁用時不會丟例外 */
  const store = {
    get(k) { try { return localStorage.getItem('tossdrive.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('tossdrive.' + k, v); } catch (e) { /* 忽略 */ } },
    remove(k) { try { localStorage.removeItem('tossdrive.' + k); } catch (e) { /* 忽略 */ } },
  };

  /** 同時執行數量限制（下載縮圖、文字時最多 4 個一起跑，避免塞車） */
  function createLimiter(max) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= max || !queue.length) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => { active--; next(); });
    };
    return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
  }
  const limitDownload = createLimiter(MAX_CONCURRENT_DOWNLOADS);

  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function stamp(d = new Date()) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** 日期分隔線文字：今天、昨天、11月19日（週四） */
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const key = dayKey(ts);
    if (key === dayKey(today)) return '今天';
    if (key === dayKey(today.getTime() - 86400000)) return '昨天';
    const wk = '日一二三四五六'[d.getDay()];
    const y = d.getFullYear() === today.getFullYear() ? '' : d.getFullYear() + '年';
    return `${y}${d.getMonth() + 1}月${d.getDate()}日（週${wk}）`;
  }

  /** 把文字裡的網址變成可點的連結（回傳節點陣列） */
  function linkify(text) {
    const out = [];
    const re = /https?:\/\/[^\s<>"'`]+/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      let url = m[0];
      const trail = url.match(/[.,;:!?)\]}'"。，；：！？）」』、]+$/); // 結尾標點不算網址的一部分
      if (trail) url = url.slice(0, -trail[0].length);
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
      last = m.index + url.length;
      re.lastIndex = last;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function fileIcon(mime, name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if ((mime || '').startsWith('image/')) return '🖼️';
    if ((mime || '').startsWith('video/')) return '🎬';
    if ((mime || '').startsWith('audio/')) return '🎵';
    if (mime === 'application/pdf' || ext === 'pdf') return '📕';
    if (/^(zip|rar|7z|tar|gz|tgz)$/.test(ext)) return '🗜️';
    if (/^(doc|docx|odt|rtf|txt|md)$/.test(ext)) return '📝';
    if (/^(xls|xlsx|csv|ods)$/.test(ext)) return '📊';
    if (/^(ppt|pptx|key|odp)$/.test(ext)) return '📽️';
    return '📄';
  }

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // 舊瀏覽器或非 https 環境的備用做法
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('已複製');
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name || 'download' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* =====================================================================
   * 2. 裝置資訊
   * ===================================================================== */
  const device = (() => {
    let id = store.get('devid');
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      id = Array.from(bytes, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
      store.set('devid', id);
    }
    const ua = navigator.userAgent;
    const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS 的 UA 會偽裝成 Mac
    const mobile = /iPhone|iPad|iPod|Android|Mobi/i.test(ua) || iPadOS;
    let name = '裝置';
    if (/iPhone/.test(ua)) name = 'iPhone';
    else if (/iPad/.test(ua) || iPadOS) name = 'iPad';
    else if (/Android/.test(ua)) name = 'Android';
    else if (/Macintosh/.test(ua)) name = 'Mac';
    else if (/Windows/.test(ua)) name = 'Windows';
    else if (/CrOS/.test(ua)) name = 'Chromebook';
    else if (/Linux/.test(ua)) name = 'Linux';
    return { id, name, type: store.get('devtype') || (mobile ? 'phone' : 'desktop') };
  })();

  const devIcon = (type) => (type === 'phone' ? '📱' : type === 'desktop' ? '💻' : '🌐');

  /* =====================================================================
   * 3. 登入（Google Identity Services）
   * ===================================================================== */
  const auth = {
    token: '',
    expiresAt: 0,
    email: '',
    forced: false,   // 被 API 回 401 時標記為失效（即使時間還沒到）
    waiters: [],     // 正在等憑證的 Promise
  };
  let tokenClient = null;
  let gisLoaded = false;
  let appInited = false;
  let expiryTimer = null;
  let chatStarted = false;

  const tokenValid = () => !!auth.token && !auth.forced && Date.now() < auth.expiresAt - 30000;

  /** 取得可用的憑證；過期時顯示提示條並等使用者重新連線 */
  async function getToken() {
    while (!tokenValid()) {
      showExpired();
      await new Promise((resolve) => auth.waiters.push(resolve));
    }
    return auth.token;
  }

  function showExpired() {
    if (!chatStarted) return;
    $('auth-banner').hidden = false;
    setDot('idle', '登入已過期');
  }

  function armExpiryTimer() {
    clearTimeout(expiryTimer);
    const ms = auth.expiresAt - 30000 - Date.now();
    expiryTimer = setTimeout(() => { if (!tokenValid()) { showExpired(); rerenderPending(); } }, Math.max(ms, 0));
  }

  function saveToken() {
    store.set('token', JSON.stringify({ token: auth.token, expiresAt: auth.expiresAt }));
    if (auth.email) store.set('email', auth.email);
  }

  /** 呼叫 Google 的授權視窗（必須由使用者點擊觸發，否則會被瀏覽器擋彈窗） */
  function requestToken() {
    if (!tokenClient) { toast('Google 登入元件還在載入，請稍後再試'); return; }
    const override = auth.email ? { hint: auth.email } : {};
    tokenClient.requestAccessToken(override);
  }

  function authErrorMessage(code) {
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

  function authFailed(code) {
    const msg = authErrorMessage(code);
    if (!chatStarted) showLoginError(msg);
    else toast(msg, 5000);
  }

  function showLoginError(msg) {
    const el = $('login-error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  function updateLoginButton() {
    const btn = $('login-btn');
    if (!CFG.CLIENT_ID || CFG.CLIENT_ID.includes('YOUR_CLIENT_ID')) {
      btn.disabled = true;
      btn.textContent = '尚未設定 CLIENT_ID';
    } else if (!gisLoaded) {
      btn.disabled = true;
      btn.textContent = '正在載入 Google 登入…';
    } else {
      btn.disabled = false;
      btn.textContent = auth.email ? `以 ${auth.email} 繼續` : '使用 Google 帳號登入';
    }
  }

  function setupTokenClient() {
    if (tokenClient || !gisLoaded || !appInited) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: CFG.SCOPES,
      callback: onTokenResponse,
      error_callback: (err) => authFailed(err && err.type ? err.type : 'unknown'),
    });
    updateLoginButton();
  }

  async function onTokenResponse(resp) {
    if (resp.error) { authFailed(resp.error); return; }
    // Google 允許使用者只勾部分權限，這裡確認 Drive 權限有被勾選
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, CFG.SCOPES)) { authFailed('scope'); return; }

    auth.token = resp.access_token;
    auth.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
    auth.forced = false;
    saveToken();
    armExpiryTimer();

    if (!auth.email) {
      try {
        const about = await api('/about', { params: { fields: 'user(emailAddress)' } });
        auth.email = (about.user && about.user.emailAddress) || '';
        saveToken();
      } catch (e) { /* 取不到 email 不影響使用 */ }
    }

    $('auth-banner').hidden = true;
    auth.waiters.splice(0).forEach((resolve) => resolve());
    rerenderPending();

    if (!chatStarted) enterChat();
    else scheduleSync(0);
  }

  function logout() {
    if (uploads.some((u) => u.status !== 'failed') && !confirm('還有檔案正在上傳，登出後會中斷。確定要登出嗎？')) return;
    // 只清除這台裝置的登入狀態，不撤銷授權（不影響其他裝置）
    cancelAllUploads();
    clearTimeout(sync.timer);
    clearTimeout(expiryTimer);
    store.remove('token');
    store.remove('email');
    auth.token = '';
    auth.email = '';
    auth.expiresAt = 0;
    auth.forced = false;
    resetData();
    chatStarted = false;
    $('auth-banner').hidden = true;
    showView('login');
    updateLoginButton();
  }

  /* =====================================================================
   * 4. Drive API
   * ===================================================================== */
  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function httpErrorFrom(res) {
    let msg = res.statusText || '請求失敗';
    try {
      const j = await res.json();
      if (j && j.error && j.error.message) msg = j.error.message;
    } catch (e) { /* 不是 JSON 就用預設訊息 */ }
    return new HttpError(res.status, `${msg} (${res.status})`);
  }

  /**
   * 共用的 Drive API 呼叫：自動帶憑證；401 時標記憑證失效並等使用者重新連線後重試。
   * opts.as：json（預設）/ blob / text / none
   */
  async function api(path, opts = {}) {
    const { method = 'GET', params, body, as = 'json', signal } = opts;
    let url = API + path;
    if (params) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) sp.set(k, String(v));
      url += '?' + sp;
    }
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const headers = { Authorization: 'Bearer ' + token };
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { method, signal, headers, body: body ? JSON.stringify(body) : undefined });
      if (res.status === 401 && attempt < 2) { auth.forced = true; continue; }
      if (!res.ok) throw await httpErrorFrom(res);
      if (as === 'blob') return res.blob();
      if (as === 'text') return res.text();
      if (as === 'none') return null;
      return res.json();
    }
  }

  /** 找（或建立）專屬資料夾，用隱藏屬性 td_role 辨識，資料夾被搬走也找得到 */
  async function findOrCreateFolder(role, parentId, name) {
    const find = async () => {
      const q = [
        `mimeType='${FOLDER_MIME}'`,
        'trashed=false',
        `appProperties has { key='td_role' and value='${role}' }`,
      ];
      if (parentId) q.push(`'${parentId}' in parents`);
      const r = await api('/files', {
        params: { q: q.join(' and '), fields: 'files(id)', orderBy: 'createdTime', pageSize: 10, spaces: 'drive' },
      });
      return r.files.length ? r.files[0].id : null;
    };
    const found = await find();
    if (found) return found;
    await api('/files', {
      method: 'POST',
      params: { fields: 'id' },
      body: {
        name, mimeType: FOLDER_MIME, appProperties: { td_role: role },
        ...(parentId ? { parents: [parentId] } : {}),
      },
    });
    // 兩台裝置同時第一次登入時可能各建了一個，重新查詢取最早建立的那個，大家就會收斂到同一個
    return (await find());
  }

  /** 把檔案移到垃圾桶（30 天內可在 Drive 還原） */
  function trashFile(id) {
    return api('/files/' + id, { method: 'PATCH', params: { fields: 'id' }, body: { trashed: true } });
  }

  /* =====================================================================
   * 5. 訊息資料
   * ===================================================================== */
  const state = {
    rootId: '',
    thumbsId: '',
    nextPageToken: null,   // 載入更早訊息用
    booted: false,
  };
  const messages = new Map();      // id → 訊息物件（已存在 Drive 的）
  const uploads = [];              // 上傳中 / 失敗的訊息（只存在這台裝置的畫面）
  const textCache = new Map();     // id → 長文字內容（沒有存在說明欄位的）
  const textLoading = new Set();
  const thumbPromises = new Map(); // 縮圖 key → Promise<objectURL>
  const localFiles = new Map();    // 訊息 id → 這台裝置剛上傳的原始 File（下載、看大圖不用重抓）
  let readyResolve;
  let ready = new Promise((r) => { readyResolve = r; });

  /** Drive 檔案 → 訊息物件 */
  function fileToMessage(f) {
    const p = f.appProperties || {};
    const mime = f.mimeType || '';
    // 不是 TossDrive 建立的檔案（用完整 drive 權限手動丟進資料夾的）也能顯示
    const type = p.td_type || (mime.startsWith('image/') ? 'image' : 'file');
    const inline = p.td_inline === '1';
    return {
      id: f.id,
      type,
      name: f.name || '',
      mime,
      size: Number(f.size || 0),
      time: Date.parse(f.createdTime) || Date.now(),
      devid: p.td_devid || '',
      devtype: p.td_dev || '',
      devname: p.td_devname || '',
      text: type === 'text' && inline ? (f.description || '') : undefined,
      thumbId: p.td_thumb || '',
      w: Number(p.td_w) || 0,
      h: Number(p.td_h) || 0,
      link: f.webContentLink || '',
    };
  }

  const getText = (m) => (m.text !== undefined ? m.text : textCache.get(m.id));

  function upsertMessage(m) {
    messages.set(m.id, m);
  }

  function removeMessage(id) {
    const m = messages.get(id);
    if (!m) return false;
    messages.delete(id);
    localFiles.delete(id);
    textCache.delete(id);
    if (m.thumbId && thumbPromises.has(m.thumbId)) {
      thumbPromises.get(m.thumbId).then((u) => URL.revokeObjectURL(u), () => {});
      thumbPromises.delete(m.thumbId);
    }
    return true;
  }

  /** 登出時清空所有資料 */
  function resetData() {
    for (const p of thumbPromises.values()) p.then((u) => URL.revokeObjectURL(u), () => {});
    thumbPromises.clear();
    messages.clear();
    uploads.length = 0;
    textCache.clear();
    textLoading.clear();
    localFiles.clear();
    els.clear();
    $('messages').replaceChildren();
    state.rootId = state.thumbsId = '';
    state.nextPageToken = null;
    state.booted = false;
    sync.pageToken = null;
    sync.failures = 0;
    ready = new Promise((r) => { readyResolve = r; });
  }

  /** 長文字（沒有存在說明欄位）需要另外下載內容 */
  function ensureText(m) {
    if (m.text !== undefined || textCache.has(m.id) || textLoading.has(m.id)) return;
    textLoading.add(m.id);
    limitDownload(() => api('/files/' + m.id, { params: { alt: 'media' }, as: 'text' }))
      .then((t) => textCache.set(m.id, t))
      .catch(() => textCache.set(m.id, '⚠ 無法載入這則訊息的內容'))
      .finally(() => { textLoading.delete(m.id); scheduleRender(); });
  }

  /* =====================================================================
   * 6. 同步（首次載入、載入更早、Changes 輪詢、背景暫停、錯誤退避）
   * ===================================================================== */
  const sync = { pageToken: null, timer: null, running: false, failures: 0 };

  function setDot(kind, title) {
    const dot = $('sync-dot');
    dot.className = 'sync-dot' + (kind === 'ok' ? ' ok' : kind === 'error' ? ' error' : '');
    dot.title = title || '同步狀態';
  }

  async function listMessages(pageToken) {
    return api('/files', {
      params: {
        q: `'${state.rootId}' in parents and trashed=false and mimeType != '${FOLDER_MIME}'`,
        orderBy: 'createdTime desc',
        pageSize: CFG.PAGE_SIZE,
        pageToken,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        spaces: 'drive',
      },
    });
  }

  /** 啟動時：建立資料夾 → 記下 Changes 起點 → 載入最新一頁訊息 → 開始輪詢 */
  async function bootstrap() {
    $('loading-hint').hidden = false;
    state.rootId = await findOrCreateFolder('root', null, CFG.FOLDER_NAME);
    state.thumbsId = await findOrCreateFolder('thumbs', state.rootId, '_thumbs（縮圖）');
    $('drive-link').href = 'https://drive.google.com/drive/folders/' + state.rootId;

    // 先取 Changes 起點、再列訊息，這樣兩者之間發生的變動不會漏掉
    sync.pageToken = (await api('/changes/startPageToken', { params: { spaces: 'drive' } })).startPageToken;
    const page = await listMessages();
    for (const f of page.files) upsertMessage(fileToMessage(f));
    state.nextPageToken = page.nextPageToken || null;
    state.booted = true;
    $('loading-hint').hidden = true;
    render({ bottom: true });
    readyResolve();
    setDot('ok', '同步正常');
    scheduleSync(CFG.POLL_INTERVAL_MS);
    maybeCleanup().catch((e) => console.warn('自動清理失敗', e));
  }

  async function loadOlder() {
    if (!state.nextPageToken) return;
    const btn = $('load-older');
    btn.disabled = true;
    try {
      const timeline = $('timeline');
      const page = await listMessages(state.nextPageToken);
      const prevHeight = timeline.scrollHeight;
      const prevTop = timeline.scrollTop;
      for (const f of page.files) upsertMessage(fileToMessage(f));
      state.nextPageToken = page.nextPageToken || null;
      render();
      // 維持原本看的位置，不要被新載入的舊訊息推走
      timeline.scrollTop = prevTop + (timeline.scrollHeight - prevHeight);
    } catch (e) {
      toast('載入失敗：' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  function scheduleSync(delay) {
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
    if (changed) render();
  }

  /* =====================================================================
   * 7. 渲染（元素重複使用，圖片不會重新載入）
   * ===================================================================== */
  const els = new Map();   // key → { el, sig, refs }
  let renderQueued = null;
  let imgObserver = null;

  function scheduleRender(opts) {
    renderQueued = Object.assign(renderQueued || {}, opts || {});
    if (renderQueued.raf) return;
    renderQueued.raf = requestAnimationFrame(() => {
      const o = renderQueued;
      renderQueued = null;
      render(o);
    });
  }

  /** 以 sig（內容簽章）判斷要不要重建元素；簽章沒變就原樣重用 */
  function reuse(key, sig, build) {
    let c = els.get(key);
    if (!c || c.sig !== sig) {
      c = { sig, ...build() };
      els.set(key, c);
    }
    return c;
  }

  function render({ bottom = false } = {}) {
    const timeline = $('timeline');
    const container = $('messages');
    const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 120;

    const list = [...messages.values()].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
    const nodes = [];
    const used = new Set();
    let lastDay = '';
    const addSep = (ts) => {
      const k = dayKey(ts);
      if (k === lastDay) return;
      lastDay = k;
      const key = 'd:' + k;
      const c = reuse(key, dayLabel(ts), () => ({ el: h('div', { class: 'day-sep', text: dayLabel(ts) }) }));
      used.add(key);
      nodes.push(c.el);
    };

    for (const m of list) {
      addSep(m.time);
      const key = 'm:' + m.id;
      const text = m.type === 'text' ? getText(m) : '';
      const sig = JSON.stringify([m.type, m.name, m.size, m.time, m.devid, m.devname, m.devtype, text, m.thumbId, m.w, m.h]);
      const c = reuse(key, sig, () => ({ el: buildMessage(m) }));
      used.add(key);
      nodes.push(c.el);
      if (m.type === 'text') ensureText(m);
    }
    for (const u of uploads) {
      addSep(u.createdAt);
      const key = 'p:' + u.localId;
      const c = reuse(key, pendingSig(u), () => buildPending(u));
      used.add(key);
      nodes.push(c.el);
    }

    // 只在順序不對時才搬動元素
    nodes.forEach((n, i) => {
      if (container.children[i] !== n) container.insertBefore(n, container.children[i] || null);
    });
    while (container.children.length > nodes.length) container.lastChild.remove();
    for (const k of [...els.keys()]) if (!used.has(k)) els.delete(k);

    $('load-older').hidden = !state.nextPageToken;
    $('empty-hint').hidden = !(state.booted && nodes.length === 0);

    if (bottom || nearBottom) timeline.scrollTop = timeline.scrollHeight;
  }

  /** 延遲載入縮圖：元素快進入畫面時才下載 */
  function observeImage(box, loader) {
    if (!imgObserver) {
      imgObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          imgObserver.unobserve(e.target);
          if (e.target._load) e.target._load();
        }
      }, { root: $('timeline'), rootMargin: '300px' });
    }
    box._load = loader;
    imgObserver.observe(box);
  }

  /* =====================================================================
   * 8. 訊息元件
   * ===================================================================== */
  function fileCard(name, size, icon) {
    return h('div', { class: 'file-card' },
      h('div', { class: 'file-icon', text: icon }),
      h('div', { class: 'file-info' },
        h('div', { class: 'file-name', text: name }),
        h('div', { class: 'file-size', text: fmtSize(size) })));
  }

  function act(label, onClick, danger) {
    return h('button', { class: 'act' + (danger ? ' danger' : ''), text: label, onclick: onClick });
  }

  /** 縮圖框的大小：依原圖比例預留版面，避免圖片載入時畫面跳動 */
  function imgBoxStyle(w, h2) {
    if (!w || !h2) { w = 4; h2 = 3; }
    const width = Math.round(Math.min(280, (360 * w) / h2));
    return `width:${width}px;aspect-ratio:${w} / ${h2}`;
  }

  /** 取得縮圖的本機 URL（有快取、有同時下載數量限制） */
  function getThumbUrl(m) {
    const key = m.thumbId || 'o:' + m.id;
    if (thumbPromises.has(key)) return thumbPromises.get(key);
    const p = limitDownload(async () => {
      let blob = null;
      if (m.thumbId) {
        try { blob = await api('/files/' + m.thumbId, { params: { alt: 'media' }, as: 'blob' }); }
        catch (e) { if (e.status !== 404) throw e; }
      }
      // 沒有縮圖（例如手動丟進資料夾的圖片）→ 檔案不大就直接用原圖
      if (!blob && m.size <= MULTIPART_MAX) {
        blob = await api('/files/' + m.id, { params: { alt: 'media' }, as: 'blob' });
      }
      if (!blob) throw new Error('沒有縮圖');
      return URL.createObjectURL(blob);
    });
    p.catch(() => thumbPromises.delete(key));
    thumbPromises.set(key, p);
    return p;
  }

  function buildImageBox(m) {
    const img = h('img', { alt: m.name, draggable: 'false' });
    const box = h('div', { class: 'img-box placeholder', 'data-label': '🖼️', style: imgBoxStyle(m.w, m.h), onclick: () => openLightbox(m) }, img);
    observeImage(box, () => {
      box.className = 'img-box loading';
      box.dataset.label = '載入中…';
      getThumbUrl(m).then((url) => {
        img.src = url;
        box.className = 'img-box';
      }).catch(() => {
        box.className = 'img-box error';
        box.dataset.label = '無法載入';
      });
    });
    return box;
  }

  /** 已存在 Drive 的訊息 */
  function buildMessage(m) {
    const mine = m.devid === device.id;
    const meta = h('div', { class: 'meta', text: `${devIcon(m.devtype)} ${m.devname || '未知裝置'} · ${fmtTime(m.time)}` });
    let body;
    const actions = [];

    if (m.type === 'text') {
      const text = getText(m);
      body = text === undefined
        ? h('div', { class: 'text muted', text: '載入中…' })
        : h('div', { class: 'text' }, linkify(text));
      if (text !== undefined) actions.push(act('📋 複製', () => copyText(text)));
    } else if (m.type === 'image') {
      body = h('div', {}, buildImageBox(m), h('div', { class: 'caption', text: `${m.name} · ${fmtSize(m.size)}` }));
      actions.push(act('⬇ 下載', () => downloadMessage(m)));
    } else {
      body = fileCard(m.name, m.size, fileIcon(m.mime, m.name));
      actions.push(act('⬇ 下載', () => downloadMessage(m)));
    }
    actions.push(act('🗑 刪除', () => deleteMessage(m), true));

    const bubble = h('div', { class: 'bubble' }, meta, body, h('div', { class: 'actions' }, actions));
    return { el: h('div', { class: 'msg ' + (mine ? 'mine' : 'theirs') }, bubble) };
  }

  /** 上傳中 / 失敗的訊息 */
  const pendingSig = (u) => JSON.stringify([u.status, u.error, u.name, !tokenValid()]);

  function pendingStatusText(u) {
    if (u.status === 'failed') return '失敗：' + (u.error || '未知錯誤');
    if (u.status === 'queued') return '等待上傳…';
    if (!tokenValid()) return '登入已過期，重新連線後會繼續';
    return u.kind === 'file' ? `上傳中 ${Math.round(u.progress * 100)}%` : '傳送中…';
  }

  function buildPending(u) {
    const refs = {};
    const meta = h('div', { class: 'meta', text: `${devIcon(device.type)} ${device.name} · ${fmtTime(u.createdAt)}` });
    const body = [];
    if (u.kind === 'text') {
      body.push(h('div', { class: 'text' }, linkify(u.text)));
    } else if (u.previewUrl) {
      body.push(h('img', { class: 'pending-preview', src: u.previewUrl, alt: '' }));
      body.push(h('div', { class: 'caption', text: `${u.name} · ${fmtSize(u.size)}` }));
    } else {
      body.push(fileCard(u.name, u.size, fileIcon(u.mime, u.name)));
    }
    if (u.kind === 'file' && u.status !== 'failed') {
      refs.fill = h('div', { class: 'progress-fill', style: `width:${Math.round(u.progress * 100)}%` });
      body.push(h('div', { class: 'progress' }, refs.fill));
    }
    refs.status = h('div', { class: 'pending-status' + (u.status === 'failed' ? ' failed' : ''), text: pendingStatusText(u) });
    body.push(refs.status);

    const actions = u.status === 'failed'
      ? [act('↻ 重試', () => retryUpload(u)), act('✕ 移除', () => removeUpload(u), true)]
      : [act('✕ 取消', () => removeUpload(u), true)];
    const bubble = h('div', { class: 'bubble' }, meta, body, h('div', { class: 'actions' }, actions));
    return { el: h('div', { class: 'msg mine pending' }, bubble), refs };
  }

  /** 進度條更新：只改進度條，不重建整個元素 */
  function updateProgress(u) {
    const c = els.get('p:' + u.localId);
    if (!c || !c.refs) return;
    if (c.refs.fill) c.refs.fill.style.width = Math.round(u.progress * 100) + '%';
    c.refs.status.textContent = pendingStatusText(u);
  }

  const rerenderPending = () => scheduleRender();

  /* ---------- 看大圖 ---------- */
  let lightboxMsg = null;
  let lightboxFullUrl = '';

  async function openLightbox(m) {
    lightboxMsg = m;
    const lb = $('lightbox');
    const img = $('lightbox-img');
    $('lightbox-name').textContent = m.name;
    img.removeAttribute('src');
    lb.hidden = false;

    const mine = m;
    // 先顯示縮圖，再換成原圖
    getThumbUrl(m).then((url) => { if (lightboxMsg === mine && !lightboxFullUrl) img.src = url; }).catch(() => {});
    try {
      let url;
      if (localFiles.has(m.id)) {
        url = URL.createObjectURL(localFiles.get(m.id));
      } else {
        const blob = await limitDownload(() => api('/files/' + m.id, { params: { alt: 'media' }, as: 'blob' }));
        url = URL.createObjectURL(blob);
      }
      if (lightboxMsg !== mine) { URL.revokeObjectURL(url); return; }
      lightboxFullUrl = url;
      img.src = url;
    } catch (e) {
      if (lightboxMsg === mine) toast('原圖載入失敗：' + e.message);
    }
  }

  function closeLightbox() {
    $('lightbox').hidden = true;
    $('lightbox-img').removeAttribute('src');
    if (lightboxFullUrl) URL.revokeObjectURL(lightboxFullUrl);
    lightboxFullUrl = '';
    lightboxMsg = null;
  }

  /* ---------- 下載、刪除 ---------- */
  async function downloadMessage(m) {
    try {
      if (localFiles.has(m.id)) { saveBlob(localFiles.get(m.id), m.name); return; }
      if (m.size > DIRECT_DOWNLOAD_MAX) {
        // 太大的檔案不在網頁裡下載（會吃光記憶體），改用 Drive 的下載連結
        window.open(m.link || `https://drive.google.com/uc?export=download&id=${m.id}`, '_blank', 'noopener');
        toast('檔案較大，已改用 Google Drive 下載（需登入同一個 Google 帳號）', 4000);
        return;
      }
      toast('下載中…', 8000);
      const blob = await api('/files/' + m.id, { params: { alt: 'media' }, as: 'blob' });
      saveBlob(blob, m.name);
      $('toast').hidden = true;
    } catch (e) {
      toast('下載失敗：' + e.message);
    }
  }

  async function deleteMessage(m) {
    if (!confirm('刪除這則訊息？\n（會移到 Google Drive 垃圾桶，30 天內都救得回來，其他裝置也會同步消失）')) return;
    removeMessage(m.id);
    render();
    try {
      await trashFile(m.id);
      if (m.thumbId) trashFile(m.thumbId).catch(() => {});
    } catch (e) {
      upsertMessage(m);  // 刪除失敗，放回畫面
      render();
      toast('刪除失敗：' + e.message);
    }
  }

  /* =====================================================================
   * 9. 上傳（multipart、resumable、縮圖、佇列、進度、取消與重試）
   * ===================================================================== */
  let queueRunning = false;
  let nextLocalId = 1;

  /** 用 XHR 送出請求（fetch 拿不到上傳進度）。不丟 HTTP 錯誤，由呼叫端看 status。 */
  function xhr({ method, url, headers, body, signal, onProgress }) {
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open(method, url);
      for (const [k, v] of Object.entries(headers || {})) req.setRequestHeader(k, v);
      if (onProgress) req.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
      req.onload = () => resolve({ status: req.status, text: req.responseText, header: (n) => req.getResponseHeader(n) });
      req.onerror = () => reject(Object.assign(new Error('網路連線中斷'), { network: true }));
      req.ontimeout = req.onerror;
      req.onabort = () => reject(Object.assign(new Error('已取消'), { aborted: true }));
      if (signal) {
        if (signal.aborted) { req.abort(); return; }
        signal.addEventListener('abort', () => req.abort(), { once: true });
      }
      req.send(body);
    });
  }

  /** 帶憑證的 XHR：401 時等重新連線後重試 */
  async function xhrAuthed(opts, okStatuses = [200, 201]) {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const res = await xhr({ ...opts, headers: { ...opts.headers, Authorization: 'Bearer ' + token } });
      if (res.status === 401 && attempt < 2) { auth.forced = true; continue; }
      if (!okStatuses.includes(res.status)) throw responseError(res);
      return res;
    }
  }

  function responseError(res) {
    let msg = '上傳失敗';
    try { msg = JSON.parse(res.text).error.message || msg; } catch (e) { /* 用預設訊息 */ }
    return Object.assign(new HttpError(res.status, `${msg} (${res.status})`), { http: true });
  }

  /** multipart：中繼資料 + 檔案內容一次送出（≤ 5MB） */
  async function multipartUpload(meta, blob, mime, item, parentSignal) {
    const boundary = 'tossdrive' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(meta),
      `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const res = await xhrAuthed({
      method: 'POST',
      url: `${UPLOAD_API}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      signal: parentSignal,
      onProgress: item ? (loaded) => setProgress(item, Math.min(loaded / body.size, 1)) : null,
    });
    return JSON.parse(res.text);
  }

  /**
   * 可續傳上傳（> 5MB）：每次送 8MB，斷線自動重試並從中斷處接續。
   * 上傳位址（session URI）本身就帶有授權資訊，所以傳資料時不帶憑證，
   * 這樣上傳到一半憑證過期也不會中斷。
   */
  async function resumableUpload(meta, file, mime, item) {
    const signal = item.abort.signal;
    if (!item.sessionUri) {
      const res = await xhrAuthed({
        method: 'POST',
        url: `${UPLOAD_API}/files?uploadType=resumable&fields=${encodeURIComponent(FILE_FIELDS)}`,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mime,
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify(meta),
        signal,
      });
      item.sessionUri = res.header('Location');
      if (!item.sessionUri) throw new Error('無法取得上傳位址');
      item.offset = 0;
    }

    let retries = 0;
    // 向 Google 查詢「已經收到多少」。Range 標頭讀不到時，保守地從最後確認的位置接續。
    const queryOffset = async () => {
      const res = await xhr({
        method: 'PUT', url: item.sessionUri, signal,
        headers: { 'Content-Range': `bytes */${file.size}` },
      });
      if (res.status === 200 || res.status === 201) return { done: JSON.parse(res.text) };
      if (res.status === 308) {
        const range = res.header('Range');
        return { offset: range ? parseInt(range.split('-')[1], 10) + 1 : item.offset };
      }
      throw responseError(res);
    };

    while (item.offset < file.size) {
      const start = item.offset;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      try {
        const res = await xhr({
          method: 'PUT', url: item.sessionUri, signal,
          headers: { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` },
          body: file.slice(start, end),
          onProgress: (loaded) => setProgress(item, (start + loaded) / file.size),
        });
        if (res.status === 200 || res.status === 201) return JSON.parse(res.text);
        if (res.status === 308) {
          const range = res.header('Range');
          item.offset = range ? parseInt(range.split('-')[1], 10) + 1 : end;
          setProgress(item, item.offset / file.size);
          retries = 0;
          continue;
        }
        if (res.status === 404 || res.status === 410) {   // 上傳位址過期，重新開始
          item.sessionUri = null;
          throw Object.assign(new Error('上傳階段已失效，請重試'), { sessionExpired: true });
        }
        if (res.status >= 500 || res.status === 429) throw Object.assign(new Error('伺服器忙碌'), { network: true });
        throw responseError(res);
      } catch (e) {
        if (e.aborted || e.sessionExpired || !(e.network || e.status >= 500 || e.status === 429)) throw e;
        if (++retries > 6) throw e;
        await sleep(Math.min(1000 * 2 ** retries, 15000));
        const q = await queryOffset().catch(() => ({ offset: item.offset }));
        if (q.done) return q.done;
        item.offset = q.offset;
      }
    }
    // 理論上最後一段就會拿到 200；萬一已經送完卻沒拿到結果，查詢一次
    const q = await queryOffset();
    if (q.done) return q.done;
    throw new Error('上傳未完成');
  }

  /** 在瀏覽器裡用 canvas 產生縮圖（長邊約 480px 的 JPEG），並取得原圖尺寸 */
  async function makeThumb(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('無法解碼圖片'));
        i.src = url;
      });
      const w = img.naturalWidth;
      const hgt = img.naturalHeight;
      if (!w || !hgt) throw new Error('無法取得圖片尺寸');
      const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(w, hgt));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(hgt * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';  // 透明背景的 PNG 轉 JPEG 會變黑，先鋪白底
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) throw new Error('縮圖產生失敗');
      return { blob, w, h: hgt };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function deviceProps(type) {
    return { td_type: type, td_dev: device.type, td_devname: device.name, td_devid: device.id };
  }

  function setProgress(item, frac) {
    item.progress = Math.max(0, Math.min(1, frac));
    updateProgress(item);
  }

  /** 把一則文字訊息放進上傳（文字會立刻送出，不排隊） */
  function sendText(text) {
    const item = newItem({ kind: 'text', text, type: 'text' });
    uploads.push(item);
    render({ bottom: true });
    runItem(item);
  }

  /** 把檔案放進佇列（一個一個傳，避免手機網路塞車） */
  function enqueueFiles(files) {
    for (let f of files) {
      // 手機拍照 / 貼上截圖的檔名常是 image.jpg / image.png，改成有時間的名稱方便辨識
      if (/^image\.\w+$/i.test(f.name) || !f.name) {
        const ext = (f.name.split('.')[1] || (f.type.split('/')[1] || 'bin')).replace('jpeg', 'jpg');
        f = new File([f], `${f.type.startsWith('image/') ? '照片' : '檔案'}_${stamp()}.${ext}`, { type: f.type, lastModified: f.lastModified });
      }
      const isImage = (f.type || '').startsWith('image/');
      const item = newItem({
        kind: 'file', file: f, name: f.name, size: f.size, mime: f.type || 'application/octet-stream',
        type: isImage ? 'image' : 'file',
        previewUrl: isImage ? URL.createObjectURL(f) : '',
      });
      uploads.push(item);
    }
    render({ bottom: true });
    runQueue();
  }

  function newItem(props) {
    return {
      localId: nextLocalId++, status: 'queued', progress: 0, error: '', createdAt: Date.now(),
      name: '', size: 0, mime: '', previewUrl: '', abort: null, cancelled: false,
      sessionUri: null, offset: 0, thumbId: '', thumbBlobUrl: '', w: 0, h: 0,
      ...props,
    };
  }

  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      for (;;) {
        const item = uploads.find((u) => u.kind === 'file' && u.status === 'queued');
        if (!item) break;
        await runItem(item);
      }
    } finally {
      queueRunning = false;
    }
  }

  async function runItem(item) {
    item.status = 'uploading';
    item.error = '';
    item.abort = new AbortController();
    scheduleRender();
    try {
      await ready;   // 資料夾準備好才能上傳
      const json = item.kind === 'text' ? await uploadText(item) : await uploadFile(item);
      completeItem(item, json);
    } catch (e) {
      if (item.cancelled || e.aborted) return;   // 使用者取消，畫面上已經移除
      console.warn('上傳失敗', e);
      item.status = 'failed';
      item.error = e.message || '未知錯誤';
      scheduleRender();
    }
  }

  async function uploadText(item) {
    const text = item.text;
    const inline = text.length <= INLINE_TEXT_MAX;
    const meta = {
      name: `訊息_${stamp()}.txt`,
      mimeType: 'text/plain',
      parents: [state.rootId],
      appProperties: { ...deviceProps('text'), td_inline: inline ? '1' : '0' },
    };
    if (inline) meta.description = text;   // 短文字同時存在說明欄位，列出訊息時一起拿到，不用逐一下載
    return multipartUpload(meta, new Blob([text], { type: 'text/plain' }), 'text/plain; charset=UTF-8', null, item.abort.signal);
  }

  async function uploadFile(item) {
    const file = item.file;
    const props = deviceProps(item.type);

    // 照片：先產生縮圖、上傳到 _thumbs，再上傳原圖
    if (item.type === 'image' && !item.thumbId) {
      try {
        const t = await makeThumb(file);
        const thumbJson = await multipartUpload({
          name: `${file.name}.thumb.jpg`,
          mimeType: 'image/jpeg',
          parents: [state.thumbsId],
          appProperties: { td_role: 'thumb' },
        }, t.blob, 'image/jpeg', null, item.abort.signal);
        item.thumbId = thumbJson.id;
        item.thumbBlobUrl = URL.createObjectURL(t.blob);  // 上傳完成後直接用這個顯示，不用重新下載
        item.w = t.w;
        item.h = t.h;
      } catch (e) {
        if (e.aborted || e.http || e.network) throw e;
        item.type = 'file';   // 瀏覽器解不開的圖片（例如 HEIC）當一般檔案傳
        props.td_type = 'file';
      }
    }
    if (item.type === 'image') {
      props.td_type = 'image';
      props.td_thumb = item.thumbId;
      props.td_w = String(item.w);
      props.td_h = String(item.h);
    }

    const meta = { name: file.name, mimeType: item.mime, parents: [state.rootId], appProperties: props };
    if (file.size <= MULTIPART_MAX) {
      return multipartUpload(meta, file, item.mime, item, item.abort.signal);
    }
    return resumableUpload(meta, file, item.mime, item);
  }

  function completeItem(item, json) {
    const m = fileToMessage(json);
    if (item.thumbBlobUrl) {
      if (m.thumbId) thumbPromises.set(m.thumbId, Promise.resolve(item.thumbBlobUrl));
      else URL.revokeObjectURL(item.thumbBlobUrl);
    }
    if (item.file) localFiles.set(m.id, item.file);
    if (m.type === 'text' && item.kind === 'text' && m.text === undefined) textCache.set(m.id, item.text);
    upsertMessage(m);
    dropItem(item);
    render({ bottom: true });
  }

  function dropItem(item) {
    const i = uploads.indexOf(item);
    if (i >= 0) uploads.splice(i, 1);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  /** 取消或移除：中斷上傳、把已上傳的縮圖丟垃圾桶 */
  function removeUpload(item) {
    item.cancelled = true;
    if (item.abort) item.abort.abort();
    if (item.thumbId) trashFile(item.thumbId).catch(() => {});
    if (item.thumbBlobUrl) URL.revokeObjectURL(item.thumbBlobUrl);
    dropItem(item);
    render();
  }

  function cancelAllUploads() {
    for (const u of [...uploads]) {
      u.cancelled = true;
      if (u.abort) u.abort.abort();
      if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      if (u.thumbBlobUrl) URL.revokeObjectURL(u.thumbBlobUrl);
    }
    uploads.length = 0;
  }

  function retryUpload(item) {
    item.status = 'queued';
    item.error = '';
    item.cancelled = false;
    item.progress = item.sessionUri ? item.offset / (item.size || 1) : 0;
    scheduleRender();
    if (item.kind === 'text') runItem(item);
    else runQueue();
  }

  /* =====================================================================
   * 10. 互動（送出、選檔、拍照、拖曳、貼上）
   * ===================================================================== */
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

  function bindUI() {
    $('login-btn').addEventListener('click', () => { showLoginError(''); requestToken(); });
    $('reauth-btn').addEventListener('click', requestToken);
    $('logout-btn').addEventListener('click', logout);
    $('load-older').addEventListener('click', loadOlder);

    // 切換這台裝置的標示（手機 / 電腦）
    const devBtn = $('device-btn');
    devBtn.textContent = devIcon(device.type);
    devBtn.addEventListener('click', () => {
      device.type = device.type === 'phone' ? 'desktop' : 'phone';
      store.set('devtype', device.type);
      devBtn.textContent = devIcon(device.type);
      toast(`這台裝置現在標示為 ${devIcon(device.type)} ${device.name}`);
    });

    // 輸入列
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

    // 拖曳檔案到視窗（電腦）
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !chatStarted) return; e.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      $('drop-overlay').hidden = true;
      if (chatStarted && e.dataTransfer.files.length) enqueueFiles(Array.from(e.dataTransfer.files));
    });

    // Ctrl+V 貼上截圖或檔案（貼文字照常進輸入框）
    document.addEventListener('paste', (e) => {
      if (!chatStarted || !e.clipboardData || !e.clipboardData.files.length) return;
      e.preventDefault();
      enqueueFiles(Array.from(e.clipboardData.files));
    });

    // 看大圖
    $('lightbox-close').addEventListener('click', closeLightbox);
    $('lightbox-download').addEventListener('click', () => { if (lightboxMsg) downloadMessage(lightboxMsg); });
    $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('lightbox').hidden) closeLightbox(); });

    // 頁面切到背景就暫停同步，回到前景馬上同步一次
    document.addEventListener('visibilitychange', () => {
      if (!chatStarted || !state.booted) return;
      if (document.hidden) { setDot('idle', '背景暫停中'); return; }
      if (!tokenValid()) { showExpired(); return; }
      scheduleSync(0);
    });
    window.addEventListener('online', () => { if (chatStarted && state.booted && tokenValid()) scheduleSync(0); });

    // 還有檔案在上傳時，關閉頁面前提醒
    window.addEventListener('beforeunload', (e) => {
      if (uploads.some((u) => u.status === 'uploading' || u.status === 'queued')) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* =====================================================================
   * 11. 自動清理（依 RETENTION_DAYS 把過期訊息與縮圖移到垃圾桶）
   * ===================================================================== */
  async function maybeCleanup() {
    const days = Number(CFG.RETENTION_DAYS) || 0;
    if (days <= 0) return;
    // 沒有伺服器可以定時跑，所以由任一台裝置打開網頁時執行，每台裝置每天最多一次
    if (Date.now() - Number(store.get('cleanup') || 0) < 86400000) return;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const q = `('${state.rootId}' in parents or '${state.thumbsId}' in parents) and trashed=false`
      + ` and createdTime < '${cutoff}' and mimeType != '${FOLDER_MIME}'`;
    let pageToken;
    do {
      const r = await api('/files', { params: { q, pageSize: 100, pageToken, fields: 'nextPageToken,files(id)', spaces: 'drive' } });
      await Promise.all(r.files.map((f) => limitDownload(() => trashFile(f.id))));
      pageToken = r.nextPageToken;
    } while (pageToken);
    store.set('cleanup', String(Date.now()));
  }

  /* =====================================================================
   * 12. 啟動
   * ===================================================================== */
  function showView(name) {
    $('login-view').hidden = name !== 'login';
    $('chat-view').hidden = name !== 'chat';
  }

  async function enterChat() {
    if (chatStarted) return;
    chatStarted = true;
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

  function init() {
    appInited = true;
    bindUI();
    auth.email = store.get('email') || '';

    if (!CFG.CLIENT_ID || CFG.CLIENT_ID.includes('YOUR_CLIENT_ID')) {
      showView('login');
      updateLoginButton();
      showLoginError(authErrorMessage('config'));
      return;
    }

    // 憑證還有效（1 小時內重新整理）→ 直接進聊天室，不用再登入
    let saved = null;
    try { saved = JSON.parse(store.get('token') || 'null'); } catch (e) { /* 損毀就當沒有 */ }
    if (saved && saved.token && saved.expiresAt - 30000 > Date.now()) {
      auth.token = saved.token;
      auth.expiresAt = saved.expiresAt;
      armExpiryTimer();
      enterChat();
    } else {
      showView('login');   // 過期或第一次 → 顯示「以 xxx 繼續」/「使用 Google 帳號登入」
    }
    updateLoginButton();
    setupTokenClient();
    setTimeout(() => { if (!gisLoaded) showLoginError(authErrorMessage('gis')); }, 10000);
  }

  // index.html 在 Google 登入元件載入完成時呼叫
  window.TossDrive = {
    onGisLoaded() {
      gisLoaded = true;
      setupTokenClient();
      updateLoginButton();
      if ($('login-error').textContent === authErrorMessage('gis')) showLoginError('');
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
