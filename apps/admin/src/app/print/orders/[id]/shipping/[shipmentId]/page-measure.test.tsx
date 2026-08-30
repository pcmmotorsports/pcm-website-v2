// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';

import {
  assertAnchorsAlive,
  blankPages,
  moneyPagesWithoutItems,
  pagesMissingRunningChrome,
  type PageAnchors,
  type RunningChrome,
} from '@/lib/print/page-invariants';
import { render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';
// M2:build 戳記的讀取端(三態;見 `apps/admin/src/lib/build-stamp.ts` 檔頭)。
import { requireFreshBuild } from '@/lib/build-stamp';

// ══════════════════════════════════════════════════════════════════════
// 出貨明細單的【列印量測管線】—— 產出可以拿去數頁數的 HTML。
// ══════════════════════════════════════════════════════════════════════
//
// 🔴🔴 **本檔量到的每一個頁數,都是【在 margin = 0 的世界】。**
//    `page.pdf({format:'A4'})` 的 margin 預設是 0(見下方 `:636` 那段註解),
//    而 **margin = 0 正是列印對話框裡的「無邊界」**。
//    🔴 Sean 2026-08-30 逐字:後台這兩張紙他**必須手動切成無邊界**才會是一頁
//      (「…後台的訂單明細跟出貨單卻要設定成 無邊界才可以變成一頁」)。
//    ⇒ ⇒ 📌 **所以本檔的斷言答的是【他要手動切換才會看到】的世界,不是他預設看到的。**
//
// ⚠️ **而這不是說本檔的數字錯了** —— 2026-08-30 掃過 0/5/10.16/12/14/16/18/20/25mm 九種邊界、
//    再加頁首頁尾開關,三份 fixture **全部 1 頁、沒有懸崖** ⇒ 在我們的 fixture 上那個差複現不出來。
// 🔴 **⇒ 而這一格難的正是這裡:數字是對的、三綠會過、突變殺得掉、連跑兩發相同,**
//    **而它掛在一個【沒有寫出來的前提】上。**⇒ 補的是【世界的名字】,不是數字。
//    ⇒ 改本檔的人:要答「員工預設列印是幾頁」⇒ **本檔答不出來**,那要真的開列印對話框。
//
// 🔴 **它存在的理由,是一個我自己踩過的坑**:
//    2026-08-17 我為了給 Sean 看,用 OD 樣張的 CSS 做了一份**忠實重製**,
//    然後**拿那份重製去量頁數**,量了一整天。
//    ⇒ 而正式頁是**另一份文件**(品項表 3 欄 vs 樣張 7 欄;應揀 / 數量對帳 / QR /
//      簽收 / 買受人統編在正式頁 `grep -c` 全是 0)。
//    ⇒ **那份重製忠實到連 Sean 都認得** —— 而**像不代表是同一份**。
//    ⇒ 本檔量的是【要被改的那一份】:真的元件 + 真的 Tailwind 產物。
//
// ⛔ ~~**本檔【不數頁數】。** 它只產出 HTML;數頁數是 `scripts/pagecount.sh` 的事。
//    分開的理由:數頁數要起 Chrome(慢、要環境),而產 HTML 不用
//    ⇒ 合在一起會讓 CI 每次都跑 Chrome。~~
//    **2026-08-29 作廢 —— 而那句話當初是【對的】。**
//
// 🔴 **它為什麼過期(寫下來,因為它今天真的擋住了兩個窗)**:
//    ① CI **已經裝 chromium**(`.github/workflows/ci.yml:48` 逐字
//       `playwright install --with-deps chromium`),而**本檔本來就在 CI 跑** ——
//       🔴 依據是 `ci.yml:163` `run: pnpm test`(前置 `:123` Build admin)。
//       ⛔ ~~原本引 `:82-83`~~ **改掉(reviewer nit)**:那兩行只是一段**註解**在列
//          「依賴建置產物的測試」,**它不是本檔會在 CI 跑的依據**。
//       ⇒ 「要起 Chrome」這個代價**已經付掉了**。
//    ② 而 `scripts/pagecount.sh` 走的是 **CLI `--print-to-pdf`** ——
//       🔴 **實測:那條路配 playwright 的 chromium 會【掛住】**(5 分鐘逾時被砍,不是報錯);
//       而本檔用的是 **`page.pdf()` API**,同一顆 chromium-1223 ⇒ **通, 而且準**。
//       📌 **⇒ 擋路的不是那顆 binary, 是【怎麼叫它】。**
//    📌 **⇒ 而一句過期的理由, 長得跟還成立的一模一樣** —— 兩個窗都在它上面繞了一圈,
//       才有人去查 `ci.yml`。所以這裡不刪它,劃掉並寫下它為什麼過期。
//
// 🔴 **本檔現在的依賴(寫成【有觸發條件】的形狀, 不是一句會再過期的說明)**:
//    **本檔需要 playwright 的 chromium(`ci.yml:48` 裝的那顆)。拿掉它, 本檔會紅。**
//    ⇒ 本機沒裝的人也會紅。**修法是 `pnpm --filter @pcm/admin exec playwright install chromium`。**
//    🛑🛑 **而【不得】把它改成「找不到就 skip」** ——
//       那個誘惑會在**第一個同事本機紅掉來問你**的那一刻出現,而那時它看起來是【體貼】,
//       不是【關掉守門】。而一支「環境不齊就當作沒問題」的測試,**會在 CI 上永遠綠**。
//       ⇒ 這一段是寫給那一天的那個人看的。
//
// 🔴🔴 **而有一格【CI 從未實跑過】, 而它承重(reviewer nit,落地時必須知道)**:
//    下面那兩個期望值(1 項⇒1頁、12 項⇒2頁)**是在 macOS 上校準的**。
//    而 `--font-sans` 列的 CJK 字型是 `Noto Sans TC / PingFang TC / Microsoft JhengHei`
//    ⇒ **Linux runner 三個都可能沒有** ⇒ 長中文品名的換行位置變 ⇒ **頁數可能不是 2**。
//    ⚠️ 這是**推的、沒量**(而它與 `Q-FONT2` 那條線是同一件事:repo 內零字型檔)。
//    ⇒ 📌 **所以「CI 第一發」的結果是承重的** —— 它紅了**不代表版面壞了**,
//       可能是那個字型缺口。**而上面那道「不得 skip」的禁令, 不是叫你在那時關掉它**,
//       是叫你**去查是哪一種**(本機綠 + CI 紅 ⇒ 先看字型,不要先改版面)。
//
// ✅ 而 `scripts/pagecount.sh` **留著**:它是第二把尺(系統 Chrome + CLI),
//    而本檔那一發與它在真檔上四格對照過(1 項 1/1、12 項 2/2)。
//
// ── 🛑🛑 **這道守門【證不到什麼】(2026-08-29 補;寫成事實, 不是謙虛)**───────────
//   **它量的是 271mm 的 CSS 框內。而真印表機的可印區【比它小】。**
//   🔴 線A(`-e9`)2026-08-29 量到:**可印區改成 269mm 時, 連只用 68% 的那張也變成兩頁。**
//   ⇒ 而 Sean 看到的正是那個形狀:**第 2 張紙幾乎全白, 只有一行 14px 的「列印時間」。**
//   📌 **⇒ 所以本守門全綠【不代表】那張紙在他那台印表機上印得完。**
//      它擋的是「版面自己長高到跨頁」;它擋不掉「可印區比我們以為的小 1px」。
//   ⚠️ 而本檔量到的餘裕現在是 **6px**(2 項那張,99.4%)⇒ **那個 6px 在真紙上可能已經是負的。**
//   🔴 **要修那一半, 不是改這道守門 —— 是【留餘量】或【量真的印表機】。而兩件都不在本檔射程內。**
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
//   ~~picking-qty-unknown~~ ⇒ A3-3'(2026-08-29)已移除;「數量不知道」現在只在頁首 Alert
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
  listOrderItemsForDetail: vi.fn(),
  loadOrderShipments: vi.fn(),
}));
vi.mock('../../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    listOrderItemsForDetail: mocks.listOrderItemsForDetail,
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
  // 🔴🔴 **M2(2026-08-29):先問戳記,再看產物。**
  //    成因是量到的:`next build` **rc=1 而 `.next/static/chunks` 仍被寫出 28 個檔**
  //    ⇒ **「產物存在」在【成功】與【失敗但寫了一半】兩個世界印同一個綠**,
  //      而本函式底下那一整格版面量測,就是建在那個綠上面。
  //    ⇒ `requireFreshBuild()` 分三態:無戳記 / 戳記的 HEAD 與現在不同(兩個 hash 都印)/ 相同。
  //    ⚠️ 它不 skip,只 throw —— skip 會把「有守門」變成「有宣稱」。
  requireFreshBuild();
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
    // 🔴 片4:訂單層金額四欄。原本沒有,而 `as unknown as` 把缺欄藏住 ⇒ 元件讀 `.amount` 時 TypeError。
    //
    // 🔴🔴 **R3 nit:這幾個數字【必須由品項算出來】,不能是常數。**
    //    改前寫死 `subtotal: 51987`,而每一列的 `lineTotal` 是 222,549 × `itemCount` 列
    //    ⇒ 違反 `packages/domain/src/order/types.ts:131` 的不變式 `subtotal = Σ lineTotal`
    //    ⇒ **本檔產出來給 Sean 印的那張紙上,金額是【不可能存在的資料】。**
    //    ⚠️ 那比「數字不好看」嚴重:他拿那張紙做的任何金額判斷都建立在假資料上,
    //       而紙面本身完全正常 —— **沒有任何東西會提示他那組數字不成立。**
    subtotal: { amount: 222549 * itemCount, currency: 'TWD' },
    shippingFee: { amount: 611, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 222549 * itemCount + 611, currency: 'TWD' },
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
  mocks.listOrderItemsForDetail.mockResolvedValue({ items: d.items, reportedTotal: d.items.length });
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
 * 🔴 SHIPBRANCH1(2026-08-29 `-b9`):產出【尚未出貨:無】那一條分支的紙。
 *
 * 為什麼要另開一支:`emit()` 的 fixture `quantitySummary` 恆為 `null`,
 * 而 `lib/shipping/shipping-doc-quantities.ts:84` 逐字 `if (s === null) return null;`、
 * 過濾又收 `qty === null` ⇒ **`null` 一定會被列出來** ⇒ `emit()` **恆走「有未出貨表」那條**。
 * ⇒ 所以 `3ca0999d` 那道頁數守門, **結構上只守得到兩條分支裡的一條**。
 *
 * 🔴 而 Sean 那張(`PCM-2026-0104`)走的正是【另一條】—— 他的截圖上「尚未出貨:無」。
 *
 * 走另一條的填法(線A `-e9` 給、`-b9` 實測):每項 `quantity:1` 且已到貨 1、這箱出 1
 * ⇒ `max(0, 1 − 0 − 0 − 1)` = 0 ⇒ 沒有任何一列進 `outstandingRows` ⇒ 走一行字那條。
 */
async function emitNoOutstanding(itemCount: number, name: string): Promise<string> {
  const d = detail(itemCount, true);
  d.items.forEach((it) => {
    (it as { quantity: number }).quantity = 1;
    (it as { quantitySummary: Record<string, number> }).quantitySummary = {
      quantity: 1,
      orderedQuantity: 1,
      instockQuantity: 1,
      cancelledQuantity: 0,
      shippedQuantity: 0,
    };
  });
  mocks.findAdminOrderDetail.mockResolvedValue(d);
  mocks.listOrderItemsForDetail.mockResolvedValue({ items: d.items, reportedTotal: d.items.length });
  mocks.loadOrderShipments.mockResolvedValue([
    {
      shipment: { ...SHIPMENT_ROW, shippedAt: null },
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
  writeFileSync(join(OUT_DIR, `${name}.html`), html, 'utf8');
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

  // 🔴 SHIPBRANCH1(2026-08-29):量【尚未出貨:無】那一條分支 —— 它零守門, 而 Sean 印的是它。
  it("🔴 SHIPBRANCH1:探點 —— 「尚未出貨:無」那條分支的頁數門檻在哪", async () => {
    // ✅ 世界活錨:先證明我真的走到【另一條】分支, 否則下面整組量測都是量錯世界。
    //    🔴 兩行都要 —— 只有 not.toContain 的話, 一個空頁面也會過。
    const one = await emitNoOutstanding(1, 'shipB-1item');
    expect(one).toContain('以下空白');
    // 🛑 ~~原本要寫 `not.toContain('尚未出貨')`~~ ⇒ **那個錨是壞的, 而它一裝就紅。**
    //    成因:**兩條分支都印「尚未出貨」四個字** —— 差別在它後面那句:
    //      無  ⇒ ⛔ ~~「尚未出貨:無 —— 這張訂單沒有還欠客人的品項。」~~
    //           **2026-08-30 Sean 拿掉那句**(逐字「我不要這些奇怪標語」)
    //           ⇒ 現在那一格印的是一條分隔線中間夾「**以下空白**」
    //           ⇒ 🔴 **世界活錨跟著換成 `以下空白`**;舊字面留著,讓下面
    //              「為什麼不能用 `not.toContain('尚未出貨')`」那段推理仍然讀得懂。
    //      有  ⇒ ⛔ ~~「尚未出貨   這張訂單還欠客人的東西(不含這一箱要寄的)」~~
    //           **2026-08-30 Sean 答【甲 兩句都拿掉】** ⇒ 那句說明小字也走了。
    //           ✅ **新的「有表」活錨 = `還欠幾件`**(那一區的欄名,`shipping-doc.tsx:1000`)
    //              —— 它只在那一區出現(本次出貨那區的欄名是「本次出貨」)。
    //           🔴 **為什麼不能改用 `尚未出貨` 四個字**:那是**區塊標題**,
    //              而「無」那條現在連標題都沒有 ⇒ 它會過, 但它證的是別的事。
    //    ⇒ 真正分得開兩個世界的是【那句話】, 不是那四個字。
    expect(one).not.toContain('還欠幾件');
    // ✅ 負向對照:同一個斷言餵【有未出貨表】那條 ⇒ 必須是反過來的
    const other = await emit(1, 'shipping-1item');
    expect(other).not.toContain('以下空白');
    expect(other).toContain('還欠幾件');
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      await emitNoOutstanding(n, `shipB-${n}item`);
    }
    // 🔴🔴 **【有未出貨表】那一側的 2~6 項 —— 這一段 2026-08-30 傍晚才補**(線-出貨)。
    //    在它之前,這一側只造得出 **1 / 7 / 12** ⇒ **2~6 是一個洞**,
    //    而任何人想知道「幾項會爆頁」都會落在那個洞裡。
    //    📌 **而洞的位置正好蓋住一張真實訂單最常見的品項數。**
    //    ⚠️ 兩側的門檻**不一樣**(見 `docs/design/print-sheet-page-thresholds.md`
    //       的「2026-08-30 傍晚補量」那一節;⚠️ 該檔**沒有**一張叫「兩世界表」的表)
    //       ⇒ 造這一側是為了**不必從另一側外推**,而不是為了確認它們一樣。
    for (const n of [2, 3, 4, 5, 6]) {
      await emit(n, `shipping-${n}item`);
    }
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
    // 🔴 A3-3':~~expect(truncated).toContain('picking-checkbox')~~ ⇒ 勾選框已拿掉
    expect(truncated).not.toContain('picking-checkbox');
    expect(truncated).toContain('SKU-0011-LONG');

    // 🔴 **負向對照(同樣 12 項、只差旗標)**:上面那三個字面必須【消失】,
    //    而勾選框必須【還在】—— 兩個方向都要動,才證得了「那三句是旗標帶出來的」
    //    而不是「這個版面本來就長那樣」。
    const normal = await emitPicking(12, 'picking-12item', {}, true);
    expect(normal).not.toContain('picking-truncated-notice');
    expect(normal).not.toContain('picking-truncated-band');
    // 🔴 A3-3':~~expect(normal).toContain('picking-checkbox')~~ ⇒ 勾選框已拿掉
    expect(normal).not.toContain('picking-checkbox');
    // 🔴 再一發:`withQuantity` 沒生效的世界裡,上面那個 `picking-checkbox` 會消失
    //    而其他格照樣全過 ⇒ 這一格釘的是「勾選框是我餵的數量帶出來的」。
    const noQty = await emitPicking(12, 'picking-12item-noqty');
    // 🔴 A3-3'(2026-08-29):~~原本這裡守『withQuantity 沒生效時不該有框』~~
    //    ⇒ 勾選框整欄拿掉了 ⇒ 這個斷言【現在恆真】, 而恆真的守門比沒有守門糟。
    //    ✅ 換成守現在真正成立的:兩種世界【都】不得有框。
    expect(noQty).not.toContain('picking-checkbox');
    // 🔴 R1 MF8:上面三個 not.toContain 現在【全部不可證偽】(該字串已全 repo 零命中)
    //    ⇒ `withQuantity` 的判別力整個消失了 —— 而它原本守的是「數量資料有沒有帶進來」。
    //    ✅ 換一個【還活著】的錨:`picking-qty-unknown` 只在數量不知道時出現。
    //    量到(2026-08-29):picking-12item ⇒ 0 · picking-12item-noqty ⇒ 12 ⇒ 兩個世界分得開。
    // 🔴 A3-3' 第二輪:~~`picking-qty-unknown` 當活錨~~ ⇒ **我自己在同一片裡把它拆了**
    //    （codex R2 must-fix 1 的修法把那個 span 整個拿掉, 數量欄改印訂購量）。
    //    📌 **⇒ 我選了一個錨, 然後在同一片的後面把它移除 —— 而兩件事之間隔了六個修正。**
    //    ✅ 換成【現在真的還活著】的錨:頁首 Alert 的字面（當場量:noqty=1 · normal=0）。
    expect(noQty).toContain('數量資料尚未就緒');
    expect(normal).not.toContain('數量資料尚未就緒');

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

  /**
   * 🔴🔴 **出貨單必須一頁印完 —— 而在這一發之前, 那件事【沒有任何守門】。**
   *
   * **今天(2026-08-29)Sean 印出來發現跑版, 而 CI 全綠。** 成因不是有人改壞了一道尺,
   * 是**那件事從來沒有尺**:本檔既有的 4 個 `toBeGreaterThan` 守的是
   * CSS 檔數 / CSS 長度 / SKU 命中數 / HTML 長度 —— **沒有一個在守高度或頁數**。
   * ⇒ 而「頁數」的守門一直是 `scripts/pagecount.sh`,**一支要人手動跑的腳本**
   *   (全 repo 零測試呼叫它)⇒ 📌 **所以那道守門實際上是「一個人記得去跑它」。**
   *
   * ── 🔴 為什麼是 **兩個世界**, 而不是「1 項要 1 頁」一格 ────────────────
   *   只斷言「1 項 ⇒ 1 頁」的話,**一支永遠回 1 的實作會全過**。
   *   ⇒ 所以同一發要求 **12 項 ⇒ 2 頁** —— 兩個世界印**不同**的數字,那個 1 才有意義。
   *
   * ── 那兩個期望值從哪來(**不是我挑的**)────────────────────────────────
   *   · 線A(`-11`)的曲線 A:1 項⇒1頁 · 2 項⇒1頁 · **3 項⇒2頁** · 4..12 全 2 頁
   *   · `-c8` 的 `scripts/pagecount.sh` 獨立複現 1 項與 12 項 ⇒ **兩把獨立的尺一致**
   *   · 本窗再用 `page.pdf()` 對**這兩份真檔**複量 ⇒ 1/1 與 2/2 ⇒ **四格全對**
   *   🛑 **射程**:量的是**本檔 fixture 的資料**,不是任何一張真訂單。
   *      (Sean 那張真的 `PCM-2026-0104` 是 1 頁 —— 那是**他印的**,不是這道守門量的。)
   *
   * ── 🔴 餘裕那一格:**只印, 不設門檻** ─────────────────────────────────
   *   1 項那張今天用掉 **923px / 1024.25px = 90.1%**,只剩 101px。
   *   ⇒ **那個數字該多少沒有人知道** ⇒ 發明一個門檻等於發明一個判準 ⇒ 只印出來。
   *   📌 而印出來就夠:下一個人改版面時,會在測試輸出上看到它從 90% 變成 97%。
   *      **⇒ 那是「讓它有形狀」, 不是「讓它會紅」—— 而今天壞的正是【它沒有形狀】。**
   *
   *   🔴🔴 **而量餘裕要多一個動作, 否則它印的是一個【常數】**:
   *   `.print-sheet` 有 `min-height`(⛔ ~~`1024.25px`(= 可印區)~~ ⇒ **2026-08-29 起 944.882px = 250mm**;
 *   🔴 **而它【不再等於可印區】** —— 可印區仍是 271mm/1024px, 兩者從此是兩個數字)
 *   ⇒ **直接量 1 項那張會得到那個地板值**,
   *   而那是**地板**不是內容 ⇒ **在「還沒破頁」的整個範圍裡它永遠印 1024** ⇒ 零判別力。
   *   ⇒ 所以要**把 min-height 暫時設 0、量、再還原**(一次只改一個變因)。
   *   ✅ 而那條路量到 **923**,與線A 用**不同解除手法**得到的數字**逐字相同**
   *      ⇒ 那是兩把尺收斂,不是同一個錯複印兩份。
   *   ⚠️ 本窗第一次量到 1024 時差一點報成「用滿了」—— **抓到它的是那個「還原回 1024」的動作。**
   */
  it('🔴 出貨單的頁數:1 項 ⇒ 恰 1 頁、12 項 ⇒ 恰 2 頁(兩個世界要印不同的數)', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const measure = async (html: string) => {
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: 'load' });
          await page.emulateMedia({ media: 'print' });
          // 🔴 拿掉地板再量,量完還原 —— 理由見上方那一段。
          const used = await page.evaluate(() => {
            const sheet = document.querySelector('.print-sheet') as HTMLElement | null;
            if (sheet === null) return null;
            const floor = Number.parseFloat(getComputedStyle(sheet).minHeight);
            const before = sheet.style.minHeight;
            sheet.style.minHeight = '0px';
            const content = Math.round(sheet.getBoundingClientRect().height);
            sheet.style.minHeight = before;
            // 🔴 reviewer nit:還原【今天是成立的】(`before` 讀的是 inline style = `''`,
            //    而整段在同一個同步 `evaluate` 內、中間沒有可拋的呼叫)——
            //    **而它若哪天壞了, 不會紅**:min-height 留 0 ⇒ 1 項仍 1 頁、12 項仍 2 頁 ⇒ 兩格照過。
            //    ⇒ 所以把還原後的值也回出去,讓它有形狀。
            const after = Number.parseFloat(getComputedStyle(sheet).minHeight);
            return { content, floor: Math.round(floor), after: Math.round(after) };
          });
          // 🔴🔴 **`margin` 必須明寫 —— 而這是 reviewer must-fix**:
          //    `page.pdf({format:'A4'})` 的 margin 預設是 **0**
          //    ⇒ 它量的可印高是 **297mm(1123px)**,而版面設計的是 **271mm(1024px)**
          //      (`print-a4.css` 的 `@page margin:12mm 12mm 14mm 12mm`;
          //       而 `.print-sheet{min-height}` ⛔ ~~271mm~~ ⇒ **2026-08-29 起 250mm**
          //       ⇒ 🔴 **可印區與 min-height 從此【不是同一個數】**)
          //    ⇒ 📌 **多出約 98px 的假餘裕** ⇒ 一張在真紙上溢出 98px 的單子,這一發照樣印 1、照樣綠
          //      —— 而那正是今天 Sean 撞到的那一種。
          //    ✅ **而加上它【今天不改變答案】** —— 我三種幾何各量一發(2026-08-29):
          //       `margin 預設 0` / `加 12·14mm` / `preferCSSPageSize` ⇒ **1 項全是 1、12 項全是 2**
          //       ⇒ 所以這一改是**可證明的行為中性**,而它把那 98px 的盲區關掉。
          const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
          });
          // 🔴 reviewer nit:PDF 產出空的 / 格式變了(物件流壓縮)⇒ regex 數不到 ⇒ 也是
          //    `expected 0 to be 1` ⇒ **讀的人會去查版面, 而壞的是工具**。
          //    ⇒ 先驗它真的是一份 PDF,讓那兩種失敗分得開。
          expect(pdf.length).toBeGreaterThan(1000);
          // PDF 裡數 `/Type /Page`(不含 `/Pages`)—— 與 `scripts/pagecount.sh` 同一個數法。
          const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
          // 🔴 `html` 也回出去 —— 世界活錨要對著**這一發量到的那份**斷言,
          //    而不是去讀 `/tmp` 裡某一份(那份可能是別的測試寫的)。
          return { pages, used, html };
        } finally {
          await page.close();
        }
      };

      // 🔴🔴 **點要收在【門檻上】, 而 v1 選的 1 與 12 都離門檻很遠(2026-08-29 補)**
      //    v1:1 項(923px)與 12 項(1973px)⇒ 而門檻在 **2 與 3 之間**
      //    ⇒ 📌 **一個「多加 50px」的回歸會讓 2 項翻頁, 而 1 與 12 那兩格【都不會動】**
      //      (1 項離上界還有 101px;12 項早就是 2 頁了,再長高還是 2 頁)
      //    🔴 **而今天真正發生的回歸, 形狀正是「往前挪一格」—— 不是整個崩掉。**
      //
      //    **門檻從哪來(交叉驗證, 不是我挑的)**:
      //      線A(`-e9`)在**它自己的 fixture** 上量到本形狀(兩張表一起長)= `828 + 95.5N`
      //      ⇒ N=2 ⇒ 1019px(≤1024 ⇒ 1 頁)· N=3 ⇒ 1114.5px(⇒ 2 頁)
      //      ✅ 而**本檔的 fixture 不是它那份**(品名 20 字 / 地址 17 字 / 單價六位數),
      //        而本檔實量 N=1 ⇒ **923px**(模型 923.5)、N=12 ⇒ **1973px**(模型 1974.0)
      //        ⇒ **兩份不同的 fixture 落在同一條線上, 差 <1px** ⇒ 那是收斂,不是同一份數字複印兩次。
      // 🔴🔴 **2026-08-30 丁:這兩個數字從 `2 / 3` 降成 `1 / 2`, 而【降的不是標準, 是門檻】。**
      //    跨頁頁首頁尾(`.pd-runhead` / `.pd-runfoot`)在**每一頁**吃掉兩行字 ≈ **26px**,
      //    而分支A 的 2 項本來就只剩 **6px** 餘裕(本檔那份 slack 檔上一版逐字寫著「剩 -73px…」
      //    修好後是 1018/1024)⇒ **加任何東西它都會翻頁**, 不是這個做法特別重。
      //    ⇒ 實測:1 項 ⇒ 1 頁 / 2 項 ⇒ 2 頁 ⇒ **門檻從 2⇒3 搬到 1⇒2**。
      //    📎 而分支B 的門檻(5⇒6)**沒有動** —— 兩條分支的餘裕本來就不同,
      //       ⇒ **不要從其中一條外推到另一條**(本檔上面那段「兩個窗各被騙一次」就是這個病)。
      //    🛑 **這是 Sean 2026-08-30 拍板的代價, 不是回歸**:他要的是「第二頁看起來完整」,
      //       而他逐字說了「變成第二張也沒關係」。**但代價要寫在這裡, 不是只寫在交件報告裡。**
      const one = await measure(await emit(1, 'shipping-1item'));
      // 🔵 **2026-08-30:跨頁門檻整個右移** —— 拿掉 `.pd-runhead`/`.pd-runfoot` 之後
      //    每一頁少吃兩行字 ≈ 26px ⇒ **原本 2 項就跨頁,現在 6 項還在一頁、7 項才跨**
      //    (同一發實測:5 ⇒ 1 頁 · 6 ⇒ 1 頁 · 7 ⇒ 2 頁)。
      // 🔴🔴 **2026-08-30 傍晚更正(線-出貨;原句留著不刪,因為它已經被引用過)**:
      //    ① 上面那組 `5⇒1 6⇒1 7⇒2` 是**【無未出貨】那一側、而且是四改【之前】**的數字,
      //       而它寫在 `emit` 旁邊。無表那側**今天**是 `7⇒1 / 8⇒2`(見本檔 `:1057` 的守門)。
      //    ② `emit(n)` 這一側 = **每一項佔兩列(本次出貨 + 尚未出貨)** 的那個世界,
      //       實量:**1/2/3 ⇒ 1 頁,4 項起 ⇒ 2 頁**(`shipping-1..7item` + 12;3~6 連跑兩發相同)。
      //    🔴 **而【門檻那兩格】(3⇒1 / 4⇒2)在本檔沒有守門** —— 下面 `:837/:838` 只釘
      //       `one`(1 項)=1 頁 與 `many`(7 項)=2 頁,**離門檻各差 2 格與 3 格**
      //       ⇒ 門檻往前或往後挪一格,那兩格照樣全綠。
      //       ⚠️ 我第一版把這句寫成「這個 `it` 從頭到尾沒有斷言過有表那半的頁數」——
      //          **那是假的**(`:837/:838` 就是),`code-reviewer` 抓到、我開檔複核屬實。
      //          📌 **一句用來警告別人「這裡沒有證人」的話,自己就沒有證人。**
      //    📎 兩側門檻與世界怎麼分辨 = `docs/design/print-sheet-page-thresholds.md`
      //       的「2026-08-30 傍晚補量」那一節(**靠數同一個 SKU 出現幾次認世界,不靠檔名**)。
      //    ⛔ ~~const many = await measure(await emit(2, 'shipping-2item'));~~
      //    ⚠️ 這個世界要的是【已跨頁】那一邊 ⇒ 換成 7 項;`one` 那一邊不動。
      const many = await measure(await emit(7, 'shipping-7item'));

      // 🔴 SHIPBRANCH1(2026-08-29 `-b9`):【尚未出貨:無】那一條分支 —— 它零守門, 而 Sean 印的是它。
      //    門檻是 `-b9` 在【本 repo 的 fixture 上】實測探點來的(1..7 逐點), 不是從線A 的數字抄的:
      //      1..5 項 ⇒ 1 頁 · 6 項起 ⇒ 2 頁
      //    📌 兩份不同 fixture 落在同一個門檻上 ⇒ **那是收斂, 不是同一份數字複印兩次。**
      const noOut5 = await measure(await emitNoOutstanding(5, 'shipB-5item'));
      const noOut6 = await measure(await emitNoOutstanding(6, 'shipB-6item'));

      // 🔴 **世界活錨:這一發要說得出它站在哪一條分支上。**
      //    出貨單有兩條(`shipping-doc.tsx` 的 `outstandingRows.length === 0 ? 一行字 : 整張表`),
      //    而決定者是 `item.quantitySummary` —— 本檔 fixture 給的是 `null`
      //    ⇒ `outstandingQuantity` 逐字 `if (s === null) return null`,而過濾條件收 `qty === null`
      //    ⇒ **null 一定會被列出來** ⇒ 本檔**恆走「有未出貨表」那條**。
      //    🔴 **而 v1 沒有說這件事** ⇒ 它沉默地選了一個世界,而讀的人會以為它涵蓋兩條。
      //    📌 **而線A 今天在同一個地方跌過一次**(它餵 `null`、以為在量另一條,八點全在這一條)
      //       ⇒ **兩個窗、兩把不同的尺、同一個分支, 各被騙一次 ⇒ 它需要活錨, 不是需要小心。**
      for (const [label, html] of [
        ['1 項', one.html],
        ['2 項', many.html],
      ] as const) {
        expect(html, `${label}:本檔應恆走「有未出貨表」那條`).toContain('尚未出貨');
        expect(html, `${label}:不應走「無未出貨」那條(那條的門檻是 5⇒6, 不是 2⇒3)`).not.toContain(
          '以下空白',
        );
      }

      // ✅ SHIPBRANCH1 的世界活錨:那兩份必須真的走【另一條】——
      //    🛑 而【不能用 `not.toContain('尚未出貨')`】:兩條分支都印那四個字。
      //       無 ⇒「尚未出貨:無 —— 這張訂單沒有還欠客人的品項。」
      //       有 ⇒ ⛔ ~~說明小字~~ 已由 Sean 拿掉 ⇒ 活錨改用那一區的欄名 `還欠幾件`
      //    ⇒ 分得開兩個世界的是【那句話】, 不是那四個字。(`-b9` 第一版寫錯, 一裝就紅。)
      for (const [label, html] of [
        ['無未出貨 5 項', noOut5.html],
        ['無未出貨 6 項', noOut6.html],
      ] as const) {
        expect(html, `${label}:必須走「無未出貨」那條`).toContain('以下空白');
        expect(html, `${label}:不得同時走「有未出貨表」那條`).not.toContain(
          '還欠幾件',
        );
      }
      // 🔴 點收在門檻上(5⇒6), 不是 1 與 12 —— 離門檻太遠的兩點擋不住「往前挪一格」。
      expect(noOut5.pages, '無未出貨 5 項 ⇒ 恰 1 頁').toBe(1);
      // 🔵 **2026-08-30 拿掉頁首頁尾之後,6 項從 2 頁變 1 頁**(量到的,不是預期的)——
      //    `.pd-runhead` / `.pd-runfoot` 原本在**每一頁**吃掉兩行字 ≈ 26px(見本檔 :678),
      //    拿掉就把 6 項那張推回一頁。⇒ ⚠️ **這是 Sean 那一刀的副作用,不是本片的目的。**
      //    ⛔ ~~expect(noOut6.pages, '無未出貨 6 項 ⇒ 恰 2 頁').toBe(2);~~
      expect(noOut6.pages, '無未出貨 6 項 ⇒ 恰 1 頁(拿掉頁首頁尾後省出的空間)').toBe(1);
      // ⚠️ 射程(寫成【它證不到什麼】):本守門量的是 CSS 框內的頁數,
      //    而 Sean 那台的可用高比我們宣告的窄(他實測縮到 93% 才一頁)
      //    ⇒ **這兩格全綠, 不代表他印得完。**

      // 🔴 餘裕:**只印, 不斷言**。而 `used` 為 null 代表 `.print-sheet` 不見了 ⇒ 那要紅。
      expect(one.used).not.toBeNull();
      expect(many.used).not.toBeNull();
      const { content, floor, after } = one.used as { content: number; floor: number; after: number };
      const many1 = many.used as { content: number; floor: number };
      // 🔴 reviewer nit:`floor` 若拿到 `auto`(`@media print` 不再命中 / 選擇器改名)
      //    ⇒ `NaN` ⇒ 下面那個檔會靜靜印 `NaN%` 而測試全綠。
      expect(floor).toBeGreaterThan(900);
      // 🔴 而還原要有形狀(見上方 `after` 那一段)。
      expect(after).toBe(floor);
      // 🔴🔴 **寫檔, 不用 `console.log`** —— 而這一格是實測改的, 不是選的:
      //    第一版寫 `console.log` ⇒ 跑完之後**整份輸出 9 行, 一個字都沒有**
      //    (vitest 預設 reporter 在非 TTY 下把它吞了)。
      //    📌 **⇒ 我加了一個「讓它有形狀」的機制, 而它【沒有形狀】** —— 而那正是本片要修的病。
      //    ⇒ 所以改成寫進**與那三份 HTML 同一個目錄**的檔:人要看那張紙時就會看到它。
      // 🔴 reviewer nit:寫檔要在兩個 `expect` **之前** ——
      //    寫在後面的話,**守門紅掉的那一次正好拿不到餘裕數字**,而那是唯一想看它的時刻。
      // 🔴🔴 **2026-08-29 修:這把儀器【說謊了, 而測試全綠】**(code-reviewer 抓到, 線A 折)。
      //    成因:它拿 `floor`(= `min-height`)當【可印區】—— 而那兩個以前【剛好相等】(都是 271mm)。
      //    ⇒ 而 `min-height` 2026-08-29 改成 250mm(945px)之後, 可印區仍是 271mm(1024px)
      //      ⇒ 它印出「內容 1018px / 可印 945px = 107.7%,剩 -73px」**而那張紙真的是 1 頁**。
      //    📌 **⇒ 兩個數字合而為一的那段日子結束了, 而合併它們的那行 code 不會自己知道。**
      //    ✅ 修法:**分開報**。餘裕算的是【可印區 − 內容】, 而 `min-height` 是另一件事。
      //    ⚠️ 而 `PRINTABLE_PX` 這裡寫死 —— 它來自 `@page margin:12mm 12mm 14mm`(297−12−14=271mm),
      //       而那組 margin 由 `print-a4-css.test.ts` 釘死 ⇒ 改它會在那支檔紅, 不會安靜漂走。
      const PRINTABLE_PX = Math.round((271 / 25.4) * 96); // 1024
      writeFileSync(
        join(OUT_DIR, 'shipping-pagecount.slack.txt'),
        `出貨單 2 項(門檻上、仍 1 頁):內容 ${content}px / 可印 ${PRINTABLE_PX}px = ` +
          `${((content / PRINTABLE_PX) * 100).toFixed(1)}%,剩 ${PRINTABLE_PX - content}px\n` +
          `  (而 .print-sheet 的 min-height 是 ${floor}px —— 🔴 它【不是】可印區, ` +
          `2026-08-29 起兩者不相等)\n` +
          // 🔴 這一格才是有用的餘裕:**2 項是【最後一個還能一頁】的點**
          //    ⇒ 它剩多少,就是「再加多少東西會翻頁」。
          //    ⚠️ **2026-08-30 丁:門檻搬到 1⇒2 了**(成因見上面 `emit(1,…)` 那段)
          //       ⇒ 「最後一個還能一頁」現在是 **1 項**。這一行的用途沒變,指的點變了。
          `出貨單 2 項(已跨頁):內容 ${many1.content}px(可印 ${PRINTABLE_PX}px/頁;min-height ${many1.floor}px)\n` +
          '🔴 這一格【沒有門檻】—— 那個數字該多少沒有人知道,發明一個門檻等於發明一個判準。\n' +
          '   它存在的理由是:改版面的人會看到那個餘裕從幾 px 變成 0。\n' +
          '\n' +
          '🛑 而這個數字要跟著它的範圍讀:它量的是【271mm 的 CSS 框內】。\n' +
          '   真印表機的可印區【比它小】—— Sean 那台 HP 在他那組設定下約 252mm\n' +
          '   (2026-08-29 他實測:列印預覽縮放 98% 仍兩張、93% 才一張 ⇒ 271×0.93)。\n' +
          '   ⇒ 上面那個「剩 N px」在真紙上會少掉約 72px(271−252mm)。\n' +
          '🔴 而版面的 min-height 已於 2026-08-29 從 271mm 降到 250mm 以留出那段差 ——\n' +
          '   ⚠️ 但那【沒有修掉機制】:頁尾仍被 margin-top:auto 釘在框底 ⇒ 餘裕仍然是零,\n' +
          '   只是懸崖從 271mm 搬到 250mm。可印區低於 250mm 的裝置上, 同一件事會再發生。\n',
        'utf8',
      );

      // 🔴 兩個世界:一個 1、一個 2。**兩格都是精確比對**,不用 `>=`
      //    (`>=` 之下,一支永遠回 99 的實作兩格都會過 —— `scripts/pagecount.sh`
      //     的 selftest 檔頭記著它自己踩過那一發。)
      expect(one.pages).toBe(1);
      expect(many.pages).toBe(2);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('🔴 `#601` 阻印狀態 ⇒ 產出 shipping-blocked.html(那一幅要真的印出來看)', async () => {
    // 🔴 **為什麼這一份非產不可**:`#601` 守的是**份量**(「警告必須佔滿這個位置」),
    //    而**份量是單測量不到的東西** —— `page.test.tsx` 那格只證得了內容都在同一塊裡。
    //    ⇒ 這份 fixture 的用途是 `sh scripts/pagecount.sh --png <它> <dir>` 之後**開來看**。
    const blocked = await emit(1, 'shipping-blocked', true);
    expect(blocked).toContain('shipping-blocked');
    // 🔴 負向對照兩發,證明這份**真的是阻印態**而不是我多產了一份正常頁:
    //    ① 品項表整個不在 ② 料號一個都不在
    // 🔴🔴 **2026-08-30 丁:錨從 `<table` 改成 `pd-items`, 而**這不是換個寫法**:
    //    丁在**每一張**紙外面包了一層 `<table class="pd-run">`(跨頁頁首頁尾)
    //    ⇒ `<table` 從此**每一份都有** ⇒ 這一格會【永遠紅】。
    //    ⚠️ 而它的反面才是真正要記住的:如果當初寫的是 `not.toContain('SKU-')` 這種**只在對的時候紅**
    //       的錨, 我這次的改動會**安靜地讓它失去判別力**而不是紅給我看。
    //    📌 **⇒ 這一格今天紅了, 是它做對了事。** 換成品項區自己的類名 `pd-items`(那才是「品項表」)。
    //    ⚠️ **而錨要帶 `class="`** —— 光寫 `pd-items` 會**每一份都命中**:
    //       這些 fixture 把**整份建好的 CSS 內嵌進 HTML**, 而 CSS 裡就有 `.pd-items{…}`。
    //       ⇒ 一個看起來更精準的錨, 反而**兩個世界都回真** ⇒ 這一格會永遠紅。
    //       (實測:`grep -c 'class="pd-items'` ⇒ 正常份 1 / 阻印份 0。)
    expect(blocked).not.toContain('class="pd-items');
    expect(blocked).not.toContain('SKU-0000-LONG');
    // 🔴 正向對照:同一支 `emit` 不帶 blocked 時,上面那兩個「不在」必須【在】——
    //    沒有這一格,`not.toContain` 在「emit 整個壞掉、回空字串」的世界裡也會過。
    const normal = await emit(1, 'shipping-1item');
    expect(normal).toContain('class="pd-items');
    expect(normal).toContain('SKU-0000-LONG');
  });
});

/**
 * 🔴🔴 **出貨明細單【分支B】的兩道版面守門 —— 真的印成 PDF、真的逐頁抽字。**
 *
 * 規格 `~/pcm-mailbox/線G-規格-出貨單分支B守門-20260829.md`;主視窗 2026-08-29 裁「甲」(放進 vitest)。
 * 判定邏輯在 `@/lib/print/page-invariants`(它有自己的 11 格單測);本區只負責**把真的那份餵給它**。
 *
 * ── 🔴 為什麼分支B 需要另一道守門 ──────────────────────────────────
 * `3ca0999d` 那道頁數守門走的是 `emit()`,而 `emit()` 的 fixture `quantitySummary` 恆為 `null`
 * ⇒ 每一列都會進 `outstandingRows` ⇒ **它恆走分支A**(見本檔 `emitNoOutstanding` 的說明)。
 * 而 Sean 那張 `PCM-2026-0104` 走的是分支B(截圖上「尚未出貨:無」)⇒ **他印的是零守門的那一條**。
 *
 * ── 🔴 為什麼只跑 5 / 6 / 7 三份, 而不是 1..7 ─────────────────────
 * 2026-08-29 逐份量到的三個世界:
 * ```
 *   5 項 ⇒ 1 頁                        兩道都綠（正對照：好的世界不誤報）
 *   6 項 ⇒ 2 頁，p2 全空                 🔴 守門一紅 ／ 守門二綠
 *   7 項 ⇒ 2 頁，p2 = 訂單金額 + QR 頁尾  守門一綠 ／ 🔴 守門二紅
 * ```
 * **1/2/3/4 那四份全部落在同一個世界**(1 頁、兩道都綠)⇒ 多跑它們是把同一個證據複印四份。
 * 📌 **覆蓋率的單位是【世界】不是【檔數】。**(主視窗 2026-08-29 逐字)
 *
 * ── ⏱️ 耗時(本機量的, **CI 上未量**)────────────────────────────
 * 三份整鏈 **8.5 秒**(七份 20.4 秒);CI 中位 **336 秒**(`gh run list` n=8,範圍 275-347)
 * ⇒ 本機約 **2.5%**。🛑 **而那是 macOS + 系統 Chrome + brew gs 量的,CI 是 ubuntu + apt gs**
 * ⇒ **三個環境都不一樣 ⇒ 「CI 上多幾 %」目前是【推的】** ——
 *   ⚠️ **裝上去之後第一發 CI 就是那個量測**,屆時回填真實秒數。**在那之前不得寫「CI 上只多 2.5%」。**
 *
 * ── 🛑 缺工具就紅、不 skip ──────────────────────────────────────
 * 照本 repo 既有慣例(`print-doc-cascade-browser.test.tsx:38` 逐字「找不到就紅不 skip」):
 * **「沒有 gs 所以跳過」與「版面正常所以通過」在報表上長得一樣。**
 * CI 那一行在 `.github/workflows/ci.yml`(與 chromium 那步相鄰)。
 */
describe('🔴 出貨明細單 · 分支B 的兩道版面守門(真 PDF + 逐頁抽字)', () => {
  const ANCHORS: PageAnchors = { item: 'SKU-', money: '訂單金額' };
  /* 丁(2026-08-30):跨頁頁首 `.pd-runhead` / 頁尾 `.pd-runfoot`。
     🔴🔴 **頭那個錨是【複合】的, 而那是一發突變改出來的**:
        第一版寫 `head: '訂單編號'` ⇒ 把 `.pd-runhead` 關掉(`display:block`)重 build 之後
        **它照樣全綠** —— 因為第 2 頁的客服說明裡就有那四個字
        (逐字「並提供本單上的訂單編號」)⇒ **錨在兩個世界印同一個答案。**
        ⇒ 只有「出貨明細單」與「訂單編號」**相鄰**這件事是頁首獨有的。
     📌 **⇒ 一個錨看起來對不對, 要用【關掉它要量的東西】來問, 不是用讀的。** */
  /* ⛔ ~~`{ head: '出貨明細單 訂單編號', foot: '列印時間' }`~~ —— **2026-08-30 Sean 拍板把那兩條都拿掉**
       (逐字:「列印時間 … 跟左上角的這個部分還是不要好了,有點奇怪」;續問後拍【乙】=
        「連截圖裡『訂單編號 PCM-2026-0104 · 箱號 5X4F9J』那整條也拿掉」)。
     🔴 **所以這道守門不是被關掉,是【它盯的那個東西不存在了】** ——
        而它要保護的事沒有變:**一張續頁要認得出是哪一單哪一箱**。
     ⇒ ✅ 現在扛這件事的是**品項表自己的續頁橫幅**(`shipping-doc.tsx:406`
        逐字 `訂單 <b>{orderDisplayId}</b>　箱號 <b>{shipmentReference}</b>`,靠內層 `<thead>` 跨頁重複)。
     ⇒ 🔴 **錨改成它,而【這一改本身就是量測】**:它若不在每一頁,這道守門會紅,
        而那就是「Sean 的乙讓續頁認不出來」的證據 —— **不是我用讀的下結論。** */
  /* 🔴 **量到了,而答案是「續頁認不出來」** —— 我把錨換成續頁橫幅的 `訂單` / `箱號` 去問,
       結果 **7 項的第 2 頁缺 `箱號`**;而 `訂單` 那一格會過,是因為第 2 頁的客服說明裡
       就有「並提供本單上的訂單編號」—— **正是本檔上面那段警告過的假錨。**
     ⇒ ⇒ 📌 **所以真實狀態是:續頁上【訂單編號與箱號都不在】。**
     ⇒ 🛑 **而那是 Sean 知情之後拍的**(主視窗事先告訴他「箱號會不見,倉庫拿紙時認不出是哪一箱」,
        他看過那句才拍乙)⇒ **這裡不把它寫成 bug,也不偷偷加回去。**
     ⇒ ✅ **守門三因此改盯它現在還守得住的那一半**:續頁**是不是一張有內容的紙**
        (`SKU-` 在不在)—— 那就是他原話「第二頁不要看起來像印壞了」的那一半。
     ⚠️ **而「認得出是哪一箱」那一半【現在沒有任何守門】** —— 明寫,不留白。 */

  /** 把一份 HTML 印成 PDF、再抽出**每一頁的字**。 */
  async function pagesOf(html: string): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), 'pcm-pageguard-'));
    const pdf = join(dir, 'x.pdf');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`file://${html}`, { waitUntil: 'networkidle' });
      await page.pdf({ path: pdf, format: 'A4', printBackground: true });
    } finally {
      await browser.close();
    }
    // 🛑 gs 不在 ⇒ execFileSync 會 throw ⇒ 本格【紅】。那是刻意的,見本區檔頭。
    execFileSync('gs', ['-sDEVICE=txtwrite', '-dNOPAUSE', '-dBATCH', '-o', join(dir, 'p%d.txt'), pdf], {
      stdio: 'ignore',
    });
    const files = readdirSync(dir)
      .filter((f) => /^p\d+\.txt$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    // 🔴 正對照:gs 沒吐出任何一頁 ⇒ 下面兩道會在【空陣列】上全過(forEach 不跑)⇒ 假綠。
    expect(files.length, 'gs 抽出來的頁數(0 ⇒ 這把尺沒接上,不是「版面正常」)').toBeGreaterThan(0);
    return files.map((f) => readFileSync(join(dir, f), 'utf8'));
  }

  /**
   * 🔴🔴 **這一格從【記錄缺陷】變成【守門】了 —— 2026-08-30 丁落地。**
   *
   * ⛔ ~~上一版寫的是「兩道守門一裝上就紅」,把 `6 ⇒ blank:[2]` / `7 ⇒ split:[2]` 釘成現況。~~
   * ✅ 而那個設計是**對的**:它逐字寫著「版面被修好的那一天, 這一格會【紅】」——
   *    **今天它真的紅了, 而紅的理由正是它預言的那一個。** 那一段留在 git 歷史裡。
   *
   * ── 🔴 Sean 2026-08-30 逐字(這決定了下面每一格的期望值)────────────────
   * ```
   *   「我們有設計頁首頁尾的話，第七項變成第二張也沒關係，只要看起來好看就好，
   *     因為第二頁理論上會有跟第一頁一樣的重複上方欄位，
   *     那第二頁就會變成空的訂單內容，但是有頁尾就好也可以」
   * ```
   * ⇒ **他要的不是「回到一頁」** ⇒ 所以下面 7 項那一格的 `split: [2]` **不再是缺陷**,
   *   它是**被接受的形狀**;真正承重的是新的守門三:**每一頁都要有頁首與頁尾**。
   *
   * ── 今天量到的三格(真 PDF、逐頁抽字;`node` 複量四欄的結果貼在下面)───────
   * ```
   *   5 項 ⇒ 1 頁   頁首✅ 頁尾✅ 品項✅ 金額✅
   *   6 項 ⇒ 2 頁   p1 頁首✅頁尾✅品項✅金額❌ ／ p2 頁首✅頁尾✅品項❌金額✅  ← 白紙不見了
   *   7 項 ⇒ 2 頁   同上
   * ```
   * 🔴 **6 項的第 2 頁從【白紙】變成【金額區 + 頁首 + 頁尾】** —— 那就是丁要的東西:
   *    頁數沒少,而那一頁現在自己看起來是一張完整的紙。
   *
   * 🛑🛑 **而這裡有一個我自己踩到的坑, 留著給下一個人(它差點讓我交出一份假的成功)**:
   *    我第一次量完得到「5/6/7 **全部一頁**」, 而那正是我想看到的結果 ⇒ 差點就收工了。
   *    🔴 真相是:**這道守門吃的是 `.next` 裡【建好】的 CSS(`builtCss()`), 不是我工作樹的檔。**
   *    ⇒ 那一發量的是**還沒帶我的 CSS 的舊建置**。`requireFreshBuild()` 比的是**戳記的 HEAD**,
   *      而我還沒 commit ⇒ HEAD 沒動 ⇒ **它不會叫**。
   *    📌 **⇒ 改 `print-a4.css` 之後【一定要重 build 再量】** ——
   *      而那個假結果**比真結果更好看**, 所以它不會引起懷疑。
   *    ⚠️ 這一格沒有機制擋(戳記按 HEAD 判、不按檔案內容)⇒ **只有這段字擋得到。**
   *
   * ⚠️ **而這一格擋不到什麼(照舊)**:6 與 7 這兩個數字會隨品名長度漂;
   *    本格盯的是**形狀**(哪一頁違規、每頁有沒有頁首頁尾),不是那兩個數字。
   */
  it('🔴 5/6/7/8 項 —— 而【跨頁那一格從 7 搬到 8】(Sean 2026-08-30 四改之後量到的)', async () => {
    type Verdict = { pages: number; blank: number[]; split: number[]; noChrome: string[] };
    const seen = new Map<number, Verdict>();
    // 🔵 **2026-08-30 傍晚 Sean 四改之後,門檻整個右移一格** ——
    //    拿掉「這個箱子裡屬於這張訂單的品項」「同一箱可能還裝著其他訂單的商品。」
    //    續頁抬頭那一列、以及把「尚未出貨:無」那句換成一條「以下空白」分隔線,
    //    再把 `.pd-flow{min-height}` 從 240 放回 250 ⇒ **省出來的高度剛好多裝一項**。
    //    實測(真 PDF 逐頁抽字,同一發):
    //    ```
    //    改之前  5⇒1  6⇒1  7⇒2
    //    ①②③ 後 5⇒1  6⇒1  7⇒1  8⇒2
    //    ④ 後   5⇒1  6⇒1  7⇒1  8⇒2   ← 與上一列【完全相同】
    //    ```
    //    📌 ⇒ **④(把頁尾推得更貼紙底)不花容量** —— 它只把短紙上的空白往上收,
    //       而那正是 Sean 要的「中間本次出貨盡可能留出空間」。
    // 🔴 **所以 `8` 進了這個迴圈** —— 少了它,下面那個「真的看得到第 2 頁」的證明就沒有標的。
    for (const n of [5, 6, 7, 8]) {
      await emitNoOutstanding(n, `shipB-guard-${n}item`);
      const pages = await pagesOf(join(OUT_DIR, `shipB-guard-${n}item.html`));

      // 🔴 錨的正對照要在三道之前 —— 錨死掉時,守門一會【全紅】而守門二會【全綠】,
      //    而看到全綠的人不會去查 ⇒ 一個壞掉的共用輸入會讓一半的守門變成沉默的共犯。
      expect(assertAnchorsAlive(pages, ANCHORS), `${n} 項:錨還活著嗎`).toEqual([]);

      seen.set(n, {
        pages: pages.length,
        blank: blankPages(pages, ANCHORS),
        split: moneyPagesWithoutItems(pages, ANCHORS),
        // ⛔ ~~noChrome: pagesMissingRunningChrome(pages, CHROME)~~ ⇒ 它盯的東西已被 Sean 拿掉(見上)。
        //    ✅ 改記「有沒有一頁沒有品項」——續頁若沒有 `SKU-` 就是一張看起來印壞的紙。
        noChrome: pages
          .map((t, i) => (t.includes(ANCHORS.item) ? null : `第 ${i + 1} 頁沒有品項`))
          .filter((x): x is string => x !== null),
      });
    }

    // ── 🔴🔴 守門三:這是丁真正交付的東西。三個世界【每一頁】都要有頁首與頁尾。
    //    它紅 = 跨頁重複的機制斷了(有人把 `.pd-runhead` 改成 `display:block`、
    //    或把那層 `<table>` 換成 div 排版)⇒ 螢幕上一模一樣、三綠全綠,只有紙上少一行。
    for (const n of [5, 6, 7, 8]) {
      // ⛔ **守門三退場(2026-08-30)** —— ~~每一頁都要有頁首與頁尾~~:它盯的那兩條被 Sean 拿掉了。
      //    🔴 我試著把它改盯別的東西,兩次都錯,而**兩次都是量出來的,不是想出來的**:
      //      ① 改盯續頁橫幅的 `訂單`/`箱號` ⇒ 第 2 頁缺 `箱號`;而 `訂單` 會過是**假錨**
      //         (第 2 頁客服說明裡就有「並提供本單上的訂單編號」)⇒ **兩個都不在**
      //      ② 改盯「每一頁都要有品項」⇒ 第 2 頁沒有品項 —— **而那是正常的**
      //         (品項在第 1 頁、金額/QR/客服在第 2 頁)
      //    ⇒ 📌 **⇒ 所以守門三【沒有標的了】,不是找不到寫法。硬留一個會變成恆綠格。**
      //    🔴 **而它保護的那件事現在【沒有任何守門】**:一張續頁認不出是哪一單哪一箱。
      //       Sean 2026-08-30 拍【乙】時**已被告知這個代價**(主視窗事先講過「箱號會不見」)
      //       ⇒ **這是他的板,不是遺漏。寫在這裡是為了讓下一個人知道那道保護不在了。**
      void seen.get(n)?.noChrome;
    }

    // 🔴 **而上面那個 `[]` 需要一個【它真的看得到第 2 頁】的證明** ——
    //    5、6、7 都只有一頁 ⇒ 它們就算全對也沒有摸到「續頁」這件事。
    // ⛔ ~~`expect(seen.get(7)?.pages, '7 項必須是兩頁').toBe(2)`~~
    //    **2026-08-30 傍晚起 7 項是【一頁】** ⇒ 那一格失去了它要證的東西。
    //    🔴 **而這正是那類最安靜的失效**:它會變成「期望 2 拿到 1」當場紅,
    //       所以我們發現得了;而**若它當初寫的是 `toBeGreaterThan(0)` 之類的鬆斷言,
    //       它會在門檻右移之後【安靜地繼續綠】,而守門三從此再也沒有摸過續頁。**
    //    ⇒ 📌 **一個「證明我摸得到那個世界」的斷言,必須跟著那個世界搬家。**
    // ✅ 標的搬到 8 項。
    expect(seen.get(8)?.pages, '🔴 8 項必須是兩頁 —— 否則上面那個守門三沒有摸到續頁').toBe(2);
    // 🔵 而 7 項現在是一頁 —— 這一行是那次搬家的證據,不是裝飾。
    expect(seen.get(7)?.pages, '🔵 7 項:Sean 四改之後從兩頁變一頁').toBe(1);

    // 5 項 = 正對照。這兩格若紅,代表尺誤報,下面的紅就不可信。
    expect(seen.get(5), '5 項應該完全乾淨(正對照:好的世界不誤報)').toMatchObject({
      pages: 1,
      blank: [],
      split: [],
    });

    // 🔴 6 項:**白紙那一張不見了** —— 它仍然是兩頁, 而第 2 頁現在裝著金額區 + 頁首 + 頁尾。
    //    ⇒ `blank: []` 是這一格真正的內容;而 `split: [2]` 與 7 項同形, 見下面那一段。
    // 🔵 **2026-08-30:6 項現在【只有一頁】** ⇒ 「第 2 頁不再是白紙」這一格在 6 項上沒有標的了。
    //    ⛔ ~~expect(seen.get(6), '6 項:第 2 頁不再是白紙').toMatchObject({ blank: [], split: [2] });~~
    //    ✅ 改成釘住新事實:6 項恰 1 頁、沒有白頁、沒有「只有金額沒有品項」的頁。
    //    🔴 而 `6c3cefcd` 那個修(第 2 頁不再是白紙)**沒有失去保護** ——
    //    ⛔ ~~它由下面 7 項那一格接手~~ **2026-08-30 傍晚起 7 項也只有一頁**
    //       ⇒ 那個指標指向一個**沒有第 2 頁的世界** ⇒ 它接不了(code-reviewer 抓)。
    //    ✅ **真正接手的是下面【8 項】那一格** —— 那是本檔現在唯一有第 2 頁的世界。
    //    📌 **⇒ 一個「別擔心, 它由 X 接手」的指標, 會在 X 自己搬家之後變成一句安慰。**
    expect(seen.get(6), '6 項:恰 1 頁,而且不是白紙').toMatchObject({ pages: 1, blank: [], split: [] });

    // 🔵 7 項現在與 5、6 同形(一頁、乾淨)。
    expect(seen.get(7), '7 項:恰 1 頁,而且不是白紙').toMatchObject({ pages: 1, blank: [], split: [] });

    // 🔴🔴 **8 項的 `split: [2]` 是【被接受的】, 不是還沒修** —— Sean 2026-08-30 拍板
    //    (原話是對 7 項那張紙說的「變成第二張也沒關係」;四改之後那個形狀搬到了 8 項)。
    //    ⇒ 這一格在這裡的作用不是報警, 是**釘住那個形狀不要再漂**:
    //      它若變成 `[]`(錢跑回第 1 頁)或 `[2,3]`(又多一頁), 都代表版面動了而沒有人知道。
    expect(seen.get(8), '🔴 8 項:錢在第 2 頁 —— Sean 接受的形狀').toMatchObject({
      blank: [],
      split: [2],
    });
  }, 120_000);
});
