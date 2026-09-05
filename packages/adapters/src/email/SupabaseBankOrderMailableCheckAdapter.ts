/**
 * SupabaseBankOrderMailableCheckAdapter —— 寄送前重驗的 Supabase 實作。
 *
 * 🔵 它查 `public.pcm_bank_order_still_mailable`(`20260906180000`)——
 *    **與排信用的掃描面共用同一份述詞**(那支 view 就是七條述詞本身, pending view = 它 + anti-join)。
 *    ⇒ 📌 **這裡不重寫任何述詞** —— 重寫一份, 兩份會漂,
 *      而漂掉時客人拿到的是一封叫他匯錢而他其實不必匯的信。
 *
 * 🛑 **為什麼不查 pending view**:那一支帶 outbox anti-join, 而**寄送當下那一列已經存在**
 *    ⇒ 查它一定回空 ⇒ **每一封都會被判成不該寄**(探針第 31/33 格量過)。
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IBankOrderMailableCheck, BankOrderMailableResult } from '@pcm/ports';
import type { Database } from '../supabase/database.types';

export type BankOrderMailableCheckClient = SupabaseClient<Database>;

const STILL_MAILABLE_VIEW = 'pcm_bank_order_still_mailable';

export class SupabaseBankOrderMailableCheckAdapter implements IBankOrderMailableCheck {
  constructor(private readonly client: BankOrderMailableCheckClient) {}

  async isBankOrderStillMailable(input: { orderId: string }): Promise<BankOrderMailableResult> {
    let outcome: { data: unknown[] | null; error: unknown };
    try {
      // 🔴🔴 **要取值, 不是只問「在不在」**(codex R1-#2/#3)——
      //    只問存在性 ⇒ **金額或收件人被改過也照舊寄出快照裡的舊值**。
      // ⚠️ **而這條路因此看得到 PII(兩個 email 欄)** —— 代價明寫:
      //    ✅ 它**只被拿去與快照比對**, **不進 log、不進 result、不回給呼叫端以外的地方**;
      //    ✅ 回傳只帶【比對後要用的那三個值】, 而 `currentRecipientEmail` 是其中之一
      //       ⇒ 呼叫端拿它比對之後就丟掉(見 use-case 那一段)。
      outcome = await this.client
        .from(STILL_MAILABLE_VIEW as never)
        .select('order_id, total, balance_due, notification_email, customer_email')
        .eq('order_id', input.orderId)
        .limit(1);
    } catch {
      // 🔴 連錯誤物件都不接住 —— 接住了就會有人「順手」log 它, 而那條路上有 PII。
      return { kind: 'unavailable' };
    }
    if (outcome.error !== null && outcome.error !== undefined) {
      // 🔴 **讀不到 ⇒ unavailable, 不是 not_mailable**:兩者的下游行為不同 ——
      //    `unavailable` 計 error(下一輪重試), `not_mailable` 標終態(從此不寄)。
      //    📌 **把「我不知道」寫成「他不必匯」= 用一次讀取失敗永久吞掉一封信。**
      return { kind: 'unavailable' };
    }
    const rows = (outcome.data ?? []) as Array<{
      total: number | null;
      balance_due: number | null;
      notification_email: string | null;
      customer_email: string | null;
    }>;
    const row = rows[0];
    if (row === undefined) return { kind: 'not_mailable' };
    // 🔴 值讀不出來 ⇒ `unavailable` 而**不是** `not_mailable`:
    //    📌 「我讀不到現況」與「他不必匯」是兩件事, 而後者會永久吞掉一封信。
    if (!Number.isSafeInteger(row.total) || !Number.isSafeInteger(row.balance_due)) {
      return { kind: 'unavailable' };
    }
    // 🔵 收件人的退化順序與排信那一側**同一條**(notification 優先, 其次 customers.email)。
    //    ⚠️ 而**空白字元的判定不在這裡** —— view 那一側已經用 `pcm_js_trim_whitespace()` 篩過,
    //       在這裡再寫一次會長出第二套空白定義(`⟦b4-JSWSNARROWER⟧` 那一族)。
    const recipient =
      row.notification_email !== null && row.notification_email.trim() !== ''
        ? row.notification_email
        : row.customer_email;
    return {
      kind: 'mailable',
      currentRecipientEmail: recipient,
      currentBalanceDue: row.balance_due as number,
      currentTotal: row.total as number,
    };
  }
}
