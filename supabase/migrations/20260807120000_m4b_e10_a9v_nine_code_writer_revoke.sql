-- ============================================================
-- M-4b E10 · A9v:九碼 writer 停寫(**九碼退場線收線片**)
-- ============================================================
-- 片級 plan:docs/specs/2026-08-07-e10-a9v-nine-code-writer-revoke-plan.md
-- 真權威 = 母 plan docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:454(row 62)逐字:
--   「REVOKE `admin_update_order_item_workflow`(item 支)+ R18 補:撤 `order_status_options` 的
--    service_role INSERT/UPDATE 寫權 + ACL 終態斷言(否則 P3 停寫不真 —— UI 下架了、寫權還在)
--    —— `admin_update_order_workflow` **保留** …… `order_items.workflow_status` 欄凍結不 DROP。」
--
-- 🔴 **REVOKE,不是 DROP**:函式與表都留著,只是叫不動 / 寫不進。可逆、留回滾餘地。
--    (派工單 `E-134-A` 寫「DROP 該 RPC 與 order_status_options 讀取函式族」與真權威不符,
--     且「讀取函式族」查無此物 —— 它是一張表、直接讀,全 migration 樹零專屬讀取函式。
--     派工單自己註明「實查為準」⇒ 照真權威 + 實查做,差異在此標明、不靜默改口。)
--
-- ── 前置(全部實查,不是讀 migration 猜的)────────────────────
--   · app 層:`admin_update_order_item_workflow` 與 `order_status_options` 在 apps/ + packages/
--     的命中**全部是註解**,零實際呼叫(A9w1-4c + A11a/b/c 重建後)。
--   · DB 內部:唯一在 prosrc 命中的是 `admin_update_order_workflow`,但那是**註解**
--     (「狀態唯一寫入面=admin_update_order_item_workflow」)、**不是呼叫**
--     ⇒ 撤權不會打壞合法改單(運送方式與發票四欄照常)。
--   · A10c2(母 plan :450 row 58)= 「依供應商單號搜尋畫面(**消費 A9b2**)」⇒ 零九碼消費端。
--
-- ── 🔴 兩個實查發現(照字面寫會出錯)────────────────────────
--   ① **「UPDATE 寫權」是欄級的,不是表級的。** 表級 ACL 只有 INSERT + SELECT;真正的策展寫權
--      是 `label` / `color` / `text_color` / `sort_order` / `is_active` **五個欄位各自的 UPDATE**。
--      只看表級會以為「沒有 UPDATE 可撤」。
--   ② **表級 `REVOKE UPDATE` 會連帶清掉欄級授權 —— 實測、非假設。**
--      拋棄式叢集交易模擬:欄級 ACL 5 欄 → 表級 REVOKE UPDATE 後 0 欄、
--      `has_column_privilege(service_role, …, 'label', 'UPDATE')` = f;ROLLBACK 後回到 5 欄。
--      ⇒ 一句表級 REVOKE 就夠,不補欄級 REVOKE(冗餘)。
--      🔴 **但終態斷言必須檢查欄級** —— 那才是「日後有人在欄級重新授權」的觀察面,表級斷言對它全盲。
--
-- 🔴 誠實邊界 ①:apply 會讓一批「…權仍在,撤權歸 A9v」的註解變假。**本片同批改掉 app 層那八處**
--    (純註解、被守門的 stripLineComments 剝掉 ⇒ 行為與測試零影響):
--      apps/admin/src/lib/orders/{workflow-form,order-actions,order-repository}.ts
--      packages/adapters/src/{index.ts, supabase/SupabaseOrderAdapter.ts}
--      packages/ports/src/{IOrderRepository,index}.ts / packages/domain/src/order/types.ts
--    🔴 改法刻意寫成 **apply 前後都成立**的說法(「由 A9v 撤除、apply 後生效」),不寫過去式 ——
--    本 migration 尚未 apply,寫過去式現在就是假的。
--    (階段 C 抓到我原本只列一處;**第八處是我修完再 grep 一次自己抓到的**,審查者也漏了。)
-- 🔴 誠實邊界 ②:`admin_update_order_workflow` **函式體內**那句「狀態唯一寫入面=…」改不了 ——
--    它在已 apply 的 migration 的 prosrc 裡,改它要 CREATE OR REPLACE 整支函式 = 擴張範圍。
--    ⇒ 本片不改,掛進 apply 後的清理清單。
--
-- 🔴 本片零 DROP、零表結構改動、零資料寫入。`order_items.workflow_status` 欄**凍結不 DROP**(有斷言)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 撤 item 支九碼 writer 的 EXECUTE ──────────────────────
-- 🔴 兩句都要:第二句撤 service_role 是本片的目的;第一句是 **Supabase default-grant 家族坑** ——
--    函式的 `proacl` **一旦變成 NULL 就等於 EXECUTE TO PUBLIC**。顯式寫死 PUBLIC/anon/authenticated,
--    照 S1b 慣例(memory `reference_supabase-service-role-execute-default-grant` 同族)。
REVOKE ALL ON FUNCTION public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_order_item_workflow(uuid, integer, jsonb, text, text)
  FROM service_role;

-- ── 2. 撤 order_status_options 的寫權(SELECT 保留)──────────
-- 🔴 `UPDATE` 那個字連帶清掉五個欄級授權(見檔頭實測)。`SELECT` **刻意保留** ——
--    真權威只說撤「寫權」;留著讓策展資料仍可讀(debug / 日後後台 CRUD 的來源)。
REVOKE ALL ON TABLE public.order_status_options FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON TABLE public.order_status_options FROM service_role;

-- ── 3. 檔內 fail-closed 驗收(任一不符則整支 migration 回滾)──
DO $verify$
DECLARE
  v_fn  oid := 'public.admin_update_order_item_workflow(uuid,integer,jsonb,text,text)'::regprocedure;
  v_keep oid := 'public.admin_update_order_workflow(uuid,integer,jsonb,text,text)'::regprocedure;
  v_txt text;
  v_cnt integer;
BEGIN
  -- 3a. 🔴 proacl 非 NULL —— NULL = EXECUTE TO PUBLIC 預設,3b 的 aclexplode 會攤出零列而假綠。
  --     ⚠️ 誠實界(階段 C N4):**本檔內這條恆真** —— 上面兩句 REVOKE 會把預設 ACL 具現化
  --     ⇒ 構造不出突變。留著是為日後「DROP + CREATE 重播」那條路徑的保險,不是有判別力的守門。
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'A9v 異常 — 九碼 writer 的 proacl 為 NULL(= EXECUTE TO PUBLIC 預設,撤權反而變全開);拒繼續';
  END IF;

  -- 3b. 非 owner 授權恰「無」(攤平含 is_grantable:WITH GRANT OPTION 攤平後字串與普通 EXECUTE 相同)
  SELECT coalesce(pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_proc pr
            CROSS JOIN LATERAL pg_catalog.aclexplode(pr.proacl) a
           WHERE pr.oid = v_fn AND a.grantee <> pr.proowner) x;
  IF v_txt <> '<無>' THEN
    RAISE EXCEPTION 'A9v 異常 — 九碼 writer 應零非 owner 授權,實 [%];拒繼續', v_txt;
  END IF;

  -- 3c. 有效權限(role 繼承在 proacl 裡看不見 ⇒ 3b 可能綠而實際叫得動)
  IF pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'A9v 異常 — 九碼 writer 仍有有效 EXECUTE(直接授權或 role 繼承);停寫不真;拒繼續';
  END IF;

  -- 3d. 🔴 誤殺防護:`admin_update_order_workflow` 必須**仍然**叫得動。
  --     它已在 D-2 收窄(送 workflow_status key = RAISE),現管運送方式與發票四欄;
  --     撤了會讓合法改單失效 —— 母 plan row 62 明文「保留」。
  IF NOT pg_catalog.has_function_privilege('service_role', v_keep, 'EXECUTE') THEN
    RAISE EXCEPTION 'A9v 異常 — 誤殺:admin_update_order_workflow 的 service_role EXECUTE 不見了(合法改單會死);拒繼續';
  END IF;

  -- 3e. order_status_options 表級 ACL 終態 = 恰 service_role:SELECT
  SELECT coalesce(pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
           WHERE c.oid = 'public.order_status_options'::regclass AND a.grantee <> c.relowner) x;
  IF v_txt <> 'service_role:SELECT:false' THEN
    RAISE EXCEPTION 'A9v 異常 — order_status_options 非 owner 授權應恰為 service_role:SELECT:false,實 [%];拒繼續', v_txt;
  END IF;

  -- 3f. 🔴🔴 欄級 ACL 必須歸零 —— **這條是本片的核心觀察面**。
  --     策展寫權本來就是欄級的(五欄各自 UPDATE),表級斷言(3e)對它**完全看不見**;
  --     日後有人在欄級重新授權,只有這條會紅。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_status_options'::regclass
     AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A9v 異常 — order_status_options 仍有 % 個欄位帶欄級 ACL(表級收斂擋不住欄級後門);拒繼續', v_cnt;
  END IF;

  -- 3f-2. 有效權限層再驗一次(繼承面)。⚠️ **抽驗 `label` 與 `is_active` 兩欄、不是逐欄**
  --       (關卡2 codex nit 3:原註解寫「逐欄問」是過度宣稱)。五欄的直接授權由 3f 的
  --       `attacl IS NOT NULL` 計數整組擋住,這裡補的是**繼承面**、抽兩顆即可。
  IF pg_catalog.has_column_privilege('service_role', 'public.order_status_options'::regclass, 'label', 'UPDATE')
     OR pg_catalog.has_column_privilege('service_role', 'public.order_status_options'::regclass, 'is_active', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.order_status_options'::regclass, 'INSERT') THEN
    RAISE EXCEPTION 'A9v 異常 — service_role 對 order_status_options 仍有有效寫權;停寫不真;拒繼續';
  END IF;
  -- SELECT 是刻意保留的,反面斷言它還在(免得日後有人「順手清乾淨」)
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_status_options'::regclass, 'SELECT') THEN
    RAISE EXCEPTION 'A9v 異常 — order_status_options 的 SELECT 被一併撤掉了(真權威只要求撤寫權);拒繼續';
  END IF;

  -- 3f-3. 🔴 **「停寫為真」的另一半**(階段 C N5):本片撤的是 RPC 與詞彙表的權,但「九碼寫不進去」
  --        還押在另一條不變量 —— service_role 對 `order_items` **無直寫權**
  --        (`20260716120000:100-107` 當時 apply 過一次,此後全樹無翻案 GRANT)。
  --        那條從沒被複驗過 ⇒ 順手釘住,讓本片的收束宣稱自足。
  IF pg_catalog.has_table_privilege('service_role', 'public.order_items'::regclass, 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.order_items'::regclass, 'INSERT') THEN
    RAISE EXCEPTION 'A9v 異常 — service_role 對 order_items 有直寫權(繞過 RPC 就能寫九碼,停寫不真);拒繼續';
  END IF;

  -- 3g. 🔴 `order_items.workflow_status` 欄**凍結不 DROP**(母 plan row 62 字面)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_items'::regclass
     AND attname = 'workflow_status' AND NOT attisdropped;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A9v 異常 — order_items.workflow_status 欄不見了(母 plan 要求凍結不 DROP);拒繼續';
  END IF;

  RAISE NOTICE 'A9v 結構驗收全數通過(九碼 writer proacl 非 NULL + 零非 owner 授權 + 三 role 零有效 EXECUTE / admin_update_order_workflow 誤殺防護 / order_status_options 表級恰 SELECT + 欄級 ACL 歸零 + 有效寫權零 + SELECT 保留 / workflow_status 欄凍結)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾(另立版本號更大的 down migration;Supabase forward-only):
--
--   GRANT EXECUTE ON FUNCTION public.admin_update_order_item_workflow(
--     uuid, integer, jsonb, text, text) TO service_role;
--   GRANT INSERT ON TABLE public.order_status_options TO service_role;
--   GRANT UPDATE (label, color, text_color, sort_order, is_active)
--     ON TABLE public.order_status_options TO service_role;
--
--   🔴 **UPDATE 那句必須用欄級語法** —— 原始授權就是欄級的(建表檔 20260714120000),
--      寫成表級 `GRANT UPDATE ON TABLE` 會**多給**(全欄可寫),不是還原。
--   🔴 本片零 DROP、零表結構改動、零資料寫入 ⇒ down 乾淨、無資料面代價。
--
-- 🔴 「九碼退場線」到此收束:A9w1 → A9w2 → A9w4a/4c(app 層拆除)→ A11a/b/c(列表重建)
--    → **A9v(DB 端停寫)**。🔴 **精確講(階段 C N6:別把守門叫得比它實際擋得住的大)**:
--      · **寫入面**已在 DB 端撤除 —— service_role 叫不動 item RPC、詞彙表無寫權、order_items 無直寫權(3f-3)。
--      · **讀取面**是「應用層零引用」,由**字面守門**承重 —— 而它自己承認拼接字串繞得過;
--        且 DB 端 `order_status_options` 的 SELECT **刻意保留**。⇒ **不宣稱「讀不可達」**。
--    `order_items.workflow_status` 欄與歷史資料保留、不 DROP。
-- ============================================================
