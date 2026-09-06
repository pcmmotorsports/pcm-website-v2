import { createSupabaseServiceClient } from '@pcm/adapters/server';

/**
 * ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B ①②③ —— 「這張單可不可以登錄人工寄出取消通知」。
 *
 * ══ 為什麼述詞要住在【一個地方】 ═══════════════════════════════════════════
 * 這支檔的述詞有**兩個呼叫端**:
 *   ① 訂單詳情頁 —— 決定那顆鈕出不出現
 *   ② server action —— 按下去之後**重新問一次**(codex 關卡1 must-fix ①)
 * 🔴 **而它們【必須是同一段碼】** —— 兩份各自寫一次的話, 收窄其中一份就是一道靜默的岔:
 *    鈕出現而 action 拒絕(員工看到一個按了沒用的鈕), 或**鈕不出現而 action 會收**
 *    (那張單沒有人救得了它)。
 * 📌 ⇒ 本檔匯出一支 `readManualCancelNoticeEligibility`, 兩邊都叫它。**不要再寫第二份。**
 *
 * ══ 🛑 而「重問一次」不是多餘的 ══════════════════════════════════════════
 * codex 2026-09-06 關卡1 must-fix ① 的失敗情境:
 *   送一個**還沒取消**(或不是混合軌)的訂單 ID 進來 ⇒ 若只靠 UI 藏鈕, action 照插一列
 *   ⇒ 🔴 **日後那張單【真的】被取消時, 它反而被 `email_outbox` 的 anti-join 排除**
 *     ⇒ 📌 **那位客人從此永遠收不到取消信, 而計數上它是「已處理」。**
 * ⇒ 所以 action 進來的第一件事是重新讀這裡, 不信任表單送來的任何東西。
 *
 * ══ 述詞的來源(不是我發明的)═════════════════════════════════════════════
 * 逐字對應 `supabase/migrations/20260906620000_m4b_cancelled_mixed_rail_gap_counts.sql`
 * 的 `pending_manual_send_count`(而那一支又逐字鏡像 `20260905310000` 那支 view 的
 * `:178` `:179` `:180` 與 outbox anti-join):
 *   payment_method = 'tappay' · payment_status = 'refunded' · cancelled_at IS NOT NULL
 *   · 有未作廢的 order_manual_refunds · 沒有 order_cancelled 的 email_outbox 列
 * ⚠️ **兩份字面, 一個真相** —— 這裡是 TS、那裡是 SQL, **沒有任何東西會在它們分岔時叫**。
 *    ⇒ 改任一邊要同時改另一邊;而**真正的權威是那支 view**, 兩邊都是它的鏡子。
 */

/** 為什麼不能登錄的理由。**每一個值都要對得出一句給人看的話**(訊息在 actions 那一側)。 */
export type ManualCancelNoticeBlocker =
  | 'not_found'
  | 'not_card_refunded' // 不是「刷卡且已全額退款」
  | 'not_cancelled' // 還沒取消
  | 'not_mixed_rail' // 沒有未作廢的人工退款 ⇒ 系統自己會寄, 不該人工登錄
  | 'already_recorded' // 已經有 order_cancelled 的列(不論狀態)
  | 'unreadable'; // 讀不到 ⇒ 🔴 **不是「不符合」**

export type ManualCancelNoticeEligibility =
  | {
      readonly eligible: true;
      /** 預填用。兩個都空是**合法的** —— 那正是最需要人工處理的那批單。 */
      readonly suggestedEmail: string | null;
    }
  | { readonly eligible: false; readonly blocker: ManualCancelNoticeBlocker };

/**
 * 🔴 **`unreadable` 與「不符合」在回傳上是兩種東西, 這是刻意的。**
 * 讀不到時把它折成「不符合」⇒ 鈕消失 ⇒ **DB 抖一下, 那張單就沒有人救得了它**,
 * 而畫面上與「這張單本來就不用寄」長得一模一樣。
 * ⇒ 呼叫端要分開處置:鈕那側顯示「暫時讀不到」, action 那側**拒絕**(不猜)。
 */
export async function readManualCancelNoticeEligibility(
  orderId: string,
): Promise<ManualCancelNoticeEligibility> {
  // 🔴🔴 **建 client 這一步自己會丟** —— `requireEnv` 在 env 缺的時候直接 throw
  //    (`packages/adapters/src/supabase/client.ts:28`)。
  //    ⛔ 我第一版把它放在 try 外面 ⇒ 🛑 **整個訂單詳情頁的 render 一起炸**
  //      (2026-09-06 實測:`vitest related` **116 格紅**, 而 typecheck / lint / build 全綠)。
  //    📌 ⇒ 這正是本檔上面那句「讀不到 ≠ 不符合」的**最壞形狀**:
  //      不是那顆鈕消失, 是**整頁不見了** —— 而別人的區塊都各自 catch 了, 只有我沒有。
  //    ✅ 進來就包起來, 失敗落 `unreadable`。
  let svc: ReturnType<typeof createSupabaseServiceClient>;
  try {
    svc = createSupabaseServiceClient();
  } catch {
    return { eligible: false, blocker: 'unreadable' };
  }

  let order: {
    payment_method: string | null;
    payment_status: string;
    cancelled_at: string | null;
    notification_email: string | null;
    customer_user_id: string;
  };
  try {
    const res = await svc
      .from('orders')
      .select('payment_method, payment_status, cancelled_at, notification_email, customer_user_id')
      .eq('id', orderId)
      .maybeSingle();
    if (res.error) return { eligible: false, blocker: 'unreadable' };
    if (res.data === null) return { eligible: false, blocker: 'not_found' };
    order = res.data;
  } catch {
    return { eligible: false, blocker: 'unreadable' };
  }

  // 🔵 **順序是刻意的:先答「不是這一類」, 再答「已經做過了」。**
  //    反過來的話, 一張根本不該人工寄的單會得到「已登錄」那句話 ⇒ 讀的人以為處理過了。
  if (order.payment_method !== 'tappay' || order.payment_status !== 'refunded') {
    return { eligible: false, blocker: 'not_card_refunded' };
  }
  if (order.cancelled_at === null) return { eligible: false, blocker: 'not_cancelled' };

  // 🔴 混合軌的判準 = **有沒有未作廢的人工退款**, 不是比金額
  //    (`20260905310000:189-190` 逐字:比金額會把「人工退款 0 元」這種列當成沒有,
  //     而它仍然代表這張單走過別條軌)。
  try {
    const res = await svc
      .from('order_manual_refunds')
      .select('id')
      .eq('order_id', orderId)
      .is('voided_at', null)
      .limit(1);
    if (res.error) return { eligible: false, blocker: 'unreadable' };
    if ((res.data ?? []).length === 0) return { eligible: false, blocker: 'not_mixed_rail' };
  } catch {
    return { eligible: false, blocker: 'unreadable' };
  }

  // 🛑 **anti-join 逐字照抄那支 view:只問 event_type, 不問 status。**
  //    ⚠️ 而代價要寫出來(codex 關卡1 指出的同一件事):一列 `failed` 的取消信
  //    **一樣會讓這裡回 `already_recorded`** —— 那位客人其實沒收到。
  //    ⇒ 那一格由死信那條路承接(`docs/runbooks/` 死信 SOP), **不是這顆鈕的職責**;
  //      而**若在這裡放寬成「只有 sent 才算」, 這支就與片 A 的計數分岔了**
  //      ⇒ 鈕說可以登錄, 而登錄完計數不會動。**寧可與計數一致。**
  try {
    const res = await svc
      .from('email_outbox')
      .select('id')
      .eq('order_id', orderId)
      .eq('event_type', 'order_cancelled')
      .limit(1);
    if (res.error) return { eligible: false, blocker: 'unreadable' };
    if ((res.data ?? []).length > 0) return { eligible: false, blocker: 'already_recorded' };
  } catch {
    return { eligible: false, blocker: 'unreadable' };
  }

  // 預填:訂單上的通知信箱優先;沒有就去客人資料拿。**兩個都沒有 ⇒ null, 不編一個佔位字串。**
  let suggested = nonEmpty(order.notification_email);
  if (suggested === null) {
    try {
      const res = await svc
        .from('customers')
        .select('email')
        .eq('user_id', order.customer_user_id)
        .maybeSingle();
      // 🔵 讀不到客人資料**不算 unreadable** —— 預填只是方便, 它失敗不該讓整顆鈕消失。
      if (!res.error && res.data !== null) suggested = nonEmpty(res.data.email);
    } catch {
      // 同上:預填拿不到就算了。
    }
  }

  return { eligible: true, suggestedEmail: suggested };
}

/** 空白只有空字串與純空白兩種形狀 ⇒ 一起收掉。`null` 表示「沒有」, 不是空字串。 */
function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
