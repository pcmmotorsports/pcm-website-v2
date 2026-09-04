-- 🛑 **檔頭第一行:本支【不需要搭配任何新的 SQL, 也不需要部署 TS】** ——
--    🔴 **而它【不是】無條件可貼**(codex 2026-09-04 nit;舊字面作廢留痕):
--    ⛔ ~~「本支【可以獨立貼】」~~ —— 下一行寫著「它有前置代」, **兩句互相打架**,
--       而先讀到第一句的人會以為隨時可貼。
--    ✅ 正確說法:**正式庫上那支必須已經是 `20260904160000`(多顆膠囊)那一代** ——
--       前置閘會擋(fail-closed), 而**擋下來時你的庫零改動**。
-- ============================================================
-- M-4b · 帶分類時也照【中高價位優先】排 —— 而今天帶分類等於【沒有排序】
-- ⟦search-CATSORTRANDOM⟧ · 2026-09-04 · 線【身分】`-auth`
-- ============================================================
-- ✅ **Sean 2026-09-04 拍板,逐字「3. 甲」**
--    題目(我端的字面):
--    > Q-分類頁排序: 客人點進一個分類(或搜尋帶出分類)時, 第一頁要不要也照【中高價位優先】排?
--    > 甲 = 要 —— 跟首頁一致, 客人先看到中高價位的
--    > 乙 = 不要, 維持現在 —— 而現在是【沒有排序】: 第一頁是資料庫內部編號的順序, 等於隨機
--
-- 🔴🔴 **而這一題【不是新發現】—— 是上一個人刻意留下而一直沒被端出去的**:
--    `20260827150000_m4b_storefront_950_recommend_sort_mid_high_price.sql:31-37` 逐字寫著:
--      :31 「── 🔴 只在【沒指定分類】時生效 ──」
--      :34 理由:「客人點進『精品螺絲與螺帽』分類頁時, 螺絲不該被降權 —— 他就是來看螺絲的。」
--          (前一行注明它來自「第一版權重表的硬約束, 而 Sean 批的 plan 逐字寫著它」⇒ **那是拍板**)
--      :35 ⚠️ 「**而換成價格排序之後, 那個理由其實已經不成立**(單一分類頁內沒有跨類降權可言)」
--      :37 「要拿掉是另一個決定, 而它會改變分類頁的樣子 ⇒ **要有人拍**。」
--    ⇒ 🎯 **那個「有人」今天拍了。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔬 今天的行為(正式庫唯讀實測, 2026-09-04)
-- ══════════════════════════════════════════════════════════════════════════
--    帶兩個分類(尾段排氣管 319 件 + 全段排氣管 248 件)⇒ 那 12 處排序 CASE 全部回 NULL
--    ⇒ **唯一還在生效的鍵是 `f.id ASC`, 而 `id` 是 UUID。**
--    前 10 筆的價格:34900 74900 86800 45800 46100 46100 26800 70600 26000 63400
--    ⇒ 📌 **沒有價格叢集, 而【也沒有任何價格意圖】** —— 它就是 UUID 的順序。
--    🔵 兩類是交錯的(前 25 筆:全段 15 · 尾段 10, 母體 44/56)⇒ **不是「一類全排前面」。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 本支動什麼、【不動】什麼 —— 而這一段是整支檔最重要的一段
-- ══════════════════════════════════════════════════════════════════════════
--    ✅ **動**:12 處排序 CASE 的 `AND cardinality(v_cats) = 0` 拿掉(兩個分支各 6 處)。
--    🛑 **不動**:`WHERE (cardinality(v_cats) = 0 OR ...)` 那**兩處** —— 那是**過濾**。
--       ⇒ 📌 **動它會改變【回傳哪些商品】, 而本支只改【它們的順序】。**
--    🔬 而這件事有一格斷言在守:事後閘②驗「同一組查詢, 貼前貼後的 **id 集合一模一樣**」。
--    🔵 「大類輪流」(`sort_rn` 的 `PARTITION BY 大類`)在只選一個分類時**自然變成 no-op**
--       ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。**不必也不該另外改它。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 回退
-- ══════════════════════════════════════════════════════════════════════════
--    把 `20260904160000` 那支的函式本體原樣 `CREATE OR REPLACE` 回去(同名同簽章、ACL 不動)。

-- ══════════════════════════════════════════════════════════════════════════
-- 🔬 這些閘【被實測殺過】—— 拋棄式鑽機(storefront-probe:117 個真分類 + 108 件種子商品)
-- ══════════════════════════════════════════════════════════════════════════
--    🟢 前提對得上:那台鑽機上這支函式的 `prosrc md5` 與正式庫**逐位元組相同**
--       (`ae1f2603744753109f6413b756f2a128`, 14,430 字元)⇒ 前置閘在兩邊都成立。
--    ```
--    乾淨貼                                      ⇒ rc=0
--    連【過濾】用的 WHERE 也一起拿掉              ⇒ 事後閘①b 紅
--    只改一個分支(留下另一支的 6 處)            ⇒ 事後閘①a 紅
--    什麼都不改(12 處條件加回去)                ⇒ 事後閘①a 紅
--    連【外層】的 price-asc CASE 也改掉           ⇒ 事後閘④ 紅
--    ```
--    🔴🔴 **而 price-asc 那一發我第一次【打錯了目標】, 記在這裡**:
--       我先改的是**內層** `CASE WHEN p_sort = 'price-asc' THEN f.price_general` ⇒ **rc=0 全綠**。
--       成因:決定最終順序的是**外層**那個 `pg.price_general` 的 CASE, 內層只是子查詢裡的排序
--       ⇒ 📌 **突變沒有落在【會影響結果】的那一段上, 而它印的綠是誠實的。**
--       ✅ 改打外層 ⇒ 事後閘④ 當場紅。
--    🛑 **而還有一格我沒能驗**:「①b 只剩 1 處」與「②集合變了」在 c1 那一發會**同時成立**,
--       而 ①b 排在前面 ⇒ ② 沒有機會說話。⇒ 我不宣稱 ② 被那一發殺過。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔬 這些閘【被實測殺過】—— 而【鑽機驗不到的那一格也寫出來】
-- ══════════════════════════════════════════════════════════════════════════
--    鑽機 = `scripts/storefront-probe/up.sh`(117 個真分類 + 108 件種子商品 · 26 個有貨的葉分類)。
--    🟢 **前提對得上**:鑽機上這支函式的 `prosrc md5` 與正式庫**逐位元組相同**
--       (`ae1f2603744753109f6413b756f2a128`, 14,430 字元)⇒ 前置閘在兩邊都成立。
--    🔴 **而貼法也對得上 Sean 會做的形狀**:**手動 `psql -f` 貼進一台 live = 0827 代的庫**,
--       不是「從零重放」—— 從零重放時本支的前置閘一定紅(順序上它排在 0827 之後)。
--    ```
--    乾淨貼                                      ⇒ rc=0
--    連【過濾】用的 WHERE 也一起拿掉              ⇒ 事後閘①b 紅
--    什麼都不改(12 處條件加回去)                ⇒ 事後閘①a 紅
--    連【外層】的 price-asc CASE 也改掉           ⇒ 事後閘④ 紅
--    把「挑兩個分類」改成挑 0 個(量測表空掉)    ⇒ 事後閘② 紅
--    ```
--    🔴🔴 **而【鑽機驗不到】的那一格 —— codex 2026-09-04 must-fix ① 就住在這裡**:
--       事後閘②比的是 `total`, 而我原本比的是**前 40 筆的 id 集合**。
--       🛑 那個版本在鑽機上**永遠綠**(那兩個分類只有 11 件 < 40, 一頁裝得下全部),
--          而在正式庫上**必然紅**(那兩個分類 567 件 ⇒ 排序改對了第一頁成員本來就會換)
--          ⇒ **Sean 貼下去會整支回滾。**
--       ⇒ 📌 **鑽機與正式庫的【資料量】差異, 讓一個必然會炸的斷言全綠。**
--       ⚠️ **而換成 `total` 之後, 「>40 件的世界」在鑽機上仍然造不出來**
--          ⇒ 🔴 **那一格是【正式庫貼完才驗得到的】** ⇒ 貼後由線 `-db` 對帳:
--             同一組分類, 貼前貼後的 `total` 相同、而第一頁順序不同。
--
--    🛑 **另一格我明寫沒能驗**:`d1`(拿掉過濾)會**同時**觸發 ①b 與 ②,
--       而 ①b 排在前面 ⇒ **② 沒有機會說話** ⇒ 我不宣稱 ② 被那一發殺過(它是被 `d4` 殺的)。
--
BEGIN;

-- 🔴🔴 **[2026-09-04 codex must-fix ② —— 順序換過了, 理由寫在這裡]**
--    ⛔ ~~原本【先量快照, 再跑前置閘】~~ ⇒ 🛑 那表示我**先呼叫了四次還沒驗過身分的函式**,
--       才去問「它是不是我抄的那一代」。⇒ 📌 **驗身分要排在【用它】之前。**
-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_md5 text;
  v_def text;
  r     record;
BEGIN
  SELECT md5(p.prosrc), pg_get_functiondef(p.oid) INTO v_md5, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:帶 p_categories 的那支不存在 ⇒ 先貼 20260904160000, 不要讓本支替你創造它。';
  END IF;
  -- 🔴 釘身分:我抄的是 2026-09-04 晚正式庫上的那一版。
  --    ⚠️ 這道閘紅了不代表壞掉 —— 它代表「有人在我量完之後改過它」⇒ 停下來比對, 不要硬貼。
  IF v_md5 <> 'ae1f2603744753109f6413b756f2a128' THEN
    RAISE EXCEPTION '前置閘②:庫上那支的 prosrc md5 是 %(期望 ae1f2603744753109f6413b756f2a128)⇒ 有人改過它 ⇒ 停。', v_md5;
  END IF;
  -- 🔴 屬性也釘(md5 只釘本體;REPLACE 會把沒寫出來的重設回預設)
  -- 🔴 **[2026-09-04 codex must-fix ③ 補三欄]**:`CREATE OR REPLACE` 會把**沒寫出來的屬性**
  --    套回隱含值 ⇒ `STRICT` / `LEAKPROOF` / `SUPPORT` 都可能被靜默吹掉。
  SELECT p.provolatile, p.proparallel, p.procost, p.prorows, p.prosecdef,
         p.proisstrict, p.proleakproof, p.prosupport::text AS support, p.proretset,
         coalesce(array_to_string(p.proconfig, ','), '') AS cfg
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000
     OR r.prosecdef OR r.cfg <> 'search_path=public, pg_temp'
     OR r.proisstrict OR r.proleakproof OR r.support <> '-' OR NOT r.proretset THEN
    RAISE EXCEPTION '前置閘③:函式屬性與 2026-09-04 實測不符(volatile=% parallel=% cost=% rows=% secdef=% config=% strict=% leakproof=% support=% retset=%)⇒ 停。',
      r.provolatile, r.proparallel, r.procost, r.prorows, r.prosecdef, r.cfg,
      r.proisstrict, r.proleakproof, r.support, r.proretset;
  END IF;
  -- 🔴 擋重貼:本支拿掉的東西若已經不在, 停。
  IF position('p_sort = ''recommend'' AND cardinality(v_cats) = 0' IN v_def) = 0 THEN
    RAISE EXCEPTION '前置閘④:庫上那支已經沒有「recommend AND cardinality(v_cats)=0」那組條件 ⇒ **本支已經貼過了** ⇒ 不要重貼。';
  END IF;
END
$$;

-- ── 貼之前先量一次(兩個世界的「之前」那一半)────────────────────────────
--    🔴 `ON COMMIT DROP` ⇒ 只活在本交易裡, 不留痕。
--    🔵 四個世界:①帶分類 recommend(要變)②帶分類 price-asc(不得變)
--                ③不帶分類 recommend(不得變 —— 首頁)④帶分類的【id 集合】(不得變)
CREATE TEMP TABLE _catsort_before ON COMMIT DROP AS
-- 🔴 **要比對的那兩個分類【當場從資料挑】, 不寫死** —— 寫死的話:
--    ① 在拋棄式鑽機上那兩個分類可能沒有商品 ⇒ 每一格都拿到 NULL ⇒ 比較失去判別力
--    ② 而正式庫哪天把那兩個分類清空, 這支就變成「跑了而什麼都沒驗」—— 而它會印綠。
--    ⇒ ✅ 挑【商品最多的兩個葉分類】:兩邊都一定有東西, 而且排序差異最看得出來。
WITH cats AS (
  SELECT array_agg(t.raw_path) AS c FROM (
    -- 🔴 只挑【葉分類】(沒有子分類的)—— codex nit:字面說「葉」而查詢沒驗它。
    --    挑到祖先/子孫會讓兩分類退化成一組, 而 `sort_rn` 的 PARTITION 行為就測不出來。
    SELECT c2.raw_path
      FROM public.categories c2
      JOIN public.products p2 ON p2.category_id = c2.id AND p2.delisted_at IS NULL
     WHERE NOT EXISTS (SELECT 1 FROM public.categories k WHERE k.parent_category_id = c2.id)
     GROUP BY c2.raw_path
     ORDER BY count(p2.id) DESC, c2.raw_path
     LIMIT 2
  ) t
)
SELECT
  (SELECT md5(string_agg(x.item->>'id', ',' ORDER BY ord))
     FROM cats, LATERAL (
       SELECT item, row_number() OVER () AS ord
         FROM public.search_catalog_by_vehicle(p_categories := cats.c, p_sort := 'recommend', p_limit := 40)
     ) x)                                                                    AS 帶分類_recommend_順序,
  -- 🔴🔴 **[2026-09-04 codex must-fix ① —— 這一欄整個換掉了, 舊字面留痕]**
  --    ⛔ ~~原本比【前 40 筆的 id 集合】~~ ⇒ 🛑 **那是錯的, 而它會在正式庫上炸**:
  --       那兩個分類在正式庫有 **567 件**, 而 `p_limit := 40` 只拿第一頁
  --       ⇒ **排序改對了, 第一頁的成員【本來就會換】** ⇒ 那一格會判成「過濾被動了」⇒ **整支回滾。**
  --    🔬 而我的鑽機驗不到這件事:它只有 11 件(< 40)⇒ **一頁裝得下全部** ⇒ 集合永遠相同。
  --       ⇒ 📌 **鑽機與正式庫的【資料量】差異, 讓一個必然會炸的斷言在鑽機上全綠。**
  --    ✅ 改成比 **`total`** —— 那是**過濾之後的總筆數**, 與排序無關。
  --    🛑 **而它證得比較少, 寫出來**:`total` 相同**不保證**是同一批商品
  --       (換掉一件、又補進一件, 總數不變)⇒ 那一半今天由**字面閘①b**(WHERE 兩處沒動)頂著。
  (SELECT max(y.total) FROM cats, LATERAL
     public.search_catalog_by_vehicle(p_categories := cats.c, p_sort := 'recommend', p_limit := 40) y)
                                                                             AS 帶分類_總筆數,
  (SELECT md5(string_agg(z.item->>'id', ',' ORDER BY ord))
     FROM cats, LATERAL (
       SELECT item, row_number() OVER () AS ord
         FROM public.search_catalog_by_vehicle(p_categories := cats.c, p_sort := 'price-asc', p_limit := 40)
     ) z)                                                                    AS 帶分類_priceasc_順序,
  (SELECT md5(string_agg(w.item->>'id', ',' ORDER BY ord))
     FROM LATERAL (
       SELECT item, row_number() OVER () AS ord
         FROM public.search_catalog_by_vehicle(p_categories := ARRAY[]::text[], p_sort := 'recommend', p_limit := 40)
     ) w)                                                                    AS 不帶分類_recommend_順序;

-- ── 本體(逐字抄自正式庫的 pg_get_functiondef, 只拿掉那 12 處條件)──────────
CREATE OR REPLACE FUNCTION public.search_catalog_by_vehicle(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
  -- 🔴🔴 **[2026-09-04 本支改的就是這件事 —— 而它【只動排序, 不動過濾】]**
  --    Sean 2026-09-04 逐字「3. 甲」= 帶分類時也照【中高價位優先】排。
  --    ⛔ ~~原本 12 處排序 CASE 都掛著 `AND cardinality(v_cats) = 0`~~
  --       ⇒ 一旦帶了分類, 那組 CASE 全部回 NULL ⇒ **唯一還在生效的鍵是 `f.id ASC`(UUID)**
  --       ⇒ 📌 **客人點進一個分類, 第一頁等於【隨機順序】** —— 而那不是「另一種排法」, 是沒有排法。
  --    ✅ 本支把那 12 處的 `AND cardinality(v_cats) = 0` 拿掉。
  --    🛑 **而【WHERE 那兩處一個字都沒動】** —— 那是過濾, 不是排序:
  --       `WHERE (cardinality(v_cats) = 0 OR ...)` 決定「要不要套分類過濾」。
  --       ⇒ 動它會改變**回傳哪些商品**, 而本支只改**它們的順序**。
  --    🔵 而「大類輪流」(`sort_rn` 的 PARTITION BY 大類)在只選一個分類時**自然變成 no-op**
  --       —— 同一個 partition ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。
  -- 🛑 **而「空」的判準一律是 `cardinality(v_cats) = 0`, 不是 `IS NULL`** ——
  --    陣列有兩種空(NULL 與 `{}`), 而**它們在 `IS NULL` 上不一樣**。
  --    🔬 本檔實測到的分母:`p_category IS NULL` 在原版出現 **12** 次(兩份查詢各 6)
  --      ⇒ ⚠️ 而 plan 裡我寫「三行」—— 那是**只 grep 到一份查詢**的數。**12 才是對的。**
  v_cats text[];
  -- 供應商批次門檻 N（Sean 2026-08-11 Q15=C 定 500 起手、明文委任 S 窗可調 → 本檔落 100）。
  -- 判準是「單一台灣日新增**達到** N 件」（>=，不是 >）；正當性與殘留風險見檔頭。
  -- 🔴 改這個數字要開**新的 migration** 重貼整支函式 —— 本檔一旦 apply 就不該再編輯，
  --    改舊檔 `db push` 不會重跑、正式庫的門檻不會變(codex R3)。
  -- 🔴 而且改 N ＝ 檔頭那組突變證據作廢，必須用 `scripts/269b-evidence.sql` §2b 重找切點重量。
  -- 單一定義點：下面兩個分支都讀這一個，不得各寫一個數字。
  c_batch_day_threshold constant int := 100;
  -- ── #950 推薦排序:中高價位優先(Sean 2026-08-27「中間~高 價位優先在前面好了」, 選項回「乙」)──
  -- 🔴 這兩個數字是【我們挑的, 不是他挑的】。他看到的選項字面是
  --    「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」, 而他回【甲】
  --    ⇒ 他同意的是那個做法, **不是這兩個值**。
  -- 🔴🔴 **要改就是改這兩行。**
  --    ⚠️ **而 backlog `#950` 目前【還沒有】指回本檔**(code-reviewer 實查:
  --       `grep -n '20260827150000' docs/phase-1-backlog.md` ⇒ 0 命中)
  --       ⇒ 那句「要改得叫我們」的承諾,現在只有【這一行】是它的地址。
  --       ⇒ 條目改寫是欠著的工(見 checkpoint), 而在那之前不要說「backlog 指到這裡」。
  --      (改了要開新 migration 重貼整支函式, 理由同上面那個門檻常數。)
  -- 值的來源:全站群代表價分布, 2026-08-27 量於報價單庫 storefront_catalog_v(22,193 群)
  --    中位數 4,000 / P90 13,800 ⇒ 段界取【中位數 ~ P90】
  --    ⚠️ 換成 Q3~P95(7,480 ~ 約 21,000)⇒ 第一頁整批換人、平均單價高很多
  -- 分類第一段 = 這個字的商品【不進新品區】(Sean 2026-08-27 拍【甲】= 照大類切)。
  -- 🔴 用 split_part 取第一段, 不是整串比對 —— 以後多出「維修零件 · 油封」這種子類會【自動】跟著排除,
  --    不需要有人記得回來改。Sean 拍甲的理由就是這個(de 端題時已明說「今天甲乙行為一樣, 差別在以後」)。
  -- ⚠️ 只作用在【新品模式】(p_new_since IS NOT NULL)。目錄 / 搜尋 / 品牌頁 / 分類頁傳 NULL ⇒ 不受影響;
  --    客人在分類頁直接看「維修零件」時 p_new_since 也是 NULL ⇒ 那 1631 件照常看得到。
  c_new_arrivals_excluded_category constant text := '維修零件';
  c_recommend_band_lo constant int := 4000;
  c_recommend_band_hi constant int := 13800;
BEGIN
  -- 🔵 新舊合流:兩個都給的話一起吃(聯集)。`p_category` 是舊入口, 保留到步驟 C 才 DROP。
  v_cats := (
    -- 🔴 **`btrim` 要寫回, 不是只拿來過濾**(codex nit):原版只用它排除空白字串,
    --    而 `' 排氣系統 '` 會**帶著空白留下來** ⇒ 比不到任何分類, 而且不會與無空白版去重。
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
      FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                  || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
     WHERE btrim(x) <> ''
  );
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH new_batch_days AS (
      -- 只在 p_new_since 有值時才會被執行（見 filtered 的 OR 短路）。
      -- 下界 = p_new_since 所在台灣日的 00:00（不是 p_new_since 本身）：整日量才判得準。
      SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
      FROM public.products_list_public pb
      WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
        -- 未來時戳不得參與批次日計數（codex R2）：那種列自己不會被回傳（filtered 有 <= now()），
        -- 但若同一天累積到 N，會把當天**真正的**新品整天一起誤殺。
        AND pb.created_at <= now()
      GROUP BY 1
      HAVING count(*) >= c_batch_day_threshold
    ), filtered AS (
      SELECT p.*
      FROM public.products_list_public p
      -- 🔴🔴 **不是 `= ANY(v_cats)`** —— 分類的述詞有【兩個分支】(`=` 與 `LIKE 父 · %`),
      --    而品牌只有一個 ⇒ 照抄品牌那一格會**漏掉「打大類要涵蓋子類」那一半**,
      --    而它看起來完全正確。⇒ 每一個元素都要走那兩個分支。
      -- ✅ **聯集**(任一元素中就算中)= Sean 2026-09-04 拍的甲:
      --    逐字「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」。
      WHERE (cardinality(v_cats) = 0
             OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                         WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- 只夾窗、不夾 new_batch_days：批次日要用「整日實際有幾列」判斷。
              AND p.created_at <= now()
              AND NOT EXISTS (
                SELECT 1 FROM new_batch_days nbd
                WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
              )
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows,
        -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
        --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
        --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
        --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
        --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END AS sort_band,
        -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
        --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
        --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH new_batch_days AS (
    SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
    FROM public.products_list_public pb
    WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
      AND pb.created_at <= now()                       -- 同上：未來時戳不參與批次日計數
    GROUP BY 1
    HAVING count(*) >= c_batch_day_threshold
  ), matched AS (
    SELECT product_id
    FROM public.product_fitments
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
  ), filtered AS (
    SELECT p.*
    FROM public.products_list_public p
    JOIN matched m ON m.product_id = p.id
    -- 🔴 與上面那份同一個修法(本函式有【兩份】查詢, 兩份都要改)。
    WHERE (cardinality(v_cats) = 0
           OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                       WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM new_batch_days nbd
              WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
            )
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows,
      -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
      --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
      --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
      --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
      --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
      CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
           THEN 0 ELSE 1 END AS sort_band,
      -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
      --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
      --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
      row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;   -- 🔴 `pg_get_functiondef` 的輸出【沒有這個分號】—— 少了它, 下一個 DO 區塊會被當成同一句


-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- 🔴 與上面那張表用【同一個挑法】—— 兩邊挑不同的分類, 比較就沒有意義了。
  v_cats text[] := (
    SELECT array_agg(t.raw_path) FROM (
      SELECT c2.raw_path FROM public.categories c2
        JOIN public.products p2 ON p2.category_id = c2.id AND p2.delisted_at IS NULL
       WHERE NOT EXISTS (SELECT 1 FROM public.categories k WHERE k.parent_category_id = c2.id)
       GROUP BY c2.raw_path ORDER BY count(p2.id) DESC, c2.raw_path LIMIT 2) t);
  b      record;
  a_order text; a_priceasc text; a_nocat text;
  a_total bigint;
  v_def  text;
  v_cnt  int;
BEGIN
  -- ① 字面:那 12 處真的沒了, 而 WHERE 那兩處還在
  -- 🔴🔴 **先剝掉 `--` 註解再數 —— 而這一格是本支自己撞出來的**:
  --    我在函式本體頂端寫了一段說明, 而那段話裡**逐字引用了** `WHERE (cardinality(v_cats) = 0`
  --    ⇒ 第一次跑 ①b 數到 **3**(2 個真的 + 1 個註解裡的)⇒ **紅**。
  --    ⇒ 📌 **註解被當成碼** —— 一道防它的守門, 長得像那個東西本身。
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  v_def := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
  IF position('p_sort = ''recommend'' AND cardinality(v_cats) = 0' IN v_def) <> 0 THEN
    RAISE EXCEPTION '事後閘①a:排序那組條件還在 ⇒ REPLACE 沒貼上我以為的東西。';
  END IF;
  -- 🔴🔴 **這一格守的是【我不該動的那半】** —— 過濾用的 WHERE 兩處必須原封不動。
  --    少了它, 一個「連 WHERE 也一起拿掉」的改法會讓分類過濾整個失效, 而回傳的商品變多
  --    ⇒ 而下面 ② 那格會紅, 但它紅的理由會被讀成「排序變了」。這一格說得出是哪一半壞了。
  SELECT count(*) INTO v_cnt FROM regexp_matches(v_def, 'WHERE \(cardinality\(v_cats\) = 0', 'g');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '事後閘①b:過濾用的 `WHERE (cardinality(v_cats) = 0` 只剩 % 處(期望 2)⇒ 有人連【過濾】也一起改了。', v_cnt;
  END IF;

  SELECT * INTO b FROM _catsort_before;

  -- ② 🔴🔴 **同一組查詢, 貼前貼後的 id【集合】必須一模一樣** —— 本支只改順序, 不改回傳哪些商品
  SELECT max(y.total) INTO a_total
    FROM public.search_catalog_by_vehicle(p_categories := v_cats, p_sort := 'recommend', p_limit := 40) y;
  IF a_total IS DISTINCT FROM b.帶分類_總筆數 THEN
    RAISE EXCEPTION '事後閘②:貼完之後【過濾後的總筆數變了】(% ⇒ %)⇒ 本支動到了過濾, 而它只該動排序。',
      b.帶分類_總筆數, a_total;
  END IF;

  -- ③ 而【順序必須真的變了】—— 否則這支等於什麼都沒做
  SELECT md5(string_agg(x.item->>'id', ',' ORDER BY ord)) INTO a_order
    FROM (SELECT item, row_number() OVER () AS ord
            FROM public.search_catalog_by_vehicle(p_categories := v_cats, p_sort := 'recommend', p_limit := 40)) x;
  IF a_order IS NOT DISTINCT FROM b.帶分類_recommend_順序 THEN
    RAISE EXCEPTION '事後閘③:帶分類的 recommend 順序【沒有變】⇒ 那 12 處條件沒有真的生效。';
  END IF;

  -- ④ 🟢 負對照一:`price-asc` 那條路【不得】被動到(本支只碰 recommend 那組 CASE)
  SELECT md5(string_agg(z.item->>'id', ',' ORDER BY ord)) INTO a_priceasc
    FROM (SELECT item, row_number() OVER () AS ord
            FROM public.search_catalog_by_vehicle(p_categories := v_cats, p_sort := 'price-asc', p_limit := 40)) z;
  IF a_priceasc IS DISTINCT FROM b.帶分類_priceasc_順序 THEN
    RAISE EXCEPTION '事後閘④:price-asc 的順序也變了 ⇒ 我動到了不該動的那組 CASE。';
  END IF;

  -- ⑤ 🟢 負對照二:【不帶分類】那條路(= 首頁)必須逐筆相同 —— 那是 0827 那片的行為, 不得改
  SELECT md5(string_agg(w.item->>'id', ',' ORDER BY ord)) INTO a_nocat
    FROM (SELECT item, row_number() OVER () AS ord
            FROM public.search_catalog_by_vehicle(p_categories := ARRAY[]::text[], p_sort := 'recommend', p_limit := 40)) w;
  IF a_nocat IS DISTINCT FROM b.不帶分類_recommend_順序 THEN
    RAISE EXCEPTION '事後閘⑤:不帶分類(首頁)的順序變了 ⇒ 本支不該碰它。';
  END IF;

  -- ⑥ 🔵 而上面四格都需要「之前那張表真的量到東西」—— 全 NULL 會讓 ②④⑤ 恆綠(NULL = NULL 不成立…
  --    但 IS DISTINCT FROM 對兩個 NULL 回 false ⇒ ②④⑤ 會【通過】)⇒ 這一格擋住那個世界。
  IF b.帶分類_recommend_順序 IS NULL OR b.帶分類_總筆數 IS NULL
     OR b.帶分類_priceasc_順序 IS NULL OR b.不帶分類_recommend_順序 IS NULL THEN
    RAISE EXCEPTION '事後閘⑥:貼前那張量測表有 NULL ⇒ 上面每一格的比較都失去判別力(兩個 NULL 會被判成「沒變」)。';
  END IF;
END
$$;

COMMIT;
