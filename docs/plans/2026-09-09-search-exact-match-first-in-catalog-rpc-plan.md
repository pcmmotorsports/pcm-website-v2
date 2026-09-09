# 2026-09-09 · 讓兩支目錄 RPC 保住「料號完全命中排最前」

> 板列 `⟦db-SEARCHFACETMUTEX⟧` 的**第二半**。第一半(給 RPC 加 `p_terms`)已在 `20260909010000` / `20260909040000` 落地。
> 🛑 **本 plan 未經批准,一個字都還沒動。** 貼正式庫由 Sean(或他明文授權的那一次)。

---

## 1. 為什麼要做 —— 這不是新功能,是**擋一個回歸**

顧客站 `/products` 今天有兩條資料路,而板列要把它們併成一條(關鍵字與 facet 不再互斥)。
**併路的碼我寫完了,三綠全過、1279 個測試全綠、七發突變全紅** —— 而 **codex 唯讀對抗審查 R1 = FAIL**,
抓到三條 must-fix,我逐條開檔核過,**三條都是真的**。其中一條要動 SQL,那就是本 plan。

### 🔴 回歸長什麼樣
`storefront_search_product_ids(p_terms)` 自 `20260906950000` 起**最後一段是一個 `ORDER BY`**,
逐字(`:230-241`):

```sql
ORDER BY (EXISTS ( SELECT 1 FROM t
           WHERE upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g')) <> ''
             AND ( EXISTS (SELECT 1 FROM public.products_public p2
                            WHERE p2.id = h.id AND upper(regexp_replace(p2.external_id,'[^A-Za-z0-9]','','g'))
                                = upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g')))
                OR EXISTS (SELECT 1 FROM public.product_variants_public pv2
                            WHERE pv2.product_id = h.id AND upper(regexp_replace(pv2.sku,'[^A-Za-z0-9]','','g'))
                                = upper(regexp_replace(t.term,'[^A-Za-z0-9]','','g')))
                 ))) DESC,
         h.id;
```
= **完全命中排最前**(Sean 2026-09-06 逐字「完全命中的排最前」)。
🔵 而該檔 `:221` 自己寫著「本函式在此之前**一個 `ORDER BY` 都沒有**」⇒ 那是第一次給它排序,不是改排序。

🛑 **而目錄 RPC 用它的方式把那個順序當場丟掉** —— 線上現行定義逐字(`:124-125`):

```sql
OR p.id IN (SELECT k.id FROM public.storefront_search_product_ids(
     (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k))
```

📌 **`IN (SELECT …)` 是集合語意 —— 順序在這一行蒸發**,然後外層照 `p_sort`(預設 `recommend`)重排。

---

## 2. 影響量到了 —— **第 1 名 → 第 14 名(最後一名)**

樣本 `VF11`:正式庫唯讀查 ⇒ 完全命中 **1 顆**、`VF11%` 前綴 **14 顆**。

| | 完全命中那顆的名次 |
|---|---|
| **今天(未合路,走 helper 的順序)** | **第 1**(2026-09-09 正式站瀏覽器實測,逐一讀 14 張卡片) |
| **合路之後(走 recommend)** | **第 14 = 最後一名**(唯讀 SQL 用線上那條 `recommend` 公式重算) |

🟢 **正對照**:正式站搜 `VF11` 回 **14 件**,與我在 SQL 裡列舉的 14 顆 **external_id 逐一相同** ⇒ 候選集是同一個。

**為什麼掉到最後**:`recommend` 在同一價格帶內**依價格由高到低**排,而完全命中的 `VF11` 是 **NT$290**,
其餘 13 顆是 320–350。⇒ 📌 **「客人打的就是這一顆的料號」在 `recommend` 眼裡是零資訊。**

⚠️ **這個樣本沒有更糟只是因為它小**:14 顆 < 一頁 50 顆 ⇒ 還看得到。
　候選集一超過一頁,完全命中那顆會**掉到第二頁**,而客人不會翻。

### 這一格答不出什麼(明寫)
- 🛑 **`pcm_readonly` 叫不動 `storefront_search_product_ids`**(實測 `has_function_privilege(...)` ⇒ `f`)
  ⇒ 上表「合路之後」那一格是**用線上的 `recommend` 公式在唯讀連線上重算的**,不是真的跑一次合路後的 RPC。
  🔵 而候選集那一半有正對照(見上)⇒ 錯的空間只在「我抄的 recommend 公式有沒有抄錯」,不在「哪些商品會進來」。
- **只量了一個樣本**(n=1)。沒有量「有多少搜尋會踩到」。

---

## 3. 改什麼 —— 三個做法,選【甲】

### 甲(選這個):讓 helper 多回一欄 `is_exact`,目錄 RPC 消費它
```
① storefront_search_product_ids  RETURNS TABLE(id uuid)  ⇒  RETURNS TABLE(id uuid, is_exact boolean)
   把現行 ORDER BY 裡那整段 EXISTS 提成一個【輸出欄】,ORDER BY 保留不動。
② 兩支目錄 RPC:`IN (SELECT …)` ⇒ 改成 CTE + JOIN,把 is_exact 帶進 filtered
③ 兩支目錄 RPC 的 ORDER BY 最前面插一鍵:
   CASE WHEN p_sort = 'recommend' AND p_terms IS NOT NULL THEN NOT f.is_exact END ASC NULLS LAST
```
- ✅ **一把尺**:「什麼叫完全命中」的定義**只住在 helper 裡**,兩支目錄 RPC 只是消費它。
- ✅ **明確指定排序時照指定的走**(`price-asc` / `price-desc` / `new` 不受影響)—— codex 的最小修法逐字要求這一點。
- ✅ 只在**有關鍵字時**才多一鍵 ⇒ 今天絕大多數請求(沒有 `p_terms`)行為**一個位元組都不變**。
- ⚠️ **代價**:`RETURNS TABLE` 加欄位**不能 `CREATE OR REPLACE`** ⇒ 要 `DROP FUNCTION` + `CREATE`
  ⇒ rollback 要還原**三支**(helper + 兩支目錄 RPC),而那是**機械的**。
- ⚠️ **要驗**:`SupabaseProductAdapter` 打這支 RPC 時只讀 `.id`,多一個 JSON 欄位對它無害 —— **驗收 §5-② 釘這件事**。

### 乙:`WITH ORDINALITY` 拿 helper 的輸出順序當主鍵
```sql
FROM public.storefront_search_product_ids(…) WITH ORDINALITY AS k(id, kw_ord)
```
- ✅ **不動 helper** ⇒ rollback 只要還原兩支目錄 RPC,**最小**。
- ⛔ **而它把 `recommend` 整個換掉**:helper 的第二排序鍵是 `h.id`(不是價格、不是分類輪流)
  ⇒ 非完全命中的那一段會變成**依 uuid 排** ⇒ 📌 **有關鍵字時的清單順序整個變,而那不是本片要修的東西。**
- ⛔ 另一格:SQL 函式被 planner inline 時 `ORDER BY` 可能被丟掉。`WITH ORDINALITY` 會擋掉 inline
  —— **而那是我讀來的,沒有實測** ⇒ 一個「靠 planner 行為」的正確性,我不想放在錢的路上。

### 丙:目錄 RPC 自己重算「完全命中」
- ✅ 不動 helper,rollback 最小。
- ⛔ **那段 `EXISTS`(母料號 + 變體 sku、兩端正規化)會變成三份**(helper + 公開 + 經銷)
  ⇒ 📌 **三份會漂,而漂了之後「搜尋結果的第一名」在兩條路上不同,兩邊都不會紅。**

### ⇒ 選甲,一句話理由
**乙丙省下的是 rollback 的工,換來的是一個會漂的定義;甲多出來的 rollback 工是機械的、寫一次就有。**

---

## 4. 基底從哪裡抄 —— **線上現行定義,不是 repo 檔**

```bash
bash scripts/latest-definition-of.sh search_catalog_by_vehicle
bash scripts/latest-definition-of.sh search_catalog_by_vehicle_dealer
bash scripts/latest-definition-of.sh storefront_search_product_ids
```
2026-09-09 實跑結果:
- `search_catalog_by_vehicle` newest = **`20260909050000`**(⚠️ 帳本上 `live` 仍是 `20260909010000` ——
  `20260909050000` 今天貼了而帳本列還沒補)
- `search_catalog_by_vehicle_dealer` newest = **`20260909050000`**(同上)
- `storefront_search_product_ids` newest = **`20260906950000`**

🔴 **而實際抄的是正式庫的 `pg_get_functiondef`**(唯讀撈,已取得),不是上面任何一支檔。
理由是量到的:今天 `search_catalog_by_vehicle` 是**第三次**被改(`…010000` 加 `p_terms` · `…050000` 拿掉批次日 · 本片),
而**我今天已經差點用錯基底一次** —— 交辦給的落點是 `20260906910000`(12 參數版),
用它重貼會把同日稍早上線的關鍵字搜尋整個蓋掉,**而三綠全過**。

## 4-b. 🔴 兩支一起改,同一顆 commit
只改公開那支 ⇒ 一般會員的搜尋完全命中排第一、經銷會員排第十四,**而兩邊都不會紅**。
📌 同一種形狀今天已經咬過一次(`⟦f3-NEWARRIVALBRANDLIST⟧` 那顆的批次日規則有兩個落點)。

---

## 5. 驗收(拋棄式 PG,不碰正式庫)

工具:`scripts/storefront-probe/up.sh` 那條路 / `docs/runbooks/throwaway-postgres-for-migration-verification.md`。

1. **forward rc=0**、事後閘全過。
2. 🔴 **`storefront_search_product_ids` 的既有呼叫端沒壞** ——
   `SupabaseProductAdapter` 那條路(`packages/adapters/src/supabase/SupabaseProductAdapter.ts:1042`)
   打的是 PostgREST,多一欄 JSON 對它應該無害。**實跑一次確認,不用推的。**
3. **排序四格**(每一格都要有正反兩個世界):
   | 世界 | 期望 |
   |---|---|
   | `p_terms=['VF11']` + `p_sort='recommend'` | 完全命中那顆 **第 1** |
   | `p_terms=['VF11']` + `p_sort='price-asc'` | **照價格排**,完全命中不插隊 |
   | `p_terms=NULL` + `p_sort='recommend'` | 與改前**逐列相同**(⚪ 負對照:本片不得動到沒有關鍵字的路) |
   | 經銷那支 同上四格 | 與公開那支**同樣的名次** |
4. **突變**:把第 ③ 步那一鍵拿掉 ⇒ 第一格要當場紅。
5. **rollback rc=0**,還原後上面四格回到改前的值。

---

## 6. Rollback

`supabase/rollbacks/<版本>-rollback.sql` —— 🔴 **一支可執行的檔,不是散文**:
三支函式改動前的定義**原樣**(helper 用 `DROP` + `CREATE` 還原回 `RETURNS TABLE(id uuid)`,
兩支目錄 RPC 用 `CREATE OR REPLACE`)。
⚠️ **驗收不要只看「搜得到嗎」** —— 那對排序**零判別力**:順序全錯而件數完全正確。
⇒ 對帳查詢用 §5 的四格。

---

## 7. 🔴 這一片要**連同下面三件一起收**,不要拆

它們是同一件事的四半;只收其中幾半 = **明知會回歸還是送出去**。

### ① 變體料號回查不見了(codex must-fix 1)
`searchProducts`(`apps/storefront/src/lib/search.ts:147`)在【零結果 + 第一頁】會呼叫
`adapter.searchByVariantSku()` 做完整字串比對。合路之後那段**完全繞過**。
🔵 **而它的射程比我原本講的窄** —— 見 §8。差集是**不含數字的變體料號**(codex 的反例 `KIT-BLK`):
helper 的變體分支閘是 `t.term ~ '[0-9]'`(`20260906900000:184`)⇒ 那種詞只有這顆 fallback 撈得到。

### ② 搜尋語料不再記錄(codex must-fix 3)
`logSearchQuery({path:'keyword'})` 也住在 `searchProducts` 裡(`:175`),合路之後沒有承接
⇒ 未解析成膠囊的搜尋(**含真正零結果那些**)會從缺貨商機的分母裡整批消失。
🔵 四道閘要一起搬:`countTotal` / `offset===0` / `error===false` / `!variantLookupFailed`。

### ③ codex 兩條 nit
- **(a)** `products/page.test.tsx` 那格「嚴格不弱於」的宣稱要**收窄** —— 4800 是 mock 餵的,
  證不到真的走經銷 RPC。⇒ 補一格用**真** `fetchCatalogPage` 的 `store + search`,斷言 RPC 名字 + `p_terms` + 快取隔離。
- **(b)** `lib/products.ts` 那段 `null` vs `[]` 的註解**講反了** ——
  SQL 對 `NULL` / `[]` / 全空白**三者都跳過**,送 `null` 本身不防任何東西;
  **真正承重的是 `fetchCatalogPage` 開頭那道零詞短路。**
  ⇒ 註解改對,否則下一個人會以為 SQL 那層在守。

📎 **併路的碼在 `git stash@{0}`**,訊息逐字
`⟦db-SEARCHFACETMUTEX⟧ 客人半合路 —— codex R1 三條 must-fix 未收(② 要動 SQL 等 plan 批)`。

---

## 8. 🔴 一句要帶走的,而它是我自己犯的

我 2026-09-09 上午在正式站量到變體料號搜得到,寫的結論是
「**只可能**是我那顆 `0dc6c79b4` 的變體 fallback」,反對照是那兩個字串在 `products.title` / `external_id` 命中 **0 / 0**。

🛑 **那句是錯的** —— 我漏了第三條路:`storefront_search_product_ids` **自己就有變體分支**
(`20260906900000_m4b_storefront_search_variant_sku.sql:182` 逐字 `FROM public.product_variants_public pv`),
而它的閘是「含數字 **且**(含字母 **或** 純數字≥7 位)」⇒ 我拿去測的 `MATERYA-9281-9401` 與 `VF11SIL`
**兩個都過得了那道閘** ⇒ 它們本來就搜得到。

✅ **正確結論**:**兩條路至少有一條在跑。我排除了母表,沒排除 helper。**
✅ 而那顆 fallback **仍然有用**,只是用途比我原本講的窄(見 §7-①)。

> 📌 **我排除了兩條路就寫「只可能是第三條」,而我沒有數過總共有幾條路。**

⇒ `docs/reviews/2026-09-09-窗A-十二列查證.md` §0-② 寫的是舊結論,**與本片同一顆 commit 訂正**
　(留原句加刪除線 + 新結論 + 為什麼原來那句錯 —— 不直接改掉,那會讓下一個人以為我們沒犯過這個錯)。
