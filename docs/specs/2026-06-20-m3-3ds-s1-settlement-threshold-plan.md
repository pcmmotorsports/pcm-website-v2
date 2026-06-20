# 2026-06-20 M-3 3DS S1：settleCharge 成立門檻改（授權即成立）slice plan【定稿 v2】

> **文件性質**：執行 session（寫審分離 ROLE=A）所寫 slice plan = 鐵則 8+12 動手前審查輸入。
> **權威依據**：`docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md`（Sean 2026-06-20 拍「授權即成立 + 請款自動」）。
> **Sean 已拍**：Q1=A（不加 S1 專屬 flag）/ Q2=A（不加 auth_code 縱深）/ Q3=A（收緊弱識別 paid 時間窗下界，見 §4b）。
> **v2 變更**：納入審查側雙扣 finding（case 0 改判 paid 後浮現的弱識別 paid 路徑 pre-attempt 雙扣縫）+ Q3 收緊修法 + §8 縱深倒退分析。
> **狀態**：待 ① 審查 session 跑 codex 關卡1（餵雙扣分析審 plan vs 設計包）② Sean 批 → 才實作。**本 plan 未動 code。**
> **範圍邊界**：只做 S1（成立門檻 + Q3 收緊）。S2-S6 收尾層**不在本 slice**。

---

## ① 任務目標（1-2 句）

(a) 把 `classifyRecordStatus` 成立門檻從「`record_status=1 && is_captured`」放寬為「`record_status ∈ {0 AUTH, 1 OK}` 即成立」，對齊 Sean「授權即成立、請款由收單行自動批次、網站不做 capture」。
(b) **同步收緊（Q3）**：放寬後弱識別 paid 路徑的時間窗下界從 `attempt−5min` 收成 `attempt`，關閉 case 0 改判帶出的 pre-attempt 雙扣縫；**`recordMatchesOrder` 的識別/金額比對一字不動**。

---

## ② 改點精確定位

| 檔 | 位置 | 動作 |
|---|---|---|
| `packages/use-cases/src/settle-charge.ts` | `classifyRecordStatus`（L212-230） | 🔴 主改動：case 0/1 → `paid_candidate` |
| `packages/use-cases/src/settle-charge.ts` | `withinAttemptWindow`（L165-182）+ `SETTLE_CLOCK_SKEW_MS`（L152） | 🔴 Q3：下界統一 = attempt、移除 −5min skew + `forFinalFail` 參數（見 §4b） |
| `packages/use-cases/src/settle-charge.ts` | `recordMatchesOrder` L201 | 🔴 Q3：弱識別時間窗下界收緊（識別/金額比對不動） |
| `packages/use-cases/src/settle-charge.ts` | explicit_failed 二次窗 L101 | 🔴 Q3：pre-attempt 擋拒分支不可達 → 移除 guard（保 markFailed 流程；§4b/§8） |
| `packages/use-cases/src/settle-charge.ts` | L93-94 / L122 / L126 / L154-163 / L214 註解 | 字面 vs 事實同步 |
| `packages/domain/src/payment/types.ts` | L153-156 / L170 / L182-184 / L417 註解 | 字面 vs 事實同步 |
| `apps/storefront/.../tappay-notify/[secret]/route.ts` | L4 註解 | 字面 vs 事實同步 |
| ~~`packages/adapters/src/tappay/wire.ts`~~ | — | 🔴 實核後**不需改**(L64-152 中性 wire/parse 描述、無 is_captured 裁決誤述;code-reviewer 確認) |
| `packages/use-cases/src/settle-charge.test.ts` | 見 §7 | 3 反轉 + 4 新增 |

**不動**：`recordMatchesOrder` 的識別/金額比對（orderNumber/rec/bank/amount/currency）、`buildRecordQuery`、`settlePaid`、`RecordVerdict` 型別、`SettleChargeOutcome` 型別。

---

## ③ record_status 官方 7 值映射：前後對照

官方 7 值（reference.html #record_status，審查側逐字釘死）：
`-1=ERROR / 0=AUTH（授權未請款）/ 1=OK（交易完成）/ 2=PARTIALREFUNDED / 3=REFUNDED / 4=PENDING（待付款）/ 5=CANCEL`。

| record_status | 現判定 | 改後判定 | 變? | 理由 |
|---|---|---|---|---|
| **0 AUTH 授權未請款** | pending（auth_or_pending） | **paid_candidate** | 🔴 變 | 已授權成功 → 授權即成立（Sean 拍） |
| **1 OK + is_captured=true** | paid_candidate | paid_candidate | 不變 | 本來就成立 |
| **1 OK + is_captured=false** | pending（auth_or_pending） | **paid_candidate** | 🔴 變 | OK 即成立、不再要求 captured（設計包 L60「0 或 1 → 成立」） |
| **4 PENDING 待付款** | pending（auth_or_pending） | pending（auth_or_pending） | **不變** | 🔴 **關鍵分界**：4=尚未授權 ≠ 0=已授權 |
| **-1 ERROR / 5 CANCEL** | explicit_failed | explicit_failed | 不變 | 明確失敗 |
| **2 / 3 退款** | refund_anomaly | refund_anomaly | 不變 | Phase 1 無退款流程、告警不放行 |
| 未知碼 | pending（record_unverified） | pending（record_unverified） | 不變 | fail-closed |

🔴 **0 vs 4 是本改動安全核心**：`0 AUTH = 授權成功（未請款）`、`4 PENDING = 待付款（尚未授權）`。只放「已授權」（0/1）成立、「待授權」（4）維持 pending。實測代表單 PCM-2026-0015 停 record_status=0、有 Auth Code 573326 → 方向成立。

**改後 `classifyRecordStatus`（草案）**：
```ts
function classifyRecordStatus(tr: TapPayTradeRecord): RecordVerdict {
  switch (tr.recordStatus) {
    case 0: // AUTH 授權成功未請款 → 授權即成立（Sean 2026-06-20；請款由收單行自動批次、網站不做 capture）
    case 1: // OK 交易完成 → 成立（不再要求 is_captured；設計包 L60「0 或 1 → 成立」）
      return { kind: 'paid_candidate' };
    case 4: // PENDING 待付款（尚未授權）→ 維持 pending（≠ 0 AUTH）
      return { kind: 'pending', reason: 'auth_or_pending' };
    case -1: // ERROR
    case 5: // CANCEL 取消交易
      return { kind: 'explicit_failed' };
    case 2: // PARTIALREFUNDED
    case 3: // REFUNDED
      return { kind: 'refund_anomaly' };
    default:
      return { kind: 'pending', reason: 'record_unverified' };
  }
}
```
> `tr.isCaptured` 在裁決中**不再被讀**，但**保留欄位 parse（wire.ts）+ 型別**：留未來精準帳務 `authorized`/`captured` 兩段（設計包 L43）；不刪、避免擴 scope。
>
> 🔴 **歷史檔 supersede 註記（codex 關卡2 r1 consider）**：本 S1（2026-06-20）已 **supersede** 以下歷史 plan/migration 中「`record_status=1 && is_captured` 才 paid」的舊成立門檻字面 —— `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md`（L6/137/177）、`2026-06-14-m3-3ds-1b-settlecharge-plan.md`（L132）、`2026-06-13-m3-3ds-2-route-plan.md`（L101）、`supabase/migrations/...3ds_0a_webhook_events.sql`（L16）。**已套用的歷史檔不改寫**（保留當時決策快照）；現行門檻一律以本 S1 = `record_status ∈ {0,1}` 為準。

---

## ④a 識別/金額閘保留論證（設計包 L62-63 審查把關）

「放寬成立門檻」只動 `classifyRecordStatus`（record_status → verdict 的最後一步），發生在以下所有閘**之後**：
1. `queryStatus===0 && numberOfTransactions===1 && records.length===1`（L85）— 不動。
2. `recordMatchesOrder`（L89）的**識別/金額比對一字不動**：`orderNumber===orderId`、本機有 rec/bank → 必等於 Record、`amount===orderTotal`（整數）、`currency==='TWD'`。
3. merchant wire 完整性（adapter，每筆 merchant_id 必本商戶否則 throw）— 不動。

🔴 record_status=0（AUTH）新 paid 路徑與既有 record_status=1 paid 路徑**走同一條 `settlePaid`、過同一組識別/金額閘** → 不可能因放寬而誤結他單。§7 以「AUTH + 金額不符 / rec 不符」測試證明閘對 AUTH 態同樣生效。

## ④b 🔴 Q3：弱識別 paid 路徑 pre-attempt 雙扣縫 + 收緊修法（審查側 finding）

**雙扣縫**：case 0（AUTH）改判 paid_candidate 後，弱識別（無 rec/無 bank、走 hint/order_number）paid 路徑浮現一條縫：
- `recordMatchesOrder` L201 呼 `withinAttemptWindow` 用預設 `forFinalFail=false`（下界 `attempt−5min`）→ 會採信「本 attempt 建立前 5 分鐘內、同單的舊 AUTH」→ `classifyRecordStatus=paid_candidate` → `settlePaid` 標單 paid 釋鎖。
- 對照 explicit_failed 釋鎖路徑 L101 早已硬化為 `forFinalFail=true`（下界 `attempt`、零 pre-attempt 偏移），**paid 側漏了同款硬化**。
- 端到端目前「非穩定可達」（靠上游 per-order 鎖 + L85 count guard 兜底，見 §8），但屬**防禦縱深倒退** = 安全性外包給遠處不變式；任一上游不變式未來被改鬆即直接浮現雙扣。鐵則 12（payment/雙扣）+ 鐵則 8 命中。

**收緊修法（Q3=A）**：弱識別時間窗下界**統一收成 `attempt`**（零 pre-attempt skew），對齊 explicit_failed：
- `recordMatchesOrder` L201 的 `withinAttemptWindow` 下界改 = attempt。
- 因 L101（explicit_failed）與 L201（recordMatchesOrder）下界統一 → **移除 `forFinalFail` 參數 + `SETTLE_CLOCK_SKEW_MS` 常數**（消除不對稱與 dead branch；§6 死碼分析）。
- explicit_failed 二次窗 L101 的 **pre-attempt 擋拒分支** 在 recordMatchesOrder 收緊後 **不可達**（弱識別 pre-attempt 在 L89 已被 recordMatchesOrder 以相同下界擋、`return pending:record_unverified`，到不了 classifyRecordStatus/L101 那道 guard；🔴 codex 精準：explicit_failed 的 **post-attempt / 強識別路徑仍正常走 markFailed**，只是該二次窗 guard 永不觸發）→ **移除冗餘 L101 guard**，但 explicit_failed 分支（現 L96-111）**務必保留 markFailed + catch fail-closed（throw → pending:record_unreachable）+ return failed**；同步清掉 L96-100 forFinalFail 釋鎖硬化的內聯註解（概念已移除、字面 vs 事實）。安全縱深前移到 recordMatchesOrder（**涵蓋 paid + failed 雙 terminal**，比原本只在 explicit_failed 補嚴更全面）。
- 這是審查側「L201 改傳 forFinalFail=true 等義（下界=attempt、移除 −5min skew）」的徹底實現。

**🔴 零回歸論證（審查側補強，必寫進 plan）**：弱識別窗的觸發前提 = bank_txn 尚未寫、begin 後數百毫秒。此窗內**本 attempt 自己的 charge 根本還沒上 TapPay** → Record 反查撈到的同單交易「必是」pre-attempt 舊交易；本 attempt 一旦真 charge 即取得 rec/bank → 轉**強識別、走無時間窗的強識別路徑**。故**在目前 3DS bank_txn 於 charge 前先 durable 的 invariant 下**，`−5min` 對弱識別 paid「**純擋有害、零合法用途**」，收緊是**純安全增益、不誤擋任何合法自癒**。（🔴 鐵則 10 可維護性：此論證綁定「bank_txn charge 前 durable」前提；未來若改 initiate 順序須重核此句、withinAttemptWindow 內聯註解同步加此限定。）

**改後 `withinAttemptWindow`（草案）**：
```ts
const SETTLE_WINDOW_FORWARD_MS = 24 * 60 * 60 * 1000; // attempt 後 24h
// 🔴 下界 = attempt（零 pre-attempt 偏移）：在 bank_txn 於 charge 前先 durable 的 invariant 下，弱識別窗內
//    本 attempt 的 charge 尚未上 TapPay → Record 撈到的同單交易必是 pre-attempt 舊交易；採信會誤釋鎖放行
//    重刷 = 雙扣（Q3、審查側）。paid/failed 同款硬化。
function withinAttemptWindow(recordTimeMillis: number | undefined, attemptCreatedAt: string): boolean {
  if (recordTimeMillis === undefined) return false; // 弱識別無交易時間 → fail-closed
  const attemptMs = Date.parse(attemptCreatedAt);
  if (Number.isNaN(attemptMs)) return false;
  return recordTimeMillis >= attemptMs && recordTimeMillis <= attemptMs + SETTLE_WINDOW_FORWARD_MS;
}
```
> **備案（交 codex 關卡1 定奪）**：若審查側偏好保留 `forFinalFail` 參數作語意標記（最小 diff），則 L201 傳 `true`、保留 L101——但 `forFinalFail=false` 即成 dead branch、`SETTLE_CLOCK_SKEW_MS` unreachable。我**推薦移除**（消死碼、降不對稱複雜度、縱深前移涵蓋雙 terminal）。

---

## ⑤ paid 收斂路徑對 AUTH 態（settlePaid 不改）

AUTH（record_status=0）→ `paid_candidate` → `settlePaid`：
- `markCharged({recTradeId: tr.recTradeId, fallbackToken: ''})`：attempt pending→charged。`tr.recTradeId` 由 wire.ts 保證非空（缺 → parse throw）；AUTH 態 Record 有 rec（實測 D20260620FWJUJX）。
- `confirm({amount: attempt.orderTotal})`：order unpaid→paid（冪等）。RPC 內 PF-X3 再驗 `amount===orders.total`，與 §4a 金額閘一致。
- `recordPendingInvoice`：best-effort 待開票。

「授權即成立」= 視同已收款，markCharged + confirm 標 paid 語意正確。**settlePaid 一行不改。**

---

## ⑥ 牽連面 + 死碼分析（grep 實證）

| 對象 | 現況 | S1 處理 |
|---|---|---|
| `classifyRecordStatus` | settle-charge.ts 內部、不 export | case 0/1 改點 |
| `isCaptured`（裁決） | 僅 classifyRecordStatus 讀 | 不再讀 |
| `isCaptured`（parse/型別） | wire.ts parse + 型別 L171 | **保留**（留兩段帳務） |
| `withinAttemptWindow` | L101(true)+L201(false) 兩呼叫點 | L201 收緊；移除 forFinalFail 參數 |
| `SETTLE_CLOCK_SKEW_MS` | 僅 withinAttemptWindow false 分支用 | 🔴 收緊後 false 分支無呼叫點 → **移除常數**（否則 unreachable dead branch） |
| explicit_failed L101 guard | recordMatchesOrder 後二次窗 | 🔴 pre-attempt 擋拒分支不可達 → **移除 guard**（保 markFailed） |
| `markFailed` 呼叫點 | confirm-payment.ts:74 + settle-charge.ts:107 | 不動（L107 仍在；前提皆與 AUTH 無關，§8） |
| sweep-settlements.test | record_status 4/5/1&&captured | 無 0 或 1&&!captured pending 斷言 → 不破壞；full vitest 驗 |

**字面 vs 事實同步清單（鐵則 11）**：
- `settle-charge.ts`：L93-94 / L122 / **L126**（settlePaid 上方「record_status=1 && is_captured && 金額/幣別符」→ 改述新門檻）/ L154-163（withinAttemptWindow 不對稱下界註解 → 改統一下界 + Q3 論證）/ **L214**（case 1「須已 captured 才算 paid」→ 改「不再要求 is_captured」）。
- `domain/types.ts`：L153-156 / L170（isCaptured 欄位「配 record_status=1 才算 paid」）/ L182-184 / L417（auth_or_pending 描述）。
- `route.ts` L4：把「record_status=1 && is_captured 才 paid」改述為「record_status ∈ {0,1} 即成立、is_captured 不再為門檻」。
- 🔴 `wire.ts`：**實核後不需改**(L64-152 為中性 wire/parse 描述、列必要欄 + 官方 7 值逐字、無 is_captured 裁決誤述;code-reviewer 確認、消 plan over-claim)。

---

## ⑦ 回歸測清單（settle-charge.test.ts）

**A. 必改（行為反轉）**：
1. `record_status=0（AUTH）`（現 L174-177，斷 pending）→ 改斷 **paid**（走 settlePaid 全鏈：markCharged/confirm/recordPendingInvoice 以 `tr.recTradeId`）。
2. `record_status=1 && is_captured=false`（現 L182-185，斷 pending）→ 改斷 **paid**。
3. 弱識別 + record_status=1 paid + pre-attempt 3min（現 L296-302，斷 paid）→ 🔴 收緊後改斷 **pending:record_unverified**（移除 paid 自癒 skew）。

**B. 必守（不變回歸護欄）**：
4. `record_status=4（PENDING）→ pending:auth_or_pending`（L178-181）：🔴 證「0 反轉但 4 守住」。
5. happy `record_status=1 && is_captured → paid`（L92）。
6. `-1/5 強識別 → markFailed → failed`（L186-197）。
7. `2/3 → refund_anomaly → pending:record_unverified + 告警`（L198-209）。
8. 識別/金額閘全測（L150-171、L241-256）。
9. 強識別超窗仍 paid（L310-313，強識別不套窗）。

**C. 新增（審查側 §4 四案 + 設計包 L62 把關）**：
10. **【審查 ①】** 弱識別 + record_status=0（AUTH）+ pre-attempt（attempt−2min）→ 收緊後 **pending:record_unverified**，markCharged/confirm/markFailed **皆不呼**（不走 settlePaid）。
11. **【審查 ②】** 弱識別 + record_status=0（AUTH）+ 交易時間 ≥ attempt（本 attempt 自己 charge）→ **paid**（走 settlePaid）。
12. **【審查 ③】** L85 count=2（`numberOfTransactions=2`/`records.length=2`）→ **pending:record_unverified**，markCharged/markFailed 皆不呼（短路、永不進 classifyRecordStatus）。
13. **【審查 ④】** explicit_failed 既有下界（pre-attempt 3min record_status=5 → pending + 不 markFailed）**不得回歸**：保留現 L285-295（收緊後擋拒點從 L101 前移到 recordMatchesOrder L89，回傳值/副作用不變 → 仍 pass）。
14. **【設計包把關 §62-63 四閘齊】** record_status=0（AUTH）強識別 + rec/bank/amount/currency 全符 → paid；AUTH 強識別 + **rec 不符** → pending:record_unverified；AUTH + **bank 不符** → pending:record_unverified；AUTH + **amount 不符** → pending:record_unverified；AUTH + **currency 不符** → pending:record_unverified（湊滿 AUTH 態四閘、證放寬不弱化識別/金額閘）。

**D. 跨檔**：完整 `pnpm test`（非單檔），確認 `sweep-settlements.test.ts` 無 cross-effect。

---

## ⑧ 🔴 縱深倒退分析（審查側明確要求）

case 0 改判 paid 後，弱識別 paid 路徑雙扣縫「目前非穩定可達」，是因下列**上游不變式兜底**——一旦任一被改鬆即浮現雙扣（安全性外包給遠處）：

| 上游兜底不變式 | 現況 | 風險 |
|---|---|---|
| per-order partial-UNIQUE 鎖（pending 不釋鎖） | 同單 active attempt 在、begin 擋重入 | 鎖策略改鬆 → 重入 settleCharge |
| `markFailed` 唯二呼叫點（confirm-payment.ts:74 + settle-charge.ts:107） | AUTH 前提皆不觸發（74=同步 charge failed、107=explicit_failed） | 新增釋鎖點 → pre-attempt 誤釋 |
| sweeper 4 RPC 零改 order status | sweeper 只透過 settleCharge 收斂 | sweeper 直改 status → 繞過閘 |
| L85 count guard（numberOfTransactions/records.length===1） | 多筆 → 短路 record_unverified | count guard 放寬 → 多筆誤採 |

🔴 **收緊後（Q3）**：弱識別 paid/failed 雙 terminal 路徑的 pre-attempt 防線**改為函數層自身關閉**（recordMatchesOrder L89 統一下界 = attempt，在識別閘一次擋掉 paid + failed 兩條 terminal 的 pre-attempt 弱識別），**不再僅靠上游不變式兜底**。L85 count guard 降為加強驗證（§9 Q4），失效也不雙扣。

---

## ⑨ 決策題（Sean 已拍 / 後置）

```
Q1（rollback 粒度）= A：不加 S1 專屬 flag，靠既有 TAPPAY_3DS_ENABLED gate + git revert 純函數單點。【已拍】
Q2（AUTH 縱深）= A：不加 auth_code 欄位，信任官方語意「0=授權成功」+ 既有金額/識別/時間窗閘。【已拍】
Q3（弱識別 paid 時間窗）= A：下界收成 attempt、移除 −5min skew、對齊 explicit_failed。【已拍，見 §4b】
Q4（TapPay count guard sandbox 實證）= 後置/backlog：Q3=A 使函數層自防、count guard 失效也不雙扣
   → 實證降為「加強驗證」、非 S1 前置。列 S1 後置或 backlog，不阻 S1。
```

---

## ⑩ 禁止清單（基線 + S1 專屬）

- 不動 `recordMatchesOrder` 的識別/金額比對（orderNumber/rec/bank/amount/currency）、`buildRecordQuery`、`settlePaid`、`RecordVerdict`/`SettleChargeOutcome` 型別。
- 不做 S2-S6 收尾層（callback 輪詢 / 鎖釋放 / 訂單顯示 / email / sweeper cron）。
- 不刪 `isCaptured` 欄位 parse / 型別。
- 不改 env / deployment / schema / migration / vercel.json。
- 不開 prod checkout flag。
- 不 `git add .` / `-A`（精準 add）；不自動 push；不動 `.env*`。
— 禁止清單結束 —

---

## ⑪ 收工流程（鐵則 11 + 12）

1. 實作：classifyRecordStatus（case 0/1）+ withinAttemptWindow 收緊（移 skew/forFinalFail）+ 移除冗餘 L101 + 註解同步 + 測試（A 反轉 3 + C 新增 4）。
2. 三綠 `/slice-checkpoint`（typecheck + lint + build）+ 完整 `pnpm test`（驗 sweep 無 cross-effect）。
3. `code-reviewer` subagent。
4. 🔴 codex 雙關卡（鐵則 12 結算核心硬要求）：審查 session 跑關卡1（plan + 雙扣分析）+ 關卡2（diff），每關卡硬上限 2 輪。
5. commit（精準 add、STATUS 7 欄同 commit〔含「當前 slice→3DS-S1」〕、busboy-end）、**不 push**。

---

*執行 session（寫審分離 ROLE=A）／2026-06-20 定稿 v2*
