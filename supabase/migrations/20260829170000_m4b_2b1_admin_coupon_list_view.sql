-- M-4b 優惠券 片2b-1:後台券列表 view(`admin_coupon_list_v`)
--
-- 🛑 **本檔【不由任何窗 apply】** —— apply 是 Sean 的手。
-- 上游:`docs/specs/2026-08-26-coupon-admin-crud-spec.md` §3-1 · 片1 `20260829150000`(**未 apply**)
-- 形狀來源:`20260816030000_m4b_admin_customer_list_view.sql`(285 行)—— 逐條對齊,**一處刻意偏離見 §2**。
-- 鐵則:12③(新 DB 物件)。⚠️ 本片【零寫入路徑】、不含任何畫面。
--
-- ══ 1. 為什麼是 view 不是 RPC(而我一開始說錯了)══════════════════════════════
--
-- 🔴 `admin_search_customers` 這個名字**聽起來就是列表**,而它 `RETURNS jsonb`、
--    回的是 `{ids, truncated}` —— 它是【關鍵字搜尋】那一軸,不是列表。
--    列表走的是 `SupabaseCustomerAdapter.ts:305` 的
--    `.from('admin_customer_list_v').select(…, {count:'exact'})`。
-- 📌 **我從一個呼叫點的名字推出了整個架構, 而沒有開那支檔** ⇒ 名字比它的內容寬。
-- ✅ 而券的 spec §3-1 **沒有關鍵字搜尋**(只有篩選與排序)⇒ **本片不需要那支 RPC。**

BEGIN;

-- ══ 2. 🔴🔴 刻意偏離鄰居一格:**本 view 不加 `security_invoker`** ═══════════════
--
-- 鄰居 `admin_customer_list_v:72-73` 是 `WITH (security_invoker = true)`,而它逐字寫著理由:
--   > 「沒有任何需要繞過底表 RLS 的理由,以呼叫者身分套底表 RLS」
--
-- 🔴 **那句話在它那裡是對的, 而在這裡【前提不成立】** ——
--    它成立是因為 `customers` 那張底表 `service_role` 讀得到
--    (`20260523034911:230` 對 `authenticated` 有 GRANT;service_role 走平台既有授權)。
--    而券的兩張底表在片1 被**刻意 REVOKE 到零權限**:
--      `REVOKE ALL ON TABLE public.coupons FROM PUBLIC, anon, authenticated, service_role`
--    且片1 還寫了 fail-closed 斷言去釘住它。
--
-- ⇒ **照抄 `security_invoker = true` 的後果 —— 而這一格我【推錯過一次, 實測才知道】**:
--   🔴 我原本寫「service_role 讀底表沒有權限 ⇒ view 回【零列】⇒ 畫面顯示『尚未建立優惠券』
--      ⇒ 與正常空狀態一模一樣」,而**那是推的, 不是量的**。
--   ✅ **拋棄式 PG 17.0010 實測(兩個世界)**:
--        世界甲(本片, 預設 owner 權限)⇒ `SAVE10 | 已用=1 | 建立者=線G 驗收`
--        世界乙(照抄鄰居 `security_invoker=true`)⇒ **`ERROR: permission denied for table coupons`**
--   ⇒ **它是【當場報錯】, 不是靜默回零列。**
--   📌 **⇒ 所以這個偏離的理由要改寫**:不是「會偽裝成空狀態」, 而是
--      **「照抄會讓這一頁【整頁打不開】」** —— 那是壞得很大聲的一種, 比我原本說的好。
--   ⚠️ **而偏離仍然要做** —— 一個會報錯的頁面與一個能用的頁面, 差別不會因為它報得大聲就消失。
--   🔴 **而我把這一段留在這裡而不是刪掉, 是因為【下一個人也會這樣推】** ——
--      「沒權限 ⇒ 回空」聽起來完全合理, 而 PostgreSQL 在 view 這一層選的是報錯。
--
-- ✅ **⇒ 所以本 view 用預設(= owner 的權限)**,與片1「讀寫唯一路走 owner 權限的物件」同一個設計。
-- 🛑 **⇒ 下一個人想把它「修正」成 `security_invoker = true` 之前, 先讀上面那段。**
--    (主視窗 2026-08-29 裁【甲】;乙 = 保留 invoker 而 GRANT 底表給 service_role
--     ⇒ 那會把片1 刻意做的零表權限拆掉, 而片1 的斷言會當場紅。)
--
-- ══ 3. 寫法契約(逐條抄鄰居)═══════════════════════════════════════════════════
--   · 欄位**逐顆列出**,刻意不用 `c.*` —— `c.*` 是「建 view 當下凍結」的隱藏陷阱,
--     而逐顆列出讓「加欄要同批重建本 view」變成一件看得見的事。
--   · 聚合一律**純量子查詢**,不 join、不 GROUP BY、不 DISTINCT。
--   · `count(*)` 回 `bigint` ⇒ **不轉回 integer**(鄰居 §3:轉型自己跟自己矛盾過)。
--
-- ══ 4. 🔴 NULL 語意 —— 四欄【不一致是對的】══════════════════════════════════
--   used_count       零使用 ⇒ **0**(`count(*)` 不會 NULL,不需要 coalesce)
--   ends_on          NULL = **不設結束日** ⇒ **刻意不 coalesce**(沒有一個合理的「零日期」)
--   max_redemptions  NULL = **總量不限**   ⇒ 同上
--   max_per_account  NULL = **每人不限**   ⇒ 同上
-- 🔴 **接線片(2b-2)必須把這三個 NULL 顯示成「不限期」/「不限」, 不得留白** ——
--    留白在畫面上與「載入失敗」長得一模一樣
--    (`customers-table.tsx:157-159` 逐字;本片管到 DB, 這句是**給下一片的驗收條款**,
--     不是本片已完成的宣稱)。

-- 🔴 **`CREATE VIEW` 不是 `CREATE OR REPLACE VIEW`**(migration 守門實跑抓到, rc=1):
--    本 view 是【新物件】—— `OR REPLACE` 會讓「它已經存在」這件事**安靜地被接受**。
-- 🔴🔴 而修這一條時量到另一件事:守門的第三格對舊版本是【恆真】的 ——
--    它數的是 `^CREATE (TABLE|VIEW|…)`, 而 `CREATE OR REPLACE VIEW` **不匹配**
--    ⇒ 可授權物件數 = 0、斷言清單長度 = 0 ⇒ **「兩邊都是 0 個」= 綠**。
--    📌 **一個寫錯的關鍵字, 讓那道守門變成一格永遠會過的檢查。**
CREATE VIEW public.admin_coupon_list_v AS
SELECT
  -- 逐顆列出 = 白名單本身(見 §3)。
  c.id,
  c.code,
  c.description,
  c.discount_type,
  c.discount_value,
  c.ends_on,
  c.max_redemptions,
  c.max_per_account,
  c.min_spend,
  c.stacks_with_tier,
  c.is_active,
  c.created_at,
  c.created_by,
  -- 🔴 `staff.id` 是 slug(`^[a-z0-9_]{1,64}$`)、`label` 才是名字(`20260726120000:13-14`)
  --    ⇒ 直接顯示 `created_by` 會在畫面上印出 `g_probe` 這種東西。
  --    ⇒ 純量子查詢, 不 join(契約 §3)。
  (SELECT s.label
     FROM public.staff s
    WHERE s.id = c.created_by)                          AS creator_label,
  -- 🔴🔴 **`reverted_at IS NULL` 這一格不是可選的** —— 片1 檔內自己警告過:
  --    漏掉任一處數次數的地方 ⇒ 那張券【看起來已用完】而客人明明退過貨,
  --    **而它不會報錯、不會紅, 只會有客人打電話來說「我的券不見了」。**
  (SELECT count(*)
     FROM public.coupon_redemptions r
    WHERE r.coupon_id = c.id
      AND r.reverted_at IS NULL)                        AS used_count
FROM public.coupons c;

-- ⏸️ **還沒放進來的一欄:衍生狀態(可用/已過期/已用完/已停用)**
--    🔴 `is_active = true` **不等於**「啟用中」—— 券可能已過期或已用完, 而旗標還是 true。
--    ⇒ 而「狀態欄要顯示行政旗標還是衍生狀態」**是 Sean 的產品題, 2026-08-29 已端出、未答**。
--    ⚠️ 而它**連動篩選**:spec §3-1 的篩選是「全部/啟用中/已停用」= 照 `is_active` 篩;
--       走衍生狀態的話, 一張 badge 寫「已過期」的券會被篩進「啟用中」⇒ 畫面自己打架。
--    ⇒ 所以那一欄**留白等他**;本 view 先把**算得出它所需要的原料全部備齊**
--       (`is_active` / `ends_on` / `max_redemptions` / `used_count`)
--       ⇒ 他答哪一邊, 都只是**加一顆衍生欄 + 改 WHERE**, 不是重寫這支 view。

-- ══ 5. 權限(逐字抄鄰居 :99-105)═══════════════════════════════════════════════
-- 🔴 **絕不 GRANT 給 `anon` / `authenticated`**。
-- ⚠️ view 建立者的授權是**給具名角色的授權、不是 PUBLIC** ⇒ `REVOKE … FROM PUBLIC`
--    **收不掉它** ⇒ 必須**逐角色**再收一次(這一段的教訓來自鄰居 :101-102, 不是我推的)。
REVOKE ALL ON public.admin_coupon_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_coupon_list_v FROM anon, authenticated;
-- 🔴🔴 **`service_role` 也要先 REVOKE ALL 再 GRANT SELECT**(關卡2 must-fix)——
--    本 view 是**簡單 view ⇒ PostgreSQL 自動可更新**, 而它跑在 owner 權限下。
--    ⇒ 若 default ACL 給了 service_role `UPDATE`, 它就能**透過這支 view 改券**,
--      而底表的零表權限**擋不住**(view 用的是 owner 的權限)。
--    ⇒ 而 6f 的閉世界檢查看到的是「service_role」這個預期內的名字 ⇒ **它會放行。**
--    📌 一個唯讀頁面的 view, 在權限上不是天生唯讀的。
REVOKE ALL ON public.admin_coupon_list_v FROM service_role;
GRANT SELECT ON public.admin_coupon_list_v TO service_role;

COMMENT ON VIEW public.admin_coupon_list_v IS
  '後台優惠券列表(已用次數 / 建立者名稱)。'
  '🔴 已用次數口徑:一律排除【已退回】的 redemption(reverted_at IS NOT NULL 者不計)。'
  '🔴 本 view【刻意不使用 security_invoker】—— 底表 coupons/coupon_redemptions 在片1 被 '
  'REVOKE 到零表權限(含 service_role)⇒ 以呼叫者身分讀會 ERROR: permission denied for table coupons '
  '(實測, 不是推的)⇒ 整頁打不開。⇒ 想改回 security_invoker=true 之前, 先讀本檔 §2。'
  '🔴 寫法契約:coupons 欄位逐顆列出(不用 c.*)、聚合與 creator_label 一律純量子查詢, '
  '不得 GROUP BY/DISTINCT/join。coupons 加欄要同批重建本 view。'
  '🔴 只給 service_role。⏸️ 衍生狀態欄(可用/已過期/已用完/已停用)未定 —— Sean 未答, 見本檔 §4 後那段。';

-- ══ 6. 🔴 fail-closed 斷言 ═════════════════════════════════════════════════════
--
-- 🛑 **這一節有一個我【做不到】的斷言, 先講清楚, 免得下一個人以為它守住了:**
--    「service_role 對本 view 真的**查得出列**」—— **apply 當下 `coupons` 是空表**
--    ⇒ 那一發不論權限對不對都回 0 列 ⇒ **它是一格恆真的斷言。**
-- ⇒ **所以這裡改成斷言【前提】而不是【結果】**:前提成立而表有資料時,結果必然成立;
--    而前提每一格都在兩個世界會印不同的東西。
-- ⇒ 「真的查得出列」那一格**移到 2b-2 的驗收**(種幾張券之後真的撈一次), 寫在那裡, 不寫在這裡。
DO $$
DECLARE
  -- 家法要求的收權斷言清單(migration-static-checks.sh:461 會比對它與 CREATE 的支數)
  v_relations text[] := ARRAY['public.admin_coupon_list_v']::text[];
  v_functions text[] := ARRAY[]::text[];
  -- 🔴 迴圈變數【不叫 r】—— 6e 那段的表別名就是 r,撞名會讓 plpgsql 把別名解析成變數
  --    ⇒ 實跑 rc=3(我第一版就是這樣壞的,守門 rc=0 而 apply 紅 ⇒ 兩把尺又一次)
  v_rel_name text;
  v_view    oid;
  v_owner   name;
  v_opts    text[];
  v_extra   text;
BEGIN
  -- 6a. view 建成了(走 v_relations 這份清單, 不寫死字面 ⇒ 清單與斷言不會漂)
  FOREACH v_rel_name IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(v_rel_name) IS NULL THEN
      RAISE EXCEPTION '片2b-1 fail-closed:% 沒建成', v_rel_name;
    END IF;
  END LOOP;
  v_view := pg_catalog.to_regclass(v_relations[1]);

  -- 6b. 🔴 **本片偏離的那一格, 用機器釘住** —— reloptions 裡不得出現 security_invoker=true
  SELECT c.reloptions INTO v_opts FROM pg_catalog.pg_class c WHERE c.oid = v_view;
  IF coalesce(array_to_string(v_opts, ','), '') ILIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION
      '片2b-1 fail-closed:本 view 不得用 security_invoker=true —— 底表零表權限 ⇒ 實測會 permission denied、整頁打不開(見本檔 §2)';
  END IF;

  -- 6c. 🔴 而 6b 只擋住「開關被打開」。**真正的前提是:view 的 owner 讀得到底表。**
  --     owner 換人 ⇒ 6b 照樣綠, 而 view 照樣壞。
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_catalog.pg_class c WHERE c.oid = v_view;
  -- 🔴 **三張底表, 不是兩張**(關卡2 must-fix):`creator_label` 那顆純量子查詢讀的是 `staff`
  --    ⇒ 原版只查兩張券表 ⇒ owner 讀得到券、讀不到 staff ⇒ **斷言全綠而實際查 view 會報錯**。
  FOREACH v_rel_name IN ARRAY ARRAY['public.coupons','public.coupon_redemptions','public.staff'] LOOP
    IF NOT pg_catalog.has_table_privilege(v_owner, v_rel_name, 'SELECT') THEN
      RAISE EXCEPTION
        '片2b-1 fail-closed:view owner(%) 讀不到底表 % ⇒ 本 view 會 permission denied', v_owner, v_rel_name;
    END IF;
  END LOOP;

  -- 6c-2. 🔴🔴 **而 `has_table_privilege` 答不出 RLS**(關卡2 must-fix)——
  --    `coupons` / `coupon_redemptions` 都 `ENABLE ROW LEVEL SECURITY` 且**零 policy** = default deny。
  --    ⇒ 一個「有 SELECT 權限但不是表 owner、也沒有 BYPASSRLS」的 view owner
  --      ⇒ 6c 全綠, 而查出來是**零列**。
  --    🛑 **而【這一個】才是真正靜默的那種** —— 我原本把 security_invoker 那格說成靜默(實測是報錯),
  --       而真正會靜默回零列的是這一格。⇒ 所以它要有自己的斷言。
  --    ⇒ 判準:view owner 必須就是那三張底表的 owner(表 owner 天然繞過 RLS),
  --      且底表不得開 `FORCE ROW LEVEL SECURITY`(開了連 owner 也要守 policy ⇒ 零 policy = 零列)。
  FOREACH v_rel_name IN ARRAY ARRAY['public.coupons','public.coupon_redemptions','public.staff'] LOOP
    IF pg_catalog.pg_get_userbyid(
         (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = v_rel_name::regclass)
       ) <> v_owner THEN
      RAISE EXCEPTION
        '片2b-1 fail-closed:view owner(%) 不是底表 % 的 owner ⇒ RLS 會把它擋成【零列】而不報錯', v_owner, v_rel_name;
    END IF;
    IF (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel_name::regclass) THEN
      RAISE EXCEPTION
        '片2b-1 fail-closed:底表 % 開了 FORCE ROW LEVEL SECURITY ⇒ 連 owner 也要守 policy, 而它零 policy ⇒ 零列', v_rel_name;
    END IF;
  END LOOP;

  -- 6d. service_role 讀得到本 view(沒有它, 後台整頁空)
  IF NOT pg_catalog.has_table_privilege('service_role', v_view, 'SELECT') THEN
    RAISE EXCEPTION '片2b-1 fail-closed:service_role 對本 view 沒有 SELECT';
  END IF;

  -- 6e. anon / authenticated 一格都不能有(本 view 帶全部券碼)
  SELECT pg_catalog.string_agg(format('%s(%s)', r, p), ', ') INTO v_extra
    FROM unnest(ARRAY['anon','authenticated']) r
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER']) p
   WHERE pg_catalog.has_table_privilege(r, v_view, p);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '片2b-1 fail-closed:anon/authenticated 對本 view 還有權限 ⇒ %', v_extra;
  END IF;

  -- 6f. 🔴 閉世界:上面 6d/6e 是【點名式】= 黑名單 ⇒ 第四個角色拿到授權它們全綠。
  --     (同一個病在片1 已經被 codex 抓過一次, 這裡不再犯。)
  SELECT pg_catalog.string_agg(DISTINCT g.grantee, ', ') INTO v_extra
    FROM (
      SELECT pg_catalog.pg_get_userbyid((pg_catalog.aclexplode(c.relacl)).grantee) AS grantee
        FROM pg_catalog.pg_class c
       WHERE c.oid = v_view AND c.relacl IS NOT NULL
    ) g
   WHERE g.grantee NOT IN (v_owner, 'service_role');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '片2b-1 fail-closed:本 view 上有預期外的【表級】授權對象 ⇒ %', v_extra;
  END IF;

  -- 6g. 🔴 **欄級 ACL**(關卡2 must-fix;片1 折過同一條, 而我沒有把它帶過來)——
  --     `GRANT SELECT (code) ON admin_coupon_list_v TO anon` 住在 `pg_attribute.attacl`
  --     ⇒ 6e(表級有效權限)與 6f(relacl)**兩關都看不到它**, 而券碼已經外洩。
  SELECT pg_catalog.string_agg(DISTINCT g.grantee, ', ') INTO v_extra
    FROM (
      SELECT pg_catalog.pg_get_userbyid((pg_catalog.aclexplode(a.attacl)).grantee) AS grantee
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = v_view AND a.attnum > 0
         AND NOT a.attisdropped AND a.attacl IS NOT NULL
    ) g
   WHERE g.grantee NOT IN (v_owner, 'service_role');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '片2b-1 fail-closed:本 view 上有預期外的【欄級】授權對象 ⇒ %', v_extra;
  END IF;

  -- 6g-2. 🔴🔴 **而上面每一格都沒有守「service_role 只有 SELECT」** —— 這一格是我自己
  --      實測那個洞的時候發現的, 不是 codex 講的:
  --      6e 只問 anon/authenticated;6f/6g 的閉世界把 service_role 當【預期內的名字】排除掉
  --      ⇒ **service_role 拿到 UPDATE 時, 上面七格全綠。**
  --   🔴 而那個洞是【實測過的, 不是推的】:給 service_role `UPDATE` 之後
  --      `update admin_coupon_list_v set description=… ` **成功寫進底表**,
  --      而底表 `coupons` 對 service_role 是【零表權限】——
  --      因為本 view 跑在 owner 權限下, 而簡單 view 是自動可更新的。
  --   📌 **⇒ 一個唯讀頁面的 view, 在權限上不是天生唯讀的;而「唯讀」也不會有人回頭驗。**
  SELECT pg_catalog.string_agg(p, ', ') INTO v_extra
    FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
   WHERE pg_catalog.has_table_privilege('service_role', v_view, p);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION
      '片2b-1 fail-closed:service_role 對本 view 只能有 SELECT, 而它還有 ⇒ %(可更新 view + owner 權限 = 寫得穿零權限底表)', v_extra;
  END IF;

  -- 6h. 🔴 **而這一格我原本寫「做不到」, 而那是【寫太滿】了**(關卡2 nit, 它是對的):
  --     「service_role 真的【看得到券】」確實要有資料才驗得到 ⇒ 那一格仍在 2b-2。
  --     **但「service_role 走這條路會不會被權限擋下」是【現在就驗得到】的** ——
  --     以 service_role 實跑一發 `count(*)`:報錯 ⇒ 紅;回 0 ⇒ 綠(空表的 0 是合法的)。
  --     📌 **⇒ 它分得開【permission denied】與【零列】, 而那正是本片最怕搞混的兩件事。**
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM count(*) FROM public.admin_coupon_list_v;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION '片2b-1 fail-closed:service_role 實跑本 view 被擋 ⇒ %', SQLERRM;
  END;
END $$;

COMMIT;
