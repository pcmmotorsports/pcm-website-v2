// @vitest-environment jsdom
//
// OverviewTab smoke + 字面對齊(g-2)。
//
// 驗:
// - 3 stats:Member tier(TierBadge)/ Stored value / Total orders
// - tier sub 字面 3 種(general/store/premiumStore 對齊 design L477-481)
// - 訂單空狀態(orderCount=0)字面
// - 為你推薦 3 分支:有商品 / 空 / error
// - 連結:onJumpToOrders / onJumpToWallet 觸發(纯 client setState)

import { afterEach, describe, expect, it, vi } from 'vitest';
// (2026-08-07 R-3:原本這裡還 import `node:fs` / `node:url` / `node:path` 去讀 `account.css`
//  現算 `.acc-rec` 欄數。那條「顯示筆數整除欄數」守門已隨版位改 rail 一起移除 ⇒ 四個 import
//  與它們的說明註解跟著清掉,不留無指涉的殘留。)
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CartProvider } from '@/contexts/CartContext';

// next/link mock(避免帶 router context)。
// 🔴 2026-08-07 R-3:消費者換人了 —— `OverviewTab` 自己已不再用 `Link`,
//    是它渲染的 `ProductRail`(「更多新品」那顆 CTA)在用,mock 仍然必要。
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OverviewTab } from './OverviewTab';
import type { FeaturedResult } from '@/lib/products';
import type { MockProduct } from '@/data/mock-products';
import { toMoneyAmount, type OrderListItem } from '@pcm/domain';
import { ORDER_ITEM_COUNT_TRUNCATED_NOTE } from '@/lib/account-order-copy';

afterEach(cleanup);

const EMPTY_FEATURED: FeaturedResult = { products: [], error: false };

// 測試用最近訂單(AccountView 已 slice(0,2) 傳入;此處直接給 ≤2 筆。中性值、非 design mock 字面)
const SAMPLE_RECENT: OrderListItem[] = [
  {
    id: 'ord-1',
    displayId: 'PCM-2099-0007',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    total: { amount: toMoneyAmount(12345), currency: 'TWD' },
    itemCount: 3,
    itemCountTruncated: false,
  },
];

// 2026-08-08 快速加購接線:`OverviewTab` 渲染的 `ProductRail` → `ProductCard` 從此吃
// `useCart()`,無 provider 會 throw(`CartContext.tsx:325-327`)。
// 本檔既有的 `renderTab`(:59-69)內部就是呼叫 `render(...)`,所以遮蔽這個名字同時涵蓋它,
// 呼叫端與斷言一字未動。
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

function renderTab(overrides: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  const props: React.ComponentProps<typeof OverviewTab> = {
    stats: { tier: 'general', walletBalance: 0, orderCount: 0 },
    featured: EMPTY_FEATURED,
    recentOrders: [],
    onJumpToOrders: vi.fn(),
    onJumpToWallet: vi.fn(),
    ...overrides,
  };
  return { ...render(<OverviewTab {...props} />), props };
}

describe('OverviewTab(g-2 真資料、對齊 design AccountPages.jsx L467-535)', () => {
  it('3 stats 卡(Member tier / Stored value / Total orders)字面', () => {
    renderTab();
    expect(screen.getByText('Member tier')).toBeTruthy();
    expect(screen.getByText('Stored value')).toBeTruthy();
    expect(screen.getByText('Total orders')).toBeTruthy();
    expect(screen.getByText('2024 年起累計')).toBeTruthy();
  });

  it('tier=general:badge 一般會員 + sub「一般會員價(升級需聯絡客服)」', () => {
    renderTab();
    expect(screen.getByText('一般會員')).toBeTruthy();
    expect(screen.getByText('一般會員價(升級需聯絡客服)')).toBeTruthy();
  });

  it('tier=store:badge 店家會員 + sub「已享店家經銷價」', () => {
    renderTab({ stats: { tier: 'store', walletBalance: 0, orderCount: 0 } });
    expect(screen.getByText('店家會員')).toBeTruthy();
    expect(screen.getByText('已享店家經銷價')).toBeTruthy();
  });

  it('tier=premiumStore:badge PREMIUM STORE + sub「已享 PREMIUM 經銷折扣」', () => {
    renderTab({ stats: { tier: 'premiumStore', walletBalance: 25000, orderCount: 3 } });
    expect(screen.getByText('PREMIUM STORE')).toBeTruthy();
    expect(screen.getByText('已享 PREMIUM 經銷折扣')).toBeTruthy();
    expect(screen.getByText('NT$ 25,000')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // orderCount 顯示
  });

  it('recentOrders 空:最近訂單顯示 acc-empty「目前尚無訂單紀錄」', () => {
    const { container } = renderTab({ recentOrders: [] });
    expect(screen.getByText('目前尚無訂單紀錄')).toBeTruthy();
    expect(container.querySelector('.acc-orders')).toBeNull();
  });

  it('M-3 Q5=A:recentOrders 有單 → 顯 preview 列表(.acc-order 無 -full、無詳情鈕、displayId / 狀態 / 金額)', () => {
    const { container } = renderTab({
      recentOrders: SAMPLE_RECENT,
      stats: { tier: 'general', walletBalance: 0, orderCount: 1 },
    });
    // preview 用 .acc-order(非 orders tab 的 .acc-order-full)
    expect(container.querySelectorAll('.acc-order')).toHaveLength(1);
    expect(container.querySelector('.acc-order-full')).toBeNull();
    // preview 不含「查看詳情」鈕(design overview preview L498-517 無)
    expect(container.querySelector('.acc-order-detail')).toBeNull();
    expect(screen.getByText('PCM-2099-0007')).toBeTruthy();
    expect(screen.getByText('處理中')).toBeTruthy(); // paid + shipped → A9f row47 固定「處理中」
    expect(screen.getByText('NT$ 12,345')).toBeTruthy();
    // overview preview meta 用「件」非「件商品」(對齊 design L508)
    expect(screen.getByText('2099-04-15 · 3 件')).toBeTruthy();
    // 有單時不顯空狀態
    expect(screen.queryByText('目前尚無訂單紀錄')).toBeNull();
  });

  it('「查看明細 →」點擊觸發 onJumpToWallet', () => {
    const { props } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /查看明細/ }));
    expect(props.onJumpToWallet).toHaveBeenCalledTimes(1);
  });

  it('「查看全部 →」點擊觸發 onJumpToOrders', () => {
    const { props } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    expect(props.onJumpToOrders).toHaveBeenCalledTimes(1);
  });

  it('featured 空:推薦顯「商品即將上架」', () => {
    renderTab({ featured: { products: [], error: false } });
    expect(screen.getByText('推薦商品即將上架')).toBeTruthy();
  });

  it('featured error:推薦顯「載入失敗、請稍後再試」', () => {
    renderTab({ featured: { products: [], error: true } });
    expect(screen.getByText('推薦商品載入失敗、請稍後再試')).toBeTruthy();
  });

  // 🔴 2026-08-06(Sean 拍板 Q1=A)選擇器連動:卡片由自刻的 `.acc-rec-item` 改成
  //    首頁 N°02 同一顆 `ProductCard`(`.pcard`)⇒ 本檔所有計數選擇器一起換。
  //    這不是「改期望值遷就實作」:數的是同一件事(畫了幾張卡),換的是卡片元件。
  it('featured 有商品:列 4 張 ProductCard + name + price + slug link', () => {
    const products: MockProduct[] = [
      { id: 1, slug: 'p-1', brand: 'BRAND1', name: '商品 A', fits: '通用', price: 1200, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
      { id: 2, slug: 'p-2', brand: 'BRAND2', name: '商品 B', fits: '通用', price: 3400, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
      { id: 3, slug: 'p-3', brand: 'BRAND3', name: '商品 C', fits: '通用', price: 5600, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
      { id: 4, slug: 'p-4', brand: 'BRAND4', name: '商品 D', fits: '通用', price: 7800, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
    ];
    const { container } = renderTab({ featured: { products, error: false } });
    const items = container.querySelectorAll('.pcard');
    expect(items.length).toBe(4);
    expect(screen.getByText('商品 A')).toBeTruthy();
    expect(screen.getByText('NT$ 1,200')).toBeTruthy();
    expect(screen.getByText('NT$ 7,800')).toBeTruthy();
    // slug link —— `ProductCard` 是把 `.pcard`(article)包在 `<Link>` 裡
    // (`ProductCard.tsx 的外層 Link(grep display: 'contents' 找、不引行號)`,`display:contents` 的外層 a)⇒ 從卡片往上找 anchor,
    // 不是直接讀 `.pcard` 的 href(自刻版那時 `.acc-rec-item` 本身就是 a)。
    expect(items[0]!.closest('a')?.getAttribute('href')).toBe('/products/p-1');
  });

  // 🔴 Sean 2026-08-06 拍板 Q1=A 的**不變量**:這一格用的必須是**首頁那顆共用商品卡**,
  //    不是本頁自刻的第二種卡。只斷言「有 4 張 .pcard」擋不住有人在本頁複製一份 pcard 樣式;
  //    這裡釘的是「卡片內容欄位齊」——品牌行 / 品名 / 適用車型 / 價格,
  //    正是舊自刻版缺掉、Sean 指出的那幾項(舊版只有品名 + 價格)。
  //    ⚠️ 它擋不住什麼:證得了結構欄位在,證不了顏色與版面(顏色在 `product-card.css`,
  //       要真瀏覽器量;本檔是 jsdom、不套 CSS)。
  it('🔴 用的是首頁同一顆 ProductCard —— 品牌行/適用車型/價格三欄都在(舊自刻版缺前兩項)', () => {
    const { container } = renderTab({
      featured: {
        products: [
          // 🔴 R1 nit:`fits` 不帶「適用」前綴 —— 元件自己會畫成「適用 {fits}」
          //    (`ProductCard.tsx` 的 `適用 {formatCardFits(...)}`),真資料也是
          //    「{廠牌} {車型代號}」或「通用款」(`lib/products.ts`)。帶前綴的 fixture 會畫出「適用 適用 …」。
          { id: 1, slug: 'p-1', brand: 'RIZOMA', name: '商品 A', fits: 'BMW HP2 Sport', price: 1200, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null },
        ],
        error: false,
      },
    });
    // 🔴 R1 nit 的精神保留、對象換掉:原本釘的是 `.acc-rec` 那層**版位格線**(它被刪掉的話卡片
    //    會變單欄直排,而只數 `.pcard` 的斷言全綠)。2026-08-07 R-3 版位由 grid 換成共用 rail
    //    ⇒ 對應的承重層變成 `.b-carousel-item`(軌道格),照樣要釘。
    expect(container.querySelector('.acc-rec'), 'grid 版位殘留 ⇒ R-3 應已整區換成 rail').toBeNull();
    expect(
      container.querySelector('.b-select-inset .b-carousel-item'),
      '軌道格 .b-carousel-item 沒了 ⇒ 卡片會失去橫捲版位;`.b-select-inset` 沒了 ⇒ rail 的 --ed-* token 全部無聲失效',
    ).not.toBeNull();
    const card = container.querySelector('.pcard');
    expect(card, '不是 ProductCard ⇒ 又長出第二種商品卡').not.toBeNull();
    expect(card!.querySelector('.pcard-brand')?.textContent, '缺品牌 mono 行').toBe('RIZOMA');
    expect(card!.querySelector('.pcard-name')?.textContent, '缺品名').toBe('商品 A');
    expect(card!.querySelector('.pcard-fits')?.textContent, '缺適用車型行(舊自刻版就是沒有這行)')
      .toContain('BMW HP2 Sport');
    // 價格走共用的 .price-main(顏色由 product-card.css 統一給,不再是本頁自刻的灰)
    expect(card!.querySelector('.price-main')?.textContent, '價格不是走共用的 .price-main')
      .toContain('1,200');
    // 反面:自刻版那組 class 一個都不許回來
    for (const dead of ['.acc-rec-item', '.acc-rec-img', '.acc-rec-name', '.acc-rec-price']) {
      expect(container.querySelector(dead), `自刻卡的 ${dead} 又出現了`).toBeNull();
    }
  });

  // ── 為你推薦顯示筆數 ──
  //
  // 🔴 2026-08-07 R-3:這裡原本有兩條守門,理由都是**版面**:
  //    ①「給滿 10 筆時只畫 8 筆」②「顯示筆數整除 `.acc-rec` 每個斷點的欄數」。
  //    兩條的共同前提是「這區是 grid、有列、最後一列會缺角」。
  //    ⇒ 本片把版位換成橫捲 rail,**rail 沒有列、不存在缺角** ⇒ 兩條的前提整個消失,
  //    連同 `ACCOUNT_REC_DISPLAY = 8` 一起移除。**是理由消失而作廢,不是被忘記。**
  //    接手的守門:`lib/products-featured-limit.test.ts`(取數必須 > 桌機軌道格數,格數由 CSS 現算)
  //    —— 首頁與本頁現在是同一顆 rail、同一個取數,那支一支就夠,本頁不需要再抄一份。
  //    這裡改守「不再截斷」這個新的不變量。
  describe('為你推薦顯示筆數(rail 全顯、不截斷)', () => {
    function manyProducts(n: number): MockProduct[] {
      return Array.from({ length: n }, (_, i) => ({
        id: i + 1, slug: `p-${i + 1}`, brand: `BRAND${i + 1}`, name: `商品 ${i + 1}`, fits: '通用',
        price: 1000 + i, origPrice: null, isNew: false, isSale: false, inStock: true,
        category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null,
      }));
    }

    it('🔴 給滿 10 筆(=取數上限)全部畫出來 —— 顯示層不再截斷', () => {
      const { container } = renderTab({ featured: { products: manyProducts(10), error: false } });
      expect(
        container.querySelectorAll('.pcard').length,
        '顯示層還在截斷 ⇒ 客人滑到底會少看到商品(截 8 那條拍板的理由已隨 grid 一起作廢)',
      ).toBe(10);
      // 首尾都在:證明不是「取前 N 筆」也不是「取後 N 筆」。
      expect(screen.getByText('商品 1')).toBeTruthy();
      expect(screen.getByText('商品 10')).toBeTruthy();
    });

    it('🔴 少量商品照樣全畫(不會反過來變成「一定要湊滿幾筆」)', () => {
      const { container } = renderTab({ featured: { products: manyProducts(2), error: false } });
      expect(container.querySelectorAll('.pcard').length).toBe(2);
    });
  });

  // 🔴🔴 `#636`(2026-08-18 W4 補)——**這條分支落地前本檔一格都沒有。**
  //    `itemCountTruncated` 在本檔只以 fixture 的 `false` 出現過(`:50`)⇒ 真值那一半
  //    **從來沒有被渲染過**。`OrdersTab` 有它的雙向格,而這裡沒有;同一個病、同一句文案,
  //    只有一面被守著 ⇒ 「? 件」在這一面可以壞掉而不會有任何東西紅。
  describe('🔴 `#636` itemCountTruncated ⇒ 件數印「?」', () => {
    const truncated = [{ ...SAMPLE_RECENT[0]!, itemCountTruncated: true }];

    it('🔴 旗標為真 ⇒ 印「? 件」,而那個少算的數字一個字都不出現', () => {
      renderTab({ recentOrders: truncated });
      expect(screen.getByText(/\? 件/)).toBeTruthy();
      expect(screen.queryByText(/3 件/), '少算的數字不得出現').toBeNull();
    });

    it('正向對照:旗標為假 ⇒ 「3 件」照常印(否則上一格靠「永遠印 ?」也能過)', () => {
      renderTab({ recentOrders: SAMPLE_RECENT });
      expect(screen.getByText(/3 件/)).toBeTruthy();
    });

    // 🔴 接線格:說明文字必須**就是**共用常數,不是就地另寫一句
    //    ——「請重新整理」正是這樣長回來的。
    it('🔴 說明文字 = 共用常數,而且印在【畫面上】不是 title 裡(`#639 甲`)', () => {
      // 期望值 2026-08-18 由「title 屬性」改成「畫面文字」——理由同 `OrdersTab.test.tsx` 同名那格:
      // 原本的斷言把「說明住在 title 裡」寫成了規格,而那正是 `#639` 立案的病。
      renderTab({ recentOrders: truncated });
      expect(screen.getByText(ORDER_ITEM_COUNT_TRUNCATED_NOTE)).toBeDefined();
    });

    it('🔴🔴 那段說明【不得】再掛回任何 `title` 屬性上(`#639` 這條病的定義)', () => {
      const { container } = renderTab({ recentOrders: truncated });
      const titles = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
      expect(titles).not.toContain(ORDER_ITEM_COUNT_TRUNCATED_NOTE);
    });
  });
});
