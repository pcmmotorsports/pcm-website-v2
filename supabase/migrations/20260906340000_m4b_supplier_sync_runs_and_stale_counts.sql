-- ═══════════════════════════════════════════════════════════════════════════
-- ⟦supply-SYNCTIMEOUTPARTIAL⟧:每日同步的「留痕 + 告警」——【缺席本身就是訊號】
--   plan  = docs/plans/2026-09-06-synctimeoutpartial-留痕告警-plan.md(commit 6f6e3f15e)
--   Sean 2026-09-06 01:5x 拍板逐字:「Q-同步留痕 = **甲**」(甲 = 做)
--   派工 主視窗 `-f8`;版本號 340000 由帳號窗釋出
--   🔵 **日期前綴用 `20260906`** —— 340000 那個號是主視窗指定的, 而前綴取今天,
--      好讓它排在今晚已貼的 `20260905430000` **之後**(重放順序才對)。
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ■ 段一 · 這一片在解什麼
--   每日供應商同步(`.github/workflows/rpm-sync.yml`, 18 個 job, `max-parallel: 1`,
--   每個 job `timeout-minutes: 45`)被 timeout 砍在**分批寫入中途** ⇒ 留下半套商品/變體,
--   而 🔴 **逾時的 job 只被標 cancelled, 零告警** ⇒ **沒有人會知道。**
--   ⚠️ 而它**自己會癒合**(下一晚把同一批重寫一次, `upsertBatched` 冪等)
--   ⇒ 📌 **那正是它不會被發現的理由。**
--
-- ■ 段二 · 🔴 為什麼【不是】「同步結束時寫一列」—— 這一格決定了整個設計
--   deadman 那支 migration(`20260829010000`)的檔頭逐字:
--     **「一個只數存在的東西的量具, 對『東西沒被建出來』永遠印 0, 而那個 0 看起來像正常。」**
--   ⇒ 🛑 **一個「結束時寫一列 / 被砍時寫一列」的設計, 前提是【那一刻還能寫】** ——
--     而那正是最不能假設的一刻(行程正在被殺、連線可能已斷、訊號不保證送達)。
--   🔬 **而那個前提的邊界我親自撞過**:`scripts/rpm-partial-report.ts` 的 `installKillReporter()`
--     只在 `SIGTERM` **真的送到那個 node 行程**時才說話, 中間隔著 shell 與 `pnpm` 包裝
--     ⇒ **我構造不出那個世界**(那要真的讓一班跑超過 45 分)。
--   ⇒ ✅ **所以反過來:活著的兩端各寫一次**
--       開工 `INSERT`(started_at)· 收工 `UPDATE`(completed_at + outcome)
--       ⇒ 🎯 **被砍 = 那一列永遠停在只有 `started_at`** ⇒ **它不需要任何訊號, 缺席本身就是訊號。**
--   🔵 它與 `installKillReporter()` **不衝突也不取代**:那一行答「停在哪一群」(診斷),
--      本片答「有沒有停」(告警)。**兩個問題, 兩個機制。**
--
-- ■ 段三 · 🔴 `outcome` 是【三態】不是兩態 —— 而那是量到的
--   2026-09-05 那一班是 **failure 不是 timeout**:`sync (dbk)` 在 **1.2 分**就結束
--   (orphan 閘擋下)。⇒ 📌 **「失敗」與「逾時」是兩種東西, 混成一格就分不出該找誰。**
--     `completed`  = 跑完了(不論它自己判紅判綠 —— 那是 job 的 rc 在管)
--     `failed`     = 它自己知道自己失敗了, 而**有機會寫下來**
--     `NULL`       = 🔴 **沒有回填**。**本片告警只看這一種。**
--   🛑🛑 **而它證得了什麼, 要寫準**(2026-09-06 codex must-fix ⑥):
--     ⛔ ~~`NULL` = 被砍~~ ⇒ ✅ **`NULL` = 【收工那一步沒有成功寫下來】。**
--     那涵蓋:被 timeout 砍 · 行程當掉 · 機器沒了 · **以及「資料其實同步完了, 而回填那一次寫失敗」**。
--     ⇒ 📌 **最後那一種, 資料是好的而告警照樣會叫** —— 那是**假告警**, 而本片接受它:
--       收工回填在程式那一端是 fail-loud 的(`rpm-sync-run-log.ts`)⇒ 那個世界會同時留下一個炸掉的 job,
--       ⇒ 兩個訊號一起出現時, 人分得出來。**但別把這一列讀成「一定是被砍」。**
--
-- ■ 段四 · 門檻怎麼來的(🛑 不是拍一個數)
--   🔬 2026-09-06 唯讀量(`gh run list --workflow=rpm-sync.yml --limit 25`, 08-15~09-05):
--     · **單一 sync job 最長 = samco 8.7 分**(2026-09-04);平常各家 1.5~2 分
--     · **整班牆鐘** 平常 17~21 分;最壞 **101 分**(2026-09-04;多出來的在【排隊】不在任何一家身上)
--   ⇒ 預設門檻 **6 小時** = 最壞單一 job 的 **41 倍**、最壞整班的 **3.6 倍**,
--     而同步是**每日一班** ⇒ 6 小時**遠早於下一班**, 不會被下一班蓋掉。
--   ⚠️ **它是參數不是常數**(`p_stale_hours`)—— 上面兩個數會隨家數變, 改門檻前先重量那兩個。
--
-- ■ 段五 · 這一片管不到什麼
--   · **它不判「寫進去的內容對不對」** —— 只答「這一班有沒有跑完」。
--   · **併發**:⛔ ~~本片取最新那一列, 舊的忽略 —— 那不是漏, 是刻意~~
--     ⇒ 🔴 **2026-09-06 codex must-fix ③ 訂正:那句話是【錯的】, 它把一個真缺口說成了設計。**
--       A 先開工 → B 後開工並跑完 → A 最後被砍 ⇒ 只看最新那一列會得到 `stale_open = 0`,
--       **而 A 留下的半套沒有人知道。**
--     ⇒ ✅ 現在的規則:**每一列開著而超過門檻的都算, 但被後來一趟【跑完的】接手過的不算**
--       (`upsertBatched` 冪等 ⇒ 後面那一趟會把同一批重寫一遍)。
--       🔵 那正是「它自己會癒合」那個性質的機械化:**癒合過的不叫, 沒癒合的一直叫。**
--   · **它不涵蓋「job 根本沒被排到」** —— 那一種**連 `INSERT` 都不會發生** ⇒ 這張表上零列
--     ⇒ 🛑 **而「零列」與「從來沒裝過」印同一個東西** ⇒ 本片的 RPC 因此**同時回分母**(見下)。
--   · 🛑🛑 **同一族還有一個更難看見的**(2026-09-06 codex must-fix ②, 我**沒有修它, 只寫清楚**):
--     **開工那一次 `INSERT` 自己失敗**時, 程式刻意**不擋同步**(理由見 `rpm-sync-run-log.ts`)
--     ⇒ 那一班**完全沒有留痕** ⇒ 之後就算真的被 timeout 砍, **`stale_open` 也是 0**。
--     ⇒ 📌 **也就是說:本片的告警覆蓋率, 上限等於「開工那一次寫得進去」的成功率。**
--     ⇒ ✅ 而那個世界**不是零訊號** —— 它在 job log 上有一行大聲的 `🔴 開工留痕寫不進去`;
--       🔴 **而那是【人】的線索, 不是機器的** ⇒ 沒有人讀 job log 的話, 它等於不存在。
--     ⚠️ **為什麼不把 `suppliers_seen = 0` 接進告警**:那個值在**第一次同步跑起來之前也是 0**
--       ⇒ 接了會在貼上去到第一班之間一直叫 ⇒ 🎯 **一個開場就在叫的告警, 會在它第一次真的有事之前**
--       **就被人學會忽略。** ⇒ 這一格**留給人看分母**, 不進 `shouldAlert`。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ── 前置閘⓪:角色必須存在(不然下面每一道 GRANT/斷言都會假綠或指錯地方)──
DO $g0$
BEGIN
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:角色 service_role 不存在 ⇒ 這個庫不是我讀到的那個, 拒繼續';
  END IF;
  IF to_regrole('payment_confirmer') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:角色 payment_confirmer 不存在 ⇒ 告警那條路讀不到本片, 拒繼續';
  END IF;
END $g0$;

-- ── 前置閘①:本片的兩個物件都不可以已經存在(⛔ 不用 IF NOT EXISTS)──
-- 🔴 `CREATE ... IF NOT EXISTS` 會讓「已經有一張【形狀不同】的同名表」安靜通過
--    ⇒ 📌 那個世界裡 migration 印綠, 而後面每一次寫入都可能對不上欄位。
DO $g1$
BEGIN
  IF to_regclass('public.supplier_sync_runs') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.supplier_sync_runs 已經存在 ⇒ 本片是【新建】不是【改】, 拒繼續(要改請另開一支)';
  END IF;
END $g1$;

-- ── 1. 留痕表 ──────────────────────────────────────────────────────────
CREATE TABLE public.supplier_sync_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_slug text        NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at  timestamptz,
  outcome       text,
  run_ref       text,
  note          text,
  -- 🔴 **三態的形狀寫成約束, 不只寫在註解裡**:
  --    沒回填 ⇒ 兩欄都空;回填了 ⇒ 兩欄都要有。**半套的列本身就是矛盾。**
  --
  -- 🔴🔴 **`outcome IS NOT NULL` 那一句不是贅字 —— 少了它這道約束【放行半套的列】**
  --    (2026-09-06 拋棄式 PG 實測抓到, 我第一版就是少了它):
  --    `CHECK` 只在算出 **FALSE** 時擋, 算出 **NULL 時放行**(PostgreSQL 明訂)。
  --    而 `completed_at` 有值、`outcome` 是 NULL 時:
  --        第一支 `completed_at IS NULL` ⇒ FALSE
  --        第二支 `TRUE AND (NULL IN (…))` ⇒ `TRUE AND NULL` ⇒ **NULL**
  --        `FALSE OR NULL` ⇒ **NULL** ⇒ 🛑 **放行。**
  --    🔬 實測逐字:那一列 `INSERT 0 1`(進去了), 而另外兩種半套都被擋。
  --    ⇒ 📌 **一道只擋掉【兩種半套裡的一種】的約束, 看起來與擋掉兩種的完全一樣** ——
  --      它有名字、有定義、貼上去也不會紅。**分得開它們的只有一發【三個方向都餵】的測試。**
  CONSTRAINT supplier_sync_runs_outcome_shape CHECK (
    (completed_at IS NULL AND outcome IS NULL)
    OR (completed_at IS NOT NULL AND outcome IS NOT NULL
        AND outcome IN ('completed','failed'))
  )
);

COMMENT ON TABLE public.supplier_sync_runs IS
  '⟦supply-SYNCTIMEOUTPARTIAL⟧ 每日同步的留痕。開工 INSERT、收工 UPDATE ⇒ 【只有 started_at 的列 = 沒跑完】。'
  '🔴 缺席本身就是訊號 —— 本表刻意【不】依賴「被砍時還能寫」那個前提(理由見 migration 檔頭段二)。';
COMMENT ON COLUMN public.supplier_sync_runs.outcome IS
  '三態:NULL = 沒有回填(被砍/當掉, 告警只看這一種)· completed = 跑完 · failed = 它自己知道失敗而寫得下來。'
  '🔴 「失敗」與「逾時」是兩種東西(2026-09-05 dbk 1.2 分就被 orphan 閘擋下)⇒ 不可混成一格。';

-- 🔵 查最新那一列會很頻繁(RPC 每次告警都問)⇒ 給它一道索引。
CREATE INDEX supplier_sync_runs_slug_started_idx
  ON public.supplier_sync_runs (supplier_slug, started_at DESC);

-- ── 2. 表的 ACL ────────────────────────────────────────────────────────
-- 🔴 新物件**出生就自帶權限**(`supabase_admin` 的 ADP 給 anon `arwdDxtm`), 而 repo 內零 GRANT 字面可掃
--    ⇒ 兩道 REVOKE 是**物理擋**不是慣例。
REVOKE ALL ON TABLE public.supplier_sync_runs
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
-- 🔵 只有同步程式要寫它(它跑在 service_role);告警那條路**不直接讀表**, 走下面那支 SECDEF 窗。
GRANT SELECT, INSERT, UPDATE ON TABLE public.supplier_sync_runs TO service_role;

-- ── 3. SECDEF 受控窗:告警那條路唯一的入口 ────────────────────────────
-- 🔴 **為什麼一定要 SECDEF, 而不是讓告警直接查表**(`20260829010000` 檔頭記過同一格):
--    告警跑在 `payment_confirmer`, 它對本表**零表權** ⇒ 直接查表 ⇒ `42501 permission denied`。
--    ⚠️ **而「抄了先例」不等於權限就對了** ⇒ 本檔第 5 段當場斷言有效權限, 不假設。
CREATE FUNCTION public.get_supplier_sync_stale_counts(p_stale_hours integer DEFAULT 6)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH latest AS (
    SELECT DISTINCT ON (r.supplier_slug)
           r.supplier_slug, r.started_at, r.completed_at, r.outcome
      FROM public.supplier_sync_runs r
     ORDER BY r.supplier_slug, r.started_at DESC
  ),
  -- 🔴🔴 **`stale_open` 不可以只看【最新那一列】**(2026-09-06 codex must-fix ③):
  --    A 先開工 → B 後開工並跑完 → A 最後才被砍。`DISTINCT ON` 只看得到較新的 B
  --    ⇒ **`stale_open` = 0, 而 A 留下的半套沒有人知道。**
  --    ⇒ 📌 我原本在檔頭寫「取最新那一列, 舊的忽略 —— 那不是漏, 是刻意」——**那句話是錯的**,
  --      它把一個真的缺口說成了設計。
  -- ✅ 改成:**每一列開著而超過門檻的都算**, 但**被後來一趟【跑完的】接手過的不算** ——
  --    因為 `upsertBatched` 是冪等的, 後面那一趟會把同一批重寫一遍 ⇒ 那個半套已經被補上了。
  --    🔵 而這一句正是「它自己會癒合」那個性質的機械化:**癒合過的不叫, 沒癒合的一直叫。**
  stale AS (
    SELECT r.supplier_slug
      FROM public.supplier_sync_runs r
     WHERE r.completed_at IS NULL
       AND r.started_at < pg_catalog.now()
           - pg_catalog.make_interval(hours => p_stale_hours)
       AND NOT EXISTS (
         SELECT 1 FROM public.supplier_sync_runs later
          WHERE later.supplier_slug = r.supplier_slug
            AND later.completed_at IS NOT NULL
            AND later.started_at > r.started_at
       )
     GROUP BY r.supplier_slug
  )
  SELECT pg_catalog.jsonb_build_object(
    -- 🔴 主詞:有一趟開了工而【沒有任何後續跑完的接手】, 且已經超過門檻 ⇒ 那一家卡著
    'stale_open', (SELECT pg_catalog.count(*) FROM stale),
    'stale_suppliers', (SELECT COALESCE(pg_catalog.jsonb_agg(supplier_slug ORDER BY supplier_slug), '[]'::jsonb)
                          FROM stale),
    -- 🔵 還在跑(開著而未超過門檻)⇒ **不進告警**, 只是讓讀的人分得開「卡住」與「正在跑」
    'open_recent', (SELECT pg_catalog.count(*) FROM latest
                     WHERE completed_at IS NULL
                       AND started_at >= pg_catalog.now()
                           - pg_catalog.make_interval(hours => p_stale_hours)),
    'failed_latest', (SELECT pg_catalog.count(*) FROM latest WHERE outcome = 'failed'),
    -- 🔴🔴 **分母一定要一起回** —— 「零列」與「從來沒有裝過這套留痕」印同一個 0
    --    ⇒ 讀的人要分得開, 就必須看得到分母。
    'suppliers_seen', (SELECT pg_catalog.count(*) FROM latest),
    'stale_hours', p_stale_hours
  );
$fn$;

REVOKE ALL ON FUNCTION public.get_supplier_sync_stale_counts(integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_supplier_sync_stale_counts(integer)
  TO payment_confirmer;

-- ── 4. fail-closed 斷言:收權真的收到了嗎(清單驅動)──────────────────
-- 🔵 清單寫成宣告式 `ARRAY[...]` 是 `scripts/migration-static-checks.sh` 第③道要的形狀
--    (它比「可授權物件數」與「斷言清單長度」)。
DO $acl$
DECLARE
  v_functions text[] := ARRAY['public.get_supplier_sync_stale_counts(integer)']::text[];
  -- 🔵 表也要列成宣告式清單 —— `migration-static-checks.sh` 第③道比的是
  --    【可授權物件數】vs【斷言清單長度】, 而我第一版只列了函式
  --    ⇒ 它當場擋下:「可授權物件 2 個, 斷言清單列了 1 個 ⇒ 有漏列」。
  --    📌 那道閘要的不是「你有沒有斷言」, 是「**每一個可授權物件都被點過名**」。
  -- 🔴 **而變數名不是隨便取的** —— 那道閘取清單的 awk 是 `^[[:space:]]*v_(relations|functions)`,
  --    我第一版叫 `v_tables` ⇒ **它看不到, 於是照樣印「列了 1 個」** ⇒ 我差點以為閘壞了。
  --    ⇒ 📌 **一個【格式沒對上】與一個【真的漏列】, 在那道閘的輸出上是同一句話。**
  v_relations text[] := ARRAY['public.supplier_sync_runs']::text[];
  f text;
  t text;
  r text;
BEGIN
  FOREACH f IN ARRAY v_functions LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','public'] LOOP
      IF pg_catalog.has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION '收權斷言失敗:% 對 % 還開著 EXECUTE(REVOKE 少了一個角色?或 proacl 是 NULL = 套用預設)', f, r;
      END IF;
    END LOOP;
    -- 🟢 正對照:該有的那一個必須【有】—— 少了這一格, 「全部收光」會被判成成功
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', f, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE ⇒ 告警那條路叫不到它(收過頭)', f;
    END IF;
  END LOOP;

  -- 表那一半:anon/authenticated/PUBLIC 一格都不准有;而 service_role 的三種必須在
  FOREACH t IN ARRAY v_relations LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated','public'] LOOP
      IF pg_catalog.has_table_privilege(r, t, 'SELECT')
         OR pg_catalog.has_table_privilege(r, t, 'INSERT')
         OR pg_catalog.has_table_privilege(r, t, 'UPDATE')
         OR pg_catalog.has_table_privilege(r, t, 'DELETE') THEN
        RAISE EXCEPTION '收權斷言失敗:% 對 % 還開著讀或寫', t, r;
      END IF;
    END LOOP;
    -- 🟢 正對照:該有的那三種必須【有】—— 少了這一格, 「全部收光」會被判成成功
    IF NOT (pg_catalog.has_table_privilege('service_role', t, 'INSERT')
        AND pg_catalog.has_table_privilege('service_role', t, 'UPDATE')
        AND pg_catalog.has_table_privilege('service_role', t, 'SELECT')) THEN
      RAISE EXCEPTION '收權斷言失敗:service_role 對 % 少了讀或寫 ⇒ 同步程式寫不進去(收過頭)', t;
    END IF;
  END LOOP;

  -- 🔵 codex nit ⑦:⛔ ~~「只有 X」~~ —— owner 與 superuser 一直都有權限, 那句話對它們不成立。
  --    ⇒ 改成把射程講出來:**應用角色**裡只有那一個。
  RAISE NOTICE '✅ 收權斷言全過:應用角色裡, 函式只有 payment_confirmer 叫得到、表只有 service_role 讀寫得到(owner/superuser 不在此射程內)。';
END $acl$;

-- ── 5. RLS:本表不對外, 而 RLS 仍然要開(縱深)──────────────────────
-- 🔵 service_role 預設 BYPASSRLS ⇒ 同步程式不受影響;
--    而萬一哪天有人多給了 anon 一格 SELECT, RLS 是第二道。**沒有 policy = 零列可讀。**
ALTER TABLE public.supplier_sync_runs ENABLE ROW LEVEL SECURITY;

-- 🔴🔴 **而【開了 RLS 而不寫政策】是一個會安靜壞掉的形狀**(`scripts/rls-service-role-policy-gate.py`
--    在 pre-commit 上當場擋下我這一片, 逐字):
--    今天它照樣會動 —— 因為 `service_role` 帶 **`BYPASSRLS`**。
--    ⇒ 📌 **那是【平台角色屬性】, 不是我寫的政策** ⇒ 🛑 **拿掉它的那一天, 這張表會變成後台讀到空的,**
--      **而空資料看起來像正常資料, 沒有人會叫。**
--    ⚠️ 而那一天不是假想:板列 `⟦b9-RLSHARDEN⟧` 的威脅模型逐字是
--      「**不是攻擊者, 是一個善意而看起來完全正確的改動**」——收掉 `BYPASSRLS` 正是那種改動。
--    ⇒ ✅ 所以政策要明寫出來, 讓這張表**不依賴那個屬性**。
CREATE POLICY supplier_sync_runs_select_service_role ON public.supplier_sync_runs
  FOR SELECT TO service_role USING (true);
CREATE POLICY supplier_sync_runs_insert_service_role ON public.supplier_sync_runs
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY supplier_sync_runs_update_service_role ON public.supplier_sync_runs
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
-- 🔵 **`anon` / `authenticated` 刻意【沒有】政策** —— 它們連表權都沒有(上面 REVOKE 過),
--    而「零表權」與「有表權但零政策」是兩層;兩層都在, 才不必靠其中一層。

COMMIT;
