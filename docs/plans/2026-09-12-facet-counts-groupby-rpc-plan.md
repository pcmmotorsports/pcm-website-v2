# Plan:目錄頁側欄件數改成一發 GROUP BY RPC(品牌 ⇄ 分類互相連動)

> 2026-09-12 · 施工窗 A(pcm-website-v2-5a)· 樹 `~/pcm-shop` 分支 `agent/shop-2`
> 起因:Sean 09-12 01:4x 在 www 截圖 —— `/products` 選「外觀與後視鏡」+ 品牌「EAZI-GRIP」⇒ 右邊 0 件,左邊分類件數仍是全站數(外觀與後視鏡 3887…)。原話「我以為會跟我們選車種的方式一樣」。
> Sean 09-12 01:3x 拍【乙】:動 DB,新開一支 GROUP BY RPC。**本檔只是 plan(鐵則 8),未寫 migration、未改碼,等 Sean 批。**

## 0. 白話

- **現在**:選車 ⇒ 件數會變(網頁另外去問 108 次)。選品牌 / 選分類 ⇒ 件數不變(用的是全站總數)。
- **改完**:選車、選品牌、選分類,三個都會讓另一邊的件數跟著變。問一次就拿到全部件數,不再問 108 次。
- **錯了會怎樣**:最壞是件數整排不顯示(跟今天查失敗時一樣),**不會印出錯的數字**。商品列表本身不受影響。
- **要 Sean 做的**:① 批這份 plan ② 回答第 5 節那一題(價格要不要一起算)③ 之後授權貼那一支 migration 編號。

## 1. 改什麼

### 1a. 新 RPC(migration 一支,只新增、不改任何既有函式)

```sql
public.catalog_facet_counts(
  p_category_keys        text[],               -- 要算的分類 key(大類名 + 「大類 · 子類」),由 route 從分類樹產生、過白名單
  p_brand_keys           text[],               -- 要算的品牌 slug,由 route 從品牌表產生
  p_brand                text    DEFAULT NULL, -- 車:廠牌(= search_catalog_by_vehicle 的 p_brand)
  p_model                text    DEFAULT NULL, -- 車:車型
  p_year                 integer DEFAULT NULL, -- 車:年份
  p_selected_categories  text[]  DEFAULT NULL, -- 客人已選的分類 ⇒ 只疊到【品牌】面板
  p_selected_brand_slugs text[]  DEFAULT NULL  -- 客人已選的品牌 ⇒ 只疊到【分類】面板
) RETURNS TABLE(facet text, key text, n bigint)   -- facet ∈ {'category','brand'};每個要求的 key 都回一列,沒有商品 = 0
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = public, pg_temp
```

算法(一次掃描):
1. `base` = `products_list_public`,有車時 `JOIN matched`(matched 逐字抄 `search_catalog_by_vehicle` 有車那一支的 `product_fitments UNION product_fitments_effective`)。
2. `g` = `base` 依 `(category_raw, brand_slug)` GROUP BY(正式庫實量:全目錄 370 組)。
3. 分類面板:每個 `p_category_keys` 的 k ⇒ `sum(g.n)`,條件 `g.category_raw = k OR g.category_raw LIKE k || ' · %'`,**再加上**已選品牌(`p_selected_brand_slugs` 空 ⇒ 不過濾)。
4. 品牌面板:每個 `p_brand_keys` 的 b ⇒ `sum(g.n)`,條件 `g.brand_slug = b`,**再加上**已選分類(聯集,與列表同一個 `EXISTS (unnest … = vc OR LIKE vc || ' · %')`;空 ⇒ 不過濾)。
5. 已選分類要跟列表一樣先 `btrim` 並丟掉空字串(列表的 `v_cats`,`20260909070000_…:323-330`)。

**「各面板不疊自己那一維」**:分類面板不看已選分類、品牌面板不看已選品牌 ⇒ 客人看到的是「如果我再點這一格,會有幾件」。已選中而變成 0 的那一格仍可點掉(`FilterSide.tsx:158` 有 `!checked`)。

**不吃的參數**:關鍵字(有關鍵字時根本不印件數,見第 6 節)、新品(新品頁不印件數,Sean 2026-08-11 Q21=B)、價格(第 5 節,預設不做)。

### 1b. 權限(INVOKER,照 `docs/patterns/revoking-function-execute-in-supabase.md` + 同族前例)

- **SECURITY INVOKER**,理由:`search_catalog_by_vehicle` 本身就是 INVOKER(`20260909070000_…:266-270`,只有 `STABLE` + `SET search_path`),讀的是公開投影 `products_list_public`。INVOKER ⇒ anon 看得到的列不會變多,只回件數、不回任何商品欄位 / 價格。
- 這支是**要讓 anon 執行的**(route 用 anon client)⇒ 規則不是「收掉 anon」,而是「收掉 PUBLIC、具名發給要的人」,抄同一支 migration 的前例 `20260909070000_…:259-262`:
  ```sql
  REVOKE ALL ON FUNCTION public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[]) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[]) TO anon, authenticated, service_role;
  ```
- migration 尾段加斷言(抄 `20260909070000_…:1181` 那個形狀):ACL 不是 NULL、`has_function_privilege('anon', …, 'EXECUTE')` = true、PUBLIC 沒有 EXECUTE、`prosecdef = false`、`proconfig` 含 `search_path=public, pg_temp`。任一不符 ⇒ `RAISE EXCEPTION`,整支回滾。
- 經銷會員:今天件數就是用公開那支算的(`vehicle-facet-counts.ts:203` 呼叫 `search_catalog_by_vehicle`)⇒ 沿用。件數不看價格,經銷與一般的商品集合相同 ⇒ 數字一樣。**不做經銷版。**

### 1c. 前端(3 支檔 + 各自的測試)

| 檔 | 改什麼 |
|---|---|
| `apps/storefront/src/lib/vehicle-facet-counts.ts` | 108 發 fan-out(`mapWithLimit` / `countOne` / `FACET_CONCURRENCY`)換成**一發** `catalog_facet_counts`;回傳照舊組成 `{ categories, brands }`。快取 key 加上已選品牌 / 分類(排序後序列化)。`withTimeout` / single-flight / `MAX_CONCURRENT_FANOUTS` 留著(名額從「一組 108 發」變成「一發」,上限值另議,不在本片調)。 |
| `apps/storefront/src/app/api/catalog/facet-counts/route.ts` | 車變成**可選**;新收 `pbrands` / `categories`,走同一支 `parseCatalogQuery`,再各自核對:品牌必須在品牌表、分類必須在 `categoryFacetKeys` 裡(key 空間有界:≤ 21 品牌 × 92 分類)。三者都沒有 ⇒ 400(沒有要算的東西,client 本來就不會來問)。 |
| `apps/storefront/src/lib/vehicle-facet-display.tsx` | hook 觸發從「有車」改成「有車 或 有已選品牌 / 分類」,把它們帶進 fetch URL;`makeFacetCountResolver` 的 `hasVehicle` 改成「有沒有送出去問」。**第 191-192 行 `hideCounts`(關鍵字 / 新品不印)一字不動、仍排在最前面。** |

什麼都沒選 ⇒ 照舊用 server 帶下來的全站數,**0 次額外查詢**(與今天一樣)。

## 2. 述詞怎麼跟 `search_catalog_by_vehicle` 保持同一個

保證的是「**面板上的數字 = 點下去之後右邊的 N 件**」。新 RPC 的述詞是**抄**的,不是呼叫同一支 ⇒ 兩份會漂。用三道釘住:

1. **拋棄式 PG 對照測試**(照 `scripts/mark-order-cancelled-verify.sh` 的 initdb 形狀):灌兩支函式與假資料,跑一個矩陣 —— 車(無 / 只廠牌 / 廠牌+車型 / +年份)× 已選品牌(無 / 1 / 2)× 已選分類(無 / 大類 / 子類 / 兩個)。每一格斷言:
   `catalog_facet_counts` 的分類 k 件數 == `search_catalog_by_vehicle(p_categories=[k], p_brand_slugs=已選品牌, 車, p_limit=1).total`(0 列當 0);品牌同理。
   **突變**:把新 RPC 的 `LIKE k || ' · %'` 拿掉、或把 matched 的 `UNION product_fitments_effective` 拿掉 ⇒ 那格必須紅。
2. **靜態漂移警報**(vitest,一支小測試):讀兩支函式在 `supabase/migrations/` 裡**最新那一代**的定義,斷言以下片段兩邊都在:分類 `= vc OR … LIKE vc || ' · %'`、品牌 `brand_slug = ANY`、matched 的兩張 fitments 表與年份條件。以後有人改了 `search_catalog_by_vehicle` 的過濾而沒動這支 ⇒ 這格紅。它只擋「漏改」,擋不住「兩邊都改錯」—— 那由第 1 道擋。
3. **貼正式庫後對照**:本機顧客站(anon key)挑 3 台車 × 2 品牌 × 2 分類,兩支 RPC 各叫一次比數字,全等才推前端。(`pcm_readonly` 沒有這兩支函式的 EXECUTE —— 見 `~/pcm-mailbox/0905查證/q-catswitch-explain-v2.sql` 檔頭 ⇒ 不能用唯讀帳號做這一步。)

## 3. 效能(09-12 對正式庫唯讀實量)

方法:`pcm_readonly` 跑 `EXPLAIN (ANALYZE, BUFFERS)`,把 GROUP BY 展開成純 SELECT(**不是那支函式本身,函式還不存在**)。只量 DB 執行時間,不含網路。SQL 與輸出在窗 A scratchpad `facet-groupby-explain.sql` / `facet-groupby-out.txt`。

| 情境 | 實量 |
|---|---|
| 分母 | `products_list_public` 26,479 列 · 86 種 category_raw · 21 品牌 · 370 組 (分類,品牌) |
| 對照:今天 108 發裡的一發(沒車、只看 eazi-grip) | 4.0 ms |
| **沒車,全目錄 GROUP BY** | **38.4 ms**(`products` 循序掃 26,479 列 17 ms) |
| **沒車,完整兩面板**(分類疊 eazi-grip、品牌疊外觀與後視鏡) | **45.6 ms** |
| 有車,**只選廠牌 Ducati**(fitment 最多 = 最壞情況) | **3,959.8 ms**,其中 `product_fitments_effective` 索引掃 11.7 萬列佔 2,936 ms;有 2,814 個 block 從磁碟讀(部分冷快取) |
| 有車,選到車型 / 年份 | **未量** |

讀法:
- 沒選車:一發約 45 ms ⇒ **不需要新索引**。
- 有車時慢的是「這台車能裝哪些商品」那一段(matched)—— **商品列表那支 RPC 本來就要付同一段**,不是新 RPC 才多出來的。今天的 108 發每一發都各付一次 matched;新做法只付一次 ⇒ 只會比今天省。matched 本身要不要調是另一題(不在本片範圍)。
- 目錄頁首次載入:**不變**(件數照舊是頁面出來之後才去問)。

## 4. 影響與 rollback

**影響**:只有 `/products` 側欄(桌機)與篩選抽屜(手機)的件數。商品列表、價格、結帳、後台都不碰。新增一支函式,不改任何既有函式、表、view、權限。

**上線順序**(反了只會讓件數消失,不會錯):
1. 貼 migration(Sean 授權那一支編號)⇒ 唯讀核:函式在、ACL 對、斷言有跑。
2. 第 2 節第 3 道的貼後對照,全等。
3. 推前端。前端比 migration 先上 ⇒ RPC 不存在 ⇒ route 503 ⇒ 件數不顯示(fail-safe)。

**舊的 108 發要不要留在碼裡當退路:不留。** 理由:兩條路並存 = 兩份述詞要一起顧,正是第 2 節要避免的事。退路是 git:
- 前端壞 ⇒ `git revert <前端那一顆>`,108 發的碼原封回來(新 RPC 留著無害)。
- DB 要撤 ⇒ 前端先 revert,再 `DROP FUNCTION public.catalog_facet_counts(text[], text[], text, text, integer, text[], text[]);`(沒有任何資料寫入,純刪函式)。

## 5. 要 Sean 答的一題(預設不做)

```
Q: 客人拉了價格區間之後,側欄件數要不要也只算那個價格內的?
A: 甲 不算(預設)—— 件數只跟車、品牌、分類連動。拉價格之後,側欄數字可能比右邊多。
   乙 一起算 —— 數字更準;RPC 多兩個參數,經銷會員要另外處理(他們的價格不一樣,可能要一支經銷版)。
   推薦:甲。先把 Sean 抓到的品牌 ⇄ 分類做好,價格等有人抓到再做。
```

## 6. 不動的拍板

- **有關鍵字不印件數**(Sean 2026-09-11 拍乙,`ed649dda0`):`vehicle-facet-display.tsx:191-192` 的 `hideCounts` 一字不動、排在新邏輯前面 ⇒ 有關鍵字時 hook 拿到 `null`,**不會發這支 RPC**。
- **新品頁不印件數**(Q21=B):同一行守住。

## 驗收(做的時候)

- 三綠(`TURBO_FORCE=1 pnpm typecheck` / `lint` / `build`)+ 跑 `route.test.ts`、`vehicle-facet-counts.test.ts`、`vehicle-facet-display.test.tsx`、`ProductsPage.test.tsx`、`FilterSide.test.tsx`、`FilterDrawer.test.tsx`。
- 拋棄式 PG 對照 + 突變(第 2 節第 1 道)綠,突變格紅。
- 碰 DB / 權限 ⇒ commit 前 Fable 5.1 唯讀審一輪(codex 09-15 前沒額度)。
- 貼後對照(第 2 節第 3 道)全等。
- **做完 = Sean 自己在 www 重走一次:選外觀與後視鏡 + EAZI-GRIP ⇒ 左邊件數跟著變、沒有商品的格子灰掉。**
