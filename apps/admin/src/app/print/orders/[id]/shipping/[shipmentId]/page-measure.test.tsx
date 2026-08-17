// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// ══════════════════════════════════════════════════════════════════════
// 出貨明細單的【列印量測管線】—— 產出可以拿去數頁數的 HTML。
// ══════════════════════════════════════════════════════════════════════
//
// 🔴 **它存在的理由,是一個我自己踩過的坑**:
//    2026-08-17 我為了給 Sean 看,用 OD 樣張的 CSS 做了一份**忠實重製**,
//    然後**拿那份重製去量頁數**,量了一整天。
//    ⇒ 而正式頁是**另一份文件**(品項表 3 欄 vs 樣張 7 欄;應揀 / 數量對帳 / QR /
//      簽收 / 買受人統編在正式頁 `grep -c` 全是 0)。
//    ⇒ **那份重製忠實到連 Sean 都認得** —— 而**像不代表是同一份**。
//    ⇒ 本檔量的是【要被改的那一份】:真的元件 + 真的 Tailwind 產物。
//
// 🔴 **本檔【不數頁數】。** 它只產出 HTML;數頁數是 `scripts/pagecount.sh` 的事。
//    分開的理由:數頁數要起 Chrome(慢、要環境),而產 HTML 不用
//    ⇒ 合在一起會讓 CI 每次都跑 Chrome。
//
// **怎麼用(兩步)**:
// ```
// TURBO_FORCE=1 pnpm build                 # 🔴 【每次動過樣式之後】都要先 build，見下方那一格
// npx vitest run apps/admin/src/app/print/orders/'[id]'/shipping/'[shipmentId]'/page-measure.test.tsx
// sh scripts/pagecount.sh /tmp/pcm-print-measure/shipping-1item.html
// sh scripts/pagecount.sh /tmp/pcm-print-measure/shipping-12item.html
// ```
//
// ── 🔴 本管線的分母【不含什麼】────────────────────────────────────────
//   · **不驗紙上的內容對不對**,只保證「這份 HTML 帶著真樣式」。
//   · **字型是系統堆疊**(`--font-sans: ui-sans-serif, system-ui, …, "PingFang TC", …`;
//     實查 `@font-face` 命中 0、`next/font` 命中 0,負向對照 `next/` 118 檔)
//     ⇒ 🔴 **本量測對【macOS + Chrome】成立** —— Sean 2026-08-17 就是用這個組合實印的
//        (依據 `C-216` §3-2)。**換 Windows / Linux 會落到別的字型 ⇒ 那台上的頁數未確認。**
//   · **量到的是【建置產物】不是原始碼** —— 兩者不逐字相同
//     (實證:`margin:12mm 12mm 14mm 12mm` 在產物裡被壓成三值)。這是對的,但引用時要講清楚。

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listOrderItemsForPrint: vi.fn(),
  loadOrderShipments: vi.fn(),
}));
vi.mock('../../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    listOrderItemsForPrint: mocks.listOrderItemsForPrint,
  }),
}));
vi.mock('../../../../../../lib/shipping/order-shipments', () => ({
  loadOrderShipments: mocks.loadOrderShipments,
}));

import OrderShippingPrintPage from './page';

const ORDER = '11111111-1111-4111-8111-111111111111';
const SHIPMENT = '33333333-3333-4333-8333-333333333333';
const OUT_DIR = '/tmp/pcm-print-measure';
/** `.next` 在 app 根;本檔在 app/print/orders/[id]/shipping/[shipmentId] ⇒ 上溯 7 層。 */
const NEXT_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '.next');

/**
 * 從建置產物撈 CSS。
 *
 * 🔴 **用【內容】找,不用檔名** —— chunk 檔名是 build hash(`21qvwslyrmzvp.css`),
 *    寫死的話**下一次 build 就指到不存在的檔**,而那時這裡會產出一份【沒有樣式的 HTML】,
 *    再被 `pagecount.sh` 數成一個**看起來很正常的頁數**。
 *    ⇒ 找不到就**大聲失敗**,不要靜靜產出沒樣式的東西。
 */
function builtCss(): { css: string; files: string[] } {
  const dir = join(NEXT_DIR, 'static', 'chunks');
  if (!existsSync(dir)) {
    throw new Error(
      `找不到建置產物目錄 ${dir} —— 請先跑 \`TURBO_FORCE=1 pnpm build\`。` +
        '這【不是】版面出問題,是還沒 build。',
    );
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
  const parts: string[] = [];
  const used: string[] = [];
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf8');
    // 兩支都要:@page 那支 = print-a4.css;--font-sans 那支 = Tailwind 產物。
    if (body.includes('@page') || body.includes('--font-sans')) {
      parts.push(body);
      used.push(f);
    }
  }
  return { css: parts.join('\n'), files: used };
}

function detail(itemCount: number): AdminOrderDetail {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`,
    variantSku: `SKU-${String(i).padStart(4, '0')}-LONG`,
    title: `示範品項 ${i + 1} —— 名稱長度接近真實料件`,
    spec: { 顏色: '黑', 規格: '通用' },
    quantity: 3,
    unitPrice: { amount: 74183, currency: 'TWD' },
    lineTotal: { amount: 222549, currency: 'TWD' },
    procurements: [],
    procurementTruncated: false,
    quantitySummary: null,
  }));
  return {
    id: ORDER,
    displayId: 'PCM-2026-0042',
    createdAt: '2026-08-04T02:00:00+00:00',
    cancelledAt: null,
    customer: { name: '王小明', email: null, phone: null },
    items,
    itemsTruncated: false,
  } as unknown as AdminOrderDetail;
}

const SHIPMENT_ROW = {
  id: SHIPMENT,
  shipmentReference: 'K7X2MP',
  customerUserId: 'cu-1',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: '6412345678',
  shippedAt: null,
  voidedAt: null,
  voidReason: null,
  recipientSnapshot: {
    name: '王小明',
    phone: '0912345678',
    line: '台北市信義區松高路 1 號 5 樓之 2',
  },
};

async function emit(itemCount: number, name: string, blocked = false): Promise<string> {
  const d = detail(itemCount);
  if (blocked) {
    // 🔴 `#601` 整幅阻印版面的量測產物。**用面4(整張訂單已取消)當代表**:
    //    八種阻印狀態共用同一個槽位(樣張逐字「原因文字換掉即可,版面不變」)
    //    ⇒ 量一種就量得到那個版面;**而八種文案本身由 `page.test.tsx` 逐面釘,不在這裡重複。**
    //    ⚠️ 這份 fixture 量得到的是**版面**,不是**哪一種原因會觸發** —— 兩件事分開。
    (d as { cancelledAt: string | null }).cancelledAt = '2026-08-16T03:00:00+00:00';
  }
  mocks.findAdminOrderDetail.mockResolvedValue(d);
  mocks.listOrderItemsForPrint.mockResolvedValue({ items: d.items, reportedTotal: d.items.length });
  mocks.loadOrderShipments.mockResolvedValue([
    {
      shipment: SHIPMENT_ROW,
      lines: d.items.map((it) => ({ orderItemId: it.id, title: it.title, quantity: 1 })),
    },
  ]);

  const { container } = render(
    await OrderShippingPrintPage({ params: Promise.resolve({ id: ORDER, shipmentId: SHIPMENT }) }),
  );
  const { css, files } = builtCss();
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>${name}</title>
<!-- 樣式來源(建置產物,非原始碼): ${files.join(' + ')} -->
<style>${css}</style>
</head><body>${container.innerHTML}</body></html>`;

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.html`);
  writeFileSync(path, html, 'utf8');
  return html;
}

describe('列印量測管線 —— 產出帶真樣式的正式頁 HTML', () => {
  // 🔴 **正向對照必須在同一次執行裡**:沒有它,`.next` 不存在 / 元件沒 render 出東西 /
  //    CSS 撈到空字串,下面每一格都會「漂亮地通過」而產出一份沒用的檔。
  it('建置產物撈得到【兩支】CSS,而且 Tailwind 那支不是空的', () => {
    const { css, files } = builtCss();
    expect(files.length).toBeGreaterThanOrEqual(2);
    // Tailwind 產物 ~69KB;print-a4 ~301 bytes。合起來遠大於 10KB。
    // ⚠️ 這個門檻擋的是「撈到空字串 / 只撈到 print-a4」,不是「樣式對不對」。
    expect(css.length).toBeGreaterThan(10_000);
    expect(css).toContain('--font-sans');
    expect(css).toContain('@page');
  });

  it('單品項 ⇒ 產出 shipping-1item.html', async () => {
    const html = await emit(1, 'shipping-1item');
    // 掛勾對不上 = CSS 寫了等於沒寫(`print-a4.css` 唯一的掛勾)。
    expect(html).toContain('print-sheet');
    expect(html).toContain('出貨明細單');
    // 🔴 負向對照:確認這一份【真的只有一個品項】,不是 fixture 沒生效。
    expect(html.match(/SKU-\d{4}-LONG/g)?.length).toBeGreaterThan(0);
    expect(html).not.toContain('SKU-0001-LONG');
  });

  it('多品項(12)⇒ 產出 shipping-12item.html,而且比單品項長', async () => {
    const one = await emit(1, 'shipping-1item');
    const many = await emit(12, 'shipping-12item');
    // 🔴 這一格釘的是「itemCount 真的有作用」——
    //    沒有它,兩份產出可能一模一樣,而後面數頁數會得到兩個【一樣正常】的數字。
    expect(many.length).toBeGreaterThan(one.length);
    expect(many).toContain('SKU-0011-LONG');
  });

  it('🔴 `#601` 阻印狀態 ⇒ 產出 shipping-blocked.html(那一幅要真的印出來看)', async () => {
    // 🔴 **為什麼這一份非產不可**:`#601` 守的是**份量**(「警告必須佔滿這個位置」),
    //    而**份量是單測量不到的東西** —— `page.test.tsx` 那格只證得了內容都在同一塊裡。
    //    ⇒ 這份 fixture 的用途是 `sh scripts/pagecount.sh --png <它> <dir>` 之後**開來看**。
    const blocked = await emit(1, 'shipping-blocked', true);
    expect(blocked).toContain('本單不得出貨');
    expect(blocked).toContain('本頁不含品項明細');
    // 🔴 負向對照兩發,證明這份**真的是阻印態**而不是我多產了一份正常頁:
    //    ① 品項表整個不在 ② 料號一個都不在
    expect(blocked).not.toContain('<table');
    expect(blocked).not.toContain('SKU-0000-LONG');
    // 🔴 正向對照:同一支 `emit` 不帶 blocked 時,上面那兩個「不在」必須【在】——
    //    沒有這一格,`not.toContain` 在「emit 整個壞掉、回空字串」的世界裡也會過。
    const normal = await emit(1, 'shipping-1item');
    expect(normal).toContain('<table');
    expect(normal).toContain('SKU-0000-LONG');
  });
});
