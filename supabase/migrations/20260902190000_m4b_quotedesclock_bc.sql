-- M-4b ⟦b4-QUOTEDESCLOCK⟧ 段 B+C:商品描述鎖(記號 + 同步跳過)
--
-- ✅ Sean 2026-09-02 拍板逐字:「**甲 要, 現在做(三段:後台能改 + 留記號 + 同步跳過)**」
--    🔵 而「三段」是他打的字 —— 他複誦的那三段就是 plan 切的三段。
-- 🔵 而**段 A(後台 UI)不在本支** —— 順序是【B+C 先、A 最後】,
--    而那個順序**不是 Sean 拍的, 是本窗的技術判斷、主視窗批的**(兩者可推翻性不同)。
--    ⇒ 理由:反過來先做 A ⇒ **員工改了描述, 而隔天被同步蓋掉** —— 那是最糟的順序。
--    🛑 **⇒ 段 A 的驗收條要含一格:「B+C 已上線且有測試」。**
-- 🔵 而段 C 走【DB trigger】而不是【呼叫端分兩批】—— **那一格是主視窗判的, 不是 Sean 拍板。**
--    理由二格:①段 A 之後還會有別的寫入路徑(匯入、批次修正), 而分兩批只擋得住那一支腳本
--             ②分兩批會**動到一道現在正在守著的閘**(`rpm-load` 的 byte 等價回歸鎖)
--               ⇒ 📌 **一道被重設的鎖, 與一道從來沒裝的鎖, 在綠色上長得一樣。**
--
-- ── 🔴 病(量到的, 2026-09-02)────────────────────────────────────────
--    `scripts/supplier-config.ts` 的 `syncDescription`(2026-09-02 第三次量, 逐條列 slug 之後):
--      設定檔裡共 18 條, **而其中一條是 `__gated_canary__`**(`:386` 起, 守門用的靶,
--      `:384` 逐字「僅於顯式 `--supplier=__gated_canary__` 呼叫時命中 → 對真每日同步管線惰性零副作用」)
--      ⇒ ✅ **真供應商 17 家:false 1 家(`rpm`, `:114`) · true 16 家**
--    ⇒ 🔴 **那 16 家的每日同步會覆蓋 `products.description`** ⇒ 保護今天完全不存在。
--    ⚠️ **而 codex 說「每日 matrix 實際只有 15 家會寫描述」—— 我【沒有驗】那一格**
--      (要開每日同步的 matrix 對照 supplier-config)⇒ **那是未確認, 不要當讀數。**
--
--    🔴🔴 **而這個數字我錯了【兩次】, 兩次錯法不同 —— 兩次都留著:**
--      ⛔ ~~第一版「false 1 / true 7」~~ ——
--         成因:我第一發 grep 加了 `head -12` ⇒ 只看到前 8 個值 ⇒ **把被截斷的輸出讀成了全部**。
--         📌 **而它印出來的那 8 行每一行都是真的** —— 錯的不是那些行, 是【它不是全部】。
--         ⇒ 🔴 **一個被 `head` 截斷的清單, 與一個真的只有這麼多的清單, 印出來完全一樣。**
--      ⛔ ~~第二版「false 2 / true 16 / 合計 18」~~ ——
--         成因:我這次沒截斷了, **而我沒問「這 18 條【每一條都是供應商嗎】」**
--         ⇒ 🔴 **一個守門用的假靶被算進了母體。**
--         ⇒ 📌 **第一次錯在【分母被截短】, 第二次錯在【分母混進不屬於它的東西】——**
--           **而兩次的輸出都是一個看起來很乾淨的數字。**
--      🎯 **⇒ 修法是同一句:拿到計數之後【逐條列出來看】, 不要只看總數。**
--    ⚠️ 而 rpm 那家「看起來有保護」—— **那不是保護, 是它根本沒有描述可寫**
--      (`supplier-config.ts:12` 逐字「rpm **刻意不寫** description、全批一致省欄 → byte-safe」)。
--    ⇒ 📌 **兩者在「描述沒被覆蓋」這個結果上長得一樣, 而它們的分母差 7 家供應商。**
--    🛑 **而「今天完全沒有保護」是【碼層事實】, 不是【已經出事過】的證據**
--      —— 沒有人量過那 7 家實際蓋掉過幾次(要正式庫歷史)。**兩者不要合併。**
--
-- ── 🔬 而 trigger 對 upsert 的行為是【實跑量到的】, 不是讀文件 ──────────────
--    2026-09-02 於拋棄式 PG 17.10 實測(主視窗指名這一格要實跑):
--      `INSERT … ON CONFLICT (id) DO UPDATE SET descr = EXCLUDED.descr`
--      ⇒ ✅ **`BEFORE UPDATE` 的 trigger【會】在 ON CONFLICT 的 UPDATE 那一支觸發**
--        (被鎖那列保住原值, 未鎖那列被覆蓋 ⇒ 兩個世界印不同的東西)
--      ⇒ 🟢 而普通 `UPDATE` 同樣行為 ⇒ 兩條路一致
--    📌 **⇒ 這是本支能成立的前提。少了這一發, 整片是建在一個沒驗過的假設上。**
--
-- ── 🔴 逃生口:段 A 之後後台要【改得動】被鎖的描述 ──────────────────────
--    trigger 若無條件保留舊值 ⇒ **段 A 會做不出來**(員工改了也存不進去)。
--    ⇒ 用一個交易級 GUC 當逃生口:`SET LOCAL pcm.allow_locked_description_write = 'on'`
--    🔬 三個世界實測(同一座拋棄式庫):
--      ① 沒開(同步那條路)⇒ **擋住**  ② 開了(後台那條路)⇒ **寫得進去**
--      ③ 交易結束之後再寫 ⇒ **又擋住**(`SET LOCAL` 隨交易結束自動失效 —— 那正是用 LOCAL 的理由)
--    🛑 **而它是【誰記得設】而不是【誰有權限】** —— 任何拿得到寫入權的人都設得起來。
--      ⇒ 這道 trigger 防的是**忘記**(每日同步不會去設它), **不是防惡意**。
--      ⇒ 📌 **不要把它寫成安全機制。**
--    🔴🔴 **而還有一格更具體, codex R2 抓的**:trigger 只讀得到那個 GUC 的【值】,
--      **它分不出那個值是 `SET LOCAL` 設的還是 session 級 `SET` 設的**。
--      ⇒ 🔴 **連線池重用時**:某個連線曾經跑過 `SET pcm.allow_locked_description_write='on'`(沒有 LOCAL)
--        ⇒ 那個值**留在該連線上** ⇒ **之後每一筆用到同一條連線的交易都會繞過這道 trigger**
--        ⇒ ⇒ 而它**不會報錯、不會留痕** —— 描述就這樣被蓋掉了。
--      ⇒ 🛑 **本片【沒有】解掉這一格。** 段 A 那支 RPC 必須用 `SET LOCAL`,
--        而「它有沒有用 LOCAL」是**段 A 的驗收條**, 不是這裡擋得住的。
--      ⇒ 📌 **⇒ 這一格要寫進段 A 的驗收:一發「跑完那支 RPC 之後, 同一條連線的下一筆交易仍然被擋」。**
--      🔴🔴 **而那一發必須在【同一條連線】上連跑兩次, 不可以開兩條連線各跑一次**
--        (主視窗 2026-09-02 加的要求)——
--        ⇒ 🎯 **開兩條的話, 連線池那個病【根本不會出現】** ⇒ 那一格會印一個誠實的綠,
--          而它證的是另一件事。
--        ⇒ 📌 **這正是本片自己那個母題的又一個實例:一個到不了目標世界的量測, 印的是綠。**
--
-- ── 🔵 而隔壁那把鎖【一欄兩用】—— 我們刻意只抄一半, 而理由寫進 COMMENT ────
--    報價單那側 `translation_locked` 的註解逐字:
--      「不只是保護旗標, 它同時是【這列的 AI 文案已付過生成費、別再付一次】的成本開關」
--    ⇒ 🎯 我們這邊**沒有 AI 文案生成費這回事** ⇒ 那一半不需要。
--    ⇒ 🛑 **而【明寫我們不抄】比不寫重要** —— 否則下一個人看到隔壁那把鎖,
--      會以為我們的也有成本語意, 然後**不敢動它**。
--
-- 🛑 本支【不含】:段 A 的任何 UI / RPC · 不動 `supplier-config.ts` · 不動任何既有寫入路徑。

BEGIN;

-- 🔴🔴 **這一支會把 `products` 鎖到 COMMIT —— 連一般 SELECT 都進不來**(codex R2 抓, 我不假裝解掉)。
--    `ADD COLUMN`(三個)+ `ADD CONSTRAINT ... CHECK`(要驗既有每一列)+ `CREATE INDEX`
--    全部在同一筆交易裡, 而 ACCESS EXCLUSIVE **持有到 COMMIT**。
--    🛑 **而我沒有量過正式庫 `products` 有幾列。**
--
--    ✅ **主視窗 2026-09-02 判【不拆交易、不改守門】, 而它給了一個數字 ——**
--       **而那個數字是【轉述】而且量的不是這張表, 兩格但書照原樣寫在這裡:**
--       ```
--       線 `-fc` 2026-09-02 正式庫唯讀 EXPLAIN ANALYZE ⇒ `public.products_public` = **22,802 列**
--       🔴 ① 它量的是 **products_public**, **不是 products** —— 兩者的關係本窗未證
--             ⇒ 若前者是後者上的 view/篩選 ⇒ `products` **≥ 22,802**
--       🔴 ② 那是**另一個窗**在**另一件事**上量的 ⇒ 主視窗是轉述的, 不是它量的
--       ```
--    🎯 **⇒ 而判準不是精確列數, 是【量級】:**
--       ①`ADD COLUMN` 不帶 volatile default ⇒ PG 11+ catalog-only、**不重寫表** ⇒ 與列數無關
--       ②`ADD CONSTRAINT` 要掃全表驗既有列 ⇒ 而 2-10 萬列的順序掃是**次秒級**
--       ③`CREATE INDEX`(非 CONCURRENTLY)⇒ 同一個量級
--       ⇒ **三件加起來的 ACCESS EXCLUSIVE 預期在【秒】不是分鐘。**
--    🔴 **而拆交易的代價是【改守門】** —— 靜態閘要求恰好一個 COMMIT,
--       而那道閘擋的是「一支 migration 半途 COMMIT 而後半失敗 ⇒ 留下半套」。
--       ⇒ 📌 **為了省一秒鐘的鎖去拆掉一道防【留下半套】的閘 —— 那個交換在這個量級是虧的。**
--
--    🛑🛑 **而這一整段是【推論不是讀數】, 所以觸發條件寫死在這裡:**
--       **「本片假設 `products` 在十萬列以內。依據是線 `-fc` 2026-09-02 對 `products_public`**
--       **的正式庫量測(22,802 列)—— 而 `products_public` 與 `products` 的關係本窗未證。**
--       **若實際是【百萬級】, 這一段的鎖時間結論不成立 ⇒ 那時候拆交易 + 改守門才划算。」**
--    ⇒ `lock_timeout` 只封「等鎖」那一段;`statement_timeout` 只封單一句
--      ⇒ **兩者都不是整筆交易的總上限** ⇒ **本片對「總時長」沒有上界。**
--    ✅ **能做而我做了的**:兩個 timeout 讓「卡住」有形狀、不會無限期擋人。
--    🔵 **那條路留著, 而它今天刻意不走**:`ADD CONSTRAINT ... NOT VALID` 再單獨
--      `VALIDATE CONSTRAINT`(較弱的鎖)、以及 `CREATE INDEX CONCURRENTLY`。
--      ⇒ **兩者都要拆交易 ⇒ 要先改那道守門** ⇒ 見上面那段的觸發條件。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.products IN ACCESS EXCLUSIVE MODE;

-- ── 0. 前置閘(forward-only;已在鎖底下)────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.products'::regclass
                AND attname = 'description_locked' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘①:products.description_locked 已存在 ⇒ forward-only, 拒重跑';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.products'::regclass
                    AND attname = 'description' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘②:找不到 products.description ⇒ 本支要鎖的那一欄不在, 部署態與預期不符';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.products'::regclass AND tgname = 'trg_products_description_lock') THEN
    RAISE EXCEPTION '前置閘③:trigger 已存在 ⇒ forward-only, 拒重跑';
  END IF;
  -- 🔴 staff 是 description_locked_by 的 FK 目標 ⇒ 它不在的話這支建不起來, 而錯誤會指向 FK 而不是這裡
  IF to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 public.staff ⇒ description_locked_by 的 FK 目標不在';
  END IF;
END
$$;

-- ── 1. 三個欄 ─────────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN description_locked    boolean     NOT NULL DEFAULT false,
  ADD COLUMN description_locked_at timestamptz,
  ADD COLUMN description_locked_by text REFERENCES public.staff(id) ON DELETE RESTRICT;

-- 🔵 單向不變式(刻意不做成雙向, 同 `coupon_redemptions_revert_pair` 的既有判例):
--    有人 ⇒ 一定有時間(「有人鎖了而沒有時間」永遠是壞資料);
--    而「有時間而沒有人」寫得進去 —— 那是**系統自動鎖**的落點, 而那還沒有人拍板。
-- 🔴 codex must-fix:原本只有「有人 ⇒ 有時間」那一條, 而它放行兩種壞狀態:
--    ① `locked=true` 而 `at`/`by` 全 NULL ⇒ **「已鎖但完全沒留記號」** —— 而這一片的重點就是留記號
--    ② `locked=false` 而帶著鎖定資料 ⇒ 三欄不是一致狀態
--    ⇒ 收成:**鎖著 ⇒ 一定有時間**;**沒鎖 ⇒ 兩個記號欄都要是空的**。
--    🔵 而「有時間而沒有人」仍然放行 —— 那是**系統自動鎖**的落點, 而那還沒有人拍板。
--      ⇒ 📌 那一格是刻意留的, 不是漏的。
ALTER TABLE public.products
  ADD CONSTRAINT products_description_lock_pair
    CHECK (
      (description_locked      AND description_locked_at IS NOT NULL)
      OR
      (NOT description_locked  AND description_locked_at IS NULL
                               AND description_locked_by IS NULL)
    );

-- 部分索引:要撈「哪些商品被鎖了」是這一片的主要查詢
CREATE INDEX products_description_locked_idx
  ON public.products (id) WHERE description_locked;

COMMENT ON COLUMN public.products.description_locked IS
  'true = 這一列的 description 是【人工改過的】, 每日同步不可覆蓋它。
🔴 **怎麼擋的**:`trg_products_description_lock`(BEFORE UPDATE)在 description_locked 為 true 時
把 NEW.description 換回 OLD.description。
🔬 **而它對 upsert 也生效 —— 那是實跑量到的, 不是讀文件**(2026-09-02 拋棄式 PG 17.10):
`INSERT … ON CONFLICT DO UPDATE` 那一支【會】觸發 BEFORE UPDATE ⇒ 被鎖那列保住原值。
🔴 **逃生口**:`SET LOCAL pcm.allow_locked_description_write = ''on''` 之後那一筆交易可以改。
段 A(後台改描述)走這條路。⚠️ 而它是【誰記得設】不是【誰有權限】——
任何拿得到寫入權的人都設得起來 ⇒ **這道 trigger 防的是【忘記】, 不是防惡意。不要把它寫成安全機制。**
🔵 **而我們刻意【不抄】隔壁那把鎖的另一半**:報價單那側的 `translation_locked` 一欄兩用 ——
它同時是「這列的 AI 文案已付過生成費、別再付一次」的成本開關。
我們這邊**沒有 AI 文案生成費這回事** ⇒ 那個成本語意本欄**沒有**。
⇒ 🛑 **明寫出來是為了讓下一個人【敢動它】** —— 否則他看到隔壁那把鎖會以為我們的也有成本耦合。
🛑 **本欄不涵蓋** title / subtitle / highlights —— 只鎖 description。要擴是另一片。';

COMMENT ON COLUMN public.products.description_locked_at IS
  '這一列的 description 被鎖起來的時間。🔵 與 description_locked_by 是【單向】不變式:
有人一定有時間;而「有時間而沒有人」寫得進去 = 系統自動鎖的落點, 而那還沒有人拍板。';

COMMENT ON COLUMN public.products.description_locked_by IS
  '是誰鎖的(FK → public.staff.id)。🔵 值域刻意用【我們自己的 staff.id】,
不是隔壁那套 `sean_web_ui / llm_corrector_accept / manual_sql` 的來源字串 ——
我們有真的員工名單, 而那套字串是他們沒有名單時的替代品。';

-- ── 2. trigger ────────────────────────────────────────────────────────
CREATE FUNCTION public.products_description_lock_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- 🔴 讀【OLD】不是 NEW:要問的是「這一列**原本**有沒有被鎖」。
  --    讀 NEW 的話, 同一發 UPDATE 只要把 description_locked 設成 false 就繞過去了。
  IF OLD.description_locked
     AND coalesce(pg_catalog.current_setting('pcm.allow_locked_description_write', true), 'off') <> 'on'
  THEN
    NEW.description := OLD.description;
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.products_description_lock_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.products_description_lock_guard() FROM anon, authenticated;

CREATE TRIGGER trg_products_description_lock
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_description_lock_guard();

-- 收權斷言(repo 慣例形狀;`scripts/migration-static-checks.sh` 第③道會數這張清單)
DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.products_description_lock_guard()'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
  END LOOP;
  -- 🔵 trigger 函式**不需要**對 service_role 有 EXECUTE:trigger 由 PG 自己叫,
  --    不走呼叫端的權限。⇒ 這裡刻意不驗那一格(驗了會逼我們開一個不需要的權限)。
  RAISE NOTICE '✅ 收權斷言過:% 支 trigger 函式 —— anon/authenticated 零 EXECUTE。⚠️ 它【不答】有沒有第三個角色被授權、也不答 WITH GRANT OPTION。',
    cardinality(v_functions);
END
$grant_assert$;

-- ── 3. 事後閘 ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_type text; v_notnull boolean; v_default text; v_com text; v_cfg text[];
  v_tgenabled "char"; v_tgtype smallint; v_tgfoid oid;
  v_condef text; v_idxdef text;
BEGIN
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_notnull, v_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.products'::regclass
     AND a.attname = 'description_locked' AND NOT a.attisdropped;
  IF v_type IS DISTINCT FROM 'boolean' OR NOT v_notnull OR v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '事後閘①:欄形狀不對(型別 % / notnull % / 預設 %)', v_type, v_notnull, v_default;
  END IF;

  -- 🔴 codex must-fix:原本只驗【同名 trigger 存在】——
  --    disabled(`tgenabled='D'`)、錯時機(AFTER)、錯事件(只 INSERT)、掛到別的函式,
  --    **四種壞世界全部照樣通過** ⇒ 兩個行為世界印相同的成功。
  --    ⇒ 逐格釘:啟用中 · BEFORE · 含 UPDATE · 指向我們那支函式。
  --    🔵 `tgtype` 位元:bit0=ROW · bit1=BEFORE · bit4=UPDATE(PG 內部編碼)。
  SELECT t.tgenabled, t.tgtype, t.tgfoid
    INTO v_tgenabled, v_tgtype, v_tgfoid
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.products'::regclass
     AND t.tgname = 'trg_products_description_lock' AND NOT t.tgisinternal;
  IF v_tgenabled IS NULL THEN
    RAISE EXCEPTION '事後閘②:trigger 沒建成';
  END IF;
  IF v_tgenabled <> 'O' THEN
    RAISE EXCEPTION '事後閘②:trigger 不是啟用中(tgenabled=%)⇒ 它在但不會跑', v_tgenabled;
  END IF;
  -- 🔴 codex R2:原本只驗「三個 bit 都有」⇒ **多掛 INSERT / DELETE 照樣綠**
  --    ⇒ 釘**精確值 19**(ROW=1 + BEFORE=2 + UPDATE=16)。多一個事件 ⇒ 值就不是 19。
  IF v_tgtype <> 19 THEN
    RAISE EXCEPTION '事後閘②:trigger 的時機/事件不是【剛好 ROW+BEFORE+UPDATE】(tgtype=% 而要 19)⇒ 多掛或少掛了事件', v_tgtype;
  END IF;
  -- 🔴 codex R2:原本比 `proname` ⇒ **別的 schema 底下的同名函式也會過**。⇒ 比 oid。
  IF v_tgfoid IS DISTINCT FROM 'public.products_description_lock_guard()'::regprocedure THEN
    RAISE EXCEPTION '事後閘②:trigger 指向的不是 public.products_description_lock_guard()(實際 oid=%)', v_tgfoid;
  END IF;

  -- 🔴 codex must-fix:原本四格**沒有驗另外兩個欄、那條 CHECK、那個部分索引**
  --    ⇒ 刪掉其中任一項, 它仍然會宣告「定義層四格通過」。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.products'::regclass
                    AND attname = 'description_locked_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '事後閘⑤:description_locked_at 不見了';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.products'::regclass
                    AND attname = 'description_locked_by' AND NOT attisdropped) THEN
    RAISE EXCEPTION '事後閘⑤:description_locked_by 不見了';
  END IF;
  -- 🔴🔴 codex R2 抓到的【該紅而會綠】那一格:⑤⑥⑦ 原本只驗**存在** ——
  --    `CHECK(true)` / 拿掉 FK / 索引改成 `WHERE NOT description_locked`
  --    **三種壞世界全部照樣印七格通過, 而 harness 也照樣 8/0**。
  --    ⇒ 📌 **一個「它在」的斷言, 對「它變成別的東西」完全失明。**
  --    ⇒ 改成釘**定義字面**(同本 repo 既有判例:`pg_get_constraintdef` 逐字比)。
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_condef
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.products'::regclass
     AND c.conname = 'products_description_lock_pair' AND c.contype = 'c';
  IF v_condef IS NULL THEN
    RAISE EXCEPTION '事後閘⑥:那條一致性 CHECK 不見了';
  END IF;
  -- 只釘承重的三個片語(不釘整段:PG 的正規化格式跨版本會變, 釘整段會在別的版本上假紅)
  IF pg_catalog.strpos(v_condef, 'description_locked_at IS NOT NULL') = 0
     OR pg_catalog.strpos(v_condef, 'description_locked_at IS NULL') = 0
     OR pg_catalog.strpos(v_condef, 'description_locked_by IS NULL') = 0 THEN
    RAISE EXCEPTION '事後閘⑥:那條 CHECK 在, 而它的定義不是我們要的那一條(實際 %)', v_condef;
  END IF;
  -- 🔴 FK 也要釘 —— 拿掉它「description_locked_by 指向誰」就沒有人管了
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  JOIN pg_catalog.pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attname = 'description_locked_by'
                 WHERE c.conrelid = 'public.products'::regclass
                   AND c.contype = 'f' AND a.attnum = ANY (c.conkey)
                   AND c.confrelid = 'public.staff'::regclass) THEN
    RAISE EXCEPTION '事後閘⑥b:description_locked_by 沒有指向 public.staff 的 FK';
  END IF;
  SELECT pg_catalog.pg_get_indexdef(i.oid) INTO v_idxdef
    FROM pg_catalog.pg_class i
   WHERE i.relname = 'products_description_locked_idx' AND i.relkind = 'i';
  IF v_idxdef IS NULL THEN
    RAISE EXCEPTION '事後閘⑦:部分索引不見了';
  END IF;
  -- 🔴 述詞方向要釘:改成 `WHERE NOT description_locked` 會撈到【剛好相反】的那一群,
  --    而它仍然是一個合法的部分索引 ⇒ 只驗「索引在」看不出來。
  IF pg_catalog.strpos(v_idxdef, 'WHERE description_locked') = 0 THEN
    RAISE EXCEPTION '事後閘⑦:索引在, 而它的述詞不是 WHERE description_locked(實際 %)', v_idxdef;
  END IF;

  SELECT p.proconfig INTO v_cfg FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'products_description_lock_guard';
  IF v_cfg IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(v_cfg) e
                     WHERE e IN ('search_path=', 'search_path=""')) THEN
    RAISE EXCEPTION '事後閘③:trigger 函式沒有 SET search_path = ''''(實際 %)', v_cfg;
  END IF;

  v_com := pg_catalog.col_description('public.products'::regclass,
             (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.products'::regclass AND attname = 'description_locked'));
  -- 🔴 三句各擋一種【以後被讀錯】的方式, 缺一不可
  IF v_com IS NULL
     OR pg_catalog.strpos(v_com, 'ON CONFLICT DO UPDATE') = 0   -- upsert 那一格是實跑量到的
     OR pg_catalog.strpos(v_com, '不要把它寫成安全機制') = 0     -- 逃生口的射程
     OR pg_catalog.strpos(v_com, 'AI 文案生成費') = 0 THEN       -- 刻意不抄隔壁那一半
    RAISE EXCEPTION '事後閘④:description_locked 的 COMMENT 少了三句其中之一 ⇒ 契約與碼分岔了';
  END IF;

  RAISE NOTICE '事後閘通過(定義層八格):①欄形狀 ②trigger 啟用中 + tgtype 剛好 19 + tgfoid 指向本函式 ③search_path 收乾淨 ④COMMENT 三句都在 ⑤另兩個記號欄在 ⑥一致性 CHECK 的【定義】對 + ⑥b FK 指向 staff ⑦部分索引的【述詞】對。🛑 **它們證不到的**:(a)**不驗行為** —— trigger 擋不擋得住 upsert 那一層在 scripts/description-lock-verify.sh(拋棄式 PG);(b)④ 是**字串有沒有出現**不是語意;(c)本檔**完全不驗**每日同步那條路真的會走到這裡 —— 那要跑 rpm-load, 而它不在本支的分母裡。';
END
$$;
COMMIT;
