// refund-baseline.ts — M-3 A7c RW2c:G0 baseline 斷言(純函式;plan v3.2 §2 G0 逐條)。
//
// 為什麼存在:DB 打不了 HTTP ⇒ S2 baseline(record_refunded_before)與 full 凍結額
// (record_amount)由 server action 從 TapPay Record API 查得後**餵給** RPC。
// 這裡是那次查詢的守門 —— **任一不成立 → action abort、RPC 零呼叫**(fail-closed)。
//
// 🔴 G0 ③ 是本檔的存在理由(fable R3 F1):`refundedAmount` **欄缺 = 異常、直接 abort、
//    嚴禁 `?? 0`** —— 未退款紀錄實測必帶 `refunded_amount=0`(2026-08-03 probe,
//    `docs/handoff/2026-08-03-day-refund-wire.md` §4 第 1 發);缺欄翻 0 會永久污染 S2
//    ⇒ RW4 差額判定會把「從未執行的退款」判成已退。

import type { TapPayRecordResult } from '@pcm/domain';
import type { RefundKind } from './refund-form';

/**
 * G0 recordQuery 的逾時上限(RW2b 契約債:port 預設**無**逾時 ⇒ action 必自帶 ≤10s)。
 * 🔴 為什麼是 10s:route maxDuration=60s、refund() 自帶 30s 硬逾時 —— Record 若慢到
 * 吃掉更多餘額,退款送出後才被平台砍在半路 = 自製 unknown-state。10s 給足正常反查、
 * 守住「砍就砍在還沒動錢的階段」。
 */
export const REFUND_RECORD_QUERY_TIMEOUT_MS = 10_000;

/**
 * Record `record_status` allowlist(G0 ②):0=AUTH / 1=OK / 2=PARTIALREFUNDED 可退;
 * 3=REFUNDED(已退畢)/ 4=PENDING / 5=CANCEL / -1=ERROR → 具名員工可讀錯誤。
 */
export const REFUND_ALLOWED_RECORD_STATUSES: readonly number[] = [0, 1, 2];

export type RecordBaselineCheck =
  | {
      ok: true;
      /** Record `amount` = TapPay 剩餘可退額(**會隨退款遞減**,#301;full 凍結額來源,G3)。 */
      recordAmount: number;
      /** Record `refunded_amount` = 累計已退(S2 baseline;RW4 差額判定的錨)。 */
      refundedBefore: number;
    }
  | {
      ok: false;
      code: 'record_shape_bad' | 'record_state_bad' | 'nothing_left';
      /** log 用(不進 UI;UI 只吃 code 對應訊息)。 */
      detail: string;
    };

/**
 * G0 斷言全套。順序:先形狀(①查詢成功+恰一筆+識別碼相符)、再狀態(②allowlist)、
 * 再欄位完整性(③refunded_amount 欄缺)、最後業務態(④full 已無可退)。
 */
export function checkRecordBaseline(
  result: TapPayRecordResult,
  expectedRecTradeId: string,
  kind: RefundKind,
): RecordBaselineCheck {
  // ① queryStatus ∈ {0,2}(兩者皆「查詢成功」;其餘=查詢層異常,fail-closed)
  if (result.queryStatus !== 0 && result.queryStatus !== 2) {
    return {
      ok: false,
      code: 'record_shape_bad',
      detail: `queryStatus=${result.queryStatus}(非 0/2)`,
    };
  }
  // ① 恰一筆 —— 兩個計數都驗(計數欄與陣列長度分岔=解析層異常,一樣拒)
  if (result.numberOfTransactions !== 1 || result.records.length !== 1) {
    return {
      ok: false,
      code: 'record_shape_bad',
      detail: `筆數異常(numberOfTransactions=${result.numberOfTransactions}, records=${result.records.length})`,
    };
  }
  const record = result.records[0];
  if (record === undefined) {
    // 長度已驗 1、理論不可達;noUncheckedIndexedAccess 之下仍顯式擋(fail-closed 不 cast)。
    return { ok: false, code: 'record_shape_bad', detail: 'records[0] 缺(解析層異常)' };
  }
  // ① recTradeId 相符(送錯 rec 給 TapPay = 退到別人的交易;P7C03 之外的第一道)
  if (record.recTradeId !== expectedRecTradeId) {
    return {
      ok: false,
      code: 'record_shape_bad',
      detail: `recTradeId 不符(Record=${record.recTradeId})`,
    };
  }
  // 幣別(G0 未列、本片加嚴):Phase 1 全 TWD;幣別對不上=amount 單位語意整個不對,
  // 凍結額會以錯誤單位入帳。缺欄放行(1a 對歷史紀錄的既有寬容)、有值必須是 TWD。
  if (record.currency !== undefined && record.currency !== 'TWD') {
    return {
      ok: false,
      code: 'record_shape_bad',
      detail: `currency=${record.currency}(非 TWD)`,
    };
  }
  // ② record_status allowlist
  if (!REFUND_ALLOWED_RECORD_STATUSES.includes(record.recordStatus)) {
    return {
      ok: false,
      code: 'record_state_bad',
      detail: `record_status=${record.recordStatus}(不在 {0,1,2})`,
    };
  }
  // ③ refunded_amount 欄缺 = abort(嚴禁 ?? 0;見檔頭)
  if (record.refundedAmount === undefined) {
    return {
      ok: false,
      code: 'record_shape_bad',
      detail: 'refunded_amount 欄缺(嚴禁翻 0;G0 ③)',
    };
  }
  // ④ full 的「已無可退」(=0 → 友善業務態;否則 0 元凍結會撞 refund_amount>0 CHECK)
  if (kind === 'full' && record.amount === 0) {
    return { ok: false, code: 'nothing_left', detail: 'Record amount=0(已無可退)' };
  }
  return { ok: true, recordAmount: record.amount, refundedBefore: record.refundedAmount };
}
