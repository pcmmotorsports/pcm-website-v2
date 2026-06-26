# M-3 3DS 放棄交易完整方案 — canonical 執行 plan(乙路·退款版·立即重刷)v10

> **canonical 狀態(2026-06-27, round11 PASS + pivot 塊A popup→整頁 redirect 已折入):** 本檔已折入 codex round4(8 項)+ round5(10 項)+ round6(7 組)+ round7(4 必修組)+ round8(4 必修 + 1 consider + 2 nit)+ round9(Git/worktree 同步鏈 + merge/push/deploy/flag 鏈 + 20 片逐列 + 2 nit)+ round10(§14 步34-36 commit/複審時序修正 + 1 nit)+ round11(複審 PASS 零 finding)+ **2026-06-27 pivot(Sean 拍板:塊A 3DS UX 由「桌機 popup + 原頁輪詢」改「桌機+手機整頁 redirect」;理由 = TapPay 3DS redirect-only〔payment_url 只支援整視窗 top-level navigation、不支援 iframe/popup〕+ popup 過時 + 真機實證同分頁兩 popup 雙扣 0072/0073;見 §6/§2.3/§9/§14 + 附錄 B ㉗)** must-fix,**取代並廢除**所有前版「後段覆蓋前段」層疊。**本檔為唯一、可直接執行的真權威**;歷史方向見「附錄 B(superseded,勿實作)」。
>
> **守線狀態(誠實,見 §12):** **pre-round4 R1 SQL harness 的「未變子集合」35/35 PASS**(零留痕);canonical 新增/變更契約(released failure observation 三參數雙鍵 + 輸入守衛、find_sibling ACL/PUBLIC revoke + 資料最小化、markFailed order-paid guard、S2b released 繞 manual/ceiling、anomaly 主表 + **append-only event 表** RLS/table ACL + id PK + claim/resolve CAS lifecycle + 退款未知態 fail-closed、B1a server-only claim RPC 並發、manual close、兩次 db push 驗證 gate)**尚未模擬**,須在對應 slice commit 前各自補 DB 模擬/測試。**整體刷卡流程未 PASS、未進實作、未通過 canonical R1 DB 模擬**;真錢 code 未實作,每段須 三綠 + code-reviewer + codex K2 + 對應模擬 PASS 才 commit、不 push。
>
> **鐵則 8 + 12** → Codex Packet + Sean 終端 db push;db push / push / 肉眼驗收 留 Sean。

---

## §0 Sean 決策鎖定
| 決策 | 值 |
|---|---|
| 方向 | **乙路·立即重刷**(放寬鎖讓客人馬上重買 + 極罕見雙扣偵測後 Sean 手動退;informed-accept) |
| Q1 退款 | 過渡 = Sean TapPay 後台手動退;後台自動退款(Refund API,adapter 現 stub)= 上線前 backlog |
| Q2 問 TapPay | 不問、不依賴「record_status 4 不會晚扣」假設(§2.4) |
| UX(2026-06-27 pivot) | **桌機+手機整頁 redirect**(復用 CheckoutRedirecting;TapPay redirect-only)→ TapPay 完成回 callback、放棄回站由 preflight 處理 → 回購物車(車不丟)→ 馬上重結帳零死路頁。**廢** popup/原頁輪詢/三離開事件跨視窗同步(整頁同分頁一次一筆=消滅二刷主向量;殘餘雙分頁靠 in-flight 防呆 + W1) |
| 節奏 | Y 直攻乙路、Claude 自驅至守線;真錢 code 須 codex K2 + 對應模擬 PASS 才動 |

---

## §1 線上真相(MCP 親驗 2026-06-23,canonical 基線)
- `orders.cart_session_id`(uuid);`create_order` 5-param;`begin_charge_attempt(p_order_id)` 含 cart-instance dedup / user_in_flight(10 分鐘)/ needs_settle / duplicate;`confirm_order_payment` 線上。
- `payment_charge_attempts.status` CHECK = **{pending, charged, failed}**;另有 `..._check`(charged ⇒ rec_trade_id NOT NULL)。
- 索引:`..._order_lock_idx` UNIQUE(order_id) **WHERE status IN (pending,charged)**;`..._user_active_idx`(customer_user_id,created_at) 同;`..._rec_unique_idx` / `..._bank_txn_unique_idx`。`orders_customer_cart_session_idx`(customer_user_id,cart_session_id) **非唯一**。
- `begin_charge_attempt`:dedup LEFT JOIN attempt `a.status IN (pending,charged)`、ORDER BY `(o.payment_status='paid') DESC, (a.status='charged') DESC, o.created_at DESC`;user_in_flight EXISTS `status IN (pending,charged)` 且 order 未 paid;per-order INSERT `ON CONFLICT (order_id) WHERE status IN (pending,charged) DO NOTHING`。
- `mark_charge_attempt_charged`:`WHERE status='pending'` + FOR UPDATE;charged+同 rec → no-op、charged+異 rec → raise;跨單 rec 撞 rec_unique → raise。
- `mark_charge_attempt_failed`:`WHERE status='pending'`;failed→failed no-op;**charged→failed 永拒**;**目前無 order-paid 守衛**(本檔 §4 R1b2 補)。
- `get_active_charge_attempt`:`status IN (pending,charged)` ORDER BY created_at DESC LIMIT 1。
- sweeper RPC(payment_confirmer):`claim_stuck_unsettled_attempts` / `expire_stuck_attempts_at_ceiling` / `flag_non_unpaid_active_attempts` / `mark_attempt_settle_retry`(predicate 見線上、皆 status IN(p,c) + nmr/ceiling/unpaid 閘)。
- settleCharge record_status 分類(親讀 settle-charge.ts):`0/1 → paid_candidate` | `4 → auth_or_pending(hold)` | `-1/5 → explicit_failed` | `2/3 → refund_anomaly` | 其他 → `record_unverified`;**約束:settleCharge 不下 UI/cart 決策**。
- 🔴 **S2b `claim_order_poll_settle` 未上線**(migration 止於 `20260619120000`;`20260621120000` 未推);R1 db push 連帶推 S2b。
- 角色:`payment_confirmer`(rolbypassrls=false、非 LOGIN-super);`authenticated`/`anon`/`service_role`/`postgres`(rolbypassrls=true、非 super)。
- 三個真實 user(模擬 scaffold):`d6164add…`(主)/`3bac8bc3…`/`c2707561…`。

---

## §2 canonical 核心架構

### §2.1 根因
放棄舊 attempt 卡 active 集(`pending|charged`):既不能直接 `markFailed`(record_status=4 可能 late success;且 -1/5 也不可貿然當終局,見 §2.2),又擋住重刷(begin dedup/user_in_flight 撞它)。

### §2.2 新狀態 `released` + 生命週期(round5 #2 定稿)
新增 attempt 狀態 **`released`**:客人放棄該次付款、且 Record 確認當下 `auth_or_pending(4)` 時,由 **server-only CAS** 從 `pending` 轉入。語意 = 「客人放棄這次、退出『去重/in-flight 鎖』讓立即重刷;**真失敗未定**、留在『對帳集』+『per-order 唯一』直到 terminal」。

🔴 **`released` 遇到 Record `-1/5` 的完整 outcome(round5 #2 + round6 二,實作以此為準):**
```
ActiveChargeAttempt.status = 'released'
Record status ∈ {-1, 5}
  → settleCharge 呼 attempts.recordReleasedFailureObservation(attemptId, orderId, observedStatus)  〔三參數雙鍵〕
  → attempt 仍為 'released'(不轉 failed、不轉 no_attempt)
  → 分兩種回傳(皆 pending、皆不可 failed/no_attempt):
       RPC 成功                    → settleCharge 回 { kind:'pending', reason:'released_failure_observed' }
       RPC throw / 回應不合法        → settleCharge 回 { kind:'pending', reason:'record_unreachable' }
```
**failure observation = 首次觀察 write-once**:`failure_observed_at = COALESCE(existing, now())`、`failure_observed_status = COALESCE(existing, observed_status)`;**重放不得覆蓋首次時間或首次狀態**。
🔴 **兩種 pending outcome 都不得 failed/no_attempt;sweeper/inbox 對兩者皆 `markRetry`(continue retry)、`markProcessed` 不得被呼;stuck 走 `markSettleRetry`、不得計為 terminal**(§2.5/§5)。

🔴 **`released` 的 terminal 只有兩種(皆非 settleCharge 自動 markFailed):**
- **late success**:Record `0/1` → `markCharged(released→charged)` + 同交易寫 anomaly(§2.6)→ 雙扣明確化。
- **人工結案**:Sean 取得 TapPay 明確終局(未扣款)後,以 **owner-only `close_released_attempt`**(§4 R1c3)收尾 → `released→failed` + `released_closed_*`。

🔴 **active 集分類(每消費者精確;released 是否計入):**

| 消費者 | 集合 | released? | 理由 |
|---|---|---|---|
| per-order UNIQUE index(同單一筆鎖) | {pending,charged,released} | ✅ 含 | 守「同單一次一筆」硬不變式 |
| begin cart dedup / user_in_flight | {pending,charged} | ❌ 排除 | released 不被 dedup/in-flight → 重刷不撞不卡 |
| begin ON CONFLICT arbiter | {pending,charged}**(不改)** | — | 窄 implies 寬、inference 成功;同單已 released 再 begin → 優雅 order_locked(DB 模擬 R-IDX-2/3/4 證、**非硬 unique_violation**)。**廢除「begin predicate 必須同步含 released」結論。** |
| get_active_charge_attempt | {pending,charged,released} | ✅ 含 | late success 可對帳 |
| webhook active 閘 / S2b claim_order_poll_settle | {pending,charged,released} | ✅ 含 | late success 不 drop;🔴 **released 繞 manual/ceiling 閘、pending/charged 仍受 manual/ceiling**(§4 R1c2);unpaid+throttle 對所有狀態保留 |
| sweeper(claim/expire/flag/mark_retry) | released 專用 policy | 特殊 | §2.5 |
| mark_charge_attempt_charged | — | ✅ `released→charged` | late success 收斂(same-rec 冪等) |
| mark_charge_attempt_failed | — | ❌ **不含 released** | released 不自動 failed(僅 pending→failed,cancel 路徑;released 結案走 §4 R1c3) |

### §2.3 立即重刷流程(preflight own-only lookup + server-only release CAS)
🔴 **preflight 完整在 placeOrder 之前**(否則新單先建 = 孤兒):
```
客人放棄 → 原頁保留鎖定 → 點「重新付款」→ chargePaymentAction(server):
  ① siblingLookup(authenticated own-only, §3)find_active_sibling_own(cart_session_id) → discriminated union:
       {kind:'none'}   → proceed(③)
       {kind:'paid', existingOrderId, displayId}  → 顯既有單(零雙扣、不建新單、不 release)
       {kind:'active', existingOrderId, attemptId, displayId}:    🔴 不帶 recTradeId/bankTransactionId(資料最小化,round6 一)
         → settleCharge(existingOrderId):  🔴 rec/bank 由 payment_confirmer 的 get_active_charge_attempt 內部取得、絕不經 authenticated/browser
              paid                          → 顯既有單
              auth_or_pending(4)            → releaseSibling(server-only, §3)
                   mark_charge_attempt_released_for_user(attemptId, userId, cartSessionId):
                     rowcount=1(pending→released、寫 released_at once) → proceed(③ 建新單重刷)
                     🔴 rowcount=0(被 markCharged 搶先 / 他 tab 已處理) → 重 settleCharge → paid→顯既有 / pending|unverified→hold / 不建新單
              released_failure_observed     → hold「確認中、稍候」(§2.2;不放行、不建新單)
              unreachable/unverified        → hold「確認中、稍候」
  ③ placeOrder(新單)   [僅 proceed]
  ④ begin(新單) → 舊單已 released 退 cart dedup/user_in_flight → 佔鎖 → initiatePayment → 整頁 redirect(§6)
  🔴 post-placeOrder begin 仍回 needs_settle(preflight↔begin race 後備) → hold 不放行
      (誠實:此後備仍**可能**留單筆 no-attempt orphan〔fail-closed、非雙扣〕;hold 不誘導連續製造)
```

🔴 **整頁 redirect 下的二刷收斂(2026-06-27 pivot)**:塊A 改整頁後,客人「3D 頁上一頁 / 放棄 → 回站再刷」= **同分頁一次只一筆**(離開付款頁時舊 3D 即不在前景)→ 結構上消滅「兩視窗同時完成」主向量(= popup 模型真機實證雙扣 0072/0073 根因)。本 §2.3 server release + 放行狀態機**不變**(仍是客人愛的「馬上重刷」)。**殘餘**(整頁未消滅、靠兜底):① 客人已在 3D 完成但頁未返回又回站再刷(late-success 窗 → §2.4 / §7 偵測 + 手動退)② 客人自行**另開分頁**雙刷(in-flight localStorage 防呆 → §6.4 + §9 A3)。

### §2.4 為何 Q2「不問 TapPay」仍安全
release **只在 Record 確認 `auth_or_pending(4)`** 時 → 確認當下未實扣;其餘一律 hold。**不依賴「4 不晚扣」**:late success 由對帳集留 released 自動捕捉 markCharged→confirm(§2.6)→ 雙扣明確化 → §7 偵測 + 手動退。

### §2.5 sweeper released 專用 policy(round5 #1/#2)
release CAS 同交易重置:`settle_attempt_count=0`、`needs_manual_review=false`、`next_settle_at=now()+低頻`、寫 `released_at`(once)。
- released **持續低頻對帳**,sweeper claim **以 released 專用 predicate** 納入(不受 `needs_manual_review` / `settle_attempt_count<8` ceiling 擋)直到 terminal。**S2b `claim_order_poll_settle` 同款(§4 R1c2):released 繞 manual/ceiling、pending/charged 仍受閘、unpaid+throttle 對所有狀態保留**。
- `expire_stuck_attempts_at_ceiling` **不碰 released**;12h 後仍非 paid → 標 `released_manual_review_at`(獨立欄、**≠ 停止對帳**)+ 進人工 queue;**自動對帳不停**。
- 🔴 **released 讀 -1/5 → `released_failure_observed` / RPC 不可達 → `record_unreachable`(§2.2)**:settleCharge 回 `{kind:'pending', reason:…}` → **sweeper/inbox 對兩者皆 `markRetry`(continue retry)、`markProcessed` 不得被呼**;stuck attempt 走 `markSettleRetry`、**不得計為 terminal**。
- 誠實定性 = 「持續自動對帳 + 12h 後**加掛**人工兜底 + 唯 late-success(paid)或人工結案才停」非「轉純人工」非「自動 failed」。

### §2.6 late success 捕捉 + 雙扣明確化
released 留對帳集 → sweeper/webhook/callback/S2b → settleCharge(舊單)→ get_active(含 released)→ Record `0/1` → `markCharged(released→charged)`(同交易寫 anomaly,§4 R1b1c)→ confirm → 舊單 paid。🔴 此時舊單 paid + 重刷新單 paid = 雙扣明確化 → §7 強制偵測 + 退款候選報表(只列 open anomaly)。**無幽靈扣款**。

---

## §3 權限架構(round5 #6 + D4 + #7 稽核 + round8 一/二 資料層,明列 port/adapter + bundle 安全)
- 🔴 **資料層安全(round8 一/二,適用 anomaly 主表 + event 表 + 既有 charge_attempts 相關表)**:新建表 `payment_double_charge_anomalies` / `payment_double_charge_anomaly_events` 一律 **`ENABLE ROW LEVEL SECURITY`、Phase 1 zero-policy(無 policy = 非 owner/postgres 不得直接存取)**;`REVOKE ALL ON TABLE` 涵蓋 **PUBLIC / anon / authenticated / service_role / payment_confirmer**;**payment_confirmer 維持零 table/column 權限、只能透過指定 SECURITY DEFINER RPC 寫入**;W1 報表與退款操作走 **owner/postgres 受控流程、不開 service_role 直讀**;migration 含 **`has_table_privilege` / `information_schema.role_table_grants` fail-closed assert**。
- 🔴 **所有 SECURITY DEFINER RPC 硬化(round8 一)**:一律 **`SET search_path=''` + 全識別子 schema-qualified(`public.`…)**;EXECUTE 權限矩陣**同時驗 `has_function_privilege` 與負向角色實呼 `permission denied`**。涵蓋 `find_active_sibling_own` / `mark_charge_attempt_released_for_user` / `record_released_failure_observation` / anomaly claim·resolve / `close_released_attempt` / B1a `claim_expired_pending_attempts`。
- 🔴 **owner-only RPC 操作者稽核(round7 二)**:`claim_double_charge_anomaly_for_refund` / `resolve_double_charge_anomaly` / `close_released_attempt` 為 SECURITY DEFINER → **稽核欄(`refund_claimed_by`/`resolved_by`/`released_closed_by`/event `actor_session_role`)不得用 `current_user`(會記成 function owner)**;Phase 1 owner-only RPC 一律寫 **`session_user`**;文件說明此欄記錄 **DB session role**,未來正式 staff/admin 身分另做獨立 migration / actor 模型。
- **siblingLookup(唯讀、客人可呼)**:`ISiblingLookup` port + `SupabaseSiblingLookupAdapter`(authenticated client、own-only)。DB = `find_active_sibling_own(uuid)` authenticated SECDEF own-only,回 discriminated union(§4 R1a2);🔴 **資料最小化(round6 一):browser-callable 回傳不含 `recTradeId`/`bankTransactionId`**——settleCharge(existingOrderId)本就由 payment_confirmer 的 `get_active_charge_attempt` 內部取 rec/bank,無須把金流交易識別碼下放 authenticated/browser。
- **releaseSibling(改狀態、server-only)**:`IReleaseSibling` port + `PgReleaseSiblingAdapter`(**payment_confirmer client**)。DB = `mark_charge_attempt_released_for_user` server-only payment_confirmer。
- **failure observation(D4 定稿,round6 二:三參數雙鍵)**:**不另造 use-case port**;由既有 **`IChargeAttemptStore` 新增 `recordReleasedFailureObservation(attemptId, orderId, observedStatus)`**(三參數、order 雙鍵),`PgChargeAttemptAdapter` 實作 → DB 獨立窄權 RPC **`record_released_failure_observation(p_attempt_id, p_order_id, p_observed_status)`**(payment_confirmer only、§4 R1b3);settleCharge 透過既有 attempts dependency 呼叫。
- **manual close(D1 定稿)**:`close_released_attempt` **不 GRANT payment_confirmer**;**REVOKE PUBLIC/anon/authenticated/service_role/payment_confirmer**;**`SET search_path='' + schema-qualified`(round8 一)**;Phase 1 僅 function owner/postgres 由 Sean 受控人工流程執行(未來建正式 staff/admin 角色再獨立 migration 開權)。
- 🔴 **payment_confirmer client 絕不進 browser bundle**:server-only 模組(runtime=nodejs + 受控 eslint-disable + commit 前 grep client bundle,沿用 line-admin/ADR-0005 §8.4 護欄)。
- release/observation **不信 client 傳的 attempt/order/取消訊號**:歸屬由 DB CAS 四閘(`customer_user_id=p_user_id AND order.cart_session_id 一致 AND order.payment_status=unpaid AND status='pending'`)鎖死(子集合 DB 模擬 R-CAS-3..7 PASS)。

---

## §4 migration 規格(按 slice 組織;R1a1-a3 / R1b1a·R1b1b·R1b1c·R1b2·R1b3 / R1c1-c3)

**R1a1 — status / CHECK / 欄位 / index / 資料一致性 constraints(round6 二)**
1. CHECK:`status IN ('pending','charged','failed','released')`。
2. 新欄:`released_at timestamptz`(release CAS 首次寫、**不覆蓋**;12h+anomaly 用此)/`released_manual_review_at timestamptz`/`failure_observed_at timestamptz`/`failure_observed_status int`/`released_closed_at timestamptz`/`released_closed_by text`/`released_close_resolution text`。
3. per-order UNIQUE index 改 `WHERE status IN ('pending','charged','released')`;cart dedup/user_active 維持 `(pending,charged)`(begin ON CONFLICT 不改)。
4. 🔴 **資料一致性 CHECK constraints(round6 二)**:
   - `failure_observed_status IS NULL OR failure_observed_status IN (-1,5)`;
   - `failure_observed_at` 與 `failure_observed_status` **同時為 NULL 或同時非 NULL**(雙鍵成對);
   - `released_closed_at` / `released_closed_by` / `released_close_resolution` **整組 NULL 或整組非 NULL**;
   - `released_closed_at` 非 NULL 時 **`status` 必須是 `failed`**(close 終局與狀態一致)。

**R1a2 — find_active_sibling_own + ACL + 資料最小化 + tests(round5 #3 + round6 一)**
4. `find_active_sibling_own(p_cart_session_id)`(authenticated SECDEF、`search_path=''`、own-only `auth.uid()`):鏡像 begin 安全排序 `ORDER BY (o.payment_status='paid') DESC, (a.status='charged') DESC, o.created_at DESC`(LEFT JOIN active attempt;**paid order 即使無 active attempt 也必須被找到**)。回 **discriminated union**(🔴 round6 一:**移除 browser 回傳的 `recTradeId`/`bankTransactionId`**):
   - `{kind:'paid', existingOrderId, displayId}`(不強迫帶 attempt_id)
   - `{kind:'active', existingOrderId, attemptId, displayId}`(**不含 rec/bank**)
   - `{kind:'none'}`
   🔴 **ACL(round6 一,補 PUBLIC + payment_confirmer)**:
   ```sql
   REVOKE ALL ON FUNCTION public.find_active_sibling_own(uuid)
     FROM PUBLIC, anon, service_role, payment_confirmer;
   GRANT EXECUTE ON FUNCTION public.find_active_sibling_own(uuid)
     TO authenticated;
   ```
   🔴 **權限矩陣須驗(`has_function_privilege` + 實呼)**:authenticated=true / anon=false / service_role=false / payment_confirmer=false;**PUBLIC privilege 不得讓上述負向角色重新取得 EXECUTE**;🔴 **`SET ROLE anon` / `SET ROLE payment_confirmer` 實呼 → 預期 `permission denied`(無 EXECUTE、不得寫成模糊的「無資料」)**。保留 SECURITY DEFINER + `search_path=''` + own-only + paid-without-active + `paid>charged>pending>created_at DESC`。零價/PII。

**R1a3 — release RPC + ACL + CAS tests**
5. `mark_charge_attempt_released_for_user(p_attempt_id,p_user_id,p_cart_session_id)`(SECDEF、server-only **payment_confirmer**、`search_path=''`):CAS `UPDATE … SET status='released', released_at=COALESCE(released_at,now()), settle_attempt_count=0, needs_manual_review=false, released_manual_review_at=NULL, next_settle_at=now()+低頻 WHERE id=$1 AND customer_user_id=$2 AND order.cart_session_id=$3 AND order.payment_status='unpaid' AND status='pending'` → `{released: rowcount=1}`。REVOKE PUBLIC/anon/authenticated/service_role + `has_function_privilege` 矩陣 assert(僅 payment_confirmer)。

**R1b1a — anomaly 主表 + append-only event 表 + constraints + RLS/table ACL(round5 #6 + round6 四 + round7 二 + round8 一/二,L3🔴PRD 前置;本片只建表/約束/安全,RPC 在 R1b1b)**
6. 主表 `public.payment_double_charge_anomalies`:
   - 🔴 **鍵/型別(round7 二 + round8 一,逐欄定稿、不裸列)**:`id uuid PRIMARY KEY DEFAULT gen_random_uuid()`;`old_attempt_id uuid UNIQUE NOT NULL`(FK→`payment_charge_attempts.id`);`old_order_id uuid NOT NULL`(FK→`orders.id`);`user_id uuid NOT NULL`;`cart_session_id uuid NOT NULL`;`rec_trade_id text NOT NULL`;`refund_target_rec_trade_id text NOT NULL`;`released_at timestamptz NOT NULL`(取自 attempt 欄);`charged_at timestamptz NOT NULL`;🔴 **`amount integer NOT NULL CHECK (amount >= 0)`(取自 `orders.total` 整數快照、禁浮點)**;`status text NOT NULL DEFAULT 'open'`;`refund_claimed_at timestamptz` / `refund_claimed_by text` / `resolved_at timestamptz` / `resolved_by text` / `resolution_note text` / `refund_provider_reference text`;`created_at timestamptz NOT NULL DEFAULT now()`。
   - `status` CHECK **`open` | `refunding` | `refunded` | `dismissed`**;**`refunded`/`dismissed` = 不可逆終態**;**`refund_target_rec_trade_id` 建立後不可被 claim/resolve 修改**(固定為 `released→charged` 舊 attempt 的 rec、絕不指向新訂單)。
   - 🔴 **主表一致性 constraints(round8 二:reopen note 移 event 表後,主表 open 維持乾淨)**:`open`→`refund_claimed_at/by` + `resolved_at/by` + `resolution_note` + `refund_provider_reference` 皆 NULL;`refunding`→`refund_claimed_at/by` 非 NULL、`resolved_at/by` NULL;`refunded`→`refund_claimed_at/by` + `resolved_at/by` + `refund_target_rec_trade_id` 非 NULL,且 `refund_provider_reference` 非空;`dismissed`→`resolved_at/by/resolution_note` 非 NULL、`refund_provider_reference` NULL。
7. 🔴 **append-only 稽核 event 表 `public.payment_double_charge_anomaly_events`(round8 二)**:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`;`anomaly_id uuid NOT NULL`(FK→主表 `id`);`event_type text NOT NULL` CHECK allowlist **{`claim`,`refund_confirmed`,`refund_not_executed`,`refund_uncertain`,`reopened`,`dismissed`}**;`from_status text`;`to_status text`;`actor_session_role text NOT NULL`(寫 `session_user`、記 DB session role 非人類 staff ID);`note text NOT NULL`;`provider_reference text`;`created_at timestamptz NOT NULL DEFAULT now()`。
   - **append-only:不提供 UPDATE/DELETE RPC**;只允許 owner-run SECDEF RPC(R1b1b)在**同一交易** INSERT。
8. 🔴 **兩表 RLS/table ACL(round8 一)**:各 `ALTER TABLE … ENABLE ROW LEVEL SECURITY`(Phase 1 **zero-policy**);`REVOKE ALL ON TABLE` FROM **PUBLIC/anon/authenticated/service_role/payment_confirmer**;**payment_confirmer 維持零 table/column 權限**;migration 含 `has_table_privilege` / `information_schema.role_table_grants` **fail-closed assert**;W1 報表 + 退款走 owner/postgres、不開 service_role 直讀。
   - 🔴 **誠實定性(round7 二)**:`old_attempt_id` UNIQUE 只防重複 anomaly row;CAS 只能**序列化系統內**退款工作,**無法物理阻止 Sean 在 TapPay Dashboard 手動點兩次**。真正防呆 = **claim CAS + runbook + TapPay 狀態查證 + 不確定時 fail-closed 保持 refunding**;**不得寫成「CAS 完全防止 Dashboard 重複退款」**。

**R1b1b — anomaly claim/resolve/reopen RPC + append-only event 寫入 + ACL/CAS tests(round8 二,L3🔴PRD 前置)**
9. 🔴 **owner-only RPC(SECDEF、`SET search_path='' + schema-qualified`、REVOKE PUBLIC/anon/authenticated/service_role/payment_confirmer、owner/postgres only、負向角色實呼 `permission denied`;每個轉移皆同交易 INSERT event)**:
   - **A. `claim_double_charge_anomaly_for_refund(p_anomaly_id uuid)`**:**只允許 `open→refunding`**;CAS `WHERE status='open'`(平行/重複 claim 只一人成功);寫 `refund_claimed_at=now()`、`refund_claimed_by=session_user`;**同交易寫 `claim` event**。
   - **B. `resolve_double_charge_anomaly(p_anomaly_id uuid, p_resolution, p_note, p_provider_reference nullable)`**:
     - `refunding→refunded`(Dashboard 明確退款成功):`resolved_at=now()`/`resolved_by=session_user`/`resolution_note` 必填/`refund_provider_reference` 必填、保留 claimed;**寫 `refund_confirmed` event**。
     - `open→dismissed`(確認非雙扣):`resolved_at/by`+note 必填;**寫 `dismissed` event**。
     - `refunding→open`(**僅** TapPay 明確確認未退款/未執行):**清空主表 `refund_claimed_at`+`refund_claimed_by`+`refund_provider_reference`**(回乾淨 open)、**reopen note 與前次 claim 歷史保存在 event 表**(寫 `refund_not_executed` + `reopened` event);🔴 round8 二:**reopen 不抹除稽核歷史**。
     - 🔴 **退款結果不確定 / Dashboard 回應遺失**:**status 維持 `refunding`**、**寫 `refund_uncertain` event**、進人工查證、**不可 reopen、不可再 claim、不可再退款**;查明確定未退款才 reopen、查明確定已退款才 refunded。
     - **禁** `refunded→open/refunding`、`dismissed→退款`、`open→refunded`(不可直跳)、非法 resolution、覆蓋 `refund_target_rec_trade_id`。
   - 測試:lifecycle constraints + CAS 平行 claim(同一 anomaly 只一人成功)+ 非法轉移否決 + unknown 保持 refunding + reopen 清主表欄但 event 表留歷史 + event append-only + ACL 矩陣(負向 permission denied)。

**R1b1c — markCharged released→charged + 同交易建 anomaly(round7 三 + round8 二拆出)**
10. `mark_charge_attempt_charged` 改:`status IN ('pending','released')→charged`(same-rec 冪等;異 rec/跨單 rec 撞 → RAISE)。🔴 `v_row.status='released'` 時**同交易**寫主表 anomaly(`old_attempt_id` ON CONFLICT DO NOTHING、`status='open'`)。🔴 **所有 NOT NULL 欄須齊填(否則 INSERT RAISE → 漏記雙扣,§7 主訊號失效)**:`old_order_id=v_row.order_id` / `user_id=v_row.customer_user_id` / `cart_session_id`(取自 order)/ `rec_trade_id`+`refund_target_rec_trade_id`(取舊 attempt 的 rec)/ `released_at`(取自欄)/ `charged_at=now()` / `amount`(取 `orders.total` 整數)。

**R1b2 — markFailed order-paid guard(round5 #1/#2)**
11. `mark_charge_attempt_failed` 改:僅 `status='pending'`→failed(**移除 released→failed**)。🔴 **order-paid guard(fail-closed)**:同交易 `SELECT … FROM orders WHERE id=order FOR UPDATE`,`payment_status<>'unpaid'` → RAISE。charged→failed 永拒、failed→failed no-op(不變)。

**R1b3 — failure observation RPC(三參數雙鍵 + 輸入守衛,round6 二)+ get_active**
12. `record_released_failure_observation(p_attempt_id uuid, p_order_id uuid, p_observed_status integer)`(SECDEF、`search_path='' + schema-qualified`):
   - 🔴 **ACL**:`REVOKE ALL FROM PUBLIC, anon, authenticated, service_role;` `GRANT EXECUTE TO payment_confirmer;`;矩陣 = payment_confirmer=true、其餘全 false(`has_function_privilege` assert + 實呼)。
   - 🔴 **輸入守衛(fail-closed)**:`p_observed_status` 僅接受 **-1 或 5**,其他值 → RAISE;查 attempt:`id=p_attempt_id AND order_id=p_order_id AND status='released'`、且 `order.payment_status='unpaid'`;**找不到 / order 不符 / 非 released / 已付款 → 一律 RAISE fail-closed**(不靜默 no-op)。
   - 🔴 **write-once 雙鍵**:`SET failure_observed_at=COALESCE(failure_observed_at,now()), failure_observed_status=COALESCE(failure_observed_status,p_observed_status)`;**不改 status**;**重放不得覆蓋第一次觀察**(時間+狀態皆 COALESCE)。
13. `get_active_charge_attempt` 改:`status IN ('pending','charged','released')`。

**R1c1 — sweeper released policy**
14. sweeper(claim/expire/flag/mark_retry)納 released 專用 policy(§2.5):claim 繞 ceiling 含 released、expire 不碰 released、mark_retry 對 released 不誤標 needs_manual_review、達 12h 寫 released_manual_review_at;released_failure_observed → markSettleRetry(非 terminal)。

**R1c2 — S2b released predicate(round6 三:不只加 status)**
15. `claim_order_poll_settle`(R1 db push 連帶上線)。🔴 **僅把 status 改成含 released 不夠**:現行 predicate 還有 `needs_manual_review=false` + `settle_attempt_count<8` + throttle,只加 status 會讓 released 在 manual=true 或 count≥8 時被排除,與「released 持續對帳」矛盾。**canonical predicate 定稿**:
   ```sql
   (
     ( status IN ('pending','charged')
       AND needs_manual_review = false
       AND settle_attempt_count < 8 )       -- pending/charged 維持既有 manual/ceiling 閘
     OR status = 'released'                  -- released 繞 manual/ceiling
   )
   AND order.payment_status = 'unpaid'       -- 對所有狀態保留
   AND throttle window 已到期                 -- 對所有狀態保留
   ```
   🔴 **db push 前必補同款 BEGIN+ROLLBACK released-predicate 模擬**才放行(10 案見 §9 R1c2)。

**R1c3 — manual close RPC(round5 #7,D1/D2 定稿)**
16. `close_released_attempt(p_attempt_id, p_resolution)`(SECDEF、`search_path='' + schema-qualified`):**REVOKE PUBLIC/anon/authenticated/service_role/payment_confirmer**(owner/postgres only)。`released→failed`(**不新增 closed enum**)+ 寫 `released_closed_at/by/resolution`;order-paid guard fail-closed;**已 charged/paid 不得 close**;**重複 close 冪等**。
> 🔴 begin 主體**不改**。

---

## §5 use-case / action / 型別(round5 #2/#3 + D4)
- **SettleChargeOutcome**:新增 `{kind:'pending', reason:'released_failure_observed'}`;`normalizeReason` / DB allowlist 加 `released_failure_observed`;`record_unreachable`(既有 reason)續用於 RPC throw/不合法分支。
- **IChargeAttemptStore**:加 `recordReleasedFailureObservation(attemptId, orderId, observedStatus)`(🔴 round6 二:三參數雙鍵);`PgChargeAttemptAdapter` 實作(呼 `record_released_failure_observation(p_attempt_id,p_order_id,p_observed_status)`)。
- **settleCharge 分支**:`attempt.status==='released' && record∈{-1,5}` → try `recordReleasedFailureObservation(attemptId, orderId, observedStatus)`:成功 → 回 `{kind:'pending', reason:'released_failure_observed'}`;**throw/回應不合法 → 回 `{kind:'pending', reason:'record_unreachable'}`**;兩者皆不得 failed/no_attempt。
- **sweepSettlements 測試**:`released_failure_observed` **與** `record_unreachable` 兩 outcome → **`inbox.markRetry` 被呼、`markProcessed` 不得被呼**;stuck attempt 走 `markSettleRetry`、不計 terminal。
- **siblingLookup 型別**:`SiblingLookupResult` discriminated union(`paid`/`active`/`none`、§3/§4 R1a2);🔴 round6 一:`active` 不含 `recTradeId`/`bankTransactionId`;`preflightReleaseSibling` 對 active 分支改呼 `settleCharge(existingOrderId)`(內部由 payment_confirmer 取 rec/bank)。
- **ActiveChargeAttempt.status** 加 `'released'`;`PgChargeAttemptAdapter` parser、`database.types`、所有 switch/守衛同 slice 更新。
- **R2b use-case `preflightReleaseSibling`**(§2.3):siblingLookup → settleCharge → release CAS / hold / 顯既有;`chargePaymentAction` 於 **placeOrder 前**呼。
- **R3 charge-actions**:preflight 在 placeOrder 前;`adjudicateSettlement` pending 分支維持 hold;redirect outcome(§6.1)。

---

## §6 塊A 前端 — 整頁 redirect 3DS UX(2026-06-27 pivot;原「新分頁 popup」見附錄 B ㉗)

> 🔴 **pivot:TapPay 3DS = redirect-only(payment_url 只支援整視窗 top-level navigation、不支援 iframe / popup)→ 桌機 + 手機一律整頁 redirect**,復用既有 3DS-6b `CheckoutRedirecting`(`window.location.assign`)。**廢** popup 開啟 / `popup.opener=null` / 原頁 `CheckoutPendingThreeDS` 輪詢 / 三離開事件跨視窗同步 / BroadcastChannel。整頁 = 同分頁一次一筆 → 結構上消滅 popup 模型二刷主向量。

### §6.1 整頁 redirect 契約(pivot 取代「popup 契約」)
- charge-actions redirect outcome = **`{redirect:true, redirectUrl}`**(整頁不需 orderId/displayId;原頁離開、無原頁輪詢)。
- 🔴 **flag-on 3DS 啟動成功 → `CheckoutRedirecting` 於 `useEffect` 內 `window.location.assign(payment_url)` 整頁跳轉**(render 期不副作用);`payment_url` 含 token、**絕不 log / 不入 DOM 顯示原值**。
- 返回由 **callback 頁**(`/checkout/callback` + `PollOrderStatus`)處理;🔴 **只有確認 `paid` 才清購物車**(callback `ClearCartOnSuccess`);pending/failed 不清車、車留可回頭重結帳。
- 點擊送出 = **使用者手勢內直接整頁跳轉**;無 popup → 無「同步開窗」時序問題、無 popup blocker。

### §6.2 整頁返回 / 放棄分流(pivot 取代「三離開事件 + 跨視窗同步」)
整頁模型**無原頁 listener、無 popup、無 BroadcastChannel**;只有兩條路:
- **A. 在 TapPay 完成(成功 / 失敗 / 取消)**:TapPay 經 `frontend_redirect_url` 回我方 callback → callback `settleCharge`(Record API 唯一權威)→ paid / failed / pending 各自落地頁(§6.4)。
- **B. 在 TapPay 按上一頁 / 放棄 → 回到我方站(結帳頁或購物車)**:舊單 Record 可能停 PENDING(late-success 窗);**不主動宣稱 CANCEL、不主動呼 release**;下次結帳由 **preflight settle + release CAS**(§2.3)處理 = 客人愛的「馬上重刷」。同分頁離開付款頁時舊 3D 即不在前景 → 不可能與新一筆並存(消滅二刷主向量)。

### §6.3 TapPay 語意(round5 #5,釘死;pivot 後仍適用)
- 🔴 **`frontend_redirect_url` 才是「交易完成返回」**(成功/失敗落地頁、回我方 callback)。
- 🔴 **`go_back_url` 只是部分銀行 3DS Error 頁的返回連結,不得當成通用 cancel/close callback**。
- 桌機 + 手機**皆整頁 redirect**(無彈窗);**真機 + production build 實測**(dev bundle 手機 onClick 卡死前例 [[reference_pcm-mobile-device-verify-dev-vs-prod]])。

### §6.4 整頁落地頁 + #239 手動跳轉鈕(A2)
整頁是唯一路徑、行為自足:
- **去程**:`CheckoutRedirecting` auto `window.location.assign`;🔴 **#239 硬化(A2)**:加「未自動跳轉?點此繼續付款」手動連結 / 鈕(瀏覽器擋自動跳轉時不卡死);`payment_url` 只進 `href`、不 log / 不顯示原值。
- **回程**(callback 已有單號 → settle / own-only 查詢):
  - **paid** → 清車 + regenerate(換 cart key)+ 成功頁。
  - **failed** → **不清車**,顯示「回購物車 / 重新付款」CTA。
  - **pending** → **不清車**,持續有界輪詢 + 提供「回購物車」CTA。
- 回購物車後再次付款**仍經 preflight**;另開分頁雙刷殘餘 → in-flight localStorage 防呆(A3、§9)。
- 驗收涵蓋:桌機整頁 redirect、iOS / Android production build(無 popup blocked 情境)。

---

## §7 W1 — 雙扣偵測 + open anomaly 退款候選報表 + 退款 runbook(round5 #1/#3/#6 + round6 四 + round7 二)
- 主訊號 = `released→charged` 轉移**同交易**寫 anomaly(§4 R1b1c,`old_attempt_id` UNIQUE;`released_at` 取自欄;status='open';`refund_target_rec_trade_id` 取舊 attempt rec)。
- 退款候選查詢 = **只列 `status='open'`** 的 anomaly:「同 user 在 `released_at` 後 12h 內任何其他 paid order」(不限金額/品項/cart_session;相近金額/品項僅輔助標記)。**`refunding` 另列「處理中」、不得再次領取;`refunded`/`dismissed` 不列入**。
- 退款候選報表(W1 同交付):old/new display_id、`refund_target_rec_trade_id`、金額、released_at/charged_at、**退款目標規則(退 released→charged 的 old attempt 那筆、絕不退新單)**、SLA、責任人。
- 🔴 **誠實定性(round7 二)**:`old_attempt_id` UNIQUE 只防重複 anomaly row;**CAS 只能序列化系統內退款工作、無法物理阻止 Sean 在 Dashboard 手動點兩次**。防呆 = **claim CAS + 下列 runbook + TapPay 狀態查證 + 不確定時 fail-closed 保持 refunding**;**不得寫「CAS 完全防止 Dashboard 重複退款」**。
- 🔴 **人工退款 runbook 定稿(過渡,§0 Q1)**:
  1. 查 `open` anomaly。
  2. owner-only CAS claim:`open → refunding`(`claim_double_charge_anomaly_for_refund`、寫 `refund_claimed_by=session_user`)。
  3. **成功 claim 後**,才去 TapPay Dashboard 對 `refund_target_rec_trade_id` 退款。
  4. Dashboard **明確顯示退款成功** → `resolve_double_charge_anomaly`:`refunding → refunded`(填 `resolution_note` + `refund_provider_reference`/退款證據)。
  5. Dashboard **明確確認未退款/未執行** → `refunding → open`(清主表 `refund_claimed_at/by` + `refund_provider_reference`;**reopen note 寫入 event 表 `refund_not_executed` + `reopened` event、主表回乾淨 open 不留 note**,對齊 §4 R1b1b)。
  6. 🔴 **退款結果不確定 / Dashboard 回應遺失** → **維持 `refunding`、寫 `refund_uncertain` event、進人工查證、不得再 claim、不得重新退款**;查明未退才 reopen、查明已退才 refunded。
  7. `dismissed` 僅用於確認**不是**雙扣。
  - 自動退款(Refund API)= 上線前 backlog。

## §8 12h 孤兒收尾(放棄但沒重刷)= §9 第 19/20 片 B1a+B1b(round6 五納入 + round7 一/三 + round8 三)
🔴 **canonical 定稿(根因:pending 孤兒經現行 sweeper 重試 8x 後變 `needs_manual_review=true` 並退出一般掃描)**:B1 是受 `age + unpaid + 獨立 throttle` 限制的**「專用人工列再確認路徑」;可涵蓋 `manual=true`,但不清除 manual flag**。(舊「不繞 needs_manual_review」措辭已廢、僅存附錄 B ⑪。)
- 進入條件:`attempt.status='pending'` AND `order.payment_status='unpaid'` AND `attempt.created_at < now()-12h` AND `needs_manual_review` **true 或 false 都可進入**。
- 自有 `last_expired_settle_at` **durable throttle**(防熱迴圈);**可略過一般 sweeper 的 `needs_manual_review` 排除條件**;但 **B1 不得清除 `needs_manual_review`**。
- 再查 Record:`-1/5`→ **markFailed(過 order-paid guard)收斂為 failed**;`4`/`unreachable`/`unverified`→ **維持 pending**(未收斂時 manual 保持 true;原本 false 可標 true 進人工 queue)。
- 🔴 **不得因 B1 查詢失敗而判 failed**;**order 已 paid 不處理**;**B1 不處理 `released`**(released 走自己的持續對帳 policy §2.5)。
- 模擬至少 10 案:①pending+unpaid+age≥12h+manual=T+Record 5→failed ②同 manual=F+Record 5→failed ③manual=T+Record 4→維持 pending+manual ④manual=F+Record 4→維持 pending 並進 manual ⑤Record unreachable→維持 pending ⑥order paid→不處理 ⑦age<12h→不處理 ⑧released→不進 B1 ⑨throttle 未到→不處理 ⑩throttle 到期→可重新確認。
- 🔴 **B1a server-only claim RPC `claim_expired_pending_attempts(p_limit integer)`(round8 三定稿)**:SECURITY DEFINER + `SET search_path='' + schema-qualified`;**payment_confirmer-only**(`REVOKE PUBLIC/anon/authenticated/service_role`、`GRANT EXECUTE` 僅 payment_confirmer;payment_confirmer 維持零 table/column 權限;`has_function_privilege` 矩陣 + 負向角色實呼 `permission denied`);**原子 claim 用 row lock `FOR UPDATE SKIP LOCKED`**、claim 時**同交易寫 `last_expired_settle_at=now()`**;守 `status='pending'` AND `order unpaid` AND `age≥12h` AND `throttle 到期` AND `released 不可進` AND `paid 不可進`;**manual=true/false 都可進、不清 `needs_manual_review`**;**`p_limit` 有安全上下界**;查 Record 失敗仍不得 markFailed。
- 🔴 **並發測試**:真雙連線/平行 claim → **同一 attempt 同一輪只能被一個 worker claim**(`FOR UPDATE SKIP LOCKED`)。
- 拆 **B1a(claim/throttle migration + claim RPC)+ B1b(adapter/use-case/tests)**(§9)。

---

## §9 slice 拆分(round5 #8 + round6 五 + round7 三 + round8 二/三;**20 片**;每片 15–45 分鐘可獨立驗)

> 內容分級:UX 文案 = **L2**(hardcode + TODO/backlog);anomaly / 退款候選資料 = **L3**(必 DB-backed);純技術狀態機標記 = **不適用(N/A)**。每片 rollback:migration forward-only 逆序手動 / code revert 即回。
>
> 🔴 **codex 觸發(round6 五修正)**:命中鐵則 12(payment/雙扣/migration/RLS/GRANT)→ K2 必跑;**A1/A2/A3 三片皆改 payment redirect/callback/購物車清理/retry/整頁 redirect security → 全部 codex K2 必跑 + `security_review_required` + `code_review_required`,不得標「例行跳」**。
>
> 🔴 **L3 PRD gate(round6 五 + round7 四 + round8 二,鐵則 9)**:`R1b1a`/`R1b1b`/`R1b1c`(anomaly/退款 lifecycle + event 表)+ `W1`(退款候選/runbook)被標 L3 → **開工前必須先有 dedicated PRD 且過 `prd_review`;PRD 未完成不得實作 R1b1a/R1b1b/R1b1c/W1**。R1a1–a3 可先做、到 **R1b1a 前必須停**。**本輪不建立此 PRD(非第四個檔案)、只在此記錄為前置**;**不得用「canonical plan 本身等同 PRD」繞過**。此 gate 同時列入 §14 唯一執行順序。
>
> 🔴 **前端片(A1/A2/A3)共同要求(round6 五)**:開工前 **grep `design-reference` 字面**;**若 design-reference 無此付款狀態畫面 → 記錄 business override / open drift、等 Sean 批准,不得憑想像設計**;Manifest Impact;**TSX/CSS 同 slice**;smoke test;三綠(typecheck + lint + build);肉眼驗收涵蓋**桌機整頁 redirect / iOS / Android production build**。

| slice | 內容 | 檔案範圍 | migration | 估時 | 驗收(y/n) | 對應模擬/測試 | codex | 分級 |
|---|---|---|---|---|---|---|---|---|
| R1a1 | status/CHECK/7 新欄/per-order index 含 released | 1 migration | ✅ | 20m | enum/欄/index 在線上 catalog 比對為新值 | DDL MCP 模擬 | K2 | N/A |
| R1a2 | find_active_sibling_own + ACL(PUBLIC+payment_confirmer revoke)+ 資料最小化(去 rec/bank)+ discriminated union | 1 migration | ✅ | 30m | paid-without-active/paid>charged>pending/最新/他人不可見;ACL 矩陣 auth=T·anon/svc/pc=F·PUBLIC 不回授;active 回傳無 rec/bank | BEGIN+ROLLBACK:6 union 案 + ACL 矩陣(SET ROLE anon/payment_confirmer 實呼=permission denied) | K2 | N/A |
| R1a3 | release RPC + ACL + CAS | 1 migration | ✅ | 30m | 歸屬否決四路 rowcount=0、正確可 release、released_at write-once | 模擬 R-CAS-1..7 + write-once | K2 | N/A |
| R1b1a | anomaly 主表(id PK/逐欄型別/amount int CHECK≥0)+ append-only event 表 + 4 態+一致性 constraints + 兩表 RLS zero-policy/table ACL(REVOKE 5 角色含 payment_confirmer)+ has_table_privilege assert | 1 migration | ✅ | 30–45m | 兩表存在/逐欄型別 NOT NULL/FK/UNIQUE;amount int≥0 取 orders.total;RLS enabled+zero-policy;table ACL 5 角色皆無;event_type CHECK allowlist;payment_confirmer 零 table 權限 | 模擬 table ACL/RLS 矩陣 + constraints + has_table_privilege fail-closed | K2 | **L3🔴PRD 前置** |
| R1b1b | anomaly claim/resolve/reopen owner-only RPC + append-only event 同交易寫入 + ACL/CAS tests | 1 migration | ✅ | 30–45m | claim CAS open→refunding 平行只一人;refunded/dismissed 不可逆;refunding unknown→保持 refunding 寫 refund_uncertain event(不 reopen);reopen 清主表 claimed/provider 但 event 留歷史;非法轉移否決;refund_target 不可改;負向角色實呼=permission denied;session_user;event 無 UPDATE/DELETE RPC | 模擬 CAS 平行 claim + 非法轉移 + unknown fail-closed + reopen 清主表/event 留痕 + append-only + ACL 矩陣 | K2 | **L3🔴PRD 前置** |
| R1b1c | markCharged released→charged + 同交易建 open anomaly(amount 取 orders.total) | 1 migration | ✅ | 25–40m | released→charged 成立;same-rec no-op;跨單 rec unique 保護;同交易建 open anomaly、amount=orders.total、refund_target=舊 attempt rec;ON CONFLICT old_attempt_id 冪等 | 模擬 RACE-B/B2 + anomaly 冪等 | K2 | **L3🔴PRD 前置** |
| R1b2 | markFailed order-paid guard | 1 migration | ✅ | 20m | paid→RAISE(fail-closed)/unpaid pending→failed 成功/charged→拒 | 模擬 paid-guard + unpaid-pending | K2 | N/A |
| R1b3 | record_released_failure_observation RPC(三參數雙鍵+輸入守衛+ACL)+ get_active 含 released | 1 migration | ✅ | 30m | 僅 -1/5、其他 RAISE;雙鍵 order 不符/非 released/已付款 fail-closed;ACL 僅 payment_confirmer;write-once 重放冪等;get_active 回 released | 模擬 input-guard + dual-key fail-closed + ACL 矩陣 + write-once/replay | K2 | N/A |
| R1c1 | sweeper released claim/expire/flag/markRetry policy | 1 migration | ✅ | 35m | released 繞 ceiling 被 claim、多輪、rmra 不停掃、observed→markSettleRetry | 模擬 SWEEP-1..7 + observed retry | K2 | N/A |
| R1c2 | S2b claim_order_poll_settle released predicate(繞 manual/ceiling) | 1 migration | ✅ | 25m | released 繞 manual/ceiling、pending/charged 仍受閘、unpaid+throttle 全狀態保留 | **db push 前補模擬 10 案**:①pending+manual=F+count<8→可 ②pending+manual=T→不可 ③pending+count≥8→不可 ④released+manual=F+count<8→可 ⑤released+manual=T→仍可 ⑥released+count≥8→仍可 ⑦released+manual=T+count≥8→仍可 ⑧released+order paid→不可 ⑨released+throttle未到→不可 ⑩released+throttle到期→可 | K2 | N/A |
| R1c3 | close_released_attempt 人工結案 RPC(owner-only) | 1 migration | ✅ | 25m | REVOKE 全角色(含 payment_confirmer)、released→failed+closed_*、charged/paid 不可 close、冪等 | 模擬 ACL 矩陣 + close 冪等 | K2 | N/A |
| R2a | domain types/ports/parsers/adapter(SiblingLookupResult〔active 去 rec/bank〕/SettleChargeOutcome reason〔+released_failure_observed,複用 record_unreachable〕/IChargeAttemptStore.recordReleasedFailureObservation 三參數/parser/database.types) | use-cases+adapters+types | ✗ | 40m | typecheck 綠、switch 全分支、parser 對 released、union active 無 rec/bank | 單元測試 | K2 | N/A |
| R2b | preflightReleaseSibling use-case | 1 use-case + test | ✗ | 40m | §2.3 序:none/paid/active→settle(內部取 rec/bank)→release/hold;released_failure_observed 與 record_unreachable 皆 hold | 單元測試覆蓋 union 全分支 + 兩 pending reason | K2 | N/A |
| R3 | charge-actions preflight 接線(placeOrder 前)+ adjudicate hold + redirect outcome | charge-actions + test | ✗ | 40m | preflight 在 placeOrder 前、post-begin needs_settle hold、outcome 含 4 欄 | 單元測試 | K2 | N/A |
| W1 | open anomaly 報表 + 7 步 manual refund runbook(claim→退→resolve/event) | report + docs | ✗ | 35m | 報表只列 open、refunding 另列「處理中」不可再領、退款目標=舊 rec 規則正確、每個狀態操作/退款結果均透過受控 RPC 寫入對應 event(查詢 open / 人工前往 Dashboard 本身不寫 event) | 單元測試 + 固定 SQL | K2 | **L3🔴PRD 前置** |
| A1(整頁化) | flag-on 走 `CheckoutRedirecting` 整頁跳轉、redirect outcome `{redirect,redirectUrl}`、只 paid 清車(callback) | 前端元件(grep design+TSX/CSS) | ✗ | 已落地 | flag-on 整頁跳 TapPay、callback 接返回、只 paid 清車;桌機整頁/iOS/Android production 肉眼驗 | smoke test + 三綠 + 真機 | **K2 + security + code review** | L2(文案) |
| A2(#239) | 整頁 fallback 硬化:`CheckoutRedirecting` 手動跳轉鈕 + callback paid/failed/pending CTA | 前端 + callback(grep design+TSX/CSS) | ✗ | 30m | 未自動跳轉時手動鈕可達、callback 三態各足 CTA、payment_url 不入 log/DOM;桌機整頁/iOS/Android production 肉眼驗 | smoke test + 三綠 + 真機 | **K2 + security + code review** | L2(文案) |
| A3(防呆) | 再結帳防呆:in-flight localStorage 記號 + 結帳前檢查 | 前端(grep design+TSX/CSS) | ✗ | 40m | 結帳前偵測「付款進行中」提示、擋另開分頁雙刷、回站再刷正常(同分頁向量整頁已消滅)、記號生命週期 fail-safe | smoke test + 三綠 + 真機 | **K2 + security + code review** | L2(文案) |
| B1a | 12h claim/throttle migration + `claim_expired_pending_attempts` server-only RPC | 1 migration | ✅ | 25–40m | last_expired_settle_at;RPC SECDEF+search_path=''+schema-qualified+payment_confirmer-only(負向 permission denied);FOR UPDATE SKIP LOCKED 原子 claim、同交易寫 last_expired_settle_at;manual=T/F 都能進不清 flag;p_limit 安全上下界;order unpaid+status pending+age+throttle guards;released/paid/未到期否決;查 Record 失敗不 markFailed | §8 10 案 BEGIN+ROLLBACK 模擬 + ACL 矩陣 + 真雙連線平行 claim(同 attempt 只一 worker) | K2 | N/A |
| B1b | B1 adapter/use-case/tests | adapter/port + use-case + test | ✗ | 30–45m | 12h Record 再確認 use-case:-1/5→guarded markFailed、4/unreachable/unverified→維持 pending/manual;throttle outcome;查詢失敗不判 failed | 單元測試 + 三綠 | K2 | N/A |

> 🔴 **兩次 db push(round8 四,Sean 終端跑、驗證 gate 見 §14)**:**第一次 = R1 migration bundle**(R1a1–R1c3,含 R1b1a/R1b1b/R1b1c)**連帶 S2b=live**(含 S2b released predicate 模擬);**第二次 = B1a migration**。每次 push 後驗 list_migrations / catalog / CHECK / index / 函式簽名 / table ACL / function ACL / RLS,任一失敗立即停。

---

## §10 攻擊時序自審(鐵則 10)
1. preflight settleCharge=4 → release CAS vs late success markCharged:`WHERE status='pending'` 序化 + FOR UPDATE → 子集合模擬 R-RACE-A/B PASS;**真並發(雙連線)留執行 session 雙 psql 補驗**。
2. release 後 begin 重刷:released 退 dedup/user_in_flight → 佔鎖;舊單留 per-order index(含 released)+ 對帳集。R-IDX-2/3/4 PASS。
3. released + Record -1/5:`released_failure_observed`(不轉 failed、續掃)→ 杜絕「TapPay 其實已扣但被提早 failed 退出對帳=幽靈」(**待 R1b3 模擬**)。
4. markFailed + order-paid guard:paid 時一律 RAISE → 杜絕「已付款單被標 failed」(**待 R1b2 模擬**)。
5. 歸屬:release CAS 四閘 → 錯 user/cart/已 paid/非 pending 全 rowcount=0(子集合 R-CAS-3..7 PASS)。
6. find_sibling discriminated union:paid 優先(即使無 active)→ 杜絕「paid 單漏找誤建新單雙扣」(**待 R1a2 模擬**);🔴 sibling 回傳去 rec/bank → 杜絕「金流交易識別碼下放 browser」(**待 R1a2 ACL/最小化模擬**)。
7. S2b released predicate(round6 三):released 在 `needs_manual_review=true` / `settle_attempt_count≥8` 時**仍被 claim 對帳**(只繞這兩閘、不繞 unpaid/throttle)→ 杜絕「released 被 ceiling/manual 提早停掃 = 漏接 late-success 變幽靈」(**待 R1c2 10 案模擬**)。
8. anomaly 重複人工退款(round6 四 + round7 二 + round8 二):`old_attempt_id` UNIQUE **只防重複 anomaly row、不防 Sean 在 Dashboard 重複退款** → 靠 `claim_double_charge_anomaly_for_refund`(open→refunding CAS、owner-only、平行只一人)+ runbook「先 claim 才退」+ **不確定時 fail-closed 保持 refunding(寫 `refund_uncertain` event、絕不誤 reopen 重退)** + **append-only event 表保存稽核(reopen 不抹歷史)** + **兩表 RLS/table ACL(payment_confirmer 零 table 權限)**(**待 R1b1a 表/RLS + R1b1b CAS 平行 claim + unknown fail-closed + reopen 清主表/event 留痕模擬**)。
9. B1 12h 孤兒(round7 一):pending 孤兒 8x 後變 `manual=true` 退出一般掃描 → B1 專用路徑**可涵蓋 manual=true 但不清 flag**、查詢失敗不判 failed、released/paid/未到期否決 → 杜絕「孤兒永遠卡 manual queue 無人再確認」與「B1 誤殺已付款/查不到的單」(**待 B1a 10 案模擬**)。
10. gemini 三陷阱:① 購物車變更 → 每單獨立金額快照、settleCharge 用 attempt.orderTotal ② Race 雙發貨 → confirm FOR UPDATE per-order ③ 12h 假訊號 → 狀態機單向、已 paid 不回滾。
11. **殘餘(不得 Claude 自宣接受)**:§7 雙扣窗(Sean accept + 偵測必做 + 手動退);真並發雙連線實證(執行 session 補);自動退款未做;released 人工兜底;**Dashboard 物理重複退款無法被 DB 完全阻止(靠 runbook + fail-closed)**。

## §11 風險 / rollback / 殘餘
- rollback:塊A revert 即回;R migration forward-only(逆序手動);preflight/adjudicate revert 回 hold。
- 殘餘(Sean accept):立即重刷雙扣窗(§7 偵測 + 手動退);自動退款未做;released 人工兜底(12h queue + owner-only close)。
- 🔴 **Claude 守線**:真錢 slice → codex K2 PASS + 對應 DB 模擬/測試 PASS 才 commit;未達 → 停 raise Sean。

## §12 DB 模擬狀態(誠實,round5 #1 + round6 六)
> 🔴 **不得寫成「canonical R1 已通過 DB 模擬」**;以下僅 pre-round4「未變子集合」PASS,canonical 新契約逐片補證。
- ✅ **pre-round4 R1 SQL harness 的「未變子集合」35/35 PASS**(零留痕 ×3;harness scratchpad `sim_r1_cas.sql`/`sim_r1_cas_v2.sql`)。**已證(canonical 仍適用)**:① release/markCharged CAS 競態 ② server-only ACL 與歸屬否決 ③ 索引 inference(begin 不改)④ **原版** released sweeper policy ⑤ anomaly ON CONFLICT 冪等。
- 🔴 **canonical 尚未驗證清單(單一、去層疊;round4–round8 合併,須在對應 slice commit 前各自補)**:
  1. released + Record -1/5 → 維持 released、`released_failure_observed`;RPC throw/不合法 → `record_unreachable`;**兩者皆 pending、皆不得 failed/no_attempt**(R1b3/R2)。
  2. failure observation **三參數雙鍵 + 輸入守衛**(僅 -1/5、order 不符/非 released/已付款 fail-closed)+ write-once 重放冪等(R1b3)。
  3. sweeper/inbox 對上述 pending outcome **markRetry、不得 markProcessed**;stuck → markSettleRetry 非 terminal(R1c1/R2)。
  4. markFailed **order-paid guard**:paid fail-closed、unpaid pending 正常成功(R1b2)。
  5. `find_active_sibling_own` **ACL/PUBLIC revoke 矩陣**(auth=T、anon/svc/payment_confirmer=F、PUBLIC 不回授、負向實呼 permission denied)+ 資料最小化(去 rec/bank)(R1a2)。
  6. **S2b released 繞 manual/ceiling 10 案**(pending/charged 受閘、released 繞、unpaid+throttle 全保留)(R1c2、db push 前)。
  7. **anomaly 主表 + append-only event 表 RLS/table ACL**(兩表 RLS zero-policy、REVOKE 5 角色含 payment_confirmer、has_table_privilege fail-closed assert)(R1b1a)。
  8. **anomaly `id` PK + 逐欄型別/NOT NULL/FK + `amount integer CHECK≥0`(取 orders.total、禁浮點)**(R1b1a)。
  9. **anomaly claim/resolve/reopen CAS lifecycle**:open→refunding 平行只一人成功、非法轉移否決、**refunding→open 僅明確未退款且清主表 claimed/provider 並寫 event**、**退款未知 → 維持 refunding 寫 `refund_uncertain` event(不 reopen/不再 claim/不再退)**、refunded/dismissed 不可逆(R1b1b)。
  10. **event 表 append-only**(無 UPDATE/DELETE RPC、每轉移同交易寫 event、reopen 不抹稽核歷史)(R1b1a/R1b1b)。
  11. **owner-only RPC 以 `session_user` 寫稽核欄**(非 current_user/owner;含 event `actor_session_role`)+ 所有 SECDEF RPC `search_path='' + schema-qualified` + `has_function_privilege` 矩陣 + 負向 permission denied(R1a2/R1a3/R1b1b/R1b3/R1c3/B1a)。
  12. markCharged released→charged + 同交易建 open anomaly(amount 取 orders.total、ON CONFLICT 冪等)(R1b1c)。
  13. manual close RPC(owner-only、released→failed+closed_*、charged/paid 不可 close、冪等)(R1c3)。
  14. **B1 專用人工列再確認路徑**:manual=true/false 都進、**不清 `needs_manual_review`**、-1/5→guarded markFailed、4/unreachable→維持、查詢失敗不判 failed、released/paid/未到期否決;**B1a `claim_expired_pending_attempts` SECDEF payment_confirmer-only + `FOR UPDATE SKIP LOCKED` 原子 claim + 同交易寫 last_expired_settle_at + p_limit 安全界 + 真雙連線平行 claim(同 attempt 只一 worker)**(B1a/B1b)。
  15. **R1b1a/R1b1b/R1b1c、B1a/B1b 分片各自 15–45 分可獨立驗**(§9)。
  16. **兩次 db push 驗證 gate**(migration version / catalog / table+function ACL / RLS / S2b 模擬 / B1 claim 並發)(§14)。
  17. **rollout gate(round9 補 Git/部署鏈)**:開 worktree 前 dev clean+雙向同步;20 片各自 checkpoint;兩次 db push + 線上 ACL/RLS 驗證;ROLE=A 整體 Codex 複審 → Sean 合併回 dev → Sean push dev → Sean dev→main → production deploy(flag=false)→ 部署 SHA 與批准版本一致 + flag=false smoke;**全完成 + Sean 拍板才開 production `TAPPAY_3DS_ENABLED`、開後監控 + 先關 flag rollback**(§14)。
  18. 真雙連線並發(release CAS、anomaly claim、B1 claim)(執行 session 雙 psql)。
- 🔴 **原 harness 仍含已作廢的 `released→failed`(R-FAIL-1)測項**:該測驗的是**已作廢契約**,**不得作為 canonical R1b 放行證據**。
- **未證**:前端整頁 redirect/TapPay/callback 流程(A1-A3 smoke + 真機)。

## §13 unresolved decisions(round10 後仍僅 2,皆不阻擋 R1a1 開工)
- **D3(Sean 最終拍)**:塊A 三事件 + fallback 的 **UX 文案字面**(L2;狀態轉移/清車規則/fallback 行為已在 §6 定稿、**不待**)。
- **未來**:是否在取得 **TapPay 官方終局契約**後另做「自動 close released」(Phase 1 不做、僅人工;屆時獨立 migration、**不留 schema 二選一**)。

---

## §14 唯一執行順序(45 步)+ Git 同步鏈 + 兩次 db push + merge/push/deploy/flag 鏈 + rollout gate(round5 #9 + round6 五/七 + round7 四 + round8 四 + round9 一/二/consider + round10 一)
> 🔴 **唯一順序(廢除前版「docs commit → 直接開 worktree」與「30 步」;改 45 步,含開工前 Git 雙向同步守線 + 收尾 merge/push/main/deploy/flag 鏈)。** plan/handoff/packet 皆 untracked、STATUS 未更新 → Codex PASS 後**不可直接開 fresh worktree**(docs commit 後 dev 將 ≥ ahead origin/dev 4、不能宣稱 up-to-date)。**20 片各自獨立步(R1b1a/R1b1b/R1b1c 不得壓成一步)、各遵守 15–45 分 + STATUS + 三綠 + K2 + code-reviewer + 精準 add + 獨立 commit + 不 push。** 正確序(共 45 步):
1. **本輪 Codex 複審 PASS**。
2. **current dev session** 更新 `STATUS.md` 七欄(指向本 canonical plan + R1a1)。
3. 精準 `git add` canonical plan + handoff + packet + STATUS(**禁 `git add .`/`-A`**)。
4. 建 **docs-only commit**(type=docs);**Claude Code 不 push**。
5. 🔴 **【Sean 操作】手動 push 已批准的全部 dev commits**(含既有 3 個 ahead commits + 本次 docs commit)。
6. 🔴 **push 後重新驗證起手綠**:`branch=dev`;`git status` clean;`git rev-list --count origin/dev..HEAD = 0`;`git rev-list --count HEAD..origin/dev = 0`;HEAD 與 STATUS 記載一致。**任一不綠 → 停止、回報 Sean、不建 worktree、不自行修復。**(Sean 臨時不 push = 停止開工,**不是**自動繞過 up-to-date 守線。)
7. 全綠後依寫審分離流程建 fresh **ROLE=A worktree/session**,**自行再跑一次 AGENTS.md 起手檢查 + 完整文件套件讀取**;全綠才開 R1a1。
8. R1a1。
9. R1a2。
10. R1a3。
11. 🔴 **停止 implementation,建立 anomaly/refund dedicated PRD**。
12. PRD 通過 `prd_review`(canonical plan **不等同** PRD)。
13. R1b1a。
14. R1b1b。
15. R1b1c。
16. R1b2。
17. R1b3。
18. R1c1。
19. R1c2。
20. R1c3。
21. 🔴 **【Sean 操作】執行第一次 R1 migration bundle db push**(R1a1–R1c3,含 R1b1a/b/c **連帶 S2b=live**)。
22. 🔴 **第一次 db push 驗證 gate(任一失敗立即停、不進 R2)**:`list_migrations` 版本存在;catalog / CHECK / index / 函式簽名正確;**table ACL、function ACL、RLS 正確**;**S2b released predicate 模擬 PASS**。
23. R2a。
24. R2b。
25. R3。
26. W1。
27. A1(整頁化:flag-on 走 `CheckoutRedirecting` 整頁跳轉、redirect outcome `{redirect,redirectUrl}`、只 paid 清車於 callback;**2026-06-27 `reset --hard 26bc93f` 已落地** = 復用 3DS-6b、無 popup)。
28. A2(#239 整頁 fallback 硬化:`CheckoutRedirecting`「未自動跳轉請點此」手動鈕 + callback paid/failed/pending CTA 各自足)。
29. A3(再結帳防呆:in-flight localStorage 記號、結帳前檢查「付款進行中」、擋另開分頁雙刷;同分頁向量整頁已消滅)。
30. B1a。
31. 🔴 **【Sean 操作】執行第二次 B1a migration db push**。
32. 🔴 **第二次 db push 驗證 gate**:B1 claim RPC、ACL、throttle、平行 claim 驗證 PASS;失敗停止。
33. B1b。
34. **累積整合驗證 + 更新 STATUS／roadmap + 產出整體最終 Codex Review Packet(尚不 commit)**:完整三綠、全測試、真雙連線模擬、K2、security review、code-reviewer、前端真機結果全部齊備;更新 `STATUS.md` 七欄與 roadmap;產出**整體最終 Codex Review Packet**;**此步尚不 commit**。
35. **整體最終 Codex Review Packet 通過 commit 前 / merge 前唯讀複審(PASS)**;FAIL 則回 step 34 修正、**不得先 commit**。
36. 執行 `busboy-end`,完成最終 commit;**不 push**(此步在 Codex 複審 PASS 之後才 commit,符合 commit 前審查鐵則)。
37. Codex PASS 後,**由 Sean 依寫審分離流程把 ROLE=A 成果合併回 dev**;Claude **不可自行假設 merge 授權**。
38. 在 dev 重跑 branch/status/log、完整三綠、測試、HEAD/STATUS 對齊及累積 diff 驗證;失敗停止。
39. 🔴 **【Sean 操作】手動 push dev**。
40. 🔴 **【Sean 操作】依 production 流程手動將 dev 合併至 `main`**。
41. 🔴 **部署 production,但 `TAPPAY_3DS_ENABLED` 必須維持 `false`**。
42. 🔴 **驗證 production 實際部署 commit SHA、migration versions、catalog、ACL、RLS、payment routes、`flag=false` smoke test**;任一失敗停止。
43. **production readiness review**,確認所有 rollout gate 證據齊備(含實際部署 SHA 與批准版本一致,**非只檢查「有 commit」**)。
44. 🔴 **【Sean 拍板】才可把 production `TAPPAY_3DS_ENABLED` 設為 `true`**。
45. 開啟後執行 production smoke / 監控;**發現付款 / 雙扣 / callback / sweeper / anomaly 異常 → 第一動作把 flag 關回 `false`**,再依 rollback/runbook 處理。

🔴 **rollout gate(開 production `TAPPAY_3DS_ENABLED`=true 前必須全完成,缺一不可)**:
- 🔴 **開 fresh worktree 前**:dev 已 clean 且與 origin/dev **雙向同步**(`origin/dev..HEAD = 0` 且 `HEAD..origin/dev = 0`)。
- **20 個 slice 各自完成 checkpoint**(三綠 + K2 + code-reviewer + 獨立 commit)。
- **兩次 db push 均成功**;**線上 migration version / catalog / table+function ACL / RLS 驗證成功**。
- **R1/R2/R3 全完成**;**anomaly lifecycle、append-only event、unknown fail-closed、W1 報表 + 7 步 runbook、A1/A2/A3 真機(桌機整頁/iOS/Android production)、B1 全部符合既有 gate**。
- **ROLE=A 累積成果通過整體 Codex 複審**;**成果已正確合併回 dev**;**dev 已由 Sean 手動 push**;**dev 已由 Sean 依 production 流程合併至 `main`**。
- **production 已部署正確 commit**;**部署 commit SHA 與批准版本一致**;**首次部署 flag=false**;**flag=false smoke test 通過**。
- 🔴 **B1 defer 契約(不變)**:預設 B1a/B1b 必須完成;若 Sean 明確 defer 須有拍板 + 編號 backlog;**不可默默略過**(文件不得同時宣稱「全片完成才開」與「可無條件略過」)。
- **Sean 最終拍板後才能開 flag**;**開 flag 後有 smoke、監控與「先關 flag」rollback**;**production flag 全程維持 false,直到最後 Sean 拍板**。

🔴 **L3 PRD gate(round7 四 + round8 二)**:R1a1–a3 可先做;到 **R1b1a 前必須停**;dedicated PRD + `prd_review` 通過後才能繼續 R1b1a/R1b1b/R1b1c/W1;本輪仍不建立 PRD、只記錄 gate。
> 🔴 **本輪(Codex round10 文件修正)仍禁實際更新 STATUS / 禁 stage / 禁 commit / 禁 push / 禁 merge / 禁 deploy / 禁開 flag / 禁開 R1a1**;此序僅寫入文件供下一步遵循。**本輪文件修正 ≠ 已完成 Git 同步、部署或 production 驗證。**

---

## 附錄 A — TapPay 接地事實(逐字核 2026-06-23)
- 沙盒可重現 3D:merchant `pcmmoto_NCCC_AE_Only`(AMEX-only、有開 3D)+ AMEX 卡 `3454 5465 4604 563` / CCV `1234` / OTP `1234567`;ngrok https 當 `NEXT_PUBLIC_SITE_URL`;`TAPPAY_3DS_ENABLED=true`。
- late-success 為真:離開 3D 後複製 payment_url 貼新分頁可重開完成、訂單變 paid(PCM-2026-0052)→ 立即重刷雙扣窗真實 → §7 必做。
- 取消 vs 關閉(✅ 沙盒釘死):「取消」鈕 → TapPay 回終態 CANCEL → settleCharge explicit_failed → markFailed(pending)→ 鎖釋放(PCM-0053/0054);「上一頁/關閉」→ record 停 4 PENDING(PCM-0055)+ URL 可重開 = late-success → released 立即重刷只對付這條。
- 無法主動殺 pending 3D:Cap Cancel / Refund 都要交易先授權成功;未授權 pending 3D 無取消端點 → 舊 3D 自己活到 OTP 過期(約 5 分)→ 只能偵測 + 退款。
- credential:`status 84`=Partner 未授權、`status 121`=參數錯誤:prime;四把成套才 `status:0`;demo `GlobalTesting_CTBC` 無 3D;正式 `tppf_pcmmoto_5803001` 真卡仍 `121`=正式四憑證未成套(上線前修)。
- delay_capture_in_days `-1`=只授權暫不請款;現行 `initiateThreeDSCharge` 不送(=當天自動請款,對齊 S1)。退款版維持 S1「授權即成立 + 自動請款」、不採兩段式。
- void:TapPay 無獨立 void;取消未請款授權 = Refund API 省 amount;用 `is_captured` 區分 auth reversal vs 真退款;過渡走 dashboard 手動。

## 附錄 B — superseded 方向(勿實作)
- **gemini Auth & Capture(A1-Void、兩段式 capture/void)**:與「立即重刷」二選一 + cap 非同步雙扣 + confirm 對 voided 反向幽靈 + 真錢 enum 未實證。🔴 **正式作廢。** 維持 S1 + 退款版。
- **前版層疊已廢**:① begin ON CONFLICT 必同步含 released ② released→failed on -1/5(改 failure observation)③ go_back_url 當 cancel/close ④ opener=null 與 postMessage 並存(改 opener=null + BroadcastChannel + WindowProxy)⑤ markReleased authenticated(改 server-only)⑥ find_sibling 強迫帶 attempt_id(改 discriminated union、paid 可無 attempt)。
- **round6 再廢**:⑦ find_sibling `active` 回傳帶 rec/bank(改**資料最小化**、去 rec/bank;rec/bank 由 payment_confirmer 內部取)⑧ failure observation 兩參數 + 弱輸入(改**三參數雙鍵** `attemptId+orderId+observedStatus` + 輸入守衛僅 -1/5 + order/狀態/已付款 fail-closed)⑨ S2b「只把 status 改含 released」(改**顯式繞 manual/ceiling** predicate、保留 unpaid/throttle)⑩ anomaly 兩態 + 「`old_attempt_id` UNIQUE 防重複人工退款」(改 **4 態 open/refunding/refunded/dismissed + claim/resolve CAS**;UNIQUE 只防重複 row)。
- **round7 再廢**:⑪ B1「不繞 needs_manual_review」(改**專用人工列再確認路徑**:可涵蓋 manual=true、但不清 flag)⑫ anomaly 表無 `id` PK(改 `id uuid PK` + `old_attempt_id UNIQUE NOT NULL` + `refund_provider_reference`)⑬ `refunding→open` 無條件釋回(改**僅明確未退款才 reopen**;**unknown/Dashboard 遺失 → fail-closed 保持 refunding**)⑭ SECDEF 內 `current_user` 當操作者(改 **`session_user`** 寫稽核欄)⑮ R1b1 / B1 各單片(改拆 **R1b1a/R1b1b、B1a/B1b = 19 片**)⑯ §14「R1a→R1c→R2→R3 線性」與「PRD 前置」字面衝突(改**唯一 26 步順序** + rollout gate;🔸 round8 再擴為 **30 步**、見 round8 ㉑)。
- **round8 再廢**:⑰ anomaly 表無 table 層安全(改**兩表 ENABLE RLS zero-policy + REVOKE ALL ON TABLE PUBLIC/anon/authenticated/service_role/payment_confirmer + has_table_privilege fail-closed assert**;payment_confirmer 零 table 權限只透過 SECDEF RPC 寫)⑱ reopen 清 claimed 抹除稽核歷史(改**主表存目前狀態 + append-only `payment_double_charge_anomaly_events` 保存歷史**、無 UPDATE/DELETE RPC)⑲ anomaly `amount` 裸欄/可能浮點(改 **`integer NOT NULL CHECK(amount>=0)` 取 `orders.total` 整數快照、禁浮點**)⑳ B1a「+ ACL」模糊(改 **`claim_expired_pending_attempts` SECDEF payment_confirmer-only + `FOR UPDATE SKIP LOCKED` + `p_limit` 安全界 + 真雙連線平行 claim 測試**)㉑ R1b1 兩片 + 單次 db push 順序(改 **R1b1a/R1b1b/R1b1c 三片 = 20 片**;**§14 由 round7 的 26 步擴為 30 步、新增第二次 B1a db push + 第二次驗證 gate**)。
- **round9 再廢**:㉒ 「docs commit → 直接開 fresh worktree」(違反起手 up-to-date 守線:docs commit 後 dev ahead≥4)→ 改 **Sean push 全部 dev commits + push 後雙向同步驗證(`origin/dev..HEAD=0` 且 `HEAD..origin/dev=0`)+ HEAD 對齊 STATUS 全綠才建 worktree;不綠停下回報、不自行修復**㉓ §14「30 步在 B1b 後直接 production readiness」缺 Git/部署鏈 → 改 **45 步**:加累積整合驗證 + 整體 Codex 複審 → Sean 合併回 dev → Sean push dev → Sean dev→`main` → production deploy(**flag=false**)→ 部署 commit SHA 驗證 → readiness → **Sean 拍板才開 flag** → 監控 + 先關 flag rollback㉔ §14 第 11 步把 **R1b1a/R1b1b/R1b1c 壓成一步**(改 **第 13/14/15 步逐片獨立**、20 片各自有步);㉕ §7 主訊號誤標 `R1b1b`(改 `R1b1c`)+ W1「每步寫 event」(改「每個狀態操作/退款結果透過受控 RPC 寫對應 event」、查詢 open/去 Dashboard 不寫 event)。
- **round10 再廢**:㉖ §14「step35 `busboy-end` + 最終 commit → step36 才做 commit 前 Codex 複審」時序倒置(commit 後不可能再「commit 前」審、違反 AGENTS.md commit 前審查)→ 改 **step34 累積驗證 + 更新 STATUS／roadmap + 產出整體最終 Packet(尚不 commit)→ step35 Codex commit 前／merge 前複審 PASS → step36 `busboy-end` 完成最終 commit(不 push)**;step37 起 merge 回 dev／push／main／deploy／readiness／開 flag／監控不變(仍 45 步)。
- **2026-06-27 pivot 再廢(round11 PASS 後、Sean 拍板)**:㉗ 塊A「桌機 popup 開新分頁付款 + 原頁 `CheckoutPendingThreeDS` 依 orderId 輪詢 + 三離開事件 A/B/C + BroadcastChannel 跨視窗同步 + `popup.opener=null` + popup-blocked 才退整頁」**全套作廢**。理由:① TapPay 3DS **redirect-only**(payment_url 官方只支援整視窗 top-level navigation、不支援 iframe / popup)→ iframe modal 不可行、popup 是唯一非整頁選項但已過時(無主流 PSP SDK 用)② 真機實證:popup 模型「開 3D popup(#1 pending)→ 不關 → 原頁重整 → 再結帳 → 第二 popup(#2)→ 兩筆都 paid(0072/0073 各 17,300)」= 同分頁兩 popup 並存雙扣(安全網 R1b1c anomaly genesis + W1 偵測接住、0072 待 Sean W1 退)。**改**桌機+手機整頁 redirect(復用既有 3DS-6b `CheckoutRedirecting`)= 同分頁一次一筆消滅二刷主向量 + 免跨視窗防呆那一整套。折入:§6 整頁化(§6.1 整頁契約 / §6.2 整頁返回+放棄〔廢三離開事件跨視窗同步〕/ §6.3 TapPay 語意保留 / §6.4 整頁主路徑 + #239 手動鈕)、§2.3 加整頁二刷收斂註記、§0 UX 列、§9/§14 A1-A3 重定義(A1 整頁化〔reset 已落地〕/ A2 #239 鈕 / A3 in-flight 防呆)。研究依據:handoff `2026-06-27-payment-arch-research-and-direction.md`(Gemini 廣度 + 5 路 web 官方引用、Claude triage)。A1 popup commit `089c220` 經 `git reset --hard 26bc93f` 退出主歷史(reflog 留存可救)。**保留不變**:§2.3 server release+放行狀態機 / §3 權限 / §4 R1 migration(R1a-R1c〔已 db push 落 prod〕)/ R2/R3 preflight / §7 W1 / B1 / §14 Git·db push·merge·flag 鏈。

## 附錄 C — codex round10 finding → 本檔節次
| 類 | round10 finding | 折入節次 |
|---|---|---|
| 必修(時序) | §14 step35(`busboy-end` + 最終 commit)早於 step36(commit 前 Codex 複審)→ commit 後不可能再「commit 前」審、違反 AGENTS.md commit 前審查 → 重排為 **step34 累積驗證 + 更新 STATUS／roadmap + 產出整體最終 Packet(尚不 commit)→ step35 Codex commit 前／merge 前複審 PASS → step36 `busboy-end` 完成最終 commit(不 push)**;step37–45 不變、仍 45 步;handoff §3 與 packet §F 同步 | §14 步 34-36 + 附錄 B ㉖ / handoff §3 / packet §F |
| nit | §13 / handoff §4「roundN 後仍僅 2」round 號落後(本版折入 round10)→ 對齊為 **round10**;unresolved 仍 2 項未變(Codex round10 指明改 round9 以對齊 v8;本版同時折入 round10、bump v9,依「欄位 round = 版本所折入 round、不留 lag」同一規則寫 round10) | §13 / handoff §4 |
| 版本字面 | v8→v9、round10 findings 已折入、Packet 送 round11、執行前置「本輪 Codex 複審 PASS」、plan/handoff/Packet 一致(v9·round10·20 片·45 步) | 標頭 / §14 / packet / handoff |
| 保留 | round4–round9 既有契約全原封(Git 雙向同步鏈/20 片逐列/兩次 db push + 驗證 gate/merge·push·main·deploy·flag=false·SHA 驗·readiness·監控 rollback/DB 安全·append-only 稽核·兩表 RLS·REVOKE 5 角色·payment_confirmer 零 table/amount int 禁浮點/unknown 維持 refunding/reopen 清主表 event 留痕/R1b1a-c 三片/B1a SKIP LOCKED/B1 manual=T·F 都進/W1 7 步/A1-3 K2+security+code review+真機/L3 PRD gate/35/35 僅未變子集合/canonical R1 未過完整模擬/真錢未實作/不自動 push/flag 全程 false 至 Sean 拍板)未退回 | 全檔 + 附錄 B |

— END —
