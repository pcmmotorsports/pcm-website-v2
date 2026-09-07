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
        //
        // 🔴🔴 **`customer_email` 【不是 orders 的欄位】**(codex `gpt-6-astra` 2026-09-07 12⑤ must-fix)。
        //    ⛔ ~~`.select('order_source, notification_email, customer_email')`~~
        //    當場複驗:`20260604120000` 的 `CREATE TABLE orders` 逐欄看過 **沒有 email 欄**;
        //    後來只加過 `notification_email`(`20260718120000:114`)。
        //    repo 裡那 43 處 `customer_email` **全是 view 裡的 `c.email AS customer_email` 別名**。
        //    ⇒ 📌 **它會讓 PostgREST 回錯** ⇒ 本 adapter fail-closed 回 `unavailable`
        //      ⇒ 呼叫端不寄、放回重試 ⇒ **每一封信都停** 而 attempts 燒完就永久不再認領。
        //    🛑 **而顆1 那 7 格測試全綠** —— fake client 回什麼是我自己給的
        //      ⇒ 📌 **一個查不存在欄位的查詢, 在 fake 上與正確的查詢長得一模一樣。**
        // ✅ 真來源 = `customers.email`, 經 `orders.customer_user_id` 的 FK
        //    (`20260604120000:` 那行 `REFERENCES customers(user_id)`)——
        //    形狀照抄 repo 既有的 embed(`SupabaseOrderAdapter.ts:229` 的 `customers(name)`)。
        .select('order_source, notification_email, customers(email)')
        .eq('id', input.orderId)
        .limit(1);
    } catch {
      return { kind: 'unavailable' };
    }
    if (outcome.error !== null && outcome.error !== undefined) {
      return { kind: 'unavailable' };
    }
    // 🔵 PostgREST 的 embed 回的是巢狀物件;`customer_user_id` 是 NOT NULL 的 FK ⇒ 正常是單一物件,
    //    而**型別上兩種都收**(有些 PostgREST 版本對 to-one 也回陣列)—— 少了這一半,
    //    一個回陣列的環境會讓 `customers.email` 變 `undefined` ⇒ 靜靜地掉回「沒有地址」。
    const rows = (outcome.data ?? []) as Array<{
      order_source: string | null;
      notification_email: string | null;
      customers: { email: string | null } | Array<{ email: string | null }> | null;
    }>;
    const row = rows[0];
    // 🔴 **查無那一列 ⇒ `unavailable`, 不是 `known/null`** ——
    //    「這張單不見了」與「這張單沒有地址」是兩件事, 而呼叫端只有前者該 fail-closed。
    if (row === undefined) return { kind: 'unavailable' };

    const nonEmpty = (v: string | null): string | null =>
      v !== null && v.trim() !== '' ? v : null;
    const embedded = Array.isArray(row.customers) ? (row.customers[0] ?? null) : row.customers;
    const customerEmail = embedded === null ? null : embedded.email;
    const email = suppressCustomerEmailFallback(row.order_source)
      ? nonEmpty(row.notification_email)
      : (nonEmpty(row.notification_email) ?? nonEmpty(customerEmail));
    return { kind: 'known', email };
  }
}
