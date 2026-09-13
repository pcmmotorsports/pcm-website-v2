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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import type { SidebarCounts } from '@/lib/layout/sidebar-counts';
import { AppSidebar, formatNavCount, railCountText } from './app-sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/orders' }));

// W1-077:三格數字接線之後,`mount()` 一律要帶 `counts`——**預設用「全部成功、無待辦」的樣本**,
// 因為那正是「留白 vs 讀取失敗」最容易混淆的一格(稿 `:288` 的量具論證,見下面「三態」那組測試)。
const SYNCED_COUNTS: SidebarCounts = {
  unorderedOrderCount: 0,
  refundExceptionCount: 0,
  refundExceptionTruncated: false,
  refundExceptionVerdictsUnavailable: false,
  outOfStockProductCount: 0,
  syncedAt: '2026-08-20T04:00:00.000Z', // 台北 12:00
};

const FAILED_COUNTS: SidebarCounts = {
  unorderedOrderCount: null,
  refundExceptionCount: null,
  refundExceptionTruncated: false,
  refundExceptionVerdictsUnavailable: false,
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
      <AppSidebar counts={counts} />
    </SidebarProvider>,
  );
}

describe('側欄常駐(2026-09-13 深夜:頂欄與切換鈕退場,稿 v22 沒有頂欄)', () => {
  // ⛔ ~~`#380` 收合 = 整條滑走(渲染驗)~~ / ~~Bug B 手機點 SidebarTrigger 開關 nav-rail~~ —— 兩組共 3 格移除:
  //    它們守的是「按下那顆鈕之後」的行為,而那顆鈕連同頂欄 2026-09-13 深夜一起拿掉了(Sean「整個頁面…都還沒到位」,
  //    稿 v22 沒有頂欄、側欄 fixed 常駐)。**不是改期望值遷就 code,是那個行為的對象沒有了。**
  //    `#380`(08-10 「整條滑走」)與 Bug B(08-24 手機開關)的根因鏈留在 git:`git show ca604c58d:<本檔>`。
  it('🔴 不管 SidebarProvider 的 open 是什麼,軌都在 —— 沒有鈕可切之後,收合狀態不能再從別的路(cmd+B)進得去', () => {
    mount(false);
    expect(screen.queryByTestId('nav-rail'), 'open=false 時軌不見了 ⇒ 收合那條路還活著,而沒有鈕能開回來').not.toBeNull();
    cleanup();
    mount(true);
    expect(screen.queryByTestId('nav-rail')).not.toBeNull();
  });

  it('🔴 手機也常駐(Sean 09-13 裁乙:員工幾乎不用手機 ⇒ 不為手機另設開關)', () => {
    const desktopInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    try {
      mount(true);
      expect(screen.queryByTestId('nav-rail'), '手機上軌不見了,而頂欄那顆鈕已經沒了 ⇒ 手機零導覽').not.toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: desktopInnerWidth, configurable: true });
    }
  });
});

describe('設定那一格(Sean 2026-08-20 拍板甲)', () => {
  // 🔴🔴 **本格的斷言方向被【翻過來】了,而它不是「改期望值去遷就 code」。**
  //    原本:「軌上【沒有】設定」(依定案稿 :357「不在軌上出現」)
  //    現在:「軌上【有】設定,而且點不動」—— **Sean 同日拍板甲,稿 :357 自此作廢。**
  //    📌 分辨:**行為被拍板改了 ⇒ 斷言跟著翻**;而 R4 的停止訊號是
  //       **code 壞了、我去改期望值遷就它** —— 兩者在 diff 上都是綠的。
  // 🔴 2026-09-13 晚 Sean 答甲(知情推翻 08-20 甲):「設定」從灰字點不動變成【可展開的群組表頭】。
  //    仍然不是 <a>(它不是頁面);點了展開 員工管理 / 供應商 / 優惠券 / 寄不出去的信(旗標開再多 操作紀錄)。
  it('🔴 「設定」在軌上【最下面】、不是 <a>、而它【點得動】:點一下展開群組,再點收起', () => {
    mount(true);
    const railNav = screen.getByTestId('nav-rail').querySelector('nav') as HTMLElement;
    const settings = within(railNav).getByText('設定');
    expect(settings.closest('a'), '設定不是頁面 ⇒ 不得是連結').toBeNull();
    const btn = settings.closest('button') as HTMLButtonElement;
    expect(btn, '設定是群組表頭 ⇒ 要是 <button>').not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('nav-rail-settings'), '預設收著').toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByTestId('nav-rail-settings');
    for (const label of ['員工管理', '供應商', '優惠券', '寄不出去的信']) {
      expect(within(group).queryByText(label), label).not.toBeNull();
    }
    fireEvent.click(btn);
    expect(screen.queryByTestId('nav-rail-settings'), '再點一次收起').toBeNull();
  });

  // 🏁 2026-09-14 Sean 拍 Q2 乙:操作紀錄常開(旗標退場)⇒ 群組打開【有】「操作紀錄」、排最後;軌上仍 5 項 + 設定(Q1 甲)。
  it('軌上 5 項 + 設定;群組打開有「操作紀錄」且排最後;退款異常不在軌上', () => {
    mount(true);
    const railNav = screen.getByTestId('nav-rail').querySelector('nav') as HTMLElement;
    for (const label of ['總覽', '訂單', '出貨清單', '客戶', '商品', '設定']) {
      expect(within(railNav).queryByText(label), label).not.toBeNull();
    }
    // 🔴 退款異常 2026-09-13 起不在側欄(Sean 答甲:計數搬到總覽,頁面仍在)—— 守「他推翻的東西沒被做回來」。
    expect(within(railNav).queryByText('退款異常')).toBeNull();
    fireEvent.click(within(railNav).getByText('設定'));
    const settingsLinks = [...railNav.querySelectorAll('#nav-rail-settings a')].map((a) => a.textContent?.trim());
    expect(settingsLinks[settingsLinks.length - 1]).toBe('操作紀錄');
    for (const label of ['員工管理', '供應商', '優惠券', '寄不出去的信', '操作紀錄']) {
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

  // ── 🔴 R1 MF3:第三態的量具(之前零覆蓋 —— 那個分支整段刪掉照樣全綠)──
  it('🔴 更正讀不到(而三格都讀到了)⇒ 軌底顯示「判定讀不到」,**不印時間戳**', () => {
    mount(true, { ...SYNCED_COUNTS, refundExceptionVerdictsUnavailable: true });
    const rail = screen.getByTestId('nav-rail');
    expect(
      rail.textContent,
      '那時退款那格是退化值(含已判定的)⇒ 印時間戳等於把一個退化值蓋章成事實',
    ).toContain('判定讀不到');
    expect(rail.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('🔴 它與「讀取失敗」是**兩句話**,不得合成一句(少一句 = 少一個世界)', () => {
    mount(true, { ...SYNCED_COUNTS, refundExceptionVerdictsUnavailable: true });
    expect(screen.getByTestId('nav-rail').textContent).not.toContain('讀取失敗');
  });

  it('負對照:旗標是 false 時**不得**出現那句話(否則它是恆真的裝飾)', () => {
    mount(true, SYNCED_COUNTS);
    expect(screen.getByTestId('nav-rail').textContent).not.toContain('判定讀不到');
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
      // 🔴 8 ⇒ 9:M-4b 券片 2b-2 加了「優惠券」那一格(`nav-items.ts`)。
      //    本數字**不是門檻, 是「軌上有幾格」** ⇒ 加一格就要同步 +1,
      // 🔴 9 ⇒ 10:M-4b ⟦b4-MAILDEAD⟧ 加了「寄不出去的信」那一格。
      //    而那正是這一格存在的意義(它看守的是「每一格都有那個 22px 數字位」)。
      // 🔴 10 ⇒ 11:2026-09-10 加了「出貨清單」那一格(Sean 逐字「最陽春的」那一頁)。
      //    🎯 而它【當場就紅了】—— 那正是這條斷言在做的事:加一格就要有人回來看一眼。
    ).toBe(6);
    // 🔴 2026-09-13 晚 11 ⇒ 6:Sean 答甲把 11 項收成 5 + 設定群組(表頭自己也帶一個空的數字位)。
    //    群組打開之後再多 4 ⇒ 10。這格仍然守「每一格都有那個 span」。
    fireEvent.click(within(railNav).getByText('設定'));
    // 🔴 10 ⇒ 11:2026-09-13 匯率進設定群組(4 → 5)。同上一句:加一格就要有人回來看一眼,而它當場紅了。
    // 2026-09-14:11 → 12(設定群組多了「操作紀錄」,Q2 乙常開)。
    expect(railNav.querySelectorAll('[data-testid="rail-count-slot"]').length).toBe(12);
    // 正對照:確實是那個數字位,不是隨便一個 span。
    // 🔴 2026-09-13 側欄換新版:~~`min-w-[22px]` 對齊位~~ ⇒ 數字改貼在中文右邊、空的用 `empty:hidden` 不佔寬,
    //    對齊改由 flex 置中負責 ⇒ **「每一格都有這個 span」仍然成立**(它是數字的載體、也是旁白的來源),
    //    而「22px 寬」那個規格作廢。⚠️ 這是設計改了(Sean 09-13「更新到新的版本」),不是把紅改綠。
    expect(slots[0]?.className).toContain('empty:hidden');
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
    openSettingsIfNeeded(label);
    const labelEl = within(railNav).getByText(label);
    // label 與 count slot 是兄弟 span,共同父層是 <a>/<span> 那個 RailCell 容器。
    // 🔴 不能用 `.closest('span.block')`:label 自己的 className 也帶 `block`
    //    (`mt-1 block text-center …`),`closest()` 連起點元素自己都算 ⇒ 會抓到 label 本身。
    //    改用 `aria-disabled` 挑出不可點那個 `<span>` 容器,可點的用 `<a>` 標籤本身。
    const cell = labelEl.closest('a, button') as HTMLElement;
    if (!cell) throw new Error(`找不到「${label}」對應的 RailCell 容器`);
    return cell;
  }
  // 設定群組裡的項目要先展開才在 DOM 上(2026-09-13 起);軌上那五項直接找得到。
  const openSettingsIfNeeded = (label: string) => {
    const railNav = screen.getByTestId('nav-rail').querySelector('nav') as HTMLElement;
    if (within(railNav).queryByText(label) === null && screen.queryByTestId('nav-rail-settings') === null) {
      fireEvent.click(within(railNav).getByText('設定'));
    }
  };

  it('正對照:{orders:12, refunds:3, products:0} ⇒ 畫面上恰好出現 "12" 與 "3",商品那格空白', () => {
    mount(true, {
      unorderedOrderCount: 12,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 0,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    const ordersSlot = railCellFor('訂單').querySelector('[data-testid="rail-count-slot"]');
    const productsSlot = railCellFor('商品').querySelector('[data-testid="rail-count-slot"]');
    expect(ordersSlot?.textContent).toBe('12');
    // 🔴 退款異常 2026-09-13 起不在側欄(Sean 答甲:計數搬到總覽、頁面仍在)⇒ 這一格的樣本從它換成商品。
    expect(screen.getByTestId('nav-rail').textContent).not.toContain('退款異常');
    // 🔴 0 ⇒ 空白,不是 "0"(稿 :287 的既有規格,formatNavCount 早已守;這裡驗的是接線沒有繞過它)。
    expect(productsSlot?.textContent).toBe('');
  });

  // ── 那顆數字在數什麼(2026-08-22 新增)────────────────────────────────
  // 成因:側欄寫「訂單 23」、清單寫「共 16 筆」,而畫面上沒有任何字說它們各自在數什麼。
  // 兩個數字**合法地在數不同的東西**(23=未訂貨 / 16=清單當下的篩選結果)⇒ 修的是「數字沒有名字」。
  // 🔴🔴 **只看【看得見】的那一列** —— `.sr-only` 那份要排除掉。
  //    第一版沒排除,而我後來加了一個 `.sr-only`「未訂貨 12 筆」給讀螢幕的人 ⇒
  //    **把看得見那一列整個拿掉,65 條全綠**。
  //    ⇒ 我加的無障礙文字,把我自己的視覺守門變成了恆真的。
  //    (今晚同款第二次:不是「我改了什麼」,是「我這一改還順便關掉了什麼」。)
  const visibleTextOf = (label: string) => {
    const cell = railCellFor(label).cloneNode(true) as HTMLElement;
    cell.querySelectorAll('.sr-only').forEach((n) => n.remove());
    return cell.textContent ?? '';
  };

  it('有數字的三格,中文標籤下面要【看得見】它在數什麼', () => {
    mount(true, {
      unorderedOrderCount: 12,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 5,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    expect(visibleTextOf('訂單')).toContain('未訂貨');
    expect(visibleTextOf('商品')).toContain('缺貨');
  });

  // 🔴 讀螢幕的人:原本那顆數字是 `aria-hidden`、沒 title、旁邊沒旁白 ⇒ **它對輔助工具不存在**。
  //    這條驗的是「聽得到,而且聽到的是一句完整的話」,不是一個裸數字。
  it('讀螢幕的人聽得到那顆數字,而且聽到的是【完整的一句】不是裸數字', () => {
    mount(true, {
      unorderedOrderCount: 12,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 5,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    const sr = railCellFor('訂單').querySelector('.sr-only');
    expect(sr?.textContent?.trim()).toBe('未訂貨 12 筆');
    // 負向對照:那個數字槽本身仍然是 aria-hidden(視覺版不該被唸第二次)
    const slot = railCellFor('訂單').querySelector('[data-testid="rail-count-slot"]');
    expect(slot?.getAttribute('aria-hidden')).not.toBeNull();
  });

  // 🔴 truncated 時唸出來要與看到的一致(都是 99+),不可以唸出那個看起來精確的假數字。
  // 🔴 2026-09-13 起唯一會 truncated 的那格(退款異常)不在側欄 ⇒ 這條規則改在【函式】上守。
  //    總覽頁接手那顆數字時要用同一支 railCountText(或同語意),不然 55 會印成精確值而真相 ≥56。
  it('railCountText:truncated=true ⇒ 一律 "99+";false ⇒ 照數字;0 / null ⇒ 空', () => {
    expect(railCountText(55, true)).toBe('99+');
    expect(railCountText(55, false)).toBe('55');
    expect(railCountText(0, false)).toBe('');
    expect(railCountText(null, true)).toBe('');
  });

  // 🔴 **限定詞被唸兩次**(2026-08-29 線D 真瀏覽器量到,三格全中):
  //    視覺那塊限定詞 `<span>` 少了 `aria-hidden` ⇒ 它與下面那句 sr-only 各唸一次。
  //    當場量到的字面(admin-probe 3051、`72aa7146` 之後):
  //      /orders                   ⇒「訂單未訂貨未訂貨 7 筆」
  //      /orders/refund-exceptions ⇒「退款異常卡住卡住 筆」
  //      /products                 ⇒「商品缺貨缺貨 1 筆」
  //    ⚠️ 而這【不是規格題】—— 元件註解本來就寫著「視覺那兩塊維持 aria-hidden」,
  //       數字那塊掛上了、限定詞那塊漏了 ⇒ **實作沒跟上它自己的註解**。
  //    📌 它只有【聽】得出來 ⇒ 看的人完全正常 ⇒ 沒有人會在畫面上撞到它。
  it('限定詞只被唸一次 —— 視覺那塊要 aria-hidden,否則與旁白重複', () => {
    mount(true, {
      unorderedOrderCount: 12,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 5,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    for (const [label, qualifier] of [
      ['訂單', '未訂貨'],
      ['商品', '缺貨'],
    ] as const) {
      const cell = railCellFor(label).cloneNode(true) as HTMLElement;
      // 螢幕閱讀器聽到的 = 全部文字扣掉 aria-hidden 的那些
      cell.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      const heard = cell.textContent ?? '';
      const times = heard.split(qualifier).length - 1;
      expect(times, `${label}:「${qualifier}」被唸 ${times} 次,聽到的是「${heard.trim()}」`).toBe(1);
    }
  });

  // 🔴 **`0` 那個世界**(同日同一發量到):`formatNavCount(0)` 回空字串是**規格**
  //    (稿 `:287` 逐字「0 不是資訊,只有非 0 才是」),而 sr-only 沿用同一支
  //    ⇒ 唸出來會是「卡住　　筆」——**一句沒有數字的話**。
  //    ⚠️ 而 `null`(讀取失敗)本來就被既有條件擋掉 ⇒ **只有 `0` 漏了**。
  //    🔴 分辨 0 與讀取失敗的訊號在**軌底同步行**(當場量過:那個 `<div>` 沒有 `aria-hidden`
  //       ⇒ 螢幕閱讀器讀得到)⇒ 所以 0 時整段不唸,與視覺一致。
  it('count 為 0 ⇒ 旁白整段不唸,不唸出一句沒有數字的話', () => {
    mount(true, {
      unorderedOrderCount: 12,
      refundExceptionCount: 0,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 0, // 🔴 樣本從退款異常換成商品(2026-09-13 退款異常不在側欄)⇒ 這一格才是那個 0
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    expect(railCellFor('商品').querySelector('.sr-only')).toBeNull();
    // 正向對照:同一發裡非 0 的那格【要】唸得出來 —— 少了它,把 sr-only 整個拿掉也會綠
    expect(railCellFor('訂單').querySelector('.sr-only')?.textContent?.trim()).toBe('未訂貨 12 筆');
  });

  // 🔴 負向對照:沒有這一條的話,上面那條在「每一格都無條件印限定詞」時照樣綠。
  it('沒有數字的格【不】印限定詞(否則九格會為了三格一起長高)', () => {
    mount(true, {
      unorderedOrderCount: 12,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 0, // ⇒ 商品那格數字是空白
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    // 商品:count=0 ⇒ 槽是空白, 但 count 不是 null ⇒ 限定詞【仍該在】(0 是一個答案, 不是沒答案)
    expect(visibleTextOf('商品')).toContain('缺貨');
    // 客戶 / 供應商 / 總覽:count 本身是 null ⇒ 不該有任何限定詞
    for (const label of ['客戶', '供應商', '總覽']) {
      const t = railCellFor(label).textContent ?? '';
      expect(t, `${label} 不該有限定詞`).not.toMatch(/未訂貨|待處理|缺貨/);
    }
  });

  // 🔴🔴 讀取失敗(count=null)⇒ 限定詞也要收起來。
  //    **這一條是突變測試逼出來的**:第一版只驗了「沒有限定詞表的格不印」,
  //    而那件事光靠 `qualifier !== undefined` 就成立 ⇒ 把 `count !== null` 那半拿掉
  //    **64 條全綠**。⇒ 那半當時是恆真的裝飾。
  //    語意:讀取失敗時印一個沒有數字的「未訂貨」,讀起來像「未訂貨(空)」= 一個假的答案。
  it('讀取失敗(count=null)⇒ 限定詞跟著收起來,不留一個沒有數字的名字', () => {
    mount(true, {
      unorderedOrderCount: null,
      refundExceptionCount: null,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: null,
      syncedAt: null,
    });
    for (const label of ['訂單', '商品']) {
      const t = railCellFor(label).textContent ?? '';
      expect(t, `${label} 讀取失敗時不該留著限定詞`).not.toMatch(/未訂貨|待處理|缺貨/);
    }
  });

  // ── 「設定」點不動, 而畫面上要說得出為什麼(2026-08-22)────────────────
  // 成因:`-3c` 量到那一格只靠【視覺】傳達「不能點」——
  //       滑鼠兩個訊號 / 觸控只剩顏色 / 🔴 讀屏零訊號(`#846`)。
  // ⚠️ 不動它在不在(Sean 08-20 拍板留著), 只加說明。
  // 🔴 2026-09-13 晚:原本這裡兩格守「設定要說得出為什麼點不動(三段)」與「不可以寫成還沒開放」。
  //    Sean 答甲把設定變成可展開群組 ⇒ **它現在點得動、也不再是「還沒做」** ⇒ 那兩段文案整個拿掉。
  //    這一格改守反面:那句「這一頁還沒做」**不得**再出現在設定那一格(留著 = 對員工說謊)。
  it('「設定」點得動之後,不得再帶「這一頁還沒做」那段文案', () => {
    mount(true);
    const t = railCellFor('設定').textContent ?? '';
    expect(t).not.toContain('這一頁還沒做');
    expect(t).not.toContain('還沒開放');
  });

  it('🔴 突變:把訂單改成 13 ⇒ 那一格必須跟著變(否則這組測試只是在驗「有數字」)', () => {
    mount(true, {
      unorderedOrderCount: 13,
      refundExceptionCount: 3,
      refundExceptionTruncated: false,
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 0,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    const ordersSlot = railCellFor('訂單').querySelector('[data-testid="rail-count-slot"]');
    expect(ordersSlot?.textContent).toBe('13');
    expect(ordersSlot?.textContent).not.toBe('12');
  });

  // 🔴 原本這裡兩格(truncated ⇒ 99+ / 對照 55)綁在退款異常那格的 DOM 上;2026-09-13 起它不在側欄,
  //    規則改由上面 `railCountText` 那格單元守(同一支函式、同兩個案例)。**不是刪守門,是換載體。**

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
      refundExceptionVerdictsUnavailable: false,
      outOfStockProductCount: 99,
      syncedAt: SYNCED_COUNTS.syncedAt,
    });
    for (const label of ['總覽', '客戶', '員工管理', '供應商', '設定']) {
      const slot = railCellFor(label).querySelector('[data-testid="rail-count-slot"]');
      expect(slot?.textContent, label).toBe('');
    }
  });
});
