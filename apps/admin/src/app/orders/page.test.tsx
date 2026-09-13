// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 本頁的核心交付 = **Sean Q1=A 的「明示、不默默降級」**。
// ⚠️ #347-B(codex R2 nit):承載體**已換人** —— 原本是 A10c2 供應商單號的三種 invalid 訊息
//    與 `TooManyError` 分流,那些連同兩個專用搜尋欄一起退場(下方 81-87 行明載)。
//    現在承載它的是「刷卡未付款被藏起來」提示 + 供應商三態的恆 null 渲染。
// 🔴 這一整層原本零測試(階段 C must-fix 4):把 `instanceof` 換成別的判斷、
//    或 adapter 改成不再擲 `TooManyError`,分流會**靜默退化成通用錯誤態**而三綠全綠。
//
// repository getter 會拉 server-only 模組 ⇒ 整支 mock(同 refund-exceptions/page.test.tsx 紀律)。
// 🔴 本片同時把 `page.tsx` 的 `@/…` import 改成相對路徑:根 `vitest.config.ts:27` 的 `@` alias
//    指向 **storefront** 的 src,admin 檔案用 `@/` 在 vitest 裡 resolve 不到。姊妹頁
//    `refund-exceptions/page.tsx` 本來就用相對路徑 —— 這頁用 `@/` 只是因為它從來沒有測試。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
// 🆕 P-d:`?open=` 不在這一頁時的存在檢查走 `findAdminOrderDetail` ⇒ 一起 mock(預設查無)。
const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
const cookieState = vi.hoisted(() => ({ keyword: undefined as string | undefined }));
// 🆕 P-e-2:「跟供應商下訂」body 會 await `listSuppliers()` ⇒ 一起 mock(空清單就夠,本檔只驗殼與 body 有沒有接上)。
vi.mock('../../lib/supplier', async (importOriginal) => ({
  // 🔴 保留真模組、只換會打 DB 的那支(同本檔對 next/navigation 的做法): 是純函式,換掉它沒有意義。
  ...(await importOriginal<typeof import('../../lib/supplier')>()),
  listSuppliers: vi.fn(async () => []),
}));
// 🆕 收款欄可點:pay body 會 await `listOrderPayments`(打 RPC)⇒ mock 成「讀得到、零筆」。
vi.mock('../../lib/orders/payment-repository', () => ({ listOrderPayments: vi.fn(async () => []) }));
// 🆕 pay body 同時打 `pcm_order_refundable_remaining`(算已退)⇒ mock 成「查到、未登記額 = 整張」(= 零退款)。
// 🔴 保留真模組、只換這一支:`open=` 展開的 `OrderDetailRoute` 也 import 這個模組的其他函式,整包替換會讓它們變 undefined。
vi.mock('../../lib/payment/refund-read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/payment/refund-read')>()),
  getLedgerUnregisteredAmount: vi.fn(async () => 1000),
}));
vi.mock('../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ listOrderSummariesForAdmin: mocks.list, findAdminOrderDetail: mocks.detail }),
}));
// 🔴 **保留真模組、只換 `useRouter`**(2026-08-12 換版分流片):本頁 `:21` 載入 `shipping-selection`,
//    它再載入 `shipment-launcher.tsx`,而後者的 catch 現在會呼叫 `unstable_isUnrecognizedActionError`。
//    整包替換的話那支是 `undefined` ⇒ 日後在本檔補一格「讀候選失敗」就吃 TypeError。
vi.mock('next/navigation', async () => ({
  ...(await vi.importActual<typeof import('next/navigation')>('next/navigation')),
  useRouter: () => ({ replace: vi.fn() }),
}));
// #347-2b:本頁自此會讀 `cookies()` —— 關鍵字搜尋詞的載體(它是 PII、刻意不進 URL)。
// 🔴 沒有這個替身,vitest 會擲「`cookies` was called outside a request scope」⇒ 本檔**每一格**都紅,
//    而紅的原因與各格自己要驗的東西完全無關。回空 store = 「沒有在搜尋」,正是本檔既有各格的前提。
// 🔴 #347-B:這個替身從「恆空」改成**可控**,因為新的「刷卡未付款被藏起來」提示
//    的觸發條件之一就是「有沒有在搜尋關鍵字」,而關鍵字只住在這顆 cookie 裡。
//    仍然逐鍵比對(`get(name)`)—— 不分鍵回值的替身會讓「讀錯 cookie」這個突變照樣綠。
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'admin_order_keyword' && cookieState.keyword !== undefined
        ? { value: cookieState.keyword }
        : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

import OrdersPage from './page';

// 🔴 `server-only` 在**本檔**換成空替身 —— **不是放寬護欄,而且刻意不做成全域 alias。**
//    真的 `server-only` 被 client 模組載入時會丟錯,那正是我們要的
//    (`shipment-candidates.ts` 帶著它,誰把訂單明細拉進 client bundle 就建置失敗)。
//    但 vitest 沒有 server/client 之分、會天真地走完整個 import 圖:
//      client 元件 → `shipment-actions.ts`('use server')→ `shipment-candidates.ts`('server-only')→ 丟錯。
//    真實 Next 下這條路**不存在**('use server' 模組在 client 側是引用樁)。
//    ⚠️ **為什麼不做全域 alias**:`apps/storefront/src/lib/brand-products.test.ts:223` 有一條測試
//    **刻意依賴 server-only 真的丟錯**來證明 mock 清乾淨了(斷言字面就是那句錯誤訊息)。
//    全域替身會把那條的驗證機制整個拆掉 —— 實測會讓它從綠變紅。所以只在需要的檔各自 mock。
vi.mock('server-only', () => ({}));


const EMPTY = { items: [], total: 0 };
const ONE_ORDER = {
  items: [
    {
      id: 'o-1',
      displayId: 'YWP3PC',
      createdAt: '2026-08-07T00:00:00+00:00',
      customerName: '王小明',
      paymentStatus: 'paid' as const,
      fulfillmentStatus: 'pending' as const,
      total: { amount: 1000, currency: 'TWD' as const },
      // 🔵 稅欄(Sean 2026-09-05 第 6 題)—— 這一族 fixture 走 `as unknown as`,
      //    型別看不到缺欄, 而執行期會 `Cannot read properties of undefined`。
      taxTotal: { amount: 0, currency: 'TWD' as const },
      orderSource: 'storefront' as const,
      paymentChannel: 'tappay' as const,
      tierAtCheckout: null,
      invoiceStatus: null,
      cancelledAt: null,
      displayPosition: null,
      // 🔴 2026-08-27 補上:`AdminOrderSummary.shippingAddress` 是**必填**, 而本 fixture 少了它
      //    ⇒ `7489aada` 起 `buildOrderExportRows` 在這裡 `TypeError`, 本檔 **5 格**紅在 `dev` 上。
      //    ⇒ 這一欄不是為了讓測試變綠而加的裝飾, 是**這個 fixture 本來就違反型別**。
      shippingAddress: { name: null, phone: null, line: null },
      lines: [],
    },
  ],
  total: 1,
};

async function renderPage(params: Record<string, string | string[] | undefined>) {
  const ui = await OrdersPage({ searchParams: Promise.resolve(params) });
  const result = render(ui);
  // 🔴 **分母守門(2026-08-28 量到本檔有 4 格是恆綠的)**:本檔多數斷言的形狀是
  //    「`container.textContent` 裡**不得**出現某句話」/「某個節點是 `null`」——
  //    而整頁沒渲染時 `textContent` = `''`、任何 `querySelector` 都是 `null`
  //    ⇒ **「頁面正確地沒顯示那句提示」與「頁面整個沒出來」印同一個綠。**
  //    放在共用的 render helper 裡:一道蓋住全檔,新加的格自動有分母。
  //    釘**標題節點的數量**(結構),不釘任何一句文案 —— 文案改字不該讓這裡紅。
  expect(
    result.container.querySelectorAll('h1, h2').length,
    '整頁一個標題節點都沒有 ⇒ 訂單列表頁根本沒渲染 ⇒ 本格的負向斷言恆真',
  ).toBeGreaterThan(0);
  return result;
}

// ── #347-B(Sean 拍板 Q-347-B1=B / Q-347-B5=C):本檔原本整支在測 A10c2 供應商單號的
//    「明示態」(三種 invalid 訊息 + 命中過多 vs 程式壞了的分流 + #338 三態具名)。
//    那些能力連同兩個專用搜尋欄一起退場 ⇒ 整組刪除,改測**接替它們的東西**:
//      ① Q-347-B6=B 的「刷卡未付款被藏起來」提示(承接「不默默降級」的新載體)
//      ② Q-347-B5=C 的「三態在恆 null 之下不渲染」(契約留著、producer 待片 B-2)
//    🔴 「一般錯誤 → 通用錯誤態」那格是**與本片無關的活測試**,原本住在將死的
//       describe 裡 —— 刻意搬出來保留,不隨容器一起刪(整族連鍋端是踩過的坑)。

describe('OrdersPage — 讀取失敗', () => {
  beforeEach(() => {
    cookieState.keyword = undefined;
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('一般錯誤 → 通用錯誤態(既有行為零改動)', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage({});
    expect(container.textContent).toContain('訂單列表載入失敗');
  });
});

// ── Q-347-B6=B:「可能有刷卡未付款的單被藏起來」提示 ───────────────────────
// 🔴 **它為什麼存在**:兩個專用搜尋欄退場後,D-385-A 的「豁免綁精準鍵」沒有實作了
//    (adapter 的豁免條件式塌成只看 `includeUnpaidCardOrders`)。Sean 拍板要求
//    「查無時提示」來承接 —— 這一族就是那個承接體的守門。
//
// 🔴 **三個條件,三格負向各只拿掉一個** —— 每格只讓一道閘失敗,否則證不出是哪一道在擋。
describe('OrdersPage — #347-B 刷卡未付款被藏起來的提示', () => {
  // 🔴🔴 **R1 Imp-2:這裡原本寫 `const HINT = '顯示刷卡未付款(預設隱藏)'` 然後
  //    `expect(頁面文字).toContain(HINT)` —— 那是**恆真格**。
  //    同一個字串有**兩個獨立來源**:提示本文(`page.tsx` 的 `UNPAID_CARD_HIDDEN_HINT`)
  //    與篩選列 checkbox 的 label(`order-filter-controls.tsx`,而篩選列**無條件渲染**)。
  //    ⇒ 把提示裡「勾選下方的『…』再查一次」整句換成「請自行想辦法。」,八格照樣全綠(已實測)。
  //    我原本那輪突變之所以會紅,靠的是「找不到單」那句、**不是這條斷言** ——
  //    也就是說我測了三道閘,卻從沒測過我宣稱在守文案一致性的那條。
  //    ⇒ 改成對**原始碼**斷言:label 的字面從元件檔讀出來,再要求提示文案含它。
  //      這條與畫面渲染完全無關,checkbox 渲不渲染都不影響它的判別力。
  const SRC = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  // 🔵 2026-09-13 晚:那顆勾從篩選卡(已拆)搬到工具列「只看」chip,label 住在 `order-toolbar-view.ts` 的 VIEW_CHIPS。
  const TOOLBAR_VIEW_SRC = SRC('../../lib/orders/order-toolbar-view.ts');
  // 🔴 提示文案也從**原始碼**取,不從 `page.tsx` import ——
  //    `UNPAID_CARD_HIDDEN_HINT` 是頁面模組的私有常數,為了測試把它 export 出去
  //    等於為了量它而改變被量的東西(而且 Next 頁面模組的 export 面有它自己的規矩)。
  const PAGE_SRC = SRC('./page.tsx');
  beforeEach(() => {
    cookieState.keyword = undefined;
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('🔴 正向:有關鍵字 + 隱藏規則生效 + 0 筆 ⇒ 明示提示並指向那個勾', async () => {
    cookieState.keyword = '王小明';
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    // 🔴 「找不到單」只出現在提示本文,是這一格唯一有判別力的觀察面。
    expect(text).toContain('找不到單');
  });

  it('🔴 文案一致性:提示叫人勾的字,必須逐字等於篩選列上那個 label', async () => {
    // 🔴 **對原始碼斷言、不對畫面斷言**(R1 Imp-2 的修法):
    //    畫面上那個字串由 chip label 無條件供應 ⇒ 對畫面 `toContain` 恆真。
    //    這裡把 label 從元件原始碼挖出來,再要求提示文案含它 —— 改壞任一邊都紅。
    //    同款先例:`packages/domain/src/order/display-id.test.ts` 的 regex 單一來源守門。
    const label = /key: 'show-unpaid-card', label: '([^']+)'/.exec(TOOLBAR_VIEW_SRC)?.[1]?.trim();
    const hint = /const UNPAID_CARD_HIDDEN_HINT =\s*\n?\s*'([^']+)'/.exec(PAGE_SRC)?.[1];
    // 🔴 兩邊都抓得到才算數 —— 抓不到就失敗,不是「跳過這格」
    //    (正規式失配還讓它綠 = 又一個恆真格,正是本格在修的病)。
    expect(label, 'chip label 沒抓到,選擇器過期了').toBeTruthy();
    expect(hint, '提示文案常數沒抓到,選擇器過期了').toBeTruthy();
    expect(hint).toContain(label);

    // 🔴🔴 **第二道:那個 label 必須真的被渲染成表單控制項的標籤**(codex R2 must-fix)。
    //    只有原始碼那道還是假綠:把真的 JSX label 刪掉、在**區塊註解裡**留一行以同字面
    //    開頭的文字,正規式照樣命中 ⇒ 十格全綠(已實測構造出來)。
    //    ⇒ 加這道之後,「label 被刪、只剩註解」會在這裡紅:註解不會變成 accessible name。
    //    ⚠️ 這與 Imp-2 修掉的那個恆真**不同**:那邊錯在拿畫面文字證「提示含 label」
    //      (第二來源供應);這裡是拿畫面證「label 存在且叫這個名字」—— 那正是畫面該負責的事。
    //    🔵 2026-09-13 晚:那個字現在是「只看」列的一顆 chip(連結),accessible name = 它的文字。
    const { getByRole } = await renderPage({});
    expect(getByRole('link', { name: label as string })).toBeTruthy();
  });

  it('負向①:勾已經打開(隱藏規則沒生效)⇒ 不提示(沒有東西被藏,提示就是說謊)', async () => {
    cookieState.keyword = '王小明';
    const { container } = await renderPage({ show_unpaid_card: '1' });
    expect(container.textContent ?? '').not.toContain('找不到單');
  });

  it('負向②:有結果 ⇒ 不提示(員工不需要逃生口)', async () => {
    cookieState.keyword = '王小明';
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({});
    expect(container.textContent ?? '').not.toContain('找不到單');
  });

  it('負向③:沒有在搜尋(只是瀏覽列表)+ 0 筆 ⇒ 不提示(瀏覽時它是噪音)', async () => {
    const { container } = await renderPage({});
    expect(container.textContent ?? '').not.toContain('找不到單');
  });

  /**
   * 🔴 `#841` 乙-2(2026-08-22,線 A `-86`):**瀏覽 + 0 筆時,畫面上要有一句解釋。**
   *
   * **與上面「負向③」的關係(讀之前先看這段,否則會以為兩者打架)**:
   * 負向③ 釘的是「瀏覽 + 0 筆 ⇒ **不得出現【找不到單】那句**」——**那條一個字都沒動,而且仍然綠**。
   * 本族講的是**另一句話**(`BROWSE_EMPTY_HINT`),它刻意不含那四個字。
   * 🔴 誰日後要改那句文案,**先確認沒有把「找不到單」帶進來** —— 帶進來會讓負向③ 紅,
   *    而**那不是它壞了,是你撞到它**。
   *
   * 🔴 三格,而第三格是這一族存在的理由:
   *   ① 瀏覽 + 0 筆        ⇒ 要講
   *   ② 瀏覽 + 有結果      ⇒ 不講（否則變成常駐噪音,那正是原作者當初排除瀏覽態的理由）
   *   ③ 那句話裡【必須】有「其他篩選條件」那一段
   *      —— 因為 0 筆的真正原因可能是別的篩選軸, 而我們證明不了是隱藏造成的。
   *      少了它, 這句話會讓員工以為「勾了就一定找得到」。
   */
  function browseHint(container: HTMLElement): string | null {
    const t = container.textContent ?? '';
    return t.includes('有些訂單預設不會列出來') ? t : null;
  }

  it('🔴 乙-2 ①:沒有在搜尋 + 0 筆 ⇒ 要講(0 筆時它不是噪音,是畫面上唯一的解釋)', async () => {
    const { container } = await renderPage({});
    expect(browseHint(container), '瀏覽而 0 筆時必須有一句解釋').not.toBeNull();
  });

  it('🔴 乙-2 ②:沒有在搜尋 + 有結果 ⇒ 不講', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({});
    expect(browseHint(container)).toBeNull();
    // 正對照:這一發真的渲染了列表 ⇒ 上面那個 null 不是「整頁沒出來」造成的。
    expect(container.textContent ?? '').toContain('共');
  });

  it('🔴 乙-2 ③:那句話必須帶「其他篩選條件」—— 少了它會讓人以為勾了就一定找得到', async () => {
    const { container } = await renderPage({});
    expect(container.textContent ?? '').toContain('其他篩選條件');
  });

  it('🔴 乙-2 ④:勾已經打開 ⇒ 不講(沒有東西被藏,講了是說謊)', async () => {
    const { container } = await renderPage({ show_unpaid_card: '1' });
    expect(browseHint(container)).toBeNull();
  });

  it('🔴 讀取失敗時不提示 —— 0 筆的原因是壞掉,不是被藏起來', async () => {
    cookieState.keyword = '王小明';
    mocks.list.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    expect(text).toContain('訂單列表載入失敗');
    expect(text).not.toContain('找不到單');
  });
});

// ── Q-347-B5=C:`supplierOrderNoMatchedSuppliers` 恆 null 之下的三態渲染 ────────────
// 🔴 主視窗列為硬驗收:恆 null 是**新常態**,不能只靠「以前 null 也沒事」推定。
//    這一格證的是「整塊不渲染」,不是「渲染成空殼 / undefined 字樣」。
describe('OrdersPage — #347-B 供應商三態在恆 null 之下不渲染', () => {
  // 🔴 用**只有那三段橫幅才有**的句子當觀察面(舊測試的教訓:輸入框的 sr-only
  //    提示裡也有半句一樣的字,拿那半句斷言會抓到輸入框、量到的不是橫幅)。
  const BANNER_ONLY = '到貨登記前請先點進訂單核對供應商';
  beforeEach(() => {
    cookieState.keyword = undefined;
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('🔴 有結果、而 adapter 回 null ⇒ 三段橫幅一句都不出現', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, supplierOrderNoMatchedSuppliers: null });
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    expect(text).not.toContain(BANNER_ONLY);
    expect(text).not.toContain('這組單號屬於供應商');
    expect(text).not.toContain('家供應商都有');
    // 🔴 也不得渲染成空殼:整塊不存在,不是存在但沒字。
    expect(text).not.toContain('undefined');
    // 正向對照:訂單本身有正常列出來(證明上面三個 not 不是因為整頁沒渲染)
    expect(text).toContain('YWP3PC');
  });

  it('🔴 契約仍活著:多家 ⇒ 示警橫幅列名(這才是真的會出事的那態)', async () => {
    // ⚠️ 同上,**縱深不是現況**。挑 `multiple` 是因為它是三態裡唯一「不看就會登錄錯貨」的:
    //    兩家供應商用同一組單號時,員工看到具名以為只有一家 ⇒ 到貨登記登到別家頭上。
    //    (R1 m4:原本三態只測了 `single`,`multiple`/`unknown` 在頁層零覆蓋。)
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      supplierOrderNoMatchedSuppliers: [
        { id: 's-1', label: '大同機車行' },
        { id: 's-2', label: '協進車業' },
      ],
    });
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    expect(text).toContain('大同機車行');
    expect(text).toContain('協進車業');
    // 🔴 光列名不夠 —— 這一態的重點是**叫他去核對**,少了這句就只是資訊、不是警告。
    expect(text).toContain('先點進訂單確認');
  });

  it('🔴 契約仍活著:片 B-2 把 producer 接回來(給一家)⇒ 具名橫幅要出得來', async () => {
    // ⚠️ 這格是**縱深**,不是現況 —— 現在沒有 producer 會產生這個值。
    //    它守的是「有人看到恆 null 就把三態渲染整段刪掉」:那樣本格會紅。
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      supplierOrderNoMatchedSuppliers: [{ id: 's-1', label: '大同機車行' }],
    });
    const { container } = await renderPage({});
    expect(container.textContent ?? '').toContain('大同機車行');
  });
});

// ── P-d:`?open=` 指到的單【不在這一頁】時要說一句(2026-09-13,主視窗裁甲)──────────
describe('P-d — ?open= 指到的單不在這一頁', () => {
  const OPEN = '11111111-2222-4333-8444-555555555555';

  it('🔴 存在但被篩選 / 分頁藏起來 ⇒ 藍提示 + 「清除篩選並打開」,而且【不撈明細、不畫展開列】', async () => {
    // 🔴 這一格是真瀏覽器驗出來的【最糟】情況的替身守門:舊版在這裡**靜靜地什麼都沒有**。
    //    主視窗的突變要求:拿掉「先判在不在」那一步 ⇒ 要當場紅。
    //    ⇒ 拿掉那一步的話,`openMissingOrHidden` 永遠是 null ⇒ 下面「提示要在」那條紅。
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue({ displayId: 'PCM-2026-1002' });
    const { container } = await renderPage({ open: OPEN });

    const notice = container.querySelector('[data-testid="open-order-hidden"]');
    expect(notice, '被藏起來的單沒有任何提示 ⇒ 他會以為網址壞了').not.toBeNull();
    expect(notice!.textContent).toContain('PCM-2026-1002');
    // 🔴 那顆連結 = 同一張單、篩選清空:return_to 不帶任何篩選、只帶 open。
    const rt = notice!.querySelector('input[type="hidden"][value^="/orders?open="]') as HTMLInputElement | null;
    expect(rt, '清除篩選並打開的 return_to 不對').not.toBeNull();
    expect(rt!.value).toBe(`/orders?open=${OPEN}`);
    // 不在列表 ⇒ 沒有展開列(展開列綁在那一列底下,那一列不存在)。
    expect(container.querySelector('tr.orders-expanded')).toBeNull();
    // 存在檢查恰一次、而且問的是那張單。
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.detail).toHaveBeenCalledWith(OPEN);
    // 🔴 兩句是兩件事:紅提示不得同時出現。
    expect(container.querySelector('[data-testid="open-order-missing"]')).toBeNull();
  });

  it('🔴 根本不存在 ⇒ 紅提示、沒有連結(沒有地方可去)、列表照常', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(null);
    const { container } = await renderPage({ open: OPEN });

    const missing = container.querySelector('[data-testid="open-order-missing"]');
    expect(missing).not.toBeNull();
    expect(missing!.querySelector('form')).toBeNull();
    expect(container.querySelector('[data-testid="open-order-hidden"]')).toBeNull();
    // 列表照常(那一張單還在)。
    expect(container.querySelectorAll('tbody.orders-group').length).toBe(1);
  });

  it('🔴 沒帶 open ⇒ 兩種提示都沒有、存在檢查【不跑】(對照組,擋恆真)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockClear();
    const { container } = await renderPage({});
    expect(container.querySelector('[data-testid="open-order-hidden"]')).toBeNull();
    expect(container.querySelector('[data-testid="open-order-missing"]')).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('🔴 open 不是 UUID ⇒ 當沒帶(不撈、不提示)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockClear();
    const { container } = await renderPage({ open: 'not-a-uuid' });
    expect(container.querySelector('[data-testid="open-order-hidden"]')).toBeNull();
    expect(container.querySelector('[data-testid="open-order-missing"]')).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});

// ── 手動建單彈窗:`?new=1` ⇒ 殼 + ManualOrderView(container='dialog');只開表單不寫入 ────────
//    🔵 ManualOrderView 是 async server component、會撈員工名單 ⇒ 整支 mock 成一個記 props 的探針,
//       本檔守的是「page 有沒有把對的容器餵給它」(同 order-detail-tabs-wiring 那支的理由)。
const manualViewProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('../../components/orders/manual-order-view', () => ({
  ManualOrderView: async (props: Record<string, unknown>) => {
    manualViewProps.last = props;
    return <div data-testid='manual-order-view-probe' />;
  },
}));
/** 🔵 讀成函式:上面剛指派過 `null`, TS 流程分析會把 `manualViewProps.last` 窄成 `never`(同 order-detail-tabs-wiring 那支)。 */
function capturedManualView(): { container?: unknown; raw?: Record<string, string> } | null {
  return manualViewProps.last as { container?: unknown; raw?: Record<string, string> } | null;
}
describe('手動建單 — ?new=1 開彈窗', () => {
  it('🔴 ?new=1 ⇒ 殼在(標題「手動建單」)、ManualOrderView 拿到 container=dialog 與整包 raw', async () => {
    manualViewProps.last = null;
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({ new: '1', r: 'manual_order_error', mrid: 'x' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('手動建單');
    expect(dlg!.querySelector('[data-testid="manual-order-view-probe"]')).not.toBeNull();
    expect(capturedManualView()?.container, '容器餵錯 ⇒ 送出之後會跑去別的容器').toBe('dialog');
    // 🔴 失敗導回帶的 r / mrid 要原樣進 view(它靠這兩顆印橫幅、沿用冪等鍵)
    expect(capturedManualView()?.raw?.r).toBe('manual_order_error');
    expect(capturedManualView()?.raw?.mrid).toBe('x');
  });

  // 🔴 codex 2026-09-13 must-fix:彈窗原本被包在 loadFailed 的成功分支裡 ⇒ 列表撈不到就不能建單、不能沿用 mrid 重送。
  //    面板那條路從來沒有這條規則;建單不依賴列表。
  it('🔴🔴 列表載入失敗 ⇒ 手動建單彈窗【照樣開】(建單不依賴列表, 員工要能沿用 mrid 重送)', async () => {
    manualViewProps.last = null;
    mocks.list.mockRejectedValue(new Error('列表掛了'));
    const { container } = await renderPage({ new: '1', r: 'manual_order_error', mrid: '11111111-1111-4111-8111-111111111111' });
    expect(container.textContent).toContain('訂單列表載入失敗');
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '列表掛了就不能建單 ⇒ 多了一條面板沒有的規則').not.toBeNull();
    expect(capturedManualView()?.container).toBe('dialog');
    expect(capturedManualView()?.raw?.mrid).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('🔵 沒有 ?new= ⇒ 不開、ManualOrderView 沒被渲染', async () => {
    manualViewProps.last = null;
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({});
    expect(container.querySelector('[data-testid="manual-order-view-probe"]')).toBeNull();
    expect(capturedManualView()).toBeNull();
  });
});

// ── 發票小抄:`?invoice=<id>` ⇒ 開彈窗(殼借 P-e-1 的), 只開表單不寫入(2026-09-13, Sean 拍甲)────────
describe('發票小抄 — ?invoice= 開彈窗', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  const DETAIL = {
    id: U,
    displayId: 'PCM-2099-0001',
    version: 7,
    invoiceRequested: true,
    invoiceStatus: 'not_issued',
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceRequest: { type: 'personal' },
    priceTaxMode: 'inclusive',
    total: { amount: 1100, currency: 'TWD' },
    taxTotal: { amount: 0, currency: 'TWD' },
  };

  it('🔴 invoice 指到這一頁的單 ⇒ 殼在、三個數在、抬頭/統編/登記三格在同一張 form', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
    mocks.detail.mockResolvedValue(DETAIL);
    const { container } = await renderPage({ invoice: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.textContent).toContain('發票上要寫的');
    expect(dlg!.textContent).toContain('1,048');
    // 一張 form(不含殼自己那顆 method=dialog 的取消):抬頭 / 統編 / 登記三格全在裡面
    const forms = [...dlg!.querySelectorAll('form')].filter((f) => f.getAttribute('method') !== 'dialog');
    expect(forms).toHaveLength(1);
    for (const name of ['invoice_title', 'invoice_tax_id', 'invoice_status', 'invoice_number', 'invoice_amount', 'version']) {
      expect(forms[0]!.querySelector(`[name="${name}"]`), `缺 ${name}`).not.toBeNull();
    }
  });

  it('🔴 invoice 指到【不在這一頁】的單 ⇒ 不開、也不撈明細', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockClear();
    const { container } = await renderPage({ invoice: U });
    expect(container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('🔴 撈明細失敗(回 null)⇒ 殼在、印一句找不到、零表單', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
    mocks.detail.mockResolvedValue(null);
    const { container } = await renderPage({ invoice: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg!.querySelector('[role="alert"]')?.textContent).toContain('找不到這張單');
    expect([...dlg!.querySelectorAll('form')].filter((f) => f.getAttribute('method') !== 'dialog')).toHaveLength(0);
  });
});

// ── P-e-1:`?next=<id>&do=<動作>` ⇒ 只開彈窗【殼】,零寫入(2026-09-13,Sean 批 P-e 甲)────────
describe('P-e-1 — ?next= 開的是殼,不是動作', () => {
  // 🏁 **P-e-2(2026-09-13):佔位字退場,三支 body 接上。** 本檔只驗「殼 + 對的 body 有沒有接上」,
  //    body 自己長什麼樣由設計窗的 `next-step-bodies.test.ts` 守。
  const U = '11111111-2222-4333-8444-555555555555';
  const withOrder = () =>
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
  // 到貨 body 要一張「有還在等的採購」的明細;其餘欄位它不讀。
  const DETAIL_WITH_PENDING = {
    displayId: 'PCM-2026-1002',
    items: [
      {
        id: 'it-1',
        productSnapshot: { title: '下導流' },
        procurements: [
          // 下訂 body 會把既有採購列整理成供應商選項 ⇒ 供應商三欄要在( 讀它們)。
          { id: 'pr-1', voidedAt: null, allocatedQuantity: 3, receivedQuantity: 1, supplierId: 'sup-1', supplierLabel: '甲供應商', supplierIsActive: true },
        ],
      },
    ],
  };

  it('🔴 do=receipt ⇒ 殼在(標題「到貨登記」)+ 到貨 body 在殼裡', async () => {
    withOrder();
    mocks.detail.mockResolvedValue(DETAIL_WITH_PENDING);
    const { container } = await renderPage({ next: U, do: 'receipt' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('到貨登記');
    expect(dlg!.querySelector('[data-testid="next-step-receipt-body"]'), '到貨 body 沒接進殼').not.toBeNull();
  });

  it('🔴 do=order ⇒ 殼在(標題「跟供應商下訂」)+ 下訂 body 在殼裡', async () => {
    withOrder();
    mocks.detail.mockResolvedValue(DETAIL_WITH_PENDING);
    const { container } = await renderPage({ next: U, do: 'order' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('跟供應商下訂');
    expect(dlg!.querySelector('[data-testid="next-step-procurement-body"]'), '下訂 body 沒接進殼').not.toBeNull();
  });

  it('🔴🔴 M1:採購投影【讀不到】(procurements === null)⇒ 那一項不給表單、印讀不到那句', async () => {
    // 🔴 codex R1 must-fix(P-e-3):第一版把 null 靜靜轉成 [] ⇒ 用空資料初始化表單 ⇒ 送出會用空白蓋掉
    //    別人填過的單號 / 異常原因 / 預計到貨日。明細頁是 `blocked = unreadable || truncated`,彈窗要一樣。
    withOrder();
    mocks.detail.mockResolvedValue({
      ...DETAIL_WITH_PENDING,
      items: [{ ...DETAIL_WITH_PENDING.items[0]!, procurements: null }],
    });
    const { container } = await renderPage({ next: U, do: 'order' });
    const body = container.querySelector('[data-testid="next-step-procurement-body"]')!;
    expect(body.querySelector('[data-testid="next-step-procurement-unreadable"]'), '讀不到時要印那句').not.toBeNull();
    expect(body.querySelector('form'), '讀不到時不得渲染表單 —— 送出會用空白蓋掉既有值').toBeNull();
  });

  it('🔴🔴 do=ship ⇒ 讀取中【有殼】(B13:沒品項的單原本不開也不報);開起來之後 ShipmentDialog 自帶遮罩、不再包殼', async () => {
    withOrder();
    const { container } = await renderPage({ next: U, do: 'ship' });
    // 🔵 2026-09-13 B13:讀取 / 讀不到 / 沒品項 三個狀態現在包在 NextStepDialog 裡(原本是裸 <div> 掉在頁面流裡,
    //    員工按了「出貨」什麼都沒看到)。ShipmentDialog 本體仍是自己那片 fixed 遮罩(page.tsx 那段理由不變)。
    const shell = container.querySelector('[data-testid="next-step-dialog"]');
    expect(shell, '讀取中沒有殼 ⇒ 空品項的單會回到「不開也不報」').not.toBeNull();
    expect(shell!.querySelector('[data-testid="next-step-shipment-loading"]')).not.toBeNull();
    // 出貨 body 是 client 元件、mount 前先印 loading 那一格 ⇒ 那一格在就代表它被渲染了。
    expect(
      container.querySelector('[data-testid^="next-step-shipment-"]'),
      '出貨 body 沒渲染',
    ).not.toBeNull();
  });

  it('🔴 do 不在三值白名單 ⇒ 不開(不開一個不知道要幹嘛的彈窗)', async () => {
    const U = '11111111-2222-4333-8444-555555555555';
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
    const { container } = await renderPage({ next: U, do: 'delete' });
    expect(container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
  });

  it('🔴 next 指到【不在這一頁】的單 ⇒ 照開(codex R2 must-fix ①:送出失敗後那張單離開篩選,彈窗不能跟著卸載、丟掉冪等鍵)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({ next: '11111111-2222-4333-8444-555555555555', do: 'order' });
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '綁了列表成員資格').not.toBeNull();
  });

  it('🔴 page 傳給表格的 buildNextHref 帶著篩選與頁碼(擋「漏傳 ⇒ 用了不帶篩選的預設」)', async () => {
    const U = '11111111-2222-4333-8444-555555555555';
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      items: [{ ...ONE_ORDER.items[0]!, id: U, lines: [], paymentStatus: 'unpaid' }],
    });
    const { container } = await renderPage({ payment_status: 'unpaid', page: '2' });
    const a = container.querySelector('td.col-next a');
    expect(a, '這張單的貨品軸應該是 none ⇒ 有「跟供應商下訂」連結').not.toBeNull();
    const qs = new URLSearchParams(a!.getAttribute('href')!.split('?')[1] ?? '');
    expect(qs.get('payment_status')).toBe('unpaid');
    expect(qs.get('page')).toBe('2');
    expect(qs.get('next')).toBe(U);
    expect(qs.get('do')).toBe('order');
    expect(qs.get('open'), 'next 連結不該順手把那一列展開').toBeNull();
  });
});

// ── 收款欄可點:`?pay=<id>` ⇒ 「新增收款」彈窗(2026-09-13,Sean 答甲)──────────────
describe('收款欄可點 — ?pay= 開的是明細頁那份收款表單', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  const withOrder = () =>
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      items: [{ ...ONE_ORDER.items[0]!, id: U, balanceDue: 3500, paymentStatus: 'partiallyPaid' }],
    });

  it('🔴 pay 指到這一頁的單 ⇒ 殼在(標題「新增收款」)+ 收款表單在殼裡、同一支 action', async () => {
    withOrder();
    const { container } = await renderPage({ pay: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('新增收款');
    expect(dlg!.querySelector('[data-testid="next-step-pay-body"]'), '收款 body 沒接進殼').not.toBeNull();
    // 🔴 復用的是明細頁那份 PaymentRecordForm ⇒ 它的表單在(有 request_id 那顆 hidden)。
    expect(dlg!.querySelector('form input[name="request_id"]'), '沒有明細頁那份表單的冪等鍵欄位 ⇒ 不是同一份表單').not.toBeNull();
    // 🔴 codex must-fix ①:整段 PaymentSection(清單在上)—— 零筆時印「尚未登錄任何收款。」而不是沒有清單。
    //    沒清單 ⇒ 首送已入帳但回應失敗時員工看不到那一筆、按「開始下一筆」就寫兩筆。
    expect(dlg!.textContent, '收款清單沒進彈窗 ⇒ 只搬了表單、漏了清單').toContain('尚未登錄任何收款');
    // 彈窗整個就是為了這張表單開的 ⇒ 一進來就攤開;彙總行要對得上列表那格(不是「未知」)。
    expect(dlg!.querySelector('details[open]'), '表單收著,員工要再點一次「新增收款」').not.toBeNull();
    expect(dlg!.textContent).toContain('應收');
    expect(dlg!.textContent).not.toContain('未知');
    // 🔴 codex must-fix ③:做完回列表要展開【真的收款的這張】,結果橫幅跟著錢走。
    const rt = dlg!.querySelector('form input[name="return_to"]') as HTMLInputElement | null;
    expect(rt, '表單沒帶 return_to').not.toBeNull();
    expect(new URLSearchParams(rt!.value.split('?')[1] ?? '').get('open')).toBe(U);
    // 🔴 對稿(v20-v22 `.ft`):[取消][確認] 同一排 ⇒ 取消鈕只有一顆、住在表單那一排、靠 `form=` 指回殼的隱形 dialog form;
    //    殼自己的 footer 不畫第二顆。
    const cancels = dlg!.querySelectorAll('[data-next-step-cancel]');
    expect(cancels.length, '取消鈕不是恰一顆(兩顆 = 殼 footer 沒收掉;零顆 = body 沒放)').toBe(1);
    expect(cancels[0]!.getAttribute('form')).toBe('next-step-close');
    expect(dlg!.querySelector('form#next-step-close[method="dialog"]'), '殼的隱形 dialog form 不在 ⇒ 取消鈕按了沒反應').not.toBeNull();
    expect(cancels[0]!.closest('.next-step-ft')?.contains(dlg!.querySelector('button[type="submit"]:not([form])')), '取消與確認不在同一排').toBe(true);
  });

  it('🔴 對照:下訂彈窗(每品項一張表單)取消仍在殼的 footer、不帶 form=', async () => {
    withOrder();
    const { container } = await renderPage({ next: U, do: 'order' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    const cancels = dlg.querySelectorAll('[data-next-step-cancel]');
    expect(cancels.length).toBe(1);
    expect(cancels[0]!.hasAttribute('form')).toBe(false);
    expect(cancels[0]!.closest('form')?.id).toBe('next-step-close');
  });

  it('🔴 must-fix ②/③:`?open=B&pay=A` ⇒ 連結與取消都保留 open=B;做完的 return_to 改展開 A', async () => {
    const B = '22222222-2222-4333-8444-555555555555';
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      items: [
        { ...ONE_ORDER.items[0]!, id: U, balanceDue: 3500, paymentStatus: 'partiallyPaid' },
        { ...ONE_ORDER.items[0]!, id: B, orderNo: 'PCM-B' },
      ],
    });
    const { container } = await renderPage({ open: B, pay: U });
    const a = container.querySelector('td.col-pay a');
    expect(new URLSearchParams(a!.getAttribute('href')!.split('?')[1] ?? '').get('open'), '點收款就把明細收掉了').toBe(B);
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    const closeHref = dlg.getAttribute('data-close-href') ?? '';
    expect(new URLSearchParams(closeHref.split('?')[1] ?? '').get('open'), '取消不該改變他在看哪張').toBe(B);
    const rt = dlg.querySelector('form input[name="return_to"]') as HTMLInputElement;
    expect(new URLSearchParams(rt.value.split('?')[1] ?? '').get('open'), '收的是 A、回去卻展開 B').toBe(U);
  });

  it('🔴 pay 指到【不在這一頁】但存在的單 ⇒ 照開,應收從 findAdminOrderDetail 拿(codex R2 must-fix ①)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValueOnce({ displayId: 'PCM-X', total: { amount: 9900, currency: 'TWD' } });
    const { container } = await renderPage({ pay: U });
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '綁了列表成員資格 ⇒ 送出失敗後彈窗會卸載').not.toBeNull();
    expect(mocks.detail).toHaveBeenCalledWith(U);
  });

  it('🔴 pay 補查應收 throw ⇒ 照開、鎖成「讀不到」(codex R3 must-fix ①:那正是「已入帳、回應斷了」的時刻,收窗 = 丟鍵)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockRejectedValueOnce(new Error('db down'));
    const { container } = await renderPage({ pay: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '補查失敗就收窗 ⇒ 表單實例與舊冪等鍵一起沒了').not.toBeNull();
    expect(dlg!.textContent).toContain('未知');
    expect(dlg!.textContent).not.toContain('應收');
  });

  it('🔴 列表本身載入失敗 + 補查成功 ⇒ 彈窗照開(codex R4 must-fix:彈窗生命週期不跟列表讀取成敗走)', async () => {
    mocks.list.mockRejectedValueOnce(new Error('list down'));
    mocks.detail.mockResolvedValueOnce({ displayId: 'PCM-X', total: { amount: 9900, currency: 'TWD' } });
    const { container } = await renderPage({ pay: U });
    expect(container.textContent).toContain('訂單列表載入失敗');
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '列表紅了就把彈窗一起卸載 ⇒ 丟鍵').not.toBeNull();
  });

  it('🔴 pay 指到【不存在】的單 ⇒ 不開(沒有單就沒有錢可收)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValueOnce(null);
    const { container } = await renderPage({ pay: U });
    expect(container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
  });

  it('🔴 列表那格的連結帶著篩選與頁碼、不帶 open(擋「用了不帶篩選的預設」)', async () => {
    withOrder();
    const { container } = await renderPage({ payment_status: 'paid', page: '2' });
    const a = container.querySelector('td.col-pay a');
    expect(a, '還差 3,500 那格沒有連結').not.toBeNull();
    const qs = new URLSearchParams(a!.getAttribute('href')!.split('?')[1] ?? '');
    expect(qs.get('pay')).toBe(U);
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.get('page')).toBe('2');
    expect(qs.get('open')).toBeNull();
  });
});
