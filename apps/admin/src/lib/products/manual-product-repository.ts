import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// manual-product-repository.ts — 商品頁乙 P5:新增手動商品的資料庫呼叫。
// 🔴 從 product-repository.ts 搬出來:那支是商品【讀取層】,守門測試釘它零經銷價欄位(product-repository.test.ts 驗收 4)。
//    這支是【寫入】:員工在表單填的經銷價原樣送進 RPC,不讀任何人的價格回來。經銷價白名單見同一支測試檔的第五筆。

/** 送進 admin_create_manual_product 的一個規格(鍵名照 RPC 的 p_variants)。 */
export type ManualVariantRow = { sku: string; label: string; price_general: number; price_store: number | null; availability: string };

/** 商品頁乙 P5:呼叫 20260928210000 `admin_create_manual_product`。回新商品 id;資料庫明確拒絕時丟錯(訊息帶規則說明)。 */
export async function createManualProduct(args: {
  brandId: string;
  categoryId: string;
  title: string;
  subtitle: string;
  description: string;
  variants: readonly ManualVariantRow[];
  actor: string;
  requestId: string;
}): Promise<string> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_create_manual_product', {
    p_brand_id: args.brandId,
    p_category_id: args.categoryId,
    p_title: args.title,
    p_subtitle: args.subtitle === '' ? null : args.subtitle,
    p_description: args.description === '' ? null : args.description,
    p_variants: [...args.variants],
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) throw error;
  const id = (data as { product_id?: unknown } | null)?.product_id;
  if (typeof id !== 'string') throw new Error('admin_create_manual_product RPC 回傳非預期形狀');
  return id;
}

/** 商品頁乙 P9:價格區的一個規格(手動商品)。一般價、經銷價是員工改的,特價由 P14 另外設。 */
export type ManualVariantPriceRow = {
  id: string;
  sku: string;
  label: string;
  priceGeneral: number | null;
  priceStore: number | null;
  salePrice: number | null;
};

/**
 * 商品頁乙 P9:讀一件手動商品(supplier_slug = 'pcm')全部規格的價格,給編輯頁「價格」區用。
 * 經銷價在後台給員工看(Sean 2026-08-31 拍甲:後台可顯示經銷價),只在 server 端讀。
 */
export async function loadManualProductPrices(productId: string): Promise<ManualVariantPriceRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('product_variants')
    .select('id, sku, spec, price_general, price_store, sale_price_general')
    .eq('product_id', productId)
    .order('sku', { ascending: true });
  if (error) throw new Error(`規格價格讀取失敗: ${error.message}`);
  return (data ?? []).map((v) => {
    const style = v.spec && typeof v.spec === 'object' && !Array.isArray(v.spec) ? (v.spec as Record<string, unknown>).style : undefined;
    return {
      id: v.id,
      sku: v.sku,
      label: typeof style === 'string' ? style : v.sku,
      priceGeneral: v.price_general,
      priceStore: v.price_store,
      salePrice: v.sale_price_general,
    };
  });
}

/** 送進 admin_set_variant_prices 的一筆(鍵名照 RPC 的 p_changes;這一片只改一般價與經銷價)。 */
export type VariantPriceChange = { variant_id: string; price_general: number; price_store: number | null };

/** 商品頁乙 P8:呼叫 20260928220000 `admin_set_variant_prices`。回每個規格的結果;資料庫明確拒絕時丟錯。 */
export async function setVariantPrices(args: {
  productId: string;
  changes: readonly VariantPriceChange[];
  actor: string;
  requestId: string;
}): Promise<{ variantId: string; outcome: 'UPDATED' | 'NO_CHANGE' }[]> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_set_variant_prices', {
    p_product_id: args.productId,
    p_changes: [...args.changes],
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) throw error;
  const results = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw new Error('admin_set_variant_prices RPC 回傳非預期形狀');
  return results.map((r) => {
    const row = r as { variant_id?: unknown; outcome?: unknown };
    if (typeof row.variant_id !== 'string' || (row.outcome !== 'UPDATED' && row.outcome !== 'NO_CHANGE')) {
      throw new Error('admin_set_variant_prices RPC 回傳非預期形狀');
    }
    return { variantId: row.variant_id, outcome: row.outcome };
  });
}

/**
 * 計畫-手動商品照片寫回網站(2026-10-02):呼叫 20261002210000 `admin_set_manual_product_images`。
 * images = 報價單圖庫沒隱藏的照片網址(依順序)。只收 pcm 商品;資料庫明確拒絕時丟錯。
 */
export async function setManualProductImages(args: {
  productId: string;
  images: readonly string[];
  actor: string;
  requestId: string;
}): Promise<'UPDATED' | 'NO_CHANGE' | 'NOT_FOUND'> {
  // 新 RPC 還不在共用的 database.types.ts(那支屬 packages/adapters 共用件)⇒ 照 product-repository.ts 搜尋那支的寫法轉型
  const { data, error } = await createSupabaseServiceClient().rpc(
    'admin_set_manual_product_images' as never,
    { p_product_id: args.productId, p_images: [...args.images], p_actor: args.actor, p_request_id: args.requestId } as never,
  );
  if (error) throw error;
  if (data === 'UPDATED' || data === 'NO_CHANGE' || data === 'NOT_FOUND') return data;
  throw new Error('admin_set_manual_product_images RPC 回傳非預期形狀');
}
