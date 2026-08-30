// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from '@playwright/test';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { StatementDoc } from './statement-doc';

// statement-cascade-browser.test.tsx —— 客人那張紙的**串接量測**(真 chromium + 真編譯後 CSS)。
//
// 🔴🔴 **本檔存在的理由是三輪審查,而三輪抓到的【每一顆真 bug 都在同一層】:**
//    R1 `.stmt-page{padding:24px}` 蓋掉 `@media print{.print-sheet{padding:0}}`
//    R2 `.stmt-page > * + *` 蓋掉 `.pd-bottom{margin-top:auto}` ⇒ 頁尾不貼紙底
//    R3 `.stmt-page > * + *` 的**前提整個是假的** ⇒ 四個區塊間距全被蓋成 4.23mm
//    R3 **BLOCKER** root layout 的 `<MobileTabBar/>` 印在紙上、壓在金額表上
//    ⇒ **四顆全是 cascade 贏家的問題,而 typecheck / lint / build / 83 格單測【全綠】。**
//    📌 **⇒ 那一層在這個 app 裡【一把已 commit 的尺都沒有】** —— 前三顆是人讀出來的,
//       而我修完自己跑的 playwright 量測是 ad-hoc、不在 repo ⇒ **下一個改 CSS 的人什麼都不會紅。**
//    ⇒ 本檔就是那把尺。形狀照後台既有的 `print-doc-cascade-browser.test.tsx`,不自己發明。
//
// 🔴 **量的是【列印媒體】**(`emulateMedia({media:'print'})`)—— 一把量紙的尺跑在螢幕模式下,
//    對螢幕為真、對紙為假,而它會印一個綠。
//
// 🔴 **CSS 取【編譯產物】,找不到就紅、不 skip**:「沒有 CSS 所以跳過」與「CSS 正常所以通過」
//    在報表上長得一樣。訊息會叫你先跑 `TURBO_FORCE=1 pnpm build`。
//
// 🔴 **它同時量【兩個世界】** —— 每一格都有一條 screen 的對照。
//    沒有那一半的話,`display:none` 與「這個元素根本不在」印同一個結果。
//
// ⚠️ **已知限制(照抄後台那支的自陳,同一個成因)**:本檔讀**共用的 `.next` 產物** ——
//    別的視窗同時 `pnpm build` 時,它腳下的 CSS 會在兩次執行之間變掉。
//    ⇒ **它的紅要先問「剛剛有沒有人在 build」**;連續兩次同一格紅才當成真的。
//    ⇒ **它不是不決定性的測試,是不決定性的【輸入】。**
// ⚠️ **射程**:它量的是 CSS 誰贏,**不是紙好不好看** —— 版面美醜、字級順不順眼由肉眼驗。

const REPO = join(__dirname, '../../../../..');
const CHUNKS = join(REPO, 'apps/storefront/.next/static/chunks');

/** 從編譯產物裡撈含指定字面的那支 CSS。找不到 ⇒ throw(不 skip)。 */
function compiledCss(marker: string): string {
  let files: string[];
  try {
    files = readdirSync(CHUNKS).filter((f) => f.endsWith('.css'));
  } catch {
    throw new Error(`讀不到 ${CHUNKS} —— 先跑 \`TURBO_FORCE=1 pnpm build\``);
  }
  const hit = files
    .map((f) => readFileSync(join(CHUNKS, f), 'utf8'))
    .find((css) => css.includes(marker));
  if (hit === undefined) {
    throw new Error(
      `編譯產物裡找不到含 \`${marker}\` 的 CSS(掃了 ${files.length} 支)—— 先跑 \`TURBO_FORCE=1 pnpm build\``,
    );
  }
  return hit;
}

const twd = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });
const ORDER = {
  id: 'o1',
  displayId: 'PCM-2099-0007',
  createdAt: '2099-04-15T10:00:00Z',
  paymentStatus: 'paid',
  fulfillmentStatus: 'shipped',
  paymentMethod: 'tappay',
  paidAt: '2099-04-18T03:00:00Z',
  subtotal: twd(18000),
  shippingFee: twd(100),
  discountTotal: twd(0),
  total: twd(18100),
  shippingMethod: 'home',
  shippingAddress: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  cancelledAt: null,
  cancelKind: 'none',
  items: [0, 1, 2].map((i) => ({
    id: `oi${i}`,
    variantSku: `SKU-100${i}`,
    brand: 'CNC RACING',
    title: `下鏈條蓋 ${i}`,
    spec: { color: 'black' },
    imageUrl: null,
    vehicle: null,
    quantity: 1,
    unitPrice: twd(6000),
    lineTotal: twd(6000),
  })),
  itemCount: 3,
  itemsTruncated: false,
} as MemberOrderDetail;

type Measured = {
  tabbarDisplay: string;
  bodyPadBottom: string;
  sheetPadding: string;
  gapInfoMm: number;
  gapItemsMm: number;
  gapTotalsMm: number;
  bottomToFloorPx: number;
  denominator: { sheet: boolean; tabbar: boolean; info: boolean; items: boolean; totals: boolean; bottom: boolean };
};

let browser: Browser;
let screen: Measured;
let print: Measured;

beforeAll(async () => {
  // 🔴 載入順序照真的來:root layout 的 CSS 先,然後才是這一頁自己 import 的那兩支。
  //    順序寫反的話,R1 那顆 bug 在量具裡就不會發生 ⇒ 量具會替它背書。
  const layoutCss = compiledCss('.mobile-tabbar');
  const pageCss = compiledCss('.stmt-page');

  // 🔴 `<MobileTabBar/>` 是 **root layout 每一條 route 都渲染的**(`app/layout.tsx:179`)——
  //    它不在 `StatementDoc` 裡,而**客人印到的是整條 route**。
  //    R3 的 BLOCKER 就住在這個縫:前兩輪的比對框是「元件 vs 後台元件」,而紙上有的比那多。
  //    `data-mobile="true"` = SSR UA hint 那條路(手機客人,而這一頁的客群包含不熟電腦的)。
  const html = `<!doctype html><html lang="zh-Hant" data-mobile="true"><head><meta charset="utf-8">
<style>${layoutCss}</style><style>${pageCss}</style></head>
<body>${renderToStaticMarkup(<StatementDoc order={ORDER} />)}
<nav class="mobile-tabbar"><a class="mtb-item">首頁</a><a class="mtb-item">目錄</a></nav></body></html>`;

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);

  const read = () =>
    page.evaluate((): Measured => {
      const q = (s: string) => document.querySelector(s);
      const mm = (px: string) => Math.round((parseFloat(px) / 96) * 25.4 * 100) / 100;
      const sheet = q('.stmt-page');
      const bottom = q('.pd-bottom');
      const tabbar = q('.mobile-tabbar');
      const info = q('.pd-info');
      const items = q('.pd-items');
      const totals = q('.pd-totals');
      // 🔴 分母:每一個被量的節點都要在。少一個 ⇒ 下面的值會是 fallback,而 fallback 不會叫。
      const denominator = {
        sheet: sheet !== null, tabbar: tabbar !== null, info: info !== null,
        items: items !== null, totals: totals !== null, bottom: bottom !== null,
      };
      const cs = (el: Element | null) => (el === null ? null : getComputedStyle(el));
      return {
        tabbarDisplay: cs(tabbar)?.display ?? 'MISSING',
        bodyPadBottom: getComputedStyle(document.body).paddingBottom,
        sheetPadding: cs(sheet)?.padding ?? 'MISSING',
        gapInfoMm: mm(cs(info)?.marginTop ?? '-1px'),
        gapItemsMm: mm(cs(items)?.marginTop ?? '-1px'),
        gapTotalsMm: mm(cs(totals)?.marginTop ?? '-1px'),
        bottomToFloorPx:
          sheet === null || bottom === null
            ? -1
            : Math.round(sheet.getBoundingClientRect().bottom - bottom.getBoundingClientRect().bottom),
        denominator,
      };
    });

  await page.emulateMedia({ media: 'screen' });
  screen = await read();
  await page.emulateMedia({ media: 'print' });
  print = await read();
  // 🔴🔴 **第二個引數 60 秒不是保險,是量到的**:`vitest.config.ts:71` 只設了
  //    `testTimeout: 15_000`,**沒有設 `hookTimeout`** ⇒ hook 走預設的 **10 秒**,
  //    而這個 hook 要 launch 一顆 chromium。單跑本檔 ⇒ 0.8 秒;
  //    **跟著 268 支檔一起跑 ⇒ 逾時。**
  // 📌 **⇒ 而它的症狀正是鐵則 11 點名的那一種**:`Hook timed out` ⇒ **檔【紅】而 0 格紅**
  //    ⇒ 那一發的 `Tests` 那行印 **3926 passed / 0 failed**,與全綠那一發**逐字相同**
  //    ⇒ **只比測項總數的話,這一發會被判成 ✅。**
  //    ⇒ 抓到它的是「連跑兩發、比【紅的檔數】」那一格(實測:run10 = 268 passed、
  //      run11 = 1 failed | 267 passed,而**兩發的測項總數都是 3928**)。
  // ⚠️ **不改 `vitest.config.ts`** —— 那是根層共用設定,動它會影響每一支測試。
}, 60_000);

// 🔴 ** 也要給** —— 上一版只給了 , 而它還是印 `Hook timed out in 10000ms`
//    ⇒ **逾時的是【關瀏覽器】那一邊**。兩個 hook 各有各的預算, 給一個不會蓋到另一個。
//    📌 而診斷它的線索是那個數字本身: != 我給 `beforeAll` 的 60000
//       ⇒ **逾時訊息裡的數字, 就是「是哪一個 hook」的答案。**
afterAll(async () => {
  await browser?.close();
}, 30_000);

describe('客人明細列印頁 · 串接量測(真 chromium + 編譯後 CSS + 列印媒體)', () => {
  it('🔴 分母:六個被量的節點都在(少一個的話下面每一格都是 fallback)', () => {
    expect(print.denominator).toEqual({
      sheet: true, tabbar: true, info: true, items: true, totals: true, bottom: true,
    });
  });

  it('🔴🔴 BLOCKER 守門:紙上【不得】有手機底部導覽列(R3 抓到)', () => {
    // 成因:root layout 每條 route 都渲染它, 而 `mobile-tabbar.css` 兩個分支都沒有 `@media print`。
    // ⚠️ 而那個「顯而易見」的修法會輸:`.mobile-tabbar{display:none}` 只有 (0,1,0),
    //    輸給 `html[data-mobile="true"] .mobile-tabbar` 的 (0,2,1) —— 實測過。
    expect(print.tabbarDisplay).toBe('none');
    // 🔴 另一半 —— 沒有它,「藏起來了」與「這個元素根本沒被渲染」印同一個結果。
    expect(screen.tabbarDisplay, '螢幕上也不見了 ⇒ 我把手機導覽列弄壞了').toBe('flex');
  });

  it('🔴 紙上不得被 `body{padding-bottom}` 擠壓(同一個成因的另一半)', () => {
    expect(print.bodyPadBottom).toBe('0px');
    expect(screen.bodyPadBottom, '螢幕上那 70px 是手機導覽列的位子, 不該消失').toBe('70px');
  });

  it('🔴 紙面邊界只由 `@page` 決定 —— 螢幕的 24px 內距不得跟上紙(R1)', () => {
    expect(print.sheetPadding).toBe('0px');
    expect(screen.sheetPadding).toBe('24px');
  });

  it('🔴 區塊間距 = `print-a4.css` 自己的值, 不是我鏡射出來的(R3)', () => {
    // 這三個數字**逐字取自那份逐位元組副本**:`.pd-info{5mm}`/`.pd-items{5mm}`/`.pd-totals{4mm}`。
    // ⇒ 它們相等就代表「與後台那張同一套間距」, 因為後台吃的是同一份無層規則。
    // ⛔ 修好前這三格全是 4.23mm(= 我那條 `* + *` 的 1rem)—— 實測過。
    expect([print.gapInfoMm, print.gapItemsMm, print.gapTotalsMm]).toEqual([5, 5, 4]);
  });

  it('🔴 頁尾(金額表 + LINE QR)貼紙底(R2)', () => {
    expect(print.bottomToFloorPx).toBe(0);
    // ⇒ 螢幕上**不該**貼底(那裡的紙沒有固定高度)—— 兩個世界不同, 這格才有判別力。
    expect(screen.bottomToFloorPx).toBeGreaterThan(0);
  });
});
