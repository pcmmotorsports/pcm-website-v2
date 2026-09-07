-- ═══════════════════════════════════════════════════════════════════════════
-- 貼板 83r · QB-12 還原 —— 把那一格 price_store 清回 NULL
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **本檔可以單獨跑** —— 不依賴 83 的任何變數或狀態, 貼進 SQL Editor 就會動。
-- 🛑 純 SQL, 不含 psql meta 指令。
--
-- 🔴🔴 **它是【帶條件】的還原, 而那個條件不是形式**:
--    `AND price_store = 87` —— 若那一格已經不是 87(有人改過、或 83 根本沒生效),
--    本檔**什麼都不做並且印出來**, 而不是安靜地寫 NULL。
--    ⇒ 📌 **「還原」與「把別人剛寫的值清掉」在一個【無條件】的 UPDATE 上長得一模一樣。**
--      而它們的後果差很多:前者是收工, 後者是事故。
--
-- 🔵 為什麼**不需要**「貼前擷取前一代」那一套(`⟦db-NOROLLBACKARTIFACT⟧`):
--    本次改的是**一格資料**不是一個物件定義 —— 而它的前一代是 `NULL`, 那是**寫得出來的**。
--    ⇒ 📌 那條規則講的是 `CREATE OR REPLACE`(前一代被覆蓋、事前寫不出來), 不是這一種。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $qb12r$
DECLARE
  c_variant constant uuid    := '73537121-9739-4e0a-9263-9c0533f98e41';
  c_price   constant integer := 87;
  v_n       integer;
  v_now     integer;
  v_filled  integer;
BEGIN
  SELECT price_store INTO v_now FROM public.product_variants WHERE id = c_variant;

  UPDATE public.product_variants
     SET price_store = NULL
   WHERE id = c_variant
     AND price_store = c_price;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    -- 🛑 **不是錯誤, 而必須被看見** —— 什麼都沒做的時候, 沉默與成功長得一樣。
    RAISE WARNING '83r 沒有動任何一列:variant % 現在的 price_store = %(不是 %)。
  ⇒ 可能是 ①83 沒有生效 ②已經還原過 ③有別人改過它。
  🛑 本檔【刻意不強制清成 NULL】—— 那會把別人剛寫的值清掉。請人判之後再手動處理。',
      c_variant, coalesce(v_now::text,'(NULL)'), c_price;
  ELSIF v_n <> 1 THEN
    RAISE EXCEPTION '83r fail-closed:動到 % 列(必須 0 或 1)⇒ 整片回捲', v_n;
  ELSE
    RAISE NOTICE '83r 已還原:variant % 的 price_store % ⇒ NULL', c_variant, c_price;
  END IF;

  -- ── 收工釘:全庫 price_store 非空的必須回到 1(= 儲值那筆)────────────
  --   🔴 只有在【真的還原了】的那一路才釘 —— v_n = 0 那一路本來就沒動,
  --     它的數可能是 1(已還原過)也可能是 2(83 生效而值被改成別的), 兩種都要人看。
  IF v_n = 1 THEN
    SELECT count(*) INTO v_filled FROM public.product_variants WHERE price_store IS NOT NULL;
    IF v_filled <> 1 THEN
      RAISE EXCEPTION '83r 收工釘失敗:price_store 非空的是 % 筆(預期 1)⇒ 整片回捲', v_filled;
    END IF;
    RAISE NOTICE '83r 收工釘過:price_store 非空的回到 1 筆。';
  END IF;
END $qb12r$;

COMMIT;
