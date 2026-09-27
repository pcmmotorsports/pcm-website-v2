'use server';

// 商品頁乙 A7:批次上架 / 下架的 server action(Sean 09-28 Q3 甲 ⇒ 計畫第四節「批次的上限與結果」)。
// 寫法照 product-listing-actions.ts(單件):登入與 Origin 先檢查、操作人取自 session、request id 由 server 產生。
// 每一件照舊呼叫 admin_set_product_listing(各自一個交易、各自寫稽核),上架照舊先跑規格料號檢查。
// 前端每次最多送 LISTING_BATCH_CHUNK 件;這裡再擋一次,並在時間快用完時把剩下的標成「尚未執行」。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { LISTING_BATCH_CHUNK, type BatchListingOutcome } from './product-list-view';
import { displayTitle, listProductListingStates, setProductListing } from './product-repository';
import { findVariantSkuCollisionOrUnavailable } from './variant-sku-collision';
import { isConnectionClass } from '../orders/payment-reverse-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 一次請求最多跑多久就停(毫秒);頁面的 maxDuration 是 60 秒,留一段餘裕把結果送回去。 */
const TIME_BUDGET_MS = 45_000;

export type BatchListingResult =
  | { ok: true; results: { productId: string; outcome: BatchListingOutcome }[] }
  | { ok: false; message: string };

function validIds(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value)];
  if (ids.length === 0 || ids.length > max || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) return null;
  return ids as string[];
}

export async function setProductListingBatchAction(input: {
  productIds: readonly string[];
  delisted: boolean;
}): Promise<BatchListingResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: '沒有權限上下架商品，請重新登入後再試。' };
  if (typeof input !== 'object' || input === null || typeof input.delisted !== 'boolean') {
    return { ok: false, message: '選的商品有問題，請重新整理後再試。' };
  }
  const ids = validIds(input.productIds, LISTING_BATCH_CHUNK);
  if (!ids) return { ok: false, message: '選的商品有問題，請重新整理後再試。' };

  const requestId = await getRequestId();
  console.info('[admin/products] product.listing.batch.attempt', {
    request_id: requestId,
    sid: auth.sid,
    actor: auth.actorId,
    count: ids.length,
    delisted: input.delisted,
  });

  const started = Date.now();
  const remaining = () => TIME_BUDGET_MS - (Date.now() - started);
  const results: { productId: string; outcome: BatchListingOutcome }[] = [];
  for (const productId of ids) {
    // 🔴 時間檢查在【每一次寫入之前】(A7 Codex 必修 3):規格檢查本身也可能很久,檢查完再看一次,
    //    沒時間了就不寫,標「尚未執行」(沒有送出任何寫入,所以是確定的)。
    if (remaining() <= 0) {
      results.push({ productId, outcome: 'NOT_RUN' });
      continue;
    }
    // 上架前的規格料號檢查(同單件):疑似屬於別件商品、或查不出來 ⇒ 不上架,請員工到商品頁逐件確認。
    if (!input.delisted) {
      const collision = await findVariantSkuCollisionOrUnavailable(productId);
      if (collision) {
        results.push({ productId, outcome: 'NEEDS_REVIEW' });
        continue;
      }
      if (remaining() <= 0) {
        results.push({ productId, outcome: 'NOT_RUN' });
        continue;
      }
    }
    try {
      // 寫入也有期限:等太久就放棄這次請求 ⇒ 資料庫可能已經寫了 ⇒ 標「結果未確認」(下面 catch 沒有錯誤碼那條)。
      const r = await setProductListing({
        productId,
        delisted: input.delisted,
        note: null,
        actor: auth.actorId,
        requestId,
        signal: AbortSignal.timeout(Math.max(1000, remaining())),
      });
      results.push({ productId, outcome: r === 'UPDATED' ? 'UPDATED' : r === 'NOT_FOUND' ? 'NOT_FOUND' : 'NO_CHANGE' });
    } catch (err) {
      const e = err as { code?: unknown; message?: unknown };
      // 🔴 資料庫明確拒絕(PostgREST 帶錯誤碼)= 沒做到;連線中斷、逾時 = 不知道有沒有做到,不能說成失敗。
      //    連線類的錯誤碼(08*、57P0*、PGRST000–003)也可能發生在寫入之後 ⇒ 同樣是「不知道」(同 payment-reverse-state.ts)。
      const rejected = typeof e.code === 'string' && e.code !== '' && !isConnectionClass(e.code);
      console.error('[admin/products] 批次上下架其中一件出錯', {
        request_id: requestId,
        product_id: productId,
        code: rejected ? e.code : undefined,
        message: String(e.message ?? '').slice(0, 200),
      });
      results.push({ productId, outcome: rejected ? 'FAILED' : 'UNCONFIRMED' });
    }
  }

  revalidatePath('/products');
  for (const r of results) if (r.outcome === 'UPDATED') revalidatePath(`/products/${r.productId}`);
  return { ok: true, results };
}

/**
 * 「重新讀取目前狀態」:只讀,不改。結果未確認的那幾件,讓員工看到它們現在是上架還是下架。
 */
export async function readProductListingStatesAction(
  productIds: readonly string[],
): Promise<{ ok: true; states: { productId: string; title: string; listed: boolean }[] } | { ok: false; message: string }> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: '沒有權限讀取商品，請重新登入後再試。' };
  const ids = validIds(productIds, 200);
  if (!ids) return { ok: false, message: '選的商品有問題，請重新整理後再試。' };
  try {
    const rows = await listProductListingStates(ids);
    return {
      ok: true,
      states: rows.map((r) => ({ productId: r.id, title: displayTitle(r), listed: r.delisted_at === null })),
    };
  } catch {
    return { ok: false, message: '目前狀態讀取失敗，請稍後再按一次。' };
  }
}
