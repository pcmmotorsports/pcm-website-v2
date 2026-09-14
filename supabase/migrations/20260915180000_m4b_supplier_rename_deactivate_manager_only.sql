-- 20260915180000_m4b_supplier_rename_deactivate_manager_only.sql —— 供應商:新增任何員工都行, 改名 / 停用限管理者(DB 那一層)
--
-- 🛑 未貼(貼板 Sean 一張一點名)。Sean 2026-09-16 拍 Q6 甲。TS 那一層(supplier-actions.ts 改名 / 停用走 authorizeManagerMutation)同分支。
--
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- · admin_upsert_supplier 第 2 代 = 第 1 代(20260801160000)本體【逐字】+ actor 驗完之後加管理者閘, 只在 p_supplier_id 非 NULL(改名 / 停用)時生效。
--   新增路徑(p_supplier_id NULL)一字不動。閘的形狀抄 20260915040000。
-- · 🔴 SET 子句照【正式庫】寫 search_path = ''(20260905110000 已用 ALTER 鎖成空字串;檔案裡的第 1 代還寫 public, pg_temp)。
--   函式體全部表名都帶 public. / pg_catalog.(已掃, 零未限定)⇒ 空 search_path 下行為不變(正式庫今天就是這樣跑)。
-- · 簽章不動 ⇒ CREATE OR REPLACE;ACL 重發基準並事後斷言;COMMENT 由 REPLACE 保留。
-- ⚠️ codex R1 nit:函式體裡「actor 驗證」上方那段舊註解說個人帳號還沒接上 —— 那是 2026-08-01 第 1 代的歷史字面,
--    **為了保持第 1 代本體逐字(md5 可比)而原封留著**, 不代表現況。現況分兩件講:
--    · TS 那一側:actor 由 session v2 票證驗證後取得(lib/session/actor.ts), 不是表單送的。
--    · RPC 這一側:仍然【信任】server 傳進來的 p_actor —— 本閘驗的是「那個 actor 是不是在職管理者」, 不是「呼叫者就是那個人」。
-- ══ 前提 ═══════════════════════════════════════════════════════════════
-- 正式庫唯讀(2026-09-16):md5(prosrc) = 055538ac12fddf3d52cf1f0e86f64f85、proconfig = search_path=""、EXECUTE = service_role + postgres。
-- 前置閘:md5 = 第 1 代 ⇒ 升;= 第 2 代 0a4eea7fe583f0aba33409e41b10e943 ⇒ 冪等;其他停。search_path 必須已是空字串。
-- 回滾:supabase/rollbacks/20260915180000_down.sql = 第 1 代逐字(search_path = '')。零資料改動。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_src text; v_cfg text[];
BEGIN
  SELECT p.prosrc, p.proconfig INTO v_src, v_cfg FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_upsert_supplier(uuid, text, boolean, text, text, text)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:找不到 6 參 admin_upsert_supplier';
  END IF;
  IF v_cfg IS NULL OR NOT ('search_path=""' = ANY (v_cfg) OR 'search_path=' = ANY (v_cfg)) THEN
    RAISE EXCEPTION '前置閘⓪:search_path 不是空字串(%)⇒ 20260905110000 還沒貼, 停', v_cfg;
  END IF;
  IF pg_catalog.md5(v_src) = '055538ac12fddf3d52cf1f0e86f64f85' THEN
    RAISE NOTICE '前置閘⓪:第 1 代在(md5 相符)⇒ 升第 2 代';
  ELSIF pg_catalog.md5(v_src) = '0a4eea7fe583f0aba33409e41b10e943' THEN
    RAISE NOTICE '前置閘⓪:已是第 2 代(md5 相符)⇒ 照樣重跑(冪等)';
  ELSE
    RAISE EXCEPTION '前置閘⓪:admin_upsert_supplier md5(prosrc) = % 不是第 1 代也不是第 2 代 ⇒ 有人改過這支, 停', pg_catalog.md5(v_src);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_manager' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘①:staff.is_manager 不在';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260915180000(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_upsert_supplier(
  p_supplier_id uuid,
  p_label       text,
  p_is_active   boolean,
  p_note        text,
  p_actor       text,
  p_request_id  text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- Unicode 空白 + 零寬/格式字全集(逐字沿用 20260717010000 admin_set_customer_tier 的 v_ws)。
  -- 🔴 為什麼供應商名稱需要這一套而不是單純 btrim:PG 的單參數 `btrim(x)` **只剝空格**,
  --    tab / NBSP / 全形空白都留著 ⇒ 從供應商網站複製貼上的 'AKOSO\t' 會通過 S1a 的
  --    `label = btrim(label)` CHECK,與 'AKOSO' 並存為兩家。本片是唯一寫入路 ⇒ 在這裡收斂。
  -- ⚠️ PG 的 E'' 不支援 \v(會變字面字母 v)⇒ 垂直 tab 用 \013。
  -- 🟡 這是家族內第三份 v_ws 複本(wallet 20260716210000 / tier 20260717010000 / 本片)。
  --    抽共用函式會動到既有兩支金流相關 RPC,不在本片範圍。
  -- 🔴 更正(S2 審查抓):原本這裡寫「三份各自帶長度自檢,漂移會 fail-loud」是**錯的** ——
  --    實 grep `char_length(v_ws)`:wallet 那份 **0 次**、tier **2 次**、本片 **1 次**。
  --    ⇒ 「複製沒關係」這個理由只對三份中的兩份成立;wallet 那份漂移會靜默。
  --    本片不順手改它(那是金流 RPC、別片的事),但不得再拿它當複製的正當理由。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';

  -- ponytail:label 上限 100 字元。依據 = seed 26 家最長 18 字元('Extreme-Components')。
  --   選 100 不是 18 是留改名空間;真需要更長時改這個常數,別拿掉這道。
  --   沒有上限的話 `text` 可以塞進 MB 級字串,選單與稽核 log 一起遭殃。
  v_label_max constant integer := 100;

  v_label     text;
  v_note      text;
  v_actor     text;
  v_req       text;
  v_con       text;
  v_before    public.suppliers%ROWTYPE;
  v_new_label text;
  v_new_id    uuid;
  v_is_manager boolean;
BEGIN
  -- 1a. v_ws 自檢(字面漂移 ⇒ 全函式拒用、fail-loud;沿用 tier RPC 的做法)
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_upsert_supplier: v_ws 字元集長度異常(預期 31)';
  END IF;

  -- 1b. server 供參數 fail-closed:缺 actor / request_id 一律拒,不以未知身分寫稽核。
  -- 🔴 更正(關卡2 抓,主對話親讀原始碼確認):同族樣板的註解寫「actor 由 server session 解析、
  --    非 client」,套到現況會**宣稱大於事實** —— `apps/admin/src/lib/session/actor.ts:6-7` 逐字
  --    「actor 以 cookie 承載、內容來自使用者自行選擇。這**不是**登入 / 授權邊界,
  --    也沒有驗證『目前使用者是誰』」。
  --    ⇒ 本 RPC 保證的是「稽核列一定有一個非空的 actor 字串」,**不是**「那個字串是真的操作者」。
  --    真身分要等 E8-B 個人帳號線;在那之前稽核的歸屬性是**自陳**的。這條債屬 E8-B,不在本片。
  -- 🔴 長度與控制字元(S2 審查抓):這兩個值**直接寫進稽核表**,而下面給 label 設上限的理由
  --    (「text 塞得下 MB 級字串,選單與稽核 log 一起遭殃」)對它們一字不改地成立
  --    ⇒ 原本只驗非空 = 同一個理由只套了一半。
  -- 🔴 寫進稽核的是**剝過空白**的值(關卡2 抓):原本只拿 btrim 判空、卻寫入原值
  --    ⇒ 'alice ' 與 'alice' 會被記成兩個不同的操作者,'req-1 ' 與 'req-1' 拆成兩條追蹤鏈
  --    ⇒ 稽核鍵被靜默分裂,而稽核的用途正是「同一個人/同一次請求做了什麼」。
  -- 🔴 順序 = **先剝、後驗**,與下面的 label / note 一致(R3 抓):
  --    上一版是「先對**原值**驗控制字元、才剝空白」⇒ 同一支函式裡三種輸入三種順序,
  --    而且 cookie 帶一個尾隨 CR 就會整包拒收(實測 actor 尾隨 tab → 拒收,
  --    同樣位置的 label 與 note 卻是剝掉後照常通過)。這是關卡2 兩條修法組合出來的產物,不是設計。
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_supplier: 缺 actor';
  END IF;
  v_actor := pg_catalog.btrim(p_actor, v_ws);
  IF v_actor = '' THEN
    RAISE EXCEPTION 'admin_upsert_supplier: 缺 actor';
  END IF;
  IF pg_catalog.char_length(v_actor) > 200 OR v_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_upsert_supplier: actor 非法';
  END IF;

  -- 🔴 第 2 代(20260915180000, Sean 2026-09-16 拍 Q6 甲):**新增任何員工都行, 改名 / 停用限管理者。**
  --    本函式一支兩用:p_supplier_id NULL = 新增;非 NULL = 改名或改啟用狀態 ⇒ 只在非 NULL 時驗管理者。
  --    閘的形狀逐字抄 20260915040000(M-4b-01 管理者紅線):staff 在職 + is_manager, 不是 ⇒ '無權執行此操作'。
  --    為什麼要 DB 這一層:後台 key 是 service_role, PostgREST 直打不經 TS 那道 authorizeManagerMutation。
  IF p_supplier_id IS NOT NULL THEN
    SELECT s.is_manager INTO v_is_manager
      FROM public.staff s WHERE s.id = v_actor AND s.is_active
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '無權執行此操作';
    END IF;
    IF NOT coalesce(v_is_manager, false) THEN
      RAISE EXCEPTION '無權執行此操作';
    END IF;
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_supplier: 缺 request_id';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_upsert_supplier: 缺 request_id';
  END IF;
  IF pg_catalog.char_length(v_req) > 200 OR v_req ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_upsert_supplier: request_id 非法';
  END IF;

  -- 1c. 稽核備註:非必填;給了才驗(空白字串等同沒給)
  IF p_note IS NOT NULL THEN
    v_note := pg_catalog.btrim(p_note, v_ws);
    IF v_note = '' THEN
      v_note := NULL;
    ELSIF pg_catalog.char_length(v_note) > 200 OR v_note ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'admin_upsert_supplier: 備註非法';
    END IF;
  END IF;

  -- 1d. label 正規化與驗證(給了才處理;NULL = 不改名)
  IF p_label IS NOT NULL THEN
    v_label := pg_catalog.btrim(p_label, v_ws);
    IF v_label = '' THEN
      RAISE EXCEPTION 'admin_upsert_supplier: 供應商名稱必填';
    END IF;
    IF pg_catalog.char_length(v_label) > v_label_max THEN
      RAISE EXCEPTION 'admin_upsert_supplier: 供應商名稱過長';
    END IF;
    -- 剝完前後空白後**內部**還有控制字元 ⇒ 選單裡會出現看不見的折行,拒收
    IF v_label ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'admin_upsert_supplier: 供應商名稱含控制字元';
    END IF;
  END IF;

  -- ── 2. 新增路徑 ─────────────────────────────────────────
  IF p_supplier_id IS NULL THEN
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'admin_upsert_supplier: 新增時必須給 label';
    END IF;

    BEGIN
      INSERT INTO public.suppliers (label, is_active)
      VALUES (v_label, coalesce(p_is_active, true))
      RETURNING id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
      -- 🔴 只吞「label 撞名」這一種(關卡2 抓:原本吞掉**全部** 23505)。
      --    別的唯一約束失敗被翻譯成「這家已存在」會把真 bug 講成業務結果 ⇒ 一律往上丟。
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con <> 'suppliers_label_unique' THEN
        RAISE;
      END IF;
      -- 同名(含與並行 session 撞名)= 業務結果,交易不中止
      RETURN 'DUPLICATE_LABEL';
    END;

    INSERT INTO public.admin_audit_log
      (actor, action, target, before, after, reason, request_id, source_app)
    VALUES (
      v_actor,
      'supplier.create',
      'supplier:' || v_new_id::text,
      NULL,
      pg_catalog.jsonb_build_object('label', v_label,
                                    'is_active', coalesce(p_is_active, true)),
      v_note,
      v_req,
      'admin'
    );

    RETURN 'CREATED';
  END IF;

  -- ── 3. 改名 / 切停用路徑 ────────────────────────────────
  IF p_label IS NULL AND p_is_active IS NULL THEN
    -- 呼叫端 bug(送了一個空的 patch),不是業務結果 ⇒ fail-loud
    RAISE EXCEPTION 'admin_upsert_supplier: 沒有要變更的欄位';
  END IF;

  -- 鎖列 + before 快照(同一家並行改名序列化;快照與寫入同一把鎖內)
  SELECT * INTO v_before
    FROM public.suppliers
   WHERE id = p_supplier_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  v_new_label := coalesce(v_label, v_before.label);

  -- 同值冪等:零寫入零稽核(double-submit 第二發不產生噪音稽核列)
  IF v_new_label = v_before.label
     AND coalesce(p_is_active, v_before.is_active) = v_before.is_active THEN
    RETURN 'NO_CHANGE';
  END IF;

  BEGIN
    -- 🔴 只 SET 這兩欄:id 不在 SET 清單裡(FK 目標不得變動)、
    --    created_at 不碰、updated_at 由 S1a 的 suppliers_touch_updated_at trigger 寫
    --    ⇒ 「不得改 id、不得寫時間欄」(plan §5-13)在函式體就沒有那個口,不是靠約定。
    UPDATE public.suppliers
       SET label     = v_new_label,
           is_active = coalesce(p_is_active, v_before.is_active)
     WHERE id = p_supplier_id;
  EXCEPTION WHEN unique_violation THEN
    -- 同上:只吞 label 撞名(關卡2 抓)
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'suppliers_label_unique' THEN
      RAISE;
    END IF;
    RETURN 'DUPLICATE_LABEL';
  END;

  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    v_actor,
    'supplier.update',
    'supplier:' || p_supplier_id::text,
    pg_catalog.jsonb_build_object('label', v_before.label, 'is_active', v_before.is_active),
    pg_catalog.jsonb_build_object('label', v_new_label,
                                  'is_active', coalesce(p_is_active, v_before.is_active)),
    v_note,
    v_req,
    'admin'
  );

  RETURN 'UPDATED';
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_upsert_supplier(uuid, text, boolean, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_supplier(uuid, text, boolean, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_supplier(uuid, text, boolean, text, text, text) TO service_role;
ALTER FUNCTION public.admin_upsert_supplier(uuid, text, boolean, text, text, text) OWNER TO postgres;

DO $post$
DECLARE v_oid oid := pg_catalog.to_regprocedure('public.admin_upsert_supplier(uuid, text, boolean, text, text, text)'); v_src text; v_bad text; v_msg text;
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
  IF pg_catalog.strpos(v_src, '無權執行此操作') = 0 OR pg_catalog.strpos(v_src, 'IF p_supplier_id IS NOT NULL THEN') = 0 THEN
    RAISE EXCEPTION '事後閘③:函式體沒有改名 / 停用的管理者閘 ⇒ 貼到的不是第 2 代';
  END IF;
  IF pg_catalog.strpos(v_src, 'suppliers_label_unique') = 0 OR pg_catalog.strpos(v_src, 'v_ws') = 0 THEN
    RAISE EXCEPTION '事後閘③:第 1 代的撞名處理 / 空白字元集少了 ⇒ 聯集漏了';
  END IF;
  IF pg_catalog.strpos(v_src, 'P9Z99_20260915180000') <> 0 THEN
    RAISE EXCEPTION '事後閘③b(負對照):現造的字串居然在定義裡 ⇒ 這把尺壞了';
  END IF;
  -- ④ 活體:改名路徑 + 不存在的 actor ⇒ 管理者閘擋(在任何查詢 / 寫入之前;子交易吃掉例外, 零寫入)
  BEGIN
    PERFORM public.admin_upsert_supplier('00000000-0000-4000-8000-000000000000'::uuid, 'postgate', NULL, NULL, 'postgate-nobody-20260915180000', 'postgate-180');
    RAISE EXCEPTION '事後閘④:改名路徑不存在的 actor 居然沒被擋';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> '無權執行此操作' THEN RAISE EXCEPTION '事後閘④:應回「無權執行此操作」, 回了 %', v_msg; END IF;
  END;
  RAISE NOTICE '20260915180000 貼好了:admin_upsert_supplier 第 2 代(改名 / 停用限管理者)。';
END
$post$;

COMMIT;
