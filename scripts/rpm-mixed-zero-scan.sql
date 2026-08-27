-- rpm-mixed-zero-scan.sql   ·   M-4b `#934` 片A · Sean 2026-08-26 拍 `Q18 = 丙`
--
-- 🔴 這支【不會叫】。它要有人去跑,跑了才有答案。
--    🔴 措辭釘死(主視窗 2026-08-26):送達是【已排,未做】——**不是【不做】**。
--       不要把本檔寫成「一道會叫的閘」或「已加一道觀測」。
--    誰跑 / 何時跑(從 plan §2.0b 抄進來, 因為那份 plan 在 repo 外、信箱會被清):
--      誰跑    上贈品的人 / 做部署盤點的人 / 任何要動 rpm-* 的窗
--      何時跑  ① 報價單側要灌第一支贈品【之前】 ② 要動 rpm-transform 價格挑法【之前】
--              ③ milestone 收尾盤點
--      命中    🔴 當日開工片B, 不是記進 backlog 等
--      沒命中  把 measured_at + 數字寫進 backlog `#934`, 只寫「查過了」不算
--
-- 它回答什麼:來源資料裡有沒有【同一群內同時存在 0 元與正價變體】的商品?
--   有的話那件商品在顧客站的卡片價會變 `NT$ 0`(基準價 = 群內最低價,rpm-transform.ts:302-322)。
--
-- ⚠️ 精確講它掃的是【取整後為 0】,不是【欄位裡字面是 0】——
--    `0.4` 取整後也是 0,也會被抓(而那正是要抓的:它一樣會讓卡片印 NT$ 0)。
--
-- ── 2026-08-26 實跑值(跑在【報價單專案】那顆庫;measured_at=2026-08-26 02:44:37+00)──
--   ⚠️ 「跑在哪一顆庫」是我自己記的, 不是查詢印出來的 —— current_database() 兩顆都印 postgres。
--   mixed_zero_groups 0 · any_zero_groups 0 · null_price_groups 0 · negative_price_groups 0
--   groups_scanned 20,909 · canary_must_be_1 = 1 ✅ · neg_control_must_be_0 = 0 ✅
--   分母(查詢 0)rows_all 52,741 · rows_live 51,579 · rows_delisted 1,162
--                groups_fully_delisted 257 · skus_spanning_suppliers 27
--   🔴 這幾個數字綁著上面那個 db 與時刻。**答案跟著跑的那一刻走, 不跟著這個檔案走。**
--      來源下一分鐘多一支贈品, 這裡仍然寫 0 —— 所以要自己跑一次, 不要引用這幾行當現況。
--   ⚠️ 而「來源是 0」不等於「顧客站是 0」:見下面限制 A。

-- ── 跑法 ────────────────────────────────────────────────────────────────
--   整支貼進【報價單專案】的 Supabase SQL Editor 執行。唯讀 SELECT,零寫入、零 DDL。
--   那顆庫 = 匯入的來源。連線變數名 QUOTE_SUPABASE_URL / QUOTE_SUPABASE_PUBLISHABLE_KEY
--   (rpm-import.ts:152-155;此處只寫變數【名】,值在 .env.local、不進本檔)。
--
-- ── 為什麼掃這張 view(依據是碼,不是註解)──────────────────────────────
--   rpm-import.ts:152  const source = createClient(QUOTE_SUPABASE_URL, ...)
--   rpm-import.ts:165  fetchAllSupplierProducts(source, config.supplierSlug)
--     ⚠️ 量具與結論要對得上:`grep -n '(source' scripts/rpm-import.ts` 印的是【4 行】
--        (116 / 165 / 444 / 680, 其中三行是註解或字串)—— 不是 1 行。
--        而且那個 pattern 抓不到 `f(a, source)` 這種第二參數位置。
--        ⇒ 結論「source 只在 :165 被傳出去」是【開檔逐行看出來的】, 不是那發 grep 印出來的。
--   rpm-fetch.ts:130   export async function fetchAllSupplierProducts(src, ...)
--   rpm-fetch.ts:133     fetchPageWithRetry(src, from, supplierSlug)   ← 唯一呼叫處
--   rpm-fetch.ts:108   async function fetchPageWithRetry(src, ...)
--   rpm-fetch.ts:112     src.from('storefront_catalog_v')             ← 唯一一處
--   分母 `grep -h '\.from(' scripts/rpm-*.ts --exclude='*.test.ts' | wc -l` ⇒ 14;含測試檔 18。
--        ⚠️ 那 14 處是【1 處讀來源 view + 13 處打目標庫】——**不是「13 處是寫入」**:
--        13 處裡多數也是 select(rpm-load / rpm-delta / rpm-reconcile / rpm-preflight),
--        真正的寫只有 4 處。⇒ 引用時說「讀來源的只有 1 處」, 不要說「13 寫」。
--
-- ── 🔴 兩個【不對就會靜靜漏報】的地方, 本檔都對齊了匯入(codex 2026-08-26 抓到)────
--   ① 分群鍵 = (supplier_slug, main_sku), 不是只有 main_sku。
--      匯入一次跑一家(rpm-import.ts:165 帶 config.supplierSlug)⇒ 只用 main_sku 會把
--      不同家的同碼商品併成一群 ⇒ 造出【實際永遠不會同批出現】的假混群。
--      實測 2026-08-26:跨供應商的 main_sku = 27 個(下面查詢 0 可重跑)。
--   ② 整群已下架時【不可以濾掉】。rpm-transform.ts:286 逐字
--        `isFullyDelisted(variants) ? variants : variants.filter((v) => !v.delisted_at)`
--      ⇒ 整群下架時匯入【保留整群、照常算基準價】。
--      🔴 只寫 `where delisted_at is null` 會把這種群整群濾掉 ⇒ 真的混 0 群會被掃成 0。
--
-- ── 還沒解決、要知道的(不要因為它回 0 就以為這幾格也安全)──────────────
--   A. 🔴 它量【來源】, 不量【我們已經寫進去的結果】。
--      來源今天乾淨, 不代表目標庫裡沒有【上一次同步寫進去的 NT$0 商品】。
--      那個殘留本查詢完全看不到 —— 要查它得去網站正式庫, 而本窗無存取權。
--   B. 它是一個【時點】。答案跟著跑的那一刻走, 不跟著這個檔案走(所以下面要求把結果貼回板子)。
--   C. view 尾端 `_group_has_zh`:無中文名的群進不了這張 view。
--      ✅ 這條有落點且可重跑(2026-08-26 實跑):
--         select position('_group_has_zh' in pg_get_viewdef('storefront_catalog_v'::regclass,true))
--         ⇒ 340(正對照 'delisted_at' ⇒ 1077;負對照 'zzz_nothere_20260826' ⇒ 0)
--      而匯入也讀這張
--      ⇒ 那些群不會被同步進來 ⇒ 產不出 NT$0 卡片 ⇒ 對本查詢是【正確邊界】, 不是漏掉。
--      而它們哪天補上中文名就會一次湧進來。
--   D. 三發是三個獨立 statement, 沒有共同 snapshot。中間來源變了不會有人知道。
--   E. Postgres `round()` 與 TS `Math.round()` 對負數不一致(-0.5 ⇒ -1 vs -0)。
--      本檔把負價【排除在零那一側之外】並單獨計數 —— 負價不是贈品, 它由 isAbnormal 硬擋
--      (rpm-delta.ts:74)。🔴 拿本檔去問「負價有幾筆」要看 negative_price_groups 那一格。

-- ══ 查詢 0:分母(把檔頭那些數字變成【可重跑】, 不要只當宣稱)══════════════
-- 2026-08-26 深夜實跑值:52,741 / 51,579 / 1,162 / 20,909 / 257 / 27
select current_database() as db, now() as measured_at,
       count(*)                                            as rows_all,
       count(*) filter (where delisted_at is null)          as rows_live,
       count(*) filter (where delisted_at is not null)      as rows_delisted,
       count(distinct (supplier_slug, main_sku))            as groups_by_supplier_sku,
       (select count(*) from (
          select supplier_slug, main_sku from storefront_catalog_v
          group by supplier_slug, main_sku
          having bool_and(delisted_at is not null)) x)      as groups_fully_delisted,
       (select count(*) from (
          select main_sku from storefront_catalog_v
          group by main_sku having count(distinct supplier_slug) > 1) y)
                                                            as skus_spanning_suppliers
from storefront_catalog_v;

-- ══ 查詢 1:答案 + 對照(canary 讓【零述詞】自己表演一次)════════════════
-- 🔴 canary 是一組灌進來的假資料:一群裡放 0 與 5000。
--    它【必須】被抓到。抓不到 ⇒ 這把尺對「零」這個述詞是瞎的, 那個 0 不算數。
--    (上一版拿「以 1000 為界的混群」當正對照 —— codex 指出那驗的是【另一個述詞】, 不算。)
with src as (
  select supplier_slug, main_sku, price_retail, delisted_at from storefront_catalog_v
  union all
  select 'zzz-canary-20260826', 'CANARY-MIXED', v, null::timestamptz
    from (values (0::numeric(10,2)), (5000::numeric(10,2))) t(v)
), g as (
  select supplier_slug, main_sku,
         bool_or(delisted_at is null)                                              as has_live,
         bool_or(round(price_retail) = 0 and price_retail >= 0)
           filter (where delisted_at is null)                                      as live_zero,
         bool_or(round(price_retail) > 0) filter (where delisted_at is null)        as live_pos,
         bool_or(round(price_retail) = 0 and price_retail >= 0)                     as all_zero,
         bool_or(round(price_retail) > 0)                                           as all_pos,
         bool_or(price_retail is null)                                              as any_null,
         bool_or(price_retail < 0)                                                  as any_neg
  from src group by supplier_slug, main_sku
), e as (
  -- 對齊 rpm-transform.ts:286 的 liveVariantsOf:整群下架時【用整群】, 否則只用未下架的
  select supplier_slug, main_sku, any_null, any_neg,
         case when has_live then live_zero else all_zero end as zero_side,
         case when has_live then live_pos  else all_pos  end as pos_side
  from g
)
select current_database() as db, now() as measured_at,
       count(*) filter (where zero_side and pos_side
                          and supplier_slug is distinct from 'zzz-canary-20260826')  as mixed_zero_groups,
       count(*) filter (where zero_side
                          and supplier_slug is distinct from 'zzz-canary-20260826')  as any_zero_groups,
       count(*) filter (where any_null)                                as null_price_groups,
       count(*) filter (where any_neg)                                 as negative_price_groups,
       count(*) filter (where supplier_slug is distinct from 'zzz-canary-20260826')  as groups_scanned,
       count(*) filter (where zero_side and pos_side
                          and supplier_slug is not distinct from 'zzz-canary-20260826')  as canary_must_be_1,
       (select count(*) from storefront_catalog_v
         where supplier_slug = 'zzz-canary-20260826')                  as neg_control_must_be_0
from e;

-- 🔴 怎麼判這一發算不算數(四格一起看, 少看一格就分不出「真的 0」與「尺沒接上」):
--    canary_must_be_1      != 1  ⇒ 尺對「零」是瞎的。整發作廢, 不要引用那個 0。
--    neg_control_must_be_0 != 0  ⇒ 有人真的建了那個假供應商。換一個當天日期的靶重跑。
--    groups_scanned         = 0  ⇒ view 讀不到 / 跑錯庫, 不是「沒有商品」。
--    measured_at                 ⇒ 🔴 抄結果時連它一起抄。沒有時間的 0 不知道是哪一天的。
--    🔴🔴 db 那一格【不能拿來認庫】:Supabase 每個專案的 current_database() 都是 `postgres`
--         ⇒ 報價單庫與網站庫【印同一個字】, 它對「跑在哪一顆庫」零判別力。
--         ⇒ 要記錄跑在哪一顆, 自己從 SQL Editor 網址列把 project ref 抄下來, 寫在結果旁邊。
--         ⚠️ 我只在報價單那一側跑過(印 postgres);「網站那側也印 postgres」是【推的, 未量】。

-- ══ 查詢 2:命中的話它們是誰(今天回 0 列)══════════════════════════════
-- 🔴 total_hits 與列數不一致 ⇒ 被 limit 截斷了。不要把畫面上的列數當成完整名單。
-- 🔴 它列的是【所有含 0 元那側的群】, `is_mixed` 那欄才分得開兩種:
--    is_mixed = true   群裡同時有 0 與正價 ⇒ 卡片會被贈品拉成 NT$0
--    is_mixed = false  群裡只剩 0(例如正價那支已下架)⇒ 🔴 卡片【一樣印 NT$0】
--    ⇒ 上一版只列 is_mixed 的 ⇒ 第二種會看到 0 列就收工。那正是 G6 那個洞。
with g as (
  select supplier_slug, main_sku,
         bool_or(delisted_at is null) as has_live,
         bool_or(round(price_retail) = 0 and price_retail >= 0)
           filter (where delisted_at is null) as live_zero,
         bool_or(round(price_retail) > 0) filter (where delisted_at is null) as live_pos,
         bool_or(round(price_retail) = 0 and price_retail >= 0) as all_zero,
         bool_or(round(price_retail) > 0) as all_pos,
         min(round(price_retail)) filter (where round(price_retail) > 0) as lowest_positive,
         count(*) filter (where round(price_retail) = 0 and price_retail >= 0) as zero_rows,
         count(*) as rows_in_group
  from storefront_catalog_v group by supplier_slug, main_sku
), e as (
  select *, case when has_live then live_zero else all_zero end as zero_side,
            case when has_live then live_pos  else all_pos  end as pos_side
  from g
)
select supplier_slug, main_sku, has_live,
       (zero_side and pos_side) as is_mixed,
       zero_rows, rows_in_group, lowest_positive,
       count(*) over () as total_hits
from e where zero_side
order by is_mixed desc, supplier_slug, main_sku
limit 200;

-- ══ 查詢 3:自檢(不碰真實表, 七個世界一次演完)══════════════════════════
-- 🔴 為什麼要留這發:上面兩發今天回 0,而【偵測是對的而今天沒有】與【偵測根本不會動】
--    印出來的是同一個 0。這發用假資料把兩者分開。
-- ⚠️⚠️ 而要先知道它的【限制】,不然它會給人假的安全感(code-reviewer 2026-08-26 抓到):
--    本檔的判準寫了【三份】:查詢 1 / 查詢 2 / 查詢 3 各一份抄本。
--    ⇒ 🔴 改壞查詢 1, 查詢 3 照樣印出正確的七格 —— 它驗的是【尺的複製品】, 不是那把尺。
--    ⇒ 真正扣著查詢 1 的只有 canary 那一格(而它只演 mixed 一個世界)。
--    ⇒ 📌 動任何一份判準, 三份都要動。數法:
--       `grep -c 'round(price_retail) = 0 and price_retail >= 0' scripts/rpm-mixed-zero-scan.sql`
--       ⇒ 2026-08-26 實測 **8**。組成:三發查詢各 2 處 = 6, 加上【本註解自己寫了這個 pattern
--         兩次】= 8。🔴 我第一版寫「應為 6」而實跑是 8 —— **因為寫下那把尺就會被那把尺數到。**
--       ⇒ 不是 8 ⇒ 有人只改了其中一處。而改了本註解的字也會動到這個數 ⇒ 動完重量一次。
-- 期望(2026-08-26 實跑逐格對過):
--    G1-mixed        true   0 與 5000                     ⇒ 該叫
--    G2-allpos       false  3000 與 5000                  ⇒ 不該叫
--    G3-allzero      false  整群 0(真贈品組)             ⇒ 不該叫, 它不是「混」
--    G4-point4       true   0.4 取整後是 0                ⇒ 🔴 該叫。這格是 plan v1 死掉的原因
--    G5-delisted-mix true   整群已下架而混 0              ⇒ 🔴 該叫。濾掉下架就會漏它
--    G6-partial      false  下架那列是正價、活的只剩 0    ⇒ 🔴 看下面那段, 這格【不叫是對的而它是個洞】
--    G7-negative     false  -50 與 5000                   ⇒ 不該叫。負價不是贈品
--    🔴 少了 G4 / G5 / G7 任一格, 這支尺就退回被打掉的舊錯法。
--
-- 🔴🔴 G6 這一格 2026-08-26 當場量出來與我原本寫的【相反】, 而它不是筆誤, 是一個洞:
--    正價那支下架了、活的只剩 0 元贈品 ⇒ liveVariantsOf 只回那一支 ⇒ 基準價 = 0
--    ⇒ 【卡片照樣印 NT$ 0】, 而群裡已經沒有東西可以「混」⇒ 本檔的 mixed 定義抓不到它。
--    ⇒ 接住它的是查詢 1 的 `any_zero_groups`(不管有沒有正價那側, 只要有 0 就計數)。
--    ⇒ 🔴 引用結果時【兩格都要看】:mixed_zero_groups 是 0 不代表 any_zero_groups 也是 0。
--    ⇒ 而「整群都是 0 到底該不該當贈品組放行」是 Sean 的題, 不是我能判的。
--      ⚠️ 不要去引 plan §2.3 ③ —— 那一格逐字是【驗收條目】「群內全 0 ⇒ 零命中(它不是「混」)」,
--         那是【已定的驗收】, 不是待決題。兩件事語氣相反, 引錯會讓人以為已經拍過。
--    📌 這一格是【文件說 true 而機器說 false】撈出來的 —— 我改的是文件, 不是那把尺。
with fake(supplier_slug, main_sku, price_retail, delisted_at) as (values
  ('s1','G1-mixed',           0::numeric(10,2), null::timestamptz),
  ('s1','G1-mixed',        5000::numeric(10,2), null::timestamptz),
  ('s1','G2-allpos',       3000::numeric(10,2), null::timestamptz),
  ('s1','G2-allpos',       5000::numeric(10,2), null::timestamptz),
  ('s1','G3-allzero',         0::numeric(10,2), null::timestamptz),
  ('s1','G3-allzero',         0::numeric(10,2), null::timestamptz),
  ('s1','G4-point4',        0.4::numeric(10,2), null::timestamptz),
  ('s1','G4-point4',       5000::numeric(10,2), null::timestamptz),
  ('s1','G5-delisted-mix',    0::numeric(10,2), now()),
  ('s1','G5-delisted-mix', 5000::numeric(10,2), now()),
  ('s1','G6-partial',         0::numeric(10,2), null::timestamptz),
  ('s1','G6-partial',      5000::numeric(10,2), now()),
  ('s1','G7-negative',      -50::numeric(10,2), null::timestamptz),
  ('s1','G7-negative',     5000::numeric(10,2), null::timestamptz)
), g as (
  select supplier_slug, main_sku,
         bool_or(delisted_at is null) as has_live,
         bool_or(round(price_retail) = 0 and price_retail >= 0)
           filter (where delisted_at is null) as live_zero,
         bool_or(round(price_retail) > 0) filter (where delisted_at is null) as live_pos,
         bool_or(round(price_retail) = 0 and price_retail >= 0) as all_zero,
         bool_or(round(price_retail) > 0) as all_pos
  from fake group by supplier_slug, main_sku
)
select main_sku,
       coalesce(case when has_live then live_zero else all_zero end, false)
       and coalesce(case when has_live then live_pos else all_pos end, false) as detected
from g order by main_sku;

-- 命中怎麼辦:🔴 當日開工片B(不是記進 backlog 等)。片B 規格在同一份 plan §3。
-- 沒命中怎麼辦:把【db + measured_at + 數字】一起寫進 backlog `#934`。只寫「查過了」不算。
