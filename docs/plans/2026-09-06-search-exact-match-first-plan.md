# plan · ⟦search-VARIANTSKUFIRST⟧ 完全命中排最前(`storefront_search_product_ids` 加 `ORDER BY`)

> 線【資料】`-db` 2026-09-06 寫;主視窗 `-f1` 裁 **乙′**(函式內排序, 簽章不變)。
> **鐵則 8 + 鐵則 12③ ⇒ 等批准, 且要過 codex(`gpt-6-astra --disable apps`)。**
> Sean 原話(主視窗轉述):「**完全命中的排最前**」—— 他**沒有**要 rank 這個值。

---

## 0. 🔴 先抄現在的樣子(主視窗指定的第一步 —— 而它就是我今晚踩的那個坑)

**`bash scripts/latest-definition-of.sh storefront_search_product_ids` 的【完整輸出】**
(🛑 **不 `head`、不 `sed -n '1,Np'`** —— 我今晚就是用 `sed -n '1,12p'` 把最後一代截掉, 結果做出一支會回退別人修法的 migration):

```
版本號        行號 形狀  帳本 檔名
20260903050000   84     create  已記 20260903050000_m4b_storefront_search_product_ids.sql
20260903230000   188    cor     已記 20260903230000_m4b_storefront_search_partno_normalized.sql
20260904010000   124    cor     未記 20260904010000_m4b_storefront_search_partno_indexable.sql
20260904030000   148    cor     已記 20260904030000_m4b_storefront_search_split_three_blocks.sql
20260904180000   215    cor     已記 20260904180000_m4b_storefront_search_partno_long_numeric.sql
20260906900000   98     cor     未記 20260906900000_m4b_storefront_search_variant_sku.sql

newest = 20260906900000   (repo 裡最後一代;共 6 代 / 6 個定義點)
live   = 20260904180000   (帳本上最後一支已記的)
🔴🔴 newest ≠ live
```

### 🔴 而它當場告訴我一件會排錯順序的事

**`20260906900000` 是我今晚剛做的(貼板 58), 而它【還沒貼進正式庫】。**
⇒ 本片要接在它上面(排序要看變體 sku, 而那一塊是 900000 加的)
⇒ 🛑 **貼板順序是死的:58 必須先於 62。** 反過來貼 ⇒ 本片的前置閘會擋(那是它該做的事)。

### 現在的排序條件是什麼

**答案是:一個都沒有。**
```
grep -c 'ORDER BY' supabase/migrations/20260906900000_m4b_storefront_search_variant_sku.sql ⇒ 0
```
函式結尾逐字:
```sql
  SELECT h.id
    FROM hits h
    CROSS JOIN n
   WHERE n.want > 0
   GROUP BY h.id, n.want
  HAVING count(DISTINCT h.ord) = n.want;
```
⇒ 📌 **順序完全由 planner 決定** —— 主視窗交辦裡的「再原排序」**沒有那個東西可以接**。

---

## 1. 🛑 而這一片【單獨貼下去看不出差別】—— 這句要寫在貼板檔頭

`packages/adapters/src/supabase/SupabaseProductAdapter.ts` 逐字兩行:
```ts
:577  // 🔴 `.in('id', …)` **不保證順序** ⇒ 自己排,才與舊路的 `.order('id')` 同序。
:578  const ordered = [...brandIds].sort();
:596      .order('id', { ascending: true });
```
⇒ 🎯 **呼叫端把 RPC 回來的順序排掉【兩次】** —— 先 `.sort()`(字串序), 再 `.order('id')`。
⇒ **我在函式裡怎麼 `ORDER BY` 都不會有人看到。**

### ✅ 而 front 已經先動了一半 —— 我複驗過, 不是照單全收

`02499b9c6` **feat(adapters): 一道今天是 no-op 的接縫 —— 沒有它, db 那半貼上去什麼都不會發生**
它把 `:596` 那一半處理掉了(改成拿 `pageIds` 的順序去重排), 而那顆的註解逐字寫著:
> 🛑 **今天這一段是【no-op】, 而那是刻意的** —— `pageIds` 是從 `[...brandIds].sort()` 切出來的,
> 所以它的順序**現在就等於** id 升冪 ⇒ 輸出逐字不變。
> ⚠️ **而 `.sort()` 今天【不能拿掉】** —— 現行 RPC `grep 'ORDER BY'` ⇒ **0 命中**
> ⇒ 它的列序是**任意的** ⇒ 拿掉 `.sort()` 而 62 還沒貼 ⇒ **分頁會重複與漏商品**

⚠️ **而那顆【不在我的分支上】** —— `git merge-base --is-ancestor 02499b9c6 HEAD` ⇒ **不是祖先**;
我工作樹的 `:596` 現在仍是 `.order('id', { ascending: true })`。
⇒ 📌 **「front 說改好了」與「我這棵樹上改好了」是兩件事** —— 而我今晚已經在這一格上被咬過一次
　 (`harvest-chain.sh` 舊版)。**本片不依賴那顆**:我改的是 DB 那半, 兩顆各自可獨立上 dev。

### 🛑 所以貼板檔頭那句是這樣(主視窗 2026-09-06 逐字改過)
> **貼完 62 之後, 要等 front 拿掉 `adapter:578` 的 `.sort()` 才會生效。**
> 在那之前貼了**看不出任何差別** —— 而那不是壞掉。
⇒ 這句進貼板 `62b` 的**第 0 格**, 免得貼的人跑完對帳看到「順序沒變」以為它沒作用。

---

## 2. 要改什麼

`supabase/migrations/20260906950000_m4b_search_exact_match_first.sql` ——
本體**逐字搬自 `20260906900000`**(repo 最新代), 只在最後那個 `SELECT` 後面加一段 `ORDER BY`:

```sql
   ORDER BY (EXISTS (
              SELECT 1 FROM t
               WHERE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
                 AND ( EXISTS (SELECT 1 FROM public.products_public p2
                                WHERE p2.id = h.id
                                  AND upper(regexp_replace(p2.external_id, '[^A-Za-z0-9]', '', 'g'))
                                      = upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')))
                    OR EXISTS (SELECT 1 FROM public.product_variants_public pv2
                                WHERE pv2.product_id = h.id
                                  AND upper(regexp_replace(pv2.sku, '[^A-Za-z0-9]', '', 'g'))
                                      = upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')))
                     )
            )) DESC,
            h.id
```

**為什麼這個形狀**:
- 🔵 **`= ` 不是 `LIKE`** —— 這裡要的是**完全命中**, 而正規化兩端之後直接比相等。
- 🔵 **`h.id` 當第二排序鍵** —— 沒有它, 同一組(都完全命中 / 都不是)之間的順序仍由 planner 決定
  ⇒ 📌 **「排序不穩定」與「排序錯了」在畫面上很像**, 而分頁時前者更毒(同一筆會出現在兩頁)。
- 🔵 **不改簽章** ⇒ `CREATE OR REPLACE` ⇒ **不動權限、不動 `database.types.ts`**。

---

## 3. 影響面 / rollback / 片型

| 項 | 內容 |
|---|---|
| 動到的檔 | 一支新 migration · 貼板 62 / 62b · 板列 |
| 影響面 | **顧客站每一發搜尋** —— 而在 front 那顆跟上之前**看不出差別**(§1) |
| 效能 | 🔴 **未量**(明寫未量, 不是估):那個 `EXISTS` 對結果集每一列各跑一次 ⇒ 驗收要有修前修後兩個讀數。數法 `EXPLAIN (ANALYZE, BUFFERS)` 對同一組詞各跑一發 |
| rollback | `CREATE OR REPLACE` 回 `20260906900000` 那一版 ⇒ 一支 down.sql 一起交(**含 `lock_timeout`**, 見 `⟦b4-LOCK1⟧`) |
| 片型 | **高風險片**(鐵則 12③)⇒ codex `gpt-6-astra --disable apps` 一次 |
| 🔴 貼的順序 | **58 必須先於 62**(本片接在 900000 上)⇒ 前置閘會擋反序 |

---

## 4. 驗收(主視窗給的正對照, 逐字)

```
搜 AZ203  ⇒ 第一筆是 AZ203
搜 PET52R ⇒ 第一筆是【變體所屬那張】, 不是母 PET52
```
🔴 而這兩格**要在拋棄式 PG 上跑**(正式庫零寫入), 並各配一個負對照:
· 一個現造料號 ⇒ 零列(證明尺會動)
· 一個**不完全命中**的詞 ⇒ 順序不變(證明它只動完全命中那一格, 不是把整個順序重排)

## 5. 要主視窗拍的一個字

**效能那一格怎麼收**:
- **甲** = 只在拋棄式 PG 上量(資料量小 ⇒ 數字不代表正式庫), 並在板列寫明「正式庫延遲未量」
- **乙** = 等貼進正式庫之後用唯讀 EXPLAIN 量一次再關列
**我推薦乙**, 而它表示這一列**貼完之後才關得掉**。
