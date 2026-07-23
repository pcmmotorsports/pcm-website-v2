# CURRENT HANDOFF — pcm-website-v2

> 這是新 Codex／Claude session 的當次交接入口。現況衝突時依
> 「可驗證事實 → `STATUS.md` → 本檔 → 歷史 handoff／memory」仲裁。
> **現行主線＝M-3 TapPay 正式化線(Sean 2026-07-23 開工):S1a「付款送出逾時出口」✅(`b73e9cb`、已推 `origin/dev`)+ S1b-1「reconcileCartSession 後端」✅(`43c0d6d`)+ S1b-2「前端接線」✅ 收工(本 session、**未 push**、零 migration)→ 下一片 S2 sweeper 搬 pg_cron。** plan 真權威=`docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md`(S1a-S6+L1);金流紅線+設計輸入=memory `project_tappay-production-blackhole-settle-line`。並行入口:主軌 M-4a B-4、支線 #288-b、法律頁 L1(草稿待核准);**同一時間只允許一個寫入 session。**
> ✅ **正式上線閘已解除**（2026-07-22 Sean 拍 Q1=A：桌機 390px 視窗驗過即算滿足「肉眼驗手機版」）。誠實範圍：驗過 3/4 項、**非真手機、第 ④ 項觸控焦點未驗**。🔴 **但推 `main` 仍是 Sean 的手動動作** —— 任何 session 不得代推、不得主動提議推。

## 1. 交接快照

- Updated: 2026-07-23, Asia/Taipei — **M-3 S1b-2「黑洞『查詢付款結果』前端接線」✅ 收工（本 session、**未 push**）**：`unknown` 死路畫面加「查詢付款結果」按鈕 → 呼 S1b-1 `reconcileCartSession` 即時反查 → paid（成交終態）/ failed（新 `ChargeState reconciled_failed` 全頁「付款未完成」、CTA 參數化「重新選購」→/products）/ pending（維持 unknown+提示含重新登入出口+10s 冷卻）。新 hook `useReconcilePayment`（組合於 `useChargePayment` 內、注入私有 setState 共用同一 ChargeState=MF7 凍結;client 15s bounded timeout+finally 保證 reconciling 重置=按鈕不永久死鎖;**stale/unmount 守衛**=晚到 paid 不清客人新車;fail-closed 絕不誤報 paid/failed）。CheckoutView 393→400/400（鐵則 6 上限、下次動先外移）。**四層審不降級全過**:code-reviewer(opus) PASS、Fable 盲審 GO、**codex 關卡2 R1 FAIL→4 must-fix→R2 FAIL〔StrictMode mountedRef setup/cleanup 對稱 bug、dev 按鈕失效〕→修→Sean 授權 R3+Fable 複審=codex R3 程式/金流 GO + Fable GO、code 三層零 must-fix**。三綠、full **246 檔 2836+1todo**、agent-browser 390px 三態視覺 PASS。⚠️ **StrictMode bug 教訓**:agent-browser harness 用本地假 handler 沒走真 reconcile → 漏掉 dev StrictMode 下按鈕失效,codex R2 補抓(memory `feedback_agent-browser-harness-must-wire-real-handler`)。**未 apply DB、未開 flag、未動 `.env*`;🚀 Sean 授權已推 `origin/dev`=`7289808`（S1b-1 `43c0d6d`+S1b-2 `7289808` 一併上;pre-push lint 綠、Bypassed=Sean admin bypass 正常;零 migration/零 admin 碼→admin 重部署同碼、storefront 正式站看 `main` 不受影響）。**
- 🔴 **下一片 = S2「sweeper 搬 Supabase pg_cron + 開」(黑洞背景兜底,補即時查漏網;Q4=A 分鐘級)**:黑洞即時對帳客人自助迴圈(S1a 逾時出口 + S1b 反查)已完整;S2 補**背景**網。現況缺口③=cron settle-sweep 每日一次 + `CRON_SWEEPER_ENABLED` false(與 3DS/anomaly flag 一起關)→ prod 黑洞零自動兜底。S2 要把 sweeper 搬 pg_cron 分鐘級 + 開。🔴 **平台注意**:memory `reference_pcm-platform-plans-vercel-hobby-supabase-pro` 排程別預設綁 Vercel(Hobby 禁商業用途);Supabase Pro pg_cron 是方向。🔴 **Sean 手動步驟**:S2 若含 pg_cron migration → Sean db push;開 `CRON_SWEEPER_ENABLED` flag=Sean 手動。plan 真權威=`docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md` §3(go-live 開關硬清單)。
- Updated: 2026-07-23, Asia/Taipei — **M-3 S1b-1「reconcileCartSession 後端 server action」✅ 收工（`43c0d6d`、**未 push**）**：own-only `find_active_sibling_own` 取 orderId → 既有 by-orderId `claim_order_poll_settle` 節流 → `settleCharge`（重用零改）→ paid/failed/pending;全程 fail-closed（查不到/未登入/throttle/settle/throw → pending，永不誤報）。🔴 **Q1a=A 重用既有 RPC、零新 migration、零 DB 物件、Sean 不需 db push**。三綠 8/8·10/10·2/2、full **245 檔 2817+1todo**;**三層 diff 審**=code-reviewer(opus) PASS / codex 關卡2 FAIL / Fable 盲審 FAIL——🔴 **後兩者皆判 code 本體 0 must-fix**（fail-closed/IDOR/零洩漏/節流/並發/鐵則逐條擋、Fable 10+ 攻擊全擊退），must-fix **全屬 docs/字面**（「四層審過」過度宣稱改誠實、SSoT 殘留清、測試補 factory-throw+console 零洩漏斷言、未登入 log 移除防灌爆、plan §4 型別補 displayId）已全折入。⚠️ **純後端、`reconcileCartSession` 尚未被任何 UI 觸達**（前端按鈕 + 全頁 failed 態 = S1b-2）;無 UI 故無 agent-browser。本 commit 未推、`origin/dev` 仍 `644cb3a`。
- Updated: 2026-07-23, Asia/Taipei — **M-3 TapPay 正式化線 S1a ✅ 收工並推 `origin/dev`**（S1a=`b73e9cb`、法律草稿=`5d92936`；`origin/main` 仍 `3bfee6b` 未動、storefront 正式站不受影響）。
- **S1a「付款送出逾時出口」**（高風險金流片、四層審不降級全過）：`useChargePayment.submit` 以 `withSubmitTimeout` 包 action，逾時(90s provisional、值待 S3 實測定案)→ reject → 落既有 catch 的 `unknown` 終態（掀 U5 遮罩給出口、清車、保留 `cart_session_id` 不 regenerate、不釋 `inFlightRef`）；catch 加 `setPaymentInflight` 跨分頁軟提醒。🔴 **付款鏈語意零改**。full storefront 1475 測綠、突變 3/3 全紅。**agent-browser 併入 S3**（Sean 拍 A：零版面變更、逾時路徑僅 3DS 開啟後可達）。
- 🔴 **S1b（reconcileCartSession 即時反查）plan 經 codex 關卡1 + Fable 兩輪雙模型規劃審查（codex R2 FAIL findings 已折入 v3、Fable R2 GO；v3=折入版、依 plan 層 2 輪上限未再開 R3）；Sean 拍 Q1a=A 重用既有 RPC〔`find_active_sibling_own` + `claim_order_poll_settle`〕、零新 migration、拆 S1b-1 後端 + S1b-2 前端**（plan 真權威=`docs/specs/2026-07-23-m3-s1b-reconcile-cart-session-plan.md`）。**S1b-1**（新 server action `reconcileCartSession` + 窮舉狀態測試）流程：own-only `find_active_sibling_own`（auth.uid()）取 orderId → 既有 by-orderId `claim_order_poll_settle` 節流 → `settleCharge`（重用、**零新寫入/刪除/release**）→ 回 paid/failed/pending。🔴 **零 DB migration、Sean 不需 db push**（原「新 by-cartSessionId RPC + migration + db push」已作廢）。下一 = **S1b-2**（前端 `unknown` 畫面「查詢付款結果」按鈕 + 新全頁 failed 態 + agent-browser 真瀏覽器驗）。
- 🔴 **Sean 5 決策（2026-07-23、本線、已鎖）**：Q1a=B 軟上線（法律頁 L1 必須、擋 S4）／Q1b=A Claude 起草法律（7 天合法條件式：現貨照 7 天+真客製排除+回復原狀+價值減損；「下單訂貨/選變體」不算客製）／Q2=A 訂單只標記 failed/cancelled 不物理刪／Q3=A 黑洞對帳=webhook+sweeper 兩網+超時出口+by-cartSessionId 反查／Q4=A sweeper 搬 Supabase pg_cron 分鐘級／Q5=A 一起開 anomaly-alert。全文＝memory `project_tappay-production-blackhole-settle-line` + plan §1。
- 🔴 **全線 Sean 手動步驟（Claude 碰到一律停下交手）**：S2 的 db push（🔴 **S1b 零 migration、不需 db push**）、S4 正式金鑰+開 3 flag（TAPPAY_3DS_ENABLED/CRON_SWEEPER_ENABLED/ANOMALY_ALERT_ENABLED）+ 換正式 merchant + TapPay 後台登記 notify URL、S5 上架 1 元商品+真刷、S6 TapPay 後台退款+手動改 payment_status、所有 push。go-live 一組開關硬清單見 plan §3。
- **法律頁草稿**：`docs/specs/2026-07-23-pcm-legal-terms-privacy-draft.md`（服務條款 15 條+隱私政策，已填 site-config 真實聯絡資訊，含審閱期/瑕疵擔保；**待 Sean/律師核准才上 `/terms` `/privacy` route**）。負責人=林蓁瑜、快遞、訂貨 2-12 週、退貨運費依解除權/換貨分流。
- ⚠️ **以下為前一片 U4b 的歷史交接、非現況**：
- Updated: 2026-07-23, Asia/Taipei（**M-3 兩步結帳 Slice U4b：第一錯誤 focus/scroll + lifecycle 回歸 ＝ 本 commit**；U4a `f071415` 為前一 commit）
- **✅ U4b 已收工**（本 commit；U 線第 9 片、L1、高風險片）：聚焦第一個可聚焦錯誤 + `.auth-field` 可及容器（role=group/tabIndex=-1、零新增節點）+ 動作列外移進 CheckoutStep2（§8）。**五層審查全跑(不降級)全數折入/銷案**：plan 層 codex 關卡1 FAIL→6 + Fable FAIL→2+6nit;diff 層 code-reviewer(opus)**PASS**+1nit、codex 關卡2 FAIL→2(已修)、Fable 盲審 **PASS**+3nit（N1 preventScroll 採 / N3 焦點轉移測補 / N2 outline 品味題留 Sean）。✅ **agent-browser 真瀏覽器程式驗證 PASS（390px、桌機+mobile 兩路徑）**：焦點落 `#checkout-card-number`、**未彈到 `.co-pay` 隱藏 radio**（解掉 U2b 殘餘風險）、scrollIntoView 置中在 buybar 之上、grid 兩子不歪、零溢出、buybar 不遮 terms/同意 → **design §7.2 全段達成**。⚠️ 誠實邊界：程式驗證非 Sean 肉眼驗、走 fixture 路由（非真 /checkout E2E、未送出付款）、fixture 用完即刪 git 零留痕。付款鏈零變更、`CheckoutView.tsx` 386→389/400。
- 🚀 **2026-07-23 Sean 授權推正式站,`git push origin dev` + `git push origin dev:main` 皆完成**：`origin/dev` = `origin/main` = **`ed44478`**（FF、推前 main=`fa1dd01`）。storefront 正式站現部署 checkout U3b+U4a-0+U4a+U4b（錯誤顯示 + 聚焦）；🔴 `git diff --name-only fa1dd01..ed44478` 實查零 migration/零平台設定/零 admin，付款 flag 未碰（真刷卡狀態不變）。⚠️ U4b 的 §7.2 focus 僅 agent-browser 程式驗證、**未經 Sean 正式站肉眼驗**。Sean 轉新視窗續工。
- **下一片 ＝ M-3 U5「validate-then-pay、七態回歸與 mobile + 步驟列同源上鎖」**（或依 Sean 指示回主軌 M-4a B-4）。以下 U4b 交接內容為歷史紀錄。
  ① 🔴 **鐵則 6 硬前置(最重要)**：`CheckoutView.tsx` **386 行 / 上限 400、跑道只剩 14 行**，
     而 U4b 要建 focus target registry（每個錯誤一個 target、固定順序、focus + scrollIntoView）＝ 一定不只 14 行。
     → **動它之前必須先外移**，不得靠壓縮註解硬塞（U3b 在此連踩三次：401→400→399→401）。
     ⚠️ 外移候選受 design §8 限制：`CheckoutView` **必須保留付款 orchestrator**，
     能抽的是「錯誤導引 / focus registry」那半、或 Step2 的 actions 區塊；
     付款鏈（`confirmProceedIfInflight → getPrime → charge.submit`）**不得離開 View**。
  ② ✅ **U4a 已完成的前置**（不必再做）：卡片三欄 + `card.module` 已接、`payDisabled` 的 `!tappay.canGetPrime` 已移除、
     `TapPayCardFields` 內層 `role="alert"` 已移除（與 `card.module` 摘要同片完成）。
  ③ 🔴 **U4b 的 design 依據**（§7.2 逐字）：「完成錯誤集合後，捲動並聚焦第一個可聚焦錯誤；其他紅字仍保留」＋
     「TapPay iframe 無法直接聚焦內部 input 時，聚焦該欄的可存取容器並捲至該區」。
     固定順序見 plan U4b §⑤：`shipping.address → notificationEmail → invoice.title → invoice.taxId →
     invoice.donateCode → card.module → card.number → card.expiry → card.ccv → terms`。
  ④ 🔴 **U4b 同片要補的既有缺口**：`aria-invalid`/`aria-describedby` 目前掛在無顯式 role 的 `div.tpfield` 上，
     **螢幕閱讀器是否朗讀未經實測**；U4b 的 `role="group" tabIndex={-1}` 外層容器才是真正的可及容器。
  ⑤ ✅ **plan 字面已於 U4a 更正**：`TapPayCardFields.test.tsx` 已新建（plan §⑤ 原把它當既有檔）；
     `submitAttempted` 採單一 ownership，且**實作時再進一步收進 `usePaymentErrors`**（非 View）——
     plan `:343` 的字面已同步改掉。
  ⑥ 🔴 **真瀏覽器驗證方法已建立（Sean 2026-07-23 指名 `agent-browser`）**：
     `/checkout` 有登入守門，作法＝建臨時路由以 fixture props 掛 `CheckoutView`、用完即刪並驗 `git status` 無殘留；
     購物車走真實「加入購物車」流程取得真 variantId。詳 memory `reference_agent-browser-cli-real-browser-verify`。
     **動前台 TSX/CSS 的片,收工前都要這樣實看一次**，不要再只交 jsdom 全綠。
  🔴 **U4a 之後仍不得宣稱 design §7.2「全錯誤一次顯示」全段達成**：§7.2 逐字還要求
     「完成錯誤集合後，捲動並聚焦第一個可聚焦錯誤」＝ **U4b 尚未做**。
     可誠實宣稱的是**前半段**：同一次 submit 的所有錯誤（卡片三欄 + card.module + 發票 + 條款）
     已全部同時顯示、不再逐一阻擋 —— 這點有真瀏覽器實測（390px、4 條紅字一次全出、單一 alert）。
     open drift `checkoutAllErrorsAtOnce` **維持 open**，剩 U4b／U5。
- ✅ **U2b `8a3852e` 的 Fable 補審已完成**（Sean 2026-07-22 拍 A）＝ **PASS-with-comments、0 must-fix、判定可 push**。
  🔴 **它抓到 codex 與 code-reviewer 都沒抓到的 F1**：真 TapPayCardFields 進到 `<label class="co-pay">` 內後，radio 的可及名稱由整個 label 內容推導 → 螢幕閱讀器會把「卡號 / 有效期 / CVV / …加密處理」整串念出來；U2a 之前卡欄是 `aria-hidden` 的假預覽故不會，**這是 U2b 引入的無障礙退化**。已於本 commit 修（radio 加 `aria-label`，零視覺變動）。
  另補 F2 測試缺口（同意勾選無法撤回會全綠）。**F3 併入驗收清單**：手機肉眼驗請加測「點『卡號 / 有效期 / CVV』**文字**（不是欄位框）之後，再點欄位框能否正常輸入」—— ⚠️ Sean 2026-07-22 的驗收沒測到這一項。
- ✅ **U3b 已接上非卡片錯誤** + ✅ **U4a（本 commit）已接上卡片三欄與 `card.module`**
  （逐欄紅字／`aria-invalid`／條件式 `aria-describedby`／付款區單一 `role=alert` 摘要；
  `payDisabled` 的 `!tappay.canGetPrime` 已移除；`TapPayCardFields` 內層 `role="alert"` 已移除）。
  **仍未接**：第一錯誤 focus-scroll（U4b）、validate-then-pay 與步驟列鎖（U5）。
- 🔴 **graphify 索引已過期**（2026-07-22 U4a-0 實測）：查詢結果仍含 U2b 已刪除的 `CheckoutStep3.tsx`。
  規劃連動面時**改以全樹 grep 為準**，不得採信 graphify 輸出、也不得宣稱「已查 graphify 連動面」等同已覆蓋。
  刷圖是 milestone 收尾工作，本片未做。
- ✅ **顧客站每日同步時間已往後搬（2026-07-22 完成、獨立 commit）**：
  `.github/workflows/rpm-sync.yml` cron `'0 19 * * *'`（UTC 19:00＝台灣次日 03:00）→ `'30 4 * * *'`（UTC 04:30＝台灣同日 12:30）。
  需求單＝報價單 repo `docs/handoff/REQ-2026-07-22-網站庫同步時間.md`；片型＝高風險片（鐵則 12 ④平台設定：CI），codex 對抗審查已跑。
  原因：舊排程比報價單側爬蟲（台灣 03:30 開跑）還早 30 分鐘，顧客站每天同步到的必然是**前一天**的庫存與價格。
  ✅ **實查：本 repo 預設分支＝`dev`**（`gh repo view` 取得）→ scheduled workflow 跑 default branch，**推 `dev` 即生效、不必推 `main`**。
  🔴 **收工後補測 28 次歷史執行（2026-07-22，`gh run list`）→ 推翻了需求單與我原本寫的兩個字面**：
  ① GitHub 排程延遲 **最小 55 分／中位 72 分／最大 111 分** → 舊 cron 表訂台灣 03:00 的**實際開跑是 03:55-04:51**，
  正好壓在**爬蟲視窗 03:30-04:20 之內**。所以舊行為不是「必然拿到前一天資料」，而是**讀到爬蟲還在寫的部分更新狀態**。
  ② 新排程表訂台灣 12:30 的**實際開跑預期 ≈ 13:25-14:21**（仍安全在 11:30 之後、餘裕約 2 小時）。談實際行為不可用 12:30。
  ③ **總執行時長實測 0.17-0.22h ＝ 約 10-13 分鐘**（近 12 次）→ codex 關卡2「總時長從未實測、最壞 72 小時」的缺口**已用實測解掉**，
  理論值與實況差兩個數量級。⚠️ 另兩項缺口（無 timeout／無缺跑偵測）仍在。
  ④ 歷史 2 次 failure（07-17／07-18）查明＝`materya` 的 **#261 分類 gate**（4 群「未分類」→ abort、`fail-fast:false` 不影響其他家），
  **與排程時間無關** —— 我原本猜是「跑在爬蟲中間造成」，實查後**推翻自己的假設**。
  🔴 **codex 抓到的真問題（未解、跨 repo）**：12:30 只是「排在上游之後」，**不是「上游已完成」的保證** ——
  兩個 repo 之間沒有任何完成訊號／preflight／失敗閘。報價單側防睡鎖 caffeinate 只覆蓋台灣 03:22-07:17，
  而 **11:30 的 `sync_storefront_fitments` 落在防睡鎖放開後 4 小時**、該機 `pmset` 閒置 1 分鐘即睡
  → 可能發生該 plist 註解自述的「跑起來但網路不通的假失敗」（2026-07-22 lightech／samco-stock 即此下場）。
  11:30 失敗或延遲時，12:30 仍會照跑並同步到**更舊**的 fitment。**已 raise 給 Sean、待決策**（見「需要 Sean」）。
  🔴 **另兩項既有缺口（非本次造成、未修）**：① matrix 12 家 `max-parallel:1`、各 job 上限 6h，
  **總時長從未實測、無 timeout、無「營業時間前完成」SLO** ② 失敗只走 GitHub 預設 email，**無缺跑偵測**
  （排程被停用／觸發被丟棄時不會產生 failed run，也就不會有通知）。
- 🔴 **Sean 的真刷驗收路徑（2026-07-22 明講）＝ 正式站開 1 元商品直接刷，不走本地區網**。規劃結帳驗收時**別再提「用手機連本機」**。連帶 backlog #293（本地 HTTPS 通道）已擱置。
  ⚠️ 該計畫的三個前置（已查證）：①正式站結帳目前關著（3DS flag 全 false、`isThreeDSEnabled` 註解明寫「僅 sandbox/staging」）②退款無自動化（全樹無 TapPay refund 呼叫實作，依 07-17 拍板要 Sean 手動去 Dashboard 退）③1 元商品會被一般客人看到（正式站目錄公開、無「只有我看得到」機制）。詳 memory `project_sean-real-payment-verify-via-1nt-product`。
- 🔴 **U2b 已通過 Sean 驗收**（2026-07-22、**390px 桌機模擬**、①無重複區塊 ②無假卡欄 ③版面正常 三項通過）。⚠️ **不是真手機**，且**第 ④ 項「點卡號文字標籤後焦點是否正常」未驗**——該項需真觸控裝置，而真機測試被 `crypto.randomUUID` 非安全環境問題擋住（見下一片）。**推 main 與否由 Sean 決定，本 session 不推、不提議推。**
- Agent: Claude Code
- Mode: 執行模式；**本 commit ＝ M-3 兩步結帳 Slice U3a「建立 canonical invoice schema」**（12 片中的第 5 片、內容分級 L1、高風險片〔鐵則 12 ①錢：`CheckoutInput` 的消費端是刷卡 server action `chargePaymentAction`〕；收檔 11 個；**本片開工基底 ＝ preflight HEAD ＝ parent ＝ `e4b9581`**；審查＝codex 關卡1 + 關卡2 + code-reviewer 全跑、不降級）。**以下為前一片 `62d8522` 的歷史紀錄**：`cart_session_id` 非安全環境 fallback（高風險片、鐵則 12 ①錢；收檔 6 個：`CartContext.tsx` / `CartContext.test.tsx` / manifest〔CartPage＋CheckoutPage 兩處〕/ backlog #293 / `STATUS.md` / 本檔。**本片開工基底 ＝ parent ＝ `5609352`**〔導覽列品牌死連結修正〕；審查＝codex 關卡1×2＋關卡2＋Fable＋code-reviewer 全跑、不降級）。**以下 U2b 段落為歷史紀錄**：M-3 兩步結帳 **Slice U2b ＝ `8a3852e`**（組成單欄 Step 2 並退役 Step 3；**片型＝高風險片**、鐵則 12 ①錢 命中 → 關卡1＋關卡2 codex 對抗審查都跑、不降級）；U2a＝`6443a8e`；U1＝`8061255`；L0＝`d619c14`；拍板紀錄＝`56c01de`。**本輪已於 2026-07-22 由 Sean 授權推出**（`dev` 與 `main` 皆已推、`origin/main` = `e000040`）；未 deploy 之外的動作（DB／flag／env）仍未做
- **🚀 2026-07-22 Sean 拍 A 授權推正式站**:`git push origin dev:main` 完成,**`origin/main` = `origin/dev` = `fa1dd01`**（FF、無 merge）。
  推前逐檔核實:main 缺的 4 個 commit 中**真正會執行的程式碼只有 `packages/schemas/src/index.ts`**(非註解 65 行 = U3a);
  其餘四個 storefront 檔實測**非註解變動 0**。🔴 **cron 從來不需要 main**(scheduled workflow 讀 default branch = `dev`、實查)。
  ⚠️ U3a 等價性是機器證明、**未在真瀏覽器或正式站驗過**。⚠️ push 仍是 Sean 的手動決定,本次為明確字面授權才代為執行。
- Branch: `dev`
- Implementation base：
  - **U2b 開工基底 ＝ preflight HEAD ＝ `6443a8e`**（U2a commit「抽出結帳複查區塊」）＝ **`8a3852e` 的 parent**（🔴 **非本 commit 的 parent** —— 本 commit 的 parent 是 `5609352`），兩者**相同**（`git merge-base --is-ancestor` 驗過）。開工時 `dev` 領先 `origin/dev` 1 個 commit（＝U2a、Sean 尚未推）。
  - **U2a 開工基底 ＝ preflight HEAD ＝ `96cf42c`**（「立正式上線閘 dev 暫不推 main」）＝ **U2a commit `6443a8e` 的 parent**（非本 commit 的 parent），兩者**相同**（`git merge-base --is-ancestor` 驗過）。開工時 `dev` 與 `origin/dev` 對齊、未推 0。
  - **U1（`8061255`、2026-07-21 23:55）開工基底 ＝ 其 parent ＝ `d619c14`**（L0 commit）—— 該輪 preflight HEAD 與 parent **相同**，無 L0 那種落差。
  - 🔴 **L0 的歷史落差（勿套用到 U1）**：L0 的開工基底是 `a53897f`，但其實際 parent 是 `0be428e`「docs(docs): 交接 Eazi-Grip 總代理上市規劃 [marketing]」——
    該 commit 由**另一條線**於 2026-07-21 19:43 在 L0 進行中建立、**不屬於 L0**。
    後續任何 push／revert／review 的範圍計算都必須把它算進去。
  - 🔴 **U2a 開工前並行視窗檢查（實跑，非宣稱）**：`ps aux | grep native-binary/claude` 起初列出 **3 個**進程，逐一 `lsof -a -p <PID> -d cwd` 後發現**兩個 cwd 指向本 repo**（68808 ＝ 本視窗、71740 ＝ 前一視窗，其 transcript 在 13 秒前仍在寫）；十餘秒後複查，**71740 已自行結束**（`ps -p 71740` 回 NOT RUNNING），第三個（95505）cwd 在報價單 repo、不相干 → 確認全程只有本視窗寫入本 repo。tree clean、HEAD ＝ `96cf42c` 對齊 SSoT。
  - 🔴 **U1 那輪的同款檢查**：前一視窗 19:09 啟動、最後動作 22:57「L0 收工」後閒置未再寫入。
- Git snapshot: HEAD、remote refs 與未推數一律用下方命令即時取得。**🚀 2026-07-22 收工時 Sean 授權推出 `dev` 與 `dev:main`，兩者皆已完成**（推前 `origin/main` = `a0c62c0`）；⚠️ push 仍是 Sean 的手動決定，任何 session 不得代推或主動提議。
- Expected dirty: 本 commit 後應為 clean；若仍有 dirty，先辨認 ownership

每個新 session 仍須自行重跑：

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --short --branch && git log --oneline -5
```

## 2. 已確認現況

### M-4a 通知線（修正版 D′）

- 真權威：`docs/specs/2026-07-18-b0-order-notification-email-prd.md`
- B-0 PRD ✅
- B-1 `orders.notification_email` nullable 欄位 + 六條件 CHECK：repo SSoT 記錄為已 apply production
- B-2 `create_order` 8→9 參：repo SSoT 記錄為已 apply production，且路徑②驗收完成
- B-3：**程式、測試與三輪獨立審查已完成，R3 PASS；commit `a7ff24d`**；🚀 已隨 2026-07-22 該次 push 上 `origin/dev`（flag 仍 off，未 deploy 正式站）
- B-2 上線不等於通知功能已上線；第 9 參仍可 `DEFAULT NULL`，必填收緊屬 B-6

### #288 production-build E2E 支線

- #288-a ✅：production config、env preflight、會斷的 smoke、GitHub Actions workflow 已進 git
- 實作 commit：`e700481`
- 下一片：**#288-b（globalSetup 資料合約 + mobile device project）**
- `STATUS.md` 與前版 CURRENT 對 GitHub Secrets／首航結果有漂移：
  - 前版 CURRENT 記錄「Secrets 已設、dev/main 首航皆綠」
  - `STATUS.md` 仍列「Secrets 待設定」
  - 本輪未連 GitHub live 重驗，故不得把任一說法當成當前已確認事實

### M-3 兩步結帳方向

- Sean 已批准 A：由三步改成兩步，第二步採單欄連續式。
- 設計真權威：`docs/specs/2026-07-20-m3-two-step-checkout-design.md`。
- 實作計畫：`docs/specs/2026-07-20-m3-two-step-checkout-implementation-plan.md`；已經 Sol High 兩輪唯讀審查，R1 10 項與 R2 4 項 must-fix 均已折入；依 repo 兩輪上限未跑 R3。
- 計畫共 12 片：L0、U1、U2a、U2b、U3a、U3b、U4a、U4b、U5、L1、V1a、V1b。L1 等兩份正式條款與隱私內容取得核准（**核准矩陣＝Sean 必要、法律顧問選配加簽**，非二擇一；詳 backlog #291）；未完成 L1+V1b 前不得稱 production checkout 完成。
- **Slice L0 ✅ ＝ `d619c14`（2026-07-21 19:55、docs／註解 only、U1 的 parent）**：
  - 新開 backlog **#291**「正式服務條款／隱私政策 route + version/hash」，狀態 🔴 **BLOCKED**，acceptance 十條齊備。
  - 修正 #241 對 live #235 的錯誤依賴（live #235 = 「Step3／完成頁退換貨連結 + 客服 LINE 入口」，**不產出法律頁**）；#235 條目加反向 cross-link 防再漂移。
  - 校正 `apps/storefront/src/lib/legal/terms-version.ts` **active 註解**（依賴改指 #291；標明現行 hash provenance 取自 design **草稿**、不得當未來正式內容來源）。`CURRENT_TERMS_VERSION` 值 `'2026-06-30'` **未動**。
  - manifest `CheckoutPage.open_drifts.checkoutLegalPagesDeferred` 改記「已納入 #291／正式來源待核准／不得複製 design 草稿／仍是上線前人工 release checkpoint」；`last_modified_commit` = `a53897f`（**開工時的 preflight HEAD ＝ 可達祖先，不是本 commit 的 parent**；實際 parent 見 §1）、`last_modified_date` 前置新段。
  - 🔴 **未做（硬紅線遵守）**：未自撰法律文案、未杜撰聯絡資訊、未新增 `/terms`／`/privacy` route、未建 migration、未 bump version、未改既有 consent 歷史、未 apply DB、未開 flag、未 deploy。（L0 當時未 push；🚀 已隨 2026-07-22 該次 push 上 `origin/dev`。）已 apply 的 `20260630120000` migration 歷史註解**未回改**。
- **Slice U1 ✅ ＝ `8061255`（2026-07-21 23:55、首次動 checkout code；🚀 已 push）**：
  - step domain 由 `1|2|3` **原子**收斂為 `CheckoutStep = 1 | 2`；新檔 `apps/storefront/src/components/CheckoutStepIndicator.tsx`（56 行）為唯一型別源，步驟列兩格「收件資料／發票與付款」、只有已完成步驟可回點。
  - **同片**把 `useTapPayCard(step === 3)` 改 `(step === 2)`，不留「步驟已兩步、卡欄仍綁第三步」的中間斷裂 commit。
  - Step 2 依序掛既有 `CheckoutStep2` + `CheckoutStep3`；「下一步:確認訂單」移除；Step 1 CTA 改「**下一步:發票與付款**」（半形冒號）。
  - `CheckoutStep3Props.onEditStep2` 改 optional：兩步版同頁無處可跳 → 不傳即不渲染付款／發票兩顆「編輯」鈕（不留死鈕）。
  - 🔴 **付款安全契約逐條未動**（diff 實證）：`useTapPayCard.tsx` 僅 3 處註解、零邏輯行（generation guard／active=false 即清 state／重入重 setup／getPrime 15s timeout 全留）；`confirmProceedIfInflight → getPrime → charge.submit` 順序、`primeBusyRef` 同步鎖、終態不釋放策略未動；`charge-actions.ts`／`useChargePayment.tsx`／`TapPayCardFields.tsx` 不在改動檔清單內。
  - 🔴 **反假綠**：舊 `CheckoutView.test.tsx` 的 `useTapPayCard` mock **忽略 `active`**（步驟切對切錯都綠）→ 改為真收參數並斷言序列 `false → true → false → true`；突變（`step === 2` → `step === 1`）實測轉紅、還原後綠。
  - ⚠️ **U1 = WIP 中間態**：假卡欄與 `CheckoutStep3` shell 仍在、Step 2 有重複字面節點 → **只可稱「兩步 UI 骨架已實作」**，不得稱兩步結帳完成（見 manifest open drift `checkoutTwoStepWipWaitingU2`）。
  - **審查兩條線（皆先 FAIL、findings 全修）**：
    - code-reviewer **R1 `FAIL`**：1 must-fix（本兩份 SSoT 未同 commit 更新）+ 6 nit，全數已處理。
    - 外部 codex 唯讀（`codex exec -s read-only`，跑前後 `git status --porcelain` 比對**零留痕**）**R1 `NO-GO`**：4 must-fix + 2 nit，全數屬實全數已修。
    - 🔴 **最關鍵一條＝版面缺陷，測試全綠也抓不到**：`checkout.css` 的步驟列 grid 仍是三欄（base 與 900px 斷點兩處）→ 兩顆步驟鈕只佔 2/3 寬、**留下空的幽靈第三欄**；而我在同一片的 CSS 檔頭還寫了「規則本身未變（不依賴步數）」這句**不實**字面。已改兩處為 2 欄 + 檔頭改記「欄數硬編碼、兩處必須同步」+ **新增 `styles/checkout.test.ts` 兩條 CSS 守門**，並實跑兩種突變（桌機改回 3 欄／mobile 改回 3 欄）確認**各自轉紅**、還原後綠。
    - 🔴 **「只改被點名那一處」在同一片復發**：manifest 我只更新了一處，漏掉 active 元件描述的「結帳殼 + 3 步」與 `checkoutStep3ReviewAdaptations` 的「最後一步輸入」→ 已全掃補齊。
    - 其餘：targeted 數字過時（已更正）、STATUS 留下指向不存在內容的前向引用（已補實體）、`git diff --check` 不涵蓋 untracked 新檔（改用 `git add` 後 `git diff --cached --check`）、步驟指示器當前步驟是「可聚焦可按卻無反應」的假控制（見下方 R2 的最終修法）。
    - **code-reviewer R2 `FAIL`（3 must-fix，全在 SSoT 字面、code 面 0 must-fix）**：①CURRENT 內 full test 數字自相矛盾（2597 vs 2600）②`STATUS.md` 當前狀態段尾句仍寫「下一片=U1、待 Sean 放行」＝**同一份 diff 內第三次「只改被點名那一處」**，且落在最高權威段落 ③新元件行數寫 48、實測 56（a11y 修入後未重量）。**三條全已修**，數字改為實跑值。R2 另獨立**突變驗證了 CSS 守門有效**（三種突變字串皆由綠轉紅，非鬆 regex）。
    - **a11y 最終修法（R2 nit 推翻我原本的做法）**：原本把當前步驟設成原生 `disabled` —— R2 指出代價是「移出 tab 順序 + 多數螢幕閱讀器不朗讀 disabled 控制項 ⇒ `aria-current` 很可能永遠念不到」。改為業界標準：**當前步驟保持可聚焦**，以 `aria-current="step"` + `aria-disabled` 表達「我在這一步、此刻不可動作」，handler 由 `step > s.n` 守門 no-op；**只有未完成步驟**用原生 `disabled`。CSS 對應改 `.co-step.is-active[aria-disabled='true'] { cursor: default; }`。
    - 另補：R2 指出「View 不傳 `onEditStep2`」無測試鎖住（日後加回去會靜默產生死鈕）→ 已在 `CheckoutView.test.tsx` 加「step 2 的『編輯』鈕恰為 2 顆」斷言。
    - 🔴 **誠實現況**：R2 的 3 條 must-fix 修正**尚未經第三方覆核**（依 repo 一輪制／兩輪上限，未再開 R3）；codex 線修完後亦未跑 R2。
- **Slice U2a ✅ ＝ `6443a8e`（2026-07-22、12 片中的第 3 片、內容分級 L1、片型＝標準片）**：
  - **片型自行覆核**（未沿用前人判定）：拿 2026-07-22 新版 `CLAUDE.md` 鐵則 12 **六類硬清單**逐條比對 —— ①錢 ②權限 ③DB 結構／大量寫入 ④平台設定 ⑤對外不可回收 ⑥`packages/ui` 共用元件行為，**六類全部未命中**（只搬顯示層 JSX、零 handler、零金額計算，`paymentSlot` 由 `CheckoutView` 建立 `<TapPayCardFields>` 後原樣傳遞；新檔在 `apps/storefront/src/components/`，非 `packages/ui`）→ codex 關卡1／關卡2 **不觸發**；但跨多檔且動 checkout 結構、不算輕量片 → 走完整 9 步含 code-reviewer。
  - 新檔 `apps/storefront/src/components/CheckoutStep2ReviewSections.tsx`（**139 行 < 300**）export `CheckoutShippingSummary`／`CheckoutPaymentSection`／`CheckoutOrderReview`，JSX **逐字**搬自 `CheckoutStep3.tsx`；後者退為 compose（**164 → 122 行**；🔴 **不是字面上的「只 compose」**，見下一條）。
  - 🔴 **發票資訊 readonly 複查區刻意不抽**：它是 U2b 要刪的重複節點（可編輯發票表單已在同頁 `CheckoutStep2`），抽出無未來消費端 → 留在 shell 內隨其一起退役。**因此 `CheckoutStep3.tsx` 並非字面上的「只 compose」**（plan ⑤ 原字面），此為刻意偏離、已於 commit body 與 manifest 揭示。
  - 🔴 **`CheckoutOrderReview` 回傳 fragment、不得包 wrapper**：包了會讓 `.co-review-block:last-child { border-bottom: 0 }` 改變命中對象＝視覺變動。
  - 🔴 **RED 先行**：先寫 `CheckoutStep2ReviewSections.test.tsx`（14 測），實測模組不存在、無法載入 → 才實作。
  - 🔴 **突變自驗三種、全部轉紅、還原後綠**：(a) 改包 `<div>` (b) 注入 `line.slice(0,8)+'…'` 截短地址 (c) 拿掉 `{paymentSlot}`。
    ⚠️ **突變 (a) 當場抓到我自己測試的假綠**：原本結構斷言寫「兩者 `parentElement` 相同」—— 包了 wrapper 後兩者仍共用同一個新 parent、**照樣綠**；已改為鎖「掛載點的直接子節點恰為 `.co-review-block` + `.co-agree`」，重跑突變才轉紅。**沒有這次突變就會留下一條假守門**。
  - 🔴 **DOM 逐字元等價實測（本片最強證據，不是「看起來一樣」）**：臨時 harness 取 `git show HEAD:…CheckoutStep3.tsx` 與抽元件版，對 **96 組 props 組合**（4 種發票型別 × 3 種商品集〔含空集〕× 有無編輯鈕 × 有無地址 × 有無 `paymentSlot`）逐字元比對 `innerHTML` → **96/96 相等**。harness 為一次性檔案，**驗完即刪、不入 commit**（刪除當下即跑 `git status --porcelain` 確認只剩該時點的三個預期異動；收工時的完整收檔清單另見下方 commit 說明，為 12 檔）。
  - **`CheckoutStep3.test.tsx` 零變動（`git diff --cached --numstat` ＝ 0/0）、`CheckoutView.test.tsx` 僅動一行過期註解（1/1，斷言零變動）**，兩檔仍全綠 ＝ 畫面不變的獨立證據。
    - 🔴 **本句原寫「兩檔一字未改」，是 R2 抓出的假字面**：四個位置寫了同一句，我**只在其中兩處補了「後者僅改一行註解」的但書** —— 與 R1 的 MF-1 同一根因（「只改註解 ⇒ 推論未變」＋「只補被點名那幾處」），且發生在我正在修 MF-1 的同一輪。四處已全部改為不依賴上下文的自足字面。
  - 🔴 **不可破壞契約逐條未動**：step domain、validation、CSS（`checkout.css` 不在改動檔清單內）、`confirmProceedIfInflight → getPrime → charge.submit` 順序、`primeBusyRef` 同步鎖、終態不釋放、`agreed` server guard、金額重算、tier、RLS、cart session、3DS callback；`useTapPayCard.tsx`／`useChargePayment.tsx`／`TapPayCardFields.tsx`／`charge-actions.ts` **不在改動檔清單內**；新元件內我方 `<input>` 數 ＝ **0**（已測），PAN／有效期／CVV 仍只在 TapPay iframe。
  - ⚠️ **U2a 沒有關掉任何一項客人可見的 WIP**：假卡欄、Step3 shell、重複字面節點、完整收件複查 **四項全部仍 open**（manifest open drift 已如實記）→ 仍**只可稱「兩步 UI 骨架已實作 + 第二步區塊已模組化」**。
  - 🔴 **連動字面一次改完（不重蹈 U1「只改被點名那一處」）**：先 grep 建「事實 × 位置」完整清單再動手。
    - **事實 B「結帳同意條款兩個連結所在檔已不是 `CheckoutStep3.tsx`」＝ 6 處**：`terms-version.ts` 註解、backlog **#291** 的問題敘述／驗收條件 10 消費端清單／「相關」欄、manifest `checkoutLegalPagesDeferred` 的 note 與 plan。🔴 **這是會讓未來 L1 去改錯檔的真缺陷**，且原文寫死的 `:145-146` 行號已當場變假 → 全改為 `rg -n '服務條款' apps/storefront/src` 錨點、**不寫死行號**。
    - **事實 C「`formatCartVehicle` 的結帳端消費者」＝ 2 處**：`cart-vehicle-format.ts`、`CartVehicleField.tsx`。
    - **事實 A「U2a 已完成」＝ 5 處 code 註解**：`CheckoutStep3.tsx`、`CheckoutView.tsx`×3、`CheckoutView.test.tsx`。
    - **已逐條檢查但確認無需改動者**（記錄下來，避免被誤讀成漏改）：manifest `checkoutStepsWipPlaceholder` 的三項 WIP 敘述在 U2a 後**仍全為真**；`CheckoutView.test.tsx:279` 的「發票資訊 ＝ 2 個節點」斷言在 U2a 後**仍應為 2**（U2b 才回到 1）。
  - **範圍外但必須改的一個檔**：`docs/phase-1-backlog.md`（#291 三處）不在 plan U2a 的 Commit 清單內，但依「字面 ＝ 事實」與全線前置的 SSoT 同步要求必須同 commit 修正，否則 L1 會照著錯的檔名施工。
- **2026-07-22 Sean 看過 U1 真畫面後再拍兩題**（全文 memory `project_m3-u1-two-step-decisions`）：
  - **Q1=A**：假信用卡框**照計畫走、不插隊** —— U2a 抽元件 → **U2b 一併刪**（假卡欄 + CheckoutStep3 shell）。
  - **Q2=C**：付款方式文案改白話 —— `co-pay-label`「信用卡(TapPay)」→「**信用卡付款**」；`co-pay-desc` 刪末段「· 後端串接 TapPay SDK」、保留「VISA · Mastercard · JCB · AE，3D 驗證」。
    🔴 **屬授權覆蓋 design**（兩行字面源自 `design-reference/components/CheckoutPage.jsx:398-399`）→ U2b 須登記 business override `checkoutPaymentLabelPlainLanguage`，否則違反鐵則 1。
    🔴 **兩個消費端一起改**：`CheckoutStep2.tsx` 選項列（Sean 點名）＋ `CheckoutStep3.tsx` 複查行「信用卡 · TapPay」（**未點名、依同一原則延伸、Sean 可否決**）＋ 4 個測試檔字面；**不動** `CheckoutStep1.tsx` 的 B-3 揭示文案。落點＝plan U2b §④/§⑤（含文案搜尋 gate）。
  - Sean 另問「將來串虛擬帳戶，上下要連動嗎」→ **會，結構已是可擴充單選**（design §6.3；design `:432` 原本就畫了 ATM 選項）；但**虛擬帳戶不在 Phase 1**（design §4.2），且需取號／對帳／逾期取消／訂單狀態機，**不是前端工作**。
- 🔴 **正式上線閘（Sean 2026-07-22 拍 A）：`dev` 暫不推 `main`**
  - 🚀 **2026-07-22 已解閘並推出**：`origin/main` 由 `a0c62c0` 前進到 `e000040`（Sean 授權、fast-forward、無 merge）。以下為推出前的歷史記錄。~~現況：`origin/main` = `a0c62c0`（07-20）~~；`dev` 領先幾個 commit **本欄不寫死** → 一律實跑 `git rev-list --count origin/main..dev`。實測 **fast-forward 可推、零 migration、B-3 Email flag off、3DS flag false** → 技術上安全。
  - 不推的理由＝**U1 是刻意留的 WIP**：客人登入後進結帳第二步會看到「發票資訊」「付款方式」各兩次、灰掉的假信用卡欄、夾在中間的「確認訂單」標題。付款雖走不完（flag 關著），但**畫面看得到**，會傷信任。
  - 另一理由：**U1 未經真瀏覽器驗收** —— 桌機僅 Sean 本機 localhost 看過，**390px 手機版零驗證**（U1 的幽靈第三欄教訓＝測試全綠也可能版面壞掉）。
  - **解閘條件**：U2a（✅ `6443a8e`）+ U2b（✅ `8a3852e`）＋ Sean 驗收 390px（✅ **已達成**：2026-07-22 以**桌機瀏覽器 390px 視窗**驗過①無重複區塊 ②無假卡欄 ③版面正常，Sean 回覆「沒問題」並於同日拍 Q1=A **明確定義此即滿足「肉眼驗手機版」**；🔴 誠實揭示：**非真手機**，**第 ④ 項「點卡號 / 有效期 / CVV 文字標籤後焦點」未驗**〔觸控行為、滑鼠模擬不準〕） → **三條件全部達成、閘已解除**；`git push origin dev:main` 為 Sean 的手動動作。
  - 🔴 **Sean 驗收的誠實範圍**：以**桌機瀏覽器 390px 視窗**驗過三項——①無重複區塊 ②無假信用卡欄 ③版面正常，Sean 回覆「沒問題」。
    ⚠️ **不是真手機**，且**第 ④ 項「點『卡號 / 有效期 / CVV』文字標籤後焦點是否正常」未驗**（觸控行為、滑鼠模擬不準）。
    當時真機路徑被 `crypto.randomUUID` 非安全環境 crash 擋住；該問題已於本 commit 修復，真機驗收路徑現已打通、第 ④ 項可補驗。
  - 🔴 **推 main 與否是 Sean 的決定**；本 session 不推、不代推、不主動提議推。
  - 🔴 **U2b 已把「不推的理由」清掉**：重複的「發票資訊」「付款方式」節點、灰掉的假信用卡欄、多餘的第三步 shell 全部刪除；第二個理由（真機驗收）已由 Sean 2026-07-22 拍 Q1=A 銷案：桌機 390px 視窗驗過 3/4 項即算滿足。🔴 仍誠實記錄：真手機與第 ④ 項觸控焦點**未驗**；真機路徑當時被 `crypto.randomUUID` crash 擋住、現已修通，日後可補驗。
  - 🔴 **肉眼驗請指定測四項**：①第二步是否還有重複區塊 ②假信用卡欄是否已消失 ③390px 版面是否破圖（尤其收件摘要地址單行截短、付款區卡欄）④**點「卡號 / 有效期 / CVV」的文字標籤後，焦點是否正常留在該欄**（＝本片明示的殘餘風險：`.co-pay` 依 design 是 `<label>`，點文字標籤可能觸發 label activation 把焦點交給隱藏的 readOnly radio；點 iframe 本身不受影響、codex 兩輪均判無「不改就會壞」的證據，故保留 design 結構）。
  - ⚠️ **U2a 是內部重構、對解閘零進度；解閘所需的可見成果由 U2b（`8a3852e`）提供**（U2a 收工當時假卡欄與重複區塊一個都沒清、畫面與 U1 相同，該敘述現已由 U2b 取代）。
  - 🔴 **在此之前任何 session 不得推 `main`**；推 `dev` 不受此閘限制（storefront 正式站追 `main`）。
- **下一片 = U3a**「建立 canonical invoice schema」（plan Slice U3a）。⚠️ **U3a 不是解閘條件** —— 正式上線閘只等 Sean 手機肉眼驗；U3a–U5 可在 flag-off 下平行推進。
- ~~下一片 = U2b~~ **✅ 2026-07-22 完成（`8a3852e`）**：組成單欄 Step 2、刪假卡欄與 Step3 shell、付款文案改白話並登記 business override `checkoutPaymentLabelPlainLanguage`。🔴 **執行時 Sean 追加拍板「付款區採 A 案」**：真 TapPay 卡欄掛在 N°04 付款方式選項的 `.co-pay-body` 內（＝design-reference `CheckoutPage.jsx:400-422` 原始結構），而非交接單原設想的「掛在付款複查區塊內」——後者會讓畫面連續出現兩次「付款方式 / 信用卡付款」＝正是本片要消滅的重複。連帶：U2a 抽出的 `CheckoutPaymentSection` 無消費端 → **連同其 4 條測試刪除**，`CheckoutStep2ReviewSections.tsx` 剩 `CheckoutShippingSummary` / `CheckoutOrderReview` 兩 export；原計畫「第二個消費端也要改文案」因該節點整個消失而自然滿足。
- route、migration、flag、deploy、DB 至今仍全數未動（U1 動 checkout **UI 層**、U2a 只做**同層 JSX 搬家**、U2b 收斂 UI 並刪除 `CheckoutStep3.tsx`／`.test.tsx`，**三者**都只碰 UI ＋ 測試／manifest／SSoT）。

### 作廢入口

**E2a-2 已於 2026-07-18 D′ 轉折後作廢。**
`docs/specs/2026-07-19-m4a-email-e2a-2-plan.md` 與舊過夜片單只供歷史追溯，
**不得據此規劃、施工或恢復「對帳補寄 + 五訊號」舊路線**。

## 3. 三個入口

| 軌道 | 下一片 | 優先序 | 是否互相阻擋 |
|---|---|---|---|
| 主軌 | **M-4a B-4 規劃 checkpoint**：B-3 已由 `a7ff24d` 收錄；B-4 接真值持久化與 TapPay 三分支 | 全域優先 | 不受 #288-b 阻擋 |
| M-3 | **兩步結帳 U3b**（L0 + U1 + U2a + U2b + U3a ✅ 已收工）：非卡片全錯誤 state 與 ARIA | 兩步 UI 內容已完成，接下來是驗證/錯誤態/schema 收斂 | L1 受 #291 正式法律內容阻擋；U3a–U5 可在 flag-off 平行推進。✅ **正式上線閘已解除**（2026-07-22 Sean 拍 Q1=A）；🔴 **但推 `main` 仍是 Sean 手動動作、不得代推** |
| 支線 | **#288-b**：E2E 資料合約 + mobile device project | 非 M-4a 主線 | 不受 B-3 阻擋 |

三個入口業務上可獨立規劃，但共用 `dev` 與同一 working tree；**同一時間只讓一個執行 session 寫入**，
另一條若同時存在只能唯讀，避免 shared index／push 夾帶事故。

## 4. 主軌審查卡：M-4a B-3

### 已實作

結帳收件資料區塊已加入通知 Email 欄、會員真 Email 安全預填／LINE 合成域留白、UI 揭露文案與測試；
client／server 共用同一份 canonical schema。單一 strict opt-in flag 同步控制四層；off 精確 8 參，on 精確 9 參但第 9 值固定 `null`，所以 B-3 **不會持久化真 Email**。flag 仍保持 off。

### 獨立審查依序讀

1. `docs/reviews/2026-07-20-m4a-b3-checkout-notification-email-packet.md`
2. `docs/specs/2026-07-20-m4a-b3-checkout-notification-email-plan.md`
3. `docs/specs/2026-07-18-b0-order-notification-email-prd.md` §3.1、§3.4、§4、§5、§6
4. `docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md` §8.2
5. `docs/handoff/2026-07-19-m4a-b2-applied-handoff.md` §1、§3、§5、§7

### 六條件硬紅線

zod／server canonical 驗證必須鏡像 DB 的全部六條件，不能只用一般 `email()`：

1. raw 值先只裁掉前後 ASCII space（U+0020），再驗證 canonical 值；DB 收到的值不得帶 padding
2. 只允許可列印 ASCII `^[!-~]+$`
3. UTF-8 octet 長度 ≤ 254
4. 僅一個 `@`，且 domain 至少含一個 `.`
5. domain 小寫並去尾點後，不得等於 `line.pcmmotorsports.local`
6. domain 小寫並去尾點後，不得是 `*.line.pcmmotorsports.local`

漏任一條會形成「app 放行、DB CHECK 擋下、客人只看到結帳 500」。
client 驗證只改善 UX，server 必須重新驗證；log、錯誤與回應不得帶 email 原值。

### 接線與字面紅線

- 單一 env flag 同時控制四層：UI 顯示、client payload、server schema requirement、RPC 呼叫形態
- flag 預設 off；跨片順序固定：
  `B-1/B-2 完成 → B-3/B-4 部署且 flag off → 開 flag 並記 cutoff → 觀察窗 → B-6`
- B-3／B-4 動 TS 時，逐條核銷 B-2 plan §8.2 的 11 項「8 參數」舊字面
- 兩處假綠高風險斷言：
  - `packages/adapters/src/supabase/mappers/order.test.ts`
  - `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts`
- Q2=A：`packages/adapters/src/supabase/database.types.ts` 刻意留到 B-4 更新，不得在 B-3 誤判為漏做
- `packages/domain/src/order/order.ts` 的 `createOrder()` 是 domain factory，不是 RPC，勿誤改

### 審查與收工 gate

- Sean 已批准精確 slice plan；本輪按該 plan 實作完成
- 涉 order／checkout contract，三輪高風險獨立唯讀審查已完成；Review Packet 已同步
- R1 verdict=`FAIL`：null-only marker、manifest 正式清單、flag-on 桌機／手機實測、active 舊字面四項已全修，且已由 R2 reviewer 確認全數銷案
- R2 verdict=`FAIL`：reviewer 確認 R1 四項全銷案，另抓到 Email input 14px 會觸發 iOS Safari 聚焦縮放；已改 mobile 16px、加 CSS RED→GREEN 守門、`agent-browser` 重驗，並同步其檔頭 nit
- R3 verdict=`PASS`：0 must-fix；R1／R2 findings 全銷案，可進 commit checkpoint
- 動 `.ts/.tsx`：typecheck + lint + build + 相稱測試全綠後才可 commit
- 不開 flag、不 push、不 deploy、不 apply migration；這些保留 Sean checkpoint
- PRD §6 八項 gate 未全數達成前，禁稱「通知功能上線」或「孤兒已消滅」

## 5. 支線開工卡：#288-b

### 目標

為現有 production-build Playwright runner 加：

1. `globalSetup` 資料合約與 fail-fast
2. 完整 mobile device profile project
3. `html[data-mobile="true"]` 斷言

### 動工前依序讀

1. `docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md` §3、§6、§7.1、§7.3、§9、§10
2. `docs/phase-1-backlog.md` #288
3. `apps/storefront/playwright.prod.config.ts`
4. `apps/storefront/e2e-prod/runner-smoke.spec.ts`
5. `apps/storefront/scripts/e2e-prod-preflight.mjs`

### 實作紅線

- 收檔以 plan §6 為準：globalSetup 檔 + production config + backlog + `STATUS.md`
- Playwright 執行序是 webServer ready 後才跑 globalSetup；env preflight 已在 webServer command 前綴，不得搬回 globalSetup
- globalSetup 不受一般 test timeout 保護：必設 `globalTimeout`、page/action/navigation timeout
- 失敗訊息只列非敏感計數，不印 URL、key、email 或資料內容
- mobile project 必用完整 Playwright device preset（含 UA），不能只改 viewport
- 必斷言 `html[data-mobile="true"]`，避免 viewport 是手機、server UA 卻仍判桌機的混血態
- 不改既有 `playwright.config.ts`、既有 dev specs、產品邏輯或 `.env*`
- 本機命令：

```bash
cd /Users/sean_1/pcm-website-v2/apps/storefront && pnpm test:e2e:prod
```

`test:e2e:prod` 會自行 build；不要與 dev server 同跑，兩者共用 `.next`。

### 資料策略漂移

- plan §9／§10 寫「不做固定 fixture，先打真 DB + fail-fast contract」
- backlog #288 的依賴卻寫「固定 fixture vs 專用測試頁，移至 #288-b」
- 在 Sean 未另行推翻前，**預設遵守 plan v3.2：#288-b 只做不寫資料的 fail-fast contract**；
  不自行新增 production fixture、專用產品頁或正式資料寫入
- 若實作發現 #288-c 所需 A/B 首屏差異無法靠唯讀 contract 保證，再把資料策略獨立列成 Sean 決策，
  不在 #288-b 暗中擴 scope

### 開工與收工 gate

- #288 全線鐵則 8 已由 Sean 2026-07-20 批准，仍須遵守 plan §6 的單片範圍
- 鐵則 12 已觸發：commit 前產／更新 Codex Review Packet
- typecheck + lint + root tests + production E2E；未實跑不得寫成通過
- 不 push、不改 GitHub Secrets、不 deploy

## 6. Codex 執行端操作坑

- `workspace-write` 的可寫根由**啟動時 cwd**決定；必須從 repo 根啟動 Codex
- 若從子目錄或其他目錄啟動，即使後來 `cd`，也可能無法寫 repo 目標檔
- 執行端使用 `codex exec -s workspace-write`；唯讀審查才使用 `-s read-only`
- 工單要給精確 scope／old-new／驗收，不讓執行端自行擴張
- 若命令長時間無輸出，先檢查 cwd、sandbox 與 subprocess 狀態，不要重複啟動第二個寫入 session

## 7. Git cleanup 收案

Root cause：2026-07-12 至 07-20 多個 session 產出的 handoff、spec、Review Packet、截圖與行銷文件
被持續標成「凍結勿動」，卻沒有進 git，因而逐日累積；不是 Git 自行產生異常。

本輪採 Sean 選定的「保留式整理」：

- `33ccc41`：擴大 `.env*`／`.vercel` 本機檔忽略，保留 `.env.example` 例外
- `cf0dfaa`：收錄 20 份歷史證據；已結案 handoff／截圖／舊設計稿移到
  `docs/archive/2026-07-20-git-cleanup/`
- `a9acb23`：三份 Eazi-Grip 行銷產物獨立收案
- `dd4413f`：進度地圖刷新至 2026-07-20（57 完成／2 進行中／35 未開始）
- 被 migration／測試直接引用的文件保留原路徑，並加「歷史／作廢，不得開工」標記
- E2a-2 明確作廢；現行通知線仍走 D′／B-3
- 沒有刪除任何原始資料，也沒有把 dirty 藏進 stash

新 session 預期從 clean tree 起手。只可精準 stage 自己片內檔案；禁 `git add .`／`git add -A`。
若 status 再出現 dirty，先辨認 ownership；無法解釋才停下問 Sean。

## 8. 已驗證／尚未驗證／需要 Sean

### 本輪已驗證（2026-07-23 Slice U4a，實跑）

- **三綠（全 `TURBO_FORCE=true`、0 cached）**：typecheck **8/8**、lint **10/10**、build **2/2**；`git diff --check` 乾淨。
  ⚠️ 過程中 typecheck 曾單獨紅過一次（build 與測試都綠）：hoisted `tapRef` 把 `fieldStatus` 釘成 `0 as const`
  字面型別，測試要設 1/2/3 就 TS2322 → 已放寬型別。**這正是三綠要分三道跑的理由**。
- **full `pnpm test`：242 檔 2755 passed + 1 todo**（前一片基準 241 檔 2726 ＝ **+1 檔 +29 測**）。
  逐檔：`TapPayCardFields.test.tsx` **9**（新檔）＋ `validate-checkout-payment.test.ts` 24→**40**（+16）
  ＋ `CheckoutView.test.tsx` 41→**45**（+4，其中 ⑤c 為語意反轉改寫）＝ 29，與全套差值吻合。
- **`design-mirror --validate`**：26 元件 / **232** path tokens / 24 可達（231→232 ＝ 本片新增 1 個測試檔）。
- **`wc -l CheckoutView.tsx` ＝ 386**（開工 356、上限 400）→ 🔴 **跑道只剩 14 行，U4b 必須先外移**。
- 🔴 **突變實測 12/12 全紅**（四檔跑完 shasum 與基準逐字一致）：
  M1 status 3 當 valid / M2 `valid` 改用「errors 是否為空」(**10 紅**) / M3 valid 拿掉 canGetPrime /
  M4 紅字改成 `.co-card-row` 直接子元素(**7 紅**) / M5 內層 `role=alert` 復活 / M7 移除 submitAttempted 顯示閘 /
  M8a·M8b `alertFor` 內部合併各丟掉一半 / M9 早退漏 `!cardResult.valid` / M10 loading 當 valid /
  M11 移除 `step!==2` reset / M12 formError 排回數量之後。
  ⚠️ **M2 的確切形式**（Fable nit：不同寫法紅的條數差很多，字面要精準）＝ 把 `const valid = …` 整行換成
  `const valid = true`（等同「valid 在 errors 填入前求值、恆真」），得 **10 紅**；
  若改成「在 return 點才用 `Object.keys(errors).length===0` 判」只會 **1 紅**（由 lib 那條專測守住）。
- **第四層 Fable 盲審：FAIL → 1 must-fix（已修）+ 2 nit**。
  🔴 **它獨家抓到的 must-fix ＝ 送審版本沒凍結**：我在跑 codex 關卡2 **之前**就 `git add`，
  之後依 code-reviewer／codex findings 改的 5 個檔沒有重新 stage（`MM` 狀態）→ 它審的是**過期快照**。
  它並實測證明差異是真的：把付款閘改成「只看 `canGetPrime`、完全忽略 `fieldStatus`」這個 mutant，
  對**舊 staged 版 45/45 全綠（存活）**、對**工作區版 1 紅（被殺）**。
  已全部重新 `git add` 並驗 `git diff --name-only` 為空（staged ＝ 工作區），
  且**重跑該 mutant 確認在最終版本轉紅**。對應 memory `feedback_freeze-artifact-before-adversarial-review`
  ——這條規則我讀過卻還是犯了，記在此供下一個 session 引以為戒。
  另 2 nit：M2 突變形式字面（已於上一段補）、`ready==='error'` 分支文字全來自 props（已改 `errors` 為必填 prop）。
  ✅ Fable 獨立重現並確認：`CheckoutView.tsx` 386 行、full test 242 檔 2755 passed ＋ 1 todo、
  manifest 26/232/24、design §7.2/§7.3 引句逐字命中、no-op 宣稱成立、**無 fail-open、無死路、無鎖洩漏**。
- 🔴 **第一輪突變有 2 個存活 ＝ 我自己的測試假綠（已修，值得下一個 session 引以為戒）**：
  「status 3 絕不 valid」與「loading 絕不 valid」兩條，我把 `canGetPrime` 設成 `false`
  → `valid=false` 是**因為 canGetPrime**，不是因為受測的那個條件；斷言通過的理由是錯的。
  改成釘 `canGetPrime=true` 隔離變因、並補 status 2 / ready=error 兩條同款隔離測試後，M1/M10 才轉紅。
- 🔴 **本線首次真瀏覽器驗證（`agent-browser` + production build，390×844 與 360×780）**：
  `/checkout` 有 server 登入守門（307→/login），故建臨時路由 `tmp-checkout-preview` 以 fixture props 掛
  `CheckoutView`，**用完即刪、已驗 `git status` 無殘留**（U2a harness 前例）。購物車走真實流程加入真商品
  （variantId 來自真 DB）。實測結果：
  ① 卡片三欄 + 條款共 **4 條紅字一次全顯示**（design §7.2 前半段）
  ② 付款區 `role="alert"` **恰好 1 個**（內層 alert 移除生效）
  ③ 摘要「還有 4 個項目」**＝ 畫面實際紅字節點數 4**
  ④ `.co-card-row` 子元素恰好 2 個且都是 `.auth-field` → **grid 擠歪的陷阱沒有發生**
  ⑤ **零橫向溢出**；⑥ 付款鈕**確實可按**（真 TapPay SDK 已載入並回報三欄為空）＝ `!canGetPrime` 移除在真瀏覽器生效
- **手機版置中檢查（Sean 2026-07-23 交辦）＝ 通過**：390/360px 下 `.co-main`／`.co-head`／`.co-layout`／
  `.co-body`／`.co-section`／`.co-pay`／buybar 左右**完全對稱**、零橫向溢出。
  `.co-card-form` 左 98 / 右 66（差 32px）**不是版面歪掉**：`.co-pay` 是 `grid-template-columns: 20px 226px`
  （左欄放圓鈕），卡欄本來就在右欄內；其父 `.co-pay` 本身左右各 49px 對稱。
- **Sean 2026-07-23 交辦的 `agent-browser`** 已落 memory `reference_agent-browser-cli-real-browser-verify` ＋ 索引一行。

### 前一片已驗證（2026-07-22 Slice U4a-0，實跑）

- **開工前並行視窗檢查（硬前置、實跑）**：`ps aux | grep native-binary/claude` 列 **3 個**進程，
  逐一 `lsof -a -p <PID> -d cwd`：PID 43119 ＝ 本視窗（以 shell `$PPID` 逐層比對、非猜測），
  另兩個（64631 / 60228）cwd 在 `PCM報價單-V2` → **本 repo 全程只有本視窗寫入**。tree clean。
- **三綠（全 `TURBO_FORCE=true`、0 cached）**：typecheck **8/8**、lint **10/10**、build **2/2**；`git diff --check` 乾淨。
- **full `pnpm test`：241 檔 2726 passed + 1 todo**（前一片基準 239 檔 2715 ＝ **+2 檔 +11 測**）。
  逐檔拆解：`CheckoutTerminalScreen.test.tsx` **6** ＋ `CheckoutCartNotice.test.tsx` **4**
  ＋ `CheckoutView.test.tsx` **+1**（新增的「終態優先於空車」守門，40 → 41 條）＝ 11，與全套差值吻合。
- **`node scripts/design-mirror.mjs --validate`**：26 元件 / **231** path tokens OK / 24 可達 OK
  （227 → 231 ＝ 本片 4 個新檔）。⚠️ `ProductPage.related_storefront[8]` 警告為既有。
- **`wc -l CheckoutView.tsx` ＝ 356**（開工 392、鐵則 6 上限 400）→ 跑道 **44 行**留給 U4a/U4b。
- 🔴 **行為零變更的機械證據**：`CheckoutView.test.tsx` 既有 40 條中 **39 條零修改全綠**
  （第 2 條「空車」擴充了導航斷言）。這比 DOM 字串比對更強：它涵蓋付款鏈順序、雙擊鎖、清車政策。
- 🔴 **code-reviewer 抓到的 must-fix ＝ 本片最高風險不變量原本零覆蓋**（已補、已用突變證明）：
  「終態必須優先於 loading/empty」是 `CheckoutView.tsx` 註解自己寫死的規則
  （「clear() 後 cart 轉 empty 不可蓋掉終態」），但**從來沒有測試守過** —— 既有測試的 `clear` 是 no-op `vi.fn()`，
  `cartRef.items` 永遠不會變空，`useResolvedCart` 的 status 恆為 `'ready'`，四條終態測試全程走不到 empty 分支。
  後果：若有人把終態判斷挪到 loading/empty 之後（U4a/U4b 往這段插行時極易發生），**剛刷完卡的客人會看到
  「購物車是空的」而不是「訂單已成立」＋單號 → 直接誘導重複付款**，而 40 條既有 + 10 條新測試照樣全綠。
  已補一條讓 `clear()` 真的清空品項的測試；**突變 C（把終態判斷挪到 empty 之後）實測「只有這條新測試轉紅」**。
  ⚠️ 因此本片「40 條全綠 = 行為零變更」的原始宣稱**曾經對這條不變量屬假綠**，據實記錄。
- 🔴 **突變實測 4/4 全數轉紅**（數字皆為**最終版重跑**、非中途快照；腳本與備份在 scratchpad；
  還原後三檔 shasum 與 baseline 逐字一致）：
  **A** `isTerminalChargeState` 恆回 false → **7 紅**（含 5 條付款終態）。
  **B** 把判斷改成「JSX 元素是否 truthy」（`? <元件/> : <></>` 後 `if (terminal)`）→ **41/41 全紅**
  ＝ 整頁結帳表單消失。**這正是 codex 關卡1 R1 抓到的真 bug**，已固化成負向守門測試。
  **C** 把終態判斷挪到 loading/empty **之後** → **只有新補的「終態優先於空車」那條轉紅**（其餘 40 條全綠）
  ＝ 精準證明 code-reviewer 指出的覆蓋缺口為真、且新測試殺得死它。
  **D** 分類表多開一個整頁態卻不補 render 分支 → **`tsc` 轉紅**
  （`TS2322: Type '{ status: "error"; ... }' is not assignable to type 'never'`）
  ＝ codex 關卡2 要求的**真**窮盡保護已生效（前一版 `as const satisfies readonly …[]` 漏列不會紅、是假保護）。
- **兩輪 plan 對抗審查（高風險片不降級）**：
  ① **codex 關卡1 R1 FAIL（11 must-fix + 3 nit）** —— 全部開檔核實屬實。其中 4 條是真缺陷：
     JSX-truthy 旗標（真 bug）、`submitAttempted` 不重設會穩定顯示三欄空白紅字（我推理錯）、
     `allErrors` 是假合併（`CheckoutStep2` 根本不讀 card key）、
     **等價類漏 3 處**（`useTapPayCard.tsx:41`／`:111-120`／`useTapPayCard.test.tsx:170` 的「付款鈕 gate」敘述 U4a 後成假話）。
  ② **codex 關卡1 R2 FAIL（7 must-fix + 2 nit）** —— **核心設計零新增 finding**，codex 明確覆核通過：
     `formError` 新優先序正確／`canGetPrime` 留 validation 但移出 disabled 仍 fail-closed／
     `step !== 2` reset 不會被終態 early return 誤傷。7 條全是測試嚴謹度與流程，已折入
     （U4a-0 補導航點擊斷言＝本片；其餘 5 條屬 U4a 範圍、已寫進 plan v1.1；1 條**不接受**：
     codex 建議把 manifest／文件同步拆到後續片以壓時間，**與 repo「同一 commit 更新 STATUS 七欄與 CURRENT」硬規則衝突** → 依鐵則優先）。
- **Sean 四拍板已落 memory**（`project_m3-u4a-card-errors-decisions`）＋ MEMORY.md 索引一行。

### 前一片已驗證（2026-07-22 Slice U3b，實跑）

- **開工前並行視窗檢查（硬前置、實跑）**：`ps aux | grep native-binary/claude` 列出 **4 個**進程，逐一
  `lsof -a -p <PID> -d cwd`：PID 8215 ＝ 本視窗（以 shell 的 parent 鏈逐層驗證，非猜測）、
  **PID 94437 cwd 亦為本 repo**（15:09 起、transcript 一分鐘前仍在寫）、另兩個在報價單 repo。
  → **停下回報 Sean、不自行處理**；Sean 回「a（已不用）」後複查 `ps -p 94437` 已不存在才動手。當時 tree 乾淨。
- **三綠（全 `TURBO_FORCE=true`、0 cached）**：typecheck **8/8**、lint **10/10**、build **2/2**；`git diff --check` 乾淨。
- **full `pnpm test`：239 檔 2715 passed + 1 todo**（前一片基準 236 檔 2654 ＝ **+3 檔 +61 測**）。
  逐檔實測拆解：**新檔 3 支共 33 測**（`validate-checkout-payment.test.ts` 24 + `CheckoutPaymentFeedback.test.tsx` 3
  + `CheckoutMobileBuybar.test.tsx` 6）＋ **既有檔 +28** ＝ **61**，與全套差值 2715−2654 吻合。
- **`node scripts/design-mirror.mjs --validate`**：26 元件 / **227** path tokens OK / 24 可達 OK
  （220 → 227 ＝ 本片新增的 7 條 related path，數字對得上）。⚠️ `ProductPage.related_storefront[8]` 警告為既有。
- **`wc -l apps/storefront/src/components/CheckoutView.tsx` ＝ 392**（開工 357、鐵則 6 上限 400）。
  三刀外移：純邏輯 → `validate-checkout-payment.ts`（172 行）、state lifecycle → `usePaymentErrors.ts`（98 行）、
  手機底部操作列 → `CheckoutMobileBuybar.tsx`（53 行）。
- **🔴 突變實測 13/13 全數轉紅、零假綠**（腳本與備份在 scratchpad；跑完逐檔 shasum 比對，5 個檔全部逐字還原）：
  ①停用 type-change cleanup ②逐欄 map 改 `issues[0]` ③`valid` 改用 map 是否為空（fail-open）
  ④紅字改成 `.co-inv-grid` 直接子元素 ⑤清除 wrapper 改成全清 ⑥收件紅字改放 `.co-review-body` 之外
  ⑦`aria-describedby` 無條件恆掛 ⑧stale 解除移到 `getPrime` 之前 ⑨auto-fill effect 改回一律清三個
  ⑩`.co-review-body` 渲染條件改回只看 `currentAddr` ⑪describedby 改回寫死單一 id
  ⑫stale 改回套用到所有可重試態 ⑬`getPrime` 拿掉 `.catch`。
- **付款鏈零破壞（實測斷言，非讀碼推理）**：validation 失敗 →
  `confirmProceedIfInflight` / `getPrime` / `chargePaymentAction` 呼叫次數**皆為 0**；
  全合法 → 呼叫**順序**斷言 `['confirm','getPrime','action']`。既有同輪雙擊守門測試未被破壞。
- **四輪審查（高風險片不降級）**：
  ① **codex 關卡1 R1 FAIL（9 must-fix + 1 nit）** —— 抓到雙通道 state 缺失、殭屍訊息、地址／Email 清除路徑漏、
     auto-fill effect 誤清、順序未釘死、註解變假、鐵則 6 額度不足、測試假綠七類。
  ② **Fable 盲審 R1 FAIL（2 must-fix + 4 nit + 1 疑慮）** —— 🔴 **獨家抓到 codex 沒抓到的三條**：
     「View 層清除全滅 mutant 可假綠」（我原本規劃的四個突變**全部殺不死**它）、
     `.co-review-block:last-child` 底線陷阱、紅名單漏列 `:466`。四項與 codex 重疊 ＝ 交叉確認為真問題。
  ③ **codex R2 FAIL（3 未解決 + 3 新 must-fix）** → **R3 FAIL（2 剩餘）**，Sean 拍 A 放行動工（v1.3）。
  ④ **code-reviewer R1 FAIL（1 Critical + 4 nit）**，全數核實屬實、全數已修 + 補負向測試（突變⑪⑫⑬）。
  ⑤ **codex 關卡2 R1 FAIL（2 must-fix + 1 nit）**，全數核實屬實、全數已修：
     🔴 **must-fix ①（真漏洞 + 我的測試假綠）**：舊「付款失敗」只在**驗證失敗**那條路徑被淘汰，
        但客人最常見的動作是「什麼都不改、直接再按一次」→ 取 prime 期間（可達 ~15 秒）舊訊息一直掛著。
        且 codex 指出「刪掉 `resumeChargeMessage()` 仍可能假綠」—— 屬實，因為我原本的測試在 stale 從未被
        設為 true 的狀態下就斷言訊息出現。**修法**：每次按下都先淘汰，並補兩條測試
        （「直接重試期間舊訊息消失」「淘汰後新錯誤可重新顯示」）。
        **突變⑭ 實測**：刪除 `resumeChargeMessage()` → **7 條轉紅**（含這兩條新測），假綠已封死。
     ⑥ **codex 關卡2 R2 FAIL —— 但程式修正全數判定通過，剩餘全是文件字面**（4 處，已全修並自行重量驗證）：
        manifest 兩處被我改成「⚠️ 仍未完成：U3a ✅／U3b ✅」自相矛盾、`handleSubmit` 的「順序不可調動」
        註解仍寫成淘汰發生在 `getPrime` 後（**與實作相反、且這是金流硬順序註解**）、
        CURRENT 把 `usePaymentErrors.ts` 誤寫成 93 行（實際 98；起因是我用 `（8`→`（9` 這種殘缺 anchor 做取代）、
        測試數拆解沿用了抽 buybar 前的舊版（正確＝新檔 3 支 33 測 ＋ 既有檔 +28 ＝ 61）。
        另指出 buybar 的 disabled 守門「擋得住旗標互換、擋不住 `nextDisabled || payDisabled` 混用」——
        屬實，已補反向案例並以 **突變⑮** 實測轉紅。
        🔴 **本輪四個數字全部由我自己重跑 `wc -l` 與逐檔 vitest 取得，非採信審查者轉述。**
     ② manifest 三處已成假話（兩處仍稱 U3a/U3b 未完成、一處行數過期）→ 已改。
     ③ nit：清除函式改 **stable callback + functional update、不閉包 `errors`**（concurrent／中止 render 下
        可能讀到未提交狀態）→ 已改，`invoiceFieldsChanged` 以純值比較判定 formError 失效、不讀 state；
        View 端的 `clearInvoiceKeysRef` 隨之移除、改正常列進 effect deps。
- 🔴 **鐵則 6 第三刀（codex 關卡2 修法的連帶後果，據實揭示）**：must-fix ① 的修法把 `CheckoutView.tsx`
  推到 **401 行 / 上限 400**。我**沒有**再靠壓縮註解硬塞（那正是我寫給 U4a 的禁令），改為執行
  **plan U4a §④ 早已指定的外移候選之一** —— 把手機底部固定操作列抽成
  `CheckoutMobileBuybar.tsx`（53 行，純 presentational、JSX 逐字搬移、class／DOM／文案／handler 契約不變，
  配 6 條守門測試含「兩顆按鈕各吃自己的 disabled 旗標」）。結果 **392 行**、留 8 行跑道。
  ⚠️ 這是本片唯一一處**超出原 plan 範圍**的結構改動，理由＝鐵則 6 是硬規則、不可帶著違反 commit。
- 🔴 **code-reviewer 抓到的 Critical（本輪最痛、值得下一個 session 引以為戒）**：我用 `s.index()` 找
  `last_modified_date: "2026-07-22 [M-3 兩步結帳 Slice U3a` 當 anchor 寫 manifest，**但 AccountPages 也有一條
  同樣開頭的 U3a 連動紀錄且排在前面** → U3b 的敘述被寫進 **AccountPages**，同時造成三重壞結果：
  ①AccountPages 被寫了假話（本片零 account 檔變更）②它原本的 U3a 連動紀錄被覆蓋刪除
  ③CheckoutPage 該記的地方沒記到（commit 說 U3b、date 說 U3a，自己跟自己打架）。
  **`design-mirror --validate` 抓不到**（只驗 path token 存在性與 commit 可達性）。
  已用 `git show HEAD:` 取回 AccountPages 原文還原、U3b 改寫進 CheckoutPage，兩者 commit/date 各自一致。
  **根因 ＝ anchor 未驗證唯一性就寫入**；同一份腳本裡 commit 那行我有 `assert count==1` 保護、date 那行沒有。
- **等價類（`payDisabled=!agreed` 字面）處理**：⚠️ 本輪此清單**錯了三次**（v1.1「3 處」＝ 搜尋範圍只有 3 個目錄、
  非全樹；v1.2「7 處」證據清單誤列 `manifest:1188`、漏掉 `manifest:1035`）。**定案 ＝ 先寫死準則再列結果**：
  準則 A（字面 `payDisabled=!agreed`）全樹 7 處、準則 B（語意）另 3 處。
  **改 4 處**（`charge-actions.ts:165` / `useChargePayment.tsx:43` / `CheckoutView.tsx` 檔頭 / backlog #241，
  全為 comment-only，**server 邏輯一行未改**）；**刻意不改 6 處**（`PROGRESS.md`、`2026-06-30` #241 plan ×2、
  `manifest:1035`、`2026-06-20` 3DS redesign、backlog #241「問題」段 —— 全是歷史快照，回頭塗改歷史是另一種造假）。
  backlog #241 採**附加更正註記、不塗改原文**（前例 ＝ 同條目已有的「⚠️ 2026-07-21 更正（Slice L0）」）。

### 前一片已驗證（2026-07-22 Slice U3a，實跑）

- **開工前並行視窗檢查（硬前置、實跑）**：`ps aux | grep native-binary/claude` 列出 4 個進程，逐一 `lsof -a -p <PID> -d cwd`：
  PID 94437 ＝ 本視窗、**PID 59840 cwd 亦為本 repo**（10:37 起、存活中）、另兩個在報價單 repo。
  → **停下回報 Sean、不自行處理**；Sean 回覆「B ＝ 那個視窗是刻意留著的、照樣開工」後才動手。當時 tree 乾淨、無 index.lock。
- **HEAD 與交接單落差已查明非異常**：交接寫 `e000040`、實際 `e4b9581`，後者是 Sean 授權推出後補的字面同步 commit（commit body 自述）。`git rev-list --count origin/dev..HEAD` ＝ **0**、`origin/dev` ＝ `origin/main` ＝ `e4b9581`。
- **🔴 窮舉差分實測 21,546 組輸入**（Address 17,496 + Checkout 4,050；zod 4.4.3 實裝版，舊/新兩版並排跑）：
  accept/reject 分歧 **0**、成功案 parsed output 分歧 **0**、「候選非現行超集」**0**、issue 集合不同 **4,662 案**（全為多報發票錯誤）。
  觸發條件 ＝ 同一次 parse 有 fatal issue（`invalid_type` / z.enum `invalid_value`）；反證：單獨 `too_small`（姓名空）或單獨 `invalid_format`（addressId 非 uuid）**不**觸發。
- **測試 +35**：`address.test.ts` 4→20、`checkout.test.ts` 30→48、`account/address/actions.test.ts` 10→11（逐檔實跑取得，非推算）。
- **RED → GREEN 基線（以最終版測試對原始 schema 重測）＝ 11 failed / 68 passed（79）** → 改後 **79/79**。
  🔴 **誠實拆解（codex 關卡2 + code-reviewer 同時抓到我原本寫錯）**：79 ＝ 既有 44 + 新增 35；
  新增的 35 條中 **24 條對著舊 schema 就已全綠**（＝發票規則未被改動的機械證據）、**11 條如預期轉紅**。
  ⚠️ 先前寫的「50 條發票特徵測試重構前全綠」**是錯的** —— 那 50 裡有 34 條是與發票無關的既有測試。
- **🔴 突變實測 6 個全部轉紅、還原後全綠**：①canonical 內層 path 改回 `['invoice','title']` ②統編 regex `^\d{8}$` 放寬成 `^\d+$` ③AddressInput 改用自己的 z.object 複本 ④**codex 關卡2 自建：兩個 overload 回傳型別對調** —— runtime 測試 **45 條全綠**、只有 `expectTypeOf` + `tsc` 抓得到 ⑤`CheckoutInvoice` 由 `z.output` 改 `z.input` ⑥**code-reviewer 自建：規則被複製回外層 superRefine（invoice 仍指 canonical）** —— 補斷言前 **63 條全綠**。
  🔴 **教訓（已落 memory）**：原本宣稱「只有實例同一性 `toBe` 測試抓得到 schema 被複製回兩份」是**過度宣稱**。`toBe` 只涵蓋「invoice 欄被換成另一個 z.object」；「規則被複製回外層」會讓同一 path 出現兩條 issue，而以 `.find()` 取值的斷言全部照樣綠 —— 要靠新增的「**同一欄只報一次 issue**」斷言才擋得住。守門的名字不可大於它的實際能力。
- **三綠（全 `TURBO_FORCE=true`、0 cached）**：typecheck **8/8**、lint **10/10**、build **2/2**；`git diff --check` 乾淨。
- **full `pnpm test`：236 檔 2654 passed + 1 todo**（對前一片基準 2619 ＝ **+35**，與逐檔拆解 16+18+1 完全吻合）。
- **`node scripts/design-mirror.mjs --validate`**：26 元件 / **220** path tokens OK / 24 last_modified_commit 可達 OK。
  ⚠️ `ProductPage.related_storefront[8]` 的「無 path token」警告為**既有**、本片未碰 ProductPage。
- **三輪審查全部 FAIL → 全數核實屬實後折入**（高風險片、不降級）：
  ① **codex 關卡1 R1 FAIL**：判定 plan §⑥「byte-for-byte 等價」以 plan 自己指定的做法不可達、推薦 A 案。
     🔴 另抓到**我自己探針的兩個缺陷**：完全沒測 flag-on schema、對 issues 做了 `.sort()` 把陣列順序差異自己抹掉。已補探針 v3 證實。
  ② **codex 關卡2 R1 FAIL（6 must-fix + 1 nit）**：測試未達 plan 自訂覆蓋面（Address 無 fatal sibling、無 server action 通道守門）、overload 型別假綠、片序 4→5、CURRENT 前瞻性宣稱、backlog #198 舊落點、RED 數字不實。
  ③ **code-reviewer R1 FAIL（3 Critical + 2 Important）**：獨立重跑驗證所有數字；額外抓到 codex 沒抓到的 **`toBe` 覆蓋面過度宣稱**、STATUS 同欄兩個互斥「現行下一片」、四處錯置的「(本 commit)」、AccountPages 漏 bump。
  🔴 **三個審查層各自抓到別人沒抓到的東西**，與前四片的實證一致。兩個 codex 輪次皆 `-s read-only`、跑前後 `git status --porcelain` 零留痕。
- **消費端實查（非推論）**：`charge-actions.ts` 與 `account/address/actions.ts` 皆為**逐欄建 map**、不吃 issue 順序；`useChargePayment.tsx` 以 `notificationEmail ?? addressId ?? 通用` 按鍵取訊息 → **客人看到的錯誤字句零變化**。
  全樹唯一仍用 `issues[0]` 的正式碼 ＝ `CheckoutView.tsx` 的單欄 `NotificationEmailInput` parse（順序無關），已加明示豁免註解。

### 前一片已驗證（2026-07-22 Slice U2b，實跑）

- **開工前並行視窗檢查（硬前置、實跑）**：`ps aux | grep native-binary/claude` 列出 3 個進程，
  逐一 `lsof -a -p <PID> -d cwd` → **PID 41369（U2a 那個視窗）cwd 仍是本 repo、且 10 分鐘前還在寫 transcript**
  → **停下回報 Sean、不自行處理**；Sean 關閉後重驗只剩本視窗（PID 59840）才動手。當時 git 樹乾淨、無汙染。
- **三綠（全部 `TURBO_FORCE=true`、0 cached，不吃 turbo 快取）**：typecheck 8/8、lint 10/10、build 2/2。
- **full `pnpm test`：236 檔 2609 passed + 1 todo**。對 U2a 基準（237 檔 2614 + 1 todo）＝ **-1 檔 -5 測**，
  已實測拆解：刪除 16 條（`CheckoutStep3.test.tsx` 12 條 + `CheckoutPaymentSection` describe 4 條）、新增 11 條。
  checkout 四檔 57 綠；U2a 版同組五檔基準 62 綠（用 `git stash` 取基準後還原，`git status` 已比對）。
- **🔴 突變實測（證明守門非假綠，非只看綠）**：
  ①把 `onEditAddress` 誤接成 `onEditItems` → `CheckoutStep2.test.tsx` 與 `CheckoutView.test.tsx` 兩條接線守門**同時轉紅**；
  ②把 `paymentSlot` 移出 `.co-pay-body` → 落點守門 + 卡欄容器唯一性守門**共 3 條轉紅**；還原後全綠。
- **搜尋 gate G1–G6 全過**（原 plan 的「必須零 active 命中」不可機械判定，已於本片改寫並同步回 plan §⑤）：
  G1 使用面 0 / G2 兩檔確認不存在 / G3 文案非測試檔 0（測試檔 3 處全為 `not.toContain` 負向斷言：`CheckoutStep2.test.tsx:212,213,214`）/
  G4 `最後一步輸入` 0 / G5 非測試檔 0（測試檔 2 處全為 `toBeNull` 負向斷言：`CheckoutView.test.tsx:284,314`）/
  G6 殘留 2 處皆明確標「已退役」（`CheckoutView.tsx:12`、`CheckoutStep2.tsx:10`）。
- **`node scripts/design-mirror.mjs --validate`**：26 元件 / 217 path tokens OK / 24 last_modified_commit 可達 OK。
- **codex 對抗審查兩關卡（高風險片、不降級）**：關卡1 **R1 FAIL（4 must-fix）** → 我逐檔核實 4 條全為真 → 全折入 →
  **R2 FAIL（4 must-fix，全為完整性缺口）** → 亦全折入；依 **plan 層審查上限 2 輪**不開第 3 輪，改由關卡2 審實際 diff。
  兩輪皆 `-s read-only`，跑前後 `git status --porcelain` 比對**零留痕**。

### 前一片已驗證（2026-07-22 Slice U2a，實跑）

- `pnpm exec turbo run typecheck --force` → **8/8 successful、0 cached**
- `pnpm exec turbo run lint --force` → **10/10 successful、0 cached**
- `pnpm exec turbo run build --force` → **2/2 successful、0 cached**
- `pnpm test`（full）→ **237 檔 2614 passed + 1 todo**（U1 基準 236 檔 2600 + 1 todo → **恰為 +1 檔 +14 測**＝新測試檔的 14 條，零測試遺失）
- targeted：`pnpm exec vitest run` CheckoutStep2ReviewSections / CheckoutStep3 / CheckoutView **三檔 → 51 passed**
- `node scripts/design-mirror.mjs --validate` → **26 元件／217 path tokens OK／24 `last_modified_commit` 可達 OK**（215 → 217 ＝ 新增的 `.tsx` + `.test.tsx` 兩個 token；既有 `ProductPage.related_storefront[8]` 無-token warning 為既存、未新增）
- `git add` 後 `git diff --cached --check`：clean（🔴 **涵蓋兩個新檔**；`git diff --check` 不驗 untracked、對新檔是假綠）
- `wc -l` → `CheckoutStep2ReviewSections.tsx` **139**（< 300）／`CheckoutStep3.tsx` **122**（U2a 前 164）／`CheckoutView.tsx` **361**（U2a 前 359；+2 全來自註解、**非註解行變動實測 ＝ 0**、< 383）
  - 🔴 **此條原寫「359（未變）」＝ 假字面，由 code-reviewer R1 抓出（本片唯一 must-fix、且是 code 面 0 must-fix 之外的紀錄面錯誤）**。根因：只看「我只改了註解」就推論行數不變，漏掉註解本身也佔行 —— 沒有真的跑 `wc -l`，卻把它寫在「已驗證（實跑）」段落底下。已改為三來源重量（`git show :<path>`／`git show HEAD:<path>`／工作樹 `wc -l`，三者一致）。⚠️ **同款錯誤在 U1 的 code-reviewer R2 已抓過一次**（新元件行數寫 48、實測 56）＝ 本片復發。
- **RED→GREEN 實測**：新測試檔先行時 **模組不存在、整檔無法載入**（`Failed to resolve import`），實作後全綠
- **突變自驗三種、全部轉紅、還原後綠**：(a) `CheckoutOrderReview` 改包 `<div>` (b) 注入 `line.slice(0,8)+'…'` (c) 拿掉 `{paymentSlot}`
- 🔴 **DOM 逐字元等價 96/96**：一次性 harness 比對 `git show HEAD:…CheckoutStep3.tsx` 與抽元件版的 `innerHTML`，96 組 props 組合全等；harness 已刪、不在 commit 內
- `git merge-base --is-ancestor 96cf42c HEAD` → 通過（manifest `last_modified_commit` 可達性）
- ⚠️ **證據等級**：上列數字屬**本視窗自報**、terminal 輸出未存成 committed artifact；code-reviewer 的獨立複核結果見下方審查段
- ⚠️ 「未 apply DB／未開 flag／未 deploy」屬外部系統動作、repo 內無法自證；可自證的只有「未 push」
- 🔴 **本片完全沒有真瀏覽器驗收**（桌機與 390px 皆零驗證）—— U2a 宣稱「畫面不變」的依據是 **DOM 字串等價 + CSS 未動**，不是肉眼；U1 的幽靈第三欄教訓正是「測試全綠也可能版面壞掉」，惟該次成因是 CSS 改動，本片 `checkout.css` **零變更**

### 前一片已驗證（2026-07-21 Slice U1，實跑）

- `pnpm exec turbo run typecheck --force` → **8/8 successful、0 cached**
- `pnpm exec turbo run lint --force` → **10/10 successful、0 cached**
- `pnpm exec turbo run build --force` → **2/2 successful、0 cached**
- `pnpm test`（full）→ **236 檔 2600 passed + 1 todo**
- targeted：`pnpm exec vitest run` CheckoutStepIndicator / CheckoutView / CheckoutStep1 / CheckoutStep2 / CheckoutStep3 / useTapPayCard / styles-checkout **七檔 → 64 passed**
- 🔴 上列數字為**修完兩輪審查 findings 之後**重跑的最終值（先前寫的「5 檔 52 passed」是修補前的過時數字，已由 codex 抓出更正）
- `node scripts/design-mirror.mjs --validate` → **26 元件／215 path tokens OK／24 `last_modified_commit` 可達 OK**（+1 token＝新增的 `CheckoutStepIndicator.tsx`；既有 `ProductPage.related_storefront[8]` 無-token warning 為既存、未新增）
- `git diff --check`：clean（exit 0）
- `wc -l apps/storefront/src/components/CheckoutView.tsx` → **359**（< 383，鐵則 6；U1 前為 383）
- **RED→GREEN 實測**：先寫測試時 **19 個既有測試轉紅 + `CheckoutStepIndicator.test.tsx` 無法載入**（元件不存在），實作後全綠
- **突變自驗（反假綠）**：`useTapPayCard(step === 2)` → `(step === 1)` ⇒ 新測 ⑲ 轉紅（`AssertionError: expected [ true ] to deeply equal [ false ]`），還原後綠
- ⚠️ **證據等級（沿用 L0 的誠實標註）**：除 `design-mirror --validate` 由 code-reviewer 獨立重跑複核外，其餘數字屬**本視窗自報**、terminal 輸出未存成 committed artifact
- ⚠️ 「未 apply DB／未開 flag／未 deploy」屬外部系統動作、repo 內無法自證；可自證的只有「未 push」

### 前一片已驗證（2026-07-21 Slice L0，實跑）

> 🔴 **並行寫入事故（誠實揭示；同款事故第 2 次）**：2026-07-21 19:12–19:28 期間，**有兩個 Claude session 同時對同一個 working tree 寫入**這五個檔案，違反本檔「同一時間只允許一個寫入 session」。
> 兩邊各自對「誰是正牌寫入者」有**互相矛盾**的紀錄，**從 repo 內無法裁決**（`git reflog` 不記執行者、檔案 mtime 只證明時間不證明身分）→ 本檔**不採信任何一方的歸屬敘述**，只記可查證事實。
> Sean 於 19:35 後確認收斂為單一視窗收尾。**收尾視窗對最終內容重跑全部驗證**（`turbo --force`、0 cached、非 cache hit），不沿用任何一方先前自報的數字；下列每一條都是收尾視窗親跑的輸出。
> **一處**由並行期間留下、經覆核**確認為正確**而保留的修正：#291 的分流標籤改為合規值 `P1-before-launch`（`P1-launch-gate` 不在 backlog 規範四選一內）。此為逐行核對整份 diff 後確認的唯一一處；原先寫「兩處」是筆誤，已由 codex 唯讀審查抓出並更正。
> 🔴 **給下一個 session 的教訓**：開工前除了 `git status`，還要確認沒有第二個視窗掛在同一個 repo；本次是在 commit 前一刻才發現，若當時直接 commit 就會把未經自己驗證的字面收進 SSoT。

- `pnpm exec turbo run typecheck --force` → **8/8 successful、0 cached**
- `pnpm exec turbo run lint --force` → **10/10 successful、0 cached**
- `pnpm exec turbo run build --force` → **2/2 successful、0 cached**
- `node scripts/design-mirror.mjs --validate`：**26 元件／214 path tokens OK／24 `last_modified_commit` 可達 OK**；既有 `ProductPage.related_storefront[8]` 無-token warning 為既存、未新增
- `git diff --check`：clean（exit 0）
- `pnpm exec vitest run apps/storefront/src/app/checkout/charge-actions.test.ts`（**須從 repo 根跑**，從 `apps/storefront/` 跑會 `No test files found`）：**1 檔 66 passed**（`CURRENT_TERMS_VERSION` 的直接消費者）
- `terms-version.ts` 經 diff 實證為**純註解變更**：濾掉註解行後 `+/-` 為空，`CURRENT_TERMS_VERSION = '2026-06-30'` 值未動
- RED→GREEN 字面驗證：改前 grep 證實 #241 誤指 #235、active 註解誤稱 #235、manifest 記「Phase 1 不做 legal pages」；改後全樹 grep 確認三處 active 字面均已更正，殘留者僅存在於**凍結歷史紀錄**且已逐條列入 #291
- manifest 結構完整性：`--validate` 解析成功、214 path tokens 與 B-3 紀錄一致（條目數未淨變）、diff 僅落在 `CheckoutPage` 段
- ⚠️ **上列數字的證據等級（codex R1 nit，誠實標註）**：除 `design-mirror --validate` 的 `26/214/24` 與 `git diff --check` 已被獨立第三方（fresh read-back agent 與 codex）重跑複核外，其餘 `0 cached`／`8-8`／`10-10`／`2-2`／`66 passed` 屬**收尾視窗自報**、terminal 輸出未存成 committed artifact → 對後續 reviewer 而言是 **self-reported**。要完全消除此疑慮須把驗證輸出存檔進 repo（本輪未做）。
- ⚠️ 同理，「未 apply DB／未開 flag／未 deploy」屬**外部系統動作**，repo 內無法自證。🚀 push 狀態則可自證：2026-07-22 已依 Sean 指示推上 `origin/dev`（`git rev-list --count origin/dev..HEAD` 實跑為準）

### 前輪已驗證（M-4a B-3，沿用）

- B-3 共用六條件 schema、UI／prefill、client payload、server 重驗、domain／mapper／adapter 四層 gate
- flag off 精確 8 RPC 鍵；flag on 精確 9 鍵且 `p_notification_email: null`
- typecheck 8/8、lint 10/10、build 2/2
- full test：235 檔、2589 passed、1 todo
- 五層突變自驗：schema／UI／payload／server／RPC 任一防線拿掉都會轉紅，還原後全綠
- design manifest validate 通過；既有 ProductPage path-token warning 未新增
- 本機 process-only flag-on 瀏覽器流程：1280×1000 桌機與 390×844 手機 2/2 通過；驗預填、揭露、地址切換、錯誤阻擋、canonical、前進／返回、手機固定列與零水平溢出。R2 修後再由 `agent-browser` 實量 Email computed style=`16px`、焦點正確、錯誤存在、scrollWidth=innerWidth=390。臨時 preview／E2E harness 已刪，未改 `.env*`
- 手機肉眼初驗發現錯誤紅字被固定 buybar 遮住；已補 RED test 與 focus + 置中捲動修正，回歸後完整可見
- iOS Safari `<16px` 聚焦縮放風險已由 checkout mobile breakpoint 16px + `checkout.test.ts` 靜態守門鎖住

### 前一片尚未驗證／尚未執行（Slice L0）

- ✅ **外部 codex 唯讀 review 已執行**（2026-07-21，`codex exec -s read-only -c service_tier="fast"`，codex-cli 0.144.1；每輪跑前後 `git status --porcelain` 皆 0＝零留痕）。🔴 **Sean 2026-07-21 拍板：往後鐵則 12 觸發時不再產 Review Packet 給 Sean 人工貼 web Codex，一律由主 session 直接跑 `codex exec -s read-only`**（memory `feedback_codex-cli-direct-executor-no-packet` 已更新；`/codex-review` skill 的「產檔給 Sean 貼」流程視為已被取代）。
- **審查輪次與結果（截至本 commit；🔴 至今無任何一輪 PASS）**：

| 輪 | 審查者 | verdict | must-fix |
|---|---|---|---|
| R1 | codex 唯讀 | `NO-GO` | 8（+2 nit）|
| R1 | 另一視窗 code-reviewer | `FAIL` | 4（+2 nit）|
| R2 | codex 唯讀 | `NO-GO` | 3 |
| R3 | codex 唯讀（Sean 明示放行） | `NO-GO` | 4 |
| R4 | codex 唯讀（Sean 明示放行） | `NO-GO` | 9 |
| | | **累計** | **28，全數屬實、全數已修** |

- 🔴 **R4 的修正尚未經第三方覆核**；在有任何一輪 PASS 之前，本 commit 不得被描述為已通過審查。
- 🔴 **最嚴重的單一 finding（R1，code-reviewer 抓）**：commit body 與 STATUS 曾寫「code-reviewer R1 PASS(0 must-fix)」＝**不實** —— 那次 PASS 跑在並行寫入期間的舊 diff 上，其後內容又改過。**審查 verdict 必須綁定它實際看到的版本**，版本變了就重審，不可沿用舊 verdict。
- 🔴 **同一缺陷連續四輪復發**（每輪皆「修了被點名處、漏掉別處等價字面」）。R3 後改用「先建事實×位置清單一次改完 + 逐一 grep 反驗」，**R4 仍抓到 9 條**，根因這輪才看清：我的清單只涵蓋 repo 內檔案，漏了兩個載體 ——
  1. **commit message 本身**：一路 append R2／R3 段落卻從未回頭重讀開頭 → 同一份 message 頭寫「15 條」「a53897f 是父 commit」，尾寫「19 條」。**本輪已整份重寫、非 append 修補**。
  2. **被我判為「凍結歷史／範圍外」而跳過的 active 檔案段落**（STATUS 的 07-20 條目、plan `:56`）—— 它們仍在對讀者傳播舊事實。→ 判定「凍結」不等於可以留著錯的字面，至少要標作廢。
- 🔴 **amend 會讓自指 hash 當場失效**：本片 amend 4 次，STATUS 內寫死的 `d40b059` 早已不可達（死 hash，R4 抓出）→ 自指 commit hash 一律不寫死，改記可執行取得方式。
- ✅ **R3 第 4 條的兩處延伸字面，Sean 已授權處置並完成**：①實作計畫 plan 檔 `:7`／`:56`／`:66` 誠實化（硬閘→人工 release checkpoint、核准矩陣精確化、收檔數更正為 7），該檔因此成為本片第 **7** 個收檔 ②commit subject 改為 `docs(storefront): 建立正式法律頁上線 checkpoint [m-3]`（原「上線硬閘」為任務指定字面，經 R3 判定與實際能力不符；未 push 故零歷史改寫成本）。
- （L0 當時字面，已被 U1 取代）~~U1 尚未開始~~ → **U1 已由 `8061255` 完成**；route／migration／version bump 仍未做；DB／env／flag／deploy 仍未做，🚀 push 已於 2026-07-22 執行
- L0 未跑 **full** `pnpm test`（該片零 `.ts/.tsx` 行為變更；U1 本片已補跑 full 236 檔 2600 passed + 1 todo）
- L0 未驗證任何 runtime／瀏覽器行為（該片不產生 UI 變更）

### U4a 尚未驗證（本輪誠實揭示）

- 🔴 **未跑真刷卡 / sandbox 3DS**。真瀏覽器只驗到「卡欄錯誤與版面」，**沒有真的送出過一筆付款**；
  flag 維持 off。`getPrime` 成功之後那一段（charge.submit → 3DS → callback）本片零觸碰、也零實測。
- 🔴 **`aria-invalid` / `aria-describedby` 掛在無顯式 role 的 `div.tpfield` 上，螢幕閱讀器是否真的朗讀＝未實測**。
  真正的可及容器（`role="group"` + `tabIndex={-1}`）是 **U4b** 的交付項。本片只宣稱「屬性已掛上且有守門測試」。
- 🔴 **不得宣稱 design §7.2 全段完成**：§7.2 逐字還要求「完成錯誤集合後，捲動並聚焦第一個可聚焦錯誤」＝ U4b。
  目前可誠實宣稱的只有「同一次 submit 的所有錯誤已全部顯示、不再逐一阻擋」這半段。
- 🔴 **`CheckoutView.tsx` 386/400、跑道只剩 14 行** → U4b 開工前**必須先外移**，不得壓縮註解硬塞。
  ⚠️ 外移候選受 design §8 限制：View **必須保留付款 orchestrator**，能抽的是「錯誤導引」那半或 Step2 actions 區塊，
  付款鏈（confirm → getPrime → charge.submit）不得離開 View。
- **「肉眼驗」未做**（Sean 專屬用詞；本輪是我用 agent-browser 做的程式驗證，不等於 Sean 肉眼驗）。
- **未 apply DB、未開 flag、未動 `.env*`、未 deploy、未 push。**
- ⚠️ **STATUS.md 主表既有漂移續增**：規則 ≤30 行，U4a-0 收工 134 行、**本片 137 行**。非本片造成、但本片讓它更糟。

### U4a-0 尚未驗證（沿用）

- **零真瀏覽器驗證**。本片動的是**四個付款終態畫面與兩個過場畫面**的 render 位置。
  jsdom 測試證明「同樣的 props 產生同樣的節點與文案」，**不證明「在真瀏覽器裡看起來沒壞」**。
  降低風險的事實：JSX 逐字搬移、class／`data-screen-label`／文案／導航皆未動、`checkout.css` 零變更 —— 但這是讀碼與測試推理。
- 🔴 **未實際觸發過真的付款終態**：`paid`／`processing`／`unknown`／`redirect` 全部只在 jsdom 以 mock 的
  `chargePaymentAction` 回傳值驅動。**真刷卡 / sandbox 3DS 未跑**，flag 維持 off。
- 🔴 **DOM 逐字等價 harness 未做**：plan v1.1 §D.3 原列了「對 HEAD 版與外移版比對六種畫面 `innerHTML`」，
  實作時改以「既有 40 條測試零修改全綠 + 2 個突變」取代。**理由**：既有測試涵蓋面更廣（含付款鏈順序、
  雙擊鎖、清車政策），而 innerHTML 比對只證 DOM 字串。**這是對 plan 的偏離，據實揭示、非默默跳過。**
- **「肉眼驗」未做**（Sean 專屬用詞；本輪只有程式驗證）。
- ⚠️ **plan 層審查達 2 輪上限、未開 R3**：codex 關卡1 R2 的 7 條修法**未經第三方覆核**。
  屬於 U4a-0 範圍的只有 1 條（導航點擊斷言，已實作並實跑），其餘 5 條要到 U4a 才驗得到。
- ⚠️ **commit 前審查鏈已跑滿三層、findings 全數修畢，但修完後未再開複審輪**（依 repo 輪次紀律）：
  ① **code-reviewer（opus）R1 FAIL：3 must-fix + 1 important + 2 nit** —— 全數核實屬實、全數已修。
     其中 must-fix ③ 是本輪最痛的一條（終態 vs 空車零覆蓋，見上），另兩條是我自己的字面錯：
     行數寫 354（實為 **356**，我在補檔頭 2 行註解**之前**量的）、`STATUS.md` 一處「U3b ＝本 commit」漏改。
  ② **codex 關卡2 R1 FAIL：2 must-fix + 3 nit** —— 全數核實屬實、全數已修。
     must-fix ① 指出我為前一輪 nit 寫的 `as const satisfies readonly ChargeState['status'][]`
     **不是窮盡檢查**（只驗「列出來的值合法」，漏列不會紅），已改成 `Record<ChargeState['status'], boolean>`
     分類表 + 型別推導 + `never` 窮盡守門，並以**突變 D** 實測 tsc 轉紅。
     must-fix ② 指出 `STATUS.md:12` 的「U3b ＝本 commit」**在句尾補歷史註記並不能消除同一列的相反字面**，已直接改成 hash。
     nit 指出我在測試裡寫的 `fireEvent.click(container)` **不會觸發 React rerender**、註解「再觸發一次 render」是假的
     （測試本身仍有效，因 paid 的 setState 已在空車狀態下完成 rerender）→ 已刪除無作用點擊並改寫註解。
  🔴 **未跑 Fable 盲審**（U3b 的實證是四層各自抓到別人沒抓到的東西）——本片時間與範圍所限未跑，據實揭示。
- ⚠️ **STATUS.md 主表既有漂移加深**：規則「分隔線上 ≤30 行嚴守」，U3b 收工時實測 129 行，
  **本片 +5 行 → 134 行**。非本片造成的漂移，但本片確實讓它更糟；未在本片處理＝範圍外，記此避免無人發現。
- **未動 `.env*`、未 apply DB、未開 flag、未 deploy、未 push。**

### U3b 尚未驗證（沿用）

- **零真瀏覽器驗證**：全部證據來自 vitest（jsdom）+ typecheck/lint/build + 突變實測。
  🔴 **本片動了真 TSX**（不像 U3a 零 UI 變更）→ 版面回歸（紅字撐開、grid 擠壓、摘要位置）
  **只有真瀏覽器看得到**。已加 DOM 位置守門測試（紅字須在 `label.auth-field` 內／`.co-review-body` 內），
  但那證明的是「節點掛在對的父層」，**不是「看起來沒壞」**。
- **未跑真 TapPay／sandbox 3DS／真刷卡**；flag 維持 off。
- 🔴 **`shipping.address` 與 `notificationEmail` 兩條 key 在 Step 2 的 UI 上不可達**
  （addressId 恆為 server UUID；Email 已由 `goNext` 擋在 Step1）→ 保留它們是鏡像 server 契約的
  defense-in-depth，**不宣稱它們擋得住什麼**；測試以元件 props 直接驗 DOM/ARIA 契約，不偽稱是使用者路徑。
- 🔴 **`usePaymentErrors.ts` 無獨立 test 檔**：行為由 `CheckoutView.test.tsx` 覆蓋，
  且突變⑤（改成全清）與⑫（stale 改回全套用）都由它抓到 ＝ 有機械證據，但**非逐函式單測**。
- 🔴 **nit「auto-fill effect 無條件清 formError」的修法沒有回歸測試**：該路徑需要「對不上固定 key 的 issue」
  （如 `invoice.type` 被竄改）才會產生 formError，而那在 UI 上不可達 → 無法用 View 測試自然觸發。
  修法本身已實作（只在 errors 真的變動時才清），但**沒有守門測試**，據實揭示、不宣稱已覆蓋。
- **「肉眼驗」未做**（Sean 專屬用詞；本輪只有程式驗證）。
- **未動 `.env*`、未 apply DB、未開 flag、未 deploy、未 push。**
- ⚠️ **code-reviewer R1 的 1 Critical + 4 nit 全部修完後,未再開 R2 複審**（依 repo 輪次紀律）。
  修法已逐條自驗：Critical 以 `sed -n` 逐行比對 841/1035 兩處、三個 nit 各配一個負向突變（⑪⑫⑬）實測轉紅。
  **下一個 session 若要複驗,這是最該看的一段。**
- ⚠️ **STATUS.md 主表既有漂移**：規則寫「分隔線上 ≤30 行嚴守」，實測 **129 行**（本片進來前即如此、非本片造成；
  本片只加 3 行）。未在本片處理 ＝ 範圍外，但記在此處避免無人發現。

### U3a 尚未驗證（沿用）

- **零真瀏覽器驗證**：本片全部證據來自 vitest（jsdom）+ typecheck/lint/build + 差分探針。不過本片**不動任何 UI**（零 TSX／零 CSS 變更），客人可見畫面理應零變化 —— 這是讀碼推理 + 消費端實查，非真瀏覽器實測。
- **未跑真 TapPay／sandbox 3DS／真刷卡**；flag 維持 off。
- **⚠️ 已知且已被 Sean 接受的行為差異（未實測、僅推理 + 差分探針證據）**：偽造 payload 打 `addAddressAction` 時，回傳通道可能由 `formError` 變 `fieldErrors`。**未以真 server action 端對端實測過**，證據來源為讀 `actions.ts:80-85`（fieldErrors 為空才 fallback）+ 差分探針的 issue 集合差異。
- **「肉眼驗」未做**（Sean 專屬用詞；本輪只有程式驗證）。
- **審查已全部跑完並收斂**：codex 關卡1 R1 FAIL → 折入；codex 關卡2 R1 FAIL（6 must-fix + 1 nit）→ 全數核實屬實、全折入；
  code-reviewer R1 FAIL（3 Critical + 2 Important）→ 全數核實屬實、全折入。詳細逐條見上方「本輪已驗證」。
  ⚠️ **修完後未再開 R2 複審**（依 repo 輪次紀律，R1 的 findings 全為機械字面 + 測試斷言補強，已由我逐條實跑驗證：
  突變⑥ 補斷言後轉紅、突變④ 補型別守門後 tsc 轉紅、所有數字重量後寫入）。**下一個 session 若要複驗，這是最該看的一段。**
- **未動 `.env*`、未 apply DB、未開 flag、未 deploy、未 push。**

### U2b 尚未驗證（沿用）

- **零真瀏覽器驗證**：桌機與 390px 手機版都沒開過，只有 jsdom 測試綠。版面缺陷（破圖、截短失效、卡欄擠壓）
  三綠與單元測試都看不見 —— 這正是解閘還要 Sean 手機肉眼驗的原因。
- **🔴 殘餘風險（明示、未實測、不自宣接受）**：`.co-pay` 依 design 為 `<label>`，
  點「卡號 / 有效期 / CVV」**文字標籤**（非 iframe 本身）時，label activation 可能把焦點交給隱藏的 readOnly radio。
  iframe 屬 interactive content、點 iframe 本身不受影響；codex 兩輪均判定「無不改就會壞的證據」、維持 nit，
  故保留 design 結構（鐵則 1）而非改成 `div`。**請 Sean 手機肉眼驗時指定測這一項**。
- **真 TapPay sandbox 未跑**：卡欄搬位置後的實際 setup / 輸入 / Step 2→1→2 重建，只有 jsdom mock 驗過。
- **未動 `.env*`、未 apply DB、未開 flag、未 deploy（指未手動觸發部署；push main 會由 Vercel 自動建置）。**⚠️ 「未 push／未推 main」為該片收工當下的字面，**2026-07-22 收工時 Sean 已授權推出兩者**。

### U2a 尚未驗證（沿用）

- **未跑真瀏覽器／桌機／390px 手機驗收**：本片全部證據來自 vitest（jsdom）+ typecheck/lint/build + DOM 字串等價比對。**「抽元件後真 TapPay iframe 仍掛得起來」未經真瀏覽器證實**（jsdom 內 SDK 是 mock）。可降低風險的事實：`paymentSlot` 的 React element 由 `CheckoutView` 建立、只是被多包一層 function component，`TAPPAY_FIELD_IDS` 與 hook 的 selector／setup／cleanup 皆未動，`checkout.css` 零變更 —— 但這是**讀碼推理，不是實測**。真瀏覽器與 3DS 驗收由 plan 的 **V1a／V1b** 負責。
- **未做 `pnpm exec vitest run` 以外的 TapPay 生命週期回歸**（`useTapPayCard.test.tsx` 本片未列入 targeted，但已含在 full `pnpm test` 的 237 檔內、全綠）。
- 「肉眼驗」未做（Sean 專屬用詞；本輪只有程式驗證）。
- **U2a 對「正式上線閘」零進度**：解閘要的是 U2b 的可見成果 + Sean 驗收（U2b `8a3852e` 已於 2026-07-22 完成，同日 Sean 驗收並拍 Q1=A → **三條件全達成、閘已解除**）。

### U1 尚未驗證（沿用）

- **未跑真瀏覽器／桌機／390px 手機驗收**：U1 全部證據來自 vitest（jsdom）+ typecheck/lint/build；真 TapPay SDK 在 jsdom 內是 mock，**「真 iframe 在 step 2 掛得起來」該輪未經真瀏覽器證實**。真瀏覽器與 3DS 驗收由 plan 的 **V1a／V1b** 負責。
- **未跑任何真實刷卡／sandbox 3DS**；flag 維持 off，production checkout 仍不可開。
- 「肉眼驗」未做（Sean 專屬用詞；本輪只有程式驗證）。

### 前輪尚未驗證（M-4a B-3，沿用）

- B-3 已由 `a7ff24d` 收錄；push、deploy、正式 flag 與 B-4 尚未執行
- 正式 authenticated `/checkout` 的 flag-on 驗收（正式 flag 仍 off；本輪只驗本機 process-only flag + 真 `CheckoutView`）
- production DB、Vercel 或正式站 runtime；本片不連線、不部署

### 需要 Sean

- 🔴 **正式服務條款與隱私政策內容的來源**（#291 唯一 blocker）：由誰產出／何時可提供、核准人與核准日期。**AI 不自撰、不得複製 `design-reference/components/LegalPage.jsx` 草稿**（該檔自述「草稿待法務 review」、含假電話／假 Email、未實作服務、與 PCM 現行政策衝突的七日退貨說法）
- 🔴 **Sean 用手機看一次結帳第二步（390px）＝ 正式上線閘的最後一道**：確認①沒有重複區塊 ②沒有假信用卡欄③版面沒破圖 ④點「卡號」文字標籤後焦點正常。**Sean 點頭才可 `git push origin dev:main`**。
- ~~是否放行下一片 U2b~~ **✅ 2026-07-22 上午已放行、已完成（`8a3852e`）**。同時 Sean 追拍「付款區採 A 案」（真卡欄掛付款選項 body 內、刪除重複的付款複查區塊）。
- ⚠️ **本輪偏離交接指示、已報備並取得繼續**：交接單原寫 `terms-version.ts` 等三處「不用再改」，但其括號內仍寫著即將不存在的檔名 `CheckoutStep3.tsx`、依本片的 G6 gate 會失敗 →**只拿掉死檔名、不動指標與邏輯**（`terms-version.ts` / `cart-vehicle-format.ts` / `CartVehicleField.tsx` 各 1 行註解）。
- ✅ **審查已結（Sean 2026-07-21 拍板：不開 R5、接受現況收工）**：外部 codex 唯讀跑滿 **R1→R4、四輪全數 `NO-GO`**（累計 28 條 must-fix、全數屬實、全數已修；R3／R4 為 Sean 明示放行，repo 預設上限 2 輪）。🔴 **誠實現況＝R4 的 9 條修正尚未經第三方覆核**；在有任何一輪 PASS 之前，不得把本 commit 描述為已通過審查。
- ✅ **結構性根因已拍板並落檔（Sean 2026-07-21 拍 A）**：同一組事實（核准矩陣／parent／審查狀態／checkpoint 定位）重複散落 7 個檔案 + commit message、靠人工同步 —— 四輪審查證明此結構下人工同步會持續漏。採 **A 案＝收斂為單一來源**（#291 為法律頁事實的唯一權威，其餘各處只留一行指標、不複製內容；自指 hash 不寫死；字面反驗須納入 commit message）。已開 **backlog #292** 獨立一片承接，**不塞進 L0 或任何既有 slice**。
- 現在不需操作 dashboard、DB、env；**2026-07-22 Sean 授權後 `dev` 與 `main` 皆已推出**，`dev` 領先 `origin/dev` 的數量本欄一律不寫死（每多一個 commit 就當場變假）→ 實跑 `git rev-list --count origin/dev..HEAD` 為準（U1 那次的 `origin/dev` push 是 Sean 明示指示、非常態）；主軌下一片 B-4 需另行確認範圍
- push、deploy、production migration、env／GitHub Secrets、正式 flag 切換仍由 Sean 操作或逐次明確批准

## 9. 安全邊界

- 不讀、不輸出、不提交 `.env*`、token、service role、TapPay／LINE credential
- email 是 PII；log、告警、錯誤與 handoff 不得記錄原值
- 不碰正式 DB／migration apply／GitHub Secrets／Vercel env／feature flag，除非 Sean 對該動作明確批准
- 不 reset、stash、刪除或順手 commit 其他 session 新增的檔案
- 預設不 push、不 merge、不 deploy

## 10. 相關入口

- 現況 SSoT：`STATUS.md`
- 共用規則：`docs/ops/AI_CONTRACT.md`
- B-3 PRD：`docs/specs/2026-07-18-b0-order-notification-email-prd.md`
- B-3 實作 plan：`docs/specs/2026-07-20-m4a-b3-checkout-notification-email-plan.md`
- B-3 Review Packet：`docs/reviews/2026-07-20-m4a-b3-checkout-notification-email-packet.md`
- B-2 收案：`docs/handoff/2026-07-19-m4a-b2-applied-handoff.md`
- 11 項舊字面：`docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md` §8.2
- #288 plan：`docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md` v3.2
- #288 backlog：`docs/phase-1-backlog.md` #288
- #288-a 實作：`e700481`
- Git cleanup archive：`docs/archive/2026-07-20-git-cleanup/`
- Git cleanup commits：`33ccc41`、`cf0dfaa`、`a9acb23`、`dd4413f`
- 前版 CURRENT 推齊修正：`cc9ce02`
- 前版雙軌交接：`a0c62c0`

— END —
