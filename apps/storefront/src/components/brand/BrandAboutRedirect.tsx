'use client';

// BrandAboutRedirect.tsx — backlog #314 的 client 側 redirect(D3c-5;2026-08-05)
//
// 🔴 **為什麼一定是 client 側、不是 middleware / server redirect**(D3a 實查、信箱 C-25-Q Q1 →
//    C-26-A 核可):設計稿的網址契約是 `brand-page.html:1606` 的
//    `` (s) => `${catalogue(s)}#brand-about` `` = **`/products?pbrand=X#brand-about`**,
//    而 **hash 永遠不會送到 server** —— 瀏覽器根本不把 `#` 之後的東西放進請求。
//    ⇒ server 端看到的只有 `/products?pbrand=X`,那是一個**完全合法的商品目錄網址**,
//      在那裡 redirect 會把「照品牌篩商品」這個正常用法也一起劫走。只有瀏覽器分得出兩者。
//
// 這條 redirect 保住的是**設計稿字面**(鐵則 1 的 A 案配套):正式站的品牌介紹頁在
// `/brands/<slug>`(計畫 §3 拍板),但設計稿與任何已經散出去的舊連結仍指著上面那個形狀。
// 不接的話,客人會落在商品目錄的頁首、`#brand-about` 沒有對應錨點 = 什麼都沒發生。
//
// ── 行為邊界(逐條寫明,不要靠讀 code 猜)────────────────────────────────────
// · **只在 hash 恰好是 `#brand-about` 時動作**。`/products?pbrand=X`(無 hash)是正常的
//   目錄篩選,一個字都不能碰。
// · **slug 必須是已知品牌**(`BRAND_BY_SLUG`)。查無 → 不動作、留在目錄頁
//   (fail-open 是對的:那是一個能正常顯示的頁面,把客人丟去 404 更糟)。
//   🔴 `Object.hasOwn` 不是 `in`、也不是 truthy 檢查:`?pbrand=constructor` / `__proto__`
//      會取到**原型鏈**上的東西且 truthy(memory `reference_js-index-lookup-hits-prototype-chain`;
//      本 repo 五個頁面真的中過)。`app/brands/[slug]/page.tsx` 用的是同一個寫法。
// · **目錄零商品的那 5 家照樣 redirect**。它們的品牌介紹頁**內容是完整的**(沿革、工藝、年表),
//   只有商品區整區不渲染、磚牆上自己那磚泛白 —— 泛白的是**入口**不是頁面
//   (Sean 2026-08-04 拍板的範圍)。不 redirect 才會製造「連結壞掉」的感覺。
// · **`replace` 不是 `push`**:中間那個網址不該進上一頁堆疊,否則客人按上一頁會被彈回來、
//   再被 redirect 一次,出不去。
// · 讀 `window.location` 而不是 `useSearchParams()`:整件事都發生在 effect 裡,
//   沒有 render 期依賴 ⇒ 不需要 Suspense 邊界、也不會讓這條 route 掉進 CSR bailout。
// · 只認 `?pbrand=`(設計稿產出的那個 key)。legacy 的 `?brand=` 不在契約裡,不擴大範圍。
// · **只在掛載時讀一次**(deps 只有 `router`)⇒ 已經在 `/products` 之後才把 hash 加上去的
//   「同頁軟導覽」不會再觸發。今天站內**沒有任何地方**產生那種連結(磚牆與總覽卡都走
//   `brandIntroUrl` 直接指 `/brands/<slug>`)⇒ 不可達;真的出現時再改成監聽 `hashchange`。
// · 本函式用 `URLSearchParams.get('pbrand')` **只取第一個值**。設計稿的契約每次只帶一家
//   ⇒ 多值是站外手打的形狀;取第一家比「不動作」對客人好(至少到得了一個品牌頁),
//   這是刻意的選擇、不是漏想。
//   🔴 **2026-08-11 #287 更正**:原句寫「`pbrand` 在目錄側是可重複的多選 key(`?pbrand=a&pbrand=b`)」
//   —— 目錄側現在寫出的是**單值逗號分隔** `?pbrands=a,b`(舊的重複鍵仍讀得懂)。
//   本檔**刻意只認 `pbrand`**:它服務的是檔頭引的設計稿字面(`brand-page.html:1606`;
//   ⚠️ 該座標 2026-08-11 在本樹 `design-reference/` 查無、標未確認,非本片引入),
//   而 `lib/brand-url.ts` 的 `brandCatalogueUrl` 也維持產舊格式 ⇒ 兩邊自洽、不跟著 #287 改。
// · **會有一次商品目錄閃現**:`/products` 是 `force-dynamic`,server 先把整頁目錄渲染出來、
//   client 掛載後才轉走。這是 client 側方案的固有代價(hash 拿不到就沒有別的做法),
//   信箱 C-26-A 核可時已知。
// ⚠️ **已知的理論競態(關卡2 R2 nit,判為 nit、本片不補守衛)**:`useVehicleUrlSync`
//   (`products-url-state.tsx`)沒有首輪守衛,所以像 `?pbrand=X&model=x#brand-about` 這種
//   **同時帶車輛長版參數**的怪網址,它的寫回有機會蓋掉本元件的 `replace`。
//   今天站內產不出那種組合(設計稿契約只帶 `pbrand`),要補守衛得同時配一條會紅的測試 ——
//   沒有測試的守衛只是另一個沒被驗過的斷言。先記在這裡,真的出現再處理。
//
// 🔴🔴 **合法 slug 由 server 用 prop 傳下來,本檔不 import `BRAND_CONTENT`**(關卡2 R2 must-fix C):
//    第一版直接 `import { BRAND_BY_SLUG } from '@/data/brand-content'` —— 那支是 2704 行、
//    含 20 家全部文案的資料檔,而本元件是 **client**;於是**整份品牌全文被打包進 `/products`
//    的 client bundle**,只為了驗 20 個 slug。build 產物實測(修前/修後各重建):含品牌
//    全文的 chunk **105,164 bytes**、修法後 `/products` 首載 **-83,650 bytes** 歸零命中
//    (主視窗收割時以四句 brand-content 專屬長句 grep 全部首載 chunk 驗證)。
//    ⇒ 改成由 `app/products/page.tsx`(server component)算好 slug 陣列傳進來:
//      **單一真相仍是 `BRAND_CONTENT`**(不另立一份會漂移的名單),而 client 只拿到 20 個短字串。

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
// 只 import 零依賴的純字串模組 —— **不要**在本檔 import `@/data/brand-content`(見檔頭 🔴🔴)。
import { brandIntroUrl } from '@/lib/brand-url';

/** 設計稿字面的錨點(`brand-page.html:1606`)。只有這一個值會觸發。 */
export const BRAND_ABOUT_HASH = '#brand-about';

/**
 * 純副作用元件,不渲染任何東西。
 * 回傳目的地(或 null = 不動作)抽成 `resolveBrandAboutTarget`,讓行為可以被單測 ——
 * 而 hash 這件事**只有真瀏覽器證得了**,所以另有一次真瀏覽器實測(記在 commit body)。
 */
export function resolveBrandAboutTarget(
  search: string,
  hash: string,
  knownSlugs: readonly string[],
): string | null {
  if (hash !== BRAND_ABOUT_HASH) return null;
  const slug = new URLSearchParams(search).get('pbrand');
  // 🔴 用 `includes` 比對**陣列**、不是查物件的鍵 —— 原型鏈那一族(`__proto__` / `constructor`
  //    / `toString`)因此結構上不可能命中,不必再靠 `Object.hasOwn` 那道人記得寫的守門。
  if (!slug || !knownSlugs.includes(slug)) return null;
  return brandIntroUrl(slug);
}

export function BrandAboutRedirect({ knownSlugs }: { knownSlugs: readonly string[] }) {
  const router = useRouter();
  useEffect(() => {
    const target = resolveBrandAboutTarget(window.location.search, window.location.hash, knownSlugs);
    if (target) router.replace(target);
  }, [router, knownSlugs]);
  return null;
}
