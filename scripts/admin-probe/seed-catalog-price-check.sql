-- seed-catalog-price-check.sql — 給 ⟦b4-PURCHTAX1⟧ 甲案(單價 vs 型錄含稅價)用的種子。
--
-- 用法(探針起來之後):
--   psql "postgresql://postgres@127.0.0.1:<探針埠>/postgres" -f scripts/admin-probe/seed-catalog-price-check.sql
--   探針埠 = grep -oE '127.0.0.1:[0-9]+' /tmp/pcm-admin-probe/prest.conf | head -1 | cut -d: -f2
--
-- ══════════════════════════════════════════════════════════════════════
-- 🔴🔴 **為什麼需要這一支:主種子 `seed.sql` 種了【0 筆】`product_variants`。**
--    (數法:`grep -c product_variants scripts/admin-probe/seed.sql` ⇒ 0)
--    ⇒ 而甲案那道比價**只對型錄品項有效** ⇒ 沒有 variant 就只驗得到「查無(代購)」那一種,
--      而那**恰好是它幫不上忙的那一種** ⇒ 📌 **零 variant 的探針對這一片幾乎零判別力。**
--    ⚠️ 2026-09-03 兩個窗(`-account`、`-auth`)各自撞到這件事一次。
--
-- 🛑 **刻意【不併進 `seed.sql`】** —— 那支是全窗共用的,多 23 筆變體可能動到別片的期望值。
--    ⇒ 要用的人自己多跑這一支;不用的人完全不受影響。
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 主角:權威含稅價 1050 ⇒ 在畫面上填 1000 就會踩 `mismatch`,
--    且 1000 × 1.05 = 1050 **精確成立** ⇒ 文案會加上「這看起來像填成了未稅價」。
--    🔵 想驗「不像未稅」那一支:填 300(300×1.05=315 ≠ 1050)⇒ 那句話不該出現。
INSERT INTO public.product_variants (product_id, sku, price_general, spec)
SELECT p.id, 'ZZ-PROBE-1', 1050, jsonb_build_object('n', 'probe')
  FROM (SELECT id FROM public.products LIMIT 1) p;

-- ② 22 筆同前綴 ⇒ 搜 `ZZ-MANY` 會**塞滿** `MANUAL_ORDER_CATALOG_LIMIT`(= 20)
--    ⇒ 打一個【不存在的】完整料號(例 `ZZ-MANY-99`)會踩 `inconclusive`
--      (「符合的商品太多…沒能確定哪一筆是它」)。
--    🔴 **為什麼是 22 不是 20**:要嚴格【超過】上限,20 筆剛好等於上限、邊界含糊。
--
-- 🔴🔴 **`spec` 必須逐筆不同** —— `pv_spec_unique` 是 `(product_id, spec)` 上的唯一鍵,
--    而 `spec` 的預設是 `{}` ⇒ 同一個 product 底下第二筆就會撞。
--    ⚠️ 2026-09-03 實際踩到,錯誤訊息是
--       `duplicate key value violates unique constraint "pv_spec_unique"`。
INSERT INTO public.product_variants (product_id, sku, price_general, spec)
SELECT p.id, 'ZZ-MANY-' || g, 500, jsonb_build_object('n', g::text)
  FROM (SELECT id FROM public.products LIMIT 1) p, generate_series(1, 22) g;

COMMIT;

-- ③ 🔵 **自檢:餵幾筆 vs 它有幾筆**(鐵則 11 第四個數,換個受詞)。
--    期望 23。不是 23 就不要往下走。
--
-- 🔴🔴 而這一格是 2026-09-03 真的踩到的坑,寫下來:
--    我原本把 ① 與 ② 放在**同一個 `psql -c`** 裡。② 撞了 unique 錯,
--    而回頭查 `count` 是 **22 不是 23** ⇒ 📌 **`psql -c` 的多句是同一個交易,
--    第二句失敗把第一句一起回滾了。**
--    ⇒ ⚠️ **而 `INSERT 0 1` 那一行是【誠實的】** —— 它當下真的插了一筆;
--      **回滾發生在它印完之後。** ⇒ 🎯 **看到成功訊息不等於那筆還在。**
--    ⇒ 抓到它的不是錯誤訊息, 是下面這一句。
SELECT
  count(*) FILTER (WHERE sku = 'ZZ-PROBE-1') AS 主角應為1,
  count(*) FILTER (WHERE sku LIKE 'ZZ-MANY-%') AS 湊數應為22,
  count(*) AS 全部應為23
FROM public.product_variants;
