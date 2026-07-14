import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderStatusOptionsRepository } from '@pcm/ports';
import type { OrderStatusOption } from '@pcm/domain';
import type { Database } from './database.types';

/**
 * order_status_options 投影白名單(M-4a Slice A;後台訂單處理狀態詞彙)。
 *
 * 🔴 鐵則 12 慣例縱深:具名白名單、禁 `select('*')`(本表 7 欄皆非敏感〔label/color=後台顯示詞彙〕,
 * 但守全 repo「禁 *」慣例、防未來加欄靜默外洩)。created_at 不取(顯示用不到)。
 * module-level `export const` → SupabaseOrderStatusOptionsAdapter.test.ts byte-equal + spy 守門。
 */
export const ORDER_STATUS_OPTIONS_SELECT =
  'code, label, color, text_color, sort_order, is_active';

/** order_status_options row(投影後)→ domain OrderStatusOption。 */
type OrderStatusOptionRow = Pick<
  Database['public']['Tables']['order_status_options']['Row'],
  'code' | 'label' | 'color' | 'text_color' | 'sort_order' | 'is_active'
>;

/**
 * wire row → domain(snake_case → camelCase)。
 * `text_color` 由 text narrow 成 'light'|'dark'(DB CHECK order_status_options_text_color 保證值域、
 * 非任意字串;text-column↔domain-union 邊界的正當投射,同 order_source/payment_channel 慣例)。
 */
function mapOrderStatusOptionRow(row: OrderStatusOptionRow): OrderStatusOption {
  return {
    code: row.code,
    label: row.label,
    color: row.color,
    textColor: row.text_color as OrderStatusOption['textColor'],
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

/**
 * SupabaseOrderStatusOptionsAdapter:order_status_options 真實讀 adapter(M-4a Slice A、admin-only)。
 *
 * - 注入 service_role client(order_status_options 對 anon/authenticated 全鎖 + RLS zero-policy,
 *   只有 admin server 讀得到;composition 層 = apps/admin lib/orders/order-repository.ts);
 * - 回全量(含 inactive;badge 解析停用選項的舊單)、sort_order ASC;
 * - error → 裸 throw(對齊 SupabaseOrderAdapter 慣例;caller〔admin 頁〕try/catch 退錯誤態、頁面不 500);
 * - 寫入(Slice D 設定 UI)屆時擴方法,本片唯讀。
 */
export class SupabaseOrderStatusOptionsAdapter implements IOrderStatusOptionsRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listOrderStatusOptions(): Promise<OrderStatusOption[]> {
    const { data, error } = await this.supabase
      .from('order_status_options')
      .select(ORDER_STATUS_OPTIONS_SELECT)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true }); // 尾鍵:sort_order 不唯一時順序穩定(Fable R1 nit)
    if (error) {
      throw error;
    }
    return (data as OrderStatusOptionRow[]).map(mapOrderStatusOptionRow);
  }
}
