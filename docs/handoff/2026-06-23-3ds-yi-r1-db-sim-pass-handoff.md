# M-3 3DS 乙路 R1 — DB SQL harness「未變子集合」PASS;整體流程待 Codex 複審(2026-06-24, Codex round10 findings 已折入)

> **給下個 session:** **pre-round4 R1 SQL harness 的「未變子集合」35/35 PASS(零留痕)。整體刷卡流程「未 PASS」、未通過 canonical R1 DB 模擬、未解除守線、不可進實作** —— canonical plan 已折入 codex round4(8 項)+ round5(10 項)+ round6(7 組)+ round7(4 必修組)+ round8(4 必修 + 1 consider + 2 nit)+ round9(Git/worktree 同步鏈 + merge/push/deploy/flag 鏈 + 20 片逐列 + 2 nit)+ round10(§14 步34-36 commit/複審時序修正 + 1 nit)must-fix,仍待 **本輪 Codex 複審通過**才依 §14 唯一 **45 步**順序開執行 session。**本 session 零 code、零 commit。** 真權威 canonical plan = `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(v9)。
>
> ⚠️ **措辭守則(codex round5 #1 + round6 六 + round7 五 + round8/9/10 nit):** 本檔只背書「pre-round4 SQL harness 未變子集合 PASS」,**不得**讀成「canonical R1 契約已 PASS」「canonical R1 已通過 DB 模擬」「整個刷卡流程已 PASS」或「Git 同步/部署/production 驗證已完成」。

## 0. 一句話現況
對線上 prod(`bmpnplmnldofgaohnaok`)用單一交易 `DO … RAISE→ROLLBACK` 模擬,跑出 v1 25/25 + v2 35/35 全零留痕(×3 information_schema 二次驗)。🔴 **但 canonical 新設計已把若干契約改掉**(released 不再 →failed 改 failure observation、find_sibling 去 rec/bank、failure observation 三參數雙鍵 + 輸入守衛、markFailed order-paid guard、S2b released 繞 manual/ceiling、anomaly **主表 + append-only event 表 + 兩表 RLS/table ACL + `id` PK + amount int CHECK≥0 + 4 態 claim/resolve CAS + 退款未知態 fail-closed + `session_user` 稽核**、**B1a server-only claim RPC(`FOR UPDATE SKIP LOCKED`)**、manual close、**兩次 db push 驗證 gate**、slice **17→20**),**這些新契約 harness 尚未測**;原 harness 還含**已作廢**的 `released→failed` 測項。故只能背書「未變子集合」,**canonical R1 仍待逐片補模擬、未通過 canonical R1 DB 模擬**。

## 1. 模擬涵蓋(誠實分類,round5 #1)

### 1a. 已證、canonical 仍適用(可作放行證據的子集合)
- **release / markCharged CAS 競態**(pending→released CAS、二次 release no-op、markCharged 先→release rowcount=0、release 先→late markCharged released→charged)。
- **server-only ACL 與歸屬否決**(has_function_privilege 矩陣 payment_confirmer only;SET ROLE authenticated 直呼→真 insufficient_privilege;歸屬否決四路 rowcount=0 + 正確可 release)。
- **索引 inference**(per-order 含 released 擋同單第二筆;dedup/user_in_flight 排除 released;begin 不改、同單 released→order_locked 非 unique_violation)。
- **原版 released sweeper policy**(claim 繞 ceiling、expire 不碰、多輪、rmra 不停掃)。
- **anomaly ON CONFLICT 冪等**(二次 INSERT 同 old_attempt_id → rowcount=0、表仍 1)。

### 1b. 🔴 尚未證,須在對應 slice commit 前各自補模擬/測試
- released + Record -1/5 → **維持 released**(R1b3)
- failure_observed_at/status **write-once 與重放冪等**(R1b3)
- settleCharge 回 **`{kind:'pending', reason:'released_failure_observed'}`**;RPC throw → **`record_unreachable`**(皆 pending、皆 markRetry)(R2)
- sweeper/inbox 對兩 outcome**必須 markRetry、不得 markProcessed**;stuck 走 markSettleRetry 非 terminal(R1c1/R2)
- markFailed 對 **paid order fail-closed**(R1b2)
- markFailed 對 **unpaid pending 正常成功**(R1b2)
- **manual close RPC**(owner-only、released→failed+closed_*、charged/paid 不可 close、冪等)(R1c3)
- 🔴 **find_active_sibling_own ACL 矩陣**(REVOKE PUBLIC+payment_confirmer、GRANT authenticated;auth=T/anon/svc/pc=F;PUBLIC 不回授;SET ROLE 實呼=**permission denied**、非「無資料」)+ **資料最小化(active 去 rec/bank)**(R1a2)
- 🔴 **failure observation RPC 三參數雙鍵 + 輸入守衛**(僅 -1/5、order 不符/非 released/已付款 fail-closed;ACL 僅 payment_confirmer)(R1b3)
- 🔴 **S2b released 繞 manual/ceiling 10 案**(pending 受閘 / released 繞閘 / unpaid+throttle 全保留)(R1c2、db push 前)
- 🔴 **anomaly 主表 + append-only event 表 + 兩表 RLS/table ACL**(round8 二:RLS zero-policy、REVOKE ALL ON TABLE 5 角色含 payment_confirmer、has_table_privilege fail-closed assert;payment_confirmer 零 table 權限只透過 SECDEF RPC 寫)(R1b1a)
- 🔴 **anomaly `id` PK + 逐欄型別/NOT NULL/FK + `amount integer CHECK≥0`(取 orders.total、禁浮點)**(round8 一)(R1b1a)
- 🔴 **anomaly claim/resolve/reopen CAS + append-only event 寫入**(open→refunding 平行只一人、非法轉移否決、**refunding unknown→fail-closed 保持 refunding 寫 `refund_uncertain` event**、**reopen 清主表 claimed/provider 但 event 留歷史**、event 無 UPDATE/DELETE RPC、`session_user`、負向=permission denied)(R1b1b)
- 🔴 **markCharged released→charged + 同交易建 open anomaly**(amount 取 orders.total、ON CONFLICT 冪等)(R1b1c)
- 🔴 **B1a server-only claim RPC `claim_expired_pending_attempts`**(SECDEF+search_path=''+schema-qualified+payment_confirmer-only+負向 permission denied;`FOR UPDATE SKIP LOCKED` 原子 claim+同交易寫 last_expired_settle_at;manual=T/F 都進不清 flag;p_limit 安全界;查詢失敗不 markFailed;真雙連線平行 claim 同 attempt 只一 worker)(B1a)
- 🔴 **B1 12h 孤兒收尾 use-case**(-1/5→guard markFailed、4/unreachable→維持、released/paid/未到期否決)(B1b)
- 🔴 **所有 SECDEF RPC 硬化**(`search_path='' + schema-qualified` + `has_function_privilege` 矩陣 + 負向 permission denied)(R1a2/R1a3/R1b1b/R1b3/R1c3/B1a)
- 🔴 **兩次 db push 驗證 gate + rollout gate**(全片 + 真機 + W1 完成前不得開 production `TAPPAY_3DS_ENABLED`)(§14)
- **find_active_sibling_own ACL 矩陣 + 資料最小化**(去 rec/bank;auth=T/其餘 F/負向 permission denied)+ discriminated union(paid-without-active/paid 優先/他人不可見)(R1a2)
- **真雙連線並發**(release CAS / anomaly claim / B1 claim)(執行 session 雙 psql)

### 1c. ⚠️ 已作廢測項(不得作為放行證據)
- 原 v2 harness 的 **`R-FAIL-1 released→failed`**:**此測項驗的是已作廢契約**(canonical 改 failure observation)→ **不得作為 canonical R1b 放行證據**。同理原 `R-FAIL-3/R-FAIL-4` FLAG 已升級為 round4/round5 定稿(failure observation + order-paid guard),須照新契約重測。

harness(零留痕、可重跑、僅供未變子集合與重寫參考):scratchpad `sim_r1_cas.sql`(v1)/`sim_r1_cas_v2.sql`(v2)。對抗審查工作流結果 task `wqfkaq11c`。

## 2. canonical 關鍵契約(round4+round5+round6+round7+round8 定稿,實作以 plan 為準)
- **released 遇 -1/5**:`recordReleasedFailureObservation(attemptId, orderId, observedStatus)`(🔴 round6 三參數雙鍵、write-once)→ 仍 released → settleCharge 回 `{kind:'pending', reason:'released_failure_observed'}`;**RPC throw/不合法 → `record_unreachable`**;兩者皆 pending、絕不 failed/no_attempt(plan §2.2/§5)。terminal 僅 late-success(paid)或 owner-only `close_released_attempt`(plan §4 R1c3)。
- **markFailed**:僅 pending→failed + **order-paid guard(同交易 FOR UPDATE order、paid→RAISE fail-closed)**;移除 released→failed(plan §4 R1b2)。
- **find_active_sibling_own**:**discriminated union** `{kind:'paid'|'active'|'none'}`,**paid 即使無 active attempt 也必找到**;鏡像 begin 排序 paid>charged>pending>created_at DESC;🔴 **round6:ACL REVOKE PUBLIC+anon+service_role+payment_confirmer / GRANT authenticated + 權限矩陣;active 去 rec/bank(資料最小化、rec/bank 由 payment_confirmer 內部取)**(plan §3/§4 R1a2)。
- **三離開事件**(plan §6.2,禁混寫):A TapPay 內取消(回 CANCEL→markFailed pending)/ B 關閉彈窗·上一頁(record 可能 PENDING、popup.closed→own-only 複查、不宣稱 CANCEL)/ C 原頁停止等待(純前端 abort、不呼 release、不清車)。popup 安全 = `opener=null` + 父頁持 WindowProxy + **BroadcastChannel**(非 postMessage)+ 任何通知必經 own-only 複查。
- **popup-blocked/手機整頁 fallback**(plan §6.4):`window.location.assign`;callback 依 orderId 自 settle → paid 清車+regenerate / failed 不清車+CTA / pending 不清車+有界輪詢+CTA;回購物車再付仍經 preflight。
- **S2b released predicate**(🔴 round6,plan §4 R1c2):**不只加 status**——released 繞 manual/ceiling、pending/charged 仍受 manual/ceiling 閘、unpaid+throttle 對所有狀態保留;db push 前補 10 案模擬。
- **anomaly 資料層 + lifecycle**(🔴 round6+round7+round8,plan §3/§4 R1b1a-c/§7):**主表 `id uuid PK` + `old_attempt_id UNIQUE NOT NULL` + 逐欄型別 + `amount integer CHECK≥0`(取 orders.total、禁浮點)** + **append-only `payment_double_charge_anomaly_events` 表**;**兩表 ENABLE RLS zero-policy + REVOKE ALL ON TABLE(PUBLIC/anon/authenticated/service_role/payment_confirmer)+ has_table_privilege fail-closed assert**(payment_confirmer 零 table 權限、只透過 SECDEF RPC 寫);status open|refunding|refunded|dismissed + 一致性 constraints;**`claim_double_charge_anomaly_for_refund`(open→refunding CAS)+ `resolve_double_charge_anomaly`(refunding→refunded / open→dismissed / refunding→open / unknown→保持 refunding)每轉移同交易寫 event、`session_user`**;🔴 **退款未知/Dashboard 遺失 → fail-closed 保持 refunding 寫 `refund_uncertain` event**、**reopen 清主表 claimed/provider 但歷史留 event(不抹稽核)**;報表只列 open、refunding 另列「處理中」;`old_attempt_id` UNIQUE **只防重複 row、CAS 不能物理阻止 Dashboard 重複退款**。
- **manual close**(plan §4 R1c3/D1 定稿):owner-only(REVOKE 含 payment_confirmer、寫 `session_user`、search_path=''+schema-qualified)、released→failed + released_closed_*、無 closed enum、冪等、charged/paid 不可 close。
- **slice 拆 20 片**(🔴 round8,plan §9):R1a1/a2/a3 · **R1b1a/R1b1b/R1b1c**/b2/b3 · R1c1/c2/c3 · R2a/R2b · R3 · W1 · A1/A2/A3 · **B1a/B1b**,各 15–45 分鐘 + 檔案範圍/驗收/rollback/模擬/codex 觸發/內容分級;🔴 **A1/A2/A3 全 codex K2+security+code review**;🔴 **R1b1a/R1b1b/R1b1c/W1 = L3 → R1a1-a3 後停、PRD 過 prd_review 才繼續**(plan §9 intro/§14)。

## 3. 🔴 唯一執行順序(45 步;Git 同步鏈 + 兩次 db push + merge/push/deploy/flag 鏈)+ rollout gate(round9 一/二 + round10 一,plan §14)
1. 本輪 Codex 複審 PASS。
2. **current dev** 更新 `STATUS.md` 七欄。
3. 精準 `git add` canonical plan + handoff + packet + STATUS(禁 `git add .`/`-A`)。
4. **docs-only commit**;Claude **不 push**。
5. 🔴 **【Sean】手動 push 全部已批准 dev commits**(含既有 3 ahead + docs commit)。
6. 🔴 **push 後驗起手綠**:branch=dev / `git status` clean / `origin/dev..HEAD=0` 且 `HEAD..origin/dev=0` / HEAD 對齊 STATUS;**不綠停下回報、不建 worktree、不自行修復**(Sean 不 push = 停止開工、非繞過守線)。
7. 全綠後建 fresh **ROLE=A worktree**,自跑起手檢查 + 完整套件讀取才開 R1a1。
8-10. R1a1 → R1a2 → R1a3。
11-12. 🔴 **停止 implementation,建 anomaly/refund dedicated PRD → 過 `prd_review`**(canonical plan 不等同 PRD;本輪不建)。
13. R1b1a。 14. R1b1b。 15. R1b1c。(🔴 三片各自獨立步,不壓一步)
16-20. R1b2 → R1b3 → R1c1 → R1c2 → R1c3。
21. 🔴 **【Sean】第一次 R1 migration bundle db push**(R1a1–R1c3 連帶 S2b=live)。
22. 🔴 **第一次驗證 gate**(version/catalog/CHECK/index/函式簽名/**table+function ACL/RLS**/**S2b 模擬**;失敗停、不進 R2)。
23-29. R2a → R2b → R3 → W1 → A1 → A2 → A3。
30. B1a。
31. 🔴 **【Sean】第二次 B1a migration db push**。
32. 🔴 **第二次驗證 gate**(B1 claim RPC/ACL/throttle/平行 claim;失敗停)。
33. B1b。
34. 累積整合驗證(三綠/全測試/真雙連線/K2/security/code-reviewer/真機齊備)+ 更新 STATUS/roadmap + 產出整體最終 Codex Review Packet;尚不 commit。
35. 整體最終 Packet 過 commit 前/merge 前複審 PASS(FAIL 回 step 34、不先 commit)。
36. 執行 `busboy-end`、完成最終 commit;不 push(Codex PASS 後才 commit,符合 commit 前審查)。
37. 🔴 **【Sean】把 ROLE=A 成果合併回 dev**(Claude 不自假設 merge 授權)。
38. dev 重驗(branch/status/log/三綠/測試/HEAD-STATUS/累積 diff;失敗停)。
39. 🔴 **【Sean】手動 push dev**。
40. 🔴 **【Sean】依 production 流程把 dev 合併至 `main`**。
41. 🔴 **部署 production,`TAPPAY_3DS_ENABLED` 維持 `false`**。
42. 🔴 **驗證部署 commit SHA / migration / catalog / ACL / RLS / payment routes / flag=false smoke**(失敗停)。
43. production readiness review(查實際部署 SHA、非只看有 commit)。
44. 🔴 **【Sean 拍板】才把 production flag 設 `true`**。
45. 開後 smoke/監控;異常(付款/雙扣/callback/sweeper/anomaly)**第一動作關回 flag=false** 再 rollback/runbook。
🔴 **rollout gate**:開 worktree 前 dev clean+雙向同步;20 片各 checkpoint;兩次 db push + 線上 ACL/RLS 驗證;ROLE=A 整體 Codex 複審 → 合併回 dev → Sean push dev → Sean dev→main → deploy(flag=false)→ 部署 SHA 與批准版本一致 + flag=false smoke;全完成 + Sean 拍板才開 flag、開後監控 + 先關 flag rollback;B1 defer 須拍板+編號 backlog(不可默默略過、不得同時宣稱全片完成才開與可無條件略過)。
> 🔴 本輪(Codex round10 文件修正)**仍禁實際更新 STATUS / 禁 stage / 禁 commit / 禁 push / 禁 merge / 禁 deploy / 禁開 flag / 禁開 R1a1**;此序僅供下一步遵循。**本輪文件修正 ≠ 已完成 Git 同步、部署或 production 驗證。**

## 4. unresolved(round10 後仍僅 2,皆不阻擋 R1a1)
- **D3**:塊A 三事件 + fallback 的 **UX 文案字面**(L2;狀態轉移/清車規則已定稿、不待)。
- **未來**:取得 TapPay 官方終局契約後是否另做自動 close(Phase 1 僅人工;屆時獨立 migration、不留 schema 二選一)。

## 5. 守線(不變)
- 真錢 code **未實作**;**SQL harness 未變子集合 PASS ≠ canonical R1 PASS ≠ 整體流程 PASS ≠ Git 同步/部署/production 驗證已完成**。
- **不 stage / 不 commit / 不 push / 不 merge / 不 deploy / 不開 flag / 不 db push / 不碰 .env / 不跑新 DB 寫入**(push/merge/deploy/開 flag 皆 Sean 手動、見 §3 第 5/39/40/44 步)。
- production `TAPPAY_3DS_ENABLED` **全程維持 false**,直到 §14 全 rollout gate 過 + Sean 最終拍板。
- 正式上線依賴 Sean 正式四憑證成套(plan 附錄 A / round3 handoff §4)。

— END —
