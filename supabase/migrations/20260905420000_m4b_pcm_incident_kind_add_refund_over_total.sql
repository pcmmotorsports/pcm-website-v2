-- ═══════════════════════════════════════════════════════════════════════════
-- `pcm_incident.kind` 封閉集加一值:`refund_over_total`
--   (2026-09-05 主視窗 -f8 裁:由線【DB】出這一支, account 片③ 只呼叫不碰 CHECK)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ■ 段一 · 為什麼由這條線出, 而不是讓寫入方各自 ALTER
--   `kind` 的封閉集是 `pcm_incident`(20260905290000)**唯一擋得住「什麼都往裡面丟」的東西**
--   —— 那支檔頭逐字寫著這句。
--   🔴 若每一條想寫入的線各自 `ALTER … CHECK`, 那個封閉集就變成**開放集, 只是要多打一行**
--   ⇒ 📌 **一道守門的價值等於「繞過它要多費多少事」, 而各自 ALTER 把那個成本降到一行。**
--   🔵 另外兩個理由(都是這張表的知識, 不該讓每條線各自重想一次):
--     · `DROP CONSTRAINT` 之後、`ADD` 之前那個瞬間**封閉集是開的** ⇒ 必須包在同一個交易裡
--     · `ADD CONSTRAINT` 會重驗全表 ⇒ 表大了要用 `NOT VALID` + `VALIDATE`(今天不必, 見段三)
--
-- ■ 段二 · 這一值是給誰的
--   線【帳務】`-d8` 片③(退款狀態照事實走):**超退**(退款總額 > 訂單金額)這件事
--   主視窗裁「寫進 `pcm_incident_log(kind='refund_over_total')` 當等價告警」。
--   🛑 **本片只加那個值, 不寫入、不告警** —— 寫入是片③ 的事, 告警端的白名單在同一顆 commit 的 TS 那半。
--
-- ■ 段三 · 貼進正式庫會發生什麼 · 以及它的依賴
--   🔬 2026-09-05 唯讀實測:
--     · `pcm_incident_kind_check` 的定義逐字是 `CHECK ((kind = 'pending_refund_open_failed'::text))`
--       —— ⚠️ PG 把 `IN (單一值)` **折成了 `=`**;所以本片的前置閘比對的是**折過之後**那個字面。
--     · `SELECT count(*) FROM public.pcm_incident` ⇒ **`ERROR: permission denied for table pcm_incident`**
--       ⇒ 🔵 那是**預期**:20260905290000 刻意讓這張表對每一個角色都隱形, 只有 definer 函式進得去。
--       ⇒ 📌 **所以「表上有幾列」我量不到** —— 而 `ADD CONSTRAINT` 會重驗全表,
--         那張表今天最多只有極少列(它從今晚才存在, 而唯一的寫入口在一條被吞掉的例外路徑上)
--         ⇒ 重驗的成本可以忽略。**這句是推論不是量到的, 標在這裡。**
--   🔴🔴 **片③ 有一個依賴, 而它壞掉時是安靜的**:
--     本片**先貼**, 片③ 才能寫 `refund_over_total`。順序反了 ⇒ `pcm_incident_log` 丟 `check_violation`
--     ⇒ 而它在 `pcm_noncard_settle_recompute` 裡**被內層 handler 吞掉**
--     ⇒ 📌 **超退那件事會安靜地不留痕, 而畫面全綠。**
--     ⇒ 這句已請主視窗記進 handoff, 並直接告知 `-d8`。
--
-- ↩️ Rollback:`supabase/rollbacks/20260905420000-rollback.sql`
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ── 前置閘 ──────────────────────────────────────────────────────────────
DO $gate$
DECLARE v_def text;
BEGIN
  IF to_regclass('public.pcm_incident') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.pcm_incident 不存在 ⇒ 先貼 20260905290000(貼板 36)';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = to_regclass('public.pcm_incident')
     AND con.conname = 'pcm_incident_kind_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到約束 pcm_incident_kind_check ⇒ 有人拿掉了那個封閉集 ⇒ 停下人工確認';
  END IF;

  -- 🔵 **冪等**:已經是兩值的形狀 ⇒ 本片已經做過了, no-op。
  --    ⇒ 📌 不把它判成紅 —— 「已經做過」與「被別人破壞」的下一步完全不同。
  IF pg_catalog.strpos(v_def, 'refund_over_total') > 0 THEN
    RAISE NOTICE '前置閘:約束裡已經有 refund_over_total ⇒ 本片已經做過了 ⇒ no-op, 事後閘照跑。';
    RETURN;
  END IF;

  -- 🔴 逐字比對【折過之後】那個字面 —— PG 把 `IN (單一值)` 存成 `=`。
  --    寫成 `IN ('pending_refund_open_failed')` 去比會永遠不符, 而那個紅與它要守的事無關。
  IF v_def <> 'CHECK ((kind = ''pending_refund_open_failed''::text))' THEN
    RAISE EXCEPTION '前置閘③:約束現在是「%」, 而我抽取時是 CHECK ((kind = ''pending_refund_open_failed''::text))⇒ 中間有人動過, 拒繼續', v_def;
  END IF;
END $gate$;

-- ── 換約束(同一個交易 ⇒ 中間那個「封閉集是開的」瞬間對外不存在)──────────
ALTER TABLE public.pcm_incident DROP CONSTRAINT IF EXISTS pcm_incident_kind_check;
ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
  CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total'));

COMMENT ON CONSTRAINT pcm_incident_kind_check ON public.pcm_incident IS
  '封閉集:新增一種事故要【明文】改這裡。🔴 這是本表唯一擋得住「什麼都往裡面丟」的東西, '
  '而它的價值等於「繞過它要多費多少事」⇒ 不要讓寫入方各自 ALTER。'
  ' pending_refund_open_failed(20260905290000)· refund_over_total(20260905420000, 給 -d8 片③ 超退)';

-- ── 事後閘:兩個世界都要表演 ────────────────────────────────────────────
DO $after$
DECLARE
  v_def      text;
  v_probe_id bigint;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = to_regclass('public.pcm_incident')
     AND con.conname = 'pcm_incident_kind_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:約束不見了 ⇒ DROP 成功而 ADD 沒成功';
  END IF;
  IF pg_catalog.strpos(v_def, 'refund_over_total') = 0 THEN
    RAISE EXCEPTION '事後閘②:新值沒進去(現在是「%」)', v_def;
  END IF;
  IF pg_catalog.strpos(v_def, 'pending_refund_open_failed') = 0 THEN
    RAISE EXCEPTION '事後閘③:舊值不見了(現在是「%」)⇒ 我換掉的不只是我要換的', v_def;
  END IF;

  -- 🔴 **不要只看約束的字面** —— 字面對而行為不對是可能的(例如約束被建成 NOT VALID)。
  --    ⇒ 下面兩發是【真的寫進去再刪掉】, 兩個方向各一次。
  BEGIN
    -- 🔴 codex must-fix ①:原版用 `DELETE … WHERE detail = '…'` 刪回去
    --    ⇒ 📌 **既有事故若恰好有相同的 detail, 會被一起刪掉。**
    --      而那張表裝的是「有人匯了錢而退款單沒開成」—— 刪掉一列等於刪掉一件真事故,
    --      🛑 而它**不會有任何訊號**(這張表沒有人在看, 那正是它存在的理由)。
    --    ⇒ 改成 `RETURNING id` 拿到【這一列】的 id 再刪。
    INSERT INTO public.pcm_incident (kind, subject_id, detail)
    VALUES ('refund_over_total', NULL, 'after-check 正對照, 同一個 DO 裡刪掉')
    RETURNING id INTO v_probe_id;
    DELETE FROM public.pcm_incident WHERE id = v_probe_id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '事後閘④(正對照):新值 refund_over_total 竟然寫不進去 ⇒ 約束的字面對而行為不對';
  END;

  BEGIN
    INSERT INTO public.pcm_incident (kind, subject_id, detail)
    VALUES ('__不在封閉集裡的種類__', NULL, 'after-check 負對照');
    RAISE EXCEPTION '事後閘⑤(負對照):不在封閉集裡的 kind 竟然寫得進去 ⇒ 這張表擋不住「什麼都往裡面丟」';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- ✅ 這才是對的
  END;

  RAISE NOTICE '事後閘全過:兩個值都在 · 新值真的寫得進去 · 封閉集仍擋得住不在集合裡的。';
  RAISE NOTICE '⚠️ 本閘讓 pcm_incident_id_seq 前進了兩格(nextval 不隨交易回滾)⇒ 事故 id 不連續是【預期】。';
END $after$;

COMMIT;
