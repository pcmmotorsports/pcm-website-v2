// @vitest-environment jsdom
// order-detail-items-brand.test.tsx — 片16(2026-08-19)品牌那一行的守門。
//
// 🔴 **為什麼要新開一格**:本片加完品牌行之後,全套 551 個測試檔**沒有一個紅、也沒有一個綠是因為它**
//    (實測:加完 UI 那一行後直接全跑 ⇒ 551 passed)⇒ **把那一行刪掉,不會有任何東西紅。**
//    而 `ItemsTable` 在既有的 `order-detail-header.test.tsx:151` 是被 `vi.mock` 成 `() => null` 的
//    ⇒ 那一檔對本片零判別力。
//
// 🔴 **釘的是三件,而第三件最容易被下一個人弄丟**:
//    ① 有品牌 ⇒ 印出來
//    ② `null` ⇒ **整行不印**(不是印 `—`)
//    ③ 🔴 它在 `<summary>` 裡、`.iline` 那個 grid **之外(之前)** ——
//       設計稿 `:291` 的形狀是「橫跨整列的一行」,而**塞進 `.iline` 裡會變成第七軌**、把六軌擠歪。
//       ⚠️ **而「擠歪」在 jsdom 裡量不到**(沒有版面)⇒ 這一格改用 **DOM 位置關係**釘它,
//          不是量寬度。**它擋得住「被搬進 grid 裡」,擋不住「在真瀏覽器裡長得難看」。**

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { ItemsTable } from './order-detail-items-table';

afterEach(cleanup);

const PAYMENTS = { status: 'unreadable' } as const;

function detailWith(brand: string | null): AdminOrderDetail {
  return {
    id: 'o1',
    subtotal: { amount: 5000, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 5000, currency: 'TWD' },
    itemsTruncated: false,
    items: [
      {
        id: 'oi-1',
        brand,
        variantSku: 'BRM-GP4RX-108-DUC-V4S',
        title: 'GP4-RX 輻射式對四卡鉗 108mm',
        spec: null,
        quantity: 1,
        unitPrice: { amount: 5000, currency: 'TWD' },
        lineTotal: { amount: 5000, currency: 'TWD' },
        procurements: null,
        procurementTruncated: false,
        quantitySummary: null,
      },
    ],
  } as unknown as AdminOrderDetail;
}

// 🔴 `returnTo` / `suppliers` / `suppliersFailed` 是 ItemsTable 的必填 prop（片7 之後加的），
//    本片一格都不斷言它們 —— 放在這裡只為了讓型別過。
//    ⚠️ 它們的行為由 item-procurement-section.test.tsx 守，不要在本檔重複守一份。
//    （2026-08-19 收割窗補：w1-order-panel 的基底早於片7，merge 乾淨而 typecheck 紅。）
describe('🔴 片16:商品列的品牌那一行', () => {
  it('有品牌 ⇒ 印在 .ibrand 裡', () => {
    const { container } = render(<ItemsTable detail={detailWith('BREMBO')} payments={PAYMENTS} returnTo='/orders' suppliers={[]} suppliersFailed={false} />);
    const el = container.querySelector('.ibrand');
    expect(el, '.ibrand 不見了 ⇒ 品牌那一行沒畫').not.toBeNull();
    expect(el?.textContent).toBe('BREMBO');
    // 🔴 **class 名字本身是承重的** —— `.ibrand` 的三個值(10px / 700 / .05em)只寫在 CSS 裡,
    //    改名 ⇒ 樣式靜默失效、字變成繼承來的大小,而**畫面上仍然看得到那個字** ⇒ 沒有東西會紅。
    //    ⇒ 這一條同時釘住「那一行存在」與「它掛著能讓 CSS 找到它的名字」。
  });

  it('🔴 brand 為 null ⇒ 整行不印(不是印「—」)', () => {
    const { container } = render(<ItemsTable detail={detailWith(null)} payments={PAYMENTS} returnTo='/orders' suppliers={[]} suppliersFailed={false} />);
    // 正向錨:表格本身有渲染。少了它,下面兩條在「元件回 null」時會恆綠。
    expect(container.textContent, '品項表沒渲染 ⇒ 下面兩條會恆綠').toContain(
      'BRM-GP4RX-108-DUC-V4S',
    );
    expect(container.querySelector('.ibrand'), 'null 時仍畫出品牌行').toBeNull();
    // 🔴 **而且 `<summary>` 的第一個子元素就是 `.iline`** —— 也就是它前面【什麼都沒插】。
    //    ⚠️ 我第一版寫的是 `summary.textContent 不含 '—'`,而那條是**錯的尺**:
    //       三軸讀不到時 `ItemAxisValue` 本來就印 `—`(與品牌無關)⇒ 它量的是別人的東西。
    //       ⇒ 換成「位置」而不是「字面」:要驗的是「有沒有多出一行」,不是「畫面上有沒有破折號」。
    const summary = container.querySelector('.icard summary');
    expect(summary, '錨不見了').not.toBeNull();
    expect(summary!.firstElementChild?.className, 'summary 裡多了一個空的品牌行').toContain('iline');
  });

  it('🔴 品牌行在 `.iline` 之外(它是橫跨整列的一行,不是第七軌)', () => {
    const { container } = render(<ItemsTable detail={detailWith('BREMBO')} payments={PAYMENTS} returnTo='/orders' suppliers={[]} suppliersFailed={false} />);
    const brand = container.querySelector('.ibrand');
    const line = container.querySelector('.iline');
    expect(brand, '錨不見了').not.toBeNull();
    expect(line, '錨不見了').not.toBeNull();
    // ① 不是 `.iline` 的後代 —— 進去就變成第七軌
    expect(line?.contains(brand!), '品牌被塞進 .iline 裡 ⇒ 它會變成第七軌、把六軌擠歪').toBe(false);
    // ② 而且排在它【前面】(設計稿是「上方那一行」)
    expect(
      brand!.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING,
      '品牌行跑到 .iline 後面了',
    ).toBeTruthy();
  });
});
