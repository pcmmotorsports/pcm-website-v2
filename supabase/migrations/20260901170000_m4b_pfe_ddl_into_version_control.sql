-- ============================================================
-- product_fitments_effective:把【已經在正式庫上的】那張表補進版控
-- ------------------------------------------------------------
-- 🔴🔴🔴 **本支【不 apply 到正式庫】。它是空庫重放用的。**
--    正式庫上那張表**已經存在**(2026-09-01 唯讀實查:relkind=r、RLS 開著)
--    ⇒ 本支在那裡跑會 **ERROR: relation "product_fitments_effective" already exists**
--      —— 而整支包在 `BEGIN … COMMIT` 裡 ⇒ **交易回捲、零改動, 而且它會出聲。**
--    ⇒ 📌 **那是刻意的**:一支「補版控」的檔在正式庫上**沒有事情可做**,
--      而【安靜地什麼都不做】與【做了而我不知道】在事後長得一樣。**所以它選擇出聲。**
--    🛑 **⇒ 不要把它放進「要 Sean 貼」的那一疊。**
--    ⚠️ **而帳本那一格是開著的**:`supabase/APPLIED.tsv` **沒有【刻意不 apply】這個態**
--      (四欄 = 版本號 / 檔案 sha256 / apply 日期 / 由誰記;一列在上面只代表「有人記過 apply」,
--       而該檔自己第 13-20 行寫著「不在本表上 ⇒ 什麼都不代表」)。
--      而 `scripts/migration-ledger-divergence.sh` 的八種組合裡, 本支落在
--      **④ `R H̄ P̄` =「待套 PENDING(正常, 還沒 apply)」⇒ ok**(不擋 pre-push)
--      ⇒ 🔴 **它不會卡住任何人, 而它會被【叫成 PENDING】—— 一個【永遠不會被套】的東西
--        掛在一個寫著「還沒」的態底下。**見板 `⟦b4-LEDGERNOAPPLY1⟧`。
--
-- 🔴🔴 本支的用途不是建它, 是補版控。
--
-- 🛑🛑 而【它沒有解掉從零重放】—— 這一句不要只讀過去:
--    本支的版號是 `20260901170000`, 而**第一個讀這張表的 migration 是 `20260712183000`**
--    (`20260712183000_products_catalog_page_public.sql`;讀它的共 11 支)。
--    ⇒ 從零重放時, 建表跑在【第 11 個讀它的人之後】⇒ **一樣炸。**
--    ⇒ 📌 **要真的解掉, 版號必須插到 2026-07-12 之前 —— 而那會動 `APPLIED.tsv` 帳本
--      (一支【號碼在過去而 apply 在今天】的 migration), 那是 Sean 的成本, 不是這支檔能決定的。**
--    ⇒ ⇒ **那件事記在板 `⟦b4-PFEREPLAY1⟧`(標【等 Sean】), 不是只記在這裡** ——
--      因為**查「我們能不能從零重建」的人不會來打開這支檔**, 而那正是這件事一開始被埋起來的方式。
--
-- 病:`product_fitments_effective` 在正式庫上是一張真表(relkind=r、RLS 開著),
--    而 repo 的 migration 裡**沒有任何一支建它**
--    (尺:`create table [if not exists] [public.]<名>`, 只吃 git 追蹤的 258 支;
--     🟢 正對照 orders ⇒ 2 支、product_fitments ⇒ 1 支、products ⇒ 1 支;🔵 負對照 zzq_no_such_table ⇒ 0)。
--
-- 🔴🔴 而【洞不只這一張】(2026-09-01 線【出貨】重量, codex R1 MF6 逼出來的):
--      product_fitments_effective            ⇒ 0   ← 本支補的
--      product_fitments_effective_staging    ⇒ 0   🔴 而有 2 支 migration 在讀它
--      product_fitments_effective_sync_log   ⇒ 0   🔴 而**後台首頁那行車搜新鮮度灰字在讀它**(員工每天看得到)
--      product_fitments                      ⇒ 1   ✅ 有
--    ⇒ 🛑 **本支只補三分之一。**另外兩張見板 `⟦b4-PFEDDL2⟧`。
--    ⚠️ **而第一次量的時候我拿到的是 `1`** —— 磁碟上的分母含了【本支自己】。
--       ⇒ 📌 一把用來證明「這個洞存在」的尺, 它的分母裡有那個洞的補丁。**改吃 git 追蹤檔才對。**
--
-- 🔴🔴 本支【對既有資料庫零改動】—— 這是 codex R2 finding 1/7 之後的設計, 不是巧合:
--    表已經存在 ⇒ 本支只做**唯讀驗證**, 不建索引、不重建 policy、不動任何 GRANT/REVOKE。
--    ⇒ 📌 理由是【誰在貼它】:這支檔要 Sean 親手貼進 SQL Editor,
--      而他讀到的標題是「**補版控**」⇒ **一個會改變正式庫權限的動作, 不可以掛在一個說自己不改東西的標題底下。**
--    ⇒ ⇒ 那不只是審查衛生, 那是【對使用者的字面 vs 事實】。
--    ⛔ ~~原本第 5 節對 identity sequence 下 REVOKE~~ ⇒ **已整段移出**, 見板 `⟦b4-SEQACL1⟧`。
--    ⛔ ~~原檔頭「apply 也只影響新建的庫」~~ ⇒ **那句是假的**:實測同一支對兩個起點產生兩個終態
--       (空庫 `service_role=rU` / 既有庫 `service_role=rwU`, 因為 REVOKE 沒對 service_role 下)。
--       ⇒ 🔵 **而那句話現在【整個不需要了】** —— 本支用裸 `CREATE TABLE`,
--         表已存在就當場 ERROR、交易回捲 ⇒ **零改動是物理保證, 不是一段條件式。**
--         ⛔ ~~原本靠一個交易內 GUC 旗標 `pcm.pfe_preexisting` 決定要不要跳過~~ 已整段移除。
--
-- 來源:2026-09-01 唯讀正式庫 `pg_catalog` 原文
--    (`~/pcm-mailbox/正式庫實查-product_fitments_effective-DDL-20260901.md`, 含它的第 6 節補量),
--    欄位 / 約束名 / 索引結構 / 表 ACL / policy 的 `polroles`+`polpermissive`
--    **由線【出貨】2026-09-01 17:3x 獨立複量過**(不同 session、自己下的查詢), 與該檔相同。
--
-- 🛑 這支【沒有量到】什麼 —— 逐格列出, 而**這份清單自己未經窮舉**:
--    ⚠️ **它列的是【我想到的】, 不是【全部】**(codex R2 finding 9:
--       一份自稱不完整的清單, 沒有人會去查它還缺什麼 ⇒ 這一句是那個病的解藥)。
--      · COMMENT / trigger / 誰在寫它
--      · table 與 sequence 的 owner · `relforcerowsecurity` · persistence · partition
--        · reloptions · tablespace · replica identity
--      · sequence 的 start / increment / min / max / cache / cycle
--      · index 的 opclass / collation / 排序方向(valid / ready / live / partial / nulls-not-distinct
--        這五格**有**進下面那道守門)
--      · 【還有沒有別種物件也在漂】(函式 / view / 型別)—— 本支只問了表與 sequence
-- ============================================================

BEGIN;

-- codex R2 finding 3:非 CONCURRENTLY 的索引建置會擋住 INSERT/UPDATE/DELETE。
-- 本支在既有庫上不建索引(見下面那道閘), 而萬一有人在別的情境跑它, 卡住要自己鬆手而不是拖著。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';


-- ── 1. 表(欄序、型別、NOT NULL、identity 全部照實查) ────────────────
-- 🔴 裸 `CREATE TABLE`(不是 `IF NOT EXISTS`)—— 見檔頭第一段:表已存在 ⇒ 當場 ERROR、交易回捲。
CREATE TABLE public.product_fitments_effective (
  id                bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid    NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  moto_brand        text    NOT NULL,
  model_code        text    NOT NULL,
  year_start        integer,
  year_end          integer,
  match_source      text    NOT NULL,
  source_model_code text    NOT NULL,

  -- 🔴 五條 CHECK 的【名字】要照抄 —— 約束名進得了錯誤訊息, 而別處可能用名字引用它。
  CONSTRAINT pfe_match_source_valid
    CHECK (match_source = ANY (ARRAY['direct'::text, 'inherited'::text])),
  CONSTRAINT pfe_nonblank_valid
    CHECK (btrim(moto_brand) <> '' AND btrim(model_code) <> '' AND btrim(source_model_code) <> ''),
  CONSTRAINT pfe_provenance_valid
    CHECK ((match_source = 'direct'    AND source_model_code =  model_code)
        OR (match_source = 'inherited' AND source_model_code <> model_code)),
  CONSTRAINT pfe_year_interval_valid
    CHECK (year_start IS NULL OR year_end IS NULL OR year_end >= year_start),
  CONSTRAINT pfe_year_state_valid
    CHECK (year_start IS NOT NULL OR year_end IS NULL)
);


-- ── 2. 索引 · policy · 權限(全部【字面語句】, 不包在 EXECUTE 字串裡)──────
-- 🔵 原本這一整段包在一個 `DO … EXECUTE` 裡, 為了「表已存在就整段跳過」。
--    改成裸 `CREATE TABLE` 之後那個需求消失了(表存在就先炸在第 1 節)⇒ 全部攤平。
-- 🔴 **而攤平順帶解掉一件我自己造的事**:包在字串裡的 `GRANT`
--    讓 `scripts/acl-drift-gate.py` 的 R6 只能印「未判」、`migration-static-checks` 規則④ 也看不到
--    ⇒ 我當時寫了 `ACL-GATE-EXEMPT: *` 讓它閉嘴, **而那一行的意思是「以後沒有任何東西在看這幾行」。**
--    ⇒ 📌 **現在不需要那一行了。**而那是今天第三次撞同一個機制:
--      **任何按字面判的尺, 對包進字串的東西恆印 0。**(另兩次見板 `⟦b4-SEQACL1⟧`)

-- 🔴🔴 `NULLS NOT DISTINCT` 不能漏 —— year_start / year_end 可為 NULL,
--    預設的 NULLS DISTINCT 會讓「兩列除了 NULL 年份以外完全相同」**都塞得進去**
--    ⇒ 漏掉這一格, 唯一性就不是同一個東西了(而它不會紅, 只是變寬)。
CREATE UNIQUE INDEX ux_pfe_row
  ON public.product_fitments_effective
  USING btree (product_id, moto_brand, model_code, year_start, year_end, match_source)
  NULLS NOT DISTINCT;

CREATE INDEX ix_pfe_lookup
  ON public.product_fitments_effective
  USING btree (moto_brand, model_code, year_start, year_end);

CREATE INDEX ix_pfe_product
  ON public.product_fitments_effective
  USING btree (product_id);

ALTER TABLE public.product_fitments_effective ENABLE ROW LEVEL SECURITY;

-- 🔵 `AS PERMISSIVE` 與 `TO public` **明寫**(codex R1 MF5):
--    2026-09-01 實查 `pg_policy` ⇒ `polpermissive = t` · `polroles = PUBLIC`(regrole 印 `{-}` = oid 0)
--    🟢 正對照 `orders_select_own` ⇒ `{authenticated}` ⇒ 這把尺分得出兩個世界, 不是每支都印 PUBLIC。
--    ⇒ 不寫也是同一個結果(PG 預設), **而不寫的時候讀的人分不出「量過」與「沒想過」。**
CREATE POLICY product_fitments_effective_select_public
  ON public.product_fitments_effective
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_fitments_effective.product_id
        AND p.delisted_at IS NULL
    )
  );

-- 照 `docs/patterns/revoking-function-execute-in-supabase.md`:
--   PUBLIC 那份與 anon/authenticated 具名那份是**兩件事**, 少一道都是開的。
REVOKE ALL PRIVILEGES ON TABLE public.product_fitments_effective FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.product_fitments_effective FROM anon, authenticated;

-- 🔵 `acl-drift-gate` 的 R3 會擋下一行, 而它擋對了 —— 它要的是【一個查得到的理由】。
--    這張表**就是**要給顧客站公開讀:實查正式庫 ACL = `anon=r/postgres` + `authenticated=r/postgres`,
--    而擋住下架商品的是 RLS policy(第 2 節);顧客站不繞 RLS
--    (`apps/storefront` 對 `service_role` 有 eslint 整片禁令 ADR-0005)。
--    ⚠️ 而那道閘自己的檔頭天花板 ① 逐字點名了這張表:它是【走 dashboard 手動 GRANT 進線上的三張之一】
--       ⇒ 📌 本支把它補進版控, 正好是在關那條路 —— **而那道閘結構上看不到那條路。**
-- ACL-GATE-EXEMPT: public.product_fitments_effective -- 顧客站車款搜尋公開讀, 實查 anon=r + RLS 擋下架 (2026-09-01, 板 b4-PFEDDL1)
GRANT SELECT ON TABLE public.product_fitments_effective TO anon, authenticated;

-- 🔴 codex R1 MF1:`service_role` 明寫, 不靠 Supabase 的 default privileges
--    (ADP 是【建表當下】那個角色的設定, 空庫重放時是誰在跑決定的, 不是我們決定的)。
-- 🔵 codex R2 finding 10(nit):**逐項列出而不用 `ALL`** —— `ALL` 會隨未來 PG 版本新增權限而擴張,
--    而本支的目標是【固定住那個 ACL 指紋】。實查 = `arwdDxtm` = 下面這八項。
--    🔴 而【明列】自己也會出錯:我第一版漏掉 `MAINTAIN` ⇒ 實跑量到 `service_role=arwdDxt`,
--       而正式庫是 `arwdDxtm` —— **少一個字母, 而 diff 上看不出來、也不會紅。**
--       ⇒ 📌 「用 `ALL` 會隨版本擴張」與「明列會漏」是**兩個相反方向的錯**;
--         換成明列不是把風險消掉, 是把它換成一個【今天就發生、而要跑一次才看得見】的錯。
--       ⇒ 抓到它的是實跑, 不是讀。
--    ⚠️ `MAINTAIN` 是 PostgreSQL 17 才有的權限 ⇒ 本支需要 PG17+(正式庫實查 17.6)。
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.product_fitments_effective TO service_role;

-- 🔴 `pcm_readonly` 實查 ACL 上有 `=r/postgres`, 而**沒有任何一支 migration 建這個角色**。
--    codex R1 MF3 / R2 finding 6:條件式跳過 ⇒ migration 仍被記成 applied ⇒ 這條 GRANT 永遠補不回。
--    🛑 **而那條【至今沒有機制】** —— `WARNING` 只是讓它出聲, 不是修好。
--       真正的修法是【建 `pcm_readonly` 的那支 migration 自己補這條 GRANT】, 而那支還不存在。
--    ⇒ 所以它記在板 `b4-PCMRO1`(log 會滾掉, 板子不會), 而不是靠這幾行。
DO $pfe_ro$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly') THEN
    GRANT SELECT ON TABLE public.product_fitments_effective TO pcm_readonly;
  ELSE
    RAISE WARNING
      'pcm_readonly 不存在 ⇒ 已跳過 GRANT SELECT ON public.product_fitments_effective。'
      '本 migration 仍會被記成 applied ⇒ 這條 ACL 不會自己補回來。'
      '建 pcm_readonly 的那支 migration 必須自己補 GRANT SELECT … TO pcm_readonly(板 b4-PCMRO1)。';
  END IF;
END
$pfe_ro$;


-- ── 3. 🔴 索引形狀守門(唯讀;兩條路都跑)────────────────────────────
-- 病(codex R1 MF4):`CREATE UNIQUE INDEX IF NOT EXISTS` 撞到一支【同名而定義不同】的既有索引時
--    **整句靜默跳過、不紅** ⇒ 一支缺了 `NULLS NOT DISTINCT` 的 ux_pfe_row 會活下來, 而本檔看起來完全成功。
--
-- 🔴 codex R2 finding 4/5 之後改寫過, 兩件事一起修:
--   ① ⛔ ~~比 `pg_indexes.indexdef` 的【字串】~~ ⇒ 那有四種假綠/假紅:
--        `indisvalid/indisready/indislive=false`(建到一半的索引, 定義文字完全正確)
--        · partial index(多一個 `WHERE`)· 另一張表的同名索引(用 `tablename` 查會跑零圈)
--        · opclass/collation/排序方向明寫時字串不同而語意相同 ⇒ 假紅
--      ✅ 改吃 `pg_index` 的**結構化欄位**, 並且用 `indrelid` 綁死是【這張表的】索引。
--   ② ⛔ ~~只守 `ux_pfe_row`~~ ⇒ 另外兩支完全沒守。**三支一起守。**
--      📌 那與「洞是三張表而我只補一張」是同一個形狀:**我修了會叫的那一個。**
--
-- 🛑 而這道守門【自己的天花板】, 寫在這裡:
--    · 它不驗 opclass / collation / 排序方向 —— 那三格仍然可以不同而它不叫
--    · 它靠索引【名字】找 ⇒ 一支形狀完全正確而叫別的名字的索引, 它看不到(而那也不會壞事)
--    · 它不驗 CHECK / FK / RLS 是否與實查一致 —— 只驗索引
DO $pfe_ix$
DECLARE
  r          record;
  v_cols     text;
  v_expect   text;
  v_found    int := 0;
  spec       text[][] := ARRAY[
    ['ux_pfe_row',     'product_id,moto_brand,model_code,year_start,year_end,match_source', 'unique_nnd'],
    ['ix_pfe_lookup',  'moto_brand,model_code,year_start,year_end',                          'plain'],
    ['ix_pfe_product', 'product_id',                                                         'plain']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(spec, 1) LOOP
    v_expect := spec[i][2];
    SELECT i2.indisvalid, i2.indisready, i2.indislive, i2.indisunique,
           i2.indnullsnotdistinct, (i2.indpred IS NOT NULL) AS is_partial,
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM unnest(i2.indkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i2.indrelid AND a.attnum = k.attnum) AS cols
      INTO r
      FROM pg_index i2
      JOIN pg_class ic ON ic.oid = i2.indexrelid
     WHERE i2.indrelid = 'public.product_fitments_effective'::regclass   -- 🔴 綁死是這張表的
       AND ic.relname  = spec[i][1];

    IF NOT FOUND THEN
      RAISE EXCEPTION '索引 % 不存在於 public.product_fitments_effective ⇒ 形狀不完整。', spec[i][1];
    END IF;
    v_found := v_found + 1;

    IF NOT (r.indisvalid AND r.indisready AND r.indislive) THEN
      RAISE EXCEPTION '索引 % 存在而【不是可用狀態】(valid=% ready=% live=%)⇒ 它不在守任何東西。',
        spec[i][1], r.indisvalid, r.indisready, r.indislive;
    END IF;
    IF r.is_partial THEN
      RAISE EXCEPTION '索引 % 是 partial(帶 WHERE)⇒ 它守的範圍比預期窄。', spec[i][1];
    END IF;
    IF r.cols IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION '索引 % 的欄序或欄集不同 ⇒ 它守的不是同一件事。實際 % / 預期 %',
        spec[i][1], r.cols, v_expect;
    END IF;
    IF spec[i][3] = 'unique_nnd' THEN
      IF NOT r.indisunique THEN
        RAISE EXCEPTION '索引 % 不是 UNIQUE ⇒ 唯一性根本不存在。', spec[i][1];
      END IF;
      IF NOT r.indnullsnotdistinct THEN
        RAISE EXCEPTION
          '索引 % 缺 NULLS NOT DISTINCT ⇒ 兩列除了 NULL 年份以外完全相同時【都塞得進去】。', spec[i][1];
      END IF;
    END IF;
  END LOOP;

  -- 🔴 而這一格是【守門自己的守門】:上面用的是 `NOT FOUND` 而不是迴圈次數,
  --    所以「跑零圈而全綠」那個形狀在這裡已經不可能。這一行把它變成可觀察的。
  IF v_found <> array_length(spec, 1) THEN
    RAISE EXCEPTION '索引守門只驗到 % 支, 而清單有 % 支 ⇒ 這道守門自己壞了。',
      v_found, array_length(spec, 1);
  END IF;
  RAISE NOTICE '索引守門:% 支全部通過(valid/ready/live · 非 partial · 欄序 · unique+NND)。', v_found;
END
$pfe_ix$;


-- ── 4. 🔴🔴 ACL 閉世界後置斷言(唯讀;兩條路都跑)──────────────────────────
-- **這一段是主視窗 2026-09-01 裁「甲」時附的條件, 而條件的理由是我自己犯的錯:**
--   ⛔ ~~第 2 節的 GRANT/REVOKE 包在 `EXECUTE` 字串裡(為了「既有庫零改動」)~~ **已改回字面語句**
--   ⇒ `scripts/acl-drift-gate.py` 的 R6 對動態 GRANT 只能印「未判」
--   ⛔ ~~我用 `ACL-GATE-EXEMPT: *` 讓它閉嘴~~ ⇒ 那一行**已刪**, 而它的意思本來是
--      「以後沒有任何東西在看那三行」。
--   ✅ **而這一節的條件仍然保留, 理由更硬了**:字面 `GRANT` 讓那道閘看得到【我寫了什麼】,
--      **而它看不到【跑完之後真的是什麼】** —— 兩者在「同一支檔後面再 GRANT 一次」時會分岔。
-- 🛑 **⇒ 我為了讓一道閘(既有庫零改動)成立, 把另一道閘(ACL 漂移)弄瞎了。**
--    **而那不是疏忽, 是兩道閘的要求互相衝突, 而我選了其中一個。**
-- ✅ **⇒ 所以看的人換成 migration 自己**:跑完之後用 `aclexplode` 驗實際 ACL,
--    對不上就 `RAISE` ⇒ 那一發 apply 當場紅。
-- 📌 **⇒ 而理由是主視窗那一句**:「寫在碼旁的代價, 三週後就是 `⟦b4-NONCARDPAID1⟧` 那個 `:77`」——
--    那一列的成因就是一句寫在碼旁的「不在本片可修」, 三週沒有人回來做。
--
-- 🛑 這道斷言【擋不住什麼】:
--    · 它驗的是 **apply 當下**那一刻的 ACL;apply 之後任何人在 dashboard 手動 GRANT, 它看不到
--      (那正是 acl-drift-gate 檔頭天花板 ① 的路⑤, 而這張表就是走那條路進線上的)
--    · 它不驗 sequence 的 ACL —— 那一格刻意留在板 ⟦b4-SEQACL1⟧, 本支不碰
DO $pfe_acl$
DECLARE
  -- 🔵 `v_relations` 這個名字是 `scripts/migration-static-checks.sh` 規則③ 認的形狀:
  --    它比「本檔建了幾個可授權物件」與「這張清單列了幾個」⇒ 對不上就紅。
  --    📌 那道規則防的是【忘記列】, 不是【忘記收權】—— 兩件事,
  --      而只有前者會讓後者變成假綠(收權斷言只檢查你列出來的物件)。
  v_relations text[] := ARRAY['public.product_fitments_effective']::text[];
  v_owner text;
  v_bad   text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_catalog.pg_class c WHERE c.oid = 'public.product_fitments_effective'::regclass;

  -- ① 閉世界:不准出現允許集合以外的 grantee, 也不准任何人帶 WITH GRANT OPTION
  SELECT pg_catalog.string_agg(DISTINCT y.who, ', ' ORDER BY y.who) INTO v_bad
    FROM (
      SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(g.grantee) END
             || CASE WHEN g.is_grantable THEN '(WITH GRANT OPTION)' ELSE '' END AS who
        FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) g
       WHERE c.oid = 'public.product_fitments_effective'::regclass
         AND (g.grantee = 0
              OR pg_catalog.pg_get_userbyid(g.grantee)
                 NOT IN (v_owner, 'service_role', 'anon', 'authenticated', 'pcm_readonly')
              OR g.is_grantable)
    ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'product_fitments_effective ACL 閉世界被打破(%)⇒ 出現允許集合外的 grantee, 或有人帶了 WITH GRANT OPTION',
      v_bad;
  END IF;

  -- ② anon / authenticated 只准有 SELECT —— 多一項就紅
  --    🔴 用 aclexplode 逐項比, 不用 has_table_privilege:後者對【欄級授權】少報(見
  --       docs/patterns/revoking-function-execute-in-supabase.md), 而少報的方向是「看起來沒有」。
  SELECT pg_catalog.string_agg(z.t, ', ' ORDER BY z.t) INTO v_bad
    FROM (
      SELECT pg_catalog.pg_get_userbyid(g.grantee) || ':' || g.privilege_type AS t
        FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) g
       WHERE c.oid = 'public.product_fitments_effective'::regclass
         AND pg_catalog.pg_get_userbyid(g.grantee) IN ('anon','authenticated')
         AND g.privilege_type <> 'SELECT'
    ) z;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon/authenticated 對 product_fitments_effective 拿到 SELECT 以外的權限(%)', v_bad;
  END IF;

  -- ③ 反向:anon 與 authenticated 必須【真的有】SELECT(顧客站車款搜尋靠它)
  --    🔴 少了這一格, ①② 在「兩個角色一個權限都沒有」的世界會全綠 —— 那是把功能關掉而不叫。
  IF NOT (pg_catalog.has_table_privilege('anon', 'public.product_fitments_effective', 'SELECT')
      AND pg_catalog.has_table_privilege('authenticated', 'public.product_fitments_effective', 'SELECT')) THEN
    RAISE EXCEPTION 'anon 或 authenticated 拿不到 SELECT ⇒ 顧客站車款搜尋會空掉';
  END IF;

  RAISE NOTICE 'ACL 閉世界斷言通過(owner=%, 允許集合 = owner/service_role/anon/authenticated/pcm_readonly)。', v_owner;
END
$pfe_acl$;

COMMIT;
