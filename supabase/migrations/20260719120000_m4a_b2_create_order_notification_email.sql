-- ============================================================
-- M-4a B-2:create_order 8-param → 9-param(新增 p_notification_email)
--
-- 上位真權威:docs/specs/2026-07-18-b0-order-notification-email-prd.md §4 B-2
-- 片級 plan:docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md
-- apply 前凍結 snapshot:docs/reviews/2026-07-19-b2-preapply-snapshot.md
-- 鐵則觸發:8(schema+金流 RPC)、12(migration/schema/order/payment → 需 Codex Packet)
--
-- Sean 2026-07-19 拍板:
--   Q1=A 不合規 email 裸傳、由 B-1 CHECK 擋;RPC 內不加驗證/正規化(不新增第三份規則)
--   Q2=A database.types.ts 留 B-4 補(本片刻意不同步、非漏做)
--   Q3=A 檔內自帶 BEGIN/COMMIT + 兩簽章 DROP IF EXISTS(可重跑)
--   Q5=A 守門與 DROP 間競態窗口記為有界假設(全部 schema 變更走 db push、Sean 單人序列執行)
--
-- 🔴 為何必須 DROP+CREATE 而非 CREATE OR REPLACE(實測,非推論):
--   PG 不允許用 CREATE OR REPLACE 改參數數量 → 會產生 overload。實測 8-param 與
--   9-param(第 9 參 DEFAULT NULL)共存時,8 引數呼叫(具名與位置皆是)一律回
--   ERROR 42725 function ... is not unique → 結帳全斷。故必須 DROP 先、CREATE 後,且原子。
--
-- 🔴 為何自帶 BEGIN/COMMIT:2026-07-18 B-1 實測,migration 檔無顯式 BEGIN 時檔內
--   SET LOCAL 會噴 WARNING 25P01 且為 no-op(=無鎖保護)。自帶顯式交易同時取得
--   鎖保護與 DROP+CREATE 的原子性。⚠️ 殘餘:若 CLI 自帶外層交易,本檔 COMMIT 可能使
--   schema_migrations 寫入落到另一筆交易(schema 已改、history 未記)→ 由「兩簽章
--   DROP IF EXISTS = 整支可重跑」兜底收斂,非已驗證的原子性。Sean 明示接受(plan §3.1)。
--
-- 🔴 apply 失敗/中斷後的 SOP(codex 關卡2 M-5;**不可直接再按一次 db push**):
--   codex 讀 supabase CLI v2.98.1 原始碼(pkg/migration/file.go + pgconn ExecBatch)確認:CLI 先送
--   本檔全部語句、**之後才追加** schema_migrations 的 history INSERT;且 pgconn 遇到顯式交易控制時
--   不再提供整批隱式交易 → 「9-param 已生效、history 未記」**確定可能發生**,不是理論假設。
--   故 db push 報錯或中斷時,依序做完下列三查再決定,任何一步意外即停下交人工判斷:
--     ①查 history:select version from supabase_migrations.schema_migrations where version='20260719120000';
--     ②查簽章:select oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--               where n.nspname='public' and p.proname='create_order';
--     ③查完整指紋(段 2.5 同一公式)並比對本檔的 8-param / 9-param 兩個常數。
--   判讀:①無 + ②僅 8-param + ③== 8-param 基線 → 完全沒套上,可安全重跑。
--         ①無 + ②僅 9-param + ③== 9-param 預期產出 → 正是「schema 已改、history 未記」的裂縫,
--           重跑會走段 2.5 狀態 B、指紋相符才放行 → 可安全重跑。
--         ①有 + ②僅 9-param + ③相符 → 已完成,**不需也不應重跑**。
--         其餘任何組合(指紋不符 / 兩簽章並存 / 兩者皆無)→ **停,不得重跑**,交 Sean 判斷。
--
-- 🔴 函式體來源與驗證(零手動轉錄):
--   權威基底 = 2026-07-19 由 prod pg_get_functiondef 取得;prosrc md5 = a60944edb678064c468ba517391cc311
--   完整指紋(公式 = 上方 pg_temp.b2_create_order_fp,單一來源):
--     · 8-param 基線(prod 現況)  = 77945871ed5d9f5dcac7f8d53c9f192c
--     · 9-param 預期產出(本檔)  = 850e2e3cf5f503391df5fe6fe0067cce
--     兩值皆於 2026-07-19 在 **production 實測取得**(8-param 直接查;9-param 以異名複製品在
--     交易內建出後求值、結尾 RAISE 回滾,零留痕),並與本機拋棄式 PG 的結果逐字相符。
--   ⚠️ 指紋歷經兩次公式更正,前兩代值**皆已作廢,勿再引用**:
--     · 2b898129e49d194c30ab8039b857c0be(初代;漏 proretset / prosupport / seclabel = 關卡2 M-2)
--     · beca7444c4c29251940509d889fe0c74(二代;seclabel 只比 objoid、且誤查 pg_shseclabel
--       = 關卡2 round2 #2)
--     凍結 snapshot §2 的指紋列屬初代公式,因該檔自訂「產出後不得再編輯」→ 現行值與完整
--     catalog 一律以補充檔 docs/reviews/2026-07-19-b2-preapply-snapshot-supplement.md 為準。
--   本檔函式體以程式產生,並經「反向還原後 md5 等回基線」驗證 → 除下列 1 處 delta 外零位元組偏差:
--     · orders INSERT 欄位清單 + VALUES 各加一欄(notification_email / p_notification_email)
--   ⚠️ 「1 處」= **同一個 INSERT 敘述**;跑 unified diff 會看到 **2 個 hunk**(欄位清單與
--      VALUES 分屬兩段上下文),兩者皆屬同一處 delta,勿誤判為字面不符。
--   (簽章與 COMMENT 不在 prosrc 內,故 prosrc 層 delta = 1 處、檔面 = 3 處)
--   新函式體 prosrc md5 = 0bc0d256b7483c5dd6ef1f8f97b4e9a7
--
-- 驗收(詳 plan §6):三綠 / 路徑① apply 前模擬(須剔除本檔 BEGIN;COMMIT; 兩行,
--   否則內層 COMMIT 會真的提交 → prod 留痕)/ 路徑② apply 後含 PostgREST smoke。
-- rollback:見 plan §9 —— 只認 apply 前凍結副本,禁止重新拿舊 migration 當權威。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ── application-defined「create_order DDL 約定鎖」(codex 關卡2 M-1 修正 + round2 nit)──
--   🔴 原本用「本 migration 自己的時戳」20260719120000 當 key = **假互斥**:下一支 migration
--      會用它自己的時戳,兩把鎖永不衝突。前一視窗宣稱「已緩解」為不成立的宣稱,已作廢。
--   改用**所有 create_order DDL 共用的固定常數**。此常數本身就是約定,日後任何動
--   public.create_order 的 migration 一律沿用**這個字面值**、不得各自重算或改寫。
--   常數來源(僅供追溯,apply 時不再計算,避免依賴未文件化函式):
--     select hashtext('public.create_order');  → 1201033732(2026-07-19 於 prod PG 17.6 取得)
--   🔴 用詞界定(codex round2 nit:原寫「object-scoped」過強):advisory lock key 是
--      **應用層自訂的數字資源**,PG 並未把它綁定到 pg_proc 物件;命名為「約定鎖」才符實。
--      32-bit key 理論上可與別人的約定碰撞 → 後果是**誤等待**(多等 lock_timeout 3s 後 fail-fast),
--      **不會**造成互斥失效,方向安全。
--   🔴 能力邊界(誠實界定,勿再誇大):只讓**同樣寫死此常數**的 migration 互斥;
--      對不遵守此約定的任何外部 DDL session **無效**。真正的防線仍是 Q5=A 的有界假設
--      ——「所有 schema 變更走 db push、由 Sean 單人序列執行,無第二個 DDL 行為者」。
--      若日後出現第二個 schema 變更管道(CI 自動 migration、他人取得 DB 權限),該假設即失效。
SELECT pg_advisory_xact_lock(1201033732);

-- ── 指紋函式:**單一定義來源**(codex 關卡2 round2 #1)──────────────────────
--   🔴 原設計把同一條公式**抄在段 2.5 與斷言⑧兩處**,並宣稱「兩處不一致就 fail-closed」。
--      該宣稱**不成立**:斷言⑧只驗「⑧自己的公式算出的產物 == ⑧自己的常數」,從未與段 2.5
--      的公式比對。若有人同時弱化段 2.5 的公式**並重取該處的兩個常數**,首次 apply 走狀態 A、
--      根本不會用到狀態 B 常數,⑧照樣通過 → 之後 COMMENT 被外部改動就會被弱化的守門放行。
--      **根治法 = 公式只寫一次**,守門與斷言共用,結構上不可能不一致。
--   pg_temp = session 級暫存 schema,不進 public、不留正式物件;本檔 COMMIT 前另有顯式 DROP。
--
--   🔴 指紋涵蓋欄位 = plan E11 全欄:
--     prosrc / pg_get_function_arguments / pg_get_expr(proargdefaults) / proargnames /
--     prosecdef / proconfig / proacl / owner / prorettype / proretset / lanname / provolatile /
--     proparallel / proisstrict / proleakproof / procost / prorows / prosupport /
--     security label / COMMENT。(pronargs、pronargdefaults 由 args 字串與 default 運算式涵蓋。)
--   🔴 security label 精確化(codex 關卡2 round2 #2):原查詢只用 `objoid = p.oid` 取 count。
--      `pg_seclabel` 的識別鍵是 (objoid, **classoid**, objsubid, provider) —— 只比 objoid
--      可能誤配到**其他 catalog 中同一 OID 數值**的物件標籤;且 `pg_shseclabel` 依定義只存
--      cluster-shared 物件(role/database/tablespace),函式**不可能**出現在該表,原本查它
--      反而製造誤配面。故:①只查 `pg_seclabel` 並補 `classoid='pg_proc'::regclass AND objsubid=0`
--      ②改存**排序後的 provider=label 串接**(比 count 更能偵測「標籤被換掉」而非只偵測數量)。
CREATE FUNCTION pg_temp.b2_create_order_fp(p_oid oid) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $fp$
  SELECT md5(
    coalesce(p.prosrc,'')                        || '|' ||
    pg_get_function_arguments(p.oid)             || '|' ||
    coalesce(pg_get_expr(p.proargdefaults,0),'') || '|' ||
    coalesce(p.proargnames::text,'')             || '|' ||
    p.prosecdef::text                            || '|' ||
    coalesce(p.proconfig::text,'')               || '|' ||
    coalesce(p.proacl::text,'')                  || '|' ||
    pg_get_userbyid(p.proowner)::text            || '|' ||
    p.prorettype::regtype::text                  || '|' ||
    p.proretset::text                            || '|' ||
    l.lanname::text                              || '|' ||
    p.provolatile::text                          || '|' ||
    p.proparallel::text                          || '|' ||
    p.proisstrict::text                          || '|' ||
    p.proleakproof::text                         || '|' ||
    p.procost::text                              || '|' ||
    p.prorows::text                              || '|' ||
    p.prosupport::text                           || '|' ||
    coalesce((SELECT string_agg(s.provider || '=' || s.label, ',' ORDER BY s.provider, s.label)
                FROM pg_seclabel s
               WHERE s.objoid = p.oid
                 AND s.classoid = 'pg_proc'::regclass
                 AND s.objsubid = 0), '')        || '|' ||
    coalesce(obj_description(p.oid,'pg_proc'),'')
  )
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = p_oid
$fp$;

-- ── 段 2.5:apply-time 基線守門(codex R3 BLOCKER-1;關卡2 M-2/M-3 補強)────────
--   目的:DROP IF EXISTS 會願意輾過『任何』現況,包含別人後來改過的較新版本。
--   守門要求當下必為兩個預期狀態之一,且**完整指紋**相符,否則中止,絕不覆寫未知版本。
--
--   🔴 指紋涵蓋欄位(關卡2 M-2:原公式漏 proretset / prosupport / security label 三項,
--      而這三項明明列在 plan E11 → 舊公式配「全屬性」稱呼是名稱誇大實際能力,已補齊)。
--      **公式本身定義於上方 `pg_temp.b2_create_order_fp`(單一來源)**,守門與檔尾斷言共用。
--
--   🔴 狀態 B 改驗**完整預期產出指紋**(關卡2 M-3):原設計只驗 prosrc md5 + 簽章字串,
--      理由寫「ACL/COMMENT 本就要 canonicalize,故無風險」——**那正是守門存在要禁止的
--      覆寫行為**。正常的 history 裂縫必然發生在本檔完整 COMMIT 之後,現況就該逐位元組
--      等於本檔的預期產出;放寬沒有正當理由。若有人在裂縫後改了 owner / SECURITY DEFINER /
--      search_path / ACL / COMMENT,現在會被擋下而非靜默洗掉。
--
--   ⚠️ 9-param 預期產出指紋是**自指常數**(其輸入含本檔下方的 COMMENT 與 ACL 字面)。
--      代償控制:檔尾斷言⑧以**同一個 helper**(結構上必然同公式)重算並比對**同一個常數**
--      → 任何人改了 COMMENT/ACL/函式體卻忘了同步此常數,**首次 apply 就會在斷言階段
--      整批回滾並吵**,不會潛伏到某次重跑才誤擋。
--      🔴 界定(codex round2 #1 更正):此代償控制保護的是「**常數**未隨檔案內容更新」;
--         「兩處公式漂移」則是靠 helper 只有一份**在結構上消除**,而非靠斷言偵測。
--         原字面宣稱斷言能證明兩處公式一致 —— **不成立,已作廢**。
DO $guard$
DECLARE
  v_oid8  oid  := to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  v_oid9  oid  := to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
  v_oid   oid;
  v_state text;
  v_want  text;
  v_fp    text;
  v_dump  text;
BEGIN
  IF v_oid8 IS NOT NULL AND v_oid9 IS NULL THEN
    -- 狀態 A:首次 apply。預期 == prod 8-param 基線。
    v_state := 'A(首次 apply,現況僅 8-param)';
    v_oid   := v_oid8;
    v_want  := '77945871ed5d9f5dcac7f8d53c9f192c';
  ELSIF v_oid9 IS NOT NULL AND v_oid8 IS NULL THEN
    -- 狀態 B:history 裂縫後重跑。預期 == 本檔自身的完整產出(非放寬版)。
    v_state := 'B(history 裂縫後重跑,現況僅 9-param)';
    v_oid   := v_oid9;
    v_want  := '850e2e3cf5f503391df5fe6fe0067cce';
  ELSE
    RAISE EXCEPTION 'B-2 守門:create_order 現況非預期狀態(8-param 存在=%,9-param 存在=%)。預期為「僅 8-param」或「僅 9-param」→ 中止,交人工判斷(處置見檔頭 SOP)。'
      , (v_oid8 IS NOT NULL), (v_oid9 IS NOT NULL);
  END IF;

  v_fp := pg_temp.b2_create_order_fp(v_oid);

  -- 🔴 逐欄 dump:md5 不符時單看雜湊無法診斷是哪一項漂移,故一併輸出可讀清單
  --    (只含 catalog 屬性與雜湊,不含 prosrc / COMMENT 全文)
  SELECT format('｜實際屬性:args=%s｜default=%s｜argnames=%s｜secdef=%s｜config=%s｜acl=%s｜owner=%s｜ret=%s｜retset=%s｜lang=%s｜vol=%s｜par=%s｜strict=%s｜leak=%s｜cost=%s｜rows=%s｜support=%s｜seclabel=%s｜prosrc_md5=%s｜comment_md5=%s(len=%s)',
      pg_get_function_arguments(p.oid), coalesce(pg_get_expr(p.proargdefaults,0),'(無)'),
      coalesce(p.proargnames::text,''), p.prosecdef, coalesce(p.proconfig::text,''),
      coalesce(p.proacl::text,''), pg_get_userbyid(p.proowner), p.prorettype::regtype::text,
      p.proretset, l.lanname, p.provolatile, p.proparallel, p.proisstrict, p.proleakproof,
      p.procost, p.prorows, p.prosupport::text,
      coalesce((SELECT string_agg(s.provider || '=' || s.label, ',' ORDER BY s.provider, s.label)
                  FROM pg_seclabel s
                 WHERE s.objoid = p.oid AND s.classoid = 'pg_proc'::regclass AND s.objsubid = 0), '(無)'),
      md5(coalesce(p.prosrc,'')), md5(coalesce(obj_description(p.oid,'pg_proc'),'')),
      length(coalesce(obj_description(p.oid,'pg_proc'),''))) INTO v_dump
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = v_oid;

  IF v_fp IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'B-2 守門:狀態 % 的完整指紋與預期不符(實際=%,預期=%)→ 現行 create_order 已被本 migration 之外的變更動過,中止,絕不覆寫未知版本。%'
      , v_state, v_fp, v_want, v_dump;
  END IF;
END
$guard$;

-- ── DROP:兩簽章皆 IF EXISTS = 整支可重跑(正確性由上方守門保證,非靠 IF EXISTS)──
DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text);

-- ── CREATE 9-param ─────────────────────────────────────────────────────
--   🔴 屬性宣稱的精確版本(web Codex nit #5:原字面「屬性全部顯式寫出,不倚賴 PG 預設值
--      日後不變」**高估了 CREATE 本身的能力,已作廢**):
--      · **可在 CREATE 顯式指定者,已全部指定**:RETURNS / LANGUAGE / SECURITY DEFINER /
--        VOLATILE / PARALLEL UNSAFE / CALLED ON NULL INPUT / NOT LEAKPROOF / COST / SET search_path。
--      · **CREATE 語法無從指定者**:`prosupport`(需另下 ALTER FUNCTION … SUPPORT)、
--        `prorows`(僅 set-returning 函式適用)→ 這兩項取 PG 預設。
--      · 故「不倚賴預設值」**不是靠 CREATE 達成的**,而是靠**檔尾斷言逐項精確驗證**:
--        預設值日後若改變,斷言會 fail-closed 擋下,而非默默生效。
CREATE FUNCTION public.create_order(
  p_lines              jsonb,
  p_address_id         uuid,
  p_shipping_method    text,
  p_invoice            jsonb,
  p_cart_session_id    uuid,
  p_terms_version      text,
  p_client_ip          text,
  p_client_ua          text,
  p_notification_email text DEFAULT NULL   -- 🔴 B-2 過渡期 DEFAULT;B-6 移除
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
PARALLEL UNSAFE
CALLED ON NULL INPUT
NOT LEAKPROOF
COST 100
SET search_path = ''
AS $fn$
DECLARE
  v_uid            uuid := (select auth.uid());
  v_addr           record;
  v_line           jsonb;
  v_variant        record;
  v_qty            integer;
  v_variant_id     uuid;
  v_supplier_slug  text;
  v_sku            text;
  v_unit_price     integer;
  v_line_total     bigint;
  v_subtotal       bigint := 0;
  v_shipping_fee   integer;
  v_total          bigint;
  v_seen_variants  uuid[] := '{}';
  v_items          jsonb := '[]'::jsonb;
  v_invoice        jsonb;
  v_addr_snapshot  jsonb;
  v_display_id     text;
  v_seq_text       text;
  v_order_id       uuid;
  -- 🔴 V-3a delta:vehicle 白名單重組工作變數(其餘 DECLARE 逐字同 20260630120000)
  v_veh            jsonb;
  v_veh_ok         boolean;
  v_veh_year       integer;
  v_vehicle        jsonb;
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 0b. 🔴 #241 同意條款 guard(create_order 路徑「無 consent 不生 order」;codex H4 空字串、B2 限縮為本路徑)──
  IF p_terms_version IS NULL OR pg_catalog.btrim(p_terms_version) = '' THEN
    RAISE EXCEPTION 'create_order: 缺同意條款版本(consent)';
  END IF;

  -- ── 1. 身分 + customer profile(fail-closed)──
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_order: 未登入(auth.uid NULL)';
  END IF;
  PERFORM 1 FROM public.customers WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 查無 customer profile(uid=%)', v_uid;
  END IF;

  -- ── 2. 地址歸屬(必為本人、否則 raise;快照凍結履約地址)──
  SELECT id, name, phone, line
    INTO v_addr
    FROM public.customer_addresses
   WHERE id = p_address_id AND customer_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 地址非本人或不存在(address_id=%)', p_address_id;
  END IF;
  v_addr_snapshot := pg_catalog.jsonb_build_object(
    'name', v_addr.name, 'phone', coalesce(v_addr.phone, ''), 'line', v_addr.line
  );

  -- ── 3. 配送方式白名單(home/store)──
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'create_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;

  -- ── 4. 發票類型 ──
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'type') IS NULL OR (p_invoice->>'type') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'create_order: 發票類型非法或缺失(%)', p_invoice->>'type';
  END IF;
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       p_invoice->>'type',
    'carrier',    p_invoice->>'carrier',
    'title',      p_invoice->>'title',
    'taxId',      p_invoice->>'taxId',
    'donateCode', p_invoice->>'donateCode'
  ));

  -- ── 5. 購物車非空 + 品項數上限 ──
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'create_order: 購物車為空';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'create_order: 購物車品項超過上限(200)';
  END IF;

  -- ── 6. 逐 line ──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(p_lines) AS e
  LOOP
    v_qty := (v_line->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 10000 THEN
      RAISE EXCEPTION 'create_order: 數量非法或超過上限 1-10000(qty=%)', v_line->>'qty';
    END IF;

    v_variant_id    := nullif(v_line->>'variant_id', '')::uuid;
    v_supplier_slug := v_line->>'supplier_slug';
    v_sku           := v_line->>'sku';

    IF v_variant_id IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.supplier_slug = v_supplier_slug AND pv.sku = v_sku;
    ELSE
      RAISE EXCEPTION 'create_order: line 缺 variant_id 或 (supplier_slug,sku)';
    END IF;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'create_order: 找不到 variant(variant_id=%, supplier_slug=%, sku=%)', v_variant_id, v_supplier_slug, v_sku;
    END IF;

    IF v_variant.id = ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'create_order: 重複 variant(%);同變體應合併 qty', v_variant.id;
    END IF;
    v_seen_variants := v_seen_variants || v_variant.id;

    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
    END IF;

    v_unit_price := v_variant.price_general;
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
    END IF;

    IF pg_catalog.jsonb_typeof(v_variant.spec) <> 'object'
       OR NOT public.m3_jsonb_values_all_string(v_variant.spec)
       OR (v_variant.spec ?| array['price_store','price_by_tier','cost']) THEN
      RAISE EXCEPTION 'create_order: variant spec 非法(非 object/含非字串值/含敏感鍵)(variant=%)', v_variant.id;
    END IF;

    v_line_total := v_unit_price::bigint * v_qty;
    IF v_line_total > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 單筆金額溢位(variant=%, line_total=%)', v_variant.id, v_line_total;
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 訂單小計溢位(subtotal=%)', v_subtotal;
    END IF;

    -- ── 6v. 🔴 V-3a delta:optional vehicle 白名單重組(鏡像 §4 p_invoice 手法;禁 v_line->'vehicle' 直存)──
    --   逐 kind 隔離(verdict REQUIRED-3):dict 只收 brand/model/year/source(不收 raw)、
    --   free 只收 raw/year/source(不收 brand/model);非空 text ≤200;year=JSON number 4 位整數
    --   1900-2100(regex 先驗防 ::integer 溢位 RAISE)。任何不合 → 該 line v_vehicle=NULL、
    --   不 RAISE 不擋單(選填;與 @pcm/schemas .catch(undefined) 同構)。車種鐵律:零正規化、字面凍結。
    v_vehicle := NULL;
    v_veh := v_line->'vehicle';
    IF v_veh IS NOT NULL AND pg_catalog.jsonb_typeof(v_veh) = 'object' THEN
      v_veh_ok := true;
      v_veh_year := NULL;
      IF v_veh ? 'year' THEN
        -- 🔴 cast 與驗證分離(reviewer Important):::integer 只在 regex 4 位通過「之後」的獨立
        --   statement 執行=可證明無溢位 RAISE(不依賴 AND 短路順序=PG 官方不保證求值順序);
        --   typeof/regex 本身無異常面(->> 回 text/NULL、NULL~pattern=NULL)。
        IF pg_catalog.jsonb_typeof(v_veh->'year') = 'number'
           AND (v_veh->>'year') ~ '^[0-9]{4}$' THEN
          v_veh_year := (v_veh->>'year')::integer; -- regex 已限 4 位、cast 恆安全
          IF v_veh_year < 1900 OR v_veh_year > 2100 THEN
            v_veh_ok := false; -- 超界=整顆作廢(兩層同構;非法不擋單)
          END IF;
        ELSE
          v_veh_ok := false; -- year 形狀不合=整顆作廢(兩層同構;非法不擋單)
        END IF;
      END IF;
      IF v_veh_ok AND v_veh->>'kind' = 'dict' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'brand') = 'string'
           AND pg_catalog.jsonb_typeof(v_veh->'model') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'brand'), '') <> '' AND pg_catalog.length(v_veh->>'brand') <= 200
           AND coalesce(pg_catalog.btrim(v_veh->>'model'), '') <> '' AND pg_catalog.length(v_veh->>'model') <= 200
           AND (v_veh->>'source') IN ('search', 'garage', 'picker') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'dict', 'brand', v_veh->>'brand', 'model', v_veh->>'model',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      ELSIF v_veh_ok AND v_veh->>'kind' = 'free' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'raw') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'raw'), '') <> '' AND pg_catalog.length(v_veh->>'raw') <= 200
           AND (v_veh->>'source') IN ('garage', 'freetext') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'free', 'raw', v_veh->>'raw',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      END IF;
    END IF;

    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id',       v_variant.id,
      'variant_sku',      v_variant.sku,
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec),
      'quantity',         v_qty,
      'unit_price',       v_unit_price,
      'line_total',       v_line_total,
      'availability_at_checkout',
        CASE WHEN v_variant.variant_availability = 'in-stock'
              AND v_variant.product_availability = 'in-stock'
             THEN 'in-stock' ELSE 'out-of-stock' END,
      -- 🔴 V-3a delta:白名單重組後快照(NULL → JSON null → §9 NULLIF 轉回 SQL NULL)
      'vehicle',          v_vehicle
    );
  END LOOP;

  -- ── 7. 運費 ──
  IF p_shipping_method = 'store' THEN
    v_shipping_fee := 0;
  ELSE
    v_shipping_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END;
  END IF;
  v_total := v_subtotal + v_shipping_fee;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 訂單總額溢位(total=%)', v_total;
  END IF;

  -- ── 8. 產號 + 寫 order ──
  v_seq_text := pg_catalog.nextval('public.order_display_seq')::text;
  v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
                  CASE WHEN pg_catalog.length(v_seq_text) < 4 THEN pg_catalog.lpad(v_seq_text, 4, '0') ELSE v_seq_text END;

  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id,
    notification_email
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
    p_notification_email
  )
  RETURNING id INTO v_order_id;

  -- ── 8b. 🔴 #241 同 transaction 原子寫同意紀錄(Gemini 否決拆 RPC 的幽靈訂單;create_order 路徑無 consent 不生 order)──
  --    IP/UA left() 截斷(codex M8;NULL 輸入 left 回 NULL、容忍 best-effort 缺值)。
  INSERT INTO public.order_legal_consents (order_id, terms_version, consented_at, client_ip, client_user_agent)
  VALUES (v_order_id, p_terms_version, pg_catalog.now(),
          pg_catalog.left(p_client_ip, 128), pg_catalog.left(p_client_ua, 1024));

  -- ── 9. 寫 items(V-3a delta:多寫 vehicle_snapshot;NULLIF 把 JSON null 轉回 SQL NULL)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total, availability_at_checkout, vehicle_snapshot
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer,
      v_line->>'availability_at_checkout',
      NULLIF(v_line->'vehicle', 'null'::jsonb)
    );
  END LOOP;

  -- ── 10. return DTO ──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;

-- ── ACL 鏡像重建(DROP 後權限歸零;🔴 實測 Supabase 對新函式預設 GRANT 給
--    PUBLIC + anon + authenticated + service_role,anon 可執行 → 必須全部 REVOKE)──
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) TO authenticated;
-- 🔴 SECURITY DEFINER 的執行身分 = owner;實測 db push 以 postgres 連線,本行為保險
ALTER FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) OWNER TO postgres;

COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) IS
  'M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄 + M-4a V-3a vehicle_snapshot + M-4a B-2 notification_email(9-param)。client 送 variant+qty+address+method+cart_session_id+invoice,每 line 可帶 optional vehicle(白名單重組逐 kind 隔離、非法=NULL 不擋單、字面凍結零猜),永不送價/tier;server 注入 terms_version + best-effort client_ip/ua。notification_email 由 app 層送入(canonical 化由 B-3 的 app 層鏡像規則保證,**RPC 本身不驗不正規化**);⚠️ B-2 當下無任何呼叫端送第 9 參(TS 仍 8 參,B-4 才接)。p_notification_email 為 B-2 過渡期 DEFAULT NULL(必填收緊=B-6 移除 DEFAULT);RPC 內不做任何 email 正規化或驗證(Sean 07-19 拍 Q1=A:規則只留 DB CHECK 與 B-3 app 層鏡像兩份,不新增第三份),不合規值由 orders_notification_email_valid CHECK 擋下、整筆回滾。其餘 executable 逐字同 20260716200000(prosrc 僅 1 處 delta=orders INSERT 欄位與 VALUES);return 只 {order_id,display_id}。';

-- 🔴 codex R1 #1:不只依賴 pgrst_ddl_watch / pgrst_drop_watch,顯式再送一次。
--    NOTIFY 於 COMMIT 才送達 → 快取在新函式可見之後才重載,順序天然正確。
NOTIFY pgrst, 'reload schema';

-- ── fail-closed 斷言矩陣 ───────────────────────────────────────────
DO $assert$
DECLARE
  v_n8 int; v_sigs int; v_acl text; v_owner text; v_args text; v_def text;
  v_secdef boolean; v_cfg text; v_ret text; v_lang text; v_vol text; v_par text;
  v_strict boolean; v_leak boolean; v_cost real; v_rows real;
  v_retset boolean; v_support text;
  v_nargs int; v_ndef int; v_names text; v_cmt_md5 text; v_cmt_len int; v_src text;
  v_seclabel int; v_fp9 text;
BEGIN
  SELECT count(*) INTO v_n8 FROM pg_proc WHERE oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  IF v_n8 <> 0 THEN RAISE EXCEPTION '斷言②失敗:舊 8-param 仍存在(=overload 風險)'; END IF;

  -- 🔴 斷言①:public.create_order 的**簽章總數**必須恰為 1。
  --    只驗「8-param 不在 + 9-param 在」不夠 —— 若另有型別相異的第三個 overload
  --    (例如末參 varchar),上面兩查都看不見,apply 後 8 引數呼叫會撞 42725
  --    is not unique = 結帳全斷(plan E4 實測過的災難模式)。
  SELECT count(*) INTO v_sigs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION '斷言①失敗:public.create_order 簽章總數=%(必須恰為 1;>1 即 overload 歧義風險)', v_sigs;
  END IF;

  SELECT p.prosecdef, coalesce(p.proconfig::text,''), pg_get_userbyid(p.proowner)::text,
         p.prorettype::regtype::text, l.lanname::text, p.provolatile::text, p.proparallel::text,
         p.proisstrict, p.proleakproof, p.procost, p.prorows,
         p.proretset, p.prosupport::text,
         p.pronargs, p.pronargdefaults, p.proargnames::text,
         pg_get_function_arguments(p.oid), coalesce(pg_get_expr(p.proargdefaults,0),''),
         coalesce(p.proacl::text,''), md5(obj_description(p.oid,'pg_proc')),
         length(obj_description(p.oid,'pg_proc')), md5(p.prosrc)
    INTO v_secdef, v_cfg, v_owner, v_ret, v_lang, v_vol, v_par, v_strict, v_leak, v_cost,
         v_rows, v_retset, v_support, v_nargs, v_ndef, v_names, v_args, v_def, v_acl,
         v_cmt_md5, v_cmt_len, v_src
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
  IF NOT FOUND THEN RAISE EXCEPTION '斷言①失敗:9-param create_order 不存在'; END IF;

  IF NOT v_secdef THEN RAISE EXCEPTION '斷言⑤失敗:prosecdef 非 true'; END IF;
  IF v_cfg <> '{"search_path=\"\""}' THEN
    RAISE EXCEPTION '斷言⑤失敗:proconfig 非預期(實際=%)', v_cfg; END IF;
  IF v_owner <> 'postgres' THEN RAISE EXCEPTION '斷言⑤失敗:owner=%(SECURITY DEFINER 執行身分)', v_owner; END IF;
  IF v_ret <> 'jsonb' THEN RAISE EXCEPTION '斷言⑤失敗:回傳型別=%', v_ret; END IF;
  IF v_lang <> 'plpgsql' THEN RAISE EXCEPTION '斷言⑤失敗:語言=%', v_lang; END IF;
  IF v_vol <> 'v' THEN RAISE EXCEPTION '斷言⑤失敗:volatility=%', v_vol; END IF;
  IF v_par <> 'u' THEN RAISE EXCEPTION '斷言⑤失敗:parallel=%', v_par; END IF;
  IF v_strict THEN RAISE EXCEPTION '斷言⑤失敗:proisstrict 非 false'; END IF;
  IF v_leak THEN RAISE EXCEPTION '斷言⑤失敗:proleakproof 非 false'; END IF;
  IF v_cost <> 100 THEN RAISE EXCEPTION '斷言⑤失敗:cost=%', v_cost; END IF;
  IF v_rows <> 0 THEN RAISE EXCEPTION '斷言⑤失敗:rows=%', v_rows; END IF;
  IF v_retset THEN RAISE EXCEPTION '斷言⑤失敗:proretset 非 false(應為純量回傳)'; END IF;
  IF v_support <> '-' THEN RAISE EXCEPTION '斷言⑤失敗:prosupport=%(基線為無)', v_support; END IF;

  -- 斷言⑦:第 9 參契約 —— 精確等值,禁 substring
  IF v_nargs <> 9 THEN RAISE EXCEPTION '斷言⑦失敗:參數數=%', v_nargs; END IF;
  IF v_ndef <> 1 THEN RAISE EXCEPTION '斷言⑦失敗:default 數=%', v_ndef; END IF;
  IF v_args <> 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text DEFAULT NULL::text' THEN
    RAISE EXCEPTION '斷言⑦失敗:簽章字串不符(實際=%)', v_args; END IF;
  -- 🔴 實測:PG 把 DEFAULT NULL 正規化為 NULL::text(非裸 NULL),照直覺寫會失敗
  IF v_def <> 'NULL::text' THEN
    RAISE EXCEPTION '斷言⑦失敗:default expression=%(預期 NULL::text)', v_def; END IF;
  IF v_names <> '{p_lines,p_address_id,p_shipping_method,p_invoice,p_cart_session_id,p_terms_version,p_client_ip,p_client_ua,p_notification_email}' THEN
    RAISE EXCEPTION '斷言⑦失敗:proargnames=%', v_names; END IF;

  -- 斷言③④:ACL 六角色矩陣 + proacl 字面
  IF v_acl <> '{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION '斷言④失敗:proacl=%', v_acl; END IF;
  IF NOT has_function_privilege('authenticated','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:authenticated 無 EXECUTE(結帳會全斷)'; END IF;
  IF has_function_privilege('anon','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:anon 可執行(未登入者可建單)'; END IF;
  IF has_function_privilege('service_role','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:service_role 可執行'; END IF;
  IF has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:payment_confirmer 可執行'; END IF;
  IF has_function_privilege('authenticator','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:authenticator 可執行'; END IF;
  IF has_function_privilege('public','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:PUBLIC 可執行'; END IF;

  -- 斷言⑥:COMMENT 已重建且為實質內容。
  --   🔴 刻意**不**驗 md5:COMMENT 就寫在本檔上方 3 個語句處,寫死其 md5 = 自指字面
  --   (改一個字就得同步改 md5,正是本專案反覆踩過的坑)。改以「非空 + 長度下限」
  --   證明它不是空字串或佔位符;逐字內容由 plan §6-B 第 4 項對照**本檔上方的
  --   COMMENT ON FUNCTION 語句字面**覆核(⚠️ 不是對照 snapshot —— snapshot 凍的是
  --   8-param 的舊 COMMENT,與本檔的 9-param 版本本就不同)。
  --   🔴 上一行 md5 IS NULL 檢查是承重的:若只留長度檢查,COMMENT 為 NULL 時
  --   NULL < 400 求值為 NULL 會靜默放行。日後勿「簡化」掉。
  IF v_cmt_md5 IS NULL THEN RAISE EXCEPTION '斷言⑥失敗:COMMENT 為空(DROP 後未重建)'; END IF;
  IF v_cmt_len < 400 THEN RAISE EXCEPTION '斷言⑥失敗:COMMENT 長度=%(疑為佔位符)', v_cmt_len; END IF;

  -- 斷言:函式體 = 已驗證產出(除 1 處 delta 外與 prod 基線零偏差)
  IF v_src <> '0bc0d256b7483c5dd6ef1f8f97b4e9a7' THEN
    RAISE EXCEPTION '斷言失敗:prosrc md5=%(預期=%)', v_src, '0bc0d256b7483c5dd6ef1f8f97b4e9a7'; END IF;

  -- 🔴 security label(codex 關卡2 round2 #2 精確化):
  --    `pg_seclabel` 的識別鍵是 (objoid, **classoid**, objsubid, provider) → 只比 objoid
  --    會誤配其他 catalog 中同一 OID 數值的物件標籤,故補 classoid + objsubid。
  --    `pg_shseclabel` 只存 cluster-shared 物件(role/database/tablespace),函式**依定義
  --    不會**出現在該表 → 查它不增加保護、只增加誤配面,已移除(原斷言字面作廢)。
  SELECT count(*) INTO v_seclabel FROM pg_seclabel
   WHERE objoid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)')::oid
     AND classoid = 'pg_proc'::regclass
     AND objsubid = 0;
  IF v_seclabel <> 0 THEN
    RAISE EXCEPTION '斷言⑤失敗:pg_proc security label 數=%(基線 0)', v_seclabel; END IF;

  -- 🔴 斷言⑧:剛建好的 9-param 完整指紋 == 段 2.5 狀態 B 所用的預期產出常數。
  --    這條是段 2.5 那個**自指常數的代償控制**:改了上方 COMMENT/ACL/函式體卻忘了重取常數,
  --    本斷言會在**首次 apply** 當場失敗、整批回滾並吵出來,不會潛伏到某次重跑才誤擋。
  --    🔴 公式共用同一個 `pg_temp.b2_create_order_fp` helper(codex round2 #1)→
  --       「兩處公式漂移」在結構上不可能發生,不再倚賴斷言去偵測。
  --    常數重取方式:以同一 helper 對套用後的 9-param 求值(交易模擬即可,見 plan §6-B)。
  v_fp9 := pg_temp.b2_create_order_fp(
    to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'));
  IF v_fp9 IS DISTINCT FROM '850e2e3cf5f503391df5fe6fe0067cce' THEN
    RAISE EXCEPTION '斷言⑧失敗:本次產出的 9-param 完整指紋=%,與段 2.5 狀態 B 常數 % 不符 → 檔案內容已改但該常數未同步重取。', v_fp9, '850e2e3cf5f503391df5fe6fe0067cce'; END IF;

  RAISE NOTICE 'B-2 斷言矩陣全數通過(9-param / ACL / E11 全欄 / 簽章 / prosrc / 完整指紋)';
END
$assert$;

-- ── 清掉暫存指紋 helper(pg_temp 本就 session 級、不留正式物件;顯式 DROP 求乾淨,
--    避免同一次 db push 的後續 migration 在同 session 撞見殘留定義)──
DROP FUNCTION pg_temp.b2_create_order_fp(oid);

COMMIT;
