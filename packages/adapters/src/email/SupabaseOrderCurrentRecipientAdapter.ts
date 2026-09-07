import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderCurrentRecipient, CurrentRecipientResult } from '@pcm/ports';
import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { Database } from '../supabase/database.types';

export type OrderCurrentRecipientClient = SupabaseClient<Database>;

/**
 * ⟦mail-RECIPIENTNOTRECHECKED⟧ 讀「這張單**現在**的收件地址」。
 *
 * 🔴 **算法逐字照排信那一套**(`enqueue-order-created-emails.ts:107-109`):
 *    來源會壓制 customer 回退 ⇒ 只看 `notification_email`;否則 `notification_email` 空才用 `customer_email`。
 *    🛑 **不照抄的話會製造【假的漂移】** —— 現值與排信當下用不同規則算出來,
 *      比對就會對「其實沒有改過 email 的單」判定不同 ⇒ 那些信會被擋下來而沒有人知道為什麼。
 *
 * ⚠️ **它答不出什麼**:①「該不該寄」—— 那是另一個問題(匯款族那支檔頭記過把兩者混成一個的後果)
 *    ②「這個地址寄不寄得到」—— 它只回值, 不驗證信箱
 *    ③ 🔴 **`{ kind: 'known', email: null }` 與 `{ kind: 'unavailable' }` 是兩件事**:
 *      前者 = **這張單現在沒有可用地址**;後者 = **我沒讀到**。呼叫端對兩者的處置不同。
 */
export class SupabaseOrderCurrentRecipientAdapter implements IOrderCurrentRecipient {
  constructor(private readonly client: OrderCurrentRecipientClient) {}

  async getCurrentRecipient(input: { orderId: string }): Promise<CurrentRecipientResult> {
    let outcome: { data: unknown[] | null; error: unknown };
    try {
      outcome = await this.client
        .from('orders' as never)
        // 🔴 逐欄指名。`order_source` 少一個就套不了 `suppressCustomerEmailFallback`,
        //    而那正是「假的漂移」的來源。
        .select('order_source, notification_email, customer_email')
        .eq('id', input.orderId)
        .limit(1);
    } catch {
      return { kind: 'unavailable' };
    }
    if (outcome.error !== null && outcome.error !== undefined) {
      return { kind: 'unavailable' };
    }
    const rows = (outcome.data ?? []) as Array<{
      order_source: string | null;
      notification_email: string | null;
      customer_email: string | null;
    }>;
    const row = rows[0];
    // 🔴 **查無那一列 ⇒ `unavailable`, 不是 `known/null`** ——
    //    「這張單不見了」與「這張單沒有地址」是兩件事, 而呼叫端只有前者該 fail-closed。
    if (row === undefined) return { kind: 'unavailable' };

    const nonEmpty = (v: string | null): string | null =>
      v !== null && v.trim() !== '' ? v : null;
    const email = suppressCustomerEmailFallback(row.order_source)
      ? nonEmpty(row.notification_email)
      : (nonEmpty(row.notification_email) ?? nonEmpty(row.customer_email));
    return { kind: 'known', email };
  }
}
