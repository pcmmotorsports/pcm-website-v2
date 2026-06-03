# 交接:審查 session 換手(context 滿)+ 賣場內容自動化架構定案(2026-06-04)

> 本 session(網站側審查 session)context 已滿(OD 審查 + 翻譯研究 + 兩次架構 workflow + 設計 doc + PRD 升維 + LINE CTA slice 指令)。Sean 要 fresh 審查 session 接手哨兵。本檔給新審查 session 起手用。
> **本 session 哨兵(Monitor byo0hnkyh)已 TaskStop;新 session 必重 arm。**

---

## 0. 起手綠的定義(新審查 session)

```
git branch --show-current   # = dev
git rev-parse --short dev origin/dev od-redesign
```
預期(交接時):**dev 領先 origin/dev 數個未推 commit、od-redesign 落後 dev(分叉)**——這是並行 session 常態,不是不綠。重點:**確認 working tree 的非自己檔別誤動**(見 §1)。

---

## 1. ⚠️ 並行 session 地圖(撞車風險高、第一優先讀)

主樹 `/Users/sean_1/pcm-website-v2` 目前**多方並行**:
- **本審查 session**(我、收尾中):docs 已 commit `6cce4a3`(OD NIT 審)+ `3ca6411`(設計 doc/#209)。
- **第二審查 session**:working tree 有 `M docs/reviews/od-redesign-review-log.md`(+15/−1)= 它審我的 `3ca6411` 判 PASS 的紀錄、**未 commit**。內容正確、看似完成。
- **報價單 session**:在報價單專案寫 PRD(不在本 repo)。
- **執行 session**:做 LINE CTA、**已決定走獨立 git worktree 隔離**(Q1=A)。

**新審查 session 守則**:① 嚴守唯讀(git show/grep 不可變快照、三綠在乾淨 tip 純態跑、零 git add/stash/checkout 別人的檔)② working tree 那個 review-log M 不是你寫的,確認內容後可精準 `git commit docs/reviews/od-redesign-review-log.md`(pathspec、別掃別檔);若疑似另一 session 仍在寫則先別動、問 Sean ③ 對齊 memory `feedback_concurrent-session-git-index-contamination` / `project_parallel-sessions-shared-git-index-collision`。

**tip 狀態(交接時)**:dev=`3ca6411`(本檔 commit 後會再 +1)、origin/dev=`2d8ee9c`(未推 2-3)、od-redesign=`266f5f2`(落後 dev:2 NIT + content-model + 本檔)。

---

## 2. 本輪已完成 + 已審(PASS)

- **OD-12 NIT 兩 commit**:`0eff2a41`(註解去 OD-F1/Phase B + 修 unconfirmed 偏離)+ `2d8ee9cd`(分組表補 ARIA list a11y)→ 審 PASS、紀錄已 commit `6cce4a3`、三綠 fresh 重跑全綠。
- **賣場內容方向 `3ca6411`**:設計 doc `docs/specs/2026-06-03-storefront-content-model-design.md` + backlog #209 升級 → 第二審查 session 審 PASS(review-log M,待 commit)。
- 末次 dev 三綠基線:vitest 81 檔 546 測 / typecheck 7/7 / lint 10/10 / build 1/1。

---

## 3. 🎯 賣場內容自動化架構定案(兩次對抗審查 workflow 結論、Sean 拍板)

**北極星**:未來 20+ 家供應商、完全自動大量上架/下架/更新/維護、人工最少。

**架構 = 範本工廠骨架 + 分層加值(template-floor / AI-head)+ 既有鎖欄(不新建狀態機)**:
- **工作單位 = 群(group)非件**:去重後約 4500 群、膨脹 3.6x(RPM 8.18x);逐件 AI = 同篇寫 3-8 遍灌水。群鍵沿用 `product_groups_v.main_sku`。
- **範本鍵 = major_category(衍生 SSOT、已乾淨)**+ 桶內 product_name_zh 填充;**不用** native category(motogadget 97% 空)、**不用** product_name_zh 當鍵(長尾品名碎成一品一範本)。複用 `lib/product_categorizer.py` classify() 單入口模式做孿生 `lib/product_templater.py`。
- **內容 = 程式拼裝(零 AI、零付費 key)打底全量到地板 + AI 只補頭部 5-15%**(高價/有安裝警告)+ 人工只校頭部 + 維護 ~70 範本片段。
- **🔴 車種鐵律**:範本/AI 都**無車種欄**、車款一律 `fitment_parsed` DB 直出(結構上不可能寫錯車);多車不挑單車、標題只有真單車才放、否則「適用 N 款」。
- **spec schema-less key/value 渲染**(每家 spec key 完全不同)+ 白名單擋表單垃圾 + 空 spec 兜底。
- **加新供應商成本掛「品類數」不掛「供應商數」**(撐 20+ 家關鍵):填對照表 row(半天-1天);全新品類軸(避震/排氣)才一次性加範本片段;唯一隨「家」走的小工程=新家 SKU 分群不同需在 main_sku CASE 加一條分支。
- **下架**:沿用 `delisted_at` 軟下架 + 補「連續 N 天缺席才下架」去抖 + 高價品 keep 標記。
- **🔴 上線前必修(code 實證)**:fetcher 每夜 `DELETE WHERE manually_corrected=false` 會砍掉人工校鎖內容 → DELETE 條件須加 `AND translation_locked=false`;且 `summary_zh`/`highlights_zh` 併入 `PROTECTED_TRANSLATION_FIELDS`。
- **AI 頭部吃 description_origin**:只 RPM 100% 有、其他 5 家 0 → 其他家頭部待「爬官網補原文」平行工程才有燃料(原文逐步到位、頭部覆蓋逐步擴大、不回頭改主引擎)。

**兩次 workflow 完整結果**(證據鏈):`/private/tmp/claude-502/.../tasks/w2rc5dx56.output`(優先序對抗審查)、`wol2b7plr.output`(架構)。⚠️ /tmp 會清,要長留需另存。

---

## 4. 優先序(三次審查一致、Sean 拍 Q1=A)

```
P-1（半天、最高投報）：全站補可點 LINE 詢價 CTA href —— 執行 session 正在做(worktree)
P1：M-3 結帳/訂單/金流（讓站內能收單；現 M-3=0 進度、無 /checkout、無 orders 表）
P2：賣場內容範本工廠（長期地基、對的，但不是當下瓶頸）
```
誠實:站內無法結帳(購物車只 localStorage、立即購買不導結帳),內容做再好站內成交=0。

---

## 5. 待審清單(新審查 session 哨兵盯)

1. **LINE CTA slice**(執行 session worktree 做中):slice 指令見對話/本輪交付。審點:預填訊息**零車款字串**(車種鐵律)、含商品名/料號/頁面 url、車型留空、桌機 QRCODE、RWD 不擋 buybar、smoke test、三綠。merge dev 時審合併後三綠。LINE basic ID 待 Sean 確認(@pcmmoto?)。
2. **報價單 PRD v2**(報價單側專案、非本 repo):升維方向已交 Sean 轉報價單 session(主引擎逐件 AI→範本工廠、範本鍵 major_category、修 DELETE 條件)。網站審查可選看,主審在報價單側。
3. **之後 M-3 結帳**(網站側大工程):會觸發鐵則 8(schema/API)+ 鐵則 12(order/payment/pricing)→ **重點審 + codex K2(若 quota 回)**。
4. **第二審查 session 的 review-log M** commit(§1)。

---

## 6. 哨兵 arm(新審查 session 必做)

baseline = 起手 `git rev-parse --short dev`。Monitor persistent 盯 **dev + od-redesign**(+ 執行 session 的 LINE CTA worktree 分支名,若 Sean 告知);每新 commit fresh-context `git show` 審不可變快照、findings 寫對應 review-log、只 FAIL 才 PushNotification。法見 memory `reference_sentinel-auto-review-pipeline`。**本 session 哨兵 byo0hnkyh 已停、務必重 arm。**

---

## 7. 關鍵文件 + 記憶

- 設計 doc:`docs/specs/2026-06-03-storefront-content-model-design.md`
- 報價單 PRD:`/Users/sean_1/API大量上架/PCM報價單-V2/docs/PRD-storefront-content-pipeline-2026-06-03.md`
- OD 審查紀錄:`docs/reviews/od-redesign-review-log.md`(含 working tree 未 commit M)
- backlog #209(已升級指向設計 doc)
- 記憶:`project_storefront-content-model-design`(架構+車種鐵律+報價單系統成熟度)、`tw-marketplace-copy-conventions`(已更新)、`project_quote-website-integration-phase1`、`feedback_execution-review-session-split`、`reference_sentinel-auto-review-pipeline`、`project_deploy-topology-main-stale-dev-live`、`feedback_concurrent-session-git-index-contamination`。

---

## 8. push 狀態

dev 領先 origin/dev 2-3 commit、**全未 push**(Sean 暫不上線/手動推)。新審查 session **不代推**、不主動 offer push。

— END —
