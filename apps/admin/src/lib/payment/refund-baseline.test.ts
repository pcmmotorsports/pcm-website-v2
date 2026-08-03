import { describe, expect, it } from 'vitest';
import type { TapPayRecordResult, TapPayTradeRecord } from '@pcm/domain';
import {
  REFUND_ALLOWED_RECORD_STATUSES,
  REFUND_RECORD_QUERY_TIMEOUT_MS,
  checkRecordBaseline,
} from './refund-baseline';

// refund-baseline.test.ts — G0 斷言逐條(plan §2 G0 ①-④)。每道閘一紅一綠、
// fixture 逐欄問過「這值是否讓守門恆真」(memory `feedback_fixture-value-makes-guard-vacuous`):
// amount=600≠0(nothing_left 可構造)、refundedAmount=100≠0(?? 0 突變可觀察)。

const REC = 'D20260803TESTrec';

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

describe('checkRecordBaseline — 通過形', () => {
  it('partial/full 皆回 baseline 兩值(recordAmount=剩餘額、refundedBefore=累計已退)', () => {
    for (const kind of ['full', 'partial'] as const) {
      expect(checkRecordBaseline(result(), REC, kind)).toEqual({
        ok: true,
        recordAmount: 600,
        refundedBefore: 100,
      });
    }
  });

  it('queryStatus=2(已無更多分頁)也是查詢成功', () => {
    expect(checkRecordBaseline(result({ queryStatus: 2 }), REC, 'full')).toMatchObject({ ok: true });
  });

  it('🔴 refundedAmount=0(未退過)是合法值、必須過 —— 「0」與「欄缺」是兩件事', () => {
    const zero = result({ records: [record({ refundedAmount: 0 as TapPayTradeRecord['refundedAmount'] })] });
    expect(checkRecordBaseline(zero, REC, 'partial')).toEqual({
      ok: true,
      recordAmount: 600,
      refundedBefore: 0,
    });
  });
});

describe('checkRecordBaseline — ① 形狀閘', () => {
  it('queryStatus 非 0/2 = shape_bad', () => {
    expect(checkRecordBaseline(result({ queryStatus: 1 }), REC, 'full')).toMatchObject({
      ok: false,
      code: 'record_shape_bad',
    });
  });

  it('筆數非恰一(0 筆 / 2 筆 / 計數與陣列分岔)= shape_bad', () => {
    expect(
      checkRecordBaseline(result({ numberOfTransactions: 0, records: [] }), REC, 'full'),
    ).toMatchObject({ ok: false, code: 'record_shape_bad' });
    expect(
      checkRecordBaseline(
        result({ numberOfTransactions: 2, records: [record(), record()] }),
        REC,
        'full',
      ),
    ).toMatchObject({ ok: false, code: 'record_shape_bad' });
    expect(
      checkRecordBaseline(result({ numberOfTransactions: 2 }), REC, 'full'),
    ).toMatchObject({ ok: false, code: 'record_shape_bad' });
  });

  it('🔴 recTradeId 不符 = shape_bad(送錯 rec = 退到別人的交易)', () => {
    expect(
      checkRecordBaseline(result({ records: [record({ recTradeId: 'D_OTHER' })] }), REC, 'full'),
    ).toMatchObject({ ok: false, code: 'record_shape_bad' });
  });

  it('幣別非 TWD = shape_bad;缺幣別 = 放行(1a 對歷史紀錄的既有寬容)', () => {
    expect(
      checkRecordBaseline(result({ records: [record({ currency: 'USD' })] }), REC, 'full'),
    ).toMatchObject({ ok: false, code: 'record_shape_bad' });
    expect(
      checkRecordBaseline(result({ records: [record({ currency: undefined })] }), REC, 'full'),
    ).toMatchObject({ ok: true });
  });
});

describe('checkRecordBaseline — ② 狀態閘(allowlist {0,1,2})', () => {
  it('allowlist 常數本身釘死', () => {
    expect(REFUND_ALLOWED_RECORD_STATUSES).toEqual([0, 1, 2]);
  });
  for (const status of [0, 1, 2]) {
    it(`record_status=${status} 放行`, () => {
      expect(
        checkRecordBaseline(result({ records: [record({ recordStatus: status })] }), REC, 'partial'),
      ).toMatchObject({ ok: true });
    });
  }
  for (const status of [3, 4, 5, -1]) {
    it(`record_status=${status} = state_bad(具名員工可讀錯誤,非裸炸)`, () => {
      expect(
        checkRecordBaseline(result({ records: [record({ recordStatus: status })] }), REC, 'partial'),
      ).toMatchObject({ ok: false, code: 'record_state_bad' });
    });
  }
});

describe('checkRecordBaseline — ③ 欄缺閘(本檔的存在理由)', () => {
  it('🔴🔴 refundedAmount 欄缺 = abort(嚴禁 ?? 0 —— 翻 0 會讓 RW4 把「從未執行的退款」判成已退)', () => {
    const missing = result({ records: [record({ refundedAmount: undefined })] });
    expect(checkRecordBaseline(missing, REC, 'partial')).toMatchObject({
      ok: false,
      code: 'record_shape_bad',
    });
    expect(checkRecordBaseline(missing, REC, 'full')).toMatchObject({ ok: false });
  });
});

describe('checkRecordBaseline — ④ full 已無可退', () => {
  it('full × amount=0 = nothing_left(友善業務態,不讓 0 元凍結去撞 CHECK 裸錯)', () => {
    const drained = result({ records: [record({ amount: 0 as TapPayTradeRecord['amount'] })] });
    expect(checkRecordBaseline(drained, REC, 'full')).toMatchObject({
      ok: false,
      code: 'nothing_left',
    });
  });
  it('partial × amount=0 不在本閘擋(超額由 TapPay 10051 當權威;拍板⑤)', () => {
    const drained = result({ records: [record({ amount: 0 as TapPayTradeRecord['amount'] })] });
    expect(checkRecordBaseline(drained, REC, 'partial')).toMatchObject({ ok: true });
  });
});

describe('G0 recordQuery 逾時常數', () => {
  it('🔴 ≤10s(RW2b 契約債字面;放大會吃掉 refund 30s 後的 maxDuration 餘額)', () => {
    expect(REFUND_RECORD_QUERY_TIMEOUT_MS).toBe(10_000);
  });
});
