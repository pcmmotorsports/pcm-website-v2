// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// #10 片1:揀貨單列印頁的守門。
//
// 🔴 每一格都對應一種**會靜默壞掉**的改法(不是「有渲染就好」的煙霧測試):
//   ①投影沒接上畫面 ②金額/收件資訊漏印上紙 ②b 表格被改成 div(跨頁表頭失效)
//   ③清單沒載完卻照印 ③b 反向(沒截斷時不該有警告)④非 UUID 打 DB ④b 查無卻印空白紙
//   ⑤族 = 「揀貨單不反映貨的真實狀態」(R1 must-fix 3+4,整單取消/部分取消/未到貨/已出貨/不知道)
//   ⑥三顆 `print:hidden` 被刪掉 ⑦登入閘 matcher 被改窄

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

const mocks = vi.hoisted(() => ({ findAdminOrderDetail: vi.fn() }));
vi.mock('../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail: mocks.findAdminOrderDetail }),
}));

import OrderPickingPrintPage from './page';
import { pickableQuantity } from '../../../../../components/print/picking-doc';

const ORDER = '11111111-1111-4111-8111-111111111111';
const SRC = join(__dirname, '..', '..', '..', '..', '..');

// 🔴🔴 **金額欄位一個都不留 0**(R1 must-fix 5)。第一版 `shippingFee`/`discountTotal` 都是 0,
//    而格②只擋 `12345`/`86415` ⇒ **有人在揀貨單加一列「運費」,那格照樣綠**,而真訂單的運費不是 0。
//    現在六個金額欄各給一個互不相撞、也不與數量/料號/單號/日期相撞的值,並且**整組**進 not.toContain。
const MONEY = {
  unitPrice: 12345,
  lineTotal: 86415,
  shippingFee: 611,
  discountTotal: 733,
  subtotal: 51987,
  total: 52598,
} as const;
const MONEY_VALUES = Object.values(MONEY);

// 數量刻意全用兩位數且彼此不同(nit-8:單字元斷言換 fixture 就可能靜默恆綠)。
const QTY = { bought: 53, instock: 41, shipped: 15 } as const;
const PICKABLE = QTY.instock - QTY.shipped; // 26
const PHONE = '0987654321';
const ADDRESS = '台北市信義區松高路 1 號';

type Over = Partial<AdminOrderDetail> & { summary?: unknown };

function detail(over: Over = {}): AdminOrderDetail {
  const { summary, ...rest } = over;
  // `as unknown as`:Money 是 branded type(慣例同 `app/orders/[id]/nine-code-retire.test.tsx`)。
  return {
    id: ORDER,
    displayId: 'PCM-2026-0042',
    createdAt: '2026-08-04T02:00:00+00:00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'bank_transfer',
    paymentMethod: null,
    paidAt: null,
    subtotal: { amount: MONEY.subtotal, currency: 'TWD' },
    shippingFee: { amount: MONEY.shippingFee, currency: 'TWD' },
    discountTotal: { amount: MONEY.discountTotal, currency: 'TWD' },
    total: { amount: MONEY.total, currency: 'TWD' },
    shippingMethod: 'home',
    shippingAddress: { name: '收件人小明', phone: PHONE, line: ADDRESS },
    customer: { name: '王小明', email: 'a@b.c', phone: PHONE },
    invoiceRequest: { type: null, taxId: null, title: null, carrier: null, donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    cancelledReason: null,
    version: 1,
    items: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        variantSku: 'LTC-BK-XL',
        title: '前叉防甩頭',
        spec: { 顏色: '黑', 尺寸: 'M' },
        quantity: QTY.bought,
        unitPrice: { amount: MONEY.unitPrice, currency: 'TWD' },
        lineTotal: { amount: MONEY.lineTotal, currency: 'TWD' },
        procurements: [],
        procurementTruncated: false,
        quantitySummary:
          summary === undefined
            ? {
                quantity: QTY.bought,
                orderedQuantity: QTY.bought,
                instockQuantity: QTY.instock,
                cancelledQuantity: 0,
                shippedQuantity: QTY.shipped,
                cancellableQuantity: 0,
              }
            : summary,
      },
    ],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
    ...rest,
  } as unknown as AdminOrderDetail;
}

async function renderPage(id = ORDER) {
  const ui = await OrderPickingPrintPage({ params: Promise.resolve({ id }) });
  return render(ui);
}
const textOf = (c: HTMLElement) => c.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue(detail());
});
afterEach(() => cleanup());

describe('#10 片1 揀貨單列印頁', () => {
  it('①把投影接上畫面:單號 / 料號 / 品名 / 規格都印得出來', async () => {
    const t = textOf((await renderPage()).container);
    expect(t).toContain('揀貨單');
    expect(t).toContain('PCM-2026-0042');
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('前叉防甩頭');
    expect(t).toContain('顏色: 黑');
  });

  it('②🔴 揀貨單上不得有**任何**金額欄位,也不得有收件電話 / 地址', async () => {
    const t = textOf((await renderPage()).container);
    // 六個金額欄整組掃,不是只掃我想得到的那兩個(must-fix 5 的修法)。
    for (const v of MONEY_VALUES) {
      expect(t).not.toContain(String(v));
      expect(t).not.toContain(v.toLocaleString('en-US'));
    }
    expect(t).not.toContain('NT$');
    expect(t).not.toContain(PHONE);
    expect(t).not.toContain(ADDRESS);
  });

  it('②b🔴 品項清單必須是真的 `<table>` + 真的 `<thead>`(跨頁表頭靠它)', async () => {
    // 🔴 守的是列印時第 2 頁還有沒有欄名,而那件事單測量不到(沒有分頁概念)。
    //    2026-08-15 真瀏覽器 + 真 A4 PDF 量過:30 項時第 2 頁上緣**有**四個欄名,
    //    把 `thead` 打成 `table-row-group` 之後**就沒有了**(負向對照,詳 `picking-doc.tsx` 該段)。
    //    ⇒ 那是瀏覽器對「真 table + 真 thead」的原生保證,**不是我們寫的 CSS**
    //    ⇒ 唯一會弄壞它而畫面看不出來的改法 = 把表格改成 div 排版。這格釘那條路。
    //    ⚠️ 誠實:本格**不能**證明第 2 頁真的有欄名,它證明的是那個保證的**前提還在**。
    const { container } = await renderPage();
    const thead = container.querySelector('table > thead');
    expect(thead).not.toBeNull();
    expect([...(thead?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim())).toEqual([
      '✓',
      '料號',
      '品名 / 規格',
      '應揀數量',
    ]);
    expect(container.querySelectorAll('table > tbody > tr').length).toBe(1);
  });

  it('③品項沒載完 ⇒ fail-closed 明說「不要拿這張去揀貨」', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
    const { container } = await renderPage();
    expect(textOf(container)).toContain('不要拿這張去揀貨');
  });

  // 🔴 **2026-08-17:舊文案逐字「請重新整理後再列印」是一句假話** —— 觸發它的是固定上限
  //    (`ORDER_ITEMS_EMBED_LIMIT = 200`,`packages/adapters/src/supabase/mappers/order.ts:406`)
  //    ⇒ 重整一百次拿回同一個數字。**這張紙比出貨明細單更該修:倉庫真正拿在手上的是它。**
  //    ⚠️ **禁的是【詞根】不是祈使形白名單** —— 白名單版在 `shipping-doc` 那片被穿透兩次
  //    (「請重新整理再列印一次」/「麻煩您重新整理一下再列印看看」都全綠)⇒ 中文祈使形舉不完。
  it('🔴 ③a 截斷文案不得叫他做會失敗的動作(禁詞根)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
    const t = textOf((await renderPage()).container);
    for (const bad of ['重新整理', '重試', '再試一次', '稍後']) {
      expect(t, `文案叫員工做一件永遠不會成功的事:${bad}`).not.toContain(bad);
    }
    // 正向對照:仍要給一條真的做得到的下一步,否則這格會退化成「把話刪掉就過」。
    expect(t).toContain('聯絡負責人');
  });

  // 🔴 **改之前這顆鈕在警告【上面】、不受影響** ⇒ 兩種「不該拿去揀貨」的狀態下
  //    員工都按得下去,印出一張紙照樣進倉庫。
  //    ⚠️ 三格成對:兩個反面 + 一個正面。少了正面那格,把整顆鈕刪掉也會綠。
  //    ⚠️ 釘「文字剛好是【列印】的 button」而不是 `querySelector('button')` ——
  //       後者會因為這頁日後加任何一顆鈕而誤紅(`shipping-doc` 那片 R1 nit8 的原話)。
  describe('🔴 不該揀的紙上不得留下一顆按得下去的列印鈕', () => {
    const printButtons = (c: HTMLElement) =>
      [...c.querySelectorAll('button')].filter((b) => b.textContent === '列印');

    it('訂單已取消 ⇒ 沒有列印鈕', async () => {
      mocks.findAdminOrderDetail.mockResolvedValue(
        detail({ cancelledAt: '2026-08-05T02:00:00+00:00' }),
      );
      expect(printButtons((await renderPage()).container)).toHaveLength(0);
    });

    it('品項沒載完 ⇒ 沒有列印鈕', async () => {
      mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
      expect(printButtons((await renderPage()).container)).toHaveLength(0);
    });

    it('🔴 正向對照:一切正常 ⇒ 列印鈕還在(證明上兩格不是「這顆鈕根本不存在」)', async () => {
      expect(printButtons((await renderPage()).container)).toHaveLength(1);
    });
  });

  it('③b 一切正常時不得出現任何警告(否則上面幾格恆綠)', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('④id 非 UUID ⇒ 不打 DB、直接 notFound', async () => {
    await expect(renderPage('not-a-uuid')).rejects.toThrow('notFound');
    expect(mocks.findAdminOrderDetail).not.toHaveBeenCalled();
  });

  it('④b 查無訂單 ⇒ notFound(不印出一張空白的紙)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('notFound');
  });
});

// 🔴🔴 R1 must-fix 3+4 是**同一個病的兩個面**:「揀貨單不反映貨的真實狀態」。
//    折的時候先列了這病的全部面(見 `picking-doc.tsx` 的 `pickableQuantity` docstring),
//    這個 describe 逐面釘住,不只釘被 reviewer 指名的那兩處。
describe('#10 片1 🔴 揀貨單必須反映貨的真實狀態', () => {
  it('⑤面1 整單已取消 ⇒ 出警告**而且不印品項表**(印出來就會有人照著去揀)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ cancelledAt: '2026-08-05T02:00:00+00:00' }),
    );
    const { container } = await renderPage();
    expect(textOf(container)).toContain('已取消');
    expect(textOf(container)).toContain('不要揀貨');
    // 🔴 這一條才是真的守門:表格不存在 ⇒ 沒有東西可以照著揀。
    expect(container.querySelector('table')).toBeNull();
    expect(textOf(container)).not.toContain('LTC-BK-XL');
  });

  it('⑤面2/3/4 放大的數字是「已到貨 − 已出貨」,**不是下單量**', async () => {
    const { container } = await renderPage();
    const qtyCell = [...container.querySelectorAll('table > tbody > tr > td')].at(-1);
    // 放大的那顆(揀貨的人眼睛真正會落上去的數字)必須是應揀量。
    expect(qtyCell?.querySelector('.text-xl')?.textContent?.trim()).toBe(String(PICKABLE));
    // 下單量仍在,但只能是小字的輔助資訊。
    expect(qtyCell?.textContent).toContain(String(QTY.bought));
    expect(qtyCell?.querySelector('.text-xl')?.textContent).not.toContain(String(QTY.bought));
  });

  it('⑤面5 `quantitySummary` 為 null ⇒ 明說不知道,**絕不補 0、也絕不印下單量**', async () => {
    // 契約:`packages/domain/src/order/types.ts:739-762`「null 的意思是『不知道』,不是『都是 0』」
    //       +「null 時一律 fail-closed …不得自行補 0」。揀貨單屬「守門/判斷」那一類,不是純顯示。
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ summary: null }));
    const { container } = await renderPage();
    const qtyCell = [...container.querySelectorAll('table > tbody > tr > td')].at(-1);
    expect(qtyCell?.textContent).toContain('數量資料尚未就緒');
    expect(qtyCell?.textContent).toContain('這一項不要揀');
    // 🔴 **這格不准出現任何數字。** R2 nit-3:第一版寫 `not.toContain('0')` + `not.toContain(下單量)`
    //    兩條,我還把它辯護成「寧可假紅」的取捨 —— 那是**假兩難**:`/\d/` 嚴格更強
    //    (順帶涵蓋下單量與任何其他數字),而**假紅面完全相同**(都只怕文案自己塞數字)。
    //    ⇒ 更好的寫法零成本時,不存在「取捨」。
    expect(qtyCell?.textContent).not.toMatch(/\d/);
  });

  it('⑤面3b 應揀量為 0(代購最常見:貨還沒到)⇒ 用字說「這次不用揀」,而且**不給打勾框**', async () => {
    // 🔴 R2 nit-4:只印一個放大的 `0` 配一顆打勾框,語意是模糊的 —— 要打勾嗎?這項算揀完了嗎?
    //    病根是**標準不對稱**:面5(不知道)給了文字,面「知道就是 0」反而只給數字。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ summary: { instockQuantity: 7, shippedQuantity: 7 } }),
    );
    const { container } = await renderPage();
    const cells = [...container.querySelectorAll('table > tbody > tr > td')];
    expect(cells.at(-1)?.textContent).toContain('這次不用揀');
    // 🔴 不給框 = 這一列不需要你做任何動作,一眼看得出來。第一格(✓ 欄)必須是空的。
    expect(cells[0]?.querySelector('span')).toBeNull();
  });

  it('⑤面3b 反向:應揀量 > 0 時**必須**有打勾框(否則上一格恆綠)', async () => {
    const cells = [...(await renderPage()).container.querySelectorAll('table > tbody > tr > td')];
    expect(cells[0]?.querySelector('span')).not.toBeNull();
  });

  it('⑤面7 品項空陣列 ⇒ fail-closed,不印一張只有表頭的空表格', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ items: [] }));
    const { container } = await renderPage();
    expect(textOf(container)).toContain('讀不到任何品項');
    expect(container.querySelector('table')).toBeNull();
  });

  it('⑤`pickableQuantity` 契約:null → null;shipped 全出 → 0;正常 → 差', () => {
    const mk = (instockQuantity: number, shippedQuantity: number) =>
      ({ quantitySummary: { instockQuantity, shippedQuantity } }) as never;
    expect(pickableQuantity({ quantitySummary: null } as never)).toBeNull();
    expect(pickableQuantity(mk(41, 15))).toBe(26);
    expect(pickableQuantity(mk(41, 41))).toBe(0);
    // 理論上 `shipped ⊆ instock` ⇒ 不會負;真的負也不印負數給倉庫看。
    expect(pickableQuantity(mk(3, 9))).toBe(0);
  });
});

// 🔴 R1 must-fix 6:三顆 `print:hidden` 原本**零守門** —— 刪掉之後三綠全綠、畫面完全看不出來,
//    紙上卻多一整條 144px 空白欄(`SIDEBAR_WIDTH='9rem'`)。
//    ⚠️ 這是**字面**守門:它擋不住「用值被別的規則蓋掉」(那只有真瀏覽器量得到,`D-004` §3 量過一次),
//       但它擋得住**刪除**,而刪除是這三處唯一沒人守的一條路。**量過 ≠ 有守門。**
// ── 本次應揀合計(Sean 2026-08-16 答「幾項」)────────────────────────────────
//
// 🔴 **它守的是「漏揀一整列」,而那件事在這張紙上原本【零症狀】** ——
//    揀貨的人一列一列往下勾,勾完最後一列就走;**沒有任何東西告訴他應該勾滿幾個**。
//    ⇒ 這一族釘的不是「有沒有印出一個數字」,是**那個數字與紙上的框對不對得起來**。
describe('#10 片1 本次應揀合計', () => {
  /** 一列。`instock`/`shipped` 直接給,`summary: null` 用 `unknown: true`。 */
  const row = (sku: string, instock: number, shipped: number, unknown = false) => ({
    id: `id-${sku}`,
    variantSku: sku,
    title: '測試品項',
    spec: null,
    quantity: 9,
    unitPrice: { amount: 100, currency: 'TWD' },
    lineTotal: { amount: 900, currency: 'TWD' },
    procurements: [],
    procurementTruncated: false,
    quantitySummary: unknown
      ? null
      : {
          quantity: 9,
          orderedQuantity: 9,
          instockQuantity: instock,
          cancelledQuantity: 0,
          shippedQuantity: shipped,
          cancellableQuantity: 0,
        },
  });

  // 3 列要揀 / 1 列這次不用揀(到貨=已出貨)/ 1 列不知道
  const MIXED = [
    row('AAA', 5, 0),
    row('BBB', 3, 1),
    row('CCC', 2, 0),
    row('DDD', 7, 7),
    row('EEE', 0, 0, true),
  ];

  it('🔴 合計 = 真的要動手的列數,**不是表格列數**', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: MIXED } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    // 🔴 **讀【那一顆節點】,不掃整份文字**(codex R1):
    //    解釋小字「勾選欄共 3 項」裡也有「3 項」⇒ 掃全文的話,主數字被刪掉或改錯照樣綠。
    const total = container.querySelector('[data-slot="picking-total"]');
    expect(total?.textContent?.trim()).toBe('3 項');
    expect(textOf(container)).toContain('本次應揀合計');
    // 🔴 表頭那行「品項:5 項」是**表格列數**,兩個數字必須不同 ——
    //    寫成同一個數就是叫人去勾一個他勾不滿的數。
    expect(textOf(container)).toContain('品項:5 項');
  });

  it('🔴🔴 合計必須等於紙上勾選框的實際數量(這一格才是真的守門)', async () => {
    // ⚠️ 前面那格只證「印出 3」;它證不了「紙上剛好有 3 個框」。
    //    框與合計是**兩個消費端**,而本片把它們接到同一支 `needsPicking` ——
    //    這一格是那個決定的負向面:任一邊漂走,兩個數就對不起來。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: MIXED } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    // 🔴 **指名勾選框本身,不是「第一格裡的任何 span」**(codex R1):
    //    第一格將來多一個提示 span、或框被改成隱藏,原本那個選擇器都照樣數得到。
    const boxes = container.querySelectorAll('[data-slot="picking-checkbox"]');
    const total = container.querySelector('[data-slot="picking-total"]');
    expect(boxes.length).toBe(3);
    // 🔴 兩邊都指名節點 ⇒ 任一邊漂走這格就紅。掃全文會被解釋小字接住。
    expect(total?.textContent?.trim()).toBe(`${boxes.length} 項`);
  });

  it('🔴 「數量資料尚未就緒」的列不算進合計,但**必須被單獨講出來**', async () => {
    // 契約同 `pickableQuantity`:`null` 是「不知道」不是「0」。
    // 🔴 不算進應揀數是對的(不知道就別叫人去揀);**但只算不說就變成「把不知道印成沒有」**——
    //    揀貨的人勾滿 3 項會認為這張單處理完了,而那一列可能還欠貨。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: MIXED } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    const t = textOf(container);
    expect(t).toContain('有 1 項的數量資料尚未就緒');
    expect(t).toContain('不算處理完');
    // 🔴 **位置本身是驗收條件的一部分,不只是文字在不在**:
    //    這句話在【頁首 Alert 區】,不在合計旁邊 —— 因為合計那塊不在 <table> 裡,
    //    跨頁時它可能留在頁尾而警告掉到下一頁 ⇒ 當頁把「不知道」讀成「沒有」。
    //    ⚠️ 搬回合計旁邊這格不會紅(文字還在)⇒ 所以這裡直接釘它在 role=alert 裡面。
    const alerts = [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent ?? '');
    expect(alerts.some((a) => a.includes('數量資料尚未就緒'))).toBe(true);
  });

  it('沒有「不知道」的列時,不印那句話(否則它變成永遠都在的雜訊)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: [row('AAA', 5, 0)] } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    expect(container.querySelector('[data-slot="picking-total"]')?.textContent?.trim()).toBe('1 項');
    // 🔴 三個特徵一起排除(codex R1:只排「另有」的話,那句話改寫成不含「另有」就靜默永久顯示)
    const t = textOf(container);
    expect(t).not.toContain('尚未就緒');
    expect(t).not.toContain('不算處理完');
    // 🔴 連那顆 Alert 都不該存在(只驗文字的話,空殼 Alert 會留下來當雜訊)
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  // 🔴🔴 **這一格是機制,不是規則** —— 我在同一片裡把 markdown 粗體寫進 JSX 文字**兩次**,
  //    兩次都是自己回頭看才發現的。星號會【照字面印在給倉庫的紙上】,而 typecheck/lint 都不會叫。
  //    ⇒ 與其寫一條「記得不要在 JSX 裡寫 **」的規則,不如讓它紅。
  //    ⚠️ 掃的是**渲染輸出**不是原始碼 ⇒ 註解裡的 `**` 不會誤傷(那正是本檔最多的東西)。
  it('🔴 紙上不得出現 markdown 星號(JSX 文字裡寫 ** 會照字面印出來)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: MIXED, itemsTruncated: true } as unknown as Partial<AdminOrderDetail>),
    );
    expect(textOf((await renderPage()).container)).not.toContain('**');
  });

  it('🔴🔴 清單沒載完 ⇒ 合計旁邊不得說「全部勾完才算揀完」(那句話會說謊)', async () => {
    // 🔴 codex 對抗審查 2026-08-16 抓的,而**我第一版真的印了它**。
    //    itemsTruncated = 有幾列根本沒被載進來 ⇒ 它們不在合計裡
    //    ⇒「全部勾完才算揀完」等於給了他一個**假的完成條件**。
    //    ⚠️ 這比沒有合計更糟:沒有合計他至少不會覺得自己完成了。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: MIXED, itemsTruncated: true } as unknown as Partial<AdminOrderDetail>),
    );
    const t = textOf((await renderPage()).container);
    expect(t).not.toContain('全部勾完才算揀完');
    expect(t).toContain('清單沒載完');
    expect(t).toContain('不要拿它當揀完的依據');
    // 🔴 codex R2:只驗那一句的話,紙上**其他**看起來精確的數字照樣把人騙回去。
    //    「品項:N 項」與「另有 N 項」在截斷時都只是【已載入子集】⇒ 兩處都要自己講清楚。
    expect(t).toContain('未載完,不是總數');
    expect(t).toContain('未載入的列裡可能還有');
  });

  it('🔴 整單已取消 ⇒ 連合計都不印(合計本身也是「可以照著做事」的資訊)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ cancelledAt: '2026-08-05T02:00:00+00:00' }),
    );
    const { container } = await renderPage();
    // 🔴 整塊都不該在,不是只有標籤消失(codex R1):數字節點與解釋小字都要一起不見。
    expect(textOf(container)).not.toContain('本次應揀合計');
    expect(textOf(container)).not.toContain('勾選欄共');
    expect(container.querySelector('[data-slot="picking-total"]')).toBeNull();
  });
});

describe('#10 片1 列印時必須藏起來的三顆', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['components/ui/sidebar.tsx', "'group peer text-sidebar-foreground hidden md:block print:hidden'"],
    ['components/layout/header.tsx', 'border-b px-4 print:hidden'],
    ['components/print/print-button.tsx', 'text-sm print:hidden'],
  ];
  for (const [rel, literal] of cases) {
    it(`${rel} 仍帶 print:hidden`, () => {
      expect(readFileSync(join(SRC, rel), 'utf8')).toContain(literal);
    });
  }

  it('sidebar 的 print:hidden 必須在 **root**、不是在 sidebar-container', () => {
    // 🔴 這格守的是 `D-002` §2 那個差點犯的錯:`Sidebar` 的 `className` prop 只會落在
    //    `sidebar-container`,而佔位寬度是它的**兄弟** `sidebar-gap` 撐出來的
    //    ⇒ 藏錯層 = 紙上留一整條空白欄,而畫面上完全看不出來。
    const src = readFileSync(join(SRC, 'components/ui/sidebar.tsx'), 'utf8');
    const rootLine = src
      .split('\n')
      .findIndex((l) => l.includes("'group peer text-sidebar-foreground hidden md:block print:hidden'"));
    const gapLine = src.split('\n').findIndex((l) => l.includes("data-slot='sidebar-gap'"));
    expect(rootLine).toBeGreaterThan(-1);
    expect(gapLine).toBeGreaterThan(-1);
    // root 必須在 gap **之前**(gap 是 root 的子節點)⇒ 證明 class 掛在包住 gap 的那一層。
    expect(rootLine).toBeLessThan(gapLine);
  });
});

// 🔴 R2 nit-5:`order-detail.tsx` 那顆入口鈕的 **`!cancelled` 條件與 href 全 repo 零守門**
//    ⇒ 路由資料夾改名 = **靜默 404**(員工按了得到「找不到頁面」),而三綠全綠、沒有任何測試會紅。
//    做法照同目錄既有樣板 `components/orders/order-detail-refund-entry.test.ts` 的 source-scan 形。
describe('#10 片1 入口鈕:href 必須真的指到一支存在的頁', () => {
  const detailSrc = readFileSync(join(SRC, 'components/orders/order-detail.tsx'), 'utf8');
  const HREF = '`/print/orders/${detail.id}/picking`';

  it('href 字面還在', () => {
    expect(detailSrc).toContain(HREF);
  });

  it('🔴 href 對應的 page 檔真的存在(資料夾被改名就紅,不再靜默 404)', () => {
    // href `/print/orders/<id>/picking` ⇒ 檔案 `app/print/orders/[id]/picking/page.tsx`。
    // 這一步是**把網址翻成檔案路徑**,而不是去 grep 一個字串 —— 改名的人動的是資料夾,不是字串。
    expect(existsSync(join(SRC, 'app/print/orders/[id]/picking/page.tsx'))).toBe(true);
  });

  it('🔴 已取消的訂單不給入口(`!cancelled` 條件還在)', () => {
    // ⚠️ 這只是 UX 那一層;真守門在 `picking-doc.tsx`(已取消 ⇒ 不印品項表),
    //    格⑤面1 釘那一層。兩層都要,少了下面那層這顆鈕等於零。
    expect(detailSrc).toContain('{!cancelled && (');
  });
});

describe('#10 片1 的前提:登入閘的**設定字面**涵蓋 /print', () => {
  // 🔴 這個 describe 不驗本片的 code,驗的是 plan §4「鐵則 12② 不命中」所依賴的那條 matcher。
  // ⚠️ **誠實(nit-9)**:這兩格只讀 `proxy.ts` 的**設定字面** —— `proxy()` 本體一次都沒被呼叫,
  //    「未登入真的會被 303 導去 /api/sso/start」這件事**本檔沒有驗過**。
  //    它們擋的是「有人把 matcher 改窄 / 把 /print 加進白名單」,不是行為回歸。
  const proxySrc = readFileSync(join(SRC, 'proxy.ts'), 'utf8');

  it('matcher 仍是「除靜態資源外全包」', () => {
    expect(proxySrc).toContain("matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']");
  });

  it('未登入白名單仍只有 SSO 那兩條(nit-7:只看那一行,不掃整支檔)', () => {
    // 🔴 第一版寫 `expect(proxySrc).not.toContain('/print')` ⇒ 掃**整支檔**,
    //    任何人寫一句提到 `/print` 的註解就假紅。縮到白名單那一行本身。
    const line = proxySrc.split('\n').find((l) => l.includes('SSO_OPEN_PATHS = new Set'));
    expect(line).toBe("const SSO_OPEN_PATHS = new Set(['/api/sso/start', '/api/sso/callback']);");
  });
});
