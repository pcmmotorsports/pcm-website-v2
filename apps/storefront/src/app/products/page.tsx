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
import { searchProducts } from '@/lib/search';
import type { CatalogCardProduct } from '@/lib/catalog-page';
import { parseVehicleFromUrl } from '@/lib/vehicle-url';
import { parseCatalogQuery } from '@/lib/catalog-query';
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
      await fetchCatalogPage(catalogQuery, vehicle);
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
      />
    </>
  );
}
