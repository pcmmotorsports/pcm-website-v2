'use server';

// app/checkout/actions.ts — 結帳送出建單 server action(M-3-S2-b2-e3b)
//
// 🔴 鐵則 12 建單 path(order/payment-adjacent)。建「未付款」單(Q2=A);真卡零接、TapPay prime token 留階段②。
//
// 五層信任邊界(鏡像 address/actions.ts addAddressAction、已過 codex 雙關卡 pattern):
// - ① server session getUser:**純登入 gate**(無 user → formError)。
//      ⚠️ 不作 customerId 來源 —— placeOrder use-case 刻意不收 currentUserId、身分由 create_order RPC
//      auth.uid() 零信任重查(防 IDOR);故此處 getUser 只擋未登入、**絕不把 user.id 傳進 use-case**。
// - ② CheckoutInput.safeParse(只驗 addressId/shippingMethod/invoice、strip 未知欄 + invoice superRefine)
//      + PlaceOrderLinesInput.safeParse(購物車線獨立 zod、不在 CheckoutInput)。
//      🔴 線缺/非法 variantId → REJECT 整單(回 formError)、不略過壞行續建單(寫入路徑 vs 顯示路徑 resolveCartLines)。
// - ③ 組 domain PlaceOrderInput(lines/addressId/shippingMethod/invoice):**零 userId / tier / price**
//      (型別層即無此欄;client 永不送價,價由 RPC server 權威算)。
// - ④ create_order SECURITY DEFINER RPC 內 auth.uid() 重查身分 + orders RLS own-only(跨 user 建單被擋)。
// - ⑤ create_order RPC server 權威算價(恆 price_general、tier_at_checkout 恆 general)+ 快照白名單 + 下架/缺貨/防撞。
//
// 🔴 error 不洩:SupabaseOrderAdapter.placeOrder 刻意裸 throw RPC RAISE(下架/缺貨/錯價/IDOR 地址歸屬訊息),
//    catch{} 必吞回單一通用字面(Q2=A)、**絕不透傳 RPC RAISE 原文**。
//
// #181 雙通道 + ok 標 + displayId(client 收 ok 後清車 + 顯示結帳頁內最小成功狀態 Q-e3=A):
// - fieldErrors 逐欄(含巢狀 invoice,對齊 CheckoutInput superRefine path);formError 帳號/建單層級。
// - displayId 為建單回傳的人類可讀單號(PlaceOrderResult、零價結構);成功頁只用此、不讀回訂單明細(讀路徑 stage③)。

import { placeOrder } from '@pcm/use-cases';
import { CheckoutInput, PlaceOrderLinesInput } from '@pcm/schemas';
import type { PlaceOrderInput, PlaceOrderLine } from '@pcm/domain';
import { getOrderRepo } from '@/lib/auth/composition';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// invoice 巢狀 fieldErrors(對齊 CheckoutInput superRefine path ['invoice','title'|'taxId'|'donateCode'])。
export type CheckoutInvoiceFieldErrors = Partial<
  Record<'carrier' | 'title' | 'taxId' | 'donateCode', string>
>;
// 結帳表單頂層欄(addressId/shippingMethod)+ 巢狀 invoice。
export type CheckoutFieldErrors = {
  addressId?: string;
  shippingMethod?: string;
  invoice?: CheckoutInvoiceFieldErrors;
};

// 雙通道 + ok 標(鏡像 AddAddressActionResult)+ displayId(成功時帶人類可讀單號供 in-page 成功狀態)。
export type PlaceOrderActionResult = {
  fieldErrors?: CheckoutFieldErrors;
  formError?: string;
  ok?: true;
  displayId?: string;
};

/**
 * 送出建單。成功 → { ok: true, displayId };表單驗證失敗 → { fieldErrors }(含巢狀 invoice);
 * 未登入 / 購物車線非法 / 建單失敗 → { formError }。caller(usePlaceOrder)不需自取 user.id(server 內部 gate)。
 *
 * @param input 預期 { addressId, shippingMethod, invoice, lines };lines 為 [{variantId, quantity}](零價)。
 */
export async function placeOrderAction(input: unknown): Promise<PlaceOrderActionResult> {
  // 信任邊界 ①:server session getUser 驗 JWT(純登入 gate;**不**作 customerId 來源、不傳 user.id 進 use-case)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  // 信任邊界 ②a:CheckoutInput safeParse(只驗 addressId/shippingMethod/invoice;購物車品項不在此 schema)。
  const parsedCheckout = CheckoutInput.safeParse({
    addressId: raw.addressId,
    shippingMethod: raw.shippingMethod,
    invoice: raw.invoice,
  });
  if (!parsedCheckout.success) {
    const fieldErrors: CheckoutFieldErrors = {};
    for (const issue of parsedCheckout.error.issues) {
      const p0 = issue.path[0];
      const p1 = issue.path[1];
      if (
        p0 === 'invoice' &&
        (p1 === 'carrier' || p1 === 'title' || p1 === 'taxId' || p1 === 'donateCode')
      ) {
        (fieldErrors.invoice ??= {})[p1] = issue.message;
      } else if (p0 === 'addressId' || p0 === 'shippingMethod') {
        fieldErrors[p0] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
    // input 非 object / path 為空 → formError fallback,不無聲失敗(對齊 addAddressAction)。
    return { formError: '結帳資料有誤,請返回確認' };
  }

  // 信任邊界 ②b:購物車線獨立 zod。🔴 缺/非法 variantId → REJECT 整單(非略過壞行續建單)。
  const parsedLines = PlaceOrderLinesInput.safeParse(raw.lines);
  if (!parsedLines.success) {
    return { formError: '購物車有商品缺少規格資訊,請返回購物車重新確認' };
  }

  // 信任邊界 ③:組 domain PlaceOrderInput —— 零 userId/tier/price(型別層即無此欄)。
  const placeOrderInput: PlaceOrderInput = {
    lines: parsedLines.data.map(
      (l): PlaceOrderLine => ({ variantId: l.variantId, quantity: l.quantity }),
    ),
    addressId: parsedCheckout.data.addressId,
    shippingMethod: parsedCheckout.data.shippingMethod,
    invoice: parsedCheckout.data.invoice,
  };

  // 信任邊界 ④/⑤:placeOrder → getOrderRepo(authenticated client、非 service_role)→ create_order RPC
  //   (auth.uid() 重查身分 + server 權威算價/快照 + REVOKE PUBLIC/anon)。
  // 🔴 adapter 裸 throw RPC RAISE → catch 吞回通用字面、不洩原始 error。
  try {
    const result = await placeOrder(await getOrderRepo(), placeOrderInput);
    return { ok: true, displayId: result.displayId };
  } catch {
    return { formError: '下單失敗,請稍後再試或聯繫客服 LINE' };
  }
}
