import type { MockProduct } from '@/data/mock-products';

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
};

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
    price: row.price_general ?? 0,
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: row.availability === 'in-stock',
    category: row.category_raw ?? '',
    color: 'silver',
    imgTone: 'neutral',
    image: row.card_image,
    originalPrice: null,
    tierLabel: null,
  };
}
