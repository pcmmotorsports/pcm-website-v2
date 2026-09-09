// app/products/page.tsx — 商品列表頁 route(M-1-12b)
//
// /products 對齊 Header navItem「商品目錄」(href: /products)+ HomeFooter 連結。
// 實際版面 / 篩選 / 商品 grid 由 client 元件 ProductsPage 負責。
//
// S1 變體補足(2026-07-12):車款篩選下推 DB —— URL 有車輛參數(短版 ?vehicle= / 長版
// ?brand=&model=)→ server 走 fetchProductsByVehicle(RPC = product_fitments ∪
// product_fitments_effective 去重,繼承件也命中、MT-09 SP 2021 實測 74→124);無 → 全目錄
// ⛔ ~~fetchCatalogProducts~~ ⇒ ✅ `fetchCatalogPage`(2026-09-08:前者已移除;本 route 的無車款
// 路徑一直走的是 `fetchCatalogPage`, 那個舊名字只活在這句註解裡)。slug→原始名解析與 PDP 同源(fetchVehicleTaxonomy + parseVehicleFromUrl、
// id 空間一致);client 端 vehicle 過濾同步移除(F4:client 只認 direct、會濾掉繼承命中)。
// 車輛下拉清單(motoBrands)改由本 route 傳 prop:products 現在可能是「已按車過濾」子集、
// 不能再用 buildVehicleTaxonomy(products) 衍生(選了車後下拉會塌縮成只剩該車)。

import type { Metadata } from 'next';
import { ProductsPage } from '@/components/ProductsPage';
import { BrandAboutRedirect } from '@/components/brand/BrandAboutRedirect';
// 🔴 這支在**本檔(server component)**被 import 是刻意的:合法 slug 由 server 算好傳下去,
//    `BrandAboutRedirect` 自己不 import 它 —— 否則 2704 行的品牌全文會進 client bundle
//    (關卡2 R2 must-fix C 實測:含品牌全文的 chunk 105,164 bytes、修法後 /products 首載 -83,650 bytes)。
import { BRAND_CONTENT } from '@/data/brand-content';
import {
  fetchCatalogPage,
  tryCatalogBrandTaxonomy,
  tryCategories,
  tryVehicleTaxonomy,
} from '@/lib/products';
import { redirect } from 'next/navigation';
import { searchProducts } from '@/lib/search';
import { parseSearchFacets, hasAnyFacet } from '@/lib/parse-search-facets';
import { logSearchQuery } from '@/lib/search-log';
import type { CatalogCardProduct } from '@/lib/catalog-page';
import { parseVehicleFromUrl } from '@/lib/vehicle-url';
import { parseCatalogQuery, isSafeCategoryValue, CATEGORIES_PARAM } from '@/lib/catalog-query';
import { parseCategoryFromUrl, CATEGORY_URL_SEPARATOR } from '@/components/products-url-parsers';
import { resolveAuthenticatedTierStrict } from '@/lib/tier';
import { fetchEffectivePrices, priceKey } from '@/lib/tier-prices';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getVehicleRepo } from '@/lib/auth/composition';

// useSearchParams 在 client component 需 route 端標 dynamic、否則 production build 報
// Static Generation 錯;對齊首頁 page.tsx L31-34 既有慣例(Phase 1 dev 真資料動態)。
// #220:本 route server 端撈真目錄 → 傳 client ProductsPage(對齊詳情頁/首頁 server-fetch→client)。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '商品目錄 — PCM重機零件販售',
  description: '高端機車零件選品 · 依車款 / 分類 / 品牌篩選',
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProductsRoute({ searchParams }: Props) {
  // searchParams shim(對齊 PDP route 既有 idiom:重複參數取首值)
  const sp = await searchParams;
  const spGet = (name: string): string | null => {
    const v = sp[name];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v[0] ?? null;
    return null;
  };
  const catalogQuery = parseCatalogQuery({
    get: spGet,
    getAll: (name) => {
      const value = sp[name];
      return typeof value === 'string' ? [value] : value ?? [];
    },
  });
  // 短版 ?vehicle= 或長版 ?brand=&model=(?brand= 單獨=商品品牌 filter 語意、不當車輛;
  // 對齊 PDP route hasVehicleParam 判準)。⚠️ 例外:品牌-only 車輛選擇由 client 同步寫短版
  // ?vehicle=brandId(單段),仍走短版分支、長版不支援品牌-only(歷史書籤語意不變)。
  const hasVehicleParam =
    catalogQuery.vehicle != null || (spGet('brand') != null && spGet('model') != null);

  // 車輛下拉清單:恆撈全目錄 taxonomy(unstable_cache 60s、輕量 fitments 投影),
  // 兼作 URL slug→原始名對照表(與 client deep-link restore 同一份、id 空間一致)。
  // garage(V-1e):登入會員愛車 chips(RLS vehicles_*_own 守自己 row;未登入/讀取失敗→[]、
  //   「我的愛車」鈕整排不顯示、頁面不 500)。本 route 已 force-dynamic → 加 per-user 讀取
  //   零快取語意變更(值班台 verdict 特別查過);併入既有 Promise.all 不 serial 疊 TTFB。
  // ⟦search-CATSWITCHSLOW⟧ ② 變快那半的**儀器**(2026-09-06,主視窗 -f8 批;**只印時間與筆數**)。
  // 🔬 **為什麼非加不可**:切分類慢 3.2 秒是**量到的**(結果區計時 3212/3318 ms,與板上獨立量到的
  //   正式站 3371/3378/5487/6259 ms 同一量級);而**兇手不在 DB** —— 唯讀 `EXPLAIN (ANALYZE)` 實測
  //   帶分類的完整形狀 **22.6 ms**,比不帶分類的 **141 ms** 還快(`~/pcm-mailbox/0905查證/q-catswitch-explain-v2.sql`)。
  // 🛑 **而我從外面量到兩把打架的尺**:瀏覽器 `fetch` 說帶分類 2979–6085 ms、不帶 151 ms;
  //   同一時間 `curl` 說 1099–2243 ms vs 810 ms,而且 curl 那組**會變快**、瀏覽器那組五發都不會。
  //   ⇒ 📌 **兩把外部的尺對不起來 ⇒ 只能從裡面量。這一行就是那個「裡面」。**
  // 🔵 形狀抄 `lib/products.ts` 既有的 `[vehicleTaxonomy] cold …`,不新造機制。
  //   (⛔ ~~`cold pages=… ms=…`~~ —— 改一發 RPC 之後沒有「頁」了, 現在是 `cold n=… ms=…`。)
  // 🔴 **只印毫秒與【筆數】,不印分類名稱、不印查詢字串、不印任何使用者資料** ——
  //   分類名是客人給的自由文字,印進 log 等於把未過濾的輸入寫進另一個系統。
  const routeT0 = performance.now();
  const marks: Record<string, number> = {};
  const mark = <T,>(name: string, promise: Promise<T>): Promise<T> => {
    const started = performance.now();
    return promise.then((value) => {
      marks[name] = Math.round(performance.now() - started);
      return value;
    });
  };
  const [vehicleTax, categoryTax, brandTax, garage] = await Promise.all([
    // 🔴 2026-09-06(Sean 拍甲 · ⟦search-TAXONOMYTIMEOUT⟧):帶 `failed` 那扇門, 理由同首頁。
    mark('tax', tryVehicleTaxonomy()),
    // 🔴 2026-09-06(⟦search-SILENTDOORS2⟧, plan `docs/plans/2026-09-06-silent-doors-2-plan.md`):
    //   與車款那一扇同一個形狀 —— 走【帶 `failed` 的那扇門】, 讓「讀不到」與「真的沒有」分開。
    mark('cats', tryCategories()),
    mark('brands', tryCatalogBrandTaxonomy()),
    mark('garage', (async () => {
      try {
        const supabase = await createServerSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return [];
        // 序列化面收窄:chips 只需 id/name/year/dict 對(engine/km/mods 等不進 client props;
        // 皆本人 own 資料、此為最小面原則、與首頁 page.tsx 同一投影)
        const vehicles = await (await getVehicleRepo()).listByCustomer(user.id);
        return vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          year: v.year,
          dictBrandName: v.dictBrandName,
          dictModelName: v.dictModelName,
          isPrimary: v.isPrimary,
        }));
      } catch (garageError) {
        console.error('[products] 愛車清單讀取失敗、chips 退化不顯示:', garageError);
        return [];
      }
    })()),
  ]);
  // 🔵 **解構在這裡, 讓下游一個字都不用改** —— 本片要的是【多一個 `failed`】,
  //   不是改寫每一個既有的 `motoBrands` 讀取點。
  const motoBrands = vehicleTax.motoBrands;
  const vehicleTaxonomyFailed = vehicleTax.failed;
  const categories = categoryTax.categories;
  const categoryTaxonomyFailed = categoryTax.failed;
  const brands = brandTax.brands;
  const brandTaxonomyFailed = brandTax.failed;
  // ── ⟦search-CAPSULEPARSE⟧ 2026-09-03:自由文字 ⇒ 膠囊 ────────────────────
  //
  // 🔵 Sean 逐字:「如果是車種＋商品名稱也會盡可能的帶入相對應的膠囊這樣」
  //    ⇒ `?search=mt07 akrapovic` ⇒ **redirect 成** `?vehicle=yamaha:mt-07&pbrands=akrapovic`
  //
  // 🔴 **為什麼在 server 解析而不是在搜尋疊層**:taxonomy(車款/品牌/分類三份清單)
  //    只有 server 拿得到 —— 疊層沒有它們。
  // 🎯 **而 redirect 讓網址是【可分享的】** —— 那正是 Sean 圖二圖三的樣子(膠囊 + 貼給別人)。
  //
  // 🔴🔴 **307 不是 308,而理由比「字典會長大」更硬**:
  //    308 會被瀏覽器**永久快取** ⇒ 我們改了字典之後,**已經打過那句話的客人永遠拿到舊的解析**
  //    ⇒ 🛑 而**我們這一端量不到它** —— 那個 redirect 根本不會打到我們的伺服器
  //    ⇒ ⇒ 📌 **那是一個【我們看不見的】錯,而它會活得比字典久。**
  //    ⚠️ 所以**不要因為覺得 308 比較「乾淨」就換掉它**。(`redirect()` 預設就是 307。)
  //
  // 🛑 **防迴圈**:只有「解析出東西」**且**「leftover 比原輸入短」才跳。
  //    ⇒ 後者由 `parse-search-facets.test.ts` 那一格不變式守著
  //      (每條命中路徑都 `used.add(i)`,而 leftover 是它的補集 ⇒ 命中必然變短)。
  //    ⇒ 📌 而跳過去的網址**不再帶原本那串 search**,只帶 leftover ⇒ 第二次進來解析不出東西 ⇒ 不跳。
  // 🔵 **已經有 facet 就不再解析**(code-reviewer 2026-09-04 minor:原本沒寫理由):
  //    網址上已經有 `vehicle=` 或 `pbrands=` ⇒ 那是**客人自己選的**(或我們上一輪跳過來的)
  //    ⇒ 🛑 再解析一次會用**猜的**去覆蓋**他明確選的**, 而他不會知道被換掉了。
  //    ⇒ 📌 而它同時是 redirect 迴圈的第二道保險:跳過去的網址一定帶 facet ⇒ 第二次進來就不解析。
  // 🔴 **`q0` = 原搜尋詞, 且【在場本身】= 不再轉址(2026-09-07 定, Q47 甲)** —— 一個鍵兩個意思。
  //    ✅ 這是**沿用本頁既有形狀**:下一行的 `pbrands === null` 也不是旗標,
  //    是「某個【帶值】參數在不在」;本頁全部參數都帶值(`category`/`filter`/`page`/`per`/
  //    `pmax`/`pmin`/`price`/`search`/`sort`/`vehicle`)⇒ **站上沒有 `xxx=1` 那種旗標。**
  //    ⛔ ~~原本要新增 `nocapsule=1`~~ ⇒ 那會是**全新形狀**;主視窗 `-B` 2026-09-07 批 `q0` 兼兩義。
  //    ⚠️ **代價明寫**:一個鍵兼兩義, 少了這段註解它只會像「一個奇怪的參數」。
  //    ⛔ ~~🔵 它只從「查看全部搜尋結果 →」那條連結來, 站上沒有別的產生點。~~
  //    🔴 **2026-09-08 訂正:現在有【第二個產生點】** ——
  //       `use-catalog-filter-url-sync.tsx` 刪 `search` 時會把那個字存進 `q0`
  //       (⟦搜尋-關鍵字消失無聲⟧, 主視窗 A 拍乙)。
  //    🔵 **而它不影響本段那個判準**:本行問的是「進站時 `q0` 在不在」, 而那個第二產生點
  //       寫出來的網址**同時不帶 `search`** ⇒ 本 if 的第一個條件就不成立, 走不到這裡。
  //       搜尋框走 `SearchOverlay.tsx:247` 建**全新網址**(不合併舊參數)⇒ 新搜尋照樣會轉址。
  if (
    catalogQuery.search !== undefined &&
    !hasVehicleParam &&
    spGet('pbrands') === null &&
    spGet('q0') === null
  ) {
    const parsed = parseSearchFacets(catalogQuery.search, {
      motoBrands,
      brands,
      categories,
    });
    if (hasAnyFacet(parsed) && parsed.leftover.join(' ') !== catalogQuery.search) {
      // 🔴 **從原本的參數開始, 不是從空的開始**(code-reviewer 2026-09-04 minor)。
      //    ⛔ ~~`new URLSearchParams()`~~ ⇒ 那會把 `sort` / `per` / `pmin` / `pmax` / `filter`
      //    整組丟掉。⚠️ 站內唯一產生 `?search=` 的入口(`SearchOverlay`)只送裸 `search=`
      //    ⇒ **今天的 UI 走不到那個丟參數的世界** —— 而客人手打或分享的網址走得到。
      //    ⇒ 📌 「今天走不到」不是「不會發生」, 而這一行的成本是零。
      const next = new URLSearchParams(
        [...Object.entries(sp)].flatMap(([k, v]) =>
          typeof v === 'string' ? [[k, v] as [string, string]] : [],
        ),
      );
      // 🔵 原本那個 `search` 要拿掉 —— 它已經被解析掉了, 留著會讓 route 走關鍵字路。
      next.delete('search');
      // 🔵 **原搜尋詞帶到分類頁**(Q47 甲, Sean 2026-09-07):分類頁頂要能說
      //    「查看全部 N 筆搜尋結果 →」, 而那一行需要知道客人本來打的是什麼。
      //    🛑 它**不參與過濾** —— 與上面 `unmatched` 同一個理由:只給人看。
      next.set('q0', catalogQuery.search);
      if (parsed.vehicle !== null) next.set('vehicle', parsed.vehicle);
      if (parsed.brandIds.length > 0) next.set('pbrands', parsed.brandIds.join(','));
      // 🔴 **一個俗稱可以解出多顆分類**(Sean 2026-09-04 拍甲:魚雷管要同時列全段+尾段)
      //    ⇒ 寫成 `?categories=a,b` 單鍵逗號(形狀與 `pbrands` 同一條理由:重複鍵撞 segment cache)。
      //
      // 🔴🔴 **而【兩個鍵都要寫】—— 這一段我第一版寫錯過, 訂正留著**(R1 對抗審查抓到):
      //    ⛔ ~~舊的 `category` 鍵這裡不再寫;兩個都寫會讓解析層與讀取層各有一份判斷~~
      //    🛑 **那句話的前半是對的事實, 而它支撐了一個錯的結論。**
      //    🔬 實查:讀 `categories` 的**全 repo 只有一個** —— `lib/catalog-query.ts` 的 server 過濾。
      //       而**畫膠囊**走 `products-url-parsers.ts` 的 `searchParams.get('category')`、
      //       **URL 回寫**走 `use-catalog-filter-url-sync.tsx` 的 `params.delete('category')`
      //       ⇒ 兩個都**只認舊鍵** ⇒ 只寫新鍵的話 **一顆膠囊都畫不出來, 而篩選照樣生效**
      //       ⇒ 📌 **Sean 要的是「兩顆都列出來」, 而我那一版做成【零顆】—— 比改之前糟。**
      //    ✅ 兩個都寫**不會**產生兩份判斷:`categories ⊇ {category}` 是**解析端保證的不變式**
      //       (見 `parse-search-facets` 的回傳), 而讀取端有 `new Set` ⇒ 不會重複計算。
      // 🛑 **而多顆【顯示】那一半仍然沒做** —— 膠囊今天只畫得出第一顆。
      //    那要動 `products-url-parsers` 與 `ActiveChips`, 不在本片。
      if (parsed.categories.length > 0) {
        next.set(CATEGORIES_PARAM, parsed.categories.join(','));
        next.set('category', parsed.categories[0] as string);
      }
      // 🔴🔴 **沒用到的字放 `unmatched=`,【不是】`search=`** —— 而這一格是我差點寫錯的:
      //    ⛔ ~~本來我把 leftover 塞回 `search=`~~
      //    🛑 而 `search` 有值時 route 會走**關鍵字資料路**, 而那條路**吃不到 facet**
      //       ⇒ 📌 **我剛解析出來的膠囊會被自己忽略掉, 而畫面還會把它藏起來**
      //         (`searchKeyword` 存在時不還原 facet —— 那是 R2 修的那道閘)
      //       ⇒ ⇒ 🎯 **等於「解析出兩顆膠囊」然後「兩顆都不生效也不顯示」= 比不解析更糟。**
      //    ✅ 所以 leftover 走一個**只給人看、不參與過濾**的參數。
      // 🔵 而那是誠實的:那些字**確實沒有被用來過濾** —— 我們算不出「facet AND 關鍵字」
      //    (RPC 那條路與 ILIKE 那條路是互斥的)⇒ **就不要假裝它在過濾。**
      if (parsed.leftover.length > 0) next.set('unmatched', parsed.leftover.join(' '));
      // 🔴🔴 **記語料要在 `redirect()` 【之前】** —— `redirect()` 是用 throw 實作的,
      //    寫在它後面的每一行**永遠不會執行**, 而那件事在 diff 上長得像「我寫了」。
      //    🔵 這條路記的是**膠囊那一種**:`unmatched` 就是「我們的分類缺什麼」的直接訊號,
      //       而它是本線(俗稱字典)真正要的那一欄。
      //    🛑 這裡**沒有** `resultCount` —— 商品還沒撈, 而**編一個 0 比留空糟**
      //       (一個代表「沒有」的值會被讀成「真的 0 筆」)。
      logSearchQuery({
        path: 'capsule',
        query: catalogQuery.search,
        unmatched: parsed.leftover.length > 0 ? parsed.leftover.join(' ') : null,
      });
      redirect(`/products?${next.toString()}`);
    }
  }

  const vehicle = hasVehicleParam ? parseVehicleFromUrl({ get: spGet }, motoBrands) : null;

  // ── ⟦搜尋-落點換 /products⟧ 2026-09-03:**同一頁,兩條資料路** ────────────────
  //
  // 🔴🔴 **為什麼是兩條路而不是把關鍵字加進 query** —— 這不是偷懶,是量到的牆:
  //    `/products` 的商品走 RPC `search_catalog_by_vehicle`,而**那支沒有關鍵字參數**。
  //    數法(自己重跑得到同一組數,不要引用這行字):
  //      grep -rln "search_catalog_by_vehicle" supabase/migrations/ | while IFS= read -r f; do
  //        echo "$(grep -c -iE 'p_(keyword|search|q)\b|ILIKE' "$f")  $f"; done
  //    ⇒ 10 個定義檔**全 0**;🟢 正對照 `p_vehicle|p_brand|p_category` ⇒ 3~25 命中(尺是活的)。
  //    ⇒ 📌 **直接把 `?search=` 交給 RPC 會被【完全忽略】⇒ 顯示全部商品** —— 那比舊的
  //      `/search`(「共 668 件」)糟,而畫面上完全正常。
  //
  // 🔵 稿的落點本來就是這裡:`design-reference/components/SearchOverlay.jsx:67` 逐字
  //    `onNav('products', { search: query.trim() })`;而稿裡**沒有 `/search` 這個頁**
  //    (掃 `onNav('search'` / `page === 'search'` ⇒ 0 命中)⇒ 本片是**對回稿**,不是新功能。
  //
  // 🛑 **代價明寫:關鍵字這條路吃不到 facet**(品牌/價格/分類/車款都在 RPC 那條路上)。
  //    ⇒ 不讓它安靜:`searchKeyword` 往下傳,畫成一顆**可 ✕ 的膠囊 + 一句提示**。
  //    ⇒ 這保住了 2026-09-02 那個拍板的判準逐字:
  //      **「一個看得見的缺,永遠優於一個安靜的錯」**(`lib/search.ts` 檔頭)。
  //
  // ⚠️ **排序/分類/價格在關鍵字路上不生效,而分頁【生效】** —— `searchProducts` 吃
  //    limit/offset,所以第 2 頁是真的第 2 頁。這個不對稱是刻意的:分頁不生效會讓
  //    客人**看不到第 25 筆以後的東西**,那是漏資料;facet 不生效只是沒縮小範圍。
  // 🔵 顯式標型別:兩條路各自回 `MockProduct[]` 與 `CatalogCardProduct[]`,而
  //    `CatalogCardProduct = Omit<MockProduct,'price'> & { price: number|null }`
  //    ⇒ 前者**是**後者的子型別(`number` ⊂ `number|null`),只是 TS 不會自動把
  //      兩個【陣列】的 union 收斂 ⇒ 這裡標一次,不要用 `as any` 把差異蓋掉。
  // 🔴🔴 ⟦search-SHORTNAMEZEROFLASH⟧:**首發那一輪也要認得裸【子】分類名。**
  //
  // 病:server 讀的是**原始網址值**(`catalog-query.ts` 的 `const categoryValue = searchParams.get('category')` 那兩行 只驗形狀、不查對照表),
  //    而 RPC 只認 `category_raw = X` 或 `LIKE X || ' · %'` ⇒ `?category=機油與濾芯`(子分類短名)
  //    **首發真的撈到 0** ⇒ 要等 client hydration 把網址改寫成全路徑才重撈。
  // 🔬 2026-09-04 本機真瀏覽器實測:`647ms` 印「0 件 / 找不到符合條件的商品」→ `1352ms` 才 4 件
  //    ⇒ **客人看得到約 0.7 秒的空畫面**;負對照(頂層分類)全程沒印過「找不到」。
  //
  // ✅ **用的是 client 那一輪【同一支】`parseCategoryFromUrl`, 不在這裡另寫一份** ——
  //    📌 兩份消歧規則會分岔, 而分岔的那天沒有東西會叫(本 repo 今天已經有兩個窗各撞一次)。
  // 🔵 `categories` 在上面 `Promise.all`(:78)就 await 過了 ⇒ **這一段【沒有】多一次往返**。
  // 🛑 **負對照要活著**:名字誰都不是 ⇒ `parseCategoryFromUrl` 回 `null` ⇒ 這裡**原封不動**
  //    ⇒ 髒值照樣送進 RPC ⇒ 照樣 0 筆。**不可以退化成「總是找一個最像的」。**
  // ⚠️ **兩個順帶的行為改變, 都明寫**(R1 訂正:我原本寫「一個」, 而實際是兩個):
  //    ① `?category=<分類 id>` **首發**以前送 id 進 RPC ⇒ 0 筆;現在解析成**名稱**全路徑 ⇒ 撈得到。
  //       🔵 而**只在首發**成立 —— hydration 之後 `use-deep-link-restore.tsx:79` 早就把它改寫成名稱了
  //       ⇒ 舊世界的**穩定態不是 0 筆**。
  //    ② `?category=<大類> · <不存在的子>` **首發放寬成整個大類**
  //       (`products-url-parsers.ts:104-108`:子查無時只回大類;回歸鎖 `products-url-state.test.ts:30-33`)
  //       —— 以前送全路徑 ⇒ 0 筆。🔵 它與 hydration 後的穩定態**一致**, 不是新錯。
  const resolvedCategory = catalogQuery.category
    ? parseCategoryFromUrl({ get: spGet }, categories)
    : null;
  const resolvedPath = resolvedCategory
    ? resolvedCategory.sub
      ? `${resolvedCategory.main}${CATEGORY_URL_SEPARATOR}${resolvedCategory.sub}`
      : resolvedCategory.main
    : null;
  // 🔴 **解出來的值要再過【同一道】白名單** —— R1 抓到:少了它, 這條新路會繞過
  //    `catalog-query.ts` 的 `isSafeCategoryValue` 的 `isSafeCategoryValue`, 而 RPC 的 `LIKE vc || ' · %'` **未跳脫**
  //    ⇒ 父分類名若含 `_` 或 `%`, rollup 會多算/錯配, 而**直打同一個名字反而會被擋掉**
  //    ⇒ 📌 #306「兩端同一道白名單」的單一定義點被繞過。
  // ⚠️ **而這是「閘漏掉一種輸入」, 不是已顯形的錯** —— 本窗無正式庫, **證不到今天存不存在這種名字**。
  // 🔴🔴 **`categories` 要一起換掉, 不能只換 `category`**(R1 對抗審查抓到, Critical):
  //    少了它, `products.ts` 照送**未解析的裸短名**, 而 RPC 那側把兩個來源併成一份 `v_cats`
  //    ⇒ 變成「解析後的全路徑」+「裸短名」兩顆。
  // 🛑 **而那顆裸短名若剛好也是某個【頂層分類】的名字**, RPC 的
  //    `category_raw = vc OR category_raw LIKE vc || ' · %'` 會把**那整棵頂層樹**一起撈進來
  //    ⇒ 📌 **比修 ⟦search-SHORTNAMEZEROFLASH⟧ 之前【多撈】** —— 修法製造出一個修之前不存在的形狀。
  // ⚠️ **那個世界存不存在, 本窗證不到**(要對正式庫問「有沒有頂層名 == 某個子分類短名」)
  //    ⇒ 所以這裡**不賭它不存在**, 直接把裸短名換掉。
  const effectiveQuery =
    resolvedPath && isSafeCategoryValue(resolvedPath) && resolvedPath !== catalogQuery.category
      ? {
          ...catalogQuery,
          category: resolvedPath,
          categories: [
            ...new Set([
              resolvedPath,
              ...catalogQuery.categories.filter((c) => c !== catalogQuery.category),
            ]),
          ],
        }
      : catalogQuery;

  // 🔴🔴 **身分要在【取商品之前】解析出來, 而它原本在下面**(⟦front-CATALOGPRICEGENERALONLY⟧)。
  //   成因:經銷會員的**篩選與排序**也要用他看得到的那個價 ⇒ `fetchCatalogPage` 得先知道他是誰。
  //   🛑 **往上搬會改變一件事, 而我查過了**:它落在 render 路徑的更前面 ——
  //     而 `resolveAuthenticatedTier` 內部任何不確定都回 `general`、**不往上拋**
  //     (`lib/tier.ts` 那段註解逐字寫著為什麼不讓它 reject)⇒ 搬上來**不新增失敗點**。
  //   🔵 **解一次、兩個地方共用**(取商品 + 下面蓋價):同一個請求解兩次的話,
  //     兩發之間可以不一致, 而**那種不一致不會有任何東西叫**。
  const catalogTierStrict = await resolveAuthenticatedTierStrict();
  const catalogTier = catalogTierStrict.tier;
  /**
   * 🔴🔴 **[codex R2 must-fix:身分【靜默降級】會繞過下游那條「經銷 RPC 失敗必顯錯」]**
   *
   * `resolveAuthenticatedTier()` 對任何不確定都回 `general` 且**不往上拋**
   *   (`lib/tier.ts` 那段註解逐字寫著為什麼刻意不讓它 reject:讓它 reject =
   *    新增一個「Supabase 一抖首頁就 500」的失敗點,而改之前沒有)。
   * 🛑 **而本片在下游立了一條相反的規矩**:經銷 RPC 失敗 ⇒ **回錯誤狀態、不靜默退回**。
   *   ⇒ 📌 **兩條路的處置不對稱**:RPC 掛了會吵,而**「我根本不知道他是不是經銷」不會吵**
   *     ⇒ 一個 `customers.tier` 讀取逾時的 store 會員,會拿到一份**依牌價篩選排序**的目錄,
   *       而**畫面上完全正常**。
   *
   * 🔴 **我【沒有】改成 fail-closed, 而那是判斷不是遺漏**:
   *   `reason === 'tier'` 涵蓋**每一個登入者**(絕大多數是一般會員)——
   *   讓他們在一次瞬時失敗時看到錯誤頁, 是**替全客群新增一個單點故障**去救一個今天 0 人的族群。
   * ✅ **我做的是把【後果】講出來** —— `lib/tier.ts` 那三處 `console.error` 說的是
   *   「tier 讀不到、退化 general」, 而它**沒有說那會影響目錄的篩選排序**。
   *   ⇒ 🎯 **兩個世界本來就印不同的東西(有 log / 沒 log), 而 log 沒有說出它的代價。**
   * ⛔ ~~**已知缺口, 未被接受**:要不要對 `reason === 'tier'` 的登入者改成顯錯, 是 Sean 的題。~~
   * 🟢🟢 **[2026-09-08 Sean 拍甲 —— 這題結案了, 現況就是拍板後的樣子]**
   *   逐字:「① 身分查不到的時候要給牌價還是錯誤頁    **給牌價**」(主視窗 A 端;
   *   題目 `~/pcm-mailbox/front-003-Q.md`、memory `project_0908-tier-lookup-failure-shows-general`)。
   *   ⇒ 📌 **上面那段 `console.error` 從此不是「暫時的留痕」, 它是這個決定的觀測面。**
   *   ⇒ 🛑 **下一個人不要把它「順手改成 fail-closed」** —— 那會推翻一個拍板。
   *   他採納的三個理由(原封轉的):①同一個做法目錄頁已上線, 只改一頁 ⇒ 兩頁分岔
   *   ②改 fail-closed = 替【每一個登入客人】新增當機點(`lib/tier.ts:109-116`:走到
   *   `reason:'tier'` 的前提是 user 非 null)去救一個今天 0 人的族群 ③產品行為不是執行端可以拍的。
   * 🔵 **射程**:本題答的是【查不到身分那一瞬間】, 不是正常情況。正常情況經銷會員看經銷價。
   *   而答案**一次套三頁**(`/products` · `/brands/[slug]` · 未來任何看得到價的頁)。
   */
  if (!catalogTierStrict.ok && catalogTierStrict.reason === 'tier') {
    console.error(
      '[products] 身分解析失敗、退化 general ⇒ 🔴 這一頁的【篩選與排序】會用牌價算。'
        + ' 這個人是【已登入】的 ⇒ 他可能是經銷會員, 而畫面上看不出來。',
      { path: '/products' },
    );
  }

  const { products, total, error }: {
    products: CatalogCardProduct[];
    total: number | undefined;
    error: boolean;
  } = catalogQuery.search
    ? await (async () => {
        const r = await searchProducts(
          catalogQuery.search as string,
          catalogQuery.perPage,
          (catalogQuery.page - 1) * catalogQuery.perPage,
        );
        // 🔴 `total: null` = **不知道總數**,不是 0 —— 往下傳 `undefined`,
        //    讓 `ProductsPage` 的 optional prop 走「不印件數」而不是印一個編出來的 0。
        return { products: r.items, total: r.total ?? undefined, error: r.error };
      })()
    : // P4:只回當頁公開 card DTO + total；車款仍走 direct + inherited RPC 語意。
      await mark('page', fetchCatalogPage(effectiveQuery, vehicle, catalogTier));
  // ══ 經銷會員的價蓋上去(⟦b4-DEALERSIGNUPUNSEEN⟧ 的第二半;PDP 那半 = `ab1d839b8`)══
  // 🔴 **為什麼在【這裡】而不在 `fetchCatalogPage` 裡面**:那支走 `unstable_cache`,
  //   而快取鍵只有 query + vehicle 四個參數、**沒有 tier**(`lib/products.ts:528-534`,
  //   2026-09-07 開檔量到)⇒ ⇒ **一個經銷會員的價會被快取起來, 然後餵給下一個一般會員。**
  //   ✅ 本 route 是 `export const dynamic = 'force-dynamic'`(本檔 `:41`)⇒ 不快取。
  //   🛑 **哪天有人把這一段搬進 `fetchCatalogPage`, 或把本 route 改成 static/revalidate,
  //     它就會把經銷價快取給一般會員** —— 驗收有一格在釘「general tier 的 props 裡沒有 dealerPrice」。
  //   🔵 **[2026-09-08 補一個指標]** 這段警語**寫在呼叫端**, 而要動 `fetchCatalogPage` 的人
  //     是從 `lib/products.ts` 那一側進來的 —— 🔴 **我做 ⟦front-CATALOGPRICEGENERALONLY⟧ 時
  //     就沒看到它, 自己重推了一次同一格。** ⇒ 同樣的話現在也寫在那一側,
  //     而**守門在 `lib/catalog-dealer-not-cached.test.ts`**(它的世界是一個真的會記住的快取)。
  //     📌 **一段寫對了而【放在讀者不會路過的地方】的警語, 與沒寫的差別比想像中小。**
  // ══ 🔴🔴 **一個來源, 一個快照**(Sean 2026-09-08 裁甲, 逐字「甲 不掛了 —— 一個來源、一個快照」)══
  //
  // ⛔ ~~`catalogTier === 'store'` ⇒ 用 `get_effective_prices` 再讀一次經銷價蓋進 `dealerPrice`~~
  // 🛑 **接上經銷目錄 RPC 之後那一步變成【第二次讀同一個數字】**:
  //    `products[].price` 本身已經是經銷價(那支 RPC 讀 `products_list_dealer`, 該 view 逐字
  //    `coalesce(pr.price_store, v.price_general) AS price_general`)。
  //    ⇒ 📌 兩支獨立 RPC 兩個快照:`price_store` 在兩發之間 4800→4700 ⇒ 篩選/排序/`price` 用 4800、
  //      `dealerPrice` 用 4700 ⇒ **同一份 props 兩個經銷價**(codex 2026-09-08 must-fix)。
  // ✅ ⇒ **經銷路徑不再蓋** —— `dealerPrice ?? price`(`products-filter-logic.ts:165`)
  //    在欄位不存在時退回 `price`, 而 `price` 已經是對的那個數字。
  //
  // 🔴🔴 **而這推翻了一條拍板 —— 留痕, 不靜靜改掉**:
  //    ⛔ ~~判準是「有沒有 `dealerPrice` 這個欄位」(主視窗 B 2026-09-07 裁甲)~~
  //    ⇒ **2026-09-08 Sean 裁甲**「不掛了, 一個來源一個快照」
  //      ⇒ **`tier === 'store'` 的 props 從此【沒有】那個欄位。**
  //    📌 **舊拍板不是錯的 —— 是【它問的那個世界不存在了】**:
  //      舊前提「`price` 是一般價, 所以 store 要另外有 `dealerPrice`」已經不成立。
  //    🔵 **三處都留了刪除線**(本段 · `products-filter-logic.ts` 那支函式的 docstring ·
  //      `products/page.test.tsx` 那三格守門的抬頭)⇒ 搜「有沒有這個欄位」的人
  //      **不論從哪一處進來, 都會同一發撞到訂正**。
  //      ⚠️ 我原本在這裡寫「`products-filter-logic.ts:152` **仍寫著**舊判準」——
  //      🛑 **那句在我改完那支檔的當下就過期了**, 而它是我自己寫的。
  //      📌 **一句描述「別處現在長什麼樣」的註解, 有一個沒有人會去看的到期日。**
  //
  // 🔵 **本片保留的那條路**:`fetchEffectivePrices` 這支函式本身**不動**
  //    —— 商品詳情頁(`products/[slug]/page.tsx:162`)仍然在用它, 而那一頁**沒有**走經銷目錄 RPC。
  //    ⇒ 📌 **只有目錄頁這一個呼叫端改掉, 不是把那支函式廢掉。**
  /**
   * 🔴🔴 **[codex R2 must-fix:我把【關鍵字搜尋】那條路的經銷價弄不見了 —— 那是回歸]**
   *
   * 上面那個三元運算有**兩條路**:
   * ```
   * catalogQuery.search 有值 ⇒ searchProducts()      ← ILIKE 那條, 【沒有】經銷版本
   * 沒有                     ⇒ fetchCatalogPage(…, tier) ← 本片改的那條, price 已是經銷價
   * ```
   * 🛑 **而我把疊價整段拿掉時, 兩條路一起被拿掉了** ⇒ 經銷會員打關鍵字搜尋
   *    看到**牌價**, 點進商品頁又變經銷價 ⇒ 📌 **同一個商品前後兩個價, 而畫面完全正常。**
   * 🔴 **那不是「原本就這樣」** —— 疊價本來涵蓋兩條路, **是我拿掉的。**
   *
   * ✅ **修法 = 疊價【只留給關鍵字那條路】**:
   *    · 目錄那條:`price` 已經是經銷價 ⇒ **不疊**(疊了就是兩支 RPC 兩個快照, Sean 裁甲禁止)
   *    · 關鍵字那條:`searchProducts` 回的是牌價 ⇒ **照舊疊**(它今天沒有經銷版本)
   *    ⇒ 🎯 **兩條路各自【一個來源】, 而不是同一條路兩個來源。**
   * ⚠️ **代價明寫**:關鍵字那條路的**篩選與排序仍然吃牌價**(那是 `searchProducts` 內部的事)
   *    ⇒ 🛑 **本片沒有修那一半, 而它是 `⟦db-SEARCHFACETMUTEX⟧` 那一列的地盤**(DB 側)。
   *    ⇒ 📌 **這裡修好的只有「他看到的那個數字」, 不是「他篩到的那批商品」。**
   */
  const usedKeywordSearch = Boolean(catalogQuery.search);
  const dealerPrices =
    usedKeywordSearch && catalogTier === 'store'
      ? await fetchEffectivePrices({
          tier: catalogTier,
          // 🔴 `productId` 是 optional ⇒ 濾掉沒有的, 而**不是** `?? ''` ——
          //   一個空字串會變成一把查不到的鍵, 而它看起來像查過了。
          productIds: products
            .map((p) => p.productId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
          variantIds: [],
        })
      : new Map<string, number>();
  const pricedProducts: CatalogCardProduct[] =
    dealerPrices.size === 0
      ? products
      : products.map((p) => {
          const dealer =
            p.productId === undefined ? undefined : dealerPrices.get(priceKey('product', p.productId));
          // 🔵 `typeof dealer === 'number'` 就是「這個 id 在不在 Map」—— `0` 會留住
          //    (主視窗 B 2026-09-07 裁甲那條, 在【關鍵字這條路上】仍然成立)。
          return typeof dealer === 'number' ? { ...p, dealerPrice: dealer } : p;
        });

  // ══ ⟦f3-NEWARRIVALBRANDLIST⟧ 2026-09-09 · Sean 在正式站抓到,拍【乙】═══════════════
  //
  // 🔬 **他看到的**(`?filter=new&pbrands=wrs`):側欄列出**全部 20 家品牌**,而那一頁 **0 件商品**。
  //   他的原話:「**如果點擊其他品牌會變成沒商品**」⇒ 📌 側欄給了他一排點下去會落空的東西。
  //
  // 🔬 **成因(先查才動)**:側欄品牌來自 `catalog_brand_counts()` RPC = **全站聚合**
  //   (`lib/products.ts` 的 `queryCatalogBrandTaxonomy`)—— 它**沒有任何條件參數**,
  //   不知道有沒有 `?filter=new`。⇒ 它列的是「這家在整個型錄裡有幾件」,不是「在新品裡有幾件」。
  //
  // ✅ **修法 = 從【這一頁真的查到的新品】反推有哪幾家**,不另外打 DB、不改 RPC。
  //
  // 🔴🔴 **而它有一個天花板,寫在這裡而不是只活在訊息裡**:
  //   我們手上只有**這一頁**(`perPage` 筆)。新品**超過一頁**時,只看第一頁會**漏掉品牌** ——
  //   而漏掉的樣子是「側欄少了幾家,而客人看不出來少了」⇒ 📌 **那比「列了全部」危險得多。**
  //   ⇒ ⇒ **所以算不完整就【退回列全部】(fail-open)**,絕不端出一個不完整而看不出來的清單。
  //   🛑 **判別式逐條**(任何一條不成立就不過濾):
  //     ① `filter === 'new'`          —— 只在新品那條路上做,一般目錄頁行為逐字不變
  //     ② `error === false`           —— 撈失敗時 `products` 是空的,過濾會把側欄清空
  //     ③ `page === 1`                —— 第 2 頁手上是別的切片,拿它反推是錯的
  //     ④ `typeof total === 'number'` —— 不知道總數就不知道算沒算完
  //     ⑤ `total <= 這一頁筆數`        —— 這一頁裝得下全部新品,才叫「算完了」
  //
  // 🔴 **件數也要一起換掉,不能只篩清單** —— `FilterTop.tsx:301` 逐字印 `{b.count}`,
  //   而那是**全站**件數。只篩清單的話,客人會在新品情境看到「RPM CARBON 1508」
  //   ⇒ 📌 **一個描述別的集合的數字,比一家點不進去的品牌更難發現。**
  //   ⇒ 手上既然有完整那批,順手就算得出每家幾件,用真的那個數。
  //
  // ⚠️ **甲(拿掉批次日規則)上線之後,這一片多半會走 fail-open** ——
  //   今天新品 37 件(一頁裝得下),拿掉之後是 **3,615 件**(裝不下)⇒ ⑤ 不成立 ⇒ 退回列全部。
  //   🛑 **那是【安全的退回】不是壞掉**,而它也表示**那時候乙的效果會消失**。
  //   ⇒ 要在那個世界裡仍然有效,得改走「`catalog_brand_counts` 加條件參數」= 另一支 migration
  //     ⇒ **那是新的一題,等甲上線之後再問 Sean。本片刻意不提前買單。**
  const sidebarBrands = ((): typeof brands => {
    if (catalogQuery.filter !== 'new') return brands;
    if (error || catalogQuery.page !== 1) return brands;
    if (typeof total !== 'number' || total > pricedProducts.length) return brands;
    const counts = new Map<string, number>();
    for (const p of pricedProducts) {
      if (p.brandSlug === undefined) continue;
      counts.set(p.brandSlug, (counts.get(p.brandSlug) ?? 0) + 1);
    }
    const kept = brands
      .filter((b) => counts.has(b.id))
      .map((b) => ({ ...b, count: counts.get(b.id) ?? 0 }));
    // 🔵 **算出空的也退回** —— 那代表這批新品的 `brand_slug` 與側欄那份對不起來(資料不一致),
    //   而「側欄一家都沒有」比「列了全部」更像壞掉。寧可多不可少。
    return kept.length > 0 ? kept : brands;
  })();

  // ⟦search-CATSWITCHSLOW⟧ 儀器輸出 —— **一行,而它要能單獨回答「那 3 秒花在哪一段」**。
  // 🔵 `catsN` 是**筆數不是名字**;`hasVeh` / `kw` 是布林。搜尋那條路不經過 `mark('page')`
  //   ⇒ 它會印 `page=-1`,而那是**「這一發沒走目錄查詢」**,不是 0 毫秒。
  //   🛑 少了這個區分,搜尋那條路會被讀成「目錄查詢瞬間完成」。
  // 🔴 `total` 是**本函式量到的牆鐘**,不含 RSC 序列化與傳輸 ⇒ 它比客人等的時間**短**,
  //   而那個差本身就是讀數:`total` 遠小於客人等的秒數 ⇒ 慢的在這一行**之外**。
  console.info(
    `[catalogRoute] tax=${marks.tax ?? -1}ms cats=${marks.cats ?? -1}ms brands=${marks.brands ?? -1}ms ` +
      `garage=${marks.garage ?? -1}ms page=${marks.page ?? -1}ms total=${Math.round(performance.now() - routeT0)}ms ` +
      `catsN=${effectiveQuery.categories.length} brandsN=${effectiveQuery.brandSlugs.length} ` +
      `p=${effectiveQuery.page} per=${effectiveQuery.perPage} sort=${effectiveQuery.sort} ` +
      `hasVeh=${vehicle !== null && vehicle !== undefined} kw=${catalogQuery.search !== undefined} rows=${products.length}`,
  );
  return (
    <>
      {/* backlog #314:設計稿的品牌介紹連結字面是 `/products?pbrand=X#brand-about`,而
          **hash 不會送到 server** ⇒ 只能在瀏覽器裡認出來、轉去 `/brands/<slug>`。
          無 hash 的 `?pbrand=X` 是正常的目錄篩選、一個字都不碰(行為邊界寫在該元件檔頭)。 */}
      <BrandAboutRedirect knownSlugs={BRAND_CONTENT.map((b) => b.slug)} />
      <ProductsPage
        products={pricedProducts}
        total={total}
        error={error}
        categories={categories}
        brands={sidebarBrands}
        motoBrands={motoBrands}
        vehicleTaxonomyFailed={vehicleTaxonomyFailed}
        categoryTaxonomyFailed={categoryTaxonomyFailed}
        brandTaxonomyFailed={brandTaxonomyFailed}
        garage={garage}
        searchKeyword={catalogQuery.search}
        unmatchedWords={spGet('unmatched') ?? undefined}
      />
    </>
  );
}
