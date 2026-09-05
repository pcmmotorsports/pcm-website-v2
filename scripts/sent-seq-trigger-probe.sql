-- sent-seq-trigger-probe.sql —— ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 片 B-2 的行為探針
--
-- 🔴 **它問的是一件靜態守門答不出來的事**:那道 trigger 在真的 UPDATE 上會不會蓋章。
--    釘樁只證 trigger 存在;**存在的 trigger 也可以什麼都不做**(條件寫錯就是這樣)。
--
-- 用法(拋棄式 PG):
--   psql -h /tmp -p <port> -U postgres -d postgres -v ON_ERROR_STOP=1 -f scripts/sent-seq-trigger-probe.sql
-- 🔵 ROLLBACK 收尾 ⇒ 資料零留痕。
-- ⚠️ **而【序列不會回滾】**(codex R2 nit;PG 的 `nextval` 刻意不受交易控制)——
--    本探針每跑一發**永久消耗兩到三個序號**。⇒ 📌 那不影響正確性(序號只用來比大小,
--    不要求連續), 而**「零留痕」那句話要收窄成「資料零留痕」** —— 否則下一個人會拿它
--    去證一件它證不到的事。
BEGIN;

DO $$
DECLARE
  v_order uuid;
  v_id1 uuid; v_id2 uuid; v_id3 uuid;
  v_a bigint; v_b bigint; v_again bigint; v_failed bigint;
BEGIN
  -- ══ 前置閘:少了它, 下面每一格都會在一個【沒有 trigger 的庫】上全綠 ═══
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.email_outbox'::regclass
                    AND tgname  = 'pcm_email_outbox_stamp_sent_seq' AND NOT tgisinternal)
  THEN RAISE EXCEPTION '前置閘:trigger 不在 ⇒ 20260905200000 沒貼, 本探針測的不是我以為的東西'; END IF;

  -- 🔴 **不直接 INSERT customers** —— `auth.users` 上的 `handle_new_auth_user()` 會自己建那一列
  --    (直接插會撞 PK)。⇒ 走真的那條路建人(形狀照 `sent-tracking-three-worlds.sql:35-36`)。
  INSERT INTO auth.users(id, email)
  VALUES ('11111111-1111-1111-1111-111111111111', 'real@example.com');

  -- 造一張最小的單
  -- 🔵 欄位形狀照 `scripts/sent-tracking-three-worlds.sql:53-61`(那一份跑過)——
  --    不自己發明一組, 免得補到一半才發現少一個 NOT NULL。
  INSERT INTO public.orders(
    display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
    payment_status, subtotal, shipping_fee, total, shipping_method, invoice,
    shipping_method_at_checkout, notification_email, paid_at)
  VALUES ('PCM-2026-9001', '11111111-1111-1111-1111-111111111111',
    '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, 'general',
    'paid'::public.payment_status, 1000, 0, 1000, 'home', '{"type":"personal"}'::jsonb,
    'home', 'a@example.com', pg_catalog.now() - interval '3 day')
  RETURNING id INTO v_order;

  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, claimed_at)
       VALUES ('order_shipped', v_order, 'probe-seq-1', 'probe@example.com', 's', '{}'::jsonb, 'sending', pg_catalog.now())
    RETURNING id INTO v_id1;
  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, claimed_at)
       VALUES ('order_shipped', v_order, 'probe-seq-2', 'probe@example.com', 's', '{}'::jsonb, 'sending', pg_catalog.now())
    RETURNING id INTO v_id2;
  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, claimed_at)
       VALUES ('order_shipped', v_order, 'probe-seq-3', 'probe@example.com', 's', '{}'::jsonb, 'sending', pg_catalog.now())
    RETURNING id INTO v_id3;

  -- ── ① 進 sent ⇒ 蓋章
  UPDATE public.email_outbox SET status='sent', sent_at=pg_catalog.now(), claimed_at=NULL WHERE id=v_id1
    RETURNING sent_seq INTO v_a;
  IF v_a IS NULL THEN RAISE EXCEPTION '①:進 sent 而 sent_seq 還是 NULL ⇒ trigger 沒作用 ⇒ 整片等於沒做'; END IF;

  -- ── ② 第二封要拿到【比較大】的號 —— 單調性就是這一欄存在的理由
  UPDATE public.email_outbox SET status='sent', sent_at=pg_catalog.now(), claimed_at=NULL WHERE id=v_id2
    RETURNING sent_seq INTO v_b;
  IF v_b IS NULL OR v_b <= v_a THEN
    RAISE EXCEPTION '②:第二封的 sent_seq(%)沒有大於第一封(%)⇒ 它答不出誰比較晚', v_b, v_a; END IF;

  -- ── ③ 🔴 負對照:已經 sent 的列再被 update ⇒ **不得重蓋**
  --    重蓋的後果不是多一個號, 是那封信在時間軸上往前跳 ⇒ 被誤判成最後一封。
  UPDATE public.email_outbox SET request_id='x' WHERE id=v_id1 RETURNING sent_seq INTO v_again;
  IF v_again IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION '③:已 sent 的列被重蓋了(% ⇒ %)⇒ 舊信會被誤判成最後一封', v_a, v_again; END IF;

  -- ── ④ 🔴 負對照:轉去 failed ⇒ **不蓋**(它沒有寄出去)
  UPDATE public.email_outbox SET status='failed', claimed_at=NULL WHERE id=v_id3 RETURNING sent_seq INTO v_failed;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION '④:轉 failed 也被蓋了 % ⇒ 沒寄出去的信會被算進「最後告知」', v_failed; END IF;

  -- ── ⑤ 🔴🔴 **蓋了 seq【不代表】這一列是片 B 寫的。**(2026-09-05 codex R2 must-fix)
  --    上面四格只證「有沒有蓋章」, 而**那正是舊 writer 在部署窗口裡的狀態** ——
  --    有 seq、沒號碼、沒旗標。⇒ 📌 **本探針若只驗蓋章, 那條 must-fix 存在時它照樣全綠。**
  --    ✅ 所以這一格反過來斷言:trigger **不准**順手把出處旗標打開。
  IF (SELECT sent_tracking_recorded FROM public.email_outbox WHERE id = v_id1) IS NOT FALSE THEN
    RAISE EXCEPTION '⑤:trigger 把 sent_tracking_recorded 打開了 ⇒ 舊 writer 的列會被當成片 B 寫的 ⇒ 多寄更正信';
  END IF;
  IF (SELECT sent_tracking_number FROM public.email_outbox WHERE id = v_id1) IS NOT NULL THEN
    RAISE EXCEPTION '⑤-b:trigger 竟然動了號碼 ⇒ 它的職責只有序號';
  END IF;

  RAISE NOTICE '✅ 五格全過:①蓋章 %  ②單調 %  ③不重蓋  ④failed 不蓋  ⑤蓋章≠出處', v_a, v_b;
END $$;

ROLLBACK;
