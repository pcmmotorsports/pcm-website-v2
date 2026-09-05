-- ⟦b9-RLSHARDEN⟧ 第 0 步【三代 · 收窄版】:只補 `customers` 的 service_role UPDATE policy
--
-- 🛑🛑 **動 RLS = PCM 鐵則 12②(權限)。審查狀態(逐字,不四捨五入)**:
--    **codex R1 = FAIL(11 must-fix + 3 nit)· R2 = FAIL(11 must-fix + 1 nit)**
--    **R3 = FAIL**(adversarial-reviewer opus / 假設審查角度)—— 🟢 **SQL 本體零 finding**,
--    七條全在**檔頭字面與相鄰的記帳**。三輪 findings 本檔已逐條折。
--    🔴 **而【已折完】不等於【通過】** —— 沒有任何一輪回過 PASS。貼之前請當它未過。
--    ⛔ ~~上一版檔頭寫「已過 codex 對抗審查 R1 + R2」~~ —— **那是 R2 跑之前就寫下的,是假的。**
--       (R2 #1 抓到它。留刪除線讓搜「已過 R2」的人同一發撞到訂正。)
-- 🟢 **純加【一條】policy** —— 零 `GRANT`、零 `REVOKE`、零 `ALTER ROLE`、不建表 / 函式 / 角色。
--    (⚠️ policy 自己就是一個新的 DB 物件 ⇒ 不能寫成「不建任何新物件」。)
--
-- ══════════════════════════════════════════════════════════════════════════
-- 為什麼是【一條】而不是二代那七條 —— 二代的前提被自己的量測推翻了
-- ══════════════════════════════════════════════════════════════════════════
--   二代(`docs/specs/2026-09-05-service-role-policies-customer-tables-draft.sql`,已降級)
--   要給三張表補 I/U/D 共七條。它的依據是「掃描器說那三張表碼要 DISU」。
--   🔴 **而那把尺分不出【哪個呼叫端用了哪個動詞】** —— 同一個 adapter 被兩條路注入
--      **兩把不同的鑰匙**(admin 注 service_role · storefront 注 authenticated)。
--
-- ── 重量:每張表一列, 三欄 = 呼叫端 → adapter 方法 → 哪把鑰匙 ──────────
--    (2026-09-05,分母改成【呼叫端】,量在主樹 `dev` @ `c33cad7b6`)
--
--   ▸ customer_addresses
--     寫  apps/storefront/src/app/account/address/actions.ts:107 / :163 / :187
--         → addAddress / updateAddress / deleteAddress
--         → SupabaseAddressAdapter.create / .update / .delete        ⇒ **authenticated**
--     讀  apps/admin/src/lib/customers/load-customer-detail.ts:126 → listByCustomer ⇒ service_role
--     ⇒ 🎯 **service_role 側零寫入**
--
--   ▸ customer_vehicles
--     寫  apps/storefront/src/app/account/vehicle/actions.ts:100 / :152 / :176
--         → addVehicle / updateVehicle / deleteVehicle
--         → SupabaseVehicleAdapter.create / .update / .delete        ⇒ **authenticated**
--     讀  apps/admin/src/lib/customers/load-customer-detail.ts:127 → listByCustomer ⇒ service_role
--     ⇒ 🎯 **service_role 側零寫入**
--
--   ▸ customers(五條寫入路徑,只有第②條需要本檔這條 policy)
--     ① apps/storefront/src/app/account/profile/actions.ts:87
--        → updateProfile → SupabaseCustomerAdapter.update            ⇒ **authenticated**
--     ② **apps/admin/src/lib/customers/profile-actions.ts:65**
--        → getAdminCustomerRepository().update                       ⇒ 🔴 **service_role** ← 唯一
--     ③ apps/admin/src/lib/customers/tier-actions.ts:54
--        → rpc `admin_set_customer_tier` ⇒ UPDATE 在 **SECURITY DEFINER 函式內以 owner 執行**
--     ④ 註冊 → trigger `handle_new_auth_user` 的 INSERT              ⇒ 同樣 **owner**
--     ⑤ 🔴 **[codex R1 #1 抓到 —— 我原本漏了這一條]**
--        apps/admin/src/lib/customers/wallet-actions.ts:51 → rpc `admin_adjust_wallet`
--        → INSERT customer_wallet_ledger → trigger `on_wallet_ledger_inserted`
--        → `sync_wallet_balance_on_ledger_insert()` **UPDATE public.customers**
--        (`20260523034911…sql:303`, 該函式 `:311` 是 `SECURITY DEFINER`)⇒ 同樣 **owner**
--        📌 **它是【間接】的:呼叫端看不到 customers 這個字, 是 trigger 走過去的。**
--        ⇒ 這正是「三欄表」這種尺的已知盲區:**它只看得到呼叫端直接碰的表。**
--
--   🔬 **③④⑤ 的 owner 免疫【是量到的, 不是 SECDEF 的性質】**(2026-09-05 正式庫唯讀實查):
--     四支函式 `admin_set_customer_tier` / `handle_new_auth_user` /
--     `sync_wallet_balance_on_ledger_insert` / `admin_adjust_wallet`
--     ⇒ `prokind = 'f'` 四支、owner 全是 `postgres`、`rolsuper = f` 而 **`rolbypassrls = t`**、
--       `prosecdef = t`。⇒ 下面 ⑫ 把它變成一道**會叫的閘**,而且**釘住分母 = 恰 4 支**。
--     🔵 **[R2 #10 訂正]** ⛔ ~~原本還加了一道「三張表不得開 FORCE RLS」~~ ——
--        **那個模型是反的**:`FORCE RLS` 只讓 **owner** 受 policy 限制,而
--        **`BYPASSRLS` 永遠優先** ⇒ owner 帶 BYPASSRLS 時 FORCE 不影響它。
--        ⇒ 那道閘會**誤擋一次真正的安全強化**。**已刪。**
--
--   ⇒ 📌 **所以二代給 addresses / vehicles 補的六格是【過度授權】,這一支一格都不給它們。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔬 貼之前的現況(2026-09-05 唯讀實查正式庫;`scripts/readonly-prod-sql.sh`)
-- ══════════════════════════════════════════════════════════════════════════
--   policy(三張表共 15 條):
--     customers           r customers_select_service_role(TO service_role, qual=true)
--                         a customers_insert_service_role · d customers_delete_service_role
--                         r/w *_own(TO authenticated)      ⇒ 🔴 **缺的正是 w(UPDATE)**
--     customer_addresses  r customer_addresses_select_service_role + 四條 *_own
--     customer_vehicles   r customer_vehicles_select_service_role + 四條 *_own
--   逐表(不是合計)的 service_role SELECT policy:**1 / 1 / 1**
--   `customers` 上會影響 UPDATE 的 policy(貼本檔之前)**只有一條**:
--     `customers_update_own` TO authenticated,qual 與 with check 都是 `(auth.uid() = user_id)`
--   RLS:三張表 `relrowsecurity = t`(三張都在、三張都開)
--   對 service_role 有效適用的 restrictive policy:**0**(而同一把尺算 permissive ⇒ **3** ⇒ 尺會動)
--   `service_role`:`rolbypassrls = t`、`rolsuper = f`、**不是**三張表的 owner、也沒有
--     【有效地】拿到 owner 的權限(三張表 `pg_has_role(service_role, relowner, 'USAGE')` 全 `f`)
--   `customers` 上 service_role **有效**可 UPDATE 的欄(問 `has_column_privilege`,不是展開 ACL):
--     `birthday` `gender` `name` `phone` `updated_at` —— **恰 5 欄**
--     🟢 正對照:同一把尺問 SELECT ⇒ **11 欄**(= 整張表)⇒ 尺不是恆回 5
--     ⇒ 而 adapter 白名單是 **name / phone / gender / birthday**
--       🔴 **[R1 #3 訂正]** ⛔ ~~三欄~~ ⇒ **四欄**:`mappers/customer.ts:161-172` 有 `gender`
--     ⇒ 📌 **欄的範圍歸 GRANT 管,不歸 policy 管** ⇒ 這條 policy 寫 `true`
--        **不會**讓 service_role 改得到第六欄(`tier` 的欄級 UPDATE 實查 = **f**)。
--   角色圖(兩個方向都量,因為它們答的是不同的問題):
--     · **USAGE**(不必 SET ROLE 就繼承)⇒ `postgres` `supabase_admin`
--     · **MEMBER**(可以 `SET ROLE` 變成它)⇒ `authenticator` `cli_login_postgres`
--       `postgres` `supabase_admin` `supabase_storage_admin`
--     ⇒ **`anon` / `authenticated` 兩邊都不在。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 本檔【證不到什麼】
-- ══════════════════════════════════════════════════════════════════════════
--   🔴 **[R1 #12 —— 最核心的那一條]**:**下面每一格斷言都是在
--      `service_role` 還帶著 BYPASSRLS 的世界裡跑的。**
--      ⇒ 它們證的是 **catalog 的形狀**,**不是 harden 之後的行為**。
--      ⇒ 📌 **從來沒有人以一個【受 RLS 約束】的角色實跑過那條
--         `.update().select().single()`** —— 那要 apply 授權 + 一個能 SET ROLE 的環境。
--      ⇒ ✅ **真正的驗收在 harden 那一天。**
--   🔴🔴 **[R3 F1]** ⛔ ~~判準是「後台改客戶基本資料還存不存得起來」~~ —— **那只驗到路②。**
--      **路⑤(儲值金)靠的是 `postgres` 的 BYPASSRLS,而那個 UPDATE【沒有檢查改到幾列】**
--      (`20260523034911…sql:303-308`;實查該函式本體 `GET DIAGNOSTICS` / `IF NOT FOUND` **0 處**,
--       🟢 正對照:全庫 **65 支** migration 用過 `GET DIAGNOSTICS` ⇒ 那把尺會動)
--      ⇒ 🎯 **那天若連 `postgres` 的 BYPASSRLS 也被收:流水寫得進去、餘額不動、而【零錯誤】。**
--      ⇒ ✅ **驗收改成三格,缺一不可**:
--         ① 後台改一次客戶基本資料 ⇒ 存得起來(路②)
--         ② 後台調一次會員等級 + 加一次儲值金 ⇒ **回頭比 `customers.wallet_balance` 有沒有跟著動**
--            (路③⑤;🛑 **只看「有沒有噴錯」是看不到的**)
--         ③ 用一個新 email 註冊一個帳號 ⇒ `customers` 有沒有長出那一列(路④)
--   🔴🔴 **角色那兩把尺【分不出 service_role 與 anon】** —— 實測:
--      `pg_has_role(*, 'service_role', 'MEMBER')` 與 `pg_has_role(*, 'anon', 'MEMBER')`
--      **回同一串**(那五個是管理員角色 + `authenticator`,它們可以變成任何角色)。
--      ⇒ 📌 **所以 ⑥b 釘的是「這個集合不會【變大】」,不是「這個集合是 service_role 專屬的」。**
--      ⇒ 🛑 **不要把它讀成「本檔驗過只有 service_role 拿得到」** —— 它沒有。
--   · 呼叫端量測**只掃了 repo 的 TS**。`supabase/functions` 目錄不存在;
--     7 支帶 `cron.schedule` 的 migration 對三張表零命中(唯一那筆是**註解**)。
--     🔴 **而「有人在 SQL Editor 手打」量不到 ⇒ 那一格永遠【未確認】。**
--     🔴 **而 R1 #1 證明這把尺還有第二個盲區:【trigger 走過去的間接寫入】。**
--       ⇒ 我補了⑤,而**我沒有辦法宣稱已經窮舉** —— 只能說「掃過 trigger 這一族了」。
--   · 本檔**不動 ACL** ⇒ `customer_addresses` / `customer_vehicles` 的表級 U/D 授權
--     **仍然過寬**(碼從來不用它)。🔴 那是另一列(收 GRANT 要跑 `⟦b9-ACLDRIFT5⟧` 那道閘)。
--     ⇒ 📌 **寫在這裡免得下一個人以為「policy 收窄了 = 權限收窄了」。**
--   · 🔴 **[R2 #12]** 下面的形狀比對用 `coalesce(pg_get_expr(...), 'true')`
--     ⇒ **「沒寫 USING」與「明寫 USING (true)」對它是同一件事。** 今天等價,而**那是巧合**。
--
-- 🔵 **刻意不用 `IF NOT EXISTS`**(`docs/patterns/revoking-function-execute-in-supabase.md` §3.2):
--    那是「把撞名從報錯變成靜靜跳過」的開關,而跳過之後斷言會對著你沒看過的既有物件跑。
--
-- 🛑 **順序(一):與 `⟦b9-RLSHARDEN⟧`**:本檔要在「拿掉 BYPASSRLS」之【前】貼。反過來的話 admin 改客戶基本資料
--    會**安靜地失敗**(RLS 擋掉的 UPDATE 不一定噴 500,可能只回 0 列)。
--    🔬 **[R3 F5] 而【安靜】具體長什麼樣, 我原本沒寫出來**:回 0 列 ⇒ adapter 的 `.single()`
--       丟 `PGRST116` ⇒ `apps/admin/src/lib/customers/profile-actions.ts:66-71` 把它收斂成 **`not_found`**
--       ⇒ 🎯 **畫面對操作的人說「查無這個客戶」** —— 不是「存檔失敗」。
--       ⇒ 📌 **那句話會把人送去查客戶資料, 而問題在權限。**
--
-- 🛑 **順序(二):與 `⟦auth-R5VSMEMBERSHIP⟧`**(**[R3 F6]** —— 本檔原本零處提它):
--    那一列要 `GRANT service_role TO <專用角色>`。⇒ 📌 **它一貼, 本檔閘 ⑥b 釘死的
--    MEMBER 五個名字就會多一個 ⇒ 本檔【重跑會紅】。**
--    ✅ **誰先誰後都可以, 而後貼的那一片要改前一片的期望值**:
--       · 本檔先貼 ⇒ 那一列上線時, **要回來把 ⑥b 的兩串名字加上新角色**。
--       · 那一列先貼 ⇒ **本檔貼之前先重量那兩串**(`pg_has_role` 那兩發), 照實際的寫。
--    🛑 **不要把 ⑥b 改成「含有就好」** —— 那正是它擋的東西(閉世界才擋得住「多了一個」)。

BEGIN;

-- ── 唯一的一條:customers 的 service_role UPDATE ──────────────────────────
--    呼叫端:apps/admin/src/lib/customers/profile-actions.ts:65
--    🔴 `USING` 與 `WITH CHECK` 兩個都要寫:`USING` 決定「哪些既有列改得到」、
--       `WITH CHECK` 決定「改完的樣子准不准」。只寫 `USING` 時 PostgreSQL 會拿它當
--       `WITH CHECK` —— 這次剛好等價,而**那是巧合不是設計**。
CREATE POLICY customers_update_service_role ON public.customers
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- 前置與事後斷言 —— 🔴 **codex R1(11)+ R2(11+1)之後的第三版**
--   R2 的主軸只有一句:**我用「列舉名字」去問一個要用「有效權限」問的問題。**
--   ⇒ 這一版凡是問「誰拿得到」的地方,一律改問 `pg_has_role` / `has_column_privilege`。
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  n int;
  sr_oid oid;
  cols text;
  usage_members text;
  set_members text;
  own_pol text;
BEGIN
  SELECT oid INTO sr_oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role';
  IF sr_oid IS NULL THEN
    RAISE EXCEPTION 'service_role 這個角色不存在 ⇒ 本檔的前提整個不成立';
  END IF;

  -- ① 前提:BYPASSRLS 還在 ⇒ 本檔今天是零行為改變。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role 已經沒有 BYPASSRLS ⇒ 順序反了(RLSHARDEN 先跑了)⇒ 停下來重讀檔頭';
  END IF;

  -- ② 前提:三張表**都在**、而且**都開著 RLS**。
  --    🔴 **[R2 #6]** 舊版只驗 customers 一張, 而⑧那格用 GROUP BY ⇒ **表不存在就沒有那一組,
  --       於是「不等於 1 的張數」回 0 ⇒ 一個假綠。** ⇒ 這裡把分母釘死成 3。
  SELECT count(*) INTO n FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public'
     AND c.relname IN ('customers','customer_addresses','customer_vehicles')
     AND c.relkind = 'r' AND c.relrowsecurity;
  IF n <> 3 THEN
    RAISE EXCEPTION '三張客人表裡, 「存在且是一般表且開著 RLS」的只有 % 張(期望 3)'
                    '⇒ 少的那張要嘛不存在、要嘛沒開 RLS ⇒ 在它上面加 policy 是假保護', n;
  END IF;

  -- ②b 🔴 **[R1 #4 · R2 #2]** RLS 開著**還不夠** —— **表 owner 與 superuser 天生繞過 RLS**。
  --     ⛔ ~~舊版只比 `relowner = sr_oid`~~ —— **service_role 若【繼承】了 owner role,
  --        relowner 不等於它、rolsuper 也是 f, 而 PostgreSQL 照樣把它當 owner。**
  --     ✅ 改問**有效權限**:`pg_has_role(service_role, relowner, 'USAGE')`。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
               JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname='public'
                AND c.relname IN ('customers','customer_addresses','customer_vehicles')
                AND pg_catalog.pg_has_role(sr_oid, c.relowner, 'USAGE')) THEN
    RAISE EXCEPTION 'service_role 【有效地】具備那三張表其中之一的 owner 權限 '
                    '⇒ 它天生繞過 RLS ⇒ 這條 policy 只是裝飾';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role' AND rolsuper) THEN
    RAISE EXCEPTION 'service_role 是 superuser ⇒ 它天生繞過 RLS ⇒ 這條 policy 只是裝飾';
  END IF;

  -- ③ 前提 + 閉世界:`customers` 上 service_role **有效**可 UPDATE 的欄,必須恰好是那五欄。
  --    🔴 **[R1 #5 · R2 #3]** ⛔ ~~舊版展開 `aclexplode(attacl)` 只看直接授給 service_role 的~~
  --       —— **PUBLIC 授的、繼承來的、`WITH GRANT OPTION` 的,它一格都看不到。**
  --    ✅ 改問 `has_column_privilege`(它就是「有效權限」那個問題本身)。
  --    🔴 **為什麼要閉世界**:本檔這條 policy 的 qual 是無條件 `true`
  --       ⇒ 📌 **欄級 GRANT 是這條路徑【唯一】的欄範圍限制** ——
  --       🛑 **[R3 F3] 而它沒有活的守門** ——【本格只在 apply 的那一刻驗過一次】。
  --          之後有人在 dashboard 或 SQL Editor 手動多授一欄, **不會有任何東西紅**
  --          (`⟦b9-ACLDRIFT5⟧` 那道漂移偵測自陳「dashboard / SQL Editor 手動永遠不紅」)。
  --          多授一個 `tier` / `wallet_balance` 就是一條無條件的直寫旁路。
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO cols
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public' AND c.relname='customers'
     AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('service_role','public.customers', a.attname, 'UPDATE');
  IF coalesce(cols,'') <> 'birthday,gender,name,phone,updated_at' THEN
    RAISE EXCEPTION 'service_role 在 customers 上【有效】可 UPDATE 的欄集合變了 ⇒ 實際是「%」;'
                    '期望逐字「birthday,gender,name,phone,updated_at」。'
                    '⇒ 多出來的每一欄都是一條無條件的直寫旁路, 先回去讀檔頭再決定', coalesce(cols,'(空)');
  END IF;
  -- 🟢 正對照:同一把尺問 SELECT 必須回**整張表**的欄數(> 5)——
  --    少了它, 一把「恆回那五欄」的壞尺會表現得完美。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public' AND c.relname='customers'
     AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('service_role','public.customers', a.attname, 'SELECT');
  IF n <= 5 THEN
    RAISE EXCEPTION '正對照失敗:同一把尺問 SELECT 只回 % 欄 ⇒ 它可能恆回那五欄, 上面那個「恰五欄」沒有判別力', n;
  END IF;

  -- ④ 前提:回讀用的 SELECT。
  --    🔴 adapter 是 `.update(...).select().single()` ⇒ **`RETURNING` 走的是 SELECT policy**。
  --       🔵 **[R1 #6 訂正]** 兩種壞法不一樣:**改到的列不符 SELECT policy ⇒ PostgreSQL 報錯**;
  --       **看不到舊列 ⇒ UPDATE 0 列 ⇒ `.single()` 收成 PGRST116**。兩個都要擋。
  IF NOT has_table_privilege('service_role','public.customers','SELECT') THEN
    RAISE EXCEPTION 'customers 的 SELECT ACL 不在 ⇒ .update().select().single() 的回讀會失敗';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                   JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
                   JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
                  WHERE ns.nspname='public' AND c.relname='customers'
                    AND p.polcmd IN ('r','*') AND p.polpermissive
                    AND p.polroles = ARRAY[sr_oid]::oid[]
                    AND coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid),'true') = 'true') THEN
    RAISE EXCEPTION 'customers 沒有一條 qual 為 true 的 service_role SELECT policy ⇒ RETURNING 會被擋';
  END IF;

  -- ⑤ 正向:這條 policy 的【表 + 名 + 動詞 + qual + withcheck + permissive + 角色恰等於】
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relname  = 'customers'
     AND p.polname  = 'customers_update_service_role'
     AND p.polcmd   = 'w'::"char"
     AND p.polpermissive
     AND p.polroles = ARRAY[sr_oid]::oid[]
     AND coalesce(pg_catalog.pg_get_expr(p.polqual,      p.polrelid), 'true') = 'true'
     AND coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true';
  IF n <> 1 THEN
    RAISE EXCEPTION 'customers_update_service_role 不符期望形狀(動詞/qual/withcheck/permissive/角色恰等於 service_role)⇒ 數到 % 條', n;
  END IF;

  -- ⑥ 🔴 **[R2 #4]** 舊版只檢查【本檔新加的那一條】。
  --     而 **`customers` 上任何一條 permissive 的 UPDATE/ALL policy 都會被 OR 起來**
  --     ⇒ 📌 **既有的 `customers_update_own` 若哪天被改成無條件, 或有人新增一條開給
  --        PUBLIC / anon / authenticated 的, 舊版一格都不會叫。**
  --     ✅ 改成**閉世界**:把 customers 上所有 `w`/`*` 的 policy 連同角色與 qual 釘死成一份字串。
  SELECT string_agg(
           p.polname || '|' || p.polcmd::text || '|' || p.polpermissive::text || '|' ||
           coalesce((SELECT string_agg(coalesce(r.rolname,'PUBLIC'), '+' ORDER BY coalesce(r.rolname,'PUBLIC'))
                       FROM unnest(p.polroles) u(oid)
                       LEFT JOIN pg_catalog.pg_roles r ON r.oid = u.oid), '(none)') || '|' ||
           coalesce(pg_catalog.pg_get_expr(p.polqual,      p.polrelid), '(null)') || '|' ||
           coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '(null)'),
           ' ;; ' ORDER BY p.polname)
    INTO own_pol
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public' AND c.relname='customers' AND p.polcmd IN ('w','*');
  IF coalesce(own_pol,'') <>
     'customers_update_own|w|true|authenticated|(auth.uid() = user_id)|(auth.uid() = user_id)'
     || ' ;; ' ||
     'customers_update_service_role|w|true|service_role|true|true' THEN
    RAISE EXCEPTION 'customers 上會影響 UPDATE 的 policy 集合不是期望的那兩條 ⇒ 實際是「%」。'
                    '⇒ permissive 的 UPDATE policy 是【OR】起來的, 多一條就是多一條放行路徑', coalesce(own_pol,'(空)');
  END IF;

  -- ⑥b 🔴🔴 **[R1 #8 · R2 #5]** `TO service_role` 的 policy **對能拿到 service_role 的角色也適用**。
  --     ⛔ ~~舊版比 `pg_auth_members` 的【直接成員名字】~~ —— **遞移成員、改 INHERIT 選項,
  --        那個字串都可以維持不變。**
  --     ✅ 改問 `pg_has_role`,**兩個方向都問**(它們答的是不同的問題):
  --        · `USAGE`  = 不必 SET ROLE 就繼承它的權限
  --        · `MEMBER` = 可以 `SET ROLE` 變成它(PostgREST 走的就是這條)
  --     🛑 **而這兩把尺【分不出 service_role 與 anon】**(檔頭「證不到什麼」有實測)——
  --        ⇒ 📌 **它釘的是「這個集合不會變大」,不是「只有 service_role 拿得到」。**
  SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) INTO usage_members
    FROM pg_catalog.pg_roles r
   WHERE r.rolname <> 'service_role' AND pg_catalog.pg_has_role(r.oid, sr_oid, 'USAGE');
  IF coalesce(usage_members,'') <> 'postgres,supabase_admin' THEN
    RAISE EXCEPTION '【USAGE】能繼承 service_role 的角色集合變了 ⇒ 實際「%」, 期望逐字「postgres,supabase_admin」。'
                    '⇒ 多出來的角色會直接繼承本檔這條無條件 UPDATE policy', coalesce(usage_members,'(空)');
  END IF;
  SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) INTO set_members
    FROM pg_catalog.pg_roles r
   WHERE r.rolname <> 'service_role' AND pg_catalog.pg_has_role(r.oid, sr_oid, 'MEMBER');
  IF coalesce(set_members,'') <>
     'authenticator,cli_login_postgres,postgres,supabase_admin,supabase_storage_admin' THEN
    RAISE EXCEPTION '【MEMBER】能 SET ROLE 成 service_role 的角色集合變了 ⇒ 實際「%」, 期望逐字 '
                    '「authenticator,cli_login_postgres,postgres,supabase_admin,supabase_storage_admin」。'
                    '⇒ 多出來的角色可以變成 service_role 而拿到全表無條件 UPDATE', coalesce(set_members,'(空)');
  END IF;
  -- 🔴 而上面兩格是「集合相等」⇒ 有人**同時**加一個減一個時它會叫, 而**訊息不會說出重點**。
  --    這一格單獨把最危險的那兩個名字問出來, 讓錯誤訊息直接說出是誰。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
              WHERE r.rolname IN ('anon','authenticated')
                AND (pg_catalog.pg_has_role(r.oid, sr_oid, 'USAGE')
                  OR pg_catalog.pg_has_role(r.oid, sr_oid, 'MEMBER'))) THEN
    RAISE EXCEPTION 'anon 或 authenticated 拿得到 service_role ⇒ 本檔這條無條件 UPDATE policy '
                    '會讓【每一個登入的客人】改得到整張 customers。立刻停下';
  END IF;

  -- ⑦ 正對照:與 ⑤ **走同一條程式路徑**, 只把「角色恰等於」換成【一定會中】的成員資格問法。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND (c.relname, p.polname) = ('customers','customers_update_service_role')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                  WHERE r.oid = ANY (p.polroles) AND r.rolname = 'service_role');
  IF n <> 1 THEN
    RAISE EXCEPTION '正對照失敗:同一個查詢形狀餵【一定會中】的角色只數到 % 條(期望 1)⇒ 上面那些 0 沒有判別力', n;
  END IF;

  -- ⑧ 現況核對:三張表的 service_role **SELECT** policy **逐表各恰 1 條**。
  --    🔴 **[R1 #9]** ⛔ ~~舊版驗「合計 3 條」~~ —— 「2 + 1 + 0」也印 3。
  --    🔴 **[R2 #6]** 而分組本身也會漏:表不存在就沒有那一組 ⇒ **分母已由 ② 釘死成 3**。
  SELECT count(*) INTO n FROM (
    SELECT c.relname, count(p.polname) AS k
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_policy p
             ON p.polrelid = c.oid
            AND p.polcmd IN ('r','*') AND p.polpermissive
            AND p.polroles = ARRAY[sr_oid]::oid[]
            AND coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid),'true') = 'true'
     WHERE ns.nspname = 'public'
       AND c.relname IN ('customers','customer_addresses','customer_vehicles')
     GROUP BY c.relname
  ) q WHERE q.k <> 1;
  IF n <> 0 THEN
    RAISE EXCEPTION '三張客人表裡有 % 張的 service_role SELECT policy 不是恰好 1 條 '
                    '⇒ harden 後那張表的後台明細會空掉, 而空清單不會噴錯', n;
  END IF;

  -- ⑨ 本檔【不得】動 GRANT ⇒ customers 的表級 UPDATE 應仍是 false(它是欄級的)。
  IF has_table_privilege('service_role','public.customers','UPDATE') THEN
    RAISE EXCEPTION 'customers 的 UPDATE 變成【表級】授權了 —— 本檔不動 GRANT, 這表示有別的東西放寬了它';
  END IF;

  -- ⑩ 本檔【不得】給 addresses / vehicles 加任何 service_role 適用的寫入 policy(它們零寫入)。
  --    🔴 **[R1 #10]** 補 `'*'`(FOR ALL)與 PUBLIC。
  --    🔴 **[R2 #7]** ⛔ ~~還是只認直接列出 service_role~~ ——
  --       **policy 若列的是某個 service_role【繼承得到】的角色, 它一樣適用。**
  --       ✅ 改問 `pg_has_role(service_role, <policy 列的角色>, 'USAGE')`。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relname IN ('customer_addresses','customer_vehicles')
     AND p.polcmd IN ('a','w','d','*')
     AND (0 = ANY (p.polroles)
          OR EXISTS (SELECT 1 FROM unnest(p.polroles) u(oid)
                      WHERE pg_catalog.pg_has_role(sr_oid, u.oid, 'USAGE')));
  IF n <> 0 THEN
    RAISE EXCEPTION 'customer_addresses / customer_vehicles 上有 % 條【對 service_role 適用】的寫入 policy '
                    '(含 FOR ALL 與 PUBLIC 與繼承)—— 量測說那兩張表 service_role 側零寫入'
                    '⇒ 那是過度授權, 先回去讀檔頭', n;
  END IF;
  -- 🟢 正對照:同一把尺問 customers 必須回 2(既有的 insert + delete)——
  --    少了它, 一把恆回 0 的壞尺會讓上面那格永遠通過。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relname = 'customers'
     AND p.polcmd IN ('a','d')
     AND (0 = ANY (p.polroles)
          OR EXISTS (SELECT 1 FROM unnest(p.polroles) u(oid)
                      WHERE pg_catalog.pg_has_role(sr_oid, u.oid, 'USAGE')));
  IF n <> 2 THEN
    RAISE EXCEPTION '正對照失敗:同一把尺問 customers 的 a/d 只數到 %(期望 2)⇒ 上面那個 0 沒有判別力', n;
  END IF;

  -- ⑪ restrictive policy 會與 permissive **AND** 起來。
  --    🔴 **[R1 #11]** 舊版只寫在檔頭 = 一張快照, 沒有閘。
  --    🔴 **[R2 #8]** ⛔ ~~而變成閘之後我把三張表的【全部】restrictive 一律判錯~~ ——
  --       **一條只適用 `authenticated` `DELETE` 的 restrictive 根本不影響 service_role 的 UPDATE**,
  --       那樣會**誤擋一次正當的強化**。
  --    ✅ 只算**真的會 AND 進去**的:動詞是 r/w/* 且對 service_role 適用(含 PUBLIC 與繼承)。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relname IN ('customers','customer_addresses','customer_vehicles')
     AND NOT p.polpermissive
     AND p.polcmd IN ('r','w','*')
     AND (0 = ANY (p.polroles)
          OR EXISTS (SELECT 1 FROM unnest(p.polroles) u(oid)
                      WHERE pg_catalog.pg_has_role(sr_oid, u.oid, 'USAGE')));
  IF n <> 0 THEN
    RAISE EXCEPTION '三張客人表上有 % 條【對 service_role 的讀/寫真的會 AND 進去】的 restrictive policy '
                    '⇒ 本檔會全綠而 harden 當天寫入照樣失敗。先把那幾條看過再貼', n;
  END IF;
  -- 🟢 正對照:同一把尺把 `NOT p.polpermissive` 換成 `p.polpermissive` 必須回非零。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relname IN ('customers','customer_addresses','customer_vehicles')
     AND p.polpermissive
     AND p.polcmd IN ('r','w','*')
     AND (0 = ANY (p.polroles)
          OR EXISTS (SELECT 1 FROM unnest(p.polroles) u(oid)
                      WHERE pg_catalog.pg_has_role(sr_oid, u.oid, 'USAGE')));
  IF n = 0 THEN
    RAISE EXCEPTION '正對照失敗:同一把尺算 permissive 也回 0 ⇒ 上面那個 restrictive 的 0 沒有判別力';
  END IF;

  -- ⑫ 把檔頭「③④⑤ 靠 owner 免疫」變成**會叫的閘**。
  --    🔴 **[R2 #9]** ⛔ ~~舊版只找「找得到而不合格」的~~ —— **函式消失就是空集合 ⇒ 通過。**
  --    ✅ 分母釘死:那四個名字必須恰好對到 **4 支**、`prokind='f'`、`prosecdef`、
  --       owner 帶 `rolsuper` 或 `rolbypassrls`。
  --    ⚠️ **它證不到什麼**:只比**函式名**, 不比 signature ⇒ 同名 overload 會被算進來,
  --       而那會讓分母 > 4 ⇒ **本閘會叫**(往保守的一側錯)。今天實查 = 4 支、args 各自唯一。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
   WHERE ns.nspname = 'public'
     AND p.proname IN ('admin_set_customer_tier','handle_new_auth_user',
                       'sync_wallet_balance_on_ledger_insert','admin_adjust_wallet')
     AND p.prokind = 'f' AND p.prosecdef
     AND (r.rolsuper OR r.rolbypassrls);
  IF n <> 4 THEN
    RAISE EXCEPTION '那四支寫 customers 的函式裡, 「存在且是函式且 SECURITY DEFINER 且 owner 繞得過 RLS」'
                    '的只有 % 支(期望恰 4)⇒ 檔頭「③④⑤ 靠 owner 免疫」那段不再成立, '
                    '而本檔沒有給那三條路徑任何 policy', n;
  END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback(**不是單向門** —— 一條新加的 policy, 刪掉即回到今天)
-- ══════════════════════════════════════════════════════════════════════════
--   🔴 包在交易裡, 而且**先擋三個世界**:
--     ① BYPASSRLS 若已被拿掉 ⇒ DROP 會【當場切斷後台改客戶基本資料】。
--     ② **[R1 #13 · R2 #11]** 只問 service_role 自己不夠, 也不能比【直接成員的名字】——
--        要問 `pg_has_role`, 因為遞移成員與 INHERIT 選項的改變不會動到那個名字字串。
--     ③ **[R1 #14 · R2 #12]** DROP 前重新核形狀 ——
--        🛑 **而 `coalesce(..., 'true')` 分不出「沒寫 USING」與「明寫 USING (true)」**
--        ⇒ 這裡改成**要求兩個表達式都【不是 NULL】而且逐字是 `true`**。
--
--   BEGIN;
--     DO $r$
--     DECLARE v_sr oid; v_m text;
--     BEGIN
--       SELECT oid INTO v_sr FROM pg_catalog.pg_roles WHERE rolname='service_role';
--       IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
--                       WHERE rolname='service_role' AND rolbypassrls) THEN
--         RAISE EXCEPTION 'BYPASSRLS 已經拿掉了 ⇒ 現在 DROP 會切斷 admin 改客戶基本資料那條路';
--       END IF;
--       SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) INTO v_m
--         FROM pg_catalog.pg_roles r
--        WHERE r.rolname <> 'service_role'
--          AND (pg_catalog.pg_has_role(r.oid, v_sr, 'USAGE')
--            OR pg_catalog.pg_has_role(r.oid, v_sr, 'MEMBER'));
--       IF coalesce(v_m,'') <> 'authenticator,cli_login_postgres,postgres,supabase_admin,supabase_storage_admin' THEN
--         RAISE EXCEPTION '拿得到 service_role 的角色集合已經變了(%)—— 可能有人正靠這條 policy 活著', v_m;
--       END IF;
--       IF NOT EXISTS (
--            SELECT 1 FROM pg_catalog.pg_policy p
--              JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
--              JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
--             WHERE ns.nspname='public' AND c.relname='customers'
--               AND p.polname='customers_update_service_role'
--               AND p.polcmd='w'::"char" AND p.polpermissive
--               AND p.polroles = ARRAY[v_sr]::oid[]
--               AND p.polqual      IS NOT NULL AND pg_catalog.pg_get_expr(p.polqual,      p.polrelid)='true'
--               AND p.polwithcheck IS NOT NULL AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)='true') THEN
--         RAISE EXCEPTION '這條 policy 已經不是本檔建的那個樣子了 ⇒ 有人改過它 ⇒ 先看過再決定要不要刪';
--       END IF;
--     END $r$;
--     DROP POLICY customers_update_service_role ON public.customers;
--   COMMIT;
--
-- 🛑 **貼了之後不會有任何東西變綠, 也不會有任何畫面變化** —— BYPASSRLS 還在的時候
--    PostgreSQL 根本不會去看 policy。本檔今天的價值是【預先鋪路】, 不是【換了一條路】。
