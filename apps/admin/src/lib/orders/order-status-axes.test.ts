import { describe, expect, it } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import {
  ORDER_STATUS_LABEL,
  orderGoodsAxis,
  orderPayAxis,
  orderStatusView,
  type OrderGoodsAxis,
  type OrderPayAxis,
} from './order-status-axes';

// L1 驗收:狀態八值 = 收款軸 × 貨品軸(需求檔 §0-H;Sean 拍 Q22=A/Q23=A/Q24=A/Q27=B/Q28=A)。
//
// 🔴 本組**不驗畫面** —— 本片零消費端。驗的是:①八格字面逐字對 ②兩軸的判定與判序
// ③配色由**貨品軸**決定、收款只加標記 ④`未收出貨` 的實心例外 ⑤已取消不在矩陣裡。

/**
 * 品項 fixture。
 *
 * 🔴 四個數量軸**由參數各自給**、不互相推導:寫死或互相推導會讓「兩軸接錯線」全綠
 * (L0 那次我就是把 `shipped` 設成等於 `instock`,結果 mapper 抄錯軸也不會紅)。
 */
function line(
  quantity: number,
  axes: { ordered?: number; instock?: number; shipped?: number; cancelled?: number } = {},
): AdminOrderLine {
  const ordered = axes.ordered ?? 0;
  const instock = axes.instock ?? 0;
  const shipped = axes.shipped ?? 0;
  const cancelled = axes.cancelled ?? 0;
  return {
    id: `l-${quantity}-${ordered}-${instock}-${shipped}`,
    variantSku: 'SKU-001',
    title: '排氣管',
    brand: 'Akrapovic',
    quantity,
    unitPrice: { amount: toMoneyAmount(12000), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(12000 * quantity), currency: 'TWD' },
    workflowStatus: null,
    version: 1,
    vehicle: null,
    quantitySummary: {
      quantity,
      orderedQuantity: ordered,
      instockQuantity: instock,
      shippedQuantity: shipped,
      cancelledQuantity: cancelled,
      cancellableQuantity: quantity - instock - cancelled,
    },
  };
}

function order(over: {
  lines: AdminOrderLine[];
  paymentStatus?: AdminOrderSummary['paymentStatus'];
  cancelledAt?: AdminOrderSummary['cancelledAt'];
}): AdminOrderSummary {
  return {
    id: 'ord-1',
    displayId: 'PCM-0001',
    createdAt: '2026-08-13T02:00:00.000Z',
    paymentStatus: over.paymentStatus ?? 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    total: { amount: toMoneyAmount(12000), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName: '王小明',
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    cancelledAt: over.cancelledAt ?? null,
    displayPosition: null,
    lines: over.lines,
  };
}

/** 買 2 件、走到指定階段的單品項單(階段之間**單調遞增**,符合 shipped ⊆ instock ⊆ ordered)。 */
const AT_STAGE: Record<OrderGoodsAxis, AdminOrderLine> = {
  none: line(2),
  ordered: line(2, { ordered: 2 }),
  instock: line(2, { ordered: 2, instock: 2 }),
  shipped: line(2, { ordered: 2, instock: 2, shipped: 2 }),
};

describe('L1 — 八格字面逐字對 Sean 的試算表原詞', () => {
  // 🔴 逐格寫死中文,**不從函式回推** —— 從函式回推的話,函式把字打錯這組照樣全綠。
  it.each([
    ['unpaid', 'none', '未收未定'],
    ['unpaid', 'ordered', '未收已定'],
    ['unpaid', 'instock', '未收現貨'],
    ['unpaid', 'shipped', '未收出貨'],
    ['paid', 'none', '已收未定'],
    ['paid', 'ordered', '已收已定'],
    ['paid', 'instock', '現貨在庫'],
    ['paid', 'shipped', '出貨完成'],
  ] as const)('%s × %s → 「%s」', (pay, goods, label) => {
    expect(ORDER_STATUS_LABEL[pay][goods]).toBe(label);
  });

  it('🔴 Q23=A:`未收出貨` 與 `出貨完成` 必須是**兩個不同的詞**(前者是風險狀態,要被看見)', () => {
    expect(ORDER_STATUS_LABEL.unpaid.shipped).not.toBe(ORDER_STATUS_LABEL.paid.shipped);
  });

  it('🔴 八個字面兩兩相異(任兩格撞字 = 員工分不出兩種處置)', () => {
    const all = [
      ...Object.values(ORDER_STATUS_LABEL.unpaid),
      ...Object.values(ORDER_STATUS_LABEL.paid),
    ];
    expect(new Set(all).size, `八格出現重複字面:${all.join(' / ')}`).toBe(8);
  });
});

describe('L1 — 貨品軸判定', () => {
  it.each([
    ['none', 'none'],
    ['ordered', 'ordered'],
    ['instock', 'instock'],
    ['shipped', 'shipped'],
  ] as const)('單品項走到 %s → 判為 %s', (stage, expected) => {
    expect(orderGoodsAxis(order({ lines: [AT_STAGE[stage]] }))).toBe(expected);
  });

  it('🔴🔴 判序不可倒:已出貨的單三個條件同時成立,必須答 `shipped` 而不是 `instock`', () => {
    // 這格就是 L0 之前那個病的靶:`shipped ⊆ instock` ⇒ 已出貨的單 `instock >= quantity` 恆成立,
    // 判序若倒過來寫,`未收出貨` 會顯示成 `未收現貨` —— **名字是反的**。
    const shipped = order({ lines: [line(2, { ordered: 2, instock: 2, shipped: 2 })] });
    expect(orderGoodsAxis(shipped)).toBe('shipped');
    expect(orderStatusView(shipped).label).toBe('出貨完成');
  });

  it('🔴 訂單層 = **所有品項都到齊**才進下一階段(差一件就退回前一階段)', () => {
    // 品項 A 全出貨、品項 B 只訂了沒到 ⇒ 整單只能算「已定」…不對,B 訂滿了但 A 也訂滿 ⇒ ordered。
    const mixed = order({
      lines: [line(2, { ordered: 2, instock: 2, shipped: 2 }), line(3, { ordered: 3 })],
    });
    expect(orderGoodsAxis(mixed), 'A 出貨了但 B 只訂了 ⇒ 整單不得算出貨/在庫').toBe('ordered');
  });

  it('🔴 差一件就不算到齊(邊界:instock 1/2)', () => {
    expect(orderGoodsAxis(order({ lines: [line(2, { ordered: 2, instock: 1 })] }))).toBe('ordered');
  });

  it('🔴 空 `lines` → `none`,**不是 `shipped`**(`[].every()` 恆真的陷阱)', () => {
    expect(orderGoodsAxis(order({ lines: [] }))).toBe('none');
  });
});

describe('L1 — 收款軸(含照 OD 字面實作的已知落差)', () => {
  it.each([
    ['paid', 'paid'],
    ['unpaid', 'unpaid'],
    ['partiallyPaid', 'unpaid'],
    ['partiallyRefunded', 'unpaid'],
  ] as const)('paymentStatus=%s → 收款軸 %s', (status, axis) => {
    expect(orderPayAxis(order({ lines: [AT_STAGE.none], paymentStatus: status }))).toBe(axis);
  });

  it('🔴 誠實邊界釘死:`refunded` 落在 **unpaid** 軸並吃到紅框 —— 這是已知落差,不是 bug', () => {
    // 🔴 主視窗要求「測試裡有一格專門釘它落在哪一軸」——**註解會被讀漏,測試不會**。
    //    紅框的語意是「去催客人付錢」,對一張已退款的單是噪音。要改得先推翻「照 OD 字面」那條裁決。
    const refunded = order({ lines: [AT_STAGE.none], paymentStatus: 'refunded' });
    expect(orderPayAxis(refunded)).toBe('unpaid');
    expect(orderStatusView(refunded).label).toBe('未收未定');
    expect(orderStatusView(refunded).capsuleClass).toContain('shadow-[');
  });
});

describe('L1 — 配色:貨品軸決定色、收款只加標記(Q27=B)', () => {
  const toneOf = (pay: OrderPayAxis, goods: OrderGoodsAxis) =>
    orderStatusView(
      order({ lines: [AT_STAGE[goods]], paymentStatus: pay === 'paid' ? 'paid' : 'unpaid' }),
    ).capsuleClass;

  it.each([
    ['none', 'bg-muted'],
    ['ordered', 'bg-amber-100'],
    ['instock', 'bg-sky-100'],
    ['shipped', 'bg-emerald-100'],
  ] as const)('已收 × %s → 底色 %s(四階段四個色相)', (goods, tone) => {
    expect(toneOf('paid', goods)).toContain(tone);
  });

  it('🔴 同一個貨品階段:未收與已收**底色相同**,差別只在紅框(這就是 Q27=B 的意思)', () => {
    const paid = toneOf('paid', 'instock');
    const unpaid = toneOf('unpaid', 'instock');
    expect(unpaid, '未收沒有紅框 ⇒ 風險看不出來').toContain('shadow-[');
    expect(paid, '已收不該有紅框').not.toContain('shadow-[');
    // 去掉紅框之後兩者應完全相同 ⇒ 證明顏色**不是**由收款軸決定的
    expect(unpaid.replace(/\s*shadow-\[[^\]]*\]/, '')).toBe(paid);
  });

  it('🔴🔴 Q28=A 唯一例外:`未收出貨` 是**實心深紅**,不是「淡綠 + 紅框」', () => {
    const risk = orderStatusView(
      order({ lines: [AT_STAGE.shipped], paymentStatus: 'unpaid' }),
    );
    expect(risk.label).toBe('未收出貨');
    expect(risk.capsuleClass, '例外格被「修正」成綠色了').not.toContain('bg-emerald-100');
    expect(risk.capsuleClass, '實心深紅底不見了').toContain('bg-[oklch(0.52_0.20_25)]');
    // 🔴 冗餘訊號:白字 + 粗體是**獨立於色相**的兩個訊號(色盲 / 黑白列印仍跳得出來)
    expect(risk.capsuleClass).toContain('text-white');
    expect(risk.capsuleClass).toContain('font-bold');
    // 🔴 不再疊紅框(紅上加紅看不出來)—— 這條擋「順手把 mark 也套上去」
    expect(risk.capsuleClass, '實心深紅上再套紅框 = 紅上加紅').not.toContain('shadow-[');
  });

  it('🔴 正向對照:`出貨完成`(已收)走一般綠,不吃例外那套', () => {
    const done = orderStatusView(order({ lines: [AT_STAGE.shipped], paymentStatus: 'paid' }));
    expect(done.label).toBe('出貨完成');
    expect(done.capsuleClass).toContain('bg-emerald-100');
    expect(done.capsuleClass).not.toContain('font-bold');
  });
});

describe('L1 — 已取消不在 2×4 矩陣裡', () => {
  it('🔴 已取消 → 字面「已取消」、兩軸為 null、`cancelled` 為 true', () => {
    const cancelled = orderStatusView(
      order({ lines: [AT_STAGE.instock], cancelledAt: '2026-08-13T09:00:00.000Z' }),
    );
    expect(cancelled.label).toBe('已取消');
    expect(cancelled.payAxis).toBeNull();
    expect(cancelled.goodsAxis).toBeNull();
    expect(cancelled.cancelled).toBe(true);
  });

  it('🔴 已取消的灰**不得與「未定」的灰長得一樣**(灰不能同時代表兩件事)', () => {
    const cancelled = orderStatusView(
      order({ lines: [AT_STAGE.none], cancelledAt: '2026-08-13T09:00:00.000Z' }),
    );
    const none = orderStatusView(order({ lines: [AT_STAGE.none] }));
    expect(cancelled.capsuleClass).not.toBe(none.capsuleClass);
    expect(cancelled.capsuleClass, '已取消要靠虛線外框分開').toContain('border-dashed');
  });

  it('🔴 未取消的單**不得**帶已取消樣式(上一格的負向對照)', () => {
    expect(orderStatusView(order({ lines: [AT_STAGE.none] })).cancelled).toBe(false);
    expect(orderStatusView(order({ lines: [AT_STAGE.none] })).capsuleClass).not.toContain(
      'border-dashed',
    );
  });
});

describe('L1 — 收款軸第三值的擴充性(Q22=A:預留、這輪不畫)', () => {
  it('🔴 加一個收款軸不需要動 `GOODS_TONE` —— 由「顏色只看貨品軸」在結構上保證', () => {
    // 🔴 這格不是在測未來的 code,是在測**現在的形狀**:
    //    同一個貨品階段下,兩個收款軸的 class 去掉標記之後**完全相同**
    //    ⇒ 顏色與收款軸零耦合 ⇒ 第三值回來時只需在 `ORDER_STATUS_LABEL` / `PAY_MARK` 各補一列。
    //    若哪天有人把顏色改成「看收款軸」,這格會紅,而那正是 Q27=B 被推翻的訊號。
    const strip = (c: string) => c.replace(/\s*shadow-\[[^\]]*\]/, '');
    for (const goods of ['none', 'ordered', 'instock'] as const) {
      const paid = orderStatusView(order({ lines: [AT_STAGE[goods]], paymentStatus: 'paid' }));
      const unpaid = orderStatusView(order({ lines: [AT_STAGE[goods]], paymentStatus: 'unpaid' }));
      expect(strip(unpaid.capsuleClass), `${goods} 的顏色被收款軸影響了`).toBe(
        strip(paid.capsuleClass),
      );
    }
    // ⚠️ `shipped` 不在上面的迴圈裡 —— 它有 Q28=A 的實心例外,**本來就該不同**。
    //    把它放進去會讓這格必紅,而那是規格不是 bug(邊界寫出來,不要讓下一個人以為是漏測)。
  });
});
