'use server';

// 商品頁乙 P8:主管改手動商品的一般價與經銷價(計畫第八節)。特價入口是 P14,這一片不開。
// 寫法照 manual-product-actions.ts:先檢查登入與 Origin、操作人要是【登入票證上的身分】、再查在職主管,
// 驗證輸入後才用 service_role 呼叫 RPC。規則的權威在資料庫(20260928220000 admin_set_variant_prices):
// 在職主管、同步商品只能在報價單改、一般價不能改成空、商品被鎖就請稍後再試。
// 🔴 上線順序:要等 P-M5(沒帶核對單價就拒絕建單)之後才開(計畫 R3-1:改了上架中商品的價,
//    已經開著結帳頁的客人會被核對擋下、請他確認新金額,而不是看舊價付新價)。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { getSessionActorWithSource } from '../session/actor';
import { isActiveManager } from '../staff';
import { getRequestId } from '../audit/context';
import { setVariantPrices, type VariantPriceChange } from './manual-product-repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManualPriceInput {
  variantId: string;
  priceGeneral: number;
  priceStore: number | null;
}

export type SaveManualPricesResult =
  | { ok: true; updated: number; unchanged: number }
  | { ok: false; message: string };

function isPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 999_999_999;
}

export async function saveManualProductPricesAction(productId: string, input: ManualPriceInput[]): Promise<SaveManualPricesResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: '沒有儲存：登入已過期，請重新登入後再試。' };
  const { actor, source } = await getSessionActorWithSource();
  if (source !== 'ticket' || !actor || actor.id !== auth.actorId) {
    return { ok: false, message: '沒有儲存：改價格需要用自己的帳號登入。請登出後重新登入，再改一次。' };
  }
  if (!(await isActiveManager(auth.actorId))) return { ok: false, message: '沒有儲存：只有主管可以改價格。' };

  if (typeof productId !== 'string' || !UUID.test(productId)) return { ok: false, message: '沒有儲存：商品資料不對，請重新整理頁面。' };
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) {
    return { ok: false, message: '沒有儲存：一次要改 1 到 50 個規格。' };
  }
  const changes: VariantPriceChange[] = [];
  for (const [i, c] of input.entries()) {
    const n = i + 1;
    if (typeof c?.variantId !== 'string' || !UUID.test(c.variantId)) return { ok: false, message: '沒有儲存：規格資料不對，請重新整理頁面。' };
    if (!isPrice(c.priceGeneral)) return { ok: false, message: `沒有儲存：第 ${n} 個規格的一般價要是 0 以上的整數。` };
    if (c.priceStore !== null && !isPrice(c.priceStore)) return { ok: false, message: `沒有儲存：第 ${n} 個規格的經銷價要是 0 以上的整數，或不填。` };
    changes.push({ variant_id: c.variantId, price_general: c.priceGeneral, price_store: c.priceStore });
  }
  if (new Set(changes.map((c) => c.variant_id)).size !== changes.length) return { ok: false, message: '沒有儲存：同一個規格出現兩次，請重新整理頁面。' };

  const requestId = await getRequestId();
  try {
    const results = await setVariantPrices({ productId, changes, actor: auth.actorId, requestId });
    revalidatePath(`/products/${productId}`);
    const updated = results.filter((r) => r.outcome === 'UPDATED').length;
    return { ok: true, updated, unchanged: results.length - updated };
  } catch (err) {
    const message = String((err as { message?: unknown }).message ?? '');
    if (message === '無權執行此操作') return { ok: false, message: '沒有儲存：只有在職主管可以改價格。請重新登入後再試。' };
    if (message === '商品正在更新,請稍後再試') return { ok: false, message: '沒有儲存：這件商品正在更新（例如每日同步），請稍後再試。' };
    const prefix = 'admin_set_variant_prices: ';
    if (message.startsWith(prefix)) return { ok: false, message: `沒有儲存：${message.slice(prefix.length).replace(/,/g, '，')}。` };
    console.error('[admin/products] 改價格沒有成功或結果未確認', { request_id: requestId, message: message.slice(0, 200) });
    // 🔴 連線中斷時資料庫可能已經改好了 ⇒ 不說失敗;重新整理就看得到目前的價格
    return { ok: false, message: '無法確認價格是否已儲存。請重新整理頁面，確認目前的價格。' };
  }
}
