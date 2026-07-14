import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderStatusOptionsRepository } from '@pcm/ports';
import type { OrderStatusOption, OrderStatusOptionUpdate } from '@pcm/domain';
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
 * - 寫入:`updateOrderStatusOption`(M-4a Slice D-3 設定頁編輯既有;INSERT/新增留 D-3b)。
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

  /**
   * 更新既有狀態選項(M-4a Slice D-3 設定頁;code 為鍵、不可改)。
   *
   * 🔴 只 UPDATE {label, color, text_color, sort_order, is_active} —— code/created_at 絕不入 SET
   * (DB column-level grant 已收窄至此 5 欄、此處為型別+字面縱深)。停用走 is_active=false(soft-delete、非 DELETE)。
   * `.select()` 回讀在位列(service_role 對本表有 SELECT grant)→ 0 列 = NOT_FOUND(caller 分流)。
   * error → 裸 throw(對齊慣例;caller server action try/catch 退錯誤碼)。
   */
  async updateOrderStatusOption(
    code: string,
    update: OrderStatusOptionUpdate,
  ): Promise<'UPDATED' | 'NOT_FOUND'> {
    const { data, error } = await this.supabase
      .from('order_status_options')
      .update({
        label: update.label,
        color: update.color,
        text_color: update.textColor,
        sort_order: update.sortOrder,
        is_active: update.isActive,
      })
      .eq('code', code)
      .select(ORDER_STATUS_OPTIONS_SELECT);
    if (error) {
      throw error;
    }
    return data && data.length > 0 ? 'UPDATED' : 'NOT_FOUND';
  }

  /**
   * 新增狀態選項(M-4a Slice D-3c 設定頁;service_role INSERT grant〔Slice A 20260714120000〕)。
   *
   * 🔴 code 由呼叫端提供(中性 slug、非從 label 衍生;RESERVED_CODES〔form 層〕+ DB CHECK 雙層擋非法/保留字)。
   * INSERT 具名 6 欄、無 created_at(交 DB default);**不鏈 `.select()`**(只需 { error }、不回讀)。
   * PK 重複(unique_violation 23505)→ 'DUPLICATE'(caller 退友善碼);其他 error → 裸 throw。
   */
  async createOrderStatusOption(input: OrderStatusOption): Promise<'CREATED' | 'DUPLICATE'> {
    const { error } = await this.supabase.from('order_status_options').insert({
      code: input.code,
      label: input.label,
      color: input.color,
      text_color: input.textColor,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    });
    if (error) {
      if (error.code === '23505') return 'DUPLICATE'; // code PK 已存在
      throw error;
    }
    return 'CREATED';
  }
}
