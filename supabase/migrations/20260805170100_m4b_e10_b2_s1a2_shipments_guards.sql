-- ============================================================
-- M-4b E10 第 2 批 B2 · S1a-2:`public.shipments` 可變性守門族
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md`(v5.3)§3.2-A/§3.3。
-- 本片 = 四支 BEFORE UPDATE:X8 出貨·作廢後凍結 / A2 永不可改 / touch / X2 write-once。
--
-- 🔴 **X1(已離開草稿態必有品項)不在本片**,在 S1b —— 它的函式要讀 `shipment_items`,
--    而那張表 S1b 才建。實測:`CREATE FUNCTION` 引用不存在的表**會建成功**,錯誤要到執行時
--    才以 `42P01` 爆出來 ⇒ 若放本片,本片的 X1 負測會紅在「缺表」而不是「守門」
--    (K1 R3-Fable must-fix,plan §2)。
--
-- ── 名稱序契約(對齊 A4a `20260803140000:48-53` 的明文契約)──────────────
-- 同表同事件的 trigger 按**名稱字母序**發火。本表四支 BEFORE UPDATE 的序:
--   shipments_frozen_after_ship_bu  (X8)
--   shipments_immutable_guard_bu    (A2)
--   shipments_touch_updated_at_bu   (touch)
--   shipments_write_once_bu         (X2)
--
-- 🔴 **名稱序不影響結果,只影響「同時違反多條時紅在哪一條」**,而這個結論掛在三個前提上
--    (v5 曾寫「四支的讀寫欄集不相交」—— **那句字面是假的**:X8 判階段要讀 OLD.shipped_at、
--     X2 也讀 shipped_at,兩者讀集重疊。K1 R3-Fable 抓到,這裡改掛真正的前提):
--   P1  四支都**不寫 NEW**,只 RAISE 或原樣 RETURN NEW(touch 例外,見 P2)
--   P1b 四支一律 `RETURN NEW`,**禁 `RETURN NULL`**
--       —— BEFORE trigger 回 NULL 會讓該列的更新被**靜默取消**:
--          本機 PG17.10 實測 `UPDATE` 回 `UPDATE 0`、零錯誤、事後查值仍是舊值。
--          一支「看似只是不擋」的守門可以把合法寫入整個吞掉而不留痕跡。
--   P2  touch 是唯一寫 NEW 的一支(只寫 updated_at),而 updated_at 不被任何守門讀
--   ⇒ 讀集重疊是允許的:重疊的是**讀**不是寫,會出事的是「前一支改了後一支要讀的值」,P1 已排除。
--
-- ⚠️ 契約債(對齊 A4a 契約債⑥):下方 DO 的名稱序與前提斷言**只在本片 apply 時跑一次**,
--    不是常駐守門。**未來任何在本表掛 trigger / 改名的片必須重跑**。
--    🔴 **本批內部即觸發一次該契約,已重跑**:S1b 會在 `shipments` 上掛 X1
--    ⇒ **S1b 的驗收重跑本片的名稱序斷言**(見 S1b 檔內「名稱序契約反身性」段)。
--    🔴 v5.4(codex K2 nit 7):原文寫「欠自己一次」措辭過重 —— X1 是 AFTER constraint trigger,
--    **不改變**四支 BEFORE UPDATE 的名稱序;重跑是**遵守契約**(契約的文義 = 任何在本表掛 trigger
--    的片都要重跑該斷言),不是在補償一個缺失。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 前置閘:pin S1a-1 的產物(forward-only、拒亂序重跑)。
-- 🔴 v5.4(codex K2 #14):v5.3 只**數** CHECK=10 與 trigger 名存在 ⇒ 對「改名」「換事件面」
--    「trigger 被 DISABLE」全部隱形。改成具名集合雙向 + 事件面 + `tgenabled` 一起 pin。
DO $gate$
DECLARE
  v_actual   text[];
  v_expected text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.shipments'::regclass) THEN
    RAISE EXCEPTION 'S1a-2 前置閘:public.shipments 不存在 —— 必須先套 S1a-1;拒繼續';
  END IF;

  -- S1a-1 交付的具名約束全集(排除 contype='t':constraint trigger 屬 S1b)
  SELECT array_agg(conname ORDER BY conname) INTO v_actual
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.shipments'::regclass AND contype IN ('p','u','f','c');
  v_expected := ARRAY[
    'shipments_carrier_domain','shipments_carrier_note_pair','shipments_customer_user_id_fkey',
    'shipments_hct_evidence_carrier','shipments_hct_status_carrier','shipments_hct_status_domain',
    'shipments_hct_submitted_evidence','shipments_pkey','shipments_recipient_snapshot_shape',
    'shipments_reference_format','shipments_reference_unique','shipments_shipped_needs_tracking',
    'shipments_void_pair'];
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'S1a-2 前置閘:S1a-1 的約束集合不符 — 實際 = %,期望 = %;拒繼續', v_actual, v_expected;
  END IF;

  -- S1a-1 交付的 trigger 全集 + 啟用狀態(名稱與 tgenabled 一起釘)
  SELECT array_agg(tgname || ':' || tgenabled::text ORDER BY tgname) INTO v_actual
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal;
  IF v_actual IS DISTINCT FROM ARRAY['shipments_block_delete_bd:O','shipments_block_truncate_bt:O'] THEN
    RAISE EXCEPTION 'S1a-2 前置閘:S1a-1 的 trigger 集合/啟用狀態不符 — 實際 = %;拒繼續', v_actual;
  END IF;

  -- 空白 helper 必須在(本片不建、但下游守門的語意靠它)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = 'public.pcm_b2_is_blank(text)'::regprocedure) THEN
    RAISE EXCEPTION 'S1a-2 前置閘:缺 public.pcm_b2_is_blank(text)(S1a-1 應已建);拒繼續';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal
                AND tgname = 'shipments_write_once_bu') THEN
    RAISE EXCEPTION 'S1a-2 前置閘:本片產物已存在 —— 不得重跑;拒繼續';
  END IF;
END;
$gate$;

-- ── 1. X8:已寄出**或已作廢**後,凍結「寄給誰、走哪家」三欄 ──────────
-- 🔴 凍結集恰 3 欄:recipient_snapshot / carrier_code / carrier_note。
--    **不凍結** tracking_number(Q2=A 單號可改)與 hct_* 三欄 —— 後者是**外部系統的軌跡**,
--    不是出貨事實:已出貨 + 送單失敗必須能重送,凍結它等於讓資料永遠停在 failed 這個謊
--    (K1 R3 F9:「已出貨 + 送單失敗 = 不可逃逸死鎖」)。
--    不凍結的欄各自有恆時守門接住:tracking_number ← A8;hct_* ← X4/X5/X6/A9 + A5 partial unique。
--
-- 🔴🔴 **上面那句「hct_* 有恆時守門接住」是說過頭的,必須連著讀這段**(codex K2 #8,夜跑實測):
--    那四條 CHECK 都是**恆時**約束,只管「當下這一列自洽」,**完全不管狀態怎麼轉移**。
--    實測可走通的路徑:draft → 加品項 → 設 `shipped_at` + `submitted` + `hct_request_id`
--    → 再 `UPDATE … hct_status='draft', hct_request_id=NULL, hct_raw_response=NULL`
--    ⇒ **成功**(實測回報 `status=draft req=<NULL> shipped=t`)。
--    也就是:**一個已實際出貨、已送單新竹的包裹,可以被改回「從未送過單」並清空全部證據,
--    而 `shipped_at` 還留著** —— 稽核軌跡在 DB 層是可被抹除的。
--
--    🔴 **本片刻意不加「禁 submitted → draft」的狀態轉移守門**,理由不是做不到,是**那是產品決策**:
--    它會改變員工在後台實際做得到什麼(例如「送單送錯客戶、想退回重來」這種情境要不要允許),
--    而 Sean 至今沒有就此拍過板,plan §4 也沒有任何一條要求它。
--    在 schema 片、apply 不可逆的前提下,**憑實作者判斷新增一條會擋掉員工操作的守門 = 範圍擴張**。
--    ⇒ 處置:①本註解降級為誠實描述(不再宣稱 hct_* 被接住)
--            ②不變式交棒給出貨 writer RPC(MP §5.2 項 2 DoD)
--            ③**已列為給 Sean 的決策題**(見本批 STOP):要不要禁這條轉移、或改成「只准轉 failed」。
--
-- 🔴 用 **OLD** 判階段,不是 NEW:同一句 UPDATE 同時設 shipped_at 並改 carrier_code
--    = 建立當下一次寫完,**合法**;只有「已經是已寄出/已作廢的列」才進入凍結。
--
-- 🔴 條件必須含 `OR OLD.deleted_at IS NOT NULL` —— 少了它,作廢面完全沒有實作
--    (K1 R3-Fable must-fix:plan 的欄表宣告涵蓋已作廢,但守門只寫了 shipped_at)。
--
-- 不掛 SECURITY DEFINER:本函式只比對 OLD/NEW,不讀任何表(plan §3.2-C-2)。
CREATE FUNCTION public.pcm_b2_shipments_frozen_after_ship()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF (OLD.shipped_at IS NOT NULL OR OLD.deleted_at IS NOT NULL)
     AND (NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
       OR NEW.carrier_code       IS DISTINCT FROM OLD.carrier_code
       OR NEW.carrier_note       IS DISTINCT FROM OLD.carrier_note) THEN
    RAISE EXCEPTION
      '包裹已寄出或已作廢,收件資料與快遞商不可再改(shipment=%)。'
      '選錯快遞商的補救 = 作廢重開新包裹(Sean 2026-08-05 Q-a=C:出貨畫面提供「照這箱內容開一張新的」)',
      OLD.shipment_reference
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipments_frozen_after_ship';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipments_frozen_after_ship() FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. A2:身分欄永不可改 ─────────────────────────────────────
-- 🔴 customer_user_id 也在內:改客人會讓已裝箱的品項變成跨客人,而 A7(同客人)只在
--    shipment_items 的 INSERT 面驗 —— 事後改 parent 的客人它看不到。
CREATE FUNCTION public.pcm_b2_shipments_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.id                 IS DISTINCT FROM OLD.id
     OR NEW.shipment_reference IS DISTINCT FROM OLD.shipment_reference
     OR NEW.customer_user_id   IS DISTINCT FROM OLD.customer_user_id
     OR NEW.created_at         IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      '包裹的 id / 編號 / 客人 / 建立時間永不可改(shipment=%)', OLD.shipment_reference
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipments_immutable_guard';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipments_immutable_guard() FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. X2:shipped_at write-once ──────────────────────────────
-- 撤銷出貨的唯一路徑 = deleted_at 作廢(留 void_reason 稽核)。
CREATE FUNCTION public.pcm_b2_shipments_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF OLD.shipped_at IS NOT NULL AND NEW.shipped_at IS DISTINCT FROM OLD.shipped_at THEN
    RAISE EXCEPTION
      '出貨時間 write-once,不可清空也不可改(shipment=%);撤銷出貨請走作廢 deleted_at + void_reason',
      OLD.shipment_reference
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipments_write_once';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipments_write_once() FROM PUBLIC, anon, authenticated, service_role;

-- ── 4. touch:updated_at 自動維護 ─────────────────────────────
-- 沒有 trigger 的 updated_at 會永遠停在建立日 = 一個會說謊的欄位(照抄 suppliers 的理由)。
-- 🔴 這是四支裡**唯一寫 NEW** 的一支(P2),而它寫的 updated_at 不被任何守門讀。
CREATE FUNCTION public.pcm_b2_shipments_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipments_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. 掛 trigger(名稱序 = 發火序,見檔頭)────────────────────
CREATE TRIGGER shipments_frozen_after_ship_bu
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipments_frozen_after_ship();

CREATE TRIGGER shipments_immutable_guard_bu
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipments_immutable_guard();

CREATE TRIGGER shipments_touch_updated_at_bu
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipments_touch_updated_at();

CREATE TRIGGER shipments_write_once_bu
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipments_write_once();

-- ── 6. 結構驗收 ──────────────────────────────────────────────
-- 🔴 v5.4(codex K2 #4/#9):v5.3 的 P1/P1b 是兩條 grep,實測對 `RETURN OLD` 與 `NEW := OLD`
--    **完全全盲**(兩條 grep 命中數皆 0)⇒ 一支能靜默吞掉更新的守門可以整支通過驗收。
--    改成「釘死唯一允許的形狀」:恰一個 RETURN、且必須是 `RETURN NEW;`。
DO $verify$
DECLARE
  v_cnt      integer;
  v_actual   text[];
  v_src      text;
  v_name     text;
  v_owner    oid;
  v_pair     text[];
BEGIN
  -- 本片 4 支 + S1a-1 的 2 支 = 6 支,具名雙向 + 啟用狀態
  SELECT array_agg(tgname || ':' || tgenabled::text ORDER BY tgname) INTO v_actual
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal;
  IF v_actual IS DISTINCT FROM ARRAY[
       'shipments_block_delete_bd:O','shipments_block_truncate_bt:O',
       'shipments_frozen_after_ship_bu:O','shipments_immutable_guard_bu:O',
       'shipments_touch_updated_at_bu:O','shipments_write_once_bu:O'] THEN
    RAISE EXCEPTION 'S1a-2 驗收失敗 — shipments trigger 集合/啟用狀態不符,實際 = %;拒繼續', v_actual;
  END IF;

  -- 名稱序契約:四支 BEFORE UPDATE 的字母序
  SELECT string_agg(tgname, ',' ORDER BY tgname) INTO v_name
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal
     AND (tgtype & 16) <> 0 AND (tgtype & 2) <> 0;
  IF v_name <> 'shipments_frozen_after_ship_bu,shipments_immutable_guard_bu,'
               || 'shipments_touch_updated_at_bu,shipments_write_once_bu' THEN
    RAISE EXCEPTION 'S1a-2 驗收失敗 — 名稱序契約破裂,實際序 = %;'
                    '歸因(同時違反多條時紅在哪一條)押在這上面,拒繼續', v_name;
  END IF;

  -- 🔴 P1 / P1b(v5.4 改寫):不再只 grep 禁止字樣,改成**正面釘死唯一允許的形狀**。
  --    v5.3 只禁 `RETURN NULL` + 禁 `NEW.<欄> :=` ⇒ 以下三種靜默吞寫全部躲得過(codex K2 #9):
  --      ①`RETURN OLD`(BEFORE 觸發器回 OLD = 該列被改回原值,等同吞掉本次更新)
  --      ②`NEW := OLD`(整筆賦值,沒有 `NEW.` 前綴 ⇒ 舊 regex 不命中)
  --      ③`SELECT … INTO NEW`(同樣繞過 `:=` 形狀)
  FOR v_name, v_src IN
    SELECT p.proname, p.prosrc FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.pcm_b2_shipments_frozen_after_ship()'::regprocedure,
                     'public.pcm_b2_shipments_immutable_guard()'::regprocedure,
                     'public.pcm_b2_shipments_write_once()'::regprocedure,
                     'public.pcm_b2_shipments_touch_updated_at()'::regprocedure)
  LOOP
    -- 恰一個 RETURN,且必須是 `RETURN NEW;`
    IF regexp_count(v_src, '\mRETURN\M', 1, 'i') <> 1 THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 的 RETURN 不是恰一個(實 %):'
                      '多重出口會讓「原樣 RETURN NEW」這個前提無法靜態確認;拒繼續',
                      v_name, regexp_count(v_src, '\mRETURN\M', 1, 'i');
    END IF;
    IF regexp_count(v_src, '\mRETURN\s+NEW\s*;', 1, 'i') <> 1 THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 唯一的 RETURN 必須逐字是 `RETURN NEW;`'
                      '(`RETURN OLD` 會把該列改回原值、`RETURN NULL` 會靜默取消更新,兩者都零錯誤);拒繼續', v_name;
    END IF;
    -- 禁整筆賦值與 SELECT INTO NEW
    IF v_src ~* '\mNEW\s*:=' OR v_src ~* '\mINTO\s+NEW\M' THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 對 NEW 做了整筆賦值(NEW := … 或 SELECT … INTO NEW):'
                      '這會繞過「只有 touch 寫 NEW」的前提;拒繼續', v_name;
    END IF;
    -- 逐欄賦值:只有 touch 可以,且只能寫 updated_at
    IF v_name = 'pcm_b2_shipments_touch_updated_at' THEN
      IF regexp_count(v_src, '\mNEW\.[a-z_]+\s*:=', 1, 'i') <> 1
         OR v_src !~* '\mNEW\.updated_at\s*:=' THEN
        RAISE EXCEPTION 'S1a-2 驗收失敗 — touch 必須恰寫 NEW.updated_at 一欄(P2);拒繼續';
      END IF;
    ELSIF v_src ~* '\mNEW\.[a-z_]+\s*(:=|=[^=])' THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 寫了 NEW:只有 touch 可以寫(P1/P2),'
                      '否則名稱序會開始影響結果而不只是歸因;拒繼續', v_name;
    END IF;
  END LOOP;

  -- 🔴 函式面合約(plan §4 項 18):regprocedure 為鍵,owner / prosecdef / proconfig 逐字 / 零非 owner grantee
  SELECT relowner INTO v_owner FROM pg_catalog.pg_class WHERE oid = 'public.shipments'::regclass;
  FOREACH v_name IN ARRAY ARRAY[
      'public.pcm_b2_shipments_frozen_after_ship()',
      'public.pcm_b2_shipments_immutable_guard()',
      'public.pcm_b2_shipments_write_once()',
      'public.pcm_b2_shipments_touch_updated_at()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid = v_name::regprocedure) THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — 函式 % 不存在;拒繼續', v_name;
    END IF;
    IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_name::regprocedure) <> v_owner THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 的 owner 與表 owner 不一致;拒繼續', v_name;
    END IF;
    IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_name::regprocedure) THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 不該是 SECURITY DEFINER(它不讀任何表);拒繼續', v_name;
    END IF;
    IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_name::regprocedure)
       IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 的 proconfig 應恰為 {search_path=pg_catalog, public},實 %;拒繼續',
        v_name, (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_name::regprocedure);
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc pr, aclexplode(pr.proacl) a
     WHERE pr.oid = v_name::regprocedure AND a.grantee <> pr.proowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'S1a-2 驗收失敗 — % 除 owner 外仍有 % 個 grantee(shim 的具名 default grant);拒繼續', v_name, v_cnt;
    END IF;
  END LOOP;

  RAISE NOTICE 'B2 S1a-2 結構驗收全數通過(6 trigger 具名+啟用 / 名稱序契約 / P1 P1b 形狀釘死(恰一個 RETURN NEW、禁 RETURN OLD/NULL、禁整筆賦值)/ 四函式 owner+proconfig 逐字+零 grantee)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾(反向序 S1b → **S1a-2** → S1a-1):
--   ① DROP TRIGGER shipments_frozen_after_ship_bu / shipments_immutable_guard_bu
--      / shipments_touch_updated_at_bu / shipments_write_once_bu
--   ② **DROP FUNCTION ×4**(DROP TABLE 不帶走獨立函式;S1a-1 檔尾同一坑)
--   本片零資料異動 ⇒ 回滾無資料風險。
-- ============================================================
