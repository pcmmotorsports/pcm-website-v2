// capture-state-repository.test.ts — 形狀驗證那一層的守門(W4-Q 第二半)
//
// 🔴 **本檔只測 `parseCaptureRow`,【不測】`getOrderCaptureState`。** 那不是漏掉:
//    後者的全部內容是一發 supabase 查詢,mock 掉它之後測到的是「我有沒有照我自己寫的方式呼叫我的 mock」
//    —— 那種測試在**真的權限不足(42501)**時照樣綠,而那正是這一片最可能失敗的地方(驗收 ☐6 未實測)。
//    ⇒ **那一格只有實跑答得出來**,寫一個 mock 測試只會製造一個「已測過」的假象。
//    📌 同族:`docs/patterns/guard-and-instrument-traps.md`「恆綠格」。

import { describe, it, expect, vi } from 'vitest';

// 既有慣例(同 `payment-repository.test.ts:3`):`server-only` 在非 react-server 條件下 import 即拋。
vi.mock('server-only', () => ({}));

import { parseCaptureRow, CaptureStateShapeError } from './capture-state-repository';

/** 一筆形狀完全正確的列;每個案例只覆寫它關心的那一欄。 */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    capture_state: 'authorized',
    capture_state_read_at: '2026-08-20T01:21:57.000Z',
    status: 'charged',
    bank_transaction_id: 'bank-txn-123',
    ...over,
  };
}

describe('parseCaptureRow — 正常路徑', () => {
  it('四欄齊備 ⇒ 轉成顯示層要的形狀', () => {
    const got = parseCaptureRow(row());
    expect(got.captureState).toBe('authorized');
    expect(got.status).toBe('charged');
    expect(got.hasBankTxn).toBe(true);
    expect(got.readAt?.toISOString()).toBe('2026-08-20T01:21:57.000Z');
  });

  it('read_at 是 null ⇒ readAt 是 null,不是拋(unknown 那一態的合法形狀)', () => {
    const got = parseCaptureRow(row({ capture_state: 'unknown', capture_state_read_at: null }));
    expect(got.readAt).toBeNull();
  });

  it('🔴 bank_transaction_id 是 null ⇒ hasBankTxn=false(直刷單的判別欄)', () => {
    // 這一格若壞掉,直刷單會被畫成「查詢中」而永遠不會有答案 —— `#781` ① 講的就是它。
    expect(parseCaptureRow(row({ bank_transaction_id: null })).hasBankTxn).toBe(false);
  });
});

describe('🔴 值域:讀回來的東西不在值域 ⇒ 拋,不得靜默收斂', () => {
  for (const bad of ['pending', 'CAPTURED', '', 'null']) {
    it(`capture_state = ${JSON.stringify(bad)} ⇒ 拋`, () => {
      expect(() => parseCaptureRow(row({ capture_state: bad }))).toThrow(CaptureStateShapeError);
    });
  }

  it('status 不在四值裡 ⇒ 拋', () => {
    expect(() => parseCaptureRow(row({ status: 'refunded' }))).toThrow(CaptureStateShapeError);
  });

  // 🔴 負對照:值域檢查不能嚴到把【合法值】也擋掉。
  //    沒有這一格,一個「對任何東西都拋」的實作也會讓上面每一格變綠。
  for (const ok of ['authorized', 'captured', 'unknown']) {
    it(`負對照:capture_state = ${ok} ⇒ 必須通過`, () => {
      expect(() =>
        parseCaptureRow(row({ capture_state: ok, capture_state_read_at: ok === 'unknown' ? null : row().capture_state_read_at })),
      ).not.toThrow();
    });
  }
});

describe('🔴 「鍵不存在」與「值是 null」要分得開', () => {
  it('缺 capture_state_read_at 這個鍵 ⇒ 拋(欄位被改名 / 沒選到)', () => {
    const r = row();
    delete r.capture_state_read_at;
    expect(() => parseCaptureRow(r)).toThrow(/缺 capture_state_read_at/);
  });

  it('缺 bank_transaction_id 這個鍵 ⇒ 拋', () => {
    const r = row();
    delete r.bank_transaction_id;
    expect(() => parseCaptureRow(r)).toThrow(/缺 bank_transaction_id/);
  });

  // 🔴 這一組是上面那兩格的【對照】:值是 null 是合法的,鍵不見才是壞的。
  //    兩者若被收斂成同一個結果,欄位改名的那一天每一筆都會靜默畫成「尚未查詢」而全綠。
  it('對照:值是 null(鍵在)⇒ 不得拋', () => {
    expect(() => parseCaptureRow(row({ capture_state_read_at: null, capture_state: 'unknown' }))).not.toThrow();
    expect(() => parseCaptureRow(row({ bank_transaction_id: null }))).not.toThrow();
  });
});

describe('時間欄的邊界', () => {
  it('read_at 是不合法時間字串 ⇒ 拋,不得產生 Invalid Date', () => {
    // 🔴 Invalid Date 不會自己爆,它會一路流到新鮮度閘的減法裡變成 NaN,
    //    而 `NaN > 門檻` 是 false ⇒ **過期的值會被當成新鮮的印出來**。
    expect(() => parseCaptureRow(row({ capture_state_read_at: 'not-a-date' }))).toThrow(
      /不是合法時間/,
    );
  });

  it('read_at 是數字(不是字串)⇒ 拋', () => {
    expect(() => parseCaptureRow(row({ capture_state_read_at: 1755648117000 }))).toThrow(
      CaptureStateShapeError,
    );
  });
});

describe('不是物件', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    // 空陣列刻意也算不合法:`maybeSingle()` 回陣列代表我查錯了(該用 single 的地方回了多列)。
    it(`${JSON.stringify(bad)} ⇒ 拋`, () => {
      expect(() => parseCaptureRow(bad)).toThrow(CaptureStateShapeError);
    });
  }
});
