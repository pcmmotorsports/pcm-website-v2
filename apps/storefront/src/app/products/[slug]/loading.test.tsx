// @vitest-environment jsdom
// 商品詳情頁 loading fallback 的守門。
//
// 🔴 **這一支釘的是【沒有什麼】,不是【有什麼】** —— 本檔存在的理由就是
//    「不要再帶著型錄骨架的 `<main>` 與 `<h1>全部商品</h1>` 進 PDP」。
// ⚠️ **而它證不到真正的病**:真正的病在【原始 HTML 同時有 fallback 與內容】,
//    那要 `curl` 才量得到,jsdom 這裡只看得到 fallback 自己。
//    ⇒ 📌 這一支守的是「fallback 自己乾不乾淨」,**不是**「整頁只有一個 main」。
//      整頁那一格的量法逐字寫在 `loading.tsx` 的檔頭,不要用這支測試代替它。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// 🔴 `screen` 查的是整個 `document.body`,不是這一次 `render` 的容器 ——
//    沒有 cleanup,第二個 `it` 會看到第一個 `it` 留下來的那份,錯訊逐字是
//    「Found multiple elements with the role "status"」。實測撞到過。
afterEach(cleanup);

vi.mock('@/components/Header', () => ({
  Header: ({ currentPage }: { currentPage?: string }) => (
    <header data-testid="pdp-loading-header" data-current-page={currentPage} />
  ),
}));

import ProductDetailLoading from './loading';

describe('ProductDetailLoading', () => {
  it('🔴 不得有 `<main>` 或 `<h1>` —— 有的話 PDP 的原始 HTML 又會變成兩個', () => {
    const { container } = render(<ProductDetailLoading />);
    expect(container.querySelectorAll('main'), '載入畫面又長出 <main> 了').toHaveLength(0);
    expect(container.querySelectorAll('h1'), '載入畫面又長出 <h1> 了').toHaveLength(0);
    // 🟢 正對照:這一份**真的有東西**被渲染出來 —— 否則上面兩條 0 只是「什麼都沒 render」。
    expect(container.querySelector('.pd-route-loading-spinner')).not.toBeNull();
  });

  it('🔴 反面:不得出現型錄那句「全部商品」', () => {
    const { container } = render(<ProductDetailLoading />);
    expect(container.textContent ?? '', '型錄的標題又跑回 PDP 了').not.toContain('全部商品');
  });

  it('報讀器知道在等,而轉圈本身是裝飾', () => {
    const { container } = render(<ProductDetailLoading />);
    const status = screen.getByRole('status', { name: '正在載入商品' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.pd-route-loading-spinner')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('頁首留著,導航當下不會整條閃掉', () => {
    render(<ProductDetailLoading />);
    expect(screen.getByTestId('pdp-loading-header').getAttribute('data-current-page')).toBe('catalog');
  });
});
