// app/products/page.tsx — 商品列表頁 route(M-1-12b)
//
// /products 對齊 Header navItem「商品目錄」(href: /products)+ HomeFooter 連結。
// 實際版面 / 篩選 / 商品 grid 由 client 元件 ProductsPage 負責。
//
// S1 變體補足(2026-07-12):車款篩選下推 DB —— URL 有車輛參數(短版 ?vehicle= / 長版
// ?brand=&model=)→ server 走 fetchProductsByVehicle(RPC = product_fitments ∪
// product_fitments_effective 去重,繼承件也命中、MT-09 SP 2021 實測 74→124);無 → 全目錄
// fetchCatalogProducts。slug→原始名解析與 PDP 同源(fetchVehicleTaxonomy + parseVehicleFromUrl、
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
  fetchCatalogBrandTaxonomy,
  fetchCategories,
  fetchVehicleTaxonomy,
} from '@/lib/products';
import { redirect } from 'next/navigation';
import { searchProducts } from '@/lib/search';
import { parseSearchFacets, hasAnyFacet } from '@/lib/parse-search-facets';
import type { CatalogCardProduct } from '@/lib/catalog-page';
import { parseVehicleFromUrl } from '@/lib/vehicle-url';
import { parseCatalogQuery, isSafeCategoryValue } from '@/lib/catalog-query';
import { parseCategoryFromUrl, CATEGORY_URL_SEPARATOR } from '@/components/products-url-parsers';
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
  const [motoBrands, categories, brands, garage] = await Promise.all([
    fetchVehicleTaxonomy(),
    fetchCategories(),
    fetchCatalogBrandTaxonomy(),
    (async () => {
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
    })(),
  ]);
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
  if (catalogQuery.search !== undefined && !hasVehicleParam && spGet('pbrands') === null) {
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
      if (parsed.vehicle !== null) next.set('vehicle', parsed.vehicle);
      if (parsed.brandIds.length > 0) next.set('pbrands', parsed.brandIds.join(','));
      if (parsed.category !== null) next.set('category', parsed.category);
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
  // 病:server 讀的是**原始網址值**(`catalog-query.ts:193-194` 只驗形狀、不查對照表),
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
  //    `catalog-query.ts:194` 的 `isSafeCategoryValue`, 而 RPC 的 `LIKE vc || ' · %'` **未跳脫**
  //    ⇒ 父分類名若含 `_` 或 `%`, rollup 會多算/錯配, 而**直打同一個名字反而會被擋掉**
  //    ⇒ 📌 #306「兩端同一道白名單」的單一定義點被繞過。
  // ⚠️ **而這是「閘漏掉一種輸入」, 不是已顯形的錯** —— 本窗無正式庫, **證不到今天存不存在這種名字**。
  const effectiveQuery =
    resolvedPath && isSafeCategoryValue(resolvedPath) && resolvedPath !== catalogQuery.category
      ? { ...catalogQuery, category: resolvedPath }
      : catalogQuery;

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
      await fetchCatalogPage(effectiveQuery, vehicle);
  return (
    <>
      {/* backlog #314:設計稿的品牌介紹連結字面是 `/products?pbrand=X#brand-about`,而
          **hash 不會送到 server** ⇒ 只能在瀏覽器裡認出來、轉去 `/brands/<slug>`。
          無 hash 的 `?pbrand=X` 是正常的目錄篩選、一個字都不碰(行為邊界寫在該元件檔頭)。 */}
      <BrandAboutRedirect knownSlugs={BRAND_CONTENT.map((b) => b.slug)} />
      <ProductsPage
        products={products}
        total={total}
        error={error}
        categories={categories}
        brands={brands}
        motoBrands={motoBrands}
        garage={garage}
        searchKeyword={catalogQuery.search}
        unmatchedWords={spGet('unmatched') ?? undefined}
      />
    </>
  );
}
