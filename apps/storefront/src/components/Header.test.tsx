// @vitest-environment jsdom
//
// Header smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「desktop / mobile 兩變體 render 不報錯」+ M-1-13e-b-2 cart badge 行為。
// useRouter 走 per-file vi.mock;Header useEffect 用 window.matchMedia、
// jsdom 無此 API → beforeAll 補 polyfill stub。
// useCart 必須 wrap <CartProvider>、否則 throw(M-1-13e-b 設計、防 Provider 漏裝)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

// hoisted stable push spy:供 nav 路由斷言(M-1-14e-f1-a D-f=A 會員圖示→/login)。
const { pushMock, authState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  authState: { session: null as { user: { id: string } } | null },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
// Header g-1b auth-state:mock browser supabase client。onAuthStateChange 同步 emit INITIAL_SESSION
// (可控 authState.session、預設未登入)→ 測試以 authState.session 切換登入態驗條件路由。
vi.mock('@/lib/supabase/browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        cb('INITIAL_SESSION', authState.session);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

import { Header } from './Header';
import { CartProvider } from '@/contexts/CartContext';

const STORAGE_KEY = 'pcm-cart-mock-v2';

beforeAll(() => {
  // jsdom 不實作 matchMedia、Header useEffect 會呼叫 → 補最小 stub
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

beforeEach(() => {
  window.localStorage.clear();
  pushMock.mockClear();
  authState.session = null; // 預設未登入(各測試自設登入態)
});

afterEach(cleanup);

function renderWithCart(ui: ReactElement) {
  return render(<CartProvider>{ui}</CartProvider>);
}

describe('Header', () => {
  it('should render the desktop header without crashing', () => {
    renderWithCart(<Header isMobile={false} />);
    expect(screen.getByAltText('PCM MOTOR PARTS')).toBeDefined();
    expect(screen.getByText('商品目錄')).toBeDefined();
  });

  it('should render the mobile header without crashing', () => {
    renderWithCart(<Header isMobile />);
    expect(screen.getByAltText('PCM MOTOR PARTS')).toBeDefined();
    expect(screen.getByLabelText('購物車')).toBeDefined();
  });

  // 🔴 0b 之前,「手機分支真的長得跟桌機不一樣」是靠上面兩條各自的 `getByText('PCM')` /
  //    `getByText('PCM MOTORSPORTS')` 偶然守住的 —— 那是**唯一**只在單一分支成立的字面。
  //    logo 換成同一張圖之後兩條的斷言在兩個分支都成立 ⇒ `isMobile` 三元寫反、
  //    或手機誤渲染桌機那棵樹,全檔仍會全綠。這條把兩棵樹的差別本身釘住。
  describe('兩個 DOM 分支不得長成同一棵', () => {
    it('桌機有導覽列與搜尋框、沒有手機專屬結構', () => {
      const { container } = renderWithCart(<Header isMobile={false} />);
      expect(container.querySelector('.pcm-nav'), '桌機少了導覽列').not.toBeNull();
      expect(container.querySelector('.pcm-search'), '桌機少了搜尋框').not.toBeNull();
      expect(screen.queryByLabelText('會員'), '桌機少了會員鈕').not.toBeNull();
    });

    it('手機沒有導覽列與搜尋框(有的話=誤渲染桌機那棵樹)', () => {
      const { container } = renderWithCart(<Header isMobile />);
      expect(container.querySelector('.pcm-nav'), '手機出現桌機導覽列 ⇒ isMobile 分支寫反了').toBeNull();
      expect(container.querySelector('.pcm-search'), '手機出現桌機搜尋框').toBeNull();
      expect(screen.queryByLabelText('會員'), '手機不該有會員鈕(手機走 TabBar)').toBeNull();
      expect(screen.getByLabelText('搜尋商品'), '手機少了搜尋鈕').toBeDefined();
    });
  });

  it('🔴 R2-3:桌機搜尋框有 aria-label「搜尋」(這欄沒有 <label>,少了它報讀器念不到)', () => {
    renderWithCart(<Header isMobile={false} />);
    const input = screen.getByLabelText('搜尋');
    expect(input.getAttribute('placeholder')).toBe('搜尋商品 / 車款 / 品牌...');
  });

  // 🔴 R2-3(第0批 0b)頁首 logo 守門。
  //   原本「logo 存在」是被上面兩條 smoke 的 `getByText('PCM MOTORSPORTS')` / `getByText('PCM')`
  //   偶然守住的 —— 換成圖檔後那兩個字面消失。不補這組的話,「圖檔路徑打錯 / 兩個 DOM 分支各指一張圖 /
  //   誤用 master 或 stacked 變體」全部不會有任何測試轉紅(破圖不會讓任何流程變紅,
  //   同 `BrandPageCraft.test.tsx:9` 那條教訓)。
  //   桌機與手機**必須是同一張** compact 變體:R2-3 表列頁首只給一個值,而真站 Header 是兩個
  //   DOM 分支 ⇒ 分支各改各的正是最容易漂的地方,所以兩個分支各跑一次同一組斷言。
  describe('頁首 logo(R2-3:compact-bicolor-on-light、桌機與手機同一張)', () => {
    for (const [name, isMobile] of [['桌機', false], ['手機', true]] as const) {
      it(`${name}分支:logo 是 compact-bicolor-on-light、包在連回首頁的 .pcm-logo 裡`, () => {
        const { container } = renderWithCart(<Header isMobile={isMobile} />);
        const link = container.querySelector('a.pcm-logo');
        expect(link, '.pcm-logo 連結不見了').not.toBeNull();
        expect(link!.getAttribute('href')).toBe('/');
        const img = link!.querySelector('img');
        expect(img, 'logo 沒有 <img>(退回文字了?)').not.toBeNull();
        expect(img!.getAttribute('src')).toBe('/pcm-compact-bicolor-on-light.png');
        expect(img!.getAttribute('alt')).toBe('PCM MOTOR PARTS');
        // 反面:堆疊版與單色 master / italian 版都不得出現在頁首
        //(R2-3 逐字:「原商品頁誤用 master 版」——那次就是換錯變體、沒人看得出來)。
        expect(img!.getAttribute('src'), '頁首用到了非 compact-bicolor 的變體')
          .not.toMatch(/stacked|master|italian/);
        // 寬高屬性要在,否則圖載入前那 34px 會塌成 0 高、整條頁首跳一下(CLS)。
        expect(img!.getAttribute('width'), '缺 width ⇒ 沒有 aspect-ratio 佔位').toBe('1259');
        expect(img!.getAttribute('height'), '缺 height ⇒ 沒有 aspect-ratio 佔位').toBe('656');
      });
    }
  });

  // 🔴 導覽列連結目的地守門。本測試把整組 href 鎖住,任何人改動導覽目的地都會當場轉紅、
  //   必須是刻意的。
  //   沿革:2026-07-22 因為 `/brands` route 不存在(客人按了吃 404)把「品牌」改指 `/products`;
  //   **D3c-3 那條 route 落地、D3c-4 進了 sitemap ⇒ D3c-5 改回 `/brands`**,前提消失。
  //   ⚠️ /install 與 /stores 目前**仍是已知死連結**(backlog #269、待 Sean 定內容),
  //      刻意鎖住現況以免被誤讀成「已修好」;#269 收斂時本測試會轉紅,那是預期的提醒。
  describe('導覽列連結目的地 (D3c-5 品牌改指 /brands + #269 現況鎖)', () => {
    it('每個導覽項目的 href 與預期一致,「品牌」指向已落地的 /brands', () => {
      const { container } = renderWithCart(<Header isMobile={false} />);
      const nav = container.querySelector('.pcm-nav') ?? container.querySelector('nav');
      const actual = Array.from(nav?.querySelectorAll('a') ?? []).map((a) => [
        a.textContent?.trim(),
        a.getAttribute('href'),
      ]);

      expect(actual).toEqual([
        ['商品目錄', '/products'],
        // 🔴 2026-08-03 Sean 拍 B 案「同落地+開燈」:非首頁一律 /products?pick=vehicle。
        //    本 case 沒帶 currentPage ⇒ 吃預設 'products' ⇒ 走這一支。首頁那一支見下一條測試。
        ['依車輛搜尋', '/products?pick=vehicle'],
        ['品牌', '/brands'], // ✅ D3c-3 落地、D3c-5 接回;與頁尾「品牌專區」同一個目的地
        ['新品', '/products?filter=new'],
        ['特價', '/products?filter=sale'],
        ['安裝預約', '/install'], // ⚠️ 已知死連結 = backlog #269
        ['合作店家', '/stores'], // ⚠️ 已知死連結 = backlog #269
      ]);
      // ⚠️ 這裡**刻意不再補一條「/brands 恰好出現一次」的反面斷言**(關卡2 R1 nit):
      //    上面那個整表 `toEqual` 已經嚴格蘊含它 —— 多寫一條看起來更保險、實際零判別力,
      //    而零判別力的斷言會讓人以為這一面被守著。真正該擔心的「有人改回 /products」
      //    由整表那條負責。
    });

    // 🔴 這條與上一條是**同一個 navItem 的兩個分支**,必須成對存在:
    //    只留上面那條,有人把三元運算子拿掉、寫死 ?pick=vehicle 也會全綠 ——
    //    而那會讓首頁的「依車輛搜尋」離開首頁再繞回目錄,可是 finder 就在同一頁下面。
    it('currentPage="home" 時「依車輛搜尋」維持同頁錨點 /#vehicle-finder', () => {
      const { container } = renderWithCart(<Header isMobile={false} currentPage="home" />);
      const nav = container.querySelector('.pcm-nav') ?? container.querySelector('nav');
      const vehicleLink = Array.from(nav?.querySelectorAll('a') ?? []).find(
        (a) => a.textContent?.trim() === '依車輛搜尋',
      );
      expect(vehicleLink?.getAttribute('href')).toBe('/#vehicle-finder');
    });
  });

  describe('會員圖示條件路由 (g-1b、#179 D-f 收尾)', () => {
    it('desktop 未登入 → 會員圖示點擊 → router.push(/login)', () => {
      renderWithCart(<Header isMobile={false} />);
      fireEvent.click(screen.getByLabelText('會員'));
      expect(pushMock).toHaveBeenCalledWith('/login');
    });

    it('desktop 已登入 → 會員圖示點擊 → router.push(/account)', () => {
      authState.session = { user: { id: 'u1' } };
      renderWithCart(<Header isMobile={false} />);
      // onAuthStateChange 同步 emit INITIAL_SESSION(已登入)→ isAuthed=true(render act 內 flush)
      fireEvent.click(screen.getByLabelText('會員'));
      expect(pushMock).toHaveBeenCalledWith('/account');
    });
  });

  describe('cart badge (M-1-13e-b-2)', () => {
    it('does not render .pcm-cart-dot when cart is empty (totalQty=0)', () => {
      renderWithCart(<Header isMobile />);
      // 既無預載 localStorage、initial state 與 hydration 後皆空 → dot 永不顯
      expect(document.querySelector('.pcm-cart-dot')).toBeNull();
    });

    it('renders .pcm-cart-dot with totalQty when localStorage has items (mobile)', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          { productId: 'p1', qty: 2, variantId: 'v-red' },
          { productId: 'p2', qty: 3, variantId: 'v-blue' },
        ])
      );
      renderWithCart(<Header isMobile />);
      // 等 CartProvider useEffect 從 localStorage 載入 → totalQty=5 → dot 顯 "5"
      await waitFor(() => {
        expect(screen.getByText('5')).toBeDefined();
      });
      const dot = document.querySelector('.pcm-cart-dot');
      expect(dot).not.toBeNull();
      expect(dot?.textContent).toBe('5');
    });

    it('renders .pcm-cart-dot with totalQty when localStorage has items (desktop)', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([{ productId: 'p1', qty: 7 }])
      );
      renderWithCart(<Header isMobile={false} />);
      await waitFor(() => {
        expect(screen.getByText('7')).toBeDefined();
      });
      const dot = document.querySelector('.pcm-cart-dot');
      expect(dot).not.toBeNull();
      expect(dot?.textContent).toBe('7');
    });
  });
});
