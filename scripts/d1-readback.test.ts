/**
 * D1t1:§8.7 判定矩陣逐格對照表(驗收條件 2)。
 *
 * | §8.7 格 | 測試 |
 * |---|---|
 * | 五筆有鍵不降級、唯一命中、top ∈{0,2} | happy path / top status / 多筆 / 缺結果 |
 * | 三筆已退:record_status=3 ∧ refunded=授權額 | refunded 全組 + 狀態外 + 非全額退 |
 * | 0052 查無 ⇒ 保持原值 + audit「正式商戶查無」(禁 sandbox 措辭) | 0052 zero-hit |
 * | 0102/0104 查無 = abort | 0102/0104 zero-hit |
 * | pending 只收 {-1,5};0(AUTH)/4(PENDING)= abort raise Sean | pending 全狀態掃描 |
 * | 0101 不查、禁替代鍵、證據等級 = Sean 本人確認 | 0101 note / results 含 0101 / 0101 長出鍵 |
 * | 其餘(金額不符/多筆/狀態外)一律 abort | 各負例 |
 */
import { describe, expect, it } from 'vitest';

import type { TapPayRecordResponseWire, TapPayRecordWire } from '../packages/adapters/src/tappay/wire';
import { judgeReadback, SEAN_ATTESTED_NOTE, type D1AttemptFact } from './d1-readback';

const KEYED = {
  'PCM-2026-0052': { rec: 'REC0052', total: 5100, uuid: 'uuid-0052' },
  'PCM-2026-0064': { rec: 'REC0064', total: 2400, uuid: 'uuid-0064' },
  'PCM-2026-0090': { rec: 'REC0090', total: 1800, uuid: 'uuid-0090' },
  'PCM-2026-0102': { rec: 'REC0102', total: 101, uuid: 'uuid-0102' },
  'PCM-2026-0104': { rec: 'REC0104', total: 5100, uuid: 'uuid-0104' },
} as const;

function facts(overrides: Partial<Record<string, Partial<D1AttemptFact>>> = {}): D1AttemptFact[] {
  const base: D1AttemptFact[] = [
    ...Object.entries(KEYED).map(([displayId, { rec, total, uuid }]) => ({
      displayId,
      orderId: uuid,
      recTradeId: rec,
      authorizedAmount: total,
      paymentStatus: 'paid',
    })),
    // 0101:§8.7 例外的拍板前提 = NT$2,400 / unpaid(NO_KEY_ORDER_EXPECTED 釘死)。
    { displayId: 'PCM-2026-0101', orderId: 'uuid-0101', recTradeId: null, authorizedAmount: 2400, paymentStatus: 'unpaid' },
  ];
  return base.map((f) => ({ ...f, ...(overrides[f.displayId] ?? {}) }));
}

function record(displayId: keyof typeof KEYED, patch: Partial<TapPayRecordWire> = {}): TapPayRecordWire {
  const { rec, total, uuid } = KEYED[displayId];
  return {
    recTradeId: rec,
    // TapPay order_number 存的是 orders.id(UUID),不是 display_id(adapter:91)。
    orderNumber: uuid,
    merchantId: 'pcm-prod',
    amount: total,
    currency: 'TWD',
    recordStatus: 3,
    isCaptured: true,
    refundedAmount: total,
    transactionTimeMillis: 1753000000000,
    ...patch,
  };
}

function wire(records: TapPayRecordWire[], status = 0): TapPayRecordResponseWire {
  return { status, msg: '', numberOfTransactions: records.length, records };
}

/** happy path:三筆已退全額退、兩筆 pending 已取消。 */
function happyResults(): Map<string, TapPayRecordResponseWire> {
  return new Map([
    ['PCM-2026-0052', wire([record('PCM-2026-0052')])],
    ['PCM-2026-0102', wire([record('PCM-2026-0102')])],
    ['PCM-2026-0104', wire([record('PCM-2026-0104')])],
    ['PCM-2026-0064', wire([record('PCM-2026-0064', { recordStatus: 5, refundedAmount: 0 })])],
    ['PCM-2026-0090', wire([record('PCM-2026-0090', { recordStatus: -1, refundedAmount: undefined })])],
  ]);
}

describe('judgeReadback:§8.7 判定矩陣', () => {
  it('happy path:3 refund-confirmed + 2 not-charged + 1 sean-attested,audit 6 列', () => {
    const rows = judgeReadback(facts(), happyResults());
    expect(rows).toHaveLength(6);
    const byId = new Map(rows.map((r) => [r.displayId, r]));
    for (const d of ['PCM-2026-0052', 'PCM-2026-0102', 'PCM-2026-0104']) {
      expect(byId.get(d)?.verdict).toBe('refund-confirmed');
      expect(byId.get(d)?.evidenceLevel).toBe('system-readback');
      expect(byId.get(d)?.transactionTimeMillis).toBe(1753000000000);
    }
    for (const d of ['PCM-2026-0064', 'PCM-2026-0090']) {
      expect(byId.get(d)?.verdict).toBe('not-charged-confirmed');
    }
    expect(byId.get('PCM-2026-0101')?.verdict).toBe('sean-attested-no-key');
  });

  it('0101:證據等級寫死 Sean 本人確認、非系統 read-back(逐字)', () => {
    const rows = judgeReadback(facts(), happyResults());
    const r = rows.find((x) => x.displayId === 'PCM-2026-0101')!;
    expect(r.note).toBe(SEAN_ATTESTED_NOTE);
    expect(r.note).toContain('未經 TapPay read-back'); // §8.7 施工必做 1 逐字。
    expect(r.evidenceLevel).toBe('sean-attested');
  });

  it('0052 查無 ⇒ keep-original + audit「正式商戶查無」,措辭不得含 sandbox', () => {
    const results = happyResults();
    results.set('PCM-2026-0052', wire([], 2));
    const rows = judgeReadback(facts(), results);
    const r = rows.find((x) => x.displayId === 'PCM-2026-0052')!;
    expect(r.verdict).toBe('keep-original-no-hit');
    expect(r.evidenceLevel).toBe('official-no-hit');
    expect(r.note).toContain('正式商戶查無');
    expect(r.note.toLowerCase()).not.toContain('sandbox');
  });

  it.each(['PCM-2026-0102', 'PCM-2026-0104'] as const)('%s 查無 = abort(正式站真刷必有紀錄)', (d) => {
    const results = happyResults();
    results.set(d, wire([]));
    expect(() => judgeReadback(facts(), results)).toThrow(/查無/);
  });

  // pending 狀態掃描:-1/5 放行;0(AUTH)/4(PENDING)/1(OK)/2/3 全 abort。
  it.each([-1, 5])('pending 單 record_status %i 放行', (s) => {
    const results = happyResults();
    results.set('PCM-2026-0064', wire([record('PCM-2026-0064', { recordStatus: s })]));
    expect(judgeReadback(facts(), results).find((r) => r.displayId === 'PCM-2026-0064')?.verdict).toBe(
      'not-charged-confirmed',
    );
  });
  it.each([0, 1, 2, 3, 4])('pending 單 record_status %i = abort(0/4 = 交易在途,raise Sean)', (s) => {
    const results = happyResults();
    results.set('PCM-2026-0090', wire([record('PCM-2026-0090', { recordStatus: s })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/不在自動放行集合/);
  });

  it('已退單 record_status ≠ 3 = abort', () => {
    const results = happyResults();
    results.set('PCM-2026-0104', wire([record('PCM-2026-0104', { recordStatus: 1 })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/record_status 應為 3/);
  });

  it('非全額退(refunded_amount ≠ 授權金額)= abort', () => {
    const results = happyResults();
    results.set('PCM-2026-0102', wire([record('PCM-2026-0102', { refundedAmount: 100 })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/非全額退/);
  });

  it('退款證據筆缺 transaction_time_millis = abort;pending 筆缺值 = 放行 + note 記原因', () => {
    const results = happyResults();
    results.set('PCM-2026-0052', wire([record('PCM-2026-0052', { transactionTimeMillis: undefined })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/transaction_time_millis/);

    const ok = happyResults();
    ok.set('PCM-2026-0064', wire([record('PCM-2026-0064', { recordStatus: 5, transactionTimeMillis: undefined })]));
    const r = judgeReadback(facts(), ok).find((x) => x.displayId === 'PCM-2026-0064')!;
    expect(r.verdict).toBe('not-charged-confirmed');
    expect(r.note).toContain('缺值');
  });

  it('金額不符 orders.total = abort;currency 非 TWD = abort', () => {
    const results = happyResults();
    results.set('PCM-2026-0104', wire([record('PCM-2026-0104', { amount: 9999, refundedAmount: 9999 })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/orders\.total/);

    const cur = happyResults();
    cur.set('PCM-2026-0104', wire([record('PCM-2026-0104', { currency: 'USD' })]));
    expect(() => judgeReadback(facts(), cur)).toThrow(/TWD/);
  });

  it('多筆命中 = abort;回傳 rec_trade_id 與查詢鍵不符 = abort', () => {
    const results = happyResults();
    results.set('PCM-2026-0052', wire([record('PCM-2026-0052'), record('PCM-2026-0052')]));
    expect(() => judgeReadback(facts(), results)).toThrow(/唯一命中/);

    const mismatch = happyResults();
    mismatch.set('PCM-2026-0052', wire([record('PCM-2026-0052', { recTradeId: 'REC-其他人' })]));
    expect(() => judgeReadback(facts(), mismatch)).toThrow(/查詢鍵不符/);
  });

  it('top status 非 0/2 = abort;status 2 放行', () => {
    const bad = happyResults();
    bad.set('PCM-2026-0064', wire([record('PCM-2026-0064', { recordStatus: 5 })], 1));
    expect(() => judgeReadback(facts(), bad)).toThrow(/top status/);

    const ok = happyResults();
    ok.set('PCM-2026-0064', wire([record('PCM-2026-0064', { recordStatus: 5 })], 2));
    expect(judgeReadback(facts(), ok)).toHaveLength(6);
  });

  it('五筆有鍵者缺任一 read-back 結果 = abort(key set 精確比對)', () => {
    const results = happyResults();
    results.delete('PCM-2026-0090');
    expect(() => judgeReadback(facts(), results)).toThrow(/key set 與五筆有鍵者不符/);
  });

  it('多出非五筆的 key(有人多查)= abort', () => {
    const results = happyResults();
    results.set('PCM-2026-9999', wire([]));
    expect(() => judgeReadback(facts(), results)).toThrow(/key set 與五筆有鍵者不符/);
  });

  it('order_number 非本單 UUID = abort(錯掛他單的強識別閘)', () => {
    const results = happyResults();
    results.set('PCM-2026-0104', wire([record('PCM-2026-0104', { orderNumber: 'uuid-別張單' })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/錯掛他單/);
  });
});

describe('judgeReadback:前置整組斷言(R1-18)', () => {
  it('0101 執行當下長出 rec_trade_id = abort(放行前提已漂移,停下重問 Sean)', () => {
    expect(() =>
      judgeReadback(facts({ 'PCM-2026-0101': { recTradeId: 'REC0101-NEW' } }), happyResults()),
    ).toThrow(/放行前提已漂移/);
  });

  it('results 含 0101 = abort(禁用任何替代鍵查詢)', () => {
    const results = happyResults();
    results.set('PCM-2026-0101', wire([]));
    expect(() => judgeReadback(facts(), results)).toThrow(/替代鍵/);
  });

  it('0101 拍板前提漂移(金額或付款態 ≠ NT$2,400/unpaid)= abort 停下重問 Sean', () => {
    expect(() =>
      judgeReadback(facts({ 'PCM-2026-0101': { authorizedAmount: 3000 } }), happyResults()),
    ).toThrow(/拍板前提漂移/);
    expect(() =>
      judgeReadback(facts({ 'PCM-2026-0101': { paymentStatus: 'paid' } }), happyResults()),
    ).toThrow(/拍板前提漂移/);
  });

  it('筆數非 6 / display_id 集合漂移 / 五鍵重複 / 金額非正整數 = abort', () => {
    expect(() => judgeReadback(facts().slice(0, 5), happyResults())).toThrow(/應 6 筆/);

    const wrongSet = facts().map((f) =>
      f.displayId === 'PCM-2026-0064' ? { ...f, displayId: 'PCM-2026-9999' } : f,
    );
    expect(() => judgeReadback(wrongSet, happyResults())).toThrow(/集合與 §8\.7 不符/);

    expect(() =>
      judgeReadback(facts({ 'PCM-2026-0064': { recTradeId: 'REC0090' } }), happyResults()),
    ).toThrow(/重複/);

    expect(() =>
      judgeReadback(facts({ 'PCM-2026-0064': { authorizedAmount: 0 } }), happyResults()),
    ).toThrow(/非正整數/);

    expect(() =>
      judgeReadback(facts({ 'PCM-2026-0090': { recTradeId: null } }), happyResults()),
    ).toThrow(/缺失/);
  });
});
