-- 20260928250000_m4b_product_read_indexes.sql —— 商品讀取的兩個索引(網站正式庫)
-- pcm:idempotent: yes
--   ↑ 重貼同形:兩支索引先查在不在, 在就核對定義後跳過;不在才建。
-- M-4b · 施工窗 86(主視窗 pcm-website-v2-a0 派)· Sean 2026-09-28 Q0 甲 / Q1 甲(三件都做)
-- 🛑 未貼。只寫不貼, 貼的人是主視窗(Sean 授權後)。
-- 計畫:~/pcm-mailbox/計畫-網站資料庫索引與清理-20260928.md 第一、二、四節(五輪審查紀錄在文末)
--
-- ══ 為什麼 ══════════════════════════════════════════════════════════
-- ① products (brand_id, handle):慢查詢第 1 名(同品牌推薦池 `brand_id = ? ORDER BY handle LIMIT 800`)
--    今天沿著網址代稱索引一路讀, 為了湊 800 筆同品牌丟掉 19,699 筆別的品牌(2026-09-28 正式庫 EXPLAIN:
--    76 ms、27,637 區塊)。只對第 1 名有效;第 2 名(再加分類)用不到它。
-- ② product_variants (product_id) WHERE 有特價或一般價空:products_public / products_list_public
--    (20260928230000 P-M4)算代表價的子查詢 `sv.sale_price_general IS NOT NULL OR sv.price_general IS NULL`
--    沒有索引可用 ⇒ 每一次讀到價格欄的商品查詢都整張掃規格表(正式庫單件商品查詢 31 ms, 其中 30 ms、
--    5,848 區塊、66,630 列找到 0 列)。有了它, 那一段只讀一個幾乎空的小索引。
--    🔴 本索引的 WHERE 要能涵蓋 view 子查詢的條件, 資料庫才會用它(對調順序照樣用;多加第三個「或」就不用)。
--       改 view 那段條件的人要一起看這支索引 ⇒ 索引本身掛 COMMENT 寫明它服務哪兩個 view 的哪一段(不為了加註解重建 view)。
--
-- ══ 鎖與時段(計畫第四節;R3 必修 1)══════════════════════════════════
--   · 不用 CONCURRENTLY:貼板每一支都是 BEGIN…COMMIT(先例 20260907120000、20260916110000)。
--   · 一開始 LOCK TABLE products, product_variants IN SHARE MODE NOWAIT:兩張一起拿、拿不到就立刻放棄
--     (整包回滾、什麼都沒改, 換時間再貼)。避免和後台改價(先鎖列、再寫規格、寫商品)互等。
--     拿不到不一定是有人在寫 —— 自動整理(autovacuum / 統計更新)也會讓這一句失敗, 隔幾分鐘重貼通常就過。
--   · 拿到之後:讀不受影響(客人瀏覽、結帳照常);寫入等施工結束。後台經資料庫 API 寫入最多等 8 秒,
--     施工超過 8 秒時剛好按儲存的那一筆會失敗(原始逾時訊息)⇒ 排台灣凌晨 02:00–05:00。
--     避開商品每日同步(台灣 12:30 起)與供應商同步(台灣 17:31–17:53)。
--   · 本機拋棄式 PG(22 MB / 25 MB 的表)建兩支 17 ms + 7 ms;正式庫 154 MB / 72 MB ⇒ 推估合計 1 秒內(未證實, 貼完看耗時)。
--   · statement_timeout 60s 是【每一句】的上限, 不是整段;正式庫 postgres 角色沒有預設值, 所以要寫。
--   · 失敗整包回滾, 不會留下壞掉的半成品索引(那只有 CONCURRENTLY 會)。
--
-- ══ 事後閘(R3 必修 2)══════════════════════════════════════════════
--   只驗索引存在、可用(indisvalid / indisready)、定義與計畫相同。
--   查詢計畫(有沒有真的用到)不在這裡驗:它隨資料分布改變, 放在鎖住的交易裡也會拉長擋寫入的時間
--   ⇒ 貼完另外跑唯讀檢查(計畫第二、五節)。
--
-- ══ 貼板 ════════════════════════════════════════════════════════════
--   · 跟網站程式無關的板 ⇒ 照 CLAUDE.md「貼板與推的順序」:等推 main 那一發跑完再貼。
--   · 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260928250000)。索引不改權限, 照慣例跑。
--   · 不用 NOTIFY pgrst(沒有改函式或 view)。
-- ══ rollback ══════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句, rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260928250000-rollback.sql:DROP 兩支索引。
--   🔴 DROP INDEX(非 CONCURRENTLY)會把表【完全鎖住, 連讀都擋】, 而且排在進行中的長查詢後面 ⇒ 同樣凌晨、同樣 NOWAIT。
--   退回後查詢回到今天的速度;索引不改變查詢結果, 退回不影響正確性。
-- ════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 兩張表一起拿鎖, 拿不到就放棄(不等)──────────────────────────
LOCK TABLE public.products, public.product_variants IN SHARE MODE NOWAIT;

-- ── 1. 前置閘 ───────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.products') IS NULL OR pg_catalog.to_regclass('public.product_variants') IS NULL THEN
    RAISE EXCEPTION '前置閘:products / product_variants 不在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.product_variants'::regclass AND attname = 'sale_price_general' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘:product_variants.sale_price_general 不在(20260928200000 P-M1 還沒貼)';
  END IF;
END
$pre$;

-- ── 2. 建索引(已在就核對定義, 不在才建)─────────────────────────────
-- 🔴 不用 CREATE INDEX IF NOT EXISTS:同名而建在別張表 / 別的欄 / 別的條件的索引, 它會安靜跳過(先例 20260907120000:76-80)。
DO $build$
BEGIN
  IF pg_catalog.to_regclass('public.products_brand_id_handle_idx') IS NULL THEN
    CREATE INDEX products_brand_id_handle_idx ON public.products (brand_id, handle);
  END IF;
  IF pg_catalog.to_regclass('public.product_variants_sale_or_null_general_idx') IS NULL THEN
    CREATE INDEX product_variants_sale_or_null_general_idx
      ON public.product_variants (product_id)
      WHERE sale_price_general IS NOT NULL OR price_general IS NULL;
  END IF;
END
$build$;
COMMENT ON INDEX public.product_variants_sale_or_null_general_idx IS
  '20260928250000:服務 products_public / products_list_public 代表價子查詢 (sv.sale_price_general IS NOT NULL OR sv.price_general IS NULL)。改那段條件時要一起改本索引的 WHERE,否則資料庫安靜地不再用它、退回整張掃規格表。';
COMMENT ON INDEX public.products_brand_id_handle_idx IS
  '20260928250000:同品牌依網址代稱排序(推薦同品牌池 brand_id = ? ORDER BY handle LIMIT n)。';

-- ── 3. 事後閘:存在、可用、定義正確 ─────────────────────────────────
DO $post$
DECLARE
  v_def text;
  v_valid boolean;
  v_ready boolean;
BEGIN
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid), i.indisvalid, i.indisready INTO v_def, v_valid, v_ready
    FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.products_brand_id_handle_idx');
  IF v_def IS DISTINCT FROM 'CREATE INDEX products_brand_id_handle_idx ON public.products USING btree (brand_id, handle)' THEN
    RAISE EXCEPTION '事後閘①a:products_brand_id_handle_idx 定義不對或不在:%', v_def;
  END IF;
  IF NOT (v_valid AND v_ready) THEN
    RAISE EXCEPTION '事後閘①b:products_brand_id_handle_idx 存在而不可用(indisvalid=% indisready=%)', v_valid, v_ready;
  END IF;

  SELECT pg_catalog.pg_get_indexdef(i.indexrelid), i.indisvalid, i.indisready INTO v_def, v_valid, v_ready
    FROM pg_catalog.pg_index i WHERE i.indexrelid = pg_catalog.to_regclass('public.product_variants_sale_or_null_general_idx');
  IF v_def IS DISTINCT FROM 'CREATE INDEX product_variants_sale_or_null_general_idx ON public.product_variants USING btree (product_id) WHERE ((sale_price_general IS NOT NULL) OR (price_general IS NULL))' THEN
    RAISE EXCEPTION '事後閘②a:product_variants_sale_or_null_general_idx 定義不對或不在:%', v_def;
  END IF;
  IF NOT (v_valid AND v_ready) THEN
    RAISE EXCEPTION '事後閘②b:product_variants_sale_or_null_general_idx 存在而不可用(indisvalid=% indisready=%)', v_valid, v_ready;
  END IF;
  RAISE NOTICE '事後閘 ok:兩支索引存在、可用、定義正確。查詢計畫請貼完另外跑唯讀檢查。';
END
$post$;

COMMIT;
