-- ============================================================
-- 20260820080000_dna_intake_and_oil_filter_categories
--   顧客站補上「進氣系統」大類 + 5 子類,以及「引擎與冷卻 · 機油與濾芯」子類。
--
-- Sean 2026-08-20 裁「要」(主視窗轉;報價單側的原始拍板見下方出處)。
--
-- ── 出處(引來源 migration 的檔名,不引任何人的口述)──────────────────────────
--   報價單 repo `pcm-quote-v2`,兩支皆已 push:
--     `supabase/migrations/20260819230000_dna_taxonomy_v2.sql`
--       新開大類「進氣系統」+ 四子類 + category_taxonomy_map 五列
--     `supabase/migrations/20260820120000_consumable_flag_and_dna_subcats.sql`
--       加 is_consumable 欄、新子類「機油與濾芯」「管束配件」、map 補 oil filter / clamp 兩列
--   結構匯出(含每一列的筆數與陷阱說明):`~/pcm-mailbox/DNA-分類結構匯出-給網站側.md`
--
-- ── 🔴 兩個大類都要動,不是一個 ──────────────────────────────────────────
--   `機油與濾芯` 掛在 **引擎與冷卻**,不是進氣系統(來源匯出逐字:
--   「機油濾芯跟進氣無關,客人點進氣系統看到機油濾芯是錯的」)。那批 34 筆在那裡。
--
-- ── 🔴 本檔【不做】三件,而每一件都有理由 ────────────────────────────────
--   ① **不建 `category_taxonomy_map`** —— 那張表**顧客站沒有**。
--      實查:`grep -rl 'category_taxonomy_map' supabase/migrations/*.sql` ⇒ **0**
--      ⇒ 那整套「來源分類名 → v2 分類」的映射機制只活在報價單那一側;
--        網站這邊的對應是靠 `categories.raw_path` 逐字比對(見下)。
--      🔴 **所以不要照抄來源的表結構** —— 來源用的是 `taxonomy_v2_major` / `taxonomy_v2_sub`,
--        網站這邊是**單一 `categories` 表 + `parent_category_id` 兩層**。
--   ② **不加 `is_consumable`** —— 來源匯出逐字把它標成「**你們要不要跟進自行判斷**」。
--      那是一個**產品決策**(要不要做耗材篩選頁),不是這一片的範圍。
--      ⇒ 本檔不替它決定,也不預留欄位。**要做的時候它是獨立一片。**
--   ③ **不寫任何一列 `products`** —— 商品怎麼掛進來由匯入端決定(見下方 §0 的指紋斷言)。
--
-- ── 🔴 raw_path 必與來源逐字相同 ─────────────────────────────────────────
--   `20260703120000_p0b_seed_16_major_categories.sql:19-20` 逐字:「否則 per-group resolve
--   對不上…原樣、不清洗」。分隔符 = 半形空格 + U+00B7 + 半形空格,須與 storefront
--   `products-filter-logic.ts` 的 `CATEGORY_PATH_SEP` 一致。
--   ⇒ 本檔的 6 個子類 raw_path 全部照「大類 · 子類」的既有慣例組。
--
-- ── 🔴 為什麼 sort=65 ────────────────────────────────────────────────────
--   來源逐字:「刻意插在『引擎與冷卻』(60) 與『車身防護與防摔』(70) 之間,
--   **不動既有 14 個大類的 sort_order**」⇒ 本檔照做,而下方斷言④會驗那 14 個真的沒動。
--
-- ── 交易語意:整支是**單一 `DO` 區塊 = 單一語句** ───────────────────────────
--   照 `20260811120000_m4b_storefront_412_service_other_category.sql` 的收斂結論(該檔繞了三圈):
--   不論執行端是逐句 autocommit、`psql -1`、還是自己包交易,**它都是原子的**;
--   失敗就整段不生效,而且不干涉外層交易邊界。⇒ 不用暫存表、不寫檔內 BEGIN/COMMIT。
--
-- ── 收斂式(不是差量式)─────────────────────────────────────────────────
--   `ON CONFLICT (raw_path) DO UPDATE` ⇒ 起始狀態不論是「都沒有」「部分有」「已建好」,
--   終態都一樣、可重播,空叢集從零重放也不會炸。
--
-- ── 🔴 兩格斷言的射程(突變實測後寫的,不要讀成比它們能證的更多)──────────────
--   · 零回歸那格守的是「**本檔自己**沒動既有大類的 sort」,**不是**「它們沒被別人動過」
--     (before 快照在本次執行內取)⇒ 它是縱深,不是漂移偵測。
--   · products 指紋守的是「沒有商品的 `category_id` 被改、沒有商品被新增或刪除」,
--     **商品的其他欄位它抓不到** —— 那要靠讀這支檔本身(全檔零 products 的寫入敘述)。
--   · 而我原本寫的第三道(「parent 掛錯要紅」)**已拿掉** —— 突變實測顯示它在那個位置恆真,
--     因為上面的 upsert 會先把 parent 修回來。理由留在 §3③ 的原地。
--
-- ⛔ apply 停點:本檔 commit 後**不 apply**。apply 要 Sean 在場。
-- ⚠️ 而**這一片與取消訂單那個上線包無關** —— 它是 DNA 上架那條線,不要混進那份清單。
-- ============================================================

DO $mig$
DECLARE
  v_before_n   bigint;
  v_before_fp  text;
  v_after_n    bigint;
  v_after_fp   text;
  v_top_sorts_before text;
  v_top_sorts_after  text;
  v_intake_id  uuid;
  v_engine_id  uuid;
  v_subs       bigint;
BEGIN

-- ── 0. 寫入前基準:products 全表指紋 + 既有大類的 sort 指紋 ────────────────
-- 🔴 形狀照 20260811120000 的收斂結論:**存完整 ordered serialization,不是它的 md5**
--    (md5 會碰撞;而 string_agg 本來就要先組出完整字串,直接比不多花記憶體)。
-- ⚠️ **它證得到什麼、證不到什麼**:守的是「沒有任何商品的 category_id 被改、沒有商品被新增或刪除」。
--    商品的其他欄位若被改它抓不到 —— 那要靠讀這支檔本身(全檔零 products 的 INSERT/UPDATE/DELETE)。
--    **不要把它引用成「零 products 寫入」的全稱證明。**
SELECT count(*),
       coalesce(string_agg(p.id::text || ':' || p.category_id::text, ',' ORDER BY p.id), '')
  INTO v_before_n, v_before_fp
  FROM products p;

-- 既有大類的 (raw_path, sort_order) 指紋 —— 排除本檔要新增的那一顆。
SELECT coalesce(string_agg(c.raw_path || '=' || c.sort_order::text, ',' ORDER BY c.raw_path), '')
  INTO v_top_sorts_before
  FROM categories c
 WHERE c.parent_category_id IS NULL
   AND c.raw_path <> '進氣系統';

-- ── 1. 大類:進氣系統(sort 65)──────────────────────────────────────────
INSERT INTO categories (name, raw_path, parent_category_id, sort_order, segments)
VALUES ('進氣系統', '進氣系統', NULL, 65, to_jsonb(ARRAY['進氣系統']))
ON CONFLICT (raw_path) DO UPDATE
  SET name = EXCLUDED.name,
      parent_category_id = EXCLUDED.parent_category_id,
      sort_order = EXCLUDED.sort_order,
      segments = EXCLUDED.segments;

-- ── 2. 子類:進氣系統 5 個 + 引擎與冷卻 1 個 ───────────────────────────────
-- parent 用 raw_path lookup(照 20260712120000 的既有形狀),而不是寫死 uuid。
INSERT INTO categories (name, raw_path, parent_category_id, sort_order, segments)
SELECT v.name, v.raw_path, m.id, v.sort_order,
       to_jsonb(string_to_array(v.raw_path, ' · '))
FROM (VALUES
  -- 來源:20260819230000_dna_taxonomy_v2.sql(四子類)+ 20260820120000(管束配件)
  ('空氣濾芯',   '進氣系統 · 空氣濾芯',   '進氣系統',   10),
  ('進氣上蓋',   '進氣系統 · 進氣上蓋',   '進氣系統',   20),
  ('進氣套件',   '進氣系統 · 進氣套件',   '進氣系統',   30),
  ('濾芯保養品', '進氣系統 · 濾芯保養品', '進氣系統',   40),
  ('管束配件',   '進氣系統 · 管束配件',   '進氣系統',   50),
  -- 🔴 這一個掛【引擎與冷卻】,不是進氣系統。sort 70 接在既有的「引擎精品件」(60) 之後。
  ('機油與濾芯', '引擎與冷卻 · 機油與濾芯', '引擎與冷卻', 70)
) v(name, raw_path, parent_raw_path, sort_order)
JOIN categories m ON m.raw_path = v.parent_raw_path AND m.parent_category_id IS NULL
ON CONFLICT (raw_path) DO UPDATE
  SET name = EXCLUDED.name,
      parent_category_id = EXCLUDED.parent_category_id,
      sort_order = EXCLUDED.sort_order,
      segments = EXCLUDED.segments;

-- ── 3. 斷言:兩個世界都要驗(套之前不存在、套之後存在且掛對) ────────────────
-- ① 大類在,而且是頂層、sort 對
SELECT c.id INTO v_intake_id
  FROM categories c
 WHERE c.raw_path = '進氣系統' AND c.parent_category_id IS NULL AND c.sort_order = 65;
IF v_intake_id IS NULL THEN
  RAISE EXCEPTION 'DNA 分類:大類「進氣系統」不存在 / 不是頂層 / sort 不是 65;拒繼續';
END IF;

SELECT c.id INTO v_engine_id
  FROM categories c
 WHERE c.raw_path = '引擎與冷卻' AND c.parent_category_id IS NULL;
IF v_engine_id IS NULL THEN
  RAISE EXCEPTION 'DNA 分類:大類「引擎與冷卻」不存在 ⇒ 機油與濾芯無處可掛;拒繼續(它是既有的,不該不見)';
END IF;

-- ② 六個子類都在,而且 parent 掛對
--    🔴 這裡驗的是 **parent_category_id**,不是 raw_path 的字串前綴 ——
--    後者只要名字取對就會通過,而**掛錯 parent 的那一列,raw_path 照樣長得對**。
SELECT count(*) INTO v_subs
  FROM categories c
 WHERE (c.raw_path LIKE '進氣系統 · %' AND c.parent_category_id = v_intake_id)
    OR (c.raw_path = '引擎與冷卻 · 機油與濾芯' AND c.parent_category_id = v_engine_id);
IF v_subs <> 6 THEN
  RAISE EXCEPTION 'DNA 分類:預期 6 個子類掛對 parent,實得 %;拒繼續', v_subs;
END IF;

-- ③ ~~反面:沒有任何一列 raw_path 對而 parent 掛錯~~ 🔴 **拿掉了 —— 它在這個位置是恆真的**
--    2026-08-20 突變實測:我先把「機油與濾芯」搬去掛進氣系統,再跑本檔 ⇒ **綠**。
--    成因不在它的內容,**在它的位置**:上面 §2 的 `ON CONFLICT (raw_path) DO UPDATE`
--    會**先把 parent 修回來**,斷言才跑 ⇒ 它永遠看不到掛錯的那一列。
--    ⇒ 而「upsert 沒跑到」那個世界已經被 ② 蓋住了(JOIN 找不到 parent ⇒ 那列插不進去 ⇒ 數量 < 6)。
--    📌 **一個斷言的判別力不在它寫了什麼,在它跑在什麼時候** —— 今晚我第三次在自己的檔裡種到這個。

-- ④ 零回歸:既有大類的 sort_order 一個都沒動(sort=65 是插進去的,不是擠開別人)
--    🔴 **射程要寫準(2026-08-20 突變實測打到)**:before 快照是在**本次執行內**取的
--    ⇒ 它守的是「**本檔自己**沒動它們」,**不是**「它們沒被別人動過」。
--    實測:我在跑之前先把「引擎與冷卻」改成 61 ⇒ 本檔**不紅**(因為 before 也是 61)。
--    ⇒ 這一格留著是**縱深**(擋未來有人在本檔裡加一句 UPDATE),不是漂移偵測。
--    要偵測外部漂移得把期望值釘成字面清單 —— 而那是一份會過期的枚舉,**本檔刻意不做**。
SELECT coalesce(string_agg(c.raw_path || '=' || c.sort_order::text, ',' ORDER BY c.raw_path), '')
  INTO v_top_sorts_after
  FROM categories c
 WHERE c.parent_category_id IS NULL
   AND c.raw_path <> '進氣系統';
IF v_top_sorts_after IS DISTINCT FROM v_top_sorts_before THEN
  RAISE EXCEPTION 'DNA 分類:既有大類的 sort_order 被動到了;拒繼續。before=[%] after=[%]',
                  v_top_sorts_before, v_top_sorts_after;
END IF;

-- ⑤ 零 products 異動(見 §0 的誠實邊界)
SELECT count(*),
       coalesce(string_agg(p.id::text || ':' || p.category_id::text, ',' ORDER BY p.id), '')
  INTO v_after_n, v_after_fp
  FROM products p;
IF v_after_n <> v_before_n OR v_after_fp IS DISTINCT FROM v_before_fp THEN
  RAISE EXCEPTION 'DNA 分類:products 的 (id, category_id) 映射被改動了(before n=% md5=%, after n=% md5=%);拒繼續',
                  v_before_n, md5(v_before_fp), v_after_n, md5(v_after_fp);
END IF;

RAISE NOTICE 'DNA 分類:進氣系統(65)+ 5 子類、引擎與冷卻 · 機油與濾芯(70)已就位;既有大類 sort 與 products 映射零異動';
END
$mig$;

-- ── Rollback(Supabase forward-only;手動,僅供參考)──────────────────────────
--   ⚠️ **刪之前先確認那 6 個分類底下沒有商品** —— `products.category_id` 是 NOT NULL + FK,
--      有商品掛著時 DELETE 會被 FK 擋(那是好事,不要為了刪得掉而先搬商品)。
--   DELETE FROM categories WHERE raw_path IN (
--     '進氣系統 · 空氣濾芯','進氣系統 · 進氣上蓋','進氣系統 · 進氣套件',
--     '進氣系統 · 濾芯保養品','進氣系統 · 管束配件','引擎與冷卻 · 機油與濾芯');
--   DELETE FROM categories WHERE raw_path = '進氣系統';
