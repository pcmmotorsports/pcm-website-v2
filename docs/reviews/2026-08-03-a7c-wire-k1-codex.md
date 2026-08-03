# 2026-08-03 A7c 退款接線線 plan — codex 關卡1 兩輪 findings 逐字

> 審者 = codex exec -m gpt-5.6-sol -s read-only(兩輪皆前後 git status 零留痕)。
> R1 對象 = plan v1、R2 對象 = plan v2;折入結果 = plan v3(同檔)。完整 session log 在視窗② scratchpad(揮發)。

## R1 = FAIL(22 must-fix + 6 nit;親驗駁回 0)

FAIL

- must-fix — §2 G3（[plan:49](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:49)）用帳本 remaining 阻擋超額，直接推翻「DB 不做防超退」拍板；且帳本看不到 Portal 手動退款，數值不是正式可退額。[七拍板:46](/Users/sean_1/pcm-refund-wire/docs/handoff/2026-08-01-a7c-night-run-handoff.md:46)、[migration:47](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:47)、[remaining 註解:437](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:437)。修法：移除上限守門，或新增明確決策題請 Sean 正式推翻原拍板。

- must-fix — §3 deferred 映射（[plan:69](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:69)）把 `deferred` 寫成 `failed`，違反契約「不是 failure、不得讓 caller 誤判後重退」；failed 又會被 remaining 排除，可能立即開放第二筆退款。[types.ts:173](/Users/sean_1/pcm-refund-wire/packages/domain/src/payment/types.ts:173)、[remaining:457](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:457)、[10024 證據:160](/Users/sean_1/pcm-refund-wire/docs/reference/tappay-reference.md:160)。修法：新增可持久化的 `deferred` 狀態及轉移規則，並規定同一嘗試不重送、重新查驗後才可建立新 key。

- must-fix — §3 accepted mismatch（[plan:68](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:68)）已拿到真 `refundId` 卻保持 processing；P7C10 禁止 processing 保存該 ID，因此唯一直接證據會遺失。[adapter:389](/Users/sean_1/pcm-refund-wire/packages/adapters/src/tappay/TapPayChargeAdapter.ts:389)、[P7C10:342](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:342)。修法：在回應前用獨立 evidence/attempt 欄位或表保存 `refundId`、回傳金額與時間；不能只靠 log 或日後 Record。

- must-fix — §3 unknown throw／§4 接線債 1（[plan:72](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:72)、[plan:76](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:76)）所稱「Record aggregate diff」無法執行：目前沒有在送出前持久化 `refunded_before`，Record 契約也只有聚合資料，不能把差額可靠歸因到這一筆退款。[TradeRecord:238](/Users/sean_1/pcm-refund-wire/packages/domain/src/payment/types.ts:238)、[接線債:143](/Users/sean_1/pcm-refund-wire/docs/handoff/2026-08-03-nightly-refund-adapter.md:143)。修法：送出前同交易保存 Record baseline、目標金額與查驗版本；定義 Record 不可用、多人並發及 Portal 介入時的停止規則。

- must-fix — §3 full 比對（[plan:68](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:68)）寫「full 比 remaining」會踩時序陷阱：initiate 插入 processing 後，remaining 已扣掉該筆，full 很可能讀成 0。[remaining:457](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:457)。修法：一律比對 initiate 回傳／帳本凍結的 `refund_amount`；若需要 pre-insert remaining，必須另存 snapshot，禁止 finalize 時重算。

- nit — §3 accepted→confirmed（[plan:68](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:68)）不一定映錯，但 plan 未定義 `confirmed` 是「TapPay 接受請求」還是「款項已退入消費者端」；契約明說 accepted 不代表已入帳。[types.ts:167](/Users/sean_1/pcm-refund-wire/packages/domain/src/payment/types.ts:167)。修法：把資料語意、UI 用詞及 RF8 後續查驗責任寫死，避免後台顯示「退款完成」。

- must-fix — §2 G7（[plan:53](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:53)）要求驗證 `(order_id, kind, amount)`，但帳本根本沒有 `kind` 欄位，無法驗證 full/partial 指紋。[ledger schema:80](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:80)。修法：把 `kind` 持久化並納入 immutable guard，不能用會隨帳本變動的 remaining 反推。

- must-fix — §2 G7 的 token 可跨訂單重用：`request_id` 只有 nonblank，沒有 UNIQUE；proxy 也明記 session holder 可自行選擇／重用 token。[ledger:96](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:96)、[proxy.ts:31](/Users/sean_1/pcm-refund-wire/apps/admin/src/proxy.ts:31)。修法：新增全域 action-token 唯一鍵，RPC 必須以 token 找既有列再逐欄比對指紋；明定重播遇到 processing、confirmed、deferred、failed 各自回什麼。

- must-fix — §4 接線債 2（[plan:77](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:77)）聲稱 G1＋UI pending 可防雙擊，但 G1 的 row lock 在 initiate 結束就釋放；若 Q1 選 advisory-lock 方案，第二次點擊仍可再建 processing。[plan Q1:83](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:83)。修法：使用可跨 HTTP／網路等待期存在的 partial unique constraint 或明確 lease；UI 只能降噪，不能列為金流守門。

- must-fix — §2 G10（[plan:56](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:56)）兩段式 `SUM >= total ? refunded : partiallyRefunded` 會在 failed/deferred/not-sent 且 SUM=0 時把 paid 訂單翻成 partiallyRefunded，也可能把原本 `refunded` 降級。[state-machine:18](/Users/sean_1/pcm-refund-wire/packages/domain/src/order/state-machine.ts:18)、[P7C02:232](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:232)。修法：failed 類結果不得改 payment status；confirmed 才做單調轉移，且必須處理 0／partial／full 三態並禁止 refunded 降級。

- must-fix — G10 的並發正確性尚未成為可實作規格。要讓等待中的第二個 finalize 看見第一筆 committed SUM，必須在 `READ COMMITTED` 下先鎖 order，再 CAS refund，最後用新 statement 算 SUM；反過來先鎖 refund 會破壞既有 order→refund 鎖順序，Repeatable Read 也可能看不到新 commit。[plan:56](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:56)、[既有 order lock:218](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:218)。修法：把精確 SQL 順序與 isolation assertion 寫進 plan/harness，測兩個 finalize 交錯與失敗 rollback。

- must-fix — Q1 A/B（[plan:83](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:83)）不是可互換選項：A 保證跨請求只有一筆 processing；B 的 transaction advisory lock 只保護 initiate 當下，plan 自己也承認不擋 residual processing。修法：將「是否允許多筆 processing」獨立成業務決策；若答案是不允許，B 應刪除或改成持久 lease。

- must-fix — 缺少「已是 refunded 的訂單能否再從系統退款」決策。P7C02 特意允許 `refunded`，但 domain state machine 把 refunded 視為 terminal；本地帳本又可能不知道 Portal 歷史退款。[P7C02:238](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:238)、[state-machine:38](/Users/sean_1/pcm-refund-wire/packages/domain/src/order/state-machine.ts:38)。修法：新增決策題，選擇硬擋、先查 Record 後允許，或明確的人工覆核流程。

- must-fix — §2 G11（[plan:60](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:60)）把 session、Origin、actor 稱為「三道授權」不成立：目前是共用 SSO，actor cookie 是使用者自行選的署名，不是身分或退款權限。[authorize.ts:12](/Users/sean_1/pcm-refund-wire/apps/admin/src/lib/session/authorize.ts:12)、[actor.ts:5](/Users/sean_1/pcm-refund-wire/apps/admin/src/lib/session/actor.ts:5)、[session.ts:11](/Users/sean_1/pcm-refund-wire/apps/admin/src/lib/session/session.ts:11)。修法：拍板退款 capability／角色或 step-up 驗證；未完成個人身分前，audit 不得宣稱 actor 是已驗證操作者。

- must-fix — §2 G8/G9（[plan:54](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:54)）只寫「同交易 audit」與 refund-table owner，不足以驗證 initiate、finalize、recovery 都可原子寫入 audit table；SECURITY DEFINER owner 還必須具備 audit table/RLS 所需權限。[A6 owner/ACL 查驗:322](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260802150000_m4b_e10_a6_admin_append_order_note.sql:322)、[owner 相等要求:348](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260802150000_m4b_e10_a6_admin_append_order_note.sql:348)。修法：逐 RPC 定義 audit action/payload，並複製 A6 的 owner、ACL、RLS、FORCE RLS 與 rollback harness。

- nit — 守門清單把既有條件重複算成新門：G3 的 `amount>0` 已由 CHECK 保證，G6 的 confirmed refund ID 已有 P7C09，failed nonblank reason 也已有 CHECK。[ledger:94](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:94)、[ledger:124](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:124)、[P7C09:332](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:332)。修法：標成「沿用既有門」，不要灌大新增守門數量。

- must-fix — G6 的 outcome allowlist 含字面 `<其他>`（[plan:52](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:52)），不是可執行規格。修法：列出固定 machine codes，未知值統一映射單一 `unexpected_adapter_error`；人工文字另放受長度限制的 detail 欄。

- must-fix — RPC 輸入守門缺少 `reason`、actor、request token 的長度、格式與控制字元限制；現有 schema 對這些文字欄位幾乎只有 nonblank。[ledger:90](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:90)。修法：比照 owner RPC 先例加入固定上限、trim 後 nonblank、actor 格式、UUID/token 格式及拒絕控制字元的 harness。

- must-fix — RW1→RW2 缺少實際可跨越的 apply checkpoint。RW1 明訂不 apply（[plan:37](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:37)），但 RW2 要讓 typed `SupabaseClient<Database>` 呼叫新 RPC；未 apply＋重生 types 時 RPC 不存在於型別。[client.ts:60](/Users/sean_1/pcm-refund-wire/packages/adapters/src/supabase/client.ts:60)、[database.types.ts:2194](/Users/sean_1/pcm-refund-wire/packages/adapters/src/supabase/database.types.ts:2194)。修法：RW1 後新增 Sean apply→production read-back→regen types→typecheck 的硬停點，通過才開 RW2。

- must-fix — RW2（[plan:38](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:38)）同時搬 endpoint、改 package export、storefront composition、admin composition、action、按鈕與 sandbox E2E，明顯不是 15–45 分鐘 slice。搬檔還會打破目前讀取 sibling `composition.ts` 的測試與 adapters export surface。[endpoint test:32](/Users/sean_1/pcm-refund-wire/apps/storefront/src/lib/payment/tappay-endpoints.test.ts:32)、[package exports:8](/Users/sean_1/pcm-refund-wire/packages/adapters/package.json:8)、[slice 規則](/Users/sean_1/pcm-refund-wire/AGENTS.md:29)。修法：至少拆成 shared endpoint/export、storefront 回歸、admin composition、action、full-only UI、sandbox E2E 六片。

- must-fix — RW2 sandbox E2E（[plan:106](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:106)）拿 probe 自建 TapPay 交易，卻沒有建立 `orders` 中相同 `tappay_rec_trade_id` 的測試訂單；P7C03 會直接拒絕。更未證明 dev admin 的 Supabase 與 TapPay merchant/environment 成對。[P7C03:248](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:248)、[probe 前提:149](/Users/sean_1/pcm-refund-wire/docs/reference/tappay-reference.md:149)。修法：提供可回收的 PCM 訂單 fixture，先核對 DB、merchant、gateway mode，再限制金額執行；環境不一致必須 fail closed。

- must-fix — Q2/Q4 無法產生合規拆片。Q2-B 把 full+partial 一次做完更超時；Q4-A 自己承認 harness 需多 1–2 小時，Q4-B 則在錢＋schema 高風險工作刪減負向測試。[plan Q2:89](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:89)、[plan Q4:98](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:98)。修法：安全案例不設可刪選項，改成必跑但拆成多個 15–45 分鐘 harness slices。

- must-fix — Q3 sentinel（[plan:93](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:93)）不可行：`RECOVERED+日期` 同日多筆會撞 `tappay_refund_id` UNIQUE；即使沒撞，P7C07 write-once 也讓日後真 ID 無法補回。[ledger unique:133](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:133)、[P7C07:322](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:322)。修法：真 provider ID 與 recovery evidence 分欄；沒有真 ID 時不得偽造 `tappay_refund_id`。

- must-fix — RW4／接線債 1（[plan:40](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:40)）沒有定義掃描條件、等待多久、Record 差額算法、誰可人工關帳、失敗後如何告警及驗收案例，卻在 rollback 稱為「純流程/SOP」（[plan:108](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:108)）。修法：承認它需要 schema/RPC/evidence 支援，另立 recovery slice 與可重現 harness；不能到動工後才問要不要 RPC。

- must-fix — RW3 將帳本函式結果顯示成「剩餘可退」（[plan:39](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:39)），違反 migration 註解：該值不含 Portal，不能當真正 refundable remaining。[migration:437](/Users/sean_1/pcm-refund-wire/supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:437)。修法：改標「系統帳本未登記金額」，或先以 Record 查驗後才提供可退款額。

- must-fix — probe 的 `refund_amount` 結論已被 plan 當正式契約（[plan:18](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:18)），但 domain JSDoc 仍寫語意未知；證據只是 sandbox 的有限樣本。[types.ts:170](/Users/sean_1/pcm-refund-wire/packages/domain/src/payment/types.ts:170)、[probe:157](/Users/sean_1/pcm-refund-wire/docs/reference/tappay-reference.md:157)。修法：把它表述為「sandbox 已觀測 invariant」，保留 mismatch fail-closed，並在 RW1 同步契約註解與測試，不能拿來推論正式環境帳務已完成。

- nit — n=1 併發 probe 本身沒有被過度外推：plan 有保留「只能當 signal、仍需 DB 序列化」；但驗收不得把它列為並發安全證明。[plan:19](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:19)、[probe n=1:164](/Users/sean_1/pcm-refund-wire/docs/reference/tappay-reference.md:164)。修法：正式安全證據只認 RPC 交錯 harness。

- nit — §4 接線債 3（[plan:78](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:78)）雖設成 hard gate，卻沒有寫 residual probe 的預期輸出、失敗停止條件及不同結果如何改 retry/recovery 政策。[reference:168](/Users/sean_1/pcm-refund-wire/docs/reference/tappay-reference.md:168)。修法：補成 yes/no 驗收矩陣，未得到結論時不得開 UI。

- nit — G13（[plan:61](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:61)）只是縮短雙擊視窗，不是安全守門，也不解決重送、換分頁或直接呼叫 action。修法：移到 UX mitigation，守門清單只保留 server/DB 可強制的 invariant。

- must-fix — rollback（[plan:108](/Users/sean_1/pcm-refund-wire/docs/specs/2026-08-03-a7c-refund-wire-plan.md:108)）以「整份 migration/table 重建」為退路，真實帳本列出現後不可接受。修法：逐物件提供 forward rollback：先停 UI、撤 GRANT、移除新 RPC/index/trigger，保留所有退款列與 audit；不可重建或丟棄帳本。

## R2 = FAIL(F1-F28:20 關 8 未關;新增 N1-N3)

**結論：FAIL。** R1 的 28 條中，**20 條已關、8 條未關**。未關的是 F2、F4、F5、F12、F15、F17、F18、F24；另有 3 個 v2 新增的 must-fix。

### F1–F28 關閉判定

| Finding | 判定 | 理由與行號 |
|---|---|---|
| F1 | 已關 | 已刪除 remaining 上限，只驗正整數，明訂不設上界、超額交 TapPay 10051。`plan:26,62` |
| F2 | **未關** | `plan:15` 已記「獨立 deferred 態」，但 Q1-B 仍允許把 deferred 記成 failed。把違反既定語意的方案留作選項，不算修正。`plan:57,82,96-100` |
| F3 | 已關 | 新增獨立 S3 evidence 欄，可在 processing 寫入；accepted mismatch 不再丟失 refundId。`plan:54,66,80-81,89`。但 S3 自身又有新守門缺口，見 N2。 |
| F4 | **未關** | 加了 baseline 欄，卻沒有可執行資料流。RW1a 的 initiate 是 PostgreSQL RPC，現有 Record API 是 TypeScript adapter；DB RPC 不會自己打 TapPay。RW2c 又寫成「RPC initiate→refund」，沒有「先 recordQuery→驗唯一紀錄→把 baseline 傳入 RPC」的步驟或參數。`plan:37,42,53`；`packages/ports/src/ITapPayAdapter.ts:58-61` |
| F5 | **未關** | 比對對象已改成凍結的列值，避開 insert 後 remaining=0；但「全額退」沒有金額輸入，也未定義凍結 `refund_amount` 要如何算出。缺少例如 `originalAmount - refundedBefore` 的權威公式，問題只是往前移。`plan:42,53,62,66` |
| F6 | 已關 | 明確定義 confirmed = TapPay 受理，不等於款項已入帳，並寫出全額／部分退款的營運口徑。`plan:80` |
| F7 | 已關 | S1 正式新增 `kind`，G4 指紋改為引用實際存在的欄位。`plan:52,63` |
| F8 | 已關 | S4 新增全域 `request_id` UNIQUE，跨單重用會被 G4 指紋比對拒絕。`plan:55,63` |
| F9 | 已關 | 改用 DB partial unique 作 single-flight，明確刪除 advisory lock 方案；UI 只作降噪。`plan:56,73,90` |
| F10 | 已關 | payment status 只在 confirmed 分支翻轉；failed、deferred、not_sent 均零觸碰，且 refunded 不降級。`plan:67,80-85` |
| F11 | 已關 | 已規定同交易精確順序：鎖 order→CAS 本列→新 statement SUM confirmed→翻轉。`plan:67` |
| F12 | **未關** | 兩個不等價方案仍並列：A 保留 deferred 語意，B 把它塞進 failed。這不是可互換的儲存選擇，且 B 與 `plan:15` 的既定語意衝突。`plan:57,82,96-100` |
| F13 | 已關 | 新增 Q2，明確要求 Sean 決定 refunded 訂單是否可再發起。`plan:102-105` |
| F14 | 已關 | 已揭露 actor 是自報、非真實身分驗證，並用 Q3 決定接受現況或等 E8-B。`plan:31,72,106-109` |
| F15 | **未關** | G9 只寫「逐 RPC 定義 action+payload 白名單」，本文沒有實際 action 字串、before/after/payload 欄位集合及 recovery audit 內容。仍是要求施工者日後再定義。`plan:68` |
| F16 | 已關 | 新增／沿用／app 縱深已分區；沿用的 P7C09、failed CHECK 明訂不計新守門，app 層也不計。`plan:49,65,71` |
| F17 | **未關** | machine codes 已列出，但 `detail` 欄沒有出現在 S1–S6 或既有 schema；而 `unexpected_adapter_error` 說要進 finalize，`plan:74` 又規定所有其他 throw 不 finalize、留 processing，兩條互相衝突。`plan:51-57,65,74`；既有表只有 `failed_reason`：`20260725130100...sql:96-103` |
| F18 | **未關** | 已補「長度上限／控制字元／token 格式」方向，但沒有 reason、actor、request_id、detail 的實際上限與完整 CHECK／regex；S3 evidence 也沒有非空、trim、長度規格。仍無法直接產生 migration 與負測。`plan:54,61-65` |
| F19 | 已關 | RW1 apply→read-back→regen types→typecheck 已設成硬停點，未過不得開 RW2。`plan:39,125` |
| F20 | 已關 | RW2 已拆成 a–d；搬檔的測試、exports、storefront import 波及也有列出。`plan:40-43` |
| F21 | 已關 | RW2d 已要求建立合法 order fixture、填入 sandbox `tappay_rec_trade_id` 通過 P7C03，並驗證 local Supabase 與 sandbox TapPay 配對。`plan:43` |
| F22 | 已關 | 新 Q2、Q4 都是兩個互斥選項，並標推薦與代價。`plan:102-114` |
| F23 | 已關 | sentinel 路線已移除；Q4-A 改用 Portal 取得真 DR 碼，不撞 UNIQUE／P7C07。`plan:111-114` |
| F24 | **未關** | RW4 已從一句 SOP 擴寫，但仍缺 T 的值、具體入口／RPC 簽章、「Portal 介入痕跡」的可機械判定、Record 多筆／查無／欄位缺失規則及可生成的 harness 格。加上 F4 baseline 流程不可執行，RW4 尚不是完整規格。`plan:45,89` |
| F25 | 已關 | UI 改稱「帳本未登記額」，明確不宣稱是真實剩餘可退額。`plan:44,83` |
| F26 | 已關 | `refund_amount` 只標為 sandbox 觀測，禁止外推正式帳務；正式接線只作相等比對，失配 fail-closed。`plan:18,22,66,80-81` |
| F27 | 已關 | 兩個今晚殘項已有成功／失敗分支及各自 stop rule。`plan:91` |
| F28 | 已關 | rollback 改為逐物件 forward rollback；有真退款列後不重建表、不刪帳本與 audit。`plan:127` |

### v2 新問題

1. **N1 — deferred 宣稱釋出額度，但既有 remaining 函式仍會扣除 deferred。**

   v2 說 deferred 是終態、額度釋出並可開新列：`plan:57,82`。但既有函式使用：

   `WHERE r.status <> 'failed'`

   因此新 `deferred` 仍被 SUM，RW3 的「帳本未登記額」會持續少算；S5 已允許新 processing 列後，更會同時扣到舊 deferred 與新列。`20260801120000...sql:450-467`

   Q1=A 時必須同步把函式與 COMMENT／harness 改成只計 `processing|confirmed`。

2. **N2 — S3 與 P7C08/P7C07/P7C10 沒直接相撞，但也沒有真正受到它們保護。**

   - P7C08 只擋 INSERT 預填 `tappay_refund_id`：`20260801120000...sql:262-269`
   - P7C07 只保護 `tappay_refund_id/confirmed_at`：`:322-330`
   - P7C10 只禁止 processing 期間填 `tappay_refund_id`：`:342-348`

   所以 processing 寫 S3 在結構上可行；confirmed 同次把 `tappay_refund_id` 由 NULL 寫成值，也符合 P7C07/P7C09/P7C10。

   但 v2 只有「write-once」文字，沒有規定：

   - INSERT 時 S3 必須為 NULL。
   - 僅允許 NULL→合法非空值，之後不可改／清空。
   - confirmed 時 S3 與 `tappay_refund_id` 必須一致，包含 RW4 recovery 同次補齊。

   因此答案是：**可相容，但目前規格未形成完整守門。**

3. **N3 — G6 新增了不存在的資料形狀與不可達 outcome。**

   `detail` 欄未列入 schema；`unexpected_adapter_error` 又被 `plan:74` 的「其他 throw 不 finalize」規則排除。這會讓 migration、RPC 回傳碼及 UI 無法從同一規格生成。`plan:51-57,65,74`

### S5 與 G4 專項結論

S5 本身的金錢安全方向成立：

- processing 列唯一；failed／deferred／confirmed 不在 partial index，能與新 processing 列並存。
- 同一 `request_id` 重播應先由 G4 查到原列，不重新 INSERT，因此不撞 S5。
- 不同 `request_id` 在既有 processing 尚存時會被 S5 擋下，沒有雙退窗口。

仍有一個非漏錢但需補規格的角落：不同 request 命中 S5 時，G4 沒有定義如何把該 index 的 `23505` 穩定轉成「已有退款處理中」；目前只會落成未指定的 RPC 錯誤。更嚴重的是 Q1=A 的 deferred 雖會釋放 S5，卻不會釋放既有 remaining 函式的顯示額度，即 N1。

本輪全程唯讀；working tree 狀態前後一致，未修改任何檔案。
tokens used
219,179
**結論：FAIL。** R1 的 28 條中，**20 條已關、8 條未關**。未關的是 F2、F4、F5、F12、F15、F17、F18、F24；另有 3 個 v2 新增的 must-fix。

### F1–F28 關閉判定

| Finding | 判定 | 理由與行號 |
|---|---|---|
| F1 | 已關 | 已刪除 remaining 上限，只驗正整數，明訂不設上界、超額交 TapPay 10051。`plan:26,62` |
| F2 | **未關** | `plan:15` 已記「獨立 deferred 態」，但 Q1-B 仍允許把 deferred 記成 failed。把違反既定語意的方案留作選項，不算修正。`plan:57,82,96-100` |
| F3 | 已關 | 新增獨立 S3 evidence 欄，可在 processing 寫入；accepted mismatch 不再丟失 refundId。`plan:54,66,80-81,89`。但 S3 自身又有新守門缺口，見 N2。 |
| F4 | **未關** | 加了 baseline 欄，卻沒有可執行資料流。RW1a 的 initiate 是 PostgreSQL RPC，現有 Record API 是 TypeScript adapter；DB RPC 不會自己打 TapPay。RW2c 又寫成「RPC initiate→refund」，沒有「先 recordQuery→驗唯一紀錄→把 baseline 傳入 RPC」的步驟或參數。`plan:37,42,53`；`packages/ports/src/ITapPayAdapter.ts:58-61` |
| F5 | **未關** | 比對對象已改成凍結的列值，避開 insert 後 remaining=0；但「全額退」沒有金額輸入，也未定義凍結 `refund_amount` 要如何算出。缺少例如 `originalAmount - refundedBefore` 的權威公式，問題只是往前移。`plan:42,53,62,66` |
| F6 | 已關 | 明確定義 confirmed = TapPay 受理，不等於款項已入帳，並寫出全額／部分退款的營運口徑。`plan:80` |
| F7 | 已關 | S1 正式新增 `kind`，G4 指紋改為引用實際存在的欄位。`plan:52,63` |
| F8 | 已關 | S4 新增全域 `request_id` UNIQUE，跨單重用會被 G4 指紋比對拒絕。`plan:55,63` |
| F9 | 已關 | 改用 DB partial unique 作 single-flight，明確刪除 advisory lock 方案；UI 只作降噪。`plan:56,73,90` |
| F10 | 已關 | payment status 只在 confirmed 分支翻轉；failed、deferred、not_sent 均零觸碰，且 refunded 不降級。`plan:67,80-85` |
| F11 | 已關 | 已規定同交易精確順序：鎖 order→CAS 本列→新 statement SUM confirmed→翻轉。`plan:67` |
| F12 | **未關** | 兩個不等價方案仍並列：A 保留 deferred 語意，B 把它塞進 failed。這不是可互換的儲存選擇，且 B 與 `plan:15` 的既定語意衝突。`plan:57,82,96-100` |
| F13 | 已關 | 新增 Q2，明確要求 Sean 決定 refunded 訂單是否可再發起。`plan:102-105` |
| F14 | 已關 | 已揭露 actor 是自報、非真實身分驗證，並用 Q3 決定接受現況或等 E8-B。`plan:31,72,106-109` |
| F15 | **未關** | G9 只寫「逐 RPC 定義 action+payload 白名單」，本文沒有實際 action 字串、before/after/payload 欄位集合及 recovery audit 內容。仍是要求施工者日後再定義。`plan:68` |
| F16 | 已關 | 新增／沿用／app 縱深已分區；沿用的 P7C09、failed CHECK 明訂不計新守門，app 層也不計。`plan:49,65,71` |
| F17 | **未關** | machine codes 已列出，但 `detail` 欄沒有出現在 S1–S6 或既有 schema；而 `unexpected_adapter_error` 說要進 finalize，`plan:74` 又規定所有其他 throw 不 finalize、留 processing，兩條互相衝突。`plan:51-57,65,74`；既有表只有 `failed_reason`：`20260725130100...sql:96-103` |
| F18 | **未關** | 已補「長度上限／控制字元／token 格式」方向，但沒有 reason、actor、request_id、detail 的實際上限與完整 CHECK／regex；S3 evidence 也沒有非空、trim、長度規格。仍無法直接產生 migration 與負測。`plan:54,61-65` |
| F19 | 已關 | RW1 apply→read-back→regen types→typecheck 已設成硬停點，未過不得開 RW2。`plan:39,125` |
| F20 | 已關 | RW2 已拆成 a–d；搬檔的測試、exports、storefront import 波及也有列出。`plan:40-43` |
| F21 | 已關 | RW2d 已要求建立合法 order fixture、填入 sandbox `tappay_rec_trade_id` 通過 P7C03，並驗證 local Supabase 與 sandbox TapPay 配對。`plan:43` |
| F22 | 已關 | 新 Q2、Q4 都是兩個互斥選項，並標推薦與代價。`plan:102-114` |
| F23 | 已關 | sentinel 路線已移除；Q4-A 改用 Portal 取得真 DR 碼，不撞 UNIQUE／P7C07。`plan:111-114` |
| F24 | **未關** | RW4 已從一句 SOP 擴寫，但仍缺 T 的值、具體入口／RPC 簽章、「Portal 介入痕跡」的可機械判定、Record 多筆／查無／欄位缺失規則及可生成的 harness 格。加上 F4 baseline 流程不可執行，RW4 尚不是完整規格。`plan:45,89` |
| F25 | 已關 | UI 改稱「帳本未登記額」，明確不宣稱是真實剩餘可退額。`plan:44,83` |
| F26 | 已關 | `refund_amount` 只標為 sandbox 觀測，禁止外推正式帳務；正式接線只作相等比對，失配 fail-closed。`plan:18,22,66,80-81` |
| F27 | 已關 | 兩個今晚殘項已有成功／失敗分支及各自 stop rule。`plan:91` |
| F28 | 已關 | rollback 改為逐物件 forward rollback；有真退款列後不重建表、不刪帳本與 audit。`plan:127` |

### v2 新問題

1. **N1 — deferred 宣稱釋出額度，但既有 remaining 函式仍會扣除 deferred。**

   v2 說 deferred 是終態、額度釋出並可開新列：`plan:57,82`。但既有函式使用：

   `WHERE r.status <> 'failed'`

   因此新 `deferred` 仍被 SUM，RW3 的「帳本未登記額」會持續少算；S5 已允許新 processing 列後，更會同時扣到舊 deferred 與新列。`20260801120000...sql:450-467`

   Q1=A 時必須同步把函式與 COMMENT／harness 改成只計 `processing|confirmed`。

2. **N2 — S3 與 P7C08/P7C07/P7C10 沒直接相撞，但也沒有真正受到它們保護。**

   - P7C08 只擋 INSERT 預填 `tappay_refund_id`：`20260801120000...sql:262-269`
   - P7C07 只保護 `tappay_refund_id/confirmed_at`：`:322-330`
   - P7C10 只禁止 processing 期間填 `tappay_refund_id`：`:342-348`

   所以 processing 寫 S3 在結構上可行；confirmed 同次把 `tappay_refund_id` 由 NULL 寫成值，也符合 P7C07/P7C09/P7C10。

   但 v2 只有「write-once」文字，沒有規定：

   - INSERT 時 S3 必須為 NULL。
   - 僅允許 NULL→合法非空值，之後不可改／清空。
   - confirmed 時 S3 與 `tappay_refund_id` 必須一致，包含 RW4 recovery 同次補齊。

   因此答案是：**可相容，但目前規格未形成完整守門。**

3. **N3 — G6 新增了不存在的資料形狀與不可達 outcome。**

   `detail` 欄未列入 schema；`unexpected_adapter_error` 又被 `plan:74` 的「其他 throw 不 finalize」規則排除。這會讓 migration、RPC 回傳碼及 UI 無法從同一規格生成。`plan:51-57,65,74`

### S5 與 G4 專項結論

S5 本身的金錢安全方向成立：

- processing 列唯一；failed／deferred／confirmed 不在 partial index，能與新 processing 列並存。
- 同一 `request_id` 重播應先由 G4 查到原列，不重新 INSERT，因此不撞 S5。
- 不同 `request_id` 在既有 processing 尚存時會被 S5 擋下，沒有雙退窗口。

仍有一個非漏錢但需補規格的角落：不同 request 命中 S5 時，G4 沒有定義如何把該 index 的 `23505` 穩定轉成「已有退款處理中」；目前只會落成未指定的 RPC 錯誤。更嚴重的是 Q1=A 的 deferred 雖會釋放 S5，卻不會釋放既有 remaining 函式的顯示額度，即 N1。

本輪全程唯讀；working tree 狀態前後一致，未修改任何檔案。

## R3 = FAIL(fable 換角度:假設審查/災難當天/修法回歸/測試假綠;5 must-fix + 8 nit;審 v3.1、折入 v3.2)

- F1|鏡頭1+3+4|plan G0「取 refundedAmount ?? 0」自我矛盾且開出假結案窗:refundedAmount 型別層 optional(types.ts:263)、parser 缺欄回 undefined(TapPayChargeAdapter.ts:83)、未退款紀錄實測必帶 refunded_amount=0(wire.test.ts:165-170)⇒ 缺欄=異常非零。缺欄凍成 0 → S2 不可變永久污染 → RW4 delta 灌大;若恰有等額 Portal 舊退款,機械判「已退」→ 帳本確認一筆從未執行的退款。修法:刪 ?? 0、undefined 走 abort;RW4 harness 補「缺欄必 abort」負測。【must-fix】
- F2|鏡頭1+2|G0 無 record_status/金額下限閘:Portal 已全退(本地仍 paid、G12 擋不到)→ Record amount=0 → full 凍結 0 元 → 撞 refund_amount>0 CHECK=23514 裸錯,值班凌晨看不懂;record_status 5/4 同樣長驅直入。修法:G0 加 record_status ∈ {0,1,2} + full 斷言 amount>0,各配具名可讀錯誤。【must-fix】
- F3|鏡頭3|Q4=B 後「部分退未跑 E2E 不宣告可用」擋不住真的可用:pcm-admin production 追 dev ⇒ RW2d commit+推 dev 那刻部分退欄位就活在正式站,唯一控制=口頭。修法:入口在 E2E 綠前不 render(server flag),把口頭升級成機制。【must-fix】
- F4|鏡頭2|RW2c/2d 上線 → RW4 收工之間,卡 processing=無畫面死巷:異常清單/恢復在 RW3/RW4 才有;窗內第一筆 unknown-state → S5 永久回「已有退款處理中」、finalize 無 UI 呼叫端 → 值班唯一出路=半夜挖 SQL。修法:正式站入口啟用 ≥ RW4 收工為硬序,或附值班 runbook。【must-fix】
- F5|鏡頭4|RW1b「G8 交錯 barrier」照字面構造不出來:S5 保證同單至多一列 processing ⇒ 兩 finalize 同單搶 SUM 不可達;同列雙 finalize 由 G5 CAS 決勝。停用 S5 去造=測的不是上線組態。修法:改測 finalize G8 × initiate G12 barrier(斷言 initiate 等翻轉 commit 後被 G12 擋);兩 finalize 場景註明由 S5+G5 蘊含。【must-fix】
- N1 fixture 釘防恆真(baseline>0 一格/SUM<total 一格/refund_amount≠total 避撞號)【nit】
- N2(MEDIUM 邊界)bank_refund_id 生成無方案/熵下限;sandbox 商戶已被 probe 消耗 pcm-* 鍵,日期式第一發 E2E 就可能 6002。修法:釘 ≥80-bit 隨機方案。【nit】
- N3(MEDIUM 邊界)「同步秒級」假設 vs adapter 30s 硬逾時(TapPayChargeAdapter.ts:327)vs Vercel Hobby 函式時限;補 route maxDuration 顯式。【nit】
- N4 G7-hold 列(S3 非空且 processing)=當下已知異常,異常清單條件加 OR provider_refund_id_evidence IS NOT NULL。【nit】
- N5 UI「約當日 20:00 後」是 sandbox 批次外推(僅 T2 觀測),改「請款完成後」。【nit】
- N6 deferred 與既有 failed_consistency/processing_clean CHECK 相容格未列入 harness;G6 未明說 deferred 不寫 failed_reason。【nit】
- N7 kind=full 重播凍結額隨 Record 漂移 → 指紋不符 RAISE 屬 fail-closed 可接受,錯誤文案應涵蓋。【nit】
- N8 remaining 改 allowlist 後未來新增狀態預設不佔額度(顯示面 fail-open 方向),COMMENT 應載明。【nit】
- 擊不破的點(節錄):G8×P7C02 鎖交錯無死結環;rejected→failed 釋額後找不到只信本地帳本的錢路;refunded 自轉移不可達;delta 合併格在 F1 修掉後無漏錢路徑;S3×P7C07/08/10×P7C09 逐分支對過無新縫。
- 是否可繼續:需修正(F1-F5 修完即可開工 RW1a,無需回 Sean 重拍 — 均不觸動 §5 五拍板字面)。

## R3 窄確認紀錄(補登;關卡2 codex nit 指出漏記)

- 審者=adversarial-reviewer(model:fable、同一 agent 續 context);對象=plan v3.2(git `525e46f`)。
- 結果=**PASS**:F1-F5 逐條判「已關」(F1 缺欄負測由 §4-1 既有判定碼 harness 覆蓋、另 delta 算術 fail-closed;F2 G0 ②④;F3/F4 REFUND_UI_ENABLED 機制;F5 交錯格改寫逐字同修法);N1-N8 零漏折。
- 一條字面 vs 事實備註:宣稱「RW4 缺欄負測新格」實為既有格覆蓋 —— RW1b 補顯式格。

## 關卡2 R1(RW1a migration 20260803150000;staged diff)

### code-reviewer(opus)= FAIL:1 Critical + 4 Important + 8 Minor(摘錄)

- C1 P7C11 已被 `a7c_refund_items_frozen`(20260801120000:404)佔用=同碼雙門;且 plan 字面=「併入 P7C08 家族」→ 改 P7C08(P7C03 一碼雙名同例)。
- I1 `GET DIAGNOSTICS ROW_COUNT` 隔著賦值才讀=非文件保證 → 每 UPDATE 緊接 `RETURNING INTO`+`v_after.id IS NULL` 判定。
- I2 G8 未斷言出發態(unpaid/partiallyPaid 可被翻)→ 來源態 allowlist。
- I3 P7C13 hold 列語意需明文(Portal DR 碼=wire refund_id 同一識別空間;probe P1/L 實證同值)。
- I4 「DO 未實跑」宣稱 → **駁回**(54331 from-zero 實跑+smoke 有據);「未 apply 正式站」揭示照折進 commit body。
- Minor×8:brid regex 死規則刪除/原文承重註解濃縮回填/COMMENT 補第七稽核值/CAS 訊息用鎖後現況/負值 record_amount 改 RAISE/三支被覆寫函式 ACL 收斂斷言/檔頭引文逐字化/btrim 註記。全折。

### codex `gpt-5.6-sol` = FAIL:7 must-fix + 5 nit(摘錄;零留痕已比對)

- MF1 🔴 hold 列可被二次 finalize 標成零動錢終態 → 釋放 S5+remaining → 再 initiate=雙退路徑;鎖前預讀列過期 → P7C15 trigger + RPC 5a + 鎖後重讀 FOR UPDATE。
- MF2 recovered_confirmed 憑格式合法 DR 碼即可憑空 confirm → 恢復出口加「異常列閘」(processing 超 30 分 OR 證據非空;鏡像 RW4 清單條件)。
- MF3 audit 從參數組非事實、reason 寫自由文字 → 全改 RETURNING 實際列值、audit.reason=NULL。
- MF4 G4 排在 G12 後 → refunded 後同 token 重播被 LEDGER_FULL 遮蔽 → G4 移到鎖單後第一步(smoke G2 實證 DUPLICATE|confirmed)。
- MF5 G8 缺來源態 allowlist(=code-reviewer I2)→ 折。
- MF6 trigger 綁定/啟用/覆寫前 prosrc 漂移全未驗 → 前置 0d/0e + 驗收 11j/11k。
- MF7 plan 字面「具名 RAISE」vs 實作回傳碼兩套並存 → plan §2 S5/G12 字面修訂為固定回傳碼(A6 house 慣例)。
- nit×5:search_path 樣式(全庫一致、記誠實邊界不單片破例)/前置文案三處(兩表/恰三值/enum regtype)→ 折/R3 窄確認漏記 → 本段補登/「唯二路」限定 service_role 路徑+P7C01 訊息補 deferred → 折。

### R1 後修法驗證(第二輪 from-zero)

- 54331 重 provision 全套綠(檔內驗收 NOTICE 含 P7C15/trigger 綁定)+ smoke v2 十六路全符
  (新增 G2/I2/J2 三路直測 MF4/MF2/MF1 修法)+ typecheck/lint 綠。

## 關卡2 R2(窄複審;兩線皆 PASS)

- **codex `gpt-5.6-sol` = PASS**:MF1-MF7 + nit×5 逐條判「已關」(MF1:P7C15+5a+鎖後重讀三層;
  MF2:異常列閘無繞法、created_at DB 產且不可變;MF4:重播矩陣無新縫);新致命=未見;
  staged blob 與工作檔雜湊一致。零留痕已比對。
- **code-reviewer(opus)= PASS**:C1/I1-I4/M1-M8 全關(I1 修法「比建議更強」、I3「超出要求」;
  I4 撤回並接受駁回)。殘 2 nit 已即修:11k 先擋 `proacl IS NULL`(aclexplode(NULL) 假綠格)、
  檔頭引文行號 :314→:315。
- nit 修正後第三輪 from-zero 重放綠(檔內驗收 NOTICE 全過)、54331 已 teardown。

---

# RW1b(harness 片)關卡2 紀錄(2026-08-03 傍晚;staged=scripts/a7c-rw1b-verify.sh 新檔 + scripts/a7c-verify.sh 對帳)

> 片型=🔴(全線高風險不降級);SOP 序列跑(code-reviewer → codex,不平行 —— RW1a 的偏離已改正)。
> 兩輪駁回 0 條。修後 from-zero all 實跑 57/57 全綠 exit 0(run5/run6 兩輪一致)。

## code-reviewer(opus)R1 = FAIL:3 must-fix + 8 nit(全折)

- **MF1** barrier「B 在 A commit 前零輸出」`[ ! -s outb ]` 恆真(psql 導檔 block-buffered)⇒ 刪格、
  EXPECT_PASS 58/56→57/55;「B 未返回」由 wait_blocked_by 蘊含。
- **MF2** 檔頭誠實邊界引用不存在的案例 id「J2」⇒ 改 c20(誠實邊界段自己要誠實)。
- **MF3** commit subject 79>72 ⇒ 縮為「test(scripts): RW1b 退款 RPC harness 全套 + a7c-verify 對帳新欄 [M-3]」(len=61 實測)。
- nit×8:c08=歸因非承重(措辭改+登記未消融)/三世界線標未實測推論+G1 未單獨消融/wait_idle 陳舊態
  ⇒ finalize 步改 query 錨定/run 模式 §6 冪等守門/突變段補 ON_ERROR_STOP+rc 獨立訊息/EXIT trap
  收屍+kill -0/STATUS 7 欄=worktree 慣例主視窗補(不動)/檔案模式改 644。
- 查過無虞面(節錄):count gate 四數字自己重數全中;c50/c51 稽核數對 migration 逐路徑重數全中;
  fixture 三釘=可執行斷言;兄弟補欄 11 處無漏且不造成恆真;A→B→A 選單一致;a7bt-* 直寫舊形狀
  在 20260801120000 已失效=非本片遺漏。

## codex `gpt-5.6-sol` R1 = FAIL:4 must-fix + 3 nit(全折)

- **MF1** workdir 閘 `/tmp/?*` 被「/tmp//」穿過(? 可匹配 /)⇒ all 模式 `rm -rf /tmp//`;且
  ownership 驗證前就對任意 pgdata 執行 stop ⇒ 改:existence+marker 才准 stop/rm + 直屬子目錄閘。
- **MF2** c50 outcome 只數 distinct=7(錯字 outcome 也湊得滿)⇒ 改與七值全集 array 逐字相等。
- **MF3** finalize 四道獨立衛生(actor regex/request regex/壞 DR 碼/負數 wire)無負測 ⇒ 補 c56-c59、
  EXPECT_CELLS 55→59。
- **MF4** barrier substring grep(NOT_FINALIZED 也放行)⇒ `grep -qx` 整行精確 + 兩輸出檔零 ERROR。
- nit×3:mode allowlist(all|run 之外 exit 2)/突變宣稱收窄(15 具名+2 消融;RPC 內守門未消融、
  G4 同 token 真併發與 5b 正向未測=載明)/pg_blocking_pids 加 cardinality=1(「恰含」字面成立)。

## codex R2(窄複審)= 6/7 已關;MF1 再擊破一次 → 修 → 實測收案

- R2 判 MF2/MF3/MF4+nit×3 已關;**MF1 未關**:`/tmp/<symlink>/` 尾斜線讓 `[ -L ]` 循鏈判 false
  ⇒ 仍可對別的 marked cluster stop。
- 修法:**先剝光尾斜線**(-L 才看 symlink 本體)→ -L → `/tmp/?*` → `/tmp/*/*` 拒多層與連續斜線
  → 拒 `..` → basename 閘。
- **收案證據=實測負路徑**(可反駁預測:六種構造必 die,全中):`/tmp//`(剝完=/tmp,macOS /tmp
  本身是 symlink ⇒ die)、`/tmp/link/`、`/tmp/link`、`/tmp/a/b`、`/tmp/../etc`、`/tmp/.`;
  正向 `/tmp/rw1b/`(尾斜線真目錄)通過閘。修後 from-zero all 57/57 exit 0。
- MF1 的第三輪確認交由 code-reviewer R2(異模型窄確認)覆核,不再開 codex R3
  (R2 其餘 6 條已關、剩餘問題已由實跑負路徑收案;輪次紀律=有用才加輪)。

## code-reviewer(opus)R2 窄確認 = PASS(鏈收斂)

- 你方 R1 3MF+8nit 逐條判已關(EXPECT_PASS 57/55 由其逐 ok 站點手算獨立核對、非口頭調數);
  codex R1 4MF+3nit 判已關;codex R2 的 MF1 再擊破判已關 —— 並自行加測五個方向
  (//tmp/x、/、//、含換行路徑、/tmp/*)全穿不過;`$WORK` 全檔帶引號=glob 不展開(grep 驗證)。
- 新 Minor 2 條已即修:handoff §3c「~800 行」→ 1480 行(wc -l);「run/all 一致=可重現」字面
  過期 → 改為 all 兩輪為準 + run=55 折入後無實跑證據(靜態手算)誠實標註。
- 新 nit 已即修 1 條:run 分支不再先 mkdir 後 die(缺 marker 直接死、不留空殼)。
  不動 2 條(kill -0 判別力弱但方向對;sa BEGIN/COMMIT 的 wait_idle 陳舊態無害)。
- 殘餘登記(非本片修):WORK 含引號/空白可注入 pg_ctl -o 字串=呼叫者自傷面、非跨使用者邊界;
  workdir 閘 TOCTOU:rm -rf 對頂層 symlink 只刪連結本身、破壞面有限。
- commit 訊息判 ✅(61 字元;scope=scripts 屬既有慣例外延)。

> 收工數字:from-zero all 57/57 全綠 exit 0(修後兩輪一致);行為格 59、負測 17(n00 對照+16)、
> 突變+消融 17(乾淨承重 17/17)。
