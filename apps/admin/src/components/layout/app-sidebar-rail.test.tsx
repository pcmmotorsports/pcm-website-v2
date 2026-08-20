// @vitest-environment jsdom
// app-sidebar-rail.test.tsx — 2026-08-20 新建(84px 軌)。
//
// 🔴🔴 **本檔存在的理由 = 補上 `app-sidebar.test.ts:193-195` 自陳擋不住的那三格。**
//    那支是**文字層**掃描,它逐字寫著擋不住:
//      ①收合動畫實際跑不跑得起來 ②收起後內容區有沒有真的拿回寬度 ③那顆鈕會不會被蓋住
//    而它給的理由是「vitest 的 `@` alias 指向 storefront,渲染 `<AppSidebar />` 進不去」——
//    🔴 **那個限制在 `#606`/`#612`(2026-08-17)已經修掉了**(見 `nav-items.ts:28` 那條 ⚠️)。
//    ⇒ 本檔改用**真的渲染**去守 `#380` 的行為,而不是守某一個字面。
//
// ⚠️ **本檔擋得住 / 擋不住**:
//    擋得住 —— 收合時軌整條不見、展開時回來、「設定」在軌上最下面且點不動、七項字面、數字規則。
//    🪦 ~~以及「設定在滑出清單裡」~~ —— 那塊清單 2026-08-20 已由 Sean 拍板拿掉。
//    **擋不住** —— 版面(84/236 的實際像素、覆蓋不推開)。jsdom 不做版面。
//      那三格要真瀏覽器,量測與期望值見本片 commit body。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import type { SidebarCounts } from '@/lib/layout/sidebar-counts';
import { AppSidebar, formatNavCount } from './app-sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/orders' }));

// W1-077:三格數字接線之後,`mount()` 一律要帶 `counts`——**預設用「全部成功、無待辦」的樣本**,
// 因為那正是「留白 vs 讀取失敗」最容易混淆的一格(稿 `:288` 的量具論證,見下面「三態」那組測試)。
const SYNCED_COUNTS: SidebarCounts = {
  unorderedOrderCount: 0,
  refundExceptionCount: 0,
  refundExceptionTruncated: false,
  outOfStockProductCount: 0,
  syncedAt: '2026-08-20T04:00:00.000Z', // 台北 12:00
};

const FAILED_COUNTS: SidebarCounts = {
  unorderedOrderCount: null,
  refundExceptionCount: null,
  refundExceptionTruncated: false,
  outOfStockProductCount: null,
  syncedAt: null,
};

// 🔴 jsdom **沒有** `matchMedia`,而 `SidebarProvider` 內部的 `useIsMobile` 會呼叫它
//    ⇒ 不塞這個,五格全部 throw,而**錯誤訊息長得像「元件壞了」**(今晚第二次撞到同一格:
//    `danger-zone-details.tsx` 那支也是)。
// ⚠️ 塞的是**桌機**(`matches: false`)—— 手機那半 Sean Q5 拍過「維持現狀」,不在本片射程。
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(open: boolean, counts: SidebarCounts = SYNCED_COUNTS) {
  return render(
    <SidebarProvider open={open} onOpenChange={() => {}}>
      <AppSidebar auditEnabled={false} counts={counts} />
    </SidebarProvider>,
  );
}

describe('#380 收合 = 整條滑走(而這一次是【渲染】驗的,不是字面)', () => {
  it('🔴 展開時軌在;收合時【整條不存在】—— 不是變窄、不是透明', () => {
    const { unmount } = mount(true);
    expect(screen.queryByTestId('nav-rail')).not.toBeNull();
    unmount();

    mount(false);
    // 🔴 `null` 才算數:`w-0` 或 `opacity-0` 都會讓這一格綠而 Sean 仍然看得到一條
    expect(screen.queryByTestId('nav-rail')).toBeNull();
  });

  it('🔴 收起後開得回來(收合不可逆 = 把員工鎖在收合狀態)', () => {
    const { unmount } = mount(false);
    expect(screen.queryByTestId('nav-rail')).toBeNull();
    unmount();
    mount(true);
    expect(screen.queryByTestId('nav-rail')).not.toBeNull();
  });
});

// 🔴🔴 **2026-08-20:本節原本有一格在斷言「設定在滑出清單裡,灰字＋未啟用」。**
//    **那一格刪掉了,而它【不是改期望值】—— 是它守的東西不存在了。**
//    Sean 看過線上版後拿掉整塊滑出清單 ⇒ 那一格斷言的容器沒有了。
//    📌 而這個分辨正是「**動驗證本身**」(R4 的停止訊號) 與「**移除已消失的斷言**」的差別:
//    前者是我改期望值去遷就壞掉的 code;後者是那個行為被拍板取消了。
//    ⏳ 而「設定」現在**不在任何地方** —— 甲(軌上加一格灰的)/乙(先拿掉) 等 Sean 答。
describe('設定那一格(Sean 2026-08-20 拍板甲)', () => {
  // 🔴🔴 **本格的斷言方向被【翻過來】了,而它不是「改期望值去遷就 code」。**
  //    原本:「軌上【沒有】設定」(依定案稿 :357「不在軌上出現」)
  //    現在:「軌上【有】設定,而且點不動」—— **Sean 同日拍板甲,稿 :357 自此作廢。**
  //    📌 分辨:**行為被拍板改了 ⇒ 斷言跟著翻**;而 R4 的停止訊號是
  //       **code 壞了、我去改期望值遷就它** —— 兩者在 diff 上都是綠的。
  it('🔴 「設定」在軌上【最下面】,而且【點不動】(沒有 <a>)', () => {
    mount(true);
    const railNav = screen.getByTestId('nav-rail').querySelector('nav') as HTMLElement;
    const settings = within(railNav).queryByText('設定');
    expect(settings, '稿 :357 已被 Sean 2026-08-20 拍板作廢 ⇒ 設定要在軌上').not.toBeNull();
    // 🔴 點不動 = 它不是連結。少了這一條，把它做成能點的也會全綠
    expect(
      settings?.closest('a'),
      '設定沒有任何頁面可去（nav-items:唯一去處已隨九碼退場下架）⇒ 不得是連結',
    ).toBeNull();
    // 位置：它必須是最後一格（在供應商之後）
    const labels = [...railNav.children].map((el) => el.textContent?.replace(/\s+/g, '').trim());
    expect(labels[labels.length - 1], '設定要排在軌上最下面').toContain('設定');
  });

  it('旗標關 ⇒ 軌上七項,且「操作紀錄」不出現(它預設關是機制,不是配置)', () => {
    mount(true);
    const railNav = screen.getByTestId('nav-rail').querySelector('nav') as HTMLElement;
    expect(within(railNav).queryByText('操作紀錄')).toBeNull();
    for (const label of ['總覽', '訂單', '退款異常', '客戶', '商品', '員工管理', '供應商']) {
      expect(within(railNav).queryByText(label), label).not.toBeNull();
    }
  });
});

// 🔴 這兩格是【本片自己漏掉的守門】,補於同日 —— 它們守的都是「看起來可以順手刪掉的東西」。
describe('稿指名的兩個承重細節(它們看起來都像垃圾)', () => {
  // 🔴 W1-077(2026-08-20)改寫:數字接線之後,「未接」那個佔位態不存在了 ——
  //    軌底同步行現在是**兩態**(成功=時間戳 / 失敗=「讀取失敗」),不是靜態文案。
  //    這一組守的仍是同一件事(稿 :288 的量具論證:留白不能跟「還沒算完」長得一樣),
  //    只是誠實邊界換了:現在的風險不是「印了假時間」,是「三格全掛時印出一個舊時間戳」。
  it('🔴 三格全部成功 ⇒ 軌底顯示「同步 HH:MM」(台北時間),不是「讀取失敗」', () => {
    mount(true, SYNCED_COUNTS);
    const rail = screen.getByTestId('nav-rail');
    expect(rail.textContent, 'syncedAt 有值時要印時間戳(稿 :288)').toContain('同步');
    expect(rail.textContent).toContain('12:00'); // SYNCED_COUNTS.syncedAt = 台北 12:00
    expect(rail.textContent).not.toContain('讀取失敗');
  });

  it('🔴 任一格讀取失敗(syncedAt=null)⇒ 軌底顯示「讀取失敗」,**不印時間戳**', () => {
    mount(true, FAILED_COUNTS);
    const rail = screen.getByTestId('nav-rail');
    expect(
      rail.textContent,
      '印一個時間會讓「留白」變成一句謊話:員工看到時間戳會讀成「這幾格今天沒事」,而事實是我們沒算過它',
    ).toContain('讀取失敗');
    expect(rail.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('🔴 每一格都有 22px 數字位(空的也要在,否則中文會對不齊)', () => {
    mount(true);
    const railNav = screen.getByTestId('nav-rail').querySelector('nav') as HTMLElement;
    const slots = railNav.querySelectorAll('[data-testid="rail-count-slot"]');
    // 🔴 **8 = 七項(旗標關) + 設定那一格**。
    //    ~~原本是 7~~ —— 2026-08-20 Sean 拍板把設定放上軌 ⇒ 它也需要那個位。
    //    ⚠️ **這次改期望值是合法的,而理由要說得出來**:
    //       設定那一格【沒有數字】,但它的中文一樣要置中 ⇒ 22px 位對它同樣承重。
    //       (若哪天有人主張「設定不必要那個位」,那是設計題,不是把 8 改回 7。)
    expect(
      slots.length,
      '稿 :384 逐字「數字位固定 22px 寬…1 到 99 都塞得下且不推擠中文」⇒ 拿掉這個空 span,有數字與沒數字的格子中文會對不齊',
    ).toBe(8);
    // 正對照:確實是那個寬度規格,不是隨便一個 span
    expect(slots[0]?.className).toContain('min-w-[22px]');
  });
});

describe('數字規則(逐字搬稿 :414)', () => {
  it.each([
    [0, ''],
    [1, '1'],
    [12, '12'],
    [99, '99'],
    [100, '99+'],
    [128, '99+'],
  ])('formatNavCount(%i) = "%s"', (input, expected) => {
    expect(formatNavCount(input)).toBe(expected);
  });
});

// W1-077 plan §5:「光驗有數字不夠,要驗數字錯的時候會紅」—— 逐格找到對應的 rail cell、
// 斷言它 textContent 恰好是餵進去的值,並附一發突變(改成別的值,同一格必須跟著變/紅)。
describe('W1-077:三格數字接線(正對照 + 突變)', () => {
  function railCellFor(label: string): HTMLElement {
    const railNav = screen.getByTestId('nav-rail').querySelector('nav') as HTMLElement;
    const labelEl = within(railNav).getByText(label);
    // label 與 count slot 是兄弟 span,共同父層是 <a>/<span> 那個 RailCell 容器。
    // 🔴 不能用 `.closest('span.block')`:label 自己的 className 也帶 `block`
    //    (`mt-1 block text-center …`),`closest()` 連起點元素自己都算 ⇒ 會抓到 label 本身。
    //    改用 `aria-disabled` 挑出不可點那個 `<span>` 容器,可點的用 `<a>` 標籤本身。
    const cell = labelEl.closest('a, span[aria-disabled]') as HTMLElement;
    if (!cell) throw new Error(`找不到「${label}」對應的 RailCell 容器`);
    return cell;
  }

  it('正對照:{orders:12, refunds:3, products:0} ⇒ 畫面上恰好出現 "12" 與 "3",商品那格空白', () => {
    mount(true, {
      unorderedOrderCount: 12,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      outOfStockProductCount: 0,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    const ordersSlot = railCellFor('訂單').querySelector('[data-testid="rail-count-slot"]');
    const refundsSlot = railCellFor('退款異常').querySelector('[data-testid="rail-count-slot"]');
    const productsSlot = railCellFor('商品').querySelector('[data-testid="rail-count-slot"]');
    expect(ordersSlot?.textContent).toBe('12');
    expect(refundsSlot?.textContent).toBe('3');
    // 🔴 0 ⇒ 空白,不是 "0"(稿 :287 的既有規格,formatNavCount 早已守;這裡驗的是接線沒有繞過它)。
    expect(productsSlot?.textContent).toBe('');
  });

  it('🔴 突變:把訂單改成 13 ⇒ 那一格必須跟著變(否則這組測試只是在驗「有數字」)', () => {
    mount(true, {
      unorderedOrderCount: 13,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      outOfStockProductCount: 0,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    const ordersSlot = railCellFor('訂單').querySelector('[data-testid="rail-count-slot"]');
    expect(ordersSlot?.textContent).toBe('13');
    expect(ordersSlot?.textContent).not.toBe('12');
  });

  it('🔴🔴 truncated=true ⇒ 退款異常強制顯示 "99+",不看 count 本身多小(W1-077 plan §8 M3)', () => {
    // 構造 W6 指名的失敗情境本身的一個代表值:count 落在 1-99 區間、但 truncated=true
    // (真實成因是 actionable/stuck 兩支各自的上限相加後仍 ≤99,例如 actionable=5、stuck=51=55)。
    mount(true, {
      unorderedOrderCount: 0,
      refundExceptionCount: 55,
      refundExceptionTruncated: true,
      outOfStockProductCount: 0,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    const refundsSlot = railCellFor('退款異常').querySelector('[data-testid="rail-count-slot"]');
    expect(
      refundsSlot?.textContent,
      'truncated=true 時 55 是一個看起來精確的假數字(真相 ≥56)⇒ 必須降級成 99+',
    ).toBe('99+');
  });

  it('✅ 正向對照:同樣 count=55 但 truncated=false ⇒ 顯示 "55"(否則上一格是恆真的)', () => {
    mount(true, {
      unorderedOrderCount: 0,
      refundExceptionCount: 55,
      refundExceptionTruncated: false,
      outOfStockProductCount: 0,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    const refundsSlot = railCellFor('退款異常').querySelector('[data-testid="rail-count-slot"]');
    expect(refundsSlot?.textContent).toBe('55');
  });

  it('讀取失敗(count=null)⇒ 那一格空白,與「0」畫面上一樣,差別在軌底同步行', () => {
    mount(true, FAILED_COUNTS);
    const ordersSlot = railCellFor('訂單').querySelector('[data-testid="rail-count-slot"]');
    expect(ordersSlot?.textContent).toBe('');
  });

  it('不放數字的五格(總覽/客戶/員工管理/供應商/設定)永遠空白,不受 counts 影響', () => {
    mount(true, {
      unorderedOrderCount: 99,
      refundExceptionCount: 99,
      refundExceptionTruncated: false,
      outOfStockProductCount: 99,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    for (const label of ['總覽', '客戶', '員工管理', '供應商', '設定']) {
      const slot = railCellFor(label).querySelector('[data-testid="rail-count-slot"]');
      expect(slot?.textContent, label).toBe('');
    }
  });
});
