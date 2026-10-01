// GET /api/catalog/quick-add?slug=… —— 商品卡片「+ 加入購物車」按下去時, 問伺服器這件商品能不能直接加
// (板 ⟦b4-QUICKADD-DEAD⟧;Sean 2026-10-01 批計畫甲:只有一個規格就直接加入, 多個就導到商品頁)。
//
// 🔴 為什麼要問伺服器:列表資料不帶規格編號(`/products` 與品牌頁連規格數量都沒有),
//    而購物車沒有規格編號會把整行丟掉(`app/cart/actions.ts`)⇒ 卡片自己猜會做出「顯示已加入、車裡卻沒有」。
// 🔴 只回規格編號, 不回價格 —— 價格照舊由購物車在伺服器依會員等級取(鐵則 12)。
//    規格編號本來就公開在商品頁上, 不需要登入檢查(同 `app/cart/actions.ts` 的信任邊界)。
// 🔴 任何拿不準的情況一律回「去商品頁」:多規格、零規格(Sean 2026-08-31「不賣」)、沒有價格、查不到、查詢失敗。
// 🔵 用 route 不用 server action:卡片(client component)直接 import server action 檔,
//    測試環境會把 `lib/products` 的 `server-only` 一起載進來, 14 支渲染卡片的測試檔整檔炸掉。

import { NextResponse } from 'next/server';

import { fetchProductByHandle } from '@/lib/products';

export const dynamic = 'force-dynamic';

export type QuickAddTarget = { kind: 'add'; variantId: string } | { kind: 'page' };

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_PRODUCT_ID_LEN = 256; // 同 app/cart/actions.ts

function reply(body: QuickAddTarget, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get('slug');
  if (!slug || slug.length > MAX_PRODUCT_ID_LEN) return reply({ kind: 'page' }, 400);
  try {
    const variants = (await fetchProductByHandle(slug))?.variants ?? [];
    const only = variants.length === 1 ? variants[0]! : null;
    return reply(only && only.price !== null ? { kind: 'add', variantId: only.id } : { kind: 'page' });
  } catch (err) {
    console.error('[quick-add] 查商品失敗, 改導到商品頁:', err);
    return reply({ kind: 'page' }, 503);
  }
}
