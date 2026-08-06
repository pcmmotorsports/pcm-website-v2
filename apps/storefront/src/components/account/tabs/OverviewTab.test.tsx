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
import { readFileSync } from 'node:fs';
// 🔴 jsdom 環境下的 `URL` 是 jsdom 自己那顆(不是 node 的)⇒ `readFileSync(new URL(...))` 會噴
//    「The URL must be of scheme file」。走 `fileURLToPath` + `join`(repo 既有 jsdom 測試同款)。
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// next/link mock(避免帶 router context;OverviewTab 只用 Link href)
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
  },
];

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
    // (`ProductCard.tsx:247-250`,`display:contents` 的外層 a)⇒ 從卡片往上找 anchor,
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
    // 🔴 R1 nit:`.acc-rec` 那層**版位格線**也要釘 —— 它被刪掉的話 8 張卡會變單欄直排,
    //    而只數 `.pcard` 的斷言全綠(卡片還在、只是排法崩了)。
    expect(container.querySelector('.acc-rec'), '版位格線 .acc-rec 沒了 ⇒ 卡片會單欄直排').not.toBeNull();
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

  // ── 為你推薦顯示筆數(Sean 2026-08-06 拍板 B、主視窗 `D-138-A`)──
  //
  // 🔴 為什麼上面那條擋不住:它只餵 4 筆。取數 `FEATURED_LIMIT` 已經是 10,
  //    4 筆的 fixture 讓任何「截幾筆」的規則都恆真 —— 把 `slice(0, 8)` 整條刪掉,
  //    上面那條照樣全綠。要測「截斷」就必須餵**多於截斷值**的資料。
  // 🔴 而且不寫死「8」當唯一答案:另一條釘的是「顯示數整除於每一個斷點的欄數」這個不變量
  //    (`styles/account.css` 的 `.acc-rec` 有四條 `repeat(N,…)`:桌機 4、手機 2)。
  //    有人把 grid 改成 3 欄,那條會轉紅告訴他 8 不再排得齊 —— 只斷言 `toBe(8)` 對那件事全盲。
  describe('為你推薦顯示筆數(4 的倍數、版面排得齊)', () => {
    function manyProducts(n: number): MockProduct[] {
      return Array.from({ length: n }, (_, i) => ({
        id: i + 1, slug: `p-${i + 1}`, brand: `BRAND${i + 1}`, name: `商品 ${i + 1}`, fits: '通用',
        price: 1000 + i, origPrice: null, isNew: false, isSale: false, inStock: true,
        category: '操控部品', color: 'silver', imgTone: 'cool', originalPrice: null, tierLabel: null,
      }));
    }

    it('🔴 給滿 10 筆(=取數上限)時只畫 8 筆 —— 4 欄 grid 不會留 4+4+2 的缺角', () => {
      const { container } = renderTab({ featured: { products: manyProducts(10), error: false } });
      const items = container.querySelectorAll('.pcard');
      expect(items.length, '顯示層沒有截斷 ⇒ 最後一列缺兩格(Sean 拍板 B 要求切齊)').toBe(8);
      // 截的是**尾巴**不是頭:第 1 筆還在、第 9 筆不在
      expect(screen.getByText('商品 1')).toBeTruthy();
      expect(screen.queryByText('商品 9'), '截錯段落(不是取前 8 筆)').toBeNull();
    });

    it('🔴 顯示筆數整除於 `.acc-rec` 每一個斷點的欄數(欄數從 CSS 現算、不寫死)', () => {
      const cssPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'styles', 'account.css');
      const css = readFileSync(cssPath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const cols = [...css.matchAll(/\.acc-rec\s*\{[^}]*?grid-template-columns:\s*repeat\(\s*(\d+)/g)]
        .map((m) => Number(m[1]));
      // 🔴 R1 nit:`cols.length > 0` 只擋「一條都沒解析到」,擋不住**部分解析**
      //    (`repeat(auto-fit,…)` 或某條被改寫成別的語法 ⇒ 那個斷點靜默漏掉、下面那圈少驗一個)。
      //    ⇒ 與「`.acc-rec {` 到底出現幾次」對帳:數量對不上就轉紅,而不是安靜地少驗。
      const declared = (css.match(/\.acc-rec\s*\{/g) ?? []).length;
      expect(declared, '`.acc-rec` 規則一條都沒有 ⇒ 選擇器被改名了').toBeGreaterThan(1);
      expect(cols.length, `解析到 ${cols.length} 條欄數、但 .acc-rec 規則有 ${declared} 條 ⇒ 有斷點沒被驗到`)
        .toBe(declared);
      const { container } = renderTab({ featured: { products: manyProducts(10), error: false } });
      const shown = container.querySelectorAll('.pcard').length;
      for (const n of cols) {
        expect(shown % n, `顯示 ${shown} 筆 ÷ ${n} 欄有餘數 ⇒ 那個斷點的最後一列會缺格`).toBe(0);
      }
    });

    it('🔴 不足 8 筆時全部畫出來(截斷不能反過來變成「一定要湊 8 筆」)', () => {
      const { container } = renderTab({ featured: { products: manyProducts(2), error: false } });
      expect(container.querySelectorAll('.pcard').length).toBe(2);
    });
  });
});
