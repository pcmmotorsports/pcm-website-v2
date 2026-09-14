-- ══════════════════════════════════════════════════════════════════
-- ⟦ship-HCTLABEL⟧ 乙型救回的箱「重新取得標籤」的窄門(2026-09-14, 主視窗 4f 裁)
--
-- 🔴 病:乙型(新竹有單、我們讀不懂回應)經 QueryEDELNO 救回的箱, raw 只有 4 欄【沒有 image】
--    ⇒ label.pdf 回 409 no_image_field ⇒ 那箱印不出標籤。
-- ✅ 解:同日同單號再送一次 TransData(V15 P.8 逐字「新竹貨號+訂單編號 -> 當日重複上傳, 視同更正資料內容」)
--    ⇒ 回 R + 同一個貨號 + image ⇒ 本支把那一包寫回 hct_raw_response。
-- 🛑 為什麼要一扇新的門:admin_record_hct_submit 對 submitted 的列【一律 RAISE】(20260904170000:31, 那道擋是對的 ——
--    它防重送);admin_record_hct_unknown_reason 只吃 unknown。⇒ 「submitted 而要換 raw」今天沒有任何門。
-- 🔴 這扇門只准做一件事:**同一個貨號** 的 submitted 列, 換掉 hct_raw_response。
--    · 狀態 / 貨號 / 作廢欄 一個都不碰 ⇒ 它不可能造成一次重送、也不可能把貨號改掉(write-once trigger 照樣在)。
--    · 貨號對不上(新竹回了別的 edelno = 它那邊建了第二張)⇒ RAISE, 一個字都不寫 —— 那是值班要看的事故, 不是資料。
--    · 新的那一包裡沒有 image ⇒ RAISE(換一包沒圖的進去等於白換, 而且蓋掉了原本那包的證據)。
-- 🔴 codex R1 must-fix(2026-09-14):「同日」是新竹那條規則的前提 —— 隔天再送同單號【不是更正, 是新單】。
--    而我們今天沒有任何欄位記「這張單是哪一天送到新竹的」(`hct_raw_response` 救回來那包只有 4 欄, `updated_at` 誰都會碰)。
--    ⇒ 本支同時加一欄 `hct_submitted_at` + 一支 BEFORE UPDATE trigger:
--       · 狀態【進入】unknown / submitted(從 draft / failed 來)⇒ 蓋 now()。unknown 是佔位列, 寫在 HTTP 發出去【之前】
--         ⇒ 它才是新竹收到那張單的時刻;之後 unknown ⇒ submitted(乙型救回)【不重蓋】。
--       · 狀態【離開】那兩個(重設回 draft / 新竹拒絕成 failed)⇒ 清成 NULL(新竹那邊沒有單了)。
--       · 既有列一律 NULL ⇒ action 對 NULL【拒送】(fail-closed:不知道哪天送的就不賭)。
-- 回滾:supabase/rollbacks/20260914080000_down.sql(DROP TRIGGER / FUNCTION ×2 / COLUMN;欄位是新的, 丟掉不傷既有資料)。
-- ══════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.shipments';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '前置閘②:admin_record_hct_submit 不在 ⇒ 20260904170000 還沒貼, 本支沒有配套對象';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.shipments'::regclass
                    AND t.tgname = 'shipments_hct_request_id_write_once_bu' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '前置閘③:貨號 write-once trigger 不在 ⇒ 本支「貨號不碰」的保證少了一半, 停';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_record_hct_label_raw(text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:admin_record_hct_label_raw 已經存在 ⇒ 本檔已套用過, forward-only 拒重跑';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.shipments'::regclass AND attname = 'hct_submitted_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘⑤:shipments.hct_submitted_at 已經存在 ⇒ 本檔已套用過(或有人另開了同名欄), 停';
  END IF;
END
$pre$;

-- ── 1. 「哪一天送到新竹」那一欄 + 蓋章 trigger ────────────────────────────
ALTER TABLE public.shipments ADD COLUMN hct_submitted_at timestamptz;
COMMENT ON COLUMN public.shipments.hct_submitted_at IS
  '⟦ship-HCTLABEL⟧ 這張單送到新竹的時刻(狀態進入 unknown / submitted 時由 trigger 蓋;離開時清 NULL)。'
  ' 用途只有一個:「同日同單號更正」那條路要知道今天是不是同一天。NULL = 不知道 ⇒ 不賭。';

CREATE FUNCTION public.pcm_b2_shipments_hct_submitted_at_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.hct_status IN ('unknown', 'submitted') THEN
    -- 進入:從 draft / failed / NULL 來才蓋;unknown ⇒ submitted 是同一張單的補記, 不重蓋。
    IF OLD.hct_status IS NULL OR OLD.hct_status NOT IN ('unknown', 'submitted') THEN
      NEW.hct_submitted_at := pg_catalog.now();
    END IF;
  ELSE
    -- 離開(重設回 draft / 新竹拒絕成 failed):新竹那邊沒有這張單了 ⇒ 清掉。
    NEW.hct_submitted_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pcm_b2_shipments_hct_submitted_at_stamp()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER shipments_hct_submitted_at_stamp_bu
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_b2_shipments_hct_submitted_at_stamp();

-- ── 2. 窄門 ──────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_record_hct_label_raw(
  p_shipment_reference text,
  p_edelno             text,
  p_raw                jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status  text;
  v_deleted timestamptz;
  v_edelno  text;
  v_row     jsonb;
BEGIN
  IF p_edelno IS NULL OR pg_catalog.btrim(p_edelno) = '' THEN
    RAISE EXCEPTION 'admin_record_hct_label_raw:貨號不得為空' USING ERRCODE = 'P0001';
  END IF;
  SELECT hct_status, deleted_at, hct_request_id INTO v_status, v_deleted, v_edelno
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_record_hct_label_raw:查無這張出貨單(%)', p_shipment_reference;
  END IF;
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'admin_record_hct_label_raw:這張出貨單已作廢(%), 不得再寫新竹欄位', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION
      'admin_record_hct_label_raw:這張單現在是 %(不是 submitted), 本支只給【已送成功而沒有標籤圖】的箱換那一包。'
      ' 要寫狀態請走 admin_record_hct_submit —— 本支【刻意】不碰任何狀態欄。', COALESCE(v_status, '(null)')
      USING ERRCODE = 'P0001';
  END IF;
  -- 🔴 貨號要對得上 write-once 的那一個。對不上 = 新竹那邊回了另一張單 ⇒ 不寫, 讓人看。
  IF v_edelno IS DISTINCT FROM p_edelno THEN
    RAISE EXCEPTION
      'admin_record_hct_label_raw:新竹回的貨號(%)與這箱記著的(%)不同 ⇒ 新竹那邊可能有第二張單, 一個字都不寫;請人工核對。'
      , p_edelno, COALESCE(v_edelno, '(null)')
      USING ERRCODE = 'P0001';
  END IF;
  -- 🔴 新的那一包要真的帶 image(純陣列第一列, 或物件)—— 沒圖就別蓋掉原本那包。
  v_row := CASE WHEN pg_catalog.jsonb_typeof(p_raw) = 'array' THEN p_raw -> 0 ELSE p_raw END;
  -- 🔴 用 IS DISTINCT FROM, 不用 <> —— 鍵不在時 `v_row -> 'image'` 是 NULL, `jsonb_typeof(NULL) <> 'string'` 是 NULL 不是 TRUE
  --    ⇒ 第一版就是這樣讓「沒有 image 鍵」的包整個溜過去(2026-09-14 拋棄式 PG 親測:[{"success":"R"}] 寫進去了)。
  IF v_row IS NULL OR pg_catalog.jsonb_typeof(v_row) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(v_row -> 'image') IS DISTINCT FROM 'string'
     OR pg_catalog.btrim(v_row ->> 'image') = '' THEN
    RAISE EXCEPTION 'admin_record_hct_label_raw:新竹回的那一包裡沒有 image ⇒ 不換(換了等於把原本的證據蓋掉而還是印不出來)'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.shipments
     SET hct_raw_response = p_raw
   WHERE shipment_reference = p_shipment_reference;
END
$fn$;
REVOKE ALL ON FUNCTION public.admin_record_hct_label_raw(text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_hct_label_raw(text,text,jsonb)
  TO service_role;
ALTER FUNCTION public.admin_record_hct_label_raw(text,text,jsonb) OWNER TO postgres;
COMMENT ON FUNCTION public.admin_record_hct_label_raw(text,text,jsonb) IS
  '⟦ship-HCTLABEL⟧ 乙型救回的箱重取標籤:只給 submitted 且貨號【相同】的箱換 hct_raw_response(新包必須帶 image)。'
  ' 狀態 / 貨號 / 作廢欄一個都不碰 ⇒ 不可能造成重送或改貨號。貨號對不上 ⇒ RAISE 不寫(新竹可能有第二張單, 要人看)。'
  ' 它是 admin_record_hct_submit 的配套(那支對 submitted 一律擋, 那是對的), 不是替代品。';

DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.admin_record_hct_label_raw(text,text,jsonb)',
    'public.pcm_b2_shipments_hct_submitted_at_stamp()'
  ]::text[];
  v_fn regprocedure := 'public.admin_record_hct_label_raw(text,text,jsonb)'::regprocedure;
  v_def text;
  v_set text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '後置閘①:函式沒建起來';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘②:anon / authenticated 叫得動 ⇒ 客人寫得了新竹欄位';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘③:service_role 叫不動 ⇒ 後台那顆鈕會 42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '後置閘④:search_path 不是空字串';
  END IF;
  -- 這扇門只准寫 hct_raw_response 一欄(抄 20260908020000 那道字面閘的做法)
  SELECT pg_get_functiondef(v_fn) INTO v_def;
  v_def := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', ' ', 'g');
  v_set := (pg_catalog.regexp_match(v_def, 'UPDATE\s+public\.shipments\s+SET\s+(.*?)\s+WHERE'))[1];
  IF v_set IS NULL THEN
    RAISE EXCEPTION '後置閘⑤:抽不出 UPDATE 的 SET 子句 ⇒ 下面那條斷言沒有對象';
  END IF;
  IF pg_catalog.lower(pg_catalog.regexp_replace(v_set, '\s+', ' ', 'g')) <> 'hct_raw_response = p_raw' THEN
    RAISE EXCEPTION '後置閘⑤:SET 子句不是逐字「hct_raw_response = p_raw」(實得「%」)⇒ 這扇門多寫了別的欄', v_set;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.shipments'::regclass AND t.tgname = 'shipments_hct_submitted_at_stamp_bu') THEN
    RAISE EXCEPTION '後置閘⑥:蓋章 trigger 沒掛上';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', 'public.pcm_b2_shipments_hct_submitted_at_stamp()', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑦:trigger 函式不該讓任何角色直接叫';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260914b(text)') IS NOT NULL THEN
    RAISE EXCEPTION '後置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
  RAISE NOTICE 'admin_record_hct_label_raw 貼好了(只換 submitted 同貨號箱的 hct_raw_response)+ shipments.hct_submitted_at 與蓋章 trigger。';
END
$post$;

COMMIT;
