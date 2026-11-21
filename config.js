/**
 * TossDrive 設定檔
 * ------------------------------------------------------------
 * 部署前只需要改 CLIENT_ID，其他保持預設就能用。
 * 修改後重新整理網頁即可生效（GitHub Pages 需等 1～2 分鐘更新）。
 */
window.TOSSDRIVE_CONFIG = {
  // 【必填】Google Cloud Console 建立的「OAuth 用戶端 ID」（網頁應用程式類型）
  // 長得像：1234567890-abcdefg.apps.googleusercontent.com
  CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',

  // 要求的 Google 權限。
  // drive.file：只能看到、修改「TossDrive 自己建立的檔案」，看不到你 Drive 裡其他東西（最安全）。
  // 如果你希望「自己手動丟進 TossDrive 資料夾的檔案」也出現在聊天室，
  // 可改成 'https://www.googleapis.com/auth/drive'（可存取整個 Drive，登入時警告會比較嚴重）。
  SCOPES: 'https://www.googleapis.com/auth/drive.file',

  // Drive 裡專屬資料夾的名稱（第一次登入時自動建立在「我的雲端硬碟」底下）
  FOLDER_NAME: 'TossDrive',

  // 輪詢間隔（毫秒）：每隔多久檢查一次有沒有新訊息。頁面在背景時會自動暫停。
  POLL_INTERVAL_MS: 3000,

  // 訊息保留天數：0 = 永久保留；例如 30 = 超過 30 天的訊息與檔案會自動移到 Drive 垃圾桶。
  // （沒有伺服器，所以清理會在「任一台裝置打開 TossDrive 時」執行，每台裝置每天最多一次）
  RETENTION_DAYS: 0,

  // 一次載入幾則訊息（往上捲可再載入更早的）
  PAGE_SIZE: 40,
};
