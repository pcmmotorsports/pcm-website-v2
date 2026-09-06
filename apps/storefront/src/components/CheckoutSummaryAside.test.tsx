// @vitest-environment jsdom
// CheckoutSummaryAside.test.tsx — `#873`:DB 多一個會員等級時,結帳頁會怎樣
//
// 🔴 **這支檔的第一格是【量測】不是斷言** —— 它先讓現況表演一次,再談要不要修。
//    理由:「裸 cast 不安全」是型別知識;**「這支頁面在拿到未知 tier 時會怎樣」是行為**,
//    而 backlog `#873` 要的是後者。

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MemberTier } from '@pcm/domain';
import { CheckoutSummaryAside } from './CheckoutSummaryAside';

const UNKNOWN = 'platinumDealer' as unknown as MemberTier;

/** 最小可 render 的 props;`lines` 給空陣列 —— 本片要量的是 tier,不是購物車。 */
function props(tier: MemberTier, over: { tax?: number; subtotal?: number; shipping?: number; total?: number } = {}) {
  // 🔴 `tax` 是**必填**, 不是 `?: number` —— ⟦auth-TIERTOTALBYPAYMENT⟧ B2b 刻意的:
  //    加這個 prop 的當下, `tsc` 一次點名了**每一個**沒傳它的呼叫端(本檔三處)。
  //    📌 給它一個預設值 ⇒ 那三處會安靜地拿到 0 ⇒ **忘了接稅的頁面全綠**。
  return {
    lines: [], subtotal: 0, shipping: 0, tax: 0, total: 0,
    memberName: '王小明', memberTier: tier, ...over,
  };
}

describe('#873 · 未知的會員等級走進結帳頁', () => {
  // 🔴 **這一格【期望它炸】,那不是漏修** ——
  //    `schemaTierToDesign` 的 `throw` 是**刻意的 exhaustive 保護**,不該為了這件事變寬鬆
  //    (把它改成回退 ⇒ 全 repo 的 enum 漂移從此靜音)。
  //    ⇒ 真正的修法是**在信任邊界上把值解析掉**(`checkout/page.tsx` / `account/page.tsx` 用 `toMemberTier`)。
  //    ⇒ 本格的作用是**釘住那個理由**:哪天有人想「順手」讓這裡容錯,這一格會紅,而它紅的時候
  //      要讀的是這段註解,不是把斷言改掉。
  it('🔴 未知 tier 走到這一層 ⇒ 會 throw(這【就是】邊界必須解析的理由)', () => {
    // 🔴 量具自檢:先用合法值跑一發。它若也炸 ⇒ 是環境壞了, 本格的結果作廢。
    //    (第一版沒有這一格 ⇒ `document is not defined` 被 try/catch 吞掉 ⇒ 印出「沒炸」。)
    const sane = render(<CheckoutSummaryAside {...props('general' as MemberTier)} />);
    sane.unmount();

    let thrown: unknown = null;
    try {
      render(<CheckoutSummaryAside {...props(UNKNOWN)} />);
    } catch (e) {
      thrown = e;
    }
    // 📏 **量測結果(2026-08-24)**:它**會炸**,而且是在 render 當下。
    expect(String(thrown)).toContain('TypeError');
    expect(String(thrown)).toContain('schemaTierToDesign');
  });

  it('🔴 對照組:三個合法 tier 都渲染得出來(證明上面那格不是「元件根本 render 不了」)', () => {
    for (const t of ['general', 'store', 'premiumStore'] as MemberTier[]) {
      const { unmount } = render(<CheckoutSummaryAside {...props(t)} />);
      expect(screen.getByText('王小明')).toBeTruthy();
      unmount();
    }
  });
});

describe('⟦auth-TIERTOTALBYPAYMENT⟧ B2b —— 稅那一行', () => {
  // 🔴 **本檔【沒有】自動 cleanup** —— 既有兩格都手動 `unmount()`(`:37` / `:54`), 那是本檔的慣例。
  //   🛑 我第一版漏了它 ⇒ 上一格的 DOM 留在 document 裡 ⇒ 下一格的 `queryByText` 看到的是**上一格的畫面**
  //     ⇒ 那一格當場紅了。📌 **而它【剛好】是紅的那一側** —— 如果我兩格的順序相反,
  //       同一個漏洞會讓「稅行有出現」在一個根本沒渲染稅行的世界裡**印綠**。
  it('🔴 tax > 0 ⇒ 印出「營業稅 5%」與金額', () => {
    const { unmount } = render(<CheckoutSummaryAside {...props('store' as MemberTier, { subtotal: 1000, shipping: 100, tax: 55, total: 1155 })} />);
    expect(screen.getByText('營業稅 5%')).toBeTruthy();
    expect(screen.getByText('NT$ 55')).toBeTruthy();
    expect(screen.getByText('NT$ 1,155')).toBeTruthy();
    unmount();
  });

  it('🟢 tax === 0 ⇒ 【不】印那一行(0 有兩種來源:一般會員 / 經銷選匯款, 畫面上刻意不分)', () => {
    const { unmount } = render(<CheckoutSummaryAside {...props('store' as MemberTier, { subtotal: 1000, shipping: 100, tax: 0, total: 1100 })} />);
    expect(screen.queryByText('營業稅 5%')).toBeNull();
    expect(screen.getByText('NT$ 1,100')).toBeTruthy();
    unmount();
  });
});
