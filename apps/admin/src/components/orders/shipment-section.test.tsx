// @vitest-environment jsdom
// shipment-section.test.tsx — 出貨卡的**畫面**守門(#351④,2026-08-10 新建)。
//
// 🔴 **為什麼非要有這一檔**:資料層(`order-shipments.test.ts`)只證得了「空箱算得出來」。
//    把 `shipment-section.tsx` 裡整個空箱區刪掉,那一整檔照樣全綠,而員工看到的東西就沒了 ——
//    這正是「管線每一跳都要有自己的守門」那條:資料備妥 ≠ 畫面畫出來。
//    #351④ 要修的失敗形狀本身就是「東西在 DB 裡但畫面上找不到」,只守資料層等於沒守到點子上。
//
// 🔴 `ShipmentSection` 是 **async server component** ⇒ 先 `await` 它拿到 JSX 再交給 RTL,
//    不能直接 `render(<ShipmentSection …/>)`(其他檔的做法是整支 mock 掉,那守不到本片)。
//
// ⚠️ 它擋不住什麼:jsdom 不是真瀏覽器,量不到版面;作廢鈕本身的行為在它自己的檔守。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// 🔴 `vi.hoisted`:`vi.mock` 的工廠被提升到檔頭,直接引用上面宣告的 `const` 會炸
//    (`Cannot access 'loadOrderShipments' before initialization`)——同 shipment-dialog.test.tsx 那條。
const { loadOrderShipments, loadEmptyShipments } = vi.hoisted(() => ({
  loadOrderShipments: vi.fn(),
  loadEmptyShipments: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/order-shipments', () => ({ loadOrderShipments, loadEmptyShipments }));
// 兩顆 client island 各自有守門檔;這裡換成佔位,讓斷言只針對本卡的結構。
// 🔴 字面對齊 `shipment-launcher.tsx:232` 的 `'出貨'` —— 原本寫「建立包裹」是**改名前**的字,
//    留著會讓同一顆鈕在本片內出現第三種寫法(見該檔 `:184-196` Sean 08-12 改名紀錄)。
vi.mock('./shipment-launcher', () => ({ OrderShipButton: () => <button type='button'>出貨</button> }));
vi.mock('./shipment-void-button', () => ({
  ShipmentVoidButton: ({ shipmentReference }: { shipmentReference: string }) => (
    <button type='button'>作廢 {shipmentReference}</button>
  ),
}));

import { ShipmentSection } from './shipment-section';

// 🔴 `total` 補上 —— DB 的 `orders.total` 是 **NOT NULL**(`20260604120000:104`;
//    `:103` 是 `discount_total`,不是它 —— 原本引錯行,2026-08-19 開檔核過改正),
//    fixture 少給它才是不真實的那一邊。片9 的尾款要用它。
// 🔴 片14:再補上 `shippingAddress` / `shippingMethod`。
//    ~~原本只有 `id` 與 `items`~~ —— 它靠 `as unknown as` 把型別的話壓下去,
//    而元件本來就沒讀那兩欄,所以**一直沒事**。片14 開始讀了,13 格當場全紅。
//    📌 **那不是片14 弄壞的,是這個 cast 一直在賒帳** ——
//       `as unknown as` 讓 fixture 可以少給欄位而 typecheck 不紅,
//       **少的那些欄位在有人讀到它之前都是隱形的。**
//    📌 而片9 與片14 **各自補了一次同一個 fixture**(rebase 時撞在一起)——
//       兩次都是「元件開始讀一個新欄位」。**這個 cast 會一直收租,直到有人把它拆掉。**
const detail = {
  id: 'o1',
  items: [{ id: 'oi-1', title: '鈦合金頭段' }],
  total: { amount: 5000 },
  shippingAddress: { name: '沈佑霖', phone: '0912345678', line: '台中市西屯區文心路二段 201 號' },
  shippingMethod: 'home',
} as unknown as AdminOrderDetail;

const emptyBox = (reference: string) => ({
  id: `sh-${reference}`,
  shipmentReference: reference,
  customerUserId: 'cu-1',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: null,
  shippedAt: null,
  voidedAt: null,
  voidReason: null,
});

beforeEach(() => {
  loadOrderShipments.mockReset();
  loadEmptyShipments.mockReset();
  loadOrderShipments.mockResolvedValue([]);
  loadEmptyShipments.mockResolvedValue([]);
});
afterEach(cleanup);

/**
 * 🔴 既有那幾格的預設收款態刻意用 **`unreadable`** —— 它們測的是空箱區與包裹卡,
 *    與尾款無關。給 `unreadable` 的話那一格只會印「尾款未知」,**不會憑空多一個金額**
 *    去干擾它們的 `queryByText`。(給 `ok` + 空 rows 反而會印一個「尾款 X 未收」的數字。)
 */
const PAYMENTS_UNREADABLE = { status: 'unreadable' } as const;

describe('#351④ 空箱區', () => {
  it('🔴 有空箱時:箱號畫出來 + 標「空箱」+ 有作廢鈕', async () => {
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1')]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(
      screen.queryByText('EMPTY1'),
      '空箱的箱號沒畫出來 ⇒ 員工還是「找不到那個箱子在哪裡」(Sean 08-09 逐字),#351④ 等於沒做。',
    ).not.toBeNull();
    expect(screen.queryByText('空箱'), '沒標「空箱」⇒ 員工分不出它跟正常包裹的差別').not.toBeNull();
    expect(
      screen.queryByText('作廢 EMPTY1'),
      '沒有作廢鈕 ⇒ 看得到卻處理不掉,只完成了一半。',
    ).not.toBeNull();
  });

  it('🔴 文案要講實話:這區是**客人層**、可能來自別張訂單', async () => {
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1')]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(
      screen.queryByText(/可能來自他的別張訂單/),
      'shipments 沒有 order_id(Sean 08-05 Q1=B 併箱同客人 ⇒ 本來就不該加)⇒ 這區列的箱' +
        '可能屬於這位客人的其他訂單。不講明就是假裝它是本單的。',
    ).not.toBeNull();
  });

  it('🔴 沒有空箱時整區不出現(常態是沒有,長期掛一句話會讓真的出現時不顯眼)', async () => {
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(screen.queryByText(/未收尾的空箱/), '沒有空箱卻掛著空箱區').toBeNull();
  });

  // 🔴 2026-08-12(codex R1 nit3):這一格守的是**跨檔的字面契約**。
  //    建箱彈窗的半成品箱文案叫員工「到『未收尾的空箱』作廢它」,而那個標題住在本檔測的元件裡。
  //    沒有這一格的話,標題改名 / 整區被拿掉,**兩邊的測試都照樣綠**,而員工被指去一個不存在的區塊
  //    —— 那正是 #351③ 當初刪掉地點的那個病復發。
  it('🔴 標題字面就是「未收尾的空箱」(彈窗文案指著它,改名要兩邊一起改)', async () => {
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1')]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    const heading = screen.queryByRole('heading', { name: /未收尾的空箱/ });
    expect(
      heading,
      'shipment-dialog.tsx 的半成品箱文案逐字指向這個標題;它改名或消失 = 文案指向不存在的東西。',
    ).not.toBeNull();
  });

  // ── fail-closed 要看得見(codex R1 MF2)────────────────────────────────
  //
  // 🔴 `null` = 算不出來(查不到客人 / 品項列被截斷),`[]` = 真的沒有空箱。
  //    這兩者原本畫出來**一模一樣**(整區不出現)⇒ 員工照彈窗文案來這裡,看到一張空白頁。
  describe('🔴 本單包裹清單算不出來時(loadOrderShipments 回 null)', () => {
    // 🔴🔴 **這一族 2026-08-16 才補,而在它之前那個 null 分支【零測試】** ——
    //    code-reviewer R1 MF3 抓的:把整段 null 分支刪掉退回 `groups.length === 0`,
    //    105 格照樣全綠。**我加的守門自己沒有守門。**
    //    ⚠️ 形狀就在同一支檔的下面(`empties === null` 那族),而我沒抄。
    it('🔴 要講出來,不是畫成「還沒有任何包裹」', async () => {
      loadOrderShipments.mockResolvedValue(null);
      render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
      expect(
        screen.queryByText(/沒能完整載入/),
        '截斷靜默 ⇒ 與「這張訂單還沒有任何包裹」畫面相同 ⇒ 員工會去建第二個箱。',
      ).not.toBeNull();
      // 🔴 正向對照:那句「還沒有任何包裹」**不可以同時出現** —— 兩句意思相反。
      expect(screen.queryByText(/還沒有任何包裹/)).toBeNull();
    });

    it('🔴 不列任何箱 —— 寧可不列,也不要列一份少了東西的清單', async () => {
      loadOrderShipments.mockResolvedValue(null);
      render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
      // 底下那句「這裡只列這張訂單…」是清單存在時才該出現的
      expect(screen.queryByText(/這裡只列/)).toBeNull();
    });
  });

  describe('算不出來時(null)', () => {
    it('🔴 要講出來,不是靜默消失', async () => {
      loadEmptyShipments.mockResolvedValue(null);
      render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
      expect(
        screen.queryByText(/沒能算出來/),
        'fail-closed 靜默 ⇒ 與「沒有空箱」畫面相同,員工找不到彈窗叫他來作廢的那個箱。',
      ).not.toBeNull();
    });

    it('🔴 要叫他留住箱號(這是他此刻唯一握得住的線索)', async () => {
      loadEmptyShipments.mockResolvedValue(null);
      render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
      expect(screen.queryByText(/箱號記下來/)).not.toBeNull();
    });

    it('🔴 **不得**畫出任何箱子(fail-closed 的行為本身不可放寬)', async () => {
      loadEmptyShipments.mockResolvedValue(null);
      render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
      expect(
        screen.queryByText('空箱'),
        '算不出來卻照樣列箱 ⇒ 可能指著一個其實裝著貨的箱叫員工作廢,比不列更糟。',
      ).toBeNull();
    });
  });

  // 🔴 R1 抓到的洞:原本 5 格全部沿用 `loadOrderShipments → []`,**沒有一格同時有包裹與空箱**
  //    ⇒ 把空箱區搬進「這張訂單還沒有任何包裹」那個真分支裡,5 格照樣全綠,
  //    而空箱在「這位客人**別張**有包裹的訂單頁」上全部消失 —— 那正是這區跨單語意的主場景。
  it('🔴 本單已有包裹時,空箱區**仍然要出現**(它不是「沒有包裹」時才顯示的替代畫面)', async () => {
    loadOrderShipments.mockResolvedValue([
      {
        shipment: { ...emptyBox('FULL1'), trackingNumber: '6412345678' },
        lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }],
      },
    ]);
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1')]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(screen.queryByText('FULL1'), '本單的包裹不見了').not.toBeNull();
    expect(
      screen.queryByText('EMPTY1'),
      '本單有包裹時空箱區就消失 ⇒ 這位客人的空箱只在他「沒有包裹」的訂單頁才看得到,' +
        '而空箱是**客人層**的、應該每一張都看得到。',
    ).not.toBeNull();
  });

  it('多個空箱各自一列、各自一顆作廢鈕(不是只畫第一個)', async () => {
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1'), emptyBox('EMPTY2')]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(screen.queryByText('作廢 EMPTY1')).not.toBeNull();
    expect(screen.queryByText('作廢 EMPTY2'), '第二個空箱沒畫 ⇒ 實作可能只取了第一筆').not.toBeNull();
  });

  it('前提 — 空箱查詢只吃訂單 id(不把帶成交價與 PII 的 detail 交給資料層)', async () => {
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(loadEmptyShipments).toHaveBeenCalledWith('o1');
  });
});


// ── 🔴 入口鈕的名字(2026-08-17)──
//
// 🔴 **這一格是【突變打偏】撿到的**:I 窗驗上一批時把「列印鈕改回無條件」誤打成
//    「入口鈕改回舊名」(`列印出貨明細單` -> `列印出貨單`)⇒ **rc=0、零格轉紅**
//    ⇒ **入口鈕改名這件事零測試覆蓋。**
// 📎 **突變打偏通常被當雜訊丟掉,而它其實是一次免費的覆蓋率量測。**
//
// ⚠️ 為什麼這個字面值得一格:紙上的 `<h1>` 與瀏覽器分頁名都已是「出貨明細單」
//    ⇒ **入口鈕留著舊名,員工會以為那是兩種不同的單**,而畫面上不會有任何異常。
//    (影響低是對的 —— 但「所以不必補」不成立:它是 Sean 肉眼會看到的面,而肉眼驗不是每次都做。)
describe('🔴 出貨卡的列印入口鈕名稱', () => {
  it('鈕上寫「列印出貨明細單」,不是舊名「列印出貨單」', async () => {
    loadOrderShipments.mockResolvedValue([
      { shipment: emptyBox('K7X2MP'), lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }] },
    ]);
    const { container } = render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    const link = container.querySelector('a[href*="/shipping/"]');
    expect(link?.textContent?.trim()).toBe('列印出貨明細單');
  });
});

// ─────────────── 片9 / 片11(2026-08-19 W3)───────────────

describe('🔴🔴 片9 尾款那一句:三態必須分得開(它就在「出貨」鈕旁邊)', () => {
  const withTotal = (amount: number) =>
    ({ ...detail, total: { ...detail.total, amount } }) as typeof detail;
  const paid = (n: number) =>
    ({ status: 'ok', rows: [{ amount: n }] }) as unknown as Parameters<
      typeof ShipmentSection
    >[0]['payments'];

  it('🔴 讀不到收款明細 ⇒ 【一個數字都不印】,而且要說「不是已收足」', async () => {
    // 理由逐字在 `payment-list.tsx:114-115`:「讀不到明細時算出來的『已收』必然是假的」。
    // 🔴 而在這個位置更貴:這句話就在**出貨**那顆鈕旁邊(字面見 `shipment-launcher.tsx:232`),
    //    印一個假的 0 會讓員工以為已收足而直接出貨。
    render(await ShipmentSection({ detail: withTotal(5000), payments: { status: 'unreadable' } }));
    const el = screen.getByText(/尾款/);
    expect(el.textContent).toContain('未知');
    expect(el.textContent).toContain('不是');
    // 🔴 負向:不得出現任何金額數字
    expect(el.textContent).not.toMatch(/[0-9],?[0-9]{3}/);
  });

  it('🔴 `order_not_found` 也是 unknown —— 三態裡的第二態,別只測 `unreadable`', async () => {
    // `:56` 那行只認 `ok`,其餘**兩**態都落到 unknown;原本只有 `unreadable` 有格,
    // 而「只測到一條路」與「兩條路都對」在全綠的畫面上長得一樣。
    render(await ShipmentSection({ detail: withTotal(5000), payments: { status: 'order_not_found' } }));
    const el = screen.getByText(/尾款/);
    expect(el.textContent).toContain('未知');
    expect(el.textContent).not.toMatch(/[0-9],?[0-9]{3}/);
  });

  it('還差錢 ⇒ 「尾款 N 未收」,而 N 是【應收 − 已收】', async () => {
    render(await ShipmentSection({ detail: withTotal(5000), payments: paid(2000) }));
    expect(screen.getByText(/尾款 3,000 未收/)).not.toBeNull();
  });

  it('🔴 收足 ⇒ 【要講「已收足」】,不是留白', async () => {
    // 留白與「讀不到」在畫面上長得一樣 ⇒ 空白不是一個安全的預設。
    render(await ShipmentSection({ detail: withTotal(5000), payments: paid(5000) }));
    expect(screen.getByText(/款項已收足/)).not.toBeNull();
  });

  it('溢收 ⇒ 標出來(Sean Q-溢收=A:只標不擋)', async () => {
    render(await ShipmentSection({ detail: withTotal(5000), payments: paid(6000) }));
    expect(screen.getByText(/已溢收 1,000/)).not.toBeNull();
  });

  it('🔴🔴 四態互不相同 —— 否則上面四格對「塌成兩態」是瞎的', async () => {
    const texts: string[] = [];
    for (const p of [
      { status: 'unreadable' } as const,
      paid(2000),
      paid(5000),
      paid(6000),
    ]) {
      render(await ShipmentSection({ detail: withTotal(5000), payments: p }));
      texts.push(screen.getByText(/尾款|已收足|已溢收/).textContent ?? '');
      cleanup();
    }
    expect(new Set(texts).size).toBe(4);
  });
});

describe('🔴🔴 片11 兩顆 chip:【加上去】不是換掉,而作廢的箱不畫 chip', () => {
  const activeGroup = () => ({
    shipment: emptyBox('BOX1'),
    lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }],
  });

  const shippedGroup = () => ({
    shipment: { ...emptyBox('BOX1'), shippedAt: '2026-08-19T00:00:00Z' },
    lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }],
  });

  it('未出貨 ⇒ 兩顆都在,而「已交寄」是**未完成**態', async () => {
    loadOrderShipments.mockResolvedValue([activeGroup()]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(screen.queryByText('已建立')).not.toBeNull();
    const sent = screen.getByText('已交寄');
    // 🔴 **原本這一格只斷言「已交寄」在場,而題目寫著「是未完成態」** ⇒ 宣稱了它沒有驗的事。
    //    未完成 = 灰(`bg-muted`),完成 = 綠(`bg-emerald-100`)。這是員工唯一看得到的差別。
    expect(sent.className, '未出貨的「已交寄」不是灰的 ⇒ 兩段進度線在畫面上分不開').toContain('bg-muted');
    expect(sent.className).not.toContain('emerald');
  });

  it('🔴🔴 已出貨 ⇒ 「已交寄」轉成完成態 —— 這是本片兩顆 chip **唯一會變化**的一格', async () => {
    // 🔴 為什麼非有不可:`已建立` 對非作廢箱恆為完成態(這一列存在即成立)⇒ 它零判別力。
    //    整條進度線上會動的只有這一格;沒有這格,把 `shipped ? 綠 : 灰` 改成常數
    //    (兩顆永遠一樣)**所有測試照樣全綠**,而畫面上「出貨了沒」就再也看不出來。
    loadOrderShipments.mockResolvedValue([shippedGroup()]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    const sent = screen.getByText('已交寄');
    expect(sent.className, '已出貨的「已交寄」沒有轉成完成態').toContain('bg-emerald-100');
    expect(sent.className).not.toContain('bg-muted');
  });

  it('🔴 而兩個世界必須長得不一樣 —— 否則上面兩格各自恆綠也看不出來', async () => {
    const seen: string[] = [];
    for (const g of [activeGroup(), shippedGroup()]) {
      loadOrderShipments.mockResolvedValue([g]);
      render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
      seen.push(screen.getByText('已交寄').className);
      cleanup();
    }
    expect(new Set(seen).size, '未出貨與已出貨的「已交寄」樣式相同 ⇒ 這顆 chip 沒有在表達任何東西').toBe(2);
  });

  it('🔴 只做兩顆 —— 「已送達」不得出現(U7 拍板沒有 delivered,沒有資料可以餵)', async () => {
    // `20260805170000_…s1a1_shipments.sql:128-131`:有這個值會讓後台顯示一個永遠不會變綠的狀態。
    loadOrderShipments.mockResolvedValue([activeGroup()]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(screen.queryByText('已送達')).toBeNull();
  });

  it('🔴🔴 作廢的箱:chip 不出現,而原本那行狀態文字【仍然在】', async () => {
    // 兩顆 chip 是一條進度線,線上沒有「作廢」的位置 ⇒ 換掉的話作廢箱會長得像「已建立、還沒交寄」。
    // 而本檔檔頭:「作廢 = 那些品項回到可出貨池,不是消失。過濾掉的話,員工會以為貨憑空不見了。」
    loadOrderShipments.mockResolvedValue([
      {
        shipment: { ...emptyBox('VOIDED1'), voidedAt: '2026-08-19T00:00:00Z', voidReason: '裝錯箱' },
        lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }],
      },
    ]);
    render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(screen.queryByText('已作廢'), '作廢那行狀態文字不見了 ⇒ 作廢箱與未交寄箱長得一樣').not.toBeNull();
    expect(screen.queryByText('已建立'), 'chip 畫在作廢箱上 ⇒ 進度線沒有「作廢」這個位置,會誤導').toBeNull();
  });
});

// ── 🔴 片14:出貨區照「720 側邊欄確認稿」補齊(2026-08-19)──
//
// 權威 = Aug-17 18:39「720 側邊欄確認稿」(`<title>` 逐字)。**出貨區是九塊裡唯一畫滿的一區(4/4)**
// ⇒ 這一節守的是「稿真的畫了、而我方原本沒有」的那幾格,不是我自己的版面偏好。
//   `:345`/`:543` 收件人資訊(姓名、電話、地址逗號連排,中間不留空白)
//   `:354`      已出貨包裹 + 箱數
//   `:378`      作廢這一箱
//
// 🔴 **這幾個字面同時是「頁首那張卡可以拿掉」的前提** —— 先給家、再搬走。
//    ⇒ 它們紅了不只是文案錯,是**資訊沒有家了**(頁首那張卡已經在同一片裡拿掉)。
describe('🔴 片14:出貨區的收件人資訊與包裹標題', () => {
  it('收件人資訊:姓名,電話,地址 逗號連排、中間不留空白', async () => {
    const { container } = render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(container.textContent).toContain('收件人資訊');
    // 🔴 比對**整串**,不是分開找三個值 —— 分開找的話「中間不留空白」那條約定完全沒被守到。
    expect(container.textContent).toContain('沈佑霖,0912345678,台中市西屯區文心路二段 201 號');
  });

  it('🔴 缺值印「—」而且整行還在(不是把行藏起來)', async () => {
    const noPhone = {
      ...(detail as unknown as Record<string, unknown>),
      shippingAddress: { name: '沈佑霖', phone: null, line: '台中市西屯區文心路二段 201 號' },
    } as unknown as AdminOrderDetail;
    const { container } = render(await ShipmentSection({ detail: noPhone, payments: PAYMENTS_UNREADABLE }));
    // 正向錨:整行仍在。少了這條,下面那條在「整區沒渲染」時會恆綠。
    expect(container.textContent, '收件人資訊整行不見了 ⇒ 下面那條斷言會恆綠').toContain('收件人資訊');
    expect(container.textContent).toContain('沈佑霖,—,台中市西屯區文心路二段 201 號');
  });

  it('包裹清單有標題「已出貨包裹」+ 箱數', async () => {
    loadOrderShipments.mockResolvedValue([
      { shipment: emptyBox('K7X2MP'), lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }] },
    ]);
    const { container } = render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(container.textContent).toContain('已出貨包裹');
    expect(container.textContent).toContain('1 箱');
  });

  it('🔴 沒有任何包裹時【不得】出現「已出貨包裹」標題(負向對照,防我把標題掛在區塊上)', async () => {
    loadOrderShipments.mockResolvedValue([]);
    const { container } = render(await ShipmentSection({ detail, payments: PAYMENTS_UNREADABLE }));
    expect(container.textContent, '出貨區沒渲染 ⇒ 下面那條會恆綠').toContain('收件人資訊');
    expect(container.textContent).not.toContain('已出貨包裹');
  });

  // 📌 **「作廢這一箱」那個字面不在這一檔守** —— 本檔把 `ShipmentVoidButton` 整支 mock 成佔位
  //    (檔頭 `vi.mock('./shipment-void-button')`,印的是「作廢 <箱號>」)。
  //    ⚠️ **我第一版把斷言掛在這裡,它讀到的是【我自己的佔位】** —— 兩顆鈕都含「作廢」二字,
  //       用關鍵字找會找到錯的那一顆,而它會回綠。
  //    ⇒ 那個字面改守在 `shipment-void-button.test.tsx`(片14 新建,原本零測試)。
});
