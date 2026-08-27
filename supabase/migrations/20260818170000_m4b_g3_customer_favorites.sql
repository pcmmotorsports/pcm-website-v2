-- 20260818170000_m4b_g3_customer_favorites.sql
-- 收藏(favorites)後端 —— `#191` 的表 / RLS / 權限那一半。
--
-- plan(已批):`docs/specs/2026-08-18-g3-favorites-plan.md`
--   Sean 2026-08-18 逐字「5️⃣ 收藏功能（愛心）A: 批」
--   🔴 **射程:批的是「可以開始做」,不是「可以直接動正式庫」** ⇒ apply 由主視窗跑。
--
-- ══ 0. 為什麼要有這張表(現況,量到的) ═══════════════════════════════════════════
--
--   兩顆愛心的 onClick 都只有 `setLiked(!liked)` = **純 React 畫面狀態**
--     `ProductCard.tsx:155` / `ProductInfo.tsx:197`
--     (`ProductInfo` 那半可窮舉:全檔 `liked` 6 命中,無一在 effect / localStorage / 送 server 的路徑上)
--   `FavoritesTab.tsx` 是**純靜態元件**(零 props / 零 state / 零 hook)⇒ 無條件印空狀態
--     ⇒ **不是「查到 0 筆」,是根本沒有資料源**
--   後端零(2026-08-18 實掃):
--     `grep -rln favorite supabase/migrations/` ⇒ 0 命中
--     `grep -rln favorite packages/ --include='*.ts' | grep -v '\.test\.'` ⇒ 0 命中
--   ⇒ 病的形狀不是「功能沒做」,是「**功能沒做,而畫面說做好了**」
--     (點愛心變紅 ⇒ 重新整理 12 顆紅的 0 顆 ⇒ 收藏清單仍然空的;每一步都在真瀏覽器點過)
--
-- ══ 1. 表形狀的三個決定(各自寫理由,別讓下一個人以為是隨手寫的)═══════════════════
--
--   ① **複合主鍵,不用 surrogate `id`** —— 同一人同一商品只能有一筆,**由 DB 保證**,
--      不靠應用層去重。⚠️ 這**偏離**同 repo 客人自有子表的慣例
--      (`20260523034911_init_customers_and_subtables.sql:41` 的 `id uuid PRIMARY KEY`),
--      偏離理由就是上一句。
--   ② **兩邊都 `ON DELETE CASCADE`** —— 客人刪帳號 ⇒ 他的收藏跟著消失,不留孤兒。
--      🔴 **更正(codex 對抗審查 must-fix)**:~~商品下架 ⇒ 收藏自動消失~~ **那句是假的。**
--      本站商品是**軟下架**(`products.delisted_at`,`20260602135934_s1_supplier_slug_delisted_clean_metadata.sql:50`
--      逐字「不硬刪避免撞訂單」)⇒ **不是 DELETE ⇒ cascade 不會觸發 ⇒ 收藏列會留著。**
--      ⚠️ 而 `products_select_public` 的 RLS 是 `USING (delisted_at IS NULL)` ⇒ **那個商品對客人隱形**
--      ⇒ **應用層要處理「收藏指向一個已下架商品」這個狀態**(列表 join 不到 ⇒ 要嘛不顯示、要嘛顯示
--      「已下架」)。本 migration 不處理它,**寫在這裡讓做前端那半的人不會漏掉**。
--      `products` 那邊的 cascade 只在**真的硬刪**時才有意義(今天沒有那條路)。
--   ③ 🔴 **不放任何商品快照欄**(標題 / 價格 / 圖)——
--      收藏是「**指向一個商品**」,不是「**當時那個商品的樣子**」。
--      ⚠️ 與訂單**相反**:`order_items` 有 `product_snapshot` 是因為訂單要記成交當下;
--      收藏沒有這個需求,放了只會多一份會過期的複本。
--   🔴 **不與購物車混**:`docs/phase-1-backlog.md:5058` 逐字
--      「favorites 與 cart(localStorage mock)語義不同、應各自 entity、別混」。
--
-- ══ 2. 🔴 撞名當場紅 —— 不靜靜跳過 ═══════════════════════════════════════════
--   (`20260817070000_m4b_231_3_sweeper_heartbeat.sql:21` 逐字的教訓:
--    「撞名要當場紅,不要靜靜跳過。跳過之後,你的 REVOKE 與斷言會對著那個既有物件跑」)
--   ⇒ 本檔**不用** `CREATE TABLE IF NOT EXISTS`。

BEGIN;

DO $collision_guard$
BEGIN
  IF to_regclass('public.customer_favorites') IS NOT NULL THEN
    RAISE EXCEPTION
      'customer_favorites 已經存在 —— 本檔預期是新建。'
      '若這是重跑，請先確認既有那張表是不是本檔建的（它的 REVOKE 與斷言會對著它跑）。拒繼續。';
  END IF;
END
$collision_guard$;

CREATE TABLE public.customer_favorites (
  customer_user_id uuid        NOT NULL REFERENCES public.customers(user_id) ON DELETE CASCADE,
  product_id       uuid        NOT NULL REFERENCES public.products(id)       ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_user_id, product_id)
);

COMMENT ON TABLE public.customer_favorites IS
  '會員收藏清單（#191）。一列 = 一個人收藏了一個商品。'
  '複合主鍵：同一人同一商品只能一筆，由 DB 保證去重，不靠應用層。'
  '刻意不放商品快照欄：收藏指向商品本身，不是當時那個商品的樣子（與 order_items 相反）。'
  '零金額／零訂單資訊。'
  '⚠️ 【不是零個資】（codex 對抗審查 must-fix，原本誤標「零 PII」）:'
  'customer_user_id 與 auth.users 1:1、是持久識別碼，搭配收藏紀錄即為可歸屬個人的偏好資料。'
  '⇒ 匯出／備份／log 都要當個資處理。'
  'Sean 2026-08-18 拍板「要登入才能收藏」⇒ 沒有匿名收藏這個狀態。';

-- 依 created_at 倒序列出某人的收藏（會員中心「收藏清單」的查詢形狀）。
-- PK 已涵蓋 (customer_user_id, …) 的等值查找，這支補的是排序。
CREATE INDEX customer_favorites_owner_recent_idx
  ON public.customer_favorites (customer_user_id, created_at DESC);

-- 🔴 FK 反向索引(codex 對抗審查 must-fix):PK 與上面那支**都以 `customer_user_id` 開頭**
--    ⇒ 沒有任何索引以 `product_id` 開頭。**PostgreSQL 不會替 referencing 端的 FK 自動建索引**
--    ⇒ 真的硬刪一個商品時,cascade 必須**全表掃描**這張收藏表,資料一多就是慢刪除 + 長時間鎖。
--    ⚠️ 今天商品走軟下架(見上)、硬刪那條路不常走 —— 但**索引是為了「那一天」而建的**,
--       而那一天出事時它是在**別人正在用的正式庫**上。
CREATE INDEX customer_favorites_product_idx
  ON public.customer_favorites (product_id);

-- ══ 3. 🔴🔴 出生自帶的預設授權,當場收掉 —— 四個角色,一個都不能少 ═══════════════
--
-- 🔴 **`service_role` 那一行是這裡最容易漏的**:`E683-1`(`20260817060000`)的射程
--    **刻意只收 `anon` 與 `authenticated`、不含 `service_role`**
--    ⇒ 新表出生時 `service_role` 仍自帶 `Dxtm`(含 DELETE / TRUNCATE)。
--    📎 實錘:`20260817070000_m4b_231_3_sweeper_heartbeat.sql:9-13` ——
--       那支就是**被自己的斷言擋在這一格**(它 REVOKE 了三個角色、漏了 `service_role`)。
-- 🔴 **兩道都要下**:`FROM PUBLIC` 收不到具名授權,`FROM 具名` 收不到 `PUBLIC` 授權。
-- 🔴 **即使 `E683-1` 先 apply,這幾行也不能省**:`ALTER DEFAULT PRIVILEGES` 只作用於
--    **apply 時刻之後**建的物件,而兩支的 apply 順序若被換過,省掉的那道就沒了。
-- 🔴 **`TRUNCATE` 不受 RLS 管** ⇒ RLS **不是**這幾行的替代品。
REVOKE ALL ON public.customer_favorites FROM PUBLIC;
REVOKE ALL ON public.customer_favorites FROM anon;
REVOKE ALL ON public.customer_favorites FROM authenticated;
REVOKE ALL ON public.customer_favorites FROM service_role;

-- ══ 4. 窄放:只放客人自己要用的三個動作 ══════════════════════════════════════
--
-- 🔴 **刻意不給 `UPDATE`** —— 一筆收藏沒有可改的東西(複合主鍵 + `created_at`)。
--    收藏只有「有」與「沒有」,改變狀態走 INSERT / DELETE。少一個權限就少一條路。
--    ⚠️ 這**偏離** `customer_addresses` 的 `SELECT, INSERT, UPDATE, DELETE`
--    (`20260523034911_init_customers_and_subtables.sql:236`),偏離理由就是上一句。
-- 🔴 **`anon` 一個都不給** —— Sean 拍板「要登入才能收藏」⇒ 匿名收藏這個狀態不存在。
-- 🔴 **`service_role` 也一個都不給** —— 今天沒有任何 server 端路徑需要碰這張表
--    (storefront 走客人自己的 `authenticated` JWT)。**要用的時候再顯式加,不預留。**
--    ⚠️ 連帶:本表**不建 `service_role` 的 policy**。
--    這與 `sweeper_heartbeat` 的處理**相反**,而理由不同:那張表的寫入者**就是** server,
--    本表的寫入者是**客人自己**。⇒ 不是不一致,是不同的使用者。
GRANT SELECT, INSERT, DELETE ON public.customer_favorites TO authenticated;

-- ══ 5. RLS:自讀自寫,形狀抄同 repo 既有的客人自有子表 ═══════════════════════════
--   (`20260523034911_init_customers_and_subtables.sql:166-181` 的 addresses 四條;
--    本表少一條 UPDATE,對應上面不給 UPDATE 權限。)
ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_favorites_select_own ON public.customer_favorites
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_user_id);

CREATE POLICY customer_favorites_insert_own ON public.customer_favorites
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_user_id);

CREATE POLICY customer_favorites_delete_own ON public.customer_favorites
  FOR DELETE TO authenticated
  USING (auth.uid() = customer_user_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  6. 新物件收權 fail-closed 斷言
--
--  🔴🔴 **本檔【不能】逐字套 `E-684` 樣板,而這一段就是那份白名單** ——
--     樣板斷言的是「`anon` **與** `authenticated` 兩者權限全零」,
--     而**本表必須給 `authenticated` 三個權限**(客人要讀寫自己的收藏)
--     ⇒ 逐字套的話,**這支 migration 會被自己的斷言擋死**。
--     📎 樣板 §5-2 自己寫著:widen 之後「**a documented allowlist becomes mandatory.
--        THIS IS AN EXEMPTION AND IT IS WRITTEN DOWN.**」⇒ 下面就是那份寫下來的豁免。
--
--  豁免清單與理由(逐條):
--    `authenticated` 允許 SELECT / INSERT / DELETE  ← 客人讀寫自己的收藏，這就是本表的用途
--    其餘一律零,**含 `authenticated` 的 TRUNCATE**  ← TRUNCATE 不受 RLS 管，給了等於給全刪
--
--  🔴 權限型別**由伺服器推導,不手寫**(`sweeper_heartbeat:180-186` 的教訓:
--     樣板手寫七種,而 PG 17 有八種 —— 少了 `MAINTAIN`,而它自己舉的例子就是 `anon=MAINTAIN`)。
-- ═══════════════════════════════════════════════════════════════════════════
DO $newobj_guard$
DECLARE
  -- 🔴 沿用 E-684 樣板的 `v_relations` 這個名字,**不是為了好看** ——
  --    `scripts/migration-static-checks.sh` ③ 用它來機械比對
  --    「本檔建了幾個可授權物件」vs「斷言清單列了幾個」,防的是**忘記列**。
  --    改用別的變數名 ⇒ 那道靜態閘看不到我的清單 ⇒ 它會判我漏列(我第一版就是那樣被擋的)。
  --    🔴 結尾的 `::text[]` 不能拿掉 —— 清單清空時 `ARRAY[]` 無法推斷型別。
  v_relations text[] := ARRAY[
    'public.customer_favorites'
  ]::text[];
  -- 🔴 白名單:角色 -> 允許的權限。**其餘全部必須是零。**
  v_allowed_authenticated text[] := ARRAY['SELECT', 'INSERT', 'DELETE']::text[];
  r          text;
  v_rel      oid;
  v_priv     text;
  v_col      text;
  v_bad      int  := 0;
  v_first    text;
  v_cnt      int;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
  v_rel := to_regclass(r);
  IF v_rel IS NULL THEN
    RAISE EXCEPTION '收權斷言:找不到 % —— 沒建成或名字打錯。拒繼續。', r;
  END IF;

  -- 6a. 逐一權限型別(由 acldefault 推導,PG 之後加第九種會自動入列)
  FOR v_priv IN
    SELECT DISTINCT d.privilege_type
      FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_rel))) d
  LOOP
    -- anon / PUBLIC / service_role:一律零
    IF has_table_privilege('anon', v_rel, v_priv) THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('anon 仍有 %s', v_priv); END IF;
    END IF;
    IF has_table_privilege('service_role', v_rel, v_priv) THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('service_role 仍有 %s（本表刻意不給）', v_priv); END IF;
    END IF;
    -- authenticated:只准白名單那三個
    IF has_table_privilege('authenticated', v_rel, v_priv)
       AND NOT (v_priv = ANY (v_allowed_authenticated)) THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN
        v_first := format('authenticated 仍有 %s（白名單只有 SELECT/INSERT/DELETE）', v_priv);
      END IF;
    END IF;
    -- 🔴🔴 反向:白名單那三個【必須真的有】——【這一列就是本斷言的正向對照】。
    --    GR 對 plan 的 must-fix ① 擔心的是:前面那幾列在「誰都碰不到」的世界裡**恆真**
    --    (全部零權限 ⇒ 每一條「不該有」都成立 ⇒ 斷言綠,而功能是壞的)。
    --    ⇒ 這一列讓那個世界**紅**:少了 SELECT/INSERT/DELETE 任一個就炸。
    --    實測(2026-08-18):拿掉 `GRANT … TO authenticated` ⇒ 紅 3 項,第一項「authenticated 少了 DELETE」。
    --    ⇒ **本斷言不是恆真的,而那是量出來的、不是宣稱的。**
    IF v_priv = ANY (v_allowed_authenticated)
       AND NOT has_table_privilege('authenticated', v_rel, v_priv) THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN
        v_first := format('authenticated 少了 %s —— 客人會收藏不了，而 apply 本來會靜靜通過', v_priv);
      END IF;
    END IF;
  END LOOP;

  -- 6b. 🔴 欄級授權要另外問 —— has_table_privilege 對【只有欄級授權】的情況回 false
  --     (E-684 第一版就是被這個打穿的)
  FOR v_col IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
      IF has_column_privilege('anon', v_rel, v_col, v_priv)
         OR has_column_privilege('service_role', v_rel, v_col, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN
          v_first := format('欄級授權殘留:%s 上的 %s', v_col, v_priv);
        END IF;
      END IF;
      -- 🔴 `authenticated` 的欄級也要問(codex must-fix):表級白名單只認 SELECT/INSERT/DELETE,
      --    而 `GRANT UPDATE (created_at) TO authenticated` 這種**欄級**授權
      --    會讓 `has_table_privilege(…,'UPDATE')` **仍然回 false**
      --    ⇒ 表級那一圈看不到它 ⇒ 斷言會綠,而註解還在宣稱「恰好三個權限」。
      --    ⇒ 只有 SELECT / INSERT 是白名單內的(表級已給),`UPDATE` / `REFERENCES` 一律紅。
      IF v_priv IN ('UPDATE', 'REFERENCES')
         AND has_column_privilege('authenticated', v_rel, v_col, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN
          v_first := format('authenticated 有欄級 %s(%s)—— 表級白名單看不到它', v_priv, v_col);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- 6b-2. 🔴 attacl 全掃(GR 對 plan 的 nit 3;形狀 `b1b:467-477`)——
  --    上面 6b 只問了三個【我想得到的】角色。這一道改問資料本身:
  --    **新表出生時 `pg_attribute.attacl` 必定是空的** ⇒ **非空即紅、零誤報**。
  --    它涵蓋**任何角色**(含日後才建的自訂角色),補上 6b 那三個具名角色的射程缺口。
  --    ⚠️ 但它只涵蓋**欄級**;表級的自訂角色仍在 §7-⑤ 的已知限制裡。
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attacl IS NOT NULL
  ) THEN
    v_bad := v_bad + 1;
    IF v_first IS NULL THEN
      v_first := '有欄級授權存在（新表出生時該是空的）—— 任何角色都算，含自訂角色';
    END IF;
  END IF;

  -- 6c. RLS 必須開,且 policy 恰好三條(select / insert / delete，皆 own-only)
  SELECT count(*) INTO v_cnt FROM pg_class WHERE oid = v_rel AND relrowsecurity;
  IF v_cnt <> 1 THEN
    v_bad := v_bad + 1;
    IF v_first IS NULL THEN v_first := 'RLS 沒開 —— 客人會讀到別人的收藏'; END IF;
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_policy WHERE polrelid = v_rel;
  IF v_cnt <> 3 THEN
    v_bad := v_bad + 1;
    IF v_first IS NULL THEN
      v_first := format('policy 數 %s ≠ 3 —— 多了或少了都要人看過再放行', v_cnt);
    END IF;
  END IF;

  -- 🔴🔴 **policy 的【內容】也要驗,不能只數三條**(codex 對抗審查 must-fix):
  --    只數數量的話,把 SELECT policy 的 `USING` 改成 `true`、或把 `TO authenticated` 改成 `TO PUBLIC`,
  --    **仍然是三條、apply 仍然全綠,而 A 就看得到 B 的收藏。**
  --    ⇒ 「數量對」與「擋得住」是兩件事,而只驗前者會讓後者靜默失守。
  --    判準:每一條的 qual/with_check 都必須同時提到 `auth.uid()` 與 `customer_user_id`,
  --         且角色恰好是 `authenticated`(不是 PUBLIC、不是別的)。
  SELECT count(*) INTO v_cnt
    FROM pg_policy p
   WHERE p.polrelid = v_rel
     AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
     AND coalesce(pg_get_expr(p.polqual, v_rel), pg_get_expr(p.polwithcheck, v_rel)) LIKE '%auth.uid()%'
     AND coalesce(pg_get_expr(p.polqual, v_rel), pg_get_expr(p.polwithcheck, v_rel)) LIKE '%customer_user_id%';
  IF v_cnt <> 3 THEN
    v_bad := v_bad + 1;
    IF v_first IS NULL THEN
      v_first := format(
        '只有 %s 條 policy 同時滿足「角色恰好 authenticated」與「條件含 auth.uid() 與 customer_user_id」（該是 3）'
        ' —— 有人把 own-only 改鬆了，而條數不變', v_cnt);
    END IF;
  END IF;

  END LOOP;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'customer_favorites 收權斷言失敗（% 項）；第一項:%。拒繼續。', v_bad, v_first;
  END IF;

  RAISE NOTICE 'customer_favorites 收權斷言通過:anon/PUBLIC/service_role 全零、authenticated 恰好 SELECT/INSERT/DELETE（含欄級）、RLS 開、policy 3 條且皆 own-only。';
END
$newobj_guard$;

-- ═══════════════════════════════════════════════════════════════════════════
--  7. 🔴 這支斷言【不能】做的事 —— 寫下來,免得被當成全面防護
--     (前四條沿用 `E-684` 樣板 §5;⑤⑥ 是 codex 對抗審查 2026-08-18 補的)
-- ═══════════════════════════════════════════════════════════════════════════
--   ① 它只檢查**本檔列出來的物件**(`v_relations`)。漏列一個它不會知道。
--      ⇒ 它防的是「忘記收權」,**不防「忘記列」**。(那一格由 `scripts/migration-static-checks.sh` ③ 機械把關。)
--   ② 它**在 apply 當下判斷**;日後有人手動 `GRANT`,它不會回頭紅。
--   ③ 它不檢查既有的其他 migration。
--   ④ 空清單要明示 opt-in —— 本檔清單非空,不適用。
--   ⑤ 🔴 **它不檢查自訂角色,也不檢查 `SET ROLE` 這條路。**
--      具體失敗情境(codex 給的):若日後有人建 `favorites_ops` 並給它 `TRUNCATE`,
--      再讓 `authenticated` 可以 `SET ROLE favorites_ops`
--      ⇒ 本檔三個 `has_table_privilege('anon'/'authenticated'/'service_role', …)` **全都還是綠的**,
--        而切完角色就能清表(**`TRUNCATE` 不受 RLS 管**)。
--      ⇒ 本檔**不解這一格**(它要的是全庫角色圖,不是單表斷言);
--        寫在這裡,讓下一個建自訂角色的人知道**這道閘看不到他**。
--   ⑥ 🔴 **它不檢查 `WITH GRANT OPTION`。** 上面用的是 `has_table_privilege(role, rel, priv)`,
--      而那個形式**不區分**「有這個權限」與「有這個權限且可轉授」。
--      本檔自己沒有下任何 `WITH GRANT OPTION`,所以 apply 當下不會有;
--      但**它不會擋住日後有人加**。
--
--  ⇒ 以上六條的共同形狀:**這是一道【單表、單時點】的閘。**
--    它擋得住「這一支 migration 忘記收權」,擋不住「整個庫的權限圖後來變壞」。

COMMIT;
