-- 20260915160000_m4b_03_zero_price_reason_fullwidth_rule.sql —— M-4b-03 改金額申請的「零元原因」:全形空白不算原因、零寬字元一個都不准
-- pcm:idempotent: yes
--   ↑ apply 當下的 DML 只有事後閘⑤c/⑤d/⑤f 三發 INSERT, 各自包在 BEGIN…EXCEPTION 子交易裡, 設計上【必定失敗並回滾】
--     (⑤c/⑤f 撞新 CHECK、⑤d 撞 FK);萬一真的寫進去, 同一個區塊緊接著 RAISE ⇒ 整支 migration 回滾, 一列都留不下。
--     ALTER TABLE 兩發都是 DROP … IF EXISTS 再 ADD ⇒ 重跑同形。探針實測重跑 rc=0。
--
-- 🛑 未貼(夜跑:主視窗自貼)。主視窗 2026-09-15 第 12 件 ①(B 窗查到)。
--
-- ══ 病 ═════════════════════════════════════════════════════════════════
-- 20260915050000 那兩道都用 btrim:表上 order_amount_requests_zero_price_reason_check = btrim(zero_price_reason) <> '';提案 RPC v_zero = NULLIF(btrim(…), '')。
-- btrim 只吃半形空白 ⇒ 只打一個全形空白「　」(U+3000)就算「有原因」, 零元改價過得去;零寬空白(U+200B 那一族)也一樣。
-- (畫面那條路:JS .trim() 吃得掉 U+3000 / NBSP 等 Unicode 空白、吃不掉零寬 ⇒ 員工從表單送零寬是真的進得去;全形空白只有直打 RPC 才進得去。TS 同 commit 補零寬那道。)
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- · 表:DROP order_amount_requests_zero_price_reason_check, ADD order_amount_requests_zero_price_reason_clean —— 不含零寬字元 且 修邊後非空。
--   修邊用【明列】的 Unicode White_Space 25 個碼位(U+0009-000D / 0020 / 0085 / 00A0 / 1680 / 2000-200A / 2028 / 2029 / 202F / 205F / 3000),逐碼位寫、不用區間。
--   ⛔ ~~POSIX [[:space:]]~~(codex R1 must-fix):它依 locale —— 2026-09-15 夜實量, 正式庫(ICU en_US.UTF-8)對 14 個抽樣碼位全吃,
--      探針(C locale)只吃 ASCII 4 個 ⇒ 同一支 SQL 在兩台庫擋的東西不一樣。明列之後兩台一致。
--   ⚠️ 收件三格(20260915070000)用的是 POSIX 空白類 + U+3000 —— 正式庫 ICU 下沒洞, 但同樣不是 locale 無關;回報主視窗, 本支不動。
-- · admin_request_order_item_amount 第 3 代 = 第 2 代(20260915130000)本體【逐字】+ 兩處:
--     v_zero 修邊改 regexp(明列 Unicode 空白);零元檢查之前加「零寬字元一個都不准」。
-- · 🔴 本支【不動】admin_update_order_item_amount(管理者直接改價那支, 別窗的線 20260915060000):它的零元原因檢查也是 btrim,
--   直打 RPC 一樣進得去 —— 回報主視窗另裁。畫面那條路由 TS parseAmountForm 兜住(兩條路共用)。
-- ══ 前提 ═══════════════════════════════════════════════════════════════
-- · 必須先貼 20260915130000(板 171):前置閘認 request 第 2 代 md5 b7ea2c9f246624a2c0a52d65d7327c3b;第 3 代 6da21d4766a87fc19248bb719a05d4f2 ⇒ 冪等;其他停。
-- · 正式庫 2026-09-15 夜唯讀查過:order_amount_requests 0 列、zero_price_reason 只住這張表 ⇒ 新 CHECK 撞不到既有列。前置閘仍當場再數一次。
-- 回滾:supabase/rollbacks/20260915160000_down.sql = request 貼回第 2 代本體 + CHECK 換回 btrim 那版(舊名)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_src text;
  v_cfg text[];
  v_bad bigint;
BEGIN
  SELECT p.proconfig, p.prosrc INTO v_cfg, v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:admin_request_order_item_amount 不在 ⇒ 20260915050000 還沒貼';
  END IF;
  IF v_cfg IS NULL OR NOT ('search_path=""' = ANY (v_cfg) OR 'search_path=' = ANY (v_cfg)) THEN
    RAISE EXCEPTION '前置閘⓪:search_path 不是空字串(%)⇒ 不認得的一代', v_cfg;
  END IF;
  IF pg_catalog.md5(v_src) = 'b7ea2c9f246624a2c0a52d65d7327c3b' THEN
    RAISE NOTICE '前置閘⓪:request 第 2 代在(md5 相符)⇒ 升第 3 代';
  ELSIF pg_catalog.md5(v_src) = '6da21d4766a87fc19248bb719a05d4f2' THEN
    RAISE NOTICE '前置閘⓪:request 已是第 3 代(md5 相符)⇒ 照樣重跑(冪等)';
  ELSE
    RAISE EXCEPTION '前置閘⓪:request md5(prosrc) = % 不是第 2 代也不是第 3 代 ⇒ 20260915130000(板 171)還沒貼, 或有人改過這支, 停', pg_catalog.md5(v_src);
  END IF;
  IF pg_catalog.to_regclass('public.order_amount_requests') IS NULL THEN
    RAISE EXCEPTION '前置閘①:order_amount_requests 不在';
  END IF;
  SELECT count(*) INTO v_bad FROM public.order_amount_requests
   WHERE NOT (zero_price_reason IS NULL OR (pg_catalog.translate(zero_price_reason, pg_catalog.chr(8203) || pg_catalog.chr(8204) || pg_catalog.chr(8205) || pg_catalog.chr(8288) || pg_catalog.chr(65279), '') = zero_price_reason AND pg_catalog.regexp_replace(zero_price_reason, E'^[\\u0009\\u000a\\u000b\\u000c\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+|[\\u0009\\u000a\\u000b\\u000c\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+$', '', 'g') <> ''));
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '前置閘②:已有 % 列的零元原因是全形空白 / 零寬字元 ⇒ 新 CHECK 會撞, 停下來看那些列', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.order_amount_requests'::regclass AND conname = 'order_amount_requests_zero_price_reason_check')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.order_amount_requests'::regclass AND conname = 'order_amount_requests_zero_price_reason_clean') THEN
    RAISE EXCEPTION '前置閘③:舊 CHECK order_amount_requests_zero_price_reason_check 與新 CHECK order_amount_requests_zero_price_reason_clean 都不在 ⇒ 不認得的表形狀, 停';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260915160000(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
END
$pre$;

ALTER TABLE public.order_amount_requests DROP CONSTRAINT IF EXISTS order_amount_requests_zero_price_reason_check;
ALTER TABLE public.order_amount_requests DROP CONSTRAINT IF EXISTS order_amount_requests_zero_price_reason_clean;
ALTER TABLE public.order_amount_requests ADD CONSTRAINT order_amount_requests_zero_price_reason_clean CHECK (zero_price_reason IS NULL OR (pg_catalog.translate(zero_price_reason, pg_catalog.chr(8203) || pg_catalog.chr(8204) || pg_catalog.chr(8205) || pg_catalog.chr(8288) || pg_catalog.chr(65279), '') = zero_price_reason AND pg_catalog.regexp_replace(zero_price_reason, E'^[\\u0009\\u000a\\u000b\\u000c\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+|[\\u0009\\u000a\\u000b\\u000c\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+$', '', 'g') <> ''));

CREATE OR REPLACE FUNCTION public.admin_request_order_item_amount(
  p_order_id uuid,
  p_order_item_id uuid,
  p_expected_version integer,
  p_to_unit_price integer,
  p_zero_price_reason text,
  p_reason text,
  p_actor text,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_existing public.order_amount_requests%ROWTYPE;
  v_ord      RECORD;
  v_item     RECORD;
  v_row      public.order_amount_requests%ROWTYPE;
  v_reason   text := pg_catalog.btrim(COALESCE(p_reason, ''));
  -- 🔴 第 3 代(20260915160000):⛔ ~~btrim~~ 只吃半形空白 ⇒ 只打一個全形空白「　」也算有原因。
  --    修邊改成【明列】Unicode White_Space 25 個碼位, 不用 POSIX 空白類(它跟著 locale 走 —— 正式庫 ICU 吃 NBSP, 探針 C locale 不吃;codex R1 must-fix)。
  v_zero     text := NULLIF(pg_catalog.regexp_replace(COALESCE(p_zero_price_reason, ''), E'^[\\u0009\\u000a\\u000b\\u000c\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+|[\\u0009\\u000a\\u000b\\u000c\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+$', '', 'g'), '');
  -- 零寬字元(同 20260915070000 那支的 v_zw):U+200B/C/D、U+2060、U+FEFF。
  v_zw constant text := pg_catalog.chr(8203) || pg_catalog.chr(8204) || pg_catalog.chr(8205)
                     || pg_catalog.chr(8288) || pg_catalog.chr(65279);
  v_n        integer;
  v_cname    text;
  v_payments integer;
BEGIN
  -- G1 輸入
  IF p_order_id IS NULL OR p_order_item_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: order_id / order_item_id / expected_version 必填';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: p_request_id 不可為空';
  END IF;
  IF p_to_unit_price IS NULL OR p_to_unit_price < 0 THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 想改成的單價要是 0 或正整數';
  END IF;
  IF v_reason = '' OR pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 要寫為什麼要改(1-500 字)';
  END IF;
  -- 🔴 第 3 代:零寬字元【一個都不准】(不是去掉再驗 —— 「零寬 + 空格」去掉零寬剩空格會混過;同收件三格 codex must-fix ①)。
  IF p_zero_price_reason IS NOT NULL AND pg_catalog.translate(p_zero_price_reason, v_zw, '') <> p_zero_price_reason THEN
    RAISE EXCEPTION '零元原因含看不見的字元(零寬空白等), 請重打一次';
  END IF;
  IF p_to_unit_price = 0 AND v_zero IS NULL THEN
    RAISE EXCEPTION '單價改為 0 需要填原因(例:贈品 / 換貨補寄)';
  END IF;
  IF p_to_unit_price > 0 AND v_zero IS NOT NULL THEN
    RAISE EXCEPTION '單價不是 0 時不得帶「零元原因」';
  END IF;
  -- G2 身分:啟用中員工即可(不必管理者)—— 提案不改任何金額。
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  -- G3 冪等:同 request_id 回同一筆(內容不再比對 —— 這一列不是錢, 只是申請;要改就重提一顆新 id)。
  -- 🔴 codex R1 must-fix ②:同鍵【併發】重送 —— 先用 advisory lock 把同一顆 request_id 序列化, 第二發進來時第一發已 commit ⇒ 查得到 ⇒ idempotent。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('order_amount_requests:' || p_request_id));
  SELECT * INTO v_existing FROM public.order_amount_requests r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'idempotent', 'request_row_id', v_existing.id, 'status', v_existing.status, 'order_id', v_existing.order_id);
  END IF;
  -- G4 單與品項(鎖序 orders → order_items, 與改價 RPC 同向)
  SELECT o.id, o.version, o.cancelled_at, o.discount_total, o.price_tax_mode, o.tax_total INTO v_ord FROM public.orders o WHERE o.id = p_order_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 訂單不存在';
  END IF;
  IF v_ord.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '這張單已取消, 不能再改金額';
  END IF;
  IF v_ord.version <> p_expected_version THEN
    RAISE EXCEPTION '這張單剛被別人改過(版本 % ≠ %), 請重新整理再提', v_ord.version, p_expected_version;
  END IF;
  -- 🔴 第 2 代(20260915130000):改價 RPC(admin_update_order_item_amount)的三道硬擋, 提案時就先擋 —— 條件與訊息逐字同它。
  --    不擋的話, 員工提得出申請、管理者核准那一刻才炸。收款進來【不動 orders.version】⇒ 提案後才收款的那條由 review RPC 自動退回兜底。
  SELECT count(*) INTO v_payments FROM public.order_payments p WHERE p.order_id = p_order_id;
  IF v_payments > 0 THEN
    RAISE EXCEPTION '這張單已經有收款紀錄(% 筆),目前不開放改金額 —— 因為「已收多少」的算法還沒定案。需要調整請走退款流程,或告知系統維護。', v_payments;
  END IF;
  IF v_ord.discount_total <> 0 THEN
    RAISE EXCEPTION '這張單有折扣(%),而本功能尚未處理折扣單的改價(#13 片1 已知限制 L2)。請告知系統維護。', v_ord.discount_total;
  END IF;
  IF v_ord.price_tax_mode = 'exclusive' OR COALESCE(v_ord.tax_total, 0) <> 0 THEN
    RAISE EXCEPTION '這張單的單價是【未稅】的(稅另計), 而改金額這個功能還不會重算稅 —— 目前不開放改。需要調整請告知系統維護。';
  END IF;
  SELECT i.id, i.unit_price INTO v_item FROM public.order_items i WHERE i.id = p_order_item_id AND i.order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 品項不在這張單上';
  END IF;
  IF v_item.unit_price = p_to_unit_price THEN
    RAISE EXCEPTION '想改成的單價與現在一樣(%), 不用提', p_to_unit_price;
  END IF;
  -- G5 落列(一品項一條 pending 由部分唯一索引擋 ⇒ 23505 轉成看得懂的話)
  BEGIN
    INSERT INTO public.order_amount_requests
      (order_id, order_item_id, expected_version, from_unit_price, to_unit_price, zero_price_reason, reason, requested_by, request_id)
    VALUES
      (p_order_id, p_order_item_id, p_expected_version, v_item.unit_price, p_to_unit_price, v_zero, v_reason, p_actor, p_request_id)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- 哪一道唯一撞到要分開講(codex R1 must-fix ②):request_id 那道 ⇒ 理論上被 advisory lock 擋掉, 真撞到就重讀回 idempotent;pending 那道 ⇒ 人話。
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname = 'order_amount_requests_request_id_uidx' THEN
      SELECT * INTO v_existing FROM public.order_amount_requests r WHERE r.request_id = p_request_id;
      IF FOUND THEN
        RETURN pg_catalog.jsonb_build_object('result', 'idempotent', 'request_row_id', v_existing.id, 'status', v_existing.status, 'order_id', v_existing.order_id);
      END IF;
      RAISE;
    ELSIF v_cname = 'order_amount_requests_one_pending_per_item' THEN
      RAISE EXCEPTION '這一項已經有一條待審的申請, 先請管理者處理那一條';
    ELSE
      RAISE;
    END IF;
  END;
  -- G6 稽核(同交易;落不進去整筆回滾)
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.item.amount.request', 'order_item:' || p_order_item_id::text, p_request_id,
          NULL,
          pg_catalog.jsonb_build_object('request_row_id', v_row.id, 'order_id', p_order_id,
            'from_unit_price', v_row.from_unit_price, 'to_unit_price', v_row.to_unit_price,
            'zero_price_reason', v_row.zero_price_reason, 'reason', v_row.reason),
          v_reason, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_request_order_item_amount: 稽核落 % 列 ⇒ 提案與留紀錄必須同生共死', v_n;
  END IF;
  RETURN pg_catalog.jsonb_build_object('result', 'ok', 'request_row_id', v_row.id, 'status', v_row.status, 'order_id', v_row.order_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) TO service_role;
ALTER FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) OWNER TO postgres;
COMMENT ON FUNCTION public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text) IS
  'M-4b-03 員工提「改品項單價」申請(SECDEF, service_role only)。第 3 代 20260915160000。啟用中員工即可;from 價由本函式讀 order_items, 不信 client;'
  ' 同 request_id 冪等;一品項一條 pending;提案時先擋改價 RPC 的三道硬擋(已收款 / 折扣 / 未稅);'
  ' 零元原因修邊含 U+3000、零寬字元一個都不准;不動任何金額;同交易寫 audit order.item.amount.request。';

DO $post$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure('public.admin_request_order_item_amount(uuid,uuid,integer,integer,text,text,text,text)');
  v_src text;
  v_bad text;
  v_msg text;
  v_cn  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid AND p.prosecdef
                  AND p.proconfig @> ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
    RAISE EXCEPTION '事後閘①:不是 SECURITY DEFINER / search_path 空字串 / owner postgres';
  END IF;
  SELECT pg_catalog.string_agg(COALESCE(r.rolname, 'PUBLIC'), ', ') INTO v_bad
    FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
   WHERE p.oid = v_oid AND COALESCE(r.rolname, 'PUBLIC') NOT IN ('postgres', 'service_role');
  IF v_bad IS NOT NULL OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②:EXECUTE 應只給 service_role(非白名單:%)', v_bad;
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF pg_catalog.strpos(v_src, '零元原因含看不見的字元') = 0 OR pg_catalog.strpos(v_src, E'\\u00a0') = 0 OR pg_catalog.strpos(v_src, E'\\u202f') = 0 THEN
    -- ↑ codex R2 must-fix:一般字串 '\u00a0' 在 standard_conforming_strings=off 時會被解析成真的 NBSP ⇒ 函式體裡找不到 ⇒ 誤判回滾。E'\\…' 兩種設定都是反斜線字面。
    RAISE EXCEPTION '事後閘③:request 函式體沒有零寬 / 全形空白那兩處 ⇒ 貼到的不是第 3 代';
  END IF;
  IF pg_catalog.strpos(v_src, '這張單已經有收款紀錄') = 0 OR pg_catalog.strpos(v_src, 'order_amount_requests_one_pending_per_item') = 0
     OR pg_catalog.strpos(v_src, '''idempotent''') = 0 THEN
    RAISE EXCEPTION '事後閘③:第 2 代的三道預檢 / 一品項一條 pending / 冪等少了 ⇒ 聯集漏了';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.order_amount_requests'::regclass AND conname = 'order_amount_requests_zero_price_reason_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.order_amount_requests'::regclass AND conname = 'order_amount_requests_zero_price_reason_clean') THEN
    RAISE EXCEPTION '事後閘④:舊 CHECK 還在或新 CHECK 沒建';
  END IF;
  -- ⑤ 活體(全在子交易, 零寫入):
  --   a. 零元 + 原因只有零寬 ⇒ RPC 擋在零寬那道(在 actor / 訂單查詢之前)
  BEGIN
    PERFORM public.admin_request_order_item_amount('00000000-0000-4000-8000-000000000000'::uuid, '00000000-0000-4000-8000-000000000000'::uuid,
      1, 0, pg_catalog.chr(8203), 'postgate', 'postgate-nobody', 'postgate-160-a');
    RAISE EXCEPTION '事後閘⑤a:零寬原因居然沒被擋';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> '零元原因含看不見的字元(零寬空白等), 請重打一次' THEN RAISE EXCEPTION '事後閘⑤a:回了 %', v_msg; END IF;
  END;
  --   b. 零元 + 原因只有全形空白 ⇒ 當成沒填原因
  BEGIN
    PERFORM public.admin_request_order_item_amount('00000000-0000-4000-8000-000000000000'::uuid, '00000000-0000-4000-8000-000000000000'::uuid,
      1, 0, E'\u3000', 'postgate', 'postgate-nobody', 'postgate-160-b');
    RAISE EXCEPTION '事後閘⑤b:全形空白原因居然沒被擋';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> '單價改為 0 需要填原因(例:贈品 / 換貨補寄)' THEN RAISE EXCEPTION '事後閘⑤b:回了 %', v_msg; END IF;
  END;
  --   c. 表 CHECK:直接 INSERT 全形空白原因 ⇒ 23514 撞新 CHECK(CHECK 先於 FK 觸發)
  BEGIN
    INSERT INTO public.order_amount_requests (order_id, order_item_id, expected_version, from_unit_price, to_unit_price, zero_price_reason, reason, requested_by, request_id)
    VALUES ('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', 1, 1, 0, E'\u3000', 'postgate', 'postgate', 'postgate-160-c');
    RAISE EXCEPTION '事後閘⑤c:全形空白原因居然進得了表';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
    IF v_cn <> 'order_amount_requests_zero_price_reason_clean' THEN RAISE EXCEPTION '事後閘⑤c:撞到的是 % 不是新 CHECK', v_cn; END IF;
  END;
  --   d. 正對照:「　贈品」(前面帶全形空白但有字)⇒ 不該被 CHECK 擋, 應該一路走到 FK 才被擋(證明新 CHECK 沒擋過頭)
  BEGIN
    INSERT INTO public.order_amount_requests (order_id, order_item_id, expected_version, from_unit_price, to_unit_price, zero_price_reason, reason, requested_by, request_id)
    VALUES ('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', 1, 1, 0, E'\u3000贈品', 'postgate', 'postgate', 'postgate-160-d');
    RAISE EXCEPTION '事後閘⑤d:不存在的訂單居然進得了表(FK 不在?)';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  --   e. RPC:只有 NBSP(U+00A0)⇒ 當沒填(明列之後不靠 locale)
  BEGIN
    PERFORM public.admin_request_order_item_amount('00000000-0000-4000-8000-000000000000'::uuid, '00000000-0000-4000-8000-000000000000'::uuid,
      1, 0, E'\u00a0', 'postgate', 'postgate-nobody', 'postgate-160-e');
    RAISE EXCEPTION '事後閘⑤e:NBSP 原因居然沒被擋';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> '單價改為 0 需要填原因(例:贈品 / 換貨補寄)' THEN RAISE EXCEPTION '事後閘⑤e:回了 %', v_msg; END IF;
  END;
  --   f. 表 CHECK:U+202F 窄不換行空白 + U+2007 數字空白 ⇒ 撞新 CHECK
  BEGIN
    INSERT INTO public.order_amount_requests (order_id, order_item_id, expected_version, from_unit_price, to_unit_price, zero_price_reason, reason, requested_by, request_id)
    VALUES ('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', 1, 1, 0, E'\u202f\u2007', 'postgate', 'postgate', 'postgate-160-f');
    RAISE EXCEPTION '事後閘⑤f:U+202F / U+2007 原因居然進得了表';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
    IF v_cn <> 'order_amount_requests_zero_price_reason_clean' THEN RAISE EXCEPTION '事後閘⑤f:撞到的是 % 不是新 CHECK', v_cn; END IF;
  END;
  RAISE NOTICE '20260915160000 貼好了:零元原因全形空白 / 零寬規則(表 CHECK + 提案 RPC 第 3 代)。';
END
$post$;

COMMIT;
