import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// dead-letter-count-read.ts — M-4b ⟦f3-DEADLETTERCOUNT⟧:首頁那個「有幾封卡住」。
//
// Sean 2026-09-02 拍甲:「維持人工重排,而把『有幾封卡住』做成看得見的數字」。
// ⇒ 產物不是重試機制,是**一個會愈長愈大而有人看得到的數字**。
//
// 🔴🔴 **為什麼不重用 `listDeadLetters()`**(這是本片的第一步,不是細節):
//    那支有 `DEAD_LETTER_MAX_ROWS = 50` 的上限(`dead-letter-read.ts:47/59/84`)
//    ⇒ 若寫成 `rows.filter(r => r.isDead).length`,**這個數字的上限就是 50**
//    ⇒ 📌 **50 封與 500 封會印同一個 `50`,而畫面完全正常。**
//    ⇒ 也就是說:它會在**事情變嚴重的那一刻**變成一個常數 —— 而那正是 Sean 要它會長大的原因。
//
// 🔴 **為什麼不用那支現成的 RPC**(查過了,而它擋在授權上):
//    `get_email_outbox_deadman_counts` 的 `signal2_dead_letter_count` 就是這個數,
//    而 `20260829010000:221-224` 逐字 `REVOKE ALL … FROM … service_role`、
//    只 `GRANT EXECUTE … TO payment_confirmer` ⇒ **後台(service_role)呼叫不到它。**
//    ⇒ 要用它得新開一支 migration 放寬那道 REVOKE ——
//      而那道 REVOKE 是**刻意的物理擋**(該檔頭註),放寬它不是順手,而 apply 也未獲授權。
//
// ✅ **所以走表**:`email_outbox` 的 `SELECT` 已經授權 service_role
//    (`20260717020000:396` `GRANT INSERT, SELECT, UPDATE ON TABLE public.email_outbox TO service_role`)。
//
// ⚠️ **而 PostgREST 比不了兩個欄位**(`dead-letter-read.ts:70-71` 已記)
//    ⇒ `attempts >= max_attempts` 送不進 SQL ⇒ 只能撈回兩個整數欄自己比。
//    ⇒ 所以這裡**同時**要一個 DB 端的 `count`:
//        · `total`(卡住的總數)= DB 算的,**沒有上限**,永遠精確
//        · `dead` (已放棄的)  = 本地比出來的,**受 SCAN_CAP 限制**
//      ⇒ 🔴 兩個數字**來源不同**,所以 `deadExact` 要跟著走 —— 不可以把它們當成同一次量測。

/** 一次最多撈幾列回來比 `attempts >= max_attempts`。只撈兩個整數欄,不是整列。 */
export const DEAD_LETTER_SCAN_CAP = 2000;

export type DeadLetterCount = {
  /** 卡住的總數(pending + failed)。DB 端 `count: 'exact'` ⇒ 不受 SCAN_CAP 影響。 */
  readonly total: number;
  /** 其中已放棄的(`attempts >= max_attempts`)。 */
  readonly dead: number;
  /**
   * `dead` 是不是精確值。
   * 🔴 `false` ⇒ 卡住的列數超過 SCAN_CAP,`dead` 是**下界**不是實數。
   *    畫面必須說出來 —— 一個被截斷的數字若印得像精確值,它就是下一件事故。
   */
  readonly deadExact: boolean;
  /**
   * 讀不到的理由;`null` = 讀到了。
   * 🔴 **「讀不到」與「一封都沒有」不可以長一樣** —— 一個是我們壞了,一個是好消息。
   *    (同 `settings/mail/page.tsx:88-92` 那條紀律。)
   */
  readonly unreadableReason: string | null;
};

export function unreadableCount(reason: string): DeadLetterCount {
  return { total: 0, dead: 0, deadExact: false, unreadableReason: reason };
}

export async function loadDeadLetterCount(): Promise<DeadLetterCount> {
  let data: ReadonlyArray<{ attempts: number; max_attempts: number }> | null;
  let total: number | null;
  try {
    const res = await createSupabaseServiceClient()
      .from('email_outbox')
      .select('attempts, max_attempts', { count: 'exact' })
      .in('status', ['pending', 'failed'])
      .limit(DEAD_LETTER_SCAN_CAP);
    if (res.error) return unreadableCount('查詢失敗');
    data = res.data;
    total = res.count;
  } catch {
    return unreadableCount('讀取時發生例外');
  }

  // 🔴 `count` 回 `null` 時**不當成 0** —— 那會把「我們沒拿到數字」印成「一封都沒有」。
  if (total === null) return unreadableCount('拿不到總數');

  const rows = data ?? [];
  const dead = rows.filter((r) => r.attempts >= r.max_attempts).length;
  // 🔴🔴 **`deadExact` 問的是「我撈完了嗎」,而唯一答得出來的是【手上這幾列】。**
  //
  //    ⛔ ~~舊寫法 `deadExact: total <= DEAD_LETTER_SCAN_CAP`~~(`-fc` 2026-09-02 R1 must-fix 1)
  //    🔴 **失敗情境**:PostgREST 的 `db-max-rows` 若小於 SCAN_CAP(板上兩處實測**互相矛盾**:
  //       `docs/phase-1-backlog.md:10629` 說 2000、`:18519` 說 1000),
  //       `.limit(2000)` 會被伺服器砍到 1000 列**而 supabase-js 不報錯**
  //       ⇒ `total = 1500` 時 `dead` 只在 1000 列上算(是下界),
  //         而舊式子算出 `1500 <= 2000 = true` ⇒ **把下界印成精確值。**
  //    📌 ⇒ 那正是本檔上面自己寫的那句:「一個被截斷的數字若印得像精確值,它就是下一件事故。」
  //
  //    ✅ **改成比【實得列數】** —— 它不必知道 `db-max-rows` 是多少,
  //       也不必知道 SCAN_CAP 是多少:**撈回來的列數蓋得住總數,才叫撈完。**
  return { total, dead, deadExact: rows.length >= total, unreadableReason: null };
}
