// @vitest-environment jsdom
// ── 🔴 更正紀錄那一句裡的時點要印【台北牆上時間】, 不是原樣的 ISO ──────────────────
//    成因與到貨清單那兩處同一族(2026-09-20):元件直接把 timestamptz 的 ISO 字串塞進句子。
//    🔴 而它比那兩處更容易被放過 —— **它印在一個句子中間**, 讀的人不會停下來懷疑那串字。
//    🛑 這裡用 formatTaipei(帶時分)而不是 taipeiYmd:本句講的是「誰在什麼時候更正的」,
//       砍掉時分會讓同一天的兩次更正看起來是同一刻。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RefundVerdictCorrection } from './refund-verdict-correction';
import type { EffectiveVerdict } from '../../lib/payment/refund-correction-read';

vi.mock('server-only', () => ({}));

function verdict(over: Partial<EffectiveVerdict> = {}): EffectiveVerdict {
  return {
    refundId: 'rf-1',
    correctionId: 'cr-1',
    seq: 1,
    correctedTo: 'money_moved',
    reason: '對過 TapPay 後台',
    actor: 'sean',
    createdAt: '2026-09-19T18:22:00.000Z',
    ...over,
  };
}

afterEach(() => cleanup());

describe('RefundVerdictCorrection — 更正時點印台北時間', () => {
  it('UTC 2026-09-19 18:22 ⇒ 印台北的 2026-09-20 02:22, 不印原樣 ISO', () => {
    const { container } = render(
      <RefundVerdictCorrection refundId='rf-1' serverToken='tok-1' effective={verdict()} />,
    );
    const text = container.textContent ?? '';
    expect(text, '要印台北牆上時間').toContain('2026-09-20 02:22');
    expect(text, '不可以把原樣 ISO 丟給員工看').not.toContain('2026-09-19T18:22:00.000Z');
  });

  // ⚪ 負對照:台北與 UTC 同一天的時點 —— 日期那一段兩種寫法都會過,
  //    它證不到時區這件事;留著是為了證明上面那一格不是恆紅也不是恆綠。
  it('負對照:UTC 2026-09-19 06:00(台北同日 14:00)⇒ 日期仍是 2026-09-19', () => {
    const { container } = render(
      <RefundVerdictCorrection
        refundId='rf-1'
        serverToken='tok-1'
        effective={verdict({ createdAt: '2026-09-19T06:00:00.000Z' })}
      />,
    );
    expect(container.textContent ?? '').toContain('2026-09-19');
  });

  // 🔴 壞時間不准 fallback 成「今天」—— 那會讓一筆壞資料看起來像剛剛才更正的。
  it('時間解析不了 ⇒ 印「(時間無法判讀)」, 不是今天也不是空白', () => {
    const { container } = render(
      <RefundVerdictCorrection
        refundId='rf-1'
        serverToken='tok-1'
        effective={verdict({ createdAt: 'not-a-time' })}
      />,
    );
    expect(container.textContent ?? '').toContain('(時間無法判讀)');
  });
});
