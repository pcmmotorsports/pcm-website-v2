// shipment-candidates.test.ts — 建箱彈窗資料源的守門。
//
// 🔴 **主守的是鐵則 12**:`AdminOrderDetail.items` 帶成交價(`unitPrice`/`lineTotal`),
//    而這支的產物是要交給 client 元件的 ⇒ **DTO 裡出現任何金額欄位就是外洩**。
//    守門兩面:①型別/實作層面不得出現金額欄名 ②實際回傳的物件逐鍵檢查、只有白名單那四個鍵。
//
// ⚠️ **它擋不住什麼**:mock 證不了真 DB 的數字對不對(無 DB);也證不了 RSC payload ——
//    `import 'server-only'` 讓誤用變成建置期錯誤,那是機制,不是本檔的斷言。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const findAdminOrderDetail = vi.fn();
const listAssigned = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail }),
}));
vi.mock('./shipment-repository', () => ({
  listAssignedQuantitiesByOrderItemIds: listAssigned,
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(resolve(HERE, 'shipment-candidates.ts'), 'utf8');
/** 剝註解:檔頭大量引用 `unitPrice` / `lineTotal` 當反例。 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  displayId: 'PCM-0001',
  shippingAddress: { name: '陳彥廷', phone: '0912', line: '台北市…' },
  customer: { name: '陳彥廷', email: 'a@b.c', phone: '0912' },
  items: [
    {
      id: 'oi-1',
      title: 'Akrapovic 鈦合金頭段',
      quantity: 3,
      unitPrice: { amount: 61500, currency: 'TWD' },
      lineTotal: { amount: 184500, currency: 'TWD' },
      quantitySummary: { quantity: 3, orderedQuantity: 3, instockQuantity: 0, cancelledQuantity: 1, cancellableQuantity: 2 },
    },
  ],
  ...over,
});

beforeEach(() => {
  findAdminOrderDetail.mockReset();
  listAssigned.mockReset();
  listAssigned.mockResolvedValue(new Map());
});

describe('🔴🔴 鐵則 12 — DTO 不得帶任何金額', () => {
  it('實作層不得出現 unitPrice / lineTotal / total / subtotal 等金額欄名', () => {
    const forbidden = ['unitPrice', 'lineTotal', 'subtotal', 'discountTotal', 'shippingFee', 'tierAtCheckout'];
    const bad = forbidden.filter((t) => SRC.includes(t));
    expect(
      bad,
      `shipment-candidates.ts 出現了金額欄名:${bad.join(', ')}。本檔的產物要交給 client 元件,` +
        '任何金額進 DTO = 成交價脈絡外洩進 RSC payload。',
    ).toEqual([]);
  });

  it('🔴 實際回傳的品項物件只有白名單四個鍵(逐鍵檢查,不是只看型別)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(r.items.length).toBe(1);
    expect(
      Object.keys(r.items[0]!).sort(),
      '品項 DTO 的鍵不是白名單那四個 ⇒ 有人把 detail 的欄位整包展開進來了',
    ).toEqual(['orderDisplayId', 'orderItemId', 'remaining', 'title']);
  });

  it('前提 — 本檔必須有 `import \'server-only\'`(誤用變建置期錯誤,不是上線才發現)', () => {
    expect(
      RAW.slice(0, 200),
      "檔首少了 import 'server-only' ⇒ 有人從 client 檔 import 它時不會有任何警告," +
        '而它會把訂單明細(含成交價與 PII)拉進 client bundle。',
    ).toMatch(/import 'server-only'/);
  });
});

describe('還能出幾件 = 訂購 − 已取消 − 已配箱', () => {
  it('三個減項都算進去', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    listAssigned.mockResolvedValue(new Map([['oi-1', 1]])); // 已配箱 1
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    // 訂購 3 − 已取消 1 − 已配箱 1 = 1
    expect(r.items[0]!.remaining, '減項算錯 ⇒ 員工會看到一個實際上出不了的數量').toBe(1);
  });

  it('🔴 已配箱沒被扣 → 同一件會被裝進第二個箱(這條擋的就是漏扣)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    listAssigned.mockResolvedValue(new Map([['oi-1', 2]]));
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(r.items.length, 'remaining 應為 0 ⇒ 整列不該出現;出現了代表已配箱沒扣').toBe(0);
  });

  // 🔴 第一版這條測的是「`Math.max(0,…)` 把負數收斂成 0」,而突變 M3 證明那是**死碼**:
  //    負數之後一定被 `filter(remaining > 0)` 濾掉,拿掉 Math.max 測試照樣全綠。
  //    ⇒ 已把 Math.max 移除,本條改成釘**真正在做事的那道 filter**:
  //    不論算出 0 還是負數,都不得出現在輸出裡。
  it('🔴 算出 0 或負數的品項一律不出現在輸出(負數可能來自衍生快取短暫不一致)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    listAssigned.mockResolvedValue(new Map([['oi-1', 99]])); // 3 − 1 − 99 = −97
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect(
      (await loadShipmentCandidates(['o1'])).items,
      '吐出了負數量的列 ⇒ 畫面會出現 -97 這種數量框',
    ).toEqual([]);

    listAssigned.mockResolvedValue(new Map([['oi-1', 2]])); // 3 − 1 − 2 = 0
    expect(
      (await loadShipmentCandidates(['o1'])).items,
      '吐出了 remaining=0 的列 ⇒ 員工看到一個永遠選不了的品項',
    ).toEqual([]);
  });

  it('quantitySummary 為 null 時當作零取消(不是整列消失)', async () => {
    findAdminOrderDetail.mockResolvedValue(
      detail({ items: [{ ...detail().items[0]!, quantitySummary: null }] }),
    );
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(r.items[0]!.remaining).toBe(3);
  });
});

describe('多張訂單 · 邊界', () => {
  it('跨單的品項會被攤平成同一份清單,各自標示來源單號', async () => {
    findAdminOrderDetail
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ id: 'o2', displayId: 'PCM-0002' }));
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1', 'o2']);
    expect(r.items.map((i) => i.orderDisplayId)).toEqual(['PCM-0001', 'PCM-0002']);
  });

  it('收件資料形狀恰好是 name/phone/line 三欄(RPC 多一個少一個都退件)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(Object.keys(r.recipient ?? {}).sort()).toEqual(['line', 'name', 'phone']);
  });

  it('空輸入 / 查無訂單 → 空清單,不打後續查詢', async () => {
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect(await loadShipmentCandidates([])).toEqual({ items: [], recipient: null });
    expect(findAdminOrderDetail).not.toHaveBeenCalled();

    findAdminOrderDetail.mockResolvedValue(null);
    expect(await loadShipmentCandidates(['nope'])).toEqual({ items: [], recipient: null });
    expect(listAssigned, '查無訂單時仍去查已配箱數量 ⇒ 多打一次沒有意義的 DB').not.toHaveBeenCalled();
  });
});
