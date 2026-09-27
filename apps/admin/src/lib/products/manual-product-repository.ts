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
