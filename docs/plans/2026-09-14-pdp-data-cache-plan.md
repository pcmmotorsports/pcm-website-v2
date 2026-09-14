# plan · 商品頁 /products/[slug] 讓爬蟲打快取(丙)—— 2026-09-14 B 窗

> 主視窗派第 14 件;是 `2026-09-14-products-crawler-rate-limit-plan.md` 的丙。碰 next 快取策略 + 共用 lib ⇒ 鐵則 8, 只 plan。
> 🔴 紅線(不能破):0906 Q24 經銷價未稅不標、`CLAUDE.md` 「經銷價絕不到一般會員瀏覽器」;PDP `page.tsx:112-115` 逐字警告
> 「哪天有人給本 route 加 `force-static` 或 `revalidate`, 這一段就會把經銷價快取給一般會員」。本 plan 的形狀就是繞開那一句。

## 1. 為什麼今天每一發都 MISS(build 輸出 `ƒ`;runtime log 8,577 頁全 `cache=MISS`)
route 讀了 request 才有的東西 ⇒ Next 判 dynamic ⇒ CDN 不快取、每發跑 function:
| 來源 | 檔案:行 | 讀什麼 | 需不需要每發算 |
|---|---|---|---|
| 會員等級 | `app/products/[slug]/page.tsx:116` `resolveAuthenticatedTier()` → `lib/tier.ts` → cookies | 判 `store` 才疊 `dealerPrice`(`:117-`) | 要(經銷價個人化) |
| 愛車清單 | `page.tsx:235-250` `createServerSupabaseClient()`(`lib/supabase/server.ts:33` `await cookies()`)+ `getVehicleRepo().listByCustomer` | §7 快選 | 要(個人) |
| 車款參數 | `page.tsx:212-223` `searchParams` vehicle / brand / model | 適用車款 highlight + 推薦 | 半要(有參數才算;爬蟲多半沒帶) |
| 商品本體 | `lib/products.ts:1371` `fetchProductByHandle` = React `cache()`(**per-request**, 不是 `unstable_cache`)→ `findByHandle` + `listInheritedFitments` | 一般價商品 + 變體 + 適用 | 🔴 不要:同 slug 給誰都一樣(已 strip 成 general) |
| 推薦商品 | `lib/recommendations/fetch-recommendations.ts:27` 每發打 catalog | 8 個推薦 | 不要(可依 slug+vehicle 快取) |
| 車款字典 | `lib/products.ts:1053` `getVehicleTaxonomyCached`(`unstable_cache`) | 已快取 | — |
⇒ 📌 每一發跑 function 是 tier / 愛車那兩個 cookies 讀取決定的;**而重的是商品本體 + 推薦那兩發 DB**(OOM 67 次 / 32 人在爬蟲波段裡 = 併發跑重查詢), 它們今天零跨請求快取。

## 2. 改成什麼(兩層, 推薦先做 L1)
**L1 · Data Cache(不動 route 的 dynamic 性質, 零紅線風險)**
- `fetchProductByHandle` 內層抽成 `getProductByHandleCached = unstable_cache(async (handle) => …, ['pdp-product'], { revalidate: 300, tags: ['catalog', 'product:<handle>'] })`,外層 React `cache()` 留著(同一 request 不重打)。快取的東西**逐字就是今天回傳的 general 版 UI 物件**(`toUIProduct(product,'general')` + inherited fitments)⇒ 裡面本來就沒有經銷價(`lib/products.ts:225-226` strip)。
- `fetchRecommendedProducts(handle, vehicle)` 同款 `unstable_cache`,鍵 = handle + vehicle 四參數(照 `catalog-query.ts:252` 的穩定鍵紀律),revalidate 300。
- **route 一個字不動**:tier / dealerPrice 疊加 / 愛車照舊每發算(便宜:一發 cookies + 一發小查詢;`tier !== 'store'` 零 RPC)。
- 效果:function 照跑(CDN 仍 MISS), 但 DB 從「每發 2-3 重查詢」變「每 slug 每 5 分鐘 1 次」;OOM 的成因(併發重查詢)消失。
- 🛑 對【單趟掃全站】的爬蟲, L1 第一趟**零命中**(8,577 個 slug 各一次);第二趟起命中。⇒ L1 治的是 OOM / 逾時, 不是流量;流量那半是甲(rate limit)。
- 資料新鮮度:同步完成後最多 5 分鐘舊價 / 舊庫存(與 `/products` 列表今天的 60s 同族, `products.ts:137` 已接受過);要立刻生效 ⇒ `revalidateTag('catalog')`(`products.ts:122-126` 明說不接, 維持)。

**L2 · 靜態殼 + 動態島(CDN HIT, 爬蟲根本不跑 function)—— 第二片, 先看 L1 讀數再決定要不要**
- route 改成 `export const revalidate = 300`(或 Next 16 `'use cache'` + `cacheLife`),頁面本體只含一般價;tier / dealerPrice / 愛車三樣搬進 `<Suspense>` 裡的 server component 島(讀 cookies 的只有那個島)。
- 🔴 紅線的證法:build 輸出該 route 從 `ƒ` 變 `◐`(partial)且 `page.test.tsx` 那格「釘 ƒ」改成釘「dealerPrice 只在島裡、殼的 HTML 裡 grep 不到 `dealerPrice` / `price_store`」;E2E:一般會員與經銷會員各開同一個 slug, 一般會員 HTML 零經銷價字串。
- 代價:PPR / cacheComponents 在 next.config 開旗標(鐵則 8)、Suspense 邊界改動 UI 骨架、SEO JSON-LD 裡的價要確認仍是一般價。體積 2-3 片, 不在本 plan 開。

## 3. MISS 率預估(前 / 後)
- 今天:CDN MISS 100%、DB 每發 100%(runtime log `cache=MISS` 8,577/8,577)。
- L1:CDN MISS 仍 100%;**DB 命中率 = 1 − (不重複 slug 數 ÷ 總請求)** —— 爬蟲單趟 ≈ 0%、第二趟起 ≈ 100%;真客人(熱門 slug 重複看)估 60-80%(用 24h `group_by requestPath` 的重複度算:前 25 名 slug 各 7-8 發 ⇒ 那批 ≈ 87% 命中)。
- L2:爬蟲 CDN HIT ≈ 100%(5 分鐘窗內同 slug)、function 只跑島 ⇒ OOM 歸零;首趟仍要 render 一次殼(ISR on-demand)。

## 4. rollback
- L1:兩支 `unstable_cache` 換回原函式(一顆 revert);快取殘留最長 300s 自己過期;零 schema、零 env。
- L2:revert 那顆 + next.config 旗標;build 輸出回 `ƒ`(測試釘著)。

## 5. 分片
1. L1(≤45 分):`lib/products.ts` 抽 `getProductByHandleCached` + `fetch-recommendations.ts` 加 `unstable_cache`;測試:鍵不含 tier(照 `catalog-page.ts:85` 那格的反例寫一格「同 handle 兩個 tier 拿到同一份、都沒有 dealerPrice」);`page.test.tsx` 「釘 ƒ」那格照舊綠;三綠 + 本機 storefront-probe 開兩次同 slug 看第二次 DB 零查詢(Supabase log 或 adapter 計數)。codex 一輪(碰價格路徑, 鐵則 12)。
2. 上線 24h 後讀:OOM 次數(A 窗那把尺)、`[pdp]` 逾時次數、Data Cache 命中(Vercel Observability → Data Cache)。
3. L2 要不要開:讀數說 OOM 還在才開;否則甲(rate limit)+ L1 就夠。
```
Q1: L1 先做?
A: 甲 做(推薦;零紅線風險, 一片)| 乙 直接做 L2(2-3 片 + next.config)| 丙 都不做, 只靠甲的 rate limit
```
