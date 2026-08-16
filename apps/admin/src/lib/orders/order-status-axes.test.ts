import { describe, expect, it } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_REFUNDED_LABEL,
  orderDetailGoodsAxis,
  orderGoodsAxis,
  orderPayAxis,
  orderStatusView,
  type OrderGoodsAxis,
  type OrderPayAxis,
} from './order-status-axes';
import { FULFILLMENT_STATUS_LABEL, GOODS_AXIS_LABEL } from './order-list-view';

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

  // 🔴🔴 **`#494`:本格原本釘的是相反的行為,那條裁定已被知情推翻 —— 這不是遷就紅燈。**
  //    - 2026-08-13 主視窗裁「照 OD 字面做」⇒ 原斷言 `orderStatusView(refunded).label === '未收未定'`
  //      + 吃紅框(`shadow-[`);當時就寫明「紅框的語意是去催客人付錢,對已退款的單是噪音」。
  //    - 2026-08-14 **Sean 拍 `Q-494-1`=A 確認推翻**(他肉眼撞到:點「未收未定」的單要取消,
  //      被擋且訊息說它「已付款」)⇒ 新規則:已退款單獨成一態,不進 2×4 矩陣。
  //    保留一格釘新行為的理由與原本一模一樣:**註解會被讀漏,測試不會。**
  it('🔴 `#494` 推翻後:`refunded` 由 `orderStatusView` 走**矩陣外**的「已退款」,不再是「未收未定」', () => {
    const refunded = order({ lines: [AT_STAGE.none], paymentStatus: 'refunded' });
    const view = orderStatusView(refunded);
    expect(view.label).toBe(ORDER_STATUS_REFUNDED_LABEL);
    expect(view.payAxis).toBeNull(); // 矩陣外 ⇒ 兩軸都不適用
    expect(view.goodsAxis).toBeNull();
    expect(view.cancelled).toBe(false); // 退款不是取消:別把兩件事壓成同一個布林
    // 🔴 反向釘死:舊字面與「去催款」的紅框都不得再出現在這條路上
    expect(view.label).not.toBe('未收未定');
    expect(view.capsuleClass).not.toContain('shadow-[');
  });

  // 🔴 本格與上一格**不重複**:上一格量的是 `orderStatusView`(使用者真的看到的那顆膠囊),
  //    這一格量的是 `orderPayAxis` 這支函式本身**刻意沒改** —— 它在 `refunded` 上仍回 `unpaid`,
  //    而那個回傳值**不是這張單的狀態**(`refunded` 從 `orderStatusView` 就早退了、走不到它)。
  //    寫下來是為了下一個人單獨呼叫它時不會以為那是真相。
  it('`orderPayAxis` 本身未改:單獨呼叫仍把 `refunded` 判成 `unpaid`(它不是狀態的單一來源)', () => {
    expect(orderPayAxis(order({ lines: [AT_STAGE.none], paymentStatus: 'refunded' }))).toBe('unpaid');
  });

  // 🔴 驗收 6:`partiallyRefunded` **不**走矩陣外那條 —— 它還有錢沒結、還有事要做。
  //    ⚠️ 正式庫零筆,本格是**規格斷言**、不是實例驗證(誠實缺口)。
  it('🔴 `partiallyRefunded` 維持在矩陣內的未收側(與 `refunded` 不是同一件事)', () => {
    const view = orderStatusView(order({ lines: [AT_STAGE.none], paymentStatus: 'partiallyRefunded' }));
    expect(view.label).toBe('未收未定');
    expect(view.payAxis).toBe('unpaid');
    expect(view.label).not.toBe(ORDER_STATUS_REFUNDED_LABEL);
  });

  // 🔴 本格釘的是**現況、不是拍板**(codex 關卡2 F1):取消的早退分支在 `#494` 之前就存在,
  //    本片只在它後面插一條 ⇒ 這個交集的顯示結果沒被本片改動。要不要改成合併字面是待決項。
  it('既取消又退款 ⇒ 顯示「已取消」,不是「已退款」(沿用既有順序,本片未改)', () => {
    const view = orderStatusView(
      order({ lines: [AT_STAGE.none], paymentStatus: 'refunded', cancelledAt: '2026-08-14T00:00:00+00:00' }),
    );
    expect(view.cancelled).toBe(true);
    expect(view.label).not.toBe(ORDER_STATUS_REFUNDED_LABEL);
  });
});

describe('L1 — 配色:貨品軸決定色、收款只加標記(Q27=B)', () => {
  const toneOf = (pay: OrderPayAxis, goods: OrderGoodsAxis) =>
    orderStatusView(
      order({ lines: [AT_STAGE[goods]], paymentStatus: pay === 'paid' ? 'paid' : 'unpaid' }),
    ).capsuleClass;

  /* 🔴🔴 **期望值於 2026-08-16 由 Tailwind 調色盤改成 BMW M 的 `.cap-*`。**
     Sean 當日逐字:「狀態膠囊配色 —— 對,換成新的配色方式(BMW)」。
     ⚠️ **這是【這一次】的授權,不是通則** —— 常載守則 §R4「想動驗證本身 = 立即停止訊號」仍然有效。
        本片是**先停下請示、拿到拍板才改**的(`~/pcm-mailbox/A-214-STOP.md`),**下次遇到一樣要停。**
     🔴 **這裡釘的只是「掛對 class」;真正在守「顏色有沒有壞掉」的是**
        `app/design-tokens.test.ts` 那組**實算對比**的格(四顆膠囊兌淡後的底與字逐一算,不達標就紅)。
     📎 換配色的理由是**語言一致**,不是現在不合規 —— 舊那四顆實算 4.63 / 4.51 / 5.17 / 4.84,**全達標**。 */
  it.each([
    ['none', 'cap-n'],
    ['ordered', 'cap-y'],
    ['instock', 'cap-bl'],
    ['shipped', 'cap-g'],
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
    expect(risk.capsuleClass, '例外格被「修正」成綠色了').not.toContain('cap-g');
    // 🔴 2026-08-16:底色由硬寫的 `bg-[oklch(0.52_0.20_25)]` 改吃 `--destructive`(OD :27 的 M 紅)。
    //    舊值是**不吃任何 token 的字面** ⇒ 改主色時它不會跟著動。白字對 #e4002b 實算 4.85 ✅
    //    (那個數字由 `design-tokens.test.ts` 的「實心紅那顆的白字達標」那格重算)。
    expect(risk.capsuleClass, '實心紅底不見了').toContain('bg-destructive');
    // 🔴 冗餘訊號:白字 + 粗體是**獨立於色相**的兩個訊號(色盲 / 黑白列印仍跳得出來)
    expect(risk.capsuleClass).toContain('text-white');
    expect(risk.capsuleClass).toContain('font-bold');
    // 🔴 不再疊紅框(紅上加紅看不出來)—— 這條擋「順手把 mark 也套上去」
    expect(risk.capsuleClass, '實心深紅上再套紅框 = 紅上加紅').not.toContain('shadow-[');
  });

  it('🔴 正向對照:`出貨完成`(已收)走一般綠,不吃例外那套', () => {
    const done = orderStatusView(order({ lines: [AT_STAGE.shipped], paymentStatus: 'paid' }));
    expect(done.label).toBe('出貨完成');
    expect(done.capsuleClass).toContain('cap-g');
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

// ─────────────────────────────────────────────────────────────────────────────
// `#514` — 明細頁的「出貨狀態」改讀真相(原本讀 `orders.fulfillment_status`)
// ─────────────────────────────────────────────────────────────────────────────
describe('`#514` 明細頁貨品軸', () => {
  /** 明細側品項:`quantitySummary` 是 `| null`(A4a trigger 惰性建列),與列表側刻意不同型。 */
  const item = (
    quantity: number,
    axes: { ordered?: number; instock?: number; shipped?: number } | null,
  ) => ({
    quantity,
    quantitySummary:
      axes === null
        ? null
        : {
            orderedQuantity: axes.ordered ?? 0,
            instockQuantity: axes.instock ?? 0,
            shippedQuantity: axes.shipped ?? 0,
            cancelledQuantity: 0,
            cancellableQuantity: 0,
          },
  });

  /**
   * 🔴🔴 **這一格是 `#514` 的核心證據,而它存在的理由是「修對了會看起來像沒改」。**
   *
   * 正式庫多數單還沒採購 ⇒ 改讀真相之後**畫面上多數單仍顯示「未訂貨」**
   * ⇒ **Sean 打開來看到一樣的字,會以為沒生效。**
   * ⇒ 所以要一張**有採購紀錄**的單:stale 欄位說 `notOrdered`(那是它唯一會說的話),
   *   而真相是 `ordered`。**兩者不同,才證明它真的換了資料來源**,
   *   而不是「換了個地方讀到同一個假值」。
   */
  it('🔴 有採購紀錄的單:stale 欄位說「未訂貨」,而真相是「已向廠商訂貨」', () => {
    const detail = {
      // 那一欄在正式庫 13/13 全是這個值(DEFAULT,零 writer)—— 這裡逐字重現它。
      fulfillmentStatus: 'notOrdered' as const,
      items: [item(2, { ordered: 2 }), item(1, { ordered: 1 })],
    };
    expect(orderDetailGoodsAxis(detail)).toBe('ordered');
    // 🔴 對照組:舊來源不論真相是什麼都只會回這個值 ⇒ 兩者不同 = 換來源生效了。
    expect(FULFILLMENT_STATUS_LABEL[detail.fulfillmentStatus]).toBe('未訂貨');
    expect(GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)]).toBe('已向廠商訂貨');
  });

  // 🔴 null 是**語意正確**不是 fallback:摘要列由 trigger 惰性建立,沒被採購過就沒有那一列。
  it('🔴 `quantitySummary` 全 null ⇒ 未訂貨(那是它的正確語意,不是找不到)', () => {
    expect(orderDetailGoodsAxis({ items: [item(1, null), item(3, null)] })).toBe('none');
  });

  // ⚠️ 差一件就退回前一階段(訂單層定義 = 該單所有品項都到齊)。
  it('混合:一件有摘要一件 null ⇒ 退回未訂貨', () => {
    expect(orderDetailGoodsAxis({ items: [item(1, { ordered: 1 }), item(1, null)] })).toBe('none');
  });

  it('判序不可倒:全出貨的單回 shipped(三個條件同時成立時先問最遠的)', () => {
    expect(
      orderDetailGoodsAxis({ items: [item(2, { ordered: 2, instock: 2, shipped: 2 })] }),
    ).toBe('shipped');
  });

  // ⚠️ 空 `items` 回 none 不是 shipped(`[].every()` 恆真)。
  it('空品項 ⇒ 未訂貨(不是出貨完成)', () => {
    expect(orderDetailGoodsAxis({ items: [] })).toBe('none');
  });
});
