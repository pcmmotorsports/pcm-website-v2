// @vitest-environment jsdom
// order-cancel-block.test.tsx — A13(訂單列表操作欄)的**目的地端**守門。
//
// 🔴 **為什麼是獨立一檔、而且非有不可**(2026-08-12 codex R1 must-fix):
//    列表那一欄的連結是 `…#cancel`,錨點住在本檔測的元件裡。原本的跨檔守門只是
//    「grep 這個檔的原始碼有沒有 `id='cancel'` 字面」—— 那擋不住**位置**改變:
//    把 `id` 移進 `{showForms && …}` 之後,**未取消但明細判定不可取消**的單
//    (例:已付款 ⇒ 退款線第 3 批才開通)在列表上仍然有入口,連過去卻沒有錨點,
//    而那條字面守門照樣全綠。⇒ 這裡改成**真的 render**、斷言錨點在兩種情境下都在。
//
// ⚠️ 擋不住什麼:jsdom 不做捲動,「瀏覽器真的會捲到那個錨點」這裡證不了(面板版尤其未確認)。
//    本檔守的是「錨點存在且唯一」,那是捲動能成立的必要條件、不是充分條件。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderDetailItem } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { OrderCancelBlock } from './order-cancel-block';

function summary(over: Partial<AdminOrderDetailItem['quantitySummary']> = {}) {
  return {
    quantity: 5,
    orderedQuantity: 4,
    instockQuantity: 0,
    cancelledQuantity: 0,
    cancellableQuantity: 5,
    ...over,
  } as NonNullable<AdminOrderDetailItem['quantitySummary']>;
}

function item(over: Partial<AdminOrderDetailItem> = {}): AdminOrderDetailItem {
  return {
    id: '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a',
    variantSku: 'SKU-1',
    title: '下導流',
    spec: null,
    quantity: 5,
    unitPrice: { amount: 100, currency: 'TWD' },
    lineTotal: { amount: 500, currency: 'TWD' },
    procurements: [],
    procurementTruncated: false,
    quantitySummary: summary(),
    ...over,
  } as unknown as AdminOrderDetailItem;
}

/** 基準 = 可取消的健康單(同 `cancel-review-section.test.tsx` 的形狀,刻意對齊)。 */
function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    paymentStatus: 'unpaid',
    cancelledAt: null,
    cancelledReason: null,
    chargeAttemptGate: 'clear',
    items: [item()],
    itemsTruncated: false,
    cancellations: [],
    cancellationsTruncated: false,
    ...over,
  } as unknown as AdminOrderDetail;
}

const anchors = (c: HTMLElement) => c.querySelectorAll('[id="cancel"]');

afterEach(cleanup);

describe('A13 錨點 — `id="cancel"` 是列表操作欄的目的地', () => {
  it('🔴 可取消的單:錨點恰一個,而且**表單真的出得來**(正向對照)', () => {
    const { container } = render(
      <OrderCancelBlock detail={detail()} returnTo='/orders' formsAllowed={true} />,
    );
    expect(anchors(container).length, '錨點不見了 ⇒ 列表那些 #cancel 連結全部落空').toBe(1);
    // 🔴 R2 F2:沒有這條正向對照,「表單出不來」會變成**四格共同的靜默前提** ——
    //    哪天取消表單換了元素(例:`CancelFormShell` 不再吐 `<form>`),下面三格的
    //    `expect(form).toBeNull()` 會**因為錯的理由**而綠,整組跟著塌成恆真。
    expect(
      container.querySelector('form'),
      '可取消的單居然沒有取消表單 ⇒ 下面那三格的 `form 為 null` 就不再代表「不可取消」',
    ).not.toBeNull();
  });

  it('🔴🔴 **不可取消**的單:錨點仍然要在(列表上還是有入口,連過去不能沒有落點)', () => {
    // 已付款 ⇒ `buildOrderCancelView` 推拒因、`showForms` 為 false。
    // 🔴 這正是 codex R1 點名的那個突變:把 `id` 移進 `{showForms && …}` 就只有這一格會紅。
    const { container } = render(
      <OrderCancelBlock detail={detail({ paymentStatus: 'paid' })} returnTo='/orders' formsAllowed={true} />,
    );
    // 前提:這一格真的走到「不可取消」那條路(不然它只是第一格的複本)。
    expect(
      container.querySelector('form'),
      '這張單居然還出得了取消表單 ⇒ fixture 沒有落在不可取消分支,本格失去意義',
    ).toBeNull();
    expect(anchors(container).length, '不可取消時錨點消失 ⇒ 員工從列表點「取消」會落在頁面頂端自己找').toBe(1);
  });

  it('🔴 `formsAllowed=false`(fail-closed 那條路)錨點也要在', () => {
    const { container } = render(
      <OrderCancelBlock detail={detail()} returnTo='/orders' formsAllowed={false} />,
    );
    expect(container.querySelector('form')).toBeNull();
    expect(anchors(container).length).toBe(1);
  });

  it('🔴 已取消的單:錨點照樣在(複核區塊本來就永遠掛著)', () => {
    const { container } = render(
      <OrderCancelBlock
        detail={detail({ cancelledAt: '2026-08-10T00:00:00.000Z' })}
        returnTo='/orders'
        formsAllowed={true}
      />,
    );
    expect(anchors(container).length).toBe(1);
  });
});
