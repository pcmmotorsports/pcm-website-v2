// app/products/[slug]/page.tsx — 商品詳細頁 route(M-1-13b;M-1-16c-3 由 mock 換真資料)
//
// /products/[slug] 對齊 Q1=B 拍板:SEO 友善 slug 路由(slug = handle);
// M-1-16c-3:findProductBySlug(mock)→ fetchProductByHandle(slug)(SupabaseProductAdapter
// findByHandle + embed 真變體);不存在 → notFound() 預設 404 頁(Q5=C 拍板)。
//
// ⛔ ~~🔴 tier 釘 general(M-1-16c-3、codex 關卡1 must-fix 2):詳情頁 Phase-1 顯 general 公開價。~~
// 🔴🔴 **2026-09-07 起不再釘 general**(M-2-08 PDP 片;A 批 plan)——
//    `tier` 傳真值, 而**價不是靠 tier 從 public view 取的**, 是 route 端用 `fetchEffectivePrices`
//    另外蓋進 `dealerPrice`。⇒ 📌 **下面那句「若傳真 tier 會顯 NT$ 0」講的是【舊做法】** ——
//    它今天仍然成立(public view 確實沒有 `price_store`), 而我們沒有走那條路。**留著是因為它是那個坑的說明。**
// public view 排除 price_store、store/premiumStore 走 dummy 0;若傳真 tier 會顯「NT$ 0」。
// 變體 UI 價亦取 general(見 lib/products toUIProduct strip)。tier-aware 詳情價待 M-2-08
// server-side pricing endpoint(同 featured g-2 'general' 釘法);故移除 M-1-13H-7 的
// resolveTierFromRequest tier-override 對詳情價的用途(tier override 對詳情價失效、屬刻意 Phase-1)。
//
// 實際版面由 client 元件 ProductPage 負責(breadcrumb / vehicle pill 等用 useSearchParams、client 端讀)。
//
// M-1-16c-4c:SEO / AI 友善 —
//   - generateMetadata 強化:description ← 真 subtitle、Open Graph(type=website〔Q2=A、Next 型別不支援
//     'product'、商品語意交 JSON-LD〕/ title / desc / url / image〔絕對URL〕)、canonical(絕對 URL)。
//   - default export 注入 schema.org/Product JSON-LD <script>(server render 進 HTML、給 Google 商品結果 / AI 讀)。
//   🔴 鐵則 12 經銷防護:JSON-LD/OG 價只 general(serializeProductJsonLd 逐欄白名單、見 lib/product-jsonld.ts)。
//
// ISR 註記(審查 CONSIDER 6):本片維持 **dynamic**(fetchProductByHandle 每請求查 + ProductPage useSearchParams),
//   **不設 revalidate**;未來若引入 ISR / 靜態快取,須評估 JSON-LD/OG price 與 Google Merchant 即時一致性
//   (快取舊價 vs 後台改價)、並重跑經銷洩漏驗證(backlog 追)。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchProductByHandle, fetchProductIdsByHandles, tryVehicleTaxonomy } from '@/lib/products';
import { resolveAuthenticatedTier } from '@/lib/tier';
import { fetchEffectivePrices, priceKey } from '@/lib/tier-prices';
import { fetchRecommendedProducts } from '@/lib/recommendations/fetch-recommendations';
import type { VehicleSelection } from '@/lib/recommendations';
import { parseVehicleFromUrl, vehicleUrlParam } from '@/lib/vehicle-url';
import { serializeProductJsonLd } from '@/lib/product-jsonld';
import { resolveSiteUrl, isAbsoluteHttpUrl } from '@/lib/site-url';
import { ProductPage } from '@/components/ProductPage';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getVehicleRepo } from '@/lib/auth/composition';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProductByHandle(slug);
  if (!product) {
    return { title: '商品不存在 — PCM重機零件販售' };
  }

  const title = `${product.name} — PCM重機零件販售`;
  // description ← 真 subtitle(M-1-16c-4a plumb);空則 fallback 既有風格字面。
  const description = product.subtitle?.trim() || `${product.brand} · 適用 ${product.fits}`;

  // canonical / OG url ← 絕對 URL(prod 未設 NEXT_PUBLIC_SITE_URL 則 undefined、省略、見 site-url.ts)。
  const base = resolveSiteUrl();
  const canonicalUrl = base ? `${base}/products/${slug}` : undefined;
  // OG image 須絕對 URL(相對 placeholder 過濾;對齊 JSON-LD image guard)。
  const ogImage = (product.images ?? []).find(isAbsoluteHttpUrl);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: 'PCM重機零件販售',
      type: 'website', // Next 型別 union 不含 'product'(Q2=A);商品語意交 JSON-LD @type:Product
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    // 🔴🔴 **PDP 必須自己帶 `twitter`(2026-09-09 第5片實測後補)。**
    //   第5片在 `layout.tsx` 加了站台級的 `twitter: { images: [預設圖] }` ——
    //   而 Next 對 `twitter` 與 `openGraph` 一樣是**整組取代、不是逐欄合併**,
    //   ⇒ 站台級那組會**蓋掉 Next 原本從本頁 `openGraph` 自動推導的 `twitter:image`**
    //     ⇒ 📌 **分享商品頁到 X 會變成站台 hero 圖,而不是那顆商品的圖。**
    //   🛑 那是第5片**自己造成的回歸**,實測抓到(改之前線上量到的 twitter:image 是商品圖)。
    //   ⇒ 這裡把它帶回來:有商品圖用商品圖,沒有就讓它退回站台預設(不留裸連結)。
    ...(ogImage
      ? { twitter: { card: 'summary_large_image' as const, images: [ogImage] } }
      : {}),
    ...(canonicalUrl ? { alternates: { canonical: canonicalUrl } } : {}),
  };
}

export default async function ProductSlugRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const product = await fetchProductByHandle(slug);
  if (!product) {
    notFound();
  }

  // ── ⟦b4-DEALERSIGNUPUNSEEN⟧ M-2-08 PDP:經銷會員看自己的價(2026-09-07,A 批 plan)──
  // 🔴🔴 **蓋在 `toUIProduct` 之【後】** —— `lib/products.ts:1077` 那一行就是 strip 發生的地方
  //   (`:225-226` 逐字:變體 server-side strip、不帶 `priceByTier`、取 general)
  //   ⇒ 疊在它之前會被 strip 回 general。所以落點在這裡, 而**不動 `lib/products.ts` 的既有語意**。
  // 🔴 **`price` 不蓋** —— 它永遠是一般價;稿的經銷分支「原價」用的就是它
  //   (`design-reference/components/ProductPage.jsx:294`)⇒ 經銷價另外放 `dealerPrice`。
  // 🛑 **`tier !== 'store'` ⇒ 一發 RPC 都不打**(`fetchEffectivePrices` 內部那道邊界),
  //   而這裡**連 tier 都只查一次**;未登入 `resolveAuthenticatedTier()` 回 general。
  // 🔵 ****id 不在 Map ⇒ `dealerPrice` 是 `undefined`**(⚠️ 無差價不會走這條, RPC 會 coalesce 回 general;R1 nit 5) ⇒ 顯示端 `?? price` 退回一般價
  //   ⇒ **不會變成 `NT$ 0`**(本檔 `:7-11` 記的那個坑)。
  // ⚠️ **快取**:本 route 是 `ƒ`(build 輸出實測), 而 `fetchProductByHandle` 包的是 React 的
  //   per-request `cache()`、**不是 `unstable_cache`** ⇒ 個人有效價不會跨使用者。
  //   🛑 **哪天有人給本 route 加 `export const dynamic = 'force-static'` 或 `revalidate`,
  //     這一段就會把經銷價快取給一般會員** —— 驗收有一格在釘 build 輸出的 `ƒ`。
  const tier = await resolveAuthenticatedTier();
  if (tier === 'store') {
    // 🔴🔴 **商品那半要 uuid, 而 UI 型別裡沒有** —— `MockProduct.id` 是 `number`(不是 uuid),
    //   uuid 在 `toUIProduct` 那一層就沒帶出來。⇒ 與 `app/cart/actions.ts:288-290` 同一個理由,
    //   走同一支 `fetchProductIdsByHandles`。
    //   ⛔ ~~我 plan 裡原本寫「PDP 不需要它, 因為 product 帶 product.id」~~ —— **那句是錯的**:
    //     `:1086` 那個 `product.id` 是 **`lib/products.ts` 內部的 domain 物件**, 不是回給 route 的 UI 物件。
    //     📌 **同一個名字在兩層指不同東西, 而我在兩層之間讀錯了。**
    // 🔵 變體那半不必:`UIVariant.id` 就是變體 uuid(該型別逐字寫著)。
    // 🔴🔴 **這一整段包在 try 裡**（codex R3 must-fix ①）——
    //   `fetchProductIdsByHandles` 與 `fetchEffectivePrices` 都會**往上拋**
    //   （後者是刻意的 fail-closed，見 `lib/tier-prices.ts` 檔頭）
    //   ⇒ ⛔ 沒有這個 try：**RPC 掛掉 / 身分沒傳到 DB / uuid 查詢失敗 ⇒ 經銷會員的整張商品頁 500**，
    //     而一般會員完全正常 ⇒ **沒有人會回報**。
    //   🛑 **這不是把 fail-closed 拆掉** —— 那個契約的受詞是**結帳**（`app/cart/actions.ts` 照舊拋）。
    //     這裡是**顯示層**：降級成一般價 = **比較貴的那個方向**，不會少收；而降級這件事**留痕**。
    try {
      const idByHandle = await fetchProductIdsByHandles([slug]);
      const productUuid = idByHandle.get(slug);
      // 🔴 **uuid 查無要出聲**（codex R3 must-fix ③）：零變體 + uuid 查無時，
      //   `sent === expected === 0`、`missing === 0` ⇒ 下面那兩道都不會印，**靜靜地退回一般價**。
      if (!productUuid) {
        console.error('[pdp-dealer-price] handle 解不出商品 uuid ⇒ 商品級經銷價必定取不到', { slug });
      }
      const variantIds = (product.variants ?? []).map((v) => v.id);

      // 🔴🔴 **RPC 一次最多吃 200 個 id, 而商品 uuid 自己就佔掉一個**（codex R2 must-fix ⑥）。
      //   ⇒ 📌 **不變量：每一發送進去的 `商品 id 數 + 變體 id 數` 必須 ≤ `RPC_MAX_IDS`。**
      //   🔵 **今天離天花板很遠（2026-09-07 唯讀量到）**：有變體的商品 **25,759** 件、
      //     變體數 **≥200 的 0 件**、**最大 29**（⇒ 最多 30 個 id，餘裕 6.9 倍）；負對照 0。
      //     🛑 而**那個讀數綁著量測日期** —— 一次匯入就可能推過去，
      //     所以這裡**不是靠讀數安全的，是靠下面這個切批**：切批之後天花板不存在，讀數只是說明今天跑幾發。
      //   ⛔ ~~原本一次送 `1 + 全部變體`~~：超過 200 時**只有經銷會員的 PDP 整頁 500**
      //     ——一般會員完全正常 ⇒ 沒有人會回報。
      const RPC_MAX_IDS = 200;
      const firstChunkRoom = RPC_MAX_IDS - (productUuid ? 1 : 0);
      const priced = new Map<string, number>();
      let sent = 0;
      for (let i = 0; i < Math.max(variantIds.length, 1); i += firstChunkRoom) {
        const chunk = variantIds.slice(i, i + firstChunkRoom);
        if (i > 0 && chunk.length === 0) break;
        const part = await fetchEffectivePrices({
          tier,
          // 商品 uuid 只跟**第一發**一起送（送兩次會拿到兩份一樣的列，不是錯但白跑）。
          productIds: i === 0 && productUuid ? [productUuid] : [],
          variantIds: chunk,
        });
        sent += chunk.length + (i === 0 && productUuid ? 1 : 0);
        for (const [k, v] of part) priced.set(k, v);
      }
      // 🔴 **鐵則 11 的第四個數搬到執行期**：我餵幾個 id vs 我打算餵幾個。
      //   對不上 = 切批的算式錯了，而它印出來的每一個價都還是合法整數 ⇒ 看不出來。
      const expected = variantIds.length + (productUuid ? 1 : 0);
      if (sent !== expected) {
        console.error('[pdp-dealer-price] 切批送出的 id 數與應送數對不上 ⇒ 價可能少取', {
          slug, sent, expected,
        });
      }
      // 🔴 **用 `(kind, id)` 配對, 不是只用 id** —— 同一個 uuid 可以同時出現在兩邊,
      //   單用 id 建 Map 會互相覆蓋(`app/cart/actions.ts:299`,codex 2026-09-07 指出)。
      const own = productUuid ? priced.get(priceKey('product', productUuid)) : undefined;
      if (own !== undefined) product.dealerPrice = own;
      let missing = productUuid && own === undefined ? 1 : 0;
      for (const v of product.variants ?? []) {
        const p = priced.get(priceKey('variant', v.id));
        if (p !== undefined) v.dealerPrice = p;
        else missing += 1;
      }
      // 🔴🔴 **取不到就退回一般價，而【退回這件事本身要留痕】**（codex R2 must-fix ④）。
      //   ⛔ ~~原本只是「不賦值」~~：經銷會員零日誌地看到一般價 ——
      //   **畫面完全正常、三綠全綠、沒有人會回報**，而那是錢。
      //   🛑 **為什麼 PDP 是 log 不是 throw**（與 `lib/tier-prices.ts` 檔頭那句「呼叫端 throw」不同）：
      //     · 檔頭那句的受詞是**結帳**（`app/cart/actions.ts`）—— 那裡綁的是**要收的錢**，錯了必須擋。
      //     · 這裡是**顯示**。throw ⇒ 經銷商連商品都看不到；而**顯示一般價是「比較貴的那個方向」**
      //       ⇒ 不會少收。⇒ 📌 **錢的把關留在結帳那一層，PDP 只負責不說謊 + 留痕。**
      //     ⚠️ **代價明寫**：經銷商可能看到 A 價、結帳看到 B 價。那一致性由 ⟦auth-TIERTOTALBYPAYMENT⟧ 那條線收。
      if (missing > 0) {
        console.error('[pdp-dealer-price] 經銷會員有 id 沒取到價 ⇒ 該列退回一般價（顯示層，不擋結帳）', {
          slug, missing, expected, productUuidFound: Boolean(productUuid),
        });
      }
    } catch (err) {
      // 🛑 **吞掉例外, 但【不吞掉這件事發生過】** —— 沒有這一行, 降級就是零訊號的。
      console.error('[pdp-dealer-price] 取經銷價整段失敗 ⇒ 全部退回一般價（顯示層降級，不擋結帳）', {
        slug,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // R3/N°03 推薦引擎接線(取代 C5 fetchRelatedProducts 同分類版、對齊 plan §5 資料流):
  //   ① 讀 ?vehicle → 用 cached vehicle taxonomy 把 slug 解回原始車廠/車型名(codex #2 linchpin:
  //      URL 存 taxonomy 去重後 slug id〔含碰撞序號〕、product_fitments 存原始名、禁裸 slugify 現算;
  //      複用 /products 列表端同一 parseVehicleFromUrl + 同一 buildVehicleTaxonomy 衍生源=id 空間一致)。
  //      taxonomy 由 fetchVehicleTaxonomy(unstable_cache 60s)供給 → 詳情頁免每請求重建(plan §5 決策點解)。
  //   ② 有車且解出車型 → Case A 反查選定車相容池;否則 Case B 同品牌。引擎輸出經銷價已 strip、失敗降級空。
  const sp = await searchParams;
  const spGet = (name: string): string | null => {
    const v = sp[name];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v[0] ?? null; // 對齊 URLSearchParams.get():重複參數取首值
    return null;
  };
  // 一般 PDP(無車輛參數)不撈 taxonomy(免多餘查詢);短版 ?vehicle 或長版 ?brand=&model=(書籤舊連結、
  //   parseVehicleFromUrl fallback 分支)才解析(codex R3 F3:勿只認短版而丟長版;?brand= 單獨=商品品牌
  //   filter 語意、需 model 同在才當車輛長版、不誤觸)。
  const hasVehicleParam =
    spGet('vehicle') != null || (spGet('brand') != null && spGet('model') != null);
  // V-2b:§7「是否適用我的車」需車款字典(現選入口 VehicleSelect)+ 車庫(愛車快選);商品有 fitments
  //   才渲染比對(ProductFitmentCheck 無 fitments 返 null)→ 只在需要時撈。taxonomy(unstable_cache
  //   60s)兼供推薦引擎 slug 解析;garage=per-user RLS own、容錯 []、序列化收窄(鏡像 cart/products page)。
  const hasFitments = (product.fitments?.length ?? 0) > 0;
  const [vehicleTax, garage] = await Promise.all([
    // 🔴 2026-09-06(Sean 拍甲 · ⟦search-TAXONOMYTIMEOUT⟧):帶 `failed` 那扇門, 理由同首頁。
    //   🛑 **不撈那一支時 `failed` 必須是 `false`** —— 「這一頁不需要車款樹」與「撈失敗」是兩件事。
    hasVehicleParam || hasFitments
      ? tryVehicleTaxonomy()
      : Promise.resolve({ motoBrands: [], failed: false }),
    hasFitments
      ? (async () => {
          try {
            const supabase = await createServerSupabaseClient();
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (!user) return [];
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
            console.error('[pdp] 愛車清單讀取失敗、§7 快選退化不顯示:', garageError);
            return [];
          }
        })()
      : Promise.resolve([]),
  ]);
  // 🔵 **解構在這裡, 讓下游一個字都不用改** —— 本片要的是【多一個 `failed`】,
  //   不是改寫每一個既有的 `taxonomy` 讀取點。
  const taxonomy = vehicleTax.motoBrands;
  const vehicleTaxonomyFailed = vehicleTax.failed;
  const parsedVehicle = hasVehicleParam ? parseVehicleFromUrl({ get: spGet }, taxonomy) : null;
  // Case A 反查需 motoBrand + modelCode 都有;只選了品牌沒選車型 → 當作沒車(Case B 同品牌)。
  const vehicle: VehicleSelection | undefined =
    parsedVehicle && parsedVehicle.model
      ? { motoBrand: parsedVehicle.brand, modelCode: parsedVehicle.model, year: parsedVehicle.year }
      : undefined;

  const { items: related, hasMore: relatedHasMore } = await fetchRecommendedProducts(
    product.slug,
    vehicle,
  );

  // 「查看全部」連結(hasMore 才顯):🔴 Case A(有車)一律連車輛 filter——短版 ?vehicle 或由長版
  //   ?brand=&model= 合成短版 slug(codex R3 r2:長版書籤 Case A 不可退成商品品牌 filter=文案「相容」
  //   卻連品牌 filter 誤導);Case B(無車)連商品品牌 filter;皆無 → /products(fail-safe)。
  const vehicleParamForHref = vehicle ? vehicleUrlParam({ get: spGet }) : null;
  const relatedMoreHref = vehicleParamForHref
    ? `/products?vehicle=${encodeURIComponent(vehicleParamForHref)}`
    : !vehicle && product.brandSlug
      ? `/products?brand=${encodeURIComponent(product.brandSlug)}`
      : '/products';

  // M-1-16c-4c:schema.org/Product JSON-LD。base 未解析出時(prod 未設環境變數)省略 url 欄。
  const base = resolveSiteUrl();
  const url = base ? `${base}/products/${slug}` : undefined;
  const jsonLd = serializeProductJsonLd(product, url ? { url } : undefined);

  // ⛔ ~~M-1-16c-3:tier 釘 'general'(詳情頁 Phase-1 公開價、見檔頭 🔴 註解)。~~
  // ⇒ 2026-09-07 M-2-08:改傳真 tier(見上面那段與檔頭訂正)。
  return (
    <>
      <script
        type="application/ld+json"
        // 對齊 Next 官方 json-ld guide:escape(< → 跳脫序列 U+003C)已在 serializeProductJsonLd、防 </script> breakout。
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <ProductPage
        product={product}
        // 🔴 **傳真 tier**(2026-09-07 mainB 裁:`· 經銷價` 標記對齊稿 design L527-532 ⇒ 鐵則 1,
        //   不是可順手省的畫面差異)。價已在上面蓋進 `dealerPrice`, 顯示端用它。
        tier={tier}
        related={related}
        relatedHasMore={relatedHasMore}
        relatedMoreHref={relatedMoreHref}
        relatedHasVehicle={vehicle != null}
        relatedVehicleParam={vehicleParamForHref ?? undefined}
        motoBrands={taxonomy}
        vehicleTaxonomyFailed={vehicleTaxonomyFailed}
        garage={garage}
        // V-2h/MF-3:URL 車款不再由 route 傳 prop——ProductPage 反應式衍生(useSearchParams + motoBrands=
        //   本 taxonomy)。SSR 同繪同值(同一 parseVehicleFromUrl + MF-2 三態);同頁 URL 變更即重判。
        //   route 仍算 parsedVehicle 供推薦引擎 Case A 反查(見上)。
      />
    </>
  );
}
