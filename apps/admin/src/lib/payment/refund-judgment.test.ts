import { describe, expect, it } from 'vitest';
import type { TapPayRecordResult, TapPayTradeRecord } from '@pcm/domain';
import {
  JUDGMENT_ALLOWED_RECORD_STATUSES,
  RESOLUTION_REQUIRED_VERDICT,
  judgeRefundRecovery,
  type RefundRecoverySnapshot,
} from './refund-judgment';

// refund-judgment.test.ts — RW4 判定碼表(plan §4-1:每判定碼一正一負)。
// fixture 防恆真(memory `feedback_fixture-value-makes-guard-vacuous`):
// baseline=100≠0(「?? 0 / 翻 0」突變可觀察)、refundAmount=250≠baseline(避撞號)、
// executed 的 now=350 使 delta 既 ≠0 也 ≠baseline —— 三軸互不遮蔽。

const REC = 'D20260803TESTrec';

const ROW: RefundRecoverySnapshot = {
  refundAmount: 250,
  recTradeId: REC,
  recordRefundedBefore: 100,
  providerEvidence: null,
};

function record(over: Partial<TapPayTradeRecord> = {}): TapPayTradeRecord {
  return {
    recTradeId: REC,
    orderNumber: '250001',
    merchantId: 'PCM_TEST',
    amount: 600 as TapPayTradeRecord['amount'],
    currency: 'TWD',
    recordStatus: 1,
    isCaptured: true,
    refundedAmount: 100 as TapPayTradeRecord['refundedAmount'],
    ...over,
  };
}

function result(over: Partial<TapPayRecordResult> = {}): TapPayRecordResult {
  return { queryStatus: 0, numberOfTransactions: 1, records: [record()], ...over };
}

function withRefundedNow(now: number): TapPayRecordResult {
  return result({
    records: [record({ refundedAmount: now as TapPayTradeRecord['refundedAmount'] })],
  });
}

describe('not_executed(delta=0)', () => {
  it('正:現值=baseline → not_executed、帶兩讀數', () => {
    expect(judgeRefundRecovery(withRefundedNow(100), ROW, 0)).toEqual({
      verdict: 'not_executed',
      refundedNow: 100,
      delta: 0,
    });
  });

  it('正:baseline=0、現值=0(從未退過)—— 0 是合法讀數,與「欄缺」是兩件事', () => {
    expect(
      judgeRefundRecovery(withRefundedNow(0), { ...ROW, recordRefundedBefore: 0 }, 0),
    ).toMatchObject({ verdict: 'not_executed', delta: 0 });
  });

  it('負:現值=baseline+1 → 不是 not_executed(落 delta_mismatch)', () => {
    expect(judgeRefundRecovery(withRefundedNow(101), ROW, 0)).toMatchObject({
      verdict: 'delta_mismatch',
    });
  });

  it('🔴 負(opus M1):delta=0 但**有受理證據** → 不是 not_executed(矛盾讀數不開結案按鈕)', () => {
    expect(
      judgeRefundRecovery(withRefundedNow(100), { ...ROW, providerEvidence: 'DRHOLD1' }, 0),
    ).toMatchObject({ verdict: 'evidence_contradiction' });
  });
});

describe('evidence_contradiction(受理證據 × 零差額 = 矛盾;opus M1)', () => {
  it('正:證據非空 + delta=0 → 停、純人工、帶兩讀數', () => {
    expect(
      judgeRefundRecovery(withRefundedNow(100), { ...ROW, providerEvidence: 'DRHOLD1' }, 0),
    ).toMatchObject({ verdict: 'evidence_contradiction', refundedNow: 100, delta: 0 });
  });

  it('負:證據非空但 delta=凍結額 → 照走 executed(證據與差額一致=正常恢復路)', () => {
    expect(
      judgeRefundRecovery(withRefundedNow(350), { ...ROW, providerEvidence: 'DRHOLD1' }, 0),
    ).toMatchObject({ verdict: 'executed' });
  });
});

describe('executed(delta=refund_amount 且無其他 processing)', () => {
  it('正:現值=baseline+凍結額、others=0 → executed', () => {
    expect(judgeRefundRecovery(withRefundedNow(350), ROW, 0)).toEqual({
      verdict: 'executed',
      refundedNow: 350,
      delta: 250,
    });
  });

  it('🔴 正:record_status=3(REFUNDED 已退畢)必須放行 —— 與 G0 {0,1,2} 的刻意分岔:全額退到底的卡列,Record 終點就是 3,擋掉=永遠結不了案', () => {
    const refundedOut = result({
      records: [
        record({
          recordStatus: 3,
          refundedAmount: 350 as TapPayTradeRecord['refundedAmount'],
        }),
      ],
    });
    expect(judgeRefundRecovery(refundedOut, ROW, 0)).toMatchObject({ verdict: 'executed' });
  });

  it('負:差額對但 others=1 → 不是 executed(落 other_in_flight)', () => {
    expect(judgeRefundRecovery(withRefundedNow(350), ROW, 1)).toMatchObject({
      verdict: 'other_in_flight',
    });
  });
});

describe('delta_mismatch(∉ {0, refund_amount} = Portal 介入痕跡)', () => {
  it('正:差額不等(249)→ 停+純人工、detail 帶機械判定', () => {
    const judged = judgeRefundRecovery(withRefundedNow(349), ROW, 0);
    expect(judged).toMatchObject({ verdict: 'delta_mismatch', refundedNow: 349, delta: 249 });
    if (judged.verdict === 'delta_mismatch') {
      expect(judged.detail).toContain('249');
    }
  });

  it('正:負差額(Portal 端把先前退款取消)一樣是 mismatch,不得誤入 not_executed/executed', () => {
    expect(judgeRefundRecovery(withRefundedNow(50), ROW, 0)).toMatchObject({
      verdict: 'delta_mismatch',
      delta: -50,
    });
  });

  it('🔴 正:超退(delta > refund_amount)= mismatch,不得誤判 executed —— over-refund 是錢最危險的方向', () => {
    // 出身:2026-08-18 錢/權限突變普查。原本行使過的 delta 全集={−50,0,1,249,250},
    // delta>250 一格都沒有 ⇒ executed 閘的 `=== refundAmount` 被改成 `>=` 時,退超過凍結額
    // 的那筆會被靜默判成 executed 乾淨結案、全套照綠。本格釘住那個上緣。
    // 期望值當場量(withRefundedNow(360)、before=100、refund=250 ⇒ delta=260),不是手算。
    const judged = judgeRefundRecovery(withRefundedNow(360), ROW, 0);
    expect(judged).toMatchObject({ verdict: 'delta_mismatch', refundedNow: 360, delta: 260 });
  });

  it('負:差額全等且 others=0 → 不是 mismatch(executed)', () => {
    expect(judgeRefundRecovery(withRefundedNow(350), ROW, 0)).toMatchObject({
      verdict: 'executed',
    });
  });
});

describe('other_in_flight(差額歸屬不明)', () => {
  it('正:delta=凍結額、others=2 → other_in_flight、detail 帶筆數', () => {
    const judged = judgeRefundRecovery(withRefundedNow(350), ROW, 2);
    expect(judged).toMatchObject({ verdict: 'other_in_flight', delta: 250 });
    if (judged.verdict === 'other_in_flight') {
      expect(judged.detail).toContain('2');
    }
  });

  it('🔴 負(§4-1 字面):兄弟檢查**只掛 executed 出口** —— delta=0 且 others>0 仍是 not_executed(本列零動錢已證,標記失敗不受兄弟影響)', () => {
    expect(judgeRefundRecovery(withRefundedNow(100), ROW, 3)).toMatchObject({
      verdict: 'not_executed',
    });
  });
});

describe('record_shape_bad(查無/多筆/識別碼/欄缺/幣別)', () => {
  it('正:queryStatus 非 0/2', () => {
    expect(judgeRefundRecovery(result({ queryStatus: 1 }), ROW, 0)).toMatchObject({
      verdict: 'record_shape_bad',
    });
  });

  it('正:查無(0 筆)與多筆(2 筆)都停', () => {
    expect(
      judgeRefundRecovery(result({ numberOfTransactions: 0, records: [] }), ROW, 0),
    ).toMatchObject({ verdict: 'record_shape_bad' });
    expect(
      judgeRefundRecovery(result({ numberOfTransactions: 2, records: [record(), record()] }), ROW, 0),
    ).toMatchObject({ verdict: 'record_shape_bad' });
  });

  it('正:recTradeId 不符(讀到別筆交易=毒數據)', () => {
    expect(
      judgeRefundRecovery(result({ records: [record({ recTradeId: 'D_OTHER' })] }), ROW, 0),
    ).toMatchObject({ verdict: 'record_shape_bad' });
  });

  it('🔴 正:refunded_amount 欄缺 = 停(嚴禁 ?? 0 —— 翻 0 會把差額判定整個帶歪)', () => {
    expect(
      judgeRefundRecovery(result({ records: [record({ refundedAmount: undefined })] }), ROW, 0),
    ).toMatchObject({ verdict: 'record_shape_bad' });
  });

  it('正:currency 非 TWD = 停;負:currency 欄缺(歷史紀錄寬容)照常判定', () => {
    expect(
      judgeRefundRecovery(
        result({ records: [record({ currency: 'USD' as TapPayTradeRecord['currency'] })] }),
        ROW,
        0,
      ),
    ).toMatchObject({ verdict: 'record_shape_bad' });
    expect(
      judgeRefundRecovery(result({ records: [record({ currency: undefined })] }), ROW, 0),
    ).toMatchObject({ verdict: 'not_executed' });
  });

  it('負:queryStatus=2(無更多分頁)是查詢成功、正常判定', () => {
    expect(judgeRefundRecovery(result({ queryStatus: 2 }), ROW, 0)).toMatchObject({
      verdict: 'not_executed',
    });
  });
});

describe('record_state_bad(讀數不可信)', () => {
  it.each([4, 5, -1])('正:record_status=%s → 停', (status) => {
    expect(
      judgeRefundRecovery(result({ records: [record({ recordStatus: status })] }), ROW, 0),
    ).toMatchObject({ verdict: 'record_state_bad' });
  });

  it('負:record_status=2(PARTIALREFUNDED)在 allowlist、正常判定', () => {
    expect(
      judgeRefundRecovery(result({ records: [record({ recordStatus: 2 })] }), ROW, 0),
    ).toMatchObject({ verdict: 'not_executed' });
  });

  it('allowlist 字面 = {0,1,2,3}(判定含 3;與 G0 的分岔是刻意的,改值先讀兩檔檔頭)', () => {
    expect([...JUDGMENT_ALLOWED_RECORD_STATUSES]).toEqual([0, 1, 2, 3]);
  });
});

describe('resolution → 必要判定(fail-closed 查表)', () => {
  it('mark_failed ⇔ not_executed;recover_confirmed ⇔ executed(resolve action 送出當下重判過本表)', () => {
    expect(RESOLUTION_REQUIRED_VERDICT).toEqual({
      mark_failed: 'not_executed',
      recover_confirmed: 'executed',
    });
  });
});
