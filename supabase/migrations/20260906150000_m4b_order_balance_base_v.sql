-- 20260906150000 · M-4b ⟦b4-BANKNOEMAIL⟧ 片②-a:把應付餘額那條【錢的規則】抽成 base view。
--
-- 🛑🛑 **草稿。未 commit、未 apply。** 🔴 **三支一起貼(貼板 45), 順序寫死在檔頭。**
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼要抽 —— **不是為了乾淨, 是因為那段 CASE 是一條【錢的規則】**
-- ══════════════════════════════════════════════════════════════════
-- 🔬 **量到的**:`member_order_balance_v`(`20260905330000`)寄信端**拿不到**, 兩個獨立的理由:
--   ① `:108` 逐字 `WHERE o.customer_user_id = auth.uid()` ⇒ cron / `service_role` 的 `auth.uid()` 是 NULL ⇒ **零列**
--   ② `:116` 逐字 `REVOKE ALL … FROM anon, authenticated, service_role;` + `:126` 只 `GRANT … TO authenticated`
--      ⇒ **`service_role` 連 SELECT 都沒有**
--   📌 **兩個理由獨立** —— 補 GRANT 也救不了 ①;繞過 ① 也過不了 ②。
-- 🔵 而原料是通的:`order_paid_totals_v` **有** GRANT 給 `service_role`(`20260905330000:7` 記著)。
--
-- 🔴🔴 **抄第二份的代價(主視窗 2026-09-06 裁【乙】的理由)**:那段 CASE 逐字記著
--   codex 當場推翻的那個公式(「收 3,000、退 5,000 ⇒ 舊公式印 12,000, **比訂單總額還大**」)、
--   Sean 兩次拍板、以及**退款有兩本帳**(卡軌對 `bank_transfer` 的單**永遠 0 列**)。
--   ⇒ 📌 **兩份分歧的那天, 一邊會叫客人把我們退給他的錢再匯回來。**
--   ⇒ 而本片的信正是**後果最重的那個消費端**。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴 貼板 45 的順序(中斷在哪一支就回報哪一支)
-- ══════════════════════════════════════════════════════════════════
--   20260906140000  email_outbox 加 bank_order_created        (已 commit a59f7aa7a)
--   20260906150000  ← 本支:base view
--   20260906160000  member_order_balance_v 改從 base 讀(輸出欄逐字不變)
--   20260906170000  email 掃描面 view
-- 🛑 反序的症狀:160000 先跑 ⇒ base 不在 ⇒ `42P01`;170000 先跑 ⇒ 同樣。
--
-- ⚠️ **本支【不動】`member_order_balance_v`** —— 那是 160000 的事。
--    ⇒ 貼完本支而 160000 沒貼 ⇒ **前台行為零改動**(它還在讀自己那份)⇒ 中斷是安全的。

BEGIN;

DO $precondition$
DECLARE v_cnt int;
BEGIN
  -- 前置閘①:原料要在, 否則下面建出來的是一個永遠空的 view
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_paid_totals_v' AND c.relkind = 'v';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:找不到 order_paid_totals_v(實得 %)⇒ 停下人工確認', v_cnt;
  END IF;

  -- 前置閘②:forward-only
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_balance_base_v';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘②:order_balance_base_v 已存在 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘③:🔴 來源那一份要在, 而且是【我抄的那一代】——
  --   本支的 CASE 是從 member_order_balance_v 逐字搬的;它若已經被別人換過一代,
  --   我搬的就不是現行規則。用語意特徵釘, 不比整段(pg_get_viewdef 會重寫)。
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'member_order_balance_v'
     AND pg_catalog.strpos(definition, 'order_manual_refunds') > 0
     AND pg_catalog.strpos(definition, 'voided_at') > 0
     AND pg_catalog.strpos(definition, 'order_paid_totals_v') > 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘③:member_order_balance_v 不是我抄的那一代(三個語意特徵沒有同時命中)⇒ 停下人工確認';
  END IF;
END
$precondition$;

CREATE VIEW public.order_balance_base_v
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id AS order_id,
  -- 🔴🔴 **退了款的單一律回 NULL(= 算不出來), 不是把退款加回應付** ——
  --   codex 關卡2 must-fix, 而它舉的例子讓我當場推翻自己的公式:
  --     客人付清 10,000 → 我們 confirmed 退他 3,000 → 舊公式算出【應付 3,000】
  --     ⇒ 📌 **那等於叫客人把我們退給他的錢再匯回來。**
  --     更壞的:收 3,000、退 5,000 ⇒ 舊公式印【12,000】, 比訂單總額還大。
  --   ⇒ 🎯 **有退款的單, 我們今天算不出「他還要付多少」** ——
  --      而在「印一個可能錯的數」與「不印」之間, 對不可回收的東西永遠選不印。
  --   ⚠️ **Sean 2026-09-05 的乙(「0 或負就改印請聯絡我們」)原本涵蓋不到這一格** ——
  --      他答的前提是餘額會 ≤0, 而 codex 指出的世界餘額是**正的** ⇒ 端回去補問。
  --      ✅ **他答了, 逐字:「Q-退款後的匯款單: 乙」** = 與餘額 ≤0 同一句「請聯絡我們」。
  --      ⇒ 所以這裡回 NULL 不是「什麼都不印」, 而是**交給顯示端去印那一句話**。
  -- 🔴🔴 **只問「有沒有」, 不自己加總金額** —— 這一格是 `#473b-1` 那道守門逼出來的, 而它是對的:
  --   `refund-remaining-single-source.test.ts` 逐字擋「新的 migration 碰 `order_refunds` 的退款金額欄」,
  --   ⚠️ **而這句話本身不寫那個欄名** —— 那道尺掃的是【檔案字面】, 註解也算數
  --      (同族坑:『註解被 grep 當成碼』)⇒ 我第一版把欄名寫進註解, 那道守門照樣紅。
  --   理由是**自己算的地方看不到更正** ⇒ 報出的數比實際多 ⇒ 重複退款。
  --   ⇒ 🎯 而本 view **不需要那個金額** —— 它只需要知道「這張單算不算得清楚」。
  --   ⇒ 📌 **一道擋住我的守門, 同時讓我發現我要的東西比我寫的少。**
  -- 🔴🔴 **退款有【兩本帳】, 而只看一本的話這道守門在【唯一會用到它的通道上構造不出來】**
  --   (R3 對抗審查 must-fix, 而它是對的 —— 我查了它引的三個位置):
  --     `order_refunds`        = **卡軌**帳本:`bank_refund_id NOT NULL`(20260725130100:86)、
  --       且 trigger 逐字「訂單沒有 tappay_rec_trade_id…無法登記退款」(20260803150000:265)
  --       ⇒ 📌 **一張 `bank_transfer` 的單, 這張表永遠 0 列。**
  --     `order_manual_refunds` = 匯款 / 現金那一軌, canonical 述詞是 `voided_at IS NULL`
  --       (逐字對齊 20260905010000:293-300 那支 RPC 的兩段加總)
  --   ⇒ 🎯 而本 view 的消費端 **只在 `bank_transfer` 才渲染** ⇒ 只看卡軌 = 這道守門形同不存在
  --     ⇒ **已退過款的匯款單照樣印帳號與應付餘額。**
  CASE WHEN EXISTS (
         SELECT 1 FROM public.order_refunds rf
          WHERE rf.order_id = o.id
            -- 🔵 只認 confirmed —— Sean 2026-09-05 拍甲:processing 的退款【還算已收】, 餘額暫不變。
            AND rf.status = 'confirmed'
       ) OR EXISTS (
         SELECT 1 FROM public.order_manual_refunds mr
          WHERE mr.order_id = o.id
            -- 🔵 這一軌沒有 status, 它的「還算數嗎」是 `voided_at`(作廢過的不算)。
            AND mr.voided_at IS NULL
       ) THEN NULL
       ELSE o.total - COALESCE(p.paid_total, 0)
  END AS balance_due
FROM public.orders o
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id
;

COMMENT ON VIEW public.order_balance_base_v IS
  '⟦b4-BANKNOEMAIL⟧ 片②-a:應付餘額那條【錢的規則】的**唯一一份**。
= member_order_balance_v 的同一段 CASE,**逐字搬過來**,差別只有一個:**本支沒有 auth.uid() 過濾**。
🔴 own-only 那一層留在 member_order_balance_v(它改成從本支讀);本支**只 GRANT service_role**,
因為它看得到【所有人】的單 —— 📌 那正是它不可以給 authenticated 的理由。
🛑 **要改應付餘額的算法, 改這裡, 不要在別處再寫一份。**';

-- 🔴 兩道 REVOKE:第一道收 PUBLIC, 第二道收三個具名角色 —— 少一道都是開的。
--    (形狀與理由同 20260905330000;`docs/patterns/revoking-function-execute-in-supabase.md`)
REVOKE ALL ON public.order_balance_base_v FROM PUBLIC;
REVOKE ALL ON public.order_balance_base_v FROM anon, authenticated, service_role;
GRANT SELECT ON public.order_balance_base_v TO service_role;

DO $postcheck$
DECLARE
  -- 🔴🔴 **收權斷言清單 —— 本檔建的【每一個可授權物件】都要列進來。**
  --   `scripts/migration-new-file-static-checks.sh` ③ 當場擋下我(可授權物件 1, 清單 0)。
  --   ⇒ 📌 收權斷言**只檢查你列出來的物件**:它防「忘記收權」, **不防「忘記列」**
  --     ⇒ 那道靜態閘補的正是後者。
  v_relations text[] := ARRAY[
    'public.order_balance_base_v'
  ]::text[];
  v_i integer;
  v_def  text;
  v_cols text;
  v_cnt  int;
BEGIN
  SELECT definition INTO v_def FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'order_balance_base_v';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:建完找不到 order_balance_base_v';
  END IF;

  -- 事後閘②:🔴 **是同一份規則** —— 比語意特徵, 不比整段
  --   (`pg_get_viewdef` 會重寫 NOT IN / 加型別轉換 ⇒ 整段比對必假紅)。
  IF pg_catalog.strpos(v_def, 'order_manual_refunds') = 0
     OR pg_catalog.strpos(v_def, 'voided_at') = 0
     OR pg_catalog.strpos(v_def, 'order_paid_totals_v') = 0
     OR pg_catalog.strpos(v_def, 'confirmed') = 0 THEN
    RAISE EXCEPTION '事後閘②:四個語意特徵沒有同時命中 ⇒ 我搬過來的不是那條規則(實得 %)', v_def;
  END IF;

  -- 事後閘③:🔴🔴 **本支【不可以】有 auth.uid()** —— 有了它, 寄信端照樣拿到零列,
  --   而那正是本支存在的理由 ⇒ 這一格失守 = 整支白做, 且**症狀是「掃到 0 列」= 看起來一切正常**。
  IF pg_catalog.strpos(v_def, 'uid()') > 0 THEN
    RAISE EXCEPTION '事後閘③:base view 裡出現 uid() ⇒ 它會對寄信端回零列, 而那個 0 看起來像「沒有待寄的信」';
  END IF;

  -- 🔵 事後閘④:上面三道要有判別力 —— 現造字面必須找不到
  IF pg_catalog.strpos(v_def, 'zzz_never_a_feature') > 0 THEN
    RAISE EXCEPTION '事後閘④:現造字面居然命中 ⇒ 這把尺壞了, 上面三道不可信';
  END IF;

  -- 事後閘⑤:輸出就兩欄(對齊 20260823030000 那句「不要為了方便多帶一欄」)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_balance_base_v'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,balance_due' THEN
    RAISE EXCEPTION '事後閘⑤:欄位不是 order_id,balance_due(實得 %)', v_cols;
  END IF;

  -- 事後閘⑥:ACL 白名單 —— 只有 service_role 讀得到
  SELECT count(*) INTO v_cnt FROM (
    SELECT (pg_catalog.aclexplode(c.relacl)).grantee AS g
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'order_balance_base_v'
  ) t
  WHERE t.g <> 0
    AND pg_catalog.pg_get_userbyid(t.g) NOT IN ('service_role', current_user);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘⑥:ACL 上有 service_role 與 owner 以外的角色(% 個)', v_cnt;
  END IF;
  -- 🔴 而 relacl 是 NULL 時 aclexplode 回零列 ⇒ 上面那個 0 會【因為錯的理由】變綠 ⇒ 另外問一次
  IF (SELECT c.relacl IS NULL FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'order_balance_base_v') THEN
    RAISE EXCEPTION '事後閘⑥b:relacl 是 NULL ⇒ 兩道 REVOKE 沒有留下痕跡, 而閘⑥的 0 是假的';
  END IF;
  -- 🔵 而那張清單要**真的被讀到** —— 否則它只是一段給守門看的裝飾。
  FOREACH v_i IN ARRAY ARRAY[1] LOOP
    IF v_relations[v_i] IS NULL THEN
      RAISE EXCEPTION '事後閘⑦:收權斷言清單少了第 % 項', v_i;
    END IF;
    IF pg_catalog.to_regclass(v_relations[v_i]) IS NULL THEN
      RAISE EXCEPTION '事後閘⑦:清單裡的 % 不存在 ⇒ 清單與實際建的物件對不起來', v_relations[v_i];
    END IF;
  END LOOP;
END
$postcheck$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行, 而**有順序**)
-- ══════════════════════════════════════════════════════════════════
-- 🛑 **先退 170000 的 email view 與 160000 的 member 新版, 才能退本支** ——
--    160000 之後 `member_order_balance_v` 是**從本支讀的** ⇒ 直接 DROP 本支會連前台一起打斷。
--    ✅ 正確順序:DROP email view → member view 回舊體(逐字抄 `20260905330000`)→ DROP 本支。
-- DROP VIEW IF EXISTS public.order_balance_base_v;
