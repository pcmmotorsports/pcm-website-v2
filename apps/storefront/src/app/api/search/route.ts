// app/api/search/route.ts — 搜尋疊層的即時結果(搜尋線 第一刀)
//
// 為什麼要有這支:稿的疊層是**邊打字邊出結果**(design-reference/components/SearchOverlay.jsx:28
// 的 `React.useMemo` 即時算),而稿算的是 `window.PCM_DATA` 這份靜態 mock —— 真站沒有那份東西,
// 所以那一格必須改成問 server。storefront 在本片之前**零支 search API**
// (數法 `find apps/storefront/src/app -ipath "*search*"` ⇒ 空)。
//
// 唯讀、無 auth、零寫入:只回公開商品卡片欄位,不回價格 tier / 訂單 / 任何個人資料。
// 資料面等同已公開的 `products_public` view(它物理排除 price_store / price_by_tier)。
//
// 🔴 **回傳面刻意比 `MockProduct` 窄**:疊層一列只畫「縮圖 / 品牌 / 品名 / 價格」
// (稿 `SearchOverlay.jsx:131-142` 的 `.sop-thumb` / `.sop-brand` / `.sop-name` / `.sop-price`)。
// 整包 `MockProduct` 含 description / images / fitments ⇒ 每打一個字就把那些送過網路一次。
// ⚠️ 加欄位前先問「疊層那一列畫得到它嗎」——畫不到就不要加。

// 🔴🔴 **已知的效能/濫用面,尚未處理 —— 不要以為有人看過就沒事了**(codex 2026-09-02 must-fix 5):
//   本 route 每一次呼叫都會走 `SupabaseProductAdapter.searchByKeyword`,而那支帶
//   `{ count: 'exact' }`(該檔 :531-536)+ 三欄**前置萬用字元** ILIKE(`%kw%`,索引用不上)
//   ⇒ **每打一個字,DB 都要數完整個命中集合**,而疊層只顯示 8 筆、**根本不用那個 total**。
//   ⚠️ 這是一支**公開、無 auth** 的端點 ⇒ 連續呼叫會直接變成連續全表掃描。
//   🛑 **我沒有修它**:要修得動 `packages/adapters` 的共用簽章(加一個「不要數」的選項),
//      而那支有 `packages/ports` 的介面與 contract test 綁著 ⇒ 那是獨立的一片,不是這一刀。
//   🔵 今天擋著它的只有 client 端 220ms debounce —— **而 debounce 擋的是我們自己的 UI,
//      不是一支 curl 迴圈。**
//   📎 已交 backlog(見 `~/pcm-mailbox/搜尋線-backlog待落-e3-20260902.md`)。
//
//   ⛔ ~~「這條路的成本我沒有在真實資料量下量過(正式庫 1 萬多件)」~~
//   🔴🔴 **上面那句話 2026-09-02 傍晚起【是假的】,而它壞的方向最貴:它會叫下一個人
//      【不要去找那個數字】,而那個數字已經有了。**(線 `-fc` 正式庫唯讀 EXPLAIN ANALYZE 量的)
//   🔴 **而「1 萬多件」那個數字本身也是錯的** —— 我當時是從「比 108 大很多」推的,
//      而**我把一個沒有來源的估計寫進了一個看起來像量測的位置**,它旁邊的 108 是量到的。
//      實際 **22,802 列**(差 2.28 倍,而那個差沒有任何機制會叫)。
//   ✅ **量到的**:
//        現況(帶 count)  Seq Scan · buffers 4,929 · 命中 3,772 / 濾掉 19,030 · **138.9/139.9/139.4 ms**
//        拿掉 count 只取 8 筆 Index Scan · buffers 31 · **0.229/0.243/0.287 ms**
//        ⇒ 時間 ~560 倍 · 讀頁 ~159 倍;單字「a」⇒ 98.8ms(⇒ 不是中文分詞,是那個 count)
//        ⇒ 一支公開端點每次呼叫 ≈ 139ms DB CPU ⇒ **一個 curl 迴圈 8 req/s 吃掉一顆 core**
//   ⚠️ **那組數字的射程(不要外推)**:正式庫唯讀 `EXPLAIN ANALYZE`,**不是打真的 HTTP 端點**
//      ⇒ 不含 PostgREST / Next / 網路;三發一致是**重現性**不是三個方法;沒量端到端、沒量並發。
//   🔴 **而【拿掉 count 之後行為對不對】仍然沒有人驗** —— 那是這件事現在唯一沒驗的那格。
//   🔵 量測由線 `-fc` 交、主視窗轉;**本窗未複量**。

import { NextResponse } from 'next/server';

import { tryCatalogBrandTaxonomy, tryCategories } from '@/lib/products';
import { suggestBrand } from '@/lib/brand-suggestion';
import { filterFacets } from '@/lib/search-facets';
import { searchProducts, SEARCH_OVERLAY_LIMIT } from '@/lib/search';
import type { SearchOverlayItem } from '@/lib/search-shape';

// 搜尋字隨使用者輸入變動、結果隨每日目錄同步變動:不進 CDN、不進瀏覽器快取。
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;


export async function GET(request: Request) {
  // 🔴 **這裡【不】截斷** —— 截斷住在 `searchProducts` 裡,因為疊層與 `/search` 兩條路都經過它。
  //    在這一層各截一次的下場:兩個畫面對同一個輸入給相反的答案(codex must-fix 2)。
  const raw = new URL(request.url).searchParams.get('q') ?? '';
  const q = raw.trim();
  if (q === '') {
    return NextResponse.json({ items: [], total: 0 }, { headers: NO_STORE });
  }

  // 🔵 第四個參數 `countTotal: false`(`⟦搜尋-每字全表掃⟧` 2026-09-02)——
  //    疊層畫面上**沒有任何地方印總數**(`SearchOverlay.tsx` 全檔 `total` ⇒ 0 行),
  //    而 `count: 'exact'` 會讓 PG 數完整個命中集合。⇒ 這條路不要付那筆錢。
  //    🛑 而 `/search` 那條路**照舊要數**(`app/search/page.tsx:85` 共 N 件)⇒ 分路,不是刪掉。
  // 🔵 **四區一起回, 不另開 route**(`⟦搜尋-第2刀⟧` 2a · `-0a` 2026-09-02 批)——
  //    稿 `SearchOverlay.jsx:34-58` 就是**一個 `useMemo` 算四區**;而另開 route ⇒
  //    疊層每打一個字發**兩發**請求 ⇒ 與同日 `⟦搜尋-每字全表掃⟧` 減成本的方向相反。
  //    🟢 而成本那一格查過了:三支 taxonomy 都是 server 端 + `unstable_cache`
  //       (`CATALOG_REVALIDATE_SECONDS`)⇒ **每個按鍵是快取命中, 不是 DB 查詢。**
  //    🔴 而它們與商品那一發**併發**跑 —— 串著跑等於白等三次 round-trip。
  // ⏱️ **四條腿各自計時**(2026-09-05 `-auth`;板列 `⟦search-TRGMEXPRIDX⟧`)——
  //    🔴 **它存在的理由是 code-reviewer R1 的 must-fix**:adapter 那一層的計時只量得到
  //       **第一條腿**, 而 route 的牆鐘 = **四腿的 max**;另外三腿走 `unstable_cache`(60s TTL)
  //       ⇒ 📌 **只看 adapter 那行的人, 會把「不在 DB」讀成「不在伺服器」。**
  //    🛑 **`Promise.all` 併發 ⇒ 四個數【加起來會遠大於 total】, 那是預期, 不是算錯。**
  //       要看的是**誰最接近 total** —— 那條就是這一發的瓶頸。
  //    ⚠️ 它證不到什麼:`unstable_cache` 命中與否**這裡看不出來**(只看得到快或慢);
  //       而 60s TTL 的 miss 節奏是「同一個詞時快時慢」目前**最像**的解釋, **未證實**。
  let msProducts = -1;
  let msBrand = -1;
  let msCat = -1;
  const tR0 = performance.now();
  const lap = () => Math.round(performance.now() - tR0);
  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 **車款那一腿【拿掉了】—— 而它是量出來的, 不是猜的**(`⟦search-TRGMEXPRIDX⟧`, 2026-09-05)
  // ══════════════════════════════════════════════════════════════════════
  //   🔬 dev preview 逐發實測(五發, 各自對 `x-vercel-id`):
  //     `route total` **逐字等於** `vehicles` 那一腿 —— 冷 **11,803~12,601ms**、暖 **33~40ms**;
  //     而 `products`(真正的搜尋)只有 **388~991ms**。
  //   🎯 ⇒ **12 秒裡有 92% 是這一腿**, 而它在這條路上【沒有人用】:
  //     · `SearchOverlay.tsx` 的 `hasAnyResult` **不含 vehicles**
  //     · `SearchOverlayFacets.tsx` 檔頭逐字:「vehicles 有資料而沒畫 …… 是 Sean 2026-09-04 拍的重出版甲」
  //   🔬 成因(`lib/products.ts:786` 起):`vehicle_taxonomy_public` **12,053 列**,
  //     而那支 loader 是**循序 `await`** 的 13 頁 × 1000 ⇒ 12,280ms ÷ 13 ≈ **945ms/頁**。
  //     (它還是 `OFFSET` 分頁 ⇒ 第 N 頁重掃 N×1000 ⇒ 全程約 78,000 列重掃。)
  //
  // 🛑 **拿掉它的三格代價, 逐字寫在這裡**:
  //   ① `facets.vehicles` 從此**恆為空陣列**、`failed.vehicles` 恆 `false`
  //      ⇒ 而**今天沒有東西讀它們**(上面兩處逐處驗過)。
  //   ② **Sean 日後若決定重新畫車款區, 這一腿要加回來** —— 而那時它仍然是 12 秒,
  //      🔴 **除非先修好那個迴圈**(板列 `⟦search-VEHTAXSLOW⟧`)。
  //   ③ 這一片**只修搜尋這條路** —— 首頁 / 商品頁 / `/products` / `/cart` / `/account` /
  //      `api/catalog/facet-counts` **照樣各自付那 12 秒**(它們是真的要用車款清單)。
  const [productPage, brandTax, categoryTax] = await Promise.all([
    searchProducts(q, SEARCH_OVERLAY_LIMIT, 0, false).then((r) => ((msProducts = lap()), r)),
    tryCatalogBrandTaxonomy().then((r) => ((msBrand = lap()), r)),
    tryCategories().then((r) => ((msCat = lap()), r)),
  ]);
  // 🔵 `vehicles=skipped` 是【刻意留在 log 裡】的 —— 直接把那個欄位刪掉的話,
  //    下一個讀 log 的人分不出「這一腿很快」與「這一腿根本沒跑」。
  console.info(
    `[api/search] qlen=${q.length} products=${msProducts}ms brands=${msBrand}ms ` +
      `categories=${msCat}ms vehicles=skipped total=${lap()}ms`,
  );
  const { items, total, error } = productPage;
  if (error) {
    // 🔴 503 不是 200 空陣列:「這次查不到」與「真的沒有這個商品」在疊層裡該畫兩種字,
    //    而回 200 空陣列會讓兩者長成同一個畫面(= 告訴客人我們沒有這件商品)。
    return NextResponse.json({ error: 'search_failed' }, { status: 503, headers: NO_STORE });
  }

  const payload: SearchOverlayItem[] = items.map((p) => ({
    slug: p.slug,
    brand: p.brand,
    name: p.name,
    price: p.price,
    image: p.image ?? null,
  }));
  // 🔴 三個 `failed` **各自回**, 不合成一個(`-0a` 明令 + `search-facets.test.ts` 有一發突變守著)。
  //    合成一個在型別上完全合法, 而它壞掉的方式是【品牌查不到 ⇒ 三區都說查不到】。
  const facets = filterFacets(q, {
    brands: brandTax,
    categories: categoryTax,
    // 🔴 見上面那一段:這一腿不再撈。給空的, 而**不是**不傳 —— `filterFacets` 的三區形狀不變。
    vehicles: { motoBrands: [], failed: false },
  });
  // ── 「你是不是要找 X?」的候選(`⟦search-BRANDTYPOTRGM⟧` · Sean 2026-09-04 拍甲)──────
  // 🔴🔴 **這裡【永遠算, 而由 UI 決定要不要畫】** —— 而那是刻意的:
  //    「零結果」的判準是**四區的聯集**, 而那個判準**已經在 `SearchOverlay.tsx` 裡了**
  //    (`hasAnyResult`, 稿 `SearchOverlay.jsx:60` 的 `total`)。
  //    🛑 **在這裡再寫一份「算不算零結果」= 同一個判準有兩個實作** ⇒ 它們會漂,
  //       而漂掉的症狀是【有結果卻也印建議】或【零結果卻不印】, 兩邊都不會紅。
  //    ⇒ 📌 **判準留一份, 放在已經有它的那一邊。** 這裡只負責「最像的是誰」。
  // 🔵 成本:25 個品牌的字串比對, 而它與那四發併發請求在同一個 handler 裡 ⇒ 量級上是零。
  // ⚠️ **`brandTax.failed` 時 `brands` 是空的 ⇒ 回 null** —— 那是對的:
  //    品牌清單讀不到的時候, 「沒有建議」比「猜一個」誠實。
  const suggestion = suggestBrand(
    q,
    brandTax.brands.map((b) => ({ name: b.name, slug: b.id })),
  );
  // 🛑 三區任一 `failed` **不**讓整發變 503 —— 商品那一區是主體, 它好的時候要照樣給。
  //    (而商品那一區自己 `error` 時上面已經 503 過了。)
  return NextResponse.json(
    {
      items: payload,
      total,
      ...facets,
      // 🔵 回 `{ name, slug }` 而不是只回名字 —— 連結要 `pbrand=<id>`(同 `SearchOverlayFacets.tsx:90`)。
      suggestion: suggestion ? { name: suggestion.name, slug: suggestion.slug } : null,
    },
    { headers: NO_STORE },
  );
}
