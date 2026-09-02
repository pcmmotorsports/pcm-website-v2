// @vitest-environment jsdom
//
// BrandShowcase dispatcher 守門 —— 2026-09-02 新增(`⟦f3-RIZOMASHOWCASE⟧` 那一片帶進來的)。
//
// 🔴🔴 **為什麼這支檔今天才出現**:改動前 `ls apps/storefront/src/components/BrandShowcase*.test.tsx`
//   ⇒ **查無**。⇒ 那個 switch 上架到第 17 家為止,**沒有任何一格在守「有沒有註冊進去」**。
//   ⇒ 🎯 而它壞掉的方式是:**畫面只是少一整區,不會報錯、不會紅、console 乾淨**。
//      —— 元件寫好了、測試全綠、而客人在商品頁上看不到它。
//
// 🛑 **本檔涵蓋 `rizoma`(第 18 家)與 `dbk`(第 19 家)兩格。已知未涵蓋:其餘 17 家的註冊**
//   ⇒ 補它們是另一件事,而它們今天同樣零守門。
//
// 🔴 **為什麼第 19 家非跟上這個前例不可**(2026-09-03 `-front` R1 F3 量到):
//   隔壁 `showcase-dispatch-coverage.test.ts` 那道閘**只認 import + `<X />` 兩件事**
//   ⇒ 實測把 `case 'dbk'` 改成 `case 'dbk-typo'`,那道閘**仍回 dispatched=true、照樣全綠**。
//   ⇒ 🎯 它擋得住「整個 case 被拿掉」,擋不住「case 標籤打錯字 / 接到別家的元件」——
//     而那兩種的畫面後果一模一樣:**客人少看到一整區,不報錯、不紅、console 乾淨。**

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { MOCK_PRODUCTS } from '@/data/mock-products';
import { BrandShowcase } from './BrandShowcase';

// 各家 showcase 都是重元件(影片 / IntersectionObserver / 大量標記)——
// 本檔只問「有沒有分派到」,不問「它畫了什麼」(那是各家自己那支 test 的事)。
vi.mock('./RizomaShowcase', () => ({
  RizomaShowcase: () => <div data-testid="rizoma-showcase" />,
}));
vi.mock('./DbkShowcase', () => ({
  DbkShowcase: () => <div data-testid="dbk-showcase" />,
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

  it('🔴 brandSlug=dbk ⇒ 分派到 DbkShowcase(第 19 家)', () => {
    // 🧬 突變:把 `case 'dbk'` 拿掉、或打成 'dbk-typo'、或接到 <RizomaShowcase /> ⇒ 這一格都必須紅。
    //    隔壁那道 dispatch 閘對後兩種是綠的(見檔頭)⇒ 只有這一格看得見「接對了沒」。
    const { container } = render(<BrandShowcase product={{ ...base, brandSlug: 'dbk' }} />);
    expect(container.querySelector('[data-testid="dbk-showcase"]')).not.toBeNull();
    // 🟢 同時釘住「沒有接到別家」—— 接到 RizomaShowcase 時上一行仍會紅, 而這一行說得出紅在哪
    expect(container.querySelector('[data-testid="rizoma-showcase"]')).toBeNull();
  });

  it('🔵 負對照:未知品牌 ⇒ 什麼都不畫(而不是畫錯一家)', () => {
    // 🟢 這一格證明上面那格的 not.toBeNull() 有判別力 ——
    //    若 dispatcher 對任何 slug 都回同一個東西,這裡會紅。
    const { container } = render(
      <BrandShowcase product={{ ...base, brandSlug: 'zzq-not-a-brand' }} />,
    );
    expect(container.querySelector('[data-testid="rizoma-showcase"]')).toBeNull();
    expect(container.querySelector('[data-testid="dbk-showcase"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });
});
