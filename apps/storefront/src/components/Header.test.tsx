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
  //   ✅ **2026-08-11 更正**:`/install` 與 `/stores` **已經不是死連結** ——
  //      2026-08-06 第2批已建這兩條路由(`app/install/page.tsx` / `app/stores/page.tsx`,
  //      渲染 `ComingSoon` 佔位頁,本片實查兩檔存在)。原本這裡寫「仍是已知死連結」,
  //      而下方 `:163-164` 已被同一片改成「已落地」⇒ **同檔自我矛盾**,由 code-reviewer 抓出。
  //      🔴 這是「改了摸到的那幾行、沒回頭掃同檔其他敘述」那一族(#269-a 自報)。
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
        // ⚠️ `?filter=new` **目前沒有任何地方在讀**(`parseCatalogQuery` 不認 `filter`)
        //    ⇒ 按下去是未篩選全目錄。真篩選 = #269-b(要動 RPC 投影帶 created_at)。
        ['新品', '/products?filter=new'],
        // 🔴 「特價」2026-08-11 移除(#269-a、Sean:概念還不存在)—— 這一行**刻意留成註解**,
        //    而不是無聲消失:整表 `toEqual` 是嚴格比對,誰把它加回來就必須先來這裡改,
        //    那時就會讀到「特價要等商品編輯後台」這個前提。
        // ['特價', '/products?filter=sale'],
        ['安裝預約', '/install'], // ✅ 已落地(第2批 ComingSoon 佔位頁),非死連結
        ['合作店家', '/stores'], // ✅ 同上
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

  // 手機選單 MobileMenu(OD `pcm-home-redesign/DESIGN-HANDOFF-2026-08-05.md` §十一)。
  // 補真站既有導航缺口:手機原本只有搜尋/logo/購物車,品牌/新品/特價/安裝預約/合作店家
  // 五條在手機上只剩頁尾能到。連結來源=Header 既有的 navItems(不另寫第二份清單)。
  describe('手機選單 MobileMenu(補真站導航缺口)', () => {
    // 與上面「導覽列連結目的地」測試同一份 navItems 現況(currentPage 預設 'products'),
    // 用來驗面板真的讀自 Header 的 navItems、不是另一份手寫清單。
    const EXPECTED_SHOP = [
      ['商品目錄', '/products'],
      ['依車輛搜尋', '/products?pick=vehicle'],
      ['品牌', '/brands'],
      ['新品', '/products?filter=new'],
      // 🔴 特價 2026-08-11 移除(#269-a);同上,留註解行讓恢復的人先讀到前提。
      // ['特價', '/products?filter=sale'],
    ];
    const EXPECTED_SERVICE = [
      ['安裝預約', '/install'],
      ['合作店家', '/stores'],
    ];
    const EXPECTED_ACCOUNT = [
      ['會員中心', '/account'],
      ['購物車', '/cart'],
      ['配送 & 退貨', '/info/shipping'],
    ];

    function openMenu() {
      const { container } = renderWithCart(<Header isMobile />);
      fireEvent.click(screen.getByLabelText('開啟選單'));
      // MF1 修復後面板 portal 到 document.body、不在 `container` 底下(container 是
      // RTL 掛 Header 樹的容器,面板已不是它的子孫)—— 查 document 才找得到。
      const panel = document.querySelector('.pcm-menu-panel');
      expect(panel, '面板不存在').not.toBeNull();
      return { container, panel: panel as HTMLElement };
    }

    function groupLinks(panel: HTMLElement, label: string) {
      const groups = Array.from(panel.querySelectorAll('.pcm-menu-group'));
      const group = groups.find((g) => g.querySelector('.pcm-menu-label')?.textContent === label);
      expect(group, `找不到「${label}」分組`).toBeDefined();
      return Array.from(group!.querySelectorAll('a')).map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    }

    it('桌機不渲染選單鈕(單元測試層可證;≥1080px 自動收起要靠真瀏覽器)', () => {
      renderWithCart(<Header isMobile={false} />);
      expect(screen.queryByLabelText('開啟選單'), '桌機不該有選單鈕').toBeNull();
      expect(document.querySelector('.pcm-menu-panel'), '桌機不該渲染選單面板').toBeNull();
    });

    it('390px:頁首左側有選單鈕,點了開全屏面板(OD 驗收 #1)', () => {
      const { panel } = openMenu();
      expect(panel.classList.contains('is-open')).toBe(true);
    });

    it('面板分三組(選購/服務/帳戶),每組有 mono 眉標(OD 驗收 #3)', () => {
      const { panel } = openMenu();
      const labels = Array.from(panel.querySelectorAll('.pcm-menu-label')).map((el) => el.textContent);
      expect(labels).toEqual(['選購', '服務', '帳戶']);
    });

    // 🔴 R1 更正(2026-08-07):本測試名原本宣稱「改成另寫清單…會在此轉紅」,但斷言只是
    //    拿 DOM 比對同檔硬編碼的 EXPECTED_SHOP/EXPECTED_SERVICE ——在 MobileMenu 內另寫一份
    //    同值的硬編碼陣列,本測試照樣全綠,守不住「同一份來源」。這條保留(它守的是 Header
    //    傳對值給 MobileMenu),但改用名實相符的標題;「連結真的來自 navItems 這份來源」的
    //    防線改在 `MobileMenu.test.tsx` 的 sentinel 測試(傳入明顯非真資料的 navItems)。
    it('選購+服務兩組連結的值與 Header navItems 一致(僅驗值對,非「來源」——來源防線見 MobileMenu.test.tsx sentinel 測試)', () => {
      const { panel } = openMenu();
      expect(groupLinks(panel, '選購')).toEqual(EXPECTED_SHOP);
      expect(groupLinks(panel, '服務')).toEqual(EXPECTED_SERVICE);
    });

    it('品牌/安裝預約/合作店家三條都看得到且可點(OD 驗收 #2)', () => {
      const { panel } = openMenu();
      const all = [...groupLinks(panel, '選購'), ...groupLinks(panel, '服務')];
      expect(all).toContainEqual(['品牌', '/brands']);
      expect(all).toContainEqual(['安裝預約', '/install']);
      expect(all).toContainEqual(['合作店家', '/stores']);
    });

    it('帳戶組 = 會員中心/購物車/配送&退貨,查證得到的既有路由(非 navItems)', () => {
      const { panel } = openMenu();
      expect(groupLinks(panel, '帳戶')).toEqual(EXPECTED_ACCOUNT);
    });

    // 🔴 原「特價那條有 is-sale 樣式標記(OD 驗收 #4)」2026-08-11 改寫(#269-a):
    //    特價那顆導覽項已移除(Sean 逐字:特價這個概念**還不存在**,要等商品編輯後台能設優惠價)
    //    ⇒ OD 驗收 #4 的**前提消失**,原斷言 `saleLinks === ['特價']` 恆假、不可能成立。
    //    ⚠️ **但不是刪掉就算了**:`sale?: boolean` → `is-sale` 這條樣式鉤子刻意保留
    //    (`Header.tsx` navItems 與 `MobileMenu.tsx:199`),特價回來時加一行即可、不必重接樣式。
    //    這一格改成釘「現在沒有任何一條掛 is-sale」——**偷偷把特價入口加回來會讓它轉紅**,
    //    於是恢復的人必然回到這裡、也必然讀到上面這段脈絡與 OD 驗收 #4 原本要求什麼。
    // ⚠️ 標題只講**手機面板**(`.pcm-menu-body`),因為這一格只查那個容器 —— 桌機 `.pcm-nav` 的
    //    `pcm-nav-sale` 不在本格觀察範圍(它由上面兩張整表 `toEqual` 覆蓋)。宣稱不要大於量到的面。
    it('🔴 手機面板目前沒有任何項目掛 is-sale(特價入口已移除;要恢復請連這格一起改)', () => {
      const { panel } = openMenu();
      const saleLinks = Array.from(panel.querySelectorAll('.pcm-menu-body a.is-sale')).map((a) => a.textContent?.trim());
      expect(saleLinks, '有東西掛上 is-sale ⇒ 特價入口被加回來了?請連帶恢復 OD 驗收 #4 那組斷言').toEqual([]);
      const allLinks = Array.from(panel.querySelectorAll('.pcm-menu-body a')).map((a) => a.textContent?.trim());
      expect(allLinks).not.toContain('特價');
      expect(allLinks.length).toBe(9); // 4 選購(原 5 扣特價)+2 服務+3 帳戶 = 9
    });

    it('底部有熔橘 LINE 鈕(連真 site-config LINE_ADD_URL)與門市地址(OD 驗收 #6)', () => {
      const { panel } = openMenu();
      const lineLink = panel.querySelector('.pcm-menu-line');
      expect(lineLink, '找不到 LINE 鈕').not.toBeNull();
      expect(lineLink!.getAttribute('href')).toBe('https://lin.ee/R6QZUH2');
      const store = panel.querySelector('.pcm-menu-store');
      expect(store?.textContent).toContain('新北市新莊區化成路736巷18號1樓');
      expect(store?.textContent).toContain('週一-週六 10:00-19:00');
    });

    it('按 Esc 會收起(OD 驗收 #7、真 keydown handler)', () => {
      const { panel } = openMenu();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(panel.classList.contains('is-open')).toBe(false);
    });

    // 🔴 真瀏覽器實測補的洞(2026-08-06,390px):OD §十一 把「焦點管理」列為選單行為之一,
    //    但第一版收起後 `document.activeElement` 不是開啟鈕 ⇒ 鍵盤/讀屏使用者掉回文件開頭。
    //    這條釘住「收起後焦點交還」——拿掉 cleanup 裡那行 focus() 就會紅。
    it('收起後焦點交還開啟鈕(a11y;OD §十一「焦點管理」)', () => {
      openMenu();
      const openBtn = screen.getByLabelText('開啟選單');
      expect(document.activeElement, '開啟時焦點應在面板內、不在開啟鈕上').not.toBe(openBtn);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.activeElement, '收起後焦點沒回到開啟鈕 ⇒ 鍵盤使用者失去位置').toBe(openBtn);
    });

    it('點關閉叉會收起(OD 驗收 #7)', () => {
      const { panel } = openMenu();
      fireEvent.click(screen.getByLabelText('關閉選單'));
      expect(panel.classList.contains('is-open')).toBe(false);
    });

    it('點任一連結會收起(OD 驗收 #7、真 handler 非假 handler)', () => {
      const { panel } = openMenu();
      const brandLink = Array.from(panel.querySelectorAll('a')).find((a) => a.textContent?.trim() === '品牌');
      expect(brandLink, '找不到品牌連結').toBeDefined();
      fireEvent.click(brandLink!);
      expect(panel.classList.contains('is-open')).toBe(false);
    });

    it('面板開著時背景鎖捲、關閉後解鎖(OD 驗收 #8)', () => {
      const { panel } = openMenu();
      expect(document.body.classList.contains('pcm-menu-lock')).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(panel.classList.contains('is-open')).toBe(false);
      expect(document.body.classList.contains('pcm-menu-lock')).toBe(false);
    });
  });
});
