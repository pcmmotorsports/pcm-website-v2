'use server';

// 商品頁乙 P5:新增手動商品的 server action。
// 寫法照 product-overrides-actions.ts:先檢查登入與 Origin、request id 由 server 產生、驗證輸入後才用 service_role 呼叫 RPC。
// 🔴 另外要求操作人是【登入票證上的身分】(計畫第八節 P5):功能旗標關著時員工可以自選身分(session/actor.ts:159–166),
//    建立有售價的商品不接受那種身分,會請他重新登入。
// 規則的權威在資料庫(20260928210000 admin_create_manual_product);這裡的檢查只是讓員工早一點看到哪裡不對。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { getSessionActorWithSource } from '../session/actor';
import { getRequestId } from '../audit/context';
import { createManualProduct } from './product-repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManualVariantInput {
  sku: string;
  label: string;
  priceGeneral: number;
  priceStore: number | null;
  availability: 'in-stock' | 'out-of-stock';
}

export type CreateManualProductResult = { ok: true; productId: string } | { ok: false; message: string };

/** 料號規則與報價單圖庫同一套(1–64 字、英數字與 . _ -、至少一個英數字、不能含 ..)。回傳轉大寫後的料號或 null。 */
function normalizeSku(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z0-9._-]{1,64}$/.test(s) && /[A-Z0-9]/.test(s) && !s.includes('..') ? s : null;
}

function isPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 999_999_999;
}

export async function createManualProductAction(input: {
  brandId: string;
  categoryId: string;
  title: string;
  subtitle: string;
  description: string;
  variants: ManualVariantInput[];
}): Promise<CreateManualProductResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: '沒有建立：登入已過期，請重新登入後再試。' };
  const { actor, source } = await getSessionActorWithSource();
  if (source !== 'ticket' || !actor || actor.id !== auth.actorId) {
    return { ok: false, message: '沒有建立：新增商品需要用自己的帳號登入。請登出後重新登入，再建立一次。' };
  }

  if (typeof input !== 'object' || input === null) return { ok: false, message: '沒有建立：表單資料不完整，請重新整理頁面後再試。' };
  if (typeof input.brandId !== 'string' || !UUID.test(input.brandId)) return { ok: false, message: '沒有建立：請選擇品牌。' };
  if (typeof input.categoryId !== 'string' || !UUID.test(input.categoryId)) return { ok: false, message: '沒有建立：請選擇分類。' };
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '' || title.length > 200) return { ok: false, message: '沒有建立：標題不能空白，最多 200 字。' };
  const subtitle = typeof input.subtitle === 'string' ? input.subtitle.trim() : '';
  if (subtitle.length > 300) return { ok: false, message: '沒有建立：副標最多 300 字。' };
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 5000) return { ok: false, message: '沒有建立：說明最多 5000 字。' };

  if (!Array.isArray(input.variants) || input.variants.length === 0 || input.variants.length > 50) {
    return { ok: false, message: '沒有建立：規格要有 1 到 50 個。' };
  }
  const variants: { sku: string; label: string; price_general: number; price_store: number | null; availability: string }[] = [];
  for (const [i, v] of input.variants.entries()) {
    const n = i + 1;
    const sku = normalizeSku(v?.sku);
    if (!sku) return { ok: false, message: `沒有建立：第 ${n} 個規格的料號格式不對。料號只能有英數字、.、_、-，最多 64 字，而且不能有連續兩個點。` };
    const label = typeof v.label === 'string' ? v.label.trim() : '';
    if (label === '' || label.length > 100) return { ok: false, message: `沒有建立：第 ${n} 個規格的規格名稱不能空白，最多 100 字。` };
    if (!isPrice(v.priceGeneral)) return { ok: false, message: `沒有建立：第 ${n} 個規格的一般價要是 0 以上的整數。` };
    if (v.priceStore !== null && !isPrice(v.priceStore)) return { ok: false, message: `沒有建立：第 ${n} 個規格的經銷價要是 0 以上的整數，或不填。` };
    if (v.availability !== 'in-stock' && v.availability !== 'out-of-stock') return { ok: false, message: `沒有建立：第 ${n} 個規格的現貨狀態不對。` };
    variants.push({ sku, label, price_general: v.priceGeneral, price_store: v.priceStore, availability: v.availability });
  }
  if (new Set(variants.map((v) => v.sku)).size !== variants.length) return { ok: false, message: '沒有建立：有兩個規格的料號一樣。' };
  if (new Set(variants.map((v) => v.label)).size !== variants.length) return { ok: false, message: '沒有建立：有兩個規格的名稱一樣。' };

  const requestId = await getRequestId();
  console.info('[admin/products] product.manual.create.attempt', { request_id: requestId, sid: auth.sid, actor: auth.actorId, variants: variants.length });
  try {
    const productId = await createManualProduct({
      brandId: input.brandId,
      categoryId: input.categoryId,
      title,
      subtitle,
      description,
      variants,
      actor: auth.actorId,
      requestId,
    });
    revalidatePath('/products');
    return { ok: true, productId };
  } catch (err) {
    const message = String((err as { message?: unknown }).message ?? '');
    console.error('[admin/products] 新增手動商品沒有成功或結果未確認', { request_id: requestId, message: message.slice(0, 200) });
    if (message === '無權執行此操作') return { ok: false, message: '沒有建立：這個帳號目前不能新增商品。請重新登入後再試；仍無法建立時請聯絡系統管理員。' };
    const prefix = 'admin_create_manual_product: ';
    if (message.startsWith(prefix)) return { ok: false, message: `沒有建立：${message.slice(prefix.length).replace(/:/g, '：')}。` };
    // 🔴 連線中斷時資料庫可能已經建好了 ⇒ 不說失敗,也不叫人直接重按(會建出兩件或撞料號)
    return { ok: false, message: '無法確認商品是否已建立。請先到商品列表用料號搜尋，確認沒有這件商品再重新建立。' };
  }
}
