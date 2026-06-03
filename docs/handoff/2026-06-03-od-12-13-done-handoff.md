# 交接:OD-12 適用車款表 + OD-12b/c/d + OD-13 FAQ 完成並已推(2026-06-03)

> 本 session(寫審分離之**審查 session**)收尾。Sean 已 push origin/dev、開新 session 繼續。
> 寫審分離(ROLE=A):執行 session 實作、審查 session fresh-context 重驗、Sean 橋接。

---

## 1. 現況(全綠、已推 origin/dev)

- **`origin/dev = 9cc5bbd`、local/origin 同步**;push 顯示「Bypassed rule violations…Required status check `check` is expected」= Sean admin bypass 的**正常訊息、push 成功**(見 `project_github-branch-rulesets`)。**CI 在 GitHub 跑 `check`**(程式碼三綠 + pre-push hook typecheck/lint 已綠、預期過;新 session 起手可 `gh run list` 確認)。
- **main 未動**:Sean 2026-06-03 拍 **A「暫不上線」**(只本機 :3001 驗 + push dev、不碰 main、不上線);main 仍落後 dev 344 commit、Vercel production 疑對 main 舊版。詳 `project_deploy-topology-main-stale-dev-live`。正式上線是日後鐵則 8 大改、需先 plan + 風險清單。
- **本輪完成(全 PASS、逐 commit 審 + 合併後三綠獨立驗)**:
  - **OD-12 `750ffa7`** 適用車款表(ProductFitments 新元件、接 S6 真資料 `product.fitments`、D1=A 3 欄 車廠/車型/年式、formatYears 三態、空狀態 null、ProductTabs 交叉引用恢復;對 OD §7.5 逐行保真)。
  - **OD-12b `9abb5c3`** 移除「未確認」標(Sean 拍「不該」、下單前 LINE 本就確認;保留 S6 toUIProduct unconfirmed 映射不擴 scope)。
  - **OD-12c `654e471`** 桌機年式欄收窄(後被 OD-12d supersede)。
  - **OD-12d `9b21a8e`** 適用車款表**重設計**:扁平表→依車廠/車型分組 + 年式 inline chips(groupFitments 邏輯審查逐行驗正確;Sean 指定 /frontend-design;manifest design authority 標 supersede OD §7.5 + business_override `fitmentsGroupedLayout`)。
  - **OD-13 `bb99340`** FAQ 內文修正(order/leadtime Sean 提供內容 + 保固 3→4 段拆;**消保法 §19 鑑賞期法律字面審查逐字驗證未動**、只拆段;共用 rpm-policies 單一真相、ProductTabs 同步)。
  - **backlog #211 `f8d5045`** fitments 分組字串正規化(🟢 觀察非阻;審查**獨立 SQL 複查**正式庫:2873 筆/10 車廠/96 車型/trim 異常 0/case-fold 衝突 0 → OD-12d 分組對真資料正確)。
  - **審查紀錄 `9cc5bbd`**(本檔同批、docs(reviews))。
  - 末次合併後完整三綠:**typecheck 7/7 / lint 10/10 / build 1/1 / vitest 81 檔 545 測**。

## 2. 審查紀錄(SSoT)

- OD 線:`docs/reviews/od-redesign-review-log.md`(尾段 = OD-12 → 12b → 12c → 12d → OD-13 → #211 + 各 merge,逐 commit PASS + 獨立三綠 + 字面vs事實 + DB 複查)。
- 資料線:`docs/reviews/integration-phase1-review-log.md`(S0–S6,先前完成)。
- 記憶:`project_quote-website-integration-phase1`(終態)、`project_deploy-topology-main-stale-dev-live`、`project_od-redesign-phase-a-done-od12-fitments-deferred`(已更新至 OD-12d)。

## 3. 剩餘工作 / 下一步(交新 session、Sean 挑方向)

1. **翻譯 / 中文描述 pipeline #209**(獨立、需先決策):內文(商品描述)未翻。**走結構化內容模型、非 prose 翻譯**(見 `tw-marketplace-copy-conventions`)。**⚠️ 報價單側 schema、欄位設計成「所有品牌通用」**(Sean 釘:固定欄給每品牌上架用、非 RPM 專用)。審查 session 已給通用欄位建議(品牌級 brand_story / 商品級 name_zh·summary_zh·highlights_zh / 屬性 category·origin·material·specs_zh JSONB / 變體 option 具名)+ 三決策題待 Sean 拍:**Q1 規格存法(typed+specs JSONB / 純 typed)、Q2 品牌級內容現在建表否、Q3 先 pilot 否**。拍完交**報價單 session 開 PRD**(他們鐵則 8 schema + 鐵則 9 L3)。⚠️ 連帶:商品頁有 ~5 處寫死 RPM 碳纖身份(N°01/紋路牆/規格材質/產地/picker)、多品牌通用要「去 RPM 化」= 比加欄更大的未來 workstream。
2. **NIT hygiene(非阻、執行 session 順手)**:① S6 檔 3 處過時註解(`mock-products.ts L47/L107` + `lib/products.ts L129` 仍稱適用車款表為「OD-F1(Phase B)」+ 未來式「鋪路」、表已上線應改 OD-12/過去式)② OD-12d **a11y 語意**:分組表用 `<div>` 無 table/list role、車廠非 heading → 建議補 role/aria(視覺不變)。
3. **codex 補審**(OpenAI quota 到 **2026-07-02** 恢復):本輪 OD-12~13 純前台、codex K2 正確跳;quota 回對先前 **S5 workflow + W1 閘 + S4 下架 gate** 補正式跨模型 codex(整合線那批)。
4. **backlog #210**(W1 <5% 靜默截斷持久基線根治)。
5. **上線規劃(production)**:Sean 想正式給客人看時 = 鐵則 8 大改(dev→main 344 commit + Vercel production branch 確認/設定)、需先 plan + 風險清單。

## 4. 流程 / 治理(新 session 必讀)

- **寫審分離(ROLE=A)**:執行 session 在 **OD worktree `/Users/sean_1/pcm-website-v2-od`(od-redesign)** 做、審查 session 在主樹 `/Users/sean_1/pcm-website-v2`(dev)fresh-context 重驗、Sean 橋接(prose multi-select、白話)。od-redesign 與 dev 現都 = `9cc5bbd`(本輪結束對齊)。
- **哨兵自動審 pipeline**(`reference_sentinel-auto-review-pipeline`):審查 session 用 Monitor 盯 dev + od-redesign、每 commit fresh-context `git show` 審不可變快照、findings 寫對應 review-log、只 FAIL 才 PushNotification。**⚠️ 哨兵隨 session 結束而死、新審查 session 須重 arm**(baseline 都 = `9cc5bbd`)。
- **每片審查項**:字面vs事實 / 鐵則 1-12 / scope 乾淨(精準 add)/ manifest 同步 / 經銷防護 grep(動 pricing)/ 三綠(動 .ts/.tsx 重跑、動共用元件跑完整 vitest、merge 跑合併後完整三綠)/ codex K2(命中 schema·RLS·migration·pricing 才跑、現 quota 掛走 Claude fallback)。**動 DB 宣稱獨立 SQL 複查**(#211 用此手法)。
- **檔案大小用 `git show <sha>:<path> | wc -l`**(OD 在 worktree)。
- **OD 用 manifest 追蹤、不碰 STATUS**(merge 零衝突靠此);**STATUS.md 未更 OD-12~13**(OD 線一向 manifest,Sean 若要 STATUS 反映另議)。
- **push = Sean 手動 checkpoint**:只在 Sean 明確「幫我 push / 你幫我推」才推(`feedback_push-is-sean-manual-do-not-offer`)。本輪 Sean 明確授權、已推。
- **Sean 暫不上線**:不碰 main、不部署 production。

## 5. 新 session 起手

- 兩個新 session(審查 + 執行)各自第一則讀本檔 + 對應 review-log + 記憶。
- **審查 session**:重 arm dev + od-redesign 兩哨兵(baseline `9cc5bbd`);讀 od review-log 尾 + 記憶。
- **執行 session**:在 OD worktree(od-redesign=`9cc5bbd`、已對齊 dev);接下一個 Sean 指定方向(翻譯 schema 待 Sean 拍 + 報價單 session / NIT hygiene / 更多 polish)。
- 起手檢查:`git branch --show-current && git status && git log --oneline -5`,預期 dev=`9cc5bbd`、樹乾淨、origin 同步。

— END —
