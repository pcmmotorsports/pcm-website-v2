// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderDetailItem } from '@pcm/domain';

import { BLOCK_REASON_TEXT, CancelReviewSection } from './cancel-review-section';

const ITEM_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const ITEM_B = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';

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
    id: ITEM_A,
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

/** 🔴 基準刻意是「可取消」的健康單:任一格漂成不可取消,第一條測試就紅。 */
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

afterEach(() => {
  cleanup();
});

describe('CancelReviewSection — 可取消時', () => {
  it('說得出可以取消,且整單/逐項兩種說法分得出來', () => {
    const { container } = render(<CancelReviewSection detail={detail()} />);
    expect(container.textContent).toContain('這張單可以取消');
    expect(container.textContent).toContain('可以整單取消');
  });

  it('有品項到貨 ⇒ 改說只能逐項取消(不是整單)', () => {
    const { container } = render(
      <CancelReviewSection
        detail={detail({
          items: [item({ quantitySummary: summary({ instockQuantity: 2, cancellableQuantity: 3 }) })],
        })}
      />,
    );
    expect(container.textContent).toContain('只能逐項取消');
    expect(container.textContent).not.toContain('可以整單取消');
  });

  it('影響範圍預設展開,不可取消時預設收合(兩面都釘)', () => {
    // 🔴 R1 F6:原本只驗 open===true 那一半 ⇒ 把 `open={view.canCancel}` 改成恆 `open` 全綠。
    const { container: ok } = render(<CancelReviewSection detail={detail()} />);
    expect(ok.querySelector('details')?.hasAttribute('open')).toBe(true);
    cleanup();
    const { container: blocked } = render(
      <CancelReviewSection detail={detail({ paymentStatus: 'paid' })} />,
    );
    expect(blocked.querySelector('details')?.hasAttribute('open')).toBe(false);
  });
});

describe('CancelReviewSection — 文案紀律(表格驅動)', () => {
  // 🔴 R1 F11:11 條裡原本只有 4 條被斷言,其餘改字全綠。這組把「指路對不對」變成規則而非逐句抄。
  // 🔴 **豁免制而非清單制**(R2 nit):手寫「要嚴格的碼」清單時,日後新增的碼不會被納入
  //    ⇒ 新碼漏寫指路句照樣全綠。改成「全碼扣掉明列豁免」,新碼**預設**落進嚴格桶。
  const EXEMPT_FROM_MAINTENANCE_HINT: readonly (keyof typeof BLOCK_REASON_TEXT)[] = [
    'already_cancelled',
    'payment_expired',
    'payment_not_unpaid',
    'charge_attempt_blocked',
    'nothing_cancellable',
  ];
  const NEEDS_MAINTENANCE = (
    Object.keys(BLOCK_REASON_TEXT) as (keyof typeof BLOCK_REASON_TEXT)[]
  ).filter((code) => !EXEMPT_FROM_MAINTENANCE_HINT.includes(code));

  it('讀不全/異常那批一定叫他通知系統維護', () => {
    for (const code of NEEDS_MAINTENANCE) {
      expect(BLOCK_REASON_TEXT[code].hint, code).toContain('通知系統維護');
    }
  });

  it('帳本異常與零品項不得只叫他重新整理(重整不會好)', () => {
    for (const code of ['ledger_unhealthy', 'no_items', 'items_truncated'] as const) {
      expect(BLOCK_REASON_TEXT[code].hint, code).not.toContain('請重新整理');
    }
  });

  it('每條都有非空 title 與 hint,且 hint 不得等於 title', () => {
    for (const [code, text] of Object.entries(BLOCK_REASON_TEXT)) {
      expect(text.title.length, code).toBeGreaterThan(0);
      expect(text.hint.length, code).toBeGreaterThan(text.title.length);
    }
  });

  it('ledger_unhealthy 要涵蓋三種病理,不能只講數量(R1 F5)', () => {
    expect(BLOCK_REASON_TEXT.ledger_unhealthy.hint).toContain('沒有品項');
  });

  it('nothing_cancellable 要留出路,不能把成因講死(R1 F4:有已知假陽性路徑)', () => {
    expect(BLOCK_REASON_TEXT.nothing_cancellable.hint).toContain('重新整理');
  });
});

describe('CancelReviewSection — 不可取消時逐條文案', () => {
  it('已付款 ⇒ 說「這期還不能」而不是「不能取消」(Sean 07-26 拍已付款可取消,缺口在第 3 批)', () => {
    const { container } = render(
      <CancelReviewSection detail={detail({ paymentStatus: 'paid' })} />,
    );
    expect(container.textContent).toContain('這期還不能在這裡取消');
  });

  it('自動失效 ⇒ 說「未付款已自動失效」,不說「已經取消過」', () => {
    const { container } = render(
      <CancelReviewSection
        detail={detail({ cancelledAt: '2026-08-09T00:00:00Z', cancelledReason: 'payment_expired' })}
      />,
    );
    expect(container.textContent).toContain('未付款已自動失效');
    expect(container.textContent).not.toContain('已經取消過了');
  });

  it('讀不全那幾條要帶「通知系統維護」,不能只叫他重新整理', () => {
    // 🔴 成因含投影退版 ⇒ 重整不會好;只寫「請重新整理」是叫員工做一件無效的事。
    const { container } = render(
      <CancelReviewSection detail={detail({ chargeAttemptGate: 'unknown' })} />,
    );
    expect(container.textContent).toContain('請重新整理');
    expect(container.textContent).toContain('通知系統維護');
  });

  it('拒因同時成立時逐條都畫出來,不是只畫第一條', () => {
    const { container } = render(
      <CancelReviewSection
        detail={detail({ paymentStatus: 'paid', chargeAttemptGate: 'blocked', itemsTruncated: true })}
      />,
    );
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain('這期還不能在這裡取消');
    expect(container.textContent).toContain('還在進行中');
    expect(container.textContent).toContain('品項太多');
  });
});

describe('CancelReviewSection — 數量欄', () => {
  it('已到貨與尚可取消分開顯示(買 5 / 到貨 2 / 還能取消 3)', () => {
    const { container } = render(
      <CancelReviewSection
        detail={detail({
          items: [item({ quantitySummary: summary({ instockQuantity: 2, cancellableQuantity: 3 }) })],
        })}
      />,
    );
    const cells = Array.from(container.querySelectorAll('tbody td')).map((c) => c.textContent);
    expect(cells).toEqual(['下導流SKU-1', '5', '2', '0', '3']);
  });

  it('🔴 多品項時逐列對得上自己那一項(不是全部畫第一項的數字)', () => {
    // R1 F10:單品項 fixture 讓「byId join 換成 view.items[0]」的突變恆綠。
    const { container } = render(
      <CancelReviewSection
        detail={detail({
          items: [
            item({ quantity: 5, quantitySummary: summary() }),
            item({
              id: ITEM_B,
              variantSku: 'SKU-2',
              title: '尾燈',
              quantity: 2,
              quantitySummary: summary({ quantity: 2, orderedQuantity: 2, cancellableQuantity: 2 }),
            }),
          ],
        })}
      />,
    );
    const rows = Array.from(container.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['下導流SKU-1', '5', '0', '0', '5'],
      ['尾燈SKU-2', '2', '0', '0', '2'],
    ]);
  });

  it('🔴 不知道的數字畫成「?」不是 0', () => {
    // 有採購列卻缺摘要 ⇒ 推不出 0/0 ⇒ 三個數字都是「不知道」。畫成 0 會讓員工照著它算。
    const { container } = render(
      <CancelReviewSection
        detail={detail({
          items: [
            item({
              quantitySummary: null,
              procurements: [{} as AdminOrderDetailItem['procurements'][number]],
            }),
          ],
        })}
      />,
    );
    const cells = Array.from(container.querySelectorAll('tbody td')).map((c) => c.textContent);
    expect(cells).toEqual(['下導流SKU-1', '5', '?', '?', '?']);
  });
});

describe('CancelReviewSection — 取消紀錄三態', () => {
  it('null = 讀取失敗,不得畫成「沒有取消紀錄」', () => {
    const { container } = render(<CancelReviewSection detail={detail({ cancellations: null })} />);
    expect(container.textContent).toContain('取消紀錄讀取失敗');
    expect(container.textContent).not.toContain('這張單沒有取消紀錄');
  });

  it('[] = 真的沒取消過', () => {
    const { container } = render(<CancelReviewSection detail={detail()} />);
    expect(container.textContent).toContain('這張單沒有取消紀錄');
  });

  it('🔴 截斷要明說(外層與逐列各一句)—— 員工不能以為看到的是全部', () => {
    // R1 F7:兩處揭露原本零斷言,整段刪掉全綠。
    const { container } = render(
      <CancelReviewSection
        detail={detail({
          cancellationsTruncated: true,
          cancellations: [
            {
              id: 'c1',
              reasonCode: 'out_of_stock',
              reasonDetail: null,
              actor: 's',
              idempotencyKey: 'k',
              createdAt: '2026-08-09T02:00:00Z',
              items: [{ id: 'ci1', orderItemId: ITEM_A, cancelledQuantity: 1 }],
              itemsTruncated: true,
            },
          ],
        } as unknown as Partial<AdminOrderDetail>)}
      />,
    );
    expect(container.textContent).toContain('只顯示最近幾筆');
    expect(container.textContent).toContain('品項明細沒有列完');
  });

  it('🔴 明細數字異常時不得靜默少算,要說「無法計算」(R1 F2)', () => {
    // `mappers/order-cancellations.ts` 逐欄直送、無 Number.isFinite 守門 ⇒ 執行期真的可能收到這種值。
    const { container } = render(
      <CancelReviewSection
        detail={detail({
          cancellations: [
            {
              id: 'c1',
              reasonCode: 'other',
              reasonDetail: null,
              actor: 's',
              idempotencyKey: 'k',
              createdAt: '2026-08-09T02:00:00Z',
              items: [
                { id: 'ci1', orderItemId: ITEM_A, cancelledQuantity: 2 },
                { id: 'ci2', orderItemId: ITEM_A, cancelledQuantity: null },
              ],
              itemsTruncated: false,
            },
          ],
        } as unknown as Partial<AdminOrderDetail>)}
      />,
    );
    expect(container.textContent).toContain('件數無法計算');
    expect(container.textContent).not.toContain('共 2 件');
  });

  it('🔴 壞掉的 createdAt 不得讓整頁炸(R2 nit:換回 Intl 會丟 RangeError = server render 500)', () => {
    expect(() =>
      render(
        <CancelReviewSection
          detail={detail({
            cancellations: [
              {
                id: 'c1',
                reasonCode: 'other',
                reasonDetail: null,
                actor: 's',
                idempotencyKey: 'k',
                createdAt: 'bad',
                items: [{ id: 'ci1', orderItemId: ITEM_A, cancelledQuantity: 1 }],
                itemsTruncated: false,
              },
            ],
          } as unknown as Partial<AdminOrderDetail>)}
        />,
      ),
    ).not.toThrow();
  });

  it('有內容 ⇒ 畫原因中文與件數;逐列 items=null 要說「沒有讀到」', () => {
    const { container } = render(
      <CancelReviewSection
        detail={detail({
          cancellations: [
            {
              id: 'c1',
              reasonCode: 'out_of_stock',
              reasonDetail: null,
              actor: 'staff-1',
              idempotencyKey: 'k1',
              createdAt: '2026-08-09T02:00:00Z',
              items: [{ id: 'ci1', orderItemId: ITEM_A, cancelledQuantity: 2 }],
              itemsTruncated: false,
            },
            {
              id: 'c2',
              reasonCode: 'other',
              reasonDetail: '客人改單',
              actor: 'staff-1',
              idempotencyKey: 'k2',
              createdAt: '2026-08-09T03:00:00Z',
              items: null,
              itemsTruncated: false,
            },
          ],
        } as unknown as Partial<AdminOrderDetail>)}
      />,
    );
    expect(container.textContent).toContain('缺貨');
    expect(container.textContent).toContain('共 2 件');
    expect(container.textContent).toContain('客人改單');
    expect(container.textContent).toContain('品項明細沒有讀到');
  });
});
