# TossDrive

> **Toss it here, find it there.**
> 網頁版的「傳給自己的聊天室」。手機和電腦打開同一個網址，就能互傳文字、照片、檔案，所有資料存在**你自己的 Google Drive**。

- 純靜態網頁，部署在 GitHub Pages，不需要伺服器。
- 每台裝置用自己的 Google 帳號登入，網頁直接讀寫你 Drive 裡的 `TossDrive` 資料夾。
- 不設密碼：別人拿到網址，登入的也是他自己的 Drive，看不到你的資料。

完整的設計說明請看 [PLAN.md](PLAN.md)。

---

## 部署教學

整個流程約 15 分鐘，全部免費。

### 1. 建立 Google Cloud 專案

1. 打開 <https://console.cloud.google.com/>，用你的 Google 帳號登入。
2. 左上角專案選單 →「**新增專案**」，名稱填 `TossDrive`，按「建立」。
3. 確認上方已切換到剛建立的專案。

### 2. 啟用 Google Drive API

1. 左側選單 →「API 和服務」→「**程式庫**」。
2. 搜尋 `Google Drive API` → 點進去 →「**啟用**」。

### 3. 設定 OAuth 同意畫面

1. 「API 和服務」→「**OAuth 同意畫面**」（新版介面叫「Google Auth Platform」）。
2. 使用者類型選「**外部**」，按「建立」。
3. 填基本資料：應用程式名稱 `TossDrive`、使用者支援電子郵件和開發人員聯絡資訊填你的 Gmail。其他可留空。
4. **資料存取 / 範圍（Scopes）**：新增 `.../auth/drive.file`（「查看、編輯、建立及刪除這個應用程式的特定 Google 雲端硬碟檔案」）。
5. **目標對象 / 測試使用者（Test users）**：按「Add users」，把**你要登入的所有 Gmail**（手機和電腦用的帳號）加進去。
6. **發布狀態維持「測試中」，不要按「發布應用程式」。** 這樣只有名單裡的帳號能登入，最安全，也不需要 Google 審核。

> 測試中的應用程式，授權有效期限較短（約 7 天內可能要重新授權），這是正常的，點「重新連線」即可。

### 4. 建立 OAuth 用戶端 ID

1. 「API 和服務」→「**憑證**」→「建立憑證」→「**OAuth 用戶端 ID**」。
2. 應用程式類型選「**網頁應用程式**」，名稱隨意。
3. 「**已授權的 JavaScript 來源**」新增兩個（**不要**加結尾斜線、**不要**加路徑）：
   - `https://<你的GitHub帳號>.github.io`
   - `http://localhost:8080`（本機測試用）
4. 「已授權的重新導向 URI」**留空**（用不到）。
5. 按「建立」，複製畫面上的**用戶端 ID**（長得像 `1234567890-abcdefg.apps.googleusercontent.com`）。

### 5. 把用戶端 ID 填進 `config.js`

打開 [config.js](config.js)，把 `CLIENT_ID` 換成你剛複製的：

```js
CLIENT_ID: '1234567890-abcdefg.apps.googleusercontent.com',
```

> 用戶端 ID 不是機密，放在公開的 repo 沒有問題。真正把關的是「測試使用者名單」和 Google 登入。

### 6. 本機測試

```bash
cd TossDrive
python3 -m http.server 8080
```

瀏覽器打開 <http://localhost:8080>，按「使用 Google 帳號登入」，傳一則訊息試試。
成功的話，你的 Google Drive 會出現 `TossDrive` 資料夾，訊息就是裡面的檔案。

### 7. 部署到 GitHub Pages

1. 把這個專案推到 GitHub（repo 可以是 Public 或 Private，Private 需要 GitHub Pro 才能用 Pages）。
2. repo 的「Settings」→「**Pages**」→ Source 選「Deploy from a branch」，Branch 選 `main` / `/ (root)` →「Save」。
3. 等 1～2 分鐘，頁面上方會出現網址：`https://<帳號>.github.io/<repo名稱>/`。
4. 確認步驟 4 的「已授權的 JavaScript 來源」有填 `https://<帳號>.github.io`。

### 8. 手機、電腦都打開使用

兩台裝置分別打開同一個網址，**登入同一個 Google 帳號**，就能互傳了。
手機可以「加到主畫面」，用起來像 App。

---

## 使用方式

| 想做的事 | 怎麼做 |
| --- | --- |
| 傳文字 | 輸入後按「送出」。電腦按 Enter 送出、Shift+Enter 換行 |
| 傳檔案 / 照片 | 按 📎 選檔案，或（電腦）直接把檔案拖進視窗 |
| 手機拍照傳送 | 按 📷 |
| 貼上截圖 | 電腦按 Ctrl+V（Mac 是 ⌘+V） |
| 複製別台傳來的文字 | 訊息底下的「📋 複製」，網址會自動變成可點的連結 |
| 看大圖 / 下載 | 點縮圖看大圖；訊息底下有「⬇ 下載」 |
| 刪除訊息 | 訊息底下的「🗑 刪除」，會移到 Drive 垃圾桶，30 天內救得回來 |
| 在 Drive 開啟資料夾 | 右上角 📂 |
| 切換這台裝置的標示 | 右上角 📱 / 💻 |

右上角圓點是同步狀態：綠＝正常、灰＝暫停（頁面在背景或登入過期）、紅＝錯誤（會自動重試）。

## 設定（config.js）

| 設定 | 說明 | 預設 |
| --- | --- | --- |
| `CLIENT_ID` | OAuth 用戶端 ID，**必填** | — |
| `SCOPES` | Google 權限範圍，見下方說明 | `drive.file` |
| `FOLDER_NAME` | Drive 裡資料夾名稱 | `TossDrive` |
| `POLL_INTERVAL_MS` | 多久檢查一次新訊息（毫秒） | `3000` |
| `RETENTION_DAYS` | 訊息保留天數，`0` = 永久。超過的會自動移到垃圾桶（任一台裝置打開網頁時執行，每台每天最多一次） | `0` |
| `PAGE_SIZE` | 一次載入幾則訊息 | `40` |

**關於 `SCOPES`：** 預設的 `drive.file` 只能存取 TossDrive 自己建立的檔案，最安全；代價是你在 Drive 網頁上手動丟進 `TossDrive` 資料夾的檔案，聊天室看不到。
想要看得到，可改成 `https://www.googleapis.com/auth/drive`（可存取整個 Drive，登入時警告會比較嚴重）。

---

## 常見問題

### 登入時出現 `Error 400: origin_mismatch`
Google 認不得目前的網址。回到「憑證」→ 你的用戶端 ID →「已授權的 JavaScript 來源」，確認有**完全一致**的網址：
- 協定要對（`https://` 或 `http://`）、不能有結尾 `/`、不能有路徑。
- 本機是 `http://localhost:8080`（用 `127.0.0.1` 不算同一個來源）。
- 剛修改後要等幾分鐘才會生效。

### 登入時出現 `Error 403: access_denied`（或「應用程式尚未完成 Google 驗證」）
你的帳號沒有在「測試使用者」名單裡。到「OAuth 同意畫面」→「測試使用者」把這個 Gmail 加進去。

### 出現「Google 尚未驗證這個應用程式」警告
這是正常的（應用程式維持測試狀態、沒送 Google 審核）。點「進階」→「前往 TossDrive（不安全）」即可。因為這個應用程式是你自己建立的，只會存取你自己的 Drive。

### 登入後出現「你沒有勾選 Google Drive 的權限」
授權畫面上 Google 允許只勾部分權限。請重新登入，並把 Drive 那一項勾選起來。

### 載入失敗，錯誤訊息提到 `Google Drive API has not been used in project ... or it is disabled`
回到步驟 2 啟用 Google Drive API，等 1～2 分鐘後重新整理。

### 按登入沒有反應 / 沒有跳出視窗
瀏覽器擋住了彈出視窗。請在網址列允許本網站的彈出視窗，再按一次。

### 為什麼隔一小時要按「重新連線」？
純前端網頁拿到的 Google 憑證只有 1 小時效期，而且 Google 不允許網頁在背景自動續期，一定要使用者點一下。
- 1 小時內重新整理網頁：不用做任何事。
- 網頁開著超過 1 小時：上方會出現黃色提示條，點「點此重新連線」。
- 隔天再開：點「以 xxx@gmail.com 繼續」。

只要瀏覽器還登入著 Google，Google 的小視窗會一閃而過，不用再輸入密碼。上傳到一半憑證過期也沒關係，重新連線後會從中斷處接續。
（想完全免點擊，之後可以升級成加一個 Cloudflare Worker 保存 refresh token，細節見 PLAN.md 第 10 節。）

### 登出會怎樣？
只清除**這台裝置**的登入狀態，不會撤銷授權，不影響其他裝置。要完全撤銷，到 <https://myaccount.google.com/permissions> 移除 TossDrive。

### 其他限制
- 100 MB 以下的檔案直接在網頁下載，更大的檔案改用 Drive 的下載連結（瀏覽器要登入同一個 Google 帳號）。
- 影片不會在聊天室裡直接播放，要下載或用 Drive 開啟。
- 瀏覽器解不開的圖片（例如部分 HEIC）會當成一般檔案傳送，沒有縮圖。
- 自動清理要等某台裝置打開網頁時才會執行。

---

## 專案結構

純 JavaScript（原生 ES modules），**不需要打包或編譯**，改完存檔、重新整理就生效。

```text
TossDrive/
├── index.html          頁面結構（登入畫面、聊天室、大圖檢視）
├── style.css           樣式（響應式、固定淺色、圖示）
├── config.js           設定（Client ID 等），一般腳本，部署時只改這個
├── package.json        專案資訊與常用指令（npm start / npm run check）
└── src/
    ├── main.js         進入點：把各模組接起來、登入流程、進出聊天室
    ├── constants.js    設定合併與常數（上傳門檻、縮圖大小…）
    ├── device.js       裝置資訊（手機 / 電腦、名稱、裝置 ID）
    ├── state.js        共用資料（訊息、上傳中項目、快取）
    ├── auth.js         登入（Google Identity Services）、憑證保存與過期
    ├── drive.js        Drive API 共用呼叫、資料夾、垃圾桶
    ├── messages.js     Drive 檔案 ↔ 訊息物件
    ├── thumbs.js       縮圖下載與快取
    ├── sync.js         首次載入、載入更早訊息、Changes 輪詢
    ├── actions.js      下載、刪除
    ├── cleanup.js      依保留天數自動清理
    ├── upload/
    │   ├── queue.js        上傳佇列、進度、取消與重試
    │   ├── multipart.js    ≤ 5MB 一次上傳
    │   ├── resumable.js    > 5MB 可續傳上傳
    │   ├── thumbnail.js    用 canvas 產生縮圖
    │   └── xhr.js          帶憑證的 XHR（取得上傳進度）
    ├── ui/
    │   ├── render.js       時間軸渲染、日期分隔線、捲動位置
    │   ├── message-view.js 訊息元件（文字、圖片、檔案卡片、上傳中）
    │   ├── lightbox.js     看大圖
    │   ├── events.js       送出、選檔、拖曳、貼上、背景暫停…
    │   ├── status.js       畫面切換、同步狀態燈、登入提示
    │   └── icons.js        線條風格 SVG 圖示
    └── utils/              dom、format、async、storage 小工具
```

模組之間的依賴是單向的（沒有循環）：需要「反過來通知」的地方，用回呼註冊（`configureAuth`、`configureRender`），例如登入模組不直接碰畫面。

### 本機開發

```bash
npm start            # 等同 python3 -m http.server 8080，打開 http://localhost:8080
npm run check        # 檢查 src/ 底下每個檔案的語法
```

> 要用 `http://localhost` 開，**不能直接雙擊 index.html**（瀏覽器不允許 `file://` 載入 ES modules，Google 登入也不接受）。

### 發布流程

- 平常的修改推到 `main`，**不會**更新線上網站。
- GitHub Pages 的來源是 `release` 分支。本機測過沒問題，再把 `main` 合併到 `release` 並推送，網站才會更新，同時打版本 tag（`v1.1.0`…）。
- 不要刪除 `release` 分支，否則 GitHub 會停用 Pages。
