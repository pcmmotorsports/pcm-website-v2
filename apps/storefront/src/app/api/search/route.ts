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

  const { items, total, error } = await searchProducts(q, SEARCH_OVERLAY_LIMIT);
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
  return NextResponse.json({ items: payload, total }, { headers: NO_STORE });
}
