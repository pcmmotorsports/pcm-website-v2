# Codex Review Packet — M-3 3DS 乙路 R1 canonical plan(Codex round10 findings 已折入,送 round11 複審)

> **本 packet 用途:** 回應 Codex round10(FAIL→只剩 1 個流程時序錯誤 must-fix + 1 個 round 號字面 nit;其餘 Git 雙向同步、20 片獨立、兩次 db push、merge/push/main/deploy、flag=false 與 rollback 鏈皆已通過)。**本輪只重排 §14 step34-36 的「commit vs Codex 複審」時序(45 步總數不變)並修 1 個字面,不擴張任何 DB/金流/退款/B1 設計。** 修改兩份審查標的文件(canonical plan + handoff),並同步更新一份 Review Packet,共 3 檔。canonical plan v8→**v9**;plan/handoff/Packet 統一「Codex round10 findings 已折入」;執行前置「**本輪 Codex 複審 PASS**」(不綁舊輪次)。**round4–round9 既有契約全部原封保留、未退回、未重引 superseded。** 禁 code/migration/test/STATUS/AGENTS/CLAUDE/.env、禁 DB 寫入/模擬/mutation、禁 stage/commit/push/merge/deploy、不動 branch/HEAD/worktree、不開 R1a1。**🔴 請 Codex 做 round11 唯讀複審。**
> 自帶 git 事實 + 規則摘錄;完整 round10 diff 附 §K。

## §A 本輪範圍 / 守則(遵 Codex round10 指示)
- **Codex round10 結論 = FAIL,只剩 1 必修(時序)+ 1 nit**:① §14 step35(busboy-end + 最終 commit)排在 step36(commit 前 Codex 複審)之前 → commit 後不可能再做「commit 前」審、違反 `AGENTS.md` commit 前審查鐵則 → 重排;② §13「round8 後仍僅 2」round 號落後。**其餘已通過**:Git 雙向同步、20 片獨立步驟、兩次 db push、merge/push/main/deploy、flag=false 驗證及開啟後 rollback 鏈皆完整。
- **只改 3 檔**(無 code/migration/test/STATUS/AGENTS/CLAUDE/.env、無 DB 寫入/模擬/mutation、無 stage/commit/push/merge/deploy):
  - `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(canonical plan,v8→**v9**)
  - `docs/handoff/2026-06-23-3ds-yi-r1-db-sim-pass-handoff.md`(§3 step34-36 時序同步 + round 號)
  - `docs/reviews/2026-06-23-3ds-yi-r1-canonical-plan-codex-packet.md`(本檔,round10 重寫)
- **共 3 檔 = 兩份審查標的文件 + 一份 Review Packet**;不碰其他 untracked;**round4–round9 契約全保留、未重引 superseded**。

## §B git 誠實事實
- **branch** = `dev`;**HEAD** = `ff79534`(未動);**ahead** = origin/dev + **3 commits**(皆既有、與本輪無關)。
- **tracked diff** = 空;**cached(staged)diff** = 空。**本輪只改上述 3 檔;3 檔皆 untracked。**
- **全部 untracked files(6)**:
  ```
  docs/handoff/2026-06-23-3ds-yi-immediate-recharge-codex-round2-handoff.md   (舊、未改)
  docs/handoff/2026-06-23-3ds-yi-r1-db-sim-pass-handoff.md                     (本輪改)
  docs/handoff/2026-06-23-3ds-yi-refund-version-round3-pass-handoff.md         (舊、未改)
  docs/handoff/2026-06-23-tappay-3ds-live-debug-research-handoff.md            (舊、未改)
  docs/reviews/2026-06-23-3ds-yi-r1-canonical-plan-codex-packet.md             (本輪改)
  docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md                      (本輪改)
  ```
- **三檔行數**:canonical plan(v9)= **459 行**;handoff = **101 行**;packet = 見檔尾。

## §C round10 diff --stat(本輪 3 檔,對 round9 快照 `git diff --no-index`)
```
docs/specs/...m3-3ds-abandoned-complete-plan.md   | 31 +++++----- | 15 insertions(+), 16 deletions(-)  → 459 行
docs/handoff/...r1-db-sim-pass-handoff.md         | 18 +++++----- |  9 insertions(+),  9 deletions(-)  → 101 行
docs/reviews/...r1-canonical-plan-codex-packet.md | (本檔 round10 重寫)                                   → 見檔尾
```

## §D round10 findings → plan/handoff 節次
| 類 | finding | 節次 |
|---|---|---|
| 必修(時序) | step35 busboy-end + 最終 commit 早於 step36 commit 前 Codex 複審 → commit 後不可能再「commit 前」審、違反 AGENTS.md commit 前審查 → 重排 **step34 累積驗證+更新 STATUS/roadmap+產出最終 Packet(尚不 commit)→ step35 Codex commit 前/merge 前複審 PASS → step36 busboy-end 完成最終 commit(不 push)**;step37-45 不變、仍 45 步;handoff §3、packet §F 同步 | plan §14 步 34-36 + 附錄 B ㉖ / handoff §3 / packet §F·§G |
| nit | §13 / handoff §4「roundN 後仍僅 2」round 號落後(本版折入 round10)→ 對齊 round10;unresolved 仍 2 項未變 | plan §13 / handoff §4 |
| 版本字面 | v8→v9 / round10 findings 已折入 / Packet 送 round11 / 「本輪 Codex 複審 PASS」 / plan+handoff+packet 一致(v9·round10·20 片·45 步) | 標頭 / §14 / handoff / 本 packet |
| 保留 | round4–round9 既有契約全原封未退回 | 全檔 + 附錄 B/C |

## §E 20 個 slice(逐項)
R1a1 · R1a2 · R1a3 · **R1b1a** · **R1b1b** · **R1b1c** · R1b2 · R1b3 · R1c1 · R1c2 · R1c3 · R2a · R2b · R3 · W1 · A1 · A2 · A3 · **B1a** · **B1b** = **20 片**(§14 各自獨立步:R1b1a=13/R1b1b=14/R1b1c=15、B1a=30/B1b=33)。

## §F 完整 45 步唯一執行順序(§14;🔴=Sean 操作/拍板)
1 Codex PASS → 2 更 STATUS → 3 精準 add → 4 docs commit(Claude 不 push)→ **🔴5【Sean】push 全部 dev commits(含既有 3 ahead+docs commit)** → **6 push 後雙向同步驗證**(branch=dev/clean/`origin/dev..HEAD=0` 且 `HEAD..origin/dev=0`/HEAD 對齊 STATUS;不綠停下不建 worktree)→ 7 建 fresh ROLE=A worktree(自跑起手檢查)→ 8 R1a1 → 9 R1a2 → 10 R1a3 → 11 停建 anomaly/refund PRD → 12 PRD 過 prd_review → **13 R1b1a → 14 R1b1b → 15 R1b1c** → 16 R1b2 → 17 R1b3 → 18 R1c1 → 19 R1c2 → 20 R1c3 → **🔴21【Sean】第一次 R1 bundle db push(連帶 S2b=live)** → **22 第一次驗證 gate**(version/catalog/CHECK/index/函式簽名/table+function ACL/RLS/S2b 模擬)→ 23 R2a → 24 R2b → 25 R3 → 26 W1 → 27 A1 → 28 A2 → 29 A3 → 30 B1a → **🔴31【Sean】第二次 B1a db push** → **32 第二次驗證 gate**(B1 claim RPC/ACL/throttle/平行 claim)→ 33 B1b → **34 累積整合驗證(三綠/全測試/真雙連線/K2/security/code-reviewer/真機)+ 更新 STATUS/roadmap + 產出整體最終 Codex Packet(尚不 commit)** → **35 整體 Packet 過 commit 前/merge 前複審 PASS(FAIL 回 34、不先 commit)** → **36 `busboy-end` 完成最終 commit(不 push;Codex PASS 後才 commit)** → **🔴37【Sean】合併 ROLE=A 回 dev** → 38 dev 重驗 → **🔴39【Sean】push dev** → **🔴40【Sean】dev→`main`** → **🔴41 deploy(`TAPPAY_3DS_ENABLED`=false)** → **🔴42 驗部署 commit SHA/migration/catalog/ACL/RLS/payment routes/flag=false smoke** → 43 readiness(查實際 SHA、非只看有 commit)→ **🔴44【Sean 拍板】才設 production flag=true** → **🔴45 開後 smoke/監控;異常第一動作關回 flag=false 再 rollback/runbook**。

## §G 關鍵 gate 摘要
- **開 worktree 前 Git clean+up-to-date gate(§14 步 6)**:branch=dev / `git status` clean / `origin/dev..HEAD=0` 且 `HEAD..origin/dev=0` / HEAD 對齊 STATUS;不綠停下回報、不建 worktree、不自行修復。預設 Sean 手動 push、無「push 或例外」二選一。
- **🔴 最終複審→commit→合併 gate(步 34-38,round10 修正時序)**:step34 累積驗證 + 更新 STATUS/roadmap + 產出整體最終 Packet(**尚不 commit**)→ step35 Codex **commit 前/merge 前**複審 PASS(FAIL 回 34、不先 commit)→ step36 `busboy-end` 完成最終 commit(**不 push**;commit 發生在 Codex PASS 之後,符合 AGENTS.md commit 前審查)→ step37 Sean 合併回 dev(Claude 不自假設 merge 授權)→ step38 dev 重驗(三綠/測試/HEAD-STATUS/累積 diff)。
- **Sean push dev(步 39)→ dev→main(步 40)→ deploy flag=false(步 41)→ 部署 SHA 驗證(步 42)→ readiness 查實際 SHA(步 43)→ Sean 開 flag(步 44)→ 監控+先關 flag rollback(步 45)**。
- **兩次 db push**:第一次 = step 21(R1 bundle R1a1–R1c3 連帶 S2b=live)+ step 22 驗證 gate;第二次 = step 31(B1a)+ step 32 驗證 gate。

## §H rollout gate 完整清單(開 production flag=true 前缺一不可)
開 worktree 前 dev clean+雙向同步 / 20 片各 checkpoint(三綠+K2+code-reviewer+獨立 commit)/ 兩次 db push 成功+線上 version·catalog·table+function ACL·RLS 驗證 / R1·R2·R3 全完成 / anomaly lifecycle·append-only event·unknown fail-closed·W1 報表+7 步 runbook·A1-3 真機(桌機/popup blocked/iOS/Android production)·B1 全符合既有 gate / ROLE=A 整體 Codex 複審 PASS → 最終 commit → 成果合併回 dev / Sean push dev / Sean dev→main / production 部署正確 commit + SHA 與批准版本一致 + 首次 flag=false + flag=false smoke 通過 / B1 defer 須拍板+編號 backlog(不可默默略過)/ Sean 最終拍板才開 flag / 開後 smoke+監控+先關 flag rollback / **production flag 全程 false 直到最後 Sean 拍板**。

## §I canonical 尚未驗證清單 + unresolved
- **尚未驗證(plan §12 單一 18 項)**:released -1/5 維持+record_unreachable / observation 三參數雙鍵+守衛 / markRetry / markFailed guard / sibling ACL+最小化 / S2b 繞 manual·ceiling 10 案 / anomaly 兩表 RLS·table ACL / id PK·amount int / claim·resolve·reopen CAS+unknown fail-closed / event append-only+reopen 留痕 / SECDEF 硬化+session_user / markCharged+anomaly / manual close / B1 專用路徑+B1a claim RPC 並發 / 分片 15–45 分 / 兩次 db push 驗證 gate / rollout gate(含 Git/部署鏈)/ 真雙連線並發。**pre-round4 35/35 僅「未變子集合」、canonical R1 尚未通過完整 DB 模擬。**
- **unresolved(round10 後仍僅 2)**:D3 塊A UX 文案字面(L2);未來 TapPay 官方終局後是否做自動 close(Phase 1 僅人工)。L3 PRD(R1b1a/b/c+W1)= 前置、已有歸宿(§14 步 11-12)。

## §J 規則摘錄 + 誠實聲明
- **鐵則 8/9/12 + 起手 up-to-date 守線**:branch=dev / 工作樹 clean+up-to-date / HEAD 對齊 STATUS,任一不綠停下回報 Sean、不自行修復狀態。
- 🔴 **誠實聲明**:本輪**未改 code/migration/test/STATUS/AGENTS/CLAUDE/`.env*`;未執行 DB 寫入/模擬/mutation;未 stage/commit/push/merge/deploy;未動 branch/HEAD/worktree;未開始 R1a1**。`pre-round4 SQL harness 未變子集合 35/35 PASS ≠ canonical R1 PASS ≠ 整體流程 PASS ≠ canonical R1 已過 DB 模擬 ≠ Git 同步/部署/production 驗證已完成`。**本輪文件修正 ≠ 已完成 Git 同步、部署或 production 驗證。**
- 🔴 **驗證方法誠實說明**:round9 的 packet 曾宣稱自動 3-lens 工作流「0 issue」,卻**漏抓** step35/36 的 commit-vs-複審時序矛盾(由 Codex round10 逮到)。本輪據此**改以人工聚焦時序核對為主**——跨 plan/handoff/packet 三檔逐步比對「產出 Packet → Codex 複審 PASS → busboy-end commit」先後,確認三檔一致、無「先 commit 後審」殘留;**不再以自動 lens「0 issue」當正確性保證**。
- 🔴 **請 Codex 做 round11 唯讀複審**:① §14 step34-36 時序是否已修正(commit 一定在 Codex PASS 之後、無「先 commit 後審」)、45 步是否仍連續無斷號 ② Git/worktree 同步鏈 + merge/push/deploy/flag 鏈是否仍完整無矛盾 ③ 20 片是否仍逐片列出 ④ Sean-operated 步是否未變 Claude 自動、flag 是否全程 false 至 Sean 拍板 ⑤ 是否退回 round4–9 契約 ⑥ 可否解守線開 R1a1。

## §K round10 完整 diff（plan + handoff;a/=round9 快照、b/=round10 現版;packet 為 round10 重寫見本檔）

````diff
##### PLAN round10 diff (a=round9快照 b=round10現版) #####
diff --git (round9-snapshot)/plan.md b/docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md
index 78e9d25..b118b0d 100644
--- (round9-snapshot)/plan.md
+++ b/docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md
@@ -1,6 +1,6 @@
-# M-3 3DS 放棄交易完整方案 — canonical 執行 plan(乙路·退款版·立即重刷)v8
+# M-3 3DS 放棄交易完整方案 — canonical 執行 plan(乙路·退款版·立即重刷)v9
 
-> **canonical 狀態(2026-06-24, Codex round9 findings 已折入):** 本檔已折入 codex round4(8 項)+ round5(10 項)+ round6(7 組)+ round7(4 必修組)+ round8(4 必修 + 1 consider + 2 nit)+ round9(Git/worktree 同步鏈 + merge/push/deploy/flag 鏈 + 20 片逐列 + 2 nit)must-fix,**取代並廢除**所有前版「後段覆蓋前段」層疊。**本檔為唯一、可直接執行的真權威**;歷史方向見「附錄 B(superseded,勿實作)」。
+> **canonical 狀態(2026-06-24, Codex round10 findings 已折入):** 本檔已折入 codex round4(8 項)+ round5(10 項)+ round6(7 組)+ round7(4 必修組)+ round8(4 必修 + 1 consider + 2 nit)+ round9(Git/worktree 同步鏈 + merge/push/deploy/flag 鏈 + 20 片逐列 + 2 nit)+ round10(§14 步34-36 commit/複審時序修正 + 1 nit)must-fix,**取代並廢除**所有前版「後段覆蓋前段」層疊。**本檔為唯一、可直接執行的真權威**;歷史方向見「附錄 B(superseded,勿實作)」。
 >
 > **守線狀態(誠實,見 §12):** **pre-round4 R1 SQL harness 的「未變子集合」35/35 PASS**(零留痕);canonical 新增/變更契約(released failure observation 三參數雙鍵 + 輸入守衛、find_sibling ACL/PUBLIC revoke + 資料最小化、markFailed order-paid guard、S2b released 繞 manual/ceiling、anomaly 主表 + **append-only event 表** RLS/table ACL + id PK + claim/resolve CAS lifecycle + 退款未知態 fail-closed、B1a server-only claim RPC 並發、manual close、兩次 db push 驗證 gate)**尚未模擬**,須在對應 slice commit 前各自補 DB 模擬/測試。**整體刷卡流程未 PASS、未進實作、未通過 canonical R1 DB 模擬**;真錢 code 未實作,每段須 三綠 + code-reviewer + codex K2 + 對應模擬 PASS 才 commit、不 push。
 >
@@ -361,13 +361,13 @@ released 留對帳集 → sweeper/webhook/callback/S2b → settleCharge(舊單)
 - 🔴 **原 harness 仍含已作廢的 `released→failed`(R-FAIL-1)測項**:該測驗的是**已作廢契約**,**不得作為 canonical R1b 放行證據**。
 - **未證**:前端 popup/TapPay/三事件流程(A1-A3 smoke + 真機)。
 
-## §13 unresolved decisions(round8 後仍僅 2,皆不阻擋 R1a1 開工)
+## §13 unresolved decisions(round10 後仍僅 2,皆不阻擋 R1a1 開工)
 - **D3(Sean 最終拍)**:塊A 三事件 + fallback 的 **UX 文案字面**(L2;狀態轉移/清車規則/fallback 行為已在 §6 定稿、**不待**)。
 - **未來**:是否在取得 **TapPay 官方終局契約**後另做「自動 close released」(Phase 1 不做、僅人工;屆時獨立 migration、**不留 schema 二選一**)。
 
 ---
 
-## §14 唯一執行順序(45 步)+ Git 同步鏈 + 兩次 db push + merge/push/deploy/flag 鏈 + rollout gate(round5 #9 + round6 五/七 + round7 四 + round8 四 + round9 一/二/consider)
+## §14 唯一執行順序(45 步)+ Git 同步鏈 + 兩次 db push + merge/push/deploy/flag 鏈 + rollout gate(round5 #9 + round6 五/七 + round7 四 + round8 四 + round9 一/二/consider + round10 一)
 > 🔴 **唯一順序(廢除前版「docs commit → 直接開 worktree」與「30 步」;改 45 步,含開工前 Git 雙向同步守線 + 收尾 merge/push/main/deploy/flag 鏈)。** plan/handoff/packet 皆 untracked、STATUS 未更新 → Codex PASS 後**不可直接開 fresh worktree**(docs commit 後 dev 將 ≥ ahead origin/dev 4、不能宣稱 up-to-date)。**20 片各自獨立步(R1b1a/R1b1b/R1b1c 不得壓成一步)、各遵守 15–45 分 + STATUS + 三綠 + K2 + code-reviewer + 精準 add + 獨立 commit + 不 push。** 正確序(共 45 步):
 1. **本輪 Codex 複審 PASS**。
 2. **current dev session** 更新 `STATUS.md` 七欄(指向本 canonical plan + R1a1)。
@@ -402,9 +402,9 @@ released 留對帳集 → sweeper/webhook/callback/S2b → settleCharge(舊單)
 31. 🔴 **【Sean 操作】執行第二次 B1a migration db push**。
 32. 🔴 **第二次 db push 驗證 gate**:B1 claim RPC、ACL、throttle、平行 claim 驗證 PASS;失敗停止。
 33. B1b。
-34. **累積整合驗證**:完整三綠、全測試、真雙連線模擬、K2、security review、code-reviewer、前端真機結果全部齊備。
-35. 更新 STATUS 七欄、roadmap、執行 `busboy-end`,完成最終 commit;**不 push**。
-36. 產出**整體最終 Codex Review Packet**,通過 **commit 前 / merge 前唯讀複審**。
+34. **累積整合驗證 + 更新 STATUS／roadmap + 產出整體最終 Codex Review Packet(尚不 commit)**:完整三綠、全測試、真雙連線模擬、K2、security review、code-reviewer、前端真機結果全部齊備;更新 `STATUS.md` 七欄與 roadmap;產出**整體最終 Codex Review Packet**;**此步尚不 commit**。
+35. **整體最終 Codex Review Packet 通過 commit 前 / merge 前唯讀複審(PASS)**;FAIL 則回 step 34 修正、**不得先 commit**。
+36. 執行 `busboy-end`,完成最終 commit;**不 push**(此步在 Codex 複審 PASS 之後才 commit,符合 commit 前審查鐵則)。
 37. Codex PASS 後,**由 Sean 依寫審分離流程把 ROLE=A 成果合併回 dev**;Claude **不可自行假設 merge 授權**。
 38. 在 dev 重跑 branch/status/log、完整三綠、測試、HEAD/STATUS 對齊及累積 diff 驗證;失敗停止。
 39. 🔴 **【Sean 操作】手動 push dev**。
@@ -426,7 +426,7 @@ released 留對帳集 → sweeper/webhook/callback/S2b → settleCharge(舊單)
 - **Sean 最終拍板後才能開 flag**;**開 flag 後有 smoke、監控與「先關 flag」rollback**;**production flag 全程維持 false,直到最後 Sean 拍板**。
 
 🔴 **L3 PRD gate(round7 四 + round8 二)**:R1a1–a3 可先做;到 **R1b1a 前必須停**;dedicated PRD + `prd_review` 通過後才能繼續 R1b1a/R1b1b/R1b1c/W1;本輪仍不建立 PRD、只記錄 gate。
-> 🔴 **本輪(Codex round9 文件修正)仍禁實際更新 STATUS / 禁 stage / 禁 commit / 禁 push / 禁 merge / 禁 deploy / 禁開 flag / 禁開 R1a1**;此序僅寫入文件供下一步遵循。**本輪文件修正 ≠ 已完成 Git 同步、部署或 production 驗證。**
+> 🔴 **本輪(Codex round10 文件修正)仍禁實際更新 STATUS / 禁 stage / 禁 commit / 禁 push / 禁 merge / 禁 deploy / 禁開 flag / 禁開 R1a1**;此序僅寫入文件供下一步遵循。**本輪文件修正 ≠ 已完成 Git 同步、部署或 production 驗證。**
 
 ---
 
@@ -446,15 +446,14 @@ released 留對帳集 → sweeper/webhook/callback/S2b → settleCharge(舊單)
 - **round7 再廢**:⑪ B1「不繞 needs_manual_review」(改**專用人工列再確認路徑**:可涵蓋 manual=true、但不清 flag)⑫ anomaly 表無 `id` PK(改 `id uuid PK` + `old_attempt_id UNIQUE NOT NULL` + `refund_provider_reference`)⑬ `refunding→open` 無條件釋回(改**僅明確未退款才 reopen**;**unknown/Dashboard 遺失 → fail-closed 保持 refunding**)⑭ SECDEF 內 `current_user` 當操作者(改 **`session_user`** 寫稽核欄)⑮ R1b1 / B1 各單片(改拆 **R1b1a/R1b1b、B1a/B1b = 19 片**)⑯ §14「R1a→R1c→R2→R3 線性」與「PRD 前置」字面衝突(改**唯一 26 步順序** + rollout gate;🔸 round8 再擴為 **30 步**、見 round8 ㉑)。
 - **round8 再廢**:⑰ anomaly 表無 table 層安全(改**兩表 ENABLE RLS zero-policy + REVOKE ALL ON TABLE PUBLIC/anon/authenticated/service_role/payment_confirmer + has_table_privilege fail-closed assert**;payment_confirmer 零 table 權限只透過 SECDEF RPC 寫)⑱ reopen 清 claimed 抹除稽核歷史(改**主表存目前狀態 + append-only `payment_double_charge_anomaly_events` 保存歷史**、無 UPDATE/DELETE RPC)⑲ anomaly `amount` 裸欄/可能浮點(改 **`integer NOT NULL CHECK(amount>=0)` 取 `orders.total` 整數快照、禁浮點**)⑳ B1a「+ ACL」模糊(改 **`claim_expired_pending_attempts` SECDEF payment_confirmer-only + `FOR UPDATE SKIP LOCKED` + `p_limit` 安全界 + 真雙連線平行 claim 測試**)㉑ R1b1 兩片 + 單次 db push 順序(改 **R1b1a/R1b1b/R1b1c 三片 = 20 片**;**§14 由 round7 的 26 步擴為 30 步、新增第二次 B1a db push + 第二次驗證 gate**)。
 - **round9 再廢**:㉒ 「docs commit → 直接開 fresh worktree」(違反起手 up-to-date 守線:docs commit 後 dev ahead≥4)→ 改 **Sean push 全部 dev commits + push 後雙向同步驗證(`origin/dev..HEAD=0` 且 `HEAD..origin/dev=0`)+ HEAD 對齊 STATUS 全綠才建 worktree;不綠停下回報、不自行修復**㉓ §14「30 步在 B1b 後直接 production readiness」缺 Git/部署鏈 → 改 **45 步**:加累積整合驗證 + 整體 Codex 複審 → Sean 合併回 dev → Sean push dev → Sean dev→`main` → production deploy(**flag=false**)→ 部署 commit SHA 驗證 → readiness → **Sean 拍板才開 flag** → 監控 + 先關 flag rollback㉔ §14 第 11 步把 **R1b1a/R1b1b/R1b1c 壓成一步**(改 **第 13/14/15 步逐片獨立**、20 片各自有步);㉕ §7 主訊號誤標 `R1b1b`(改 `R1b1c`)+ W1「每步寫 event」(改「每個狀態操作/退款結果透過受控 RPC 寫對應 event」、查詢 open/去 Dashboard 不寫 event)。
+- **round10 再廢**:㉖ §14「step35 `busboy-end` + 最終 commit → step36 才做 commit 前 Codex 複審」時序倒置(commit 後不可能再「commit 前」審、違反 AGENTS.md commit 前審查)→ 改 **step34 累積驗證 + 更新 STATUS／roadmap + 產出整體最終 Packet(尚不 commit)→ step35 Codex commit 前／merge 前複審 PASS → step36 `busboy-end` 完成最終 commit(不 push)**;step37 起 merge 回 dev／push／main／deploy／readiness／開 flag／監控不變(仍 45 步)。
 
-## 附錄 C — codex round9 finding → 本檔節次
-| 類 | round9 finding | 折入節次 |
+## 附錄 C — codex round10 finding → 本檔節次
+| 類 | round10 finding | 折入節次 |
 |---|---|---|
-| 必修一 | docs commit 後不可直接開 worktree(違反起手 up-to-date:docs commit 後 dev ahead≥4)→ canonical 唯一序:Codex PASS → 更 STATUS → 精準 add → docs commit(Claude 不 push)→ **Sean 手動 push 全部 dev commits(含既有 3 ahead + docs commit)**→ push 後**雙向同步驗證**(`origin/dev..HEAD=0` 且 `HEAD..origin/dev=0`)+ branch=dev + clean + HEAD 對齊 STATUS;任一不綠停下回報、不建 worktree、不自行修復;全綠才建 fresh ROLE=A worktree、fresh session 自跑起手檢查 + 完整套件讀取才開 R1a1。預設 Sean 手動 push,不留「push 或例外」二選一 | §14 步 1-7 / handoff §3 |
-| 必修二 | production flag 前補完整 Git/部署鏈(原 30 步在 B1b 後直接 readiness、缺 merge/push/main/deploy/SHA 驗/flag=false smoke/監控 rollback)→ §14 改 **45 步**:加 step34 累積整合驗證、35 STATUS/roadmap/busboy-end 最終 commit、36 整體 Codex 複審、37 Sean 合併回 dev、38 dev 重驗、39 Sean push dev、40 Sean dev→main、41 deploy(**flag=false**)、42 部署 SHA/migration/ACL/RLS/flag=false smoke 驗、43 readiness(查實際 SHA 非只看有 commit)、44 Sean 拍板開 flag、45 監控 + 先關 flag rollback | §14 步 31-45 / rollout gate / handoff §3 |
-| consider | 20 片必須逐片列在順序裡(原 step11 把 R1b1a/b/c 壓一步)→ §14 第 13/14/15 步分列 R1b1a/R1b1b/R1b1c,各自 15–45 分/驗收/模擬/K2/commit checkpoint,不用斜線或「依新拆片」帶過 | §14 步 13-15 |
-| nit×2 | §7 主訊號 `§4 R1b1b`→`§4 R1b1c`;W1「每步寫 event」→「每個狀態操作/退款結果均透過受控 RPC 寫入對應 event」(查詢 open / 去 Dashboard 不寫 event) | §7 / §9 W1 |
-| 版本字面 | v7→v8、round9 findings 已折入、Packet 送 round10、執行前置「本輪 Codex 複審 PASS」、plan/handoff/Packet 一致(v8·round9·20 片·45 步) | 標頭 / §14 / packet / handoff |
-| 保留 | round4–round8 既有契約全原封(DB 安全/append-only 稽核/兩表 RLS/REVOKE 5 角色/payment_confirmer 零 table/amount int 禁浮點/unknown 維持 refunding/reopen 清主表 event 留痕/R1b1a-c 三片/B1a SKIP LOCKED/B1 manual=T·F 都進/兩次 db push + 驗證 gate/W1 7 步/A1-3 K2+security+code review+真機/L3 PRD gate/20 片/35/35 僅未變子集合/canonical R1 未過完整模擬/真錢未實作/不自動 push/flag 全程 false 至 Sean 拍板)未退回 | 全檔 + 附錄 B |
+| 必修(時序) | §14 step35(`busboy-end` + 最終 commit)早於 step36(commit 前 Codex 複審)→ commit 後不可能再「commit 前」審、違反 AGENTS.md commit 前審查 → 重排為 **step34 累積驗證 + 更新 STATUS／roadmap + 產出整體最終 Packet(尚不 commit)→ step35 Codex commit 前／merge 前複審 PASS → step36 `busboy-end` 完成最終 commit(不 push)**;step37–45 不變、仍 45 步;handoff §3 與 packet §F 同步 | §14 步 34-36 + 附錄 B ㉖ / handoff §3 / packet §F |
+| nit | §13 / handoff §4「roundN 後仍僅 2」round 號落後(本版折入 round10)→ 對齊為 **round10**;unresolved 仍 2 項未變(Codex round10 指明改 round9 以對齊 v8;本版同時折入 round10、bump v9,依「欄位 round = 版本所折入 round、不留 lag」同一規則寫 round10) | §13 / handoff §4 |
+| 版本字面 | v8→v9、round10 findings 已折入、Packet 送 round11、執行前置「本輪 Codex 複審 PASS」、plan/handoff/Packet 一致(v9·round10·20 片·45 步) | 標頭 / §14 / packet / handoff |
+| 保留 | round4–round9 既有契約全原封(Git 雙向同步鏈/20 片逐列/兩次 db push + 驗證 gate/merge·push·main·deploy·flag=false·SHA 驗·readiness·監控 rollback/DB 安全·append-only 稽核·兩表 RLS·REVOKE 5 角色·payment_confirmer 零 table/amount int 禁浮點/unknown 維持 refunding/reopen 清主表 event 留痕/R1b1a-c 三片/B1a SKIP LOCKED/B1 manual=T·F 都進/W1 7 步/A1-3 K2+security+code review+真機/L3 PRD gate/35/35 僅未變子集合/canonical R1 未過完整模擬/真錢未實作/不自動 push/flag 全程 false 至 Sean 拍板)未退回 | 全檔 + 附錄 B |
 
 — END —

##### HANDOFF round10 diff (a=round9快照 b=round10現版) #####
diff --git (round9-snapshot)/handoff.md b/docs/handoff/2026-06-23-3ds-yi-r1-db-sim-pass-handoff.md
index b359270..897ceb3 100644
--- (round9-snapshot)/handoff.md
+++ b/docs/handoff/2026-06-23-3ds-yi-r1-db-sim-pass-handoff.md
@@ -1,8 +1,8 @@
-# M-3 3DS 乙路 R1 — DB SQL harness「未變子集合」PASS;整體流程待 Codex 複審(2026-06-24, Codex round9 findings 已折入)
+# M-3 3DS 乙路 R1 — DB SQL harness「未變子集合」PASS;整體流程待 Codex 複審(2026-06-24, Codex round10 findings 已折入)
 
-> **給下個 session:** **pre-round4 R1 SQL harness 的「未變子集合」35/35 PASS(零留痕)。整體刷卡流程「未 PASS」、未通過 canonical R1 DB 模擬、未解除守線、不可進實作** —— canonical plan 已折入 codex round4(8 項)+ round5(10 項)+ round6(7 組)+ round7(4 必修組)+ round8(4 必修 + 1 consider + 2 nit)+ round9(Git/worktree 同步鏈 + merge/push/deploy/flag 鏈 + 20 片逐列 + 2 nit)must-fix,仍待 **本輪 Codex 複審通過**才依 §14 唯一 **45 步**順序開執行 session。**本 session 零 code、零 commit。** 真權威 canonical plan = `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(v8)。
+> **給下個 session:** **pre-round4 R1 SQL harness 的「未變子集合」35/35 PASS(零留痕)。整體刷卡流程「未 PASS」、未通過 canonical R1 DB 模擬、未解除守線、不可進實作** —— canonical plan 已折入 codex round4(8 項)+ round5(10 項)+ round6(7 組)+ round7(4 必修組)+ round8(4 必修 + 1 consider + 2 nit)+ round9(Git/worktree 同步鏈 + merge/push/deploy/flag 鏈 + 20 片逐列 + 2 nit)+ round10(§14 步34-36 commit/複審時序修正 + 1 nit)must-fix,仍待 **本輪 Codex 複審通過**才依 §14 唯一 **45 步**順序開執行 session。**本 session 零 code、零 commit。** 真權威 canonical plan = `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(v9)。
 >
-> ⚠️ **措辭守則(codex round5 #1 + round6 六 + round7 五 + round8/9 nit):** 本檔只背書「pre-round4 SQL harness 未變子集合 PASS」,**不得**讀成「canonical R1 契約已 PASS」「canonical R1 已通過 DB 模擬」「整個刷卡流程已 PASS」或「Git 同步/部署/production 驗證已完成」。
+> ⚠️ **措辭守則(codex round5 #1 + round6 六 + round7 五 + round8/9/10 nit):** 本檔只背書「pre-round4 SQL harness 未變子集合 PASS」,**不得**讀成「canonical R1 契約已 PASS」「canonical R1 已通過 DB 模擬」「整個刷卡流程已 PASS」或「Git 同步/部署/production 驗證已完成」。
 
 ## 0. 一句話現況
 對線上 prod(`bmpnplmnldofgaohnaok`)用單一交易 `DO … RAISE→ROLLBACK` 模擬,跑出 v1 25/25 + v2 35/35 全零留痕(×3 information_schema 二次驗)。🔴 **但 canonical 新設計已把若干契約改掉**(released 不再 →failed 改 failure observation、find_sibling 去 rec/bank、failure observation 三參數雙鍵 + 輸入守衛、markFailed order-paid guard、S2b released 繞 manual/ceiling、anomaly **主表 + append-only event 表 + 兩表 RLS/table ACL + `id` PK + amount int CHECK≥0 + 4 態 claim/resolve CAS + 退款未知態 fail-closed + `session_user` 稽核**、**B1a server-only claim RPC(`FOR UPDATE SKIP LOCKED`)**、manual close、**兩次 db push 驗證 gate**、slice **17→20**),**這些新契約 harness 尚未測**;原 harness 還含**已作廢**的 `released→failed` 測項。故只能背書「未變子集合」,**canonical R1 仍待逐片補模擬、未通過 canonical R1 DB 模擬**。
@@ -54,7 +54,7 @@ harness(零留痕、可重跑、僅供未變子集合與重寫參考):scratchpad
 - **manual close**(plan §4 R1c3/D1 定稿):owner-only(REVOKE 含 payment_confirmer、寫 `session_user`、search_path=''+schema-qualified)、released→failed + released_closed_*、無 closed enum、冪等、charged/paid 不可 close。
 - **slice 拆 20 片**(🔴 round8,plan §9):R1a1/a2/a3 · **R1b1a/R1b1b/R1b1c**/b2/b3 · R1c1/c2/c3 · R2a/R2b · R3 · W1 · A1/A2/A3 · **B1a/B1b**,各 15–45 分鐘 + 檔案範圍/驗收/rollback/模擬/codex 觸發/內容分級;🔴 **A1/A2/A3 全 codex K2+security+code review**;🔴 **R1b1a/R1b1b/R1b1c/W1 = L3 → R1a1-a3 後停、PRD 過 prd_review 才繼續**(plan §9 intro/§14)。
 
-## 3. 🔴 唯一執行順序(45 步;Git 同步鏈 + 兩次 db push + merge/push/deploy/flag 鏈)+ rollout gate(round9 一/二,plan §14)
+## 3. 🔴 唯一執行順序(45 步;Git 同步鏈 + 兩次 db push + merge/push/deploy/flag 鏈)+ rollout gate(round9 一/二 + round10 一,plan §14)
 1. 本輪 Codex 複審 PASS。
 2. **current dev** 更新 `STATUS.md` 七欄。
 3. 精準 `git add` canonical plan + handoff + packet + STATUS(禁 `git add .`/`-A`)。
@@ -73,9 +73,9 @@ harness(零留痕、可重跑、僅供未變子集合與重寫參考):scratchpad
 31. 🔴 **【Sean】第二次 B1a migration db push**。
 32. 🔴 **第二次驗證 gate**(B1 claim RPC/ACL/throttle/平行 claim;失敗停)。
 33. B1b。
-34. 累積整合驗證(三綠/全測試/真雙連線/K2/security/code-reviewer/真機齊備)。
-35. 更新 STATUS/roadmap/busboy-end、最終 commit;不 push。
-36. 整體最終 Codex Review Packet,過 commit 前/merge 前複審。
+34. 累積整合驗證(三綠/全測試/真雙連線/K2/security/code-reviewer/真機齊備)+ 更新 STATUS/roadmap + 產出整體最終 Codex Review Packet;尚不 commit。
+35. 整體最終 Packet 過 commit 前/merge 前複審 PASS(FAIL 回 step 34、不先 commit)。
+36. 執行 `busboy-end`、完成最終 commit;不 push(Codex PASS 後才 commit,符合 commit 前審查)。
 37. 🔴 **【Sean】把 ROLE=A 成果合併回 dev**(Claude 不自假設 merge 授權)。
 38. dev 重驗(branch/status/log/三綠/測試/HEAD-STATUS/累積 diff;失敗停)。
 39. 🔴 **【Sean】手動 push dev**。
@@ -86,9 +86,9 @@ harness(零留痕、可重跑、僅供未變子集合與重寫參考):scratchpad
 44. 🔴 **【Sean 拍板】才把 production flag 設 `true`**。
 45. 開後 smoke/監控;異常(付款/雙扣/callback/sweeper/anomaly)**第一動作關回 flag=false** 再 rollback/runbook。
 🔴 **rollout gate**:開 worktree 前 dev clean+雙向同步;20 片各 checkpoint;兩次 db push + 線上 ACL/RLS 驗證;ROLE=A 整體 Codex 複審 → 合併回 dev → Sean push dev → Sean dev→main → deploy(flag=false)→ 部署 SHA 與批准版本一致 + flag=false smoke;全完成 + Sean 拍板才開 flag、開後監控 + 先關 flag rollback;B1 defer 須拍板+編號 backlog(不可默默略過、不得同時宣稱全片完成才開與可無條件略過)。
-> 🔴 本輪(Codex round9 文件修正)**仍禁實際更新 STATUS / 禁 stage / 禁 commit / 禁 push / 禁 merge / 禁 deploy / 禁開 flag / 禁開 R1a1**;此序僅供下一步遵循。**本輪文件修正 ≠ 已完成 Git 同步、部署或 production 驗證。**
+> 🔴 本輪(Codex round10 文件修正)**仍禁實際更新 STATUS / 禁 stage / 禁 commit / 禁 push / 禁 merge / 禁 deploy / 禁開 flag / 禁開 R1a1**;此序僅供下一步遵循。**本輪文件修正 ≠ 已完成 Git 同步、部署或 production 驗證。**
 
-## 4. unresolved(round9 後仍僅 2,皆不阻擋 R1a1)
+## 4. unresolved(round10 後仍僅 2,皆不阻擋 R1a1)
 - **D3**:塊A 三事件 + fallback 的 **UX 文案字面**(L2;狀態轉移/清車規則已定稿、不待)。
 - **未來**:取得 TapPay 官方終局契約後是否另做自動 close(Phase 1 僅人工;屆時獨立 migration、不留 schema 二選一)。
 
````

— END Packet —
