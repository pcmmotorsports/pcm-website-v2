-- 20260907070000_m4b_orders_delete_audit_trail.sql
-- 🔴 ⛔ 舊版號 ~~20260907010000~~ 作廢 —— 它**撞到線【身分】`-auth` 的 68**
--    (`df3a680ca` 裡的 `20260907010000_m4b_m208_get_effective_prices.sql`;我自己 `git ls-tree` 核過,
--     負對照現造版號 ⇒ 0)。今晚 0907 那批的分配:010000=68 auth · 020000=69 account ·
--     030000=70 account · 040000=71 auth · 050000=73 account · 060000=74 mail ⇒ **本片 = 070000**。
--    📌 **兩個窗同時取號, 而那個號碼在【檔名】裡 ⇒ git 撞了會叫;在檔案【內容】裡就不會**
--      (今晚型別檔那次就是後者)。這一次是主視窗先看見的。
-- 🔴🔴 **本檔【一落地就會讓一支測試變紅】, 而那是它在做事, 不是樹壞了。**
--    `orders_deleted_log` 用 `bigint GENERATED ALWAYS AS IDENTITY` ⇒ 多一支 IDENTITY 序列
--    ⇒ `scripts/public-sequence-acl.test.ts` 的 `PINNED_IDENTITY_SEQUENCES`(釘住全集, 兩個方向都會紅)
--      掃到 9 支而釘住 8 支 ⇒ 紅。
--    ✅ **處置 = 把 `orders_deleted_log_id_seq` 加進那份釘子清單, 而它與本檔【必須同一顆 commit】。**
--      (`revokedSomewhere()` 那把尺不必動 —— 下面 `REVOKE ALL ON SEQUENCE … FROM PUBLIC, anon,
--       authenticated` 三個角色都在, 它本來就認得。)
--    🔬 **兩個方向都量過**(2026-09-07):本檔在樹上而沒加釘子 ⇒ rc=1;
--      加了釘子而把本檔移走 ⇒ 也 rc=1;兩者都齊 ⇒ **7 passed rc=0**。
--    ⚠️ 而那支測試的失敗訊息是**一段固定字串**, 兩種方向都列在裡面 ⇒ **它不告訴你是哪一邊多了**,
--      要自己去比那兩份清單。全文理由寫在該測試檔那一條的註解, 這裡只留指標(同一件事不寫兩處全文)。
-- pcm:idempotent: yes
--   依據:本檔每一段都先查目錄再動(表 / 三支 trigger / policy 各自帶存在守衛),
--   函式用 CREATE OR REPLACE(重定義既有物件, 規則① 允許)。
--   🔴 而「冪等」是**重跑安全**, 不是「什麼都不做」—— 權限那一段每次都會重寫 ACL(結果相同)。
--   實測讀數見交件(拋棄式 PG 三世界 + 突變)。
-- ============================================================================
-- `⟦db-ORDERDELETENOTRACE⟧`:訂單被刪掉時留痕
-- ============================================================================
-- ✅ 授權:Sean 2026-09-07 01:30 逐字答 `Q35`:
--    「**甲 = 上線前補「刪單留痕」(一支 migration,要貼板)**」
--
-- ✅ **第二個拍板:Sean 2026-09-07 答 `Q37` = 甲 —— 「留痕寫不進去 ⇒ 刪除跟著失敗」**
--    (fail-closed;乙是「留痕失敗但照刪」)。
--    🔬 **而本片【本來就是甲】, 不是為了這個拍板改的** —— 量法可重跑:
--      `sed -n '/FUNCTION public.pcm_log_order_row_delete/,/^\$fn\$/p' <本檔> |
--       /usr/bin/grep -cE 'EXCEPTION[[:space:]]+WHEN'` ⇒ **0**
--      (🟢 正對照:同一把尺對整個檔數 `EXCEPTION` ⇒ **1**, 那是第 5 節的事後斷言;
--       🔴 負對照:現造字面 `ZZQ_EXCEPTION_NOT_REAL` ⇒ **0**)
--    ⇒ 📌 **函式體裡零個 EXCEPTION 處理器 ⇒ INSERT 失敗會往上拋 ⇒ 那一筆 DELETE 一起回滾。**
--    🛑 **而這一格是【拍板落檔】不是【行為變更】** —— 寫下來是因為
--      「它剛好是甲」與「有人決定要甲」是兩件事, 而只有後者擋得住下一個人把它改成乙。
--
-- 🎯 **為什麼要有它(而這不是事故)** —— 2026-09-04 Sean 請某個窗刪掉測試單(23 ⇒ 1),
--    **那次刪除是授權的**;缺口是**系統沒有任何地方記下它發生過**:
--      · `orders` 上原有 4 支 trigger, **全部是 INSERT / UPDATE OF …** ⇒ 沒有一支管 DELETE
--      · 唯一的留痕表 `admin_audit_log` 在那段期間只有 4 次搜尋 + 1 次手動建單, **零刪單事件**
--    ⇒ 今天查得出那件事, 靠的是**兩份信箱檔裡的一句話**, 而**信箱不在版控**。
--
-- 🔴🔴 **為什麼是三支 trigger 而不是一支**(這一段是本檔最容易被改壞的地方)
--    實測 `pg_constraint` :對 `orders` 有 FK 的子表共 14 張, 而 **`ON DELETE CASCADE` 的有兩張**:
--      `order_items`(5 列)· `order_legal_consents`   ← 🔴 **後者是【法律同意紀錄】**
--    其餘 12 張是 `RESTRICT` / `NO ACTION` ⇒ 刪父列時它們會**擋下來或留成孤兒**, 不會安靜消失。
--    ⇒ 🎯 **只在 `orders` 掛一支 trigger, 那兩張 CASCADE 子表仍然【安靜地消失】。**
--    ⇒ 三張表各掛一支 AFTER DELETE ⇒ 每一支只記**真的被刪掉的那些列**。
--    🔴 **而【還有一層孫表】, 本檔【刻意不蓋】, 這句要明寫**(codex R1 nit⑥):
--      `orders → order_items → order_item_quantity_summary`(FK 見 `20260730150000:91`)。
--      它是**可從 order_items 重算的摘要** ⇒ 不加第四支 trigger。
--      🛑 **⇒ 不可以宣稱「三支涵蓋所有 CASCADE 資料」** —— 正確的說法是
--        **「三支涵蓋所有【原始】資料;孫表那一層是可重算的衍生資料, 刻意排除」**。
--    🔵 **為什麼不用 `orders` 的 BEFORE DELETE 一次抄完子表**:BEFORE 觸發時子列還在, 抄得到;
--      **而 BEFORE 觸發器可以被【後來新增的另一支 BEFORE 觸發器】回傳 NULL 取消掉整個 DELETE**
--      ⇒ 那樣會留下一筆「刪過」而其實沒刪的假痕。AFTER 只在真的刪掉之後才跑。
--      ⚠️ 今天 `orders` 上**沒有**任何 BEFORE DELETE(實測), 而這個設計不依賴那個事實。
--
-- 🛑 **它答不出什麼(先講)**
--    · **它記不到「誰」在人的層次** —— 只記得到 DB 角色(`current_user` / `session_user`)。
--      SQL Editor 直下的刪除, 那兩個值多半都是 `postgres` ⇒ **分不出是哪一個人**。
--      🔴 **這是【機制的天花板】不是本檔的缺陷**:要分得出人, 得在應用層帶身分進來。
--    · **它救不回資料** —— 它記的是「什麼被刪了」, 不是備份。整列 jsonb 可以拿來重建,
--      **而重建需要人判斷**(FK 順序、序號、關聯列)。
--    · **本檔【不擋】刪除** —— Sean 拍的是「留痕」不是「禁止」。
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 1. 留痕表 ────────────────────────────────────────────────────────────
DO $tblguard$ BEGIN
  -- 🔴 不用 `CREATE TABLE IF NOT EXISTS`:`scripts/migration-static-checks.sh` 規則① 一律禁,
  --    而它明文放行 plpgsql 的 `IF NOT EXISTS (SELECT …)` ⇒ 守衛在外、裸 CREATE 在內。
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relname='orders_deleted_log' AND c.relkind='r') THEN
    EXECUTE $tbl$
CREATE TABLE public.orders_deleted_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deleted_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_table   text        NOT NULL,
  order_id       uuid,
  row_data       jsonb       NOT NULL,
  -- 🔴 **這兩欄不是同一件事, 而搞混它會讓「誰刪的」這個問題得到一個假答案**(codex R1 nit⑤):
  --   `definer_user`  = 函式執行當下的 `current_user`。本函式是 SECURITY DEFINER
  --                     ⇒ 它**恆等於函式擁有者**(多半是 postgres)⇒ 🛑 **它答不出「誰刪的」**。
  --   `session_role`  = 連線登入的那個角色(值來自 `session_user`), **不受 SECURITY DEFINER 影響** ⇒ 這一欄才是線索。
  --   ⚠️ 而 SQL Editor 直下時它多半也是 `postgres` ⇒ **仍然分不出是哪一個人**(機制天花板)。
  definer_user   text        NOT NULL,
  -- 🔴 欄名叫 `session_role` 不叫 `session_user` —— **後者是 SQL 保留字, 當欄名會 syntax error**
  --    (實跑抓到:`ERROR: syntax error at or near "session_user"`)。值仍然取自 `session_user`。
  session_role   text        NOT NULL,
  application_name text,
  client_addr    inet,
  backend_pid    integer,
  txid           bigint,
  jwt_claims     jsonb,
  CONSTRAINT orders_deleted_log_source_valid
    CHECK (source_table IN ('orders','order_items','order_legal_consents'))
)$tbl$;
  END IF;
END $tblguard$;

COMMENT ON TABLE public.orders_deleted_log IS
  '訂單刪除留痕(⟦db-ORDERDELETENOTRACE⟧, Sean 2026-09-07 Q35 甲)。'
  '每一列 = 一列被刪掉的資料的整列 jsonb。'
  '🔴 它記不到【人】, 只記得到 DB 角色 —— SQL Editor 直下的刪除多半都是 postgres。'
  '🔴 它不是備份:重建需要人判斷 FK 順序與關聯列。它也【不擋】刪除。';

DO $ixguard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relname='ix_orders_deleted_log_order' AND c.relkind='i') THEN
    EXECUTE $ix$CREATE INDEX ix_orders_deleted_log_order ON public.orders_deleted_log (order_id, deleted_at)$ix$;
  END IF;
END $ixguard$;

-- ── 2. 抄寫函式(三張表共用一支)────────────────────────────────────────
-- 🔴 **裸 `CREATE FUNCTION` 不是 `OR REPLACE`**(`migration-static-checks.sh` 規則①):
--    這是**新物件** ⇒ 撞名要當場紅。`OR REPLACE` 會把撞名靜靜蓋掉, 而 REVOKE 與斷言照樣綠。
--    ⇒ 冪等靠外面那層存在守衛, 不靠 `OR REPLACE`。
DO $fnguard$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname='pcm_log_order_row_delete') THEN
EXECUTE $fnbody$
CREATE FUNCTION public.pcm_log_order_row_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order_id uuid;
  v_row      jsonb;
  -- 🔴🔴 **`order_legal_consents` 的整列【不可以原樣留下來】**(codex R1 must-fix③):
  --   原表 `20260630120000:69-71` 逐字 `REVOKE ALL PRIVILEGES … FROM PUBLIC, anon, authenticated,
  --   service_role`, 註解寫「零 policy + REVOKE ALL(含 service_role)= IP/UA PII 最大隔離」。
  --   ⇒ 整列複製進本表、又給 service_role SELECT ⇒ **等於替它開了一個新的讀取入口**,
  --     把別人**刻意收窄**的邊界放寬了, 而**沒有人拍過那個板**。
  --   ✅ ⇒ 那張表的敏感鍵**存之前就拿掉**, 並在 `_redacted_keys` 留下【拿掉了哪些】
  --     ⇒ 保住「我們知道它被刪了」, 不重新暴露內容。
  c_consent_pii text[] := ARRAY['client_ip','client_user_agent'];
BEGIN
  -- 🔴 三張表的「哪一欄是訂單」不同:orders 是 id, 子表是 order_id。
  --    用 to_jsonb(OLD) 取, 取不到就留 NULL —— **不要猜欄名**。
  v_row := pg_catalog.to_jsonb(OLD);
  IF TG_TABLE_NAME = 'order_legal_consents' THEN
    v_row := (v_row - c_consent_pii)
             || pg_catalog.jsonb_build_object('_redacted_keys', pg_catalog.to_jsonb(c_consent_pii));
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    v_order_id := (pg_catalog.to_jsonb(OLD) ->> 'id')::uuid;
  ELSE
    v_order_id := (pg_catalog.to_jsonb(OLD) ->> 'order_id')::uuid;
  END IF;

  INSERT INTO public.orders_deleted_log
    (source_table, order_id, row_data, definer_user, session_role,
     application_name, client_addr, backend_pid, txid, jwt_claims)
  VALUES
    (TG_TABLE_NAME,
     v_order_id,
     v_row,
     -- 🔴 **`current_user` / `session_user` 不能加 `pg_catalog.` 前綴** —— 它們是 SQL【關鍵字】不是函式,
     --    加了前綴會被解析成「資料表 pg_catalog 的欄位」⇒ 執行期噴
     --    `missing FROM-clause entry for table "pg_catalog"`。
     --    🔬 **這是實跑抓到的, 不是想出來的**:migration 本身 apply **成功**(rc=0、事後斷言全過),
     --    因為 plpgsql 函式體在【建立當下只做語法解析、不解析名稱】
     --    ⇒ 🎯 **「函式建起來了」與「它叫得動」是兩件事**, 而只有真的 DELETE 一次才問得出來。
     --    ✅ 它們在 `SET search_path = ''` 之下**照樣可用**(關鍵字不走 search_path)。
     current_user::text,   -- ⇒ definer_user(恆等於擁有者, 見欄位註解)
     session_user::text,   -- ⇒ session_role 欄(真正的登入角色;欄名避開保留字)
     pg_catalog.current_setting('application_name', true),
     pg_catalog.inet_client_addr(),
     pg_catalog.pg_backend_pid(),
     pg_catalog.txid_current(),
     -- 🔵 PostgREST 會設這個;SQL Editor 直下時它不存在 ⇒ true 讓它回 NULL 而不是報錯。
     -- 🔴 **而 `::jsonb` 這個轉型是一條【可以直接消掉的失敗路徑】**(codex R1 must-fix②):
     --   claims 若是非空而不合法的字串, 轉型會爆 ⇒ **整個 DELETE 跟著回滾**。
     --   ⇒ 用 `to_jsonb(text)` 永遠成功(壞的就存成一個 JSON 字串), 不再讓它有機會擋刪除。
     CASE WHEN pg_catalog.current_setting('request.jwt.claims', true) IS NULL
            OR pg_catalog.current_setting('request.jwt.claims', true) = '' THEN NULL
          ELSE pg_catalog.to_jsonb(pg_catalog.current_setting('request.jwt.claims', true))
     END);

  RETURN NULL;  -- AFTER trigger 的回傳值被忽略
END
$fn$
$fnbody$;
END IF;
END $fnguard$;

COMMENT ON FUNCTION public.pcm_log_order_row_delete() IS
  '把被刪掉的那一列整列抄進 orders_deleted_log(⟦db-ORDERDELETENOTRACE⟧)。'
  'SECURITY DEFINER:呼叫者(anon/authenticated/service_role)不需要對留痕表有 INSERT。';

-- ── 3. 三支 trigger ──────────────────────────────────────────────────────
-- 🔴 三張都掛:orders 本身 + 兩張【ON DELETE CASCADE】的子表。
--    只掛 orders 的話, 那兩張子表仍然安靜地消失(理由見檔頭)。
DO $trgguard$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_items','order_legal_consents'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=t
         AND g.tgname='pcm_'||t||'_delete_audit_ad' AND NOT g.tgisinternal
    ) THEN
      EXECUTE pg_catalog.format(
        'CREATE TRIGGER %I AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pcm_log_order_row_delete()',
        'pcm_'||t||'_delete_audit_ad', t);
    END IF;
  END LOOP;
END $trgguard$;

-- ── 4. RLS + 權限 ────────────────────────────────────────────────────────
DO $rlsguard$ BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relname='orders_deleted_log') THEN
    ALTER TABLE public.orders_deleted_log ENABLE ROW LEVEL SECURITY;
  END IF;
END $rlsguard$;

DO $polguard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='orders_deleted_log'
                  AND policyname='orders_deleted_log_select_service_role') THEN
    CREATE POLICY orders_deleted_log_select_service_role
      ON public.orders_deleted_log FOR SELECT TO service_role USING (true);
  END IF;
END $polguard$;

-- 🔴 REVOKE 與 GRANT 成對且 REVOKE 先:新表在空庫世界會被 shim 預授給 anon/authenticated,
--    序列另有出廠預設 ⇒ 只 GRANT 會讓新環境比正式庫寬。
-- 🔴🔴 **`service_role` 也要先 REVOKE** —— 這一行是【拋棄式 PG 第一發實跑抓到的】, 不是想出來的:
--    我原本只 REVOKE 了 PUBLIC / anon / authenticated ⇒ **本檔自己的事後斷言當場紅**,
--    逐字「`public.orders_deleted_log`:service_role 不該有 INSERT」。
--    成因:空庫世界的 PCM shim 用 `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO service_role`
--    ⇒ **新表【出生就帶著 service_role 的全部權限】**, 而我的 REVOKE 名單裡沒有它。
--    ⇒ 📌 **一個「只收我想得到的那幾個角色」的 REVOKE, 對【出廠預設】沒有判別力。**
--    ⚠️ 而正式庫那邊實測是 `service_role=Dxtm`(無 INSERT)⇒ **兩個世界的出廠預設不一樣**
--      ⇒ 明文 REVOKE 讓兩邊的**終態一致**, 而不是各自繼承各自的預設。
REVOKE ALL ON public.orders_deleted_log FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.orders_deleted_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.orders_deleted_log TO service_role;
GRANT SELECT ON public.orders_deleted_log TO pcm_readonly;
-- 🔴 ⛔ ~~GRANT SELECT, USAGE, UPDATE ON SEQUENCE … TO service_role~~ —— **拿掉了**(codex R1 must-fix①)。
--   病:有 `UPDATE` 就能 `setval` 把序列推到上限 ⇒ 之後**每一次刪單都因為取號失敗而整筆回滾**
--   ⇒ 這支就從【留痕】變成【擋刪除】, 而那不是 Sean 拍的東西。
--   ✅ 它本來就不需要:寫入是 SECURITY DEFINER 以**擁有者**身分做的, 取號也走擁有者。
REVOKE ALL ON SEQUENCE public.orders_deleted_log_id_seq FROM service_role;
-- 🛑 **service_role 只給 SELECT** —— 它不需要寫:寫是 trigger 用 SECURITY DEFINER 做的。
--    ⇒ 一個「留痕表」如果呼叫端寫得進去, 它就不是留痕。
REVOKE ALL ON FUNCTION public.pcm_log_order_row_delete() FROM PUBLIC, anon, authenticated;
-- 🔵 函式**不 REVOKE service_role** —— 它不需要直接呼叫這支(呼叫者是 trigger),
--    而 trigger 走 SECURITY DEFINER ⇒ 以函式擁有者身分執行, 不看呼叫端的 EXECUTE。

-- ── 5. 事後斷言(貼的當下就叫, 不等別人來驗)──────────────────────────
-- 🔴 清單寫成 `v_relations` / `v_functions` 是**規則③ 認得的形狀** ——
--    它逐字說:「收權斷言【只檢查你列出來的物件】:它防『忘記收權』, 不防『忘記列』」
--    ⇒ 所以這兩個陣列要涵蓋本檔建的**每一個可授權物件**(這裡 = 1 表 + 1 函式)。
DO $assert$
DECLARE
  v_relations text[] := ARRAY['public.orders_deleted_log']::text[];
  v_functions text[] := ARRAY['public.pcm_log_order_row_delete()']::text[];
  r text;
  v_bad text := NULL;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT')
       OR pg_catalog.has_table_privilege('anon', r, 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', r, 'INSERT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':anon/authenticated 還有權限');
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 應該要有 SELECT');
    END IF;
    -- 🛑 **service_role 不給 INSERT** —— 寫是 trigger 用 SECURITY DEFINER 做的。
    --    一個「留痕表」如果呼叫端寫得進去, 它就不是留痕。
    IF pg_catalog.has_table_privilege('service_role', r, 'INSERT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 不該有 INSERT');
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname = pg_catalog.split_part(r, '.', 2)) THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':RLS 沒開');
    END IF;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':anon/authenticated 還有 EXECUTE');
    END IF;
  END LOOP;

  -- 三支 trigger(trigger 沒有 ACL ⇒ 不進上面兩個陣列, 但要單獨驗)
  -- 🔴🔴 **只數「有沒有同名的」是不夠的**(codex R1 must-fix④):同名 trigger 可以被
  --   **停用**(`ALTER TABLE … DISABLE TRIGGER`)、**指到別的函式**、或**改成別的事件**,
  --   而那三種在「數同名」這把尺下**都算數** ⇒ 📌 **一個名字對得上的 trigger, 不代表它會做那件事。**
  --   ⇒ 這裡逐張表驗四件:存在 · **啟用**(tgenabled = 'O') · **指向本檔那支函式** · **AFTER DELETE**。
  --   🔬 `tgtype` 位元:bit0=ROW · bit1=BEFORE(0 ⇒ AFTER)· bit3=DELETE。
  FOREACH r IN ARRAY ARRAY['orders','order_items','order_legal_consents'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger g
        JOIN pg_class c ON c.oid = g.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = g.tgfoid
        JOIN pg_namespace pn ON pn.oid = p.pronamespace
       WHERE n.nspname='public' AND c.relname = r
         AND g.tgname = 'pcm_'||r||'_delete_audit_ad'
         AND NOT g.tgisinternal
         AND g.tgenabled = 'O'                              -- 啟用中(不是 D/R/A)
         AND pn.nspname='public' AND p.proname='pcm_log_order_row_delete'
         AND (g.tgtype & 1) = 1                             -- FOR EACH ROW
         AND (g.tgtype & 2) = 0                             -- AFTER(不是 BEFORE)
         AND (g.tgtype & 8) = 8                             -- DELETE
    ) THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad,
        r || ':trigger 不存在 / 被停用 / 指到別的函式 / 不是 AFTER DELETE ROW');
    END IF;
  END LOOP;

  -- 🔴 序列權限(codex R1 must-fix①:斷言原本完全沒查它)
  IF pg_catalog.has_sequence_privilege('service_role','public.orders_deleted_log_id_seq','UPDATE')
     OR pg_catalog.has_sequence_privilege('anon','public.orders_deleted_log_id_seq','UPDATE')
     OR pg_catalog.has_sequence_privilege('authenticated','public.orders_deleted_log_id_seq','UPDATE') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad,
      '序列 UPDATE 沒收乾淨 ⇒ 有人可以 setval 把取號推爆, 之後每一次刪單都會整筆回滾');
  END IF;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '留痕表事後斷言失敗(⟦db-ORDERDELETENOTRACE⟧):%', v_bad;
  END IF;
END $assert$;

COMMIT;
