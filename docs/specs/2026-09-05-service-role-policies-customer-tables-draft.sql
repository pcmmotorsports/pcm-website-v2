-- 🛑🛑🛑 **這【不是】一支 migration。它住在 `docs/specs/`,而且【今天 apply 不了】。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- codex 關卡2 = FAIL, 8 must-fix。兩條讓整片站不住(2026-09-05, 主視窗 `-f8` 裁甲)
-- ══════════════════════════════════════════════════════════════════════════
--   🔴 **#1 它今天連 apply 都不會成功**:`customers_delete_service_role` **既有**
--     (`supabase/migrations/20260523034911…sql:159`;我唯讀實查 ⇒ count = **1**),
--     而本檔寫了一格斷言「不得存在這條」⇒ **每次都會 throw、整支回滾。**
--     🛑 **而它在同一支檔裡自相矛盾** —— 上面才寫「policy 今天已經有 `D` 是既有的事實,
--        本檔不動它」, 下面卻斷言它不該存在。⇒ **同一份檔的兩半沒有互相對照過。**
--
--   🔴 **#3 前提被推翻**:本檔宣稱那三張表的寫入走 service client。
--     而我查的是「adapter 被誰【建構】」, **沒查那條路實際【呼叫】了哪些方法**。
--     🔬 repo 自己的註解逐字(`apps/admin/src/lib/customers/customer-repository.ts:147-148`):
--       「scoping 由 adapter `listByCustomer` 顯式 `.eq(...)` 保證。
--         **呼叫端只用 `listByCustomer`(create/update/delete 不在明細-b、後台寫入片另議)**。」
--     ⇒ 🎯 **service 那條路【只讀】。DIU 是 storefront 的 authenticated 路在用的。**
--     ⇒ 📌 **所以本檔對 `customer_addresses` / `customer_vehicles` 補 I/U/D 很可能是【過度授權】。**
--     🛑 **而本檔檔頭原本寫著「若它們只走 anon, 本檔就是過度授權 ⇒ 所以這一格先查了才寫」**
--        —— **而我查的那一格答的是另一個問題。**
--
--   🔴 **另有兩條是【回歸】**:`#4` 正對照沒重走①的查詢形狀 · `#8` rollback 沒包交易
--     ⇒ **那兩個洞一代(`20260905090000`)都修過, 而我「沿用形狀」時沿用的是【修之前】的形狀。**
--   其餘:`#2` 前置閘沒驗 SELECT ACL · `#5` 若 `authenticated` 是 service_role 成員, 七條 `true`
--     會讓客人拿到全表寫刪權而斷言仍綠 · `#6` 之後有人加 restrictive 就靜靜失效
--     · `#7` 只驗 `relrowsecurity` 沒驗 owner / FORCE RLS。
--
-- ── 什麼時候它才可能回去 ──────────────────────────────────────────────────
--   ✅ 前置 = 先答完「那三張表的寫入到底走哪條路」(呼叫端 → adapter 方法 → 哪把鑰匙)。
--   ⇒ 🔵 **若答案是「只剩 `customers` 的 UPDATE」, 那就不是搬回本檔, 是【重寫一片小的】。**
--   🛑 **不要把本檔原樣搬回去** —— 它的依據已經被推翻, 而 8 條 must-fix 一條都沒折。
-- ══════════════════════════════════════════════════════════════════════════

-- ⟦b9-RLSHARDEN⟧ 第 0 步【二代】:補三張【客人資料表】缺的 service_role 寫入 policy
--
-- 🛑🛑 **本檔是【草稿】。動 RLS = PCM 鐵則 12②(權限)⇒ 要 Sean 拍板 + codex 對抗審查才貼。**
-- 🟢 **純加 policy** —— 零 `GRANT`、零 `REVOKE`、零 `ALTER ROLE`、**不建表 / 函式 / 角色**
--    (⚠️ policy 自己是新的 DB 物件, 那句不能寫成「不建任何新物件」—— 第 0 步一代的 nit)。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 為什麼是【現在】才出現 —— 而它比一代那三張更靠近客人
-- ══════════════════════════════════════════════════════════════════════════
--   一代補的是 `admin_audit_log` / `admin_sso_login_events` / `staff`(寫紀錄那一族)。
--   🔬 而 2026-09-05 補 `⟦b9-SRVCONSUMERGAP⟧` 的洞①時發現:
--     舊的掃描器只認「檔內含 `createSupabaseServiceClient` 或 `SUPABASE_SERVICE_ROLE_KEY`」,
--     而**靠【注入 client】的 adapter 兩個字面一個都不含**
--     ⇒ 📌 **它們對那把尺【結構上不存在】。** 實查 10 支 ⇒ 物件數 **23 ⇒ 34**。
--   🎯 **而本檔這三張, 全部來自新增的那 11 個裡。**
--   ⇒ 🔴 **它們是客人資料**(地址 / 車輛 / 客戶本人)—— 壞掉的樣子不是「少一筆稽核」,
--     是**客人改不了自己的地址、刪不掉自己的車**。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 逐欄的依據(每個動詞都有 `檔:行`,不是推的)
-- ══════════════════════════════════════════════════════════════════════════
--   customer_addresses  缺 D I U   ← policy 今天只有 S
--     `packages/adapters/src/supabase/SupabaseAddressAdapter.ts:44 select · 59 insert · 72 update · 85 delete`
--   customer_vehicles   缺 D I U   ← policy 今天只有 S
--     `packages/adapters/src/supabase/SupabaseVehicleAdapter.ts:38 select · 53 insert · 66 update · 79 delete`
--   customers           缺 U       ← policy 今天有 D I S
--     `SupabaseCustomerAdapter.ts:213/233/249 select · 275 update` · `SupabaseWalletAdapter.ts:128 select`
--
--   🔵 **而它們【真的走 service client】,不是走顧客的 anon 路** —— 實查建構點:
--     四支 adapter 都由 `apps/admin/src/lib/customers/customer-repository.ts`
--     與一支 `composition.ts` 用 `createSupabaseServiceClient()` new 出來。
--     ⇒ 📌 **若它們只走 anon, 本檔就是過度授權** —— 所以這一格先查了才寫。
--
--   🛑 **`customers` 只補 UPDATE, 不補 DELETE** —— 碼那一側**沒有任何 `.delete()`**(上面逐行列了)。
--     ⇒ **不補一個碼不會用的動詞。** 而 policy 今天已經有 `D` 是既有的事實, 本檔不動它。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 順序與射程(與一代同一句)
-- ══════════════════════════════════════════════════════════════════════════
--   本檔要在「拿掉 BYPASSRLS」之【前】貼。反過來的話那幾條路會**安靜地失敗** ——
--   RLS 擋掉的寫入不一定噴 500(可能只是回 0 列), 而呼叫端有沒有檢查回傳, 沒有人逐支看過。
--   ⇒ ✅ **驗收要用「那三張表的列數/內容還會不會變」, 不是「畫面有沒有壞」。**
--
--   ⚠️ **對「今天在跑的路徑」零行為改變**(BYPASSRLS 還在 ⇒ PostgreSQL 根本不會看 policy)。
--   🔴 **而【不宣稱】零行為改變的全稱版** —— 一代學到的:那句話對「重跑零-policy 偵測器」為假。
--     🔬 本檔實查:這三張表**沒有任何 migration 斷言它們應為零 policy**。
--     ⛔ ~~數法「grep 那兩個字面 ⇒ 2 支, 而那兩支管 staff 與 admin_audit_log」~~
--       —— 🔴 **那個 2 是我隨手寫的, 實際是 16 支。結論對而【我寫的證據是錯的】。**
--     ✅ 正確的數法(逐支開檔, 在命中點前後 2000 字元內找表名):
--       ```
--       對 16 支逐支問「這一句 zero-policy 講的是哪張表」
--         🟢 正對照 email_outbox ⇒ HIT 20260717020000  · orders ⇒ HIT 20260729010000
--         customer_addresses / customer_vehicles / customers ⇒ 各 0 支
--       ```
--       🛑 **而我第一版的負對照【也印 0】** —— 那時我拿 `staff` 當對照, 而**我今天自己改過那支檔**
--         (`a559eb258` 把它從「零 policy」改成「期望集合相等」)⇒ 對照失效而我差點採信那三個 0。
--         ⇒ 📌 **換成兩個我沒動過的檔當正對照, 兩個都 HIT, 那三個 0 才算數。**
--     ⇒ **本檔不製造那個接縫。**
--
-- ── Rollback(純加 policy ⇒ 刪掉即回到今天)───────────────────────────────
--   DROP POLICY customer_addresses_insert_service_role ON public.customer_addresses;
--   DROP POLICY customer_addresses_update_service_role ON public.customer_addresses;
--   DROP POLICY customer_addresses_delete_service_role ON public.customer_addresses;
--   DROP POLICY customer_vehicles_insert_service_role  ON public.customer_vehicles;
--   DROP POLICY customer_vehicles_update_service_role  ON public.customer_vehicles;
--   DROP POLICY customer_vehicles_delete_service_role  ON public.customer_vehicles;
--   DROP POLICY customers_update_service_role          ON public.customers;
--   🔵 而 rollback 之後行為與今天相同(今天那幾條路靠 BYPASSRLS 過, 本檔沒動它)。
--
-- 🔵 **刻意不用 `IF NOT EXISTS` / `DROP POLICY IF EXISTS`** —— 撞名要紅, 紅了人才會去看
--    (`docs/patterns/revoking-function-execute-in-supabase.md` §3.2)。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_n int;
BEGIN
  -- ① BYPASSRLS 前提:順序反了就停(與一代同一格)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role 已經沒有 BYPASSRLS ⇒ 本檔「對今天的路徑零行為改變」的前提不成立。'
                    'RLSHARDEN 可能先跑了 —— 停下來重讀本檔開頭那段順序說明';
  END IF;

  -- ② 三張表都要存在、而且 RLS 真的開著
  --    🔴 少了後半:某張表沒 ENABLE RLS ⇒ policy 與斷言【照樣全過】,
  --       而收 BYPASSRLS 之後那張表完全不受保護 ⇒ 一個綠色的假保護。
  FOR r IN SELECT unnest(ARRAY['customer_addresses','customer_vehicles','customers']) AS n LOOP
    SELECT count(*) INTO v_n FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname='public' AND c.relname = r.n AND c.relkind='r' AND c.relrowsecurity;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% 不存在、不是表、或沒有啟用 RLS ⇒ 在它上面加 policy 是【看起來有保護】而實際沒有', r.n;
    END IF;
  END LOOP;

  -- ③ ACL 那一層要在 —— 🔴 RLS 與 GRANT 是兩道【各自獨立】的閘, 兩道都要過。
  --    只補 policy 而 ACL 少了動詞 ⇒ 本檔全過, 而 harden 之後才失敗。
  IF NOT (has_table_privilege('service_role','public.customer_addresses','INSERT')
      AND has_table_privilege('service_role','public.customer_addresses','UPDATE')
      AND has_table_privilege('service_role','public.customer_addresses','DELETE')
      AND has_table_privilege('service_role','public.customer_vehicles','INSERT')
      AND has_table_privilege('service_role','public.customer_vehicles','UPDATE')
      AND has_table_privilege('service_role','public.customer_vehicles','DELETE')
      AND has_table_privilege('service_role','public.customers','UPDATE')) THEN
    RAISE EXCEPTION 'ACL 前提不成立:三張表要補的那幾個動詞在 GRANT 那一層沒有齊 ⇒ 只補 policy 不夠';
  END IF;
END $$;

-- ── customer_addresses(碼:AddressAdapter :59 insert · :72 update · :85 delete)──
CREATE POLICY customer_addresses_insert_service_role ON public.customer_addresses
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY customer_addresses_update_service_role ON public.customer_addresses
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY customer_addresses_delete_service_role ON public.customer_addresses
  FOR DELETE TO service_role USING (true);

-- ── customer_vehicles(碼:VehicleAdapter :53 insert · :66 update · :79 delete)──
CREATE POLICY customer_vehicles_insert_service_role ON public.customer_vehicles
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY customer_vehicles_update_service_role ON public.customer_vehicles
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY customer_vehicles_delete_service_role ON public.customer_vehicles
  FOR DELETE TO service_role USING (true);

-- ── customers(碼:CustomerAdapter :275 update。🛑 沒有 delete ⇒ 不補 DELETE)──
CREATE POLICY customers_update_service_role ON public.customers
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- 事後斷言(形狀沿用一代 R1-R4 折完的那一版)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  expected CONSTANT text[][] := ARRAY[
    ['customer_addresses','customer_addresses_insert_service_role','a'],
    ['customer_addresses','customer_addresses_update_service_role','w'],
    ['customer_addresses','customer_addresses_delete_service_role','d'],
    ['customer_vehicles', 'customer_vehicles_insert_service_role', 'a'],
    ['customer_vehicles', 'customer_vehicles_update_service_role', 'w'],
    ['customer_vehicles', 'customer_vehicles_delete_service_role', 'd'],
    ['customers',         'customers_update_service_role',         'w']
  ];
  i int; v_n int;
BEGIN
  -- ① 逐條驗【表 + 名 + 動詞 + qual + permissive + 角色恰等於 {service_role}】
  FOR i IN 1 .. array_length(expected, 1) LOOP
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c  ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relname  = expected[i][1]
       AND p.polname  = expected[i][2]
       AND p.polcmd   = expected[i][3]::"char"
       AND p.polpermissive
       AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')]::oid[]
       AND coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true'
       AND coalesce(pg_catalog.pg_get_expr(p.polqual,      p.polrelid), 'true') = 'true';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% 上的 % 不符期望形狀(表/動詞/qual/permissive/角色恰等於 service_role)⇒ 數到 % 條',
        expected[i][1], expected[i][2], v_n;
    END IF;
  END LOOP;

  -- ② 🟢 **正對照:證明 ① 那把尺會動。** 同一個查詢形狀餵一個【一定會中】的既有 policy。
  --    🛑 少了這一格, 一個永遠回 1 的查詢也會讓 ① 全過。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'customer_addresses' AND p.polname LIKE '%\_select\_%';
  IF v_n < 1 THEN
    RAISE EXCEPTION '正對照失敗:customer_addresses 上連一條 select policy 都數不到 ⇒ 上面那些 1 沒有判別力';
  END IF;

  -- ③ 🔵 本檔不得開給 PUBLIC / anon / authenticated —— 用【成員資格】問, 不用陣列相等
  --    (陣列相等會漏掉 `TO PUBLIC, service_role` 那一種, 那是一代 R2 抓到的)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public'
     AND (c.relname, p.polname) IN (
           ('customer_addresses','customer_addresses_insert_service_role'),
           ('customer_addresses','customer_addresses_update_service_role'),
           ('customer_addresses','customer_addresses_delete_service_role'),
           ('customer_vehicles','customer_vehicles_insert_service_role'),
           ('customer_vehicles','customer_vehicles_update_service_role'),
           ('customer_vehicles','customer_vehicles_delete_service_role'),
           ('customers','customers_update_service_role'))
     AND (0 = ANY (p.polroles)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                      WHERE r.oid = ANY (p.polroles) AND r.rolname IN ('anon','authenticated')));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '有 % 條 policy 開給了 PUBLIC/anon/authenticated —— 本檔只該開給 service_role', v_n;
  END IF;

  -- ④ 🛑 **本檔不得補 `customers` 的 DELETE** —— 碼那側沒有 `.delete()`。
  --    這一格是「不該有的沒有」, 而它比 ① 更容易被下一個人順手加壞。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
               JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
              WHERE c.relname='customers' AND p.polname='customers_delete_service_role') THEN
    RAISE EXCEPTION '本檔不該建 customers_delete_service_role —— 碼那側沒有任何 .delete()';
  END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 這一支【證不到什麼】
-- ══════════════════════════════════════════════════════════════════════════
-- · **貼了不會有任何東西變綠、也不會有畫面變化** —— BYPASSRLS 還在 ⇒ policy 不會被走到。
--   唯一的證據是那支 prereq probe 重跑, 這三張的讀數從「缺 DIU / 缺 U」變成「有」。
-- · 它不驗「收 BYPASSRLS 之後 admin 真的還改得動地址」—— 那要 apply 授權(`⟦b9-SRVCONSUMERGAP⟧` ④)。
-- · **注入鏈我只追了一層** —— adapter 再把 client 傳給第三個東西的話, 這三張表的清單可能仍不完整;
--   而**有沒有那種, 我沒有量過**。
