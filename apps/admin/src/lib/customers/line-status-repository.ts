import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { CustomerLineRow } from './line-status-view';

// line-status-repository.ts — 讀 `customers.line_user_id / line_friend_at`(第二發 `.in`,唯讀)。
//
// 🔴 **不併進既有的客戶投影**:`ADMIN_CUSTOMER_LIST_SELECT` 是具名白名單(`customer-repository.ts:14` 檔頭),
//    動它要動那一族守門;而這一格是「多一個顯示欄」⇒ 走列表之外的第二發(同 `item-costs-repository` 的理由)。
// 🔴 **欄位可能還不存在**:B 窗的 `20260914040000` 還沒貼時 PostgREST 回 42703(undefined_column)
//    ⇒ 一律收成 `readFailed`,呼叫端印「讀不到」。**絕不可以退回「沒用 LINE」**。
//    貼了沒的判準:`bash scripts/is-migration-applied.sh 20260914040000`。

type LooseClient = {
  from(table: string): {
    select(cols: string): {
      in(col: string, values: readonly string[]): Promise<{ data: unknown; error: unknown }>;
    };
  };
};

// 🔴 `customers` 的鍵是 **`user_id`** 不是 `id`(`ADMIN_CUSTOMER_LIST_SELECT` 同一個字面;`AdminCustomerSummary.id` 是投影後改的名)。
//    我第一版寫 `id` ⇒ PostgREST 回 42703 ⇒ 被自己的 `readFailed` 吞成「讀不到」而畫面看起來正常 —— 真瀏覽器 + 直打 PostgREST 才抓到。
const LINE_SELECT = 'user_id, line_user_id, line_friend_at';
/** PostgREST `in` 一次帶幾個 id(網址長度);客戶列表一頁 50 位,遠低於此。 */
const IN_CHUNK = 200;

export type CustomerLineRead = {
  rows: Map<string, CustomerLineRow>;
  /** true = 至少一批讀失敗(含欄位還沒貼)。`rows` 可能是讀到一半的 ⇒ 查不到的那幾位要印「讀不到」,不是「沒用 LINE」。 */
  readFailed: boolean;
};

export async function loadCustomerLineStatus(customerIds: readonly string[]): Promise<CustomerLineRead> {
  const rows = new Map<string, CustomerLineRow>();
  const ids = [...new Set(customerIds)].filter((id) => id !== '');
  if (ids.length === 0) return { rows, readFailed: false };
  let readFailed = false;
  const client = createSupabaseServiceClient() as unknown as LooseClient;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    try {
      const { data, error } = await client.from('customers').select(LINE_SELECT).in('user_id', chunk);
      if (error) {
        console.error('[admin/customers] LINE 綁定狀態讀取失敗(欄位可能還沒貼)', error);
        readFailed = true;
        continue;
      }
      if (!Array.isArray(data)) {
        readFailed = true;
        continue;
      }
      for (const raw of data) {
        const o = raw as Record<string, unknown>;
        if (typeof o.user_id !== 'string') continue;
        rows.set(o.user_id, {
          lineUserId: typeof o.line_user_id === 'string' ? o.line_user_id : null,
          lineFriendAt: typeof o.line_friend_at === 'string' ? o.line_friend_at : null,
        });
      }
    } catch (e) {
      console.error('[admin/customers] LINE 綁定狀態讀取拋錯', e);
      readFailed = true;
    }
  }
  return { rows, readFailed };
}
