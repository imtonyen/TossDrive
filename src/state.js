/** 全站共用的資料：各模組讀寫這裡，不直接互相持有對方的內部變數 */

export const state = {
  rootId: '',            // Drive 裡 TossDrive 資料夾的 ID
  thumbsId: '',          // _thumbs（縮圖）資料夾的 ID
  sheets: [],            // 存放文字訊息的試算表 [{ id, seq, loaded, count }]，由舊到新，最後一份是目前寫入的
  nextPageToken: null,   // 載入更早訊息用
  booted: false,         // 首次載入是否完成
  chatStarted: false,    // 是否已進入聊天室
};

export const messages = new Map();      // id → 訊息物件（已存在 Drive 的）
export const uploads = [];              // 上傳中 / 失敗的訊息（只存在這台裝置的畫面）
export const textCache = new Map();     // id → 長文字內容（沒有存在說明欄位的）
export const textLoading = new Set();
export const thumbPromises = new Map(); // 縮圖 key → Promise<objectURL>
export const localFiles = new Map();    // 訊息 id → 這台裝置剛上傳的原始 File（下載、看大圖不用重抓）

/** 資料夾準備好之後才能上傳；登出再登入時會重置 */
export const gate = {
  promise: null,
  resolve: null,
  reset() { this.promise = new Promise((r) => { this.resolve = r; }); },
};
gate.reset();
