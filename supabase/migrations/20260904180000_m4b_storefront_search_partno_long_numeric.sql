-- 🛑 **檔頭第一行:本支不需要搭配任何【新的】SQL, 也不需要先部署 TS。**
--    ⚠️ 🔴 **而它【不是】無條件可貼**(codex 2026-09-04 nit, 原句作廢留痕):
--    ⛔ ~~「本支可以獨立貼, 不依賴任何其他 SQL」~~ —— 下面的前置閘③④**強制要求**正式庫
--       已經是 `20260904030000` 那一代。⇒ ✅ 正確說法:**它不新增依賴, 而它有前置代。**
--    📎 對照:`20260904160000`(多顆膠囊)那支有**三步部署順序**;本支沒有那種順序陷阱。
-- ============================================================
-- M-4b · 打料號:【夠長的純數字】也走料號那條路
-- ⟦search-PARTNOALLDIGITS⟧ · 2026-09-04 · 線【身分】`-auth`
-- ============================================================
-- Sean 原話(逐字):
--   「但是打料號一定要有,而且要有- 無- 有空格無空格等等方式料號都要能帶出來建議的商品。」
--
-- 🔬 而我逐格量過了(7 個活料號 × 8 種寫法, 打線上顧客站 `/api/search`)——
--    **6 個八格全中, 只有一個缺口**:`01-0110058` 打成 `010110058`(去掉 `-`)⇒ **0 筆**。
--    📎 那張表 = `~/pcm-mailbox/量-料號七種寫法-20260904-auth.md`
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🎯 成因:料號那一塊要求「詞裡必須有【字母】」, 而那個條件是【刻意的】
-- ══════════════════════════════════════════════════════════════════════════
--    庫上那支自己的註解逐字寫著理由:
--      「少了它, 打 `a` ⇒ 前綴 `A%` ⇒ **命中所有 A 開頭的料號**。」
--    ⇒ 🔴 全數字的 `010110058` 走不進去;而第①塊的 `ILIKE '%010110058%'`
--       又對不上原文 `01-0110058`(中間有 `-`)⇒ **兩條路都不通 ⇒ 0 筆。**
--    📌 **那個條件擋的是【短的】, 而它順手擋掉了【長的全數字】。**
--       ⇒ 本支只把「長的」放回來, **短的原樣不動。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 門檻為什麼是 7 不是 9 —— 而每一個數字都是量的, 不是挑的
-- ══════════════════════════════════════════════════════════════════════════
-- 量測環境:正式庫唯讀連線 · 2026-09-04 晚 · 分母 = `delisted_at IS NULL` 的 **24,478** 件
--
-- ① **這個放寬到底要服務誰**(活著 + 正規化後全數字 + 原文有分隔符 ⇒ 現行兩條路都撈不到):
--    ```
--    01-0110058     ⇒ 010110058    (gilles)   9 位
--    01022.4501-01  ⇒ 01022450101  (gilles)  11 位
--    🎯 全站【就這 2 筆】。最短 = 9。
--    ```
-- ② **短的全數字會不會被拖進來 ⇒ 不會, 而理由是量到的**:
--    全站正規化後全數字的料號共 **531** 筆、最短 3 位;
--    而其中 **529 筆今天就撈得到** —— 它們原文本身沒有分隔符 ⇒ 第①塊 `ILIKE '%931%'` 直接命中。
--    🔬 線上實測:打 `931` ⇒ 6 筆(第一筆 `lightech-931b`)· 打 `0041` ⇒ 3 筆(第一筆 `bonamici-0041`)
--    ⇒ 📌 **放寬不需要涵蓋短的。短的不是壞的。**
-- ③ **結果集大小(⚠️ 這【不是】效能數字, 見下一節)**:
--    ```
--    一個 k 位純數字的詞前綴命中幾筆:k=1 ⇒ 271 · k=3 ⇒ 152 · k=6 ⇒ 10 · k=7 ⇒ 7 · k=9 ⇒ 1
--    🟢 對照組(今天【已經允許】的詞):有字母又有數字的 2 字詞 ⇒ 最壞 348
--                                      同樣形狀的 4 字詞      ⇒ 最壞 3,528
--    ```
-- ④ 🔴🔴 **而門檻寫 7 不寫 9, 是刻意的**:
--    今天全站最短的那一筆是 **9** 位 ⇒ 🛑 **一個剛好等於今天最小值的門檻, 明天就會被撞** ——
--    下一個供應商送來一個 7 位或 8 位的全數字料號, 那一列就會靜靜地撈不到,
--    而**撈不到不會有人回報, 客人只會覺得我們沒賣**。
--    ⇒ ✅ 7 留了兩格餘裕, 而它的代價在下一節量了。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 效能:而上面那個「最壞 7 筆」**不是**效能證據(codex 2026-09-04 must-fix, 他對)
-- ══════════════════════════════════════════════════════════════════════════
--    `upper(regexp_replace(external_id, …))` **沒有對應的運算式索引** ⇒ 這一塊一定是全表掃。
--    🔬 **正式庫唯讀 `EXPLAIN (ANALYZE)` 實測(2026-09-04 晚, 24,478 件)**:
--    ```
--    純數字詞 010110058 走這一塊   ⇒ Seq Scan · 執行 45.8 ms   ← 本支新增的那條路
--    英數詞   EB12E5    走同一塊   ⇒ Seq Scan · 執行 45.2 ms   🟢 這個成本【今天就在付】
--    中文詞   碳纖維    走第①塊   ⇒ BitmapOr(四支 trgm)· 22.0 ms  🟢 完全不受影響
--    ```
--    ⇒ 🎯 **所以代價說得出來, 不是「應該還好」**:
--       ① 中文與一般文字搜尋 **零影響** —— 那一塊的 `t.term ~ '[0-9]'` 把它們擋在外面
--          (030000 的正式站 EXPLAIN 已印 `never executed`)
--       ② 一個 **7 位以上的純數字詞**, 從今天的「只跑第①塊」變成「多跑一次全表掃」⇒ **約 +46 ms**
--       ③ 而那正是**英數料號今天已經在付的同一筆錢** —— 不是一種新的成本形狀
--    🛑 **殘餘風險, 我不自宣接受**:若哪天純數字搜尋變成高頻(例如客人習慣打電話號碼、年份),
--       那 +46 ms 會變成常態成本。**根治是替那個運算式建索引**, 而那是另一片(要 Sean 拍)。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🟢 兩個世界各餵一發 —— 而本檔把它寫成【會紅的斷言】, 不是寫成一段話
-- ══════════════════════════════════════════════════════════════════════════
--    事後閘⑥在同一個交易裡, **貼之前先量一次、貼之後再量一次**, 逐詞比對
--    **筆數【與】命中的 id 集合**(codex must-fix:只比筆數 ⇒ 換了一批同數量的商品也會全綠):
--    ```
--    010110058    (9 位) 0 ⇒ 1  🟢 該修好的
--    01022450101 (11 位) 0 ⇒ 1  🟢
--    0102245      (7 位) 0 ⇒ 1  🔴🔴 **門檻的判別詞** —— 見下
--    01022450     (8 位) 0 ⇒ 1  🔴🔴 同上
--    987654321    (9 位) 0 ⇒ 0  🟢 負對照:不存在的九位數仍然回 0(沒有退化成「找最像的」)
--    13 / 100 / 931 / 0041 / 123456 ⇒ 前後的【筆數與 id 集合】必須完全相等 🟢
--    ```
--    🔴🔴 **`0102245` / `01022450` 這兩格是 codex 2026-09-04 must-fix 逼出來的, 而他說得對**:
--       原本兩個正對照**剛好都是 9 位與 11 位** ⇒ 🛑 **一個寫成 `>= 9` 的錯誤實作會【全綠】。**
--       ⇒ ✅ 補這兩格之後, `>= 8` 讓 7 位那格紅、`>= 9` 讓兩格都紅 ⇒ **門檻本身被釘住了。**
--       🔬 而它們是**量出來能判別**才選的:兩者的 `ILIKE` 今天都回 **0**、正規化前綴都恰好 **1** 筆。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔬 這些閘【被實測殺過】—— 而哪一格沒有, 我也寫出來
-- ══════════════════════════════════════════════════════════════════════════
--    拋棄式 PG(從零起、逐位元組相同的 `prosrc` md5 與函式屬性)· 2026-09-04:
--    ```
--    乾淨貼                                          ⇒ rc=0
--    突變 A  門檻改成 >= 9                            ⇒ 事後閘⑥b 紅(`0102245`)
--    突變 B  改成 >= 9 而旁邊放一段 /* >= 7 */         ⇒ 事後閘⑥b 紅  ← codex 那條 must-fix 的原場景
--    突變 C  放行【所有】純數字                        ⇒ 事後閘⑥d 紅(`931` 1 ⇒ 2)
--    突變 D  在 CREATE 上加 PARALLEL SAFE              ⇒ 事後閘②e 紅
--    ```
--    🛑 **而⑥e(id 集合變了而筆數沒變)【沒有被突變殺過】** ——
--       我構造不出一個「筆數相等而 id 換了一批」的世界:每一發我試過的突變都先讓**筆數**變。
--       ⇒ 📌 **那不是「它有效」的證據, 是「我沒能驗它」** ——
--          它的尺本身(排序後 id 串接的 md5)在兩個不同的集合上必然不同, 那是構造上的;
--          **沒被驗到的是「有沒有一種真實的錯會落進那個世界」。**
--       ⇒ 🔵 留著它, 因為它便宜;而**不要**把它的綠讀成「已經檢查過商品沒有被換掉」。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 已知天花板(codex 2026-09-04 must-fix ②;**我修不掉, 所以寫出來**)
-- ══════════════════════════════════════════════════════════════════════════
--    前置閘讀 `md5(prosrc)` 與 `CREATE OR REPLACE` 之間**沒有鎖**(PostgreSQL 沒有辦法鎖一支函式,
--    而 advisory lock 只在**所有寫入者都配合**時才有用 —— 我們的寫入者是「有人在 SQL Editor 手貼」)。
--    ⇒ 🔴 若真的有第二個人在這兩步之間 REPLACE 了它, 本支會**無聲蓋掉**對方, 而事後閘全綠。
--    ⇒ 📌 **今天靠的是【只有 Sean 一個人貼 SQL, 而且是序列的】** —— 那是**流程保證, 不是技術保證**。
--       🛑 **我不自宣接受這個殘餘風險**:兩個人同時貼 SQL 的那天, 這道閘擋不住。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 回退
-- ══════════════════════════════════════════════════════════════════════════
--    把 `20260904030000` 那支的函式本體原樣 `CREATE OR REPLACE` 回去即可(同名同簽章、ACL 不動)。

BEGIN;

-- ── 前置閘:庫上那一支必須就是我抄的那一代 ──────────────────────────────────
DO $$
DECLARE
  v_def  text;
  v_code text;   -- v_def 剝掉註解之後的樣子
  v_md5  text;
  r      record;
BEGIN
  IF to_regclass('public.products_public') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.products_public';
  END IF;

  SELECT pg_get_functiondef(p.oid), md5(p.prosrc) INTO v_def, v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'storefront_search_product_ids'
     AND pg_get_function_identity_arguments(p.oid) = 'p_terms text[]';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘②:public.storefront_search_product_ids(p_terms text[]) 不存在 ⇒ 停下來查部署態, 不要讓本支替你創造它。';
  END IF;

  -- 🔴 **釘身分**:我抄的是 2026-09-04 晚間正式庫上的那一版。
  --    ⚠️ 這道閘紅了**不代表壞掉** —— 它代表「有人在我量完之後改過這支函式」
  --       ⇒ 🛑 **停下來, 去比對 `pg_get_functiondef`, 不要硬貼** ——
  --          因為 `CREATE OR REPLACE` 會把對方的改動整個蓋掉, 而它不會出聲。
  IF v_md5 <> 'a5d89aa5dfad14e6cdb9182bb58cdfd6' THEN
    RAISE EXCEPTION '前置閘③:庫上那支的 prosrc md5 是 % ⇒ 不是我抄的那一代(期望 a5d89aa5dfad14e6cdb9182bb58cdfd6)⇒ 有人改過它 ⇒ 停下來比對, 不要讓 REPLACE 蓋掉別人的改動。', v_md5;
  END IF;

  -- 🔴🔴 **而 `md5(prosrc)` 只釘【函式本體】** —— codex 2026-09-04 must-fix, 他對:
  --    volatility / parallel / cost / rows / `SET` 都**不在 prosrc 裡**, 而
  --    `CREATE OR REPLACE` 會把沒寫出來的那些**重設回預設值** ⇒ 有人加了 `PARALLEL SAFE`
  --    或 `SET search_path` ⇒ 前置閘照樣綠, 而我會**無聲吹掉它**。
  --    ⇒ ✅ 所以這裡逐欄釘住 2026-09-04 實測到的值。
  SELECT p.provolatile, p.proparallel, p.procost, p.prorows,
         p.proconfig, p.proleakproof, p.proisstrict
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000
     OR r.proconfig IS NOT NULL OR r.proleakproof OR r.proisstrict THEN
    RAISE EXCEPTION '前置閘③b:函式屬性與 2026-09-04 實測不符(volatile=% parallel=% cost=% rows=% config=% leakproof=% strict=%;期望 s/u/100/1000/NULL/f/f)⇒ 有人動過它, 而本支的 CREATE OR REPLACE 會把那些改回預設 ⇒ 停。',
      r.provolatile, r.proparallel, r.procost, r.prorows, r.proconfig, r.proleakproof, r.proisstrict;
  END IF;

  -- 🔴🔴 **剝註解要【兩種都剝】** —— codex 2026-09-04 must-fix, 他對:
  --    只剝 `--` 的話, 一個寫成 `>= 9` 的錯誤實作只要在旁邊放一段 `/* >= 7 */`,
  --    下面的字面閘就會**放行**。⇒ ✅ 兩種註解都剝掉再找。
  --    📌 而字面閘本來就擋不住這種事 —— **真正擋住它的是事後閘⑥的 7 位 / 8 位判別詞。**
  v_code := regexp_replace(
              regexp_replace(v_def, '/\*.*?\*/', '', 'gs'),
              '--[^' || chr(10) || ']*', '', 'g');

  IF position('regexp_replace(p.external_id' IN v_code) = 0 THEN
    RAISE EXCEPTION '前置閘④a:庫上那支(剝註解後)沒有料號正規化那一塊 ⇒ 它不是 030000 那一代 ⇒ 停。';
  END IF;
  IF position('b.name' IN v_code) <> 0 THEN
    RAISE EXCEPTION '前置閘④b:庫上那支(剝註解後)還含 `b.name` ⇒ 它是拆三塊【之前】那一代 ⇒ 先貼 20260904030000。';
  END IF;
  IF position('length(regexp_replace(t.term' IN v_code) <> 0 THEN
    RAISE EXCEPTION '前置閘④c:庫上那支已經含長度門檻 ⇒ **本支已經貼過了** ⇒ 不要重貼。';
  END IF;
END
$$;

-- ── 🔬 貼之前先量一次(兩個世界的「之前」那一半)────────────────────────────
--    🔴 `ON COMMIT DROP` ⇒ 這張表只活在本交易裡, 不留痕。
--    🔴 **`ids` 欄是 codex must-fix 補的**:只比筆數的話, 「換了一批同數量的商品」會全綠。
CREATE TEMP TABLE _partno_before ON COMMIT DROP AS
SELECT t.term, t.expect,
       (SELECT count(*) FROM public.storefront_search_product_ids(ARRAY[t.term])) AS n,
       (SELECT md5(coalesce(string_agg(s.id::text, ',' ORDER BY s.id), ''))
          FROM public.storefront_search_product_ids(ARRAY[t.term]) s)      AS ids
  FROM (VALUES
          ('010110058',   'fix'),   -- 🎯  9 位:01-0110058
          ('01022450101', 'fix'),   -- 🎯 11 位:01022.4501-01
          ('0102245',     'fix'),   -- 🔴  7 位判別詞:寫成 >= 8 或 >= 9 ⇒ 本格紅
          ('01022450',    'fix'),   -- 🔴  8 位判別詞:寫成 >= 9 ⇒ 本格紅
          ('987654321',   'zero'),  -- 🟢 負對照:不存在的九位數
          ('13',   'same'), ('100', 'same'), ('931', 'same'),
          ('0041', 'same'), ('123456', 'same')
       ) AS t(term, expect);

-- ── 本體 ──────────────────────────────────────────────────────────────────
-- 🔴 **刻意【不寫】 SECURITY DEFINER** —— 預設 INVOKER, 那是本片的安全前提。
-- 🔵 **也刻意不寫 `SET search_path`** —— INVOKER + 只讀具名 `public.` 物件、零提權面。
--    (而「庫上那支現在也沒有 `SET`」由前置閘③b 釘住 ⇒ REPLACE 不會吹掉任何東西。)
-- 🛑 **本體逐字抄自 2026-09-04 晚正式庫的 `pg_get_functiondef`, 只改了料號那一塊的一個條件。**
--    其餘每一行註解都是原作者寫的, 一個字都沒動 —— 那些註解裡住著拍板紀錄。
CREATE OR REPLACE FUNCTION public.storefront_search_product_ids(p_terms text[])
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
AS $function$
  WITH t AS (
    -- 🔴 逐詞編號 ⇒ 下面用「不同詞的個數」判斷「每個詞都中了」
    --    `WITH ORDINALITY` 讓重複的詞不會被摺疊成一個(打兩次同一個字仍是一個條件)
    -- 🔵 `pat` = 逃脫後的完整 LIKE 樣式, **在這裡算一次、下面三處引用**。
    --    三層 replace 的順序有意義(先 `\` 再 `%` 再 `_`)⇒ 抄成三份會各自漂;
    --    而抽成 SQL 函式是一支**新 DB 物件**(GRANT/REVOKE/審查全部跟著來)⇒ 用 CTE 欄位。
    SELECT DISTINCT ON (term) term, ord,
           '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
      FROM unnest(coalesce(p_terms, ARRAY[]::text[])) WITH ORDINALITY AS u(term, ord)
     -- 空字串 / 全空白的詞丟掉 —— 留著會變成 `%%` 而那會命中全部
     WHERE btrim(term) <> ''
  ),
  n AS (SELECT count(*)::bigint AS want FROM t),
  -- ── ② 品牌:先自己撈, 再用 brand_id 回去比 ────────────────────────────
  -- 🔴🔴 **這一塊存在的唯一理由就是「不要讓 b.name 出現在 products 的 OR 裡」。**
  --    ⛔ ~~`LEFT JOIN brands b … OR b.name ILIKE …`~~ ⇒ 跨表欄位進 OR
  --       ⇒ planner 只能先 join 再過濾 ⇒ **products 上的索引全部用不到**(正式站 249.1ms)
  --    ⇒ 📌 下一個人「簡化」它回去合併成一個 OR:三綠全綠、行為零改變、而中文搜尋回到 243ms。
  bh AS (
    SELECT t.ord, br.id AS brand_id
      FROM public.brands br
      JOIN t ON br.name ILIKE t.pat
  ),
  -- ── hits:三塊各吐 `(id, ord)`, UNION ALL 在【(商品, 詞)】那一層 ──────────
  -- 🛑 **不可以搬到商品那一層**(理由見檔頭「UNION 的層級是正確性核心」)。
  hits AS (
    -- ① 四欄 OR:純 products_public 欄位、零跨表 ⇒ BitmapOr 吃得到 trgm
    SELECT p.id, t.ord
      FROM public.products_public p
      JOIN t ON (
           p.title       ILIKE t.pat
        OR p.subtitle    ILIKE t.pat
        OR p.description ILIKE t.pat
        OR p.external_id ILIKE t.pat
      )
    UNION ALL
    -- ② 品牌
    SELECT p.id, bh.ord
      FROM public.products_public p
      JOIN bh ON p.brand_id = bh.brand_id
    UNION ALL
    -- ③ ⟦search-PARTNOSEPINDIGITS⟧ 料號:兩端都正規化, 再比【前綴】
    -- 🔴🔴 **三個條件缺一不可, 而少了第一個會【回傳整張表】**:
    --    ① `regexp_replace(term) <> ''` —— 中文詞正規化之後是**空字串**,
    --       而 `LIKE '' || '%'` = `LIKE '%'` ⇒ **命中每一列**。
    --       ⇒ 📌 客人打「油箱貼」就會拿到全站商品, 而 HTTP 200、畫面完全正常。
    --    ② 詞裡**同時**有字母與數字 —— 少了它, 打 `a` ⇒ 前綴 `A%` ⇒ 命中所有 A 開頭的料號。
    --    ③ 用 `LIKE` 不是 `ILIKE` —— 兩端都已經 `upper()` 過了。
    -- 🔵 **不需要 escape**:正規化把 `%` `_` `\` 全都當成非英數刪掉了 ⇒ 構造不出萬用字元。
    -- 🔴 **順序刻意:兩個便宜的 `~` 排在最前面** —— 中文搜尋佔多數而它們一定不含數字。
    --    🔬 而正式站的 EXPLAIN 現在替這段註解背書:中文詞下這一塊印 **`never executed`**。
    SELECT p.id, t.ord
      FROM public.products_public p
      JOIN t ON (
             t.term ~ '[0-9]'
         AND (
               t.term ~ '[A-Za-z]'
            -- 🔴 2026-09-04 加的第二條路:【夠長的純數字】也算料號
            --    門檻 7 的來源與爆炸半徑量測 ⇒ 見本檔檔頭「門檻為什麼是 7 不是 9」
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7
             )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND upper(regexp_replace(p.external_id, '[^A-Za-z0-9]', '', 'g'))
             LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
      )
  )
  SELECT h.id
    FROM hits h
    CROSS JOIN n
   WHERE n.want > 0            -- 🔴 零個有效詞 ⇒ 回零列(不是回全表)
   GROUP BY h.id, n.want
  -- 🔴🔴 **這個 `DISTINCT` 是承重的, 不是冗贅。** 拿掉 ⇒ 同一對從多塊各來一次 ⇒ 多算
  --    ⇒ `= want` 不成立 ⇒ 那一列被【丟掉】⇒ **客人打料號拿到 0 筆**(變窄, 不是放寬)。
  --    ⇒ 📌 而「拿到 0 筆」不會有人回報, 他只會覺得我們沒賣。
  HAVING count(DISTINCT h.ord) = n.want;
$function$;

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- ⚠️ 兩份清單都空是**明示**:本檔沒有新建任何可授權物件 —— 它 REPLACE 一支既有函式,
  --    而 `CREATE OR REPLACE FUNCTION` 保留既有 ACL ⇒ 沒有新的收權面。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_acl  text;
  v_cnt  bigint;
  v_all  bigint;
  v_code text;
  r      record;
BEGIN
  IF cardinality(v_relations) <> 0 OR cardinality(v_functions) <> 0 THEN
    RAISE EXCEPTION '收權斷言:本檔宣稱不新建物件, 而清單非空 ⇒ 兩者矛盾, 停下來看。';
  END IF;

  -- ── ① 字面:新條件真的在庫上那支裡(兩種註解都剝掉再看)──────────────────
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g')
    INTO v_code
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  -- 🛑 **這裡刻意【不數次數】** —— 期望值若是「出現 N 次」, 那個 N 是我照著自己要寫的碼數出來的,
  --    ⇒ 它從出生起就不可能抓到我寫錯的東西。(2026-09-04 多顆膠囊那支第一版就是這樣失敗的。)
  -- 🔴 **而字面閘本來就【擋不住門檻寫錯】** —— 那件事由下面的 ⑥ 用 7 位 / 8 位判別詞擋。
  IF position('length(regexp_replace(t.term' IN v_code) = 0 THEN
    RAISE EXCEPTION '事後閘①:長度門檻那個條件不在庫上那支裡 ⇒ REPLACE 沒有貼上我以為的東西。';
  END IF;

  -- ── ② ACL:REPLACE 不該動授權 ──────────────────────────────────────────
  SELECT coalesce(p.proacl::text, '') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF v_acl = '' THEN
    RAISE EXCEPTION '事後閘②⓪:proacl 是 NULL ⇒ 既有授權被吹掉了, 等於 PUBLIC 叫得動';
  END IF;
  IF v_acl LIKE '%{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION '事後閘②a:PUBLIC 出現在 ACL 裡 ⇒ %', v_acl;
  END IF;
  IF NOT has_function_privilege('anon', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②b:anon 執行不到 ⇒ 顧客站會拿不到結果';
  END IF;
  -- 🔵 負對照:一個沒被 GRANT 的角色必須執行不到 —— 否則上面那個 true 沒有判別力
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcm_readonly')
     AND has_function_privilege('pcm_readonly', 'public.storefront_search_product_ids(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘②c:pcm_readonly 也執行得到 ⇒ 上面那個 anon=true 沒有判別力';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='storefront_search_product_ids' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION '事後閘②d:本支是 SECURITY DEFINER ⇒ 那是把客人的查詢升權';
  END IF;
  -- 🔴 ②e 屬性不得被 REPLACE 吹掉(與前置閘③b 成對:那道問「貼之前是什麼」, 這道問「貼完還是不是」)
  SELECT p.provolatile, p.proparallel, p.procost, p.prorows,
         p.proconfig, p.proleakproof, p.proisstrict
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storefront_search_product_ids';
  IF r.provolatile <> 's' OR r.proparallel <> 'u' OR r.procost <> 100 OR r.prorows <> 1000
     OR r.proconfig IS NOT NULL OR r.proleakproof OR r.proisstrict THEN
    RAISE EXCEPTION '事後閘②e:函式屬性被改掉了(volatile=% parallel=% cost=% rows=% config=% leakproof=% strict=%)⇒ REPLACE 吹掉了原本的設定。',
      r.provolatile, r.proparallel, r.procost, r.prorows, r.proconfig, r.proleakproof, r.proisstrict;
  END IF;

  -- ── ③ 原有的兩端行為閘照抄(空詞不得回全表 / 字面 % 不得當萬用字元 / 正對照)──
  SELECT count(*) INTO v_all FROM public.products_public;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(ARRAY[]::text[]);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘③a:空詞回了 % 列(期望 0)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(ARRAY['%']);
  IF v_cnt = v_all THEN
    RAISE EXCEPTION '事後閘③b:`%%` 回了全表 % 列 ⇒ 逃脫沒生效', v_all;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(
    ARRAY[(SELECT substr(title, 1, 4) FROM public.products_public
            WHERE title IS NOT NULL AND length(title) >= 4 ORDER BY id LIMIT 1)]);
  IF coalesce(v_cnt, 0) = 0 THEN
    RAISE EXCEPTION '事後閘③c:正對照 —— 拿一筆真商品標題前四個字去搜回了 0 列 ⇒ 這支對什麼都回 0 ⇒ ③a/③b 沒有判別力';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.storefront_search_product_ids(
    ARRAY[(SELECT external_id FROM public.products_public
            WHERE external_id ~ '[0-9]' AND external_id ~ '[A-Za-z]'
            ORDER BY id LIMIT 1)]);
  IF coalesce(v_cnt, 0) = 0 THEN
    RAISE EXCEPTION '事後閘③d:拿一筆真料號去搜回了 0 列 ⇒ HAVING 的 DISTINCT 掉了';
  END IF;

  -- ── ⑥ 🔴🔴 **兩個世界各餵一發 —— 貼前 vs 貼後, 逐詞比對【筆數與 id 集合】** ──────
  --    🎯 它同時證明「該修好的修好了」與「該不動的沒動」, 而**兩邊都要**成立:
  --       只驗前者的話, 一個「全數字通通放行」的實作也會全綠。
  --    🔴 **`0102245`(7 位)與 `01022450`(8 位)是門檻本身的判別詞** ——
  --       少了它們, 一個寫成 `>= 9` 的實作**全綠**(codex 2026-09-04 must-fix)。
  --    🔴 **比 id 不只比筆數** —— 換了一批同數量的商品, 只比筆數會全綠(同一條 must-fix)。
  FOR r IN
    SELECT b.term, b.expect, b.n AS n_before, b.ids AS ids_before,
           (SELECT count(*) FROM public.storefront_search_product_ids(ARRAY[b.term])) AS n_after,
           (SELECT md5(coalesce(string_agg(s.id::text, ',' ORDER BY s.id), ''))
              FROM public.storefront_search_product_ids(ARRAY[b.term]) s)            AS ids_after
      FROM _partno_before b
     ORDER BY b.term
  LOOP
    IF r.expect = 'fix' THEN
      IF r.n_before <> 0 THEN
        RAISE EXCEPTION '事後閘⑥a:`%` 在貼之前就回了 % 列 ⇒ 前提不成立(它本來就撈得到)⇒ 停下來重新量, 不要照貼。', r.term, r.n_before;
      END IF;
      IF r.n_after <> 1 THEN
        RAISE EXCEPTION '事後閘⑥b:`%` 貼完回了 % 列(期望 1)⇒ 門檻沒有落在 7, 或修法沒有落在目標上。', r.term, r.n_after;
      END IF;
    ELSIF r.expect = 'zero' THEN
      IF r.n_after <> 0 THEN
        RAISE EXCEPTION '事後閘⑥c:負對照 `%` 貼完回了 % 列(期望 0)⇒ 放寬變成了亂撈。', r.term, r.n_after;
      END IF;
    ELSE
      IF r.n_before <> r.n_after THEN
        RAISE EXCEPTION '事後閘⑥d:短詞 `%` 的筆數變了(% ⇒ %)⇒ 門檻沒有守住, 短的被拖進料號那條路了。', r.term, r.n_before, r.n_after;
      END IF;
      IF r.ids_before <> r.ids_after THEN
        RAISE EXCEPTION '事後閘⑥e:短詞 `%` 的【筆數一樣而 id 集合換了】⇒ 它換了一批商品, 而只比筆數看不出來。', r.term;
      END IF;
    END IF;
  END LOOP;

  -- 🔵 而 ⑥ 自己也需要一格正對照:上面那張表若是空的, 整個 LOOP 一次都不跑而全綠。
  SELECT count(*) INTO v_cnt FROM _partno_before;
  IF v_cnt <> 10 THEN
    RAISE EXCEPTION '事後閘⑥f:貼前那張量測表有 % 列(期望 10)⇒ ⑥ 的 LOOP 沒有跑完該跑的世界 ⇒ 它的綠沒有判別力。', v_cnt;
  END IF;
  -- 🔵 而「四個 fix 世界都在」也要有一格 —— 少了任何一個, 門檻就少一個判別點。
  SELECT count(*) INTO v_cnt FROM _partno_before WHERE expect = 'fix';
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION '事後閘⑥g:fix 類的世界只有 % 個(期望 4:9 位 / 11 位 / 7 位 / 8 位)⇒ 門檻本身沒有被釘住。', v_cnt;
  END IF;
END
$$;

COMMIT;
