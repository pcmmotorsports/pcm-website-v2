-- ⟦#858 / :746⟧ 手動建單「查商品」那一格的種子 —— shop 2026-09-09
-- 🔴 **為什麼需要它**:`scripts/admin-probe/up.sh` 起完自己印著
--   「這台機器有 44 / 58 張表是空的 … 你要驗的那個東西, 它的表在不在下面這串裡?
--    在 ⇒ 那一發是【零判別力】, 不是【通過】」
--   而 `manual-order-catalog.ts:195` 逐字 `.from('product_variants')`, 而 `product_variants` 就在那串裡。
--   ⇒ 📌 不種這幾筆, 查商品一定回空, 而**那與「查商品壞了」在畫面上長得一樣**。
-- 🛑 **不改 `seed.sql`** —— 它全窗共用, 多幾筆可能動到別片的期望值(up.sh 自己交代的)。
-- 🔵 三筆刻意長這樣:
--   ① 一般價與經銷價【不同】⇒ 帶入的是哪一個, 分得出來
--   ② sku 前綴共用 `PROBE-` ⇒ 查一次就三筆都出來, 看得到排序
--   ③ 其中一筆 price_store 是 NULL ⇒ 看畫面怎麼處理「沒有經銷價」
-- 🔴🔴 **`spec` 每一筆都要不同 —— 而這一格是【我的自檢抓到的, 不是我想到的】**:
--   `pv_spec_unique` 是 `UNIQUE (product_id, spec)`, 而 `spec` 的預設是 `'{}'`
--   ⇒ 同一個商品底下三筆都用預設值 ⇒ **它們互撞**
--   ⇒ 🛑 而 `ON CONFLICT DO NOTHING` 讓它**靜靜地只進 1 筆**, `INSERT 0 1` 也不會紅。
--   📌 **「少了兩筆」與「三筆都進去了」在 rc 上是同一個東西** —— 那正是檔尾那個自檢存在的理由。
INSERT INTO product_variants (product_id, sku, spec, price_general, price_store, sort_order)
SELECT p.id, v.sku, jsonb_build_object('probe', v.sku), v.pg, v.ps, v.so
FROM (SELECT id FROM products ORDER BY id LIMIT 1) p,
     (VALUES
        ('PROBE-A100', 12345, 9876, 1),
        ('PROBE-B200', 6000,  4800, 2),
        ('PROBE-C300', 500,   NULL, 3)
     ) AS v(sku, pg, ps, so)
ON CONFLICT DO NOTHING;

-- 🟢 自檢:種完必須是 3 筆, 而 sku 逐字對得上
DO $chk$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM product_variants WHERE sku LIKE 'PROBE-%';
  IF n <> 3 THEN RAISE EXCEPTION '種子自檢:PROBE- 開頭的變體有 % 筆(期望 3)', n; END IF;
  RAISE NOTICE '種子 OK:PROBE- 三筆';
END
$chk$;
