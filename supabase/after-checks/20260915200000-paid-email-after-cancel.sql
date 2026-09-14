-- 20260915200000-paid-email-after-cancel.sql —— ⟦f3-PAIDCANCELRACE1⟧ 驗收(拋棄式 PG;零留痕:整包 ROLLBACK)。
--
-- 跑法:psql -h /tmp -p <PG> -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/after-checks/20260915200000-paid-email-after-cancel.sql
-- 🛑 會改 orders.cancelled_at、塞 email_outbox 列 ⇒ 只在拋棄式 PG 跑, 不要對正式庫跑。
--
-- 🛑🛑 必要格(plan §3):造一筆「取消之後付款信才標記寄出」⇒ 訊號【必須叫】。沒有它本片不得提交 ——
--    正式庫今天分母是 0, 而分母是 0 的訊號, 沉默不能當證據。
-- 🔴 突變證明(拋棄式 PG 實跑):三處述詞一起改 `<` / 只改計數那一處改 `<` ⇒ 兩種都必須紅(見 scratch mut 腳本)。
--    ⚠️ codex R1:三處一起反轉時 ①② 互換而最終計數仍是 1 ⇒ 所以先造 ② 單獨量一段(② 階段疑似必須是 0)。
-- ⚠️ 射程:沒有造超過 20 張(拋棄式 PG 只有 10 張單)⇒ 拿掉 LIMIT 的突變本檔抓不到;LIMIT 由 migration 字面與 codex 核。
--
-- 世界(全部用「本來沒取消、身上沒有任何信」的單, 以增量比, 不吃庫裡既有資料):
--   ① 競態:取消 T-2h, order_created 寄出 T-1h                ⇒ 算疑似、進分母、進清單
--   ② 正常事後取消:order_created 寄出 T-2h, 取消 T-1h        ⇒ 不算疑似、進分母
--   ③ 取消而身上沒有信                                          ⇒ 不算、不進分母
--   ④ 取消信在取消之後寄(order_cancelled)                     ⇒ 不算、不進分母
--   ⑤ 同一張 ① 再加一列 LINE 的 order_created(也在取消後)     ⇒ 疑似仍只多 1 張(數張數不數列)
--   ⑥ ① 那張的 order_created 若是 status='failed'(另開一張)  ⇒ 不算(沒寄出)

BEGIN;

DO $chk$
DECLARE
  v_fail   text[] := ARRAY[]::text[];
  v_ids    uuid[];
  v_disp   text[];
  v_before jsonb;
  v_after  jsonb;
  v_t      timestamptz := pg_catalog.now();
  v_list   jsonb;
BEGIN
  SELECT pg_catalog.array_agg(x.id ORDER BY x.created_at), pg_catalog.array_agg(x.display_id ORDER BY x.created_at)
    INTO v_ids, v_disp
    FROM (SELECT o.id, o.display_id, o.created_at
            FROM public.orders o
           WHERE o.cancelled_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.email_outbox e WHERE e.order_id = o.id)
           ORDER BY o.created_at
           LIMIT 5) x;
  IF COALESCE(pg_catalog.cardinality(v_ids), 0) < 5 THEN
    RAISE EXCEPTION '前提不齊:需要 5 張「沒取消、身上沒有信」的單, 只有 % 張 ⇒ 驗收做不了(不是過)', COALESCE(pg_catalog.cardinality(v_ids), 0);
  END IF;

  v_before := public.get_paid_email_after_cancel_counts();
  -- 🔴 codex R1 important:既有疑似單非 0 ⇒ 清單有 LIMIT 20, 新造的那張可能被正確地排除而本檔誤判紅 ⇒ 前提不齊就明講。
  IF (v_before->>'suspect_count')::int <> 0 THEN
    RAISE EXCEPTION '前提不齊:庫裡已有 % 張疑似單 ⇒ 清單格判不準(不是過), 換一台乾淨的拋棄式 PG', v_before->>'suspect_count';
  END IF;

  -- ② 正常事後取消【先造】—— 🔴 codex R1 important:三處一起反轉時 ①② 互換而計數仍是 1
  --    ⇒ 分兩段量:只有 ② 時疑似增量必須是 0、分母 +1(單獨抓計數述詞反轉)。
  UPDATE public.orders SET cancelled_at = v_t - interval '1 hour' WHERE id = v_ids[2];
  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, sent_at, channel)
  VALUES ('order_created', v_ids[2], 'zzq-ac-2', 'zzq@example.com', 's', '{}'::jsonb, 'sent', v_t - interval '2 hours', 'email');
  v_after := public.get_paid_email_after_cancel_counts();
  IF (v_after->>'suspect_count')::int <> 0 THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('② 階段:正常事後取消被算成疑似 %s 張(期望 0)⇒ 計數述詞方向反了', v_after->>'suspect_count'));
  END IF;
  IF (v_after->>'total_count')::int - (v_before->>'total_count')::int <> 1 THEN
    v_fail := pg_catalog.array_append(v_fail, '② 階段:分母沒 +1');
  END IF;
  IF v_after->>'oldest_suspect_sent_at' IS NOT NULL OR pg_catalog.jsonb_array_length(v_after->'suspect_orders') <> 0 THEN
    v_fail := pg_catalog.array_append(v_fail, '② 階段:沒有疑似而 oldest / 清單不是空的');
  END IF;

  -- ① 競態
  UPDATE public.orders SET cancelled_at = v_t - interval '2 hours' WHERE id = v_ids[1];
  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, sent_at, channel)
  VALUES ('order_created', v_ids[1], 'zzq-ac-1', 'zzq@example.com', 's', '{}'::jsonb, 'sent', v_t - interval '1 hour', 'email');
  -- ③ 取消而沒有信
  UPDATE public.orders SET cancelled_at = v_t - interval '2 hours' WHERE id = v_ids[3];
  -- ④ 取消信在取消之後寄
  UPDATE public.orders SET cancelled_at = v_t - interval '2 hours' WHERE id = v_ids[4];
  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, sent_at, channel)
  VALUES ('order_cancelled', v_ids[4], 'zzq-ac-4', 'zzq@example.com', 's', '{}'::jsonb, 'sent', v_t - interval '1 hour', 'email');
  -- ⑤ 同一張 ① 再一列 LINE
  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, sent_at, channel)
  VALUES ('order_created', v_ids[1], 'zzq-ac-1-line', 'zzq@example.com', 's', '{}'::jsonb, 'sent', v_t - interval '30 minutes', 'line');
  -- ⑥ 取消後才有一列, 而它沒寄出(failed)
  UPDATE public.orders SET cancelled_at = v_t - interval '2 hours' WHERE id = v_ids[5];
  INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload, status, sent_at, channel)
  VALUES ('order_created', v_ids[5], 'zzq-ac-6', 'zzq@example.com', 's', '{}'::jsonb, 'failed', v_t - interval '1 hour', 'email');

  v_after := public.get_paid_email_after_cancel_counts();
  v_list  := v_after->'suspect_orders';

  -- ①⑤ 疑似正好多 1 張(不是 2:LINE 那列不多算)
  IF (v_after->>'suspect_count')::int - (v_before->>'suspect_count')::int <> 1 THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('①⑤ 疑似增量 %s(期望 1)', (v_after->>'suspect_count')::int - (v_before->>'suspect_count')::int));
  END IF;
  -- 分母正好多 2 張(①②;③沒信、④不是付款信、⑥沒寄出)
  IF (v_after->>'total_count')::int - (v_before->>'total_count')::int <> 2 THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('分母增量 %s(期望 2:①②)', (v_after->>'total_count')::int - (v_before->>'total_count')::int));
  END IF;
  -- ① 在清單裡、而且只出現一次
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_list) x WHERE x->>'display_id' = v_disp[1]) <> 1 THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('① 清單裡 %s 不是正好一次(清單 %s)', v_disp[1], v_list));
  END IF;
  -- ②③④⑥ 不在清單裡
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_list) x WHERE x->>'display_id' IN (v_disp[2], v_disp[3], v_disp[4], v_disp[5])) THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('②③④⑥ 有一張跑進清單了(清單 %s)', v_list));
  END IF;
  -- 清單的寄出時刻是那張單【最早】那一封(email T-1h, 不是 LINE T-30m)
  IF (SELECT (x->>'sent_at')::timestamptz FROM pg_catalog.jsonb_array_elements(v_list) x WHERE x->>'display_id' = v_disp[1])
     IS DISTINCT FROM v_t - interval '1 hour' THEN
    v_fail := pg_catalog.array_append(v_fail, '① 清單的 sent_at 不是那張單最早那一封');
  END IF;
  -- 最舊時刻【正好】是 ① 那一封(前提已擋掉既有疑似單 ⇒ 精確比;null 也會紅)
  IF (v_after->>'oldest_suspect_sent_at')::timestamptz IS DISTINCT FROM v_t - interval '1 hour' THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('oldest_suspect_sent_at %s 晚於 ① 那一封', v_after->>'oldest_suspect_sent_at'));
  END IF;
  -- 清單上限 20
  IF pg_catalog.jsonb_array_length(v_list) > 20 THEN
    v_fail := pg_catalog.array_append(v_fail, '清單超過 20 張');
  END IF;

  IF pg_catalog.cardinality(v_fail) > 0 THEN
    RAISE EXCEPTION '🔴 20260915200000 after-check 紅 % 格:%', pg_catalog.cardinality(v_fail), pg_catalog.array_to_string(v_fail, ' ‖ ');
  END IF;
  RAISE NOTICE '✅ 20260915200000 after-check 全過(①競態會叫 ②正常事後取消不叫 ③沒信不進分母 ④取消信不算 ⑤LINE 不重算 ⑥沒寄出不算 · 清單 / 最舊 / 上限)';
END
$chk$;

ROLLBACK;
