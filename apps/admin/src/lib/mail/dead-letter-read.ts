import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// dead-letter-read.ts — M-4b ⟦b4-MAILDEAD⟧:死信清單的唯讀投影。
//
// 🔴 **為什麼需要這支檔**(2026-09-01 量到,而它是這一片真正的範圍):
//    `grep -rn "email_outbox" apps/admin/src`(非測試)⇒ **0 處**,而**不加過濾也是 0**
//    ⇒ 📌 **員工收到死信告警之後,進後台【沒有任何地方】看得到那封信。**
//    ⇒ 所以這一片不是「加一顆鈕」,是把一個今天不存在的畫面建出來。
//
// 🔴 **零 PII,而那是抄 RPC 那一側的紀律不是我發明的**:
//    `20260831040000_m4b_maildead_requeue_rpc.sql` 的回傳逐字「不回 recipient_email、
//    不回 payload、不回 subject」。**本投影同樣不撈那三欄。**
//    ⇒ 員工要判「這封該不該重排」,`order_id` + `event_type` + `last_error_code` 就夠;
//      而 `payload` 建表註解寫著它可含 PII。
//    ⚠️ 代價明寫:**畫面上看不出這封信要寄給誰** —— 要查得去訂單頁。那是刻意的。
//
// 🔴 **述詞與 RPC 的白名單【必須同義】**,而它們住在兩支檔:
//    RPC 只認 `status IN ('pending','failed')` 且 `attempts >= max_attempts`(那支 :120/:126)。
//    ⇒ 本清單用**一模一樣**的述詞 —— 不同的話,畫面會列出按下去必定失敗的列,
//      而那種按鈕比沒有按鈕糟(它讓人以為自己做得到)。
//    🛑 **改任一邊 ⇒ 兩邊一起改。** 而沒有任何機制會強制這件事,所以它寫在這裡。

/** 一列死信的顯示投影。**刻意不含** recipient_email / payload / subject。 */
export type DeadLetterRow = {
  readonly id: string;
  readonly orderId: string;
  readonly eventType: string;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  /** 已經放棄(attempts 燒完)⇒ 只有這種列得出重排鈕。 */
  readonly isDead: boolean;
};

export type DeadLetterList = {
  readonly rows: readonly DeadLetterRow[];
  /** 撈到上限 ⇒ 還有更多沒顯示。畫面要說出來,不得靜默截斷。 */
  readonly truncated: boolean;
  /** 讀取失敗。🔴 與「一封都沒有」**不可以合併** —— 前者是我們壞了,後者是好消息。 */
  readonly loadFailed: boolean;
};

/** 一次最多列幾封。多要一列當探針(這個 repo 的既有手法,見 ShippedEmailContextAdapter)。 */
export const DEAD_LETTER_MAX_ROWS = 50;

export async function listDeadLetters(): Promise<DeadLetterList> {
  const empty = { rows: [], truncated: false } as const;
  let data;
  try {
    const res = await createSupabaseServiceClient()
      .from('email_outbox')
      .select('id, order_id, event_type, status, attempts, max_attempts, last_error_code, created_at')
      .in('status', ['pending', 'failed'])
      // 🔴 舊的排前面:一封卡了三個月的信比剛死的那封急。
      .order('created_at', { ascending: true })
      .limit(DEAD_LETTER_MAX_ROWS + 1);
    if (res.error) return { ...empty, loadFailed: true };
    data = res.data;
  } catch {
    return { ...empty, loadFailed: true };
  }

  // 🔴🔴 **不在這裡篩掉未耗盡的列 —— 而【原本我篩了】,那是 codex 2026-09-01 R1 must-fix 4。**
  //
  //  ⛔ ~~舊做法:`.limit(50)` 撈回來, 再 `.filter(attempts >= max_attempts)`~~
  //  🔴 **失敗情境**:前 50 列若都是【還會再試】的列 ⇒ 篩完 0 筆
  //     ⇒ 畫面印「目前沒有寄不出去的信」**而其實有** —— 只是被擠到第 51 列之後。
  //     ⇒ 📌 那是一個**往好消息方向**的假,而好消息沒有人會回頭查。
  //  ⚠️ 而 PostgREST **比不了兩個欄位** ⇒ `attempts >= max_attempts` 送不進 SQL
  //     (同 `SupabaseShippedEmailContextAdapter` 那一格的理由)。
  //
  //  ✅ **改法:一列都不丟,每一列自己標 `isDead`。**
  //     ⇒ 畫面列出全部待處理的信,而**重排鈕只出現在 `isDead` 的列上**。
  //     ⇒ 「有死信而畫面說沒有」在結構上消失了 —— 因為畫面不再做那個篩。
  //  🛑 **仍然剩下的那一格(明寫,不假裝關掉了)**:超過 50 列時照樣截斷,
  //     而截掉的那些可能含死信 ⇒ `truncated` 為 true 時畫面**必須**說出來。
  const all = data ?? [];
  const truncated = all.length > DEAD_LETTER_MAX_ROWS;

  return {
    rows: all.slice(0, DEAD_LETTER_MAX_ROWS).map((r) => ({
      id: r.id,
      orderId: r.order_id,
      eventType: r.event_type,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastErrorCode: r.last_error_code,
      createdAt: r.created_at,
      isDead: r.attempts >= r.max_attempts,
    })),
    truncated,
    loadFailed: false,
  };
}

/**
 * 讀【單一列】的最小事實,給稽核的 `before` 用。
 *
 * 🔴 **為什麼需要它**:稽核要答「原本死在哪」(`⟦b4-MAILAUDIT⟧` 的三問之一),
 *    而那支 RPC 會把 `last_error_code` **清掉** —— 所以那個值**只有在按下去之前讀得到**。
 *    ⇒ 📌 這一發不是為了顯示,是為了**在證據被抹掉之前把它抄下來**。
 * 🔵 回 `null` = 讀不到。呼叫端據此 fail-closed(稽核寫不成就不重排)。
 */
export async function findDeadLetterForAudit(id: string): Promise<DeadLetterRow | null> {
  try {
    const res = await createSupabaseServiceClient()
      .from('email_outbox')
      .select('id, order_id, event_type, status, attempts, max_attempts, last_error_code, created_at')
      .eq('id', id)
      .maybeSingle();
    if (res.error || res.data === null) return null;
    const r = res.data;
    return {
      id: r.id,
      orderId: r.order_id,
      eventType: r.event_type,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastErrorCode: r.last_error_code,
      createdAt: r.created_at,
      isDead: r.attempts >= r.max_attempts,
    };
  } catch {
    return null;
  }
}
