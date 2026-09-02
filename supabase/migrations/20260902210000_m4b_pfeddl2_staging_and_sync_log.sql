-- ============================================================
-- ⟦b4-PFEDDL2⟧:把【已經在正式庫上的】那兩張表補進版控
--   product_fitments_effective_staging · product_fitments_effective_sync_log
-- ------------------------------------------------------------
-- pcm:never-apply
--   ↑ 🔴 **這一行是給機器讀的**(`scripts/migration-ledger-divergence.sh` 的第九格)。
--     它讓本支在帳本比對裡印成「⑨ 刻意不套用」而不是「④ 待套 PENDING」。
--     ⚠️ **不要把它挪到 20 行以外** —— 那支腳本只讀檔頭前 20 行。
--     🔵 而這是那個標記的**第三個使用者**(前兩個:`20260901170000` 與 `-c7` 的 `20260902200000`)。
--
-- 🔴🔴🔴 **本支【不 apply 到正式庫】。它是空庫重放用的。**
--    正式庫上那兩張表**已經存在**(見下面「來源」)⇒ 本支在那裡跑會
--    `ERROR: relation "..." already exists` —— 而整支包在 `BEGIN … COMMIT` 裡
--    ⇒ **交易回捲、零改動, 而且它會出聲。**
--    ⇒ 📌 **那是刻意的**:一支「補版控」的檔在正式庫上**沒有事情可做**,
--      而【安靜地什麼都不做】與【做了而我不知道】在事後長得一樣。**所以它選擇出聲。**
--    🛑 **⇒ 不要把它放進「要 Sean 貼」的那一疊。**
--
-- ── 🔵 來源:**正本, 不是抄來的** ────────────────────────────────────
--    **2026-09-02 19:5x Sean 本人在 Supabase SQL Editor 跑的四發唯讀查詢**,結果由主視窗原文轉回。
--    查詢原文:`~/pcm-mailbox/查詢-那兩張表的真DDL-20260902.md`
--      ① `information_schema.columns` ② `pg_get_constraintdef` ③ `pg_indexes` ④ `pg_class` + `pg_policies`
--    🟢 而那一發帶負對照:「這個數字必須是 0」⇒ 實得 **0** ⇒ 尺是活的。
--
--    🔴🔴 **而【為什麼非要正本不可】—— 這一段是這支檔存在的理由, 不要刪:**
--      我們手上本來有兩份材料, 而**兩份都不夠**:
--      ① `packages/adapters/src/supabase/database.types.ts`(從正式庫產生)
--         ⇒ 給得出 **欄名 / 型別 / 可不可空**;**給不出** PK / FK / CHECK / 預設 / 索引 / RLS
--      ② `docs/archive/2026-07-25-docs-cleanup/reviews/2026-07-12-s1-apply-sql.sql`(七週前手寫)
--         ⇒ 給得出上面全部, **而它的約束那一半沒有第二把尺** —— 七週來有沒有被改過, 證不出來
--      ✅ 而**欄名那一格我們交叉過了**:①與②逐字相同(staging 9 欄 / sync_log 10 欄)
--         ⇒ 🎯 **而【欄名對】不等於【DDL 對】。這條線畫在這裡。**
--      🛑 **⇒ 而這一片的目的就是【讓版控裡那份 = 正式庫那份】**
--         ⇒ **用一份【證不出相同】的 DDL 去達成「相同」, 那是把問題換一個地方放。**
--
--    🔵 **而正本回來之後, 有一格答案是【第三種】—— 兩個推論都錯:**
--      我們看到一個叫 `..._select_public` 的 policy 名字出現在碼裡, 而七週前那份存檔沒有它
--      ⇒ 當時判「『後來加的』與『那份漏了』我分不出來」
--      ⇒ 🎯 **而正本說:這兩張表 policy 數 = 0 ⇒ 那個名字是【別張表的】。**
--      ⇒ 📌 **兩種可能都不成立, 而第三種要正本才看得見。⇒ 一句「我分不出來」擋住了兩個都錯的推論。**
--
-- ── 🛑 三格抄之前要看(它們是正本與直覺不一樣的地方)──────────────────
--    ① `staging.run_id` 是 **NOT NULL**, 而 `sync_log.run_id` 是 **可空**
--       ⇒ **同名欄可空性不同** ⇒ 不要對齊
--    ② `ux_pfes_row` 帶 **`NULLS NOT DISTINCT`**(PG15+ 語法)
--       ⇒ 它決定「`year_start`/`year_end` 都是 NULL 的兩列算不算重複」⇒ **不可省**
--    ③ 兩張表 **RLS 開著而 0 條 policy** ⇒ 那不是忘了寫
--       ⇒ 本支帶 `ENABLE ROW LEVEL SECURITY`, 而**刻意不補任何 policy**
--       ⚠️ 而「service_role 讀不到開了 RLS 的表」那個缺口是**另一件事**(`⟦b9-Q15GAP⟧`)——
--         而它的態是 **Sean 2026-08-26 拍乙【已評估:今天不做】**。⇒ **不要在這支檔裡順手補。**
--
-- 🔴 本支對既有資料庫零改動:表已存在 ⇒ 它在正式庫上只會炸並回捲。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 前置閘(forward-only)────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.product_fitments_effective_staging') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:product_fitments_effective_staging 已存在 ⇒ 本支是空庫重放用的, 不在有它的庫上跑(這正是它在正式庫上該有的行為)';
  END IF;
  IF to_regclass('public.product_fitments_effective_sync_log') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:product_fitments_effective_sync_log 已存在 ⇒ 同上';
  END IF;
  -- 🔴 FK 目標:products 不在 ⇒ 建不起來, 而錯誤會指向 FK 而不是這裡
  -- 🔴 codex:原本只驗【名字在】—— 而 `products` 是 view、缺 `id`、`id` 型別不是 uuid、
  --    或 `id` 沒有唯一約束時, 這一格都不叫, 一路走到 CREATE TABLE 才噴原生錯誤。
  --    ⇒ 而那個原生錯誤指向 FK 那一行, 讀的人會去查我的 FK 而不是查 products。
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.products ⇒ staging.product_id 的 FK 目標不在';
  END IF;
  IF (SELECT relkind FROM pg_catalog.pg_class WHERE oid = 'public.products'::regclass) <> 'r' THEN
    RAISE EXCEPTION '前置閘③:public.products 不是一般表(relkind=%)⇒ FK 指不上去',
      (SELECT relkind FROM pg_catalog.pg_class WHERE oid = 'public.products'::regclass);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.products'::regclass AND attname = 'id'
                    AND atttypid = 'uuid'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘③:public.products.id 不在或不是 uuid ⇒ FK 型別對不上';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.products'::regclass
                    -- 🔴 codex R2:PG 不允許 FK 引用 **deferrable** 的 PK/UNIQUE
                    --    ⇒ 少了 `NOT condeferrable`, 這一格會放行, 而 CREATE TABLE 才原生報錯。
                    AND contype IN ('p','u') AND NOT condeferrable AND conkey = ARRAY[(
                      SELECT attnum FROM pg_catalog.pg_attribute
                       WHERE attrelid = 'public.products'::regclass AND attname = 'id')]) THEN
    RAISE EXCEPTION '前置閘③:public.products.id 沒有唯一/主鍵約束 ⇒ FK 建不起來';
  END IF;
END
$$;

-- ── 1. staging ────────────────────────────────────────────────────
--    欄序逐字照正本 ①(ordinal_position 1-9)。
CREATE TABLE public.product_fitments_effective_staging (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid    NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  moto_brand        text    NOT NULL,
  model_code        text    NOT NULL,
  year_start        integer,
  year_end          integer,
  match_source      text    NOT NULL,
  source_model_code text    NOT NULL,
  -- 🔴 這一欄 NOT NULL, 而 sync_log 的同名欄可空 —— 正本如此, 不要對齊
  run_id            uuid    NOT NULL,

  -- 五條具名 CHECK:名字與定義逐字照正本 ②(名字不可改 —— 它們是別人引用的座標)
  CONSTRAINT pfes_year_state_valid    CHECK (year_start IS NOT NULL OR year_end IS NULL),
  CONSTRAINT pfes_year_interval_valid CHECK (year_start IS NULL OR year_end IS NULL OR year_end >= year_start),
  CONSTRAINT pfes_match_source_valid  CHECK (match_source IN ('direct', 'inherited')),
  CONSTRAINT pfes_nonblank_valid      CHECK (btrim(moto_brand) <> '' AND btrim(model_code) <> '' AND btrim(source_model_code) <> ''),
  CONSTRAINT pfes_provenance_valid    CHECK (
    (match_source = 'direct'    AND source_model_code =  model_code) OR
    (match_source = 'inherited' AND source_model_code <> model_code))
);

-- 🔴 `NULLS NOT DISTINCT` 是 **PG15+** 的語法, 而它**不可省**:
--    少了它, `year_start`/`year_end` 都是 NULL 的兩列**不算重複** ⇒ 唯一鍵擋不住它們。
CREATE UNIQUE INDEX ux_pfes_row
  ON public.product_fitments_effective_staging
  (product_id, moto_brand, model_code, year_start, year_end, match_source)
  NULLS NOT DISTINCT;

-- ── 2. sync_log ───────────────────────────────────────────────────
CREATE TABLE public.product_fitments_effective_sync_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  status      text        NOT NULL,
  source_rows integer,
  staged_rows integer,
  orphan_rows integer,
  old_count   integer,
  new_count   integer,
  note        text,
  -- 🔴 可空 —— 與 staging 的同名欄不同
  run_id      uuid,

  CONSTRAINT product_fitments_effective_sync_log_status_check
    CHECK (status IN ('success', 'abort'))
);

-- ── 3. RLS:開著, 而【刻意 0 條 policy】(正本如此)────────────────────
-- 🔴🔴 **`scripts/rls-service-role-policy-gate.py` 在這裡擋下了本片一次, 而它擋得對 ——**
--    **而在這一支檔上, 照它的建議做會是【錯的】。兩句同時成立, 所以整段留下來。**
--
--    它說的:兩張表開了 RLS 而沒有 service_role 讀得到的 SELECT 政策
--    ⇒ 今天照樣會動, 因為 `service_role` 帶 `BYPASSRLS`(**平台角色屬性, 不是我們的碼**)
--    ⇒ 拿掉它的那一天, 這兩張表變成【後台讀到空的】, 而**空資料看起來像正常資料, 沒有人會叫**。
--    ✅ **那個診斷完全正確, 而正式庫現在有 45 張這樣的表。**
--
--    🛑 **而本支【不能】照它的第一條路做**, 兩個理由各自獨立成立:
--      ① **正本說 policy 數 = 0**(2026-09-02 Sean 跑的第四發)。本支的**全部目的**是
--         「版控那份 = 正式庫那份」⇒ 補一條政策 = 讓版控與正式庫**不同**, 而且是我自己造成的。
--         ⇒ 而本檔的事後閘⑥ 正在釘「policy 恰好 0」⇒ **兩道守門會當場互相打臉。**
--      ② 這件事**已經有人決定過了**:板 `⟦b9-Q15GAP⟧` ——
--         **Sean 2026-08-26 拍【乙】刻意按住**, 而 2026-09-01 的正式庫實測讓那個理由更成立:
--         補一張只救一張, 而同型的沒救 ⇒ 拿掉 BYPASSRLS 那天畫面會是
--         「客戶列表有、**每個人訂單數 0**」⇒ **比整頁空白更像真資料。空白會有人叫, 0 不會。**
--         ⇒ 📌 **所以那一列的態是【已評估:今天不做】, 不是【還沒排】。**
--
--    🎯 **⇒ 而這一格值得記住形狀:一道正確的守門, 對一支【刻意在複製現況】的檔會給出錯的處方 ——**
--       **因為它假設「你正在決定這張表該長什麼樣」, 而本支的工作是【不做那個決定】。**
--    ⚠️ **而豁免掉它【不會讓那個缺口消失】** —— 缺口是真的, 它住在 `⟦b9-Q15GAP⟧` 那一列上,
--       而那一列現在寫的是 `open`。**豁免的是這支檔的責任, 不是那件事。**
--
-- RLS-GATE-EXEMPT: public.product_fitments_effective_staging -- 本支在複製正式庫現況(正本:0 policy);補政策會讓版控與正式庫不同, 且與本檔事後閘⑥相衝。缺口本身是板 b9-Q15GAP, 態=Sean 2026-08-26 拍乙【已評估:今天不做】。誰會讀它:同步管線走 service_role(今天靠 BYPASSRLS), 以及 pcm_readonly 手動查。
-- RLS-GATE-EXEMPT: public.product_fitments_effective_sync_log -- 同上;它另有一個讀者是後台首頁那行「車搜新鮮度」灰字(走 service_role)。
ALTER TABLE public.product_fitments_effective_staging  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_fitments_effective_sync_log ENABLE ROW LEVEL SECURITY;

-- ── 3.5 權限 ──────────────────────────────────────────────────────
-- ✅✅ **這一節【有正本】** —— 來源:2026-09-02 20:0x Sean 在 Supabase SQL Editor 跑的
--    `~/pcm-mailbox/查詢-那兩張表的ACL-20260902.md`(唯讀, 帶負對照 ⇒ 實得 0 ⇒ 尺是活的)。
--    正本逐字:兩張表各 **`postgres` 七種**(它是 owner)· **`service_role` 七種** · **`pcm_readonly` SELECT**;
--    **`anon` / `authenticated` / `PUBLIC` ⇒ 一個都沒有。**
--
-- 🔴🔴🔴 **而這一節【一小時前是猜的】, 而舊字面留著 —— 它是這一片最值得留的一段:**
--    ⛔ ~~「本節是本支唯一沒有正本的一節, 必須被讀成假設不是讀數。Sean 跑的那四發查了
--        欄/約束/索引/RLS, **沒有一發查 ACL** ⇒ 誰有什麼權限, 本窗不知道。」~~
--    ⛔ ~~當時寫的那組:`REVOKE … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role`~~
--
--    🎯 **而比對結果**:`anon`/`authenticated`/`PUBLIC` 零權限 ⇒ **猜對**;
--       `service_role` 那七種 ⇒ **逐字相同**;
--       🔴 **而漏掉的是 `pcm_readonly` 的 SELECT** —— 兩張表都有。
--
--    📌 **⇒ 而漏的方向, 正是當時那個判準預測的方向:**
--       當時逐字寫著「**收太緊 ⇒ 有人跑不動 ⇒ 它會叫;開太寬 ⇒ 沒有人會叫**
--       ⇒ 在沒有正本的一格選【錯了會出聲】的方向」。
--       🎯 **⇒ 而 `pcm_readonly` 是我們唯讀查正式庫用的那個帳號**
--          ⇒ 空庫重建之後它會讀不到這兩張表 ⇒ **它真的會叫。**
--    ⇒ ⇒ 🔵 **所以這不是「我猜錯了」, 是【我選的方向讓錯誤可見, 而正本在它出聲之前就到了】。**
--       📌 **而那個判準只有在【它真的被觸發過一次】之後才算被驗過** —— 今天被驗過了。
--
--    🔴 **而這一格特別毒, 原因是【它會被讀成正本的一部分】**:
--      上面每一節都逐字釘著「2026-09-02 正本」, 而讀的人不會逐節去分辨
--      哪一節有正本、哪一節沒有 ⇒ 📌 **一個沒有來源的值, 混在一堆量過的值中間, 看起來一樣可信。**
--    ⇒ ⇒ 🎯 **而本支存在的理由就是「讓版控那份 = 正式庫那份」**
--      ⇒ **在唯一沒有正本的那一節猜一個值, 正好破壞了它自己的目的。**
--
--    🔵 **而當時那個「最保守」的推理留著, 因為它三條理由裡有兩條被正本證實了:**
--      收乾淨 → 只開給 `service_role`。理由:
--        ① 這兩張表**沒有任何 app 讀取點** —— `⟦b9-Q15GAP⟧` 那一列逐字把它們列為
--           「**2 張兩把尺都零命中**」(`.from()` 與 SQL 函式引用都是 0)
--           ⚠️ 而那一列自己也標了:那是【兩把尺看不到】不是【沒有下游】——
--              第三條路(Edge Function / 報價單那個 repo / `pg_cron` / 外部直連)**沒量**。
--        ② 寫它的是同步管線, 而管線走 `service_role`。
--        ③ 🔴 **而「收太緊」與「開太寬」的錯法不對稱**:收太緊 ⇒ 有人跑不動 ⇒ **它會叫**;
--           開太寬 ⇒ **沒有人會叫**, 而 staging 表裡有全站商品的適配資料。
--      ⇒ 📌 **在沒有正本的一格上, 選那個【錯了會出聲】的方向。**
--
--      🔴 **而②那一條(「兩把尺都零命中 ⇒ 沒有下游」)正是漏掉 `pcm_readonly` 的成因**:
--        `.from()` 與 SQL 函式引用都掃不到「一個人拿 psql 連上去 SELECT」這種用法。
--        ⇒ 📌 **那一列自己就標了「是【兩把尺看不到】不是【沒有下游】」—— 而我讀到了, 也照抄了,**
--          **然後在下一段用它推出了一個【等同於「沒有下游」】的結論。**
--        ⇒ ⇒ 🎯 **一個正確標註的限制, 擋不住讀的人在三行之後把它當成沒有限制。**
REVOKE ALL PRIVILEGES ON TABLE public.product_fitments_effective_staging  FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.product_fitments_effective_sync_log FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.product_fitments_effective_staging  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.product_fitments_effective_sync_log FROM anon, authenticated;
-- 🔵 這兩行刻意【不換行】—— `migration-static-checks.sh` 規則④ 的 regex 是 `^GRANT … <表名>`
--    ⇒ 把表名折到第二行, 那道閘就看不到它 ⇒ 它會判「建了表而沒有 GRANT」。
--    📌 一個純粹的排版動作, 會把一道守門的答案翻面。
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.product_fitments_effective_staging TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.product_fitments_effective_sync_log TO service_role;
-- 🔴 `pcm_readonly` 那兩條是正本上的, 而我第一版漏了(見上面那段)。
--    🔴🔴 **而這裡【不做條件式跳過】, 也【不硬炸】—— 角色不在就建它。**
--    ⛔ ~~第一版寫「角色不在就 RAISE EXCEPTION」~~ **作廢**(codex 抓)——
--      理由:`scripts/migrations-replay-from-zero.sh` **會跑 `supabase/migrations/` 底下每一支**,
--      **它不認得 `pcm:never-apply`**(那個標記只有帳本比對那支在讀)
--      ⇒ 🛑 **硬炸會讓 CI 的從零重放整條紅, 而紅的原因是【一個角色沒建】不是碼有問題。**
--    ⛔ 而「條件式跳過」也不行:那會產出一個**少一條 GRANT 而印綠**的重放結果
--      ⇒ 📌 **那正好是本支要防的東西, 用本支自己的手做出來。**
--    ✅ **⇒ 第三條路:沒有就建一個 NOLOGIN 的空角色。**
--      正式庫上它**早就存在** ⇒ 這段是 no-op;而本支 never-apply, 正式庫根本不會跑到。
--      重放庫上它**會被建出來** ⇒ 下面兩條 GRANT 落得下去 ⇒ **權限形狀與正本一致。**
--      🔵 而它 `NOLOGIN` 且沒有任何其他權限 ⇒ 建出來的是一個殼, 不是一條可登入的路。
--    ⚠️ 這與 `20260901170000` 的條件式做法不同, 而那是刻意的:
--      **那支會被記進帳本**(略過就永遠補不回, 所以它只能警告);**本支不會**, 所以它可以直接修好。
DO $$
BEGIN
  -- 🔴 codex R2:角色**已存在**時我一個屬性都沒看 ⇒ 一個同名而 SUPERUSER/BYPASSRLS 的角色
  --    會直接拿到下面那兩條 SELECT, 而本檔會印綠。⇒ 已存在就驗它是不是我們想的那種。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
              WHERE rolname = 'pcm_readonly' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION '角色 pcm_readonly 已存在, 而它是 SUPERUSER 或帶 BYPASSRLS ⇒ 那不是唯讀角色, 不對它 GRANT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly') THEN
    CREATE ROLE pcm_readonly NOLOGIN;
    -- 🔴🔴 **這一行是被 harness 抓出來的, 而它是一個真的 bug**:
    --    新建的角色**沒有 schema public 的 USAGE** ⇒ 下面的閘⑧ 當場擋住 ⇒ 從零重放整條紅。
    --    ⇒ 📌 **而在我把「角色不存在」這個世界【造出來】之前, 這條分支一次都沒被執行過**
    --      —— 25/25 全綠, 而其中沒有一格走過它。
    --    ⇒ ⇒ 🎯 **一條從來沒被執行過的修法, 與一條寫錯的修法, 在總分上長得一模一樣。**
    GRANT USAGE ON SCHEMA public TO pcm_readonly;
    RAISE NOTICE 'pcm_readonly 不存在 ⇒ 已建一個 NOLOGIN 空角色並給它 schema public 的 USAGE, 好讓下面兩條 GRANT 重放得出正本的權限形狀。正式庫上它早就存在 ⇒ 那裡這一段是 no-op。';
  END IF;
END
$$;
GRANT SELECT ON TABLE public.product_fitments_effective_staging TO pcm_readonly;
GRANT SELECT ON TABLE public.product_fitments_effective_sync_log TO pcm_readonly;

-- 🔴🔴 **identity 欄會【另外】生一支 sequence, 而表上的 REVOKE 收不到它**(codex 抓;
--    這正是 memory 那條已知坑:「表上兩道 REVOKE 收不到 IDENTITY 另建的 sequence,
--    而 anon 可 nextval, 且 RLS 擋不到」)。
-- ✅✅ **這一節【有正本】** —— 2026-09-02 21:0x Sean 在 SQL Editor 跑
--    `~/pcm-mailbox/查詢-那兩張表的ACL-20260902.md` **末節**(唯讀, 帶負對照 ⇒ 實得 0)。
--    正本逐字:兩支 sequence 各 **`postgres` SELECT/UPDATE/USAGE**(它是 owner)
--    · **`service_role` SELECT/UPDATE/USAGE**;**`anon`/`authenticated`/`PUBLIC` 一個都沒有。**
--
-- 🔴🔴 **而這一節【一小時前是猜的】—— 舊字面留著, 而它與上面表那一層是【同一個模式】:**
--    ⛔ ~~「本節沒有正本。那發 ACL 查詢只查了表, `role_table_grants` 不涵蓋 sequence
--        ⇒ 那兩支 sequence 的權限本窗不知道 ⇒ 這裡是選一個方向不是抄正本。」~~
--    ⛔ ~~當時寫的:`GRANT USAGE, SELECT … TO service_role`(**少了 `UPDATE`**)~~
--
--    🎯 **比對**:`anon`/`authenticated`/`PUBLIC` 零 ⇒ **猜對**;
--       而漏的是 **`service_role` 的 `UPDATE`**(以及 owner `postgres` 那三格)。
--    🔵 **⇒ 而這是【第二次】猜, 而兩次漏的都是「該有而沒給」**:
--       表那一層漏 `pcm_readonly` 的 SELECT · 這一層漏 `service_role` 的 UPDATE。
--       ⇒ 🎯 **兩次都是【我沒想到要列的那個角色/那格權限】, 而兩次都是正本補上的。**
--       ⇒ ⇒ 📌 **而那正好證實方向選對了:選「錯了會出聲」那一邊, 漏的就會是【該有而沒給】——**
--         **它會有人跑不動而叫。若選另一邊, 漏的會是【不該有而給了】—— 而那不會叫。**
--    🛑 **而「兩次都漏」本身也是一個讀數**:它說的不是「我不夠仔細」,
--       是 **「憑推理列角色」這個方法本身有一個固定的失效方向** —— 而正本一發就補完。
DO $$
DECLARE v_seq text;
BEGIN
  FOREACH v_seq IN ARRAY ARRAY[
    pg_catalog.pg_get_serial_sequence('public.product_fitments_effective_staging',  'id'),
    pg_catalog.pg_get_serial_sequence('public.product_fitments_effective_sync_log', 'id')
  ] LOOP
    IF v_seq IS NULL THEN
      RAISE EXCEPTION 'identity sequence 找不到 ⇒ 那兩支 sequence 的權限沒被收 ⇒ 不要放行';
    END IF;
    -- 🔴 codex R3:`service_role` **也要先收**。若 default ACL 已經給過它 `WITH GRANT OPTION`,
    --    後面那句普通 `GRANT` **收不掉那個 option** ⇒ 它留著可轉授, 而閘⑨ 當時忽略 is_grantable
    --    ⇒ 一個【可轉授】的權限會被判成與正本相同。⇒ 先收乾淨再給。
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
    -- 🔴 `UPDATE` 是正本上有的, 而我第一版漏了 —— 少了它 `setval()` 會被拒。
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO service_role', v_seq);
    -- ⚠️ **而 `UPDATE` 讓 `service_role` 可以 `setval()`** —— 那能把流水號推走或重設,
    --    **而 `setval` 不隨交易回滾**。🛑 **本片【不判斷那是不是好設計】** ——
    --    正本上它就是這樣, 而本支的工作是複製現況。⇒ 📌 **「與正式庫相同」不等於「安全」,**
    --    **而把後者讀進前者是這一整支檔最容易被誤讀的一句。**
    -- 🔵 **owner(`postgres`)那三格【不寫 GRANT】, 而它在正本上是有的** ——
    --    建立者本來就會拿到, 上面那道 REVOKE 只收 PUBLIC/anon/authenticated ⇒ 它不受影響。
    --    ⇒ 📌 **寫一句 no-op 的 `GRANT … TO postgres` 比不寫更糟:它讀起來像【本片處理過這一格】,**
    --      **而下一個人會以為「owner 的權限是我們給的」⇒ 收掉它就會以為只要刪那一行。**
    --    ⇒ ✅ 所以這裡只留這行註解, 而下面的事後閘⑨ **把 owner 排除在比對之外**(理由同閘⑦)。
  END LOOP;
END
$$;

COMMENT ON TABLE public.product_fitments_effective_staging IS
  '車搜適配表的 staging(每次 sync 先寫這裡, commit 時整批換過去)。
🔴 **本表的 DDL 是 2026-09-02 由 Sean 在 SQL Editor 跑唯讀查詢取回的【正本】**, 不是從舊文件抄的。
🛑 RLS **開著而 0 條 policy** —— 那是正本的狀態, 不是漏寫。
⚠️ 而「service_role 讀不到開了 RLS 的表」是另一件事(板 b9-Q15GAP), 而它的態是
Sean 2026-08-26 拍乙【已評估:今天不做】⇒ **不要在這裡順手補 policy。**';

COMMENT ON TABLE public.product_fitments_effective_sync_log IS
  '車搜適配同步的紀錄表(後台首頁那行「車搜新鮮度」灰字讀它 —— 員工每天看得到)。
🔴 DDL 來源同 staging:2026-09-02 Sean 跑的正本。
🛑 RLS 開著而 0 條 policy(正本如此)。';

-- ── 4. 事後閘:釘【定義字面】, 不只驗【存在】────────────────────────
--    🔴 理由是今晚量到的:一個「它在」的斷言, 對「它變成別的東西」完全失明。
--    🔴🔴 **而 codex R1 十二條裡有五條打的是同一件事:【我以為我在釘定義, 其實只釘了名字】** ——
--      閘①②只比欄名與可空(型別/預設/identity 改壞照樣綠)· 閘③只【數】五條(其他四條可改成恆真)
--      · 閘④只找兩段字串(provenance 兩個分支對調不叫)· 閘⑤不驗 FK 欄位與 ON DELETE
--      · 閘⑨宣稱「零權限」卻只查 SELECT(寫權、欄級權限、額外 grantee 全漏)。
--      ⇒ 📌 **「釘定義不要只驗存在」這句話我寫在這一節的標題上, 而下面十格有五格沒有照做。**
--      ⇒ ⇒ 🎯 **一個正確的原則寫在正上方, 擋不住底下的實作只做了一半 —— 而它讀起來完全一致。**
--    ✅ **改法:每一格都與【正本的字面】逐字比對, 不合就把兩邊都印出來。**
--      正本字面來源同檔頭那四發 + 2026-09-02 20:0x 那發 ACL。
DO $$
DECLARE
  v_got text; v_want text; v_rel text;
  -- 🔴🔴 **這個常數不是為了漂亮, 是為了不騙一把掃描器。**
  --    `scripts/null-shortcircuit-check-guard.test.ts` 直接讀 migration 原文找 `CHECK (`,
  --    它**剝註解、但不剝 SQL 字串** ⇒ 下面那些「期待值字串」裡的 `CHECK ((…OR…)` 會被它
  --    讀成【一條真的、而且沒有名字的 OR 串 CHECK】⇒ 它當場紅, 而紅的是一個不存在的東西。
  --    ⇒ 📌 **與今晚另一次同一個母題**(一段註解裡的 `CREATE OR REPLACE VIEW` 被別的守門
  --      數成第四個候選)—— **一把讀原文的尺, 分不出【一條 CHECK】與【一段在描述 CHECK 的字】。**
  --    ⇒ ✅ 把 `CHECK ` 拆出來當常數 ⇒ 字面上不再有 `CHECK (` 這個相鄰形狀。
  --    🛑 **而這是遷就量具, 不是修好量具** —— 真正的修法是讓那把尺剝掉 SQL 字串,
  --      而那要動別人的守門檔 ⇒ 不在本片範圍。**寫下來, 免得下一個人以為這是風格。**
  k constant text := 'CHECK ';
  -- 🔴 這份清單同時是 `scripts/migration-static-checks.sh` 規則③要的「收權斷言清單」。
  --    它防的是【忘記收權】, 不防【忘記列】⇒ 新增可授權物件時這裡要同步加。
  v_relations text[] := ARRAY[
    'public.product_fitments_effective_staging',
    'public.product_fitments_effective_sync_log'
  ]::text[];
BEGIN
  -- ① 欄:名字 + 順序 + 型別 + 可空 + 預設 + 是不是 identity ⇒ 五個維度一起釘
  --    🔵 `column_default` 對 identity 欄是 NULL ⇒ 用 '-' 佔位, 才看得出「預設被加上去了」。
  SELECT string_agg(column_name || '|' || data_type || '|' || is_nullable || '|' ||
                    coalesce(column_default, '-') || '|' || is_identity || '|' ||
                    -- 🔴 codex R2:少了這三格, `ALWAYS`→`BY DEFAULT`、text→domain、加 COLLATE
                    --    三種改動都會**全綠** —— 而它們都會改變行為。
                    coalesce(identity_generation, '-') || '|' ||
                    coalesce(domain_name, '-') || '|' || coalesce(collation_name, '-'),
                    ',' ORDER BY ordinal_position)
    INTO v_got FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'product_fitments_effective_staging';
  v_want := 'id|bigint|NO|-|YES|ALWAYS|-|-,product_id|uuid|NO|-|NO|-|-|-,'
         || 'moto_brand|text|NO|-|NO|-|-|-,model_code|text|NO|-|NO|-|-|-,'
         || 'year_start|integer|YES|-|NO|-|-|-,year_end|integer|YES|-|NO|-|-|-,'
         || 'match_source|text|NO|-|NO|-|-|-,source_model_code|text|NO|-|NO|-|-|-,'
         || 'run_id|uuid|NO|-|NO|-|-|-';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘①:staging 欄形狀與正本不符 ||正本|| % ||實得|| %', v_want, v_got;
  END IF;

  -- ② sync_log 同上。🔵 `ran_at` 的預設 `now()` 是正本上有的, 少了它每一列的時間會是 NULL。
  SELECT string_agg(column_name || '|' || data_type || '|' || is_nullable || '|' ||
                    coalesce(column_default, '-') || '|' || is_identity || '|' ||
                    -- 🔴 codex R2:少了這三格, `ALWAYS`→`BY DEFAULT`、text→domain、加 COLLATE
                    --    三種改動都會**全綠** —— 而它們都會改變行為。
                    coalesce(identity_generation, '-') || '|' ||
                    coalesce(domain_name, '-') || '|' || coalesce(collation_name, '-'),
                    ',' ORDER BY ordinal_position)
    INTO v_got FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'product_fitments_effective_sync_log';
  v_want := 'id|bigint|NO|-|YES|ALWAYS|-|-,ran_at|timestamp with time zone|NO|now()|NO|-|-|-,'
         || 'status|text|NO|-|NO|-|-|-,source_rows|integer|YES|-|NO|-|-|-,'
         || 'staged_rows|integer|YES|-|NO|-|-|-,orphan_rows|integer|YES|-|NO|-|-|-,'
         || 'old_count|integer|YES|-|NO|-|-|-,new_count|integer|YES|-|NO|-|-|-,'
         || 'note|text|YES|-|NO|-|-|-,run_id|uuid|YES|-|NO|-|-|-';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘②:sync_log 欄形狀與正本不符 ||正本|| % ||實得|| %', v_want, v_got;
  END IF;

  -- ③ 約束:**逐條釘 `pg_get_constraintdef` 的字面**, 不是數幾條。
  --    🔴 舊版只數「CHECK 有 5 條」⇒ 把其中一條改成 `CHECK (true)` 它照樣綠。
  --    🔵 這裡把 FK 也一起釘(舊閘⑤只問「有沒有指向 products 的 FK」⇒ 欄位與 ON DELETE 都沒問)。
  SELECT string_agg(conname || ' ' || pg_catalog.pg_get_constraintdef(oid), chr(10) ORDER BY conname)
    INTO v_got FROM pg_catalog.pg_constraint
   -- 🔴 codex R2:原本只收 c/f ⇒ 把具名 PRIMARY KEY 改成同名 UNIQUE, `indexdef` 相同、兩閘全綠。
   WHERE conrelid = 'public.product_fitments_effective_staging'::regclass AND contype IN ('c','f','p','u');
  v_want :=
    'pfes_match_source_valid ' || k || '((match_source = ANY (ARRAY[''direct''::text, ''inherited''::text])))' || chr(10) ||
    'pfes_nonblank_valid ' || k || '(((btrim(moto_brand) <> ''''::text) AND (btrim(model_code) <> ''''::text) AND (btrim(source_model_code) <> ''''::text)))' || chr(10) ||
    'pfes_provenance_valid ' || k || '((((match_source = ''direct''::text) AND (source_model_code = model_code)) OR ((match_source = ''inherited''::text) AND (source_model_code <> model_code))))' || chr(10) ||
    'pfes_year_interval_valid ' || k || '(((year_start IS NULL) OR (year_end IS NULL) OR (year_end >= year_start)))' || chr(10) ||
    'pfes_year_state_valid ' || k || '(((year_start IS NOT NULL) OR (year_end IS NULL)))' || chr(10) ||
    'product_fitments_effective_staging_pkey PRIMARY KEY (id)' || chr(10) ||
    'product_fitments_effective_staging_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘③:staging 的 CHECK/FK 定義與正本不符 ||正本|| % ||實得|| %', v_want, v_got;
  END IF;

  -- ④ sync_log 的那條 status CHECK
  SELECT string_agg(conname || ' ' || pg_catalog.pg_get_constraintdef(oid), chr(10) ORDER BY conname)
    INTO v_got FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.product_fitments_effective_sync_log'::regclass AND contype IN ('c','f','p','u');
  v_want := 'product_fitments_effective_sync_log_pkey PRIMARY KEY (id)' || chr(10) ||
            'product_fitments_effective_sync_log_status_check ' || k || '((status = ANY (ARRAY[''success''::text, ''abort''::text])))';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘④:sync_log 的 CHECK 定義與正本不符 ||正本|| % ||實得|| %', v_want, v_got;
  END IF;

  -- ⑤ 索引:釘 `pg_get_indexdef` 全文(schema / 所屬表 / 欄序 / NULLS NOT DISTINCT 一次全在裡面)
  --    🔴 舊閘⑥只 `strpos` 找 'NULLS NOT DISTINCT' ⇒ 欄序被換掉照樣綠。
  SELECT string_agg(indexdef, chr(10) ORDER BY indexname)
    INTO v_got FROM pg_catalog.pg_indexes
   WHERE schemaname = 'public'
     AND tablename IN ('product_fitments_effective_staging', 'product_fitments_effective_sync_log');
  v_want :=
    'CREATE UNIQUE INDEX product_fitments_effective_staging_pkey ON public.product_fitments_effective_staging USING btree (id)' || chr(10) ||
    'CREATE UNIQUE INDEX product_fitments_effective_sync_log_pkey ON public.product_fitments_effective_sync_log USING btree (id)' || chr(10) ||
    'CREATE UNIQUE INDEX ux_pfes_row ON public.product_fitments_effective_staging USING btree (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘⑤:索引定義與正本不符 ||正本|| % ||實得|| %', v_want, v_got;
  END IF;

  -- ⑥ RLS 開著, 而 policy 必須是 0(正本如此 —— 補了反而不對)
  -- 🔴 codex R2:少了 `relforcerowsecurity` ⇒ `FORCE ROW LEVEL SECURITY` 被打開也全綠,
  --    而它改變的是【owner 自己受不受 RLS 管】。
  SELECT string_agg(c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|' ||
                    (SELECT count(*) FROM pg_catalog.pg_policies pp
                      WHERE pp.schemaname = 'public' AND pp.tablename = c.relname)::text,
                    ',' ORDER BY c.relname)
    INTO v_got FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.product_fitments_effective_staging'::regclass,
                   'public.product_fitments_effective_sync_log'::regclass);
  v_want := 'product_fitments_effective_staging|true|false|0,product_fitments_effective_sync_log|true|false|0';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘⑥:RLS 開關或 policy 數與正本不符(正本:兩張都開、各 0 條) ||正本|| % ||實得|| %', v_want, v_got;
  END IF;

  -- ⑦ 表的 ACL:**讀 `relacl` 逐個 grantee 比對**, 不是問「某個角色有沒有 SELECT」。
  --    🔴 舊閘⑨只查 SELECT ⇒ 「anon 沒有 SELECT 但有 INSERT」它印綠;額外 grantee 也完全看不到。
  --    🔵 排除 owner(`postgres`):PG17 的 owner 隱含權限含 MAINTAIN 而 Supabase 那側未必
  --       ⇒ 把 owner 那列釘死會變成跨版本假紅。**正本裡有意義的是【非 owner 的那幾列】。**
  --    ⚠️ `aclexplode` 對 PUBLIC 給的 grantee 是 oid 0, 而 `pg_roles` 沒有 0
  --       ⇒ **內部 JOIN 會把它靜靜丟掉** ⇒ 這裡用 LEFT JOIN + coalesce(已知坑)。
  FOREACH v_rel IN ARRAY v_relations LOOP
    -- 🔴 codex R2 三格, 一起修:
    --   ① 原本排除的是**名字** `postgres` ⇒ owner 換人就釘不到, 而一個【非 owner 的 postgres】
    --      額外拿到權限反而被靜靜忽略。⇒ 改成排除 `c.relowner`(那才是「owner 的隱含權限」)。
    --   ② `aclexplode` 有 `is_grantable` 而我丟掉了 ⇒ 有人拿到 WITH GRANT OPTION 時輸出相同。
    --   ③ **`relacl` 完全看不到欄級授權** ⇒ `GRANT SELECT(moto_brand) TO anon` 不改 relacl
    --      ⇒ 匿名讀得到一整欄, 而這一格印綠。(同一個坑 memory 記過:`has_*_privilege` 對欄級少報。)
    SELECT coalesce(string_agg(g || '=' || pv, ',' ORDER BY g, pv), '(空)')
      INTO v_got
      FROM (SELECT coalesce(r.rolname, 'PUBLIC') AS g,
                   a.privilege_type || CASE WHEN a.is_grantable THEN '(可轉授)' ELSE '' END AS pv
              FROM pg_catalog.pg_class c,
                   pg_catalog.aclexplode(c.relacl) a
              LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
             WHERE c.oid = v_rel::regclass
               AND a.grantee <> c.relowner) q;
    v_want := 'pcm_readonly=SELECT,service_role=DELETE,service_role=INSERT,service_role=REFERENCES,'
           || 'service_role=SELECT,service_role=TRIGGER,service_role=TRUNCATE,service_role=UPDATE';
    IF v_got IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION '事後閘⑦:% 的表 ACL 與正本不符(已排除 owner 自己的隱含權限) ||正本|| % ||實得|| %',
        v_rel, v_want, v_got;
    END IF;

    -- ⑦b 欄級授權:正本上沒有任何欄級 GRANT ⇒ 這裡必須是空的
    SELECT coalesce(string_agg(att.attname || ':' || coalesce(rr.rolname, 'PUBLIC') || '=' || aa.privilege_type,
                               ',' ORDER BY att.attname), '(空)')
      INTO v_got
      FROM pg_catalog.pg_attribute att,
           pg_catalog.aclexplode(att.attacl) aa
      LEFT JOIN pg_catalog.pg_roles rr ON rr.oid = aa.grantee
     WHERE att.attrelid = v_rel::regclass AND att.attnum > 0 AND NOT att.attisdropped;
    IF v_got IS DISTINCT FROM '(空)' THEN
      RAISE EXCEPTION '事後閘⑦b:% 上有【欄級】授權, 而正本沒有 ⇒ relacl 看不到它 ||實得|| %', v_rel, v_got;
    END IF;
  END LOOP;

  -- ⑧ schema USAGE:**`has_table_privilege` 在缺 schema USAGE 時照樣印 true**(codex 抓)
  --    ⇒ 一個「有 SELECT」的角色仍然會死在 `permission denied for schema public`。
  --    ⇒ 📌 兩個世界(能讀 / 讀得到權限位元但進不了 schema)在表層 ACL 上長得一樣。
  IF NOT pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('pcm_readonly', 'public', 'USAGE') THEN
    RAISE EXCEPTION '事後閘⑧:service_role/pcm_readonly 對 schema public 沒有 USAGE ⇒ 表上的 SELECT 是空的';
  END IF;

  -- ⑨ identity sequence 的 ACL(這一格【沒有正本】—— 見 3.5 節末段)
  -- 🔴 codex R3 兩格:① 排除 owner 之後, **owner 自己缺了那三格也會被藏掉**
  --    (owner 可以自己 REVOKE, global default ACL 也能改掉建立時的權限)
  --    ② 排除的是 `relowner` 而**沒有驗那個 owner 是誰** ⇒ 用別的角色重放時, 非正式庫的 owner 被直接藏掉。
  --    ⇒ 兩格一起補:先釘 owner 的名字與它那三格, 再比非 owner 的部分。
  FOR v_rel IN
    SELECT unnest(ARRAY[
      pg_catalog.pg_get_serial_sequence('public.product_fitments_effective_staging',  'id'),
      pg_catalog.pg_get_serial_sequence('public.product_fitments_effective_sync_log', 'id')])
  LOOP
    SELECT pg_catalog.pg_get_userbyid(relowner) INTO v_got
      FROM pg_catalog.pg_class WHERE oid = v_rel::regclass;
    IF v_got IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '事後閘⑨a:% 的 owner 是 %, 而正本上是 postgres ⇒ 下面「排除 owner」那一步會藏掉一個我們沒預期的角色', v_rel, v_got;
    END IF;
    SELECT coalesce(string_agg(a.privilege_type, ',' ORDER BY a.privilege_type), '(空)')
      INTO v_got
      FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = v_rel::regclass AND a.grantee = c.relowner;
    IF v_got IS DISTINCT FROM 'SELECT,UPDATE,USAGE' THEN
      RAISE EXCEPTION '事後閘⑨b:% 的 owner 不是正本那三格(SELECT,UPDATE,USAGE)⇒ 實得 %', v_rel, v_got;
    END IF;
  END LOOP;

  SELECT coalesce(string_agg(g || '=' || pv, ',' ORDER BY s, g, pv), '(空)')
    INTO v_got
    FROM (SELECT sq AS s, coalesce(r.rolname, 'PUBLIC') AS g,
                 -- 🔴 codex R3:閘⑦ 已經帶 is_grantable 而這裡當時漏了 —— 同一條 finding 我只修了它點名的那處。
                 a.privilege_type || CASE WHEN a.is_grantable THEN '(可轉授)' ELSE '' END AS pv
            FROM unnest(ARRAY[
                   pg_catalog.pg_get_serial_sequence('public.product_fitments_effective_staging',  'id'),
                   pg_catalog.pg_get_serial_sequence('public.product_fitments_effective_sync_log', 'id')]) AS sq,
                 pg_catalog.pg_class c,
                 pg_catalog.aclexplode(c.relacl) a
            LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
           -- 🔴 排除 owner 用 `c.relowner` 不是名字 `postgres` —— 閘⑦ 已經改了而這裡當時漏掉,
           --    ⇒ 📌 **同一條 codex finding, 我只修了它點名的那一處。**
           --      而 owner 的隱含權限本來就不該進比對(正本上那三格是 owner 自動拿的, 不是誰給的)。
             WHERE c.oid = sq::regclass
               AND a.grantee <> c.relowner) q2;
  v_want := 'service_role=SELECT,service_role=UPDATE,service_role=USAGE,'
         || 'service_role=SELECT,service_role=UPDATE,service_role=USAGE';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘⑨:兩支 identity sequence 的 ACL 與正本不符(已排除 owner) ||正本|| % ||實得|| %',
      v_want, v_got;
  END IF;

  -- 🛑🛑 **一格【我沒有解掉】, 而它是 codex R1 與 R2 互相拉扯的那一格 —— 寫下來給下一個人:**
  --    R1 說「你只釘了名字, 要釘定義」⇒ 我改成逐字比 `pg_get_constraintdef` / `pg_get_indexdef`。
  --    R2 說「那是**反編譯結果不是穩定原文**」⇒ PG 版本或反編譯格式一變, **相同的 DDL 會假紅**。
  --    🎯 **兩句都對, 而它們指相反的方向** ⇒ 這不是可以再修一輪修掉的東西, 是一個取捨:
  --      **釘鬆 ⇒ DDL 被改壞而不叫(漏報);釘緊 ⇒ 換個 PG 版本就叫(誤報)。**
  --    ✅ **我選誤報那一邊**, 理由:本支 **never-apply**, 它只在我們自己的重放庫上跑
  --      ⇒ 假紅的代價是「一個人花十分鐘看訊息」, 而漏報的代價是「版控那份與正式庫不同而沒有人知道」
  --      ⇒ 而本支存在的**唯一理由**就是防後者。
  --    ⚠️ **而誤報的訊息必須自己說得出這件事** ⇒ 上面每一格失敗時都把【正本】與【實得】兩串一起印,
  --      讀的人可以當場看出「差的只是括號/空白」還是「真的變成別的東西」。
  RAISE NOTICE '事後閘通過(九格, 每一格都比【定義字面】不是【存不存在】):①②兩表欄形狀含型別/預設/identity ③staging 五條 CHECK + FK 的 constraintdef 全文 ④sync_log 的 CHECK 全文 ⑤三個索引的 indexdef 全文(含 NULLS NOT DISTINCT 與欄序)⑥RLS 開著且各 0 policy ⑦表 ACL 逐 grantee 比正本(已排除 owner)⑧schema USAGE ⑨sequence ACL。🛑 **它們證不到的**:(a)本支是空庫重放用的 ⇒ 它證的是「重放出來的形狀對」, **不證正式庫今天長這樣**(正本是 2026-09-02 那一刻的快照);(b)`NULLS NOT DISTINCT` 是 PG15+ 語法 ⇒ 更舊的 PG 上本支【建不起來】, 那是環境不是碼;(c)本檔**不驗**任何呼叫端 —— 那三支函式在別支 migration;(d)✅ **第⑨格今天也有正本了**(2026-09-02 21:0x)⇒ 五節全部有正本、同一天同一個人跑的;而它證的仍然只是【我抄對了】, 不證正式庫明天還是這樣。';
END
$$;
COMMIT;
