import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository } from '@pcm/ports';
import type { Money, Order, PlaceOrderInput, PlaceOrderResult } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import {
  mapPlaceOrderToCreateOrderArgs,
  type CreateOrderRpcResult,
} from './mappers/order';

/**
 * SupabaseOrderAdapter:Supabase 真實 IOrderRepository 實作(M-3-S2-b2-b2)。
 *
 * **單一 authenticated client + 建單走 RPC(零 service_role)**:
 * - 建單 `placeOrder` 呼 `create_order` SECURITY DEFINER RPC(migration 20260604130000):
 *   authenticated 對 orders/order_items 僅 SELECT、無直接 INSERT → 建單只能走本 RPC;
 *   價 / 運費 / tier / 歸屬全 RPC server 端 `auth.uid()` + product_variants 權威算,
 *   client 永不送價 / tier / userId;return DTO 只 `{order_id, display_id}`(🔴 鐵則 12 零價結構)。
 * - **不持 service_role**:client 由 wire-up 層(composition `getOrderRepo`)注入 cookie-aware
 *   request-scoped authenticated client(能讀 session cookie 拿 auth.uid());本 adapter 不建 client。
 *
 * **server-only**:從 `@pcm/adapters` root export(來源 client.ts 頂層 `import 'server-only'` 約束整條
 * chain);鏡像 SupabaseAddressAdapter/Customer/Vehicle(authenticated 零 service_role → root barrel、
 * 非 /server 受控小門〔那是 Wallet service_role / Auth 專用〕)。
 *
 * **讀路徑延 stage ③**:findById / listByCustomer / listByStatus 重建 domain Order 需從 order_items
 * 還原 OrderItem,但 order_items **無 product_id**(只有 variant_id)→ domain OrderItem.productId 必填
 * 無法忠實重建(backlog #217、傾向改 productId optional);故本片讀方法明確 deferred-stub、延 stage ③
 * 訂單查詢(plan §7)。
 *
 * 型別 cast `as unknown as CreateOrderRpcResult`:對齊 SupabaseProductAdapter/Address 慣例、無 generated
 * Functions 型別(待 backlog #106 消除);RPC `RETURNS jsonb` scalar → data 即該物件、不需 `.single()`。
 */
export class SupabaseOrderAdapter implements IOrderRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * 建單:呼 create_order RPC(server 權威)。
   * client 只送 lines(variant+qty)+ addressId + shippingMethod + invoice、永不送價/tier/userId;
   * RPC 錯誤(RAISE / 網路)原樣上拋不吞(對齊既有 adapter 裸 throw 慣例);回 `{orderId, displayId}`。
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const { data, error } = await this.supabase.rpc(
      'create_order',
      mapPlaceOrderToCreateOrderArgs(input),
    );
    if (error) {
      throw error;
    }
    const result = data as unknown as CreateOrderRpcResult | null;
    if (
      !result ||
      typeof result.order_id !== 'string' ||
      typeof result.display_id !== 'string'
    ) {
      throw new Error('create_order RPC 回傳格式非預期(缺 order_id / display_id)');
    }
    return { orderId: result.order_id, displayId: result.display_id };
  }

  /**
   * 付款編排窄讀(②-③c-1、plan v6 §4):`select total`(單欄、RLS own-only)→ Money。
   * - 查無 / 非本人(RLS 濾掉)→ null(caller fail-closed 拒付款、不 throw)。
   * - DB `total integer` 元位 → `toMoneyAmount` 中央守門(整數/非負;絕不 `as MoneyAmount`)。
   * - 🔴 鐵則 12:此值為 charge 與 confirm p_amount 的單一金額來源(client 永不送價、零浮點)。
   */
  async findTotal(id: string): Promise<Money | null> {
    const { data, error } = await this.supabase
      .from('orders')
      .select('total')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw error; // 裸 throw(對齊 placeOrder 慣例);caller(action)吞通用字面
    }
    if (!data || typeof (data as { total?: unknown }).total !== 'number') {
      return null; // 查無/非本人(RLS)→ fail-closed
    }
    return { amount: toMoneyAmount((data as { total: number }).total), currency: 'TWD' };
  }

  // ── 讀路徑:延 stage ③ 訂單查詢(deferred-stub)──
  // order_items 無 product_id → domain OrderItem.productId 無法忠實重建(backlog #217);
  // stage ③ 開工前拍 #217 解法(傾向 domain OrderItem.productId 改 optional)後再實作重建 mapper。
  findById(): Promise<Order | null> {
    return Promise.reject(
      new Error(
        'SupabaseOrderAdapter.findById 未實作:訂單讀路徑延 stage ③ 訂單查詢(backlog #217、order_items 無 product_id)',
      ),
    );
  }

  listByCustomer(): Promise<Order[]> {
    return Promise.reject(
      new Error(
        'SupabaseOrderAdapter.listByCustomer 未實作:訂單讀路徑延 stage ③ 訂單查詢(backlog #217)',
      ),
    );
  }

  listByStatus(): Promise<Order[]> {
    return Promise.reject(
      new Error('SupabaseOrderAdapter.listByStatus 未實作:admin 訂單列表延 M-4a-08'),
    );
  }
}
