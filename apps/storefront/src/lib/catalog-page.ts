import { parseImageTrim } from '@pcm/domain';

import type { MockProduct, UIFitment } from '@/data/mock-products';

export type CatalogListRow = {
  id: string;
  title: string | null;
  subtitle: string | null;
  handle: string | null;
  availability: string | null;
  price_general: number | null;
  card_image: string | null;
  fits: string | null;
  brand_name: string | null;
  brand_slug: string | null;
  category_raw: string | null;
  /** S4:RPC 投影的原始 fitments jsonb(公開車輛相容資料);shape 不保證 → 由 toCardFitments 白名單收。 */
  fitments?: unknown;
  /** trim 線 S4a:卡片首圖去白邊 bbox jsonb(RPC 第 13 鍵、migration 20260719150000);shape 不保證 → domain parseImageTrim 收斂;apply 前無此鍵=undefined。 */
  card_image_trim?: unknown;
};

/**
 * S4:RPC fitments jsonb → 卡片用 UIFitment[](白名單四欄:motoBrand/modelCode/yearStart/yearEnd)。
 * yearEnd 三態忠實保留(null=開放式 / 省略=單年 / number=明確迄年);車款名皆空的元素丟棄;非陣列/空 → undefined。
 */
export function toCardFitments(raw: unknown): UIFitment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UIFitment[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const r = el as Record<string, unknown>;
    const motoBrand = typeof r.motoBrand === 'string' ? r.motoBrand : '';
    const modelCode = typeof r.modelCode === 'string' ? r.modelCode : '';
    if (!motoBrand && !modelCode) continue;
    const f: UIFitment = { motoBrand, modelCode };
    if (typeof r.yearStart === 'number') f.yearStart = r.yearStart;
    if (r.yearEnd === null) f.yearEnd = null;
    else if (typeof r.yearEnd === 'number') f.yearEnd = r.yearEnd;
    out.push(f);
  }
  return out.length > 0 ? out : undefined;
}

function hashIdToNumber(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** List view → ProductCard 的最小公開 UI shape；不接觸 detail 或 tier price。 */
export function catalogRowToUIProduct(row: CatalogListRow): MockProduct {
  return {
    id: hashIdToNumber(row.id),
    slug: row.handle ?? row.id,
    brand: row.brand_name ?? '',
    brandSlug: row.brand_slug ?? undefined,
    name: row.title ?? '',
    subtitle: row.subtitle ?? undefined,
    fits: row.fits ?? '通用款',
    fitments: toCardFitments(row.fitments),
    price: row.price_general ?? 0,
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: row.availability === 'in-stock',
    category: row.category_raw ?? '',
    color: 'silver',
    imgTone: 'neutral',
    image: row.card_image,
    // trim 線 S4a:與 adapter mapper 同一顆 domain parseImageTrim 收斂(單一來源、髒數據=undefined → cover fallback)。
    imageTrim: parseImageTrim(row.card_image_trim) ?? undefined,
    originalPrice: null,
    tierLabel: null,
  };
}
