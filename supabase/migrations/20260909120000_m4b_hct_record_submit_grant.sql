-- ⟦ship-HCTSUBMITNOGRANT⟧ 後台按「送新竹」被我們自己的權限擋住 —— 補一行 GRANT。
--
-- ══ 怎麼發現的 ═══════════════════════════════════════════════════════════
-- 2026-09-10 第一箱實按(包裹 `S9FC6P`)⇒ 畫面逐字:
--   `permission denied for function admin_record_hct_submit`
-- 🟢 **而它 fail-closed** —— 擋在【佔位列之前】⇒ 零 HTTP、零託運單,那一箱仍是乾淨的 `draft`
--    (`hct_status=draft` · `hct_request_id=null` · `hct_raw_response=null`, 唯讀實量)。
-- 🔴 **而三綠看不到它**:`shipment-submit-hct-action.test.ts` 的 `recordHctSubmit` 是 `vi.fn()`
--    ⇒ 那個假貨沒有 GRANT ⇒ 📌 **它在「叫得動」與「叫不動」兩個世界印同一個綠。**
--
-- ══ 🔴 為什麼只有它漏了 —— 答案不是「後來加的沒跟上」, 是相反 ══════════════
--   `20260904170000:179`  REVOKE ALL … FROM PUBLIC, anon, authenticated;   而【沒有】GRANT
--   `20260905320000:200`  REVOKE … + GRANT EXECUTE … TO service_role;      ✅
--   `20260908020000`      同上形狀                                          ✅
-- ⇒ 📌 本支要修的那一支是這一族【最早】那一個 —— **後面兩支才把形狀補齊**。
-- ⇒ 🛑 所以不必掃全庫:`20260904170000` 只建了兩個可授權物件, 另一個是 trigger 函式
--      (`pcm_b2_shipments_hct_request_id_write_once()`, **本來就不該有 GRANT**)⇒ 那支檔沒有第二個洞。
--
-- ══ 🔴🔴 而那支 migration 的收權斷言【跑了、綠了、而它問的是反方向】══════════
-- `20260904170000:220-236` 逐字三格:③a anon 叫得動⇒RAISE · ③b authenticated 叫得動⇒RAISE
--   · ③d postgres 叫不動⇒RAISE(負對照)。
-- 🎯 **三格全綠, 而【沒有一格在問「該有的那個角色有沒有」】。**
--    而 ③d 用的是 owner。⛔ ~~我一度寫「owner 對 SECDEF 函式恆為 true」~~
--    🔴 **那句是錯的**(codex R1 nit ⑦):**SECDEF 不會讓 owner 的 EXECUTE 恆真** ——
--    非 superuser 的 owner 撤得掉自己的普通 EXECUTE。
--    ⇒ 📌 **而那不影響本段的結論**:③d 買到的仍然只是「這把尺印得出 true」,
--      **它問的仍然是另一個方向** —— 三格加起來還是沒有人在問「該有的那個角色有沒有」。
-- ⇒ 🛑 「收權斷言」這個名字本身就說了它的射程:**它防【多給】, 不防【沒給】。**
-- ⇒ ✅ **所以本支的後置閘【兩個方向都問】** —— 見下面 $post$。
--
-- ══ 🔵 形狀從線上取, 不憑記憶 ═══════════════════════════════════════════
-- 簽章取自 `pg_get_function_arguments`(唯讀正式庫 2026-09-10):
--   `admin_record_hct_submit(text,text,text,jsonb)` · 回傳 void · secdef t · search_path=""
--   · **只有 1 支多載** ⇒ 一行 GRANT 就夠(GRANT 是對簽章給的)。
-- GRANT 的寫法抄兄弟 `20260905320000:200-201` 逐字。
-- ⚠️ 2026-09-09 我在 `admin_record_manual_refund` 上腦補過簽章、被 codex R1 抓到 ⇒ 不再犯。
--
-- ══ 🛑 這一片【不做】的事(寫出來免得下一個人以為漏了)═══════════════════════
-- ⛔ 不動函式本體 —— **零行為變更**:`prosrc` 的 md5 貼前貼後必須相同
--    (貼前實量 `d88b332249d3a72ff4b3dd9306f0c2ce`, 後置閘會比它)。
-- ⛔ 不補 REVOKE —— `20260904170000:179` 已經有了, 而 GRANT 不會取消它。
-- ⛔ 不動那支 trigger 函式。
-- ⛔ 不掃全庫找同型 —— 射程見上, 那是另一件事。
--
-- ══ ⚠️ 本支證不到什麼 ═══════════════════════════════════════════════════
-- **「`service_role` 就是後台用的那個角色」我沒有量** —— 是從「兄弟兩支給的是它、而
-- `admin_cancel_order` / `admin_record_manual_payment` 也是它」推的 ⇒ 📌 那是【一致性】不是【證據】,
-- 而它會在貼完之後那一按上被證實或推翻。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src    text;
  v_strict boolean;
  v_secdef boolean;
  v_cfg    text;
  v_owner  text;
BEGIN
  -- ① 目標在不在(簽章打錯的話下面每一格都會安靜地量到別的東西)
  IF pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 admin_record_hct_submit(text,text,text,jsonb) ⇒ 簽章不對或那支還沒貼';
  END IF;

  -- ② 收權對象
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role') THEN
    RAISE EXCEPTION '前置閘②:找不到角色 service_role ⇒ 這一行 GRANT 會失敗';
  END IF;

  -- ③ 🔴 **防重貼 —— 而它同時是「這一片還有沒有意義」那一題**
  IF pg_catalog.has_function_privilege(
       'service_role', 'public.admin_record_hct_submit(text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '前置閘③:service_role 已經叫得動了 ⇒ 這一片貼過了(或有人手動給過), 拒重貼';
  END IF;

  -- ④ 🔵 **正對照:那把尺不是恆回 false** —— 兄弟那支現在一定是 true
  IF NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_hct_reset_unknown_to_draft(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '前置閘④(正對照):連兄弟那支 service_role 都叫不動 ⇒ 這把尺壞了, ③ 那個 false 不算數';
  END IF;

  -- ⑤ 🔴 **本體指紋** —— 本片宣稱零行為變更, 而那要有一個貼前的值可以比
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)');
  IF pg_catalog.md5(v_src) <> 'd88b332249d3a72ff4b3dd9306f0c2ce' THEN
    RAISE EXCEPTION
      '前置閘⑤:函式體 md5 不是 2026-09-10 量到的那一版(實得 %)⇒ 有人動過它, 停下來看一眼再貼',
      pg_catalog.md5(v_src);
  END IF;

  -- ⑥ 🔴🔴 **執行屬性 —— `prosrc` 的 md5 【釘不到】這幾格**(codex R1 must-fix ①)。
  --    🛑 **最要命的是 `proisstrict`**:同樣的本體、同樣的 ACL,只要 `STRICT` 是 true,
  --      `shipment-submit-hct-action.ts:216` 寫佔位時傳的 `requestId = NULL`
  --      ⇒ 📌 **PostgreSQL 會【整個跳過函式本體】直接回 NULL, 而且不報錯**
  --      ⇒ TS 那端以為佔位寫好了 ⇒ **照樣送 HTTP** ⇒ 🔴 **防重送的佔位保護整個消失,而全綠。**
  --    ⇒ 🎯 **一個本體 md5 相同、而行為完全不同的世界** —— 那正是本閘存在的理由。
  SELECT p.proisstrict, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ','),
         pg_catalog.pg_get_userbyid(p.proowner)
    INTO v_strict, v_secdef, v_cfg, v_owner
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)');

  IF v_strict THEN
    RAISE EXCEPTION
      '前置閘⑥a:那支函式是 STRICT ⇒ requestId=NULL 那一發會【安靜地跳過本體】而不報錯 ⇒ 佔位保護失效, 拒貼';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION '前置閘⑥b:那支函式不是 SECURITY DEFINER(實得 %)⇒ 授權語意與本片假設的不同, 拒貼', v_secdef;
  END IF;
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '前置閘⑥c:proconfig 不是 search_path=""(實得 %)⇒ 名稱解析的射程變了, 拒貼', v_cfg;
  END IF;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION '前置閘⑥d:owner 不是 postgres(實得 %)⇒ SECDEF 跑在誰身上變了, 拒貼', v_owner;
  END IF;
END
$pre$;

GRANT EXECUTE ON FUNCTION public.admin_record_hct_submit(text,text,text,jsonb)
  TO service_role;

-- ── 後置閘:**兩個方向都問** ──────────────────────────────────
-- 🛑 只問「該有的有沒有」會複製 `20260904170000` 的形狀(它只問了「不該有的有沒有」)。
DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.admin_record_hct_submit(text,text,text,jsonb)'
  ]::text[];
  v_fn  text;
  v_acl text;
  v_src text;
  v_n   int;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    -- ① ✅ **該有的那一個真的有了** —— 這是 20260904170000 缺的那個方向
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘①:service_role 仍然叫不動 % ⇒ 這一片貼了等於沒貼', v_fn;
    END IF;

    -- ② 🛑 **而沒有順手開錯門** —— 兩個不該有的仍然不該有
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘②a:anon 竟然叫得動 % ⇒ 匿名連線寫得了新竹狀態', v_fn;
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘②b:authenticated 竟然叫得動 % ⇒ 任何登入的【客人】寫得了新竹狀態', v_fn;
    END IF;

    -- ③ ⚪ **負對照:上面那兩個 false 要有判別力。**
    --    ⛔ ~~用 owner(`postgres`)當負對照~~ —— **codex R1 nit ⑦ 訂正**:
    --      **SECDEF 不會讓 owner 的 EXECUTE 恆真**(非 superuser 的 owner 撤得掉自己的),
    --      ⇒ 📌 那個「恆真」是我腦補的, 而一個會變的東西當不了負對照。
    --    ✅ 改用**兄弟那支** —— 它今天實量是 `service_role=X/postgres`,
    --      而本片**一個字都不會動它** ⇒ 它回 true 就證明這把尺印得出 true。
    IF NOT pg_catalog.has_function_privilege(
         'service_role', 'public.admin_hct_reset_unknown_to_draft(text,text,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION
        '後置閘③(負對照):兄弟那支 service_role 也叫不動 ⇒ 上面那兩個 false 沒有判別力(這把尺壞了)';
    END IF;

    -- ④ 🔵 **proacl 精確比對** —— ⛔ ~~`LIKE '%service_role=X/%'`~~ **codex R1 nit ② 訂正**:
    --    `_` 在 LIKE 裡是**單字元萬用字元** ⇒ `serviceZrole=X/postgres` 也會命中,
    --    而 `old_service_role=X/postgres` 同樣命中 ⇒ 📌 **那個「逐字」是假的。**
    --    ✅ 改成拆開 ACL 逐項比 grantee/privilege/grantor,不用字串比對。
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = pg_catalog.to_regprocedure(v_fn)
       AND pg_catalog.pg_get_userbyid(a.grantee) = 'service_role'
       AND a.privilege_type = 'EXECUTE'
       AND pg_catalog.pg_get_userbyid(a.grantor) = 'postgres';
    IF v_n <> 1 THEN
      SELECT pg_catalog.array_to_string(p.proacl, ',') INTO v_acl
        FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn);
      RAISE EXCEPTION
        '後置閘④:% 的 ACL 裡「grantee=service_role · EXECUTE · grantor=postgres」不是恰好 1 項(實得 %;proacl=%)',
        v_fn, v_n, v_acl;
    END IF;

    -- ⑤ 🔴🔴 **角色切換那條路**(codex R1 must-fix ②)——
    --    `has_function_privilege('anon', …)` 量的是**有效權限**,
    --    而一個 `INHERIT FALSE, SET TRUE` 的 membership 會讓 `anon` **仍然回 false**,
    --    卻可以 `SET ROLE service_role` 之後執行 ⇒ 📌 **上面②那兩格看不到這條路。**
    --    🔬 **今天實量:`anon` / `authenticated` 對 `service_role` 兩種語意皆 f**
    --      (而 `authenticator` 是成員, `inherit_option=f · set_option=t` —— 那是 PostgREST 的設計,
    --       本閘**不擋它**);⇒ 本格買的是「**這件事今天成立, 而它被寫下來了**」。
    --    📎 同族路徑列在 `docs/patterns/revoking-function-execute-in-supabase.md` §3.5。
    IF pg_catalog.pg_has_role('anon', 'service_role', 'MEMBER') THEN
      RAISE EXCEPTION '後置閘⑤a:anon 是 service_role 的成員 ⇒ 它可以 SET ROLE 之後叫得動 %, 而②看不到', v_fn;
    END IF;
    IF pg_catalog.pg_has_role('authenticated', 'service_role', 'MEMBER') THEN
      RAISE EXCEPTION '後置閘⑤b:authenticated 是 service_role 的成員 ⇒ 同上, 而②看不到 %', v_fn;
    END IF;
  END LOOP;

  -- ⑥ 🔴 **零行為變更** —— 本體一個字都不該動
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)');
  IF pg_catalog.md5(v_src) <> 'd88b332249d3a72ff4b3dd9306f0c2ce' THEN
    RAISE EXCEPTION '後置閘⑥:函式體 md5 變了(實得 %)⇒ 本片宣稱零行為變更而它不成立',
      pg_catalog.md5(v_src);
  END IF;

  -- ⑦ ⚪ **那支 trigger 函式【仍然】誰都叫不動** —— 順手開錯門的第二個方向
  IF pg_catalog.has_function_privilege(
       'service_role', 'public.pcm_b2_shipments_hct_request_id_write_once()', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑦:trigger 函式竟然被授權給 service_role ⇒ 這一片動到了它不該動的東西';
  END IF;

  RAISE NOTICE '⟦ship-HCTSUBMITNOGRANT⟧ 貼好了:service_role 現在叫得動 admin_record_hct_submit;anon/authenticated 仍然不行;函式體 md5 未變。';
END
$post$;

COMMIT;
