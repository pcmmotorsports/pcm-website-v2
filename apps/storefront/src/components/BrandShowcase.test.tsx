// @vitest-environment jsdom
//
// BrandShowcase dispatcher 守門 —— 2026-09-02 新增(`⟦f3-RIZOMASHOWCASE⟧` 那一片帶進來的)。
//
// 🔴🔴 **為什麼這支檔今天才出現**:改動前 `ls apps/storefront/src/components/BrandShowcase*.test.tsx`
//   ⇒ **查無**。⇒ 那個 switch 上架到第 17 家為止,**沒有任何一格在守「有沒有註冊進去」**。
//   ⇒ 🎯 而它壞掉的方式是:**畫面只是少一整區,不會報錯、不會紅、console 乾淨**。
//      —— 元件寫好了、測試全綠、而客人在商品頁上看不到它。
//
// 🛑 **本檔涵蓋的只有 `rizoma` 那一格(第 18 家 = 本片)。已知未涵蓋:其餘 17 家的註冊**
//   ⇒ 補它們是另一件事(不在本片範圍),而它們今天同樣零守門。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { MOCK_PRODUCTS } from '@/data/mock-products';
import { BrandShowcase } from './BrandShowcase';

// 各家 showcase 都是重元件(影片 / IntersectionObserver / 大量標記)——
// 本檔只問「有沒有分派到」,不問「它畫了什麼」(那是各家自己那支 test 的事)。
vi.mock('./RizomaShowcase', () => ({
  RizomaShowcase: () => <div data-testid="rizoma-showcase" />,
}));

afterEach(cleanup);

const base = MOCK_PRODUCTS[0]!;

describe('BrandShowcase dispatcher', () => {
  it('🔴 brandSlug=rizoma ⇒ 分派到 RizomaShowcase', () => {
    // 🧬 突變:把 BrandShowcase.tsx 的 `case 'rizoma'` 拿掉 ⇒ 這一格必須紅。
    //    否則「第 18 家有沒有接上」在 CI 上零訊號。
    const { container } = render(<BrandShowcase product={{ ...base, brandSlug: 'rizoma' }} />);
    expect(container.querySelector('[data-testid="rizoma-showcase"]')).not.toBeNull();
  });

  it('🔵 負對照:未知品牌 ⇒ 什麼都不畫(而不是畫錯一家)', () => {
    // 🟢 這一格證明上面那格的 not.toBeNull() 有判別力 ——
    //    若 dispatcher 對任何 slug 都回同一個東西,這裡會紅。
    const { container } = render(
      <BrandShowcase product={{ ...base, brandSlug: 'zzq-not-a-brand' }} />,
    );
    expect(container.querySelector('[data-testid="rizoma-showcase"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });
});
