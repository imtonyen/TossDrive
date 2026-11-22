/**
 * 設定與常數
 * 使用者可改的設定在專案根目錄的 config.js（window.TOSSDRIVE_CONFIG），這裡把它和預設值合併。
 */
export const CFG = Object.assign({
  CLIENT_ID: '',
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
  FOLDER_NAME: 'TossDrive',
  POLL_INTERVAL_MS: 3000,
  RETENTION_DAYS: 0,
  PAGE_SIZE: 40,
  TEXT_SHEET_MAX: 2000,
}, window.TOSSDRIVE_CONFIG || {});

export const API = 'https://www.googleapis.com/drive/v3';
export const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const SHEETS_API = 'https://sheets.googleapis.com/v4';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

// 列出 / 上傳檔案時要求回傳的欄位
export const FILE_FIELDS = 'id,name,mimeType,size,createdTime,description,appProperties,parents,trashed,webContentLink';

export const SHEET_TEXT_MAX = 40000;                  // 試算表一格上限 50000 字，超過的文字改存成 .txt 檔
export const INLINE_TEXT_MAX = 1000;                  // （.txt 檔）這個字數以內的文字同時存在「說明」欄位
export const MULTIPART_MAX = 5 * 1024 * 1024;         // ≤ 5MB 用 multipart，否則可續傳
export const CHUNK_SIZE = 8 * 1024 * 1024;            // 可續傳每段大小（必須是 256KB 的倍數）
export const DIRECT_DOWNLOAD_MAX = 100 * 1024 * 1024; // 超過就改用 Drive 的下載連結
export const THUMB_MAX_EDGE = 480;                    // 縮圖長邊像素
export const IMG_BOX_MAX_W = 280;                     // 聊天室裡圖片框最大寬度（CSS 像素）
export const IMG_BOX_MAX_H = 360;                     // 聊天室裡圖片框最大高度（CSS 像素）
export const PENDING_PREVIEW_MAX = 220;               // 上傳中預覽圖最大邊長（CSS 像素，對應 style.css .pending-preview）
export const MAX_CONCURRENT_DOWNLOADS = 4;
