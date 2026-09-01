-- ⟦b4-PCMRO1⟧ · 收掉唯讀角色 `pcm_readonly` 對【客戶清單 view】的讀取權
--
-- ══ 這支在做什麼(一句話)═══════════════════════════════════════════════════
--   一個叫 `pcm_readonly` 的唯讀帳號今天讀得到 `public.admin_customer_list_v` ——
--   那張 view 上有【全體客戶的生日、姓名、電話、Email、性別】。本支把那一張收掉,
--   並關掉「以後每建一張新表就自動再發一次」的那個機制。
--
-- ══ 🔴 Sean 的拍板, 與它的【射程】═══════════════════════════════════════════
--   2026-09-01 端他的題逐字:「那個唯讀帳號 pcm_readonly 讀得到全體客人的生日, 要留著嗎?」
--   他答:收掉。
--
--   🔴🔴 **而「收掉」有兩種讀法:只收客戶 PII / 整個帳號收掉。本支做的是【兩種讀法的交集】。**
--   ⇒ 他答前者 ⇒ 本支就是那個答案;他答後者 ⇒ 本支是它的前半段, 後面再加一發 ⇒ 兩條路都不會白做。
--
--   ⛔⛔ **【一個被推翻的理由, 留著不刪 —— 因為它已經傳到 Sean 面前了】**
--   ~~本支選窄版的理由是:那個帳號就是我們自己在用的那條唯讀連線~~
--   ~~(`PCM_READONLY_DATABASE_URL`;`docs/patterns/traps-inbox/G-20260831e-…md:4` 逐字~~
--   ~~「量測地點 = 網站庫的正式庫(唯讀連線 `pcm_readonly`)」)⇒ 全收會打斷我們自己的查證。~~
--   🔴 **那句話是【假的】, 而它是本窗 2026-09-01 從那支 traps 檔的【字面】讀來的, 沒有人量過。**
--      線 `-15` 實測(正式庫, 同一分鐘):
--        `pg_stat_activity` ⇒ `pcm_readonly` **0 條連線**
--          🟢 而尺是活的:authenticator 21 · payment_confirmer 1 · postgres 1
--        碼裡引用(`.ts/.tsx/.sh/.yml/.json`)⇒ **1 支**, 而它是 `scripts/rls-policy-debt.sh`(稽核腳本, 非產線)
--          🟢 正對照 `payment_confirmer` 同範圍 ⇒ **50** 支 ⇒ 尺會動
--        `.sql` 命中 4 支, 全部是【描述它】不是【使用它】
--   📌 **⇒ 那條鏈的形狀值得留著**:一支文件的字面 → 本窗當成事實 → 主視窗轉述 → 端到 Sean 面前。
--      **三手之後它變成一句關於【正式庫現況】的斷言, 而源頭只是一份文件怎麼寫。**
--      **⇒ 擋下它的是 `-15` 去【量了自己那條連線】—— 唯一一個不經過那條鏈的動作。**
--
--   ✅ **⇒ 而【窄版仍然是對的做法】, 換一個沒有被推翻的理由:**
--      全收要一起改【兩支已經在 `dev` 上的 migration】(`20260901170000` / `20260901080000`),
--      而它們的斷言前提逐字就是「`pcm_readonly` 應該要有 SELECT」
--      ⇒ **全收 = 一片動三個地方;窄版 = 一片動一個地方。**
--   🔴 **⇒ 為什麼要把被推翻的那半留著**:一個【對的結論】被一個【已被推翻的理由】撐著,
--      下一個人去驗那個理由、驗不過, 他會把結論一起丟掉 —— **而他每一步都正確。**
--
-- ══ 🛑 本支【不做】什麼(寫出來, 因為漏掉的那半才是下一個人會踩的)═══════════
--   ① 不動 `rolbypassrls` —— `pcm_readonly` 的 `rolbypassrls = t`(線 `-0e` 唯讀實查),
--      也就是 RLS 對它不存在。**那是獨立的一件, 已另開列。**動 `ALTER ROLE` 會讓
--      「我們自己還查不查得動正式庫」變成第二個變數 ⇒ 一片一個變數。
--   ② 不收其他 67 張表 —— 線 `-0e` 唯讀實查:`pcm_readonly` 在 public 的表上共 **68** 筆權限。
--      本支只收 1 張。**剩下 67 張的清單, 本支會印出來(第 ⑩ 段), 而不會動它們。**
--
--   🔴🔴 **【codex R1 MF4 · 檔頭原本說謊的那一格】本支的射程【不只一張 view】:**
--      第 ⑥ 段的 `ALTER DEFAULT PRIVILEGES … REVOKE` 取消的是這個角色對
--      **所有【未來】新建的 public relation** 的自動授權 —— 那比「一張 view」寬得多。
--      ⇒ **而它是必要的**:不關掉它, 下一支 migration 建的新表又自動發給它一次,
--        而那時斷言【再次開始紅】, 沒有人會知道為什麼「明明收過了」。
--      ⇒ 📌 **但它確實超出 Sean 那句話的【字面】** ⇒ 交件說明第一段已明寫這件事,
--        而還原指令(第 ⑪ 段)會照【真的收了哪些 grantor】印出來, 不是寫死一句。
--      🔵 現有的 68 張表【一張都沒有被這一段動到】—— 它只管未來的。
--   ③ 不改 `20260901170000` 那支已在 dev 的 migration —— 它 `:191` 有一條
--      `GRANT SELECT ON TABLE public.product_fitments_effective TO pcm_readonly`。
--      🔵 那是【車型對應表】, 零客戶 PII ⇒ 與本支不衝突 ⇒ 一個字都不用改。
--      🔴 **而如果將來改成「整個帳號收掉」, 那條 GRANT 會把權限發回去一格** ——
--         它的 `IF EXISTS` 判的是【角色存不存在】, 不是【它該不該有權限】⇒ 角色還在 ⇒ 走 THEN ⇒
--         安靜地 GRANT, 一個 WARNING 都不印。**那一格要跟著那一題一起處理。**(寫它的線 `-0e` 已認)
--
-- ══ 🔴 驗收為什麼不用 `information_schema` ═══════════════════════════════════
--   線 `-0e` 同一個問題、同一條連線、同一分鐘, 兩把尺:
--     `information_schema.role_table_grants` ⇒ pcm_readonly 68 張 · service_role **0** 張
--     `pg_catalog` + `aclexplode`            ⇒ pcm_readonly 68 · postgres 68 · service_role 55
--                                              · authenticated 17 · anon 10
--   ⇒ `information_schema` 只給【當前角色看得見的】授權 ⇒ 從唯讀帳號跑它系統性少報。
--   🛑 **而少報的形狀是「那個角色沒有權限」—— 那正是做 REVOKE 驗收時最想看到的答案。**
--   📌 而 `-0e` 自陳:那個 `service_role ⇒ 0` **它原本是拿來當正對照的**
--      ⇒ **一個回 0 的正對照, 意思是「這把尺沒有動」, 而它差點被讀成一個事實。**
--   ⇒ ⇒ **所以本支的每一發斷言都走 `pg_catalog` + `aclexplode`。**
--   ⚠️ 射程:那兩發都是同一個唯讀帳號跑的;換高權限帳號跑 `information_schema` 會不會一樣少報,
--      `-0e` 沒有量(它沒有那個連線)。

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 codex 對抗審查 R1 = FAIL(7 must-fix / 2 nit)。以下逐條寫在它被修的那一段旁邊。
--    最貴的一條是 MF1:**原版斷言問的是「有沒有直接授權」, 而要問的是「它讀不讀得到」** ——
--    那兩個問題在 PUBLIC 授權 / 角色繼承 / 欄級授權底下會給【相反的答案】,
--    而錯的那個方向是【印綠而它仍然讀得到】。
-- ─────────────────────────────────────────────────────────────────────────────
DO $pcmro_revoke$
DECLARE
  v_role      CONSTANT text := 'pcm_readonly';
  v_view      CONSTANT text := 'public.admin_customer_list_v';
  v_role_oid  oid := to_regrole(v_role);
  v_oid       oid;
  v_owner     name;
  v_direct    int;
  v_colacl    int;
  v_eff       boolean;
  v_defacl    int;
  v_pub_def   int;
  v_rec       record;
  v_left      int := 0;
  v_did_tbl   boolean := false;
  v_did_col   int := 0;
  v_grantors  text[] := '{}';
  -- 🔴 【codex R2 MF7 / 新洞2】收的是 `REVOKE ALL`, 而還原若只補 SELECT ⇒ 非 SELECT 的權限【永久消失】
  --    ⇒ 動手前把【真的有哪些權限】記下來, 還原指令照這份印。
  v_tbl_privs text := NULL;
  v_col_undo  text[] := '{}';
  v_def_undo  text[] := '{}';
  v_glob_def  int;
  v_pub_privs text;
  -- 🔴 還原句要用 text 裝, 不能用 v_owner(它是 `name`, 上限 63 位元組 ⇒ 會【靜靜截斷】)
  v_line      text;
BEGIN
  -- ① 角色不在就整支跳過 —— 而【跳過這件事要出聲】
  --    `to_regrole()` 對不存在的角色回 NULL(不像 `::regrole` 會拋錯)⇒ harness 環境跑得起來。
  IF v_role_oid IS NULL THEN
    RAISE WARNING
      '% 不存在 ⇒ 本支整支跳過(REVOKE 與 ALTER DEFAULT PRIVILEGES 都沒有跑)。'
      ' 🔴 而本 migration 仍會被記成 applied ⇒ 這件事不會自己補回來。板 ⟦b4-PCMRO1⟧。', v_role;
    RETURN;
  END IF;
  v_oid := v_view::regclass;

  -- ② 【codex MF6】預檢:誰是 owner、我是誰。REVOKE 需要是 owner 或其成員。
  --    🔴 不預檢的話, 失敗形狀是一個生的 `permission denied`, 而貼的人看不出要怎麼辦。
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO v_owner FROM pg_catalog.pg_class c WHERE c.oid = v_oid;
  RAISE NOTICE '② 預檢:% 的 owner = % · 現在執行的身分 = %', v_view, v_owner, current_user;
  IF NOT pg_catalog.pg_has_role(current_user, v_owner, 'USAGE') THEN
    RAISE EXCEPTION
      '執行身分 % 不是 % 的成員 ⇒ REVOKE 會被拒。請改用 % 或其成員貼這一支。'
      ' 🛑 這是刻意擋下的:「收不掉」與「收乾淨了」不得印同一個結果。', current_user, v_owner, v_owner;
  END IF;

  -- ③ 動手前的四個數字 —— 而它們問的是【四件不同的事】
  --    直接授權(relacl) / 欄級授權(attacl) / 有效權限(含 PUBLIC 與繼承) / 預設權限
  SELECT count(*), string_agg(DISTINCT a.privilege_type, ', ' ORDER BY a.privilege_type)
    INTO v_direct, v_tbl_privs
    FROM pg_catalog.pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = v_oid AND a.grantee = v_role_oid;
  SELECT count(*) INTO v_colacl
    FROM pg_catalog.pg_attribute att, aclexplode(att.attacl) a
   WHERE att.attrelid = v_oid AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee = v_role_oid;
  v_eff := pg_catalog.has_table_privilege(v_role, v_oid, 'SELECT');
  SELECT count(*) INTO v_defacl
    FROM pg_catalog.pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND a.grantee = v_role_oid;
  RAISE NOTICE '③ 動手前:表級直接授權 % 筆 · 欄級授權 % 筆 · 有效讀得到=% · public 預設權限 % 筆',
    v_direct, v_colacl, v_eff, v_defacl;

  -- ④ 收表級
  IF v_direct > 0 THEN
    EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', v_view, v_role);
    v_did_tbl := true;
  END IF;

  -- ⑤ 【codex MF2 / nit1】收欄級 —— `REVOKE ALL ON TABLE` **不會**收掉欄級授權,
  --    而欄級授權住在 `pg_attribute.attacl`, `relacl` 看不到它 ⇒ 原版斷言對它是【全盲】的。
  FOR v_rec IN
    SELECT att.attname, string_agg(DISTINCT a.privilege_type, ', ' ORDER BY a.privilege_type) AS privs
      FROM pg_catalog.pg_attribute att, aclexplode(att.attacl) a
     WHERE att.attrelid = v_oid AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee = v_role_oid
     GROUP BY att.attname
  LOOP
    v_col_undo := v_col_undo || format('GRANT %s (%I) ON TABLE %s TO %I;', v_rec.privs, v_rec.attname, v_view, v_role);
    EXECUTE format('REVOKE ALL (%I) ON TABLE %s FROM %I', v_rec.attname, v_view, v_role);
    v_did_col := v_did_col + 1;
    RAISE NOTICE '⑤ 已收欄級授權:% (原本有 %)', v_rec.attname, v_rec.privs;
  END LOOP;

  -- ⑥ 關掉「以後每建一張新表就自動再發一次」
  --    🔴 這一段是【必要的】不是保險:`pg_default_acl` 上有一條 `defaclobjtype='r'`
  --       把 SELECT 發給它(線 -0e 唯讀實查)⇒ 只收現有的 ⇒ 下一支 migration 建的表又長回來,
  --       而那時斷言【再次開始紅】, 沒有人會知道為什麼「明明收過了」。
  --    🔴 【codex MF5】原版無條件 `REVOKE ALL ON TABLES` ⇒ 若那條預設權限不只給 SELECT,
  --       會連別的一起收掉而沒有人知道 ⇒ 改成【先把它有哪些權限印出來, 再收】。
  --    🔴 【codex MF4】而這一段的射程【比一張 view 寬】:它取消的是這個角色對
  --       **所有未來 public relation** 的自動授權。**檔頭已改寫成明說這件事。**
  FOR v_rec IN
    SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS grantor,
           string_agg(DISTINCT a.privilege_type, ', ' ORDER BY a.privilege_type) AS privs
      FROM pg_catalog.pg_default_acl d, aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND a.grantee = v_role_oid
     GROUP BY d.defaclrole
  LOOP
    -- ⚠️ 【codex MF6】若某個 grantor 是【貼的人不是其成員】的角色(例如 `supabase_admin`),
    --    這一發會 `permission denied` 而整支停下 —— **那是刻意的 fail-closed**。
    RAISE NOTICE '⑥ grantor=% 的預設權限現在給了:% ⇒ 全部收掉', v_rec.grantor, v_rec.privs;
    v_def_undo := v_def_undo || format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT %s ON TABLES TO %I;',
      v_rec.grantor, v_rec.privs, v_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
                   v_rec.grantor, v_role);
    v_grantors := v_grantors || v_rec.grantor;
  END LOOP;

  -- ═══ ⑦ 斷言 —— 【codex MF1】這一格是本次審查最貴的一條 ═══════════════════════
  --   原版問的是「`relacl` 裡還有沒有它」⇒ 而 SELECT 可以從 **PUBLIC / 角色繼承 / 欄級** 來,
  --   那三條路底下 `relacl` 是乾淨的 **而它仍然讀得到** ⇒ 綠而洞還在。
  --   ⇒ **改成問「它讀不讀得到」** —— `has_table_privilege` 走的是有效權限, 三條路都涵蓋。
  --   🔴🔴 **【codex R2 MF1/MF2/新洞3】而 R1 的折法【只折了一半】**:
  --      `has_table_privilege` 答的是【整張表的 SELECT】—— 它抓不到
  --      「PUBLIC 或某個繼承來的角色, 在【某一欄】上有 SELECT」。
  --      ⇒ 那條路底下它印 false, 而那個帳號仍然讀得到【生日那一欄】。
  --      ⇒ ⇒ **改成逐欄問 `has_column_privilege`** —— 表級 SELECT 蘊含每一欄, 所以它【涵蓋】上一版,
  --        而且多涵蓋欄級那條路。**一張 view 只要有一欄讀得到, 就算沒收乾淨。**
  SELECT count(*) INTO v_colacl
    FROM pg_catalog.pg_attribute att
   WHERE att.attrelid = v_oid AND att.attnum > 0 AND NOT att.attisdropped
     AND pg_catalog.has_column_privilege(v_role, v_oid, att.attnum, 'SELECT');
  IF v_colacl <> 0 THEN
    RAISE EXCEPTION
      '🔴 收完了而 % 仍然讀得到 % 的 % 個欄位 —— 表級已收 %, 欄級收了 % 個, 而【逐欄有效權限】仍是 true。'
      ' ⇒ 來源【不是直接授權】: 可能是 PUBLIC、角色繼承、或這個 view 的 owner 就是它。'
      ' 本支刻意停在這裡:那幾條路各要各自的修法, 不是本片的範圍。'
      ' 🛑 而【停下來】是刻意的 ——「收不掉」不得與「收乾淨了」印同一個結果。',
      v_role, v_view, v_colacl, v_did_tbl, v_did_col;
  END IF;
  -- 而直接授權那一層另外驗一次(它答的是【誰發的】, 與上面那格的【讀不讀得到】是兩個問題)
  SELECT count(*) INTO v_direct
    FROM pg_catalog.pg_attribute att, aclexplode(att.attacl) a
   WHERE att.attrelid = v_oid AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee = v_role_oid;
  IF v_direct <> 0 THEN
    RAISE EXCEPTION '🔴 欄級直接授權沒收乾淨 —— % 在 % 上還有 % 筆', v_role, v_view, v_direct;
  END IF;
  --   🔴🔴 **【codex R2 MF3/新洞1】而預設權限有【兩種】, 而 R1 只查了一種**:
  --      `ALTER DEFAULT PRIVILEGES … IN SCHEMA public …`  ⇒ `defaclnamespace = 'public'::regnamespace`
  --      `ALTER DEFAULT PRIVILEGES …`(不帶 IN SCHEMA)     ⇒ `defaclnamespace = 0`(全域, 對每個 schema 都生效)
  --      ⇒ 只查前者 ⇒ 後者存在時斷言【印 0 而洞還在】, 而那是最糟的方向。
  SELECT count(*) INTO v_defacl
    FROM pg_catalog.pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND a.grantee = v_role_oid;
  IF v_defacl <> 0 THEN
    RAISE EXCEPTION '🔴 預設權限沒關掉 —— public 的 relation 預設權限裡 % 還有 % 筆 ⇒ 下一張新表又會自帶', v_role, v_defacl;
  END IF;
  SELECT count(*) INTO v_glob_def
    FROM pg_catalog.pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 0 AND d.defaclobjtype = 'r' AND a.grantee = v_role_oid;
  IF v_glob_def <> 0 THEN
    RAISE EXCEPTION
      '🔴 有 % 筆【全域】relation 預設權限(不帶 IN SCHEMA)還發給 % ⇒ 下一張新表照樣自帶,'
      ' 而本支只收得掉 public 那一種。'
      ' 🛑 收全域的會影響【每一個 schema】⇒ 超出本片射程 ⇒ 刻意停在這裡, 不印綠。'
      ' 修法:ALTER DEFAULT PRIVILEGES FOR ROLE <grantor> REVOKE ALL ON TABLES FROM %;(不帶 IN SCHEMA)',
      v_glob_def, v_role, v_role;
  END IF;
  RAISE NOTICE '⑦ 斷言全過:逐欄有效權限=0 欄 · 欄級直接授權=0 · public 預設權限=0 · 全域預設權限=0';

  -- ⑧ 【codex MF3】而 PUBLIC 的預設權限本支【收不到, 也不該收】—— 但它要出聲
  --    🔴 【codex R2 新洞4】原版不分權限種類就說「所有人都讀得到」—— 那條 default ACL 可能只給 INSERT。
  --       ⇒ 把權限清單印出來, 並且只在【真的有 SELECT】時才說「讀得到」。
  --    🔴 而這裡同樣要含全域那一種(`defaclnamespace = 0`), 理由同第 ⑦ 段。
  SELECT count(*), string_agg(DISTINCT a.privilege_type, ', ' ORDER BY a.privilege_type)
    INTO v_pub_def, v_pub_privs
    FROM pg_catalog.pg_default_acl d, aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace IN (0, 'public'::regnamespace) AND d.defaclobjtype = 'r' AND a.grantee = 0;
  IF v_pub_def > 0 AND v_pub_privs ~ '\mSELECT\M' THEN
    RAISE WARNING
      '⚠️ 有 % 筆【發給 PUBLIC】的 relation 預設權限(含 SELECT:%)⇒ 以後每一張新表【所有人】都讀得到,'
      ' 而 % 也在「所有人」裡面。**本支收不到它**(收 PUBLIC 會打壞整個站)⇒ 另開一列。',
      v_pub_def, v_pub_privs, v_role;
  ELSIF v_pub_def > 0 THEN
    RAISE NOTICE '⑧ 有 % 筆發給 PUBLIC 的 relation 預設權限, 而【不含 SELECT】(%)⇒ 讀取那條路是關的',
      v_pub_def, v_pub_privs;
  ELSE
    RAISE NOTICE '⑧ 沒有發給 PUBLIC 的 relation 預設權限(這條路是關的)';
  END IF;

  -- ⑨ `20260826140000` 那支的閉世界斷言就是卡在這裡 ⇒ 順手驗它現在過不過
  SELECT count(*) INTO v_direct
    FROM pg_catalog.pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = v_oid AND a.grantee <> c.relowner
     AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role');
  IF v_direct <> 0 THEN
    RAISE WARNING
      '⚠️ `20260826140000` 的閉世界斷言【現在仍然不會過】—— 還有 % 筆非 owner / 非 service_role 的授權。'
      ' 本支收掉的是 % 那一筆, 而它不是唯一的一筆 ⇒ 那一支要 apply 之前還要再收一輪。', v_direct, v_role;
  ELSE
    RAISE NOTICE '⑨ `20260826140000` 的閉世界斷言現在會過(非 owner / 非 service_role 的授權 = 0)';
  END IF;

  -- ⑩ 🎯 而本支最有用的產出不是 REVOKE, 是【這一段】——
  --    它把「% 還讀得到哪些帶客戶 PII 的東西」印出來, 而那個清單【沒有人有】:
  --    repo 只建過 53 個 public 物件, 而正式庫給它的是 68 張 ⇒ **repo 不是分母, 正式庫才是。**
  --    🔵 這裡用 `has_table_privilege`(有效權限)—— 問的是「它讀不讀得到」。
  --    🔴 【codex nit2】欄名特徵是【啟發式】, 兩個方向都會錯:
  --       **多報** —— `email` 也可能是供應商聯絡信箱、`address` 也可能是倉庫地址;
  --       **少報** —— 刻意不收 `name`(商品名/品牌名會全部命中)⇒ 只有 `name` 欄的客戶表會漏。
  --       ⇒ ⇒ **它是下一片的【起點】, 不是結論。逐張開來看之前不要拿它當數字用。**
  FOR v_rec IN
    SELECT c.relname,
           string_agg(DISTINCT att.attname, ', ' ORDER BY att.attname) AS pii_cols
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
       AND att.attname ~* '(birth|dob|gender|phone|mobile|telephone|address|email|id_number|tax_id|recipient)'
       AND pg_catalog.has_table_privilege(v_role, c.oid, 'SELECT')
     GROUP BY c.relname
     ORDER BY c.relname
  LOOP
    v_left := v_left + 1;
    RAISE NOTICE '⑩ 仍讀得到(欄名像客戶資料): % —— %', v_rec.relname, v_rec.pii_cols;
  END LOOP;
  RAISE NOTICE '⑩ 合計:% 仍讀得到 % 張(本支【刻意沒收】它們 —— 見檔頭「本支不做什麼」②)', v_role, v_left;

  -- ⑪ 【codex MF7】還原指令 —— **照【真的做了什麼】產生, 不寫死**。
  --    🔴 原版無條件印一句 `GRANT SELECT … TO pcm_readonly`, 而在【本來就沒有 grant】的世界照著做
  --       = **憑空發一個客戶 PII 的讀取權**。⇒ 一句還原指令可以自己製造它要還原的那個病。
  IF NOT v_did_tbl AND v_did_col = 0 AND cardinality(v_grantors) = 0 THEN
    RAISE NOTICE '⑪ 本支【什麼都沒收】(動手前就已經是乾淨的)⇒ 沒有東西要還原, 不要跑任何 GRANT。';
  ELSE
    -- 🔴 【codex R2 MF7/新洞2】收的是 `REVOKE ALL` ⇒ 還原句必須照【動手前真的有哪些權限】印,
    --    寫死 `GRANT SELECT` 會把非 SELECT 的權限永久弄丟, 而還原的人不會知道少了什麼。
    IF v_did_tbl THEN
      RAISE NOTICE '⑪ 還原表級:GRANT % ON TABLE % TO %;', v_tbl_privs, v_view, v_role;
    END IF;
    FOREACH v_line IN ARRAY v_col_undo LOOP
      RAISE NOTICE '⑪ 還原欄級:%', v_line;
    END LOOP;
    FOREACH v_line IN ARRAY v_def_undo LOOP
      RAISE NOTICE '⑪ 還原預設權限:%', v_line;
    END LOOP;
  END IF;
END
$pcmro_revoke$;
