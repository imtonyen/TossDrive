---
name: release
description: TossDrive 發版：改 package.json 版號、commit、推 main、把 main 快轉到 release（GitHub Pages 上線）、打 vX.Y.Z tag 並推上去。只在使用者說要發版時使用。
argument-hint: "[patch|minor|major|X.Y.Z]（預設 patch）"
disable-model-invocation: true
---

# TossDrive 發版

GitHub Pages 只從長期分支 `release` 上線；`main` 是開發分支。發版 = 版號 commit 在 `main` → `release` 快轉到 `main` → 打 tag。

參數：`$ARGUMENTS`（空白 = `patch`；也可以是 `minor`、`major` 或直接給 `X.Y.Z`）。

## 1. 事前檢查（任何一項不通過就停下來告訴使用者，不要硬做）

```bash
git switch main                       # 必須在 main
git status --porcelain                # 必須乾淨；有未 commit 的修改先問使用者
gh auth switch -u tony-yen-dev        # 這個 repo 一律用 imtonyen 帳號；gh 本機仍以舊名登記，git push 透過 gh 認證
git fetch origin --tags
git rev-list --count main..origin/main      # 必須是 0（遠端有新 commit 就先停下來問）
git merge-base --is-ancestor origin/release main   # 必須成功：release 只能快轉，不能分岔
npm run -s check                      # 語法檢查要通過
```

## 2. 決定新版號

- 目前版號：`package.json` 的 `version`。
- `patch` → X.Y.(Z+1)、`minor` → X.(Y+1).0、`major` → (X+1).0.0，或用參數給的版號。
- 確認 tag `vX.Y.Z` 在本機和遠端都還不存在（`git tag -l vX.Y.Z`、`git ls-remote --tags origin vX.Y.Z`）。
- 用 `git log --oneline v<上一版>..main` 列出這次會上線的 commit，在回覆裡簡短列給使用者看。

## 3. 改版號並 commit

只改 `package.json` 的 `"version"`（網頁上顯示的版號是 `src/main.js` 讀 `package.json` 來的，不用改其他檔案）。

```bash
git add package.json
git commit -m "Bump version to X.Y.Z" -m "Co-Authored-By: <依當下 system 提示的署名>"
```

## 4. 推上去、上線、打 tag

推送一律寫完整 ref；**絕對不要 `--force`**，`release` 推不上去（非快轉）就停下來問。

```bash
git push origin refs/heads/main:refs/heads/main
git push origin refs/heads/main:refs/heads/release     # 這一步會讓 GitHub Pages 上線
git branch -f release main                              # 本機 release 跟上
git tag vX.Y.Z                                          # 輕量 tag，跟過去的 v1.0.x 一致
git push origin refs/tags/vX.Y.Z
```

## 5. 確認

```bash
git rev-parse main origin/main origin/release vX.Y.Z    # 四個要相同
gh api repos/imtonyen/TossDrive/pages/builds/latest --jq '.status'   # building / built
```

最後用一兩句話回報：新版號、上線了哪些修改、Pages 建置狀態。

## 注意

- 不要刪除 `release` 分支：刪掉 Pages 的來源分支會讓 GitHub 直接停用 Pages。
- 不要建立 `release/vX.Y.Z` 這種每版一個的分支，也不要讓分支和 tag 同名。
- 不要改 GitHub Pages 的設定。
