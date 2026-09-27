import type { ReactNode } from 'react';
import { availabilityLabel } from './product-detail';
import {
  isSourceMissing,
  resolveListingState,
  resolvePrice,
  type AdminProductDetailRow,
} from '../../lib/products/product-repository';
import type { ProductOverrides } from '../../lib/products/product-overrides-view';
import { toProductMedia } from '../../lib/products/product-media';

// product-summary-band.tsx —— 商品編輯頁頂端的摘要帶(商品頁改版乙 B1;計畫 ~/pcm-mailbox/計畫-後台商品頁乙-20260928.md)。
// 打開就看得到:封面、客人看到的標題、料號、品牌、分類、售價、庫存、原廠供貨、上下架按鈕(審視 E1)。
// 大標題與副標用「客人看到的」:有我們的版本就用我們的,沒有才用供應商的(審視 E3;規則同列表的 displayTitle)。
// 分類在這裡只顯示,不編輯(編輯在 C4 的「分類」區)。
// 🔴 資訊列用 <span data-summary>,不用 <dt>/<dd>:頁面測試的 fieldValue() 以 <dt> 找唯讀區塊的欄位,
//    這裡若也用 <dt>,同名欄位會先被找到(見 page.tsx 原識別列的註解)。

function Item({ k, label, children }: { k: string; label: string; children: ReactNode }) {
  return (
    <span>
      {label}{' '}
      <span data-summary={k} className='text-foreground'>
        {children}
      </span>
    </span>
  );
}

export function ProductSummaryBand({
  product,
  overrides,
  brandName,
  categoryName,
  taxonomyFailed,
  listing,
  actions,
}: {
  product: AdminProductDetailRow;
  overrides: ProductOverrides;
  brandName: string | null;
  categoryName: string | null;
  taxonomyFailed: boolean;
  /** 上下架表單(沿用既有 ProductListingForm,不改它)。 */
  listing: ReactNode;
  /** 標題下方那一排小按鈕(批次改特價、查看變更紀錄)。 */
  actions: ReactNode;
}) {
  const title = overrides.title ?? product.title;
  const subtitle = overrides.subtitle ?? product.subtitle;
  const cover = toProductMedia(product).representativeImage;
  const price = resolvePrice(product);
  const taxonomy = (v: string | null) => (taxonomyFailed ? '讀不到' : (v ?? '—'));

  return (
    <div data-summary-band className='grid gap-4 rounded-lg border p-4 lg:grid-cols-[96px_1fr_minmax(360px,440px)]'>
      <div className='bg-muted flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border'>
        {cover === null ? (
          <span className='text-muted-foreground px-2 text-center text-xs'>沒有代表圖</span>
        ) : (
          <img src={cover} alt='封面' className='h-full w-full object-contain' />
        )}
      </div>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-xs'>客人看到的標題</p>
        <h1 className='text-lg font-semibold break-words'>{title}</h1>
        {/* 副標沒有值時不渲染節點(不印「—」):h1 底下多一個空殼會像壞掉(page.test.tsx 釘住)。 */}
        {subtitle === null || subtitle === '' ? null : <p className='text-muted-foreground text-sm'>{subtitle}</p>}
        <div className='text-muted-foreground mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm'>
          <Item k='sku' label='料號'>
            {product.external_id}
          </Item>
          <Item k='brand' label='品牌'>
            {taxonomy(brandName)}
          </Item>
          <Item k='category' label='分類'>
            {taxonomy(categoryName)}
          </Item>
          <Item k='price' label='售價'>
            {price === null ? '—' : `NT$ ${price.toLocaleString('zh-TW')}`}
          </Item>
          <Item k='stock' label='庫存'>
            {availabilityLabel(product.availability)}
          </Item>
          <Item k='source' label='原廠供貨'>
            {isSourceMissing(product) ? '原廠已無此品' : '原廠仍有'}
          </Item>
          {/* 用字與唯讀區塊相同(上架中 / 已下架),同一頁對同一個狀態只有一個說法。 */}
          <Item k='listing' label='上架狀態'>
            {resolveListingState(product) === 'listed' ? '上架中' : '已下架'}
          </Item>
        </div>
        <div className='mt-3 flex flex-wrap gap-2'>{actions}</div>
      </div>
      {/* 上下架表單原樣沿用;這一欄比原本整寬的卡窄, 按鈕會被說明文字擠到換行 ⇒ 在這裡讓按鈕不縮、不換行。 */}
      <div className='[&_button]:shrink-0 [&_button]:whitespace-nowrap'>{listing}</div>
    </div>
  );
}
