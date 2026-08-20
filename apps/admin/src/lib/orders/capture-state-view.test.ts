// capture-state-view.test.ts — W4-Q 的守門(plan `W4-030` 驗收 ☐1-☐4)
//
// 🔴 **這支測試守的不是「三個值印出三句話」**(那種格子一個放行一切的函式也會過)。
//    它守的是**兩件會讓這一格變成裝飾品的事**:
//      ① 過期的值被當成現況印出來 ⇒ 員工看到一個永遠不動的「已授權」
//      ② 「永久沒有」與「暫時還沒查到」被畫成同一格 ⇒ 他等一個不會來的值
//    ⇒ 每一格下面都寫了「這一格若被拿掉,壞掉的畫面長什麼樣」。

import { describe, it, expect } from 'vitest';
import {
  deriveCaptureDisplay,
  CAPTURE_STALE_AFTER_MS,
  CAPTURE_STATE_LABEL,
  CAPTURE_NO_CONCEPT_TEXT,
  CAPTURE_NEEDS_MANUAL_TEXT,
  type CaptureInput,
} from './capture-state-view';

const NOW = new Date('2026-08-20T12:00:00Z');
/** 剛剛才讀過 ⇒ 一定在新鮮度門檻之內。 */
const FRESH = new Date(NOW.getTime() - 60_000);
/** 過期一分鐘 ⇒ 剛好跨過門檻。**刻意只超過一分鐘**,免得測試同時通過「門檻寫錯一位數」。 */
const STALE = new Date(NOW.getTime() - CAPTURE_STALE_AFTER_MS - 60_000);

/** 3DS 刷卡單(`bank_transaction_id` 非 null)的預設值;每個案例只覆寫它關心的那一欄。 */
function card(over: Partial<CaptureInput> = {}): CaptureInput {
  return {
    captureState: 'authorized',
    readAt: FRESH,
    status: 'charged',
    hasBankTxn: true,
    ...over,
  };
}

describe('deriveCaptureDisplay — 三態', () => {
  it('captured 且值是新的 ⇒ 下肯定句', () => {
    expect(deriveCaptureDisplay(card({ captureState: 'captured', readAt: FRESH }), NOW)).toEqual({
      kind: 'settled',
      text: CAPTURE_STATE_LABEL.captured,
    });
  });

  it('authorized 且值是新的 ⇒ 不是肯定句,而且那句話自帶「不用處理」', () => {
    const got = deriveCaptureDisplay(card({ captureState: 'authorized', readAt: FRESH }), NOW);
    expect(got.kind).toBe('pending');
    // 🔴 這一格若被拿掉:員工看到「已付款」配「尚未撥款」,兩句都真,
    //    而合起來讀出來的第三個意思是「這張單有問題」—— 它沒有問題。
    //    前例 `#494`:四種付款狀態共用一句話,Sean 自己讀到才發現。
    expect(got.kind === 'pending' && got.text).toContain('不用處理');
  });

  it('🔴 unknown ⇒ 不得渲染成肯定句(kind 不是 settled)', () => {
    const got = deriveCaptureDisplay(card({ captureState: 'unknown', readAt: null }), NOW);
    expect(got.kind).toBe('pending');
    expect(got.kind === 'pending' && got.text).toBe(CAPTURE_STATE_LABEL.unknown);
  });

  it('三句話兩兩不同 —— 不得共用字面(#494 的教訓)', () => {
    const texts = Object.values(CAPTURE_STATE_LABEL);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('三句話都不得出現時長或時點(R-015-STOP:入帳時間只能講條件)', () => {
    // 負對照在下一行:這個 pattern 抓得到「3 天」「24 小時」這類字面。
    const TIME_ISH = /\d+\s*(天|小時|分鐘|日|hours?|days?)/;
    expect(TIME_ISH.test('大約 3 天')).toBe(true); // ← 尺是活的
    for (const t of Object.values(CAPTURE_STATE_LABEL)) {
      expect(TIME_ISH.test(t)).toBe(false);
    }
  });
});

describe('🔴 新鮮度閘(plan §1;驗收 ☐2)', () => {
  it('authorized 但值已過期 ⇒ 退回「尚未查詢」,不再說「已授權」', () => {
    const got = deriveCaptureDisplay(card({ captureState: 'authorized', readAt: STALE }), NOW);
    expect(got.kind === 'pending' && got.text).toBe(CAPTURE_STATE_LABEL.unknown);
  });

  it('🔴 captured 但值已過期 ⇒ **也不下肯定句**', () => {
    // 這一格比上一格重要:`captured` 是唯一的肯定句,而一個過期的肯定句
    // 會讓員工以為錢已經進來了。⇒ 拿掉新鮮度閘,**只有這一格與上一格會紅**。
    const got = deriveCaptureDisplay(card({ captureState: 'captured', readAt: STALE }), NOW);
    expect(got.kind).not.toBe('settled');
    expect(got.kind === 'pending' && got.text).toBe(CAPTURE_STATE_LABEL.unknown);
  });

  it('剛好在門檻上(未超過)⇒ 仍然照字面講 —— 閘不得把新鮮的值也擋掉', () => {
    const edge = new Date(NOW.getTime() - CAPTURE_STALE_AFTER_MS);
    const got = deriveCaptureDisplay(card({ captureState: 'captured', readAt: edge }), NOW);
    expect(got.kind).toBe('settled');
  });
});

describe('#781 ① 直刷單:永久沒有,不是還沒查到', () => {
  it('bank_transaction_id 是 null ⇒ 這一格不顯示', () => {
    const got = deriveCaptureDisplay(card({ hasBankTxn: false }), NOW);
    expect(got).toEqual({ kind: 'hidden', reason: 'no-capture-concept' });
  });

  it('🔴 負對照:3DS 未 settle 的單【必須】仍顯示「尚未查詢」', () => {
    // `#781` ③ 逐字要求這一發。沒有它,「直刷不顯示」的實作可以退化成
    // 「只要沒查到就不顯示」—— 那是把兩種空白又併回同一格,只是換了文案。
    const got = deriveCaptureDisplay(
      card({ hasBankTxn: true, status: 'pending', captureState: 'unknown', readAt: null }),
      NOW,
    );
    expect(got.kind).toBe('pending');
    expect(got.kind === 'pending' && got.text).toBe(CAPTURE_STATE_LABEL.unknown);
  });

  it('直刷單的判斷【先於】其他每一格 —— 就算它不知怎地帶了 captured 也一樣不顯示', () => {
    const got = deriveCaptureDisplay(
      card({ hasBankTxn: false, captureState: 'captured', readAt: FRESH }),
      NOW,
    );
    expect(got.kind).toBe('hidden');
  });
});

describe('#781 ② released/failed 卻已請款 ⇒ 需人工結案,不是錯誤', () => {
  for (const status of ['released', 'failed'] as const) {
    it(`status=${status} + captured ⇒ attention,而且文案不含「錯誤」`, () => {
      const got = deriveCaptureDisplay(card({ status, captureState: 'captured', readAt: FRESH }), NOW);
      expect(got.kind).toBe('attention');
      expect(got.kind === 'attention' && got.text).toBe(CAPTURE_NEEDS_MANUAL_TEXT);
      expect(CAPTURE_NEEDS_MANUAL_TEXT).not.toContain('錯誤');
    });
  }

  it('released 但【沒有】請款 ⇒ 不是 attention(閘的分母不得比病寬)', () => {
    const got = deriveCaptureDisplay(
      card({ status: 'released', captureState: 'authorized', readAt: FRESH }),
      NOW,
    );
    expect(got.kind).not.toBe('attention');
  });
});

describe('文案常數本身', () => {
  it('直刷單那句不得出現「查詢中 / 處理中 / —」(#781 ① 明文禁止)', () => {
    for (const banned of ['查詢中', '處理中', '—']) {
      expect(CAPTURE_NO_CONCEPT_TEXT).not.toContain(banned);
    }
    // 負對照:這把尺抓得到那些字。
    expect('查詢中').toContain('查詢中');
  });
});
