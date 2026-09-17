-- supabase/rollbacks/20260917130000-rollback.sql
-- 還原 `20260917130000_m4b_order_payments_amount_comment_op2b_landed.sql`:
-- 把 `public.order_payments.amount` 的 COMMENT 退回【貼之前】那一句。
--
-- 🛑🛑 **絕對不要對正式庫跑這支。** 演練只在拋棄式 PG
--     (`scripts/migrations-replay-from-zero.sh --keep-db`)。
--
-- 🔴 **本檔嵌的是【貼之前】從正式庫 `col_description` 撈下來的原文**(2026-09-17,
--    md5 = da43a149e697091c7a89fbbfa574d94d, 長度 301 字元), **不是從 repo 的 20260810100000 抄的**。
--    那兩份不保證一樣 —— 中間可能有人改過 COMMENT 而沒回寫 repo。
--
-- 🟢 退這一支【不用先退碼】:本片零行為改動, 沒有任何程式讀這句 COMMENT。
--    (與大多數 rollback 相反, 所以特別寫出來。)

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:確認現在真的是【貼過本片】的狀態 ──────────────────────────────
-- 🔴🔴 **這一段我第一版寫錯了, 拋棄式 PG 上真的跑過才發現**(2026-09-17):
-- ```
-- ⛔ 我第一版寫:IF position('dormant gate' IN v_cur) <> 0 THEN RAISE '本片沒貼過'
--    而【貼完之後的新字面裡照樣有那五個字】—— 舊句原樣被引在 ⛔ 刪除線後面(repo 慣例)。
--    ⇒ 還原當場紅在前置閘, 說「本片沒貼過」, 而它其實剛剛才貼過。
--    📌 這與正片後置閘①是**同一個錯的兩個方向** —— 兩邊都改成釘 md5。
-- ```
DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT md5(col_description('public.order_payments'::regclass, a.attnum)) INTO v_md5
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid='public.order_payments'::regclass AND a.attname='amount';

  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '還原前置閘:amount 欄現在沒有 COMMENT ⇒ 這不是貼過本片的狀態 ⇒ 停下, 不要亂動';
  END IF;
  IF v_md5 = 'da43a149e697091c7a89fbbfa574d94d' THEN
    RAISE EXCEPTION '還原前置閘:現在就是【貼之前】那一句 ⇒ 本片沒貼過, 或已經還原過 ⇒ 停下, 不要重複跑';
  END IF;
  IF v_md5 IS DISTINCT FROM '83193f5fc7eab104b1abc5dd26139186' THEN
    RAISE EXCEPTION '還原前置閘:現在的 COMMENT md5 是 %, 既不是本片寫上去的 83193f5fc7eab104b1abc5dd26139186 也不是貼之前的 da43a149e697091c7a89fbbfa574d94d ⇒ 中間有人改過 ⇒ 停下, 由人判', v_md5;
  END IF;
END
$pre$;

-- ── 2. 還原(原文逐字) ──────────────────────────────────────────────────────
COMMENT ON COLUMN public.order_payments.amount IS '整數元、非零。收款列恆正;沖銷列 = 被沖列金額的反號(可正可負,必帶 reverses_payment_id)。🔴 現在真正在守的只有「收款恆正」(order_payments_reversal_shape);沖銷分支的 <> 0 與欄位 CHECK 同界、等於沒守。沖銷列的金額正確性(反號)與環的防護要等 A9 trigger(OP2b)——**在 OP2b 落地前,本表由 dormant gate 全擋、任何列都寫不進來**,不要把這句讀成「沖銷金額已經受保護」。⇒ 「已收」= SUM(amount)。🔴 退款不在本表(照 rail 分流到別的機制);沖銷 ≠ 退款,沖銷是登錄錯誤的更正。';

-- ── 3. 後置斷言:退回去的必須【逐字】等於貼之前那一句 ────────────────────────
DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(col_description('public.order_payments'::regclass, a.attnum)) INTO v_md5
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid='public.order_payments'::regclass AND a.attname='amount';
  IF v_md5 IS DISTINCT FROM 'da43a149e697091c7a89fbbfa574d94d' THEN
    RAISE EXCEPTION '還原後置閘:退回去的 COMMENT md5 是 %, 不是貼之前的 da43a149e697091c7a89fbbfa574d94d ⇒ 沒有真的還原 ⇒ 拒 COMMIT',
                    COALESCE(v_md5,'(沒有 COMMENT)');
  END IF;
  RAISE NOTICE '✅ 已逐字還原(md5 %)', v_md5;
END
$post$;

COMMIT;
