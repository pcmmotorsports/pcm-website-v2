-- D1t2:`product_fitments_effective` 的 DDL 快照 —— **rehearsal 隔離環境專用**。
--
-- 🔴 為什麼存在:這張表在 production 是完整資料表(148,716 列),但 supabase/migrations/
--    沒有任何一支建立它(backlog #299),而 4 支 migration 引用它、其中
--    `search_catalog_by_vehicle` 是 LANGUAGE sql、建立當下就解析 ⇒ 少了它,
--    migrations 一律卡在 2026-07-12(D1a6 實測 85 支只跑 54 支)。
-- 🔴 本檔**不是 #299 的解**:#299 要走正式 migration + 關卡2 對抗審查;本檔只讓
--    演練環境的 migration 鏈跑得完(0 列即可 —— 引用它的物件只需要 relation 存在)。
-- 來源:2026-07-29 production 唯讀 introspection(pg_attribute/pg_constraint/
--    pg_indexes/pg_policies/relacl 逐項)。
-- 🔴 定位 = **migration 相容性 stub**,不宣稱與 production 持續同步:無 schema
--    fingerprint 對帳,introspection 之後的 DDL 漂移這裡看不到(codex K2 nit)。
--    夠用的原因:演練只需要「migration 鏈解析得過」,不消費此表資料。
--    若日後 #299 落地,本檔應改為指向正式 migration 並刪除。
BEGIN;

CREATE TABLE public.product_fitments_effective (
  id bigint GENERATED ALWAYS AS IDENTITY,
  product_id uuid NOT NULL,
  moto_brand text NOT NULL,
  model_code text NOT NULL,
  year_start integer,
  year_end integer,
  match_source text NOT NULL,
  source_model_code text NOT NULL,
  CONSTRAINT product_fitments_effective_pkey PRIMARY KEY (id),
  CONSTRAINT product_fitments_effective_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT pfe_match_source_valid CHECK ((match_source = ANY (ARRAY['direct'::text, 'inherited'::text]))),
  CONSTRAINT pfe_nonblank_valid CHECK (((btrim(moto_brand) <> ''::text) AND (btrim(model_code) <> ''::text) AND (btrim(source_model_code) <> ''::text))),
  CONSTRAINT pfe_provenance_valid CHECK ((((match_source = 'direct'::text) AND (source_model_code = model_code)) OR ((match_source = 'inherited'::text) AND (source_model_code <> model_code)))),
  CONSTRAINT pfe_year_interval_valid CHECK (((year_start IS NULL) OR (year_end IS NULL) OR (year_end >= year_start))),
  CONSTRAINT pfe_year_state_valid CHECK (((year_start IS NOT NULL) OR (year_end IS NULL)))
);

CREATE UNIQUE INDEX ux_pfe_row ON public.product_fitments_effective
  USING btree (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT;
CREATE INDEX ix_pfe_lookup ON public.product_fitments_effective USING btree (moto_brand, model_code, year_start, year_end);
CREATE INDEX ix_pfe_product ON public.product_fitments_effective USING btree (product_id);

ALTER TABLE public.product_fitments_effective ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_fitments_effective_select_public ON public.product_fitments_effective
  FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_fitments_effective.product_id AND p.delisted_at IS NULL));

GRANT SELECT ON public.product_fitments_effective TO anon, authenticated;
GRANT ALL ON public.product_fitments_effective TO service_role;

-- ══ 🔴🔴 讓位機制(2026-09-01 線【出貨】`-0e` 加;主視窗 `-0a` 裁「乙:只改這一支檔」)══
--
-- 病:`20260901170000_m4b_pfe_ddl_into_version_control.sql` 把這張表的 DDL 補進版控了,
--    而它用**裸 `CREATE TABLE`**(那是 `scripts/migration-static-checks.sh` 規則① 要求的,
--    理由逐字:「撞名要當場紅…拿到綠燈, 而這支 migration 什麼都沒建」)。
--    ⇒ 而本檔在**第一個消費者之前**先建了同一張表
--    ⇒ ⇒ 迴圈跑到那支 migration ⇒ `relation already exists` ⇒ **整發 provision 死掉。**
--    🔴 **爆炸半徑實量(2026-09-01)**:會逐支套 `supabase/migrations/*.sql` 的腳本 **44 支**,
--      其中**自己也建這張表的 27 支**(26 支各自有一份 `for` 迴圈 / 1 支沒有)。
--      實跑證明:bootstrap rc=0 ⇒ 那支 migration rc=3、訊息 `relation … already exists`。
--
-- 🛑 **而【本檔不建這張表】不是選項** —— 那是主視窗原本裁的形狀, 而我實查之後它不成立:
--    第一個消費者 `20260712183000_products_catalog_page_public.sql:37` 的
--    `search_catalog_by_vehicle` 是 **`LANGUAGE sql`**(`:50` 逐字)⇒ 函式體在 `CREATE` 當下就被解析
--    ⇒ 表不存在就建不出來。**剝註解後真正引用它的 migration 有 9 支**(含 creator 10;
--    🔴 而含註解的尺會量到 12 —— 那正是 `migrations-replay-from-zero.sh` 修過的那個病)。
--    ⇒ ⇒ **所以 stub 是承重的, 拿掉它會讓 9 支 migration 建不起來。**
--
-- ✅ **⇒ 改成【讓位】**:stub 照建, 而當那支 migration 真的來建同一張表時, stub 自己退場。
--    🔵 為什麼放在這裡而不是改那 26 支迴圈:**那道閘不是單數, 它是 27 份各自的拷貝**
--      ⇒ 📌 **再把同一個判斷複製 26 份, 下一次還是 27 份。**
--
-- 🛑 這個機制的天花板, 逐條寫出來:
--    · 它靠 `current_query()` 比字面 ⇒ **同一個 batch 裡有別的 `CREATE TABLE` 而該 batch 文字
--      恰好含這張表的名字時, 會誤觸**。⇒ 所以它**開一次就自己拆掉**(下面 `DROP EVENT TRIGGER`),
--      把爆炸半徑釘在【至多一次】。
--    · 它只在**本檔跑過**的環境存在 ⇒ 正式庫、以及不用 stub 的重放路徑**都沒有它**。
--    · 它不驗 stub 與那支 migration 的形狀一不一樣 —— 兩者同源(本檔的 DDL 就是從那支抄的),
--      而**「同源」是人講的, 不是這裡驗的**。
CREATE FUNCTION public.pcm_fitments_stub_yield() RETURNS event_trigger
LANGUAGE plpgsql AS $stub$
BEGIN
  IF pg_catalog.current_query() ~* 'create[[:space:]]+table[[:space:]]+(public\.)?product_fitments_effective'
     AND pg_catalog.to_regclass('public.product_fitments_effective') IS NOT NULL THEN
    EXECUTE 'DROP TABLE public.product_fitments_effective CASCADE';
    -- 🔴 開一次就拆掉自己 —— 天花板那條「可能誤觸」靠這一行把半徑釘在至多一次。
    EXECUTE 'DROP EVENT TRIGGER IF EXISTS pcm_fitments_stub_yield_trg';
    EXECUTE 'DROP FUNCTION IF EXISTS public.pcm_fitments_stub_yield()';
    RAISE NOTICE 'D1t2 fitments stub 讓位:真正建表的 migration 來了, stub 與本讓位機制一起退場。';
  END IF;
END
$stub$;

CREATE EVENT TRIGGER pcm_fitments_stub_yield_trg ON ddl_command_start
  WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.pcm_fitments_stub_yield();

COMMIT;
