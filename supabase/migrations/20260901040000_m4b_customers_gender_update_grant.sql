-- 20260901040000_m4b_customers_gender_update_grant.sql
-- 🔴 改號紀錄(2026-09-01 04:5x):本檔原為 `20260901020000`,與線【券】`-7a` 的
--   `20260901020000_m4b_coupon_p3b_order_coupon_id.sql` **撞號**(主視窗收割時的同號掃描抓到)。
--   改的是本支而不是那支,判準**不是先來後到**:那個號被 4 支檔引用(含一支前置閘逐字要求
--   先 apply 它),而本支的引用只有自己的檔名 ⇒ **改本支的成本是零**。
--   帳本 `APPLIED.tsv` 兩支皆 0 ⇒ 都沒 apply ⇒ 改號不影響正式庫。
-- ⟦客戶篩選多軸⟧ 會員中心那一片:把 `gender` 加進 `customers` 的欄級 UPDATE GRANT。
--
-- ══ 🔴🔴 §0 沒有這一支,會員中心那一格是【死的】—— 而它死得很安靜 ══════════════
--   `20260831140000` 加了 `customers.gender` 這一欄,而**欄級 GRANT 沒有跟著加**。
--   ⇒ `authenticated` 對這張表的 UPDATE 權限逐字是:
--       `20260523034911:231` GRANT UPDATE (name, phone, birthday, updated_at) … TO authenticated;
--   ⇒ 📌 **欄級 GRANT 是白名單** —— 不在名單上的欄,寫入時 PostgreSQL 回 `42501 permission denied`。
--   🛑 而它的症狀不是「存不了性別」,是**整筆 UPDATE 被拒** ⇒ 連姓名手機生日一起存不進去。
--   ⚠️ 而前端那一頁**接得住**(`account/profile/actions.ts` 有 formError 通道)——
--      使用者會看到「儲存失敗,請稍後再試」,而**看不出是哪一欄害的**。
--      ⇒ 那正是這一支要解掉的東西,不是「順便補的權限」。
--
-- ══ §1 為什麼是【兩個角色】而不是一個 ═══════════════════════════════════════
--   `authenticated`  客人自己在會員中心改 ⇒ 走 RLS `customers_update_own`(auth.uid() = user_id)
--   `service_role`   後台代改 ⇒ `20260717010000:175` 另有一條同形狀的 GRANT
--   ⇒ 🔴 **兩條都要加** —— 只加一條的話,另一條路今天不會紅,而它會在**別人做後台那片時**才炸,
--      到時候沒有人會聯想到這一支。
--   🔵 而 `updated_at` 已經在名單上、由 trigger 強制覆寫(`20260523034911` 的
--      `customers_set_updated_at`)⇒ 本檔不動它。
--
-- ══ §2 不 apply ══════════════════════════════════════════════════════════════
--   本檔由 Sean 本人在 SQL Editor 貼;施工窗不 apply、不碰正式庫。
--   🛑 而**交件前要由有唯讀連線的窗先跑一次檢查段**(2026-09-01 新常設,成因:
--      性別 view 那支讓 Sean 白貼了兩次,而兩次都是假警報)。
--
-- ══ ⚠️ §3 本檔【不看】什麼 ═══════════════════════════════════════════════════
--   ① 它不看 RLS —— `customers_update_own` 那條 policy 在不在、對不對,本檔一個字沒驗。
--      欄級 GRANT 與 RLS 是**兩道獨立的門**,兩道都要過才寫得進去。
--   ② 它不看 `customers_gender_chk` —— 值域那道由 `20260831150000` 管。
--   ③ 它不驗行為 —— 「客人真的存得進去」要開瀏覽器點一次,而那不在 SQL 裡。

BEGIN;

-- 🔵 house 值,照 `20260811060000:54-58`。GRANT 要取得 table 的鎖。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ══ 1. 兩條 GRANT ════════════════════════════════════════════════════════════
-- 🔵 GRANT 是**累加**的 ⇒ 這兩行冪等:已經有的欄不會被動到,只多一個 `gender`。
--    ⇒ 所以不需要先 REVOKE,而**也不該** REVOKE —— 那會在中途把客人的寫入權關掉。
-- ACL-GATE-EXEMPT: public.customers -- 客人自己在會員中心改性別,只有 authenticated 是他本人(20260901040000, 2026-09-01)
-- 🔴 **豁免的理由要寫得出「誰要用、為什麼不是 service_role」,而這裡是**:
--   誰要用 = **客人本人**。會員中心那一頁 (`apps/storefront/src/app/account/`) 走的是
--   `createServerSupabaseClient()` = **authenticated** 身分 + RLS `customers_update_own`
--   (`auth.uid() = user_id`)⇒ 他只改得到自己那一列。
--   為什麼不是 service_role = **改成 service_role 就等於拿掉那道 RLS** ——
--   service_role 繞過 RLS ⇒ 那條路上任何一個 bug 都變成「改到別人的資料」。
--   ⇒ 📌 這一格的安全**靠的是身分本身**,不是靠後端小心。
-- 🛑 而它是**欄級**不是表級:`(gender)` 這個括號就是整條防線 ——
--   拿掉它 ⇒ 客人改得動自己的 `tier`(經銷價)與 `wallet_balance`(儲值金)。
--   ⇒ 而下面 §2② 那兩條斷言就是在守這個括號, 它們在拋棄式 PG 上實測會紅。
-- ⚠️ 而本閘自己的天花板要跟著記:它**對 dashboard / SQL Editor 手動 GRANT 是盲的**
--   ⇒ 有人在後台面板點一下開權限, repo 裡一個字都沒有, 而這道閘不會知道。
GRANT UPDATE (gender) ON TABLE public.customers TO authenticated;
-- ACL-GATE-EXEMPT: public.customers -- 後台代改客人資料走 service_role,同欄同權(20260901040000, 2026-09-01)
-- 🔵 這一條是鏡像:`20260717010000:175` 已經給了 service_role 同一組欄
--   (name, phone, birthday, updated_at)⇒ 少了 gender 的話, 後台那半改不動它,
--   而**它今天不會紅** —— 會在別人做後台那一片時才炸。
GRANT UPDATE (gender) ON TABLE public.customers TO service_role;

-- ══ 2. 自我斷言 ═══════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_cnt integer;
  v_who text;
BEGIN
  -- 🔵 正向對照:先證這把尺量得到【既有】的欄 —— 量不到的話下面每一條都恆綠。
  --    🔴 而正對照要選在【尺沒接上時會印不同東西】的地方 ⇒ 用 `name`(它本來就在名單上)。
  IF NOT has_column_privilege('authenticated', 'public.customers'::regclass, 'name', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — 正向對照不成立:authenticated 連【既有的 name 欄】都沒有 UPDATE。'
      '🔴 那表示這把尺沒有量到對的東西(角色名錯 / 表錯 / 連錯庫), 下面每一條斷言都沒有判別力。';
  END IF;

  -- ① 兩個角色都要拿到 gender 的欄級 UPDATE
  SELECT count(*),
         coalesce(string_agg(r.rolname, ', ' ORDER BY r.rolname), '(無)')
    INTO v_cnt, v_who
    FROM (VALUES ('authenticated'), ('service_role')) AS n(nm)
    JOIN pg_roles r ON r.rolname = n.nm
   WHERE has_column_privilege(r.oid, 'public.customers'::regclass, 'gender', 'UPDATE');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '驗收失敗 — 只有 % 個角色拿得到 customers.gender 的 UPDATE(要 2):%。'
      '🔴 少的那一個今天不會紅, 而它會在別人做那一半時才炸 —— 到時候沒有人會想到這一支。'
      '📌 上面那一串是【實得值】。', v_cnt, v_who;
  END IF;

  -- ② 🔴 **不得順手擴權** —— 這一支只給 UPDATE(gender), 不給整表 UPDATE。
  --    失敗情境:有人把 `GRANT UPDATE (gender)` 寫成 `GRANT UPDATE` ⇒ 客人可以改自己的 `tier`
  --    ⇒ 那是**經銷價**的門。而 ① 那一條【照樣會過】—— 整表 UPDATE 也涵蓋 gender。
  IF has_column_privilege('authenticated', 'public.customers'::regclass, 'tier', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — authenticated 拿得到 customers.tier 的 UPDATE。'
      '🔴 那是會員等級 = 經銷價的門。最可能的成因:GRANT 寫成整表而不是 (gender) 欄級。';
  END IF;
  IF has_column_privilege('authenticated', 'public.customers'::regclass, 'wallet_balance', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — authenticated 拿得到 customers.wallet_balance 的 UPDATE。'
      '🔴 那是儲值金。同上, 最可能是 GRANT 寫成整表。';
  END IF;

  -- ③ 🔵 只印不擋:authenticated 現在到底拿得到哪幾欄的 UPDATE。
  --    ⇒ 讓下一個人不必自己查就看得到現況, 而不是靠這支檔的註解(註解會過期)。
  SELECT coalesce(string_agg(a.attname, ', ' ORDER BY a.attname), '(無)')
    INTO v_who
    FROM pg_attribute a
   WHERE a.attrelid = 'public.customers'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
  RAISE NOTICE '🔵 authenticated 對 customers 的欄級 UPDATE 現況(只印不擋):%', v_who;

  RAISE NOTICE '✅ customers.gender 欄級 UPDATE:兩個角色都拿到了, 而 tier / wallet_balance 沒有被順手放行';
END
$verify$;

COMMIT;

-- ══ 🆘 回滾(可直接複製;已包交易)═══════════════════════════════════════════
--   ```sql
--   BEGIN;
--     SET LOCAL lock_timeout = '5s';
--     REVOKE UPDATE (gender) ON TABLE public.customers FROM authenticated;
--     REVOKE UPDATE (gender) ON TABLE public.customers FROM service_role;
--   COMMIT;
--   ```
--   ⚠️ 而回滾之後**會員中心那一格會存不進去**(整筆 UPDATE 被拒)——
--      ⇒ 回滾前先把前端那一格拿掉或關掉, 順序反了會讓客人看到「儲存失敗」。
