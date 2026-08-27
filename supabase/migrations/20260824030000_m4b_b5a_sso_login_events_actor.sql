-- 20260824030000_m4b_b5a_sso_login_events_actor.sql
-- `B5-a` 後續:**登入事件記下「是誰登進來的」。**
--
-- 鐵則 12③(schema:既有表加 **2 欄** + **2 道 CHECK**;**零資料異動** —— 既有列全部拿 NULL)。
-- 🔴 **本檔不 apply。** 貼 SQL 是 Sean 的動作。
-- 📖 **上線時序(旗標 / 上游 / 部署)看** `docs/runbooks/2026-08-24-b5a-identity-rollout.md`
--    —— 本檔的 §2b(部署閘盲區)與那份的 §6 是同一件事,改一邊要改另一邊。
--
-- ══ 1. 為什麼要這一支 ═════════════════════════════════════════════════════════
--
-- `docs/launch-todo.md` 那條逐字:**出事那天查「是誰按的」,報價單那邊查得到,網站這邊查不到。**
-- `B5-a`(2026-08-24)把身分接進了 **session 票**,而**另一本帳沒接** ——
-- 因為 `admin_sso_login_events` **這張表沒有身分欄**:
-- ```
-- 20260818190000_m4b_admin_sso_login_events.sql:72-90 逐欄讀過,全部欄位是:
--   id / occurred_at / outcome / reason / amr / request_id / source_app / ip / user_agent
-- 而全 repo 只有那一支 migration 碰過這張表(grep -rl 'admin_sso_login_events' supabase/migrations/ ⇒ 1)
-- ```
-- ⇒ `apps/admin/src/lib/sso/login-event.ts:115-125` 的 `.insert({...})` **沒有身分可寫**,
--    而 `lib/sso/login-event-identity-drop-fuse.test.ts` 正是在守這件事(訊號 B:表沒有那個欄)。
-- ⚠️ **2026-08-24 更新**:那支已 **2026-08-24 依它自己的退場條款刪除**(原文 `git show 952c0c42:apps/admin/src/lib/sso/login-event-identity-drop-fuse.test.ts`,189 行);接線與空窗保護改由
--    `lib/sso/login-event.test.ts` 的行為測試顧(見該檔「B5-a」那兩組)。
--
-- 🔴🔴 **本檔只做 schema 那一半。接線(insert 真的去寫這兩欄)是另一片。**
--    ⚠️ 而**順序是硬的,而且與直覺相反**:
--    ```
--    先接線後加欄 ⇒ 每次登入都靜默降級(insert 指定不存在的欄 ⇒ 整發失敗 ⇒ best-effort 吞掉)
--                  ⇒ 而那正是 login-event-identity-drop-fuse 武裝的那一刻
--    先加欄後接線 ⇒ 欄位閒置(全 NULL),沒有任何東西壞掉 ← **本檔選這條**
--                    (該 fuse 已於 2026-08-24 退場 ⇒ 現在由 login-event.ts 的
--                     【會出聲的退回路徑】接住那個空窗,見該檔)
--    ```
--    ⇒ 那顆 fuse 在**本檔 apply 之後、接線之前**會判 `armed=false`(訊號 A 假)⇒ 它不會誤叫。
--
-- ══ 2. 為什麼是兩個 text 欄,不是一個 jsonb ═══════════════════════════════════
--
-- session 的 `sub` 是一個三態 union(`apps/admin/src/lib/session/session.ts` 的 `AdminSessionSub`):
-- `{kind:'user', staff_id}` / `{kind:'fallback'}` / `{kind:'bootstrap'}`。
--
-- 存兩個攤平的 text 欄,而不是原封 jsonb,理由三條:
--   ① **這張表的既有風格就是攤平的 text**(`amr` 是 `'pwd+totp'` 這種 join 過的字串,不是陣列)
--      ⇒ 混一個 jsonb 進來,查詢的人要記兩套寫法。
--   ② 出事那天的查詢是 `WHERE actor_staff_id = 'sean'` ——
--      jsonb 要寫 `sub->>'staff_id'`,而**值班的人不寫那個**。
--   ③ **CHECK 管得住 text,管不住 jsonb 裡的鍵**:下面兩道 CHECK 讓
--      「kind 是 user 卻沒有 staff_id」與「kind 是 fallback 卻帶著 staff_id」**存不進來**。
--      🔴 那正是 `session.ts` 的 `isSub` **刻意沒做**的那一道(它容許額外欄位,檔頭寫成缺口)
--      ⇒ **DB 這一層把它補上**。⚠️ 但兩層擋的東西不同,不要讀成「那個缺口關了」:
--         應用層仍可能拿著一個型別上不合法的物件做判斷,只是**寫不進這張表**。
--
-- ⚠️ **PII 判斷(與 `ip` 那一欄不同,寫下來免得被誤讀)**:
--    `actor_staff_id` 是**內部員工 slug**(`sean` / `staff_1`;`20260726120000_m4b_e8a1_staff_table.sql:27`
--    逐字「id 是寫入 admin_audit_log.actor 的穩定 slug」)⇒ **不是客人的個資**,
--    而它與 `admin_audit_log.actor` 是同一個字集 ⇒ 兩本帳對得起來。
--    🔴 **而它仍然不得進 console log** —— `api/sso/callback/route.ts` 那道 PII 守門釘的是**日誌**,
--       不是這張表。**「可以進 DB」與「可以進 log」是兩件事。**
--
-- ══ 2b. 🔴🔴 這支 migration 落在【部署時序閘的盲區】—— 寫給下一個只加欄的人 ═══════
--
-- `scripts/deploy-order-gate.sh`(掛 `.husky/pre-push`)擋的是「app 層先於它依賴的 migration 上線」。
-- 🔴 **而它看不到本檔。** 量到的(2026-08-24,附活的正對照):
-- ```
-- grep -cE '^\s*CREATE (OR REPLACE )?(MATERIALIZED )?(FUNCTION|VIEW)' <本檔>            ⇒ 0
-- 同一命令對 20260824020000(#858, 有 CREATE FUNCTION)                                  ⇒ 1  ← 尺是活的
-- ```
-- 成因:那道閘抽的是**函式名與 view 名**(Sean 2026-08-11 `Q2=B` + 2026-08-24「放寬」到 view)。
-- 本檔只有 `ALTER TABLE … ADD COLUMN` + 兩道 CHECK ⇒ 落在那 73 支「兩者皆無」的桶子裡。
--
-- ⚠️ **不要為此把那道閘擴到 column 名** —— `Q2=B` 明文排除 table/column/index,理由是撞常見字。
--    **那是拍板不是漏寫**;在被拍板排除的地方加閘 = 用工具推翻他的決定,而他不會知道。
--
-- ✅ **代償在應用層,而它是量過的**:`apps/admin/src/lib/sso/login-event.ts` 的**退回路徑** ——
--    帶身分的 insert 被拒 ⇒ 退回不帶身分那版重打 ⇒ **那一列不會不見**,並印一行分類過的警告。
--    📏 2026-08-24 實測(拋棄式 PG + 真 PostgREST + supabase-js 2.105.3,表【不含】這兩欄):
--       帶身分 ⇒ `PGRST204`、**回 `{error}` 不 throw** ⇒ 退回成功 ⇒ 那一列在(count 驗過)。
--    ⇒ 🔴 **所以本檔未 apply 而 app 先上線,不會掉紀錄 —— 會掉的是【身分】。**
--
-- ══ 3. 不做什麼(YAGNI,明寫免得被當成漏做)═══════════════════════════════════
--   · **不加索引**。這張表 90 天保留(`purge_admin_sso_login_events()`),而查詢是
--     「最近往前翻」——既有的 `occurred_at DESC` 索引就吃得下。
--     ⇒ 真的量到慢再加,**現在加是猜的**。
--   · **不回填既有列**。既有每一列的身分**本來就不知道** ——
--     🔴 回填任何值(包括 `'fallback'`)都是**發明一段沒發生過的歷史**。NULL 才是實話。
--   · **不動 GRANT**。見 §4。
--
-- ══ 4. 🔴 授權:本檔【不新建任何可授權物件】═══════════════════════════════════
--   `ALTER TABLE … ADD COLUMN` 不產生新的 ACL 物件 ——
--   表級 `GRANT INSERT, SELECT … TO service_role`(`20260818190000:...`)**自動涵蓋新欄**,
--   而 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 那一行仍然成立。
--   ⇒ 收權斷言清單**是空的**,並以 `v_declares_nothing := true` **明示**(不是留空)。
--   🔴 **而「自動涵蓋」是我要驗的東西,不是我要假設的東西** ⇒ §5 的 ③④ 兩格就是在驗它,
--      **而且驗兩個方向**:service_role 讀得到、anon 讀不到。
--
-- ══ 5. rollback ═══════════════════════════════════════════════════════════════
--   ALTER TABLE public.admin_sso_login_events
--     DROP CONSTRAINT admin_sso_login_events_actor_pairing_check,
--     DROP CONSTRAINT admin_sso_login_events_actor_kind_check,
--     DROP COLUMN actor_staff_id,
--     DROP COLUMN actor_kind;
--   ⚠️ **DROP COLUMN 會丟掉已經寫進去的身分紀錄,而那是稽核資料。**
--      接線之後才 rollback ⇒ 先確認那段期間的列是不是還要得回來。

BEGIN;

-- ── 1. 兩個欄(可為 NULL:失敗的登入、以及上游還沒送身分的那些)─────────────
-- 🔴 **為什麼【不用】 `NOT VALID`**(2026-08-24;codex B2-6 提出「強鎖 + 掃表」)
--    📏 **量到的**:`SELECT count(*) FROM public.admin_sso_login_events;` ⇒ **28**
--       (2026-08-24 Sean 本人在 Supabase SQL Editor 跑,螢幕逐字回傳。)
--    ⇒ 28 列的驗證成本可以忽略,B2-6 那條實害在這個量級不成立。
--    ⇒ 而**不用 `NOT VALID` 反而是比較好的那一邊**:那 28 列會**真的被驗過一次**;
--      用了 `NOT VALID` = 既有列繞過檢查,那是真取捨,而現在不必付。
--    ⚠️ **那個 28 是綁時點的,而這張表會長**(90 天保留)⇒
--       **哪天要對它再加 CHECK,先重量一次那個 count**,不要引用這一行的數字。
ALTER TABLE public.admin_sso_login_events
  ADD COLUMN actor_kind     text,
  ADD COLUMN actor_staff_id text;

COMMENT ON COLUMN public.admin_sso_login_events.actor_kind IS
  'B5-a:這次登入的身分【種類】,對齊 apps/admin/src/lib/session/session.ts 的 AdminSessionSub.kind。user=具名員工;fallback=共用密碼備援登入;bootstrap=首次建置(SETUP_SECRET)。NULL=上游沒送身分(B4 上線前的每一次登入)或這是一次失敗的登入。🔴 NULL 的意思是「不知道」,不是「沒有身分」——不得回填。';

COMMENT ON COLUMN public.admin_sso_login_events.actor_staff_id IS
  'B5-a:具名員工的 slug,與 admin_audit_log.actor / staff.id 同一個字集(20260726120000:27)⇒ 兩本帳對得起來。🔴 只在 actor_kind=''user'' 時有值(CHECK 強制)。⚠️ 這是內部員工識別字、不是客人個資;但它【仍然不得進 console log】——那道 PII 守門釘的是日誌不是本表。';

-- ── 2. 兩道 CHECK ───────────────────────────────────────────────────────────
-- 🔴 分成兩道、不合成一道:形狀抄本表既有的 `_outcome_check` / `_source_app_check`
--    (`20260818190000:88-89`)—— 合成一道之後,**錯誤訊息說不出是哪一半壞了**。
ALTER TABLE public.admin_sso_login_events
  ADD CONSTRAINT admin_sso_login_events_actor_kind_check
    CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'fallback', 'bootstrap'));

-- 🔴🔴 **同生共死 —— 而這一格我【寫錯過一次,是拋棄式 PG 上量出來的】,不是想出來的。**
--
-- ⛔ **兩個都錯的寫法(逐字留著,因為第二個看起來完全正確)**:
--    ```sql
--    -- 錯 ①(我一開始就沒用):
--    CHECK ((actor_kind = 'user') = (actor_staff_id IS NOT NULL))
--
--    -- 錯 ②(我【真的寫了】,靜態檢查四道全過、apply 也成功):
--    CHECK (   (actor_kind IS NULL AND actor_staff_id IS NULL)
--           OR (actor_kind = 'user' AND actor_staff_id IS NOT NULL AND length(actor_staff_id) > 0)
--           OR (actor_kind IN ('fallback','bootstrap') AND actor_staff_id IS NULL) )
--    ```
--    📏 **實測(拋棄式 PG 17.10,BEGIN→INSERT→ROLLBACK)**:錯 ② 對
--    `(actor_kind, actor_staff_id) = (NULL, 'sean')` —— **放行**。
--    算給下一個人看:
--    ```
--    分支1:(NULL IS NULL)=true  AND ('sean' IS NULL)=false        ⇒ false
--    分支2:(NULL = 'user')=NULL AND …                             ⇒ 🔴 NULL
--    分支3:(NULL IN (…))=NULL   AND ('sean' IS NULL)=false        ⇒ false
--    false OR NULL OR false = NULL ⇒ 🔴 **CHECK 把 NULL 當成「滿足」** ⇒ 放行
--    ```
--    ⇒ 一列「**不知道是誰,卻帶著 staff_id**」存得進來 —— 而那正是我在錯 ① 旁邊
--      寫下警告要防的東西。**我寫了那句警告,然後用另一個形狀踩了同一個坑。**
--    🔴 **而我的 apply-time 斷言當時【沒抓到】**:它試的是 `('fallback','sean')`,
--       不是 `(NULL,'sean')` ⇒ **斷言只驗我想得到的那個壞世界。**(下面 ②-b 已補這一格。)
--
-- ✅ **改用 `CASE`:每一條分支都回一個【確定的】布林,NULL 沒有地方可以生出來。**
ALTER TABLE public.admin_sso_login_events
  ADD CONSTRAINT admin_sso_login_events_actor_pairing_check
    CHECK (
      CASE
        -- 不知道是誰 ⇒ 那就【什麼都不准帶】
        WHEN actor_kind IS NULL THEN actor_staff_id IS NULL
        -- 具名員工 ⇒ slug 裡**至少要有一個 `[a-z0-9_]`**。
        --
        -- 🔴🔴 **為什麼是【正面要求】而不是「去掉空白後不是空的」**(2026-08-24 codex R2-2):
        --    我前兩版都在**列舉空白**,而那個集合是無限的,兩版都窄:
        --    ```
        --    v1  length(x) > 0        ⇒ '   ' 放行(長度 3)
        --    v2  btrim(x) <> ''       ⇒ 🔴 btrim **不帶字集只去 ASCII space**
        --                                ⇒ tab / 換行 / NBSP / 全形空白【全部放行】
        --    ```
        --    📏 **實測(2026-08-24,拋棄式 PG 17.10 UTF8,逐字元各打一發)**:
        --    ```
        --    字元            btrim 判空   PG \s   [[:space:]]   本版 ~'[a-z0-9_]'
        --    U+0020 space       t          t          t           擋 ✅
        --    U+0009 tab         f          t          t           擋 ✅
        --    U+000A 換行        f          t          t           擋 ✅
        --    U+00A0 NBSP        f          f          f           擋 ✅
        --    U+3000 全形空白    f          f          f           擋 ✅
        --    U+200B 零寬        f          f          f           擋 ✅   ← 前兩版與 JS trim() 都漏
        --    U+FEFF BOM         f          f          f           擋 ✅   ← 同上
        --    'sean' / 'staff_1' / ' sean '                        收 ✅
        --    ```
        --    ⇒ 🔴 **列舉「什麼算空白」永遠慢一步;要求「至少有一個真字元」一次關掉整族。**
        --      (母題:守門在列舉一個無限集合時,改成**正面要求**。)
        --    ⇒ 並且它**不依賴 locale** —— `\s` 與 `[[:space:]]` 的行為會隨 `LC_CTYPE` 變,
        --      而 `[a-z0-9_]` 是明寫的字元集合。**本機量到的可以外推,那兩個不行。**
        --
        -- ✅ **不會誤殺任何合法 slug**:`staff.id` 的格式是 `^[a-z0-9_]{1,64}$`
        --    (`20260726120000_m4b_e8a1_staff_table.sql:21` 逐字)⇒ 每一個合法 slug 都含 `[a-z0-9_]`。
        -- ⚠️ 射程:`' sean '`(前後有空白)仍會放行 —— 它是**格式**問題不是**空身分**問題,
        --    本道守的是後者。格式的權威在 staff 表那道 CHECK。
        -- 📌 **應用層 `session.ts` 的 `isSub` 用【同一個判準】** —— 兩層要一致,
        --    否則繞過 app 的寫入路徑(service_role / 別支 RPC / 手動 SQL)會寫進「看起來具名」的列。
        WHEN actor_kind = 'user' THEN actor_staff_id IS NOT NULL AND actor_staff_id ~ '[a-z0-9_]'
        -- 其餘(fallback / bootstrap,以及被上面那道 kind CHECK 擋掉的任何值)⇒ 不得帶 slug
        ELSE actor_staff_id IS NULL
      END
    );

-- ══ 3. apply 時的自我斷言 ════════════════════════════════════════════════════
DO $$
DECLARE
  -- 🔴 新物件收權斷言的【清單】(`scripts/migration-static-checks.sh` ③ 要它可被數)。
  --    **它防的不是「忘記收權」,是「忘記列」** —— 斷言只檢查你列出來的物件。
  --    本檔 `ALTER TABLE … ADD COLUMN` **不產生可授權物件** ⇒ 兩份清單都空,並明示。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_declares_nothing boolean := true;
  v_n integer;
  v_con text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION '新物件收權斷言:兩份清單都是空的。真的沒新建物件請把 v_declares_nothing 設 true(明示),不要留空。';
    END IF;
  END IF;

  -- ① 兩欄真的在
  SELECT count(*) INTO v_n FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.admin_sso_login_events'::regclass
     AND attname IN ('actor_kind', 'actor_staff_id') AND NOT attisdropped;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'B5-a 驗收失敗 — 兩個身分欄不齊(實際 %),而 login-event 那一半仍然掉著', v_n;
  END IF;

  -- ② 兩道 CHECK 真的在(🔴 只驗「欄在」擋不住 CHECK 被漏掉,而 CHECK 才是形狀的守門)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.admin_sso_login_events'::regclass AND contype = 'c'
     AND conname IN ('admin_sso_login_events_actor_kind_check',
                     'admin_sso_login_events_actor_pairing_check');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'B5-a 驗收失敗 — 身分欄的 CHECK 不齊(實際 %)', v_n;
  END IF;

  -- ②-b 🔴 **讓那兩道 CHECK 當場【表演一次會擋】** —— 只驗「它存在」擋不住一道
  --      恆真的 CHECK。這裡塞一列**該被擋**的,擋到就 rollback 到 savepoint。
  BEGIN
    INSERT INTO public.admin_sso_login_events (outcome, actor_kind, actor_staff_id)
    VALUES ('fail', 'fallback', 'sean');
    RAISE EXCEPTION 'B5-a 驗收失敗 — 「fallback 卻帶著 staff_id」竟然存得進去 ⇒ 配對 CHECK 是恆真的';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- ✅ 這就是要的:它擋了
  END;

  -- ②-b2 🔴 **這一格是【真的漏過】的那個世界**(見上面配對 CHECK 旁的實測):
  --      `(NULL, 'sean')` = 「不知道是誰,卻帶著 slug」。前一版 CHECK 對它**放行**,
  --      而 ②-b 那一格**照樣綠** —— 因為它試的是另一個壞世界。
  --      ⇒ **一個壞世界過了,不代表其他壞世界也被擋。**
  BEGIN
    INSERT INTO public.admin_sso_login_events (outcome, actor_kind, actor_staff_id)
    VALUES ('fail', NULL, 'sean');
    RAISE EXCEPTION 'B5-a 驗收失敗 — 「actor_kind 是 NULL 卻帶著 staff_id」存得進去 ⇒ 配對 CHECK 又落回三值邏輯了';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- ✅ 擋了
  END;

  -- ②-b3 🔴 **讓【kind CHECK】自己表演一次** —— 上面 ② 只數了它「在不在」。
  --      📏 2026-08-24 拋棄式 PG 實測:把它改成 `CHECK (true)`,**本 DO 區塊整塊照樣綠**
  --         ⇒ 一道恆真的 kind CHECK 可以一路 apply 上正式庫,沒有任何一格會叫。
  --      ⚠️ 而「擋住了」不夠 —— 要問**誰擋的**:`('bogus_kind', NULL)` 在配對 CHECK 走 ELSE 分支
  --         (slug 是 NULL ⇒ 放行)⇒ 只有 kind CHECK 會擋它。這裡把那個名字驗出來。
  BEGIN
    INSERT INTO public.admin_sso_login_events (outcome, actor_kind, actor_staff_id)
    VALUES ('fail', 'bogus_kind', NULL);
    RAISE EXCEPTION 'B5-a 驗收失敗 — actor_kind 收得下 ''bogus_kind'' ⇒ kind CHECK 是恆真的';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'admin_sso_login_events_actor_kind_check' THEN
      RAISE EXCEPTION 'B5-a 驗收失敗 — 擋住 ''bogus_kind'' 的是 %,不是 kind CHECK ⇒ kind CHECK 這一層仍然沒被驗到', v_con;
    END IF;
  END;

  -- ②-b4 🔴 **`user` 卻【沒有】slug** —— 配對 CHECK 的 user 分支,上面三格一次都沒走到。
  --      📏 同一輪實測:把那條分支改成 `THEN true`,**整塊照樣綠**。
  BEGIN
    INSERT INTO public.admin_sso_login_events (outcome, actor_kind, actor_staff_id)
    VALUES ('success', 'user', NULL);
    RAISE EXCEPTION 'B5-a 驗收失敗 — 「kind 是 user 卻沒有 staff_id」存得進去 ⇒ 那一列說得出「是具名員工」卻說不出是誰';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'admin_sso_login_events_actor_pairing_check' THEN
      RAISE EXCEPTION 'B5-a 驗收失敗 — 擋住 (user, NULL) 的是 %,不是配對 CHECK', v_con;
    END IF;
  END;

  -- ②-b5 🔴 **`user` 帶著【空字串】slug** —— `length(...) > 0` 那半的守門。
  --      📏 同一輪實測:拿掉 `AND length(actor_staff_id) > 0`,**整塊照樣綠**,
  --         而那一列真的存得進去(量到 actor_kind='user' / slug='')。
  --      ⇒ 空字串與「沒有身分」在下游長得一樣,而這一列還宣稱自己是具名員工 —— 最壞的那一種。
  --      📌 這一格與 `session.ts` 的 `isSub` 擋空字串 staff_id(驗收格 [8])是**同一件事的兩層**。
  BEGIN
    INSERT INTO public.admin_sso_login_events (outcome, actor_kind, actor_staff_id)
    VALUES ('success', 'user', '');
    RAISE EXCEPTION 'B5-a 驗收失敗 — 「kind 是 user 而 staff_id 是空字串」存得進去 ⇒ 空身分那半的守門不見了';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'admin_sso_login_events_actor_pairing_check' THEN
      RAISE EXCEPTION 'B5-a 驗收失敗 — 擋住 (user, 空字串) 的是 %,不是配對 CHECK', v_con;
    END IF;
  END;

  -- ②-b6 🔴🔴 **`user` 帶著【看不見的】slug** —— 逐字元各打一發,不是試三個代表。
  --      歷史:這一格 2026-08-24 被打開了兩次。
  --        · codex B2-1 指出 `length(x) > 0` 放行 `'   '` ⇒ 我改成 `btrim(x) <> ''`
  --        · codex R2-2 指出 `btrim` **不帶字集只去 ASCII space** ⇒ tab / NBSP / 全形空白仍放行
  --      ⇒ 現在改成**正面要求**(至少一個 `[a-z0-9_]`),而本格逐字元證明它擋得住。
  --      🔴 `U+200B`(零寬)與 `U+FEFF`(BOM)**前兩版與 JS 的 `trim()` 都放行** —— 本版擋。
  DECLARE
    v_blank text;
  BEGIN
    FOREACH v_blank IN ARRAY ARRAY[
      ' ',            -- U+0020
      E'\t',          -- U+0009
      E'\n',          -- U+000A
      E'\r',          -- U+000D
      U&'\00A0',      -- NBSP
      U&'\3000',      -- 全形空白
      U&'\2003',      -- em space
      U&'\200B',      -- 零寬空白
      U&'\FEFF',      -- BOM
      '   ',          -- 多個 ASCII 空白
      U&'\3000\3000'  -- 多個全形空白
    ] LOOP
      BEGIN
        INSERT INTO public.admin_sso_login_events (outcome, actor_kind, actor_staff_id)
        VALUES ('success', 'user', v_blank);
        RAISE EXCEPTION 'B5-a 驗收失敗 — 「kind 是 user 而 staff_id 看不見」存得進去(該字元的 16 進位 = %)', encode(convert_to(v_blank, 'UTF8'), 'hex');
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con <> 'admin_sso_login_events_actor_pairing_check' THEN
          RAISE EXCEPTION 'B5-a 驗收失敗 — 擋住空白 slug 的是 %,不是配對 CHECK', v_con;
        END IF;
      END;
    END LOOP;
  END;

  -- ②-c ✅ **正對照:合法的那一列存得進去** —— 少了它,「一道恆擋的 CHECK」也會讓 ②-b 過。
  BEGIN
    INSERT INTO public.admin_sso_login_events (outcome, actor_kind, actor_staff_id)
    VALUES ('success', 'user', 'sean');
    DELETE FROM public.admin_sso_login_events
     WHERE outcome = 'success' AND actor_kind = 'user' AND actor_staff_id = 'sean';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'B5-a 驗收失敗 — 合法的一列(user + staff_id)被擋掉了 ⇒ CHECK 寫太緊';
  END;

  -- ③ 表級授權**自動涵蓋新欄**:service_role 讀寫得到(這是 §4 那個宣稱的正面)
  IF NOT (has_column_privilege('service_role', 'public.admin_sso_login_events', 'actor_staff_id', 'SELECT')
          AND has_column_privilege('service_role', 'public.admin_sso_login_events', 'actor_staff_id', 'INSERT')) THEN
    RAISE EXCEPTION 'B5-a 驗收失敗 — service_role 對新欄沒有 SELECT/INSERT ⇒ 接線那片會寫不進去';
  END IF;

  -- ④ 🔴 而**反面才是安全那一半**:anon / authenticated 一個字都讀不到。
  --    ⚠️ `has_column_privilege` 對欄級授權會少報,所以這裡問的是**表級**那條路
  --       (新欄的權限就是繼承表級來的 ⇒ 表級沒有,欄級就沒有)。
  IF has_table_privilege('anon', 'public.admin_sso_login_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.admin_sso_login_events', 'SELECT') THEN
    RAISE EXCEPTION 'B5-a 驗收失敗 — anon/authenticated 讀得到登入事件表 ⇒ 誰在什麼時候登入外流';
  END IF;

  -- ⑤ 🔴 **零資料異動**:既有列的兩個新欄必須全是 NULL(回填 = 發明歷史)
  SELECT count(*) INTO v_n FROM public.admin_sso_login_events
   WHERE actor_kind IS NOT NULL OR actor_staff_id IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B5-a 驗收失敗 — 有 % 列的身分欄不是 NULL ⇒ 本檔不該回填任何值', v_n;
  END IF;
END $$;

COMMIT;
