# Plan · 搜了關鍵字,側欄分類數字要對得上結果

> **一句話**:客人搜「水箱護網」得到 25 件,左邊側欄卻還寫「外觀與後視鏡 14」「碳纖維部品 14」,
> 那是**整個目錄**的數字。客人點進去發現少很多,會以為網站壞了。
>
> · 🛑 **本 plan 一個字都還沒動到碼。** Sean 本人還沒看過。
> · 做法甲會動 API route 與取數 lib(鐵則 8),所以先寫 plan 等批。
> · 寫的人:窗 A,2026-09-11,基底 `29bbf4354`。

---

## 1. 現在怎麼壞的(2026-09-11 鑽機實測)

🔬 拋棄式鑽機 `scripts/storefront-probe/up.sh`(`~/pcm-shop`,HEAD `29bbf4354`),真瀏覽器:

```
/products?search=水箱護網   ⇒ 25 件商品   側欄 18 格:引擎部品 4 / 後視鏡 4 / 碳纖維部品 14 / … / 外觀與後視鏡 14 / 維修零件 4
/products(沒關鍵字)       ⇒ 108 件商品  側欄 18 格:一模一樣
```

⇒ **側欄數字完全不看關鍵字。** 點「外觀與後視鏡 14」之後,列表是 **3 件**
(RPC 同一發 `p_terms:["水箱護網"]` + `p_categories:["外觀與後視鏡"]`,psql 子分類樹查也是 3 件)。

**數字從哪來(讀碼)**:

| 情境 | 數字來源 | 看不看關鍵字 |
|---|---|---|
| 沒選車 | `page.tsx:149` `tryCategories()` 不帶參數 ⇒ `category-queries.ts:140` 每個分類對 `products_public` 數一次,整站數,快取 60 秒 | ❌ |
| 選了車 | `vehicle-facet-display.tsx:189` 打 `/api/catalog/facet-counts?vehicle=` ⇒ `vehicle-facet-counts.ts:197` 每格叫一次 `search_catalog_by_vehicle(p_limit=1)` 讀 `total` | ❌(`:209-221` 沒送 `p_terms`)— 讀碼推,**未實測** |
| 新品頁 `?filter=new` | `vehicle-facet-display.tsx:181` `NO_COUNTS` ⇒ **一律不印數字** | —(Sean 2026-08-11 `Q21 = B`) |

⚠️ 品牌那一欄的數字走同一支 resolver(`FilterDrawer.tsx:345` `countOf('brands', …)`)⇒ **同一個病**,讀碼推,未實測。

## 2. 設計稿怎麼畫(鐵則 1)

`design-reference`(主樹那份,`a14fdcf`;`~/pcm-shop/design-reference` 是空的子模組):

- `components/FilterSide.jsx:74, :83`:大類、子類**一律印數字** `{c.count}` / `{s.count}`。
- 那些數字是 `data/products.js` 的**寫死假資料**;`ProductsPage.jsx:85` `filterProducts` 用關鍵字篩列表,
  **可是數字從來不重算**(品牌、價格、車款也一樣不重算)。

⇒ **設計稿沒有定義「有關鍵字時數字長怎樣」。** 稿上一律有數字,可是那些數字本來就不會對上結果。
甲、乙兩個做法都沒有違背稿上寫死的東西。

## 3. 兩個做法

### 甲 · 數字跟著關鍵字重算

沿用「選了車」那條現成的 fan-out(`/api/catalog/facet-counts`),多帶關鍵字進去。

- 動的檔:
  - `apps/storefront/src/app/api/catalog/facet-counts/route.ts`:今天沒有 `vehicle` 就回 400,改成吃 `search` 也放行
  - `apps/storefront/src/lib/vehicle-facet-counts.ts`:`countOne` 多送 `p_terms`(用 `splitSearchTerms`,與列表同一把尺);快取鍵加上詞
  - `apps/storefront/src/lib/vehicle-facet-display.tsx`:有關鍵字時也去取數,還沒回來前先不印(沿用 `null` = 不顯示)
  - 三支各自的測試檔
- **SQL:不用動。** `search_catalog_by_vehicle` 13 參那一代已經吃 `p_terms`(`20260909070000:266`)。
- 🔴 **代價**:每一個**新的**關鍵字,都要對正式庫打「分類格數 + 品牌數」那麼多發 RPC。
  2026-07-31 實測是 **108 發**(`vehicle-facet-counts.ts:16-18`;今天的數**未確認**)。
  關鍵字千奇百怪,快取幾乎打不中。純字母詞一發約 126ms(`cc8a79188` commit body),
  ⇒ 一次搜尋估計**正式庫多吃 108 × 126ms ≈ 13.6 秒 CPU**(估算,**未量**)。
  同一個 process 同時超過 3 次 fan-out 就拒絕(`MAX_CONCURRENT_FANOUTS`),數字會變成不印。
- 更省的變體:新寫一支 SQL,`GROUP BY` 一次算完。那是**新 DB 物件**(GRANT、鐵則 12、要貼正式庫)。
  `vehicle-facet-counts.ts:13` 當初也沒採用這條(「C 新增 GROUP BY RPC」)。甲量出來太慢才考慮它。
- rollback:revert 那顆 commit。沒有 migration,不用碰正式庫。

### 乙 · 有關鍵字時,側欄先不印數字

跟「新品頁」同一個做法(Sean 2026-08-11 `Q21 = B`,理由在 `vehicle-facet-display.tsx:171-179`:
數字要對得上就得每次多打 108 發查詢)。

- 動的檔:
  - `apps/storefront/src/lib/vehicle-facet-display.tsx:188-191`:`isNewArrivals` 那一格旁邊多一個「網址有 `search`」⇒ 用 `NO_COUNTS`
  - `apps/storefront/src/lib/vehicle-facet-display.test.tsx`:加兩格(有關鍵字 ⇒ 分類、品牌都回 `null`;沒關鍵字 ⇒ 照舊)
- **SQL:不用動。API:不用動。** 正式庫查詢數:**0 發新增**。
- 客人看到:搜尋結果頁的分類、品牌照樣可以點,只是旁邊沒有數字。這個樣子早就存在:新品頁、取數失敗的時候都長這樣。
- 缺點:客人看不到「這個分類裡有幾件」,要點進去才知道。
- rollback:revert 那顆 commit。

## 4. 推薦

**乙。** 錯的數字比沒有數字糟。而且乙是新品頁已經拍過的同一個做法,正式庫零新增負擔。
甲要先在正式庫量過 fan-out 的真實成本才敢上,晚點再做不會卡住客人。

## 5. 給 Sean 的題目

```
Q:客人搜了關鍵字之後,左邊分類旁邊的數字對不上結果(搜到 25 件,旁邊卻寫 14、15)。怎麼處理?
A: 甲 = 數字跟著關鍵字重算。客人看得到每個分類有幾件;可是每搜一次,資料庫要多跑約 108 次查詢,要先量會不會拖慢網站。
   乙 = 有關鍵字時先不印數字(推薦)。跟「新品」頁現在的做法一樣;分類照樣能點,只是旁邊沒數字。今天就能做完,資料庫零負擔。
```

## 6. 驗收(乙;選甲另寫)

```
🟢 修好了:/products?search=水箱護網 側欄分類、品牌旁邊都沒有數字;/products 沒關鍵字,數字照舊;選了車沒關鍵字,照舊是那台車的數字
🔴 沒修好:有關鍵字時還看得到任何一格數字
🛑 做完的定義:Sean 自己開瀏覽器搜一次、點一個分類,走到尾
```
