// @vitest-environment node
//
// 訂單明細【路由】守門(`#240`)。
//
// 🔴 **這支存在的理由**:code-reviewer 2026-08-23 實查 —— 這個目錄底下只有 `page.tsx`、
//    **零測試**(數法 `grep -rln "account/orders" --include='*.test.*'` 只命中 OrdersTab.test.tsx
//    與 safe-redirect.test.ts)。而沒被覆蓋到的恰好是這片的**安全面**驗收:
//      驗收 2「不洩存在性」—— 別人的單與不存在的單必須長得一樣
//      驗收 3 走 OD 稿的「查無此訂單」狀態,而不是 Next 的 404 頁
//    ⇒ 四綠不會紅, 而**突變也打不到它**(沒有測試可以變紅)。
//
// 慣例照 `app/page.test.tsx`:node 環境、直接 await 呼叫 server component、
// `renderToStaticMarkup` 出真 HTML,只 stub 會打真 DB 的東西。
// ⇒ 斷言的是**真的渲染出來的 DOM**,不是原始碼的文字。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemberOrderDetail } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }));

let currentUser: { id: string } | null = { id: 'owner-1' };
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: currentUser } }) } }),
}));

// 🔴 這個假 repo **刻意複製真 adapter 的行為**:它只認「本人 + 該 displayId + 非 unpaid」,
//    其餘一律回 `null` —— 而**回 null 這件事本身就是「不洩存在性」的機制**:
//    別人的單、不存在的單、被 `#249` 藏起來的 unpaid 孤兒單,在 caller 眼中是同一個值。
const findOrderDetailForCustomer = vi.fn();
vi.mock('@/lib/auth/composition', () => ({
  getOrderRepo: () => Promise.resolve({ findOrderDetailForCustomer }),
}));

const money = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });
const OWN_ORDER: MemberOrderDetail = {
  id: 'o1',
  displayId: 'B3XA91',
  createdAt: '2099-04-15T10:00:00Z',
  paymentStatus: 'paid',
  fulfillmentStatus: 'shipped',
  paymentMethod: 'tappay',
  paidAt: '2099-04-18T03:00:00Z',
  subtotal: money(12000),
  shippingFee: money(100),
  discountTotal: money(0),
  total: money(12100),
  shippingMethod: 'home',
  shippingAddress: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  cancelledAt: null,
  cancelledReason: null,
  items: [
    {
      id: 'oi1',
      variantSku: 'SKU-1',
      brand: 'CNC RACING',
      title: '下鏈條蓋',
      spec: { color: 'black' },
      imageUrl: 'https://x/v.jpg',
      vehicle: null,
      quantity: 2,
      unitPrice: money(6000),
      lineTotal: money(12000),
    },
  ],
  itemCount: 2,
  itemsTruncated: false,
};

async function renderRoute(displayId: string): Promise<string> {
  const { default: OrderDetailRoute } = await import('./page');
  const el = await OrderDetailRoute({ params: Promise.resolve({ displayId }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  currentUser = { id: 'owner-1' };
  redirectMock.mockClear();
  findOrderDetailForCustomer.mockReset();
  findOrderDetailForCustomer.mockImplementation((displayId: string, customerId: string) =>
    Promise.resolve(displayId === 'B3XA91' && customerId === 'owner-1' ? OWN_ORDER : null),
  );
});

describe('/account/orders/[displayId] 路由', () => {
  it('本人的單 ⇒ 渲染明細(單號 / 品名 / 金額都在)', async () => {
    const html = await renderRoute('B3XA91');
    expect(html).toContain('B3XA91');
    expect(html).toContain('下鏈條蓋');
    expect(html).toContain('NT$ 12,100');
    expect(html).not.toContain('查無此訂單');
  });

  // 🔴🔴 **這是本支最重要的一格(驗收 2)。**
  //    它不是「兩個都查無」而已 —— 是**兩個世界必須印【逐字相同】的東西**。
  //    只要有一天有人為了「比較好懂」把別人的單改成 403 或「這筆不屬於你」,
  //    那句話本身就洩漏了「這張單存在」。這一格會在那天紅。
  it('🔴 別人的單 與 不存在的單 ⇒ 輸出【逐字相同】(不洩存在性)', async () => {
    const someoneElses = await renderRoute('OTHER1'); // 真的存在, 但不是他的
    const doesNotExist = await renderRoute('NOPE99'); // 根本沒有這張單
    expect(someoneElses).toBe(doesNotExist);
    expect(someoneElses).toContain('查無此訂單');
    // 反向那半:不得洩漏任何區別性字眼
    for (const leak of ['403', '無權', '不屬於你', '沒有權限', 'Forbidden']) {
      expect(someoneElses).not.toContain(leak);
    }
  });

  it('🔴 走 OD 稿的「查無此訂單」狀態,不是 Next 404(驗收 3)', async () => {
    const html = await renderRoute('NOPE99');
    expect(html).toContain('查無此訂單');
    // OD 稿 :133-137 的字面與 class
    expect(html).toContain('acc-empty');
    expect(html).toContain('訂單編號可能輸入錯誤,或這筆不屬於目前登入的帳號。');
    // 負對照:本人的單不得出現這個狀態 —— 否則上面幾格在「永遠查無」時也會綠。
    expect(await renderRoute('B3XA91')).not.toContain('查無此訂單');
  });

  // #249:被藏起來的 unpaid 孤兒單在清單看不到 ⇒ 直連網址也必須打不開,
  // 否則那個拍板會在第二個入口失效。
  it('🔴 unpaid 孤兒單(adapter 端已濾掉 ⇒ 回 null)⇒ 與查無同一個畫面', async () => {
    findOrderDetailForCustomer.mockResolvedValue(null); // adapter 的 .neq 已經把它濾掉了
    const html = await renderRoute('ORPHAN');
    expect(html).toContain('查無此訂單');
  });

  it('未登入 ⇒ 導 /login 並帶 next 回這一頁(不是回首頁)', async () => {
    currentUser = null;
    await expect(renderRoute('B3XA91')).rejects.toThrow(
      'REDIRECT:/login?next=%2Faccount%2Forders%2FB3XA91',
    );
  });

  // 🔴 codex 關卡2 must-fix 的回歸格:Next 已經解碼過動態段,
  //    再 decodeURIComponent 一次會讓 `%` 拋 URIError ⇒ 繞過查無畫面直接 500。
  it('🔴 displayId 解碼後含裸 `%` ⇒ 不得拋錯,要落到查無畫面', async () => {
    const html = await renderRoute('100%');
    expect(html).toContain('查無此訂單');
    // 而它必須原樣送進 repo(不再解一次)
    expect(findOrderDetailForCustomer).toHaveBeenCalledWith('100%', 'owner-1');
  });

  it('repo 讀取失敗(throw)⇒ 退化查無畫面,不 500', async () => {
    findOrderDetailForCustomer.mockRejectedValue(new Error('connection refused'));
    const html = await renderRoute('B3XA91');
    expect(html).toContain('查無此訂單');
  });

  it('🔴 歸屬:repo 一定被帶著【登入者本人的 id】呼叫(應用層縱深)', async () => {
    await renderRoute('B3XA91');
    expect(findOrderDetailForCustomer).toHaveBeenCalledWith('B3XA91', 'owner-1');
  });
});
