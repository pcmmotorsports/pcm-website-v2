-- ============================================================
-- M-4b E10 S1a:供應商主檔(`public.suppliers`)
-- ============================================================
-- Sean 2026-08-01 拍板:供應商改「主檔 + 下拉選單」,不再讓員工手打自由文字。
--   ① 可新增 ② 可改名(只改 label)③ **不可刪除** ④ 停用走 is_active=false
--   ⑤ 選單依字母序 ⑥ 選單支援打字帶入候選
-- 拍板全集 = memory `project_m4b-supplier-master-decisions`。
--
-- 🔴 本片**只建主檔與 seed**,刻意不含:
--   · `order_item_procurement` 形狀改(supplier_name/canonical_key → supplier_id FK)= 另一片
--   · 新增/改名/停用的 owner RPC = 另一片(本片對 service_role 只開 SELECT ⇒ 寫入端還不存在)
--   · 後台設定頁 = 另一片
--   理由:同日 A5b 與供應商 plan 共 5 版、約 104 條 must-fix、0 行 code
--   ⇒ 改為「最小可驗片先落地、審查打會執行的東西」(Sean 2026-08-01 拍 A)。
--
-- 內容分級:主檔由員工在後台自行維護 ⇒ 依鐵則 9 走 CRUD(本片先落資料層)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 主表 ──────────────────────────────────────────────────
-- 🔴 id 用 uuid 而非 staff 那種人工 slug:staff 的 text PK 是為了相容
--    `admin_audit_log.actor`(text 無 FK)這個既有包袱;suppliers 的 id 只是未來 FK 的
--    被參照端、沒有任何人需要讀它。而 Sean 給的 26 家裡:5 家含中文、12 家含空白或標點
--    (`.` `-` 空格),**聯集 17 家無法直接當 ASCII slug**(逐筆程式計數,非目測)
--    ⇒ 逼員工自造 ASCII slug = 把「名稱正規化」問題原封搬到新增畫面。
CREATE TABLE public.suppliers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- 純空白名稱會變成選單裡「看不見卻選得到」的項目(對齊 staff 的 btrim 慣例)
  CONSTRAINT suppliers_label_nonempty CHECK (pg_catalog.btrim(label) <> ''),

  -- 🔴 強制寫入端先 trim:Sean 給的名單裡 `RaceSeats ` 帶尾隨空白。
  --    只擋「純空白」會讓 'RaceSeats ' 與 'RaceSeats' 並存 = 同一家兩筆、選單無法分辨。
  CONSTRAINT suppliers_label_trimmed CHECK (label = pg_catalog.btrim(label)),

  -- 🔴 PK 是 uuid ⇒ 它完全不防「兩筆都叫 RPM Carbon」。label 唯一才是那道防線。
  CONSTRAINT suppliers_label_unique UNIQUE (label)
);

-- 🔴 COMMENT 只陳述本片**已經成立**的事;尚未存在的東西寫成「設計意圖」而非既成事實
--    (關卡2 抓:原字面宣稱「採購一律從本表選」「選單排序用本欄」,而 FK 與選單都還不存在)。
COMMENT ON TABLE public.suppliers IS
  'M-4b E10 供應商主檔(Sean 2026-08-01 拍板)。**設計意圖**:採購改為從本表選、不手打自由文字'
  '(FK 與選單皆在後續片,本片尚未建立)。停用走 is_active=false;本片不提供任何刪除路徑'
  '(表級無 DELETE/TRUNCATE 權 + 兩支 block trigger),但**表擁有者仍可繞過**,詳見 block 函式上方註解。'
  '改名只改 label;id 是後續 order_item_procurement 的 FK 目標,不得變動。';

COMMENT ON COLUMN public.suppliers.label IS
  '顯示名,唯一。寫入端必須先 btrim(CHECK 強制)。**設計意圖**為選單的顯示與排序來源;'
  '排序(Sean 拍板:字母序)由讀取端負責,本片未建立亦未測試。';

COMMENT ON COLUMN public.suppliers.is_active IS
  '停用旗標。false = 不出現在新單的選擇清單,但既有採購紀錄照常顯示這家。'
  '🔴 本片落地時尚無任何 consumer 讀它(採購表單是後續片)⇒ 現階段它不影響任何行為,這是知情選擇(Sean Q2=A)。';

-- ── 2. updated_at 自動維護 ───────────────────────────────────
-- 沒有 trigger 的 updated_at 會永遠停在建立日 = 一個會說謊的欄位(照抄 staff 的理由)。
CREATE FUNCTION public.pcm_suppliers_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_suppliers_touch_updated_at() FROM PUBLIC;

CREATE TRIGGER suppliers_touch_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_suppliers_touch_updated_at();

-- ── 3. 不可刪除 ──────────────────────────────────────────────
-- 🔴🔴 誠實邊界(2026-08-01 本機 PG17 實測,四條攻擊路徑三條通,不是推論):
--   ① service_role 直接 DELETE      → 被表級 ACL 擋(本片不給 DELETE)
--   ② owner 直接 DELETE             → 被下方 trigger 擋 ✅ 實測擋下
--   ③ owner `ALTER TABLE … DISABLE TRIGGER` 後 DELETE → **擋不住**(實測成功)
--   ④ owner `TRUNCATE`              → BEFORE DELETE 的**列**觸發器對 TRUNCATE 不觸發
--                                      ⇒ 另掛下方的 statement 觸發器才擋得住
--   ⑤ `SET session_replication_role = replica` 後 DELETE → 本機 superuser 下成功;
--      **正式站 postgres 非 superuser、該 GUC 為 superuser context ⇒ 走不通**(已唯讀實查)
--
--   ⑥ 其餘 owner 繞過路徑(未逐一實測,但機制上必然可行,列出以免「四條」被讀成窮舉):
--      `DROP TRIGGER` / `DROP` 或 `CREATE OR REPLACE` 掉 block 函式 / `DROP TABLE`
--
--   ⇒ **「不可刪除」的真實範圍 = 應用程式路徑絕對不可刪;手動操作 DB 的擁有者仍可繞過。**
--      任何 DB 層控制都擋不住表的擁有者 —— 這裡不假裝做得到,只把成本拉高到「必須刻意繞」。
--   ⇒ 對應驗收:`scripts/s1a-verify.sh` §B 有 owner DELETE / owner TRUNCATE / service_role
--      DELETE·INSERT 四條負測,§C 有各自的突變證明;上述繞過路徑**明列為未擋**,不進驗收。
CREATE FUNCTION public.pcm_suppliers_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION '供應商不可刪除 —— 不再往來請改為停用(is_active = false),既有採購紀錄才不會變成孤兒'
    USING ERRCODE = 'P0001';
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_suppliers_block_delete() FROM PUBLIC;

CREATE TRIGGER suppliers_no_delete
  BEFORE DELETE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_suppliers_block_delete();

-- 🔴 TRUNCATE 不觸發列觸發器 ⇒ 必須另掛 statement 級(實測 ④ 就是這樣被穿過去的)
CREATE TRIGGER suppliers_no_truncate
  BEFORE TRUNCATE ON public.suppliers
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.pcm_suppliers_block_delete();

-- ── 4. RLS zero-policy + 表級 ACL ────────────────────────────
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- 先撤 Supabase 對新表的 default-privilege re-grant(含 service_role),再精準補。
REVOKE ALL ON TABLE public.suppliers FROM PUBLIC, anon, authenticated, service_role;

-- 🔴 service_role **只給 SELECT**:寫入一律走 owner RPC(對齊 Sean 07-31 Q1=D)。
--    若這裡給了 INSERT/UPDATE,後續片的 RPC 就不是唯一寫入路徑 ⇒ 同交易稽核不再是強制契約。
GRANT SELECT ON TABLE public.suppliers TO service_role;

-- ── 5. seed(Sean 2026-08-01 給的 26 家,逐字;label 已 btrim)──
-- 🔴 順序不代表優先級;顯示序由讀取端 ORDER BY label 決定(Sean 拍板⑤ 字母序)。
INSERT INTO public.suppliers (label) VALUES
  ('WRS s.r.l'),
  ('Extreme-Components'),
  ('Omnia Racing'),
  ('Webike TW'),
  ('Webike JP'),
  ('Webike EU'),
  ('IMPEX'),
  ('E PLOT'),
  ('WoodCraft'),
  ('阿毅物流'),
  ('安豐達'),
  ('豪元國際'),
  ('老吳精品'),
  ('Gbracing'),
  ('FOWLER'),
  ('RaceBikeBitz'),
  ('PROTI'),
  ('MAPD'),
  ('陳蔚仁'),
  ('RaceSeats'),
  ('MOTOBIKE TH'),
  ('AKOSO'),
  ('RPM Carbon'),
  ('KINEO IN-MOTION'),
  ('S2-Concept'),
  ('VDM PARTS');
-- 🔴 Webike TW / JP / EU 是**三家**(同公司、三個下單管道、不同價格運費前置時間)。
--    任何「名稱相似即合併」的機制都會把它們判成一家 —— 這正是本線放棄機器猜同的實證理由。

-- ── 6. 檔內結構驗收(fail-closed;任一不符則整支 migration 回滾)──
DO $verify$
DECLARE
  v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.suppliers'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'suppliers schema 異常 — 應恰 5 欄,實 % 欄;拒繼續', v_cnt;
  END IF;

  -- 🔴 比對**名稱集合**而非數量:數量對得上不代表是對的那幾條
  --    (施工中實際踩到 —— 第一版斷言寫「應恰 4 個」,而我自己只寫了 2 條 CHECK,
  --     若當時寫成 3 就會靜默通過)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.suppliers'::regclass
     AND contype IN ('c','u','p')
     AND conname NOT IN ('suppliers_label_nonempty', 'suppliers_label_trimmed',
                         'suppliers_label_unique',   'suppliers_pkey');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'suppliers 約束異常 — 出現 % 個非預期約束;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.suppliers'::regclass
     AND conname IN ('suppliers_label_nonempty', 'suppliers_label_trimmed',
                     'suppliers_label_unique',   'suppliers_pkey');
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'suppliers 約束異常 — 四個具名約束應全部存在,實命中 %;拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.suppliers'::regclass AND contype = 'c' AND NOT convalidated;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'suppliers 約束異常 — 未驗證 CHECK 應為 0,實 %;拒繼續', v_cnt;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.suppliers'::regclass) THEN
    RAISE EXCEPTION 'suppliers RLS 異常 — relrowsecurity 應為 true;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_policy WHERE polrelid = 'public.suppliers'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'suppliers RLS 異常 — 應為 zero-policy,實 % 條;拒繼續', v_cnt;
  END IF;

  -- 三支 trigger:touch / no_delete / no_truncate,且全部啟用(tgenabled='O')
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.suppliers'::regclass AND NOT tgisinternal AND tgenabled = 'O';
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'suppliers trigger 異常 — 應恰 3 支啟用,實 %;拒繼續', v_cnt;
  END IF;

  -- service_role 恰只有 SELECT
  IF NOT has_table_privilege('service_role', 'public.suppliers', 'SELECT') THEN
    RAISE EXCEPTION 'suppliers ACL 異常 — service_role 應有 SELECT;拒繼續';
  END IF;
  IF has_table_privilege('service_role', 'public.suppliers', 'INSERT')
     OR has_table_privilege('service_role', 'public.suppliers', 'UPDATE')
     OR has_table_privilege('service_role', 'public.suppliers', 'DELETE')
     OR has_table_privilege('service_role', 'public.suppliers', 'TRUNCATE') THEN
    RAISE EXCEPTION 'suppliers ACL 異常 — service_role 只應有 SELECT(寫入走 owner RPC);拒繼續';
  END IF;

  -- client 三角色零權限
  IF has_table_privilege('anon', 'public.suppliers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.suppliers', 'SELECT') THEN
    RAISE EXCEPTION 'suppliers ACL 異常 — client 角色不應讀得到供應商主檔;拒繼續';
  END IF;

  -- seed 恰 26 列且全部已 trim
  SELECT count(*) INTO v_cnt FROM public.suppliers;
  IF v_cnt <> 26 THEN
    RAISE EXCEPTION 'suppliers seed 異常 — 應恰 26 列,實 %;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.suppliers WHERE label <> pg_catalog.btrim(label);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'suppliers seed 異常 — 有 % 列 label 未 trim;拒繼續', v_cnt;
  END IF;

  RAISE NOTICE 'S1a 結構驗收全數通過(5 欄 / 4 約束 / RLS zero-policy / 3 trigger / ACL 收斂 / seed 26 列)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only,對齊 A2 檔尾慣例)
--
-- DROP 之前必須先確認【全部】下游已回滾,否則會留下「查一張不存在的表」的東西:
--   · order_item_procurement 的 supplier_id FK(形狀改那片)
--   · admin_upsert_supplier owner RPC(RPC 那片)
--   · /settings/suppliers 頁與 server action(UI 那片)
--
-- down migration 必須逐項處理,不是一句 DROP TABLE:
--   ① DROP TRIGGER ×3 ② DROP FUNCTION pcm_suppliers_touch_updated_at / pcm_suppliers_block_delete
--      (DROP TABLE 只帶走 trigger、**不帶走獨立函式**)
--   ③ DROP TABLE public.suppliers
--   ④ 重 gen database.types.ts
-- 🔴 **本表一旦上線,員工新增的供應商就是真實業務資料** —— 即使採購表 0 列,
--    DROP TABLE 仍會刪掉員工建立的主檔。
--    down 之前必須**全欄匯出**(`id, label, is_active, created_at, updated_at`),不能只存 label:
--    後續片一旦有 `order_item_procurement.supplier_id` 指過來,**只有原 uuid 能重建那層關聯**;
--    `is_active` 與兩個時間欄也無從還原。(關卡2 抓:原字面只寫「匯出 label 清單」。)
-- ============================================================
