import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// retired-key-count-read.ts — M-4b ⟦mail-KEYRETIRECOUNT⟧:有幾把 `dedup_key` 被退休過。
//
// 🔴🔴 **這一片治的不是 bug —— 那個機制【是設計】。**
//    唯一索引是 `email_outbox_event_uniq (event_type, dedup_key)`(`20260717020000:377`)
//    ⇒ 換一把鍵就是一列新的信。而 repo 裡有兩支**刻意**換鍵的:
//    · `markSkippedTrackingSuperseded` ⇒ 改成 `…:superseded:<id>`
//    · `markSkippedShipmentVoided`     ⇒ 改成 `…:voided:<id>`
//    那是**退休鍵**機制:箱被復原 / 單號被更正之後, 新的一封才排得進去。
//    ⇒ 📌 **把它「修掉」等於把那兩條路關上。**
//
// 🔴 **缺的是【沒有人在數】**:一個誤觸(或一支寫錯的新程式)把鍵換掉之後,
//    今天**在任何儀表上都沒有訊號** —— 而症狀是「同一封信寄了兩次」,
//    那要等客人打電話來(`docs/runbooks/duplicate-shipping-email-sop.md` 就是在收拾這個)。
//
// ✅ **為什麼走表而不走 RPC**(與 `dead-letter-count-read.ts` 同一個理由, 那支檔頭記得更全):
//    `get_email_outbox_deadman_counts` 對 `service_role` 是 REVOKE 的(`20260829010000:221-224`,
//    刻意的物理擋)⇒ 後台叫不到。而 `email_outbox` 的 SELECT 已授權 service_role
//    (`20260717020000:396`)。
// 🟢 **而這一題比死信那題【簡單一格】**:那支檔記的痛點是「PostgREST 比不了兩個欄位」
//    (`attempts >= max_attempts` 送不進 SQL ⇒ 只能撈回來自己比 ⇒ 有 SCAN_CAP 上限)。
//    **單欄 `LIKE` 送得進去** ⇒ 用 `head: true` 只要 `count`, **一列都不撈**
//    ⇒ 📌 **沒有 SCAN_CAP 那種上限問題。**
// ⚠️ ⛔ ~~這兩個數字永遠精確。~~ **那句比事實寬一格**(R1 nit-4)⇒ 正確的說法是
//    **「印得出數字時它是精確的;量不到的時候它會說量不到」**。兩個縮的理由:
//    ① `LIKE '%…%'` 前導萬用字元用不到 `(event_type, dedup_key)` 那支索引 ⇒ 是**全表 count**
//       ⇒ 量大時可能撞 statement timeout(而結果**是安全的**:走「量不到」那條路, 不是印錯)
//    ② 兩個 count 是**兩次查詢、兩個時點**, 不是同一個快照 ⇒ 兩個數字之間可以有一封信的差。
//
// ⚠️ **它答不出什麼**(寫在這裡, 免得下一個人把它讀成「重複寄信的計數」):
//    · 它數的是**現存列裡帶退休後綴的**。一把鍵退休之後那一列**還在**, 所以數得到;
//      而 `email_outbox` 有 120 天保留 + 清理 job(#281)會刪逾期列 ⇒ **它是一個會被清掉的數字**。
//    · 它答不出「退休是對的還是誤觸」—— 兩者長一模一樣。**它只負責讓那件事【有訊號】。**
//    · 🛑 **不做門檻、不接告警器**:「今天異常多」需要一個數字, 而 2026-09-07 唯讀量到
//      superseded **0** / voided **0** / 全表 **5** 列(🟢 正對照同尺問 `'%:%'` ⇒ **4**,
//      證明它印得出非零;🔵 負對照現造後綴 ⇒ **0**)⇒ **沒有訂門檻的依據。**
//      主視窗 B 2026-09-07 裁:讀數做, 門檻等有讀數再訂。

/** 兩個後綴的字面**只寫在這裡一次** —— 與 adapter 那兩支換鍵的碼是兩份東西, 而它們會漂開。 */
export const RETIRED_KEY_SUFFIXES = {
  superseded: '%:superseded:%',
  voided: '%:voided:%',
} as const;

export type RetiredKeyCount = {
  readonly superseded: number;
  readonly voided: number;
  /** 🔴 `null` = 讀到了。非 `null` = **沒讀到**, 而上面兩個數字**不可以當成 0 印**。 */
  readonly unreadableReason: string | null;
};

export function unreadableRetiredKeyCount(reason: string): RetiredKeyCount {
  return { superseded: 0, voided: 0, unreadableReason: reason };
}

async function countLike(pattern: string): Promise<number | null> {
  const res = await createSupabaseServiceClient()
    .from('email_outbox')
    // 🔴 `head: true` ⇒ **一列都不回**, 只要 count ⇒ 沒有 SCAN_CAP 那種上限問題。
    .select('dedup_key', { count: 'exact', head: true })
    .like('dedup_key', pattern);
  if (res.error) return null;
  return res.count;
}

export async function loadRetiredKeyCount(): Promise<RetiredKeyCount> {
  let superseded: number | null;
  let voided: number | null;
  try {
    superseded = await countLike(RETIRED_KEY_SUFFIXES.superseded);
    voided = await countLike(RETIRED_KEY_SUFFIXES.voided);
  } catch {
    return unreadableRetiredKeyCount('讀取時發生例外');
  }
  // 🔴 **兩個都要讀到才算讀到** —— 只讀到一個而把另一個印成 0,
  //    那是「我沒量」被印成「量過了, 是零」, 而畫面上兩者長一樣。
  if (superseded === null || voided === null) return unreadableRetiredKeyCount('查詢失敗');
  return { superseded, voided, unreadableReason: null };
}
