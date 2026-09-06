-- ══════════════════════════════════════════════════════════════════════
-- Rollback:20260906940000_m4b_5b_complement_face_and_sent_seq_check
-- ══════════════════════════════════════════════════════════════════════
-- 🔴🔴 **這一份的驗收條件是【貼得下去】, 不是【讀得懂】** ——
--    要 rollback 的那一刻, 沒有人有心情去抄一支 view。
--    (同族的 20260905200000-rollback.sql 就是因為第一版留了一個 `...` 被連點三次。)
--
-- 🛑 **它還原兩件事, 而兩件都是可逆的**:
--    ① 互補面的 WHERE 換回第一代(只收「不是合法 UUID」那兩種壞法)
--    ② DROP 掉 sent_seq 的出處約束
--    ⇒ **不動任何欄位、不動 trigger、不動序列、不動 counts 函式** —— 本檔從來沒碰過它們。
--
-- ⚠️ **有一格不可逆**:rollback 之後, 「合法 UUID 而指不到箱」那一族會**再度從所有面上消失**
--    ⇒ 那段期間的資料品質訊號收不回來。**本檔還原判準, 不還原盲區裡發生過的事。**
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 鎖與逾時(codex 2026-09-06 R2 must-fix)═══════════════════════════
-- 🔴 ⛔ ~~原本這支檔沒有設逾時~~ —— 而 migration 那邊的 `SET LOCAL` **不會延續到這裡**
--    (SET LOCAL 只活在它自己那個交易裡)。
-- 🛑 而本檔的 `DROP CONSTRAINT` 一樣要 **ACCESS EXCLUSIVE** ⇒ 有長交易握著 email_outbox 時,
--    它會**排隊**, 而排隊中的 AEL 會把它後面的讀寫一起堵住。
--    ⇒ 📌 **rollback 是「出事時跑的那一支」** —— 它更不能自己變成第二個事故。
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ══ 前置閘:確認現在真的是本檔裝上去的那一版 ═══════════════════════════
DO $$
DECLARE v_def text; v_cols text; v_ands int; v_ors int; v_norm text;
BEGIN
  IF pg_catalog.to_regclass('public.pcm_tracking_corrected_payload_unparseable') IS NULL
  THEN RAISE EXCEPTION 'rollback 前置閘①:互補面不存在 ⇒ 沒有東西可以還原'; END IF;

  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_payload_unparseable'::regclass, true);
  -- 🔴🔴 **codex 2026-09-06 R1 nit:⛔ ~~原本這裡直接 RAISE~~ ⇒ 那讓 rollback【不能重跑】,
  --    而本檔第 62 行逐字寫著「rollback 要能重跑」⇒ 註解與行為互相矛盾。**
  -- ✅ 改法:分三個世界, 而**只有第三個才停**。
  --   ① 含 shipments 的 NOT EXISTS ⇒ 本檔貼過了 ⇒ 正常還原
  --   ② 不含 shipments 而含 pcm_safe_uuid ⇒ **已經 rollback 過** ⇒ 下面全是冪等的, 照跑
  --   ③ 兩者都不像 ⇒ 那是別人的版本 ⇒ **停下來, 不要覆蓋一個我沒讀過的 view**
  IF pg_catalog.strpos(v_def, 'shipments') > 0 AND pg_catalog.strpos(v_def, 'EXISTS') > 0 THEN
    RAISE NOTICE 'rollback:live 是 20260906940000 那一版 ⇒ 開始還原';
  ELSIF pg_catalog.strpos(v_def, 'pcm_safe_uuid') > 0 THEN
    -- 🔴🔴 **codex 2026-09-06 R2 must-fix:這個分支原本只問 pcm_safe_uuid 在不在** ——
    --    他的反例:rollback 之後有人替第一代**加了日期限制**、並重建一支同名而**更嚴格**的 CHECK
    --    ⇒ 我第二次跑 rollback 時照樣宣稱「冪等」⇒ **覆蓋掉他的 view、DROP 掉他的約束。**
    --    ⇒ 🛑 **「已經 rollback 過」與「別人在第一代上又動過」印同一個畫面。**
    -- ✅ 這個分支現在要三格全過才算真的是我認得的第一代:
    --    ①不含 shipments(註解本來就這樣承諾, 而原本沒有真的問)
    --    ②欄位清單逐字 ③條件個數 AND=3 / OR=0(多一個條件就紅)
    IF pg_catalog.strpos(v_def, 'shipments') > 0
    THEN RAISE EXCEPTION 'rollback 前置閘②a:這個分支本該是「不含 shipments」的第一代, 而它含 ⇒ 停下來看一眼'; END IF;
    SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.pcm_tracking_corrected_payload_unparseable'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_cols <> 'outbox_id,order_id,event_type,sent_at,shipment_id_raw'
    THEN RAISE EXCEPTION 'rollback 前置閘②b:第一代的欄位清單不是我認得的 ⇒ [%] ⇒ 不要覆蓋', v_cols; END IF;
    -- 🔴 先把所有空白(含 pretty-print 的換行與縮排)壓成單一空格 ——
    --    否則 `\n  AND (` 這種形狀在數 ' AND ' 時會漏掉, 而**漏數會讓這道閘靜靜放行**。
    v_norm := pg_catalog.upper(pg_catalog.regexp_replace(v_def, '\s+', ' ', 'g'));
    v_ands := (pg_catalog.length(v_norm)
               - pg_catalog.length(pg_catalog.replace(v_norm, ' AND ', ''))) / 5;
    v_ors  := (pg_catalog.length(v_norm)
               - pg_catalog.length(pg_catalog.replace(v_norm, ' OR ', ''))) / 4;
    IF v_ands <> 3 OR v_ors <> 0
    THEN RAISE EXCEPTION 'rollback 前置閘②c:第一代的條件個數不對(AND=% 期望 3 / OR=% 期望 0)⇒ 有人動過它 ⇒ 不要覆蓋', v_ands, v_ors; END IF;
    RAISE NOTICE 'rollback:live 是我認得的第一代 ⇒ 本檔已經 rollback 過, 下面照跑(冪等)';
  ELSE
    RAISE EXCEPTION 'rollback 前置閘②:live 的互補面既不是本檔的版本、也不是第一代 ⇒ 停下來看一眼, 不要覆蓋';
  END IF;
END $$;

-- ══ 1. 互補面換回第一代 ═════════════════════════════════════════════
-- 🔴 欄位清單與順序逐字不動(`CREATE OR REPLACE VIEW` 比的就是它)。
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_payload_unparseable
  WITH (security_invoker = true) AS
SELECT
  e.id           AS outbox_id,
  e.order_id     AS order_id,
  e.event_type   AS event_type,
  e.sent_at      AS sent_at,
  pg_catalog.left(e.payload ->> 'shipment_id', 64) AS shipment_id_raw
FROM public.email_outbox e
WHERE e.event_type IN ('order_shipped', 'shipment_tracking_corrected')
  AND e.status   = 'sent'
  AND e.sent_at IS NOT NULL
  AND public.pcm_safe_uuid(e.payload ->> 'shipment_id') IS NULL;

-- 🔴 `CREATE OR REPLACE VIEW` 保留既有 ACL ⇒ 這三行讓還原後的授權狀態不靠運氣。
REVOKE ALL ON public.pcm_tracking_corrected_payload_unparseable FROM PUBLIC;
REVOKE ALL ON public.pcm_tracking_corrected_payload_unparseable FROM anon, authenticated;
GRANT SELECT ON public.pcm_tracking_corrected_payload_unparseable TO service_role;

COMMENT ON VIEW public.pcm_tracking_corrected_payload_unparseable IS
$c$已寄出、而 `payload->>'shipment_id'` **不是合法 UUID**(或整個不在)的 outbox 列。
🔴 它們在判「我們最後一次告訴客人什麼」時**被略過** ⇒ **我們看不到那封信說了什麼。**
🛑 **已知盲區(20260906940000 rollback 之後回來的那一個)**:
   「是合法 UUID 而指不到任何 shipment」的列 **本面不收、主面也不收** ⇒ 它從所有面上消失。
✅ **語意**:資料品質訊號 —— 「有信寄出去了, 而我們讀不出它是哪一箱的」。
🛑 **零列不代表健康** —— 也可能代表「這裡根本沒有已寄出的信」。$c$;

-- ══ 2. DROP 掉出處約束 ══════════════════════════════════════════════
-- 🔵 `IF EXISTS`:rollback 要能重跑, 而「已經 drop 過」不是錯誤。
-- 🔴🔴 **codex R2 must-fix 的後半:不要 DROP 一條【我沒讀過】的同名約束。**
--    別人可能用同一個名字建了一條**更嚴格**的 CHECK ⇒ 無條件 DROP 會靜靜拆掉他的防線。
--    ✅ 先比對 `pg_get_constraintdef` 逐字, 對不上就停;不存在則跳過(重跑用)。
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname  = 'email_outbox_recorded_needs_sent_seq';
  IF v_def IS NULL THEN
    RAISE NOTICE 'rollback:約束不在 ⇒ 跳過(重跑時的正常路徑)';
  -- 🔵 兩個合法字面 = 同一條約束的兩個狀態(驗滿 / 還是 NOT VALID)。
  ELSIF v_def <> 'CHECK (((sent_tracking_recorded IS NOT TRUE) OR (sent_seq IS NOT NULL)))'
    AND v_def <> 'CHECK (((sent_tracking_recorded IS NOT TRUE) OR (sent_seq IS NOT NULL))) NOT VALID' THEN
    RAISE EXCEPTION 'rollback:同名約束的定義與我建的那一條逐字不同 ⇒ % ⇒ 停下來看一眼, 不要 DROP', v_def;
  ELSE
    EXECUTE 'ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_recorded_needs_sent_seq';
    RAISE NOTICE 'rollback:約束已 DROP';
  END IF;
END $$;

-- ══ 3. 事後閘 ═══════════════════════════════════════════════════════
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_payload_unparseable'::regclass, true);
  IF pg_catalog.strpos(v_def, 'shipments') > 0
  THEN RAISE EXCEPTION 'rollback 事後閘①:互補面仍含 shipments ⇒ 沒還原成功'; END IF;
  -- 🟢 正對照:第一代的元件必須在 —— 否則「還原了」與「把 view 弄壞了」印同一個綠。
  IF pg_catalog.strpos(v_def, 'pcm_safe_uuid') = 0
  THEN RAISE EXCEPTION 'rollback 事後閘②:互補面不含 pcm_safe_uuid ⇒ 還原出來的不是第一代'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.email_outbox'::regclass
                AND conname  = 'email_outbox_recorded_needs_sent_seq')
  THEN RAISE EXCEPTION 'rollback 事後閘③:約束還在'; END IF;
  -- 🟢 正對照:該讀得到的角色仍讀得到。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_tracking_corrected_payload_unparseable', 'SELECT')
  THEN RAISE EXCEPTION 'rollback 事後閘④:service_role 讀不到互補面 ⇒ 還原把授權弄掉了'; END IF;
END $$;

COMMIT;
