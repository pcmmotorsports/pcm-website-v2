-- ═══════════════════════════════════════════════════════════════════════════
-- 新物件出生自帶的那四種權限 —— **改預設,不逐支收**
--   plan = docs/plans/2026-09-05-adp-residual-default-privileges-plan.md
--   Sean 2026-09-05 拍板逐字:「Q-ADP殘留 … **甲**」
--     甲 = 改預設(以後新建的不再自帶;現有的先記板上不動)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ■ 段一 · 這一片在解什麼
--   schema `public` 的預設權限裡有一列(grantor = `postgres`):
--       service_role=Dxtm/postgres
--   `D`=TRUNCATE · `x`=REFERENCES · `t`=TRIGGER · `m`=MAINTAIN
--   ⇒ 📌 **那一列的內容【只有】那四種** —— 它不是「順便多給」, 它整列就是這四個。
--   ⇒ 每一個由 `postgres` 在 `public` 新建的表或 view, **出生就自帶它們**, 而 repo 裡
--     一行 `GRANT` 都沒有 ⇒ 🔴 **grep 不到、三綠不紅、審查看不到。**
--   🔵 而 `service_role` 的讀寫**不是**這一列給的:它們來自各 migration 明寫的 `GRANT`
--     (2026-09-05 唯讀實測:`service_role` 對 **81** 個物件有 SELECT)。
--     ⇒ **移掉這一列, 讀寫一格都不會少。**
--
-- ■ 段二 · 🔴 兩個數字要訂正, 不要照抄那題的敘述
--   ⛔ ~~28 個帶著~~ ⇒ ✅ **今天實測 29 個**(那題的 28 是**早上**量的, 之間有幾支被貼)。
--      27 個四種都有;`orders` 與 `order_items` 少了 TRUNCATE。**16 張表 + 13 支 view**。
--   🔵 負對照:今晚新建的 `public.pcm_incident` **不在那 29 個裡**
--      (`has_table_privilege('service_role','public.pcm_incident','TRUNCATE')` = **f**)
--      ⇒ 那支檔的四道 `REVOKE` 真的收乾淨了 ⇒ **這把尺分得開「收了」與「沒收」。**
--
--   🛑🛑 **而那 29 個裡有 4 個, 那題的推薦語蓋不住**
--      那題逐字寫「收那四種**差別不大**」—— 對其餘 25 個是對的, 而這四支不是:
--        `products_public` · `products_list_public` · `product_variants_public` · `vehicle_taxonomy_public`
--      🔴 **`TRIGGER` 權限在 view 上可以掛 `INSTEAD OF` trigger ⇒ 它【可能開出一條寫入路徑】。**
--      ⚠️ **而那不是一個字就成立的**(codex 2026-09-05 nit, 前提逐條寫出來):
--         ① 建 trigger 的人另需那支 trigger function 的 `EXECUTE`
--         ② 呼叫端仍需要 view 本身的 DML 權限(而 20260905260000 剛把 anon/authenticated 那半收掉)
--         ③ **不需要**是 owner
--      ⇒ ⛔ ~~一支唯讀 view 會變成可寫的~~ 那句太滿, 它跳過了兩個前提。
--      而那四支正是 `20260905260000`(⟦b9-PUBLICVIEWALL⟧)剛把 anon/authenticated 的寫入收掉的
--      顧客站 view。⇒ 📌 **「今天沒人用那四種」是對的, 而「用了會怎樣」在這四支上與別的 25 個不同。**
--      ⇒ 🔵 **本片依甲案【不收】它們**(甲案就是不逐支收), 而這一格已寫進板列 —— 不讓它被
--        「差別不大」那句蓋掉。
--
-- ■ 段三 · 貼進正式庫會發生什麼 · 以及它管不到什麼
--   ✅ **會發生**:此後由 `postgres` 在 `public` 新建的表/view **不再自帶**那四種。
--      Sean 在 SQL Editor 貼 SQL 時的身分就是 `postgres` ⇒ 我們自己貼的每一支都涵蓋得到。
--   🛑 **零追溯**:既有 29 個物件**一個都不會變**。本片的事後閘⑤ 就是在證明這一點
--      (它是負對照:如果數字變了, 表示我對 ADP 的理解是錯的)。
--   🔴 **管不到 `supabase_admin` 那三列** —— 那是平台設的, 我們改不動:
--        supabase_admin  r   postgres=arwdDxtm  anon=arwdDxtm  authenticated=arwdDxtm  service_role=arwdDxtm
--      ⇒ 📌 **由 `supabase_admin` 建立的新物件照樣自帶全部** —— 連 `anon` 都自帶 `arwdDxtm`。
--      ⇒ **這一片只關掉【我們自己建】那條路。** 另一條路仍然開著, 而它不在任何人的射程裡。
--   🔴 **只動 `TABLES`**(含 view)。`SEQUENCES` 那一列(`anon=w` / `authenticated=w` / `service_role=w`,
--      `w` = UPDATE)**本片不動** —— 那是另一題, 而 **Sean 沒有被問過**。已記板列。
--
-- ↩️ Rollback:`supabase/rollbacks/20260905350000-rollback.sql`
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ── 前置閘⓪:有沒有【全域】預設權限(不綁 schema)────────────────────────
-- 🔴🔴 codex 2026-09-05 must-fix ①:`ALTER DEFAULT PRIVILEGES` 有兩種射程 ——
--    **綁 schema 的**(`IN SCHEMA public`)與**全域的**(不寫 `IN SCHEMA`)。
--    兩者**各自獨立累加**, 而 📌 **per-schema 的 REVOKE 抵銷不掉 global 的 GRANT。**
--    ⇒ 若有一列全域的還在給 `service_role` 那四種, 本片會**成功**而新表照樣自帶
--      ⇒ 🛑 **一個成功的 migration 什麼都沒解決, 而沒有東西會叫。**
-- 🔬 2026-09-05 唯讀實測:全庫 `pg_default_acl` 共 **27 列, 每一列都綁在某個 schema**
--    ⇒ **今天一列全域的都沒有**。而「今天沒有」不是守門, 所以這一格留著。
DO $g0$
DECLARE v_g text;
BEGIN
  SELECT COALESCE(pg_catalog.string_agg(
           pg_catalog.pg_get_userbyid(d.defaclrole)::text || ':' || d.defaclobjtype::text, ', '), '(無)')
    INTO v_g
    FROM pg_catalog.pg_default_acl d,
         LATERAL pg_catalog.aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 0
     AND d.defaclobjtype = 'r'
     AND a.grantee = to_regrole('service_role')
     AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');

  IF v_g <> '(無)' THEN
    RAISE EXCEPTION '前置閘⓪:有【全域】預設權限(不綁 schema)在給 service_role 那四種(%)⇒ 本片的 per-schema REVOKE 抵銷不掉它 ⇒ 貼下去會【成功而無效】, 拒繼續', v_g;
  END IF;
END $g0$;

-- ── 前置閘⓪b:角色必須存在(不然下面的 to_regrole 全是 NULL, 每一格都會假綠)──
-- 🔵 codex nit:`service_role` 不存在時 `to_regrole` 回 NULL ⇒ 前置閘會先印「已經做過了」,
--    而真正的 REVOKE 才報錯 ⇒ 會 rollback(安全), 而**診斷訊息指錯地方**。
DO $g0b$
BEGIN
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪b:角色 service_role 不存在 ⇒ 這個庫不是我讀到的那個, 拒繼續';
  END IF;
  IF to_regrole('postgres') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪b:角色 postgres 不存在 ⇒ 拒繼續';
  END IF;
END $g0b$;

-- ── 記下【改之前】的既有物件數(事後閘⑤ 要拿它比, 不是拿一個門檻比)──────
-- 🔴 codex must-fix ③:原版事後閘⑤ 判 `v_n < 1` ⇒ 📌 **29 個意外只剩 1 個也會通過**,
--    而哪天合法清到 0 反而假紅。⇒ 改成【改前改後兩個讀數相等】。
CREATE TEMP TABLE _adp_before ON COMMIT DROP AS
SELECT count(*) AS n FROM (
  SELECT c.oid FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
         LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
     AND a.grantee = to_regrole('service_role')
     AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
   GROUP BY c.oid) t;

-- ── 前置閘:那一列現在是什麼形狀 ────────────────────────────────────────
-- 🔴🔴 **逐條解析, 不比整串字面** —— 2026-09-05 拋棄式 PG 實測抓到的:
--    正式庫那一列印出來是 `postgres=arwdDxtm/postgres  service_role=Dxtm/postgres`,
--    而**空庫上同一個設定只印 `service_role=Dxtm/postgres`** ——
--    PostgreSQL 在 owner 的預設值等於內建值時**不會把它印出來**。
--    ⇒ 📌 **整串逐字比對等於把這道閘綁死在「正式庫今天那個字串」上**;
--      它在正式庫會過, 而在任何別的庫(重播 / 拋棄式 / 未來)都會紅, 而紅的理由與它要守的事無關。
--    ⇒ ✅ 改成問三件事:①service_role 拿到的**恰好**是那四種 ②postgres 那格沒被動 ③沒有第三個人。
DO $gate$
DECLARE
  v_sr   text;
  v_pg   text;
  v_others text;
BEGIN
  SELECT
    (SELECT pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
       FROM pg_catalog.pg_default_acl d2,
            LATERAL pg_catalog.aclexplode(d2.defaclacl) a
      WHERE d2.oid = d.oid AND a.grantee = to_regrole('service_role')),
    (SELECT pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
       FROM pg_catalog.pg_default_acl d2,
            LATERAL pg_catalog.aclexplode(d2.defaclacl) a
      WHERE d2.oid = d.oid AND a.grantee = to_regrole('postgres')),
    (SELECT COALESCE(pg_catalog.string_agg(DISTINCT
              COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text, 'PUBLIC'), ','), '(無)')
       FROM pg_catalog.pg_default_acl d2,
            LATERAL pg_catalog.aclexplode(d2.defaclacl) a
      WHERE d2.oid = d.oid
        AND a.grantee NOT IN (to_regrole('service_role'), to_regrole('postgres')))
  INTO v_sr, v_pg, v_others
  FROM pg_catalog.pg_default_acl d
  JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
 WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
   AND d.defaclrole = to_regrole('postgres');

  -- 🔵 **態 B:那一列整個不在, 或 service_role 已經不在裡面 ⇒ 本片【已經做過了】**
  --    ⇒ 這不是失敗, 是冪等。⛔ 原版把這個世界判成「有人動過, 拒繼續」——
  --      📌 **那會讓「已經做過」與「被別人破壞」印同一個紅**, 而它們的下一步完全不同。
  IF v_sr IS NULL THEN
    RAISE NOTICE '前置閘:grantor=postgres 的表預設權限裡已經沒有 service_role ⇒ 本片已經做過了(或那一列從來沒有過)⇒ 本片是 no-op, 事後閘照跑。';
    RETURN;
  END IF;

  -- 態 A:恰好那四種 ⇒ 放行。多一格少一格都停下。
  IF v_sr <> 'MAINTAIN,REFERENCES,TRIGGER,TRUNCATE' THEN
    RAISE EXCEPTION '前置閘①:service_role 在預設權限裡拿到的是「%」, 而我抽取時恰好是那四種(MAINTAIN,REFERENCES,TRIGGER,TRUNCATE)⇒ 中間有人動過, 拒繼續', v_sr;
  END IF;

  -- postgres 那格:可能不存在(PG 省略等於內建值的 owner 條目)—— 那是合法的。
  IF v_pg IS NOT NULL AND pg_catalog.strpos(v_pg, 'SELECT') = 0 THEN
    RAISE EXCEPTION '前置閘②:postgres 自己在預設權限裡是「%」而連 SELECT 都沒有 ⇒ 那不是我讀到的世界, 拒繼續', v_pg;
  END IF;

  IF v_others <> '(無)' THEN
    RAISE EXCEPTION '前置閘③:那一列還有第三個被授權者「%」—— 我抽取時只有 postgres 與 service_role ⇒ 停下人工確認', v_others;
  END IF;
END $gate$;

-- ── 唯一的那一行 ────────────────────────────────────────────────────────
-- 🔴 `FOR ROLE postgres` 不可省:不寫的話它改的是**執行者自己**的預設權限,
--    而執行者若不是 postgres, 這一行會建出一列**新的**預設權限而不是改掉那一列
--    ⇒ 📌 那個世界裡它會【成功】而什麼都沒解決。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM service_role;

-- ── 事後閘 ──────────────────────────────────────────────────────────────
DO $after$
DECLARE
  v_acl    text;
  v_n      int;
  v_before int;
BEGIN
  SELECT pg_catalog.array_to_string(d.defaclacl, '  ') INTO v_acl
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND d.defaclrole = to_regrole('postgres');

  -- ① service_role 那一格不可以再在裡面
  IF v_acl IS NOT NULL AND pg_catalog.strpos(v_acl, 'service_role=') > 0 THEN
    RAISE EXCEPTION '事後閘①:service_role 仍在預設權限裡(現在是「%」)⇒ 那一行沒生效', v_acl;
  END IF;

  -- ② 🔴 postgres 自己那一格【不可以】被順手收掉 —— 收了的話新表會連 owner 都沒有權限
  IF v_acl IS NOT NULL AND pg_catalog.strpos(v_acl, 'postgres=arwdDxtm') = 0 THEN
    RAISE EXCEPTION '事後閘②:postgres=arwdDxtm 不見了(現在是「%」)⇒ 我收過頭了', v_acl;
  END IF;
  -- ⚠️ `v_acl IS NULL` 也是合法終態:PG 在那一列只剩 owner 的預設值時會把整列刪掉。
  --    ⇒ 這兩格都寫成「不是 NULL 才檢查」, 而 NULL 由下面第③格接住。

  -- ③ 兩種合法終態之一:整列消失, 或只剩 postgres
  IF v_acl IS NOT NULL
     AND v_acl <> 'postgres=arwdDxtm/postgres' THEN
    RAISE EXCEPTION '事後閘③:那一列現在是「%」, 而合法終態只有兩種(整列消失 / 只剩 postgres=arwdDxtm/postgres)⇒ 停下人工確認', v_acl;
  END IF;

  -- ④ 🔴 負對照:supabase_admin 那三列**內容**一格都不可以動。
  --    ⛔ ~~原版只數列數 = 3~~ —— codex must-fix ②:內容被改而列數不變 ⇒ 照樣通過;
  --      而平台合法新增第四種物件類 ⇒ 假紅。**數量不是內容。**
  SELECT COALESCE(pg_catalog.string_agg(x, ' || ' ORDER BY x), '(無)') INTO v_acl FROM (
    SELECT d.defaclobjtype::text || '=' || pg_catalog.array_to_string(d.defaclacl, ',') AS x
      FROM pg_catalog.pg_default_acl d
      JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'public' AND d.defaclrole = to_regrole('supabase_admin')) t;
  IF pg_catalog.strpos(v_acl, 'service_role=arwdDxtm/supabase_admin') = 0 THEN
    RAISE EXCEPTION '事後閘④(負對照):supabase_admin 在 public 的預設權限內容變成「%」—— 我抽取時它含 service_role=arwdDxtm/supabase_admin ⇒ 我動到了不該動的東西, 或那一列被別人改了', v_acl;
  END IF;

  -- ⑤ 🔴 負對照:既有物件**一個都不可以變**(ADP 只管未來, 不追溯)。
  --    ⇒ 拿【改前那個讀數】比, 不是拿門檻比(codex must-fix ③)。
  SELECT count(*) INTO v_n FROM (
    SELECT c.oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
           LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
       AND a.grantee = to_regrole('service_role')
       AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
     GROUP BY c.oid) t;
  SELECT n INTO v_before FROM _adp_before;
  IF v_n <> v_before THEN
    RAISE EXCEPTION '事後閘⑤(負對照):既有帶著那四種的物件從 % 個變成 % 個 ⇒ ALTER DEFAULT PRIVILEGES 竟然追溯了, 我的理解是錯的', v_before, v_n;
  END IF;
  RAISE NOTICE '事後閘⑤:既有仍有 % 個物件帶著那四種(改前也是 %)—— 這是【預期】, 本片零追溯。要清它們是另一件事(板列 ⟦b4-SWEEPDEAD1⟧ 旁那一列)。', v_n, v_before;

  -- ⑥ 🔴 全域那條路在事後也要再問一次 —— 中間若有人加了一列, 本片就白做了。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d, LATERAL pg_catalog.aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace = 0 AND d.defaclobjtype = 'r'
       AND a.grantee = to_regrole('service_role')
       AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')) THEN
    RAISE EXCEPTION '事後閘⑥:出現了【全域】預設權限在給 service_role 那四種 ⇒ 本片的 per-schema REVOKE 抵銷不掉它 ⇒ 成功而無效';
  END IF;

  RAISE NOTICE '事後閘全過:預設不再給 service_role 那四種 · postgres 自己那格沒動 · supabase_admin 三列沒動 · 既有物件零追溯。';
  RAISE NOTICE '🛑 而【supabase_admin 建立的新物件照樣自帶全部】—— 本片只關掉「我們自己建」那條路。';
END $after$;

COMMIT;
