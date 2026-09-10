-- 回退 20260910080000_m4b_manual_order_no_recipient_terminal_state.sql
-- ⟦auth-MANUALORDERLIMITBURN⟧ 片 1/2
--
-- 🔴🔴 **退之前先確認沒有列在用那個狀態** —— CHECK 只在寫入時驗,
--    而 `ADD CONSTRAINT` 會掃全表:**只要有一列是 `skipped_manual_no_recipient`,這支會炸。**
--    ⇒ 那是**對的行為**:退掉一個還有人在用的狀態 = 讓那些列變成寫不進去的孤兒。
--    ✅ 所以下面先數一次,有就明講,不硬退。
--
-- 🛑 **而退了之後會發生什麼要講清楚**:片 2 的碼(若已上線)會開始撞 CHECK ⇒ 手動單那條路 throw
--    ⇒ 📌 **回到「每輪重撈」之前,會先經過一段「每輪報錯」。**
--    ⇒ 🔴 **要退,片 2 的碼要先下線**,順序與貼上去的時候相反。

-- 🔴 **這裡刻意【沒有】 `\set ON_ERROR_STOP on`**(2026-09-10 codex R1 must-fix)——
--    那是 psql 的反斜線指令,不是 SQL。貼板工具 `scripts/apply-paste-board.sh:530` **白名單式全拒**
--    所有 `\` 指令(理由:`\!` 能跑 shell、`\c` 能換庫而 A/B 驗證看不到、`\quit` 能提早成功離開)。
--    🟢 而我是**自己數過才承認的**:repo 409 支 migration 裡有這一行的 = **1 支,就是我這支**
--       ⇒ 我抄錯了地方(抄的是 `supabase/rollbacks/` 那邊的少數寫法,而那些不走貼板工具)。
--    ✅ 錯誤中止由執行端給:`psql -v ON_ERROR_STOP=1`(貼板工具本來就有傳)。
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.email_outbox
   WHERE status = 'skipped_manual_no_recipient';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      '回退拒絕:已有 % 列是 skipped_manual_no_recipient ⇒ 退掉這個狀態會讓那些列變成寫不進去的孤兒。先決定那些列怎麼處理(改成別的終態 / 保留), 再退。', v_n;
  END IF;
END
$guard$;

ALTER TABLE public.email_outbox
  DROP CONSTRAINT email_outbox_status_check;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'sending'::text,
      'sent'::text,
      'failed'::text,
      'skipped_no_real_email'::text,
      'skipped_order_ineligible'::text,
      'skipped_shipment_voided'::text
    ])
  );

-- 斷言:退回七個,而第八個真的不見了。
DO $assert$
DECLARE
  v_def  text;
  v_want text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'email_outbox'
     AND con.conname = 'email_outbox_status_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '回退斷言失敗:email_outbox_status_check 不見了';
  END IF;

  FOREACH v_want IN ARRAY ARRAY[
    'pending', 'sending', 'sent', 'failed',
    'skipped_no_real_email', 'skipped_order_ineligible', 'skipped_shipment_voided'
  ] LOOP
    IF pg_catalog.strpos(v_def, '''' || v_want || '''') = 0 THEN
      RAISE EXCEPTION '回退斷言失敗:少了舊值 %', v_want;
    END IF;
  END LOOP;

  IF pg_catalog.strpos(v_def, '''skipped_manual_no_recipient''') <> 0 THEN
    RAISE EXCEPTION '回退斷言失敗:第八態還在 ⇒ 這一支沒退乾淨';
  END IF;

  -- ⚪ 負對照:同一把 strpos 對現造字面必須回 0。
  IF pg_catalog.strpos(v_def, '''zzz_never_a_status_20260910''') <> 0 THEN
    RAISE EXCEPTION '回退斷言失敗(負對照):現造字面竟然命中 ⇒ 這把尺壞了';
  END IF;
END
$assert$;

COMMIT;
