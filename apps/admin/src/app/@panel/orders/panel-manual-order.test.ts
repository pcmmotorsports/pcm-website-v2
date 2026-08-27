import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// 面板槽本身會把訂單詳情那一整條鏈拉進來 —— 本檔只量「?panel=new 這條岔路」,
// 所以把詳情那側換成探針。🔴 **不 mock `manual-order-view`**:要驗的正是它有沒有被選中。
vi.mock('../../../lib/customers/load-customer-detail', () => ({ loadCustomerDetail: vi.fn() }));
vi.mock('../../../components/customers/customer-panel', () => ({ CustomerPanel: () => null }));
vi.mock('../../../components/orders/order-detail-route', () => ({ OrderDetailRoute: () => null }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

import OrderPanelPage from './page';
import { ManualOrderView } from '../../../components/orders/manual-order-view';
import { MANUAL_ORDER_PANEL_VALUE } from '../../../lib/orders/manual-order-action-state';

// panel-manual-order.test.ts — 手動建單的**面板版**那條岔路(2026-08-28 線A)。
//
// 🔴🔴 **它守的是一件會靜默失敗的事**:`new` 不是 uuid ⇒ `readOpenPanelOrderId` 回 `null`
//    ⇒ 整個槽回 `null` ⇒ **面板永遠打不開,而畫面上什麼錯都不會出現**
//    (槽回 null 是「這個 URL 沒有面板要開」的正常語意,`@panel/default.tsx` 就是這樣設計的)。
//    ⇒ 把 `?panel=new` 那一段搬到 uuid 檢查**之後**,typecheck / lint 全綠、其他測試也全綠。

type El = { type?: unknown; props?: Record<string, unknown> } | null;

async function run(params: Record<string, string>): Promise<El> {
  return (await OrderPanelPage({ searchParams: Promise.resolve(params) })) as unknown as El;
}

/**
 * 🔴 codex R1 must-fix 之後,槽回的是**面板容器 div 包著 View**(容器 class 逐字照抄客人卡那個)。
 *    這支把外殼與內容分開拿 ⇒ 兩件事各自釘得住:①有沒有那個容器 ②裡面是不是 View。
 */
function inner(el: El): El {
  return (el?.props?.children ?? null) as El;
}

describe('@panel/orders — ?panel=new 開手動建單', () => {
  it('?panel=new ⇒ 回 ManualOrderView, 而且 inPanel=true', async () => {
    const el = inner(await run({ panel: MANUAL_ORDER_PANEL_VALUE }));
    expect(el?.type).toBe(ManualOrderView);
    // 🔴 `inPanel` 是承重的:少了它,面板裡按「找客人」會整頁跳掉、跳出面板。
    expect(el?.props?.inPanel).toBe(true);
  });

  it('🔴 其他參數要原樣遞下去(不然面板裡搜到的電話與選好的客人會消失)', async () => {
    const el = inner(await run({ panel: MANUAL_ORDER_PANEL_VALUE, phone: '0912345678' }));
    expect(el?.props?.raw).toEqual({ panel: MANUAL_ORDER_PANEL_VALUE, phone: '0912345678' });
  });

  // 🔴🔴 codex R1 must-fix:**面板要自己捲**。裸元件沒有 `sticky` / `max-h` / `overflow-y-auto`
  //    ⇒ 建單表單很長 ⇒ 它會把整頁的捲動模型換掉,而畫面上看起來只是「有點怪」。
  //    ⚠️ 這一格量的是**外殼 class 字面**,量不到真畫面的捲動行為 —— 後者要真瀏覽器。
  it('🔴 外面包著面板容器(自己捲, 不是把整頁捲動模型換掉)', async () => {
    const shell = await run({ panel: MANUAL_ORDER_PANEL_VALUE });
    expect(shell?.type).toBe('div');
    const cls = String(shell?.props?.className ?? '');
    for (const token of ['sticky', 'overflow-y-auto', 'max-h-[calc(100svh-3.5rem)]', 'border-l']) {
      expect(cls, `面板容器少了 ${token}`).toContain(token);
    }
  });

  it('🔴 負對照:沒帶 panel ⇒ 回 null(這一格證明上面兩格不是恆真)', async () => {
    expect(await run({})).toBeNull();
  });

  it('🔴 負對照:panel 是別的字 ⇒ 回 null(不得任何值都開建單面板)', async () => {
    expect(await run({ panel: 'newx' })).toBeNull();
    expect(await run({ panel: 'not-a-uuid' })).toBeNull();
  });
});
