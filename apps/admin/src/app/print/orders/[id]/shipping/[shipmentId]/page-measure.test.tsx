// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
// ── ✅ **本檔【不再斷言任何文案字面】**(2026-08-18 補完)────────────────
//   **數法(可重跑,結果應為 0)**:
// ```
//   grep -cE "expect\([^)]*\)\.(not\.)?toContain\('[^']*[一-鿿]" <本檔>
// ```
//   🔴 **這件事分兩次做完,而【中間那一次是不完整的】,留痕如下**:
//     · `8e576886` 只改了 **4 格**(B 態那批,**因為它們讓 dev 紅過**),
//       而那顆的 commit body 把它寫成「拆掉同一句話有兩個所有權人」= **根因修法**
//       ⇒ **實際是 13 格修了 4 格。那句話的字面比事實大**(commit 改不動,更正落在這裡)。
//     · 其餘 **9 格**在本次補完。
//   🔴 **為什麼那 9 格當時沒被發現**:**它們全是綠的** ——
//     只有在**有人去改那 9 句文案**時才會紅 ⇒ **觸發條件是【下一個人做一件正常的事】**。
//     ⇒ **一個不完整的修法,與完整的修法,在測試輸出上長得一模一樣。**
//   📎 而它是**去做別的事撞到的**,不是回頭複核找到的 ——
//     **複核天生只會複核你做過的那部分。**
//
//   **現在改抓的錨點**(全部是 `data-slot` / `data-blocked-kind`,不是文案):
// ```
//   shipping-doc / picking-doc            兩張紙的身分
//   print-blocked                         有沒有落在整幅阻印版面
//   picking-cancelled / picking-no-items  是哪一種阻印（A 種 / C 種）
//   shipping-blocked                      出貨明細單那一幅
//   picking-truncated-notice / -band      B 態（頁首那幅 / 表身標記帶）
//   picking-qty-unknown                   「數量不知道」那一格
//   picking-checkbox / picking-total      勾選框 / 合計
// ```
//   🔴 **文案的所有權【只在】`page.test.tsx`** ——
//     判別法兩句都要成立:**改文案時本檔不該紅** ／ **文案錯時 `page.test.tsx` 一定要紅。**
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
/**
 * 🔴 **揀貨單也在這一支檔裡量,而那是刻意的**(2026-08-17 夜補):
 * 兩張紙共用**同一套鷹架** —— `builtCss()`、`OUT_DIR`、以及上面那個
 * `order-repository` 的 mock(揀貨單頁只用 `findAdminOrderDetail`,而它已經在那個 mock 裡)。
 * ⇒ **另開一支檔要把那一百多行抄一份**,而抄一份的下場是**兩份會漂**
 * (同一支 repo 裡的既有紀錄:`shipping-doc.tsx` 抬頭七值那段註解)。
 * ⚠️ **代價**:本檔的位置在 shipping 路由底下,而它現在量兩張紙 ⇒ **檔名比範圍窄**。
 *    找它的人請用 `find apps/admin/src/app/print -name 'page-measure.test.tsx'`(⇒ 1 支),
 *    **不要用萬用字元 glob** —— zsh 在無匹配時**回 0 而不是報錯**,那個 0 與「真的沒有」長得一樣。
 */
import OrderPickingPrintPage from '../../picking/page';

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
      `找不到建置產物目錄 ${dir} —— 這【不是】版面出問題,是還沒 build。` +
        '本機:跑 `TURBO_FORCE=1 pnpm build`(或只建這個 app:`pnpm --filter @pcm/admin build`)。' +
        'CI:`ci.yml` 已有 `Build admin` 那一步 ⇒ 若在 CI 看到這則,是那一步被拿掉或失序了,' +
        '不是你的測試壞了。🔴 **不要把 `pnpm build`(全 monorepo)加進 `ci.yml`** —— ' +
        '那個做法 2026-08-18 已被裁定否決(理由與代價見該檔那一步上方的註解)。',
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

/**
 * 🔴 `withQuantity` 存在的唯一理由:**`quantitySummary: null` 的揀貨單不是一張可以揀的紙。**
 * 預設的 `null` 會讓每一列都印「數量資料尚未就緒 / 這一項不要揀」、**一個勾選框都沒有**
 * (`picking-doc.tsx` 的面5)⇒ 那份 fixture 只能當「品項表印得出來」的正向對照。
 *
 * 而 `B` 態(`itemsTruncated`)要看的東西**恰好相反**:它的病是
 * **「這張紙看起來完整、可以照著揀」**,所以量它的 fixture **必須真的有勾選框與應揀數量**,
 * 否則量到的是一張本來就不能用的紙 —— 那會把「B 有多危險」整個量不到。
 * ⇒ `instock 3 − shipped 0 = 3` ⇒ 每一列都有框、都印放大的 `3`。
 */
function detail(itemCount: number, withQuantity = false): AdminOrderDetail {
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
    quantitySummary: withQuantity
      ? {
          quantity: 3,
          orderedQuantity: 3,
          instockQuantity: 3,
          cancelledQuantity: 0,
          shippedQuantity: 0,
        }
      : null,
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

/**
 * 揀貨單版的 `emit`。**只需要 `findAdminOrderDetail`** —— 揀貨單頁沒有箱的概念
 * (`picking/page.tsx:48` 只呼叫那一支),所以上面那個 `order-repository` mock 就夠了。
 *
 * ⚠️ **`vi.mock` 的路徑深度不同,而模組是同一個**:本檔寫的是 `../../../../../../lib/...`
 * (6 層)、揀貨單頁自己 import 的是 5 層 —— **兩者解析到同一個模組**,所以 mock 通吃。
 * 🔴 這一點值得寫下來:看起來像「兩個不同的模組」,而 vitest 是**照解析後的路徑**認身分。
 */
async function emitPicking(
  itemCount: number,
  name: string,
  over: Partial<AdminOrderDetail> = {},
  withQuantity = false,
): Promise<string> {
  const d = { ...detail(itemCount, withQuantity), ...over } as AdminOrderDetail;
  mocks.findAdminOrderDetail.mockResolvedValue(d);

  const { container } = render(await OrderPickingPrintPage({ params: Promise.resolve({ id: ORDER }) }));
  const { css, files } = builtCss();
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>${name}</title>
<!-- 樣式來源(建置產物,非原始碼): ${files.join(' + ')} -->
<style>${css}</style>
</head><body>${container.innerHTML}</body></html>`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.html`), html, 'utf8');
  return html;
}

/**
 * 🔴🔴 **每一輪先把整個輸出目錄清掉。這一行是機制,不是潔癖。**
 *
 * **2026-08-18 真的被騙到一次**:我改完 `picking-doc.tsx` 的合計文案、跑完本檔,
 * 然後拿 `/tmp/pcm-print-measure/picking-normal.html` 去做文字審查
 * ⇒ 讀到的是**舊字面**,而我一度把它當成「**我的修法沒有生效**」,
 * 差一點回報一個假 finding。
 * **刪掉那個檔、重跑一次 ⇒ 新字面就在裡面。修法從頭到尾都是好的。**
 *
 * 🔴 **病灶不是「忘記重跑」** —— 我**有**重跑;病灶是
 * **「這一輪沒有寫過的檔」與「這一輪寫出來的檔」在目錄裡長得一模一樣**
 * (同樣的檔名、看起來合理的 mtime、開起來是一份完整的 HTML)。
 * ⇒ 那是 `docs/patterns/guard-and-instrument-traps.md` 的母題:
 * **錯的那次和對的那次長得一樣。**
 * ⇒ **提醒擋不住它,只有「舊的不可能還在」擋得住。**
 *
 * ⚠️ **代價明說**:`OUT_DIR` 是固定路徑 ⇒ **兩個窗同時跑本檔會互相清掉對方的產物**。
 * 症狀是「我剛量的檔不見了」,**不是靜默的錯值** ⇒ 兩害相權取這一邊。
 */
rmSync(OUT_DIR, { recursive: true, force: true });

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
    expect(html).toContain('data-slot="shipping-doc"');
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

  it('🔴 揀貨單三種 ⇒ 產出 picking-*.html(`#601` 的 A / C 兩幅要真的印出來看)', async () => {
    // 🔴 **為什麼揀貨單也要**:`#601` 的 A(已取消)/ C(讀不到品項)兩種在 2026-08-17 落地,
    //    而**當時沒有任何辦法把它們印出來看** —— 單測只證得了「內容與結構都在同一塊裡」。
    //    ⇒ 本格補的就是那一格。用法:
    //      sh scripts/pagecount.sh --png /tmp/pcm-print-measure/picking-blocked-cancelled.html <dir>
    // ⚠️ **`picking-normal` 那一份【不是】一張真實的揀貨單**:本檔的 `detail()` 把
    //    `quantitySummary` 建成 `null` ⇒ 每一列都會印「數量資料尚未就緒 / 這一項不要揀」。
    //    ⇒ 它的用途**只有一個:當上面兩份的正向對照**(證明品項表本來印得出來)。
    //    **不要拿它去驗揀貨單的正常版面。**
    const normal = await emitPicking(3, 'picking-normal');
    const cancelled = await emitPicking(3, 'picking-blocked-cancelled', {
      cancelledAt: '2026-08-16T03:00:00+00:00',
    });
    const empty = await emitPicking(0, 'picking-blocked-empty');

    // 正向對照:正常那份【有】品項表與料號 —— 沒有這一格,下面兩個 `not.toContain` 在
    // 「emit 整個壞掉、回空字串」的世界裡也會過。
    expect(normal).toContain('<table');
    expect(normal).toContain('SKU-0000-LONG');
    expect(normal).not.toContain('print-blocked');

    // A 種:整幅阻印 + 表不在 + 料號不在。
    expect(cancelled).toContain('picking-cancelled');
    expect(cancelled).not.toContain('<table');
    expect(cancelled).not.toContain('SKU-0000-LONG');

    // C 種:同上,而原因不同(這一種的文案保留「請重新整理」是刻意的,見 `picking-doc.tsx`)。
    expect(empty).toContain('picking-no-items');
    expect(empty).not.toContain('<table');
  });

  it('🔴 揀貨單 `B` 態 ⇒ 產出 picking-truncated.html(表【在】紙上而少了幾列)', async () => {
    // 🔴🔴 **為什麼 `B` 要單獨一份,而不是沿用上面那三份**:
    //    A(已取消)/ C(讀不到品項)兩種的品項表**不在紙上** ⇒ 印出來明顯不能用。
    //    `B` 是唯一一種**表在紙上、而它少了幾列**的 ——
    //    揀的人一列一列勾完,紙上看起來就是揀完了,**少的那一件零症狀**,到客人收到貨才發現。
    //    ⇒ 要量的正是「這張紙看起來多完整」,所以這一份**必須有勾選框**(`withQuantity`)、
    //      而且**必須多品項**(12 項 = Sean 要看的「乘出來」的樣子),不能用 3 項糊弄。
    //
    // ⚠️ **本份 fixture 量得到的是【紙】,不是【旗標對不對】。**
    //    `itemsTruncated` 是上游給的旗標,`picking-doc` 只是忠實反映它;
    //    上游該 `true` 卻算成 `false` ⇒ 紙少列而 B 根本不觸發 ⇒ 這一份看不到那個世界。
    //    洞在旗標來源(`ORDER_ITEMS_EMBED_LIMIT`),不在這支檔。(`C-223` §3 的射程上限)
    const truncated = await emitPicking(12, 'picking-truncated', { itemsTruncated: true }, true);

    // ── 🔴🔴 **抓【狀態錨點】,不抓文案字面**(2026-08-18,一次真的 dev 紅換來的)──
    //    這裡原本是三個 `toContain('達到 200 筆上限')` 之類的**文案字面**。
    //    ⇒ **同一句話有兩個所有權人**(本檔一份、`page.test.tsx` 一份)
    //      ⇒ **必然會漂,而漂的那天只有一邊會紅。**
    //    實際發生:改文案那一顆同步了 `page.test.tsx`(`:617` 已是新字面),**漏了本檔** ⇒ dev 紅。
    //
    //    🔴 **而根因不是「漏改一支」,是本檔【違反自己宣告的分母】** ——
    //      檔頭逐字:「**不驗紙上的內容對不對**,只保證『這份 HTML 帶著真樣式』」。
    //      這幾格真正要守的是「**這份 fixture 真的處在 B 態**」= **正向對照**,不是文案檢查。
    //
    //    ⚠️ **這【不是】把守門放寬。判別法兩句都要成立**:
    //      **改文案時本檔不該紅** ／ **文案錯時 `page.test.tsx` 一定要紅。**
    //      (文案的所有權留在 `page.test.tsx`,那裡逐句釘、且有突變驗過。)
    expect(truncated).toContain('picking-truncated-notice');
    expect(truncated).toContain('picking-truncated-band');
    // 🔴 **這一份與 A / C 的差別就是這兩格**:表在、而且真的有框可以勾。
    //    沒有這兩格,一份「表被擋掉」的產出也會通過上面三格,而那是另一種紙。
    expect(truncated).toContain('<table');
    expect(truncated).toContain('picking-checkbox');
    expect(truncated).toContain('SKU-0011-LONG');

    // 🔴 **負向對照(同樣 12 項、只差旗標)**:上面那三個字面必須【消失】,
    //    而勾選框必須【還在】—— 兩個方向都要動,才證得了「那三句是旗標帶出來的」
    //    而不是「這個版面本來就長那樣」。
    const normal = await emitPicking(12, 'picking-12item', {}, true);
    expect(normal).not.toContain('picking-truncated-notice');
    expect(normal).not.toContain('picking-truncated-band');
    expect(normal).toContain('picking-checkbox');
    // 🔴 再一發:`withQuantity` 沒生效的世界裡,上面那個 `picking-checkbox` 會消失
    //    而其他格照樣全過 ⇒ 這一格釘的是「勾選框是我餵的數量帶出來的」。
    const noQty = await emitPicking(12, 'picking-12item-noqty');
    expect(noQty).not.toContain('picking-checkbox');
    expect(noQty).toContain('picking-qty-unknown');

    // 🔴🔴 **真尺寸那一份**:`B` 態的觸發條件是**剛好載到 200 筆**
    //    (`ORDER_ITEMS_EMBED_LIMIT = 200`,`packages/adapters/src/supabase/mappers/order.ts:407`,
    //     判定用 `>=`)⇒ **真的印出來是 200 列**,不是上面那 12 列。
    //    ⚠️ 上面那份 12 項的用途是**看得懂的縮尺樣本**;
    //       **任何「多幾頁 / 標記落在第幾頁」的數字都只能拿這一份量**,不能拿 12 項那份換算。
    //       (Sean 2026-08-17 業務事實:一張訂單品項**可能到 200 個** ⇒ 這不是未來風險,是上緣。)
    const real = await emitPicking(200, 'picking-truncated-200', { itemsTruncated: true }, true);
    expect(real).toContain('SKU-0199-LONG');
    expect(real).not.toContain('SKU-0200-LONG');
    // 🔴 同上:抓狀態錨點,不抓文案(文案的所有權在 `page.test.tsx`)。
    expect(real).toContain('picking-truncated-notice');
    expect(real).toContain('picking-truncated-band');
  });

  it('🔴 `#601` 阻印狀態 ⇒ 產出 shipping-blocked.html(那一幅要真的印出來看)', async () => {
    // 🔴 **為什麼這一份非產不可**:`#601` 守的是**份量**(「警告必須佔滿這個位置」),
    //    而**份量是單測量不到的東西** —— `page.test.tsx` 那格只證得了內容都在同一塊裡。
    //    ⇒ 這份 fixture 的用途是 `sh scripts/pagecount.sh --png <它> <dir>` 之後**開來看**。
    const blocked = await emit(1, 'shipping-blocked', true);
    expect(blocked).toContain('shipping-blocked');
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
