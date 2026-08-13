# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史. 🧹 **2026-07-27 主表精簡(Sean 拍板 A)**:主表 357 → 30 行;移出的內容**逐字保存**於 `PROGRESS.md` §「2026-07-27 STATUS 主表精簡存檔」、**零刪除零改寫**,7 欄結構完整保留。

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-4b 後台重建「員工上工」線**(2026-07-26 換軌)/ **Branch:** dev。北極星(Sean 逐字)=「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」;驗收=`docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1「員工的一天」27 項;🔴 **施工序 2026-07-27 深夜改為「E10 訂單閉環 → E8-B 認證(email+密碼)→ E8-C 2FA」**(Sean Q1=A、二次確認 Q6=A;E11 積木改為隨 E10 按需長出、不獨立成階段)。~~舊序 E11→E8→E10~~。
✅ **本線已完成**:全後台畫面預覽 artifact(46 畫面、Sean 驗收畢、U1-U7 全拍板)/ E11-1 `<AdminDataTable>` / E11-2 `<AdminForm>` / #296 儲值金按 Enter 誤扣款 / E8-A1 staff 名單進 DB(migration 已 apply production)/ E8-A2 `/settings/staff` 員工管理頁。📌 **暫緩非作廢**(細節在 PROGRESS 存檔區):M-3 TapPay 正式化線 S3 起 / 退刷線 RF2b 起 / M-4a 通知線 B-4。
🔴 **E8 未完成**:操作者身分仍是使用者**自己下拉挑的、系統未驗證**(`apps/admin/src/lib/session/actor.ts:6` 自陳非授權邊界);後台唯一入口是報價單站的**共用密碼**登入(`ADMIN_PASSWORD` 單一 env;🔴 **TOTP 實查為關閉狀態**——`auth_state.require_2fa=false`、`totp_devices` 0 列、`recovery_codes` 0 列,詳 memory `project_quote-2fa-deployed-but-dormant`)再 SSO 過來,SSO payload **不帶是誰**(`apps/admin/src/lib/session/session.ts:11` 逐字)⇒ **目前沒有「每個員工的帳號密碼」這個東西**。真認證=報價單端跨 repo 線、尚未開工。

## 最後更新
🗂️ **2026-08-13 深夜 98🏁 四窗全收工 merge 入 dev + #452 已上正式庫 + 跨窗衝突解 + backlog #457-470 落檔**(**apply**:`#452` 片 2a-1 採購作廢欄 `supabase db push` 恰一支(dry-run 先確認),Sean 當面按;apply 前主視窗當著他的面跑 preflight Q1(唯讀)= `who=postgres / table_visible=t / col_exists=f / can_read=t` ⇒ 情境 A(欄位尚未建立=預期),判準 `col_exists=f` ⇒ 到此為止不送 Q2;三條 NOTICE 全在預期內(前置閘 A4a 指紋 `4ac2989a…` / 新指紋 `a03e50f7…` / 收工驗收含 `voided_at` 非 NULL 列數=0);**apply 後主視窗獨立複驗不只信 NOTICE** = 兩欄在、`business_key_index_cnt=1`、`business_key_constraint_cnt=0`、`voided_rows=0`;`APPLIED.tsv` 補登 sha256 `6781c355…`、全樹未登錄掃描=0。**四窗 merge**:B `#376` 撞號重編號(`2f91a7b3`)/ S OD 詳情線四片(`9fec15ce`)/ D `#452`(含 apply)/ E 訂單列表 L2+L0(`6f371758`)。🔴 **跨窗衝突**:E 的 `shipped_quantity`(內嵌層)× S 的 `customer_user_id`(orders 層)撞同一行明細投影 —— **主視窗差點用錯錨**(`cancelled_quantity)` 在該行出現 **2 次**,第二次是 `order_cancellation_items` 的、不得加欄)⇒ 改用 `instock_quantity, cancelled_quantity)` 並**先驗錨唯一**;雙向驗證「合成結果 replace 掉 `customer_user_id` == E 版原文」;**三處同步**(E 窗提醒,主視窗原只列兩處)。merge 後 vitest **455 檔 / 7588 格** + typecheck 8/8 + lint 10/10 皆 **`0 cached` = 真跑**。**三輪審查制實錘**:E-L2 三輪各抓不同層(引入的真回歸 / **新加的守門假綠** / 三條同一根因 ⇒ **換路:手寫配對→postcss AST**,七靶全紅);D-2a1 三輪(閘強度 / 宣稱vs字面 / **災難日**)+ 五發回退演練含負向(錯順序實測炸 `column p.voided_at does not exist`,同型前例 a7-rollback v2 擴列③ = **同族第二次**);S-片2 三輪(codex 雙 alias 反例 / R2 三種構造全綠 ⇒ 判停理由=「**每輪修法讓下一種更難構造卻沒讓它不可能**」)。🔴 **「給 Sean 看的三句話」被三輪各抓一句(①未附前提 / ①漏 partial index+③「一個字都沒動」為假 / ②回退宣稱+漏鎖表)⇒ 三句全被抓過** ⇒ 檔頭已寫「用三句話概括五百多行,每次概括都會丟掉一個他需要的東西 ⇒ **先寫三句,然後假設它漏了東西**」;主視窗**逐字讀檔頭**時另抓到 `:19` 舊句抵銷「三件事」框架(=**框架過期**,比資訊過期毒)。**設定優化**:新增 `~/.claude/hooks/block-git-add-all.js`(擋 `git add -A/.`,16 格正負測全綠、自測抓到 `git -C <path> add -A` 漏擋並修;實測擋住)—— 起因 D 窗當日違反該鐵律夾帶 0-byte 檔 `預期`。**backlog #457-470 十四條落檔**(零撞號實測),含 `#466` 已完成(觸控熱區 **視覺 24×16 不變、熱區 48×44、卡片高零變化** ⇒ 「無障礙 vs 太鬆」的對立來自「把視覺尺寸當觸控尺寸」這個前提)。**四窗共通母題**:今天四次「fixture/前提沒構造對,格子照樣印通過」+ 五次「改了一處舊字面留著」+ 主視窗自身七次(含**替沒驗過的論證背書並美化**、**以為有一道我把關的閘而那閘不存在**)。)
🗂️ **2026-08-13 下午 97🪟 四窗並行日:兩份 plan 雙雙判 FAIL(擋在寫 code 之前)+ B 收工 + S 片1 收割**(Sean 令「能開多少窗就開多少」⇒ 主視窗開 **E/S/D/B 四窗**,片界互不撞(退貨面板撞 #445 故不開、2g 排 #445 後、#450 未拍板 ⇒ 四窗是上限)。**B 窗收工** `c89df25c`:#376 撞號重編號,`#308/#342/#343` 三組各改一條(→`#453/#454/#455`)、18 處行級精準改號(不用全域 sed:同一個 `#343` 在不同行指不同條目)、機械複掃 74 處逐處開檔核、結構複驗 `uniq -d` 空;號池解凍**下一號 #457**(#456=22 處釘死 backlog 行號立案,主視窗裁 A)。**S 窗片1 收割** `7720ce8b`:備註搬家+三類分色+收合(主視窗裁 Q3=**C** 收合但未更正的 `customer_notified` 預設展開——稽核證據不預設藏);S **突變測試抓到自己測試的缺陷**(「截斷必須展開」那格的 `open` 其實是被「有告知筆數」滿足的 ⇒ 拿掉 `|| view.truncated` 照樣綠)。**E 窗**列表五片(L2 單一 markup 收斂進行中;🔴 實查 OD `grep -ic rowspan`=0 vs repo=19 ⇒ #447 收斂必須拆 rowSpan,交件附前後 1440 截圖)。**#445 plan v2** `e3573f8b`:折 codex R1 的 33 條,三個設計方向修正(§0-A `payment_refunds` 是刷卡補償退款非訂單退款帳、父表無 status ⇒ Sean Q3=A 前提錯已撤;§0-C v1 的 445a **會製造超退**——上界放 parser 先於 G4 ⇒ 重播被判「金額不合法」⇒ 員工換表單再退一次)。**但 R2 換模型判 FAIL,BLOCKER 指向主視窗自己**:§0-B「RPC 拿不到 TapPay Record」是**假的全稱句** —— 我證明的是「RPC 自己打不了 HTTP」(真),寫下的結論是「RPC 拿不到 Record」(假);`refund-baseline.ts:3-5` 逐字「由 server action 從 TapPay Record API 查得後**餵給** RPC」、`refund-actions.ts:231`(🔴 2026-08-14 R 窗更正:原寫 `:230`,實查 `:230` 是 `recordAmount: null`、`:231` 才是本句所指;行號會漂,認字面 `recordRefundedBefore: baseline.refundedBefore`)**partial 此刻已在傳** `recordRefundedBefore` ⇒ **Sean 的 Q-445-1=A 是在假的二選一框架下拍的,要重問**(C 案=值當參數傳進 RPC、比對放 G4 之後,更安全更便宜)。R2 另有 13 MF,最重=v2 把 `failed` 一律算佔額度會讓**網路斷線這類最常見的暫時性失敗永久卡死**,而解鎖出口(補償帳)要等 2g、2g 又排在本片之後 ⇒ 結構無解。**D 窗採購撤銷 plan v2** `9d38d4cf`(worktree):自報一條過期字面(業務鍵早由 S1b 改成 `supplier_id`)、附錄 A 八列前置檢查**逐列反向突變證明零恆真格**;**codex 關卡1 判 FAIL 19MF+7imp**,四條框架級=案 A 打破 A5a 自己的並發證明(它明寫依賴「本表無 DELETE writer」)/「下游全部備好」漏了搜尋(供應商訂單號只 JOIN 現存採購列)/冪等建在已知不可靠的 audit 上且 audit 寫在 DELETE **前**(既有 receipt RPC 是成功後才寫)/grep 數字**第二次**與 HEAD 不符 ⇒ 三案成本要整份重算。🔴 **codex 會編造像樣但不存在的檔名**(時間戳真、檔名造,四支全中)⇒ 收 findings 要按時間戳對映並逐條開檔核。**需求檔兩處更正** `4f6b8849`:§0-B「出貨完成看 `fulfillmentStatus`」三層錯(該欄 07-28 已明文凍結「新程式不得讀」/引的證據句講的是 `AdminOrderFilter` 篩選器/照做會讓「未收出貨」顯示成「未收現貨」= **最會賠錢那格的名字是反的**)、§0-J 補回寫備註與客人明細四件(S 窗 grep 全 620 行零命中、定案只活在 OD 成品裡)。memory 三條更新:假「做不到」**第二形狀=論證了 A 結論寫成 B**、「查了現況沒查現況的修訂史」、量具坑集 +3(`test -s` 驗存在不驗作者/BSD `sort -t'#'` 壞/codex 編檔名)。四窗全未 push。)
## 最近 3 commit
> dev。🏁 **2026-07-25 Sean 拍板 A:不寫死 hash 與未推數**(寫死的自指數字每多一個 commit 或每次 push 就當場變假、同款前科已 10 次)→ 一律當場執行取得:`git log --oneline -4`(第 1 行=本 commit,其後 3 行=前序)/ `git rev-parse --short origin/dev` / `git rev-list --count origin/dev..HEAD` / `git merge-base --is-ancestor <hash> HEAD`(驗可達、防 busboy off-by-one orphan)。⚠️ `dev` = pcm-admin 的 **production** 分支,push 即部署;`origin/main` 同理不寫死。

## 下一步
①Sean 照 `docs/specs/2026-08-12-order-admin-acceptance-package.md` 跑訂單後台總驗收(🔴 六項優先;已推版、`REFUND_UI_ENABLED=1` 已設)。②Sean 看 OD 第四輪成果並拍狀態配色 A/B/C(OD 推薦 B)+ 密度預設檔 + 「未收未定」第五值。③~~2f apply 停點~~ **2026-08-13 已完成**(講完四條 → Sean 拍 A → 已上正式庫 → 台帳補登)⇒ 下一步是 **#445 超退閘**(排 2g 前)。④~~D 片 2 採購撤銷 plan~~ **v2 已寫、codex 判 FAIL 19MF 折中**;片 3 欄位精簡等 OD 定案。⑤#409 08-13 import 後三句 SQL 驗 0 結案。⑥2g→超退閘 #445→④-a/U1-U3 解鎖。
🏁 **2026-08-13 四窗全收工 merge 入 dev**(B `2f91a7b3` / S `9fec15ce` / D `6bcba338` 台帳+已 apply / E `6f371758`)—— 🔴 **2026-08-14 Sean 已全部 push 上 `origin/dev`(admin 正式站隨之重新部署)**;顆數一律當場 `git rev-list --count origin/dev..dev`、不看本行。~~E 線 L1 未 merge~~ **2026-08-14 已 merge**(`1a65b46b`;三綠 exit 全 0、`456 檔 / 7622 passed`、`@pcm/admin:typecheck` = cache miss 真跑 + 繞開 turbo 直跑 tsc 複驗 exit 0)。
🪟 **2026-08-14 三線並行(Sean 拍:全開獨立視窗)**:**E** `pcm-od-list` = L2 手機小片(每品項寫滿車種/廠牌,Sean 08-14 拍)→ 之後 L3 / **D** `pcm-procure-void` = `#452` 片 2a-2 void·unvoid RPC **只提 plan** / **R** `pcm-refund-guard` = `#445` plan v3 跑 **R3 對抗審查**(換角度換模型;plan §12 逐字)。追蹤帳 `~/pcm-mailbox/.pending-replies.md`(十三代版整份過期、已重寫;含**號碼配發台帳** —— 01:12 兩窗各自「查最大號+1」同時挑中 `#471`,主視窗製造的撞號,改為集中發號:D=`#471`/E=`#472`/R=`#473`)。**已收割**:`#473` RW4 判定單向不可逆(硬前置=`#445b` apply 停點,**不是員工上工前**)/ **`#445` plan v4**(684 行,折堆 B 22 條;🔴 **C1 金流 fail-open** = v3 只有 partial 那行有 `guard IS NULL OR`、full 那行沒有 ⇒ 兩行已對稱;🔴 R 折的過程**新抓一條 v3 沒有的**:`SUM()` 對零列回 NULL ⇒ 每張單第一筆退款會被擋死,已定 `COALESCE(SUM(...),0)`;堆 A 5 條標 `⏸` 待 `Q-445-R3-1`,11 處標記實查)。**E L3 拆 4 片**(主視窗裁),片1 完工待審 —— 🔴 **reviewer gate 擋:E 與主視窗 session 皆禁用 AgentTool ⇒ 裁由 R 窗 fresh-context 代審(對 SOP `code-reviewer` subagent 的明文偏離,標記逐字申報、不假裝)**。🔴 **`#445` plan v3 已存在**(`188e185d`)—— 交接檔與舊追蹤帳寫的「停在 v2 待折」是過期字面。
🧹 **2026-08-14 環境整理(新視窗照舊路徑會撲空,詳交接檔 §0-B)**:報價單 repo 已 clone 到本機 **`~/API大量上架/PCM報價單-V2`**(與 origin/main 同步、`.env` 三支就位;舊的 222 顆落後版改名 `.OLD-222落後` 封存,含 `data/` 461M 可當備料)/ `~/pcm-截圖` → `pcm-website-v2/.screenshots/`(gitignore)/ 報價單一次性腳本 4 組 → 該 repo `data/one-off-archive/` / worktree 18→4(留主樹 + `pcm-od-list` + `pcm-site-redesign` + detached JSDoc 那顆)/ `.turbo` 16G 快取已刪 ⇒ **下次 typecheck/lint 全量重跑會慢一輪,是預期不是故障**。
🔴 **夜跑新視窗第一件事**:讀 `docs/handoff/2026-08-13-night-run-handover.md` —— 四線交接、各窗未落檔判斷、`#452` 開工前必讀、**E 線 L3 兩題待裁 + `order-list-view.ts` 668 行鐵則 6 判斷**(細節在 `~/pcm-mailbox/E-381-HANDOFF.md`,85 行必讀)。
## Sean 待決策
🔴 **`#462` Q3 附加條件待釐清**(主視窗已問、Sean 未回):他拍 Q3=A 時逐字加了「**到貨的商品要可以轉去庫存那邊**」,而那與 08-12 Q6=A「不做庫存」+ 08-11 Q11「庫存落點在報價單 repo」的關係要他自己定 —— 選項 A=現在先記著、等庫存功能做出來再接(推薦,`#452` 已照此做完並落誠實缺口 G7);B=現在就要能轉(那要等報價單 repo,整條線停下來等)。
~~`§0-STANDING` 第 5 條~~(**2026-08-14 已拍「要」並落檔**:條文在 `docs/specs/2026-08-12-admin-order-ui-design-brief.md:542`、commit `916106bf` ⇒ 本格為過期字面,十五代撤下。內容=改動過的可點區域要用 hit test 驗、不能用截圖驗;兩個假通過(rect 0×0、視窗外回 `null`)已一併寫進條文)。
~~E 線 L2 兩件~~(**2026-08-14 已拍**:①桌機 = **收斂後**(維持 `025a7e7e` 現況、不退)—— Sean 逐字「那算了,太麻煩了。就選收斂後吧」,他是在知道代價之後選的(選項 A=退顆回到收斂前但程式碼變回兩份、B=保留一份再壓行高;他選第三條=接受現況不再花工)⇒ **表格總高 +10.4%、多品項單第一列 38→62px 為已接受的既成事實,後續片不得再拿它當缺陷報**;rowSpan 拆除與 §0-B 字面的衝突同時結案(判定=舊條載體被新拍板取代)。②**手機採 `l2-after-430-v2.png` 那版**=每個品項都重複寫滿「車種/廠牌」,**不是**現行 code 的最終版(第二項省略重複值)⇒ **待改一小片**,無架構衝突、交件須附 430 截圖(§0-STANDING)。)
~~2f apply 停點四條~~(2026-08-13 已講、已 apply)。~~Q-445-1~~(**2026-08-13 拍 C**:Record 值當參數傳進 RPC、比對放 G4 之後;推翻同日稍早的 A —— A 是在主視窗的假前提下拍的。**Sean 同時定調「我要求的是使用上直覺、好用即可」** ⇒ 已轉成 #445 驗收條件:錯誤訊息要讓員工知道**下一步做什麼**,不是丟技術碼)。~~Q-E-2~~(拍 A:訂貨 n/m 欄與付款膠囊下架、狀態欄獨扛)。徽章兩題:#446 沖銷之沖銷語意(D 立案三選項)/ #437 訂單標頭殘題(要不要標頭再一顆「已收足」徽章;四點主體已完工 `76aff2e3`)/ 採購「改軟」三片做完後要不要接 #374 採購單層與庫存(落點已定=報價單 repo)/ memory 索引下輪盤整再議。~~視覺統一改輪~~(2026-08-13 已拍:OD 三塊方向選定,詳情甲/列表丙/客人卡甲)。~~OD 三題~~(2026-08-13 已拍:狀態配色 **A 溫和**(推翻 OD 推薦的 B)/ 密度預設 **寬鬆 40px** / 「未收未定」第五值 **保留**;第五輪只修兩件=物品名稱吃空白其餘六欄被截、手機版排列)。
## Blocker
無硬 blocker。🟡 M-3 prod checkout 仍不可開(3DS flag 全 false、獨立線、非本線)。
## 緊急 backlog
無(#441① SHAPE-3 判別力=決策題非急)。
---

## OD 商品頁改造線(並行 workstream、Claude-Code 自驅、不入主表)

> 與報價單資料線(S3a/S3b)並行的另一條線。**主表 7 欄由報價單線擁有**、OD 線狀態記此附屬區 + manifest `od_redesign`(Sean 2026-06-02 拍 A)。寫審分離 ROLE=A(施工 session 實作、審查 session 哨兵盯 dev 自動 fresh-context 複驗)、**不跑 busboy-end**(避 clobber 報價單線)、Sean 手動推。

- **視覺真權威:** OD 模板 `product-detail-rpm-template.html`(open-design "Website V2")+ `HANDOFF-rpm-template.md`。鎖定決策見 manifest `od_redesign.decisions`(決定一=A OD=視覺真權威 / D1=A 適用車款表全車種 3 欄無車系 / D3=A 12K 收進紋路無消光、由真資料 disable / Q1 override:N°03 留相關商品 + FAQ→N°04)。
- **當前 slice:** **Phase A 完成 ✅ + 已合併進 dev(merge cf630b2)**。OD-5 服務橫條 / OD-6 N°01 / OD-7 N°02 紋路牆+預覽卡+圖庫聚合 / OD-8 分頁碳纖維化 / OD-9 N°03 相關商品 / OD-10 N°04 FAQ+JSON-LD(保固共用 rpm-policies 單一真相)/ OD-11 buybar OD §12+響應式≤1079,共 11 片(OD-5~11)+ 先前 OD-1~4 全完。合併後三綠 + 完整 pnpm test 531 全綠,OD 元件 × S6 fitments 共存確認。
- **下一步:** ✅ **OD 線已收尾**(2026-06-16 查核更新):OD-12 適用車款表 + OD-12b/c/d 桌機重設計 + OD-13 FAQ + OD-V~V3b 手機/iPad 真機驗收修正**全部完成、併入 dev、已推 origin/dev**(`dev..od-redesign` 空、od-redesign tip `266f5f2` 在 origin/dev、審查 PASS `9cc5bbd` + 交接 `f3d6a42`)。此附屬區先前「OD-12 待做」字面為過時殘留、已更正。後續 OD 強化由 Sean 主導視覺(memory sean-owns-visual-design)。
- **Phase A 連續做(Sean 拍 B):** OD-3~OD-11 全速連續 commit、Sean Phase A 全完肉眼驗一次、哨兵每片自動審 FAIL 即通知。
- **分片清單:** Phase A(現做、不等 S3)OD-1→OD-11(地基/Hero/右欄/Picker+預覽/服務橫條/N°01/N°02紋路牆/分頁/N°03相關/N°04 FAQ/buybar+響應式);Phase B(等 S3b)OD-F1 適用車款表(接 fitments[])/ OD-F2 真資料收口。完整 OD區塊↔元件對照 + 計畫見對話 OD-0 偵察報告(待 Sean 點頭存 docs/specs/)。
- **⚠️ 跨線紀律:** OD 線不碰 `scripts/rpm-*.ts`(報價單線 WIP)、`docs/reviews/integration-phase1-review-log.md`(審查 session)、`docs/specs/*S3*`(報價單線)。

## 速查 / 歷史(已外移、降低本檔讀取成本)

- **速查**(Phase 1 範圍 / 技術棧 / 關鍵路徑)→ `docs/quick-reference.md`
- **變更紀錄**(slice 逐筆歷史)→ `PROGRESS.md`「STATUS.md 變更紀錄歸檔」段

## 文件交叉引用

每次新對話依此順序對齊上下文:

1. **`STATUS.md`** ← 本檔(每次先讀)
2. `docs/PHASE-1-NORTHSTAR.md` v2 — Phase 1 真權威定義
3. `docs/lessons-learned.md` — 舊專案教訓彙整
4. `CLAUDE.md` — Claude Code 工作規則
5. `docs/PHASE-1-MILESTONES.md` — milestone 排程
6. `docs/decisions/` — 重大決策記錄
7. `docs/patterns/` — 通用 + PCM 專屬規矩
8. `docs/phase-1-backlog.md` — 未決事項
9. `docs/features/*.md` — PRD
10. `design-reference/` — 視覺真權威字面(submodule)
11. `PROGRESS.md` — 歷史紀錄
12. `docs/quick-reference.md` — 速查(Phase 1 範圍 / 技術棧 / 關鍵路徑)

衝突仲裁順序:
- STATUS.md 與其他 md 衝突 → STATUS.md 為準
- 其他 md 與對話歷史衝突 → md 為準
- 視覺 / 結構 / 路由 / 元件命名衝突 → design-reference 為準
- 業務邏輯(訂單流程、權限、價格、Medusa schema)衝突 → docs/decisions/ 為準

## Busboy 機制(沿用第一輪)

- **busboy-start.js:** Sean 在 Terminal 跑、輸出貼新 Claude Code session 第一則訊息
- **busboy-end.js:** Claude Code 在 session 最後跑、自動更新本檔 5 個欄位(最後更新 / Phase Milestone slice Branch / 最近 3 commit / 下一步 / Sean 待決策)、commit、不 push(Sean 手動推當 review checkpoint)
- ⚠️ WO-6 後「變更紀錄」已移 `PROGRESS.md`「STATUS.md 變更紀錄歸檔」段、不再寫本檔;busboy-end.js 若仍寫 STATUS 變更紀錄表需同步改寫(pcm-tools 外部 repo、待 Sean 處理)
- repo 參數:`pcm`(本 repo)/ `tools`(pcm-tools)

第一次 busboy-end 跑之前、本檔欄位手動填(start template 用、由 Claude.ai 維護)。

busboy-end 跑完後 amend 進 slice 主 commit、不另開 commit。

— END —
