import type { MemberTier } from '@pcm/domain';
import { fetchRecommendedProducts } from '@/lib/recommendations/fetch-recommendations';
import { withDealerCardPrices } from '@/lib/dealer-card-prices';
import type { VehicleSelection } from '@/lib/recommendations';
import { ProductRelated } from './ProductRelated';

/**
 * N°03 相關商品的伺服器那一半(計畫-商品頁推薦查詢逾時 §4 甲-3)。
 * `page.tsx` 把它包在 `<Suspense>` 裡當 `relatedSlot` 傳給 `ProductPage` ⇒ 推薦慢的時候商品主體先送出去,
 * 推薦算好再串流補上。這段原本在 `page.tsx` 頂層 await, 推薦多慢整頁就被擋多久。
 *
 * 🔴 這裡不能 `notFound()` / 轉址:Suspense 裡面跑的時候狀態碼已經送出(見 `no-loading-boundary.test.ts`)。
 *   `fetchRecommendedProducts` 與 `withDealerCardPrices` 失敗都自己接住、回空或不印金額, 不會丟到這一層。
 */
export async function ProductRelatedServer({
  handle,
  vehicle,
  vehicleParam,
  brandSlug,
  tier,
}: {
  handle: string;
  vehicle: VehicleSelection | undefined;
  /** 網址上的車款短版 slug(`vehicleUrlParam`);只有 `vehicle` 有值時才傳。 */
  vehicleParam: string | undefined;
  brandSlug: string | undefined;
  /** `page.tsx` 用 `resolveDisplayTierStrict` 在伺服器端算好的;換經銷價在共用快取之外做(快取只存一般價)。 */
  tier: MemberTier;
}) {
  const { items, hasMore } = await fetchRecommendedProducts(handle, vehicle);
  // B2B 片 5:經銷站的經銷商看經銷價(推薦的快取只存一般價,換價回新物件、不動快取)。
  const related = await withDealerCardPrices(items, tier);

  // 「查看全部」連結(hasMore 才顯):🔴 Case A(有車)一律連車輛 filter——短版 ?vehicle 或由長版
  //   ?brand=&model= 合成短版 slug(codex R3 r2:長版書籤 Case A 不可退成商品品牌 filter=文案「相容」
  //   卻連品牌 filter 誤導);Case B(無車)連商品品牌 filter;皆無 → /products(fail-safe)。
  const moreHref = vehicleParam
    ? `/products?vehicle=${encodeURIComponent(vehicleParam)}`
    : !vehicle && brandSlug
      ? `/products?brand=${encodeURIComponent(brandSlug)}`
      : '/products';

  return (
    <ProductRelated
      related={related}
      hasMore={hasMore}
      moreHref={moreHref}
      hasVehicle={vehicle != null}
      vehicleParam={vehicleParam}
    />
  );
}
