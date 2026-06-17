import type { IOrderRepository } from '@pcm/ports';
import type { PlaceOrderInput, PlaceOrderResult } from '@pcm/domain';

/**
 * placeOrder:建單 use-case(M-3-S2-b2、plan v6 §3.1 階段①)。
 *
 * 薄編排(server 權威全在 RPC):收已驗證的 domain `PlaceOrderInput` → 走 `orderRepo.placeOrder`
 * (內部呼 `create_order` SECURITY DEFINER RPC)→ 回 `{orderId, displayId}`。
 * 單價 / 小計 / 運費 / total / 快照 / 防撞 / 下架檢查全在 RPC server 端權威算(🔴 #214a:缺貨改 availability_at_checkout 快照不擋;plan §5 紅線 3),
 * use-case **不算價、不算運費**(`calculateShippingFee` 純函式只供前台預估顯示鏡像、非結帳權威)。
 *
 * 信任邊界(守 boundary A、不 import @pcm/schemas):
 * - **不收 currentUserId**(對比 add-address):建單身分由 `create_order` RPC server 端 `auth.uid()`
 *   重查(零信任、防 IDOR)、client / use-case 永不送 userId;登入檢查在 delivery 層 server action
 *   (getUser),表單驗證 `@pcm/schemas` CheckoutInput.parse 也在 delivery 層。
 * - `input` 為已驗證 domain 型別(🔴 鐵則 12:型別層無價 / tier、client 永不送價)。
 *
 * 命名 `placeOrder`(非 createOrder):避與 domain entity factory `createOrder`(@pcm/domain、純建
 * Order 物件)跨套件同名歧義;repo / adapter 內呼的是 `create_order` RPC。
 */
export async function placeOrder(
  orderRepo: IOrderRepository,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  // 最小 domain guard(縱深防禦、對齊 deposit-wallet:即使 delivery 漏驗也擋空車、不打 DB)。
  // 品項上限 200 / qty 1-10000 / 變體存在·下架 / 金額 全在 create_order RPC server 權威驗(🔴 #214a:缺貨改快照不擋;plan §5 紅線 3)。
  if (input.lines.length === 0) {
    throw new Error('placeOrder: 購物車為空、無法建單');
  }
  // 3DS-0b 縱深:cart_session_id 為 create_order 5-param 必填(RPC 入口 null fail-closed RAISE);
  // delivery 漏填即擋、不打 DB(對齊空車 guard;option A 由 server action randomUUID 產)。
  if (!input.cartSessionId) {
    throw new Error('placeOrder: 缺 cart_session_id、無法建單');
  }
  return orderRepo.placeOrder(input);
}
