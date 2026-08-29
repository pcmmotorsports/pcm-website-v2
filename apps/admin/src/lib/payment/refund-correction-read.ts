import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// refund-correction-read.ts — `#890` 片1:退款人工判定「現行有效更正」的**批量唯讀**。
//
// plan:`docs/specs/2026-08-29-890-manual-verdict-correction-ui-plan.md` §1a / §1b(v4,Sean 2026-08-29 逐字「3 批」)。
//
// 🔴 **為什麼新開一支,而不是擴 `refund-read.ts`**(plan §1a 逐字):
//    那支是退款異常清單**現行的唯一讀取路徑** ⇒ 擴它 = 把爆炸半徑放到那一頁的全部列上;
//    新開一支只服務新功能 ⇒ **壞掉時壞的是新功能**。
//
// 🔴🔴 **查無 與 查詢失敗必須分得開**(plan §1a 逐字,R1 must-fix):
//      · **查無** = 那一筆沒有被更正過 ⇒ **Map 裡沒有那個 key**
//        ⇒ 呼叫端要把 `p_expected_correction_id` 傳 **NULL**(初始 CAS)
//      · **查詢失敗** = 這支 throw ⇒ 呼叫端**整區塊 fail-closed、不渲染更正入口**
//      📌 兩者若合併成「回一個空 Map」⇒ **一次 DB 故障會讓每一列都被當成「沒更正過」**
//        ⇒ 員工按下去 ⇒ CAS 拿 NULL 去撞一個其實有值的鏈頭 ⇒ 被 RPC 擋(P2B43)
//        ⇒ 而他看到的是一個看不懂的錯誤,而不是「現在讀不到,先別動」。
//      ⇒ **所以本檔一律 throw,不吞。**
//
// 🔴 **底層那張 view 的兩個性質,寫在這裡,因為它們決定本檔的形狀**
//    (`20260814190000:163-179`,開檔逐字):
//      · `SELECT DISTINCT ON (c.refund_id) … ORDER BY c.refund_id, c.seq DESC`
//        ⇒ **一個 refund 最多一列**(Sean `Q-473-1`=A「最新一筆說了算」)
//      · view 的 COMMENT 逐字:「**沒有更正過的 refund 不會出現在本 view**(不是回一列 NULL)」
//        ⇒ 這正是上面「查無 = Map 沒有 key」的來源,**不是我設計的**。
//
// ⚠️ **未量的一格(明寫,不要讀成已驗)**:底表 `order_refund_manual_corrections` 有
//    `ENABLE ROW LEVEL SECURITY`(同檔 `:154`),而那張 view 是 `security_invoker = true`
//    ⇒ 它以**呼叫者**身分讀底表。本檔走 `service_role`(平台上具 BYPASSRLS)⇒ 預期讀得到,
//    **而我沒有在任何 DB 上實跑過這一發** —— 第一次接上時若回空,先查這一格,不要先懷疑 id。

/** 更正的兩個合法值(`20260814190000:69` 的 CHECK 逐字)。 */
export const CORRECTED_TO_VALUES = ['money_moved', 'no_money_moved'] as const;
export type CorrectedTo = (typeof CORRECTED_TO_VALUES)[number];

/**
 * 資料完整性異常(**重試不會好**;呼叫端要映「停手找維護」而不是「稍後再試」)。
 * 形狀抄 `refund-recovery-read.ts` 的 `RecoveryReadIntegrityError`,不自己發明一套。
 */
export class CorrectionReadIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorrectionReadIntegrityError';
  }
}

/** 一筆退款**現行有效**的人工判定更正。畫面要顯示的欄位在這裡湊齊(plan §1b:零額外查詢)。 */
export type EffectiveVerdict = {
  refundId: string;
  /** CAS 用的鏈頭 id ⇒ 呼叫端原樣傳給 `p_expected_correction_id`。 */
  correctionId: string;
  seq: number;
  correctedTo: CorrectedTo;
  reason: string;
  actor: string;
  createdAt: string;
};

/**
 * 一次問幾筆的上限。
 * 🔴 這**不是**分頁上限 —— 那一頁的清單本來就是有界的;
 *    它擋的是「有人把整張表的 id 灌進來」⇒ 一發 `.in()` 撞到平台 max-rows 而**靜靜地被截斷**。
 *    (`docs/patterns/pagination-loop-review.md`:`count` 不當終止判準、截斷後的數是錯的數。)
 */
export const CORRECTION_READ_MAX_IDS = 500;

/**
 * 批量撈「現行有效更正」。
 *
 * 回傳 `Map<refundId, EffectiveVerdict>` —— **沒有更正過的 id 不會出現在 Map 裡**。
 *
 * @throws {CorrectionReadIntegrityError} id 數超過上限 / view 對同一個 refund 吐出多列
 * @throws PostgrestError 查詢失敗(**不吞**,見檔頭)
 */
export async function findEffectiveVerdicts(
  refundIds: readonly string[],
): Promise<Map<string, EffectiveVerdict>> {
  // 🔴 去重之後才數,也才送查 —— 呼叫端傳重複 id 不該吃掉上限額度,也不該讓下面那個
  //    「回來的列數 > 問的 id 數」判準誤報。
  const ids = [...new Set(refundIds)];

  // 空陣列直接回,不發查詢:PostgREST 的 `in.()` 是一個容易讀錯的邊界,而這裡不需要它。
  if (ids.length === 0) return new Map();

  if (ids.length > CORRECTION_READ_MAX_IDS) {
    throw new CorrectionReadIntegrityError(
      `findEffectiveVerdicts: 一次問了 ${ids.length} 筆,超過上限 ${CORRECTION_READ_MAX_IDS};截斷後的結果會讓「沒更正過」與「沒查到」混在一起`,
    );
  }

  const client = createSupabaseServiceClient();
  const { data, error } = await client
    .from('order_refund_effective_verdict')
    // embed 無空格 = house 字面(`refund-recovery-read.ts` 同款)。
    .select('refund_id, correction_id, seq, corrected_to, reason, actor, created_at')
    .in('refund_id', ids)
    // 🔴 多要一列當**哨兵**:view 是 DISTINCT ON (refund_id) ⇒ 正常最多 ids.length 列。
    //    真的拿到更多 ⇒ 那張 view 的唯一性不成立了(被改過?)⇒ 下面 fail-closed。
    .limit(ids.length + 1);
  if (error) throw error;

  const rows = (data ?? []) as {
    refund_id: string;
    correction_id: string;
    seq: number;
    corrected_to: string;
    reason: string;
    actor: string;
    created_at: string;
  }[];

  if (rows.length > ids.length) {
    throw new CorrectionReadIntegrityError(
      `findEffectiveVerdicts: 問了 ${ids.length} 筆卻回 ${rows.length} 列 —— order_refund_effective_verdict 的「一個 refund 最多一列」不成立了`,
    );
  }

  const out = new Map<string, EffectiveVerdict>();
  for (const row of rows) {
    // 🔴 值域 fail-closed:`corrected_to` 只認 DB CHECK 的那兩個值。
    //    未來有人加第三個值而畫面沒跟上 ⇒ **在這裡紅**,不要讓一個看不懂的字串流進 UI
    //    (那會變成畫面上一個沒有文案的狀態,而員工分不出它是什麼)。
    if (!(CORRECTED_TO_VALUES as readonly string[]).includes(row.corrected_to)) {
      throw new CorrectionReadIntegrityError(
        `findEffectiveVerdicts: refund ${row.refund_id} 的 corrected_to 是非預期值「${row.corrected_to}」`,
      );
    }
    // 🔴 同一個 refund 出現第二列 ⇒ 與上面的哨兵是**兩種不同的破法**:
    //    哨兵抓「總列數變多」,這裡抓「總列數沒變而某個 id 佔了兩列」(另一個 id 就被吃掉了)。
    if (out.has(row.refund_id)) {
      throw new CorrectionReadIntegrityError(
        `findEffectiveVerdicts: refund ${row.refund_id} 回了不只一列有效更正`,
      );
    }
    out.set(row.refund_id, {
      refundId: row.refund_id,
      correctionId: row.correction_id,
      seq: row.seq,
      correctedTo: row.corrected_to as CorrectedTo,
      reason: row.reason,
      actor: row.actor,
      createdAt: row.created_at,
    });
  }
  return out;
}
