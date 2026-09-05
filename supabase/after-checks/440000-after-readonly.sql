-- ══════════════════════════════════════════════════════════════════
-- 貼後對帳 · `20260905440000`(片③)—— **唯讀, 零寫入**
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 **這支檔存在的理由**:片③ 用 `RAISE NOTICE` 印「封口了幾張」——
--    而 **Sean 在 Supabase SQL Editor 【看不到 NOTICE】**
--    ⇒ 📌 **一個寫得很清楚的數字, 對那個要看它的人等於不存在。**
--    ⇒ ✅ 改成:貼完之後由線 `-account` 走唯讀連線跑這一支, 把數字撈回來。
--
-- 🛑 **它證得到什麼**:碼進去了 · 封口列長什麼樣 · 還有沒有漏網的。
-- 🛑 **它證不到什麼**:**那道閘會不會擋對** —— 那要真的作廢一筆退款(寫入), 唯讀線做不到。
-- ══════════════════════════════════════════════════════════════════
\pset pager off
\pset format unaligned
\pset fieldsep ' | '

SELECT '① 同步器的早退還在嗎(要 f)' AS "格",
       (pg_catalog.strpos(pg_catalog.regexp_replace(p.prosrc,'--[^'||chr(10)||']*','','g'),
                          'IF v_moved <= 0 THEN') > 0)::text AS "值"
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='pcm_sync_order_refund_payment_status'
UNION ALL
SELECT '② 三態的 CASE 在嗎(要 t)',
       (pg_catalog.strpos(p.prosrc, 'v_moved > 0 AND v_moved >= v_total') > 0)::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='pcm_sync_order_refund_payment_status'
UNION ALL
SELECT '③ 兩支呼叫端都接上同步器了嗎(要 2)',
       (SELECT count(*)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname IN ('admin_void_manual_refund','admin_correct_order_refund_verdict')
           AND pg_catalog.strpos(p.prosrc,'PERFORM public.pcm_sync_order_refund_payment_status') > 0)
UNION ALL
SELECT '🔵 負對照 現造字面在函式體裡嗎(要 f)',
       (pg_catalog.strpos(p.prosrc, 'zzz_not_a_real_literal_0905') > 0)::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='pcm_sync_order_refund_payment_status'
UNION ALL
SELECT '④ 封口補了幾列(⓪-a + ⓪-b 合計)',
       (SELECT count(*)::text FROM public.email_outbox e WHERE e.payload ? 'p3_seal')
UNION ALL
SELECT '⑤ 封口列的態(全部應為 skipped_no_real_email)',
       COALESCE((SELECT pg_catalog.string_agg(DISTINCT e.status, ',') FROM public.email_outbox e
                  WHERE e.payload ? 'p3_seal'), '(一列都沒有)')
UNION ALL
SELECT '🔴 ⑥ 還有沒有【漏網】的(refunded + 沒取消 + 有信箱 + 零退款 + 沒有 order_created 列)—— 要 0',
       (SELECT count(*)::text
          FROM public.orders o
          LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
         WHERE o.payment_status = 'refunded'::public.payment_status
           AND o.cancelled_at IS NULL
           -- 🔴🔴 **[2026-09-06 訂正:上一版這裡叫 `public.pcm_js_trim_whitespace()`, 而【這支檔的使用者跑不動它】]**
           --    逐字:`ERROR: permission denied for function pcm_js_trim_whitespace`
           --    成因:那支 helper **零 GRANT 給 `pcm_readonly`**(只給 `postgres` / `service_role`;
           --          `20260901070000:64-65` 把它從所有人身上收掉過)。
           --    🎯 **⇒ 一支【為了給貼的人看數字】而寫的對帳檔, 而那個要看它的身分執行不了它。**
           --       📌 我當時為了與寄信 view 用【同一把尺】而叫它 —— **而那個一致性讓檔案不可執行。**
           --       ⇒ **一致性與可執行性在這裡打架, 而我選了一致性卻【沒有量它跑不跑得動】。**
           --    ⛔ ~~給那支 helper GRANT EXECUTE TO pcm_readonly~~ —— 要一支 migration,
           --       而且是**為了方便而放寬一個刻意收窄的 ACL** ⇒ 不划算。
           --    ✅ 改用單參數 `btrim`(只吃空格)。
           -- 🔴 **而近似的【方向】要寫明, 否則這一格會被讀成等價**:
           --    單參數 `btrim` 比那支 helper **窄** ⇒ 只含 tab / 全形空白的信箱, **我會算成「有內容」**
           --    ⇒ 📌 **本格會【多報】而不會【漏報】** —— 對「找漏網的」來說是安全的方向。
           --    ⇒ ⚠️ 所以下面第 ⑥ 格印出非 0 時, **第一件事是逐張看那個信箱長什麼樣**, 不是直接判有漏網。
           AND COALESCE(NULLIF(pg_catalog.btrim(o.notification_email),''),
                        NULLIF(pg_catalog.btrim(c.email),'')) IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.email_outbox e
                            WHERE e.order_id = o.id AND e.event_type = 'order_created')
           -- 🔴 [R3 F8] 這裡原本 ①用單參數 btrim(與 migration 的尺不同)②只加兩段帳本、漏第三段
           --    ⇒ 「要 0」那一格會印非 0, 而它是【貼的人唯一拿得到的數字】。兩處都對齊了。
           AND 0 = (COALESCE((SELECT pg_catalog.sum(r.refund_amount) FROM public.order_refunds r
                               WHERE r.order_id=o.id AND r.status='confirmed'),0)
                  + COALESCE((SELECT pg_catalog.sum(m.refund_amount) FROM public.order_manual_refunds m
                               WHERE m.order_id=o.id AND m.voided_at IS NULL),0)
                  + COALESCE((SELECT pg_catalog.sum(r2.refund_amount) FROM public.order_refunds r2
                                JOIN public.order_refund_effective_verdict v ON v.refund_id = r2.id
                               WHERE r2.order_id=o.id AND r2.status='failed'
                                 AND r2.failed_reason='manual_failed' AND v.corrected_to='money_moved'),0)))
UNION ALL
SELECT '🟢 正對照 orders 全表列數(尺接得到資料嗎)', (SELECT count(*)::text FROM public.orders);
