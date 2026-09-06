/**
 * @module @pcm/adapters/email/SupabaseOrderPlacedAtReaderAdapter
 * ⟦b4-EMAILTRIAGE⟧ 甲-1+甲-2:**批次讀 `orders.created_at`**, 給送出層的 cutoff 閘用。
 *
 * 🔴 **為什麼讀的是 `orders.created_at` 而不是 outbox 列的時間或 payload 裡的時間**:
 *    那兩者**都由插列的人控制** —— 替一張舊單手動插一列, 那一列是今天建的、payload 也是他寫的。
 *    ⇒ 📌 **一個由被檢查者提供的值, 不能拿來檢查他。**
 *
 * 🔵 **批次是安全的, 而理由不是「省查詢」**:`created_at` **不會變** ⇒ 讀早讀晚同一個答案。
 *    🛑 而同一支 sweeper 裡的合格性閘(比 `cancelled_at` / `payment_status`)**必須逐封** ——
 *    ⇒ 🎯 **可不可以批次, 取決於【那個值會不會在讀完之後改變】, 不取決於「同一張表」。**
 *
 * 🛑 **零 PII**:本支只取 `id` 與 `created_at` 兩欄, **不碰 email / 姓名 / 金額**。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderPlacedAtReader, OrderPlacedAt } from '@pcm/ports';
import type { Database } from '../supabase/database.types';

export type OrderPlacedAtReaderClient = SupabaseClient<Database>;

export class SupabaseOrderPlacedAtReaderAdapter implements IOrderPlacedAtReader {
  constructor(private readonly client: OrderPlacedAtReaderClient) {}

  async readPlacedAt(orderIds: readonly string[]): Promise<readonly OrderPlacedAt[]> {
    // 🔵 空清單就不要打 DB —— `in()` 給空陣列在 PostgREST 上的行為不是每一版都一樣,
    //    而**我沒有量過那個行為** ⇒ 不靠它。
    if (orderIds.length === 0) return [];

    const { data, error } = await this.client
      .from('orders')
      .select('id, created_at')
      .in('id', [...orderIds]);

    // 🔴 **throw = 讀取失敗** —— 呼叫端據此 fail-closed(不寄、計 error、不標終態)。
    //    🛑 **絕不回空陣列代替錯誤**:空陣列的意思是「這幾張單都查不到」,
    //    而那在呼叫端會與「讀取失敗」走同一條 fail-closed 路 —— 📌 **兩者今天同命是巧合, 不是設計**,
    //    哪天有人把「查不到」改成放行, 這裡回空陣列就會安靜地把讀取失敗一起放行。
    if (error) {
      throw Object.assign(new Error('order_placed_at_read_failed'), {
        code: (error as { code?: unknown }).code,
      });
    }

    // 🔵 回應視為不可信 `unknown`(同本目錄其他 adapter 的慣例:編譯期型別不是 wire 保證)。
    const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const out: OrderPlacedAt[] = [];
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) continue;
      const id: unknown = (raw as { id?: unknown }).id;
      if (typeof id !== 'string') continue;
      const createdAt: unknown = (raw as { created_at?: unknown }).created_at;
      out.push({ orderId: id, placedAt: typeof createdAt === 'string' ? createdAt : null });
    }
    return out;
  }
}
