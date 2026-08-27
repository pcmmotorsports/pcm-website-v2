-- ============================================================
-- M-4a M0-S2:統一稽核 log — admin_audit_log(append-only、client 全鎖、只 server 寫)
-- ============================================================
-- 真權威:docs/specs/2026-07-12-m4a-admin-phase1-prd.md §6「統一地基」第 2 條(統一稽核 log)
--          + §6.1(最小具名身分 actor)+ §6.7(correlation/request id 貫穿)。
-- 鐵則 8(schema:新表 + RLS + GRANT/REVOKE)+ 鐵則 12(後台稽核軌 + 經銷價零外洩:before/after 快照可含成本價)。
-- L3(營運稽核資料)→ 本 PRD 即動工前置文件(鐵則 9 滿足)。
--
-- 依賴:無(獨立新表;不引用 orders/customers 欄位,故不依賴同批 pending 的 orders 加欄 migration 20260712203000)。
--       角色沿用 Supabase 既定:anon / authenticated / service_role(admin server 以 sb_secret_ 金鑰 = service_role 連線)。
--
-- 🔴 設計(PRD §6.2;與 M-3 anomaly events 表〔20260624120003〕同族但寫入模型不同,見下):
--   ① 欄位 1:1 對應 PRD §6.2 列舉:actor / action / target / before / after / reason / request_id / source_app / at。
--   ② **append-only + client 全鎖 + 只 server 寫**的落地方式(本表與 anomaly events 的分界):
--      · anomaly events = REVOKE 含 service_role、寫入唯 owner SECDEF RPC(payment_confirmer 族、金流不可竄改層級)。
--      · admin_audit_log = **admin server 直接以 service_role(sb_secret_ 金鑰)INSERT**(PRD §3.2「寫入集中在少數 repository」,
--        admin 無 owner-RPC 基建)→ 故 service_role **必須**有 INSERT grant;append-only 由「只給 INSERT、
--        不給 UPDATE/DELETE」在 ACL 層強制(service_role 有 BYPASSRLS 但 BYPASSRLS 只繞 policy、不繞 table 權限檢查)。
--      · 🔴 **repository 寫入合約(REQUIRED-2,S2 code 驗收條件)**:service_role 無 SELECT →
--        INSERT 必須 return=minimal(supabase-js `.insert(row)` **禁鏈 `.select()`**;id / created_at 不回讀),
--        否則 RETURNING 需 SELECT 權限 → runtime 42501、炸在稽核寫入路徑(可能連帶弄掛主操作)。
--      · SELECT **本 slice 不開**(最小權限;稽核檢視器 viewer slice 再顯式 GRANT SELECT TO service_role)。
--      · anon / authenticated / PUBLIC = 零權限(client 全鎖)+ RLS zero-policy(縱深:即使誤 grant 也無 policy 可讀)。
--      · 🔴 owner / postgres(Sean SQL Editor)物理上仍可改 / 刪本表 → append-only 為**角色層**強制、
--        非 DB 對 DBA 強制不可竄改(與 20260624120003 頭註 line 24 家族界線一致;威脅模型=防角色竄改)。
--   ③ 🔴 經銷價/成本零外洩(鐵則 12):before/after jsonb 為稽核快照,**可合法含經銷價 / 成本 / PII**(這正是稽核軌的用途);
--      安全來自「本表對所有 client 角色零權限、只 service_role 能 INSERT、無人能 SELECT」→ 不外洩到瀏覽器。
--      **絕不對 anon/authenticated 開任何 SELECT/policy**;未來 viewer 只走 admin server(service_role)、不下放前台。
--      (Fable 窮舉:PostgREST / pg_graphql / realtime〔新表不在 publication + zero-policy 雙保險〕/ logical replication 皆零 grant 拿不到。)
--   ④ created_at = DB 權威時間(DEFAULT now());server 寫入不回填(避免竄改事件時間)。時區 = timestamptz(UTC),
--      後台顯示邊界 Asia/Taipei(PRD §6.5)在 app 層轉。
--      🔴 欄名 created_at 對齊家族(20260624120003:109 同語意欄叫 created_at;全 repo 時間欄皆 *_at);PRD §6.2 速記「at」= 語意非釘死命名。
--
-- ⚠️ 守線(字面 vs 事實):本檔為**草稿**。
--   · 動手前真 DB 交易模擬(BEGIN→套→DO 斷言→ROLLBACK→零留痕)= **⏳ PENDING**(待 Fable 對抗審 + Sean 批後執行)。
--   · **尚未執行、尚未 db push、尚未 apply**;加入統一批次 db push 佇列(現有 4 支 → 5 支),由 Sean 手動一次推。
--   · 不預先宣稱模擬 PASS。
-- ============================================================

BEGIN;

-- ── 1. admin_audit_log 主表(欄位 1:1 對應 PRD §6.2)──────────────────────────
CREATE TABLE public.admin_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       text        NOT NULL,                        -- 具名 staff 身分(session 選人;M-4b 完整帳號前 hardcode 名單)
  action      text        NOT NULL,                        -- 動作代碼(repository 白名單;例 customer.tier.change / order.cancel)
  target      text,                                        -- 被操作對象(例 'order:<uuid>' / 'customer:<uuid>';全域動作可 NULL)
  before      jsonb,                                       -- 變更前狀態快照(可 NULL;可含敏感內部狀態 → 全表零 client 權限保護)
  after       jsonb,                                       -- 變更後狀態快照(可 NULL)
  reason      text,                                        -- 內部原因(取消/tier 變更內部原因寫這;對客文案另走 orders.cancelled_reason)
  request_id  text        NOT NULL,                        -- correlation id(貫穿 admin 寫入→audit→DB→外部服務 log,PRD §6.7)
  source_app  text        NOT NULL DEFAULT 'admin',        -- 來源 app(admin / quote;SSO 後兩邊皆可寫)
  created_at  timestamptz NOT NULL DEFAULT now(),          -- 事件時間(DB 權威、server 不回填以防竄改;欄名對齊家族 *_at)

  CONSTRAINT admin_audit_log_actor_nonempty      CHECK (actor      <> ''),
  CONSTRAINT admin_audit_log_action_nonempty     CHECK (action     <> ''),
  CONSTRAINT admin_audit_log_request_id_nonempty CHECK (request_id <> ''),
  CONSTRAINT admin_audit_log_source_app_check    CHECK (source_app IN ('admin', 'quote'))
);

COMMENT ON TABLE public.admin_audit_log IS
  'M-4a M0-S2 統一稽核 log(PRD §6.2)。後台所有寫入(tier 變更 / 取消 / 手動建單 / 排序…)同交易或緊接寫一筆。append-only:service_role 僅 INSERT、無 UPDATE/DELETE;client(anon/authenticated)零權限 + RLS zero-policy。before/after 可含經銷價/成本/PII(稽核用途)→ 安全靠全表零 client 權限,絕不對前台開 SELECT/policy。actor=具名 staff(M-4b 前 hardcode);request_id=correlation id;created_at=DB 權威時間。';
COMMENT ON COLUMN public.admin_audit_log.request_id IS
  'correlation id(PRD §6.7):同一 admin 請求貫穿 middleware→handler→audit→DB→外部服務 log,供跨層追蹤。';
COMMENT ON COLUMN public.admin_audit_log.target IS
  '被操作對象識別字;格式約定 ''<entity>:<uuid>''(例 ''order:<uuid>'' / ''customer:<uuid>''),生成集中在 §6.4 repository 白名單層;全域動作可 NULL。';
COMMENT ON COLUMN public.admin_audit_log.source_app IS
  '事件發起來源;寫入者恆為 admin server(service_role)。quote=從報價單入口(SSO)發起的 admin 事件;quote 側 server 連報價單庫、不持本庫金鑰(兩庫分離)、不直寫本表。系統自動化 / cron 事件不寫本表(各有自己的表)。';

-- ── 2. 索引(稽核檢視器主要查詢路徑;低寫入表、索引成本可忽略)──────────────────
-- 2a. 最近優先列表(預設檢視):ORDER BY created_at DESC。
CREATE INDEX admin_audit_log_created_at_idx ON public.admin_audit_log (created_at DESC);
-- 2b. 依 staff 查稽核軌(「某人做了什麼」)。
CREATE INDEX admin_audit_log_actor_created_at_idx ON public.admin_audit_log (actor, created_at DESC);
-- 2c. 依對象查(「這張單/這個客人被誰改過」);partial:只索引有 target 的列。
CREATE INDEX admin_audit_log_target_idx ON public.admin_audit_log (target) WHERE target IS NOT NULL;
-- 2d. 依 correlation id 追蹤(跨層 debug:一個 request 的所有稽核筆)。
CREATE INDEX admin_audit_log_request_id_idx ON public.admin_audit_log (request_id);

-- ── 3. RLS zero-policy + table ACL(client 全鎖、只 server 寫、append-only)──────
-- RLS enable + 零 policy:anon/authenticated 即使誤 grant 也無 policy 可讀(縱深)。
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- 先撤 Supabase 對新表的 default-privilege re-grant(含 service_role),再精準只補 service_role INSERT。
REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated, service_role;

-- admin server 以 sb_secret_ 金鑰(= service_role)直接 append;只 INSERT → append-only(無 UPDATE/DELETE)。
-- 🔴 不給 SELECT(最小權限;稽核 viewer slice 才顯式 GRANT SELECT TO service_role)。
GRANT INSERT ON TABLE public.admin_audit_log TO service_role;

-- ── 4. fail-closed 斷言:表層 ACL 終態(append-only + client 全鎖)──────────────
-- anon/authenticated/PUBLIC 7 權限全零;service_role 僅 INSERT(其餘 6 權限零)。
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_cnt  integer;
BEGIN
  -- 4a. client 角色(anon/authenticated)7 權限全零。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.admin_audit_log', v_priv) THEN
        RAISE EXCEPTION 'admin_audit_log ACL 異常 — client 角色 % 不應有 % 權限(client 須全鎖);拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 4b. service_role 只 INSERT:必須有 INSERT。
  IF NOT has_table_privilege('service_role', 'public.admin_audit_log', 'INSERT') THEN
    RAISE EXCEPTION 'admin_audit_log ACL 異常 — service_role 應有 INSERT(server append 路徑);拒繼續';
  END IF;
  -- 4c. service_role 其餘 6 權限全零(坐實 append-only:無 UPDATE/DELETE;最小權限:無 SELECT)。
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('service_role', 'public.admin_audit_log', v_priv) THEN
      RAISE EXCEPTION 'admin_audit_log ACL 異常 — service_role 不應有 %(只准 INSERT = append-only + 最小權限);拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 4d. role_table_grants 顯式 grant:anon/authenticated/PUBLIC 零;service_role 僅 1 筆 INSERT。
  SELECT count(*) INTO v_cnt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'admin_audit_log role_table_grants 異常 — anon/authenticated/PUBLIC 應零顯式 grant(實 % 筆);拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
     AND grantee = 'service_role';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'admin_audit_log role_table_grants 異常 — service_role 應恰 1 筆(INSERT),實 % 筆;拒繼續', v_cnt;
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP TABLE IF EXISTS public.admin_audit_log;   -- 連帶 4 索引 / 4 CHECK / grant 一併消失
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(Fable verdict line 93-99 代判**可直接跑**:本支 CREATE 新表、txn 內鎖自己剛建的表、
--   零既有物件接觸、零流量影響、可逆 + 零留痕;若模擬中發現要碰既有物件的意外〔publication / role 屬性〕
--   立即停回信箱。於 project bmpnplmnldofgaohnaok BEGIN → 套本 migration → 斷言 → ROLLBACK → 零留痕再查):
-- ============================================================
-- 1. 表存在、10 欄型別/NOT NULL 正確(information_schema.columns)。
-- 2. 4 CHECK 存在且生效:actor=''/action=''/request_id='' 各被擋(check_violation);source_app='xxx' 被擋。
-- 3. RLS enabled(pg_class.relrowsecurity)、零 policy(pg_policies count = 0)。
-- 4. 表層 ACL 終態(§4 DO 已在 migration 內斷言;模擬時再獨立查一次):
--    · has_table_privilege anon/authenticated × 7 權限全 false。
--    · service_role:INSERT=true、其餘 6=false。
-- 5. 合法 INSERT(actor/action/request_id 非空、source_app='admin')落地、created_at 自動 now()、id 自動 uuid。
-- 6. 4 索引存在(pg_indexes)。
-- 7. append-only 實證(nit-6:txn 內用 **SET LOCAL ROLE service_role**、非 SET ROLE〔pooled MCP SET ROLE 斷線前科、
--    memory reference_pooled-mcp-set-role-secdef-terminates〕;UPDATE / DELETE 預期 42501 各用
--    DO ... EXCEPTION WHEN insufficient_privilege 捕、免 abort 主模擬 txn;RESET ROLE 收尾):
--    SET LOCAL ROLE 後 UPDATE / DELETE admin_audit_log → 皆 insufficient_privilege。
-- 8. 無 trigger:SELECT count(*) FROM pg_trigger WHERE tgrelid='public.admin_audit_log'::regclass AND NOT tgisinternal → 0。
-- 9. ROLLBACK 後零留痕:表 / 索引 / grant 全消失(information_schema 再查為 0)。
-- 10.(nit-5 realtime 縱深)SELECT count(*) FROM pg_publication_tables WHERE tablename='admin_audit_log' → 0
--     (新表預設不在 supabase_realtime publication → 零廣播)。
--
-- 明知不做(nit-7,防未來重提):
--   · id 用 uuid(非 bigint identity)= 正確:identity 還要 GRANT USAGE ON SEQUENCE,uuid 避開整個 sequence 權限面。
--   · 列級 GRANT INSERT 排除 created_at(把「server 不回填時間」升為 DB 強制)= 不做:斷言全要改列級、複雜度不值;
--     威脅=repository 手癖,§6.4 白名單 + REQUIRED-2 return=minimal 合約已是執行點。
