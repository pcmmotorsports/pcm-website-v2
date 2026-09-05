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
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
const cookieState = vi.hoisted(() => ({ keyword: undefined as string | undefined }));
vi.mock('../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ listOrderSummariesForAdmin: mocks.list }),
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
  const FILTER_CONTROLS_SRC = SRC('../../components/orders/order-filter-controls.tsx');
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
    //    畫面上那個字串由 checkbox label 無條件供應 ⇒ 對畫面 `toContain` 恆真。
    //    這裡把 label 從元件原始碼挖出來,再要求提示文案含它 —— 改壞任一邊都紅。
    //    同款先例:`packages/domain/src/order/display-id.test.ts` 的 regex 單一來源守門。
    const label = /^\s*(顯示刷卡未付款[^\n<]*)$/m.exec(FILTER_CONTROLS_SRC)?.[1]?.trim();
    const hint = /const UNPAID_CARD_HIDDEN_HINT =\s*\n?\s*'([^']+)'/.exec(PAGE_SRC)?.[1];
    // 🔴 兩邊都抓得到才算數 —— 抓不到就失敗,不是「跳過這格」
    //    (正規式失配還讓它綠 = 又一個恆真格,正是本格在修的病)。
    expect(label, 'checkbox label 沒抓到,選擇器過期了').toBeTruthy();
    expect(hint, '提示文案常數沒抓到,選擇器過期了').toBeTruthy();
    expect(hint).toContain(label);

    // 🔴🔴 **第二道:那個 label 必須真的被渲染成表單控制項的標籤**(codex R2 must-fix)。
    //    只有原始碼那道還是假綠:把真的 JSX label 刪掉、在**區塊註解裡**留一行以同字面
    //    開頭的文字,正規式照樣命中 ⇒ 十格全綠(已實測構造出來)。
    //    ⇒ 加這道之後,「label 被刪、只剩註解」會在這裡紅:註解不會變成 accessible name。
    //    ⚠️ 這與 Imp-2 修掉的那個恆真**不同**:那邊錯在拿畫面文字證「提示含 label」
    //      (第二來源供應);這裡是拿畫面證「label 存在且叫這個名字」—— 那正是畫面該負責的事。
    const { getByLabelText } = await renderPage({});
    expect(getByLabelText(label as string)).toBeTruthy();
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
  const BANNER_ONLY = '登錄到貨前請先點進訂單核對供應商';
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
