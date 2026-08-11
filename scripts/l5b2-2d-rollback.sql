-- ============================================================
-- L5b-2 片 2d · **回退腳本**(可直接執行,不是座標清單)
-- ============================================================
-- 標的:supabase/migrations/20260811110000_m4b_lifecycle_l5b2_2d_result_confirmed_event.sql
-- 作用:把 `result_confirmed` 撤出值域、terminal 集合退回 `result_success/result_failed/manual`,
--       回到片 2c(`20260811080000`)apply 後的形狀。
--
-- 用法(整份跑,不要只跑其中幾句):
--   psql "$DSN" -v ON_ERROR_STOP=1 -f scripts/l5b2-2d-rollback.sql
--
-- 🔴 **誰跑、用哪條 DSN**:主視窗(施工窗碰不到正式 DSN);正式庫回退**需 Sean 拍板**,與 apply 同停點層級。
--    DSN 取法照既有紀律 grep 單顆,**絕不 `source .env.local`**(memory `reference_never-source-env-local-use-grep`)。
--
-- ── 🔴🔴 順序:本檔必須跑在 `l5b2-2c-rollback.sql` **之前** ──────────────
--   機制在**本檔自己**:下面 `④ 回退後自驗` 釘死的子表 CHECK 集合**含 2c 的
--   `pre_manual_needs_verdict_chk`** ⇒ 先退 2c 的話,本檔會紅在自驗、2d 退不掉;
--   而那時 2c 也 apply 不回去(2c migration 的前置閘會擋住還帶 `result_confirmed` 的值域)
--   ⇒ **死角**。2026-08-11 實測三步:2c 回退 rc=0 完成 → 本檔紅在 ④ 的 CHECK 集合比對 →
--   2c re-apply 紅在 `20260811080000:167-178`(它釘死子表六值 pre-image 那段)。
--
--   ⚠️ **v1 檔頭把這件事寫反了**:原句宣稱「2c 的回退自驗會當場 abort」=有保護。實測 **rc=0、完成**。
--   那句 abort 訊息的真正執行者是 **2c migration 的前置閘**(re-apply 路徑),不是 2c 的回退自驗。
--   擋錯序的閘現在在 `l5b2-2c-rollback.sql` 的前置閘(2026-08-11 主視窗裁 A 後補上)。
--
-- ── ⚠️ 不可逆邊界:回退**可能被資料擋住,而且那是對的** ──────────────────
--   退回舊 terminal 集合 = `result_success` **重新**變成 terminal。
--   若期間已寫入「同一顆 refund 既有 `result_success` 又有 `result_confirmed`」的列
--   —— 那正是本片解鎖的形狀、也是它存在的理由 —— 舊唯一索引**建不回去**。
--   ⇒ 本檔有閘先算;非零就拒絕並要人決定留哪一筆。**不自動刪任何事件列**
--     (那張表是 append-only,而且刪掉的是「錢到底退了沒」的證據)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ① 前置閘:確認要撤的東西真的在,以及退得回去
DO $rb_2d_guard$
DECLARE
  v_def  text;
  v_pred text;
  v_dup  bigint;
  v_conf bigint;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.conname = 'pre_event_type_chk';
  -- 🔴 `to_regclass`(對抗審查 R1 nit):`::regclass` 在索引缺席時直接丟 42P01
  --    ⇒ 下面 `v_pred IS NULL` 那條人話**不可達**,災難當天只拿得到一句 catalog 錯誤。
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_pred
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_terminal_uniq');

  IF v_def IS NULL OR v_pred IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:pre_event_type_chk 或 pre_one_terminal_uniq 不存在 ⇒ 狀態不完整,停下人工判斷';
  END IF;

  -- 冪等:2d 的產物都已不在 ⇒ 本次是重跑
  IF pg_catalog.strpos(v_def, 'result_confirmed') = 0
     AND pg_catalog.strpos(v_pred, 'result_confirmed') = 0 THEN
    -- 🔴 **冪等分支也要逐字驗**(對抗審查 R2 must-fix,成立):這條分支只確認「不含 result_confirmed」,
    --    然後**照樣往下跑硬編碼的 DROP/ADD**。後面的片若加了一個不含該字串的新值(例如 2f 加 `settled`),
    --    這裡會判成「無事可做」、下面的 DDL 卻把那個值**無聲砍掉**,而④ 自驗比的正是砍完的那個形狀 ⇒ 全綠。
    --    ⇒ 冪等的前提是「現況就是 2c 之後的形狀」,不是「找不到我的字串」。
    IF v_def IS DISTINCT FROM
       'CHECK ((event_type = ANY (ARRAY[''sent''::text, ''result_success''::text,'
       || ' ''result_failed''::text, ''result_unknown''::text, ''reconcile''::text, ''manual''::text])))'
       OR v_pred IS DISTINCT FROM
       'CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id)'
       || ' WHERE (event_type = ANY (ARRAY[''result_success''::text, ''result_failed''::text, ''manual''::text]))' THEN
      RAISE EXCEPTION 'L5b-2-2d rollback:2d 的產物不在,但現況也**不是 2c 之後的逐字形狀** ⇒ '
                      '有別的片動過值域或索引述詞(而且沒用 result_confirmed 這個字)。'
                      '本檔下面的 DDL 是硬編碼的六值/舊述詞,跑下去會把那些改動無聲吃掉。停下人工判斷。'
                      'CHECK=[%] INDEX=[%]', v_def, v_pred;
    END IF;
    RAISE NOTICE 'L5b-2-2d rollback:2d 的產物都已不在、且現況逐字等於 2c 之後的形狀 ⇒ 冪等重跑'
                 '(下面的 DDL 會把同樣的定義再寫一次,語意上是 no-op);仍會跑自驗';
  ELSIF pg_catalog.strpos(v_def, 'result_confirmed') = 0
     OR pg_catalog.strpos(v_pred, 'result_confirmed') = 0 THEN
    -- 🔴 只撤了一半 = 有人手動動過。盲目往下會把狀態弄得更難查。
    RAISE EXCEPTION 'L5b-2-2d rollback:值域與索引述詞**只有一邊**還帶 result_confirmed ⇒ 狀態不一致,停下。'
                    'CHECK=[%] INDEX=[%]', v_def, v_pred;
  ELSE
    -- 🔴🔴 **2d post-image 逐字釘死**(對抗審查 R1 must-fix,成立):上面兩條只看
    --    `result_confirmed` 這個**子字串**。後面的片若在值域再加一個值(例如 2e 加 `reconciled`),
    --    子字串仍命中 ⇒ 本檔會照著硬編碼的六值 `ADD CONSTRAINT` 把那個新值**無聲砍掉**,
    --    而④ 的回退自驗比的是「2c 當時的形狀」—— 砍完剛好符合 ⇒ **自驗綠、資料契約已被吃掉**。
    --    ⇒ 破壞性 DDL 之前先確認「我要退的就是 2d 那一版」,不是「長得有點像」。
    IF v_def IS DISTINCT FROM
       'CHECK ((event_type = ANY (ARRAY[''sent''::text, ''result_success''::text,'
       || ' ''result_confirmed''::text, ''result_failed''::text, ''result_unknown''::text,'
       || ' ''reconcile''::text, ''manual''::text])))'
       OR v_pred IS DISTINCT FROM
       'CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id)'
       || ' WHERE (event_type = ANY (ARRAY[''result_confirmed''::text, ''result_failed''::text, ''manual''::text]))' THEN
      RAISE EXCEPTION 'L5b-2-2d rollback:現況帶 result_confirmed,但**不是 2d 的 post-image 逐字形狀** ⇒ '
                      '有別的片在 2d 之後動過值域或索引述詞。本檔會用硬編碼的六值重建值域 ⇒ '
                      '盲目往下會把那些改動無聲吃掉。停下人工判斷。CHECK=[%] INDEX=[%]', v_def, v_pred;
    END IF;
  END IF;

  -- 🔴 欄型別/NOT NULL 也釘(對抗審查 R1 must-fix:前置閘與 migration 不對稱)。
  --    `event_type` 的 NOT NULL 一旦掉了,CHECK 遇 NULL 一律放行 ⇒ 回退「成功」的宣稱是空的。
  --    (與 2c 回退 N1 那條同型:回退後的形狀不該比 apply 前少一道檢查。)
  IF (SELECT COALESCE(pg_catalog.string_agg(
        a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull::text, ',' ORDER BY a.attname), '(空)')
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.payment_refund_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
     IS DISTINCT FROM
     'created_at:timestamp with time zone:true,event_type:text:true,id:uuid:true,'
     || 'lease_token:integer:true,record_snapshot:jsonb:false,refund_id:uuid:true,seq:integer:true' THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:payment_refund_events 的欄型別/NOT NULL 與 pre-image 不符 ⇒ '
                    '本檔兩道守門(值域 CHECK 與 terminal 唯一索引)的效力前提已經不成立,停下';
  END IF;

  -- 🔴 資料閘:退回舊集合之後,`result_success` 重新算 terminal ⇒ 舊唯一索引可能建不回去
  SELECT COALESCE(count(*), 0) INTO v_dup FROM (
    SELECT refund_id FROM public.payment_refund_events
     WHERE event_type IN ('result_success','result_failed','manual')
     GROUP BY refund_id HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:有 % 顆 refund 在**舊** terminal 集合下會有多筆終局事件 ⇒ '
                    '舊唯一索引建不回去。最可能的原因是本片上線後已寫入 result_success + 隔日 result_confirmed 的正常鏈,'
                    '而退回舊語意會讓那條鏈變非法。**這需要人決定留哪一筆**,本檔不自動刪事件列'
                    '(append-only,且刪掉的是「錢退了沒」的證據)', v_dup;
  END IF;

  -- 資訊:還有幾筆 result_confirmed 會失去值域(它們不會被刪,但新 CHECK 會讓它們非法)
  SELECT count(*) INTO v_conf FROM public.payment_refund_events WHERE event_type = 'result_confirmed';
  IF v_conf > 0 THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:表內已有 % 筆 result_confirmed 事件 ⇒ 撤掉值域會讓既有列違反新 CHECK,'
                    'ADD CONSTRAINT 會當場失敗(fail-closed、方向安全)。'
                    '⇒ 要回退必須先由人處理這 % 筆(它們代表「已確認退款成功」的事實,不該無聲消失)', v_conf, v_conf;
  END IF;
END
$rb_2d_guard$;

-- ② 索引退回舊述詞(先索引後 CHECK:CHECK 收緊時若有殘列會失敗,順序不影響結果但錯誤訊息較清楚)
DROP INDEX IF EXISTS public.pre_one_terminal_uniq;
CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)
  WHERE event_type IN ('result_success','result_failed','manual');

-- 🔴 **回退不得留下 pre-image 沒有的東西**(對抗審查 R1 nit,成立):`20260810140000` 建這顆索引時
--    **沒給 COMMENT**(`grep -c 'COMMENT ON INDEX' supabase/migrations/20260810140000_*.sql` → 0),
--    本檔 v1 卻在回退時補寫了一句 ⇒ 「回到 2c apply 後的形狀」這個宣稱當場不成立,
--    而④ 自驗不比 comment ⇒ 這個偏離**永遠看不見**。改成明確清空,並由④ 驗它真的是空的。
COMMENT ON INDEX public.pre_one_terminal_uniq IS NULL;

-- ②-b 撤掉本片新增的 pre_one_success_uniq(純加法的逆動作)
-- 🔴 撤掉之後「每顆 refund 至多一筆 result_success」由**退回舊述詞的** pre_one_terminal_uniq 接手
--    (舊集合含 result_success)⇒ 保證不會在回退過程中出現空窗:上面②已先把舊索引建回去。
DROP INDEX IF EXISTS public.pre_one_success_uniq;

-- ③ 值域退回(撤掉 result_confirmed)
ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_event_type_chk;
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_event_type_chk
  CHECK (event_type IN ('sent','result_success','result_failed','result_unknown','reconcile','manual'));

-- ④ 回退後自驗(fail-closed;沒有這段,「回退成功」只是「沒報錯」)
DO $rb_2d_verify$
DECLARE
  v_cons text;
  v_pred text;
BEGIN
  -- 🔴 逐字比對回 2c 當時的形狀:**含 2c 自己那條** `pre_manual_needs_verdict_chk`
  --    (本檔不該動它;動到了就是回退越界)。
  SELECT COALESCE(pg_catalog.string_agg(
           c.conname || '=' || pg_catalog.pg_get_constraintdef(c.oid), ' | ' ORDER BY c.conname), '(空)')
    INTO v_cons
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.contype = 'c';
  IF v_cons IS DISTINCT FROM
     'pre_event_type_chk=CHECK ((event_type = ANY (ARRAY[''sent''::text, ''result_success''::text,'
     || ' ''result_failed''::text, ''result_unknown''::text, ''reconcile''::text, ''manual''::text])))'
     || ' | pre_lease_token_nonneg_chk=CHECK ((lease_token >= 0))'
     || ' | pre_manual_needs_verdict_chk=CHECK ((COALESCE((event_type <> ''manual''::text), false)'
     || ' OR COALESCE((jsonb_typeof((record_snapshot -> ''refunded''::text)) = ''boolean''::text), false)))'
     || ' | pre_seq_positive_chk=CHECK ((seq > 0))' THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:CHECK 集合沒回到 2c 後的形狀。實際=[%]', v_cons;
  END IF;

  SELECT COALESCE(pg_catalog.pg_get_indexdef(i.indexrelid), '(空)') INTO v_pred
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = 'public.pre_one_terminal_uniq'::regclass;
  IF v_pred IS DISTINCT FROM
     'CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id)'
     || ' WHERE (event_type = ANY (ARRAY[''result_success''::text, ''result_failed''::text, ''manual''::text]))' THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:pre_one_terminal_uniq 沒回到 pre-image。實際=[%]', v_pred;
  END IF;

  -- 🔴 本片新增的索引必須真的不在了(回退不完整=兩顆索引重疊守同一件事,語意上沒錯但形狀不是 pre-image)
  IF pg_catalog.to_regclass('public.pre_one_success_uniq') IS NOT NULL THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:pre_one_success_uniq 還在 ⇒ 回退不完整';
  END IF;

  -- 🔴 索引 comment 必須是空的(pre-image 沒有 comment;不驗的話上面那句 `IS NULL` 就沒人守)
  IF pg_catalog.obj_description(pg_catalog.to_regclass('public.pre_one_terminal_uniq'), 'pg_class') IS NOT NULL THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:pre_one_terminal_uniq 還帶著 COMMENT,而 pre-image 沒有 ⇒ 回退留下了殘留物';
  END IF;

  -- 零直權面(表級 + 欄級兩本帳)
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = 'public.payment_refund_events'::regclass AND a.grantee <> c.relowner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute att
    JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
    CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
     WHERE c.oid = 'public.payment_refund_events'::regclass
       AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'L5b-2-2d rollback:payment_refund_events 出現非 owner grantee ⇒ 回退弄髒了零直權面';
  END IF;

  RAISE NOTICE 'L5b-2-2d rollback 完成:result_confirmed 已撤出值域,terminal 集合回到 result_success/result_failed/manual。'
               '⇒ 現在才輪到 scripts/l5b2-2c-rollback.sql(順序不可顛倒)';
END
$rb_2d_verify$;

COMMIT;
