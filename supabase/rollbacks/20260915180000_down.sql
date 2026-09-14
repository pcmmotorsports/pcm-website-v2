-- 20260915180000 回滾:admin_upsert_supplier 貼回第 1 代逐字(改名 / 停用回到任何員工都能做);search_path 維持正式庫的空字串。ACL 重發基準。零資料改動。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_upsert_supplier(uuid, text, boolean, text, text, text)');
  IF v_src IS NULL OR pg_catalog.md5(v_src) <> '0a4eea7fe583f0aba33409e41b10e943' THEN
    RAISE EXCEPTION '回滾前置閘:md5(prosrc) = % 不是第 2 代 0a4eea7fe583f0aba33409e41b10e943 ⇒ 不回滾, 停', COALESCE(pg_catalog.md5(v_src), '(函式不在)');
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
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_upsert_supplier(uuid, text, boolean, text, text, text)');
  IF pg_catalog.md5(v_src) <> '055538ac12fddf3d52cf1f0e86f64f85' THEN
    RAISE EXCEPTION '回滾事後閘:md5(prosrc) = % 不是第 1 代 055538ac12fddf3d52cf1f0e86f64f85', pg_catalog.md5(v_src);
  END IF;
END
$post$;
COMMIT;
