# HANDOFF — 前台目錄/大圖線(2026-07-19 晚間視窗)

> ⚠️ **本檔 = 當次快照,不是 M-4a 主線的開工入口**。M-4a 主線(D′ 通知線 B-3)入口仍是
> `docs/handoff/CURRENT.md` + `STATUS.md`「下一步」。本檔只交接**前台插隊線**:
> 商品卡去白邊 trim 線(已收工)+ lightbox 鍵盤循環(已收工)+ 未結項。

## 交接資訊

- Updated: 2026-07-19 晚,Asia/Taipei
- Agent: Claude Code 實作視窗(trim 線首灌收尾 + lightbox 鍵盤循環修復)
- Branch / HEAD:`dev`。🔴 **hash 與未推數不寫死**,實跑取得:
  `git rev-parse --short origin/dev` / `git rev-parse --short origin/main` /
  `git rev-list --count origin/dev..HEAD`。
  本檔寫定當下:`origin/dev` = `eddee35`、本地 ahead 0、`origin/main` = `f8caf3b`。
- ⚠️ **本視窗全程有平行 session 同時在 `dev` 施工**(前台目錄篩選/分頁線)。
  🔴 **dirty 檔清單會隨平行 session 持續變動 → 一律以實跑為準,不照抄本檔**:
  `git status --porcelain | grep -v "^??"`。
  本檔寫定當下 = `products-url-state.tsx` / `products-url-state.hooks.test.tsx` /
  `.gitignore` / `docs/progress-roadmap.html` / `docs/phase-1-backlog.md`
  (+ `docs/handoff/CURRENT.md` = **本視窗自己的指標行編輯**,隨本檔同 commit)。
  **接手者勿動平行 session 的檔、勿 `git add -A`、勿因看到未列出的 dirty 就 reset。**

## 一、商品卡去白邊 trim 線 ✅ 全線上 production(**trim 五片+熱修確實已在 `origin/main`**)

Sean 07-19 拍 Q1=B(bbox 預算存 DB、客端零運算)。五片 code + 一片熱修全數上 production,
Sean 肉眼驗通過。詳細拍板與教訓 = memory `project_card-image-trim-decisions`;
plan 真權威 = `docs/specs/2026-07-19-product-image-trim-plan.md` v1.1。

- 落地:S1 `ff217b6`(migration `20260719150000`)/ S2 `1568ad2`(掃描腳本)/
  S4a `589fedb`(資料接線)/ S4b `ef70443`(前端)/ S3 `ef50482`(CI job)/
  熱修 `f8caf3b`。
- 硬序**已按序走完**:`db push` → 路徑②驗收(16 項 DB 斷言 + 3 項 PostgREST smoke 全 PASS)
  → OP-首灌 → 肉眼驗。
- **首灌結果**:DB `product_image_trim` 共 **10,762 列**
  (`ok` 8,825 / `no_trim` 1,254 / `failed` 683)= **82% 商品卡生效**。
  正式站實抓 HTML 複驗(目錄首頁 23 張、碳纖維部品分類頁 25 張帶 trim inline style)。

### 🔴 這條線留下的兩個教訓(接手者值得看)

1. **「先驗證、後降精度」是錯的順序**。第一趟首灌 10,712 張全掃完,寫入第 19 批撞
   `CHECK bbox_complete`,舊碼 `process.exit(1)` **丟棄整趟結果**。根因=`classifyTrim`
   對**未捨入**值驗 `l+w<=1`,之後各欄獨立 `round5` 到 `numeric(6,5)`、每項最多 +5e-6
   → 和可達 `1.00001` > 1。**DB 看到的是降精度後的值,驗證就必須跑在那個值上。**
2. **長批次作業不得讓單列錯誤賠掉整趟**。已改為單批 upsert 失敗降級逐列、壞列單記其餘照寫,
   `upsert_failures>0` 才 exit 1。

### 🔴 未結項

| # | 項目 | 狀態 |
|---|---|---|
| 1 | `failed` 683 列中 **665 列集中 `www.eazi-grip.com`** | 首灌併發被對方站限流(事後單張 `curl` 200、**圖本身正常**);照 `FAILED_RETRY_MS`=7 天由 CI 增量 job 自動重試。**提前 targeted 重跑需加「只重跑 failed」旗標 = 新 code 改動 → 待 Sean 拍**(STATUS 待決策⑧) |
| 2 | 熱修②(降級逐列 upsert)**無自動化測試覆蓋** | 該段在 `main()` 內未抽成可測函式,僅靠第二趟首灌人工驗證;code-reviewer 已列 Important、依一輪制修完 nit 即收工。已於 commit body 誠實揭示 |
| 3 | reviewer nit:降級逐列為序列 `await`(最壞 200 次往返) | 未處理、非正確性問題 |

## 二、lightbox 鍵盤 ←/→ 無限輪播 ✅ 收工(`eddee35`)

Sean 回報「點開大圖應可循環 1→30→1,之前只做到手機版、電腦版忘記處理」。

🔴 **根因與回報描述不同(接手者請記住這個判斷模式)**:lightbox 內的**箭頭按鈕與觸控左右滑
早已循環**(共用 `lbNext`/`lbPrev` modulo、2026-07-09 #270 就做了);真正 clamp 的是
**鍵盤 ←/→**。桌機主要用鍵盤翻圖 → 體感成「電腦版沒做」,實際是**輸入方式差異、不是平台差異**。
**先偵察再動手,否則會修錯地方。**

- `ProductGallery.tsx`:鍵盤 effect 內 ←/→ 在 `lightbox === true` 時走 modulo。
  🔴 **刻意只在開啟時改** —— 該 listener 是 always-on(Sean **Q-2=C** 拍板:lightbox 未開時
  桌機也能 ←/→ 切 hero 圖),那裡的 clamp 是**既有 override、字面完全未動**,並新增第 3 測
  釘住此不變式。另補 `gallery.length === 0` 短路。
- `SwatchLightbox.tsx`:←/→ 改呼叫同一支 `lbNext`/`lbPrev`(單一語意來源);兩者包
  `useCallback` 使身分穩定後加進 effect deps。
- 驗證:+4 測;**突變測試**還原成 clamp → 3 測轉紅、「未開 lightbox 仍 clamp」那測維持綠
  = 非假綠。三綠 + build + full vitest **231 檔 / 2538 passed + 1 todo(total 2539)**。
  manifest 兩段同 commit 更新。
- 審鏈:code-reviewer **R1 PASS**(1 must-fix = manifest 未同步,已於同 commit 補)。
- 未處理 nit:`SwatchLightbox` 在 `len === 0` 時 modulo 會 NaN —— **既有行為、非本次引入**,
  兩個呼叫端皆傳 module-level 常數 `RPM_SWATCHES`(非空)→ **目前不可達**。

## 三、部署狀態(接手前先確認)

- `origin/dev` = `eddee35`(Sean 已授權推、本視窗執行)。
- `origin/main` = `f8caf3b` → **正式站尚未拿到**下列三片前台修復:
  lightbox 鍵盤循環 `eddee35` / 目錄分頁失效 `630b7a6` / STATUS 收尾 `3683ef8`。
  要上正式站需 **Sean 明說**後跑 `git push origin dev:main`;**不得自行 promote**。
- ⚠️ 推 `dev` 會觸發 **pcm-admin production 重部署**(`dev` 是 admin 的 production 分支)。
  本批全為 storefront 前台改動,admin 行為不變。
- 🔴 **trim 線的部署順序硬依賴仍然成立**(供日後回滾/重建環境參照):adapter 讀路徑
  `.select()` **指名** `card_image_trim`,對未 apply `20260719150000` 的 DB 是
  **PostgREST 42703、目錄全斷**(非優雅降級)→ 永遠**先 db push、後推 code**。

## 四、接手起手步驟

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
```

1. 預期 branch=`dev`;**dirty 檔應只剩平行 session 那四檔**(見上「交接資訊」)。
   出現其他無法解釋的 dirty → 停下問 Sean,不自行 reset/stash。
2. 讀 `STATUS.md`(7 欄已於 `3683ef8` 對齊)+ `docs/ops/AI_CONTRACT.md` + `docs/handoff/CURRENT.md`。
3. **要接 M-4a 主線** → 入口是 `CURRENT.md` + STATUS「下一步」(= **B-3** 結帳頁 email 欄 +
   zod 必鏡像六條件,漏做 = app 放行、DB 擋、**結帳 500**)。本檔的兩條線都已收工,不是下一步。
4. **要接本檔的未結項** → 上方「未結項」表第 1 項需 Sean 先拍,第 2/3 項是可選補強。

## 五、本視窗 Sean 拍板落檔對帳

| 拍板 | 已落檔位置 |
|---|---|
| Q1=B 走 bbox 治本、不要 CSS contain 過渡 | memory `project_card-image-trim-decisions` |
| 「用 Fable 審查一次、沒問題就開工」 | 同上(審查史段) |
| **「簡單的重複動作記得用 sonnet 去跑」** | memory `feedback_delegate-mechanical-repeat-work-to-sonnet` |
| 授權 `push origin dev:main`(trim 線上正式站) | STATUS「最後更新」+ 本檔 §三 |
| 授權 `push origin dev`(本批 5 commit) | 本檔 §三 |

— END —
