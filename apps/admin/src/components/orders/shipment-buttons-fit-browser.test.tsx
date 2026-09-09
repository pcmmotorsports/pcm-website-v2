// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 真元件間接載入 `server-only` ⇒ 逐檔 mock(同 `orders-column-fit-browser.test.tsx`)。
vi.mock('server-only', () => ({}));
const { loadOrderShipments, loadEmptyShipments } = vi.hoisted(() => ({
  loadOrderShipments: vi.fn(),
  loadEmptyShipments: vi.fn(),
}));
vi.mock('../../lib/shipping/order-shipments', () => ({ loadOrderShipments, loadEmptyShipments }));
// 🔴🔴 **只換掉 `next/navigation`, 不換掉那幾顆鈕本身 —— 這一格是本檔的判別力所在。**
//    那一排裡有四顆是 client island(`useRouter`), 而 `renderToStaticMarkup` 沒有 Next 的 app context。
//    ⛔ **最省事的做法是把它們整支 mock 成 `<button>替身</button>`** —— 而那會讓本檔
//      量到一排**我自己畫的鈕**, 不是員工看到的那一排。
//      📌 本 repo 記過這個坑(`page-measure.test.tsx` 檔頭:「那份重製忠實到連 Sean 都認得,
//         而【像不代表是同一份】」)。
//    ✅ 所以只把 router 換成 stub, **每一顆鈕都是真的元件、真的 class、真的字**。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));
import { renderToStaticMarkup } from 'react-dom/server';
import { requireFreshBuild } from '@/lib/build-stamp';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
// 🔴 起伺服器 + goto **走共用那支** —— 它裡面有「連線層空回應重試一次(而且會印一行)」。
//    理由與四條紀律在 `serve-html-and-visit.ts` 檔頭(2026-09-06 39b 收割鏈實撞)。
import { serveHtmlAndVisit } from '@/lib/test-support/serve-html-and-visit';
import type { AdminOrderDetail } from '@pcm/domain';
import { ShipmentSection } from './shipment-section';

// ⟦ship-HCTLABELCAPTURE⟧ 片 D3 的**窄畫面**守門(`Q-標籤11` 主視窗 2026-09-06 裁乙)。
//
// 🔴🔴 **它為什麼存在**:jsdom 那幾格答得出「鈕在不在」, **答不出「它有沒有把別人擠出去」**。
//    而我剛往那一排加了第五顆鈕(當場量:390px 下 **5 顆**, `scrollWidth 354 / clientWidth 354`)。
//
// ⛔🔴 **而我援引的病史【引錯排了】—— 這一段是訂正, 不要刪**:
//    我在 plan 與派工往返裡都寫「`HANDOFF-orders-ui.md:364` 記過**這一排**在 390px 會擠出去」。
//    ✅ 開檔核對之後:那一條逐字是 `[data-od-id="panel-header"] .flex-nowrap`
//      ——「**抬頭那排**在 390px 會把『列印揀貨單』推出畫面」⇒ 那是**訂單面板的抬頭列**,
//      **不是**本檔量的這一排(包裹卡的抬頭列)。**兩排不同, 內容也不同。**
//    ⇒ 📌 我拿一條真的病史, 貼到了一個它沒有涵蓋的地方 —— 而那個引用讀起來完全合理。
//
// 🛑🛑 **這把尺【殺不掉】哪個突變 —— 量過才寫**:
//    把這一排的 `flex-wrap` 拿掉(= 那條病史的修法本身)⇒ **兩把尺在 390px 都仍然綠。**
//    成因:沒有 wrap 時 flex 會**壓縮**元素而不是溢出, 而這一排的內容在 390px 下**壓得下**。
//    ⇒ ✅ 它殺得掉的是「**某一顆真的變太寬**」(負對照那格證的就是這個);
//      ❌ 它殺不掉「wrap 被拿掉」。**兩者不要混為一談。**
//    ⇒ 📌 所以本檔買到的是**一道會隨內容長大而生效的閘**, 不是「那條病史不會復發」的保證。
//
// ⚠️ **射程**:量的是 **playwright 的 chromium + `.next` 的編譯後 CSS**,
//    不是員工那台機器的瀏覽器與字型。它答得出「排版邏輯會不會溢出」,
//    **答不出「Sean 用他的手機看起來好不好」** —— 後者要他自己看。
let browser: Browser;
let compiledCss: string;

/** 掃 `.next` 找編譯後的 CSS —— **找不到就紅、不 skip**(同族既有做法)。 */
function findCompiledCss(): string {
  // 🔴 先問戳記再走 `.next`:`next build` 可以 rc=1 而照樣寫出產物
  //    ⇒「產物存在」在【成功】與【失敗但寫了一半】兩個世界印同一個綠。
  requireFreshBuild();
  const hits: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full, depth + 1);
      else if (name.endsWith('.css')) {
        const text = readFileSync(full, 'utf8');
        if (text.includes('.orders-grid')) hits.push(text);
      }
    }
  };
  walk(join(__dirname, '../../../.next'), 0);
  if (hits.length === 0) {
    throw new Error(
      '找不到編譯後的 admin CSS ⇒ 本檔沒有判別力, 判紅不判 skip。先跑 `TURBO_FORCE=1 pnpm build`。',
    );
  }
  return hits.join('\n');
}

// 🔴 **這兩個 hook 要帶時限, 而【全族其他每一支都帶了 120_000, 只有本檔沒有】**
//    (2026-09-06 當場量:cancel-forms-browser / cancel-forms-hydrated / order-toolbar /
//     orders-column-fit / orders-status-visibility 全部 `120_000 120_000`, 本檔 `DEFAULT10s`)。
//    🔬 **而它不是潔癖 —— 它今天真的紅過**:族連跑兩發, **第一發本檔 `Hook timed out in 10000ms`**
//      而**零個測試紅**(Test Files 1 failed 而 Tests 110 passed)⇒ 掛在 `chromium.launch()` 上,
//      第二發全綠。⇒ 📌 **那正是本片在修的同一件事**:機器忙 ⇒ 紅在一個不是碼的原因上。
//    🛑 而 `beforeAll` 的預設時限是 10 秒, **它不會因為裡面要開一個瀏覽器就自己變長**。
beforeAll(async () => {
  compiledCss = findCompiledCss();
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
}, 120_000);

const detail = {
  id: 'o1',
  items: [{ id: 'oi-1', title: '鈦合金頭段' }],
  total: { amount: 5000 },
  shippingAddress: { name: '沈佑霖', phone: '0912345678', line: '台中市西屯區文心路二段 201 號' },
  shippingMethod: 'home',
} as unknown as AdminOrderDetail;

/**
 * 一箱【新竹 · 已送出 · 已出貨 · 未作廢】—— **含新鈕的那個世界裡最多顆**的組合。
 * ⛔ ~~原本寫「那一排鈕最多顆的那個世界」~~(code-reviewer 2026-09-06 訂正)——
 *   **那句太寬**:`hctStatus:'unknown'` 那個世界會多渲染 `ShipmentHctUnknownNotice`
 *   ⇒ 那一排**可能更寬**, 而那個世界裡**沒有這顆新鈕**。
 *   ⇒ 📌 本檔要量的分母是「**加了新鈕之後**那一排有多擠」, 不是「那一排的歷史最寬值」。
 */
const worstBox = [
  {
    shipment: {
      id: 'sh-LBL1',
      shipmentReference: 'K7X2MP',
      customerUserId: 'cu-1',
      carrierCode: 'hct',
      carrierNote: null,
      trackingNumber: '223456789012',
      shippedAt: '2026-09-06T00:00:00Z',
      voidedAt: null,
      voidReason: null,
    },
    lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }],
    hctStatus: 'submitted',
    hctPlaceholderStuck: false,
  },
];

type Fit = { text: string; right: number; containerRight: number; over: number };
/** 那一排自己的溢出量 —— `scrollWidth - clientWidth`, **這才是 HANDOFF 當時用的那把尺**。 */
type RowFit = { scrollWidth: number; clientWidth: number; over: number };

// 🔴🔴 **我第一版的量法【量錯東西】, 而它全綠 —— 這一段是那次的墓碑**:
//    我原本只比「每一顆鈕的右緣 vs 容器右緣」。突變:把那一排的 `flex-wrap` 拿掉
//    (= `HANDOFF-orders-ui.md:364` 記載的那個病本身)⇒ **三格全綠, 一格都沒紅。**
//    成因:`flex` 沒有 wrap 時,元素會**被壓縮**而不是溢出容器
//    ⇒ 每一顆的右緣都還在容器裡, 而那一排已經擠壞了。
//    ✅ HANDOFF 當時用的是 `panel.scrollWidth 505 > clientWidth 380` —— **那把尺才量得到擠壓**。
//    ⇒ 📌 **兩把都留著**:`scrollWidth` 抓擠壓, 逐顆右緣抓真的跑出去。

/**
 * @param extraCss 量具自檢用:注入一條規則, 這把尺必須量得到它(負對照就靠它)。
 */
async function measureRow(width: number, extraCss = ''): Promise<{ els: Fit[]; rows: RowFit[] }> {
  loadOrderShipments.mockResolvedValue(worstBox);
  loadEmptyShipments.mockResolvedValue([]);
  const html = renderToStaticMarkup(
    await ShipmentSection({ detail, payments: { status: 'unreadable' } as never }),
  );
  const doc = `<html><head><style>${compiledCss}\n${extraCss}</style></head><body>${html}</body></html>`;
  return await serveHtmlAndVisit(
    browser,
    doc,
    async (page) =>
      await page.evaluate(() => {
      // 🔴🔴 **量之前先把 `<details>` 打開 —— 少了這一行, 本檔會安靜地變成零判別力。**
      //    2026-09-09 Sean 挑了摺疊版之後, 那幾顆鈕搬進「其他操作」的 `<details>` 裡
      //    ⇒ 收合狀態下它們**沒有版面** ⇒ `scrollWidth` 與 `clientWidth` 都是 0
      //    ⇒ 📌 **負對照那格當場紅了**(逐字 `expected 0 to be greater than 0`)——
      //      而它紅得好:它證明了「把某顆鈕撐寬」這件事本檔**已經看不見**。
      //    ⚠️ 如果當時我把負對照的期望值改掉讓它過, 正向那格會繼續全綠、
      //      而它量的是一排**根本沒有渲染的鈕** —— 那正是這個檔案最怕的形狀。
      //    ✅ 所以修的是**量法**不是期望值:員工要按到那幾顆鈕本來就得先展開,
      //      ⇒ 「展開之後會不會擠出去」才是這道閘現在該問的問題。
      //    🛑 **而它因此不再涵蓋「收合狀態下的寬度」** —— 收合時那一格只有一行
      //      「其他操作」, 沒有東西可以被擠出去。射程縮小了, 寫出來, 不假裝沒變。
      for (const d of Array.from(document.querySelectorAll('details'))) d.open = true;
      // 拿**元素自己的容器**當基準, 不是 viewport
      //    (溢出是相對於容器的;拿 viewport 比會漏掉「容器比 viewport 窄」那一種)。
      // ⚠️ **`li > div` 選到的比「那一排」多**(code-reviewer 2026-09-06):`<li>` 底下至少三個
      //    直接子 div(抬頭列 / 進度 chip 那排 / 卡片本體)⇒ 下面量的是**全部**, 不只鈕那一排。
      //    🔵 而那個方向是**更嚴不是更鬆** ⇒ 不改;寫在這裡是因為
      //    📌 讀「那一排」這三個字的人會以為分母只有一個, 而它是三個。
      const rows = Array.from(document.querySelectorAll('li > div'));
      const els: { text: string; right: number; containerRight: number; over: number }[] = [];
      const rowFits: { scrollWidth: number; clientWidth: number; over: number }[] = [];
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        rowFits.push({
          scrollWidth: row.scrollWidth,
          clientWidth: row.clientWidth,
          over: row.scrollWidth - row.clientWidth,
        });
        for (const el of Array.from(row.querySelectorAll('a,button'))) {
          const r = el.getBoundingClientRect();
          els.push({
            text: (el.textContent ?? '').trim(),
            right: r.right,
            containerRight: box.right,
            over: r.right - box.right,
          });
        }
      }
        return { els, rows: rowFits };
      }),
    { viewport: { width, height: 900 }, label: 'shipment-buttons-fit' },
  );
}

describe('片 D3:那一排鈕在 390px 不得把任何一顆推出容器', () => {
  it('分母:那一排真的畫出來了, 而且新鈕在裡面', async () => {
    const { els, rows } = await measureRow(390);
    expect(els.length, '一顆鈕都沒量到 ⇒ 下面那幾格是恆真的').toBeGreaterThan(0);
    expect(rows.length, '一排都沒量到 ⇒ 同上').toBeGreaterThan(0);
    expect(
      els.map((f) => f.text),
      '新鈕不在這一排裡 ⇒ 本檔量的不是我剛改的那個東西',
    ).toContain('列印託運標籤');
    // 🔵 **把餘裕印出來** —— 一格「沒有溢出」的綠, 與「離溢出還有多遠」是兩件事。
    //    下一個人往那一排再加一顆鈕之前, 這一行告訴他還剩多少。
    console.info(
      `[shipment-buttons-fit] 390px 那一排:${rows
        .map((r) => `scrollWidth ${r.scrollWidth} / clientWidth ${r.clientWidth}`)
        .join(' · ')};鈕 ${els.length} 顆`,
    );
  }, 60_000);

  it('390px:那一排沒有被擠到要捲動(scrollWidth 不超過 clientWidth)', async () => {
    const { rows } = await measureRow(390);
    const over = rows.filter((r) => r.over > 0.5); // 0.5px 容差:次像素捨入
    expect(
      over.map((r) => `scrollWidth ${r.scrollWidth} > clientWidth ${r.clientWidth}`),
      '這一排在 390px 被擠到要捲動了 —— 先去看那一排的 class 與最近加了什麼進去。' +
        '⚠️ 不要照 HANDOFF:364 去找:那條講的是【面板抬頭列】, 不是這一排(見檔頭訂正)。',
    ).toEqual([]);
  }, 60_000);

  it('390px:也沒有任何一顆鈕的右緣跑出容器(第二把尺, 抓另一種形狀)', async () => {
    const { els } = await measureRow(390);
    expect(els.filter((f) => f.over > 0.5).map((f) => `${f.text} 超出 ${f.over.toFixed(1)}px`)).toEqual([]);
  }, 60_000);

  // 🔴🔴 **負對照 —— 沒有它, 上面那兩格與「這把尺根本量不到溢出」印同一個綠。**
  it('負對照:把新鈕撐寬 ⇒ 兩把尺都要看見', async () => {
    const { els, rows } = await measureRow(
      390,
      'li > div a[href$="label.pdf"]{padding-left:600px !important}',
    );
    expect(rows.filter((r) => r.over > 0.5).length, 'scrollWidth 那把尺看不到 ⇒ 回來修量法').toBeGreaterThan(0);
    expect(els.filter((f) => f.over > 0.5).length, '逐顆那把尺看不到 ⇒ 回來修量法').toBeGreaterThan(0);
  }, 60_000);
});
