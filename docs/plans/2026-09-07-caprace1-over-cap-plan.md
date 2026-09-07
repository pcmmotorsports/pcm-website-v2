# `⟦b4-CAPRACE1⟧` 實作 plan(Sean 2026-09-02 `Q1 = 甲`;鐵則 8 因為要動 schema ⇒ **只 plan, 本次零改動**)

## 0. 拍板逐字(不是轉述)
`~/pcm-mailbox/拍板-20260902-06題.md` `Q1` ⇒ **甲** ——
「記得下來但標紅 ⇒ 帳一定跟得上事實, 而超出的那筆看得到」。同節寫著「動 DB 函式 ⇒ 鐵則 12①③ ⇒ codex 不省」。

## 1. 要改哪一行(開檔核過)
`supabase/migrations/20260831010000_m4b_866_manual_refund_raise_plaintext.sql`
· 函式 `public.pcm_manual_refund_rail_cap_guard()`(`:66` `CREATE OR REPLACE`)
· 判斷在 `:153` `IF NEW.refund_amount > v_headroom THEN` ⇒ `:165` `USING ERRCODE = 'PCM01'`
⇒ **甲 = 這裡不再 `RAISE`, 改成讓那一列進去而且標得出來。**

## 2. 🔴 一個真的設計岔路 —— 我不自己選
關閉條件② 逐字是「**那一列要標得出來(欄位或旗標, 讓超收看得見)**」。而 `order_manual_refunds`
**今天 12 個欄位裡沒有任何一個可以拿來標**(唯讀查得:`id/order_id/rail/refund_amount/reason/actor/occurred_at/created_at/voided_at/void_reason/voided_by/request_id`)。

| | 甲 · 加一個欄位 | 乙 · 只寫進 `pcm_incident` |
|---|---|---|
| 動 schema | **要**(`ALTER TABLE ADD COLUMN`, money ledger) | 不用 |
| 標記跟著那一列走 | ✅ 是 | ❌ 不是 —— 事故列與退款列是兩張表 |
| 現成的畫面 | ✅ `apps/admin/src/components/orders/manual-refund-ledger-section.tsx` 已經在列這些列 | ❌ 要另做 |
| 現成的告警 | ❌ 要另接 | ✅ `get_pcm_incident_health` 已經在數 |
| 🔴 已知風險 | 動一張有不可變 trigger 的金流帳本 | ⚠️ **`pcm_incident.resolved_at` 今天零寫入端**(見 `⟦db-INCIDENTRESOLVEUI⟧`)⇒ 事故只進不出 |

**建議 = 甲**(欄位 `over_cap_by integer NULL`;NULL = 沒超過, >0 = 超出幾元)。
理由:②逐字說「**那一列**」, 而乙的標記不在那一列上;且列的畫面已經存在。
🔵 **兩者不互斥** —— 甲做完可以再加乙當告警, 而反過來不行。

## 3. 若走甲, 要帶的東西
· `ALTER TABLE public.order_manual_refunds ADD COLUMN over_cap_by integer`(nullable, 無預設)
  + `CHECK (over_cap_by IS NULL OR over_cap_by > 0)`
· trigger 改:超過上限 ⇒ `NEW.over_cap_by := NEW.refund_amount - GREATEST(v_headroom, 0);` 然後 `RETURN NEW`(不 RAISE)
· 🔴 **不可變性**:`order_manual_refunds` 已有不可變 trigger 家族(見 `order_refunds` 那組的同款)
  ⇒ **新欄位要一起被納入不可變清單**, 否則它會變成唯一可以事後改的欄位。**這一格要先查, 我還沒查。**
· md5 前後釘 + 多載/secdef/proconfig/owner 釘 + `BEGIN`/`COMMIT` + `lock_timeout`(照 `20260907140000` 的形狀)

## 4. 驗收(照板列四條, 逐條可 yes/no)
① 超過上限**不再 RAISE**, 那一列**進得去** ② 那一列 `over_cap_by` **> 0**
③ 🔴 **負對照**:沒超過上限的那一筆 `over_cap_by` **必須是 NULL** ④ codex 不降級(鐵則 12①③)

## 5. 🛑 本 plan 證不到什麼
· 我**沒有**查「新欄位要不要納入不可變 trigger」—— §3 已標為未查, **那一格沒答之前不要動手**。
· 我**沒有**確認 `manual-refund-ledger-section.tsx` 顯示新欄位要改多少 —— 那是前端片, 不在本 plan。
· 我**沒有**跑任何寫入或併發測試。
