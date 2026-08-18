# Plan — M-4a **B-5:`order_created` 通知信 enqueue**(2026-08-18 G4 重寫版)

> ⚠️ **未批准。** 命中 **鐵則 8** + **鐵則 12 ①錢 / ②權限**(要動 `service_role` 的使用面)⇒ 提 plan 等 Sean 批。
> ✅ **`Q-G4-1` Sean 2026-08-18 14:0x 已拍 = 甲(掃描式)**(逐字「甲、甲、甲、甲」四題共用;主視窗轉)。
> 🔴 **他批的是【一個對 PRD §3.2 的偏離】,不是只批一個做法** ⇒ **PRD §4 B-5 的契約本體要標註**,
> 否則下一個讀 PRD 的人會把這個實作當成違約(已於本次同時標,見 PRD `:118` 那一列)。
> ⚠️ **plan 本體仍未批**(動 `service_role` 使用面 + 鐵則 8)。
> 🔴 **硬前置:B-4 先上**(`docs/specs/2026-08-18-m4a-b4-persist-notification-email-plan.md`)。B-4 沒上,本片撈到的每一筆 `notification_email` 都是 NULL。
> **真權威**:PRD `docs/specs/2026-07-18-b0-order-notification-email-prd.md` **§3.2(觸發與失敗語意)/ §4 B-5 列 / §5 R3 / §6 gate / §7 PII**。
> **量測環境**:主樹 `/Users/sean_1/pcm-website-v2`,branch `dev` @ `34d1754e`,2026-08-18 13:3x CST(行號當場量)。

---

## 1. 契約(逐字,不要重新發明)

```
PRD §4 B-5   :「enqueue 掛 §3.2 兩個匯聚點;付款優先、全 catch;**可部署但不得宣稱功能上線**(gate 見 §6)」
PRD §3.2 失敗:「付款結果優先;enqueue 全 catch 不上拋;缺列由 C-1 對帳補寄 + 訊號 4 告警兜底」
PRD §3.2 NULL:「訂單欄 NULL → 取 customers.email → 既有 isSyntheticEmail 閘 → 合成域落 skipped_no_real_email」
PRD §7 PII   :「log／告警／錯誤訊息／回應 body 一律禁帶 email 原值」
```
🔴 **`可部署但不得宣稱功能上線` 是這片的交付定義** ⇒ 前一版審查的 `F5`(「做完仍一封不寄」)
**不是缺陷,是【設計好的落點】**(FRAME-2)。缺的只是把它明列出來 ⇒ 見 §7。

## 2. ✅ 掛哪裡:**Sean 已拍甲(掃描式)** —— 本節留著,因為【為什麼不是乙】是實作時會一直被問的那件事

**甲(推薦)· 掃描式**:在既有 `api/cron/email-sweep` route **前面加一步**,
掃「已 paid 但 outbox 沒有 `order_created` 列」的單 → enqueue。**結帳路徑一行都不動。**

**乙 · 照 PRD 字面內嵌**:掛進 `confirm-payment.ts` 與 `settle-charge.ts` 兩個 use-case、`confirmer.confirm` 成功之後。

| | 甲(掃描) | 乙(內嵌,PRD 字面) |
|---|---|---|
| `service_role` 進到哪 | 只進 email cron 的 composition(**那裡本來就有**,`apps/storefront/src/lib/email/composition.ts:47`) | 🔴 **進結帳路徑**:`ConfirmPaymentDeps`(`confirm-payment.ts:34`)/`SettleChargeDeps`(`settle-charge.ts:41`)+ **11 條路徑的 deps 建構全要動** |
| `settleCharge` 那半有沒有權限的路 | 不需要(掃描自己讀) | 🔴 **沒有**:`settleCharge` 走 `payment_confirmer`、**零 table 權限**且由 apply 期斷言強制 ⇒ 只能擴 RPC(破它「只回非 PII 對帳欄」的契約)或把 service_role 注進金流脊椎 |
| 拿不到 `paid_at` / `display_id` 的問題 | 不存在(掃描直接 select) | 要新增一支 port + 成交後補讀一次 orders |
| 首次 enqueue 失敗 | **下一輪自己再撈到**(天然可重入) | 🔴 **零救濟**:`settle-charge.ts:71-72` 第二個 `kind:'paid'` 短路 ⇒ 之後每次重入都不會再 enqueue,而 PRD 說的 `C-1` 兜底**沒有實作** |
| 客人收到信的延遲 | 一輪(pg_cron `*/5` ⇒ ≤5 分) | 秒級 |
| 對 PRD | 🔴 **對 §3.2「掛兩個匯聚點」的申報偏離**(要 Sean 批) | 逐字照做 |
| 片的大小 | 1 個 use-case + 1 個查詢 + route 一步 | 2 個 use-case + 1 port + 1 adapter + 11 條 deps + 11 格入口測試 |

🔴 **推薦甲的理由不是省事,是【乙的三條缺口沒有便宜的解】**:
`F2`(權限死路)、`F4`(把 `SUPABASE_SERVICE_ROLE_KEY` 變成結帳路徑的相依)、`V1`(首次失敗零救濟)。
**甲把三條一起消掉**,代價是「信晚 5 分鐘」與「一條要申報的 PRD 偏離」。
⚠️ **甲不是繞過 PRD,是把 PRD 自己 §6 gate #2 的 `C-1`(NOT EXISTS 對帳補寄)當成主路徑而不是備援。**

~~**以下 §3 起全部以【甲】書寫。Sean 選乙 ⇒ 本檔作廢重寫。**~~
✅ **他選了甲** ⇒ 下面就是要做的東西。乙那一欄留著當對照,**不要刪** ——
出事那天有人會問「為什麼不掛在付款當下」,答案在那一欄裡。

## 3. 範圍(甲案)

| 檔 | 改動 |
|---|---|
| 新 `packages/use-cases/src/enqueue-order-created-emails.ts` | 掃描 + enqueue(≈60 行) |
| 新 `packages/ports/src/IPaidOrderScanner.ts` | 一支窄 port:`listPaidWithoutOrderCreatedEmail(cutoff, limit)` → `{ orderId, displayId, paidAt, notificationEmail, customerEmail }[]` |
| 新 `packages/adapters/src/supabase/SupabasePaidOrderScannerAdapter.ts` | 兩個查詢(見 §4),service_role client |
| `apps/storefront/src/lib/email/composition.ts` | 加 `getEnqueueOrderCreatedDeps()`(**只要 outbox + scanner,不要 Resend**) |
| `apps/storefront/src/app/api/cron/email-sweep/route.ts` | 認證/限流之後、`sweepEmailOutbox` **之前**插一步 enqueue |
| 測試 | 見 §6 |

**明確不動**:`confirm-payment.ts` / `settle-charge.ts` / `charge-actions.ts` / 任何金流路徑 /
`SupabaseEmailOutboxAdapter`(含 `isSyntheticEmail`)/ migration / `vercel.json` / RLS / 金額 / tier。

### 3.1 🔴 為什麼 enqueue 要在 `sweepEmailOutbox` **之前**、且用**自己的 deps**

`getSweepEmailOutboxDeps()` 會 `requireEnv('RESEND_API_KEY')`;缺 ⇒ throw ⇒ route 503。
若 enqueue 共用它,**Resend 還沒設 env 的期間連「排進 outbox」都不會發生**。
⇒ 分開的 deps + 先跑 enqueue ⇒ **信先排進去、寄的那半晚點再開**,兩件事互不綁死。

## 4. 掃描怎麼寫(零 migration)

```
① select id, display_id, paid_at, notification_email, customer_user_id
     from orders
    where payment_status = 'paid' and paid_at >= <cutoff> and created_at >= <cutoff>
    order by paid_at asc  limit <N>
② select order_id from email_outbox where event_type = 'order_created' and order_id in (①的 id)
③ 差集 → 對每一筆:recipient = notification_email ?? customers.email(該 customer 的)
   → outbox.enqueue({ orderId, displayId, paidAt, recipientEmail })
```
🔴 **`cutoff` 同時卡 `paid_at` 與 `created_at`,是 PRD §5 R3 明文**(舊單在 cutoff 之後才晚翻 paid 會被誤納入「應該有信」的集合)。
🔴 **`cutoff` = flag 實際開啟時戳,不是部署時戳**(PRD §5 R3 已釘死,兩者極易弄反)。
   **本片的 cutoff 取值 = B-4 部署上線的時戳**(因為 B-4 之後才有真值可存)⇒ **由 Sean 在開啟時記錄、寫進 env 或常數,本片不代填。**
⚠️ **`limit` 與 cutoff 都是 route 端常數,零 client 輸入**(鏡像 email-sweep route 的紀律)。

### 4.1 `V2` / `F13`:全不合格時**照 PRD 落一列**,不是靜默跳過

前一版寫「全不合格 ⇒ 不 enqueue + 一行 log」—— 那是**對 PRD §3.2 的未申報偏離**。
本版:**照樣呼 `enqueue`**,由 adapter 既有的閘決定終態:
```
SupabaseEmailOutboxAdapter.ts:198,208,222  isSyntheticEmail ⇒ status='skipped_no_real_email' 落一列
```
⇒ **有一列查得到的痕跡**,而不是一行沒有人在看的 log。
⚠️ 兩個候選都是 NULL / 空字串(理論上 B-4 之後不該發生)⇒ **不 enqueue、計數 +1**,計數進 route 的 counts-only 回應。
🔴 **counts-only、零 PII**(PRD §7)。

### 4.2 `F12`:adapter 的合成域閘比 schema 窄 —— 本片為什麼仍然不修它

```
packages/schemas/src/notification-email.ts     認子網域 + 去尾點(寬)
packages/adapters/.../SupabaseEmailOutboxAdapter.ts:163  只做完全等值比對(窄)
```
⇒ `x@sub.line.pcmmotorsports.local` 這種值,**schema 擋得住、adapter 擋不住**。
本片之後 **`enqueue` 的生產呼叫點只有一個(本掃描)**,而掃描的兩個來源都受 DB CHECK / 註冊驗證管
⇒ **今天沒有可達路徑把子網域合成值餵進 adapter。**
🔴 **但這是「今天沒有」不是「不會有」** ⇒ 列進 §7 誠實揭示 + backlog,**不在本片修**(改 adapter 的閘會動到已驗證過的狀態機)。

## 5. 失敗語意

- 掃描/enqueue 整段的例外**不影響任何付款路徑**(本片不在付款路徑上)。
- 單筆 enqueue 失敗 ⇒ 計數 +1、**不中斷整輪**;**下一輪會再撈到它**(差集是即時算的)。
- 整輪有失敗 ⇒ route 回 **503 + counts**(鏡像既有 email-sweep 紀律:壞掉的 sweeper 不可吞成 200)。
- 🔴 **不得使用 `fail-closed` 這個詞**(PRD 明文:相反語意)。

## 6. 驗證(不降級)

三綠 `TURBO_FORCE=1` + vitest(自己跑)。

| # | 斷言 | 突變(必須紅) |
|---|---|---|
| 1 | 已 paid 且 outbox 無列 ⇒ **enqueue 被呼叫,且 `recipientEmail` = orders 那個具體值** | 把差集算反 |
| 2 | 已 paid 且 outbox **有**列 ⇒ **零呼叫**(不重複寄) | 拿掉差集過濾 |
| 3 | `notification_email` 為 NULL ⇒ 用 `customers.email`(PRD §3.2 fallback) | 拿掉 fallback |
| 4 | fallback 是合成域 ⇒ 落 `skipped_no_real_email` **一列**(不是靜默跳過) | 改回「不 enqueue + log」 |
| 5 | `paid_at` / `created_at` 早於 cutoff 的舊單 ⇒ **不撈** | 拿掉 `created_at` 那半(PRD §5 R3 那一格) |
| 6 | 單筆 throw ⇒ 其餘照跑、`errors` 計數 +1、route 503 | 把 per-item catch 拿掉 |
| 7 | route 回應**只有數字**、零 email 字面 | 把 recipient 塞進回應 |
| 8 | 缺 `RESEND_API_KEY` ⇒ **enqueue 仍然跑完**(§3.1) | 讓 enqueue 共用 sweep 的 deps |

🔴 **`#633` 驗收條款照抄不改**:❌「outbox 有列 = 成功」不可寫(`recipient_email` 為 null 時那一列照樣進得去,
在兩個世界印同一個東西);✅ 斷言 **`recipient_email` 不是 null 且等於某個具體值**。
🔴 **每加一道斷言當場配一發突變** —— 不配的話「我加了守門」與「守門恆綠」長得一樣。

## 7. 🔴 誠實揭示(本片做完之後,世界是什麼樣子)

1. **一封信都不會寄。** `email-sweep` route 的 firing 由 **E2b 的 pg_cron 是否存在**控制(route 檔頭逐字「本片不進 `vercel.json` crons…天然開關」),而當場量:
   ```
   grep -c crons vercel.json                    ⇒ 0（分母 6 行）
   grep -rn "cron.schedule" supabase/migrations ⇒ pcm-settle-sweep / pcm-anomaly-alert / pcm-expire-unpaid-orders
                                                   （查無 email 相關 job）
   ```
   ⇒ **這是 PRD §6 gate #1 的原文狀態,不是本片的缺陷。**
2. **出貨通知信仍然一封不會寄**(`order_shipped` 卡 E4 模板,`packages/use-cases/src/sweep-email-outbox.ts:113` throw)。那一半有主人:`docs/specs/2026-08-17-qc9-tracking-to-customer-plan.md` 的 `C9-b`。
3. **「通知孤兒已消滅」不得宣稱**(要 C-2 Resend bounce webhook,PRD §1)。
4. **`C-1` / `A-1` 告警仍然沒有實作**(PRD §6 gate #2/#3)⇒ 本片的可重入吸收了 `C-1` 的補寄功能,**但沒有做「有 paid 沒 outbox」的告警**。
5. **PII**:`email_outbox.recipient_email` 保留 **120 天**(PRD §7,Sean 2026-07-18 拍),清理 job `#281` **本片不做**。
6. **`customers.email` 是註冊當下的凍結快照**(`handle_new_auth_user` 只掛 `AFTER INSERT`,全樹零 UPDATE 同步)⇒ auth email 改過的客人,fallback 拿到的是舊值。**照 PRD 做,缺口登記在此。**
7. **`F12` 的窄閘縫**(§4.2)未修。
8. ⚠️ **未量**:`RESEND_API_KEY` / `ORDER_EMAIL_FROM` 在正式站的現值(repo 側無管道)。缺值行為已查:sweep route ⇒ `requireEnv` throw ⇒ 503。

## 8. rollback

零 migration ⇒ `git revert` + 重部署。已排進 outbox 的列**不刪**(`dedup_key` 保證不重複寄)。

## 9. 送審指示(FRAME-1,硬要求)

派審查時,**把 PRD §3.2 / §5 R3 / §6 的內文直接貼進 prompt**,連同本檔全文。
**只貼檔名或檔頭,審查者看不到同一批契約** —— 上一輪就是這樣漏掉 V1/V2 兩條 must-fix。
🔴 並在 prompt 裡明寫:**「本片的契約是『可部署但不得宣稱功能上線』,請不要把『做完仍不會寄信』當成缺陷報回來。」**

## 10. 估時

use-case + adapter + composition + route 一步 ≈ 35 分鐘;8 格測試 + 8 發突變 ≈ 35 分鐘 ⇒ **≈ 70 分鐘 ⇒ 超過鐵則 4 上限,實作時切兩段**(段一:use-case + port + adapter + 測試;段二:composition + route + 測試)。
