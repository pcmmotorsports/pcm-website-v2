-- ============================================================
-- M-4b E10 S2:供應商主檔寫入 RPC(`public.admin_upsert_supplier`)
-- ============================================================
-- 片級 plan = docs/specs/2026-08-01-e10-supplier-master-plan.md §4 S2 / 驗收 §5-11~13。
-- 前置:20260801140000(S1a `suppliers` 表;service_role 只有 SELECT ⇒ 寫入路徑到本片才存在)
--       20260712210000(admin_audit_log;service_role 只有 INSERT)。
--
-- 🔴 為什麼需要這支 RPC 而不是直接讓 admin server 寫表:
--    S1a 對 service_role **只開 SELECT**。若改成開 INSERT/UPDATE,持 service key 就能
--    `.from('suppliers').insert(...)` 繞過同交易稽核 ⇒ 稽核不再是強制契約,只是一個慣例。
--    ⇒ 寫入唯一路 = 本 owner RPC(對齊 Sean 2026-07-31 Q1=D)。
--
-- 三種動作一支函式(plan §4 S2 逐字「新增/改名/切停用」):
--   · p_supplier_id IS NULL      ⇒ 新增(p_label 必填)
--   · p_supplier_id 有值 + p_label ⇒ 改名
--   · p_supplier_id 有值 + p_is_active ⇒ 切啟用/停用
--   兩者可同時給;NULL = 該欄不動。
--
-- 回傳固定碼(不洩約束名/欄值):
--   'CREATED' / 'UPDATED' / 'NO_CHANGE' / 'NOT_FOUND' / 'DUPLICATE_LABEL'
--   🔴 `DUPLICATE_LABEL` 是**業務結果不是例外**:員工在新增畫面打一個已存在的名字是日常,
--      讓 23505 直接冒到 UI 等於把「這家已經在名單裡」顯示成資料庫錯誤。
--
-- 🔴 本片刻意不做(不是忘記):
--   · 不回傳新建的 id —— S3b 新增完會重讀清單,不需要它。真需要時再加 OUT 參數。
--   · 不做刪除 —— S1a 的兩支 block trigger 是唯一真相,本片不提供任何繞過口。
--   · 不做「相似名稱」比對 —— A5b 已作廢,防線是 S3b 的 typeahead(人眼)+ label UNIQUE。
--
-- 🔴 誠實邊界(寫在這裡,harness §D 會再印一次):
--   · label 只做「前後空白剝除 + 拒控制字元 + 長度上限」。以下三種近似重複**都不擋**,
--     防線一律是 S3b 新增畫面的 typeahead(人眼),不在本片:
--       ① **內部**連續空白 / NBSP:'Eazi  Grip' 與 'Eazi Grip' 並存(plan §3.1 已列)
--       ② **大小寫變體**:'akoso' 與 'AKOSO' 並存(S2 審查實測;`label UNIQUE` 是區分大小寫的)
--       ③ 標點變體:'Eazi-Grip' 與 'Eazi Grip' 並存(plan §6 已列)
--     🔴 這份清單是「已知不擋的形狀」,不是窮舉 —— 任何「機器會幫我抓重複」的預期都不成立。
--
--   · 🔴🔴 **最重要的一條契約債(R3 抓,交給 S3b)**:`p_supplier_id` 為 NULL = 新增,
--     這是**靠參數是不是 NULL 分流**的必然代價 —— 一個改名請求若因為呼叫端 bug 把 id 弄丟
--     (server action 序列化掉 id 是 Next.js 常見錯),整包會**靜默降級成新增**。
--     實測:`admin_upsert_supplier(NULL,'AKOSO 改名後',…)` 回 `CREATED`、26→27 家、原本那家還在
--     ⇒ **多一筆永久垃圾列(供應商不可刪除)+ 原本要做的改名沒有發生**,而且沒有人會收到錯誤。
--     ⇒ **S3b 的改名 / 停用 action 必須斷言回傳碼 ∈ {UPDATED, NO_CHANGE};收到 CREATED = 呼叫端 bug,
--        當場報錯、不得當成功。** 回傳碼裡本來就有這個訊號,缺的是「有人去看它」。
--     🔴 根治法 = 拆成 create / update 兩支 RPC(型別層就分流,弄丟 id 會是編譯錯)——
--        那要重提 plan、動已定的片界,**本片不做**;斷言回傳碼是夠用的便宜解。
--
--   · 🆕 **新契約債(S2 審查抓,交給 S3a/S3b)**:撞到**已停用**的同名供應商時,本 RPC 回的
--     一樣是 `DUPLICATE_LABEL`。而 plan §5-14 定 `listSuppliers` 預設只回 `is_active=true`
--     ⇒ 員工會看到「這家已存在」但 typeahead 裡找不到它、也無從改名或重新啟用 = 死路。
--     ⇒ **S3b 必須有一條「顯示已停用的同名候選 + 一鍵重新啟用」的出口**,否則這是 UI 死角。
--     本片不擴大回傳碼去解它(那要動 S3a/S3b 的資料合約,屬那兩片)。
--
--   · 🟡 **稽核不能反過來當「真的有寫入」的證據**(R3 抓):`admin_audit_log` 對 service_role
--     開的是 INSERT ⇒ 同一把 service key 可以**不碰 suppliers 就直接寫一列假稽核**。
--     本片保證的是「經由本 RPC 的寫入一定留稽核」,**不是**「稽核列一定對應一次真的寫入」。
--     這是 `20260712210000` 既有的權限模型、非本片引入,但災難鑑識時不得把稽核當單一真相。
--
--   · 🟡 **RPC 執行期沒有 lock_timeout**(R3 抓):檔頭的 `SET LOCAL lock_timeout` 只保護 apply
--     那一刻,函式本體的 `SELECT … FOR UPDATE` 在 runtime 吃的是角色層的 statement_timeout。
--     26 列的表、風險低,但真的撞上一個殘留的 owner 交易時它會掛住而不是快速失敗 —— 災難日要知道。
--
--   · 🔴 **apply preflight(R3 抓,S1b 沒做過這一格)**:本片的 5f-2「suppliers 零欄級 ACL」
--     是**第一次**對正式站執行的檢查(S1b 的欄級 ACL preflight 只查了採購表)。
--     ⇒ `db push` 之前先跑一行唯讀查詢確認它不會被自己的閘擋下:
--        SELECT count(*) FROM pg_attribute
--         WHERE attrelid='public.suppliers'::regclass AND NOT attisdropped AND attacl IS NOT NULL;
--        預期 0;非 0 就停下來看是誰授的,不要直接 push。
--
--   · 🔴 **apply 之後必須重 gen 型別**(關卡2 抓):本片新增一支 RPC ⇒ `database.types.ts` 的
--     `Functions` 區塊會多一項,而該檔由**正式站** schema 產生 ⇒ apply 前物理上做不了。
--     **S3a 要用 typed `.rpc('admin_upsert_supplier', …)`,沒重 gen 就是型別紅** ⇒ 重 gen 是
--     S3a 的硬前置,不是「順手做一下」。重 gen 後必須貼回 `create_order.Args` 的三處人工校正
--     (`p_client_ip` / `p_client_ua` / `p_notification_email` 的 `| null`),以 typecheck 轉綠為證。
--
--   · 🟡 **相鄰缺口(S2 審查順手查到,本片不修)**:S1a(`20260801140000`)對兩支 trigger 函式
--     只 `REVOKE ALL … FROM PUBLIC`、沒涵蓋 anon/authenticated/service_role,而環境的
--     `ALTER DEFAULT PRIVILEGES` 會把 EXECUTE 補回給那三個角色。**無可利用性**(trigger 函式
--     直呼必炸 `can only be called as triggers`),但寫法不一致。修它要動已 apply 的物件 ACL
--     = 另一支 migration 的決定,不夾帶進本片。本片自己用的是對的寫法(FROM PUBLIC, anon, authenticated)。
--   · 稽核備註 `p_note` **非必填**(與 tier RPC 的 Q2=A 必填不同 —— Sean 沒有對供應商拍過那條;
--     加必填等於替他決定 UI 上多一個必填欄)。給了就驗、不給就記 NULL。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. admin_upsert_supplier ─────────────────────────────────
CREATE FUNCTION public.admin_upsert_supplier(
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
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION public.admin_upsert_supplier(uuid, text, boolean, text, text, text) IS
  'M-4b E10 S2 供應商主檔寫入 RPC(Sean 2026-08-01 拍板:可新增 / 可改名 / 可停用 / 不可刪除)。'
  'suppliers 對 service_role 只開 SELECT(且零欄級 ACL)⇒ **本函式是 service_role 路徑的唯一寫入口**'
  '(以 owner 身分連線的路徑不受限 —— 那不只是「手動 SQL」,pg_cron job 與持 owner 憑證的服務'
  '都算在內;R3 抓:原字面只寫「手動」低估了範圍),同交易寫 admin_audit_log '
  '(supplier.create / supplier.update)。p_supplier_id IS NULL = 新增;有值時 p_label / p_is_active '
  '各自 NULL = 該欄不動。回 CREATED / UPDATED / NO_CHANGE / NOT_FOUND / DUPLICATE_LABEL。'
  'label 寫入前剝 Unicode 前後空白、拒控制字元、上限 100 字元;**內部空白不收斂**(已知缺口,'
  '防線是設定頁 typeahead)。不改 id、不寫時間欄(updated_at 由 suppliers_touch_updated_at trigger 維護)。'
  'EXECUTE 僅 service_role。';

-- ── 4. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role ──
-- 🔴 函式的預設 ACL 是 EXECUTE TO PUBLIC ⇒ 不 REVOKE 的話 anon 也叫得到這支 owner RPC。
REVOKE ALL ON FUNCTION public.admin_upsert_supplier(uuid, text, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_supplier(uuid, text, boolean, text, text, text)
  TO service_role;

-- ── 5. 檔內 fail-closed 驗收(任一不符則整支 migration 回滾)──
DO $verify$
DECLARE
  v_oid  oid := 'public.admin_upsert_supplier(uuid,text,boolean,text,text,text)'::regprocedure;
  v_cnt  integer;
  v_txt  text;
BEGIN
  -- 5a. SECURITY DEFINER + search_path 釘死(少任一條,這支就不是「唯一寫入路」該有的樣子)
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'admin_upsert_supplier 異常 — 應為 SECURITY DEFINER;拒繼續';
  END IF;
  SELECT pg_catalog.array_to_string(proconfig, ',') INTO v_txt
    FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF v_txt IS DISTINCT FROM 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'admin_upsert_supplier 異常 — proconfig 應為 search_path=public, pg_temp,實 [%];拒繼續', v_txt;
  END IF;

  -- 5b. 參數簽章逐字比對(plan §5-13「不得寫時間欄」的結構面:
  --     多一個 p_created_at 之類的入口,這條就會紅)
  -- 🔴 pg_get_function_identity_arguments 回的是「名稱 型別」不是只有型別(本片實測踩到、
  --    第一版寫成純型別而被這道閘自己擋下)。帶名稱反而更嚴:改參數名也會紅。
  SELECT pg_catalog.pg_get_function_identity_arguments(v_oid) INTO v_txt;
  IF v_txt <> 'p_supplier_id uuid, p_label text, p_is_active boolean, p_note text, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION 'admin_upsert_supplier 異常 — 參數簽章為 [%],與宣告不符;拒繼續', v_txt;
  END IF;

  -- 5c. 🔴 proacl IS NULL = 預設 EXECUTE TO PUBLIC,而下面每一條 ACL 斷言在那個狀態下
  --     都會「看起來對」⇒ 必須先擋掉這個假綠(對齊 S1a 的 relacl IS NOT NULL 前置)
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'admin_upsert_supplier ACL 異常 — proacl 為 NULL(= EXECUTE TO PUBLIC 預設);拒繼續';
  END IF;

  -- 5c-2. 🔴 owner 是誰必須釘住(S2 審查抓):下面攤平 ACL 時用 `grantee <> proowner` 把 owner
  --       那一列排掉 ⇒ owner 本身變成沒有人在看的欄位。而 SECURITY DEFINER 的**全部**安全語意
  --       就是「以 owner 的身分跑」——審查者實測 `ALTER FUNCTION … OWNER TO 別人` 之後,
  --       5d/5e 每一條照樣全綠。
  --       比法用「與 suppliers 表同一個 owner」而不是寫死 'postgres':本機 shim 與正式站的
  --       角色名不保證一致,而真正的不變式本來就是「寫表的那支函式,以表的擁有者身分跑」。
  IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_oid)
     <> (SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.suppliers'::regclass) THEN
    RAISE EXCEPTION 'admin_upsert_supplier 異常 — 函式 owner [%] 與 suppliers 表 owner [%] 不同;SECURITY DEFINER 會以前者身分跑;拒繼續',
      (SELECT proowner::regrole::text FROM pg_catalog.pg_proc WHERE oid = v_oid),
      (SELECT relowner::regrole::text FROM pg_catalog.pg_class WHERE oid = 'public.suppliers'::regclass);
  END IF;

  -- 5d. ACL 攤平後,非 owner 的授權必須**恰好**是 service_role:EXECUTE:false
  --     🔴 必須帶 is_grantable。**不帶**的話 `GRANT … WITH GRANT OPTION` 攤平後與普通 EXECUTE
  --        字串完全相同(S1b 實測)⇒ 會放行「service_role 可把 EXECUTE 再轉授出去」;
  --        帶了之後那種情況會攤成 service_role:EXECUTE:**true**、當場不符。
  --        (原註解把這句寫反了 —— S2 審查抓,已更正。)
  SELECT coalesce(
           pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g,
                 a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_proc pr
            CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a
           WHERE pr.oid = v_oid AND a.grantee <> pr.proowner) x;
  IF v_txt <> 'service_role:EXECUTE:false' THEN
    RAISE EXCEPTION 'admin_upsert_supplier ACL 異常 — 非 owner 授權應恰為 service_role:EXECUTE:false,實 [%];拒繼續', v_txt;
  END IF;

  -- 5e. PUBLIC(grantee=0)單獨查。
  --     🔴 更正(S2 審查實測):PUBLIC **會**出現在 5d 的比對裡 —— `pg_get_userbyid(0)` 回
  --     `unknown (OID=0)`,5d 本來就會紅。這條是縱深第二層,不是「5d 看不到所以需要它」。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc pr
    CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a
   WHERE pr.oid = v_oid AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'admin_upsert_supplier ACL 異常 — PUBLIC 應零授權,實 % 筆;拒繼續', v_cnt;
  END IF;

  -- 5f. 🔴 本片**不得**放寬 suppliers 的表級 ACL:service_role 仍必須只有 SELECT。
  --     若哪天有人「順手」給了 INSERT/UPDATE,本 RPC 就不再是唯一寫入路、同交易稽核也不再強制。
  SELECT coalesce(
           pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g,
                 a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
           WHERE c.oid = 'public.suppliers'::regclass AND a.grantee <> c.relowner) x;
  IF v_txt <> 'service_role:SELECT:false' THEN
    RAISE EXCEPTION 'suppliers ACL 異常 — 應仍為 service_role:SELECT:false(寫入唯一路 = 本 RPC),實 [%];拒繼續', v_txt;
  END IF;

  -- 5f-2. 🔴🔴 欄級 ACL 必須是空的(關卡2 抓到的真洞,主對話已親驗成立):
  --       `relacl` **只放表級授權** ⇒ 做一次 `GRANT UPDATE (is_active) ON suppliers TO service_role`,
  --       上面那條攤平比對**完全看不到**(實測仍回 service_role:SELECT:false),
  --       而 service_role 從此可以直接 `UPDATE suppliers SET is_active=false` —— 繞過本 RPC、零稽核。
  --       ⇒ 表級收斂了、欄級照樣是後門;這一條才是把那個後門關上的。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.suppliers'::regclass AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'suppliers ACL 異常 — 有 % 個欄位帶欄級 ACL(表級收斂擋不住欄級後門);拒繼續', v_cnt;
  END IF;

  -- 5g. admin_audit_log 這一端也要在:service_role 只有 INSERT 是它的既有契約,
  --     但本 RPC 是以 owner 身分寫它 ⇒ 這裡只確認表還在、欄位還是本函式寫的那八個
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.admin_audit_log'::regclass
     AND NOT attisdropped AND attnum > 0
     AND attname IN ('actor','action','target','before','after','reason','request_id','source_app');
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION 'admin_audit_log 異常 — 本 RPC 寫入的 8 欄應全部存在,實命中 %;拒繼續', v_cnt;
  END IF;

  -- 5g-2. 🔴 函式 owner 必須真的寫得進稽核表(關卡2 抓):5g 只數欄位在不在。
  --       若 admin_audit_log 的 owner 漂移、而函式 owner 沒有 INSERT,這支 migration 照樣 commit,
  --       但 RPC 第一次被呼叫就 42501 —— 那時它已經在正式站了。
  IF NOT has_table_privilege(
       (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_oid),
       'public.admin_audit_log'::regclass, 'INSERT') THEN
    RAISE EXCEPTION 'admin_upsert_supplier 異常 — 函式 owner 對 admin_audit_log 無 INSERT;上線後每次呼叫都會 42501;拒繼續';
  END IF;

  RAISE NOTICE 'S2 結構驗收全數通過(SECDEF / search_path / 簽章 / 函式 ACL / suppliers ACL 未放寬 / audit 欄位)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only,對齊 A2 / S1a 慣例)
--
--   DROP FUNCTION IF EXISTS public.admin_upsert_supplier(uuid, text, boolean, text, text, text);
--
-- 這支 down 是乾淨的:本片零表結構改動、零 ACL 放寬、零資料寫入。
-- 🔴 但**下游先撤**:S3a 的 server action 與 S3b 的設定頁若還在,DROP 之後它們會在 runtime 壞掉。
--    🔴 更正(關卡2 抓):原字面寫「會 502」是猜的 —— 實際狀態碼取決於呼叫層
--    (PostgREST 找不到函式會回 404 / `PGRST202`;server action 未捕捉例外才會變 500)。
--    **不要在文件裡寫沒量過的狀態碼**;要講就講「會壞、且錯在找不到函式」。
-- 🔴 已寫進 admin_audit_log 的稽核列 = 正常營運資料,不隨 down 回收;
--    已經由本 RPC 新增/改名的 suppliers 列同理(要改回去請走本 RPC 的反向操作,留稽核軌)。
-- ============================================================
