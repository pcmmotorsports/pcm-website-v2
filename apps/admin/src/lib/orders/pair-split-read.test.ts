import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loadPairNotes, type PairVariantClient } from './pair-split-read';

// 讀取端:只有訂單裡真的有一對款才查;查不到或出錯 ⇒ 保守句, 不擋頁面。

const PAIR_ITEM = { variantSku: 'ILM-VF.007-PAIR-G', spec: { material: '碳纖', finish: '亮面', position: '左右一對' } };
const NORMAL_ITEM = { variantSku: 'RPM-1', spec: { weave: 'Twill' } };

function client(tables: { bySku?: unknown[]; byProduct?: unknown[]; error?: boolean }) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    let step = '';
    const q = {
      select: () => q,
      in: (col: string) => {
        step = col;
        calls.push(`${table}.in.${col}`);
        return q;
      },
      then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
        res(
          tables.error
            ? { data: null, error: { message: 'boom' } }
            : { data: step === 'sku' ? (tables.bySku ?? []) : (tables.byProduct ?? []), error: null },
        ),
    };
    return q;
  });
  return { c: { from } as unknown as PairVariantClient, from, calls };
}

describe('loadPairNotes', () => {
  it('沒有一對款 ⇒ 一次都不查, 回空物件', async () => {
    const { c, from } = client({});
    expect(await loadPairNotes(c, [NORMAL_ITEM])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('🔴 找得到左右 ⇒ 那個 sku 對到「左 A、右 B」;一般款不出現', async () => {
    const { c, calls } = client({
      bySku: [{ sku: PAIR_ITEM.variantSku, product_id: 'p1' }],
      byProduct: [
        { product_id: 'p1', sku: 'L1', spec: { material: '碳纖', finish: '亮面', position: '左' } },
        { product_id: 'p1', sku: 'R1', spec: { material: '碳纖', finish: '亮面', position: '右' } },
        { product_id: 'p1', sku: PAIR_ITEM.variantSku, spec: PAIR_ITEM.spec },
      ],
    });
    expect(await loadPairNotes(c, [PAIR_ITEM, NORMAL_ITEM])).toEqual({
      [PAIR_ITEM.variantSku]: '一對：出貨時請拆成左、右各一件（左 L1、右 R1）',
    });
    expect(calls).toEqual(['product_variants.in.sku', 'product_variants.in.product_id']);
  });

  it('🔴 下單後合卡或改群、查不到那個 sku ⇒ 保守句', async () => {
    const { c } = client({ bySku: [] });
    expect(await loadPairNotes(c, [PAIR_ITEM])).toEqual({
      [PAIR_ITEM.variantSku]: '一對：出貨時請拆成左、右各一件（料號請到報價單確認）',
    });
  });

  it('🔴 同一個 sku 對到兩個商品(不同供應商撞號)⇒ 保守句, 不猜是哪一個', async () => {
    const { c } = client({
      bySku: [
        { sku: PAIR_ITEM.variantSku, product_id: 'p1' },
        { sku: PAIR_ITEM.variantSku, product_id: 'p2' },
      ],
    });
    expect((await loadPairNotes(c, [PAIR_ITEM]))[PAIR_ITEM.variantSku]).toContain('料號請到報價單確認');
  });

  it('🔴 讀取出錯 ⇒ 保守句, 不丟例外(不擋出貨頁面)', async () => {
    const { c } = client({ error: true });
    expect(await loadPairNotes(c, [PAIR_ITEM])).toEqual({
      [PAIR_ITEM.variantSku]: '一對：出貨時請拆成左、右各一件（料號請到報價單確認）',
    });
  });
});
