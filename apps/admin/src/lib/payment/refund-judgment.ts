// refund-judgment.ts — M-3 A7c RW4:恢復對帳判定碼表(純函式、零 IO;plan v3.2 §4-1 逐字)。
//
// 判定式的單一真相 = S2 欄位 COMMENT(`20260803150000:177` 逐字):
//   「RW4 恢復判定:delta = Record 現值 − 本欄;delta ∉ {0, refund_amount} = 停+人工。」
//
// 🔴 與 G0 baseline(refund-baseline.ts)**刻意分函式、不共用**:兩者對 record_status 的
//    語意相反 —— G0 是「能不能發起新退款」(3=REFUNDED 已退畢 ⇒ 拒發起);本判定是
//    「卡住的退款到底執行了沒」(3=REFUNDED 正是全額退**已執行**的正常終點 ⇒ 必須放行,
//    否則每一筆退到底的卡列都永遠結不了案)。共用會讓其中一邊靜默錯。
//
// 🔴 fail-closed 方向:形狀/狀態任何一項存疑 → 純人工(manual-only),絕不猜。
//    尤其 `refundedAmount` 欄缺**嚴禁 `?? 0`**(G0 ③ 同鐵律):翻 0 會把「從未執行的
//    退款」判成 delta=baseline 的假差額,或反向把已執行判成未執行 —— 兩個方向都通向錯帳。
//
// 🔴 「該單無其他非終態列」只掛在 executed 出口(§4-1 字面):
//    delta = refund_amount 時,若同單另有 processing 列,這筆差額可能是**別列**的錢 ⇒ 停;
//    delta = 0 時不掛 —— 本列的 wire 若真的動過錢,差額必反映在本列 baseline 之後,
//    delta=0 已證本列零動錢,兄弟列是誰的事不影響「本列標記失敗」的正確性。
//    (S5 使同單雙 processing 物理不可達;本檢查是 DB 守門被繞過時的縱深,app 端可構造可測。)

import type { TapPayRecordResult } from '@pcm/domain';

/** 判定所需的帳本列快照(來源=refund-recovery-read.findRefundForRecovery;rec 用列上快照欄)。 */
export type RefundRecoverySnapshot = {
  /** 凍結額(= delta 必須全等的那個數)。 */
  refundAmount: number;
  /** 本列快照的 TapPay 交易識別碼(`order_refunds.rec_trade_id`;不讀 orders —— 快照語意)。 */
  recTradeId: string;
  /** S2 baseline(initiate 當下的 Record `refunded_amount`)。 */
  recordRefundedBefore: number;
  /**
   * 🔴 TapPay 受理證據(S3;opus 關卡2 M1 折入):非空=「TapPay 曾受理」是 migration
   * `:179` 的字面事實 —— 它與 delta=0(錢沒動)**互相矛盾**,矛盾讀數不得開放任何結案
   * 按鈕(見 evidence_contradiction)。判定不看內容、只看有無。
   */
  providerEvidence: string | null;
};

/**
 * 判定用 record_status allowlist:0=AUTH / 1=OK / 2=PARTIALREFUNDED / **3=REFUNDED**。
 * 🔴 與 G0 的 {0,1,2} 差在 3(見檔頭);4=PENDING / 5=CANCEL / -1=ERROR 讀數不可信 → 純人工。
 */
export const JUDGMENT_ALLOWED_RECORD_STATUSES: readonly number[] = [0, 1, 2, 3];

/**
 * 判定碼表(七碼;harness=每碼一正一負):
 * - `not_executed`:delta=0 **且無受理證據** ⇒ 本列零動錢 → 開放「標記失敗」(manual_failed)。
 * - `executed`:delta=refund_amount 且同單無其他在途列 ⇒ 錢已退 → 開放 Portal 真碼恢復。
 * - `evidence_contradiction`:delta=0 **但有受理證據**(opus M1)⇒ 「TapPay 曾受理」與
 *   「錢沒動」矛盾(Record 落後 / Portal 端退款被取消,兩者都是 Portal 介入面)→ 停、純人工。
 *   標記失敗會釋出額度+banner 引導重發起 = 若錢其實在路上就是二次真退款,矛盾讀數不賭。
 * - `delta_mismatch`:delta ∉ {0, refund_amount} = Portal 介入痕跡的機械判定 → 停+告警、純人工。
 * - `other_in_flight`:delta=refund_amount 但同單另有在途列 → 停(差額歸屬不明)。
 * - `record_shape_bad`:查無/多筆/識別碼不符/欄缺/幣別異常 → 停。
 * - `record_state_bad`:record_status 不在判定 allowlist → 停。
 */
export type RefundRecoveryJudgment =
  | { verdict: 'not_executed'; refundedNow: number; delta: number }
  | { verdict: 'executed'; refundedNow: number; delta: number }
  | { verdict: 'evidence_contradiction'; refundedNow: number; delta: number; detail: string }
  | { verdict: 'delta_mismatch'; refundedNow: number; delta: number; detail: string }
  | { verdict: 'other_in_flight'; refundedNow: number; delta: number; detail: string }
  | { verdict: 'record_shape_bad'; detail: string }
  | { verdict: 'record_state_bad'; detail: string };

export type RefundRecoveryVerdict = RefundRecoveryJudgment['verdict'];

/** 兩個人工結案動作;判定閘=結案動作只在對應判定成立時可執行(resolve action 送出前重判)。 */
export type RecoveryResolution = 'mark_failed' | 'recover_confirmed';
export const RECOVERY_RESOLUTIONS = ['mark_failed', 'recover_confirmed'] as const;

/**
 * 🔴 resolution → 必要判定(fail-closed 查表;resolve action 以**送出當下重判**的結果過本表,
 * 不信 client 帶來的任何判定宣稱)。`as const`=字面型別,action 端比對可直接窄化判定聯合。
 */
export const RESOLUTION_REQUIRED_VERDICT = {
  mark_failed: 'not_executed',
  recover_confirmed: 'executed',
} as const satisfies Record<RecoveryResolution, RefundRecoveryVerdict>;

/** §4-1 判定本體。檢查順序:形狀 → 狀態 → 欄位完整性 → delta 三分。 */
export function judgeRefundRecovery(
  result: TapPayRecordResult,
  row: RefundRecoverySnapshot,
  otherProcessingCount: number,
): RefundRecoveryJudgment {
  // ① 查詢層成功(0/2 皆「查詢成功」;其餘=查詢異常,讀數不可信)
  if (result.queryStatus !== 0 && result.queryStatus !== 2) {
    return {
      verdict: 'record_shape_bad',
      detail: `queryStatus=${result.queryStatus}(非 0/2)`,
    };
  }
  // ① 恰一筆(0 筆=查無、>1=多筆;兩個計數都驗,分岔=解析層異常)
  if (result.numberOfTransactions !== 1 || result.records.length !== 1) {
    return {
      verdict: 'record_shape_bad',
      detail: `筆數異常(numberOfTransactions=${result.numberOfTransactions}, records=${result.records.length})`,
    };
  }
  const record = result.records[0];
  if (record === undefined) {
    // 長度已驗 1、理論不可達;noUncheckedIndexedAccess 之下仍顯式擋(不 cast)。
    return { verdict: 'record_shape_bad', detail: 'records[0] 缺(解析層異常)' };
  }
  // ① 識別碼相符(對到別筆交易的讀數=毒數據)
  if (record.recTradeId !== row.recTradeId) {
    return {
      verdict: 'record_shape_bad',
      detail: `recTradeId 不符(Record=${record.recTradeId})`,
    };
  }
  // ① 幣別(refund-baseline 同款加嚴):單位語意不對,delta 全等比較就沒有意義。
  if (record.currency !== undefined && record.currency !== 'TWD') {
    return {
      verdict: 'record_shape_bad',
      detail: `currency=${record.currency}(非 TWD)`,
    };
  }
  // ② record_status(判定 allowlist 含 3;見檔頭與常數註解)
  if (!JUDGMENT_ALLOWED_RECORD_STATUSES.includes(record.recordStatus)) {
    return {
      verdict: 'record_state_bad',
      detail: `record_status=${record.recordStatus}(不在 {0,1,2,3};讀數不可信)`,
    };
  }
  // ③ refunded_amount 欄缺 = 停(嚴禁 ?? 0;檔頭)
  if (record.refundedAmount === undefined) {
    return { verdict: 'record_shape_bad', detail: 'refunded_amount 欄缺(嚴禁翻 0)' };
  }

  // ④ delta 三分(S2 COMMENT 逐字)+ 證據矛盾閘(opus M1;見型別註解)
  const refundedNow = record.refundedAmount;
  const delta = refundedNow - row.recordRefundedBefore;
  if (delta === 0) {
    if (row.providerEvidence !== null) {
      return {
        verdict: 'evidence_contradiction',
        refundedNow,
        delta,
        detail: '有 TapPay 受理證據但 Record 差額為 0(讀數互相矛盾)',
      };
    }
    return { verdict: 'not_executed', refundedNow, delta };
  }
  if (delta === row.refundAmount) {
    if (otherProcessingCount > 0) {
      return {
        verdict: 'other_in_flight',
        refundedNow,
        delta,
        detail: `同單另有 ${otherProcessingCount} 筆處理中退款,差額歸屬不明`,
      };
    }
    return { verdict: 'executed', refundedNow, delta };
  }
  return {
    verdict: 'delta_mismatch',
    refundedNow,
    delta,
    detail: `差額 ${delta} ∉ {0, ${row.refundAmount}}(Portal 介入痕跡的機械判定)`,
  };
}
