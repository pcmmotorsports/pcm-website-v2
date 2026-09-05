-- ══════════════════════════════════════════════════════════════════
-- ⟦d8-CROSSRAILUNVERIFIED⟧ 跨軌待退款 · 對帳(**唯讀, 零寫入**)
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 **這支檔存在的理由**:`20260902030000` 那個跨軌修法 2026-09-02 已貼進正式庫,
--    而唯讀線當時只證到【它在】—— `APPLIED.tsv:410` 自己逐字標:
--    「⚠️ 未驗:那支函式【算得對不對】唯讀線沒證 —— 跑不了它的後置斷言。」
--    ⇒ 📌 **「它在」與「它算對」是兩個宣稱, 而一個驗式只驗得了一個。**
--
-- ⛔ **不要現在跑來當背書** —— 第一張真的跨軌取消單發生**之後**才跑。
--    在那之前它會回「候選 0 張」, 而那**不是**「算對了」。
--
-- ── 怎麼用 ────────────────────────────────────────────────
--   整支貼進 Supabase SQL Editor, Run。**它只有 SELECT, 不會改任何東西。**
--   看回傳表格最後一欄 `判定`:
--     `✅ 相符`        ⇒ 這張單算對了
--     `🔴 不符`        ⇒ 差額在 `差` 欄, 貼回來
--     `🔵 候選 0 張`   ⇒ **還沒有可對的單**(不是通過)
--
-- ── 口徑(逐字對齊 `20260902030000:77-84` 那支函式)──────────────
--   每一軌:`SUM(order_payments.amount)` − `SUM(order_manual_refunds.refund_amount where voided_at IS NULL)`
--   軌別只有 `bank_transfer` / `cash`(卡片走 `order_refunds`, 另一本帳)。
--   **總額 = 兩軌淨額【相加】**(負的那軌參與相加 —— 那正是這個修法的重點)。
--
-- 🔴🔴 **時點回溯**:`amount_at_cancel` 是**取消當下**算的, 而現在的帳本可能已經動過
--    ⇒ 直接拿「現在的帳本」去對會**誠實地對出一個差額, 而那個差額是合法的**。
--    ✅ 所以下面用 `opened_at` 當截止線:只計取消**當時**看得到的那些列
--      (`received_at <= opened_at` / `occurred_at <= opened_at` 且當時尚未作廢)。
--    📌 **這一格是本支檔最容易寫錯的地方** —— 少了它, 每一張正常的單都會被判成不符。
--
-- ── 🛑 它答不出什麼(照實寫)────────────────────────────────
--   · 它比的是**兩份計算**(帳本 vs 那支函式的產出), **不是**「錢有沒有真的退給客人」。
--   · `order_payments` 的**沖銷列**(`reverses_payment_id`)沒有特別處理 ——
--     🔵 **那是刻意的**:上游那支函式也沒有處理(`20260902030000:79-80` 逐字 `SUM(p.amount)`)
--     ⇒ **對帳要用被對者的口徑**;若沖銷是正數列, 兩邊會**一起錯**, 而這支檔看不出來。
--   · 它只看「未作廢且未結清」的待退款列 —— 已結清的是歷史, 不在本次對帳範圍。
-- ══════════════════════════════════════════════════════════════════

WITH pr AS (
  -- 候選 = 還沒有人處理的待退款列(未作廢、未結清)
  SELECT p.order_id,
         pg_catalog.min(p.opened_at)          AS opened_at,
         pg_catalog.sum(p.amount_at_cancel)   AS pending_now,
         pg_catalog.count(*)                  AS rail_rows
    FROM public.order_pending_refunds p
   WHERE p.voided_at IS NULL AND p.settled_at IS NULL
   GROUP BY p.order_id
),
net AS (
  SELECT pr.order_id, r.rail,
         COALESCE((SELECT pg_catalog.sum(pay.amount) FROM public.order_payments pay
                    WHERE pay.order_id = pr.order_id AND pay.rail = r.rail
                      AND pay.received_at <= pr.opened_at), 0)::bigint
       - COALESCE((SELECT pg_catalog.sum(m.refund_amount) FROM public.order_manual_refunds m
                    WHERE m.order_id = pr.order_id AND m.rail = r.rail
                      AND m.occurred_at <= pr.opened_at
                      AND (m.voided_at IS NULL OR m.voided_at > pr.opened_at)), 0)::bigint AS amt
    FROM pr
    CROSS JOIN (VALUES ('bank_transfer'), ('cash')) AS r(rail)
),
expect AS (
  SELECT n.order_id,
         pg_catalog.sum(n.amt)                                        AS expected,
         pg_catalog.count(*) FILTER (WHERE n.amt < 0)                 AS negative_rails
    FROM net n GROUP BY n.order_id
)
SELECT o.display_id                                       AS "單號",
       pr.rail_rows                                       AS "待退列數",
       pr.pending_now                                     AS "帳上待退",
       e.expected                                         AS "應該待退",
       pr.pending_now - e.expected                        AS "差",
       e.negative_rails                                   AS "負軌數",
       CASE WHEN pr.pending_now = e.expected THEN '✅ 相符'
            ELSE '🔴 不符 —— 把這一列整個貼回來' END      AS "判定"
  FROM pr
  JOIN expect e ON e.order_id = pr.order_id
  JOIN public.orders o ON o.id = pr.order_id

UNION ALL

-- 🔴 **這一列一定會出現** —— 沒有它, 「候選 0 張」會回一個空表格,
--    而**空表格與「全部相符」在畫面上長得一樣**(整張表都是綠的 = 什麼都沒有)。
SELECT '— 合計 —',
       NULL,
       (SELECT pg_catalog.count(*) FROM pr),
       (SELECT pg_catalog.count(*) FROM pr p2 JOIN expect e2 ON e2.order_id = p2.order_id
         WHERE p2.pending_now <> e2.expected),
       NULL,
       (SELECT pg_catalog.count(*) FROM pr p3 JOIN expect e3 ON e3.order_id = p3.order_id
         WHERE e3.negative_rails > 0),
       CASE WHEN (SELECT pg_catalog.count(*) FROM pr) = 0
            THEN '🔵 候選 0 張 —— 這【不是】通過, 是還沒有可對的單'
            WHEN (SELECT pg_catalog.count(*) FROM pr p4 JOIN expect e4 ON e4.order_id = p4.order_id
                   WHERE p4.pending_now <> e4.expected) = 0
            THEN '✅ 全部相符(欄位依序 = 候選張數 / 不符張數 / — / 有負軌的張數)'
            ELSE '🔴 有不符的 —— 上面那幾列貼回來' END;
