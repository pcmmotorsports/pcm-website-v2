-- ============================================================
-- EBC 煞車皮:補子分類 '煞車系統 · 煞車皮'(加法,舊列不動)
-- ============================================================
-- plan 真權威:~/pcm-mailbox/W1-099-plan-件一-EBC煞車皮-加法-v2-20260820.md(v5)
-- 當場驗收:  ~/pcm-mailbox/W1-102-EBC-apply當場要跑的三格-20260820.md
-- 授權:      Sean 2026-08-20 晚,對「Q3 寫／明天」逐字答「寫」(主視窗對話)
-- 審查:      關卡1 四輪(plan)+ 關卡2 R1 六條 must-fix + 四條 nit,本檔為折入後版本
--
-- ── 為什麼要這一列 ────────────────────────────────────────────
-- 報價單側已把子分類改名 '煞車皮(來令片)' → '煞車皮'。
-- 我方 import 以「大類 · 子類」組 raw_path 解析到【子類】id(scripts/rpm-import.ts:167),
-- 查無 ⇒ unseededSubGroups > 0 ⇒ **WRITE 模式在 upsert 前 throw、整批不寫**(:350)。
--
-- 🔴 實跑證據(2026-08-20T11:33Z,`pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=ebc`),原字面:
--   [rpm-import] v2 分類:null-v2 0 群→未分類 / 未 seed 子類 68 群 / 同大類子類分歧 0 群 / 跨大類衝突 0 群
-- ⇒ **後果是 EBC 整家 abort(價格庫存全部停更),不是「68 件掉進未分類」。**
--
-- ── 為什麼是【加法】不是【改名】────────────────────────────────
-- 查無的後果是【整批 abort】不是【部分髒】⇒ 任何一刻兩邊不同步,那一家就完全停更。
-- 加法讓來源新舊兩種路徑都查得到 ⇒ 誰先誰後都不會破口。舊列本片不動。
--
-- ── 🔴 本檔【刻意沒有】自帶 BEGIN/COMMIT(關卡2 must-fix #6)────────
-- 檔內自帶 BEGIN/COMMIT 會**提早提交 CLI 的外層交易** ⇒ 可能出現
-- 「資料已落地、而 migration ledger 未登記」,斷線後重跑會再執行一次。
-- ⇒ 對齊本 repo 既有分類 migration 的體例:`20260811120000` 與 `20260712120000` **兩支都沒有** BEGIN/COMMIT。
-- ⚠️ 而本檔的鎖與 SET LOCAL 都**依賴外層交易存在** ⇒ **必須由會包交易的路徑套用**(CLI / MCP apply_migration)。
--    🔴 **若用 Supabase SQL Editor 逐段貼,請整段一次貼**(SQL Editor 會把整段當一個交易);
--       分段貼 = 鎖不跨段 = 下面的併發防護失效。
--
-- ── 🔴 順帶釐清一件事,免得被拿去修錯的東西 ─────────────────────
-- backlog `#795`(`20260820090000` 的 DDL 生效而版本號不在 `schema_migrations`)
-- **不是**上面那個 BEGIN/COMMIT 機制造成的:該支的 ledger 備註逐字是「Sean(SQL Editor 本人貼)」,
-- 而 **SQL Editor 這條路本來就完全不會寫 `schema_migrations`** ⇒ 那個成因已經足夠解釋它。
-- ⚠️ 兩個成因在現有資料裡**互相混淆**(有 BEGIN/COMMIT 的兩支剛好都是 SQL Editor 貼的),
--    要分開它們需要查 `schema_migrations`,**本窗沒有 DB access,未查。**
-- ============================================================

-- ⚠️ SET LOCAL 只在外層交易內生效;若套用路徑沒有包交易,本行是 no-op 而不會報錯。
SET LOCAL lock_timeout = '5s';          -- nit④:避免無限等待、跨過操作窗

-- ── 1. 前置:鎖住會被斷言的兩列,再驗真前提(關卡2 must-fix #4)──────
--    🔴 不鎖的話:另一交易可在斷言之後改名舊列或把 parent 改成子類,雙方都提交
--       ⇒ 五條斷言全過而終態錯。
DO $$
DECLARE
  v_top_id   uuid;
  v_top_cnt  integer;
  v_old_id   uuid;
  v_old_cnt  integer;
BEGIN
  -- 大類:恰一列,且鎖住
  SELECT count(*) INTO v_top_cnt
    FROM public.categories
   WHERE raw_path = '煞車系統' AND parent_category_id IS NULL;
  IF v_top_cnt <> 1 THEN
    RAISE EXCEPTION
      'EBC 煞車皮:大類 raw_path=''煞車系統'' 且 parent_category_id IS NULL 應恰 1 列,實得 % 列;拒繼續',
      v_top_cnt;
  END IF;

  SELECT id INTO v_top_id
    FROM public.categories
   WHERE raw_path = '煞車系統' AND parent_category_id IS NULL
     FOR UPDATE;                                   -- 🔴 鎖住,擋住併發改 parent

  -- 舊列:恰一列,且鎖住;把 id 記進暫存表供後置斷言比對(must-fix #5)
  SELECT count(*) INTO v_old_cnt
    FROM public.categories WHERE raw_path = '煞車系統 · 煞車皮(來令片)';
  IF v_old_cnt <> 1 THEN
    RAISE EXCEPTION
      'EBC 煞車皮:舊列「煞車系統 · 煞車皮(來令片)」應恰 1 列,實得 % 列;本片是加法,拒繼續',
      v_old_cnt;
  END IF;

  SELECT id INTO v_old_id
    FROM public.categories WHERE raw_path = '煞車系統 · 煞車皮(來令片)'
     FOR UPDATE;                                   -- 🔴 鎖住,擋住併發改名

  -- 🔴 同一個 session 內重跑時,temp table 可能還在（沒有外層交易時 ON COMMIT DROP 不會觸發)
  --    ⇒ 先 DROP 再建,否則「重跑同終態、不 RAISE」這句話會在第二次跑就破掉。
  DROP TABLE IF EXISTS pcm_ebc_pad_before;
  CREATE TEMP TABLE pcm_ebc_pad_before (top_id uuid, old_id uuid) ON COMMIT DROP;
  INSERT INTO pcm_ebc_pad_before VALUES (v_top_id, v_old_id);
END $$;

-- ── 2. 本體(冪等:重跑同終態)──────────────────────────────────
-- raw_path 慣例 =「大類 · 子類」,分隔符 = 半形空格 + U+00B7 + 半形空格,必須與
--   scripts/rpm-import.ts 的 CATEGORY_PATH_SEP(:171)與 storefront products-filter-logic.ts 一致。
--   本檔的分隔符已與 `20260712120000:92` 逐位元組(od -c)比對相同。
-- segments 由 raw_path 切出來、不手打(打錯分隔符時 segments 會變一段,斷言 ③ 會炸)。
--
-- 🔴 sort_order 的處理(關卡2 must-fix #1;推翻本檔前一版的做法):
--   前一版把 sort_order 無條件寫進 DO UPDATE ⇒ **分不出「不完整嘗試留下的 0」與「人工調整的 25」**
--   ⇒ 重跑會靜默把人工調整覆寫成 20。前例 `20260811120000:210-211` 當初排除它就是為了這個。
--   ⇒ 本版改成**只修 0**:0 = 從來沒被正確設過(欄位 DEFAULT);非 0 = 有人決定過,不動。
--
-- 🔴 DO UPDATE 帶 WHERE(nit②):值沒變就不寫 ⇒ 不會無謂推進 updated_at 讓下游誤認為分類剛變更。
INSERT INTO public.categories (name, raw_path, parent_category_id, sort_order, segments)
SELECT '煞車皮',
       '煞車系統 · 煞車皮',
       m.id,
       20,                                                   -- 沿用既有煞車皮那列(20260712120000:92)
       to_jsonb(string_to_array('煞車系統 · 煞車皮', ' · '))
  FROM public.categories m
 WHERE m.raw_path = '煞車系統' AND m.parent_category_id IS NULL
ON CONFLICT (raw_path) DO UPDATE
   SET name               = EXCLUDED.name,
       parent_category_id = EXCLUDED.parent_category_id,
       sort_order         = CASE WHEN categories.sort_order = 0
                                 THEN EXCLUDED.sort_order
                                 ELSE categories.sort_order END,
       segments           = EXCLUDED.segments,
       updated_at         = now()
 WHERE categories.name               IS DISTINCT FROM EXCLUDED.name
    OR categories.parent_category_id IS DISTINCT FROM EXCLUDED.parent_category_id
    OR categories.segments           IS DISTINCT FROM EXCLUDED.segments
    OR categories.sort_order = 0;

-- ── 3. 後置斷言(與資料量無關 ⇒ 空庫重放照樣有效)────────────────
DO $$
DECLARE
  v_cnt      integer;
  v_name     text;
  v_sort     integer;
  v_segs     jsonb;
  v_parent   uuid;
  v_top_id   uuid;
  v_old_id   uuid;
  v_old_now  text;
BEGIN
  SELECT top_id, old_id INTO v_top_id, v_old_id FROM pcm_ebc_pad_before;

  SELECT count(*) INTO v_cnt FROM public.categories WHERE raw_path = '煞車系統 · 煞車皮';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'EBC 煞車皮:新列應恰 1 列,實得 % 列', v_cnt;
  END IF;

  SELECT name, sort_order, segments, parent_category_id
    INTO v_name, v_sort, v_segs, v_parent
    FROM public.categories WHERE raw_path = '煞車系統 · 煞車皮';

  -- ① name:它會顯示在側欄,而存在性斷言對「還在但值不對」全盲
  IF v_name <> '煞車皮' THEN
    RAISE EXCEPTION 'EBC 煞車皮:name 是「%」不是「煞車皮」', v_name;
  END IF;

  -- ② sort_order:0 一定是錯的(沒帶到);非 0 非 20 = 有人調過,放行但要看得見
  IF v_sort = 0 THEN
    RAISE EXCEPTION 'EBC 煞車皮:sort_order 是 0 —— DEFAULT 沒被蓋掉,側欄順序會變';
  END IF;
  IF v_sort <> 20 THEN
    RAISE NOTICE 'EBC 煞車皮:sort_order = %(不是 20)—— 視為有人刻意調過,本片不覆寫', v_sort;
  END IF;

  -- ③ segments 必須是兩段;分隔符打錯(半形點、全形空格…)會在這裡炸
  IF jsonb_array_length(v_segs) <> 2
     OR v_segs->>0 <> '煞車系統'
     OR v_segs->>1 <> '煞車皮' THEN
    RAISE EXCEPTION 'EBC 煞車皮:segments 不是 ["煞車系統","煞車皮"](實際 = %)', v_segs::text;
  END IF;

  -- ④ parent 必須指向【前置那一刻鎖住的那顆 id】,不是「某顆叫煞車系統的」
  IF v_parent IS DISTINCT FROM v_top_id THEN
    RAISE EXCEPTION 'EBC 煞車皮:parent_category_id 沒有指向前置鎖定的大類 id';
  END IF;

  -- ⑤ 🔴 加法的核心不變式,而它必須釘【id】不是【還有一列】(關卡2 must-fix #5)
  --    前一版只數「舊 raw_path 還有幾列」⇒「把原列改成新名、再補一列假的舊名」可以讓它全過,
  --    而那正是它想擋的那件事最像的做法。
  SELECT raw_path INTO v_old_now FROM public.categories WHERE id = v_old_id;
  IF v_old_now IS NULL THEN
    RAISE EXCEPTION 'EBC 煞車皮:前置鎖定的舊列(id=%)不見了 —— 本片是加法,不得動舊列', v_old_id;
  END IF;
  IF v_old_now <> '煞車系統 · 煞車皮(來令片)' THEN
    RAISE EXCEPTION
      'EBC 煞車皮:舊列(id=%)的 raw_path 變成「%」—— 有人把本片做成了改名', v_old_id, v_old_now;
  END IF;
  IF v_old_id = (SELECT id FROM public.categories WHERE raw_path = '煞車系統 · 煞車皮') THEN
    RAISE EXCEPTION 'EBC 煞車皮:新列與舊列是同一個 id —— 那是改名不是加法';
  END IF;
END $$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、須人工執行)
-- ============================================================
-- 🔴🔴 **先讀這一段再看指令:rollback 有【失效條件】,而且不只一個。**
--
-- 失效條件 ①(關卡2 must-fix #2):**來源已經改名而還沒同步過** 時,兩個 FK 引用數都會是 0
--   ⇒ 看起來「可以安全刪」,而 **DELETE 成功之後下一輪 importer 仍然整家 abort**。
--   ⇒ **刪之前必須先確認來源還在送舊路徑**,而那要跑:
--        pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=ebc
--      看 `v2 分類:` 那行的「未 seed 子類」——
--        = 0 ⇒ 來源送的是【新】路徑 ⇒ **不要刪**(刪了明天就停更)
--        > 0 ⇒ 來源還在送舊路徑 ⇒ 刪掉新列不會造成新的破口
--
-- 失效條件 ②:**已經有東西指向新列**(products 或子分類)⇒ ON DELETE RESTRICT 擋著,刪不掉。
--
--   BEGIN;
--     SET LOCAL lock_timeout = '5s';
--
--     -- 🔴 角色 fail-closed(must-fix #3):不是印出來給人看,是不對就中止。
--     --    用 anon 跑會被 RLS `USING (delisted_at IS NULL)`(20260602135934:15)藏掉已下架的引用列
--     --    ⇒ 得到假 0 ⇒ DELETE 0 列後照樣 COMMIT,而那看起來像成功。
--     DO $rb$
--     BEGIN
--       IF current_user NOT IN ('postgres', 'service_role') THEN
--         RAISE EXCEPTION 'rollback 必須以 postgres / service_role 執行,當前是 %;拒繼續', current_user;
--       END IF;
--     END $rb$;
--
--     SELECT id FROM public.categories
--      WHERE raw_path = '煞車系統 · 煞車皮' FOR UPDATE;
--
--     -- 兩種引用一起數(自我參照最容易漏)
--     SELECT
--       (SELECT count(*) FROM public.products p
--         WHERE p.category_id = (SELECT id FROM public.categories WHERE raw_path='煞車系統 · 煞車皮'))  AS product_refs,
--       (SELECT count(*) FROM public.categories c
--         WHERE c.parent_category_id = (SELECT id FROM public.categories WHERE raw_path='煞車系統 · 煞車皮')) AS child_refs;
--     -- 兩個都 0 才往下;任一非 0 ⇒ ROLLBACK
--
--     DELETE FROM public.categories WHERE raw_path = '煞車系統 · 煞車皮';
--
--     -- 🔴 刪除後的存在性斷言(must-fix #3):DELETE 0 列不會報錯,只有這一條分得出來。
--     DO $rb2$
--     DECLARE v_left integer;
--     BEGIN
--       SELECT count(*) INTO v_left FROM public.categories WHERE raw_path = '煞車系統 · 煞車皮';
--       IF v_left <> 0 THEN
--         RAISE EXCEPTION 'rollback:刪除後仍有 % 列 —— 沒有真的刪掉,拒 COMMIT', v_left;
--       END IF;
--     END $rb2$;
--   COMMIT;
--
-- 🔴 而**前置是流程不是 SQL:先停掉同步**(鎖只鎖得住已存在的列,鎖不住 importer 待會要 INSERT 的)。
-- ============================================================
--
-- ── 已知代價 / 未解(不要當成沒有)──────────────────────────────
-- · nit①:importer 可能在本片提交前就快取了「查無」⇒ **apply 要與同步序列化**(別在 run 進行中套)
-- · nit③:新舊兩列現在都是 sort_order = 20 ⇒ **兩者之間沒有穩定 tie-break**,
--         側欄相對順序未定義。舊列刪除之後這個問題自然消失;在那之前是已知的。
-- · 🔴 本檔的 SQL **一次都沒跑過**(本窗無 DB access)⇒ 前置、五條後置、rollback 全部未經實跑。
-- ============================================================
