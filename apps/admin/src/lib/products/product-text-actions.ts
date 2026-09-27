'use server';

// 商品頁乙 A10:列表展開摘要裡「改文字…」彈窗要的資料(只讀)。
// 寫入仍走 B3 的 saveProductTextAction(彈窗裡用的就是商品頁那個 ProductOverridesEditor)。

import { authorizeAdminMutation } from '../session/authorize';
import { toProductMedia } from './product-media';
import { readProductOverrides, type ProductOverrides } from './product-overrides-view';
import { getProductForAdmin } from './product-repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductTextLoad =
  | {
      ok: true;
      supplier: { title: string; subtitle: string | null; highlights: readonly string[] };
      overrides: ProductOverrides;
    }
  | { ok: false; message: string };

export async function loadProductTextAction(productId: string): Promise<ProductTextLoad> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: '沒有權限讀取商品，請重新登入後再試。' };
  if (typeof productId !== 'string' || !UUID.test(productId)) return { ok: false, message: '找不到這件商品，請重新整理頁面。' };
  try {
    const product = await getProductForAdmin(productId);
    if (!product) return { ok: false, message: '找不到這件商品，請重新整理頁面。' };
    return {
      ok: true,
      supplier: { title: product.title, subtitle: product.subtitle, highlights: toProductMedia(product).highlights },
      overrides: readProductOverrides(product.staff_overrides),
    };
  } catch {
    return { ok: false, message: '商品文字讀取失敗，請稍後再試，或打開完整頁修改。' };
  }
}
