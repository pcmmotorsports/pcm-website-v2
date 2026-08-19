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
//    擋得住 —— 收合時軌整條不見、展開時回來、「設定」不在軌上而在滑出清單裡、數字規則。
//    **擋不住** —— 版面(84/236 的實際像素、覆蓋不推開)。jsdom 不做版面。
//      那三格要真瀏覽器,量測與期望值見本片 commit body。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar, formatNavCount } from './app-sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/orders' }));

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

function mount(open: boolean) {
  return render(
    <SidebarProvider open={open} onOpenChange={() => {}}>
      <AppSidebar auditEnabled={false} />
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

describe('定案稿:設定不在軌上', () => {
  it('🔴 軌上【沒有】「設定」(稿 :357 逐字「不在軌上出現」)', () => {
    mount(true);
    const rail = screen.getByTestId('nav-rail');
    // 軌本身那一段 = <nav>;滑出清單是另一個容器,不能混在一起數
    const railNav = rail.querySelector('nav') as HTMLElement;
    expect(within(railNav).queryByText('設定')).toBeNull();
    // 正對照:軌上該有的那幾項在 ⇒ 證明我不是掃了一個空容器
    expect(within(railNav).queryByText('訂單')).not.toBeNull();
    expect(within(railNav).queryByText('退款異常')).not.toBeNull();
  });

  it('🔴 而「設定」在滑出清單裡,灰字＋「未啟用」', () => {
    mount(true);
    const rail = screen.getByTestId('nav-rail');
    expect(within(rail).queryByText('設定')).not.toBeNull();
    expect(within(rail).queryByText('未啟用')).not.toBeNull();
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
