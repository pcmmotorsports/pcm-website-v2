-- ═══ 貼板 107:三支 trigger 函式補【第二道 REVOKE】 ═══
-- 出板:線【sync】-sync, 2026-09-09。板列 ⟦auth-HALFREVOKEDTRIGGERS⟧(`docs/launch-todo.md:1457`)。
--
-- ── 病(板列逐字, 我開檔複驗過)──────────────────────────────────────────
--   這三支的 migration 裡【有】 `REVOKE`, 而它只收了 `PUBLIC`:
--     pcm_staff_touch_updated_at      20260726120000_m4b_e8a1_staff_table.sql:53
--     pcm_suppliers_block_delete      20260801140000_m4b_e10_s1a_suppliers.sql:112
--     pcm_suppliers_touch_updated_at  20260801140000_m4b_e10_s1a_suppliers.sql:77
--   三行逐字都是 `REVOKE ALL ON FUNCTION public.<名>() FROM PUBLIC;` —— 只有一個對象。
--   而線上唯讀實測:三支各自對 `anon` / `authenticated` / `service_role` 都仍有 EXECUTE(共 9 對)。
--
--   ⛔ ~~`REVOKE … FROM PUBLIC` 對具名角色【從來就沒有效果】~~
--      —— 🔴🔴 **那句是【錯的全稱句】, 而它同時活在三個地方**:板列 `⟦auth-HALFREVOKEDTRIGGERS⟧`、
--      `20260805170000_…:250-251` 的註解, 以及本檔的第一版。**2026-09-09 codex R1 must-fix 1 打掉它。**
--   ✅ **正確的說法(三種來源要分開)**:
--        `REVOKE … FROM PUBLIC` **只**移除【經由 PUBLIC 取得】的權限。
--        它移除不了 ① 直接授給具名角色的 ② 由其他角色繼承來的。
--      ⇒ 📌 **一個【只】靠 PUBLIC 拿到權限的具名角色, 收 PUBLIC 就會失去它。**
--   🔬 **而這一格有實證, 是 `-sync` 2026-09-09 在拋棄式 PG 上量到的 —— 而【前提要寫全】**
--      (codex R2 must-fix 1 打的就是我第一版把前提寫漏):
--        該庫跑過本 repo 的 migration ⇒ 三支各有原始那道 `REVOKE … FROM PUBLIC`;
--        🔴 **而 `service_role` 那一格是我【刻意直接 GRANT 上去】造出來的負世界 fixture**,
--           不是它自己長成那樣。
--        量到:anon -> 三支 = false · authenticated -> 三支 = false
--              service_role -> 三支 = true(= 我造的那個直接授權)
--      ⇒ ✅ **它證得了的**:【直接授權存在時, 收 PUBLIC 收不掉它, 而本檔這三道 REVOKE 收得掉】。
--      🛑 **它證不了的(codex R2 逐字)**:**線上那 9 對為 true 的【來源】是什麼。**
--         ⇒ ⛔ ~~所以線上那 9 對的受詞是【Supabase 給了直接授權】~~
--         ⇒ ✅ **線上的結果與【直接授權】和【角色繼承】兩種來源都相容;本片沒有分。**
--            **本檔撤得掉直接授權;若來源是繼承, 事後閘① 會擋下並整支回滾**(見本體前那一段)。
--      ⚠️ **而那台鑽機對 anon / authenticated 零判別力**(它們那一側從一開始就是 false)
--         ⇒ 本檔的負世界只能由 `service_role` 那一格演出來。
--      📎 `docs/patterns/revoking-function-execute-in-supabase.md` §2 有拋棄式 PG 的實跑。
--
--   🔴🔴 **而最該記的是這一句(板列原文)**:**一份寫對了的 patterns 檔, 擋不住沒有讀到它的人。**
--      那份檔存在, 而這三支還是踩了。
--
-- ── 🛑 修的是什麼, 要講準(板列裁定寫成【兩句】, 合寫會讓其中一句消失)────────
--   ① **可利用性 = 0 ⇒ 這不是上線前必修。** 三支唯讀實測 `prorettype = trigger`、
--      `prosecdef = f`(非 SECURITY DEFINER);而 `docs/reviews/2026-08-05-b2-s1-ablation-ledger.md`
--      第 3 列實測過 `SET ROLE anon; SELECT <trigger 函式>();` ⇒
--      `ERROR: trigger functions can only be called as triggers`。
--      ⚠️ 而那份測的是**另外八支**, 不是本檔這三支 ⇒ 它證的是**通則**有人實測過。
--   ② **而檔內那句 ACL 宣稱是假的 ⇒ 仍要修。** 受詞是【宣稱與事實的落差】——
--      `20260805170000_…:252-253` 逐字「修它的理由是【讓檔內那句 ACL 宣稱變成真的】,
--      不是堵一個今天可觸發的漏洞」。
--   🛑 **為什麼一道半比零道糟**(板列原文):
--        沒有人守那個入口   ⇒ 讀 migration 的人【看得出來沒收】
--        有人守了而只守一半 ⇒ 讀 migration 的人【看到 REVOKE 就過去了】
--      ⇒ 📌 **一道半的守門會【關掉下一個人的檢查動作】。**
--
-- ── ✅ 我補掉了板列自己標的第 ② 格「證不到」──────────────────────────────
--   板列逐字:「我**沒有查**這三支的 EXECUTE 有沒有被別的 migration 在別處收過(只查了它們自己那一支)」。
--   `-sync` 2026-09-09 掃全 `supabase/migrations/`:
--     `grep -rn "REVOKE.*pcm_staff_touch_updated_at" supabase/migrations/`      ⇒ 1 行(:53, FROM PUBLIC)
--     `grep -rn "REVOKE.*pcm_suppliers_block_delete" supabase/migrations/`      ⇒ 1 行(:112, FROM PUBLIC)
--     `grep -rn "REVOKE.*pcm_suppliers_touch_updated_at" supabase/migrations/`  ⇒ 1 行(:77, FROM PUBLIC)
--   🟢 正對照 同尺問 `pcm_auth_provider_of` ⇒ **2 行**(:145 具名三角色 · :146 PUBLIC)⇒ **尺撈得到兩行的形狀**。
--   ⚪ 負對照 現造函式名 ⇒ 0。
--   ⇒ ✅ **全 migration 未找到符合上述【同一行字面形狀】的其他 REVOKE。**
--   🛑 **而這【不是】「沒有人在別處收過」的完備證明**(codex R1 must-fix 3):這把尺漏得掉
--      跨行的 REVOKE · `REVOKE … ON ALL FUNCTIONS` · 動態 SQL · quoted identifier 或不同空白形狀 ·
--      `DROP`/重建造成的 ACL 改變。**正對照只證明它抓得到其中一種形狀, 證不出掃描完整。**
--      ⇒ 要真的答那一題, 得做語意層級的歷史重放或完整 ACL 盤點 —— **本片沒做。**
--
-- ── 🔴 我證不到的兩件(不要當成已排除)────────────────────────────────────
--   ① **REVOKE 之後 trigger 還會不會照常觸發** —— 我**沒有實跑**。
--      依據是 PostgreSQL 觸發 trigger 時**不檢查該函式的 EXECUTE 權限**(那是引擎行為, 不是我量到的)。
--      ✅ **缺的檢查寫在貼板包裡**:貼完去後台改一次員工資料、改一次供應商資料,
--         看 `updated_at` 有沒有跟著動 —— 那是唯一能證明「沒有把 trigger 弄壞」的觀察。
--      🛑 **本檔【刻意不在 migration 裡造資料來測】**:`pcm_suppliers_block_delete` 的職責就是擋刪除
--         ⇒ 造一列測完**清不掉**。一個為了驗證而留下垃圾的驗證, 比不驗更糟。
--   ② 線上那側**沒分**直接授權與角色繼承(板列第 ③ 格, 我也沒補)。
--
-- ── 🔴 rollback(codex R1 must-fix 4 —— 第一版整段沒有, 這裡補)───────────
--   **本 migration 沒有自動 rollback。**
--   🔵 **緊急功能性回復**:對指定角色重新 GRANT ——
--        `GRANT EXECUTE ON FUNCTION public.<函式名>() TO <角色>;`
--   🛑 **而那個 GRANT 有三件事做不到, 逐條**(codex R2 must-fix 3):
--      ① 還原不了 `WITH GRANT OPTION`;② 還原不了原本的 grantor / ACL provenance;
--      ③ 🔴 **若某角色套用前【本來就是 false】, 無條件 GRANT 會給出一條原本不存在的權限。**
--         而本檔**沒有**用前置閘鎖定「套用前九對必須全為 true」⇒ 這個風險是真的。
--      ⇒ 📌 **緊急 GRANT 只准對【已確認先前真的有直接 EXECUTE】的角色下, 一個都不要多。**
--   ✅ **在不知道既有 ACL 的情況下, 安全的精確回復需要【套用前的 ACL 快照】** ——
--      至少要留每支函式的完整 ACL:grantee · grantor · EXECUTE · grant option。
--      🔵 角色 membership 快照**另有用途**(追查繼承來源), **不是**本次 ACL 回退必須重建的東西。
--      ⇒ 🔴 **要能精確回退, 就得在貼之前先存那份快照** —— 貼板包裡附了那句唯讀 SQL。
--   🔵 **回退的急迫性低, 而理由要寫準**(codex R2 must-fix 2 打掉我第一版的「本片不改任何行為」):
--      ⛔ ~~本片不改任何行為(可利用性 0、trigger 照常觸發)~~
--      ✅ **本片【確實會改變】那三個角色對這三支函式的 EXECUTE ACL, 並可能影響未來的 `CREATE TRIGGER`。**
--         依 PostgreSQL 的權限語意, **預期**不影響既有 trigger 的執行 ——
--         🛑 **而本片【沒有做那個回歸】**, 所以不寫成既成事實(檔頭「我證不到的兩件」①同一句)。
--      ⇒ **不要為了「有 rollback」而急著跑上面那個 GRANT。**
--
-- ── 版本號(照 106 檔頭那一格的取法)──────────────────────────────────────
--   掃**全部 ref**:`git for-each-ref` ⇒ **100** 個 ref、`git ls-tree` 出已用 **400** 個號
--   ⇒ `20260909020000` **零命中**(🟢 正對照 `20260908120000` ⇒ 1, 尺是活的)。
--   ⛔ `20260909010000` **不要用** —— shop 2026-09-09 已佔(`…_m4b_search_catalog_keyword_terms.sql`,
--      當時**尚未 commit** ⇒ 上面那把掃 ref 的尺看不到它。📌 **未 commit 的號, 掃 ref 撈不到。**
--   🔴 commit 之後要再跑一次 `scripts/migration-version-dup-across-lines.sh`。

BEGIN;

-- ══ 前置閘 ══════════════════════════════════════════════════════════════
DO $gate$
DECLARE
  v_missing text;
  v_bad     text;
BEGIN
  -- 前置閘① 三支都在(不在 ⇒ 停;可能被改名或搬走, 那時本檔的座標全部過期)
  SELECT string_agg(n, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
           'pcm_staff_touch_updated_at',
           'pcm_suppliers_block_delete',
           'pcm_suppliers_touch_updated_at'
         ]) AS n
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND p.proname = n AND p.pronargs = 0
         );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '貼板107 前置閘①:這幾支公開零參數函式不存在 ⇒ 停, 先去確認它們被改名還是搬走了:%', v_missing;
  END IF;

  -- 前置閘② 🔴 三支都必須仍是【非 SECURITY DEFINER 的 trigger 函式】。
  --   為什麼要擋:本檔整個嚴重度判斷(可利用性 = 0)建立在這兩個性質上。
  --   若哪一支已經被改成 SECURITY DEFINER 或改成一般回傳型別 ⇒ **那是另一件事**,
  --   收 EXECUTE 可能改變行為 ⇒ 停下來, 不要讓本檔安靜地跑過去。
  SELECT string_agg(p.proname || '(prosecdef=' || p.prosecdef || ', rettype=' ||
                    pg_catalog.format_type(p.prorettype, NULL) || ')', ', ')
    INTO v_bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.pronargs = 0
     AND p.proname IN ('pcm_staff_touch_updated_at',
                       'pcm_suppliers_block_delete',
                       'pcm_suppliers_touch_updated_at')
     AND (p.prosecdef OR pg_catalog.format_type(p.prorettype, NULL) <> 'trigger');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '貼板107 前置閘②:有函式已不是「非 DEFINER 的 trigger 函式」⇒ 停, 本檔的嚴重度判斷不再成立:%', v_bad;
  END IF;
END
$gate$;

-- ══ 本體:第二道 REVOKE ══════════════════════════════════════════════════
-- 🔴 **只補【具名角色】那一道** —— `FROM PUBLIC` 那一道三支各自的原始 migration 已經下過
--    (座標在檔頭), 重下是 no-op;而**把它留在原地**才看得出「本檔補的是哪一半」。
-- 🔵 `service_role` 一併收 —— 它不需要直呼這三支(它們只由 trigger 觸發)。
-- ⛔ ~~而多收一道的代價是零~~ ⇒ 🔴 **那句過寬**(codex R1 finding 5):
--    收 EXECUTE **不影響既有 trigger 觸發**, 而它**會**讓該角色失去「拿這三支去建新 trigger」的資格
--    —— 建 trigger 時 PG 會檢查 trigger 函式的 EXECUTE。
--    ⇒ ✅ 正確的說法(純條件句, 不先斷言再自我否定):
--       **若那三個角色沒有建立 trigger 所需的 DDL 權限, 這一項的代價才是零。**
--       ⚠️ **那個前提我沒有實查** ⇒ 所以本檔不宣稱代價為零。
--
-- 🔴🔴 **本體只撤【直接授權】**(codex R1 must-fix 2):
--    若某個角色的 EXECUTE 是**由其他角色繼承**來的, 這三行撤不掉它
--    ⇒ `has_function_privilege()` 仍會回 true ⇒ **事後閘① 會讓整支 migration 中止並回滾**。
--    ⇒ 📌 **那時要另外去查權限來源角色 —— 而【不要】在本片盲目撤 membership 或來源 ACL。**
--       那是另一件事, 影響面比本片大得多。
REVOKE ALL ON FUNCTION public.pcm_staff_touch_updated_at()     FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_suppliers_block_delete()     FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_suppliers_touch_updated_at() FROM anon, authenticated, service_role;

-- ══ 事後閘 ══════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_fn      text;
  v_role    text;
  v_still   text := '';
  v_ownerok boolean;
BEGIN
  -- 事後閘① 9 對(3 函式 x 3 角色)全部必須是 false
  FOREACH v_fn IN ARRAY ARRAY['public.pcm_staff_touch_updated_at()',
                              'public.pcm_suppliers_block_delete()',
                              'public.pcm_suppliers_touch_updated_at()'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        v_still := v_still || v_role || ' -> ' || v_fn || ' ; ';
      END IF;
    END LOOP;
  END LOOP;
  IF v_still <> '' THEN
    RAISE EXCEPTION '貼板107 事後閘①:仍有 EXECUTE 沒收乾淨 ⇒ %', v_still;
  END IF;

  -- 事後閘② 🟢 **正對照 —— 它排除的是【一把對所有受測輸入一律回 false 的尺】。**
  --   少了它, 那種壞尺會讓事後閘①【無條件通過】。
  --   🛑 **而它【不能】證明九組量測各自都正確**(codex R1 finding 6):
  --      一把「只對 anon/authenticated/service_role 錯誤回 false、對 owner 正常回 true」的
  --      選擇性壞尺, 這一格擋不住。
  --   ⚠️ **也不要把它讀成「防我收過頭」** —— 本體沒有撤 `postgres`, 所以在既定前提下
  --      owner 失去 EXECUTE 不是這三道 SQL 造得出來的結果。**這一格是量具存活檢查, 不是過撤檢查。**
  SELECT bool_and(has_function_privilege(pg_get_userbyid(p.proowner),
                                         ns.nspname || '.' || p.proname || '()', 'EXECUTE'))
    INTO v_ownerok
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.pronargs = 0
     AND p.proname IN ('pcm_staff_touch_updated_at',
                       'pcm_suppliers_block_delete',
                       'pcm_suppliers_touch_updated_at');
  IF v_ownerok IS NOT TRUE THEN
    RAISE EXCEPTION '貼板107 事後閘②(正對照):擁有者也失去 EXECUTE ⇒ 我收過頭了, 或這把尺對誰都回 false ⇒ 停';
  END IF;
END
$verify$;

-- 🔵 **沒有 `NOTIFY pgrst, 'reload schema';` 是刻意的, 而理由要寫準**(codex R1 must-fix 7 收窄過):
--    ✅ **本片只改 PostgreSQL 的 ACL, 沒有改變任何 PostgREST 需要重新解析的函式定義或簽章**
--       (零 CREATE、零 DROP、零簽章改動;而這三支是 `RETURNS trigger`, 本來就不在 Data API 曝露面上)。
--    ⛔ ~~那一行【只】治函式簽章變更~~ ⇒ 過窄, PostgREST 的 schema cache 不只涉及簽章。
--    ⛔🔴 ~~缺的檢查 = 貼完打一次顧客站目錄 API 看有沒有 PGRST202~~
--       ⇒ **那個檢查零判別力, 刪掉。** 它跟這三支 trigger 函式的 ACL 沒有關係;
--         而 `PGRST202` 是「RPC / schema cache 找不到函式」的訊號, **不是權限撤銷的判別式**。
--         📌 **一個寫成「缺的檢查」的東西, 若它在兩個世界印同一個結果, 它不是缺口, 是誤導。**
--    ⚠️ **仍未驗證**:特定 PostgREST 版本會不會快取「函式 ACL 可見性」。
--       🔵 而不論它快不快取, **資料庫層的權限在實際執行當下一定會被強制套用**。

COMMIT;
