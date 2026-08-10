// @vitest-environment jsdom
//
// MobileMenu 直接單元測試 — R1 FAIL 修復(2026-08-07)三條守門,各鎖唯一 anchor:
//
// MF1:面板必須 portal 到 document.body(不受 `.pcm-header` 的 backdrop-filter
//      containing block 裁切)。jsdom 不跑真版面(getBoundingClientRect 恆 0),
//      量不出「高度≈viewport」,改量結構代理:面板的直接父節點必須是 document.body。
//      拿掉 portal(面板 render 回 header 內)⇒ 這條轉紅、真瀏覽器那邊主對話另量高度。
//
// MF2:掛載看 UA、隱藏看 viewport 的錯位——平板 UA 拉寬會把面板鎖在開著的狀態。
//      本檔自帶可控 matchMedia mock,證明「viewport 變寬觸發 change」真的會關閉面板。
//
// MF3:Header.test.tsx 原本那條「讀自 navItems」測試其實只比對同檔硬編碼的期望值,
//      在 MobileMenu 內另寫一份同值清單一樣全綠。這裡改用 sentinel 值直接測
//      MobileMenu 本體:傳入明顯不是真資料的 navItems,面板渲染出的必須正是這些 sentinel
//      字面——另寫一份真資料硬編碼清單渲染不出 sentinel,會在此轉紅。

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobileMenu, type MobileMenuNavItem } from './MobileMenu';

beforeAll(() => {
  // jsdom 不實作 matchMedia、MobileMenu 的 MF2 effect 掛載時就會呼叫 → 補最小 stub
  // (與 Header.test.tsx 同款預設值,個別測試需要可控行為時在該測試內覆寫、事後還原)。
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

afterEach(cleanup);

const REAL_NAV: MobileMenuNavItem[] = [
  { id: 'catalog', label: '商品目錄', href: '/products' },
  { id: 'vehicle', label: '依車輛搜尋', href: '/products?pick=vehicle' },
  { id: 'brands', label: '品牌', href: '/brands' },
  { id: 'new', label: '新品', href: '/products?filter=new' },
  { id: 'sale', label: '特價', href: '/products?filter=sale', sale: true },
  { id: 'install', label: '安裝預約', href: '/install' },
  { id: 'stores', label: '合作店家', href: '/stores' },
];

function openMenu(navItems: MobileMenuNavItem[] = REAL_NAV) {
  render(<MobileMenu navItems={navItems} />);
  fireEvent.click(screen.getByLabelText('開啟選單'));
  const panel = document.querySelector('.pcm-menu-panel');
  expect(panel, '面板不存在').not.toBeNull();
  return panel as HTMLElement;
}

// 可控 matchMedia mock:只接管指定的 query 字串,其餘 fallback 用 beforeAll 的預設 stub。
// trigger() 模擬瀏覽器 resize 觸發的 'change' 事件。
function createControllableMatchMedia(query: string, initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const fallback = window.matchMedia;
  const mock = ((q: string) => {
    if (q !== query) return fallback(q);
    return {
      get matches() {
        return matches;
      },
      media: q,
      onchange: null,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    install: () => {
      window.matchMedia = mock;
    },
    restore: () => {
      window.matchMedia = fallback;
    },
    trigger: (nextMatches: boolean) => {
      matches = nextMatches;
      // act() 包住:listener 裡的 setOpen 是 React state 更新,不透過 fireEvent/RTL 的事件系統
      // 觸發、必須自己包 act 才會在下一行斷言前 flush(否則讀到更新前的 DOM)。
      act(() => {
        listeners.forEach((cb) => cb({ matches, media: query } as MediaQueryListEvent));
      });
    },
  };
}

describe('MobileMenu 直接單元測試(R1 修復守門)', () => {
  it('MF1:面板的直接父節點是 document.body(不是 Header 內的容器)——header.css 的 backdrop-filter 會讓 fixed 面板的 inset 量到 header padding box、不是 viewport', () => {
    const panel = openMenu();
    expect(
      panel.parentElement,
      '面板沒有掛到 body 下 ⇒ 拿掉 portal 會讓面板被祖先的 containing block 裁掉(真瀏覽器實測裁成 390×68)'
    ).toBe(document.body);
  });

  it('MF2:viewport 變寬(matchMedia (min-width:1080px) change → matches:true)→ 面板自動收起', () => {
    const mq = createControllableMatchMedia('(min-width: 1080px)', false);
    mq.install();
    try {
      const panel = openMenu();
      expect(panel.classList.contains('is-open'), '開啟後應該是 is-open').toBe(true);
      mq.trigger(true);
      expect(
        panel.classList.contains('is-open'),
        '拿掉 matchMedia 監聽會讓面板在拉寬後仍鎖在開著的狀態(平板 UA 拉寬鎖死頁面的根因)'
      ).toBe(false);
    } finally {
      mq.restore();
    }
  });

  it('MF3:面板渲染出的連結是傳入的 navItems(sentinel 值),不是另一份硬編碼清單', () => {
    const sentinel: MobileMenuNavItem[] = [
      { id: 'catalog', label: 'SENTINEL-A', href: '/sentinel-a' },
      { id: 'vehicle', label: 'SENTINEL-B', href: '/sentinel-b' },
      { id: 'brands', label: 'SENTINEL-C', href: '/sentinel-c' },
    ];
    const panel = openMenu(sentinel);
    // 只看「選購」+「服務」兩組(它們是 navItems 驅動);「帳戶」那組是元件內部
    // 查證得到的既有路由、刻意不吃 prop,不該用它來斷言 sentinel。
    const navDrivenGroups = Array.from(panel.querySelectorAll('.pcm-menu-group')).filter(
      (g) => g.querySelector('.pcm-menu-label')?.textContent !== '帳戶'
    );
    const links = navDrivenGroups.flatMap((g) =>
      Array.from(g.querySelectorAll('a')).map((a) => [a.textContent?.trim(), a.getAttribute('href')])
    );
    expect(links).toEqual([
      ['SENTINEL-A', '/sentinel-a'],
      ['SENTINEL-B', '/sentinel-b'],
      ['SENTINEL-C', '/sentinel-c'],
    ]);
    // 反面:在 MobileMenu 內另寫一份真資料硬編碼清單,渲染不出 sentinel 字面 ⇒ 這條轉紅。
    expect(links.map((l) => l[0])).not.toContain('商品目錄');
  });

  // 🔴 2026-08-11 #269-a 補:`sale?: boolean` → `is-sale` 這條樣式鉤子**原本沒有任何守門**。
  //    當時「特價」是唯一帶 `sale: true` 的導覽項,把它移除後我在 backlog 寫了
  //    「鉤子仍有測試覆蓋、恢復時不必重接樣式」—— **那句是假的**:全 repo 對
  //    `is-sale` / `pcm-nav-sale` 的斷言只剩 `Header.test.tsx` 那格的 `toEqual([])`,
  //    也就是**刪掉 `MobileMenu.tsx` 的 `className={item.sale ? 'is-sale' : undefined}`
  //    整套 6876 案照樣全綠**,那個承諾等於沒人守。(code-reviewer 抓到。)
  //    ⇒ 這一格用本檔既有的 `REAL_NAV` fixture(它仍帶一列 `sale: true`)把鉤子釘住:
  //    突變「拿掉那個 className 三元」⇒ 只有這一格紅。
  it('🔴 帶 sale:true 的項目要掛上 is-sale class(樣式鉤子的唯一守門、#269-a 補)', () => {
    // ⚠️ 本檔的 `openMenu()` 直接回 panel 元素(不是 `{ panel }`)—— 與 `Header.test.tsx`
    //    同名 helper 的回傳形狀不同。第一版我照 Header 那邊的形狀解構,typecheck 直接紅。
    const panel = openMenu();
    const saleLinks = Array.from(panel.querySelectorAll<HTMLAnchorElement>('a.is-sale')).map((a) =>
      a.textContent?.trim(),
    );
    expect(saleLinks, 'sale:true 的項目沒有掛 is-sale ⇒ 樣式鉤子斷了,而特價恢復時會靜默沒有樣式').toEqual(['特價']);
    // 反面:沒有 sale 標記的項目不得掛上(擋「全部都掛」那種恆真實作)。
    const catalog = Array.from(panel.querySelectorAll<HTMLAnchorElement>('a')).find(
      (a) => a.textContent?.trim() === '商品目錄',
    );
    expect(catalog?.className ?? '').not.toContain('is-sale');
  });
});
