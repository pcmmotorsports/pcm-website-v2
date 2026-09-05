// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from '@playwright/test';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { StatementDoc } from './statement-doc';
import { buildStatementHtml, parseFontFaces } from '@/lib/print/statement-html';

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
  // 🔵 段 3 加欄:這些 fixture 演的是【已付款的刷卡單】⇒ 填 'tappay',
  //   不是「隨便填一個讓它綠」——填的是這個 fixture 本來就在演的那個世界。
  paymentChannel: 'tappay' as const,
  paidAt: '2099-04-18T03:00:00Z',
  shippedAt: null,
  allItemsShipped: false,
  subtotal: twd(18000),
  shippingFee: twd(100),
  discountTotal: twd(0),
  taxTotal: twd(0),
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
    shipped: false,
  })),
  itemCount: 3,
  itemsTruncated: false,
} as MemberOrderDetail;

type Measured = {
  tabbarDisplay: string;
  actionsDisplay: string;
  bodyPadBottom: string;
  sheetPadding: string;
  gapInfoMm: number;
  gapItemsMm: number;
  gapTotalsMm: number;
  bottomToFloorPx: number;
  denominator: {
    sheet: boolean; tabbar: boolean; info: boolean;
    items: boolean; totals: boolean; bottom: boolean; actions: boolean;
  };
};

let browser: Browser;
let screen: Measured;
let print: Measured;

beforeAll(async () => {
  // 🔴 載入順序照真的來:root layout 的 CSS 先,然後才是這一頁自己 import 的那兩支。
  //    順序寫反的話,R1 那顆 bug 在量具裡就不會發生 ⇒ 量具會替它背書。
  // 🔴🔴 **標記要【每一支來源檔各自獨有】, 否則兩次查詢會撈到同一支 chunk。**
  //    ⛔ ~~`compiledCss('.mobile-tabbar')`~~ —— 那個字面**現在兩支檔都有**:
  //       `mobile-tabbar.css`(本體)與 `statement.css`(我那條 `@media print` 藏它的規則)
  //       ⇒ `.find()` 撈到第一支 ⇒ **layout 與 page 變成同一支** ⇒ tabbar 的本體規則整組不見
  //       ⇒ 螢幕那半的斷言當場紅(`flex` ⇒ `block`)。
  //    📌 **⇒ 而它紅的方式是【對的】** —— 那兩格螢幕對照就是為了這種事而存在:
  //       沒有它們, 這次量具失效會安靜地讓 print 那半「通過」。
  //    ✅ 換成 `.mobile-tabbar-btn`(只有 `mobile-tabbar.css` 有;`statement.css` ⇒ 0 命中)。
  const layoutCss = compiledCss('.mobile-tabbar-btn');
  const pageCss = compiledCss('.stmt-page');
  // 🔴 分母:兩支必須是**不同**的 chunk。相同 ⇒ 上面那個病又回來了, 而它會安靜地發生。
  if (layoutCss === pageCss) {
    throw new Error('layout 與 page 撈到同一支 chunk ⇒ 標記不夠獨有, 量具失效(不是產品壞了)');
  }

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
      const actions = q('.stmt-actions');
      const info = q('.pd-info');
      const items = q('.pd-items');
      const totals = q('.pd-totals');
      // 🔴 分母:每一個被量的節點都要在。少一個 ⇒ 下面的值會是 fallback,而 fallback 不會叫。
      const denominator = {
        sheet: sheet !== null, tabbar: tabbar !== null, info: info !== null,
        items: items !== null, totals: totals !== null, bottom: bottom !== null,
        actions: actions !== null,
      };
      const cs = (el: Element | null) => (el === null ? null : getComputedStyle(el));
      return {
        tabbarDisplay: cs(tabbar)?.display ?? 'MISSING',
        actionsDisplay: cs(actions)?.display ?? 'MISSING',
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
  // 🔴🔴 **關瀏覽器要【夾住】, 不是給它更大的數字。**
  //    經過:先只給 `beforeAll` 60s ⇒ 仍印 `10000ms`(預設)⇒ 是 `afterAll`;
  //    給 `afterAll` 30s ⇒ **仍然逾時**(`Hook timed out in 30000ms`)。
  //    ⇒ 📌 **一個「關掉一顆瀏覽器」的動作超過 30 秒, 不是它慢, 是機器被吃光了**
  //       (八個施工窗並行 + 同時有人在 `pnpm build`)。
  //    ⇒ ⇒ **再加大只是把同一件事往後推, 而它下一次仍然會紅** —— 而它紅的形狀是
  //       **檔紅而 0 格紅**(鐵則 11 點名的那一種:`Tests` 那行與全綠那一發逐字相同)。
  //
  // ✅ 改成 race 夾住:10 秒關不掉就放手, **並且不讓它把整支檔判紅** ——
  //    這一步是**收尾**, 它失敗**不代表任何一條斷言不成立**。
  // ⚠️ **代價照實寫**:最壞情況會留下一顆沒關乾淨的 chromium, 由 vitest 退出時收。
  //    我**沒有量過**那種情況實際會不會留下孤兒行程 ⇒ 那是這個取捨裡未確認的一格。
  await Promise.race([
    browser?.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}, 30_000);

describe('客人明細列印頁 · 串接量測(真 chromium + 編譯後 CSS + 列印媒體)', () => {
  it('🔴 分母:六個被量的節點都在(少一個的話下面每一格都是 fallback)', () => {
    expect(print.denominator).toEqual({
      sheet: true, tabbar: true, info: true, items: true, totals: true, bottom: true, actions: true,
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

  it('🔴🔴 列印鈕不得印在紙上 —— 而這一格是【我弄壞過並且上線了】才補的', () => {
    // 🔴 成因:`.stmt-actions{display:none}` 原本與 R1 的補丁 `.stmt-actions + *{margin-top:0}`
    //    **住在同一個 `@media print` 區塊**;R3 判那條 `* + *` 前提是假的 ⇒ 我刪掉它與它的補丁
    //    ⇒ **那條不相干的、真正在做事的規則一起走了。**
    // 📌 **而本檔當時全綠** —— 因為我造這把尺時量的是「R1/R2/R3 指名的那四格」,
    //    而這一格**在那之前就已經是對的**
    //    ⇒ ⇒ **沒有人會替一個【本來就對】的東西寫守門, 而它正是被我弄壞的那一個。**
    // 🛑 後果:Sean 在正式站的列印預覽上看到那顆框框(逐字「很奇怪」)—— 客人紙上的髒東西。
    expect(print.actionsDisplay, '那顆鈕會被印在紙上').toBe('none');
    // 🔴 另一半 —— 沒有它,「藏起來了」與「這個元素根本沒被渲染」印同一個結果。
    expect(screen.actionsDisplay, '螢幕上那顆鈕不見了 ⇒ 客人沒有東西可以按').toBe('flex');
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


// ══════════════════════════════════════════════════════════════════════════
// 片 B(2026-08-31)· 自 host 的中文字型有沒有真的進到編譯產物裡
//
// 🔴 **這一節【不開瀏覽器】,而它是被推翻兩次才變成這樣的 —— 兩次的理由都留著:**
//    ⛔ 我第一版寫成一整個 chromium describe(85 行,兩個世界比 computed font-family)。
//    · codex R2 要求「真瀏覽器兩世界守門要隨片 B 落地」⇒ 我照做了。
//    · codex R3 換角度看同一段 ⇒ 「它讓一支本來就脆的測試更脆(共用 `.next`、多開一個 chromium),
//      而**同一個突變可以用較便宜的編譯 CSS 斷言擋住**」。
//    ✅ 而我實跑之後同意 R3, 理由比他的更強一格:**那個瀏覽器斷言本來就沒有它看起來的判別力** ——
//      next/font 產出的家族名就叫 `Noto Sans TC`, **與 root layout 那條 Google CDN `<link>`
//      宣告的家族同名** ⇒ 傳不傳 `fontFamily`, 贏的都是「第一個叫 Noto Sans TC 的 face」
//      ⇒ 那一節唯一分得開的其實是**度量替身有沒有出現在字串裡**, 而那不是本片的承諾。
//    📌 **⇒ 一個開了真瀏覽器的測試, 看起來比它實際證得的多。**
//
// 🛑 **所以本節只證兩件【它真的證得了】的事**:
//    ① 那條 `var(--font-statement, …)` 還在編譯產物裡(突變殺得掉:拿掉它 ⇒ 這一格紅)
//    ② next/font 的 face **真的是自 host 的**(src 指向 `/_next/static/media/`, 不是 gstatic)
// 🔴 **證不了**「伺服器產 PDF 時字是我們這份畫的」—— 那要真 server + 攔網路,是**片 C** 的驗收:
//    2026-08-31 手動量過一次(正常 自家 0/Google 17 ⇒ 擋掉 Google 後 自家 15/Google 0),
//    **而那一發沒有被自動化。**
describe('片 B:自 host 字型在編譯產物裡(不開瀏覽器)', () => {
  it('① `--font-statement` 那條變數還在編譯後的 statement CSS 裡', () => {
    expect(compiledCss('.stmt-page')).toContain('var(--font-statement');
  });

  // 🔴 標題**刻意不寫「本尊」** —— codex R5 抓到我上一版寫「Noto Sans TC 本尊」,
  //    而本格只證得了【CSS 上被標成那個家族名】+【URL 指向本站】+【檔案在磁碟上】;
  //    **它沒有打開那些 woff2 去確認裡面真的是 Noto**(那要解字型的 name 表)。
  //    📌 這正是本 repo 記過的「標題比斷言寬」—— 而寬掉的那一格會被下一個人當成驗過了。
  it('② 被標為 Noto Sans TC 的那些 face:兩個字重都在、src 指向本站、檔案在磁碟上', () => {
    // 🔴 這一格被 codex R4 打回過一次:我第一版只驗「同一支 chunk 裡有相對 URL」——
    //    **那沒有把 URL 綁到 Noto 那個 face 上**(同一支 chunk 裡還住著度量替身),
    //    也沒有驗字重、沒有驗檔案真的存在。⇒ 現在逐個 face 解析。
    const fontCss = compiledCss('Noto Sans TC Fallback');
    const faces = [...fontCss.matchAll(/@font-face\{(.*?)\}/gs)].map((m) => m[1] ?? '');
    // 🔴 分母:先證解析器抓得到東西, 否則下面每一條都會在一個空陣列上恆真。
    expect(faces.length).toBeGreaterThan(50);

    // 命名:`labelledNoto` 而不是 `noto` —— 它是「被標成那個名字的」, 不是「經過驗證的那個字型」。
    const labelledNoto = faces.filter((f) => /font-family:Noto Sans TC;/.test(f));
    // 🔴 這條正規式**刻意帶結尾分號** —— 不帶的話 `Noto Sans TC Fallback` 也會被算進來,
    //    而那正是本格要排除的那一個。負對照見下面 `fallbackOnly`。
    const fallbackOnly = faces.filter((f) => /font-family:Noto Sans TC Fallback/.test(f));
    expect(fallbackOnly.length).toBe(1);
    expect(labelledNoto.length).toBeGreaterThan(50);
    expect(labelledNoto).not.toContain(fallbackOnly[0]);

    // 兩個字重都要有(`page.tsx` 要的是 400 + 700;紙上有 22 條 font-weight:700)
    for (const w of ['400', '700']) {
      expect(labelledNoto.filter((f) => f.includes(`font-weight:${w};`)).length).toBeGreaterThan(50);
    }

    // 每一個 Noto face 的 src 都要是相對的 `../media/…`, 而且那個檔要真的在磁碟上。
    // 🔴 `../media/` 是**開編譯產物抄的**:`/_next/static/media/` 那個絕對形式只出現在 dev
    //    ——我第一版照 dev 寫 ⇒ 紅 ⇒ 那個紅是我的期望值錯, 不是產品壞了。
    const urls = labelledNoto.map((f) => /src:url\(([^)]+)\)/.exec(f)?.[1] ?? '');
    expect(urls.every((u) => u.startsWith('../media/'))).toBe(true);
    expect(fontCss).not.toContain('fonts.gstatic.com');
    for (const u of urls) {
      const onDisk = join(CHUNKS, u);
      expect(existsSync(onDisk), `編譯產物指到一個不存在的字型檔:${u}`).toBe(true);
    }
  });

  it('負對照:現造的字串必須查無(證明 compiledCss 不是恆真)', () => {
    expect(() => compiledCss('zzq-not-a-real-marker-9137')).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 片 C2(2026-08-31)· 組出來的那份自足 HTML,在【真瀏覽器 + 零網路】下畫得對嗎
//
// 🔴 主視窗 `-2d [16689c]` 逐字要的那一格:「正式的那一發要【自動化】——
//    你現在那發是手動的, 手動的不會在下一個人改壞時說話」。這一節就是那一發。
//
// 🛑 **它證得了什麼**:
//    ① 內嵌的 `data:` 字型**真的被 Chrome 用來畫中文**(兩個世界比, 不是看畫面)
//    ② 整個過程**對外網路請求 = 0** —— 那是設計 B 的核心承諾, 不是附帶
//    ③ 子集挑選在**真資料**上真的有挑(內嵌數 < 全部 face 數)
// 🔴 **證不了**:Vercel 容器上跑得起來 / 冷啟動多久 / 部署多大 —— 那三格要真部署(C1/C3)。
describe('片 C2:自足 HTML 在真瀏覽器 + 零網路下畫得對', () => {
  let b: Browser;
  let withFonts: { fonts: string[]; net: number };
  let noFonts: { fonts: string[]; net: number };
  let built: ReturnType<typeof buildStatementHtml>;
  let totalFaces = 0;

  beforeAll(async () => {
    // 🔴 **餵給它的東西必須與那條 route 餵的【是同一批】** ——
    //    ⛔ 第一版這裡讀 `.next/static/` 的編譯產物, 而 route 後來改成讀
    //       `src/styles/*.css` + `@fontsource/noto-sans-tc`(理由:前者在 Vercel 上打包不進去)。
    //    ⇒ 兩邊不同步的話, **這一節會替一條不存在的路徑背書**。
    const styles = join(REPO, 'apps/storefront/src/styles');
    const pageCss = [
      readFileSync(join(styles, 'print-a4.css'), 'utf8'),
      readFileSync(join(styles, 'statement.css'), 'utf8'),
    ].join('\n');
    const fontPkg = dirname(
      createRequire(join(REPO, 'apps/storefront/package.json')).resolve(
        '@fontsource/noto-sans-tc/package.json',
      ),
    );
    const fontCss = ['400.css', '700.css']
      .map((f) => readFileSync(join(fontPkg, f), 'utf8'))
      .join('\n');
    totalFaces = parseFontFaces(fontCss).length;
    const bodyHtml = renderToStaticMarkup(<StatementDoc order={ORDER} />);
    const readFont = (rel: string) => {
      const p = resolve(fontPkg, rel);
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    };
    built = buildStatementHtml({ bodyHtml, pageCss, fontCss, readFont });
    const stripped = buildStatementHtml({ bodyHtml, pageCss, fontCss, readFont: () => null });

    b = await chromium.launch();
    const read = async (html: string) => {
      const p = await b.newPage();
      const net: string[] = [];
      p.on('request', (r) => {
        if (!r.url().startsWith('about:')) net.push(r.url());
      });
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      await p.setContent(html, { waitUntil: 'load' });
      await p.evaluate(() => document.fonts.ready);
      await p.emulateMedia({ media: 'print' });
      const { root } = await cdp.send('DOM.getDocument');
      // 🔴 量法換過兩次, 兩次的理由都留著 —— 它們是同一個坑的兩面:
      //    ⛔ 第一版量 `.pd-doctitle h1` ⇒ 那顆吃 `--pd-disp`, 而那條堆疊把
      //       `'Helvetica Neue','Helvetica','PingFang TC'` 排在我們前面
      //       ⇒ **在 macOS 上兩個世界都印 `PingFang TC:4`** ⇒ 零判別力。
      //    ⛔ 第二版量 `[data-slot="statement-doc"]` 這個**容器** ⇒ CDP 回**空陣列**
      //       (它只答有直接文字的節點)⇒ `length > 0` 那一格當場紅。
      //    ✅ 現在:掃整棵樹的元素, 把每個節點用到的字型**聯集**起來。
      //    📌 兩次都是「我挑的那一個點, 剛好答不出那個問題」——而第一次它**印了一個看起來正常的值**。
      const all = await cdp.send('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: '[data-slot="statement-doc"] *',
      });
      // 🔴 分母:掃到的節點數。0 ⇒ 下面的聯集必然是空的, 而空會被讀成「沒用到 Noto」。
      if (all.nodeIds.length < 20) {
        throw new Error(`只掃到 ${all.nodeIds.length} 個節點 ⇒ 量具失效(不是產品壞了)`);
      }
      // 🔴 **逐節點【加總】glyphCount, 不可以先用 Set 去重**(codex R2 抓到):
      //    去重的話 `Noto:80` 與另一個節點的 `Noto:80` 會塌成一筆
      //    ⇒ 後面那個「加起來 > 50」的門檻**可以被單一節點跨過**
      //    ⇒ 那就退回成「有沒有出現」, 而那正是 R1 說不夠的那一格。
      const totals = new Map<string, number>();
      for (const id of all.nodeIds) {
        const r = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id });
        for (const f of r.fonts) totals.set(f.familyName, (totals.get(f.familyName) ?? 0) + f.glyphCount);
      }
      const fonts = [...totals].map(([fam, n]) => `${fam}:${n}`);
      await p.close();
      return { fonts, net: net.length };
    };
    withFonts = await read(built.html);
    noFonts = await read(stripped.html);
  }, 90_000);

  // 🔴🔴 **這一段是把【同一支檔 `:198` 已經寫好的修法】套到第二個 `afterAll` 上。**
  //    2026-08-31 實測:全 repo 跑 6 發, 這支檔紅 2 發, 形狀是
  //    `Hook timed out in 10000ms` 指到本 hook ⇒ **檔級紅而 0 格紅**
  //    (`Test Files 1 failed` 而 `Tests` 那行全過 —— 鐵則 11 點名的那一種)。
  //
  // 🛑 **⇒ 而我第一個想到的修法是錯的, 而【這支檔自己在 234 行之上就否證了它】**:
  //    `:201` 逐字寫著「給 `afterAll` 30s ⇒ **仍然逾時**(`Hook timed out in 30000ms`)」
  //    ⇒ 📌 **「再給它更大的數字」在這裡已經被試過而且失敗過。**
  //    ⇒ ⇒ 而 `:202` 也寫出了為什麼:**一個關瀏覽器的動作超過 30 秒不是它慢,
  //         是機器被吃光了**(八個施工窗並行 + 同時有人在 build)。
  //
  // 📌 **⇒ 這支檔有兩個 `afterAll`, 而只有第一個拿到了那個修法。**
  //    🔴 **而修法與它的完整理由【就寫在同一支檔裡】—— 少的不是知識, 是【它沒有被套到第二處】。**
  //    ⇒ 那與 `print-a4.css` 那一格是同一個病:兩個命中在同一支檔, 而只有一個是現況。
  //
  // ✅ 照 `:210-215` 的做法:**夾住, 不是加大**。10 秒關不掉就放手, 而**不讓收尾把整支檔判紅** ——
  //    這一步是收尾, 它失敗**不代表任何一條斷言不成立**。
  // ⚠️ **代價照抄那邊寫的, 不重新發明**:最壞情況留下一顆沒關乾淨的 chromium, 由 vitest 退出時收;
  //    那邊逐字寫著「我**沒有量過**那種情況實際會不會留下孤兒行程 ⇒ 那是這個取捨裡未確認的一格」
  //    ⇒ **本處同樣未確認, 不因為抄過來就變成驗過。**
  afterAll(async () => {
    await Promise.race([
      b?.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }, 30_000);

  it('✅ 內嵌的 data 字型真的被拿去畫中文;拿掉就沒有(兩個世界)', () => {
    const hasNoto = (fs: string[]) => fs.some((f) => f.startsWith('Noto Sans TC'));
    expect(withFonts.fonts.length).toBeGreaterThan(0);
    expect(noFonts.fonts.length).toBeGreaterThan(0);
    // 🔴 這一格成立有一個前提, 而它是量過的:**這台機器沒有裝 Noto Sans TC**
    //    (`fc-list | grep -ci 'noto sans tc'` ⇒ 0, 而 `pingfang` ⇒ 36 證明那把尺會動)
    //    ⇒ 世界 A 印得出 Noto, 就只可能是從那串 data URI 來的。
    expect(hasNoto(withFonts.fonts)).toBe(true);
    expect(hasNoto(noFonts.fonts)).toBe(false);
    // 🔴 **只問「有沒有出現」不夠**(codex R1):任一個節點用到 Noto 就會過,
    //    而其他中文字全部 fallback / 豆腐仍然全綠。⇒ 加一個【量】的門檻。
    const notoGlyphs = withFonts.fonts
      .filter((f) => f.startsWith('Noto Sans TC'))
      .reduce((n, f) => n + Number(f.split(':').pop() ?? 0), 0);
    expect(notoGlyphs).toBeGreaterThan(50);
  });

  it('🔴 對外網路請求 = 0(兩個世界都是)—— 這是設計 B 的核心承諾', () => {
    expect(withFonts.net).toBe(0);
    expect(noFonts.net).toBe(0);
  });

  // 🔴 標題改過(codex R1:「而且沒有漏字」超出斷言能力)——
  //    `uncovered` 讀的是 CSS 上的 `unicode-range` **宣告**, 不是字型檔裡真的有那個字。
  it('✅ 子集挑選在真資料上真的有挑, 而且沒有【宣告層】的缺口', () => {
    expect(totalFaces).toBeGreaterThan(50);
    expect(built.embedded).toBeGreaterThan(0);
    // 有挑 = 內嵌的比全部少。相等 ⇒ 挑選那段是死的。
    expect(built.embedded).toBeLessThan(totalFaces);
    // 🔴 拿不到檔的必須是 0;而「沒有任何 face 【宣告】涵蓋的字」也必須是空。
    //    🛑 後者**不等於**「沒有字會豆腐」—— 宣告涵蓋 ≠ 字型檔裡真的有那個字形
    //       (codex R2 第二次抓同一個過寬:我改了標題卻沒改這一行)。
    expect(built.skippedMissing).toBe(0);
    expect(built.uncovered).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 片 C(2026-09-05 `⟦b4-TAXSURFACES⟧` 第 7 步)· **稅額那一列會不會把頁尾擠掉**
//
// 🔴🔴 **這一段是 codex R3 must-fix 2 逼出來的, 而它抓到的是【整個維度】不是某一格**:
//    本片其餘所有測試問的都是「**渲染出來的字串裡有什麼**」——
//    而客人拿到的是**一張紙**, 而紙會擠壓、會換頁、會把頁尾推下去。
//    ⇒ 📌 「字出現在 HTML 裡」與「客人拿到一份印得正常的文件」是**兩個宣稱**,
//       而這支檔上面每一格都只答了前一個(它們量的是 tax = 0 的那個世界)。
//
// 🛑 **本段只答一個問題**:多了那一列之後, **頁尾還貼不貼紙底**。
//    ⚠️ 它**不答**「換頁」「溢出到第二張」—— 那需要多品項的樣本, 而本段沒有造。**已知缺口, 照實寫。**
describe('片 C · 稅額那一列與頁尾(真 chromium · 列印媒體)', () => {
  let browserC: Browser;
  let taxedMm = -1;
  let zeroMm = -1;
  let overflowMm = -1;
  let zeroHasRow = true;   // 🔴 預設【相反】於期望值 —— 沒被賦值時那一格會紅, 不會靜靜通過
  let taxedHasRow = false;

  beforeAll(async () => {
    const layoutCss = compiledCss('.mobile-tabbar-btn');
    const pageCss = compiledCss('.stmt-page');
    browserC = await chromium.launch();

    // 🔴 有稅那份**必須平衡**:18000 + 100 − 0 + 905 = 19005。
    //    不平衡的單正式庫寫不進去 ⇒ 拿它量版面等於量一個不存在的世界。
    const taxedOrder = {
      ...ORDER,
      taxTotal: twd(905),
      total: twd(19005),
    } as MemberOrderDetail;

    const measure = async (order: MemberOrderDetail): Promise<{ mm: number; hasTaxRow: boolean }> => {
      const page = await browserC.newPage();
      await page.setContent(
        `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">` +
          `<style>${layoutCss}</style><style>${pageCss}</style></head>` +
          `<body>${renderToStaticMarkup(<StatementDoc order={order} />)}</body></html>`,
      );
      await page.emulateMedia({ media: 'print' });
      return page.evaluate(() => {
        const hasTaxRow = Array.from(document.querySelectorAll('.pd-money td.k')).some(
          (el) => el.textContent === '稅額',
        );
        const sheet = document.querySelector('.stmt-page');
        if (sheet === null) return { mm: -1, hasTaxRow }; // 🔴 分母:節點不在就回 -1, 不回 0
        // 🔴🔴 **量的是【紙有多高】, 不是「頁尾貼不貼底」。**
        //    ⛔ 我第一版量 `sheet.bottom − pdBottom.bottom` 並宣稱它守「頁尾被擠掉」——
        //       而**負對照當場打穿它**:餵一份 60 個品項的單, 它**照樣印 0**。
        //    🎯 成因:`.pd-bottom` 是 `margin-top:auto`, 而紙會跟著內容長高
        //       ⇒ 頁尾**永遠**在紙的底部 ⇒ 那個 0 是恆真的, 它什麼都沒守。
        //    ✅ 真正會變的量是**紙本身的高度** —— 超過一頁 A4 就是換頁。
        return { mm: Math.round((sheet.getBoundingClientRect().height / 96) * 25.4), hasTaxRow };
      });
    };

    ({ mm: zeroMm, hasTaxRow: zeroHasRow } = await measure(ORDER as MemberOrderDetail));
    ({ mm: taxedMm, hasTaxRow: taxedHasRow } = await measure(taxedOrder));

    // 🔴🔴 **負對照:這把尺印得出【不是 0】嗎?**
    //    上面兩格都印 0, 而**一把只印過一種值的尺是零證據** ——
    //    「頁尾貼底」與「這個量法根本恆為 0」在報表上長得一樣。
    //    ⇒ 餵一份**塞爆的單**(把品項複製到遠超一頁), 它必須印出非 0。
    ({ mm: overflowMm } = await measure({
      ...ORDER,
      items: Array.from({ length: 60 }, (_, i) => ({ ...ORDER.items[0]!, id: `of${i}` })),
      itemCount: 60,
    } as MemberOrderDetail));
  }, 90_000);

  afterAll(async () => {
    await browserC?.close();
  }, 60_000);

  it('🔴 分母:三個世界都真的量到了(節點不在會回 -1)', () => {
    for (const v of [zeroMm, taxedMm, overflowMm]) expect(v).toBeGreaterThan(0);
  });

  it('🟢 負對照:塞爆的單【紙會變高】—— 證明這把尺不是恆定值', () => {
    // 🛑 少了這一格, 下面那兩格的「沒超過一頁」與「這個量法根本不動」印同一個東西。
    // 🔴 而這一格是**打穿我上一版量法的那一發**:原本量「頁尾貼不貼紙底」,
    //    餵 60 個品項照樣印 0 ⇒ 那把尺恆真。**換成量紙高之後它才會動。**
    expect(overflowMm).toBeGreaterThan(zeroMm);
  });

  it('🔴🔴 多了稅額那一列, 紙【沒有】被推過一頁 A4(297mm)', () => {
    // 🎯 這一格是本段存在的理由:金額表多一列 ⇒ 內容變高 ⇒ 有可能溢到第二張紙。
    //    折扣那一列早就是同一種形狀(有折扣才印)而**從來沒有人在真媒體上量過它**
    //    ⇒ 📌 本格順帶把那個缺口一起關掉。
    expect(taxedMm).toBeLessThanOrEqual(297);
    // 🔵 而稅 0 那份也要在一頁內(前提:這把尺在【已知正確】的世界上讀得對)
    expect(zeroMm).toBeLessThanOrEqual(297);
  });

  it('🔵 而那一列【真的被渲染出來了】—— 否則上一格是拿一個空的世界在慶祝', () => {
    // 🛑 少了這一格,「稅額列沒有被渲染」與「它被渲染了而沒撐爆」印同一個綠。
    // 🔴🔴 **而這一格【不能】用「紙有沒有變高」來問** —— 實測打穿過:
    //    兩個世界的紙都是 **250mm**(`.stmt-page` 有固定高度, 而內容還有餘裕)
    //    ⇒ 多一列**不會**讓它變高 ⇒ 那個相等是對的, 不是缺陷。
    //    📌 而 60 個品項那一發**會**把它撐過 250 ⇒ 這把尺仍然會動, 只是它答的是
    //       「有沒有溢出」不是「有沒有多一列」。⇒ **兩個問題要用兩把尺。**
    expect(taxedHasRow).toBe(true);
    expect(zeroHasRow).toBe(false); // 🔵 對照:稅 0 的那份不得有那一列
  });

});

// ══════════════════════════════════════════════════════════════════════════
// 片 D(2026-09-05)· **多品項 + 有稅**:金額表會不會被切到第二頁
//
// 🔴🔴 **這一段是【找到一個既有缺陷】的地方, 不只是守本片的改動。**
//    量到的(真 chromium, 列印媒體, 真 `page.pdf({format:'A4'})`):
//      品項數  稅    紙高      金額表 [top, bottom]      PDF 頁數
//        3     0    250mm     [214.7, 250]                1
//        3    905   250mm     [207.7, 250]                1
//       12     0    293.1mm   [257.7, 293.1]              2
//       12    905   300.1mm   [257.7, 300.1]              2
//       20     0    392.7mm   [357.4, 392.7]              2
//       30     0    517.3mm   [482,   517.3]              2
//
//    🔴 **每頁內容高 = 297 − 12(上) − 14(下) = 271mm**(`@page` 邊距被
//       `print-a4-css.test.ts` 釘死)。
//    ⇒ 🛑 **12 個品項那一列:`257.7 < 271 < 293.1` ⇒ 金額表【跨過分頁線】** ——
//       客人拿到的紙上, 小計在第一頁而總額在第二頁。
//    ⇒ 📌 **而這在【今天、沒有稅】的世界就已經成立** —— 不是本片造成的。
//       本片做的是讓那一塊**再高 7mm**(多一列)⇒ 它讓這件事更容易發生, 而不是開始發生。
//
//    🔬 成因(讀 CSS 讀出來的):`print-a4.css` 只給 `tr` 與 `.pd-blocker` 下了
//       `break-inside: avoid`;**`.pd-bottom` / `.pd-money` 一條都沒有**
//       ⇒ 那一塊可以在任意兩列之間被切開。
//
// 🛑 **本片【不修它】, 而理由不是我懶**:修法是給 `.pd-bottom` 加 `break-inside: avoid`,
//    而那會把整塊金額表推到第二頁 ⇒ **第一頁下半變成空白** ⇒ 那是**版面的取捨, 要 Sean 看**。
//    ⇒ 已記板, 且**下面沒有一格假裝它不存在**。
describe('片 D · 多品項 + 有稅:金額表與分頁(真 chromium + 真 PDF)', () => {
  let browserD: Browser;
  type Geo = { sheetMm: number; topMm: number; botMm: number; pdfPages: number };
  const got: Record<string, Geo> = {};

  /** 🔴 每頁內容高。它不是我挑的:A4 297 − `@page` 上 12 − 下 14。 */
  const PAGE_CONTENT_MM = 271;

  beforeAll(async () => {
    const layoutCss = compiledCss('.mobile-tabbar-btn');
    const pageCss = compiledCss('.stmt-page');
    browserD = await chromium.launch();

    // 🔴 有稅的樣本**必須平衡**:18000 + 100 − 0 + tax = total。
    const mk = (n: number, tax: number) =>
      ({
        ...ORDER,
        items: Array.from({ length: n }, (_, i) => ({ ...ORDER.items[0]!, id: `d${i}` })),
        itemCount: n,
        taxTotal: twd(tax),
        total: twd(18000 + 100 + tax),
      }) as MemberOrderDetail;

    for (const [n, tax] of [
      [3, 0],
      [3, 905],
      [12, 0],
      [12, 905],
    ] as const) {
      const page = await browserD.newPage();
      await page.setContent(
        `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">` +
          `<style>${layoutCss}</style><style>${pageCss}</style></head>` +
          `<body>${renderToStaticMarkup(<StatementDoc order={mk(n, tax)} />)}</body></html>`,
      );
      await page.emulateMedia({ media: 'print' });
      const g = await page.evaluate(() => {
        const mm = (px: number) => Math.round((px / 96) * 25.4 * 10) / 10;
        const sheet = document.querySelector('.stmt-page');
        const bot = document.querySelector('.pd-bottom');
        if (sheet === null || bot === null) return { sheetMm: -1, topMm: -1, botMm: -1 };
        const s = sheet.getBoundingClientRect();
        const b = bot.getBoundingClientRect();
        return { sheetMm: mm(s.height), topMm: mm(b.top - s.top), botMm: mm(b.bottom - s.top) };
      });
      // 🔴 **真的產一份 PDF 來數頁** —— 不是從高度推的。
      //    數法:PDF 裡的 `/Type /Page`(後面不接 `s`, 避開 `/Pages`)。
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      got[`${n}-${tax}`] = { ...g, pdfPages };
      await page.close();
    }
  }, 120_000);

  afterAll(async () => {
    await browserD?.close();
  }, 60_000);

  it('🔴 分母:四個世界都量到了(節點不在會回 -1)', () => {
    for (const k of ['3-0', '3-905', '12-0', '12-905']) {
      expect(got[k]!.sheetMm).toBeGreaterThan(0);
      expect(got[k]!.pdfPages).toBeGreaterThan(0);
    }
  });

  it('🔵 少品項(3 件):有稅 / 無稅都還是【一頁】, 而稅額列沒有把它推成兩頁', () => {
    expect(got['3-0']!.pdfPages).toBe(1);
    expect(got['3-905']!.pdfPages).toBe(1);
  });

  it('🔴 而稅額列【確實讓那一塊變高了】—— 否則上一格是拿一個沒發生的改動在慶祝', () => {
    // 3 件那一組:紙高不變(250mm 有餘裕), 而金額表的**頂端往上跑了 7mm**。
    expect(got['3-905']!.topMm).toBeLessThan(got['3-0']!.topMm);
    expect(got['3-0']!.topMm - got['3-905']!.topMm).toBeGreaterThanOrEqual(5);
  });

  it('🟢 負對照:12 件會變成【兩頁】—— 證明這把數頁的尺不是恆為 1', () => {
    expect(got['12-0']!.pdfPages).toBe(2);
    expect(got['12-905']!.pdfPages).toBe(2);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 **這裡【曾經】有一格斷言「金額表跨過分頁線 = 既有缺陷」。它是錯的, 已刪。**
  //
  // ⛔ ~~我的斷言~~:`.pd-bottom` 的 DOM 盒子是 `[257.7, 293.1]`, 每頁內容高 271mm
  //    ⇒ `257.7 < 271 < 293.1` ⇒ 「它跨線」⇒ 「客人紙上小計在第一頁、總額在第二頁」。
  //    我還照這個結論開了板列 `⟦b4-MONEYSPLIT⟧`, 而主視窗把它排進了要給 Sean 的佇列。
  //
  // 🔴 **中間少了一步, 而那一步是整個結論的樞紐**:
  //    **DOM 盒子跨過那條線 ≠ chromium 真的在那裡把它切開。**
  //    瀏覽器會把整塊往下推(`tr{break-inside:avoid}` + `.pd-bottom{margin-top:auto}` 的實際行為)。
  //
  // 🔵 **打穿它的是真 PDF 的逐頁文字**(2026-09-05, `pdftotext -f N -l N`, 12 品項 + 稅 905):
  //      第 1 頁尾 ⇒ 「品項合計 / 共 12 項 / 第1頁/共2頁」
  //      第 2 頁   ⇒ 「金額 新臺幣 / 小計(未稅) 運費 稅額 / 訂單金額 / 18,000 100 905」
  //    ⇒ ✅ **金額表完整落在第二頁, 一刀都沒被切。**
  //    🔵 順帶證偽兩種「修法」:`.pd-bottom{break-inside:avoid}` 與 `.pd-money{break-inside:avoid}`
  //       產出的 PDF **byte 完全相同**(sha `c53b63e8…`), 而它們與現況的文字分佈**也一樣**
  //       ⇒ 那個「要 Sean 選版面」的題目根本不成立。
  //
  // 📌 **⇒ 教訓, 而它不是「要更仔細」**:我把一個【幾何讀數】直接當成【紙上的事實】,
  //    而中間那一步我沒有量。**而它往「有缺陷」那一側錯 —— 那一側沒有人會質疑,
  //    因為照著一個嚇人的結論行動看起來很盡責。**
  //
  // 🛑 **為什麼這裡【沒有】補一格新斷言**:要驗「有沒有被切開」只能讀真 PDF 的逐頁文字,
  //    而那需要 `pdftotext`(外部二進位)。**把一個外部相依塞進 repo 測試不是我可以自己拍的**
  //    ⇒ 留成註解 + 樣張 `~/pcm-mailbox/樣張-金額表跨頁-證偽-現況就是對的.pdf`。
  //    ⚠️ **而這代表「將來有人改壞它時不會有東西紅」** —— 已知缺口, 寫在這裡不藏。
  // ══════════════════════════════════════════════════════════════════════
});
