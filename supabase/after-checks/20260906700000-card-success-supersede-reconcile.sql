\set ON_ERROR_STOP on
\echo === ⟦b4-CARDPENDINGWINDOW⟧ 對帳(唯讀;貼前跑一次、貼後跑一次)===
\echo --- 0. 先證尺接上了:那三支各找到幾支(每支期望 1)---
SELECT p.proname, count(*) AS 同名幾支
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('mark_charge_attempt_charged','mark_charge_attempt_charged_fallback','confirm_order_payment')
 GROUP BY p.proname ORDER BY p.proname;

\echo --- 1. 三支的原始 md5 與「區塊在不在」---
SELECT p.proname,
       pg_catalog.md5(p.prosrc) AS 原始md5,
       (pg_catalog.strpos(p.prosrc,'SUPERSEDE-BLOCK-BEGIN') > 0) AS 區塊在
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('mark_charge_attempt_charged','mark_charge_attempt_charged_fallback','confirm_order_payment')
 ORDER BY p.proname;
\echo 貼前期望 區塊在=f:confirm 184204e35edb0dba1b6d4d0909136f3c · mark ca9a7593ca05b2991d295ce93be692f4(fallback) / 13dfcc0a3c7f8e35b53063ca9babf8e5
\echo 貼後期望 區塊在=t:confirm bdf6a39b7408d0213b0df833e6073fa5 · mark 3cb44e675f2b8f8cbd68482bd5b367c4(fallback) / ca2e19c82e3677a4c37f7a33fe6b50c6

\echo --- 2. 🔴 觀測:最近被 superseded_by_card 取消的單(值班的人要能回答這一題)---
\echo 🛑 這個理由【不是本片獨有】—— begin_charge_attempt(20260904050000)本來就會寫它。
SELECT o.payment_channel,
       count(*) FILTER (WHERE o.cancelled_at > pg_catalog.now() - interval '6 hours') AS 最近6小時,
       count(*)                                                                       AS 歷來全部,
       max(o.cancelled_at)                                                            AS 最後一張
  FROM public.orders o
 WHERE o.cancelled_reason = 'superseded_by_card'
 GROUP BY o.payment_channel ORDER BY 2 DESC, 3 DESC;

\echo --- 3. 機械判定:三支必須【整組】在同一個世界, 不能一半一半 ---
DO $rc$
DECLARE v_old integer; v_new integer; v_tot integer;
BEGIN
  -- 🔴 codex R1 #10:第一版只問「md5 屬不屬於舊集合/新集合」, **沒有把函式名綁上去**
  --    ⇒ 少了 confirm 而多一支同 body 的多載, 仍可能被報成「三支都在舊世界」。
  --    ⇒ ✅ 改成逐支比對它【自己那一對】md5。
  WITH expect(fn, old_md5, new_md5) AS (VALUES
    ('mark_charge_attempt_charged',          '13dfcc0a3c7f8e35b53063ca9babf8e5', 'ca2e19c82e3677a4c37f7a33fe6b50c6'),
    ('mark_charge_attempt_charged_fallback', 'ca9a7593ca05b2991d295ce93be692f4', '3cb44e675f2b8f8cbd68482bd5b367c4'),
    ('confirm_order_payment',                '184204e35edb0dba1b6d4d0909136f3c', 'bdf6a39b7408d0213b0df833e6073fa5')
  )
  SELECT count(*) FILTER (WHERE pg_catalog.md5(p.prosrc) = e.old_md5),
         count(*) FILTER (WHERE pg_catalog.md5(p.prosrc) = e.new_md5),
         count(*)
    INTO v_old, v_new, v_tot
    FROM expect e
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace = n.oid AND p.proname = e.fn;
  IF v_tot <> 3 THEN
    RAISE EXCEPTION '對帳③:期望清單三支而配對到 % 列 ⇒ 上面兩節不論印什麼都不可信。', v_tot;
  END IF;
  IF v_old = 3 THEN
    RAISE NOTICE '對帳③:三支【各自】都等於自己那一個舊 md5 ⇒ 貼前世界(20260810170000)。';
  ELSIF v_new = 3 THEN
    RAISE NOTICE '對帳③:三支【各自】都等於自己那一個新 md5 ⇒ 貼後世界(20260906700000)。';
  ELSE
    RAISE EXCEPTION '對帳③:三支不在同一個世界(對到舊的 % 支 / 對到新的 % 支 / 共 3)⇒ 貼到一半, 停下來看。', v_old, v_new;
  END IF;
END
$rc$;
