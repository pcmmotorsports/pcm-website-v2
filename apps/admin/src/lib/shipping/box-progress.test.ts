// 箱子進度(2026-09-27 出貨流程甲;報告 ~/pcm-mailbox/後台出貨流程審視-20260927.md 第四節)。
// 訂單列表的「下一步」與出貨清單的「狀態」都讀這一支 ⇒ 兩頁對同一箱永遠講同一句話。

import { describe, expect, it } from 'vitest';
import { boxProgress, BOX_PROGRESS_LABEL, pendingBox, type BoxProgressRow } from './box-progress';

const box = (over: Partial<BoxProgressRow> = {}): BoxProgressRow => ({
  shipmentId: 's1',
  carrierCode: 'hct',
  hctStatus: 'draft',
  hctDispatchAttemptedAt: null,
  hctDispatchedAt: null,
  shippedAt: null,
  voidedAt: null,
  createdAt: '2026-09-27T05:00:00Z',
  ...over,
});

describe('boxProgress — 一箱現在走到哪', () => {
  it.each([
    ['作廢蓋過一切(作廢的箱也可能有 shipped_at)', box({ voidedAt: 'x', shippedAt: 'y' }), 'voided'],
    ['已標出貨', box({ shippedAt: 'x', hctStatus: 'submitted' }), 'shipped'],
    ['🔴 叫過車而沒確認叫到(Sean 09-27 撞到的那一種)', box({ hctStatus: 'submitted', hctDispatchAttemptedAt: 'x' }), 'dispatch_uncertain'],
    ['叫到車而還沒標出貨', box({ hctStatus: 'submitted', hctDispatchAttemptedAt: 'x', hctDispatchedAt: 'y' }), 'dispatched'],
    ['拿到託運單號、還沒叫車', box({ hctStatus: 'submitted' }), 'ready_to_dispatch'],
    ['要號結果未確認', box({ hctStatus: 'unknown' }), 'number_uncertain'],
    ['新竹還沒要號', box({ hctStatus: 'draft' }), 'needs_number'],
    ['新竹要號被拒', box({ hctStatus: 'failed' }), 'needs_number'],
    ['非新竹的箱:填單號就能出', box({ carrierCode: 'sf', hctStatus: 'draft' }), 'needs_tracking'],
  ] as const)('%s', (_name, row, want) => {
    expect(boxProgress(row)).toBe(want);
  });

  it('🔴 兩頁的字面各不相同(對調任兩個都會被上面那族抓到)', () => {
    const labels = Object.values(BOX_PROGRESS_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('pendingBox — 一張單有好幾箱時, 下一步看哪一箱', () => {
  it('作廢與已出貨的箱不算', () => {
    expect(pendingBox([box({ voidedAt: 'x' }), box({ shippedAt: 'x' })])).toBeNull();
    expect(pendingBox([])).toBeNull();
  });

  it('🔴 需要人去確認的排最前:叫車結果不確定 > 叫到車沒標 > 要號結果不確定 > 可叫車 > 要號 > 填單號', () => {
    const rows = [
      box({ shipmentId: 'tracking', carrierCode: 'sf' }),
      box({ shipmentId: 'number', hctStatus: 'draft' }),
      box({ shipmentId: 'ready', hctStatus: 'submitted' }),
      box({ shipmentId: 'q', hctStatus: 'unknown' }),
      box({ shipmentId: 'dispatched', hctStatus: 'submitted', hctDispatchAttemptedAt: 'x', hctDispatchedAt: 'y' }),
      box({ shipmentId: 'uncertain', hctStatus: 'submitted', hctDispatchAttemptedAt: 'x' }),
    ];
    const order = ['uncertain', 'dispatched', 'q', 'ready', 'number', 'tracking'];
    for (let i = 0; i < order.length; i++) {
      const left = rows.filter((r) => !order.slice(0, i).includes(r.shipmentId));
      expect(pendingBox(left)?.shipmentId, `少了前 ${i} 箱之後`).toBe(order[i]);
    }
  });
});
