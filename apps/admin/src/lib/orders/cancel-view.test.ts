import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AdminOrderLine } from '@pcm/domain';
import {
  PAYMENT_EXPIRED_CANCEL_REASON,
  buildOrderCancelView,
  type CancelViewOrder,
} from './cancel-view';

// ── 投影守門(主視窗 `E-005-A` §6-5「要擋」)────────────────────────────────
// 🔴 列表投影的品項(`AdminOrderLine`,`mappers/order.ts:335` 走 `mapListQuantitySummary`、**缺列補 0**)
//    餵進本函式會讓 `quantity_summary_missing` 這道 fail-closed 靜默失效。
//    `CancelViewOrder['items'][number]` 要求 `procurementTruncated`,而 `AdminOrderLine` 沒有
//    ⇒ 下面這行**必須**是型別錯誤。
// 🔴 **這條由 `tsc` 守、不是 vitest**:判別欄一旦從 Pick 裡被拿掉,賦值就合法了
//    ⇒ `@ts-expect-error` 變成「未使用的指令」⇒ TS2578 ⇒ `turbo typecheck` 轉紅。
//    突變自驗要跑 `tsc --noEmit` 才看得到(vitest 不做型別檢查,只跑它會誤判成 SURVIVED)。
// ⚠️ 寫法刻意是**純型別層**:第一版用 `declare const` + `@ts-expect-error` 賦值,
//    但 `declare` 在執行期被抹掉 ⇒ 該識別字 undefined ⇒ 整個測試檔載入即爆(實測 "no tests")。
//    下面這個條件型別零執行期依賴:現在 `AdminOrderLine` **不可**指派給品項入口 ⇒ 型別是 `true`;
//    判別欄一被拿掉就變成可指派 ⇒ 型別塌成 `never` ⇒ `= true` 賦值錯誤 ⇒ tsc 轉紅。
const _listLineMustNotBeAccepted: AdminOrderLine extends CancelViewOrder['items'][number]
  ? never
  : true = true;
void _listLineMustNotBeAccepted;

const ITEM_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const ITEM_B = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';

/**
 * 一筆採購列。`ZERO_INFERENCE` 只讀 `procurements.length`,所以內容無關 ——
 * 造一顆完整的 `AdminOrderItemProcurement` 只會讓 fixture 變重而不增加判別力。
 * (刻意用 cast 並在此說明,不是偷懶:這個 fixture 的角色就是「陣列非空」。)
 */
const A_PROCUREMENT_ROW = {} as CancelViewOrder['items'][number]['procurements'][number];

/**
 * 🔴 **健康基準的每個值都被刻意選過**(memory `feedback_fixture-value-makes-guard-vacuous`):
 * - `instockQuantity: 0` —— 非 0 會讓 `fullCancelAllowed` 恆假,「有到貨就關掉整單取消」那條就構造不出負測。
 * - `cancelledQuantity: 0` 且 `< quantity` —— 相等會讓 `nothing_cancellable` 恆真、蓋掉其他拒因。
 * - `cancellableQuantity: 5 > 0` —— 0 會讓可取消判定恆假。
 * - 🔴 `orderedQuantity: 4 ≠ quantity`(R1 T1)—— 兩者同值時,把 `toItemView` 的 `quantity` 讀成
 *   `orderedQuantity` 的突變會全套恆綠。4 在 C4/C5 不變式下仍合法(ordered 可小於 quantity)。
 */
function summary(
  over: Partial<{
    quantity: number;
    orderedQuantity: number;
    instockQuantity: number;
    // L0(2026-08-13):第四軸。覆寫型別要跟著 domain 型別走,否則測試想構造
    // 「出貨了但可取消量沒被重複扣」這種情境時,覆寫參數會被 tsc 擋下來。
    shippedQuantity: number;
    cancelledQuantity: number;
    cancellableQuantity: number;
  }> = {},
) {
  return {
    quantity: 5,
    orderedQuantity: 4,
    instockQuantity: 0,
    shippedQuantity: 0,
    cancelledQuantity: 0,
    cancellableQuantity: 5,
    ...over,
  };
}

/**
 * 一列取消歷程。預設 `itemsTruncated: false` —— 設 true 會讓 Σci 少算(fail-open),由專屬測試釘。
 *
 * 🔴 明細 id 全域遞增、不每列從 `c0` 重編(關卡2 codex nit):重編會讓「兩列不同 header」用到
 *    DB 主鍵不可能重複的 id,而那正好是「同一列被重複投影」這個情境的形狀 —— 用重複 id 當
 *    正常 fixture,等於把一個異常形狀寫進基準。
 */
let cancellationRowSeq = 0;
function cancellation(
  rows: { orderItemId: string; cancelledQuantity: number }[] | null,
  itemsTruncated = false,
) {
  return {
    items:
      rows === null
        ? null
        : rows.map((r) => ({ id: `c${(cancellationRowSeq += 1)}`, ...r })),
    itemsTruncated,
  };
}

function order(over: Partial<CancelViewOrder> = {}): CancelViewOrder {
  return {
    paymentStatus: 'unpaid',
    cancelledAt: null,
    cancelledReason: null,
    chargeAttemptGate: 'clear',
    itemsTruncated: false,
    cancellationsTruncated: false,
    items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() }],
    // 🔴 `[]` 不是 `null`:`null` 會讓 cancellations_unreadable 恆真、把其餘拒因全蓋掉。
    cancellations: [],
    ...over,
  };
}

describe('投影退版:缺鍵(undefined)要與 null 同向 fail-closed', () => {
  it('🔴 quantitySummary 缺鍵 ⇒ 上限算不出來、不給勾,而且不得 throw', () => {
    // 🔴 **A13b D6-a 接線時真的炸出來過** —— 但**觸發者是頁層測試的手寫 fixture 缺鍵**,
    //    不是投影退版(R2 codex 更正:`mappers/order.ts:542-544` 的 `mapQuantitySummary`
    //    回 `| null`、**產不出 `undefined`**)。
    //    ⇒ 本條守的是「入口是結構型別、擋不住手寫物件」那一面,**純防禦**。
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5,
            // 🔴 給一筆採購列讓 `ZERO_INFERENCE` **推不出 0/0** —— 否則缺摘要會被合法地推成
            //    「上限 = 買的量」,那條路是對的、但**測不到本條要守的 fail-closed**。
            procurements: [A_PROCUREMENT_ROW],
            procurementTruncated: false,
            quantitySummary: undefined,
          } as unknown as CancelViewOrder['items'][number],
        ],
      }),
    );
    expect(view.items[0]?.maxCancellable).toBeNull();
    expect(view.canCancel).toBe(false);
    expect(view.blockReasons).toContain('quantity_summary_missing');
  });

  it('🔴 缺鍵但五項前提成立 ⇒ 走 ZERO_INFERENCE(照樣不 throw)', () => {
    // 對照組:證明上一條的 null 是「推不出來」而不是「一律擋」。
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5,
            procurements: [],
            procurementTruncated: false,
            quantitySummary: undefined,
          } as unknown as CancelViewOrder['items'][number],
        ],
      }),
    );
    expect(view.items[0]?.maxCancellable).toBe(5);
  });
});

describe('常數字面', () => {
  it('自動失效的 reason 字面 = DB 端寫的那個(不是從同一支匯入就算對)', () => {
    // 🔴 R1 T5:這行是唯一把常數的**值**釘住的地方。改成 'payment-expired' 之類要在這裡紅,
    //    否則測試與實作從同一支匯入,寫錯字面全套照樣綠、到正式站才發現對不上 L3 寫入的值。
    expect(PAYMENT_EXPIRED_CANCEL_REASON).toBe('payment_expired');
  });
});

describe('buildOrderCancelView 健康基準', () => {
  it('零拒因、整單取消開、逐品項數字原樣帶出', () => {
    const view = buildOrderCancelView(order());

    expect(view.blockReasons).toEqual([]);
    expect(view.canCancel).toBe(true);
    expect(view.fullCancelAllowed).toBe(true);
    expect(view.items).toEqual([
      {
        orderItemId: ITEM_A,
        quantity: 5,
        instockQuantity: 0,
        cancelledQuantity: 0,
        maxCancellable: 5,
      },
    ]);
  });

  it('🔴 「買了幾件」取真相 order_items.quantity,不取摘要快取的去正規化欄', () => {
    // 🔴 A13a R1 F9:兩者由複合 FK 物理保證相等 ⇒ fixture 讓它們相等時,「讀哪一個」構造不出負測。
    //    這條刻意讓它們不等(結構型別擋不住、真實 mapper 產不出,同 clamp/min 那類入口防禦)。
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5,
            procurements: [],
            procurementTruncated: false,
            quantitySummary: summary({ quantity: 4 }),
          },
        ],
      }),
    );
    expect(view.items[0]!.quantity).toBe(5);
  });

  it('canCancel 恆等於「blockReasons 是空的」', () => {
    expect(buildOrderCancelView(order()).canCancel).toBe(true);
    expect(buildOrderCancelView(order({ itemsTruncated: true })).canCancel).toBe(false);
  });
});

describe('buildOrderCancelView 單層拒因(每條只紅自己那一條)', () => {
  it('已取消(cancelled_at 非 null)', () => {
    const view = buildOrderCancelView(order({ cancelledAt: '2026-08-09T00:00:00Z' }));
    expect(view.blockReasons).toEqual(['already_cancelled']);
  });

  it('未付款自動失效 → payment_expired,不報成 already_cancelled 也不報成帳本病理', () => {
    const view = buildOrderCancelView(
      order({
        cancelledAt: '2026-08-09T00:00:00Z',
        cancelledReason: PAYMENT_EXPIRED_CANCEL_REASON,
      }),
    );
    // 🔴 同時釘三件事:碼要是 payment_expired、不得混進 already_cancelled、
    //    且「已取消單帶 reason」不是帳本病理①(RPC 步5 的先後順序,`20260805100000:339-352`)。
    expect(view.blockReasons).toEqual(['payment_expired']);
  });

  it('已取消但 reason 是別的字面 → 仍是 already_cancelled', () => {
    const view = buildOrderCancelView(
      order({ cancelledAt: '2026-08-09T00:00:00Z', cancelledReason: 'customer_request' }),
    );
    expect(view.blockReasons).toEqual(['already_cancelled']);
  });

  it('付款狀態非 unpaid —— PaymentStatus 五個值裡的其他四個全擋,而且**各掛各的碼**', () => {
    // 🔴 關卡2 codex:原本只測 paid / partiallyPaid ⇒ 把實作改成「只擋這兩值」的突變可全綠,
    //    而 refunded / partiallyRefunded 會錯成可取消。值域出處 `types.ts:40-45`。
    // 🔴🔴 `#494`(Sean 2026-08-14 拍板 B):**擋不擋沒變,掛哪一碼變了。**
    //    這張表逐態寫死期望碼 ⇒ 誰把四態折回共用一碼,四格裡至少三格紅。
    //    ~~原本四態同期望 `payment_not_unpaid`~~ 是「三病共用一碼」的形狀
    //    (同族於 `ledger_unhealthy` 被 R1 F5 抓過的那次),而它讓 Sean 對著一張已退款的單
    //    讀到「已付款…請走人工退款流程」。
    const CASES = [
      ['paid', 'payment_not_unpaid'],
      ['partiallyPaid', 'payment_partially_paid'],
      ['refunded', 'payment_refunded'],
      ['partiallyRefunded', 'payment_partially_refunded'],
    ] as const;
    for (const [status, code] of CASES) {
      expect(buildOrderCancelView(order({ paymentStatus: status })).blockReasons).toEqual([code]);
    }
    expect(buildOrderCancelView(order({ paymentStatus: 'unpaid' })).blockReasons).toEqual([]);
  });

  it('在途扣款 blocked 與 unknown 是兩條不同的碼', () => {
    expect(buildOrderCancelView(order({ chargeAttemptGate: 'blocked' })).blockReasons).toEqual([
      'charge_attempt_blocked',
    ]);
    expect(buildOrderCancelView(order({ chargeAttemptGate: 'unknown' })).blockReasons).toEqual([
      'charge_attempt_unknown',
    ]);
  });

  it('🔴 #387 已付款的單不報「刷卡進行中」——那筆非 failed 的嘗試就是成功的那一筆', () => {
    // 🔴 正向對照放在同一格:少了它,「把整條 push 刪掉」的突變會讓下面全綠。
    expect(
      buildOrderCancelView(order({ paymentStatus: 'unpaid', chargeAttemptGate: 'blocked' }))
        .blockReasons,
    ).toEqual(['charge_attempt_blocked']);

    // 🔴 值域掃全:比照上一格的紀律,不只測 paid ——「只抑制 paid」的突變要紅。
    // 🔴 `#494`:期望碼改成**逐態各自的碼**(抑制的範圍一個字都沒變,變的是被留下那一碼的名字)。
    for (const [status, code] of [
      ['paid', 'payment_not_unpaid'],
      ['partiallyPaid', 'payment_partially_paid'],
      ['refunded', 'payment_refunded'],
      ['partiallyRefunded', 'payment_partially_refunded'],
    ] as const) {
      const view = buildOrderCancelView(order({ paymentStatus: status, chargeAttemptGate: 'blocked' }));
      // 突變:拿掉 `&& paymentStatus === 'unpaid'` ⇒ 這行紅(陣列會多一碼「還在進行中」)。
      expect(view.blockReasons).toEqual([code]);
      // 🔴 抑制的是碼、不是實質:單子照樣擋得住。
      //    這行釘住的是「兩條互補、恆有一條在擋」——若有人把 `payment_not_unpaid` 那行拿掉,
      //    被抑制的這張單就會變成可送出,而只看上一行斷言是看不出來的。
      expect(view.canCancel).toBe(false);
    }

    // `unknown` 不在本次收窄範圍內:讀不完整時「可能有在途」對已付款單仍然為真。
    expect(
      buildOrderCancelView(order({ paymentStatus: 'paid', chargeAttemptGate: 'unknown' }))
        .blockReasons,
    ).toEqual(['payment_not_unpaid', 'charge_attempt_unknown']);
  });

  it('品項清單被截斷', () => {
    expect(buildOrderCancelView(order({ itemsTruncated: true })).blockReasons).toEqual([
      'items_truncated',
    ]);
  });

  it('品項清單被截斷時,歷程提到看不見的品項是正常的 —— 不得多吐 unreadable', () => {
    // 🔴 關卡2 codex R2:清單本來就是子集,B 被截掉是合法的。多一個錯碼會讓員工看到
    //    「取消紀錄讀取異常」這句與事實不符的話。
    const view = buildOrderCancelView(
      order({
        itemsTruncated: true,
        items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() }],
        cancellations: [cancellation([{ orderItemId: ITEM_B, cancelledQuantity: 1 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['items_truncated']);
  });

  it('品項清單被截斷時,看得見的全勾不動也不得斷言 nothing_cancellable', () => {
    // 🔴 關卡2 codex R2:被截掉的品項可能還勾得動,那句斷言是錯的。
    const view = buildOrderCancelView(
      order({
        itemsTruncated: true,
        items: [
          {
            id: ITEM_A,
            quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ cancelledQuantity: 5, cancellableQuantity: 0 }),
          },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 5 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['items_truncated']);
  });

  it('零品項單 —— 不得同時報成 nothing_cancellable', () => {
    expect(buildOrderCancelView(order({ items: [] })).blockReasons).toEqual(['no_items']);
  });
});

describe('buildOrderCancelView 摘要缺列:權威訊號窮舉推 0/0(R3 F1 + E-007-A Q1=A)', () => {
  it('🔴 未採購新單:缺摘要但零採購列 + 歷程可讀 ⇒ 推 0/0、可以取消', () => {
    // 🔴 這是取消 UI 的**主要情境**(客人未付款、還沒跟供應商下單、要求取消)。
    //    A4a 的 trigger 只掛採購/收貨/取消明細三張表(`20260803140000:714-717`)、惰性建列(`:179-180`)
    //    ⇒ 這種單**永遠**沒有摘要列;而 RPC 的摘要在場閘只在真相非零時 RAISE(`20260805100000:376-387`)
    //    ⇒ RPC 放行。修法前本函式永久拒絕 = 把功能做成裝飾品。
    const view = buildOrderCancelView(
      order({ items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: null }] }),
    );
    expect(view.blockReasons).toEqual([]);
    expect(view.canCancel).toBe(true);
    expect(view.fullCancelAllowed).toBe(true);
    expect(view.items).toEqual([
      {
        orderItemId: ITEM_A,
        quantity: 5,
        instockQuantity: 0,
        cancelledQuantity: 0,
        maxCancellable: 5,
      },
    ]);
  });

  it('🔴 零採購但**取消過**且缺摘要 ⇒ 不推、fail-closed(第五項前提)', () => {
    // 🔴 確認輪 MF1:RPC 的摘要在場閘是 `receipts > 0 **OR** Σci > 0` 且缺摘要 ⇒ RAISE(`:377-385`)。
    //    我原本只驗四項前提,Σci=2 時會推出上限 3 放行 ⇒ 又一個「按鈕亮著、送出必失敗」。
    //    ⚠️ 而且我把那個錯行為寫成測試釘死過(本條就是它的修正版)——
    //    測試綠只代表行為與我的預期一致,不代表行為對。
    const view = buildOrderCancelView(
      order({
        items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: null }],
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 2 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['quantity_summary_missing']);
    expect(view.items[0]!.maxCancellable).toBeNull();
  });

  it('別的品項取消過不影響本品項推 0/0(第五項前提是逐品項的)', () => {
    const view = buildOrderCancelView(
      order({
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: null },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ cancelledQuantity: 2, cancellableQuantity: 3 }) },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_B, cancelledQuantity: 2 }])],
      }),
    );
    expect(view.blockReasons).toEqual([]);
    expect(view.items[0]!.maxCancellable).toBe(5);
  });

  it('🔴 有採購列卻缺摘要 ⇒ 推不出到貨 0,維持 fail-closed', () => {
    // A4a 應該替它建列卻沒建 = 真異常。這條是修法後 `quantity_summary_missing` 唯一該亮的情境族(R3 F4)。
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5,
            procurements: [A_PROCUREMENT_ROW],
            procurementTruncated: false,
            quantitySummary: null,
          },
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['quantity_summary_missing']);
    expect(view.items[0]!.instockQuantity).toBeNull();
    expect(view.items[0]!.maxCancellable).toBeNull();
    // 🔴 買了幾件仍然知道(真相值,不隨摘要缺列變 null)。
    expect(view.items[0]!.quantity).toBe(5);
  });

  it('🔴 不變式:抑制 quantity_summary_missing 的兩種情況,一定各有別的碼擋住', () => {
    // 🔴 確認輪 R3 MF-ii 的根據。抑制只能發生在「另有碼會擋」的情況;
    //    `procurementTruncated` 沒有自己的碼,所以它**刻意不抑制** —— 抑制它會讓
    //    「上限算不出來」卻一個拒因都不吐 ⇒ canCancel 變 true = fail-open。
    const missingSummaryItem = {
      id: ITEM_A,
      quantity: 5,
      procurements: [],
      procurementTruncated: false,
      quantitySummary: null,
    };
    for (const over of [
      { itemsTruncated: true, items: [missingSummaryItem] },
      { cancellations: null, items: [missingSummaryItem] },
    ] as const) {
      const view = buildOrderCancelView(order(over));
      expect(view.blockReasons).not.toContain('quantity_summary_missing');
      // 抑制了,但整張單仍被擋、且上限仍是「不知道」。
      expect(view.blockReasons.length).toBeGreaterThan(0);
      expect(view.canCancel).toBe(false);
      expect(view.items[0]!.maxCancellable).toBeNull();
    }
  });

  it('🔴 採購清單被截斷 ⇒ 「零採購」這個前提不成立,維持 fail-closed', () => {
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5,
            procurements: [],
            procurementTruncated: true,
            quantitySummary: null,
          },
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['quantity_summary_missing']);
  });

  it('🔴 取消歷程不可讀 ⇒ 推不出 0/0(fail-closed),但**只**報 cancellations_unreadable', () => {
    // 🔴 確認輪 R2 MF-a:`ledger.unreadable` 是**整單**旗標。某個品項合法取消過 100 次就會讓
    //    外層歷程被截斷 ⇒ 連「從未有過活動」的品項也推不出 0/0。這時報 quantity_summary_missing
    //    是把「歷程不完整」誤說成「摘要異常」⇒ 那個碼又會在正常資料上亮。
    //    ⚠️ 抑制的只是碼:上限仍是 null、仍勾不動,fail-closed 的實質沒鬆。
    const view = buildOrderCancelView(
      order({
        items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: null }],
        cancellations: null,
      }),
    );
    expect(view.blockReasons).toEqual(['cancellations_unreadable']);
    expect(view.items[0]!.maxCancellable).toBeNull();
  });

  it('🔴 正常多品項單:A 合法取消過導致歷程被截 ⇒ B 不得被誤報成摘要異常', () => {
    // 確認輪 R2 給的正常反例(不是毀損資料):A 有大量合法取消、B 從未有活動且合法缺摘要。
    const view = buildOrderCancelView(
      order({
        cancellationsTruncated: true,
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ cancelledQuantity: 2, cancellableQuantity: 3 }) },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: null },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 2 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['cancellations_unreadable']);
  });

  it('🔴 品項清單被截斷 ⇒ 不推 0/0,但**只**報 items_truncated', () => {
    // 🔴 確認輪 MF2:一張正常的大單(品項數觸及 `ORDER_ITEMS_EMBED_LIMIT`=200,`mappers/order.ts:385`)
    //    會被截斷 ⇒ 若這時還報 quantity_summary_missing,那個碼就會在**完全正常的資料**上亮,
    //    F4 宣稱的「只在真異常時亮」就不成立。該單已被 items_truncated 擋住,不缺這一道。
    const view = buildOrderCancelView(
      order({
        itemsTruncated: true,
        items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: null }],
      }),
    );
    expect(view.blockReasons).toEqual(['items_truncated']);
    // 仍然沒推出上限(fail-closed 的實質沒鬆掉,只是不多吐一個誤導的碼)。
    expect(view.items[0]!.maxCancellable).toBeNull();
  });

  it('只要有一個品項推不出 0 就擋整張單(其他品項健康也一樣)', () => {
    const view = buildOrderCancelView(
      order({
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
          {
            id: ITEM_B,
            quantity: 5,
            procurements: [A_PROCUREMENT_ROW],
            procurementTruncated: false,
            quantitySummary: null,
          },
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['quantity_summary_missing']);
    expect(view.canCancel).toBe(false);
  });
});

describe('buildOrderCancelView 帳本病理(②③ 從取消歷程真相算)', () => {
  it('① cancelled_reason 殘留(cancelledAt 是 null 卻有 reason)', () => {
    expect(buildOrderCancelView(order({ cancelledReason: 'customer_request' })).blockReasons).toEqual(
      ['ledger_unhealthy'],
    );
  });

  it('② 歷程累計取消量超過買的量 —— 用真相加總,不是看摘要', () => {
    // 🔴 R1 MF1:摘要側算不出這條(`mappers/order.ts:557` 早把這種列翻成 null),
    //    真相在 cancellations 裡。買 5 件,兩次取消共 6 件 ⇒ 病理②。
    const view = buildOrderCancelView(
      order({
        cancellations: [
          cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 4 }]),
          cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 2 }]),
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['ledger_unhealthy']);
  });

  it('② 剛好等於買的量 = 正常,不是病理(邊界)', () => {
    const view = buildOrderCancelView(
      order({ cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 5 }])] }),
    );
    expect(view.blockReasons).toEqual([]);
  });

  it('② 累計要按品項分別加,不是全單加總', () => {
    // A 買 5 取消 3、B 買 5 取消 3:全單加總 6 > 5 會誤報,逐品項才對。
    const view = buildOrderCancelView(
      order({
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
        ],
        cancellations: [
          cancellation([
            { orderItemId: ITEM_A, cancelledQuantity: 3 },
            { orderItemId: ITEM_B, cancelledQuantity: 3 },
          ]),
        ],
      }),
    );
    expect(view.blockReasons).toEqual([]);
  });

  it('② 缺摘要的品項照樣檢查 —— 比較基準是真相 quantity,不是摘要快取(R3 N5)', () => {
    // 🔴 修法前:比較基準取自摘要,缺列 ⇒ `quantity === null` ⇒ 那個品項的病理② **完全跳過**。
    //    現在 quantity 取自 `order_items.quantity` 真相值 ⇒ 缺摘要也抓得到超量。
    //    (本例有採購列 ⇒ 推不出 0/0 ⇒ 兩個碼同時成立,正好釘住兩者不互相吞掉。)
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5,
            procurements: [A_PROCUREMENT_ROW],
            procurementTruncated: false,
            quantitySummary: null,
          },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 99 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['quantity_summary_missing', 'ledger_unhealthy']);
  });

  it('② 第二個品項超量也要抓到(不是只看 items[0])', () => {
    // 🔴 關卡2 codex:原本病理② 永遠只讓第一個品項超量 ⇒ 實作改成只檢查 items[0] 可全綠。
    const view = buildOrderCancelView(
      order({
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_B, cancelledQuantity: 6 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['ledger_unhealthy']);
  });

  it('③ 零明細 header 是純防禦 —— 真 mapper 產不出這個形狀', () => {
    // 🔴 關卡2 codex:`mappers/order-cancellations.ts:86` 把空明細陣列轉成 `items: null`
    //    ⇒ 真實的病理③ 到這裡長得跟「沒讀到」一樣、走 cancellations_unreadable(見下一條)。
    //    本條只證明「入口若真的收到 []，會走 ledger_unhealthy」,**不證明**病理③ 在正式站被偵測到。
    expect(buildOrderCancelView(order({ cancellations: [cancellation([])] })).blockReasons).toEqual([
      'ledger_unhealthy',
    ]);
  });

  it('取消 header 底下有明細 = 正常,不算病理', () => {
    const view = buildOrderCancelView(
      order({ cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 1 }])] }),
    );
    expect(view.blockReasons).toEqual([]);
  });
});

describe('buildOrderCancelView 歷程讀不到 = unreadable、不是病理', () => {
  it('cancellations 整包 null', () => {
    expect(buildOrderCancelView(order({ cancellations: null })).blockReasons).toEqual([
      'cancellations_unreadable',
    ]);
  });

  it('外層被截斷 —— 用真 mapper 產得出的形狀(滿 100 列 + truncated)', () => {
    // 🔴 關卡2 codex R1→R2 兩輪:`order-cancellations.ts:142` 的
    //    `rows.length >= ORDER_CANCELLATIONS_EMBED_LIMIT`(=100)決定這個旗標
    //    ⇒ 它為 true 時清單**至少 100 列**。用 0 列或 1 列當 fixture,
    //    「只在 length 小於某值時處理截斷」的錯誤實作會全綠,而正式的 100 列形狀漏報。
    //    每列取消 1 件、分佈在兩個品項上,總量不超過任一品項的 quantity(不觸發病理②)。
    const view = buildOrderCancelView(
      order({
        cancellationsTruncated: true,
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
        ],
        cancellations: Array.from({ length: 100 }, (_, i) =>
          cancellation([
            { orderItemId: i % 2 === 0 ? ITEM_A : ITEM_B, cancelledQuantity: 1 },
          ]),
        ),
      }),
    );
    expect(view.blockReasons).toEqual(['ledger_unhealthy', 'cancellations_unreadable']);
  });

  it('明細列的 cancelledQuantity 是負數 —— 會把「可讀總和是下界」的推論沖掉', () => {
    // 🔴 關卡2 codex R2:買 5,歷程 +6 之後跟一個 -2 ⇒ 加總成 4、看起來正常,
    //    但真相是已經超量。DB 有 `CHECK (cancelled_quantity > 0)`(`20260730130000:247`),
    //    所以負數只可能來自執行期漂移 ⇒ 一律當看不到。
    const view = buildOrderCancelView(
      order({
        cancellations: [
          cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 6 }]),
          cancellation([{ orderItemId: ITEM_A, cancelledQuantity: -2 }]),
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['ledger_unhealthy', 'cancellations_unreadable']);
  });

  it('明細列的 cancelledQuantity 是 NaN —— 只有 Number.isFinite 那半擋得住', () => {
    // 🔴 突變自驗抓到:`row.cancelledQuantity <= 0` 那半對 `null` 恰好也成立(JS 把 null 當 0),
    //    所以用 null 當 fixture 時「拿掉 isFinite」的突變會存活。NaN 只有 isFinite 擋得住
    //    (`NaN <= 0` 是 false),而 NaN 進了加總會讓 `NaN > quantity` 恆假 = fail-open。
    const view = buildOrderCancelView(
      order({
        cancellations: [
          { items: [{ id: 'c-nan', orderItemId: ITEM_A, cancelledQuantity: NaN }], itemsTruncated: false },
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['cancellations_unreadable']);
  });

  it('明細列的 cancelledQuantity 不是有限數 —— 加法會靜默當成 0 少算', () => {
    // 🔴 關卡2 codex:`order-cancellations.ts:88-93` 逐欄直送、沒有 Number.isFinite 守門
    //    ⇒ 執行期真的可能收到 null;JS 裡 `0 + null === 0` = 少算 = fail-open。
    const view = buildOrderCancelView(
      order({
        cancellations: [
          {
            items: [
              { id: 'c-bad', orderItemId: ITEM_A, cancelledQuantity: null as unknown as number },
            ],
            itemsTruncated: false,
          },
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['cancellations_unreadable']);
  });

  it('歷程提到不在品項清單裡的 order_item_id —— 不得當成「那個品項沒被取消過」', () => {
    // 🔴 關卡2 codex:型別是結構型別、不保證同單歸屬;B 不在 items 裡就代表我們的品項清單
    //    與歷程對不起來,必須 fail-closed 而不是靜默忽略 B。
    const view = buildOrderCancelView(
      order({
        items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() }],
        cancellations: [cancellation([{ orderItemId: ITEM_B, cancelledQuantity: 6 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['cancellations_unreadable']);
  });

  it('一列看不到、另一列已證實超量 → 兩條都報,不得被 early return 吃掉', () => {
    // 🔴 關卡2 codex:看不到的列只讓 Σci 變成**下界**;下界已超過 quantity ⇒ 病理② 是確定的。
    const view = buildOrderCancelView(
      order({
        cancellations: [
          cancellation(null),
          cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 6 }]),
        ],
      }),
    );
    expect(view.blockReasons).toEqual(['ledger_unhealthy', 'cancellations_unreadable']);
  });

  it('某一列的 items 是 null(沒讀到)—— 不得被當成「零明細 header」病理', () => {
    expect(buildOrderCancelView(order({ cancellations: [cancellation(null)] })).blockReasons).toEqual(
      ['cancellations_unreadable'],
    );
  });

  it('某一列的 items 被截斷 —— Σci 會少算,一律當看不到(fail-open 的洞)', () => {
    // 🔴 R1 N4:這列只回子集,加起來是 4 < 5 看似正常,真相可能是 6。不得放行。
    const view = buildOrderCancelView(
      order({
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 4 }], true)],
      }),
    );
    expect(view.blockReasons).toEqual(['cancellations_unreadable']);
  });
});

describe('buildOrderCancelView 可取消量與模式', () => {
  it('全品項尚可取消量都是 0 → nothing_cancellable', () => {
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ cancelledQuantity: 5, cancellableQuantity: 0 }),
          },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 5 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['nothing_cancellable']);
  });

  it('有任一品項到貨 → 關掉整單取消,但整體仍可取消(逐品項)', () => {
    const view = buildOrderCancelView(
      order({
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ instockQuantity: 2, cancellableQuantity: 3 }) },
        ],
      }),
    );
    expect(view.blockReasons).toEqual([]);
    expect(view.canCancel).toBe(true);
    expect(view.fullCancelAllowed).toBe(false);
    expect(view.items[0]!.maxCancellable).toBe(3);
  });

  it('到貨量分佈在另一個品項上,一樣關掉整單取消', () => {
    const view = buildOrderCancelView(
      order({
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ instockQuantity: 1, cancellableQuantity: 4 }) },
        ],
      }),
    );
    expect(view.canCancel).toBe(true);
    expect(view.fullCancelAllowed).toBe(false);
  });

  it('cancellableQuantity 大於三軸自算值 → 取較小者(不得給出 RPC 會拒的上限)', () => {
    // 🔴 關卡2 codex:`{quantity:5, instock:0, cancelled:0, cancellable:6}` 原本會給上限 6,
    //    而 RPC 的真實上限是 `quantity − instock − cancelled` = 5 ⇒ 員工勾 6 送出必被拒。
    const view = buildOrderCancelView(
      order({ items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ cancellableQuantity: 6 }) }] }),
    );
    expect(view.items[0]!.maxCancellable).toBe(5);
  });

  it('尚可取消量是負數 → clamp 成 0(防禦:真實 mapper 產不出,入口型別擋不住)', () => {
    // 🔴 fixture 對 C1-C7 全部自洽(關卡2 codex R2 nit:上一版 ordered=4 / instock=5 違反
    //    C5 `instock <= ordered`,壞了不只一格 ⇒ 隔離不出「只有 cancellable 欄漂掉」)。
    //    買 5 / 訂 5 / 到貨 5 / 已取消 0 ⇒ 自算值 0;只有 cancellable 欄漂成 -3。
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({
              orderedQuantity: 5,
              instockQuantity: 5,
              shippedQuantity: 5,
              cancellableQuantity: -3,
            }),
          },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
        ],
      }),
    );
    expect(view.items[0]!.maxCancellable).toBe(0);
    expect(view.blockReasons).toEqual([]);
    // 有到貨 ⇒ 整單取消關掉(順帶釘住 INSTOCK_PROXY 對這個 fixture 生效)。
    expect(view.fullCancelAllowed).toBe(false);
  });

  it('🔴 到貨閘不可被「上限等於剩餘量」那條取代 —— clamp 把負的 derived 抬回 0 時兩者會相等', () => {
    // 🔴 R3 F3 的反例,推翻我 R2「everyItemFullyCancellable 嚴格蘊含 hasAnyInstock」的推論:
    //    A `{quantity:5, instock:3, cancelled:5}` ⇒ derived = −3 → clamp 0,而 quantity − cancelled 也是 0
    //    ⇒ 「上限等於剩餘量」成立 ⇒ 只靠那條會把整單取消誤開,而 A 有到貨 3 件、RPC `:409-416` 必拒。
    //    (此形狀違反 C7、真實 mapper 產不出 —— 與同檔的 clamp / min 是同一類入口防禦。)
    const view = buildOrderCancelView(
      order({
        items: [
          {
            id: ITEM_A,
            quantity: 5, procurements: [], procurementTruncated: false,
            quantitySummary: summary({
              orderedQuantity: 3,
              instockQuantity: 3,
              shippedQuantity: 3,
              cancelledQuantity: 5,
              cancellableQuantity: 0,
            }),
          },
          { id: ITEM_B, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
        ],
      }),
    );
    expect(view.canCancel).toBe(true);
    expect(view.items[0]!.maxCancellable).toBe(0);
    expect(view.fullCancelAllowed).toBe(false);
  });

  it('某品項的上限被 min 壓到低於剩餘量 → 整單取消要關掉(畫面數字與實際發生的要一致)', () => {
    // 🔴 關卡2 codex R2:`derived=5、cancellable=1` 時畫面說「最多取消 1 件」,
    //    而整單取消會把剩下的 5 件全取消 ⇒ 員工看到的與實際發生的不同。只留逐品項模式。
    const view = buildOrderCancelView(
      order({ items: [{ id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ cancellableQuantity: 1 }) }] }),
    );
    expect(view.canCancel).toBe(true);
    expect(view.items[0]!.maxCancellable).toBe(1);
    expect(view.fullCancelAllowed).toBe(false);
  });

  it('整張單被擋時,整單取消一律關(即使數量上還勾得動)', () => {
    const view = buildOrderCancelView(order({ chargeAttemptGate: 'blocked' }));
    expect(view.items[0]!.maxCancellable).toBe(5);
    expect(view.fullCancelAllowed).toBe(false);
  });
});

describe('buildOrderCancelView 多條拒因的順序是穩定宣告序', () => {
  it('unreadable 分支:五碼', () => {
    const view = buildOrderCancelView(
      order({
        cancelledAt: '2026-08-09T00:00:00Z',
        paymentStatus: 'paid',
        chargeAttemptGate: 'unknown',
        itemsTruncated: true,
        cancellations: null,
      }),
    );
    expect(view.blockReasons).toEqual([
      'already_cancelled',
      'payment_not_unpaid',
      'charge_attempt_unknown',
      'items_truncated',
      'cancellations_unreadable',
    ]);
  });

  it('ledger 分支:payment_expired + blocked + 缺摘要 + 病理②(R1 T6 補齊剩下的碼)', () => {
    // A 有摘要且被超取消(病理②)、B 缺摘要;兩條同時成立 ⇒ 釘住 quantity_summary_missing
    // 與 ledger_unhealthy 的相對順序(先前的斷言從未讓這兩碼同時出現)。
    const view = buildOrderCancelView(
      order({
        cancelledAt: '2026-08-09T00:00:00Z',
        cancelledReason: PAYMENT_EXPIRED_CANCEL_REASON,
        chargeAttemptGate: 'blocked',
        items: [
          { id: ITEM_A, quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary() },
          {
            id: ITEM_B,
            quantity: 5,
            procurements: [A_PROCUREMENT_ROW],
            procurementTruncated: false,
            quantitySummary: null,
          },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 6 }])],
      }),
    );
    expect(view.blockReasons).toEqual([
      'payment_expired',
      'charge_attempt_blocked',
      'quantity_summary_missing',
      'ledger_unhealthy',
    ]);
  });

  it('nothing_cancellable 排在最後', () => {
    // 🔴 不用 `itemsTruncated` 製造共存 —— 它現在會**抑制** nothing_cancellable(關卡2 codex R2)。
    //    改用付款閘,它與可取消量彼此獨立。
    const view = buildOrderCancelView(
      order({
        paymentStatus: 'paid',
        items: [
          {
            id: ITEM_A,
            quantity: 5, procurements: [], procurementTruncated: false, quantitySummary: summary({ cancelledQuantity: 5, cancellableQuantity: 0 }),
          },
        ],
        cancellations: [cancellation([{ orderItemId: ITEM_A, cancelledQuantity: 5 }])],
      }),
    );
    expect(view.blockReasons).toEqual(['payment_not_unpaid', 'nothing_cancellable']);
  });
});

// ─────────────────────────────────────────────────────────────
// L0 R1-MF4:`shippedQuantity` 不得進取消算式 —— **source-scan**,不是型別防線
//
// 🔴 為什麼型別擋不住:`buildCancelItemView` 拿到的是**完整的** `AdminOrderItemQuantitySummary`,
//    可取消量的算式(`cancel-view.ts` 的 `derived`)就在同一支函式裡
//    ⇒ `summary.shippedQuantity` 在那一行**完全可及、零型別阻力**。
//    我原本宣稱「視圖型別不帶它 = 結構上寫不出這個錯」是**只蓋到下游**,R1 抓到。
//
// 🔴 為什麼這個錯特別容易被寫:它**看起來很合理** —— 「已出貨的當然不能取消」。
//    但 Sean 2026-08-05 拍板「出貨必先到貨、無直送」⇒ `shipped ⊆ instock`
//    ⇒ 已出貨的量**本來就含在 instock 裡**,再減一次 = **重複扣**,把可取消量算**小**,
//    畫面會顯示「不能取消」而實際上還能取消。
//
// 形狀照同型先例 `lib/shipping/shipment-repository.test.ts` 那格(它禁的是同一張表的另一種誤用)。
// ⚠️ **誠實邊界**:source-scan 只擋得住**這個檔**裡的直接引用。有人把 summary 傳給別的函式再減,
//    本格看不到 —— 那一層由型別防線(視圖不帶該欄)接手,兩者互補、都不是全覆蓋。
// ─────────────────────────────────────────────────────────────
describe('L0 — `shippedQuantity` 不得進取消算式(source-scan)', () => {
  const SRC = readFileSync(join(__dirname, 'cancel-view.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('前提 — 真的讀到檔、且註解真的被剝掉(不然下面恆綠)', () => {
    // 🔴 本檔的註解裡就逐字寫著 `shippedQuantity` 在解釋這條規則 ⇒ 不剝就恆紅;
    //    而讀空字串會讓它恆綠。兩個方向都要釘。
    expect(SRC).toContain('buildOrderCancelView');
    expect(SRC, '剝註解沒作用 ⇒ 下面那格會被說明文字餵飽').not.toContain('🔴');
  });

  it('🔴 `cancel-view.ts` 的**程式碼**零 `shippedQuantity` 引用', () => {
    expect(
      SRC,
      'cancel-view.ts 出現了 shippedQuantity ⇒ 極可能是把它減進可取消量。' +
        '`shipped ⊆ instock`(Sean 2026-08-05 拍板「出貨必先到貨」)⇒ 再減一次是重複扣,' +
        '會讓畫面顯示「不能取消」而實際上還能取消。要改請先推翻那條拍板。',
    ).not.toContain('shippedQuantity');
  });
});
