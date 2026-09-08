-- 20260908100000_m4b_customers_email_update_grant.sql
-- 「後台改客人信箱(最簡單版)」:把 `email` 加進 `customers` 的**欄級** UPDATE GRANT,
-- **只給 `service_role`**。Sean 2026-09-08 最終拍 A(memory `project_0908-sean-picks-minimal-email-fix`)。
--
-- ══ 🔴🔴 §0 沒有這一支,那一片【每一次都壞】,而且壞得很像成功 ═══════════════
--   `20260905190000_m4b_customers_update_service_role_policy.sql:82-88` 逐字量到:
--     「`customers` 上 service_role **有效**可 UPDATE 的欄 …
--       `birthday` `gender` `name` `phone` `updated_at` —— **恰 5 欄**」
--   ⇒ 📌 **欄級 GRANT 是白名單** —— `email` 不在上面 ⇒ 寫入時 PostgreSQL 回 `42501`。
--   🛑 而後台那一片是**兩段寫入**(先 Auth、後 `customers`)⇒ 少了這一支的症狀是:
--      **Auth 那半成功(客人真的登得進去了)、`customers` 那半被拒** ⇒ 後台畫面還印舊信箱。
--      ⇒ 員工看到「沒改到」會再按一次,而**世界上那個帳號已經改了**。
--   ⇒ 🔴 這正是 memory `feedback_code-before-db-is-invisible-to-every-green` 那個形狀:
--      碼先上而 DB 後貼 ⇒ typecheck / lint / build / vitest **四把尺全綠**,
--      因為沒有任何一把在問「那一欄的 GRANT 在不在」。
--
-- ══ §1 為什麼**只有一個角色**(與 `20260901040000` 的 gender 那支【刻意不同】)═══
--   gender 那支給了兩個角色,因為**客人自己在會員中心改性別**是預期行為。
--   🛑 **email 不是** —— 客人自己改信箱是另一整片(要驗新位址、要防帳號綁架),
--      而本片的形狀逐字是「**客服代改**」(Sean 2026-09-08 拍甲)。
--   ⇒ 🔴 給 `authenticated` 會發生什麼, 要講**準確**(codex 2026-09-08 nit 12 訂正):
--      ⛔ ~~「等於讓任何登入者改自己的登入信箱」~~ —— **那句是錯的**:
--         登入信箱住在 `auth.users`, 而本檔這條 GRANT **一個字都碰不到那張表**。
--      ✅ 真正會發生的是:客人改得動**後台看的那一欄**, 而 `auth.users` 那一半沒動
--         ⇒ 🔴 **兩邊分岔, 而【兩邊都不報錯】** —— 後台印一個信箱、客人用另一個登入,
--            出貨通知與客服對話會照著錯的那一個走, 而沒有任何東西會紅。
--      📌 錯的那句話與對的那句話**結論一樣(都是不要給)**, 所以沒有人會回頭查它 ——
--         舊字面留著加刪除線, 讓照它推理的人撞到訂正。
--   ⇒ 下面 §2③ 那條斷言就是在守這件事:`authenticated` 與 `anon` **都必須拿不到**。
--
-- ══ §2 不 apply ══════════════════════════════════════════════════════════════
--   本檔由 Sean 本人(或主視窗代貼)在 SQL Editor 貼;施工窗不 apply、不碰正式庫。
--
-- ══ ⚠️ §3 本檔【不看】什麼 ═══════════════════════════════════════════════════
--   ① 不看 RLS —— `20260905190000` 那條 `customers_update_service_role` policy 在不在,
--      本檔一個字沒驗。欄級 GRANT 與 RLS 是**兩道獨立的門**,兩道都要過才寫得進去。
--      (而 `service_role` 是 `rolbypassrls = t` ⇒ 實務上 RLS 那道對它不承重;仍不在本檔宣稱。)
--   ② 不看 `auth.users` —— 那一半走 GoTrue Admin API(`auth.admin.updateUserById`),
--      不經過本檔的任何一行 SQL。
--   ③ 不驗行為 —— 「後台真的存得進去」要開瀏覽器點一次,而那不在 SQL 裡。

BEGIN;

-- 🔵 house 值,照 `20260811060000:54-58`(逐字 `SET LOCAL lock_timeout = '5s';` 那三行)。
-- GRANT 要取得 table 的鎖。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ══ 1. 一條 GRANT(**一個角色、一個欄**)════════════════════════════════════
-- 🔵 GRANT 是**累加**的 ⇒ 這一行冪等:既有五欄不會被動到,只多一個 `email`。
--    ⇒ 所以不需要先 REVOKE,而**也不該** REVOKE —— 那會在中途把後台的寫入權關掉。
-- ACL-GATE-EXEMPT: public.customers -- 後台客服代改客人登入信箱,走 service_role(20260908100000, 2026-09-08 Sean 拍 A)
-- 🔴 **豁免的理由要寫得出「誰要用、為什麼一定是 service_role」,而這裡是**:
--   誰要用 = **後台客服**。後台走 `createSupabaseServiceClient()` = `service_role`,
--   而它要改的是**別人的**那一列(客人自己不在場)⇒ 沒有任何 `auth.uid()` 對得上
--   ⇒ 走 `authenticated` + RLS 這條路**在結構上做不到**。
-- 🛑 而它是**欄級**不是表級:`(email)` 這個括號就是整條防線 ——
--   拿掉它 ⇒ service_role 改得動 `tier`(經銷價)與 `wallet_balance`(儲值金),
--   而那兩樣今天各自只有一條 owner RPC 寫得動、且**同交易寫稽核**。
--   ⇒ 下面 §2④ 那兩條斷言就是在守這個括號。
GRANT UPDATE (email) ON TABLE public.customers TO service_role;

-- ══ 2. 自我斷言 ═══════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_cols text;
BEGIN
  -- ① 🟢 **正向對照** —— 先證這把尺量得到【既有】的欄。量不到的話下面每一條都恆綠。
  --    用 `name`:它從 `20260717010000:175` 起就在名單上(該行逐字
  --    `GRANT UPDATE (name, phone, birthday, updated_at) ON TABLE public.customers TO service_role;`)。
  IF NOT has_column_privilege('service_role', 'public.customers'::regclass, 'name', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — 正向對照不成立:service_role 連【既有的 name 欄】都沒有 UPDATE。'
      '🔴 那表示這把尺沒有量到對的東西(角色名錯 / 表錯 / 連錯庫), 下面每一條斷言都沒有判別力。';
  END IF;

  -- ② 這一支要做的那件事
  IF NOT has_column_privilege('service_role', 'public.customers'::regclass, 'email', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — service_role 拿不到 customers.email 的 UPDATE。'
      '🔴 後台改信箱那一片會【Auth 那半成功、customers 那半回 42501】—— 每一次都發生。';
  END IF;

  -- ③ 🔴 **不得順手給客人** —— 客人自己改登入信箱是另一片, 而且要驗新信箱。
  --    失敗情境:有人把這一行複製成 `TO authenticated`(gender 那支確實是兩行, 很好抄錯)
  --    ⇒ 任何登入者改得動自己的登入信箱, **而且沒有任何驗證**。
  --    ⚠️ 而 ② 那條【照樣會過】—— 多給一個角色不會讓 service_role 少拿到。
  IF has_column_privilege('authenticated', 'public.customers'::regclass, 'email', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — authenticated 拿得到 customers.email 的 UPDATE。'
      '🔴 這條 GRANT 碰不到 auth.users —— 它讓客人改得動【後台看的那一欄】而登入信箱沒動'
      ' ⇒ 兩邊分岔且都不報錯。最可能的成因:照 20260901040000(gender)抄成兩行。';
  END IF;
  -- 🔴 **`anon` 也要守**(code-reviewer 2026-09-08 nit 8)。
  --    理由不是「今天有人會這樣寫」, 是本檔那個 `ACL-GATE-EXEMPT` marker 是**逐物件**豁免
  --    (`scripts/acl-drift-gate.py` 的 `exempt_for(obj)` —— 不分角色、不分欄)
  --    🔵 **兩處引用刻意不寫行號**:codex R2 nit 10 抓到我原本寫的 `:46` / `:402` 兩個都漂了
  --       (marker 實際在本檔的 `ACL-GATE-EXEMPT:` 那一行, 函式在該支 py 的 `exempt_for` 那一行)
  --       ⇒ 📌 一個指向錯位置的精確引用, 比一個要你自己 grep 的字面更糟。
  --    ⇒ 日後有人在**這支檔**再加一行 `GRANT … TO anon`, 那道閘會被這個 marker 靜音
  --    ⇒ 而少了這一格, 這裡也看不到。**兩道都瞎的時候, 那一行就靜靜過去了。**
  IF has_column_privilege('anon', 'public.customers'::regclass, 'email', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — anon 拿得到 customers.email 的 UPDATE。'
      '🔴 anon = 沒有登入的訪客。⚠️ 欄級 GRANT 只是【第一道門】, RLS 是第二道 —— '
      '本檔不驗 RLS(見 §3①)⇒ 這一格不宣稱「任何人都改得動」, 它宣稱的是【那道門不該開】。';
  END IF;

  -- ④ 🔴 **不得順手擴權** —— 這一支只給 UPDATE(email), 不給整表 UPDATE。
  --    失敗情境:寫成 `GRANT UPDATE ON TABLE` ⇒ service_role 直接改得動 tier 與 wallet_balance,
  --    而那兩條今天各自只有一支 owner RPC 寫得動、**且同交易寫稽核** ⇒ 繞過稽核。
  --    ⚠️ ② 那條**照樣會過** —— 整表 UPDATE 也涵蓋 email。
  IF has_column_privilege('service_role', 'public.customers'::regclass, 'tier', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — service_role 拿得到 customers.tier 的 UPDATE。'
      '🔴 那是會員等級 = 經銷價的門, 今天唯一寫入路是 admin_set_customer_tier(同交易稽核)。'
      '最可能的成因:GRANT 寫成整表而不是 (email) 欄級。';
  END IF;
  IF has_column_privilege('service_role', 'public.customers'::regclass, 'wallet_balance', 'UPDATE') THEN
    RAISE EXCEPTION '驗收失敗 — service_role 拿得到 customers.wallet_balance 的 UPDATE。'
      '🔴 那是儲值金, 今天唯一寫入路是 admin_adjust_wallet(同交易稽核)。同上, 最可能是寫成整表。';
  END IF;

  -- ⑤ 🔵 只印不擋:service_role 現在到底拿得到哪幾欄的 UPDATE。
  --    ⇒ 讓下一個人不必自己查就看得到現況, 而不是靠這支檔的註解(註解會過期)。
  --    📌 貼完之後這一行應該印【六欄】:birthday · email · gender · name · phone · updated_at
  SELECT coalesce(string_agg(a.attname, ', ' ORDER BY a.attname), '(無)')
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.customers'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('service_role', a.attrelid, a.attname, 'UPDATE');
  RAISE NOTICE '🔵 service_role 對 customers 的欄級 UPDATE 現況(只印不擋):%', v_cols;

  RAISE NOTICE '✅ customers.email 欄級 UPDATE:service_role 拿到了, authenticated / anon 沒有, tier / wallet_balance 沒有被順手放行';
END
$verify$;

COMMIT;

-- ══ 🆘 回滾(可直接複製;已包交易)═══════════════════════════════════════════
--   ```sql
--   BEGIN;
--     SET LOCAL lock_timeout = '5s';
--     REVOKE UPDATE (email) ON TABLE public.customers FROM service_role;
--   COMMIT;
--   ```
--   ⚠️ 回滾之後**後台那個「改信箱」欄位會半途壞掉**:Auth 那半照樣會成功,
--      而 `customers` 那半開始回 42501 ⇒ 員工會看到「登入信箱改好了、後台顯示沒跟上」。
--      ⇒ 🔴 **回滾前先把後台那個表單拿掉**(`customer-detail.tsx` 裡那一個 `<EmailChangeForm>`),
--         順序反了會讓兩邊不一致而沒有人知道。
