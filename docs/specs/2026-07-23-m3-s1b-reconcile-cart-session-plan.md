# M-3 S1b:reconcileCartSession — 黑洞「查詢付款結果」即時反查(**v3、規劃審查收斂版**)

> 2026-07-23。上位真權威 = `docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md`;S1a〔逾時出口 `b73e9cb`〕已上 `origin/dev`。
> **v2 = 折入 R1(codex FAIL 7 must-fix + Fable NO-GO 1 must-fix)。v3 = 折入 R2(codex R2 FAIL:MF1-5 已確認正確折入、MF6/MF7 + 1 新 finding〔reconcile 自身黑洞〕已於 v3 收斂;Fable R2 GO)。plan 層 2 輪已達上限;design 核心經雙模型 GO,v3 為確定性收斂修正(非方向重議)、不再開 R3;實作 diff 仍走 §11 完整審。**
> 片型 = **高風險金流片**(鐵則 12 ①錢 + ②權限 own-only/service_role):四層審不降級。字面來源 = repo grep 命中(非記憶);R1 抓到的 stale-migration 已更正(§8)。

---

## 0. Sean 已拍板(2026-07-23、鎖定)

- **Q1a = A(資料庫做法:重用、零新 migration)**:reconcile 重用 `find_active_sibling_own`(找單、own-only authenticated)+ `claim_order_poll_settle`(節流、payment_confirmer)+ `settleCharge`(對帳)——**本片零新 migration、Sean 不需推資料庫**。不採 plan §5 原「新建 by-cartSessionId 節流 RPC」。
- **Q1b = A(查詢入口:只放按鈕)**:只在客人 `unknown` 終態畫面放一顆「查詢付款結果」按鈕;不動 S1a 逾時 catch。
- **Q2a = A(failed UX:新增全頁畫面)**:reconcile 查到「確定失敗」→ **新增全頁「付款未成功」終態畫面**,CTA「重新選購」→ `/products`(購物車已在 S1a 清掉、無法還原、誠實告知需重新加購);清 in-flight 記號。
- **Q2b = A(拆兩片)**:**S1b-1**(純後端 server action + 窮舉狀態測試)→ **S1b-2**(前端終態畫面接線 + 按鈕 + agent-browser 真瀏覽器驗;順手處理 `CheckoutView` 逼近鐵則 6 上限)。

## 0.5 R1 findings 處置對照(供 R2 逐條核銷)

| R1 finding | 來源 | v2 處置 |
|---|---|---|
| MF1 paid 漏換 key → 下次購買假成功 | codex#4 **+ Fable F1**(雙模型) | §5:reconcile paid = **既有成功生命週期全套**(`clearPaymentInflight()`+`regenerateCartSession()`+`clear()` 冪等+切 paid 態)+ 回歸測試「下次加購取得新 key」 |
| MF2 按鈕不掛 hook(hook 不畫 JSX) | codex#3 | §5:精確 render 鏈 `CheckoutView→CheckoutTerminalScreen→CheckoutSuccess` + prop 契約 + reconcile state 擁有者 |
| MF3 §2-1 措辭「只有-1/5 動單」漏講 0/1 走既有 paid 寫入 | codex#1 + Fable C1 | §2 重寫不變量(negative move only);"零新寫入"→"零新增 primitive、新增一個 caller" |
| MF4 §8 引用過期 RPC 定義(released 繞閘) | codex#2(**已讀 code 驗實**) | §8 改引 `20260624120009`;§4 狀態表補 active→released TOCTOU 分支 |
| MF5 failed 落空車死畫面 | codex#5 + Fable C2 | §5:新增全頁 failed 態(Q2a=A)、CTA→/products、清 in-flight |
| MF6 SSoT 漂移(上位/CURRENT/STATUS 仍寫新 RPC) | codex#6 | §9:同步上位 plan + CURRENT + STATUS(S1b-2 收尾同 commit) |
| MF7 scope/鐵則 4/6/9 低估、CheckoutView 393/400 | codex#7 | §3 拆兩片(Q2b);§5 鐵則 6 處理;文案標 **L1** |
| should1 登入逾時永久 pending 無 ops 訊號 | codex + Fable C3 | §6:pending 文案含「持續請重新登入/客服」+ sanitized 分類 log |
| should2 「零雙 settle」過度宣稱 | codex | §7:改「可能重複 Record/settle 呼叫,但不重複扣款;DB 終態冪等序列化」 |
| should3 client 冷卻非安全閘 | codex + Fable C4 | §6:明載「client 冷卻是 UX、真閘是 DB claim」;收斂後清 in-flight |
| nit await/function-export | codex + Fable | §4 `(await getSiblingLookup()).lookup(...)`;§8「唯一 **function** export」 |

## 0.6 R2 findings 處置(codex R2 FAIL、Fable R2 GO;plan 層第 2 輪=上限)

- **MF1-MF5**:codex R2 + Fable R2 皆確認**已正確折入**(Fable 實讀 `:198-202` 驗 paid 生命週期等價、`20260624120009` 驗 released 語意、CheckoutTerminalScreen 窮盡守衛驗 reconciled_failed 不漏渲染)。
- **MF6(SSoT 同步時機)**:v2 誤延到 S1b-2 → v3 §9 改 **S1b-1 開工同 commit**(否則 S1b-1 期間 CURRENT/STATUS 仍指錯資料庫方案)。
- **MF7(hook state ownership 未凍結)**:codex R2 + Fable R2 雙抓 → v3 §5 凍結「useReconcilePayment 只組合於 useChargePayment 內部、對外唯一契約 charge.reconcile()、View 不自行實例化」。
- **🆕 新 finding #3(reconcile 自身黑洞、codex R2)**:client→server action reject/hang → reconciling 永久 true、按鈕死鎖 = 重現 S1a 死路 → v3 §5 加 client bounded timeout + catch→pending + finally 解鎖 + 兩條回歸測試。
- **should(caller 盤點)/nit(措辭)**:v3 §2-1/§5/§7 已校準(移除「第 5 路」硬編號、paid 改「既有生命週期超集」)。
- **N2(failed 帶 displayId、Fable)**:v3 §5 採 optional 透傳。
- 🔴 三項 must-fix 皆確定性收斂修正(codex 自身給了逐字修法、或 = 套用 S1a 已審 pattern),非方向重議 → 依 plan 層 2 輪上限**不開 R3**;實作 diff 仍走 §11 完整四層審(reconcile timeout / ownership / 窮盡守衛都會在 code 層再被驗)。

## 1. 目標

S1a 讓黑洞卡死的客人跳出「付款狀態未知」死路畫面,但無法自助得知真實結果。S1b 讓客人在該畫面**主動即時對帳**:**已付款(顯訂單號)/ 還在確認(請稍候再查)/ 確定失敗(全頁告知、重新選購)**。

## 2. 金流不變量(每條 yes/no 可驗;違反 = 立即停)

1. **動單方向(措辭校準;MF3)**:reconcile 透過**重用** `settleCharge`(逐字不改)動單,且只沿用其既有語意——
   - `record_status ∈ {−1,5}`(且過識別/金額閘、markFailed 成功)→ 既有單 `markFailed`(**唯一負向動單**)。
   - `record_status ∈ {0,1}` → 走既有 paid 收斂寫入(`markCharged→confirm→paid→recordPendingInvoice`)。
   - `2/3/4`、未知碼、查詢失敗、查不到、no_attempt → 一律 **pending 不動**。
   - reconcile **零新增寫入 primitive、零新增刪除/release**,只新增一個「觸發既有 settleCharge」的 caller(**不編號**;現有 caller=callback/webhook/sweeper/payment-status poll/charge-action `adjudicateSettlement`/preflight 注入 settle。不同 caller 可並發重複 Record/settle 呼叫、**但不重複扣款**〔§7-C〕)。
2. **「不成立」= 標記,非物理刪**;reconcile **刻意不重用 `preflightReleaseSibling`**(它含 release 寫入語意)。
3. **模糊態保守 pending**、不動單、不清 client cart_session_id。
4. **own-only**:orderId 由 `find_active_sibling_own`(DB 內 `auth.uid()` 鎖死)反查;偽造他人 cartSessionId → none/自己單。
5. **零經銷價/金額/PII 出回應**:回 `{ status, displayId? }`;displayId = 客人自己訂單號(對齊既有 `{ok:true,displayId}` 揭露面)。
6. **Record 節流**:對 active 兄弟單 settle 前必過既有 `claim_order_poll_settle`;**client 按鈕冷卻是 UX、非安全閘**(真閘 = DB claim + settleCharge 冪等)。
7. **fail-closed**:反查/節流/settle/建 client 任一 throw → skip、不 500、不偽 → pending。

## 3. 拆片(Q2b=A)

- **S1b-1(純後端、標準~高風險片)**:server action `reconcileCartSession` + composition 接線 + **窮舉狀態矩陣單元測試**。零 UI、零 client。收工 = 三綠 + 測試 + 四層審。
- **S1b-2(前端終態接線、高風險片)**:新全頁 failed 態 + `unknown` 畫面「查詢付款結果」按鈕 + hook `reconcile()` 方法 + render 鏈 prop 契約 + CheckoutSuccess failed CTA 參數化 + **鐵則 6 處理**(CheckoutView 393/400、useChargePayment 235)+ **agent-browser 真瀏覽器驗** + SSoT 同步(§9)。依賴 S1b-1。

估時:S1b-1 ≈ 30 分;S1b-2 ≈ 40 分(含鐵則 6 外移與瀏覽器驗)。

## 4. S1b-1 規格:server action `reconcileCartSession`

新檔 `apps/storefront/src/app/checkout/reconcile-actions.ts`(`'use server'`)。骨架對照既有 `payment-status/route.ts:87-150`,差別 = by-cartSessionId + 直接映 outcome(不重讀 DB)。

```
型別:ReconcileResult = {status:'paid';displayId:string} | {status:'failed';displayId?:string} | {status:'pending'}

1. cartSessionId 非 UUID(局部 UUID_RE、沿用 charge-actions.ts:77)→ {status:'pending'}
2. createServerSupabaseClient() throw → pending;supabase.auth.getUser() 無 user/throw → pending
   (未登入不揭示;own-only 反查於 auth.uid() NULL 本回 none = 等同 pending、零洩漏;§6 縱深:加 sanitized 分類 log、privileged factory 絕不被呼)
3. (await getSiblingLookup()).lookup(cartSessionId) → find_active_sibling_own(own-only):
     none  → pending
     paid  → {status:'paid', displayId}          (DB 確定成交、不打 Record)
     active(existingOrderId)→ step 4
4. getPollSettleThrottle().claimPollSettle(existingOrderId, RECONCILE_THROTTLE_SECONDS=10):
     false → pending
       (🔴 MF4 released 語意:最終 RPC〔20260624120009〕predicate =
        (pending/charged 受 manual/count<8 閘) OR (released 繞閘)。故 false 可能因窗內已放行 / order 非 unpaid /
        pending·charged 已 manual 或 count≥8;released 態則繞閘可回 true。)
     true → settleCharge(getSettleChargeDeps(), {orderId: existingOrderId}):
        paid       → {status:'paid', displayId}   (0/1 走既有 paid 收斂寫入)
        failed     → {status:'failed'}            (−1/5、既有單 markFailed)
        no_attempt → pending                       (fail-closed)
        pending    → pending
   step 2-4 全包 try/catch → pending(fail-closed)

🔴 MF4 active→released TOCTOU(S4 3DS-on 且 release CAS 已跑才可達;Phase 1 flag off 不可達):
   lookup 得 pending → 他分頁 release → claim 對 released 回 true → settleCharge 對 released attempt 收斂。
   此 = 既有「released 持續低頻對帳」路徑(sweeper/poll-route 已在跑)、reconcile 只是同路又一 caller;
   late-success 的雙扣由既有 double-charge anomaly(20260624120005 genesis)捕獲、非 reconcile 新增。
```

**重用**:`getSiblingLookup()`(`composition.ts:146`)、`getPollSettleThrottle()`(`:206`)、`getSettleChargeDeps()`+`settleCharge`(`:130`/`settle-charge.ts:45`)。雙 client 混用 = 既有 `getPreflightReleaseSiblingDeps` pattern。

**測試(窮舉矩陣)**:mock composition factory(套 `charge-actions.test.ts` + `payment-status/route.test.ts` 樣式);覆蓋 none/paid/active × claim{true,false} × settle{paid,failed,no_attempt,pending} + 各 throw → 斷言**無任何 cell 誤回 paid/failed**、throw 全落 pending;+ 未登入→pending 且 **privileged factory 未被呼**。

## 5. S1b-2 規格:前端終態接線

**新增全頁 ChargeState `reconciled_failed`(MF5、Q2a=A;不重用會誤導的 retryable `error`)**:
- `useChargePayment.tsx` `ChargeState` union 加 `{ status:'reconciled_failed'; message:string }`。
- `CheckoutTerminalScreen.tsx` `FULL_PAGE_BY_STATUS` 加 `reconciled_failed:true`(該表要求列出每個 status、漏列 tsc 紅)+ 新 branch → `<CheckoutSuccess variant="failed" ctaTo="/products" ctaLabel="重新選購" message=… />`。
- `CheckoutSuccess.tsx`:**failed CTA 參數化**——既有 `variant="failed"` CTA 寫死 `/cart`(3DS-callback 保留車);reconcile 場景車已清 → 加 optional `ctaTo`/`ctaLabel`(預設維持 `/cart`「返回購物車」不回歸 3DS-callback、reconcile 傳 `/products`「重新選購」)。

**hook `reconcile()` 方法(MF1/MF2/MF7/新#3 擁有者)**:
- 🔴 **state ownership 凍結(MF7,codex R2 + Fable R2 雙抓)**:`useChargePayment` **維持唯一 `ChargeState` owner**;外移的 `useReconcilePayment` **只能組合於 `useChargePayment` 內部**(由後者注入 `setState`/`inFlightRef`/`clear`/`regenerateCartSession`/`cartSessionId`,或傳入明確 paid/failed/pending callbacks),對外唯一契約 = `charge.reconcile()` + `charge.reconciling`(+ cooldown)。**不留「hook 或 helper」二選一給施工臨場決定;`CheckoutView` 絕不自行實例化 `useReconcilePayment`**——否則獨立 state 碰不到私有 `setState`/`inFlightRef` → `charge.state` 永停 `unknown`、終態畫面不觸發(按了沒反應)。
- `charge.reconcile()` 呼 `reconcileCartSession(cartSessionId)`,映射(全程 setState 走 useChargePayment 私有 owner):
  - `paid` → **既有 paid 生命週期的超集(MF1;現行順序)**:`clearPaymentInflight()` → `clear()` → `regenerateCartSession()` → `setState({status:'paid',displayId})`(既有 `submit` paid 路徑 `:198-202` = `clear→regenerate→setState paid`;reconcile 多一步清 unknown 專屬 in-flight marker〔`:181` 設的〕)。加回歸測試「reconcile paid 後下次加購取得新 cartSessionId」。
  - `failed` → `clearPaymentInflight()` + `setState({status:'reconciled_failed', displayId?, message})`(cart 已清、保留無意義;displayId 若 lookup active 分支有帶則透傳供客訴查、與 paid 同揭露面〔N2〕)。
  - `pending` → 不改終態(維持 `unknown`)、更新「仍在確認中,請稍候再查」+ **cooldown**;**inFlightRef 維持鎖**(unknown 終態鎖不釋)。
- 🔴 **client 端 bounded timeout(新 finding #3,codex R2:reconcile 自身不可再成黑洞)**:`reconcileCartSession` 呼叫必包**獨立 bounded timeout**(比照 S1a 既有已審 `withSubmitTimeout` pattern)→ Promise reject / 永不 settle → `catch` 當 `pending`、`finally` 解除 `reconciling`;**cooldown 與 `reconciling`(請求中)兩個 state 分離**(否則永久 disabled = 重現 S1a 正在修的死路)。加回歸測試「Promise reject」+「永不 resolve」→ 斷言按鈕不永久 disabled。
- 🔴 **鐵則 6(MF7)**:外移 `useReconcilePayment` 正是為避免 `useChargePayment`(現 235 行 >200 警戒)再膨脹;commit body 記理由。

**render 鏈 prop 契約(MF2)**:`unknown` 畫面經 `CheckoutView:265 isTerminalChargeState → CheckoutTerminalScreen → CheckoutSuccess(variant="unknown")` 渲染。按鈕接線:
- `CheckoutView` 擁有 reconcile handler(呼 hook `reconcile()`)+ `reconciling`,經 `CheckoutTerminalScreen` 透傳給 `CheckoutSuccess`。
- `CheckoutSuccess`(unknown variant)加 optional 次要動作槽:`onReconcile?`+`reconciling?` → render「查詢付款結果」按鈕(`reconciling` 時 disable + 冷卻;paid/processing 變體不受影響)。
- 🔴 **鐵則 6(MF7)**:`CheckoutView` **393/400**、逼近硬上限 → S1b-2 動它前先評估外移(候選:reconcile handler + reconciling state 收進上述 `useReconcilePayment`,View 只透傳 props);若仍 >400 必外移、不壓註解硬塞(U3b/U4b 前例)。

**文案分級**:reconcile 按鈕 + failed/pending 文案 = 客人可見但錯誤路徑罕見改動 → **L1**(hardcode 可)。

**驗收**:三綠;窮舉映射單元測試;**agent-browser 真瀏覽器驗**(390px:unknown 畫面按鈕可見、查詢中 disable;paid → 成交畫面且驗下次加購換 key;failed → 全頁「付款未成功」+ CTA 到 /products;pending → 維持並可再查)。

## 6. 已知取捨 / 誠實揭示(供 R2)

1. **find_active_sibling_own 對已 markFailed/released 單回 none** → reconcile 對「確定失敗且已釋鎖」的單回 pending 而非 failed(安全、永不誤報;兩設計共通)。客人可重新結帳。
2. **unknown 態 cart 已被 S1a clear()** → failed 態需重加購(Q2a=A 全頁畫面 CTA→/products 誠實引導)。
3. **登入逾時 → 永久 pending 迴圈(should1)**:JWT 過期後 step2 無 user → 恆 pending;pending 文案含「若持續請重新登入後再試或聯繫客服 LINE」給出口;server 端加 sanitized 分類 log(供維運追、零 PII)。
4. **client 冷卻非安全閘(should3)**:腳本可繞;真閘 = DB `claim_order_poll_settle` + settleCharge 冪等。未登入/濫用面 = 便宜 own-only 查詢,Sean 已於 Q1a=A 知情接受(Record 額度與金流結果受 DB claim 保護)。

5. **released attempt 的 −1/5 不落 `released_failure_observed`(codex 關卡2 should3;既有 settleCharge 行為、非 reconcile 引入)**:實讀 `settleCharge` 對 released attempt 讀 Record −1/5 時走 `markFailed`,但該 RPC 只允許 pending → throw → 回 `pending: record_unreachable`(仍 fail-closed、**永不誤報 failed**),`released_failure_observed` 訊號不落地、reconcile 對此持續回 pending。此為既有引擎的觀測缺口(型別 `released_failure_observed` 已定義但 settleCharge 未呼 `recordReleasedFailureObservation`),**reconcile 逐字重用、不修 settleCharge**(改它 = 另一子系統高風險片);安全方向(不誤動單),列此揭示,released 分支的完整觀測留既有 sweeper/未來片。

## 7. 攻擊時序自審(更新 released 分支;措辭校準)

- **A 狂點按鈕**:find_active_sibling_own 每點跑(便宜 own-only);Record 由 claim 窗內限一次。✓
- **B 偽造他人 cartSessionId / 未登入**:auth.uid() 只查自己 → none/自己單;零 IDOR(R1 已驗)。✓
- **C 並發(reconcile × callback/webhook/sweeper/poll/adjudicateSettlement/preflight)措辭校準(should2)**:多個 caller 走同一 settleCharge;**可能重複打 Record/重複 settle 呼叫**(各 caller 不共用同一 claim),**但不重複扣款**——markCharged/confirm 各經 `FOR UPDATE` 冪等序列化、Record 同權威 rec → 訂單只成立一次。✓
- **D active 實為 late-paid**:settleCharge Record 0/1 → paid(既有語意)。✓
- **E claim 放行後 −1/5**:markFailed 釋鎖 → failed。**唯一負向動單**、沿用既有明確失敗判定。✓
- **F active→released TOCTOU**(§4):released 繞閘 claim=true → settleCharge 收斂 released attempt = 既有 released-對帳路徑又一 caller;late-success 雙扣由既有 anomaly 捕獲、reconcile 零新增。✓
- **殘餘風險**:§6-1/§6-2/§6-3——安全方向,列給 Sean、不自宣接受。

## 8. 附錄:架構事實 file:line(已 grep 對照 code、含 R1 更正)

- server action 樣式:`charge-actions.ts:104` 唯一 **function** export;零直呼 `.rpc()`,全走 composition factory。
- 先例:`payment-status/route.ts:87-150`(own-only 讀 → `claim_order_poll_settle(orderId,10)` `:137` → `settleCharge` `:139` → 重讀映射;回 `{status}` 零 PII)。⚠️ reconcile **非完整雙胞胎**:route 對 env/未登入/查無回 500/401/404,reconcile 一律吞 pending(§6-3 揭示、加 log)。
- 找單 RPC:`find_active_sibling_own(p_cart_session_id uuid)`(`20260624120001`、authenticated own-only SECDEF;WHERE `status IN(pending,charged)` → failed/released 不在 active 集回 none);adapter `SupabaseSiblingLookupAdapter.ts:28`;`getSiblingLookup` `composition.ts:146`(**async**)。
- 🔴 **節流 RPC 最終定義 = `20260624120009_m3_3ds_r1c2_poll_settle_released_predicate.sql:61-90`**(`CREATE OR REPLACE` 覆蓋基線 `20260621120000`):predicate = `(pending/charged AND 非manual AND count<8) OR status='released'`,released 繞 manual/ceiling(§2.5 持續對帳);`getPollSettleThrottle` `composition.ts:206`。
- 對帳引擎:`settleCharge` `settle-charge.ts:45`;−1/5→markFailed(`:112-122`)、0/1→paid 收斂(`:137-138,254-291`)、其餘 pending。
- client 終態:`CheckoutView.tsx:265`(`isTerminalChargeState`→`CheckoutTerminalScreen`;終態優先於 empty-cart)、`CheckoutTerminalScreen.tsx`(`FULL_PAGE_BY_STATUS` 窮盡表 + 五 branch〔S1b-2 加 reconciled_failed〕+ never 守衛)、`CheckoutSuccess.tsx`(variant paid/processing/unknown/failed;🔴 S1b-2 起 failed CTA 參數化 ctaTo/ctaLabel、預設 `/cart`)、`useChargePayment.tsx`(ChargeState `:50-66`、paid 路徑 `:198-202`、`regenerateCartSession`/`clear` 自 useCart `:111`、`clearPaymentInflight`/`setPaymentInflight` 自 inflight-marker)。
- migration 命名:`YYYYMMDDHHMMSS_<slice>_<desc>.sql`;最新 `20260719150000`;本片 Q1a=A **零新 migration**。

## 9. SSoT 同步(MF6;🔴 codex R2:**S1b-1 開工同 commit**,不可延到 S1b-2)

上位真權威仍寫「新 by-cartSessionId RPC + migration + Sean db push」,與 Q1a=A 衝突 → 一次同步:
- `docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md` §4 片序 + §5 S1 + §9 附錄「無 by-cartSessionId 版→需新建」→ 改「Q1a=A 重用 find_active_sibling_own + claim_order_poll_settle、零新 migration、拆 S1b-1/S1b-2」。
- `docs/handoff/CURRENT.md:12` S1b 入口 → 同步(移除「含 DB migration + Sean 手動 db push」、改零 migration + 拆片)。
- `STATUS.md` 下一步/S1b 敘述 → 同步。
🔴 依「先建事實×位置清單再一次改完 + 逐一 grep 反驗」(L0 四輪復發教訓),不只改被點名處。

## 10. Rollback

純加法:移除 `reconcile-actions.ts` + `useReconcilePayment` + `reconciled_failed` 態 + 按鈕 → 回 S1a 行為。既有付款鏈/輪詢端點不依賴 reconcile,零影響。settleCharge 已完成的 paid/failed/anomaly 寫入為既有引擎語意、不因移除 reconcile 逆轉。

## 11. 審查 gate(高風險不降級)

每片:三綠 → code-reviewer(opus)→ codex 關卡2 對抗審 diff + 金流背書 → Fable 盲審;S1b-2 收工前 agent-browser 真瀏覽器驗。**plan 層(本檔 v2):codex 關卡1 + Fable R2 縮限複審(驗 MF1-7 折入)。** 輪次:R2 上限本輪、仍不收斂=方向題給 Sean。
