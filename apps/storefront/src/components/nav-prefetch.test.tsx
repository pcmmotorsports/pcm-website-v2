// @vitest-environment jsdom
//
// 頁首、手機選單、頁尾的連結預先載入(2026-09-26 主視窗派工):
// Vercel 實測頁首頁尾那幾個不常點的頁面每小時各被預先抓約 500 次(多數來自爬蟲), 改成不預先載入。
// 🔴 承重點:把 `navPrefetch` 的清單拿掉任一條, 或頁尾 / 手機選單不再經過它, 這裡要紅。

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// 把 next/link 換成會把 prefetch 印在屬性上的 <a>, 才看得到實際傳了什麼。
vi.mock('next/link', () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: boolean; children: ReactNode }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

import { navPrefetch } from '@/lib/nav-prefetch';
import { HomeFooter } from './HomeFooter';
import { MobileMenu } from './MobileMenu';

afterEach(cleanup);

const OFF = ['/install', '/stores', '/info/shipping', '/terms', '/privacy', '/dealer-apply'];

describe('navPrefetch', () => {
  it('不常點的頁面、商品目錄與搜尋都不預先載入', () => {
    for (const href of [...OFF, '/products', '/products?filter=new', '/products?pick=vehicle', '/search']) {
      expect(navPrefetch(href), href).toBe(false);
    }
  });

  it('首頁、品牌頁與商品頁照 Next 預設', () => {
    for (const href of ['/', '/brands', '/products/rpm-dcc01', '/#vehicle-finder']) {
      expect(navPrefetch(href), href).toBeUndefined();
    }
  });
});

describe('頁尾', () => {
  it('不常點的六個連結都不預先載入, 品牌專區照舊', () => {
    const { container } = render(<HomeFooter />);
    for (const href of OFF) {
      const a = container.querySelector(`a[href="${href}"]`);
      expect(a, `頁尾找不到 ${href}`).not.toBeNull();
      expect(a?.getAttribute('data-prefetch'), href).toBe('false');
    }
    expect(container.querySelector('a[href="/brands"]')?.getAttribute('data-prefetch')).toBe('undefined');
  });
});

describe('手機選單', () => {
  it('安裝預約、合作店家不預先載入', () => {
    // jsdom 沒有 matchMedia, 選單掛載時會呼叫(同 MobileMenu.test.tsx 的最小 stub)。
    window.matchMedia ||= ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    render(
      <MobileMenu
        navItems={[
          { id: 'brands', label: '品牌', href: '/brands' },
          { id: 'install', label: '安裝預約', href: '/install' },
          { id: 'stores', label: '合作店家', href: '/stores' },
        ]}
      />,
    );
    for (const href of ['/install', '/stores']) {
      const a = document.body.querySelector(`a[href="${href}"]`);
      expect(a, `手機選單找不到 ${href}`).not.toBeNull();
      expect(a?.getAttribute('data-prefetch'), href).toBe('false');
    }
  });
});
