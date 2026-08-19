// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderItemProcurement } from '@pcm/domain';
import type { ProcurementActionState } from '../../lib/orders/procurement-action-state';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn<
    (prev: ProcurementActionState, form: FormData) => Promise<ProcurementActionState>
  >(),
}));
// `procurement-suppliers` → `lib/supplier.ts` → `supplier-repository.ts` → server-only。
// 只 mock 倉庫層,排序仍走真的那一把。
vi.mock('../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));

import {
  EMPTY_PROCUREMENT_VALUES,
  procurementFailure,
} from '../../lib/orders/procurement-action-state';
import {
  ItemProcurementBlock,
  ItemProcurementOrderNotices,
} from './item-procurement-section';

/**
 * 🔴🔴 **片7:`ItemProcurementSection` 這個匯出沒有了** —— 採購搬進每張商品卡的展開區,
 * 檔案拆成「對整張單說的」與「對某一項說的」兩個匯出。
 *
 * 本檔 39 格守的是**那些話對不對**(截斷 / 讀不到 / 作廢列 / 未登記件數 / 供應商清單…),
 * **不是**「它包在哪個外殼裡」⇒ 這裡用一個本地組合把兩個匯出接回原本的形狀,
 * **45 個呼叫點一個字都不用改**,39 格繼續守同一件事。
 *
 * ⚠️ **誠實代價,不要讀寬**:這個本地組合**不是**正式的組法(正式的在 `ItemsTable` 裡,
 * 而且每一項是包在一張 `<details>` 卡裡的)⇒ **本檔證不到「接線接對了」**。
 *
 * 🔴🔴 **接線由誰守,寫死在這裡(W6 `W6-056` 要求)**:
 *    `app/orders/[id]/procurement-wiring.test.tsx` 的
 *    **「採購區塊有渲染出來(標題 + 每個品項一份表單)」**那一格 —— 它跑的是**真的頁面**,
 *    而且**帶負對照**(展開前 `select[name="supplier_id"]` 是 **0** 個 → 展開後 **1** 個)。
 * ⚠️ **沒有這一行,下一個人刪掉那一格時,本檔這 39 格【不會說話】** ——
 *    它們會繼續全綠,而接線已經斷了。「話對不對」與「線接上沒」是兩支檔在守,
 *    而只有這一行讓第二支檔的存在被知道。
 */
function ItemProcurementSection({
  detail: d,
  returnTo,
  suppliers,
  suppliersFailed,
}: {
  detail: AdminOrderDetail;
  returnTo: string;
  suppliers: Parameters<typeof ItemProcurementBlock>[0]['suppliers'];
  suppliersFailed: boolean;
}) {
  return (
    <>
      <ItemProcurementOrderNotices detail={d} suppliersFailed={suppliersFailed} />
      {d.items.map((item) => (
        <ItemProcurementBlock
          key={item.id}
          detail={d}
          item={item}
          returnTo={returnTo}
          suppliers={suppliers}
        />
      ))}
    </>
  );
}

const SUP_A = '33333333-3333-4333-8333-333333333333';
const SUP_B = '44444444-4444-4444-8444-444444444444';

function proc(over: Partial<AdminOrderItemProcurement> = {}): AdminOrderItemProcurement {
  return {
    id: 'p-1',
    supplierId: SUP_A,
    supplierLabel: 'RPM Carbon',
    supplierIsActive: true,
    allocatedQuantity: 3,
    receivedQuantity: 1,
    replyStatus: 'partial',
    contactChannel: 'LINE',
    submittedAt: null,
    supplierOrderNo: 'SO-123',
    exceptionReason: '原廠缺料',
    expectedArrivalDate: '2026-09-30',
    firstOrderedAt: null,
    statusChangedAt: null,
    createdAt: '2026-08-04T02:00:00+00:00',
    // #476 片1:預設 = **生效中**。片3 會用 `proc({ voidedAt: … })` 構造作廢列來測顯示標示。
    voidedAt: null,
    voidReason: null,
    ...over,
  };
}

function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    items: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        variantSku: 'SKU-1',
        title: '下導流',
        spec: null,
        quantity: 4,
        unitPrice: { amount: 100, currency: 'TWD' },
        lineTotal: { amount: 400, currency: 'TWD' },
        procurements: [proc()],
        procurementTruncated: false,
        // 🔴 這個 fixture 走 `as unknown as AdminOrderDetail` ⇒ 型別**擋不住漏欄**。
        //    #352-b-2 的衍生指標讀這一欄,漏給時整檔 8 格一起炸(本片實錘)⇒ 顯式給。
        quantitySummary: {
          quantity: 4,
          orderedQuantity: 4,
          instockQuantity: 1,
          cancelledQuantity: 0,
          cancellableQuantity: 3,
        },
      },
    ],
    itemsTruncated: false,
    ...over,
  } as unknown as AdminOrderDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

/** #350d-3:表單的 `return_to` 值(用過得了 parser 的形狀:站內 /orders 路徑)。 */
const RETURN_TO = '/orders?payment_status=paid';

describe('ItemProcurementSection — 採購列顯示', () => {
  // 🔴 斷言限定在**表格**內:供應商名字同時會出現在下拉選單的 <option> 裡
  //    (buildSupplierChoices 把既有採購的供應商併進選單)⇒ 不限定範圍會撞到兩個節點。
  it('顯示供應商 / 訂購 / 到貨 / 回覆狀態 / 單號 / 預計到貨 / 異常原因', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed={false} />,
    );
    const table = container.querySelector('table')!;
    const text = table.textContent ?? '';
    expect(text).toContain('RPM Carbon');
    expect(text).toContain('部分出貨');
    expect(text).toContain('SO-123');
    expect(text).toContain('2026-09-30');
    expect(text).toContain('原廠缺料');
    // 訂購 3 / 到貨 1 都要在(數量欄是這張表最容易被排錯欄位的地方)
    const cells = [...table.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells[1]).toBe('3');
    expect(cells[2]).toBe('1');
  });

  // 🔴 片1(2026-08-18):這一格的**字面換了,而它守的那件事沒換**。
  //    原本逐字「沒有採購紀錄 → 明說『還沒有採購紀錄』,**不是空白**」——
  //    **「不是空白」那個意圖仍然成立**,只是空狀態現在說的是 OD 定案稿那句
  //    (`overview-desktop.html:1061-1062`),而且底下那組空白表單收進 `<details>`。
  //    ⚠️ **我改的是期望值,而那在 PCM 是一個停止訊號** ⇒ 所以把理由寫在這裡:
  //       改期望值合法的唯一情況是**規格本身變了**(Sean 拍板 `08 = 甲`),不是「測試擋路」。
  //       原意圖(不得空白)**我留著並且加強了**:下面第一條就在驗它。
  it('零採購列 → 空狀態說得出「還不能出貨」與下一步,而不是空白', () => {
    const d = detail();
    d.items[0]!.procurements = [];
    const { getByText, container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    // ① 原意圖:不是空白,而且說得出「為什麼還不能出貨」
    expect(getByText(/還沒跟任何供應商訂,所以也還不能出貨。/)).toBeTruthy();
    // ② 有下一步可以按（OD 逐字的那顆）
    expect(getByText(/＋ 跟供應商下訂/)).toBeTruthy();
    // ③ 🔴 結構斷言:表單收在 `<details>` 裡、而且**預設收起**（沒有 `open`）。
    //    ⚠️ **jsdom 量不到「看不見」**(`audit-detail.tsx:11-13` 逐字)⇒ 只能驗 DOM 結構。
    //    這一條的判別力:把 `<details>` 拿掉、或加上 `open`，這一格會紅。
    const det = container.querySelector('details');
    expect(det).not.toBeNull();
    expect(det!.hasAttribute('open')).toBe(false);
    // ④ 🔴 而表單**仍在 DOM 裡**——收起 ≠ 拿走。拿走的話員工就沒有路可以下訂了。
    expect(det!.querySelector('form')).not.toBeNull();
    // ⑤ 🔴🔴 **那句話與 CTA 必須在 `<summary>` 裡面,不是只在 `<details>` 裡面**
    //    (code-reviewer 2026-08-18 實測:把 `<summary>` 換成 `<div>` ⇒ **上面四條全綠**,
    //     而真瀏覽器下那等於「文案與 CTA 一起掉進收合區、看不見」,
    //     `<details>` 改印瀏覽器預設的 "Details")。
    //    同 repo 守著同一件事的先例:`audit-detail.test.tsx`(「收合摘要行不得含任何值」)。
    const summary = det!.querySelector('summary');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain('還沒跟任何供應商訂');
    expect(summary!.textContent).toContain('＋ 跟供應商下訂');
    // ⑥ 🔴 不得出現第二塊講同一件事的琥珀框(Sean 這輪判準逐字是「變少了沒有」)。
    //    `UnsourcedNotice` 那句「請在下面補上要向誰訂」在收合狀態下指著一個看不見的東西。
    expect(container.textContent).not.toContain('沒有登記來源');
  });

  // 🔴 反面那一格(**沒有它,上面那格會讓「無條件收合」也全綠**):
  //    截斷時 `procurements` 看起來也可能是空的,而那是「**沒撈到**」不是「**沒有**」——
  //    兩者的下一步相反(一個去下訂、一個去重整)⇒ 截斷時**不得**收合成「還沒訂」。
  it('零採購列【但訂單層被截斷】→ 不收合、不說「還沒跟任何供應商訂」', () => {
    const d = detail();
    d.items[0]!.procurements = [];
    d.itemsTruncated = true;
    const { container, queryByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(queryByText(/還沒跟任何供應商訂/)).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  // 🔴🔴 **本格的 fixture `#646`(2026-08-18)換過,而換的理由要留著:**
  //    ~~舊 fixture `procurements: []` + `procurementTruncated: true`~~,理由段還宣稱它來自
  //    「兩條真的生產路徑」(`order-procurement.ts` 的 missing、`merge-detail-items.ts` 的第 201 項)。
  //    🔴 `#646` 之後**那兩條路徑都改回 `procurements: null`** ⇒ 舊 fixture 變成一個
  //    **生產端造不出來的狀態**(memory `feedback_green-in-a-world-that-cannot-happen`:
  //    突變會紅、覆蓋率算它、而它測的世界上游產不出來)。
  //    ⇒ 換成**現在真的產得出來**的那一個:`procurements: null`(讀不到)、訂單層沒截斷。
  //    守的東西不變:**零採購列的收合快樂路徑,不得在「其實是沒讀到」時出現**
  //    (把條件寫成單看 `detail.itemsTruncated` 的實作會在這裡紅)。
  it('讀不到採購【而訂單層沒截斷】→ 一樣不收合(單邊守門會漏掉這條路)', () => {
    const d = detail();
    d.items[0]!.procurements = null;
    d.items[0]!.procurementTruncated = false;
    d.itemsTruncated = false;
    const { container, queryByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(queryByText(/還沒跟任何供應商訂/)).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  // 🔴 A9a-2:label 為 null = 內嵌沒回來,不是「這家沒有名字」⇒ 誠實顯示缺、不得空白
  it('supplierLabel 為 null → 顯示「(查不到這家供應商)」', () => {
    const d = detail();
    d.items[0]!.procurements = [proc({ supplierLabel: null })];
    const { getByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText('(查不到這家供應商)')).toBeTruthy();
  });

  it.each([
    [false, '(已停用)'],
    [null, '(狀態不明)'],
  ])('supplierIsActive=%s → 標記 %s', (isActive, label) => {
    const d = detail();
    d.items[0]!.procurements = [proc({ supplierIsActive: isActive as boolean | null })];
    const { getByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(label)).toBeTruthy();
  });
});

describe('ItemProcurementSection — 兩個截斷旗標都要接', () => {
  it('itemsTruncated(外層)→ 顯示整單警告、且每個品項的表單都拒送', () => {
    const { container, getByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO}
        detail={detail({ itemsTruncated: true })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getByText(/品項清單這次沒有完整載入/)).toBeTruthy();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[name="procurement_stale"]')!.value,
    ).toBe('1');
  });

  it('procurementTruncated(內層)→ 顯示該品項的警告、該表單拒送', () => {
    const d = detail();
    d.items[0]!.procurementTruncated = true;
    const { container, getByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(/採購紀錄太多,超過一次能載入的上限/)).toBeTruthy();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  // ── `#643` B(2026-08-18):那句話原本叫員工做一件永遠不會成功的事 ──────────
  //
  // 🔴 **舊字面逐字:「請重新整理這張單;在完整載入之前不能編輯採購(…)」**
  //    而 `itemsTruncated = order_items.length >= 200`(`mappers/order.ts:911`)
  //    ⇒ 重整拿到同一個數字。全陣紀律逐字(`account-order-copy.ts:16`):
  //    **「請重新整理」只准出現在【真的重整就會好】的地方。**
  // ⚠️ 這一組守的是**句型**,不是某個字 —— 光禁「重新整理」四個字會擋掉條件句那半。
  //    (~~原註寫「`procurementTruncated` 的 `missing` 那半」~~ —— `#646` 之後那一半已經
  //     不在這顆布林裡了,改由 `procurements === null` 表示。)
  it.each([
    ['order（外層 itemsTruncated）', () => detail({ itemsTruncated: true })],
    [
      'item（內層 procurementTruncated）',
      () => {
        const d = detail();
        d.items[0]!.procurementTruncated = true;
        return d;
      },
    ],
  ])('🔴 %s:不得出現「請重新整理這張單」那個【宣稱重整會好】的句型', (_label, make) => {
    const { getByRole } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={make()} suppliers={[]} suppliersFailed={false} />,
    );
    const alert = getByRole('alert');
    expect(alert.textContent, '這個句型宣稱重整會好').not.toContain('請重新整理這張單');
  });

  it.each([
    ['order（外層）', () => detail({ itemsTruncated: true })],
    [
      'item（內層）',
      () => {
        const d = detail();
        d.items[0]!.procurementTruncated = true;
        return d;
      },
    ],
  ])('🔴 %s:兩個 scope 都不得出現【宣稱重整會好】的句型', (_label, make) => {
    const { getByRole } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={make()} suppliers={[]} suppliersFailed={false} />,
    );
    const t = getByRole('alert').textContent ?? '';
    expect(t, '「請重新整理這張單」宣稱重整會好').not.toContain('請重新整理這張單');
    expect(t, '出路:找誰').toContain('負責人');
    // 🔴 這半句描述的是【真的擋著的行為】(`item-procurement-form.tsx:263` 的 fieldset disabled
    //    + 該檔 `:49` 自陳 action 端第二道)⇒ 把它當廢話刪掉會製造一個新的靜默失敗。
    expect(t, '那半句真的擋著的行為').toContain('不能編輯採購');
  });

  // 🔴🔴 `#646` 關卡2 codex must-fix:**兩個 scope 的講法不同,而理由是【證據不同】。**
  //    item  scope 的旗標語意只有「撞到採購內嵌上限」            ⇒ 純固定 ⇒ 講得死
  //    order scope 的旗標併了「>= 200」與「筆數對帳不符」兩個來源 ⇒ 後者**重整可能會好**
  //    ⇒ 對 order 講死 = 對那條路說謊。**這兩格成對,只留一格會讓「兩邊都講死」的壞實作有一格綠。**
  it('🔴 item(內層):純固定證據 ⇒ 講死「重新整理不會改變」', () => {
    const d = detail();
    d.items[0]!.procurementTruncated = true;
    const { getByRole } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    const t = getByRole('alert').textContent ?? '';
    expect(t, 'item 這一半有純固定證據,要講死').toContain('固定限制');
    expect(t).toContain('重新整理不會改變');
  });

  it('🔴 order(外層):旗標併了兩個來源 ⇒ **不得**斷言固定,要保留條件句', () => {
    const { getByRole } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail({ itemsTruncated: true })} suppliers={[]} suppliersFailed={false} />,
    );
    const t = getByRole('alert').textContent ?? '';
    expect(t, '① 先給一個可執行的動作(這條路重整【可能】會好)').toContain('可以先重新整理看看');
    expect(t, '② 重整之後還是這樣的判準').toContain('如果還是這樣');
    expect(
      t,
      '🔴 斷言「重新整理不會改變」對【筆數對帳不符】那條路是假的(codex 關卡2 must-fix)',
    ).not.toContain('重新整理不會改變');
  });

  // ── `#646`(2026-08-18,Sean 批「現在做」)─────────────────────────────
  //
  // 🔴 **本組是這一片存在的理由**:舊形狀一顆布林兩個世界 ⇒ 文案只能寫條件句。
  //    拆開之後**四種組合各自講死**,而下面四格就是「兩個世界會不會印出不同的東西」的測量。
  describe('`#646` 讀不到 vs 觸及上限:四種組合各說各的話', () => {
    const unreadable = (truncated: boolean) => {
      const d = detail();
      d.items[0]!.procurements = null;
      d.items[0]!.procurementTruncated = truncated;
      return d;
    };

    // 🔴🔴 關卡2 codex 兩輪之後的契約:**「讀不到」這一種【不宣稱】是哪個世界。**
    //    理由(寫在 `UnreadableWarning` 上方):我們手上沒有品項級的證據可以斷定
    //    ——「訂單層撞過上限」是**訂單**的事實,穿在**品項**身上就是猜的(codex round2 抓到)。
    //    ⇒ 下面兩格釘住的是【不准說謊】:兩個方向的斷言都不得出現。
    it.each([
      ['該品項自己沒有截斷旗標', false, false],
      ['該品項自己帶著截斷旗標', true, false],
      ['整張單也截斷了', false, true],
    ])('🔴 讀不到(%s)⇒ 講「沒有讀到」+ 條件句,兩個方向的斷言都不准', (_l, itemFlag, orderFlag) => {
      const d = unreadable(itemFlag);
      d.itemsTruncated = orderFlag;
      const { getAllByRole } = render(
        <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
      );
      const t = getAllByRole('alert').find((a) => (a.textContent ?? '').includes('沒有讀到'))?.textContent ?? '';
      expect(t, '沒讀到 ≠ 沒有採購,這一句是本片的核心').toContain('沒有讀到');
      expect(t, '① 給一個可執行的動作(這條路重整【可能】會好)').toContain('可以先重新整理看看');
      expect(t, '② 試完之後的判準與出路').toContain('如果還是這樣');
      expect(
        t,
        '🔴 不得斷言【固定】:我們沒有品項級證據 —— 拿訂單層事實去斷定品項 = codex round2 那條',
      ).not.toContain('重新整理不會改變');
      expect(
        t,
        '🔴 也不得斷言【暫時】:「請重新整理這張單」是宣稱重整會好,那一樣沒有證據',
      ).not.toContain('請重新整理這張單');
    });

    it('🔴 讀不到時**不得**走「還沒跟任何供應商訂」那條快樂路徑(那句話是假的)', () => {
      const { container } = render(
        <ItemProcurementSection returnTo={RETURN_TO} detail={unreadable(false)} suppliers={[]} suppliersFailed={false} />,
      );
      const t = container.textContent ?? '';
      expect(t, '「沒撈到」被講成「沒有」——這正是 `#646` 要修的病').not.toContain('還沒跟任何供應商訂');
    });

    it('🔴 讀不到時採購表單要停用(fail-closed 沒有因為拆旗標而變鬆)', () => {
      const { container } = render(
        <ItemProcurementSection returnTo={RETURN_TO} detail={unreadable(false)} suppliers={[]} suppliersFailed={false} />,
      );
      // 舊版靠 missing ⇒ truncated=true 擋住;`#646` 之後由 `unreadable` 接手擋。
      expect(container.querySelector('button[type="submit"]')).toBeNull();
      expect(
        container.querySelector<HTMLInputElement>('input[name="procurement_stale"]')!.value,
        'stale 沒帶 1 ⇒ 伺服器端那道也一起失效',
      ).toBe('1');
    });

    it('🔴 正向對照:讀得到 + 沒截斷 ⇒ 一則警告都不該出現(否則上面四格可能是恆真的)', () => {
      const { queryByRole } = render(
        <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed={false} />,
      );
      expect(queryByRole('alert')).toBeNull();
    });
  });

  // 🔴 **伺服器端那則是同一個病的回聲,不是另一件事** ——
  //    `stale` 由表單 hidden 欄位帶上來,值 = `truncated ? '1' : '0'`(`item-procurement-form.tsx:248`),
  //    而 `truncated = item.procurementTruncated || detail.itemsTruncated` ⇒ **同一個旗標**。
  //    只改看得見那則的話,員工照樣按送出、然後從這裡拿到舊的錯指示。
  it('🔴 伺服器端 `stale` 那則:不複述下一步、指向畫面那則(`#646` 之後分不出是哪一種)', () => {
    // 🔴 走【公開函式】拿訊息,不是 import 內部常數表 ——
    //    後者測得到字串卻測不到「這個碼真的會拿到這句」。
    // 🔴 走【公開函式】而不是 import 內部常數表:後者測得到字串,測不到「這個碼真的會拿到這句」。
    //    回傳是 union ⇒ 先收窄成 'failed',否則 `.message` 在型別上不存在
    //    (⚠️ vitest 綠而 typecheck 紅 —— 我第一版就是這樣,四綠才抓到)。
    const state = procurementFailure('stale', null, EMPTY_PROCUREMENT_VALUES);
    expect(state.status).toBe('failed');
    const msg = state.status === 'failed' ? state.message : '';
    expect(msg).not.toContain('請重新整理這張單');
    // 🔴 `#646`:伺服器端這則**分不出是哪一種**(hidden `stale` 只帶得上來一個 1)
    //    ⇒ 契約從「同一個句型」改成「不自己複述下一步、指向畫面那則」。
    expect(msg, '不得再宣稱重整會好').not.toContain('請重新整理這張單再操作');
    expect(msg, '要指向那則真正分得出情況的說明').toContain('畫面上那則說明');
    expect(msg, '仍要講清楚現在送出的後果').toContain('覆蓋既有資料');
    // ~~原本還要求「如果還是這樣」「負責人」~~ —— 那兩句是**下一步指示**,
    // 而本則現在刻意不給下一步(它分不出是哪一種情況)⇒ 兩條期望隨契約一起撤掉。
  });

  it('負向對照:同一份文案表裡【真的重整就會好】那幾則不受影響(不是把四個字全域禁掉)', () => {
    // `error` / `bug` 是寫入之後的狀態不明 ⇒ 重整就是正確的下一步 ⇒ 那句話在那裡是對的。
    // 沒有這一格,上面那格會誘導下一個人去做全域字串替換。
    for (const code of ['error', 'bug'] as const) {
      const st = procurementFailure(code, null, EMPTY_PROCUREMENT_VALUES);
      expect(st.status === 'failed' && st.message).toContain('請重新整理這張單');
    }
  });

  it('負向對照:兩個旗標都 false ⇒ **完全沒有** alert(⇒ 上面四格不是恆真)', () => {
    const { queryByRole } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed={false} />,
    );
    expect(queryByRole('alert')).toBeNull();
  });

  it('兩個都 false → 表單可送', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed={false} />,
    );
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });
});

describe('ItemProcurementSection — 供應商清單', () => {
  // 🔴 停用的既有供應商必須留在選單裡(否則那一列永遠改不了)
  it('選單 = 啟用清單 ∪ 既有採購的供應商(含已停用)', () => {
    const d = detail();
    d.items[0]!.procurements = [proc({ supplierId: SUP_A, supplierIsActive: false })];
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO}
        detail={d}
        suppliers={[{ id: SUP_B, label: 'Webike TW' }]}
        suppliersFailed={false}
      />,
    );
    const values = [...container.querySelectorAll('option')].map((o) => o.getAttribute('value'));
    expect(values).toContain(SUP_A);
    expect(values).toContain(SUP_B);
  });

  // 🔴 供應商清單載入失敗**不得靜默**:選單空掉會讓員工以為「這家不存在」而建重複的,
  //    而供應商不可刪除 ⇒ 製造永久垃圾列(`lib/supplier.ts:22-26` 逐字)。
  it('suppliersFailed → 顯示警告,不是靜默的空選單', () => {
    const { getByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed />,
    );
    expect(getByText(/供應商清單載入失敗/)).toBeTruthy();
  });
  // 🔴 #352-b 入口 1 的**正向**格 —— 沒有這一格,「截斷時收起來」那兩格會變成恆真:
  //    把 ReceiptRecordForm 整個刪掉,截斷格照樣綠(本來就沒鈕),而入口就這樣悄悄消失了。
  //    ⇒ 正負成對:沒截斷要看得到、截斷要看不到。
  it('沒截斷 → 每列採購都有「登錄到貨」入口', () => {
    const { getAllByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={detail()}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getAllByText('登錄到貨').length).toBeGreaterThan(0);
  });

  it('截斷 → 「登錄到貨」入口收起來(與警告文案「不能編輯採購」同一條不變式)', () => {
    const { queryByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={detail({ itemsTruncated: true })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(queryByText('登錄到貨')).toBeNull();
  });
});

// 🔴🔴 `#476` 片3:作廢列的顯示面。
//
// **這一組的存在理由**:片1 把 `voidedAt` 帶進讀模型、片2 讓表單只挑生效列,但**畫面上
// 作廢列與生效列長得一模一樣**,而「訂購數」已經把它扣掉了 ⇒ 員工看到「表格列了 3 件、
// 系統說還有 3 件沒登記來源」這種互相矛盾而沒有一行字解釋的畫面(`#476` 條目逐字)。
//
// ⚠️ **構造照正式庫走得到的形狀**:partial unique(`20260813120000` 步3)+ `Q-S1=A` 允許重下單
//    ⇒ 同鍵可有「一作廢 + 一生效」兩列;mapper 依 `createdAt` ASC 排 ⇒ 作廢的(較舊)排前面。
describe('🔴 #476 片3:作廢的採購列要看得出來,而且不給到貨入口', () => {
  const VOIDED = proc({
    id: 'p-void',
    supplierId: SUP_B,
    supplierLabel: 'Webike JP',
    supplierOrderNo: 'SO-舊-已作廢',
    createdAt: '2026-08-01T00:00:00+00:00',
    voidedAt: '2026-08-10T00:00:00+00:00',
    voidReason: '供應商回報缺料、改下另一家',
  });

  function withVoided(over: Parameters<typeof proc>[0] = {}) {
    const d = detail();
    return {
      ...d,
      items: [{ ...d.items[0]!, procurements: [VOIDED, proc(over)] }],
    } as typeof d;
  }

  it('作廢列標「(已作廢)」+ 刪除線;生效列兩者都不得有', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={withVoided()} suppliers={[]} suppliersFailed={false} />,
    );
    // 🔴 **按語意選列,不按位置索引**(片4 在作廢列下面插了一列「作廢原因」⇒ `rows[1]`
    //    不再是生效列)。位置索引在「同一區塊日後多一列」時會靜默指到別人身上。
    const dataRows = [...container.querySelectorAll('tbody tr')].filter(
      (r) => r.querySelectorAll('td').length > 1, // 原因列是單一 colSpan 格
    );
    expect(dataRows.length).toBe(2);
    const voidedRow = dataRows[0]!;
    const activeRow = dataRows[1]!;
    // 🔴 逐列比對,不是「整張表含有『已作廢』」—— 後者無法分辨標到哪一列
    expect(voidedRow.textContent).toContain('(已作廢)');
    expect(voidedRow.querySelector('.line-through')).not.toBeNull();
    expect(activeRow.textContent).not.toContain('(已作廢)');
    expect(activeRow.querySelector('.line-through')).toBeNull();
    // 🔴 整列淡化也要驗(codex nit:拿掉 `opacity-60` 原本 0 紅)——
    //    刪除線只在供應商那一格,整列淡化才是「一眼掃過去看得出哪幾列不算數」的那個訊號。
    expect(voidedRow.className).toContain('opacity-60');
    expect(activeRow.className).not.toContain('opacity-60');
  });

  it('🔴 作廢列不給「登錄到貨」;同一張表的生效列照給(正負成對,免得整欄消失也綠)', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={withVoided()} suppliers={[]} suppliersFailed={false} />,
    );
    const dataRows = [...container.querySelectorAll('tbody tr')].filter(
      (r) => r.querySelectorAll('td').length > 1,
    );
    expect(dataRows[0]!.textContent).not.toContain('登錄到貨');
    expect(dataRows[1]!.textContent).toContain('登錄到貨');
  });

  // 🔴 codex 關卡2:全部 fixture 只有 `null` / `string` ⇒ `!= null` 與 `!== null` 兩種寫法在
  //    現有格上**完全等價**、五發突變都分不出來。這格專證方向:`undefined` 必須倒向「當生效」。
  //    (方向的理由與 `procurement-view.ts:findActiveProcurement` 同源:`=== null` 會讓
  //     缺欄時每一列都被判作廢 ⇒ 全表劃線 + 到貨入口全消失,而資料其實好好的。)
  it('🔴 voidedAt 為 undefined(投影退版)⇒ 當【生效】處理,不得全表判成作廢', () => {
    const d = detail();
    const missingCol = {
      ...d,
      items: [
        {
          ...d.items[0]!,
          procurements: [{ ...proc(), voidedAt: undefined, voidReason: undefined }],
        },
      ],
    } as unknown as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={missingCol} suppliers={[]} suppliersFailed={false} />,
    );
    const row = container.querySelector('tbody tr')!;
    expect(row.textContent).not.toContain('(已作廢)');
    expect(row.querySelector('.line-through')).toBeNull();
    expect(row.textContent).toContain('登錄到貨'); // 到貨入口不得被誤收
  });

  // 🔴🔴 `#476` 片4:**作廢原因**。片3 只說了「它撤了」,而條目的病灶逐字是
  //    「兩個數字互相矛盾而**沒有任何一行字解釋**」⇒ 不說為什麼就只解了一半。
  it('作廢列下面帶出「作廢原因:…」', () => {
    const d = detail();
    const withReason = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={withReason} suppliers={[]} suppliersFailed={false} />,
    );
    expect(container.querySelector('tbody')!.textContent).toContain('作廢原因:供應商回報缺料、改下另一家');
  });

  // 🔴🔴 **這格是 code-reviewer 用實跑突變逼出來的**:把 `reason={p.voidReason}` 換成
  //    `reason={item.procurements[0]!.voidReason}`(全部用第一筆的原因)⇒ **28 格全綠**。
  //    病因:所有 fixture 都只有「一筆作廢」⇒ 「配給誰」這件事零覆蓋。
  //    🔴 而「拿相鄰的那筆當成要的那筆」**正是 `#476` 這條 backlog 本身的病**。
  it('🔴 兩筆作廢、原因各異 ⇒ 各自貼在自己那列後面(不是全部用第一筆的)', () => {
    const d = detail();
    const two = {
      ...d,
      items: [
        {
          ...d.items[0]!,
          procurements: [
            proc({ ...VOIDED, id: 'p-v1', supplierLabel: '甲供應商', voidReason: '甲的原因' }),
            proc({ ...VOIDED, id: 'p-v2', supplierLabel: '乙供應商', voidReason: '乙的原因' }),
          ],
        },
      ],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={two} suppliers={[]} suppliersFailed={false} />,
    );
    const rows = [...container.querySelectorAll('tbody tr')];
    // 順序 = 資料列、原因列、資料列、原因列
    expect(rows.length).toBe(4);
    expect(rows[0]!.textContent).toContain('甲供應商');
    expect(rows[1]!.textContent).toContain('甲的原因');
    expect(rows[2]!.textContent).toContain('乙供應商');
    expect(rows[3]!.textContent).toContain('乙的原因');
    // 反向:乙的原因不得出現在甲那一列後面
    expect(rows[1]!.textContent).not.toContain('乙的原因');
  });

  it('原因列跨滿整張表(colSpan 等於表頭欄數,否則欄位會靜默錯位)', () => {
    const d = detail();
    const one = { ...d, items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED })] }] } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={one} suppliers={[]} suppliersFailed={false} />,
    );
    const headCount = container.querySelectorAll('thead th').length;
    const reasonCell = container.querySelectorAll('tbody tr')[1]!.querySelector('td')!;
    // 🔴 不寫死 9:表頭加欄時這格要跟著紅,寫死的話它會變成第二個真相源
    expect(Number(reasonCell.getAttribute('colspan'))).toBe(headCount);
    // 原因列也要跟著淡化(片3 為資料列補過同一課,新列漏補 = codex nit)
    expect(container.querySelectorAll('tbody tr')[1]!.className).toContain('opacity-60');
  });

  it('剛好在門檻上的原因**不**收合(邊界 <= 那一側)', () => {
    const d = detail();
    const exact = '缺'.repeat(60); // 恰 60 字 = 門檻值本身
    const atLimit = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, voidReason: exact })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={atLimit} suppliers={[]} suppliersFailed={false} />,
    );
    // 🔴 **錨收窄到 `tbody`(2026-08-19 片17)**,而這【不是放寬】:
    //    本格釘的是「**作廢原因**恰好在門檻上時不收合」,而原因就住在 `tbody` 那一列裡
    //    (下一行 `tbody.textContent` 已經釘死它在那裡)。
    //    ⚠️ 原本寫 `container.querySelector('details')` 是一個**代理**——
    //       它成立的前提是「這個元件裡唯一的 `<details>` 就是原因那個」。
    //    🔴 片17 讓那個前提不再成立:新增採購表單也收進了一個 `<details>`(在 `tbody` 外面)
    //       ⇒ 代理開始量到別人的東西。**改的是錨的範圍,判準一個字沒動。**
    //    📌 判別句:**一個用「全場只有一個」當前提的選擇器,在有人加第二個的那天會靜默量錯對象。**
    expect(container.querySelector('tbody details')).toBeNull();
    expect(container.querySelector('tbody')!.textContent).toContain(exact);
  });

  /**
   * 🔴🔴 **片17(2026-08-19):有採購列時,「新增採購」表單要【收起】。**
   *
   * 為什麼有這一格:實量(真瀏覽器、720×900 面板、12 品項/8 項有採購)——
   * ```
   * 面板 scrollHeight 6,241 px ⇒ 6.9 個螢幕；展開的卡 536 px、收起的卡 90 px
   * 而 446 px 的差幾乎全是【這一份空表單】，採購真資料只佔約 1 行
   * ⇒ 螢幕上同時攤著 8 份一模一樣的空表單
   * ```
   * 🔴 而 Sean 的原話是「**看**得完整,但佔高度」——【看】不是【填】。
   *
   * ⚠️ **釘三件,而第三件是這一片最容易被下一個人弄丟的**:
   *   ① 有列時,表單在一個 `<details>` 裡
   *   ② 那個 `<details>` **預設是收起的**(沒有 `open`)
   *   ③ 🔴 **收起之後那顆入口仍然看得懂** —— 不是一個只有三角形的圖示
   *      (鐵則 9 / `project_admin-ux-operation-intuitiveness`:不用人教也能做對)
   */
  it('🔴 片17:有採購列時,新增採購表單收在一顆看得懂的鈕底下', () => {
    const d = detail();
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    // 正向錨:採購那張表真的渲染了。少了它,下面幾條在「整區沒出來」時會恆綠。
    expect(container.querySelector('tbody'), '採購表沒渲染 ⇒ 下面幾條會恆綠').not.toBeNull();
    const forms = [...container.querySelectorAll('details')].filter((el) =>
      el.querySelector('summary')?.textContent?.includes('供應商下訂'),
    );
    expect(forms.length, '新增採購表單沒有被收進 <details>').toBe(1);
    expect(forms[0]!.hasAttribute('open'), '收是收了,但它預設是打開的 ⇒ 高度沒省到').toBe(false);
    // ③ 入口要看得懂 —— 釘字面,不是釘「有一個 summary」
    expect(forms[0]!.querySelector('summary')!.textContent).toContain('再跟一家供應商下訂');
  });

  /**
   * 🔴 **正向對照(片17 補;本檔在此之前【沒有】這一格)。**
   *
   * 上面那格釘的是「恰 60 字 ⇒ **不**收合」,而它是一條否定式。
   * ⚠️ **只有它的話,把整個『長原因收合』的機制刪掉,那一格照樣綠** ——
   *    因為「沒有收合」正是它要的結果。**一個否定式證不了機制還活著。**
   * ⇒ 這一格餵 61 字(門檻 `VOID_REASON_INLINE_MAX = 60`,`item-procurement-rows.tsx:17`),
   *   要求它**真的收合**。兩格合起來才釘得住「邊界在 60、而且機制在」。
   * 📌 而它同時是我把上面那格的錨從 `container` 收窄到 `tbody` 之後的**判別力證明**:
   *    收窄之後那個選擇器仍然抓得到原因那個 `<details>`(這一格會證明)。
   */
  it('🔴 超過門檻一個字的原因【要】收合(正向對照:證明機制還在)', () => {
    const d = detail();
    const over = '缺'.repeat(61); // 61 字 = 門檻 + 1
    const one = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, voidReason: over })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={one} suppliers={[]} suppliersFailed={false} />,
    );
    expect(
      container.querySelector('tbody details'),
      '超過門檻仍然沒有收合 ⇒ 長原因收合這個機制不見了(而恰-60 那格不會發現)',
    ).not.toBeNull();
  });

  it('🔴 生效列**不得**冒出作廢原因那一列(否則整張表多出一堆空列)', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed={false} />,
    );
    expect(container.querySelector('tbody')!.textContent).not.toContain('作廢原因');
    // 生效列只該有一個 <tr>
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('🔴 原因為 null(投影沒帶回來)⇒ 誠實說缺,不留白', () => {
    const d = detail();
    // DB 的配對 CHECK 讓「已作廢必有原因」⇒ 這裡的 null 只可能是投影沒帶回來
    const noReason = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, voidReason: null })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={noReason} suppliers={[]} suppliersFailed={false} />,
    );
    expect(container.querySelector('tbody')!.textContent).toContain('作廢原因:(沒有帶回來)');
  });

  it('🔴 過長的原因收進可展開的區塊,而且**完整內容仍在 DOM 裡**(不是切掉尾巴)', () => {
    const long = '缺料'.repeat(60); // 120 字,遠超過內嵌門檻
    const d = detail();
    const longReason = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, voidReason: long })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={longReason} suppliers={[]} suppliersFailed={false} />,
    );
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details!.querySelector('summary')!.textContent).toContain('點開看完整');
    // 🔴 這一條是重點:展開後看得到**全文**。只驗 summary 的話,
    //    「切掉尾巴 + 假裝有 details」照樣綠 —— 那正是主視窗要求「不要只 ellipsis」的原因。
    expect(details!.textContent).toContain(long);
  });

  it('作廢與停用可以同時成立 ⇒ 兩個標記都要在,且**作廢排在前面**(順序是刻意的)', () => {
    const d = detail();
    const both = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, supplierIsActive: false })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={both} suppliers={[]} suppliersFailed={false} />,
    );
    const cell = container.querySelector('tbody tr td')!.textContent ?? '';
    expect(cell).toContain('(已作廢)');
    expect(cell).toContain('(已停用)');
    // 🔴 順序也要驗:元件註解明寫「作廢標示排在停用標示之前」是刻意的
    //    (「這筆撤了」比「這家停用了」更決定員工的下一步)。只驗兩者皆在的話,
    //    把兩塊 JSX 交換 0 紅 —— 那正是我自己寫進 §②-a 的「名稱/註解大於斷言」。
    expect(cell.indexOf('(已作廢)')).toBeLessThan(cell.indexOf('(已停用)'));
  });

  // 🔴🔴 **兩關審查各自獨立抓到的同一條**:第一版條件只寫 `if (p.voidedAt != null) continue;`,
  //    在 `suppliersFailed` 路徑上會關掉 `Q-S1=A` 的合法路 —— 那時 `suppliers=[]`,
  //    第二個迴圈是選單的**唯一**來源,一家**仍啟用**但只剩作廢列的供應商會整個消失。
  //    ⇒ 條件補上 `&& p.supplierIsActive === false`,並用下面這格釘住。
  it('🔴 供應商清單載入失敗 + 仍啟用 + 只剩作廢列 ⇒ 那家【必須】還在選單(Q-S1=A 要對它重下單)', () => {
    const d = detail();
    const onlyVoidedButActive = {
      ...d,
      items: [
        {
          ...d.items[0]!,
          procurements: [proc({ ...VOIDED, supplierIsActive: true })], // 仍啟用,只是這筆撤了
        },
      ],
    } as typeof d;
    const { container } = render(
      // 🔴 `suppliers=[]` + `suppliersFailed` = 真實的失敗路徑(`order-detail-route.tsx` 就這樣傳)
      <ItemProcurementSection returnTo={RETURN_TO} detail={onlyVoidedButActive} suppliers={[]} suppliersFailed />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(true);
  });

  it('🔴 supplierIsActive 為 null(內嵌沒回來 = 不知道)⇒ 保留,不因為作廢就移除', () => {
    const d = detail();
    const unknown = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, supplierIsActive: null })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={unknown} suppliers={[]} suppliersFailed />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(true);
  });

  it('🔴 只剩作廢列的**已停用**供應商不進選單(選了也只有空表單 + 被片2 擋)', () => {
    const d = detail();
    const onlyVoided = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, supplierIsActive: false })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={onlyVoided} suppliers={[]} suppliersFailed={false} />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(false);
  });

  it('同一家**有生效列**時仍留在選單(上一格不得把合法的那條路一起關掉)', () => {
    const d = detail();
    const stillActive = {
      ...d,
      items: [
        {
          ...d.items[0]!,
          procurements: [VOIDED, proc({ supplierId: SUP_B, supplierLabel: 'Webike JP', supplierIsActive: false })],
        },
      ],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={stillActive} suppliers={[]} suppliersFailed={false} />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(true);
  });
});

describe('ItemProcurementSection — #352-b-2 衍生指標「還有 N 件沒有登記來源」', () => {
  /** 覆寫第一個品項的摘要(fixture 走 as-cast,型別擋不住,故逐欄給滿)。 */
  function withSummary(summary: unknown) {
    const d = detail();
    return { ...d, items: [{ ...d.items[0]!, quantitySummary: summary }] } as never;
  }

  it('還有件數沒著落 → 講出確切件數,並指去下面補來源', () => {
    const { getByRole } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={withSummary({
          quantity: 5,
          orderedQuantity: 2,
          instockQuantity: 0,
          cancelledQuantity: 1,
          cancellableQuantity: 5,
        })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    // 5 − 1 − 2 = 2
    expect(getByRole('status').textContent).toContain('2');
    expect(getByRole('status').textContent).toContain('沒有登記來源');
  });

  it('全部都有來源 → 不出現任何提示(不製造雜訊)', () => {
    const { queryByRole, queryByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={withSummary({
          quantity: 3,
          orderedQuantity: 3,
          instockQuantity: 0,
          cancelledQuantity: 0,
          cancellableQuantity: 3,
        })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(queryByRole('status')).toBeNull();
    expect(queryByText(/沒有登記來源/)).toBeNull();
  });

  // 🔴 `null` = 不知道 ⇒ 說「算不出來」,**不得**說「還有 0 件」或「還有 N 件」——
  //    那是它證明不了的話(摘要列由 A4a 惰性建立,沒列只代表沒被碰過)。
  it('🔴 摘要讀不到 → 誠實說算不出來,不假裝知道', () => {
    const { getByText, queryByRole } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={withSummary(null)}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getByText(/數量資料還沒就緒/)).toBeTruthy();
    // 🔴 不變式是「**不得宣稱一個件數**」,不是「不得出現『沒有登記來源』這幾個字」——
    //    誠實的 fallback 本來就寫著「算不出『還有幾件沒有登記來源』」,那句合法。
    //    (第一版我把斷言寫成後者,當場被自己這格打回:**測的東西比要守的不變式更寬**。)
    //    ⇒ 改釘那顆 `role="status"` 的橘色提示不存在 —— 它才是「我知道是 N 件」的那個宣稱。
    expect(queryByRole('status')).toBeNull();
  });

  // 🔴 欄位整個不見(fixture as-cast 的世界)也不能白畫面 —— 降級成「算不出來」。
  it('🔴 摘要欄位缺席 → 降級,不炸整頁', () => {
    const d = detail();
    const noField = { ...d, items: [{ ...d.items[0]!, quantitySummary: undefined }] } as never;
    const { getByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={noField}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getByText(/數量資料還沒就緒/)).toBeTruthy();
  });
});
