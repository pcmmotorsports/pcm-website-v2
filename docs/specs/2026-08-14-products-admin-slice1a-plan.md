# `#20` 片1a plan · 後台商品列表(唯讀)

> 範圍縮小(我自己縮的,明寫):交辦是「列表 + 詳情」= 我數出 10 檔、超過鐵則 4 的 45 分鐘
> ⇒ 拆 **1a(列表)/ 1b(詳情)**,本檔只寫 1a。

## 1. 要動哪些檔(6 檔,自己數的)
新增 5:`app/products/page.tsx` + `page.test.tsx`、`lib/products/product-repository.ts` + `.test.ts`、
`components/products/products-table.tsx`。修改 1:`components/layout/app-sidebar.tsx:23-36` 加一格「商品」(否則進不去)。

**刻意重用不新寫**:`components/shared/list-pagination.tsx`、`admin-data-table.tsx`。
**刻意不做(留 1c)**:篩選列、搜尋、排序。`?page=` 在本片是 3 行 inline,不先建 `product-list-view.ts`
—— 沒有篩選就沒有 `buildHref` 要組(`customer-list-view.ts` 是有篩選才需要)。

## 2. 兩個設計決定(這片真正的內容)

**① 讀 base 表 `products`,不讀 `products_public` view,也不重用 storefront 的 `SupabaseProductAdapter`。**
理由:`products_public` 濾掉下架品(`20260510134708_products_public_view.sql`),而後台**必須看得到下架的那批** ——
看不到就永遠沒辦法把它上架回來。admin 走 service_role(同 `lib/customers/customer-repository.ts:12`)讀得到 base 表。
⚠️ service_role 對 `products` 的實際 grant **未對正式庫查證**(見 §5-1)。

**② server 端分頁 `.range()`,不用 `listAllProducts()`。**
`IProductRepository.ts:59-60` 自陳那是 stopgap、「全量撈進 client」;`:64` 提到舊路徑撈 3602 件
(🔴 這是 **repo 字面、不是 DB 事實**,實際筆數未查)。後台列表用它會是同一個 TTFB 坑。

## 3. 🔴 本片與 Q-B1 的關係(主視窗 ③ 要求,我原本的說法不成立)

我在 `B-001-STOP` §4-4 寫「片1 不依賴 Q-B1」,**那句太強、收回**。
**判準(可複核,逐條問本片)**:①有沒有任何一行**寫入** `products`?②有沒有對 `price` / `delisted_at`
兩欄的**取值來源**做出承諾?①=否 ⇒ 三案都不影響。**②=是** —— 列表要顯示「售價」與「上架中/已下架」。

| | A(後台只管非同步商品) | B(覆寫欄) | C(權威留報價單) |
|---|---|---|---|
| 售價欄取值 | `products.price_general` | 🔴 改讀 `price_override ?? price_general` | `products.price_general` |
| 上下架欄取值 | `products.delisted_at` | 🔴 改讀 `delist_override ?? delisted_at` | `products.delisted_at` |
| 本片要不要改 | 否 | **要,兩欄各一處** | 否 |

⇒ **結論改寫成**:A/C 兩案本片零改動;**B 案要改兩處**。
**設計約束(讓 B 案的改動只有兩處)**:兩欄取值各集中在 repository 的一個具名函式(`resolvePrice(row)` /
`resolveListingState(row)`),頁面與表格**不得直讀 `row.price_general` / `row.delisted_at`** ——
釘成驗收 5,否則「只改兩處」是一句沒有機制擔保的話。

## 4. 片型與鐵則判定
**標準片**。**鐵則 8 命中**(6 檔)⇒ 停在 plan、等批准。**鐵則 12 不命中**(唯讀、零寫入、零 schema)。
⚠️ 但 §2-① 讀 base 表會碰到 `price_store`(經銷價)所在的表 ⇒ **select 逐欄指名、禁 `select('*')`**(驗收 4),這是本片唯一貼近錢的面。
鐵則 9:商品資料 = L3,但本片唯讀、非內容輸入面;L3 要的「後台 CRUD」正是 `#20` 整條線在做,不在本片停下。

## 5. 誠實缺口(不靠推論落筆)
1. **service_role 對 `products` 的 grant 未對正式庫查證** —— 只看到「REVOKE 都指 anon/authenticated」(`20260519031049:38`),那是 repo 字面。開工日實測。
2. **PostgREST upsert 對缺席欄的 ON CONFLICT 語意:維持未確認**(主視窗 ④)。本片唯讀不受影響,登記備查。
3. `packages/domain/src/catalog/types.ts:277` 「M-1-13 / M-1-16 **落地**」是假字面(Storage 零命中)—— **只登記、本片不改**(主視窗 ④)。
4. `products` 實際筆數未查 ⇒ 分頁大小沿用 `CUSTOMERS_PAGE_SIZE`,不宣稱它對商品量是對的。
5. storefront 端是否也有人讀 base 表 `products`、會否被我的新 select 影響 —— **未查**,批准後開工第一動補。

## 6. 驗收條件(逐條 yes/no)
1. `/products` 回 200,列出商品(含**已下架**的),每列有名稱 / 料號 / 售價 / 上架狀態。
2. DB 讀取失敗時頁面仍 200、顯錯誤態,不 500;server log 有紀錄、DB error 不外洩到畫面。
3. 分頁走 server 端 `.range()`;測試證明第 2 頁拿到的不是第 1 頁的列。
4. repository 的 select **逐欄指名**,全檔 `select('*')` 零命中(附 grep 命令與 0 行輸出)。
5. 有一條測試釘住:頁面與表格元件**零次**直接讀 `price_general` / `delisted_at`(§3 的設計約束)。
6. 側欄「商品」可點、進本頁時 active。
7. 三綠(動 .tsx ⇒ 含 build)。
8. import 全走相對路徑、無 `@/`(`app-sidebar.tsx` 既有的 `@/` 不動 —— 它的測試是 `.test.ts` 純資料測、不 render)。
