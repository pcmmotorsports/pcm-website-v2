# STATUS.md
> PCM Phase 1 SSoT. 衝突仲裁: STATUS.md > NORTHSTAR > 其他 md > 對話歷史. 🧹 **2026-07-27 主表精簡(Sean 拍板 A)**:主表 357 → 30 行;移出的內容**逐字保存**於 `PROGRESS.md` §「2026-07-27 STATUS 主表精簡存檔」、**零刪除零改寫**,7 欄結構完整保留。

## 當前狀態
**Phase:** Phase 1 / **Milestone:** **M-4b 後台重建「員工上工」線**(2026-07-26 換軌)/ **Branch:** dev。北極星(Sean 逐字)=「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」;驗收=`docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1「員工的一天」27 項;🔴 **施工序 2026-07-27 深夜改為「E10 訂單閉環 → E8-B 認證(email+密碼)→ E8-C 2FA」**(Sean Q1=A、二次確認 Q6=A;E11 積木改為隨 E10 按需長出、不獨立成階段)。~~舊序 E11→E8→E10~~。
✅ **本線已完成**:全後台畫面預覽 artifact(46 畫面、Sean 驗收畢、U1-U7 全拍板)/ E11-1 `<AdminDataTable>` / E11-2 `<AdminForm>` / #296 儲值金按 Enter 誤扣款 / E8-A1 staff 名單進 DB(migration 已 apply production)/ E8-A2 `/settings/staff` 員工管理頁。📌 **暫緩非作廢**(細節在 PROGRESS 存檔區):M-3 TapPay 正式化線 S3 起 / 退刷線 RF2b 起 / M-4a 通知線 B-4。
🔴 **E8 未完成**:操作者身分仍是使用者**自己下拉挑的、系統未驗證**(`apps/admin/src/lib/session/actor.ts:6` 自陳非授權邊界);後台唯一入口是報價單站的**共用密碼**登入(`ADMIN_PASSWORD` 單一 env;🔴 **TOTP 實查為關閉狀態**——`auth_state.require_2fa=false`、`totp_devices` 0 列、`recovery_codes` 0 列,詳 memory `project_quote-2fa-deployed-but-dormant`)再 SSO 過來,SSO payload **不帶是誰**(`apps/admin/src/lib/session/session.ts:11` 逐字)⇒ **目前沒有「每個員工的帳號密碼」這個東西**。真認證=報價單端跨 repo 線、尚未開工。

## 最後更新
🗂️ **2026-08-13 凌晨 94🌙 三軌並行夜:D 兩片收割 + P 之 2f 兩輪審查(含換路裁決)+ OD 訂單後台改版兩輪 + Sean 五拍板**(**D 兩片已 merge `a49d60f2`,三綠含 build 全 exit 0**:①文案分流 `3df88a77`(Server Action not found 的換版/斷線分流;三輪審查 R1 3MF→R2 5MF→R3 1MF 全折,🔴 **R3 換模型抓到穿透前兩輪的判準鍵選錯**——`everCreatedRef` 只在拿到回傳時才 true,而斷線的定義就是沒拿到回傳 ⇒ 先斷線再撞換版會對員工說「不會多出一箱」的假話;R2 另抓到 D 給主視窗的 escalate 清單 **0/7 是真的**,病根=把「檔案提到路徑」當「載入」,mock 一支模組本身就會提到它的路徑)②到貨撤銷 B 案 `4d774876`(用表單手上的冪等鍵反查 receipt_id,**只命中 Sean 一半需求**——「key 錯資訊當下就撤」中、「事後發現該給別單」不中,界線**寫進畫面**給員工看;R2 兩條都在打 D 的折法:它加的守門格是 no-op、blocked 與 failed 同形狀只認一半;🔴 **主視窗裁補歸屬交叉檢查**——不是為今天的風險,是因為原本的安全靠「鍵不可猜+SSO」兩個這段 code 管不到的外部條件,鐵則 12② 權限面不降級)。**P 線 2f**:R1 codex FAIL 33 條全折(換窗折,前代自評「逐字寫下判準卻沒照著問」)→ **R2 換模型 Opus FAIL 19 條**(4MF/10IMP/5nit);🔴 **主視窗下換路裁決**:P6-op 被 `NOT (...)` 繞=同一道守門第二次同型被繞 ⇒ **結構斷言不再加碼**(它本質是比對 catalog 文字、永遠有第 N+1 種等價寫法),**語意保證移到 neg 模式行為測試**;R2 命中主視窗指定要打的兩點=**兩條「假的誠實缺口」**(P5b/①a2 其實十行可測)+ **抽驗繞過測試表 5-8 列即抓到兩格填錯**。**OD 訂單後台改版**:第一輪三方向 → Sean 選定(詳情甲分頁式/列表丙主從式/客人卡甲摘要優先)+ 同句打回「**留白太多、習慣看資訊很密集**」⇒ 第二輪密度重做中(以他現用 Google Sheet 一屏的量為標竿)。**Sean 拍板五件**:Q5=C(會湊多張客戶訂單成一張採購單、也會分批)/ Q6=A(**只做採購「改軟」、不新增採購單實體、不做庫存**)/ Q10=A(採購改軟三片先做)/ Q11(**庫存要做落點在報價單 repo**,理由=那裡才帶得進商品資訊)/ `REFUND_UI_ENABLED=1` 已設。**採購改軟三片**:片1 到貨撤銷已收、片2 採購撤銷=高風險待 plan(DB 無 DELETE RPC、現行唯一救濟是手動 SQL)、片3 欄位精簡等 OD 定案。**兩條機制入 playbook**(皆「破壞不當場報錯」型):/tmp 中繼檔被**別窗覆寫**(前兩例是被清掉;清掉會報錯、覆寫不會 ⇒ `test -e/-s` 零判別力)、**已 apply migration=凍結檔連純註解都不能動**(APPLIED.tsv 釘 sha256,D 實測加註解即失配、已還原複驗回位)。backlog 待發號四條(死結消融實證/shipment-dialog 463 行拆檔/到貨事後撤銷 A 案/P4A03 訊息有前端 fixture 依賴)。dev 未推 4(本 STATUS 顆前)。)
🗂️ **2026-08-12 深夜 93🔚 主視窗換代收工:訂單後台完整化線收線+三窗收哨+盤整常設**(D 十一代四片全收=#351③ 收尾 99ae4d8a/A13 操作欄 f07b3e29(各兩輪審查)/總驗收包 7e8452e5=`docs/specs/2026-08-12-order-admin-acceptance-package.md` 五路線順路驗收單、B 之 #441②③ d482ff59;沖銷入口 #372-A12 Sean 正式站實測收案(RCPVVJ 現金 6 元沖銷、audit actor/before-after 全對);P 之 2f=plan 三輪 48 條收關卡1、migration 五檔在製品但 diff R1 codex 9MF+18imp=五處守門要重做形狀 ⇒ 裁「交接不硬折」、P 窗收哨、下一代 P 重折(交接檔=docs/handoff/2026-08-12-2f-r1-fold-handover.md);B/E/S 三窗收哨(B 五片日);拍板集=Q-2f-1=10s/Q-2f-2=B 放行/超退閘 #445 做排 2g 前/沖銷三題 AAA/盤整三題 AAA(pcm-housekeeping skill 常設、STATUS 本輪照 07-27 模式二次精簡、memory 撤 2 條+檔數門檻作廢);#409 報價單側源頭已修、08-13 三句 SQL 驗 0 結案;#352/#351 backlog 進度欄落後三天=兩次「進度欄不是事實」實錘。dev 未推 7 顆(本 STATUS 顆前)。)
🗂️ **2026-08-12 傍晚 92🚀 三支 migration 一次 push 全上正式庫(130000/150000/160000,NOTICE 斷言全綠)+三線審查全收官+extreme 667 收案**(**apply**:preflight 五查 Sean 貼全綠→dry-run 恰三支→push 三支 NOTICE 逐字中預期(130000=19 條+前置閘/150000=#423 結構驗收整串/160000=後置全過+post-image md5 `f4e3aa5b` 與 P 預測逐字同=2f preflight 釘值)→後驗四查(CJK 切詞=4 正式站成立、trgm 索引 11、搜尋煙測 JSON 正常、**postgres bypassrls=true**=A12 閘結構預警口徑確認)→VACUUM 四表→APPLIED.tsv 183-185+F7 types 走 merge 腳本(零刪除、新增僅 pcm_spec_text)`90d3d2fe`。**三線收官**:B #347-fuzzy 兩顆(23cd6091+bb8f723c;R1 code-reviewer 7Imp6Min+codex R2 1MF4nit 全折;B 抓主視窗兩態窮舉漏時間軸→三格窮舉+「130000 apply 前禁開 ORDER_NUMBER_SEARCH」入 body+時序保險=apply 先於推版,已兌現)/D #423 兩顆(f82f047f+284a3e64;三輪 33 條=K2 12+codex R2 12+Fable R3 9 全折,R3 抓 A12 守零負測穿透前兩輪;#439 立案=audit append-only 只靠 GRANT,**D 誤取作廢號 #438 被攔=作廢不回收首次生效**)+#437 收款卡四點+三態完成(76aff2e3,順手修兩處既有假通過)/P 2e(7a205d38;R1 11+codex R2 14 折 1 駁〔catalog 證據〕;44 格 13 rb 13 靶;D2b 真缺口→Sean 拍 Q-2e-D2b=A→#440 立案)。**Sean 拍板**:審查鏈改制=R1 一律先 codex(memory review-chain-codex-first-r1)/Q-347-B8=A/Q-2e-D2b=A/離群價=A/extreme 667/715 寫入(乾跑零差異、變價 16 全對、分類搬家 123、寫後直查庫逐格對)。**教訓堆**:量具方言一日三例(grep BRE `$x$`/BSD `\|`/shasum 預設 SHA-1)+2>/dev/null 滅音+哨兵基準跳信三封(程序已修=先全量掃再推基準)+撞號兩起。dev 未推 14(本 STATUS 顆前)。)
🗂️ **2026-08-12 午 91🎉 D 之收款登錄片全收官(2a+2b+OP5 兩輪)+三線審查日+Sean 預批 140000**(**D 片2 收割 `7c6a9fcc`+註解定案 `2e547434`**:兩軌收款表單+印章生命週期+確認閘;審查鏈=codex R1 FAIL5 折→R2 PASS+code-reviewer FAIL 2MF(最重=兩段文案同框互打製造重複入帳路)+2Imp+4minor 八條全折+主視窗窄確認五掃;**OP5 真往返兩輪**=整條真鏈第一次走通(表單→supabase-js→真 PostgREST→真 RPC)+主視窗設計「旁路消耗」構造補測「鍵已被消耗」路=對照組真判別力、§4 缺口就地結案;D 對照組前提錯+主視窗批准背書同錯=各記一筆;roadmap M-4a-15 ⬜→🔄。**B 線**:#347 plan 全定稿(Q-347-B1=B/B2=C 三項全保留/B3=B fail-soft ③知情退場/B4=A 空窗,Sean 四拍;替身鏈首用=codex 四呼叫零產出(14 行動/62 行不動)→Fable adversarial-reviewer R2 FAIL3MF 全折+窄確認)→**migration 130000 寫完 472 行拋棄式庫實跑驗過、未 commit 等雙審**(code-reviewer 跑動中)。**P 線**:沖銷片 R1 FAIL6+R2 FAIL2(折 R1 自傷型:EXIT trap 相蓋/探針全域恆真)全折、harness 84 格全綠;**Sean 預批 140000 apply(「好,上吧」)**=鏈走完直接上、W 線 record all 入 preflight。**D 假掃信自首第三例**→playbook C-6+增補(輸出只准複製貼上)。地圖過期「等拍板」標籤清 4+正式刷卡字面修(Sean 指正)。收割:7c6a9fcc/2e547434/744bce04/7b7b2158/e1ddc827/9aeb9318/1eaacfdd+STATUS/playbook/地圖顆。dev 未推 53(`git rev-list --count origin/dev..dev` 實跑,本 STATUS 顆前)。)
🗂️ **2026-08-12 午前 90🔚 主視窗換班收工(Sean 令)+晨批七拍板+四顆收割**(當機重建收官:五窗全就位=S五/P九自活續任、D八/B十/E八新開。**Sean 拍板七件全落 memory 0812 檔**:Q-663=A 不追(#431)/extreme=12:30 確認+點頭雙前置/53 台=A 報價單側逐台判讀(29.1%=作廢交叉積、與 53 台無關=我方錯因果被報價單側抓到已三處更正,現行口徑=鍵層 8.7%)/Q-D11=依推薦(gitignore `803e505e`+#434 治本)/Q-347-B1=B/Q-347-B2=C 三項全保留(推翻推薦)。**D 線大翻案**:router 實測 dev+prod 兩輪=redirect() 是 soft nav 但表單仍重掛、印章不復活 ⇒ Fable F1 撤、#432 撤案(Fable 指錯行,真標的=receipt-action-state.ts:45 決定對理由錯=Q-D12 文件債隨片2);v4 窄核 PASS、D 實作 2a/2b 中。**P 線**:migration 140000 十段+拋棄式庫 49 格全綠(TB-neg 翻面實測=B 案回頭路通);lease_token 沿用裁接受+兩條件。**B 線**:折九條+#420-2 收割,等 C 案定稿 §5-16→窄 R2→130000;🔴W 線收據 36 條釘值過期=140000 apply preflight 必跑 record all。收割四顆=803e505e/1d2febf0/9aeb9318/1eaacfdd(backlog #433/#434 入庫、下一號 #435)。交接=`.pending-replies.md` 收工交接版+`.main-socket` 換班註記;新主視窗照 runbook §B 開。dev 未推 34(`git rev-list --count origin/dev..dev` 實跑,本 STATUS 顆前)。)
## 最近 3 commit
> dev。🏁 **2026-07-25 Sean 拍板 A:不寫死 hash 與未推數**(寫死的自指數字每多一個 commit 或每次 push 就當場變假、同款前科已 10 次)→ 一律當場執行取得:`git log --oneline -4`(第 1 行=本 commit,其後 3 行=前序)/ `git rev-parse --short origin/dev` / `git rev-list --count origin/dev..HEAD` / `git merge-base --is-ancestor <hash> HEAD`(驗可達、防 busboy off-by-one orphan)。⚠️ `dev` = pcm-admin 的 **production** 分支,push 即部署;`origin/main` 同理不寫死。

## 下一步
①Sean 推版後照 `docs/specs/2026-08-12-order-admin-acceptance-package.md` 跑訂單後台總驗收(🔴 六項優先;`REFUND_UI_ENABLED=1` 已設,退款區應可見)。②P 十一代折 R2 的 19 條(含換路裁決:結構斷言不加碼、語意移 neg 行為測試),折完主視窗評估 R3(再換模型與角度)。③D 十二代提片 2 採購撤銷 plan(高風險片,DB 無 DELETE RPC ⇒ 要新 migration;apply=Sean 停點)。④OD 第二輪密度重做交件後給 Sean 挑。⑤#409 08-13 import 後三句 SQL 驗 0 結案。⑥2g→超退閘 #445→④-a/U1-U3 解鎖(S/E 屆時開新窗)。
## Sean 待決策
徽章兩題:#446 沖銷之沖銷語意(D 立案三選項)/ #437 訂單標頭殘題(要不要標頭再一顆「已收足」徽章;四點主體已完工 `76aff2e3`)/ 採購「改軟」三片做完後要不要接 #374 採購單層與庫存(落點已定=報價單 repo)/ memory 索引下輪盤整再議。~~視覺統一改輪~~(2026-08-13 已拍:OD 三塊方向選定,詳情甲/列表丙/客人卡甲)。
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
