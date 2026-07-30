/**
 * D1t1:§8.7 判定矩陣逐格對照表(驗收條件 2)。
 *
 * | §8.7 格 | 測試 |
 * |---|---|
 * | 五筆有鍵不降級、唯一命中、top ∈{0,2} | happy path / top status / 多筆 / 缺結果 |
 * | 三筆已退:record_status=3 ∧ refunded=授權額 | refunded 全組 + 狀態外 + 非全額退 |
 * | 0052 查無 ⇒ 保持原值 + audit「正式商戶查無」(禁 sandbox 措辭) | 0052 zero-hit |
 * | 0102/0104 查無 = abort | 0102/0104 zero-hit |
 * | 🔴 0064/0090 查無 ∧ unpaid ⇒ not-charged-no-hit(official-no-hit);非 unpaid = abort | 0064/0090 zero-hit 成對 |
 * | pending 只收 {-1,5};0(AUTH)/4(PENDING)= abort raise Sean | pending 全狀態掃描 |
 * | 0101 不查、禁替代鍵、證據等級 = Sean 本人確認 | 0101 note / results 含 0101 / 0101 長出鍵 |
 * | 其餘(金額不符/多筆/狀態外)一律 abort | 各負例 |
 */
import { describe, expect, it } from 'vitest';

import type { TapPayRecordResponseWire, TapPayRecordWire } from '../packages/adapters/src/tappay/wire';
import {
  judgeReadback,
  SEAN_ATTESTED_NOTE,
  SEAN_TAPPAY_CONSOLE_ATTESTATION,
  type D1AttemptFact,
} from './d1-readback';

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
    // 🔴 #301 形狀:全額退款後 `amount` 歸 0、原額在 `original_amount`、`refunded_amount` = 已退金額。
    //    `amount=0` / `refunded_amount` / `record_status=3` / `is_captured=false` 取自 2026-07-30
    //    正式商戶實測;**`originalAmount` 與 `timeMillis` 的值未被觀察過、此處為合成值**(關卡2 R2-12)。
    amount: 0,
    originalAmount: total,
    currency: 'TWD',
    recordStatus: 3,
    // 🔴 實測:已全額退款的紀錄 is_captured 為 false(0102/0104 兩筆皆然)。
    isCaptured: false,
    refundedAmount: total,
    timeMillis: 1753000000000,
    ...patch,
  };
}

/** 未退款筆(pending/取消)的真實形狀:amount 未被退款吃掉、refunded_amount 為 0。 */
function unrefunded(
  displayId: keyof typeof KEYED,
  patch: Partial<TapPayRecordWire> = {},
): TapPayRecordWire {
  const { total } = KEYED[displayId];
  return record(displayId, { amount: total, refundedAmount: 0, ...patch });
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
    ['PCM-2026-0064', wire([unrefunded('PCM-2026-0064', { recordStatus: 5 })])],
    ['PCM-2026-0090', wire([unrefunded('PCM-2026-0090', { recordStatus: -1, refundedAmount: undefined })])],
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
      expect(byId.get(d)?.timeMillis).toBe(1753000000000);
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

  // 🔴 0064/0090 條件式零筆出口(2026-07-30 D1b1 首跑實證後 Sean 拍板「窄化放寬」)。
  //    放行與擋下**必須成對驗**:只驗放行 = 只證明了它會通過,證不了那道前提真的擋得住。
  it.each(['PCM-2026-0064', 'PCM-2026-0090'] as const)(
    '%s 查無 + payment_status=unpaid ⇒ not-charged-no-hit(證據等級 official-no-hit、非 system-readback)',
    (d) => {
      const results = happyResults();
      results.set(d, wire([], 2));
      const rows = judgeReadback(facts({ [d]: { paymentStatus: 'unpaid' } }), results);
      const r = rows.find((x) => x.displayId === d)!;
      expect(r.verdict).toBe('not-charged-no-hit');
      expect(r.evidenceLevel).toBe('official-no-hit');
      expect(r.evidenceLevel).not.toBe('system-readback');
      expect(r.note).toContain('正式商戶查無');
      expect(r.note).toContain(SEAN_TAPPAY_CONSOLE_ATTESTATION);
      // 措辭合約(R22)同樣適用:查無 ≠ sandbox 已證實。
      expect(r.note.toLowerCase()).not.toContain('sandbox');
      // 查無沒有 TapPay 側數值可記,四欄必須是 null(不得從 DB 端補值冒充 read-back 結果)。
      expect([r.recordStatus, r.amount, r.refundedAmount, r.timeMillis]).toEqual([
        null,
        null,
        null,
        null,
      ]);
    },
  );

  it.each(['PCM-2026-0064', 'PCM-2026-0090'] as const)(
    '%s 查無 + payment_status≠unpaid = abort(DB 說收過錢、正式商戶查無 = 兩邊矛盾)',
    (d) => {
      const results = happyResults();
      results.set(d, wire([], 2));
      // 預設 fixture 就是 paid ⇒ 這是「放寬沒有失控」的守門。
      expect(() => judgeReadback(facts(), results)).toThrow(/兩邊矛盾/);
      // refunded 之類的其他非 unpaid 值同樣擋下(不是只擋 'paid' 這個字面)。
      expect(() => judgeReadback(facts({ [d]: { paymentStatus: 'refunded' } }), results)).toThrow(
        /兩邊矛盾/,
      );
    },
  );

  it('零筆容忍度不外溢:0064 放行不代表 0090 以外的單也能查無(0102 仍 abort)', () => {
    const results = happyResults();
    results.set('PCM-2026-0064', wire([], 2));
    results.set('PCM-2026-0102', wire([], 2));
    expect(() =>
      judgeReadback(facts({ 'PCM-2026-0064': { paymentStatus: 'unpaid' } }), results),
    ).toThrow(/正式站真刷必有紀錄/);
  });

  it.each(['PCM-2026-0102', 'PCM-2026-0104'] as const)('%s 查無 = abort(正式站真刷必有紀錄)', (d) => {
    const results = happyResults();
    results.set(d, wire([]));
    expect(() => judgeReadback(facts(), results)).toThrow(/查無/);
  });

  // pending 狀態掃描:-1/5 放行;0(AUTH)/4(PENDING)/1(OK)/2/3 全 abort。
  it.each([-1, 5])('pending 單 record_status %i 放行', (s) => {
    const results = happyResults();
    results.set('PCM-2026-0064', wire([unrefunded('PCM-2026-0064', { recordStatus: s })]));
    expect(judgeReadback(facts(), results).find((r) => r.displayId === 'PCM-2026-0064')?.verdict).toBe(
      'not-charged-confirmed',
    );
  });
  it.each([0, 1, 2, 3, 4])('pending 單 record_status %i = abort(0/4 = 交易在途,raise Sean)', (s) => {
    const results = happyResults();
    results.set('PCM-2026-0090', wire([unrefunded('PCM-2026-0090', { recordStatus: s })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/不在自動放行集合/);
  });

  it('已退單 record_status ≠ 3 = abort', () => {
    const results = happyResults();
    results.set('PCM-2026-0104', wire([record('PCM-2026-0104', { recordStatus: 1 })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/record_status 應為 3/);
  });

  it('非全額退(refunded_amount ≠ 原始金額)= abort', () => {
    const results = happyResults();
    results.set('PCM-2026-0102', wire([record('PCM-2026-0102', { refundedAmount: 100 })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/非全額退/);
  });

  // 🔴 關卡2 F10:負 epoch / 0 也是 safe integer,但不是合法交易時間。
  //    本檔沒有時間窗可以順帶擋掉它 ⇒ 這道守門單獨承重、必須有自己的測試。
  it.each([0, -1, -1_700_000_000_000])('退款證據的 time = %i(非法 epoch)= abort', (bad) => {
    const results = happyResults();
    results.set('PCM-2026-0102', wire([record('PCM-2026-0102', { timeMillis: bad })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/time 缺失或非法/);
  });

  // 🔴 #301:官方逐字「amount 會因退款而減少」⇒ 全額退款後餘額必為 0。
  //    refunded_amount 對得上、但 amount 沒歸零 = 兩欄互相矛盾,不當成全額退款證據。
  it('全額退款但 amount 未歸零 = abort(兩欄矛盾、不採信)', () => {
    const results = happyResults();
    results.set('PCM-2026-0102', wire([record('PCM-2026-0102', { amount: 101 })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/餘額 amount 應為 0/);
  });

  it('退款證據筆缺 time = abort;pending 筆缺值 = 放行 + note 記原因', () => {
    const results = happyResults();
    results.set('PCM-2026-0052', wire([record('PCM-2026-0052', { timeMillis: undefined })]));
    expect(() => judgeReadback(facts(), results)).toThrow(/time 缺失/);

    const ok = happyResults();
    ok.set('PCM-2026-0064', wire([unrefunded('PCM-2026-0064', { recordStatus: 5, timeMillis: undefined })]));
    const r = judgeReadback(facts(), ok).find((x) => x.displayId === 'PCM-2026-0064')!;
    expect(r.verdict).toBe('not-charged-confirmed');
    expect(r.note).toContain('缺值');
  });

  it('金額不符 orders.total = abort;currency 非 TWD = abort', () => {
    const results = happyResults();
    // #301:身分閘比 original_amount(不受退款影響),故金額漂移要打在這一欄。
    results.set(
      'PCM-2026-0104',
      wire([record('PCM-2026-0104', { originalAmount: 9999, refundedAmount: 9999 })]),
    );
    expect(() => judgeReadback(facts(), results)).toThrow(/orders\.total/);

    // 🔴 缺 original_amount 時退回 amount(舊行為);此時 amount 漂移一樣要擋得住。
    const legacy = happyResults();
    legacy.set(
      'PCM-2026-0104',
      wire([record('PCM-2026-0104', { originalAmount: undefined, amount: 9999, refundedAmount: 9999 })]),
    );
    expect(() => judgeReadback(facts(), legacy)).toThrow(/orders\.total/);

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
    bad.set('PCM-2026-0064', wire([unrefunded('PCM-2026-0064', { recordStatus: 5 })], 1));
    expect(() => judgeReadback(facts(), bad)).toThrow(/top status/);

    const ok = happyResults();
    ok.set('PCM-2026-0064', wire([unrefunded('PCM-2026-0064', { recordStatus: 5 })], 2));
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
