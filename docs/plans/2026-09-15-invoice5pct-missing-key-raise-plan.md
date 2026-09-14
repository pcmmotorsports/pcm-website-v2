# 2026-09-15 · 手動建單「開發票」缺鍵改回 RAISE —— plan(⟦b4-INVOICE5PCT⟧ ⑩)

> 窗 B 第 24 件 #3。**碰 schema(`admin_create_manual_order` 新一代)⇒ 鐵則 8 先寫 plan, 等主視窗 / Sean 批。本 plan 零碼改動。**

## 1. 要修的是什麼(一句話)

員工建手動單時, `p_invoice.requested` **沒送**, DB 會自己填成 `true`(開發票、+5%)。
⇒ 「呼叫端沒送」與「員工明確勾了要開」在 `orders.invoice_requested` 上是**同一個 `true`**, 事後分不出來。

出處:`supabase/migrations/20260915060000_m4b_953_p2_rpcs_call_pcm_order_total.sql:915`
`v_invoice_requested := COALESCE((p_invoice ->> 'requested')::boolean, true);`
(第④代 `20260904251500` 起就是這樣, 當時是**相容期**:舊呼叫端不送這個鍵。板列 ⑩ 逐字「相容期結束後要另一支 migration 把缺鍵改回 RAISE, 還沒有人排」。)

## 2. 相容期結束了嗎(量到的, 不是推的)

| 呼叫端 | 送不送 `requested` | 出處 |
|---|---|---|
| 後台建單(唯一 TS 呼叫端) | **一定送, 型別 `boolean`** | `apps/admin/src/lib/orders/manual-order-repository.ts:307` `p_invoice: { ...values.invoice, requested: values.invoiceRequested }`;`manual-order-form.ts:377,561` 型別 `invoiceRequested: boolean` |
| `scripts/spec1-apply-probe.sh` | 送(`"requested":true`) | `:107` |
| `supabase/tests/`(pgTAP) | 沒有呼叫 | `grep -rln admin_create_manual_order supabase/tests` ⇒ 0 |
| 其他 SQL 函式 | 沒有(只有它自己每一代的定義) | `grep -rln "admin_create_manual_order(" supabase/migrations` ⇒ 全是定義檔 |

⇒ **今天沒有任何呼叫端會不送。** 缺鍵只會發生在「有人手打 SQL」或「將來新寫一個呼叫端忘了送」。

## 3. 改什麼

新 migration(版本號當場取):`CREATE OR REPLACE FUNCTION public.admin_create_manual_order(...)` 第 12 代。
- **只改一行語意**:缺 `requested` 鍵 ⇒ `RAISE EXCEPTION 'admin_create_manual_order: p_invoice.requested 必填(true / false)—— 沒送就猜 true 會替員工決定開發票 +5%'`。
- 其餘**逐字照抄** `20260915060000` 那一代(`scripts/latest-definition-of.sh admin_create_manual_order` newest)。🔴 那一代是 #953 P2 改的, 同名 RPC 兩窗各開一代的規矩:**版本號晚的必須是聯集** ⇒ 開工前再跑一次 latest-definition, 抄最新那一代。
- 簽章不動 ⇒ `CREATE OR REPLACE`(不 DROP、無 PGRST203);`SET search_path` 整組照抄(`CREATE OR REPLACE` 會把 SET 子句換掉)。
- 前置閘:釘 `20260915060000` 那一代的 `md5(prosrc)`, 對不上就停(有人在中間又改了一代)。
- 後置閘:`prosrc` 含新 RAISE 字面、不含 `COALESCE((p_invoice ->> 'requested')::boolean, true)`;service_role EXECUTE 仍 t、anon/authenticated 仍 f。

TS 零改動(唯一呼叫端本來就送)。

## 4. 影響

- 客人:零(後台建單才走這支)。
- 員工:零 —— 表單本來就送;只有「手打 SQL 建單不帶 requested」會從「靜靜開發票」變成當場報錯。
- 🔴 會紅的測試:任何 fixture 以 SQL 呼它而沒帶鍵的 —— §2 查過 0 支。

## 5. 驗證(做的時候)

拋棄式 PG 依序 apply 到 `20260915060000` 再 apply 本檔:
① 送 `true` ⇒ 建單成功、`invoice_requested = t`、含稅列 +5% 殘差照舊 ② 送 `false` ⇒ `f` ③ **不送鍵 ⇒ RAISE, 而且整筆回捲、orders 列數不變** ④ 送字串 ⇒ 仍是既有那道 RAISE。
三綠 + codex 一輪(錢 + schema, 鐵則 12)。

## 6. Rollback

`supabase/rollbacks/<版本>-rollback.sql`:`CREATE OR REPLACE` 回 `20260915060000` 那一代逐字(前置閘釘本代 md5)。零資料改動 ⇒ 退回無殘留。

## 7. 與 Sean 那一題的關係(不要讀混)

板列 ⑪「那顆勾選預設打勾還是必選」是**畫面預設值**, 要 Sean 拍(已放早上報告)。
本 plan 是 **DB 缺鍵時的預設**, 與畫面預設無關:不論 Sean 拍甲拍乙, 表單都會送一個明確的 true / false。
⇒ 兩件可以分開做, 本件不等那一題。

## 8. 估時

~40 分(抄最新一代 + 一行 RAISE + 前後置閘 + 拋棄式 PG 四發 + codex)。
