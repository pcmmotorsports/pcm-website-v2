-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback:20260905160000_m4b_pcm_readonly_role_and_grants_into_version_control
-- ═══════════════════════════════════════════════════════════════════════════
-- 🛑🛑 **這一支【不能整段跑】, 而且它會主動阻止你這樣做**(下面 §0 是可執行的攔截器)。
--
-- 🔴 為什麼:本片對正式庫**每一格都是 no-op** —— 它給的東西**別人已經給過了**:
--    · `search_queries` / `order_pending_refunds` 的 SELECT  ⇒ **由貼板 33 授權**
--      (Sean 2026-09-05 逐字拍「Q-唯讀兩表 … 甲 = 能(貼 33)」)
--    · `admin_order_list_v` 的 SELECT · schema public 的 USAGE ⇒ **本片之前就在**(實測直接 ACL 條目)
--    · `cron` 那三格 ⇒ **不在本片裡**(已搬到 `supabase/after-checks/grant-readonly-cron.sql`)
--    ⇒ 📌 **所以「還原本片」在正式庫上正確的動作是【什麼都不做】。**
--    ⇒ 🔴🔴 **照字面把下面的 REVOKE 放行, 撤掉的是 Sean 拍板的授權, 不是本片給的東西。**
--       (2026-09-05 codex 對抗審查 must-fix:舊版本檔把那兩條標成「本片真的給出去的」——**那是錯的**。)
--
-- ✅ **真的要還原, 唯一成立的世界是「一個從零重播出來的拋棄式庫」** ——
--    那裡本片確實是那些授權的來源。而那種庫的正確還原動作是**把整個叢集丟掉**, 不是逐條 REVOKE。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §0 攔截器(可執行;自動化直接跑本檔會停在這裡)────────────────────────
--   🔴 codex must-fix:舊版本檔的 REVOKE 全是註解, 而底下的 SELECT 會成功 ⇒ **psql rc=0**
--      ⇒ 任何「跑完 rollback 檔就算回滾成功」的自動化, 會把【零還原】記成【已還原】。
--      ⇒ 所以本檔現在**一定**以非零結束, 除非人明確把 §0 註解掉。
DO $$
BEGIN
  RAISE EXCEPTION '20260905160000 的 rollback 【不可自動執行】。本片在正式庫上每一格都是 no-op ⇒ 正確的還原動作是【什麼都不做】。真的要動 ⇒ 讀完本檔 §R 每一行的理由, 手動把 §0 與你要放行的那幾行註解狀態改掉。';
END $$;

-- ── §R 還原(全部註解;逐行判斷後才取消註解)──────────────────────────────
-- 🔴🔴 **這兩行撤的是【貼板 33 給的】, 不是本片給的 —— 撤它等於撤掉 Sean 的拍板:**
-- REVOKE SELECT ON TABLE public.search_queries        FROM pcm_readonly;
-- REVOKE SELECT ON TABLE public.order_pending_refunds FROM pcm_readonly;
--
-- 🛑 這兩行撤的是【本片之前就存在】的授權(2026-09-05 實測皆為 t):
-- REVOKE SELECT ON TABLE public.admin_order_list_v FROM pcm_readonly;
-- REVOKE USAGE  ON SCHEMA public                   FROM pcm_readonly;
--
-- ⚠️ `cron` 那三格**不是本片給的**(已搬走)⇒ 本檔逐字**不提供**那幾行, 免得有人順手撤掉。
--    要動它們 ⇒ `supabase/after-checks/grant-readonly-cron.sql` 檔頭的 Rollback 那一段。
--
-- 🔴🔴 **角色本身一律不刪。** `DROP ROLE pcm_readonly` 在正式庫上會炸(它被授權於別的物件),
--    而在重播的空庫上刪掉它會讓 20260905230000 回到本片修好之前的那個紅。
--    ⇒ 逐字**不提供**那一行。

-- ── §V 量現況(唯讀, 零副作用;角色或物件不存在也不會 throw)──────────────
--   🔴 codex must-fix:`has_*_privilege` 對**不存在的角色或物件會 throw**
--      ⇒ 舊版本檔宣稱「§V 可跑」在最需要它的那個世界(角色沒建出來)**正好跑不動**。
--      ⇒ 現在每一格都先過 `to_regrole` / `to_regclass`, 缺件回 NULL 而不是炸。
SELECT
  to_regrole('pcm_readonly') IS NOT NULL AS 角色在,
  CASE WHEN to_regrole('pcm_readonly') IS NULL THEN NULL
       ELSE pg_catalog.has_schema_privilege('pcm_readonly','public','USAGE') END AS public_usage,
  CASE WHEN to_regrole('pcm_readonly') IS NULL OR to_regclass('public.admin_order_list_v') IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege('pcm_readonly','public.admin_order_list_v','SELECT') END AS view_select,
  CASE WHEN to_regrole('pcm_readonly') IS NULL OR to_regclass('public.search_queries') IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege('pcm_readonly','public.search_queries','SELECT') END AS search_queries,
  CASE WHEN to_regrole('pcm_readonly') IS NULL OR to_regclass('public.order_pending_refunds') IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege('pcm_readonly','public.order_pending_refunds','SELECT') END AS pending_refunds,
  CASE WHEN to_regrole('pcm_readonly') IS NULL OR to_regclass('public.admin_order_list_v') IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege('pcm_readonly','public.admin_order_list_v','INSERT') END AS 負對照_寫入必f,
  CASE WHEN to_regrole('pcm_readonly') IS NULL OR to_regclass('public.orders') IS NULL THEN NULL
       ELSE pg_catalog.has_table_privilege('pcm_readonly','public.orders','SELECT') END AS 正對照_orders必t;
-- ⚠️ 讀法:某一格是 NULL ⇒ 那是【問不到】(角色或物件不存在), **不是 false**。
--    兩者在一個只看「是不是 t」的眼睛裡長得一樣, 而它們是兩件事。
