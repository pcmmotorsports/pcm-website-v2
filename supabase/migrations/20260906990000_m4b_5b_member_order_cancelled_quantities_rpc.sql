-- ══════════════════════════════════════════════════════════════════════
-- 20260906990000 · ⟦ship-CANCELQTYTOSTOREFRONT⟧ 取消件數給客人看(丁案:窗口, 不拆牆)
-- 貼板 67(號由主視窗 -f1 2026-09-06 指派)
-- ══════════════════════════════════════════════════════════════════════
-- 🎯 **Sean 2026-09-06 Q18 拍甲**:取消件數給客人看。而**怎麼給**有兩條路, 主視窗裁**丁**。
--
-- ══ 為什麼不是「開權限」(甲案)══════════════════════════════════════════
-- `cancelled_quantity` 只住兩處, 而兩處都對客人關著:
--   · `order_item_quantity_summary`(`20260730150000`)—— RLS 開 + REVOKE ALL + 只授 `service_role`
--   · `order_cancellations` 族(`20260730130000`)—— REVOKE ALL FROM … authenticated
-- 而顧客訂單頁走 `createServerSupabaseClient()`, **不持 service_role**
-- ⇒ 🛑 直接把那張表內嵌進顧客投影 ⇒ **測試全綠而客人拿到空的**(本 repo:碼先上而權限沒開)。
--
-- 🔴 **甲案(欄級 GRANT + own-order policy)被否決的理由, 是量到的、不是偏好**:
--   ① 那張表**現在的安全姿態是「零 policy」**, 而**有一道斷言在守它** ——
--      `20260730150000:202` 逐字 RAISE 'A1-RLS-POLICY:本表應為 zero-policy,實查 % 條'
--      ⇒ 甲**必然要放寬那道斷言** ⇒ 📌 **放寬之後它就不再答得出「有沒有人偷偷加了第二條」。**
--   ② 同表還有 `ordered_quantity` / `instock_quantity` —— **那兩欄是採購節奏**(誰家有貨、到幾件)。
--      甲靠**欄級 GRANT 寫對**, 而 🔴 **欄級授權在 has_table_privilege 上少報**
--      (`docs/patterns/revoking-function-execute-in-supabase.md` 記過)⇒ 驗它得逐欄問。
--   ⇒ 🎯 **丁把那兩件事都變成【結構上做不到】, 而不是【要記得做對】。**
--
-- ══ 形狀照現成的先例, 不發明 ═══════════════════════════════════════════
-- `public.find_active_sibling_own(uuid)`(`20260624120001`)—— 同樣 SECDEF + 空 search_path
-- + (SELECT auth.uid()) + REVOKE ALL … FROM PUBLIC, anon, service_role + GRANT EXECUTE TO authenticated。
--
-- ══ 🛑 呼叫端的義務(寫在這裡, 因為它在 SQL 這一側看不見)════════════════
-- **回空 `{}` 有兩個意思**:①這張單真的沒有任何取消 ②**你不是這張單的主人 / 沒登入**。
-- 🔴 **而呼叫端【分得出來】, 所以它不把兩者混成一件事**(codex 2026-09-06 nit 訂正我原本的字面):
--    ⛔ ~~「回空 ⇒ 當作不知道」~~ —— 那句話**與碼不符**, 而碼是對的:
--    · **RPC 失敗 / 回傳不是物件 / 任一值壞掉** ⇒ 呼叫端傳 `null` ⇒ 「**不知道**」
--    · **回空物件 `{}`** ⇒ 呼叫端傳 `{}` ⇒ 「**問到了, 這張單沒有取消**」⇒ 取消量 0
--    🔵 **②那個世界(不是主人)在這條路上到不了** —— adapter 撈訂單時已經
--      `.eq('customer_user_id', customerId)` 過一次, 撈得到才會叫這支 RPC。
-- ⇒ 🛑 **仍然成立的那一半**:`null`(不知道)**絕不**當成「取消 0 件」——
--    📌 **那會把「我們不知道」講成「沒有取消」。**
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ══ 前置閘 ═══════════════════════════════════════════════════════════
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.order_item_quantity_summary') IS NULL
  THEN RAISE EXCEPTION '前置閘①:public.order_item_quantity_summary 不存在 ⇒ 20260730150000 沒貼過'; END IF;
  IF pg_catalog.to_regclass('public.orders') IS NULL
  THEN RAISE EXCEPTION '前置閘②:public.orders 不存在'; END IF;
  IF pg_catalog.to_regclass('public.order_items') IS NULL
  THEN RAISE EXCEPTION '前置閘③:public.order_items 不存在'; END IF;

  -- ④ 🔴 那張表【必須仍是零 policy】—— 本片的整個理由就是「不動它的安全姿態」。
  --    若它已經有 policy, 表示有人走了甲那條路 ⇒ 停下來看一眼, 不要在一個我沒讀過的世界上疊東西。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy
       WHERE polrelid = 'public.order_item_quantity_summary'::regclass) <> 0
  THEN RAISE EXCEPTION '前置閘④:order_item_quantity_summary 已經有 policy ⇒ 有人開過權限, 停下來看一眼'; END IF;

  -- ⑤ 本檔貼過了嗎
  IF pg_catalog.to_regprocedure('public.get_member_order_cancelled_quantities(uuid)') IS NOT NULL
  THEN RAISE EXCEPTION '前置閘⑤:函式已存在 ⇒ 本檔貼過了'; END IF;
END $$;

-- ══ 1. 那扇窗 ════════════════════════════════════════════════════════
CREATE FUNCTION public.get_member_order_cancelled_quantities(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_result jsonb;
BEGIN
  -- 🔴 匿名 / 缺參數 ⇒ 回空, 不報錯。報錯會讓呼叫端要分辨「壞了」與「沒有」,
  --    而那兩件事在畫面上要做的事一樣(不印那句括號)。
  IF v_uid IS NULL OR p_order_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- 🛑 歸屬比對在函式裡, 不在呼叫端 —— 這一段就是「窗口」本身:
  --    表維持零 policy, 而**能不能看**由這裡決定。
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = p_order_id
       AND o.customer_user_id = v_uid
  ) THEN
    RETURN '{}'::jsonb;
  END IF;

  -- 🔵 只回兩欄(品項 id ⇒ 取消件數)。
  --    ⇒ 📌 ordered_quantity / instock_quantity(採購節奏)**結構上到不了這個回傳值**,
  --      而那正是丁勝過欄級 GRANT 的地方:不靠人寫對。
  SELECT COALESCE(pg_catalog.jsonb_object_agg(oi.id::text, s.cancelled_quantity), '{}'::jsonb)
    INTO v_result
    FROM public.order_items oi
    JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
   WHERE oi.order_id = p_order_id;

  RETURN v_result;
END
$fn$;

ALTER FUNCTION public.get_member_order_cancelled_quantities(uuid) OWNER TO postgres;

-- 🔴 先收再給(本 repo 記過:新物件出生就自帶 Supabase 的 default privileges)。
REVOKE ALL ON FUNCTION public.get_member_order_cancelled_quantities(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_member_order_cancelled_quantities(uuid) FROM anon, service_role;
-- 🔴🔴 **本閘擋下來過, 而它擋得對**(`scripts/acl-drift-gate.py`;2026-09-06):
--    這一行 apply 之後**沒有任何東西會再量它** —— migration 裡的 ACL 斷言全是一次性的,
--    而正式庫從不 replay。⇒ 📌 **一條被打開而沒有人在看的權限。**
-- ✅ **而它是本片的【全部目的】**:誰要用 = **登入的客人自己**(顧客訂單明細頁);
--    為什麼不是 `service_role` = **那條路不持 service_role**(`createServerSupabaseClient()`),
--    而正是因為它不持, 才需要這扇窗 —— 若給 `service_role`, 這支函式對客人**恆等於不存在**。
-- 🛑 **豁免不是免責**:它換到的東西寫在 §2 事後閘③(authenticated t / anon f / service_role f)
--    與⑤(牆沒破:policy 0 / 表級 f / 欄級逐欄 f)—— 那幾格在 apply 時會紅。
--    而**它們同樣是一次性的** ⇒ 這一行的長期守門是**貼板 67b 那份對帳**(貼後要跑)。
-- ACL-GATE-EXEMPT: public.get_member_order_cancelled_quantities -- 顧客站不持 service_role, 這扇窗的唯一使用者就是登入的客人(⟦ship-CANCELQTYTOSTOREFRONT⟧, Sean 2026-09-06 Q18 甲, 貼板 67)
GRANT EXECUTE ON FUNCTION public.get_member_order_cancelled_quantities(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_member_order_cancelled_quantities(uuid) IS
$c$會員自己那張單的【每一品項取消了幾件】。⟦ship-CANCELQTYTOSTOREFRONT⟧(Sean 2026-09-06 Q18 甲)
🎯 **它是一扇窗, 不是一道拆掉的牆**:order_item_quantity_summary 維持
   **零 policy + 只授 service_role**, 而客人透過本函式看那幾欄裡的**一欄**。
🛑 **回空 {} 有兩個意思**:①真的沒有取消 ②**不是主人 / 沒登入**。
   ⇒ 呼叫端必須 fail-closed:**不知道 ≠ 取消 0 件**。
🔵 只回 (order_item_id ⇒ cancelled_quantity) ⇒ 採購節奏那兩欄結構上到不了客人。$c$;

-- ══ 2. 事後閘 ═══════════════════════════════════════════════════════
DO $$
DECLARE
  -- 🔴 **清單寫成陣列, 而那不只是為了過靜態檢查** ——
  --    `migration-static-checks.sh:③` 逐字:「收權斷言【只檢查你列出來的物件】:
  --    它防『忘記收權』, 不防『忘記列』」⇒ 📌 **以後這支檔多一個函式, 不列就過不了那道閘。**
  v_functions text[] := ARRAY['public.get_member_order_cancelled_quantities(uuid)']::text[];
  v_fn        text;
  v_bad       text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL
    THEN RAISE EXCEPTION '事後閘①:函式沒建起來 ⇒ %', v_fn; END IF;
  END LOOP;

  -- ② SECDEF 與 search_path —— 兩者缺一, 這扇窗就不是窗
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p
           WHERE p.oid = 'public.get_member_order_cancelled_quantities(uuid)'::regprocedure)
  THEN RAISE EXCEPTION '事後閘②a:不是 SECURITY DEFINER ⇒ 它讀不到那張表, 對客人恆空'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'public.get_member_order_cancelled_quantities(uuid)'::regprocedure
                    -- 🔬 **字面是量出來的, 不是猜的**:PG 把 SET search_path = '' 存成
                    --    `search_path=""`(**帶兩個雙引號**), 不是 `search_path=`。
                    --    ⛔ 我第一版寫 `'search_path='` ⇒ 本閘當場把自己的 migration 擋下來
                    --    ⇒ 📌 **那正是它該做的** —— 而如果我當時改的是【期望值】而不是【判準】,
                    --      它就會變成一道永遠不會紅的閘。
                    AND p.proconfig @> ARRAY['search_path=""']::text[])
  THEN RAISE EXCEPTION '事後閘②b:沒有把 search_path 設成空 ⇒ SECDEF 函式的搜尋路徑可被呼叫端左右'; END IF;

  -- ③ 授權:authenticated 叫得動, 而 anon / service_role 叫不動
  IF NOT pg_catalog.has_function_privilege('authenticated',
           'public.get_member_order_cancelled_quantities(uuid)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘③a:authenticated 叫不動 ⇒ 客人拿不到, 而畫面不會說'; END IF;
  IF pg_catalog.has_function_privilege('anon',
       'public.get_member_order_cancelled_quantities(uuid)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘③b:anon 叫得動'; END IF;
  IF pg_catalog.has_function_privilege('service_role',
       'public.get_member_order_cancelled_quantities(uuid)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘③c:service_role 叫得動(本片刻意只給 authenticated)'; END IF;

  -- ④ 🔴🔴 逐個 grantee 看過 —— 上面三格只問三個角色, 而 GRANT 給別的具名角色它們問不到。
  SELECT pg_catalog.string_agg(g.grantee::pg_catalog.regrole::text, ', ')
    INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
   WHERE p.oid = 'public.get_member_order_cancelled_quantities(uuid)'::regprocedure
     AND g.grantee <> 0
     AND g.grantee <> p.proowner
     AND g.grantee::pg_catalog.regrole::text <> 'authenticated';
  IF v_bad IS NOT NULL
  THEN RAISE EXCEPTION '事後閘④:函式上有預期外的 grantee ⇒ % ⇒ 停下來看一眼', v_bad; END IF;

  -- ⑤ 🔴 牆沒有被拆 —— 本片的整個承諾就是這一句。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy
       WHERE polrelid = 'public.order_item_quantity_summary'::regclass) <> 0
  THEN RAISE EXCEPTION '事後閘⑤a:那張表多了 policy ⇒ 本片不該碰它'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.order_item_quantity_summary', 'SELECT')
  THEN RAISE EXCEPTION '事後閘⑤b:authenticated 讀得到那張表 ⇒ 牆破了'; END IF;
  -- ⑤c 🔴 **RLS 開關本身也要問**(codex 2026-09-06 nit:⑤ 有盲區)——
  --    「零 policy」在 **RLS 關著**的世界裡是**恆真**的, 而那個世界底下表是全開的
  --    ⇒ 📌 **`policy 數 = 0` 這個綠, 有兩個完全相反的成因。**
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
           WHERE c.oid = 'public.order_item_quantity_summary'::regclass)
  THEN RAISE EXCEPTION '事後閘⑤c:那張表的 RLS 是關的 ⇒ 「零 policy」在這個世界裡不代表任何事'; END IF;
  -- ⑤d 🔴 **欄級授權要逐欄問**(同上)—— 表級 `has_table_privilege` 對欄級 GRANT **少報**
  --    (`docs/patterns/revoking-function-execute-in-supabase.md` 記過)
  --    ⇒ ⑤b 綠而 `cancelled_quantity` 被單獨授出去, 這裡才看得到。
  IF pg_catalog.has_column_privilege('authenticated', 'public.order_item_quantity_summary', 'cancelled_quantity', 'SELECT')
  THEN RAISE EXCEPTION '事後閘⑤d:authenticated 對 cancelled_quantity 有欄級授權 ⇒ 牆從欄那一層破了'; END IF;
  IF pg_catalog.has_column_privilege('authenticated', 'public.order_item_quantity_summary', 'instock_quantity', 'SELECT')
  THEN RAISE EXCEPTION '事後閘⑤e:authenticated 對 instock_quantity 有欄級授權 ⇒ 採購節奏外流'; END IF;
  -- 🟢 正對照:該讀得到的角色仍讀得到 —— 否則上面那格在「誰都讀不到」的世界裡也綠, 而後台是壞的。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_item_quantity_summary', 'SELECT')
  THEN RAISE EXCEPTION '事後閘⑤正對照:service_role 讀不到那張表 ⇒ 後台那條路壞了, 上面兩格不算數'; END IF;
END $$;

COMMIT;
