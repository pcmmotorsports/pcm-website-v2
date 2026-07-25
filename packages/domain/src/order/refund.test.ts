/**
 * RF1 退款引擎窮舉測試(對應 plan **v6** §4 矩陣)。
 *
 * 🔴 金額權威片:每組都斷言**具體數字**、不只斷言 ok/!ok;rejection 逐 kind 分別斷言。
 */
import { describe, it, expect } from 'vitest';
import { computeRefundQuote, type RefundQuoteInput } from './refund';
import {
  calculateShippingFee,
  FREE_SHIPPING_THRESHOLD,
  HOME_SHIPPING_FEE,
  type ShippingRule,
} from './shipping';
import { toMoneyAmount, type Money } from '../shared/types';

function twd(n: number): Money {
  return { amount: toMoneyAmount(n), currency: 'TWD' };
}
function rule(freeThreshold: number, homeFee: number): ShippingRule {
  return { freeThreshold: toMoneyAmount(freeThreshold), homeFee: toMoneyAmount(homeFee) };
}
/**
 * 現行規則 {5000, 100}。
 * 🔴 v6:`DEFAULT_SHIPPING_RULE` 已改模組私有(codex 關卡2 R2、防 RF5 fallback)
 *   → 測試自建等值規則,並由兩個常數衍生(不寫死數字、免與常數漂移)。
 */
const R = rule(FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE);

/** 便利建構:home 宅配、折扣 0、subtotal 自品項推算(避免測試自身寫錯 subtotal 觸發 mismatch) */
function input(over: {
  items: Array<[id: string, price: number, qty: number]>;
  refund: Array<[id: string, qty: number]>;
  fee: number;
  method?: 'home' | 'store';
  shippingRule?: ShippingRule;
  subtotal?: number;
  discount?: number;
}): RefundQuoteInput {
  const remainingItems = over.items.map(([orderItemId, price, qty]) => ({
    orderItemId,
    unitPrice: twd(price),
    remainingQuantity: qty,
  }));
  const derived = over.items.reduce((a, [, price, qty]) => a + price * qty, 0);
  return {
    shippingMethod: over.method ?? 'home',
    shippingRule: over.shippingRule ?? R,
    currentShippingFee: twd(over.fee),
    currentSubtotal: twd(over.subtotal ?? derived),
    currentDiscountTotal: twd(over.discount ?? 0),
    remainingItems,
    refundItems: over.refund.map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
  };
}

function ok(r: ReturnType<typeof computeRefundQuote>) {
  if (!r.ok) throw new Error(`expected ok, got rejection: ${r.kind}`);
  return r.quote;
}
function kindOf(r: ReturnType<typeof computeRefundQuote>) {
  return r.ok ? '(ok)' : r.kind;
}
/** 守恆:refundAmount + newTotal === currentTotal(discount 恆 0) */
function assertConserved(inp: RefundQuoteInput, q: ReturnType<typeof ok>) {
  const currentTotal =
    inp.currentSubtotal.amount + inp.currentShippingFee.amount - inp.currentDiscountTotal.amount;
  expect(q.refundAmount.amount + q.newTotal.amount).toBe(currentTotal);
}

describe('computeRefundQuote — Sean 拍板情境(D1=B 公式 + 邊界①②)', () => {
  // 矩陣 1:Sean 原始範例 2500+3000=5500 免運,退 3000 → 實退 2900、保留 100 補運費
  it('1: 2500+3000 免運單退 3000 → refund 2900 / newFee 100 / charge 100', () => {
    const inp = input({ items: [['A', 2500, 1], ['B', 3000, 1]], refund: [['B', 1]], fee: 0 });
    const q = ok(computeRefundQuote(inp));
    expect(q.refundAmount.amount).toBe(2900);
    expect(q.refundedItemsAmount.amount).toBe(3000);
    expect(q.newShippingFee.amount).toBe(100);
    expect(q.previousShippingFee.amount).toBe(0);
    expect(q.shippingAdjustment).toEqual({ direction: 'charge', amount: twd(100) });
    expect(q.newSubtotal.amount).toBe(2500);
    expect(q.newTotal.amount).toBe(2600);
    expect(q.fullRefund).toBe(false);
    assertConserved(inp, q);
  });

  // 矩陣 2:續退剩餘 2500(基準=當下餘額)→ 全退、運費回退、兩輪合計 = 原付 5500
  it('2: 續退剩餘 2500 → fullRefund / newFee 0 / refund 2600 / 兩輪合計 5500', () => {
    const inp = input({ items: [['A', 2500, 1]], refund: [['A', 1]], fee: 100 });
    const q = ok(computeRefundQuote(inp));
    expect(q.fullRefund).toBe(true);
    expect(q.newShippingFee.amount).toBe(0);
    expect(q.shippingAdjustment).toEqual({ direction: 'refund', amount: twd(100) });
    expect(q.refundAmount.amount).toBe(2600);
    expect(q.newTotal.amount).toBe(0);
    expect(2900 + 2600).toBe(5500);
    assertConserved(inp, q);
  });

  // 矩陣 3:原收運費單(3000+100),退 1000 → 再退 2000;合計 3100 = 原付
  it('3: 原收運費單分兩輪退 → 1000(none) 然後 2100(refund 100)、合計 3100', () => {
    const inp1 = input({ items: [['A', 1000, 1], ['B', 2000, 1]], refund: [['A', 1]], fee: 100 });
    const q1 = ok(computeRefundQuote(inp1));
    expect(q1.refundAmount.amount).toBe(1000);
    expect(q1.newShippingFee.amount).toBe(100);
    expect(q1.shippingAdjustment.direction).toBe('none');
    assertConserved(inp1, q1);

    const inp2 = input({ items: [['B', 2000, 1]], refund: [['B', 1]], fee: 100 });
    const q2 = ok(computeRefundQuote(inp2));
    expect(q2.fullRefund).toBe(true);
    expect(q2.refundAmount.amount).toBe(2100);
    expect(q2.newShippingFee.amount).toBe(0);
    assertConserved(inp2, q2);

    expect(q1.refundAmount.amount + q2.refundAmount.amount).toBe(3100);
  });

  // 矩陣 4:一輪全退(免運單)
  it('4: 一輪全退免運單 → refund 5500 / newFee 0 / fullRefund', () => {
    const inp = input({
      items: [['A', 2500, 1], ['B', 3000, 1]],
      refund: [['A', 1], ['B', 1]],
      fee: 0,
    });
    const q = ok(computeRefundQuote(inp));
    expect(q.fullRefund).toBe(true);
    expect(q.refundAmount.amount).toBe(5500);
    expect(q.newShippingFee.amount).toBe(0);
    expect(q.newSubtotal.amount).toBe(0);
    expect(q.newTotal.amount).toBe(0);
    assertConserved(inp, q);
  });

  // 矩陣 5:門檻邊界 —— 退後恰 5000 → 免運;4999 → 收 100
  it('5: 門檻邊界 newSubtotal 5000 → fee 0;4999 → fee 100', () => {
    const at = ok(computeRefundQuote(input({
      items: [['A', 5000, 1], ['B', 1000, 1]], refund: [['B', 1]], fee: 0,
    })));
    expect(at.newSubtotal.amount).toBe(5000);
    expect(at.newShippingFee.amount).toBe(0);
    expect(at.refundAmount.amount).toBe(1000);

    const below = ok(computeRefundQuote(input({
      items: [['A', 4999, 1], ['B', 1000, 1]], refund: [['B', 1]], fee: 0,
    })));
    expect(below.newSubtotal.amount).toBe(4999);
    expect(below.newShippingFee.amount).toBe(100);
    expect(below.refundAmount.amount).toBe(900);
  });

  // 矩陣 6:退款額恰為 0 → 拒
  it('6: 5050 退 100 品項使剩 4950 → 退款額 0 → non_positive_refund', () => {
    const r = computeRefundQuote(input({
      items: [['A', 4950, 1], ['B', 100, 1]], refund: [['B', 1]], fee: 0,
    }));
    expect(kindOf(r)).toBe('non_positive_refund');
  });

  // 矩陣 7:退款額為負 → 拒
  it('7: 退 50 品項跨門檻 → 退款額 −50 → non_positive_refund', () => {
    const r = computeRefundQuote(input({
      items: [['A', 4980, 1], ['B', 50, 1]], refund: [['B', 1]], fee: 0,
    }));
    expect(kindOf(r)).toBe('non_positive_refund');
  });

  // 矩陣 8:store 自取恆 0、無重算
  it('8: store 自取任意退 → fee 恆 0 / adjustment none / refund = 品項額', () => {
    const q = ok(computeRefundQuote(input({
      items: [['A', 100, 1], ['B', 200, 1]], refund: [['B', 1]], fee: 0, method: 'store',
    })));
    expect(q.newShippingFee.amount).toBe(0);
    expect(q.shippingAdjustment.direction).toBe('none');
    expect(q.refundAmount.amount).toBe(200);
  });

  // 矩陣 9:Q3=B 部分數量退
  it('9: 量 3×1000 只退 1 → refund 1000 / remainingQuantityAfter 2 / 非全退', () => {
    const inp = input({ items: [['A', 1000, 3]], refund: [['A', 1]], fee: 100 });
    const q = ok(computeRefundQuote(inp));
    expect(q.refundAmount.amount).toBe(1000);
    expect(q.refundedLines).toHaveLength(1);
    expect(q.refundedLines[0]).toMatchObject({
      orderItemId: 'A', quantity: 1, remainingQuantityAfter: 2,
    });
    expect(q.refundedLines[0]!.lineAmount.amount).toBe(1000);
    expect(q.fullRefund).toBe(false);
    expect(q.newSubtotal.amount).toBe(2000);
    assertConserved(inp, q);
  });

  it('9b: 量 3 全退 3 → fullRefund、運費回退', () => {
    const q = ok(computeRefundQuote(input({ items: [['A', 1000, 3]], refund: [['A', 3]], fee: 100 })));
    expect(q.fullRefund).toBe(true);
    expect(q.newShippingFee.amount).toBe(0);
    expect(q.refundAmount.amount).toBe(3100);
  });
});

describe('computeRefundQuote — 輸入守門(逐 kind 分別斷言)', () => {
  // 矩陣 10
  it('10: 退量>剩餘 / 未知品項 / 空陣列 / refund 重複 id / remaining 重複 id', () => {
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 2]], refund: [['A', 3]], fee: 100,
    })))).toBe('quantity_exceeds_remaining');

    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 1]], refund: [['ZZ', 1]], fee: 100,
    })))).toBe('unknown_item');

    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 1]], refund: [], fee: 100,
    })))).toBe('empty_refund');

    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 5]], refund: [['A', 1], ['A', 1]], fee: 100,
    })))).toBe('duplicate_refund_item');

    const dupRemaining: RefundQuoteInput = {
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 100 }),
      remainingItems: [
        { orderItemId: 'A', unitPrice: twd(100), remainingQuantity: 1 },
        { orderItemId: 'A', unitPrice: twd(100), remainingQuantity: 1 },
      ],
    };
    expect(kindOf(computeRefundQuote(dupRemaining))).toBe('duplicate_remaining_item');
  });

  // 矩陣 10b:🔴 rejection 優先序 —— 空陣列 vs 量 0 各回各的 kind(codex R2-F3 契約矛盾修正)
  it('10b: 非空但 quantity 0 → invalid_quantity(不是 empty_refund)', () => {
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 1]], refund: [['A', 0]], fee: 100,
    })))).toBe('invalid_quantity');
  });

  it('10b: remainingQuantity 0 → invalid_quantity', () => {
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 0]], refund: [['A', 1]], fee: 100,
    })))).toBe('invalid_quantity');
  });

  // 矩陣 11
  it('11: discount>0 → discount_unsupported;subtotal 與品項和不符 → subtotal_mismatch', () => {
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 1000, 1]], refund: [['A', 1]], fee: 100, discount: 50,
    })))).toBe('discount_unsupported');

    expect(kindOf(computeRefundQuote(input({
      items: [['A', 1000, 1]], refund: [['A', 1]], fee: 100, subtotal: 999,
    })))).toBe('subtotal_mismatch');
  });

  // 矩陣 12:逐 kind 分別斷言
  it('12: 非整數/負金額 → invalid_amount', () => {
    const nonInt: RefundQuoteInput = {
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
      currentSubtotal: { amount: 100.5 as unknown as Money['amount'], currency: 'TWD' },
    };
    expect(kindOf(computeRefundQuote(nonInt))).toBe('invalid_amount');

    const neg: RefundQuoteInput = {
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
      currentShippingFee: { amount: -1 as unknown as Money['amount'], currency: 'TWD' },
    };
    expect(kindOf(computeRefundQuote(neg))).toBe('invalid_amount');
  });

  it('12: 幣別混用 → currency_mismatch', () => {
    const mixed: RefundQuoteInput = {
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
      currentShippingFee: { amount: toMoneyAmount(0), currency: 'USD' as 'TWD' },
    };
    expect(kindOf(computeRefundQuote(mixed))).toBe('currency_mismatch');

    const mixedItem: RefundQuoteInput = {
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
      remainingItems: [
        { orderItemId: 'A', unitPrice: { amount: toMoneyAmount(100), currency: 'USD' as 'TWD' }, remainingQuantity: 1 },
      ],
    };
    expect(kindOf(computeRefundQuote(mixedItem))).toBe('currency_mismatch');
  });

  it('12: 數量非整數/負 → invalid_quantity', () => {
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 1]], refund: [['A', 1.5]], fee: 0,
    })))).toBe('invalid_quantity');
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 100, 1]], refund: [['A', -1]], fee: 0,
    })))).toBe('invalid_quantity');
  });

  it('12: shippingMethod 非白名單 → invalid_shipping_method(引擎不讓下游 throw 逸出)', () => {
    for (const m of ['', 'pickup', 'HOME']) {
      const bad: RefundQuoteInput = {
        ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
        shippingMethod: m as unknown as RefundQuoteInput['shippingMethod'],
      };
      expect(kindOf(computeRefundQuote(bad))).toBe('invalid_shipping_method');
    }
  });

  // 矩陣 13:🔴 零元品項殘留(codex R1-F2)
  it('13: 留 NT$0 品項而退光付費品項 → zero_value_remainder_unsupported', () => {
    const r = computeRefundQuote(input({
      items: [['FREE', 0, 1], ['PAID', 3000, 1]], refund: [['PAID', 1]], fee: 0,
    }));
    expect(kindOf(r)).toBe('zero_value_remainder_unsupported');
  });

  it('13: 連 NT$0 品項一起全退 → fullRefund 正常', () => {
    const q = ok(computeRefundQuote(input({
      items: [['FREE', 0, 1], ['PAID', 3000, 1]], refund: [['FREE', 1], ['PAID', 1]], fee: 100,
    })));
    expect(q.fullRefund).toBe(true);
    expect(q.newShippingFee.amount).toBe(0);
    expect(q.refundAmount.amount).toBe(3100);
  });

  // 矩陣 14:🔴 溢位守門(codex R1-F5)
  it('14: 單價達 DB int 上限 / 乘積溢位 / 超安全整數 / rule 超上限 → amount_overflow', () => {
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 2147483647, 2]], refund: [['A', 1]], fee: 0,
    })))).toBe('amount_overflow');

    const overSubtotal: RefundQuoteInput = {
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
      currentSubtotal: { amount: 2147483648 as unknown as Money['amount'], currency: 'TWD' },
    };
    expect(kindOf(computeRefundQuote(overSubtotal))).toBe('amount_overflow');

    const unsafe: RefundQuoteInput = {
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
      currentSubtotal: { amount: (Number.MAX_SAFE_INTEGER + 1) as unknown as Money['amount'], currency: 'TWD' },
    };
    expect(kindOf(computeRefundQuote(unsafe))).toBe('invalid_amount');
  });

  // 🔴 14b:突變測試 M5 抓到的缺口補強。
  //   上面三個案例其實**全部走 `badAmount`(訂單層級金額守門)**、沒有一個走到 `badComputed`
  //   (中間運算結果守門)→ 拿掉 badComputed 的整個函式體,測試仍全綠 = 假綠。
  //   以下三組是 `badComputed` 真正可達的路徑,逐一釘住。
  it('14b: 單一 line(unitPrice × qty)溢位 → amount_overflow(非 subtotal_mismatch)', () => {
    // subtotal 顯式給合法值以通過 badAmount → 才會進迴圈算 line = 2e9 × 2 = 4e9 > DB int max
    const r = computeRefundQuote(input({
      items: [['A', 2000000000, 2]], refund: [['A', 1]], fee: 0, subtotal: 100,
    }));
    expect(kindOf(r)).toBe('amount_overflow');
  });

  it('14b: refundAmount(退品項額 + 回退運費)溢位 → amount_overflow', () => {
    // 全退 → newFee 0、direction refund、amount = currentShippingFee
    // refundAmountRaw = 2147483647 + 2147483647 = 4294967294 > DB int max
    const r = computeRefundQuote(input({
      items: [['A', 2147483647, 1]], refund: [['A', 1]], fee: 2147483647,
    }));
    expect(kindOf(r)).toBe('amount_overflow');
  });

  it('14b: newTotal(新小計 + 新運費)溢位 → amount_overflow', () => {
    // 舊運費 == 新運費(direction none)→ 退款額 = 500 > 0、繞過 non_positive 閘;
    // 但 newTotal = newSubtotal 2147483000 + newFee 2147483647 = 4294966647 > DB int max
    const r = computeRefundQuote(input({
      items: [['A', 2147483000, 1], ['B', 500, 1]],
      refund: [['B', 1]],
      fee: 2147483647,
      shippingRule: rule(2147483647, 2147483647),
    }));
    expect(kindOf(r)).toBe('amount_overflow');
  });

  // 🔴 14b-4:code-reviewer MF1 —— 第三個可達的 badComputed 位點(remainingSum 累加)。
  //   逐筆 line 各自合法(2e9 < 2147483647)、累加到 4e9 才溢位;若無此案,
  //   拿掉 remainingSum 的守門仍全綠 = 與 M5 同一種假綠。
  it('14b: 逐筆 line 合法但 Σ remainingSum 溢位 → amount_overflow', () => {
    const r = computeRefundQuote(input({
      items: [['A', 2000000000, 1], ['B', 2000000000, 1]], refund: [['A', 1]], fee: 0, subtotal: 100,
    }));
    expect(kindOf(r)).toBe('amount_overflow');
  });

  // 🔴 N1:數量超 DB int 上限(檔內其餘數量僅 0/±1/1.5/2/3/4 → 該分支原本零覆蓋)
  it('14b: 數量超 DB integer 上限 → invalid_quantity', () => {
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 1, 2147483648]], refund: [['A', 1]], fee: 0, subtotal: 1,
    })))).toBe('invalid_quantity');
    expect(kindOf(computeRefundQuote(input({
      items: [['A', 1, 1]], refund: [['A', 2147483648]], fee: 0,
    })))).toBe('invalid_quantity');
  });

  // 誠實揭示(v2 修正、原文讀起來像「除那兩處外都有覆蓋」):
  //   `badComputed` 共四個呼叫點,其中 **remainingItems 迴圈內的 line 與 remainingSum 兩處已由
  //   14b 覆蓋**;`refundItems` 迴圈內的 `lineAmount` 與 `refundedItemsAmount` 累加**兩處不可達**
  //   (refund qty ≤ remaining qty ⇒ refund line ≤ remaining line、累加總和 ≤ remainingSum,
  //   兩者都已在前一迴圈被擋)。後兩處保留為 defense-in-depth,不假裝有測試覆蓋。
  //   另 `newTotal` 的 `− currentDiscountTotal` 為死項(非 0 折扣已先被 discount_unsupported 拒)。

  // 🔴 14d:病態輸入零 throw(codex 關卡2 must-fix ——「逐欄防禦追不完」的機制底線)
  it('14d: null/undefined input、throwing getter、Proxy trap、巢狀 Money=null → invalid_field、零 throw', () => {
    const base = input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 });
    const throwingGetter = {
      ...base,
      get currentSubtotal(): Money {
        throw new Error('boom');
      },
    };
    const throwingProxy = new Proxy(base, {
      get(t, k) {
        if (k === 'remainingItems') throw new Error('proxy boom');
        return t[k as keyof RefundQuoteInput];
      },
    });
    const nestedNull = { ...base, currentSubtotal: null };
    const arrayIterTrap = {
      ...base,
      remainingItems: new Proxy([] as unknown[], {
        get(t, k) {
          if (k === Symbol.iterator) throw new Error('iter boom');
          return t[k as keyof typeof t];
        },
      }),
    };

    for (const bad of [null, undefined, 42, 'str', throwingGetter, throwingProxy, nestedNull, arrayIterTrap]) {
      expect(() => computeRefundQuote(bad as unknown as RefundQuoteInput)).not.toThrow();
      expect(kindOf(computeRefundQuote(bad as unknown as RefundQuoteInput))).toBe('invalid_field');
    }
  });

  // 🔴 14e:幣別必須是 TWD(codex 關卡2 must-fix:全 USD 原本會通過並產出 USD quote)
  it('14e: 所有 Money 一致為 USD → currency_mismatch(非「彼此相等就放行」)', () => {
    const usd = (n: number) => ({ amount: toMoneyAmount(n), currency: 'USD' as 'TWD' });
    const allUsd: RefundQuoteInput = {
      shippingMethod: 'home',
      shippingRule: R,
      currentShippingFee: usd(0),
      currentSubtotal: usd(3000),
      currentDiscountTotal: usd(0),
      remainingItems: [{ orderItemId: 'A', unitPrice: usd(3000), remainingQuantity: 1 }],
      refundItems: [{ orderItemId: 'A', quantity: 1 }],
    };
    expect(kindOf(computeRefundQuote(allUsd))).toBe('currency_mismatch');
  });

  // 🔴 14f:orderItemId 型別驗(codex 關卡2 must-fix:Symbol 原本可產出含 Symbol 的 quote)
  it('14f: orderItemId 為 Symbol / null / 空字串、item 為 null → invalid_field', () => {
    const sym = Symbol('A') as unknown as string;
    const base = input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 });
    const cases: Array<Partial<RefundQuoteInput>> = [
      {
        remainingItems: [{ orderItemId: sym, unitPrice: twd(100), remainingQuantity: 1 }],
        refundItems: [{ orderItemId: sym, quantity: 1 }],
      },
      { remainingItems: [null as unknown as RefundQuoteInput['remainingItems'][number]] },
      {
        remainingItems: [{ orderItemId: '', unitPrice: twd(100), remainingQuantity: 1 }],
        refundItems: [{ orderItemId: '', quantity: 1 }],
      },
      { refundItems: [null as unknown as RefundQuoteInput['refundItems'][number]] },
      {
        remainingItems: [{ orderItemId: 'A', unitPrice: null as unknown as Money, remainingQuantity: 1 }],
      },
    ];
    for (const patch of cases) {
      const bad = { ...base, ...patch } as RefundQuoteInput;
      expect(() => computeRefundQuote(bad)).not.toThrow();
      expect(kindOf(computeRefundQuote(bad))).toBe('invalid_field');
    }
  });

  // 🔴 14f-2:突變 M14 抓到的遮蔽 —— 上一組把壞 id 同時放兩個陣列,
  //   於是「移除 remainingItems 的字串守門」仍被 refundItems 的守門擋住 = 假綠。
  //   本組把壞 id **只放 remainingItems**、refundItems 全合法,隔離出該道守門。
  it('14f-2: 壞 orderItemId 只在 remainingItems(refundItems 全合法)→ 仍須 invalid_field', () => {
    const base = input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 });
    const cases: Array<RefundQuoteInput['remainingItems']> = [
      [
        { orderItemId: 'A', unitPrice: twd(100), remainingQuantity: 1 },
        { orderItemId: 123 as unknown as string, unitPrice: twd(50), remainingQuantity: 1 },
      ],
      [
        { orderItemId: 'A', unitPrice: twd(100), remainingQuantity: 1 },
        { orderItemId: Symbol('B') as unknown as string, unitPrice: twd(50), remainingQuantity: 1 },
      ],
      [
        { orderItemId: 'A', unitPrice: twd(100), remainingQuantity: 1 },
        { orderItemId: '', unitPrice: twd(50), remainingQuantity: 1 },
      ],
    ];
    for (const remainingItems of cases) {
      const bad = { ...base, remainingItems, currentSubtotal: twd(150) } as RefundQuoteInput;
      expect(() => computeRefundQuote(bad)).not.toThrow();
      expect(kindOf(computeRefundQuote(bad))).toBe('invalid_field');
    }
  });

  // 🔴 14h(codex 關卡2 R3 must-fix、v2 重新設計):`remainingItems[].unitPrice` 金額守門的**真隔離**測試。
  //   ⚠️ 第一版設計失敗(突變 M20 仍全綠):負單價會被下游 `newSubtotal < 0` 守門攔下、
  //   **且回同一個 `invalid_amount`** → 測試分不出是哪道守門在work。本版改用「壞單價在**未被退**的
  //   品項上、且 subtotal 對得起來」,使移除守門後結果**明顯不同**(變成成功回 quote / 變成別的 kind)。
  it('14h: 未退品項的 unitPrice 為負 → invalid_amount(移除守門會誤放行成功)', () => {
    const bad: RefundQuoteInput = {
      ...input({ items: [['A', 1000, 1]], refund: [['A', 1]], fee: 0 }),
      currentSubtotal: twd(2900),
      remainingItems: [
        { orderItemId: 'A', unitPrice: twd(1000), remainingQuantity: 1 },
        { orderItemId: 'B', unitPrice: twd(2000), remainingQuantity: 1 },
        // 🔴 負單價、且不在 refundItems 內;1000 + 2000 − 100 = 2900 = subtotal(對帳過關)
        { orderItemId: 'C', unitPrice: { amount: -100 as unknown as Money['amount'], currency: 'TWD' }, remainingQuantity: 1 },
      ],
    };
    // 若移除 unitPrice 守門 → newSubtotal 1900、newFee 100、refundAmount 900 → **成功回 quote**
    expect(kindOf(computeRefundQuote(bad))).toBe('invalid_amount');
  });

  it('14h: 非整數單價但 subtotal 為整數 → invalid_amount(移除守門會變 amount_overflow)', () => {
    const bad: RefundQuoteInput = {
      ...input({ items: [['A', 1000, 1]], refund: [['A', 1]], fee: 0 }),
      currentSubtotal: twd(2000),
      remainingItems: [
        { orderItemId: 'A', unitPrice: { amount: 1000.5 as unknown as Money['amount'], currency: 'TWD' }, remainingQuantity: 1 },
        { orderItemId: 'B', unitPrice: { amount: 999.5 as unknown as Money['amount'], currency: 'TWD' }, remainingQuantity: 1 },
      ],
    };
    // 兩個非整數單價之和恰為整數 2000 → 訂單層級 badAmount 過關、唯一防線是品項層 unitPrice 守門;
    // 移除後會落到 badComputed 回 `amount_overflow`(kind 不同 → 測試轉紅)
    expect(kindOf(computeRefundQuote(bad))).toBe('invalid_amount');
  });

  // ⚠️ 誠實揭示:「未退品項單價超 DB 上限」**無法隔離**——移除 unitPrice 守門後會落到
  //   `badComputed(line)` 並回**同一個** `amount_overflow`,兩道守門對該情境等效。不假裝有隔離覆蓋。

  // 🔴 14f-3(codex 關卡2 R2 must-fix):**refundItems 端**的 orderItemId 守門隔離測試。
  //   14f 把壞 id 同放兩個陣列 → 移除 request 端守門仍被 remaining 端擋住 = 假綠(與 M14 同型)。
  //   本組讓 remainingItems 全合法、壞 id 只出現在 refundItems。
  it('14f-3: 壞 orderItemId 只在 refundItems(remainingItems 全合法)→ 仍須 invalid_field', () => {
    const base = input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 });
    const bads: Array<RefundQuoteInput['refundItems']> = [
      [{ orderItemId: Symbol('A') as unknown as string, quantity: 1 }],
      [{ orderItemId: '' as string, quantity: 1 }],
      [{ orderItemId: 123 as unknown as string, quantity: 1 }],
    ];
    for (const refundItems of bads) {
      const bad = { ...base, refundItems } as RefundQuoteInput;
      expect(() => computeRefundQuote(bad)).not.toThrow();
      expect(kindOf(computeRefundQuote(bad))).toBe('invalid_field');
    }
  });

  // 🔴 14g(codex 關卡2 R2 must-fix):`currentDiscountTotal` 兩道守門的獨立驗證。
  //   ①刪掉它的 currency 比對 → discount 為 USD 但 subtotal 為 TWD 會成功產出 quote(原測試全綠)
  //   ②略過它的 amount 驗證 → 非整數 discount 會錯回 discount_unsupported 而非 invalid_amount
  it('14g: discount 幣別與 subtotal 不一致 → currency_mismatch(非 discount_unsupported)', () => {
    const bad: RefundQuoteInput = {
      ...input({ items: [['A', 3000, 1]], refund: [['A', 1]], fee: 0 }),
      currentDiscountTotal: { amount: toMoneyAmount(0), currency: 'USD' as 'TWD' },
    };
    expect(kindOf(computeRefundQuote(bad))).toBe('currency_mismatch');
  });

  it('14g: discount 為非整數 → invalid_amount(非 discount_unsupported)', () => {
    const bad: RefundQuoteInput = {
      ...input({ items: [['A', 3000, 1]], refund: [['A', 1]], fee: 0 }),
      currentDiscountTotal: { amount: 0.5 as unknown as Money['amount'], currency: 'TWD' },
    };
    expect(kindOf(computeRefundQuote(bad))).toBe('invalid_amount');
  });

  // 🔴 N3:陣列型別守門 —— 「對外零 throw」必須連結構性壞值都成立
  it('14c: remainingItems / refundItems 非陣列 → invalid_field、零 throw', () => {
    for (const patch of [
      { remainingItems: null },
      { refundItems: undefined },
      { remainingItems: 'nope' },
      { refundItems: { length: 1 } },
    ]) {
      const bad = {
        ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
        ...patch,
      } as unknown as RefundQuoteInput;
      expect(() => computeRefundQuote(bad)).not.toThrow();
      expect(kindOf(computeRefundQuote(bad))).toBe('invalid_field');
    }
  });

  // 矩陣 18:凍結規則守門
  it('18: rule 欄負數 / 非整數 / 缺欄 → invalid_shipping_rule、零 throw', () => {
    const mk = (r: unknown): RefundQuoteInput => ({
      ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }),
      shippingRule: r as ShippingRule,
    });
    expect(kindOf(computeRefundQuote(mk({ freeThreshold: -1, homeFee: 100 })))).toBe('invalid_shipping_rule');
    expect(kindOf(computeRefundQuote(mk({ freeThreshold: 5000.5, homeFee: 100 })))).toBe('invalid_shipping_rule');
    expect(kindOf(computeRefundQuote(mk({ freeThreshold: 5000 })))).toBe('invalid_shipping_rule');
    expect(kindOf(computeRefundQuote(mk({ freeThreshold: 2147483648, homeFee: 100 })))).toBe('invalid_shipping_rule');
    expect(kindOf(computeRefundQuote(mk(undefined)))).toBe('invalid_shipping_rule');
  });

  // 矩陣 16:對外零 throw
  it('16: 所有壞輸入一律回 {ok:false}、絕不 throw', () => {
    const bads: unknown[] = [
      { ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }), shippingMethod: 'nope' },
      { ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }), shippingRule: null },
      { ...input({ items: [['A', 100, 1]], refund: [['A', 1]], fee: 0 }), currentSubtotal: { amount: -5, currency: 'TWD' } },
      input({ items: [['A', 100, 1]], refund: [], fee: 0 }),
      input({ items: [['A', 100, 1]], refund: [['A', 0]], fee: 0 }),
      input({ items: [['A', 0, 1], ['B', 100, 1]], refund: [['B', 1]], fee: 0 }),
    ];
    for (const b of bads) {
      expect(() => computeRefundQuote(b as RefundQuoteInput)).not.toThrow();
      expect(computeRefundQuote(b as RefundQuoteInput).ok).toBe(false);
    }
  });
});

describe('computeRefundQuote — Q6=B 凍結運費規則(規則取自輸入、非模組常數)', () => {
  // 矩陣 17:🔴 期望值經 codex R2-F2 修正(v3 原寫 {3000,60}→0/3000 是算錯)
  it('17: 同情境三組規則各算出不同運費 → 證門檻與費率都取自輸入', () => {
    const mk = (r: ShippingRule) => input({
      items: [['A', 2500, 1], ['B', 3000, 1]], refund: [['B', 1]], fee: 0, shippingRule: r,
    });

    const cur = ok(computeRefundQuote(mk(rule(5000, 100))));
    expect(cur.newShippingFee.amount).toBe(100);
    expect(cur.refundAmount.amount).toBe(2900);

    // 2500 < 3000 → 仍未達免運 → 收該規則的 60(不是 0)
    const mid = ok(computeRefundQuote(mk(rule(3000, 60))));
    expect(mid.newShippingFee.amount).toBe(60);
    expect(mid.refundAmount.amount).toBe(2940);

    // 2500 >= 2000 → 免運 → 全額退品項
    const low = ok(computeRefundQuote(mk(rule(2000, 60))));
    expect(low.newShippingFee.amount).toBe(0);
    expect(low.refundAmount.amount).toBe(3000);
  });

  // 🔴 N5:非全退但 direction='refund' —— 只在 legacy / drift 資料下可達,
  //   現行行為 = 第一輪就把多收的運費全退、守恆仍成立。釘住免日後被當 bug 改掉。
  it('17c: 非全退 + 舊運費高於重算值 → direction refund、守恆成立', () => {
    const inp = input({
      items: [['A', 6000, 1], ['B', 1000, 1]], refund: [['B', 1]], fee: 100,
    });
    const q = ok(computeRefundQuote(inp));
    expect(q.fullRefund).toBe(false);
    // 退後剩 6000 >= 5000 → 新運費 0;舊運費 100 → 回退給客人
    expect(q.newShippingFee.amount).toBe(0);
    expect(q.shippingAdjustment).toEqual({ direction: 'refund', amount: twd(100) });
    expect(q.refundAmount.amount).toBe(1100);
    assertConserved(inp, q);
  });

  it('17b: 全退時無論規則為何,運費一律歸 0(邊界②)', () => {
    for (const r of [rule(5000, 100), rule(3000, 60), rule(0, 999)]) {
      const q = ok(computeRefundQuote(input({
        items: [['A', 1000, 1]], refund: [['A', 1]], fee: 100, shippingRule: r,
      })));
      expect(q.fullRefund).toBe(true);
      expect(q.newShippingFee.amount).toBe(0);
    }
  });
});

describe('calculateShippingFee 選填 rule 參數 — 行為零變更(矩陣 19)', () => {
  const cases: Array<[number, 'home' | 'store']> = [
    [0, 'home'], [1, 'home'], [4999, 'home'], [5000, 'home'], [5001, 'home'], [999999, 'home'],
    [0, 'store'], [4999, 'store'], [5000, 'store'], [999999, 'store'],
  ];

  it('19-①: 兩參呼叫 vs 三參傳 DEFAULT_SHIPPING_RULE → 逐組輸出全等', () => {
    for (const [n, m] of cases) {
      expect(calculateShippingFee(twd(n), m)).toEqual(calculateShippingFee(twd(n), m, R));
    }
  });

  // 🔴 19-② 是真正擋得住「DEFAULT 寫錯」的那道(19-① 兩參本就 delegate 到 DEFAULT = 同源假綠)
  it('19-②: 固定期望值表(寫死數字、不由常數推導)', () => {
    expect(calculateShippingFee(twd(4999), 'home').amount).toBe(100);
    expect(calculateShippingFee(twd(5000), 'home').amount).toBe(0);
    expect(calculateShippingFee(twd(5001), 'home').amount).toBe(0);
    expect(calculateShippingFee(twd(0), 'home').amount).toBe(100);
    expect(calculateShippingFee(twd(0), 'store').amount).toBe(0);
    expect(calculateShippingFee(twd(999999), 'store').amount).toBe(0);
  });

  it('19: 自訂 rule 路徑生效、且不影響預設路徑', () => {
    expect(calculateShippingFee(twd(2500), 'home', rule(2000, 60)).amount).toBe(0);
    expect(calculateShippingFee(twd(2500), 'home', rule(3000, 60)).amount).toBe(60);
    expect(calculateShippingFee(twd(2500), 'home').amount).toBe(100);
  });

  // 🔴 19-④(v6 改寫、codex 關卡2 R2 must-fix):`DEFAULT_SHIPPING_RULE` 已改**模組私有不 export**
  //   → 無法(也不該)直接斷言該物件被凍結。改以「公開行為」釘住預設值:三參傳等值規則
  //   與兩參呼叫必須逐組全等,且對照寫死期望值表(19-②)。凍結本身已無外部參照可改寫。
  it('19-④: 三參傳「由常數衍生的等值規則」與兩參呼叫全等(預設值無獨立漂移空間)', () => {
    for (const n of [0, 4999, 5000, 5001]) {
      for (const m of ['home', 'store'] as const) {
        expect(calculateShippingFee(twd(n), m, rule(FREE_SHIPPING_THRESHOLD, HOME_SHIPPING_FEE)))
          .toEqual(calculateShippingFee(twd(n), m));
      }
    }
  });

  it('19: 壞 method 仍 throw(既有 fail-closed 行為未被選填參數改變)', () => {
    expect(() => calculateShippingFee(twd(100), 'pickup' as 'home')).toThrow();
    expect(() => calculateShippingFee(twd(100), 'pickup' as 'home', R)).toThrow();
  });
});

describe('computeRefundQuote — 路徑無關性(codex 關卡2 nit:同張單不同拆法總額須相同)', () => {
  it('15b: 同一張單 A→B / B→A / 一次全退 / 分組不同 → 累積退款皆等於原付', () => {
    // 2500 + 3000 = 5500 免運
    const items: Array<[string, number, number]> = [['A', 2500, 1], ['B', 3000, 1]];
    const originalPaid = 5500;

    // 拆法 1:先退 A 再退 B
    const a1 = ok(computeRefundQuote(input({ items, refund: [['A', 1]], fee: 0 })));
    const a2 = ok(computeRefundQuote(input({ items: [['B', 3000, 1]], refund: [['B', 1]], fee: a1.newShippingFee.amount })));
    expect(a1.refundAmount.amount + a2.refundAmount.amount).toBe(originalPaid);

    // 拆法 2:先退 B 再退 A(順序顛倒)
    const b1 = ok(computeRefundQuote(input({ items, refund: [['B', 1]], fee: 0 })));
    const b2 = ok(computeRefundQuote(input({ items: [['A', 2500, 1]], refund: [['A', 1]], fee: b1.newShippingFee.amount })));
    expect(b1.refundAmount.amount + b2.refundAmount.amount).toBe(originalPaid);

    // 拆法 3:一次全退
    const c = ok(computeRefundQuote(input({ items, refund: [['A', 1], ['B', 1]], fee: 0 })));
    expect(c.refundAmount.amount).toBe(originalPaid);

    // 三種拆法總額一致(路徑無關)
    expect(new Set([a1.refundAmount.amount + a2.refundAmount.amount, b1.refundAmount.amount + b2.refundAmount.amount, c.refundAmount.amount]).size).toBe(1);
  });

  it('15c: 部分數量退的不同分組(1+1+1 vs 2+1 vs 3)總額一致', () => {
    const items: Array<[string, number, number]> = [['A', 1000, 3]];
    const originalPaid = 3000 + 100; // 3000 < 5000 → 收運費 100

    // 3 次各退 1
    let fee = 100;
    let sum = 0;
    for (let left = 3; left > 0; left--) {
      const q = ok(computeRefundQuote(input({ items: [['A', 1000, left]], refund: [['A', 1]], fee })));
      sum += q.refundAmount.amount;
      fee = q.newShippingFee.amount;
    }
    expect(sum).toBe(originalPaid);

    // 2 + 1
    const t1 = ok(computeRefundQuote(input({ items, refund: [['A', 2]], fee: 100 })));
    const t2 = ok(computeRefundQuote(input({ items: [['A', 1000, 1]], refund: [['A', 1]], fee: t1.newShippingFee.amount })));
    expect(t1.refundAmount.amount + t2.refundAmount.amount).toBe(originalPaid);

    // 一次 3
    const one = ok(computeRefundQuote(input({ items, refund: [['A', 3]], fee: 100 })));
    expect(one.refundAmount.amount).toBe(originalPaid);
  });
});

describe('computeRefundQuote — 守恆不變量(矩陣 15)', () => {
  it('15: 多組情境多輪部分退到清空,Σrefund + 殘值 = 原付', () => {
    const scenarios: Array<{ items: Array<[string, number, number]>; fee: number; method: 'home' | 'store' }> = [
      { items: [['A', 2500, 1], ['B', 3000, 1]], fee: 0, method: 'home' },
      { items: [['A', 1000, 3], ['B', 2000, 1]], fee: 0, method: 'home' },
      { items: [['A', 800, 1], ['B', 700, 2]], fee: 100, method: 'home' },
      { items: [['A', 300, 4]], fee: 0, method: 'store' },
      { items: [['A', 6000, 1], ['B', 100, 1]], fee: 0, method: 'home' },
    ];

    for (const sc of scenarios) {
      let remaining = sc.items.map(([id, price, qty]) => ({ id, price, qty }));
      let fee = sc.fee;
      const originalPaid = sc.items.reduce((a, [, p, q]) => a + p * q, 0) + sc.fee;
      let refundTotal = 0;
      let guard = 0;
      let partialRounds = 0;

      while (remaining.length > 0 && guard++ < 50) {
        const head = remaining[0]!;
        const inp = input({
          items: remaining.map((r) => [r.id, r.price, r.qty] as [string, number, number]),
          refund: [[head.id, 1]],
          fee,
          method: sc.method,
        });
        const res = computeRefundQuote(inp);
        if (!res.ok) {
          // 退不動(退款額 ≤ 0 或零元殘留)→ 改整單退,仍須守恆
          const all = input({
            items: remaining.map((r) => [r.id, r.price, r.qty] as [string, number, number]),
            refund: remaining.map((r) => [r.id, r.qty] as [string, number]),
            fee,
            method: sc.method,
          });
          const q = ok(computeRefundQuote(all));
          assertConserved(all, q);
          refundTotal += q.refundAmount.amount;
          expect(q.newTotal.amount).toBe(0);
          remaining = [];
          fee = 0;
          break;
        }
        assertConserved(inp, res.quote);
        partialRounds++;
        refundTotal += res.quote.refundAmount.amount;
        fee = res.quote.newShippingFee.amount;
        remaining = remaining
          .map((r) => (r.id === head.id ? { ...r, qty: r.qty - 1 } : r))
          .filter((r) => r.qty > 0);
      }

      // 🔴 N7:證明迴圈真的跑過部分退、且沒撞到 guard 上限
      //   (否則「全部被拒 → 直接走整單退」也會讓下面的守恆斷言綠 = 假綠)
      expect(partialRounds).toBeGreaterThan(0);
      expect(guard).toBeLessThan(50);
      // 全部退完 → 客人拿回的總額 = 當初付的總額
      expect(refundTotal).toBe(originalPaid);
    }
  });
});
