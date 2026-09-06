import { beforeEach, describe, expect, it, vi } from 'vitest';

// 這條 route 的**擋下來那幾條路**。⟦ship-HCTLABELCAPTURE⟧ 片 D2。
//
// 🔴🔴 **它為什麼存在**(2026-09-06 code-reviewer must-fix-4):同層另外兩支測試
//    **一次都沒有呼叫 `GET`** —— `label-pdf-auth.test.ts` 檔頭自己逐字寫著
//    「那條 route 一次都沒有被呼叫」⇒ 📌 **這片最重要的幾個安全決定, 零可跑的檢查。**
//
// ✅ **而它們【不需要 chromium】就測得到**:每一條 409/400 都在 `htmlToPdf` **之前** return
//    ⇒ 本檔每一格都順手斷言 `htmlToPdf` **沒有被呼叫過** —— 那句話同時證明兩件事:
//      ①這條路真的被擋下來了 ②擋的位置在產檔之前(而不是產完再丟掉)。
//
// 🛑 **本檔證不到的**:「有權限而一切正常時, 真的吐得出一份 PDF」——
//    `@sparticuz/chromium` 是 Linux binary, 本機 macOS `spawn ENOEXEC` ⇒ 那一半要線上有人打一次。

const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listOrderItemsForDetail: vi.fn(),
  loadOrderShipments: vi.fn(),
  getHctLabelRawByShipmentId: vi.fn(),
  htmlToPdf: vi.fn(),
}));

vi.mock('@pcm/pdf', () => ({ htmlToPdf: mocks.htmlToPdf }));
vi.mock('../../../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    listOrderItemsForDetail: mocks.listOrderItemsForDetail,
  }),
}));
vi.mock('../../../../../../../lib/shipping/order-shipments', () => ({
  loadOrderShipments: mocks.loadOrderShipments,
}));
vi.mock('../../../../../../../lib/shipping/shipment-repository', () => ({
  getHctLabelRawByShipmentId: mocks.getHctLabelRawByShipmentId,
}));

import { GET } from './route';

const ORDER = '6f1c2a80-0000-4000-8000-000000000001';
const BOX = '6f1c2a80-0000-4000-8000-000000000002';
const ctx = { params: Promise.resolve({ id: ORDER, shipmentId: BOX }) };
const url = (qs = '') => new Request(`http://localhost:3001/print/orders/${ORDER}/shipping/${BOX}/label.pdf${qs}`);

/**
 * 一張**結構完整**的最小假 PNG 轉 hex(簽名 + 內容 + `IEND`)。
 * 🔴 **`IEND` 是必要的, 不是裝飾**:codex 2026-09-06 R1 must-fix ——
 *    「簽名 + 一堆垃圾」原本會被判成一張圖, 而真 Chromium 當它破圖 ⇒ 空白紙照樣 200。
 * 🔵 長度也是刻意的:64 bytes ⇒ base64 88 字元 ⇒ 跨得過下游 `too_short`(門檻 64 字元)。
 */
const PNG_HEX = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(44, 0x7f),
  Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
]).toString('hex');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue({ id: ORDER, displayId: 'PCM-1' });
  mocks.listOrderItemsForDetail.mockResolvedValue({ items: [], reportedTotal: 0 });
  mocks.loadOrderShipments.mockResolvedValue([
    { shipment: { id: BOX, shipmentReference: 'S-1' }, lines: [] },
  ]);
  mocks.getHctLabelRawByShipmentId.mockResolvedValue({
    hctStatus: 'submitted',
    voidedAt: null,
    raw: [{ image: PNG_HEX }],
  });
});

/** 每一格都要問這一句:它是**在產檔之前**被擋下來的嗎。 */
const expectNoPdf = () => expect(mocks.htmlToPdf).not.toHaveBeenCalled();

describe('label.pdf 擋下來的那幾條路(都在 htmlToPdf 之前)', () => {
  it('前置(正對照):一切正常時它【真的會】走到產檔那一步 —— 否則下面每一格都是恆真的', async () => {
    mocks.htmlToPdf.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const res = await GET(url(), ctx);
    expect(res.status, '正常路徑走不通 ⇒ 下面那些 409 可能是被別的原因擋掉的').toBe(200);
    expect(mocks.htmlToPdf).toHaveBeenCalledTimes(1);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    // 🔴 這張紙上有收件人資料 ⇒ 不得被任何共用快取收走。
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('作廢的箱 ⇒ 409, 不產檔(貼上去的箱子收不回來)', async () => {
    mocks.getHctLabelRawByShipmentId.mockResolvedValue({
      hctStatus: 'submitted',
      voidedAt: '2026-09-06T00:00:00Z',
      raw: [{ image: PNG_HEX }],
    });
    const res = await GET(url(), ctx);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('已作廢');
    expectNoPdf();
  });

  it('還沒送新竹 ⇒ 409, 而它要講人話(不是 500)', async () => {
    mocks.getHctLabelRawByShipmentId.mockResolvedValue({
      hctStatus: 'draft',
      voidedAt: null,
      raw: null,
    });
    const res = await GET(url(), ctx);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain('還沒有新竹的標籤');
    expect(body).toContain('draft');
    expectNoPdf();
  });

  it('那一包裡沒有看得懂的圖 ⇒ 409 + reason, 而 reason 不得夾帶 payload', async () => {
    mocks.getHctLabelRawByShipmentId.mockResolvedValue({
      hctStatus: 'submitted',
      voidedAt: null,
      // 一段【剛好通得過 base64 字元檢查】而解不出圖的字串。
      raw: [{ image: 'deadbeef'.repeat(16), name: '王小明', phone: '0912345678' }],
    });
    const res = await GET(url(), ctx);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain('not_an_image');
    // 🔴 PII 不得從那一包漏進回應 —— 那一包裡有收件人姓名與電話。
    expect(body).not.toContain('王小明');
    expect(body).not.toContain('0912345678');
    expectNoPdf();
  });

  it.each([
    ['?sheet=letter', 'sheet 只收'],
    ['?startAt=0', 'startAt 必須是'],
    ['?startAt=7', 'startAt 必須是'],
    ['?startAt=abc', 'startAt 必須是'],
  ])('壞掉的 query %s ⇒ 400 + 看得懂的話', async (qs, want) => {
    const res = await GET(url(qs), ctx);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(want);
    expectNoPdf();
  });

  it('回顯截斷:使用者送一長串, 回應裡不得原樣吐回去', async () => {
    const res = await GET(url(`?sheet=${'A'.repeat(200)}`), ctx);
    expect(res.status).toBe(400);
    expect((await res.text()).length).toBeLessThan(80);
    expectNoPdf();
  });

  it('這箱不屬於這張單 ⇒ 404(不信網址)', async () => {
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: { id: '6f1c2a80-0000-4000-8000-000000000009', shipmentReference: 'S-9' }, lines: [] },
    ]);
    const res = await GET(url(), ctx);
    expect(res.status).toBe(404);
    // 🔴 走到這裡就不該再去查那一箱 —— 那是「不信網址」那道的重點。
    expect(mocks.getHctLabelRawByShipmentId).not.toHaveBeenCalled();
    expectNoPdf();
  });

  it('讀不到包裹(null)⇒ 500, 不是 404 —— 值班要分得出「壞了」與「沒有」', async () => {
    mocks.loadOrderShipments.mockResolvedValue(null);
    const res = await GET(url(), ctx);
    expect(res.status).toBe(500);
    expectNoPdf();
  });
});
