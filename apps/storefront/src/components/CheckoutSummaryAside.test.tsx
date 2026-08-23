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
function props(tier: MemberTier) {
  return { lines: [], subtotal: 0, shipping: 0, total: 0, memberName: '王小明', memberTier: tier };
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
