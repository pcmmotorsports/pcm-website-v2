// product-seo-title.ts — 商品頁 <title>(= og:title;twitter:title 由 Next 從 openGraph 繼承)
//
// 🔴 Sean 2026-09-12 02:3x 拍甲:幾百件同名(「導航支架 — PCM重機零件販售」)⇒ Google 分不出。
//    改成「{品牌} {品名}|{車款} — PCM」。**只改 Google 那行藍字,頁面上的商品名一字不動。**
//    不放料號、不放年份;通用款(零車款)不加車款段。
//
// 車款段:來源 = 商品卡「適用」那一格同一份 `fitments`(`product-card-fits.ts`,brand+model 去重、不含年式);
//   格式 = 577c14bf3 的副標規則:1 台 ⇒ 那台 · 2 台 ⇒「A / B」· ≥3 台 ⇒「A 等 N 款車型」。
//   ⚠️ 代表車款取【第一台】—— 副標那邊用的是同步時的 `vehicle_label`,前台拿不到 ⇒ 兩邊代表可能不同台。

import type { UIFitment } from '@/data/mock-products';

function distinctModels(fitments: readonly UIFitment[] | undefined): string[] {
  const seen = new Set<string>();
  for (const f of fitments ?? []) {
    // 🔴 `fetchProductByHandle` 會把家族樹推導的 inherited 車款併進來(`lib/products.ts` 那段 extra);
    //    卡片與副標只數原廠列 ⇒ 這裡也只數原廠列,不然標題的 N 會比副標大。
    if (f.matchSource === 'inherited') continue;
    const brand = typeof f.motoBrand === 'string' ? f.motoBrand.trim() : '';
    const model = typeof f.modelCode === 'string' ? f.modelCode.trim() : '';
    if (!model) continue;
    seen.add(`${brand} ${model}`.trim());
  }
  return [...seen];
}

export function productSeoTitle(p: {
  brand: string;
  name: string;
  fitments?: readonly UIFitment[];
}): string {
  const brand = p.brand.trim();
  const name = p.name.trim();
  // 品名自己已經以品牌開頭(例「Lightech 鋁合金腳踏組」)⇒ 不再疊一次品牌。
  const head = !brand || name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;

  const models = distinctModels(p.fitments);
  const vehicle =
    models.length === 0
      ? ''
      : models.length === 1
        ? models[0]
        : models.length === 2
          ? `${models[0]} / ${models[1]}`
          : `${models[0]} 等 ${models.length} 款車型`;

  return vehicle ? `${head}|${vehicle} — PCM` : `${head} — PCM`;
}
