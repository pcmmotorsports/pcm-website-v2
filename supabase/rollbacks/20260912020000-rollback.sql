-- 20260912020000-rollback.sql —— 退回 20260912020000_m4b_refund_email_lines_cover_all_rails.sql
--
-- 退回之後 = 2026-09-12 以前的兩張掃描面:取消信只收「刷卡 + 全額退 + 已取消」、退款信只收「刷卡 + 部分退 + 沒取消」。
-- 🔴 REPLACE 刪不掉欄(退款信那張多了 order_state / refund_source)⇒ 先 DROP 再建, 所以權限要重下。
-- 🔴 順序:排信 / 寄信那幾支碼先 revert, 再跑這一支。
--    反過來 ⇒ view 沒有 order_state 而碼要讀它 ⇒ 排信端讀不到 ⇒ fail-closed 不寄(計 error, 不會寄出半套)。
-- 🛑 本檔不動資料:兩張都是 view, 沒有任何一列被改過。
--    已經排進 email_outbox 的信【不會】被這支撤回 —— 那些信照舊會寄出去(它們的 payload 已經凍住)。
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP VIEW IF EXISTS public.pcm_cancelled_email_pending;
DROP VIEW IF EXISTS public.pcm_partial_refund_email_pending;

-- ── 舊定義(逐字抄自 20260907230000:437 與 20260908080000:115)────────────────
CREATE VIEW public.pcm_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source,
  -- 🔴 退款金額 = **回到那張卡的錢**, 算式住在上面那支函式裡, 這裡只呼叫。
  --    ⛔ ~~原本這裡對齊狀態機的 `v_moved`(卡 + 人工)~~ ⇒ 主視窗 2026-09-05 **改裁甲**:
  --       信那句宣稱的是那張卡, 人工現金不算。理由全文在函式上面那段。
  r.card_refunded      AS refunded_amount,
  -- 🔴 `refund_kind` **算出來, 不寫死** —— 本 view 的射程已經是 `payment_status='refunded'`
  --    ⇒ 它「應該」恆為 'full';而**寫死等於讓兩把尺各說各的**。
  --    ⇒ ✅ 判準 = **卡上退滿了沒**(`card_refunded >= o.total`)⇒ 🛑 **卡上沒退滿就印 'partial',
  --       而模板對 'partial' 是【那句與那個數字都不印】** —— fail-closed, 不會說一句可能是謊的話。
  --    🔵 而 view 射程已是 `payment_status='refunded'` ⇒ 它「應該」恆為 'full';
  --       印出 'partial' 就是【狀態機說全額退了, 而卡上沒有】的訊號 —— 那正是要看見的東西。
  CASE WHEN r.card_refunded >= o.total THEN 'full' ELSE 'partial' END AS refund_kind
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
-- 🔴 body 裡**一個 `sum(` 都沒有** —— 算式只有一份, 在那支函式裡(自證②b 釘這件事)。
CROSS JOIN LATERAL (SELECT public.pcm_order_card_refunded(o.id) AS card_refunded) r
-- 🔴🔴 **`payment_method` 不是 `payment_channel` —— 而這是 DB 自己的 COMMENT 講的。**
--   ⛔ ~~本支第一版寫 `payment_channel = 'tappay'`~~(codex R2 ④ 抓到, 開檔查證屬實)
--   🛑 `20260712203000:87` 的 `COMMENT ON COLUMN public.orders.payment_channel` **逐字**:
--      「管理/預期收款管道(建單時定、admin 可改);算實收金額用 payment_method+payment_status,
--       **勿用本欄**」
--   ⇒ 📌 `payment_channel` 是【打算怎麼收】, `payment_method` 是【實際怎麼收的】(付款成功時寫)。
--   ⇒ 而本 view 要答的是「**這筆錢會退回哪裡**」—— 那是事實軸, 不是預期軸。
--   🔴 具體失敗情境:建單時 channel 填 tappay、客人實際付現金 ⇒ 舊版會掃進來
--      ⇒ 信說「全額退回**原付款方式**」而那張卡從來沒被扣過。
--   ⚠️ **反向的代價明寫**:`payment_method` 可為 NULL(建表 `20260604120000:109` nullable)
--      ⇒ 欄沒寫到的舊單會**掉出掃描面 = 不寄信**。而那是 fail-closed 的方向,
--      與本片其餘每一格一致:**寧可不寄, 不寄一封說錯錢的信。**
WHERE o.payment_method = 'tappay'
  AND o.payment_status = 'refunded'
  AND o.cancelled_at IS NOT NULL
  -- ══ 🔴🔴 混合退款的單【整張不寄】(主視窗 2026-09-05 裁 Q2 乙;codex R2 ③)══════════
  --   失敗情境(量過, 探針格6f):總額 5000、卡退 4000、**現金退 1000**
  --   ⇒ 狀態機的 `v_moved`(卡 + 人工)= 5000 ⇒ 它把 `payment_status` 翻成 `'refunded'`
  --   ⇒ 這張單進得了掃描面, 而 `card_refunded` 只有 4000 ⇒ `kind = 'partial'`
  --   ⇒ 🛑 模板對 `'partial'` 是**那句與那個數字都不印**
  --     ⇒ 📌 **客人收到一封【完全沒提到退款】的取消信** —— 而他的錢確實退了。
  --   ⇒ ⇒ 而 outbox 的 anti-join ⇒ **日後卡上補退滿, 也不會再寄。**
  --   ✅ 裁示:這類單**整張不寄**, 等人工處理(板列寫著「這類單要人工寄」)。
  -- 🔵 判準用「有沒有未作廢的人工退款」, **不是**比金額 —— 比金額會把
  --    「人工退款 0 元」這種列當成沒有, 而它仍然代表**這張單走過別條軌**。
  -- ⚠️ 它與 `refund_kind` 是**兩道不同的閘**, 不是重複:
  --    這一條擋【混合軌】, `refund_kind` 擋【純卡而沒退滿】。兩者失敗情境不同, 都要留。
  AND NOT EXISTS (
        SELECT 1 FROM public.order_manual_refunds m
         WHERE m.order_id = o.id
           AND m.voided_at IS NULL)
  -- 🔴🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ **這一段是本支【新加】的, 另外五張本來就有。**
  --    ⛔ ~~原本這裡是裸的 anti-join~~ —— 它**只問「那一列在不在」**,
  --      不看 `last_error_code`、也不看 `dedup_key`
  --      ⇒ 📌 **只要那張單有過任何一列 `order_cancelled`, 它永遠不再進掃描面** ——
  --        **退休 dedup_key 對它零作用。**
  --    🛑 而取消信是 Sean 2026-09-03 拍板那封「**客人唯一一封信**」
  --      ⇒ 對這一族, 寄送當下的 skip 等於**永久丟掉它**, 而不是「下一輪重排」。
  --    ✅ ⇒ 補上與另外五張**逐字相同**的放行段。
  -- 🔵 **語意要與那五張一樣窄, 不因為它是新加的就寬一點** —— 兩套規則比一套錯的規則糟。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_cancelled'
           -- `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           -- ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 那些列就不擋了
           -- ⇒ 📌 **每一輪重寄同一封**, 而那與本支的方向【相反】。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND (
        -- 🔴 `NULL NOT IN (…)` 回 NULL(不是 true)⇒ WHERE 當假 ⇒ 來源不明的單會被【排除】。
        --    而 TS 那半對 `null` 是【照舊寄】⇒ 兩層會給相反的答案 ⇒ 這一格對齊 TS 的 fail 方向。
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

CREATE VIEW public.pcm_partial_refund_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  -- 🔴 **這一筆退款的身分** —— 它就是 `dedup_key`(見檔頭「粒度」那段)。
  r.id                 AS refund_id,
  -- 🔴 **這一筆**退回那張卡的錢。⛔ 不是任何和 —— 和會在混合軌的世界裡說謊(檔頭 ②)。
  r.refund_amount      AS refunded_amount,
  -- 🔴 什麼時候退的。CHECK `order_refunds_confirmed_consistency` 保證 confirmed ⇒ 它非 NULL。
  r.confirmed_at       AS refunded_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.order_refunds r
JOIN public.orders o ON o.id = r.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
-- 🔴🔴 `payment_method` 不是 `payment_channel` —— 而這是 DB 自己的 COMMENT 講的:
--   `20260712203000:87` 的 `COMMENT ON COLUMN public.orders.payment_channel` 逐字
--   「管理/預期收款管道(建單時定、admin 可改);算實收金額用 payment_method+payment_status, **勿用本欄**」
--   ⇒ `payment_channel` 是【打算怎麼收】, `payment_method` 是【實際怎麼收的】。
--   ⚠️ 反向代價明寫:`payment_method` 可為 NULL(`20260604120000:109` nullable)
--     ⇒ 欄沒寫到的舊單掉出掃描面 = 不寄信 —— 那是 fail-closed 的方向, 與本片其餘每一格一致。
WHERE o.payment_method = 'tappay'
  -- 🔴 **真正的部分退款** —— 而它與姊妹那張取消信 view(要求 `'refunded'`)**互斥**
  --   ⇒ 同一張單不會同時進兩個掃描面。
  AND o.payment_status = 'partiallyRefunded'
  -- 🔴🔴 **這張單還活著** —— 取消掉的單走別條路(檔頭 ① 那段有失敗情境與代價)。
  --   🛑 它同時擋住寄送前那道 ineligible 閘的一半, 而**那道閘擋不到掃描這一層**:
  --     閘在 send 之前跑, 而 enqueue 之後才被取消的單要靠它;
  --     ⇒ 📌 **兩道都要**, 不是重複。
  AND o.cancelled_at IS NULL
  -- 🔴 只認已確認到帳的卡退(檔頭「只認 confirmed」那段講了為什麼比函式窄)
  AND r.status = 'confirmed'
  -- 🔴🔴 **排除【事後補登】的退款(codex 2026-09-08 must-fix 5)** —— 而這一條是我漏掉的:
  --   我讀的是 `20260725130100` 的**原始建表**, 而 `backfilled_source` 那四欄是
  --   `20260907020000_m4b_tappaydirect_a1_backfill_columns.sql:112-115` **前一天**才加的。
  --   ⇒ 📌 **讀「這張表長什麼樣」要用 `scripts/latest-definition-of.sh`, 建表那一支不是全部。**
  -- 🛑 **失敗情境是具體的**:三個月前在 TapPay 後台退的錢, 員工今天才補登
  --   ⇒ 那一列的 `confirmed_at` 是**今天**(該欄 COMMENT 逐字「由 DB 給, 會被 now() 覆寫」)
  --   ⇒ 它**穿得過 cutoff** ⇒ 📌 **客人收到一封通知他三個月前那筆退款的信**,
  --     而 cutoff 存在的整個理由就是不要對一批早就忘了這件事的人寄信。
  -- ⛔ **不改用 `backfill_occurred_at` 當 cutoff** —— 該欄 COMMENT 逐字「**員工的說法**,
  --   而那正是這一片裡最可能被填錯的一格」⇒ 拿一個未經查證的時刻決定誰收信 = 用別人的猜當閘。
  -- ✅ 方向與本片其餘每一格一致:**寧可不寄。**
  -- 🔴 **代價明寫**:補登的那一群**不會有信**, 要人工處理 —— 而它同時擋掉另一個風險:
  --   `confirmed` 是終態(所有轉移都要求 `status = 'processing'`, `20260803150000:726` 起)
  --   ⇒ **補登金額填錯了沒有更正路徑** ⇒ 那封信會說一個永遠改不掉的數字。
  AND r.backfilled_source IS NULL
  -- 🔴🔴 anti-join 綁 **`dedup_key = 這一筆退款`**, 不綁訂單(檔頭「粒度」那段)。
  --   🛑 唯一鍵 `(event_type, dedup_key)` **不含 order_id**(`20260717020000:377`)
  --     ⇒ 這裡也只比這兩個, 比 order_id 是多的、而且會與唯一鍵說不同的話。
  --   🔵 放行清單與另外五張 **逐字相同** —— 語意不因為它是新加的就寬一點。
  --     `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
  --     ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 那些列就不擋了 ⇒ 每一輪重寄同一封。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_partially_refunded'
           AND e.dedup_key = r.id::text
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  -- 收件人:兩個來源至少一個非空(與姊妹五張逐字相同)
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

-- ── 權限:照原 migration 重下(DROP 把 ACL 一起帶走了)────────────────────────
-- ACL-GATE-EXEMPT: public.pcm_cancelled_email_pending -- 回退用, 逐字抄 20260907230000 原授權(只有 service_role;2026-09-12 回退檔)
REVOKE ALL ON public.pcm_cancelled_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_cancelled_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_cancelled_email_pending TO service_role;
-- ACL-GATE-EXEMPT: public.pcm_partial_refund_email_pending -- 回退用, 逐字抄 20260908080000:212-215 原授權(2026-09-12 回退檔)
REVOKE ALL ON public.pcm_partial_refund_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_partial_refund_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_partial_refund_email_pending TO service_role;

-- 🔵 二審 nit 9:把 ⑤ 的 COMMENT 也還原成舊的那一份(行為無關, 而字面要對得上)。
COMMENT ON VIEW public.pcm_partial_refund_email_pending IS
$c$**真正的部分退款**通知信(`order_partially_refunded`)的掃描面 —— Sean 2026-09-08 QB-16 拍甲。
一列 = 一筆 `order_refunds`(`dedup_key = order_refunds.id`);射程 = `payment_method='tappay'`
+ `payment_status='partiallyRefunded'` + `cancelled_at IS NULL` + `status='confirmed'`。$c$;

DO $post$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_cols
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.pcm_partial_refund_email_pending'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols <> 'order_id,display_id,refund_id,refunded_amount,refunded_at,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '回退事後閘:退款信 view 沒有回到原本那八欄(實得 %)', v_cols;
  END IF;
  IF position('partiallyRefunded' IN pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)) <> 0 THEN
    RAISE EXCEPTION '回退事後閘:取消信 view 還留著放寬後的述詞';
  END IF;
END
$post$;

COMMIT;
