// @vitest-environment jsdom
//
// AccountView smoke test(g-1a 建、g-2 擴):會員中心殼 regression 安全網 + g-2 新增
// stats / featured prop forward + LINE 合成 email 過濾(server-side 完成、本檔驗收 client 渲染)。
//
// 驗:
// - design 字面 render 不報錯
// - acc-head:avatar 首字 / Hi name / displayEmail(空時 acc-email 不 render)
// - 7-tab nav 在場
// - 預設 overview render(g-1a stub 退場、g-2 真 OverviewTab + 三 stats / 訂單空 / 推薦空)
// - tab 切換純 client setState
// - 登出 button 在 form 內
// - g-2:LINE 合成 email 用戶(displayEmail = '')→ acc-email 整段不顯、displayName/avatar 不洩 raw
//
// mock '@/app/account/actions'(server action)+ next/navigation(useRouter)+ matchMedia polyfill。

import { afterEach, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// 🔴 2026-08-27 補 `useSearchParams`(主視窗;線1 停工時這支檔還沒跟上)。
//    `AccountView.tsx:169` 開始用它讀 `?tab=` ⇒ 這份 mock 少了那個 export
//    ⇒ 本檔 19 格全紅,訊息是 vitest 的「No "useSearchParams" export is defined」。
//    ⚠️ **這不是放寬斷言** —— 是讓假件跟上被測元件真的用到的東西;19 格的斷言一字未動。
//    📌 而預設值給【空的】search params:本檔的既有斷言都建立在「沒有 ?tab= ⇒ 預設總覽」,
//       給 `?tab=` 反而會改掉它們要測的世界。
// 🔴🔴 **2026-08-27 code-reviewer M4 補**:~~原本給【固定空的】`new URLSearchParams()`~~
//    ⇒ 那讓 client 那一半【餵不進去】:想補「`?tab=orders` 首屏亮訂單」也沒有辦法。
//    ⇒ 而 client 那三件(`useState(initialTab)` / `useEffect` 跟隨 / `selectTab` 寫回)
//      **正是世界 A/B/C 真正靠的東西** —— server 那半只決定首屏。
//    ⇒ ⇒ 改成可變的,並在檔尾補兩格。
let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));
vi.mock('@/app/account/actions', () => ({
  logoutAction: vi.fn(),
}));
// g-4b:ProfileTab(AccountView 子元件)改 import updateProfileAction server action、
// transitively 拉 server-only(supabase/server)在 jsdom 會爆;mock 掉避免載真 server action
// (同 RegisterPage.test 處置;AccountView 預設 render overview、profile tab 不觸發、mock 不影響斷言)。
// g-5b:AddressTab 同理改 import addAddressAction server action(transitively server-only)→ mock 掉。
// g-5c:AddressTab 增 import update/deleteAddressAction(同 server-only)→ 一併 mock。
vi.mock('@/app/account/address/actions', () => ({
  addAddressAction: vi.fn(),
  updateAddressAction: vi.fn(),
  deleteAddressAction: vi.fn(),
}));
vi.mock('@/app/account/vehicle/actions', () => ({
  addVehicleAction: vi.fn(),
}));
vi.mock('@/app/account/profile/actions', () => ({
  updateProfileAction: vi.fn(),
}));

import { AccountView, type AccountViewProps } from './AccountView';
import { CartProvider } from '@/contexts/CartContext';
import type { FeaturedResult } from '@/lib/products';
import { toMoneyAmount, type OrderListItem } from '@pcm/domain';

// 測試用訂單(刻意非 design mock 字面 PCM-2026-0042;用 2099 年 + 中性值,避反洩 guard 混淆)
const SAMPLE_ORDERS: OrderListItem[] = [
  {
    id: 'ord-1',
    displayId: 'PCM-2099-0001',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    total: { amount: toMoneyAmount(1234), currency: 'TWD' },
    itemCount: 3,
    cancelledAt: null,
    cancelKind: 'none' as const,
    itemCountTruncated: false,
    items: [],
  },
];

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(cleanup);

const EMPTY_FEATURED: FeaturedResult = { products: [], error: false };

function renderView(overrides: Partial<AccountViewProps> = {}) {
  const props: AccountViewProps = {
    user: { name: '王小明', displayEmail: 'wang@example.com' },
    stats: { tier: 'general', walletBalance: 0, orderCount: 0 },
    featured: EMPTY_FEATURED,
    // g-4a:profile prop 必填、預設與 user.name 同值(對齊 page.tsx Q4=A SoT、customers.name 為主)
    profile: { name: '王小明', phone: '', birthday: '', gender: '' },
    // g-5a:addresses prop 必填、預設空陣列(AddressTab 唯讀列表;切到 address tab 才渲染)
    addresses: [],
    // #202 解凍第一片:儲值金明細 prop 必填、預設空陣列 + 未失敗
    walletEntries: [],
    walletEntriesFailed: false,
    walletEntryTotal: 0,
    walletBalanceFailed: false,
    // g-6a:vehicles prop 必填、預設空陣列(VehiclesTab 唯讀列表;切到 vehicles tab 才渲染)
    vehicles: [],
    // M-3:orders prop 必填、預設空陣列(OrdersTab 全列 + OverviewTab slice(0,2) 最近訂單)
    orders: [],
    // M-4b #191:favorites prop 必填、預設空陣列(FavoritesTab 唯讀清單;切到 favorites tab 才渲染)
    favorites: [],
    ...overrides,
  };
  return render(
    <CartProvider>
      <AccountView {...props} />
    </CartProvider>,
  );
}

describe('AccountView(會員中心殼 g-1a + g-2 真資料)', () => {
  it('render acc-head:avatar 首字 + Hi name + displayEmail', () => {
    renderView();
    expect(screen.getByText('王')).toBeTruthy();
    expect(screen.getByText('Hi, 王小明')).toBeTruthy();
    expect(screen.getByText('wang@example.com')).toBeTruthy();
  });

  it('7-tab nav 全在場(對齊 design 字面)', () => {
    renderView();
    for (const label of ['總覽', '訂單記錄', '儲值金', '收藏清單', '我的愛車', '收件地址', '個人資料']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('預設顯示 overview(g-2 真 OverviewTab 退場 g-1a stub、見 acc-stats Member tier)', () => {
    const { container } = renderView();
    // g-2:overview 渲染 acc-stats 三卡(Member tier / Stored value / Total orders)
    expect(container.querySelector('[data-tab="overview"]')).toBeTruthy();
    expect(container.querySelector('.acc-stats')).toBeTruthy();
    expect(screen.getByText('Member tier')).toBeTruthy();
    // 確認 g-1a stub 字面退場
    expect(container.querySelector('.acc-stub[data-tab="overview"]')).toBeNull();
  });

  it('點「訂單記錄」→ 切到 orders tab、overview 退場(純 client setState)', () => {
    const { container } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /訂單記錄/ }));
    expect(container.querySelector('[data-tab="orders"]')).toBeTruthy();
    expect(container.querySelector('[data-tab="overview"]')).toBeNull();
    expect(screen.getByText('目前尚無訂單紀錄')).toBeTruthy();
  });

  it('登出 button 在 form 內(server action 觸發、非 client signOut)', () => {
    renderView();
    const logoutBtn = screen.getByRole('button', { name: '登出' });
    expect(logoutBtn).toBeTruthy();
    expect(logoutBtn.closest('form')).toBeTruthy();
  });

  it('profile.name 空時退化:avatar 走 displayEmail 首字、Hi 顯 email、acc-email 仍 render(g-4a Q4=A:displayName 用 profile.name 為主)', () => {
    renderView({
      user: { name: '', displayEmail: 'wang@example.com' },
      profile: { name: '', phone: '', birthday: '', gender: '' },
    });
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.getByText('Hi, wang@example.com')).toBeTruthy();
    expect(screen.getByText('wang@example.com')).toBeTruthy();
  });

  it('profile.name + displayEmail 皆空 → avatar=P / Hi=PCM 會員 / acc-email 不 render', () => {
    const { container } = renderView({
      user: { name: '', displayEmail: '' },
      profile: { name: '', phone: '', birthday: '', gender: '' },
    });
    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.getByText('Hi, PCM 會員')).toBeTruthy();
    expect(container.querySelector('.acc-email')).toBeNull();
  });

  it('LINE 合成 email 用戶(displayEmail=空、profile.name 有):displayName 用 profile.name、acc-email 不顯', () => {
    // 真實情境:LINE 用戶 page.tsx 過濾後 displayEmail=''、profile.name = customers.name(trigger 已從
    // user_metadata.name 同步寫入 LINE 顯示名;g-4a Q4=A SoT)
    const { container } = renderView({
      user: { name: 'LINE 太郎', displayEmail: '' },
      profile: { name: 'LINE 太郎', phone: '', birthday: '', gender: '' },
    });
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.getByText('Hi, LINE 太郎')).toBeTruthy();
    expect(container.querySelector('.acc-email')).toBeNull();
    // 確認 raw LINE 合成 email 不出現在任何地方(防 codex round2 M-r2-2:name 空時 raw email 洩)
    expect(container.textContent).not.toContain('line.pcmmotorsports.local');
  });

  it('stats forward to OverviewTab:tier=premiumStore 顯 PREMIUM STORE badge + 餘額', () => {
    renderView({ stats: { tier: 'premiumStore', walletBalance: 12500, orderCount: 0 } });
    expect(screen.getByText('PREMIUM STORE')).toBeTruthy();
    expect(screen.getByText('NT$ 12,500')).toBeTruthy();
  });

  it('featured forward to OverviewTab:0 商品 → 推薦空狀態「即將上架」', () => {
    renderView({ featured: { products: [], error: false } });
    expect(screen.getByText('推薦商品即將上架')).toBeTruthy();
  });

  it('featured error → 推薦載入失敗字面', () => {
    renderView({ featured: { products: [], error: true } });
    expect(screen.getByText('推薦商品載入失敗、請稍後再試')).toBeTruthy();
  });

  it('M-3:orders forward → 切 orders tab 顯真清單(displayId / 狀態中文 / 金額)', () => {
    renderView({ orders: SAMPLE_ORDERS });
    fireEvent.click(screen.getByRole('button', { name: /訂單記錄/ }));
    expect(screen.getByText('PCM-2099-0001')).toBeTruthy();
    expect(screen.getByText('處理中')).toBeTruthy(); // paid + shipped → A9f row47 固定「處理中」
    expect(screen.getByText('NT$ 1,234')).toBeTruthy();
  });

  it('M-3 Q5=A:orders forward → overview 最近訂單 preview 顯該單(與 orderCount 同源)', () => {
    renderView({ orders: SAMPLE_ORDERS });
    // 預設 overview:最近訂單段渲染 recentOrders(slice 0,2)而非空狀態
    expect(screen.getByText('PCM-2099-0001')).toBeTruthy();
  });

  /* ══ #202 解凍第一片:四個 wallet prop 的【轉交】 ══════════════════════════════
   *
   * 🔴 上面每一格都停在 overview / orders —— **沒有一格切到 wallet tab**
   *    ⇒ 四條線任一條接錯(`loadFailed` 接到 `balanceFailed`、`total` 忘了傳…),
   *      `WalletTab.test.tsx` 照樣全綠(它直接餵 prop、跳過這一層),
   *      `page.test.tsx` 也照樣全綠(它只驗到 `AccountView` 的 props 物件為止)。
   *    📌 **兩支測試各自完整,而中間那一段接線沒有人量。**(code-reviewer R1)
   * ══════════════════════════════════════════════════════════════════════════ */

  const toWallet = () => fireEvent.click(screen.getByRole('button', { name: /儲值金/ }));

  it('🔴 前提:切到 wallet tab 真的切得過去(它若不成立,下面每一格都在對空 DOM 斷言)', () => {
    const { container } = renderView();
    toWallet();
    expect(container.querySelector('.wal-tab')).toBeTruthy();
  });

  it('🔴 `stats.walletBalance` 轉交成 WalletTab 的 `balance`', () => {
    const { container } = renderView({ stats: { tier: 'general', walletBalance: 27600, orderCount: 0 } });
    toWallet();
    expect(container.querySelector('.wal-balance-num')?.textContent).toBe('27,600');
  });

  it('🔴 `walletEntries` 轉交成 `entries`(接錯 = 客人看到空白而畫面不會紅)', () => {
    const { container } = renderView({
      walletEntries: [
        {
          id: 'w1',
          customerUserId: 'u1',
          entryDate: '2026-04-22',
          entryType: 'deposit',
          amount: 30000,
          note: '儲值 NT$ 30,000',
          relatedOrderId: null,
          createdAt: '2026-04-22T00:00:00Z',
        },
      ],
      walletEntryTotal: 1,
    });
    toWallet();
    expect(screen.getByText('儲值 NT$ 30,000')).toBeTruthy();
    expect(container.querySelector('.wal-tx-empty')).toBeNull();
  });

  it('🔴 `walletEntriesFailed` 轉交成 `loadFailed`,而**不是**接到餘額那條線', () => {
    // 🔴 **這一格的第一版是瞎的**(R1 抓到、我用真·雙向接反複跑確認):
    //    我原本斷 `textContent).toContain('讀不到')` —— 而畫面上有【兩句】含「讀不到」
    //    (`WalletTab` 的「交易紀錄暫時讀不到」與「餘額暫時讀不到」)⇒ 旗標接反時它照樣命中;
    //    第二道斷 `.wal-balance-num` 存在,而那個節點在 `balanceFailed` 世界【也還在】(裡面換成句子)
    //    ⇒ 兩道都過。**兩個旗標互換的世界裡,只有下一格會紅,這一格是綠的。**
    //    📌 而我在這裡寫過「兩格互為對照、單獨看任一格都還是綠的」—— **那句話本身是錯的**,
    //       它把「我這一格瞎了」寫成了「所以要成對看」,讀起來像設計、其實是缺陷。
    const { container } = renderView({ walletEntriesFailed: true, walletEntryTotal: null });
    toWallet();
    // 明細那一半失敗 ⇒ 走「讀不到」而**不是**空狀態「尚無交易紀錄」
    expect(container.textContent).toContain('交易紀錄暫時讀不到');
    expect(container.textContent).not.toContain('尚無交易紀錄');
    // 餘額那一半沒失敗 ⇒ `NT$` 前綴仍在(接反的話它會消失)
    expect(container.querySelector('.wal-balance-cur')).toBeTruthy();
  });

  it('🔴 `walletBalanceFailed` 轉交成 `balanceFailed`,而**不是**接到明細那條線', () => {
    const { container } = renderView({ walletBalanceFailed: true });
    toWallet();
    // 餘額那一半掛失敗 ⇒ **不得印那個數字**(印 0 就是顯示一個錯的金額)。
    // ⚠️ `.wal-balance-num` 這個節點【還在】,裡面換成一句話 ⇒ 要量的是 `NT$` 前綴不見了、
    //    而且那一格印的是句子不是數字。(我第一版對 `.wal-balance-num` 斷言 null,那是我量錯位置。)
    expect(container.querySelector('.wal-balance-cur')).toBeNull();
    expect(container.querySelector('.wal-balance-num')?.textContent).toBe('餘額暫時讀不到');
    // 而明細那一半沒失敗 ⇒ 走「真的沒交易」而不是「讀不到」
    expect(container.textContent).toContain('尚無交易紀錄');
  });

  it('🔴 `walletEntryTotal` 轉交成 `total` —— 截斷時「共 N 筆」的 N 來自它', () => {
    const { container } = renderView({
      walletEntries: [
        {
          id: 'w1',
          customerUserId: 'u1',
          entryDate: '2026-04-22',
          entryType: 'deposit',
          amount: 30000,
          note: '儲值 NT$ 30,000',
          relatedOrderId: null,
          createdAt: '2026-04-22T00:00:00Z',
        },
      ],
      walletEntryTotal: 57,
    });
    toWallet();
    // 🔴 斷在**那個節點的內文**,不是整頁 textContent —— 後者「57 印在哪都算過」。
    expect(container.querySelector('.wal-tx-head .ap-mono')?.textContent).toBe('1 / 57 ENTRIES');
    expect(container.querySelector('.wal-tx-more')?.textContent).toContain('共 57 筆');
  });
});

/**
 * 🔴🔴 **2026-08-27 code-reviewer M4:client 那一半的守門(本片之前是零覆蓋)。**
 *
 * ⚠️ **這兩格【證不到】的**:真瀏覽器裡 `history.replaceState` 有沒有真的同步
 *    Next 的 `useSearchParams` —— 那是整條世界 C 的承重前提,而 vitest 這裡是 mock。
 *    ⇒ **本節只證「元件自己那一半接對了」,不證「Next runtime 會配合」。**
 * 📌 而 jsdom 的 `window` 跨格共用 ⇒ 每格自己把 `mockSearchParams` 與 URL 重設,
 *    否則前一格點出來的 `?tab=` 會流進後面每一格(而今天沒有一格讀它 ⇒ 不會叫)。
 */
describe('AccountView · ?tab= 契約(client 那一半)', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    window.history.replaceState(null, '', '/account');
  });

  it('🔴 `?tab=orders` ⇒ 首屏就在訂單分頁(不是總覽)', () => {
    mockSearchParams = new URLSearchParams('tab=orders');
    const { container } = renderView();
    // 斷言用 `[data-tab=]`(與本檔既有那格同一把尺, 不另發明選擇器)
    expect(container.querySelector('[data-tab="orders"]')).toBeTruthy();
    expect(container.querySelector('[data-tab="overview"]')).toBeNull();
  });

  it('🔴 負對照:沒有 `?tab=` ⇒ 首屏是總覽(證明上一格不是恆真)', () => {
    const { container } = renderView();
    expect(container.querySelector('[data-tab="overview"]')).toBeTruthy();
    expect(container.querySelector('[data-tab="orders"]')).toBeNull();
  });

  it('🔴 `?tab=zzz`(不合法)⇒ 安靜落在總覽, 不報錯(Sean Q1 拍甲)', () => {
    mockSearchParams = new URLSearchParams('tab=zzz');
    const { container } = renderView();
    expect(container.querySelector('[data-tab="overview"]')).toBeTruthy();
  });

  it('🔴 點分頁 ⇒ 網址跟著變(Sean Q2 拍甲;世界 C 的必要條件)', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /儲值金/ }));
    expect(window.location.search).toBe('?tab=wallet');
  });
});
