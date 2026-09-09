# ⟦f3-PAIDCANCELRACE1⟧ 事後偵測落地 plan(2026-09-09 · 窗 B · 已折 codex R1 五條 must-fix)

> **這不是提案,是落地。** Sean 2026-09-02 已拍**乙 = 事後偵測**
> (`~/pcm-mailbox/拍板-20260902-06題.md:28-33` 逐字「**Q4 ⇒ 乙 · 取消的單收到付款信:做【事後偵測】**」/
> 「乙(他選)= 寄出之後再對一次, 對不上就開一筆給員工去聯絡客人」/
> 「🛑 他【沒有】自宣接受殘餘風險 —— **他選了看得見那一邊**」)。
> 🔴 **七天過去, 他選的那個東西不存在。** 本 plan 是把它接上去要動的東西。

---

## §0 為什麼是「偵測」不是「防止」——這一格不要重新討論

`⟦f3-PAIDCANCELRACE1⟧` 是一個 **TOCTOU**:`loadPaidContext` 讀 `cancelled_at`,
到那一發 Resend HTTP 之間,不論再加幾道檢查都還有間隙 ⇒ 📌 **它關不掉。**

⚠️ **而板列上那句「那段窗口是同步碼、零 `await`」今天不成立** —— codex R1 nit③ 指出並經核:
`sweep-email-outbox.ts:2084` 在 paid context 之後還有一發 `currentRecipient` 的 `await`
(`apps/storefront/src/lib/email/composition.ts:207` 已注入它),paid context 內部讀完取消狀態後也還有品項查詢。
⇒ 🛑 **窗口比板列寫的寬,而它的寬度到今天仍然【沒有人量過】。** 本 plan 不宣稱量過。

⇒ 所以本 plan **不加第三道事前檢查**。加了也關不掉,而每加一道就多一個下一個人以為關掉了的理由。

🔵 **今天已經有兩道事前閘**(這兩道**不動**):
1. `sweep-email-outbox.ts` 逐封 `listIneligibleAmong([job.orderId])`,述詞含 `cancelled_at IS NOT NULL`。
2. `SupabasePaidEmailContextAdapter` 的 `.select()` 含 `cancelled_at`,`kind:'cancelled'` ⇒ 不寄 +
   `last_error_code = 'order_ineligible_at_send'`。

---

## §1 今天量到的(2026-09-09 · 唯讀正式庫 + 本樹)

| 問的 | 答 | 尺 |
|---|---|---|
| 告警模組裡有沒有「寄出時已取消」這一格 | **0** | `grep -c "sentAt\|sent_at" packages/use-cases/src/check-anomaly-alerts.ts`;🟢 正對照同檔 `cancelledMixedRail` = **12**;⚪ 負對照現造 = **0** |
| 全樹有沒有任何非測試碼掛這個錨 | **0 支檔** | `grep -rln PAIDCANCELRACE apps packages` |
| 正式庫有沒有「取消後才寄出」的信 | **0 列** | 見下面那句 ⚠️ |
| 已取消的單身上總共有幾封信(上一格的分母) | **0** | ⇒ 🛑 **那個 0 沒有材料** |
| 🟢 換一個有材料的維度證明尺會動 | **6** | `sent_at > created_at`;⚪ 負對照 `+100 years` ⇒ **0** |
| `email_outbox` 總列數 / 已取消的單 | **6 / 1** | |
| `payment_confirmer` 直接讀得到 `orders` / `email_outbox` 嗎 | **f / f** | `has_table_privilege`;🟢 正對照 `service_role` 對 `orders` SELECT = **t** |

🛑 **那個 0 不讀成「沒發生過」** —— 已取消的單身上一封信都沒有,
分母是 0 的時候本尊的 0 證不了任何事(`⟦db-DEADMANSIGNAL4⟧` 那一課)。

🔴 **而以上是【2026-09-09 的一張快照】,不是對上線首日的預測**(codex R1 nit⑤)。
量完到部署之間新增的資料會讓首日不是 0。⇒ **本 plan 不寫「上線第一天它會印 0」。**

---

## §2 受詞要精確,而它只證得到「疑似」

### 2-a 只有付款成功信
🔴 取消信本來就該在取消之後寄 ⇒ 述詞若只寫 `sent_at > cancelled_at`,
`order_cancelled` / `order_refunded` / `order_partially_refunded` 每一封都會變成事故。

✅ 受詞逐字 = `event_type = 'order_created'`。
🔬 `packages/use-cases/src/sweep-email-outbox.ts:1578` 逐字
`if (job.eventType === 'order_created' && deps.paidContext !== undefined)`
⇒ 付款成功信掛在 `order_created` 上寄,沒有另一個 `order_paid`。(codex R1 獨立核過這一句成立。)
⚠️ **而這個 event_type 一名兩用** —— 未接 `paidContext` 時它是純文字建單信 ⇒
偵測到的那一列**要人去看信的內容**,述詞分不出來。

### 2-b 🔴🔴 它算的是「疑似」不是「確證」(codex R1 must-fix②)
`sent_at` 是**應用程式在 `sender.send()` 回來【之後】**用 `new Date()` 寫的
(`SupabaseEmailOutboxAdapter.ts:794`),不是寄出那一刻的資料庫時間。
🎯 **失敗情境**:10:00:00 信真的寄出去了 → 10:00:01 訂單被取消 → 10:00:02 才寫 `sent_at`
⇒ SQL 算成「取消後寄出」,而**實際上是取消前寄的**。反方向(app 與 DB 時鐘偏差)則會**漏報**。
⇒ ✅ **所以告警文字一律寫「疑似」並要求人去核時間**,計數**不得**被稱為已證實事故。
⇒ ✅ 而 §3 的回傳要帶**訂單識別**,人才核得動(見 2-c)。

### 2-c 要帶得走的識別(codex R1 must-fix⑤)
只回「3 封、最早某時刻」,員工不知道要找哪三位客人 ⇒ Sean 那句「開一筆給員工去聯絡客人」做不到。
⇒ RPC 要回一小段命中清單(`display_id` + `sent_at` + `cancelled_at`),上限 20 筆。

---

## §3 要改什麼(四層,順序不可換)

### ① 一支 migration —— 🛑 **Sean 貼**
`supabase/migrations/20260909070000_m4b_paidcancelrace_post_send_counts.sql`
(⚠️ 版號貼前要對一次 `ls supabase/migrations/ | sort | tail`;本樹落後,已知 `20260909060000` 不在)

```sql
-- 🔴 建立與收權包在同一交易:CREATE OR REPLACE 會【保留既有權限】
--    ⇒ 同簽章的舊函式若曾授權過別人, 只 GRANT 不 REVOKE 收不掉。(codex R1 must-fix①)
BEGIN;

CREATE OR REPLACE FUNCTION public.get_paid_email_after_cancel_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_result pg_catalog.jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    -- 🔴 主詞:付款成功信【標記寄出】的時刻晚於取消時刻。
    --    🛑 這是【疑似】不是確證 —— sent_at 是 app 在 send 回來之後寫的(plan §2-b)。
    'suspect_sent_after_cancel_count',
      (SELECT pg_catalog.count(*)
         FROM public.email_outbox e
         JOIN public.orders o ON o.id = e.order_id
        WHERE e.event_type = 'order_created'
          AND e.status = 'sent'
          AND e.sent_at IS NOT NULL
          AND o.cancelled_at IS NOT NULL
          AND e.sent_at > o.cancelled_at
          -- 🔵 有人核過了就不再叫(否則歷史案件會永久重複告警;codex R1 must-fix③)。
          --    🔴 target 字面 `order:<uuid>` 與後台 action 寫進去的必須一模一樣
          --       (`admin-audit` 家族慣例, `20260712210000:47` 逐字舉的就是這個形狀)。
          AND NOT EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.target = 'order:' || o.id::pg_catalog.text
                   AND a.action = 'email.paid_after_cancel.reviewed')),

    'oldest_suspect_sent_at',
      (SELECT pg_catalog.min(e.sent_at)
         FROM public.email_outbox e
         JOIN public.orders o ON o.id = e.order_id
        WHERE e.event_type = 'order_created' AND e.status = 'sent'
          AND e.sent_at IS NOT NULL AND o.cancelled_at IS NOT NULL
          AND e.sent_at > o.cancelled_at
          AND NOT EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.target = 'order:' || o.id::pg_catalog.text
                   AND a.action = 'email.paid_after_cancel.reviewed')),

    -- 🔴🔴 **分母 —— 而它要與分子【同一族】**(codex R1 nit②):
    --    數的是「已取消的單身上有一封 order_created 且已寄出的信」。
    --    ⛔ 不是「有任意 outbox 列的取消訂單」—— 那會被取消信灌大, 而那種分母 > 0
    --       不能拿來說付款信偵測「有材料」。
    --    🛑 **而分母 > 0 仍然證不了述詞沒寫錯** —— 它只證得到「這一族今天有資料」。
    'cancelled_orders_with_sent_paid_email',
      (SELECT pg_catalog.count(DISTINCT o.id)
         FROM public.orders o
         JOIN public.email_outbox e ON e.order_id = o.id
        WHERE o.cancelled_at IS NOT NULL
          AND e.event_type = 'order_created'
          AND e.status = 'sent'),

    -- 🔵 人要核得動就要有單號(plan §2-c)。上限 20, 告警信不是報表。
    'suspect_orders',
      pg_catalog.coalesce((
        SELECT pg_catalog.jsonb_agg(x ORDER BY x->>'sent_at')
          FROM (SELECT pg_catalog.jsonb_build_object(
                         'display_id',   o.display_id,
                         'sent_at',      e.sent_at,
                         'cancelled_at', o.cancelled_at) AS x
                  FROM public.email_outbox e
                  JOIN public.orders o ON o.id = e.order_id
                 WHERE e.event_type = 'order_created' AND e.status = 'sent'
                   AND e.sent_at IS NOT NULL AND o.cancelled_at IS NOT NULL
                   AND e.sent_at > o.cancelled_at
                   AND NOT EXISTS (
                         SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target = 'order:' || o.id::pg_catalog.text
                            AND a.action = 'email.paid_after_cancel.reviewed')
                 ORDER BY e.sent_at
                 LIMIT 20) s), '[]'::pg_catalog.jsonb)
  ) INTO v_result;

  -- 🔴 形狀自我斷言。**先擋 NULL 與非物件**(codex R1 nit①):
  --    `IF NOT (NULL)` 不會進例外分支, 而一個裝著三個鍵名【字串】的陣列也過得了 `?`。
  IF v_result IS NULL OR pg_catalog.jsonb_typeof(v_result) <> 'object' THEN
    RAISE EXCEPTION 'get_paid_email_after_cancel_counts: 回傳不是 jsonb object';
  END IF;
  IF NOT (v_result ? 'suspect_sent_after_cancel_count'
      AND v_result ? 'oldest_suspect_sent_at'
      AND v_result ? 'cancelled_orders_with_sent_paid_email'
      AND v_result ? 'suspect_orders') THEN
    RAISE EXCEPTION 'get_paid_email_after_cancel_counts: 回傳形狀缺鍵';
  END IF;

  RETURN v_result;
END;
$fn$;

-- 🔴🔴 **具名 REVOKE, 不是只撤 PUBLIC**(codex R1 must-fix①)。
--    失敗情境:建立者的預設授權含 anon EXECUTE, 或同簽章舊函式已有具名授權
--    ⇒ 本 SQL 成功之後匿名端仍能透過 SECURITY DEFINER 讀跨訂單統計。
REVOKE ALL ON FUNCTION public.get_paid_email_after_cancel_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_paid_email_after_cancel_counts()
  FROM anon, authenticated, service_role;
-- 🔴 是 payment_confirmer, 不是 service_role。告警讀取器持 `PAYMENT_CONFIRMER_DB_URL`,
--    它連進來的身分從來不是 service_role —— `20260906970000` 整支就是在修這個假設。
--    🔬 今天實量:payment_confirmer 對 orders / email_outbox 直接 SELECT 都是 f
--       ⇒ 這支非 SECURITY DEFINER 不可, 而那正是家族既有形狀。
GRANT EXECUTE ON FUNCTION public.get_paid_email_after_cancel_counts() TO payment_confirmer;

-- 🔬 收權斷言(照 `20260906960000:165` 家族既有做法):貼完當場證, 不靠事後查。
DO $assert$
BEGIN
  IF has_function_privilege('anon',
       'public.get_paid_email_after_cancel_counts()', 'EXECUTE')
   OR has_function_privilege('authenticated',
       'public.get_paid_email_after_cancel_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION '收權失敗:anon 或 authenticated 仍叫得動';
  END IF;
  IF NOT has_function_privilege('payment_confirmer',
       'public.get_paid_email_after_cancel_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION '授權失敗:payment_confirmer 叫不動';
  END IF;
END
$assert$;

COMMIT;
```

### ② `packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts`
照 `get_cancelled_mixed_rail_gap_counts` 同形接上,**而有一處要比家族現況多做**:

🔴🔴 **codex R1 must-fix④ 要我把 `42501` 也降級成 Unknown —— 我開檔核過, 【不照做】,而理由在檔裡。**
該檔 `:104-107` / `:144-146` 逐字寫著降級規則:
`42883` → `to_regprocedure` 複查 → 真的不存在 ⇒ unknown(部署窗口)/
`42883` 而 oid 回得出來 ⇒ **原封上拋**(函式體壞了,必須吵)/
**`42501`(權限被收走)⇒ 原封上拋**。
⇒ 📌 **那不是漏寫, 是一個寫下來的 fail-closed 決定**:權限被收走要**吵**,
不能安靜地變成「查不到」—— 一格 Unknown 讀起來像「還沒上膛」,而那正是 `20260906970000`
整支在修的那個病(告警器 37 小時沒成功而沒有人知道)。
⇒ ✅ **本片逐字沿用既有三條, 不新增第四條。** 而 codex 指出的**後果**是真的,
處置寫在 §4:那個「誰先上都安全」的保證**只涵蓋授權正確的情況**。
⚠️ **既有 16 支一格不動**(那是別的片的範圍)。

🔴 **三態**:`Unknown` ⇒ 四格回 **`null`**,**不是 0**。

### ③ `packages/use-cases/src/check-anomaly-alerts.ts`
summary 加五欄 + 訊息一段。🔴🔴 **而只加訊息不會有人收到信**(codex R1 must-fix③):
現行必須通過 `:2860` 的 `shouldAlert` 才會建訊息並送出,
而被仿照的 mixed-rail 那一段 `:1402` **明訂不觸發寄信** ⇒ 照抄它等於裝一個不會叫的東西。
🔬 而 `:1402` 那句**不進 `shouldAlert` 的理由要一起讀**,逐字:
「它是【有事要人做】不是【系統壞了】…**一個不會自己好的數字進了響鈴, 就是下一個永遠亮著的紅燈**」。
⇒ 🎯 **所以本訊號能不能進響鈴, 取決於它會不會自己好** —— 而 §3① 的述詞帶了
`NOT EXISTS admin_audit_log(...reviewed)` ⇒ **人核完就歸零** ⇒ 它會自己好。
⇒ ✅ **本片接進 `shouldAlert`**,並補一格測試:**只有這一個異常、其他全 0 ⇒ notifier 仍被呼叫。**
🛑 **而 §7 若 Sean 選乙(不做「已核對」按鈕), 這一段要一起改回不進響鈴** —— 沒有歸零的路
就正是 `:1402` 那句在擋的東西。**兩件事綁在一起, 不要只改一邊。**

訊息文字:
```
· 🔴 【疑似:付款成功信寄給了已取消的單】:N 封(最早 <時刻>)
    單號:<display_id 清單, 最多 20>
    🛑 這是【疑似】—— sent_at 是寄出【之後】才寫的, 可能是取消前寄的。請核那張單的時間再聯絡客人。
    核完在後台按「已核對」(寫 admin_audit_log action=email.paid_after_cancel.reviewed)⇒ 這一格會歸零。
· ⚪ 【疑似:付款成功信 vs 取消】:查不到(函式沒 apply 或沒授權)⇒ 這一格不是「沒有事故」。
```
⚠️ 分母那一格要**印出來**,否則 `0 封` 讀起來像背書。

### ④ 測試
· adapter:四態(有值 / `42883` 且函式真的不存在 ⇒ Unknown / `42883` 而 oid 回得出來 ⇒ 上拋 /
  `42501` ⇒ **上拋**(不是 Unknown, 見 §3②)/ 回非物件 ⇒ ParseError)。
· use-case:`count>0` 印且 `shouldAlert` 為真 · `count=0 且分母=0` 印「今天沒有材料」·
  `Unknown` 印「查不到」· **只有本異常時 notifier 被呼叫**。
· 🔬 **突變**:拿掉 `event_type='order_created'` ⇒ 必須紅一格;拿掉 `Unknown` 分支 ⇒ 必須紅一格;
  把本訊號從 `shouldAlert` 拿掉 ⇒ 必須紅一格。

---

## §4 rollback

· ② ③ ④ 是純 app 碼 ⇒ `git revert` 那一顆。
· ① `DROP FUNCTION public.get_paid_email_after_cancel_counts();`
· 🔵 **貼板順序**:RPC 與 app 誰先上都安全 —— adapter 的降級路徑吃 `42883` 與 `42501` ⇒ 自動 `Unknown`。
  🛑 **而這個保證只在【整支 migration 原子套用且授權正確】時成立**(codex R1 must-fix④):
  半套的 migration 或壞掉的權限不在這個保證裡。⇒ 所以 ① 用 `BEGIN/COMMIT` 包起來。

---

## §5 驗收(yes/no)

1. RPC 貼上去之後 `SELECT public.get_paid_email_after_cancel_counts()` 回四個鍵 ⇒ yes/no
2. `anon` / `authenticated` 叫不動、`payment_confirmer` 叫得動(migration 內的斷言自己會炸)⇒ yes/no
3. 告警端那一格從 `Unknown` 變成有數字 ⇒ yes/no
4. 三綠(`typecheck` / `lint` / `build`)rc=0 ⇒ yes/no
5. 突變三發各紅至少一格 ⇒ yes/no
6. 🔴 **codex 唯讀審一輪**(碰寄信 + schema + 權限 ⇒ 鐵則 12 ①③⑤)⇒ R1 must-fix 修完才 commit

---

## §6 這支證不到什麼(不要讓下一個人以為它涵蓋了)

1. **它不縮小那個窗口。** TOCTOU 還在,本 plan 只讓它事後看得見。
2. **它算的是「疑似」。** `sent_at` 是寄出之後才寫的 ⇒ 會**誤報**(取消前寄、取消後才標記)也會
   **漏報**(app 與 DB 時鐘反向偏差)。
3. **`sent` 不等於送達。** `ResendEmailSenderAdapter.ts:445` 收到成功 HTTP 回應就標 `sent`
   ⇒ Resend 收下之後退信的仍會被算進來。
4. **反過來也會漏**:HTTP 成功之後行程被砍、`markSent` 寫入失敗、或 CAS 失去所有權
   ⇒ **信真的寄出去了而表上沒有那一列** ⇒ 這支永遠看不到它。
5. **它只看 `status='sent'`** —— 寄失敗、卡在 retry 的都不算。
6. **`order_created` 一名兩用** ⇒ 它報的每一封都要人去看內容才知道客人看到的是哪一種。
7. **分母 > 0 只證「這一族有資料」,不證述詞沒寫錯。**
8. **競態窗口的寬度到今天仍是【讀碼推的, 沒有人量過】**,而 §0 已訂正板列那句「零 await」。
9. **§1 是 2026-09-09 的一張快照**,不是對上線首日的預測。

---

## §7 待答(不擋動手,擋的是 ①)

```
Q: 這支偵測叫出來之後, 員工在哪裡按「已核對」?
A: 甲 | 乙
   甲 = 後台訂單頁加一顆「已核對(付款信/取消)」按鈕, 寫一筆 admin_audit_log【推薦】
   乙 = 不做按鈕, 那一格永遠不歸零, 靠員工每天自己跳過已知的那幾張
說明:§3① 的述詞已經預留了甲那一條(NOT EXISTS admin_audit_log)。
     選乙的話那一段要拿掉, 而代價是同一張單會每天叫一次直到永遠。
     Sean 2026-09-02 原話「開一筆給員工去聯絡客人」—— 那句沒有指定在哪裡開, 也沒說怎麼關。
```
