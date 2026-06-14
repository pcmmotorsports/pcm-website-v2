# M-3 3DS-1b settleCharge 對帳脊椎 — plan v2(關卡1、鐵則 8+12)

> **承** master plan v5 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §1/§2/§4/§5 + Sean 拍 Q1=A/Q2=A(跳 codex 關卡1)+ 審查側 7 refine(R1-R7)。
> **v2 = 折入審查側 關卡1 的 6 缺陷 A-F + 決策 Q-A=A / Q1=A / Q2=A / Q3=A**(v1→v2 delta 見 §13)。
> **真權威**:master plan §1 settleCharge 契約 + §5 S1=B 待開票 + §7 官方 record_status 7 值(1a amend 3286a30 釘正)。
> **前序就緒**:0a webhook inbox / 0b dedup+needs_settle / **0c bank_transaction_id + pending_invoices + record_pending_invoice RPC** / **1a recordQuery(回原值不裁決)**。

---

## 0. 範圍 + 為什麼

settleCharge = 3DS 收單**脊椎**:三路(callback / webhook / sweeper)+ retry 全呼**同一條冪等結算**、以 **Record API 為唯一權威**。本片只建 use-case 本體 + 讀寫依賴(新窄權讀 RPC + port 讀法 + cookieless 寫路徑 + 待開票呼叫)+ 單元測;**不接三路 route**(3DS-2/3/4)、**不接 initiate**(3DS-5b Phase II)。純地基、零 3DS 流量。

---

## 1. 要改什麼(檔案清單;鐵則 8 影響面)

| # | 檔 | 動作 | 層 |
|---|---|---|---|
| 1 | `supabase/migrations/20260614xxxxxx_m3_3ds_1b_get_active_charge_attempt.sql`（新） | 窄權讀 RPC `get_active_charge_attempt(p_order_id)`（R1+缺陷D role-hygiene） | migration |
| 2 | `packages/domain/src/payment/types.ts` | +`SettleChargeInput`/`SettleChargeOutcome`/`ActiveChargeAttempt` | domain |
| 3 | `packages/ports/src/IChargeAttemptStore.ts` | +`findActiveByOrderId(orderId): Promise<ActiveChargeAttempt \| null>`（R2、主軌-only） | ports |
| 4 | `packages/ports/src/IPaymentConfirmer.ts` | +`recordPendingInvoice(orderId): Promise<boolean>`（**缺陷A**、S1=B 待開票） | ports |
| 5 | `packages/use-cases/src/settle-charge.ts`（新） | settleCharge use-case 本體 | use-cases |
| 6 | `packages/use-cases/src/settle-charge.test.ts`（新） | 單元測（§8 具名殘餘態 + 真競態界定 F） | use-cases |
| 7 | `packages/adapters/src/payment/PgChargeAttemptAdapter.ts` | +`findActiveByOrderId`（主軌、payment_confirmer 窄權 + 解析） | adapters |
| 8 | `packages/adapters/src/payment/ChargeAttemptStoreWithFallback.ts` | +`findActiveByOrderId` 委派**主軌 only**（§4） | adapters |
| 8b | `packages/adapters/src/payment/ChargeAttemptStoreWithFallback.test.ts` | test double 補 findActiveByOrderId stub | adapters |
| 9 | `packages/adapters/src/payment/PaymentConfirmerAdapter.ts` | +`recordPendingInvoice`（呼 0c RPC、同 payment_confirmer 連線、**缺陷A**） | adapters |
| 10 | `apps/storefront/src/lib/payment/composition.ts` | +`getSettleChargeDeps()` **cookieless sync factory**（**缺陷B**、別用會 throw 的 getChargeAttemptStore） | delivery |
| 11 | `packages/use-cases/src/index.ts` | barrel export settleCharge | use-cases |
| 12 | `packages/use-cases/src/confirm-payment.test.ts` | test double 補新 port 方法（findActiveByOrderId/recordPendingInvoice stub） | use-cases |
| 13 | `packages/adapters/src/tappay/TapPayChargeAdapter.ts` | recordQuery +merchant wire 完整性 fail-closed（**codex 關卡2 r1 #1**） | adapters |
| 14 | `packages/adapters/src/tappay/TapPayChargeAdapter.test.ts` | +merchant 完整性測 | adapters |
| 15 | `STATUS.md` | 7 欄同 commit（記 1b + **已推 origin/dev=3286a30** 修正） | docs |

> **15 檔**（本 plan doc 另計）高內聚（settleCharge 一條鏈:RPC→port×2→adapter×4→use-case→測→cookieless wiring；#13/#14 為 codex 關卡2 r1 merchant 完整性回修）。鐵則 6:settle-charge.ts ~270 行、adapter 增量各 ~30-40 行,均 < 400。

---

## 2. settleCharge 契約 + 邏輯流（master plan §1 step 1-5 + 缺陷 A/C）

```ts
type SettleChargeInput = { orderId: OrderId; recTradeIdHint?: string };
type SettleChargeOutcome =
  | { kind: 'paid'; idempotent: boolean; displayId: string }
  | { kind: 'failed' }                                            // Record 明確未成功(-1/5)→ markFailed 已釋鎖、caller 放行重刷
  | { kind: 'pending'; reason: 'auth_or_pending' | 'record_unverified' | 'record_unreachable' }
  | { kind: 'no_attempt' };                                       // orderId 無 active attempt → route 丟棄(§3.6 加固)

type SettleChargeDeps = { tappay: ITapPayAdapter; attempts: IChargeAttemptStore; confirmer: IPaymentConfirmer };
```

**邏輯流（lock 外、純讀 + 既有冪等寫;deps 由 cookieless §4 factory 注入）**:
1. `attempts.findActiveByOrderId(orderId)` → null → `no_attempt`(不打 Record、§3.6)。
2. 🔴 **缺陷C 短路 + C×A 補記**:`if (attempt.orderPaymentStatus === 'paid')` → **先 best-effort `confirmer.recordPendingInvoice(orderId)`(C×A 自癒、冪等、throw 只 log)** → `return paid{idempotent:true, displayId}`。**嚴格 `=== 'paid'`**(不可 `!== 'unpaid'`、避免誤短路退款/partiallyPaid 態)→ 省 Record rate-limit(§7)。〔🔴 C×A 理由:若首次 paid 收斂時 step5 recordPendingInvoice throw(只 log),訂單已 paid → 重入永遠短路到不了 step5 → 待開票永久遺失(違 0c durable 本意 L25「paid 重入不重複開票」);故短路路**也呼**、ON CONFLICT DO NOTHING → 已記 no-op、未記自癒補記。〕
3. 組 Record 查詢鍵(R4 優先序)→ `tappay.recordQuery(...)`;throw → `pending: record_unreachable`(保留)。
4. **Record 權威全條件**(R3+R5):`queryStatus===0` + `numberOfTransactions===1` + 鍵全對本機 + `merchant_id` 對 + `record_status` 判(§5 表)。
5. **paid 收斂(既有冪等樹複用 + 缺陷A)**:
   `attempts.markCharged`(pending→charged;rec UNIQUE no-op)→ `confirmer.confirm`(FOR UPDATE + paid no-op)
   → 🔴 **`confirmer.recordPendingInvoice(orderId)`(缺陷A、best-effort、throw 只 log 不翻 paid)** → 回 `paid{idempotent, displayId}`。
   confirm throw → `pending: record_unreachable`(已扣款不棄、retry confirm)。
6. **冪等**:重入(已 charged/paid)→ markCharged/confirm/recordPendingInvoice 皆 no-op → `paid{idempotent:true}`。

> retry 三裁決(§1(d))= action 層(3DS-5b)把 `paid`→duplicate+displayId / `failed`→放行重刷 / `pending`→短 hold;settleCharge **只產 outcome**、不碰 UI/cart。recordPendingInvoice 為 paid 副作用、不入 Outcome。

---

## 3. R1 + 缺陷D — 新窄權讀 RPC `get_active_charge_attempt`

```
get_active_charge_attempt(p_order_id uuid) RETURNS jsonb
  SECURITY DEFINER, SET search_path = ''
  回 { attempt_id, status, rec_trade_id, bank_transaction_id, attempt_created_at,
       order_total, order_payment_status, order_display_id } 或 null。
  （🔴 orders 無 currency 欄〔Phase 1 TWD-implicit、findTotal 亦 hardcode 'TWD'〕→ RPC 不回 order_currency;
   §7 的 currency 嚴格斷言 1b 用 'TWD' 常數比 record.currency。
   🔴 attempt_created_at〔codex 關卡2 r1 #8b〕:供弱識別〔hint/order_number fallback〕時間窗防誤命中。）
```
- 🔴 **只回非 PII 對帳欄**;**絕不回** fallback_token_hash / 卡資料 / 經銷價 / customer PII。
- 🔴 **order_total/payment_status/display_id 由本 RPC 回**(非 `IOrderRepository.findTotal`):findTotal 是 **RLS own-only**,webhook/sweeper **無 user JWT** → 回 null。對帳讀必走 payment_confirmer 窄權 server-side。`order_payment_status` 供缺陷C 短路。
- active = `status IN ('pending','charged')`;防禦 `ORDER BY created_at DESC LIMIT 1`。
- 權限:`REVOKE EXECUTE FROM PUBLIC, anon, authenticated, service_role` + `GRANT payment_confirmer`;入口 fail-closed(p_order_id null → RAISE 通用)。
- 🔴 **缺陷D role-hygiene 全套 assert**(對齊 0a/0c/S2-c/S2-d):末加 `has_function_privilege` 矩陣(payment_confirmer 有 / 四方無含 service_role)+ **`role_table_grants=0` + `role_column_grants=0`**(payment_confirmer 對相關表零直接表/欄權限、只透 SECDEF RPC)。
- 唯讀 → MCP 交易模擬 happy-path 全程可跑(無 SECDEF-寫斷線);仍 BEGIN+假資料+查+ROLLBACK 零留痕。**部署**:時戳在 0c 後、同 db push bundle 連帶。

---

## 4. R2 + 缺陷B — 讀**與寫**路徑:主軌-only + cookieless

`IChargeAttemptStore` 既有雙軌是為**寫韌性**(markCharged 麵包屑撐過 transport 失敗 主×3→備×2)。**settleCharge 在 webhook/sweeper 無 cookie/JWT** → 唯一 factory `getChargeAttemptStore()` 呼 `cookies()` 在 cron **throw**;備軌(PostgREST)需 user JWT 亦跑不了。故:

- **讀**(`findActiveByOrderId`):只在 **PgChargeAttemptAdapter(主軌、buildPgConfig 直連無 cookie 依賴)** 實作;`ChargeAttemptStoreWithFallback` 委派主軌、無 fallback。讀失敗 → settleCharge 回 `pending` → sweeper 重來(讀冪等、無漏寫風險)。
- 🔴 **寫**(缺陷B、markCharged/markFailed):**同理主軌-only**。已核 `PgChargeAttemptAdapter`(L12/L63):**fallbackToken 主軌刻意不入 query**(僅備軌參數)→ settleCharge 走主軌 markCharged、`MarkChargeAttemptChargedInput.fallbackToken` 傳 `''` 佔位 + 註解(主軌-only 對帳路徑、無備軌 token、不入 query/log)。markFailed 本就無 token。
- 🔴 **cookieless deps(缺陷B)**:新增 **`getSettleChargeDeps()` sync factory**(composition.ts):直接 `new PgChargeAttemptAdapter(PAYMENT_CONFIRMER_DB_URL)`(主軌-only、**不**經 ChargeAttemptStoreWithFallback、**不**呼 cookies)+ `getTapPayAdapter()` + `getPaymentConfirmer()`(皆 sync cookieless)。三路 route/cron 由此注入 settleCharge。
- 介面歸屬(Q2=A):`findActiveByOrderId` 加既有 `IChargeAttemptStore`(同「charge 簿記+對帳」語意域)。

---

## 5. R3 — retry 三裁決 × 官方 7 值（amend 3286a30 釘正）

`record_status`:`-1=ERROR / 0=AUTH / 1=OK / 2=PARTIALREFUNDED / 3=REFUNDED / 4=PENDING / 5=CANCEL`。Phase 1(無退款)逐態釘測:

| record_status | is_captured | amount 符 | outcome |
|---|---|---|---|
| 1 | true | ✓ | `paid`（markCharged→confirm→recordPendingInvoice） |
| 1 | true | ✗ | `pending: record_unverified`（金額不符不放行、PF-X3 縱深） |
| 1 | false | — | `pending: auth_or_pending`（OK 未 capture、罕見） |
| 0 / 4 | — | — | `pending: auth_or_pending` |
| -1 / 5 | — | — | `failed`（markFailed 釋鎖、放行重刷） |
| 2 / 3 | — | — | `pending: record_unverified` + 告警（退款異常、不自動放行、S2=B、Q3=A） |
| 查不到 / count≠1 / 鍵不符 | — | — | `pending: record_unverified` |
| recordQuery throw | — | — | `pending: record_unreachable` |

---

## 6. R4 + 缺陷E — Record 查詢鍵優先序（含 hint）

master §1 第 3 順位完整 = **`rec_trade_id` → `bank_transaction_id` → `recTradeIdHint`（僅 hint、須 Record 驗、不當本機鍵）→ `order_number`(=orderId) + 窄時間窗**。settleCharge 依本機 attempt 有的鍵 + hint 組 recordQuery；純 order_number fallback 加 amount + 窄窗 + count=1 防誤命中。1a recordQuery 已支援三鍵 + merchant_id 恆帶。

## 7. R5 — amount/currency 嚴格斷言在 1b（1a 故意不斷言）

1b 比對時嚴格:`record.amount === order_total`(整數元位)**且** `record.currency === 'TWD'`。不符 → `pending: record_unverified`。`order_total` 來自 §3 讀 RPC(非 client、非 findTotal)。

## 8. R6+R7 + 缺陷E/F — 冪等 / 並發 / 測試矩陣

- **冪等寫複用既有縱深**:markCharged(雙鍵+FOR UPDATE+rec UNIQUE+charged→failed 永 RAISE) / confirm(FOR UPDATE+paid no-op) / pending_invoices(order_id UNIQUE、0c)。settleCharge 不新增鎖。
- 🔴 **缺陷F 字面界定**:controlled-promise 測**斷言對象 = use-case 邏輯分支正確性**(哪態走哪 outcome、呼哪 dep);**DB 行級序列化(真防雙扣)靠既有 RPC migration assert + codex 關卡2 + 審查側 MCP 並發模擬**,測試文案**不得**寫成「測了防雙扣」(避鐵則11 字面誇大)。
- 🔴 **缺陷E 具名必測**(master §2 點名殘餘態,逐一):
  ① `no_attempt`(findActiveByOrderId null)② 缺陷C `orderPaymentStatus='paid'` 短路 paid 不打 Record
  ③ amount-mismatch → `pending: record_unverified` ④ markCharged-ok → confirm-throw → `pending: record_unreachable`
  ⑤ `-1/5` → markFailed → `failed` ⑥ `0/4`/`1&&!is_captured` → `pending: auth_or_pending`
  ⑦ `2/3` 退款 → `pending: record_unverified` + 告警 ⑧ 缺陷A+C×A:paid 尾(step5)呼 recordPendingInvoice、重入 no-op、throw 不翻 paid;**C×A:step5 首記 throw → 重入短路(step2)仍補記成功(durable 自癒)**
  ⑨ R4 各優先序(rec / bank / hint-Record驗 / order_number+窄窗)⑩ 重入冪等(charged/paid)→ `paid{idempotent:true}`
  ⑪ recordQuery throw → `pending: record_unreachable`
- **R7 節流不塞 1b**:per-order recently-settled skip 留 3DS-4;settleCharge 重複呼叫須冪等、但不自帶節流狀態。

## 9. 影響面 + rollback

- **新增**:1 migration(讀 RPC)+ settleCharge use-case + 2 port 法(findActiveByOrderId / recordPendingInvoice)+ 3 adapter 實作 + cookieless factory + 型別 + 測。**不改** confirmPayment(同步鏈並存)。
- **影響部署**:讀 RPC 進 db push bundle(同 0b/0c);無新 env、無新密鑰。
- **rollback**:純新增、未接 route → 可獨立 reset;migration 走新檔 + rollback SQL;未 push 前 Sean review。

## 10. L 分級 + 鐵則 + 禁止清單

- **內容分級**:N/A(金流核心邏輯)。**鐵則**:8 + **12 → codex 關卡2 必跑、必覆 R3/R6/R1/R5 + 缺陷A 開票鏈 + 缺陷B 寫路徑**。
- **禁止清單**:不接三路 route(3DS-2/3/4)/ 不接 initiate(3DS-5b)/ 不弱化 markCharged·confirm·pending_invoices 冪等 / 不採信 notify·hint(一律 Record 反查、hint 須 Record 驗)/ 讀 RPC 不回 PII·經銷價·token / 不走 findTotal 做 server 對帳 / **不用 getChargeAttemptStore() 給 cookieless 路徑**(會 throw)/ amount 整數零浮點 / 短路嚴格 `=== 'paid'` / recordPendingInvoice throw 不翻 paid / 不 git add . / 不自動 push。

## 11. eslint boundaries（餵關卡1、R 跨層）

`docs/decisions/0002`:domain→∅ / ports→domain / **use-cases→domain+ports** / adapters→domain+ports。settle-charge.ts(use-case) 只 import `@pcm/domain`+`@pcm/ports` ✓;findActiveByOrderId/recordPendingInvoice 實作在 adapters ✓;cookieless factory 在 delivery(composition) ✓;讀 RPC 無層。**無跨層違規**。

## 12. 決策點（審查側 關卡1 已答 → 全 A）

```
Q-A record_pending_invoice 進 1b?  A=進(paid 尾 best-effort 冪等、throw 不翻 paid;0c 已建表/RPC)〔已採，§2 step5/§1#4#9〕
Q1 讀 RPC 回傳欄位?               A=§3 那組〔含 C 短路 order_payment_status + A order_id + paid display_id + 對帳 total/currency〕
Q2 findActiveByOrderId 介面歸屬?   A=加既有 IChargeAttemptStore 主軌-only〔連帶解 B 寫路徑主軌-only + cookieless deps〕
Q3 「2/3 退款」態?                A=pending+告警不放行〔S2=B〕
```

## 13. v1 → v2 delta（審查側 關卡1 6 缺陷折入）

- **A【MAJOR】** paid 漏呼 record_pending_invoice → §2 step5 補 + §1 #4(port)#9(adapter)+ §8 測⑧;authority master §5 L108。
- **B【major】** cookieless 寫路徑 → §4 補「寫」主軌-only(fallbackToken 主軌刻意不用、傳 '' 佔位)+ getSettleChargeDeps cookieless factory(§1 #10);禁用 getChargeAttemptStore(§10)。
- **C【minor】** 打 Record 前 `orderPaymentStatus==='paid'` 短路 → §2 step2(嚴格 ===、不 !==unpaid)+ §8 測②;省 rate-limit。
- **D【minor】** 讀 RPC role-hygiene 回歸 assert → §3 補 role_table_grants=0 + role_column_grants=0(對齊 0a/0c/S2-c/S2-d)。
- **E【minor】** 測試具名殘餘態 + R4 漏 hint → §6 補 hint 順位、§8 ①-⑪ 具名。
- **F【minor 鐵則11】** controlled-promise 字面 → §8 界定斷言對象=邏輯分支、DB 序列化靠 migration assert + codex/MCP,不寫「測了防雙扣」。

- **C×A【minor、v2 關卡1 複審追加】** paid 短路切斷 step5 待開票重試 → §2 step2 短路路**也呼** recordPendingInvoice(冪等自癒)+ §8 測⑧擴。

> 關卡1 狀態:**v2 PASS**(審查側 6 缺陷 + C×A 複審通過、B/A 真碼驗實)→ 落 code → 三綠 + code-reviewer PASS + 🔴 codex 關卡2 round1。

## 14. codex 關卡2 round1 findings 折入(FAIL→修)

- **#1/#3/#7【識別+金額閘】** 原僅驗 order_number、未驗本機 rec/bank 與 amount,且 amount 只擋 paid 不擋 failed → 誤命中他單可誤釋鎖放行重刷=雙扣。修:新增 **`recordMatchesOrder` 共用閘**(order_number + 本機 rec/bank 對 Record + amount/currency 嚴格)、**任何 terminal(paid/failed)前必過**;classifyRecordStatus 不再自驗金額。+ merchant:adapter `recordQuery` 補 **wire 完整性 fail-closed**(每筆 merchant_id 必本商戶、否則 throw)。
- **#2【findActiveByOrderId fail-closed】** 讀 throw 未 catch → settleCharge reject(route 500)。修:step1 try/catch → pending:record_unreachable + 測。
- **#4【markFailed fail-closed】** markFailed throw 未收斂 → reject。修:explicit_failed 路徑 try/catch → pending:record_unreachable(不誤回 failed)+ 測。
- **#8a【字面 vs 事實 檔清單】** plan §1 漏列 index.ts/confirm-payment.test.ts、數字不符 staged。修:§1 補全 15 檔 + STATUS 隨 commit。
- **#8b【字面 vs 事實 時間窗】** code 宣稱 order_number 窗 moot 但真權威 spec 要窄窗。修:**實作時間窗**(RPC 回 attempt_created_at → ActiveChargeAttempt.attemptCreatedAt → recordMatchesOrder 對弱識別〔hint/order_number〕套 24h 窗、缺交易時間 fail-closed)+ 測;不單方改 spec。
- **PASS 不動**:A+C×A 待開票鏈、B cookieless 寫路徑。

> round1 全修 → 重跑三綠 + full vitest + MCP 重模擬(含 attempt_created_at)→ codex 關卡2 round2。

## 15. codex 關卡2 round2 findings 折入(FAIL→修;**2 輪硬上限到底、round3 不跑**)

round2 複審:round1 的 6 修全 PASS(fail-closed×4 / merchant 完整性 / paid 不漏金額 / A+C×A+B 回歸無破)。新 2 must-fix:
- **#8b-2【單向時間窗】** 原 `Math.abs(±24h)` 對稱窗 → 允許 Record 交易落在 attempt「前」24h,舊 hint 回來會誤命中同單舊交易 → 誤釋鎖放行重刷=雙扣。修:withinAttemptWindow 改**單向**(`record_time >= attempt − 5min 時鐘偏移` 且 `<= attempt + 24h`)+ 測「弱識別 + 交易在 attempt 前 1h → pending 且不 markFailed/markCharged」。
- **#8a-2【plan 檔清單 vs staged】** §1 漏列 ChargeAttemptStoreWithFallback.test.ts、STATUS 未 staged。修:§1 補 #8b 列 + STATUS 隨本 commit 7 欄同更同 stage(達 16 檔一致)。

> **2 輪硬上限到底**:codex 關卡2 round2 後**不跑 round3**(skill 紀律);round2 兩 must-fix 已修(單向窗=安全要害、檔清單=字面 vs 事實)→ 交審查側獨立逐行 + MCP + 其自跑 codex 為第二閘複核安全要害;Sean 手動推為最終 checkpoint。
