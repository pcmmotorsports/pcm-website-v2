// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 同 `orders-column-fit-browser.test.tsx`:真元件間接載入 `server-only` ⇒ 逐檔 mock。
vi.mock('server-only', () => ({}));
import { renderToStaticMarkup } from 'react-dom/server';
import { requireFreshBuild } from '@/lib/build-stamp';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
// 🔴 片4b:型別從 `AdminOrderPrintItem` 換成 `AdminOrderDetailFullItem` ——
//    元件的 `items` 加寬了(紙上要印金額)。**本檔兩個 fixture 本來就帶著 `unitPrice` /
//    `lineTotal` 的值**,只是 cast 成了窄型別 ⇒ 這是把 cast 對齊事實,不是補資料。
import type { AdminOrderDetail, AdminOrderDetailFullItem } from '@pcm/domain';
import { ShippingDoc } from './shipping-doc';

// print-doc-cascade-browser.test.tsx —— 出貨明細單的**串接量測**(真 chromium + 真編譯後 CSS)。
//
// 🔴🔴 **本檔存在的理由是一次真的失誤,而那次失誤【三綠與所有單測都是綠的】。**
//    片3 把 `.pd-items` 掛上 `<section>` 之後,`print-a4.css` 的 `.pd-items td{font-size:9pt}`
//    開始蓋掉元件的 Tailwind ⇒ **「一眼看到這次要出幾件」的設計意圖在紙上消失**,而
//    jsdom 單測不套外部 CSS、typecheck/lint/build 與樣式無關、紙沒有人印出來看過。
//
// ── 🔴🔴 **R2 打破了本檔的第一版,而打破它的那句話值得留在檔頭** ──────────────────
//    第一版的斷言集是**我列舉的**,而 `querySelector` **只取第一個命中** ——
//    `.pd-items` 有三個 section,所以它**永遠只量到「本次出貨」那一個**。
//    ⇒ 同款缺陷(裸 `.pd-num` 掛在 `td` 上)就住在沒被列舉的那個 section 裡,
//      **而量具 5 passed。它抓到了一個,然後證明了自己看不到第二個。**
//    ⇒ **本版的斷言集是【推導】的**:掃 DOM 裡**每一個** section / 每一列 / 每一格,
//      斷言的是**不變式**,不是我想得到的那幾個選擇器。
//    ⚠️ **而推導有它自己的失效模式:掃到空集合會【無聲通過】** ——
//      所以下面第一組是**分母守門**(section 數 / 列數 / 格數),它不過就沒有下面。
//
// 🔴 **量的是列印媒體**(`emulateMedia({media:'print'})`)。第一版跑在螢幕模式下 ——
//    一把「量紙」的尺跑在螢幕模式,而檔頭寫著「量最終 computed style」:**對螢幕為真、對紙為假。**
//
// 🔴 **CSS 取編譯產物、找不到就紅不 skip**:「沒有 CSS 所以跳過」與「CSS 正常所以通過」
//    在報表上長得一樣。訊息會叫你先跑 `TURBO_FORCE=1 pnpm build`。
// 📎 CI 跑得動:`.github/workflows/ci.yml:47` 裝 chromium、同檔 build admin、`:124` 跑 `pnpm test`。
//
// ⚠️ **已知限制(2026-08-23 量到,不是推的):本檔讀【共用的 `.next` 產物】** ——
//    別的視窗同時 `pnpm build` 時,它腳下的 CSS 會在兩次執行之間變掉。
//    實測:同一份原始碼**重 build 之後**對照組 1 failed,而**不 build 連跑 5 次全部 8 passed**。
//    ⇒ **本檔的紅要先問「剛剛有沒有人在 build」**,與 repo 既有的
//      「共用樹上的紅以單跑為準」同一族。**它不是不決定性的測試,是不決定性的【輸入】。**
//    🔴 **而在多窗夜跑時,那個問題的答案預設是【有】。**
//       (2026-08-23 線A 自陳:那一夜他自己跑了至少 5 次 `TURBO_FORCE=1 pnpm build`。)
//       ⇒ 先重跑一次;連續兩次同一格紅才當成真的。

function findCompiledCss(): string {
  // 🔴 R2 N1:只走 `.next`(`.next/static` 是它的子樹,分開走會撈到同一個檔兩次),並且**去重**。
  //    多 chunk 時勝負若由 `readdirSync` 順序決定,這把尺就是不決定性的。
  const hits = new Set<string>();
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
      // 🔴 認 `.pd-sech` 而不是 `@page`:`@page` 原始檔與產物都有,`.pd-sech` 只有紙面那份有。
      else if (name.endsWith('.css')) {
        const text = readFileSync(full, 'utf8');
        if (text.includes('.pd-sech')) hits.add(text);
      }
    }
  };
  // 🔴 **M2(2026-08-29):先問戳記,再走 `.next`。**
  //    `next build` 可以 **rc=1 而照樣寫出產物**(實測 28 個 chunk,時間戳為當次)
  //    ⇒ 「產物存在」在【成功】與【失敗但寫了一半】兩個世界印同一個綠。
  //    ⇒ 戳記分三態:無 / HEAD 不同(兩個 hash 都印)/ 相同。不 skip,只 throw。
  requireFreshBuild();
  walk(join(__dirname, '../../../.next'), 0);
  if (hits.size === 0) {
    throw new Error(
      '找不到含 .pd-sech 的編譯後 CSS ⇒ 本檔沒有判別力,判紅不判 skip。先跑 `TURBO_FORCE=1 pnpm build`。',
    );
  }
  return [...hits].join('\n');
}

const MONEY = (amount: number) => ({ amount, currency: 'TWD' });

function detail(): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    displayId: 'PCM-2026-0042',
    createdAt: '2026-08-04T02:00:00+00:00',
    cancelledAt: null,
    customer: { name: '王小明', email: null, phone: null },
    items: [],
    subtotal: MONEY(51987),
    shippingFee: MONEY(611),
    discountTotal: MONEY(0),
    total: MONEY(52598),
    itemsTruncated: false,
  } as unknown as AdminOrderDetail;
}

/**
 * 🔴 **測資要讓【三個區塊同時存在】** —— 這是本檔第一版最貴的教訓的直接對策:
 *    只有一個 section 的測資,會讓「掃每一個 section」這件事**看起來做了、其實只掃了一個**。
 *    買 9 / 取消 1 / 先前出 0 / 這一箱 2 ⇒ 尚未出貨 9−1−0−2 = 6 > 0 ⇒ 三區都在。
 */
const ITEM = {
  id: 'i1',
  variantSku: 'LTC-BK-XL',
  title: '前叉防甩頭',
  spec: { 顏色: '黑' },
  quantity: 9,
  unitPrice: MONEY(74183),
  lineTotal: MONEY(88291),
  quantitySummary: {
    quantity: 9,
    orderedQuantity: 9,
    instockQuantity: 9,
    shippedQuantity: 0,
    cancelledQuantity: 1,
    cancellableQuantity: 8,
  },
} as unknown as AdminOrderDetailFullItem;

/**
 * 🔴 **R3 MF6:第二個品項【沒有 quantitySummary】** —— 它會走 `qty === null` 那一支
 * (`.pd-state` + `tr.pd-wait`),而那正是 R2-N7 剛改的分支。
 * ⚠️ **改前的 fixture 長不出這一支** ⇒ **量具把它自己剛修的碼排除在分母外**,
 *    而分母外的東西不會紅。
 */
const ITEM_UNKNOWN = {
  id: 'i2',
  variantSku: 'BADGEBL',
  title: '油箱止滑貼',
  spec: null,
  quantity: 3,
  unitPrice: MONEY(1200),
  lineTotal: MONEY(3600),
  quantitySummary: null,
} as unknown as AdminOrderDetailFullItem;

const shipment = {
  id: 's1',
  shipmentReference: 'K7X2MP',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: '6412345678',
  shippedAt: '2026-08-16T02:00:00Z',
  // 🔴 `voidedAt` 少了會被讀成 `undefined !== null` ⇒ **整張紙走阻印分支**,量具會量到一堆 -1。
  //    第一版就是這樣,而是**紙上自己印出「原因:undefined」**告訴我的。
  voidedAt: null,
  voidReason: null,
  recipientSnapshot: { name: '王小明', phone: '0912345678', line: '台北市信義區松高路 1 號' },
} as never;

type Cell = {
  cls: string;
  text: string;
  align: string;
  font: number;
  padTop: number;
  /** 對紙背景的對比度(1 = 完全看不見)。🔴 限制3 的補洞:改前本檔【零顏色讀數】。 */
  contrast: number;
};
type Qty = { text: string; font: number; hasState: boolean };
type Row = { rowCls: string; qty: Qty[]; cells: Cell[]; nameFont: number | null; strongFont: number | null };
type Sect = { title: string; headAligns: { cls: string; align: string }[]; rows: Row[] };

let browser: Browser;
let compiledCss: string;
beforeAll(async () => {
  compiledCss = findCompiledCss();
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
}, 120_000);

/**
 * 掃**整張紙的每一個品項區、每一列、每一格**,回結構化讀數。
 * @param extraCss 量具自檢用。
 * @param media 預設 `print` —— 這是一張紙。
 */
async function sweep(extraCss = '', media: 'print' | 'screen' = 'print'): Promise<Sect[]> {
  // 🔴 `reportedTotal` 必須等於 `items` 長度 —— 對不上會走「清單可能少列品項」的阻印分支,
  //    而症狀是**整張紙變成阻印版面、量具掃到 0 個 section**。
  //    📎 加第二個品項時我忘了改它,而**分母守門當場紅**給我看 —— 那一格的價值就在這裡。
  const html = renderToStaticMarkup(
    <ShippingDoc
      detail={detail()}
      items={[ITEM, ITEM_UNKNOWN]}
      reportedTotal={2}
      shipment={shipment}
      lines={[{ orderItemId: 'i1', quantity: 2 }] as never}
      // ⛔ ~~printedAt='2026-08-16T02:00:00Z'~~ —— **2026-08-30 Sean 拍板拿掉紙上的「列印時間」**
      //    ⇒ 那個 prop 已從 `ShippingDoc` 移除,這裡一併拿掉。
      //    📌 而它原本存在的理由(**固定值,不是 `new Date()`,否則本檔讀數每一發都不一樣,
      //       而「不一樣」與「壞掉」在報表上長得一樣**)**仍然成立** ——
      //       ⇒ 🔴 下一個往這支元件加「當下時間」的人,請把那個值收成 prop,不要在元件裡拿。
    />,
  );
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<html><head><style>${compiledCss}\n${extraCss}</style></head><body>${html}</body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  // 🔴 **R4 F5:703px = 真可印寬 186mm**(A4 210 − `@page` 左右各 12mm;
  //    那個 margin 由 `print-a4-css.test.ts` 的 `@page margin:12mm 12mm 14mm 12mm` 釘著)。
  //    改前是 900px = **238mm ⇒ 比真的紙寬 28%**。
  // 🔴🔴 **而換成 703 之後這把尺【仍然看不到推寬/溢出】** —— 這一句比上面那個數字重要:
  //    本檔的讀數只有 `fontSize` / `paddingTop` / `textAlign` / `contrast`,**一個寬度都沒讀**。
  //    ⇒ `#827`(列印表格零欄寬 ⇒ 溢出推寬)這一族的結論,**這把尺構造上量不到**,
  //      換寬度不會讓它量得到。改 703 買到的是「別人不會誤以為它量過紙寬」,不是判別力。
  //    📎 實測(2026-08-24,兩發各自 dump 全部讀數再 diff):900 與 703 的讀數**逐字相同**
  //      (11 行 JSON,`diff` 零行;正對照:同一份 dump 內注入 99px 那一發確實不同)
  //      ⇒ **讀數不變【正是】它對寬度無感的證據,不是「換了沒差所以不用換」。**
  const page = await browser.newPage({ viewport: { width: 703, height: 1200 } });
  try {
    await page.emulateMedia({ media });
    await page.goto(`http://localhost:${port}/`);
    return await page.evaluate(() => {
      const f = (el: Element, prop: 'fontSize' | 'paddingTop'): number =>
        parseFloat(getComputedStyle(el)[prop]);
      // 🔴 **對比度而不是「顏色不等於白色」** —— 後者一個 `#fefefe` 就繞過去了,
      //    而紙上的病是「看不見」不是「等於某個字面」。公式 = WCAG 相對亮度。
      const lum = (rgb: string): number => {
        const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const c = (v: number): number => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
      };
      // 紙的背景:往上找第一個非透明的 background-color(印出來的紙預設是白的)。
      const bgOf = (el: Element): string => {
        for (let n: Element | null = el; n !== null; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0)')) return bg;
        }
        return 'rgb(255, 255, 255)';
      };
      const contrastOf = (el: Element): number => {
        const a = lum(getComputedStyle(el).color);
        const b = lum(bgOf(el));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const fontOf = (root: Element, sel: string): number | null => {
        const el = root.querySelector(sel);
        return el === null ? null : f(el, 'fontSize');
      };
      return [...document.querySelectorAll('.pd-items')].map((sec) => ({
        title: sec.querySelector('h2')?.firstChild?.textContent?.trim() ?? '',
        headAligns: [...sec.querySelectorAll('.pd-colhead th')].map((th) => ({
          cls: th.className,
          align: getComputedStyle(th).textAlign,
        })),
        // 🔴 `:scope >` —— 理由同 `page.test.tsx` 那段(丁把整張紙包進外層 `<table><tbody>`
        //    ⇒ `'tbody tr'` 的祖先比對會撈到品項表 `<thead>` 裡的列)。
        rows: [...sec.querySelectorAll(':scope > table > tbody > tr')].map((tr) => ({
          rowCls: tr.className,
          // 🔴 **數量格由元件用 `data-slot="qty"` 宣告**(R3 MF7)——
          //    改前是「每一列的最後一格」= 位置假設,而片5 在數量後面加一欄就會靜默換掉分母。
          qty: (() => {
            const q = [...tr.querySelectorAll('td[data-slot="qty"]')];
            return q.map((td) => ({
              text: (td.textContent ?? '').trim(),
              // 🔴🔴 **R4 F4:量【渲染那個數字的節點】,不是 `td`。**
              //    改前量 `td` ⇒ 把數字包成 `<td …><span class='pd-slot'>6</span></td>`
              //    (`.pd-slot` 是既有規則,`print-a4.css:690`)⇒ **td 仍 10pt、紙上數字變小**
              //    ⇒ 三格全綠。而 R2 那顆缺陷的形狀正是「數字住在 td 底下的 span 裡」。
              //    📎 同一個修法也套在 `cells[].contrast` 上 —— 兩個讀數要看同一個節點,
              //       否則「字級量 span、顏色量 td」會變成兩把互相看不見的尺。
              font: f(td.lastElementChild ?? td, 'fontSize'),
              hasState: td.querySelector('.pd-state') !== null,
            }));
          })(),
          cells: [...tr.querySelectorAll('td')].map((td) => ({
            cls: td.className,
            text: (td.textContent ?? '').trim(),
            align: getComputedStyle(td).textAlign,
            font: f(td, 'fontSize'),
            padTop: f(td, 'paddingTop'),
            // 🔴 量**渲染文字的那個節點**,不是 `td` —— 同 F4 的病:數字包進 span 之後
            //    `td` 的顏色不會變,而紙上那個數字會。
            contrast: contrastOf(td.lastElementChild ?? td),
          })),
          nameFont: fontOf(tr, '.pd-name'),
          strongFont: fontOf(tr, 'td.pd-strong'),
        })),
      }));
    });
  } finally {
    await page.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const allCells = (ss: Sect[]): Cell[] => ss.flatMap((s) => s.rows.flatMap((r) => r.cells));

describe('🔴 出貨明細單 · 串接量測(真 chromium + 編譯後 CSS + print media)', () => {
  it('🔴🔴 分母守門:掃到的 section / 列 / 格都不是 0', async () => {
    // 🔴 **這一格必須先過。** 底下每一條都是「對【每一個】…」的全稱句,
    //    而**全稱句在空集合上恆真** —— 掃不到東西時它們會全部變綠,而那正是最壞的情況。
    const ss = await sweep();
    expect(ss.map((s) => s.title)).toEqual(['本次出貨', '尚未出貨', '訂單取消']);
    for (const s of ss) expect(s.rows.length, `${s.title} 掃到 0 列`).toBeGreaterThan(0);
    expect(allCells(ss).length).toBeGreaterThanOrEqual(9);
  });

  it('量具自檢 ①:注入一條【該贏】的規則,尺必須量到它', async () => {
    const base = await sweep();
    const bent = await sweep('.pd-items tbody .pd-name{font-size:99px !important}');
    const baseName = base[0]?.rows[0]?.nameFont ?? -1;
    expect(baseName).toBeGreaterThan(0);
    expect(bent[0]?.rows[0]?.nameFont).toBe(99);
    expect(bent[0]?.rows[0]?.nameFont).not.toBe(baseName);
  });

  it('🔴 量具自檢 ②:注入一條【該輸】的規則,尺必須看到它【沒有】生效', async () => {
    // 🔴 R2 N2:自檢 ① 用的是 `!important` + 更高具體度 ⇒ 它證明「尺讀得到 style」,
    //    **證不到「本檔的規則有沒有贏過串接」** —— 而後者才是本檔存在的理由。
    //    這一格注入具體度較低的 `.pd-sku` (0,1,0),對上 `.pd-items td.pd-sku` (0,2,1) ⇒ **必須輸**。
    //    ⇒ 若它竟然生效,代表串接的勝負與我以為的不同 ⇒ 本檔所有結論都要重看。
    const base = await sweep();
    const bent = await sweep('.pd-sku{font-size:77px}');
    const skuOf = (ss: Sect[]): number =>
      ss[0]?.rows[0]?.cells.find((c) => c.cls.includes('pd-sku'))?.font ?? -1;
    expect(skuOf(base)).toBeGreaterThan(0);
    expect(skuOf(bent)).not.toBe(77);
    expect(skuOf(bent)).toBe(skuOf(base));
  });

  it('🔴 F2:每一個區塊的數量欄名都靠右(推導,不是列舉某一個)', async () => {
    const ss = await sweep();
    for (const s of ss) {
      const numHead = s.headAligns.filter((h) => h.cls.includes('pd-num'));
      expect(numHead.length, `${s.title} 沒有數量欄名`).toBe(1);
      expect(numHead[0]?.align, `${s.title} 的數量欄名沒有靠右`).toBe('right');
    }
  });

  it('🔴 每一格 `pd-num` 都靠右、每一格都有內距(掃全部,不是第一個)', async () => {
    const ss = await sweep();
    for (const c of allCells(ss)) {
      if (c.cls.includes('pd-num')) expect(c.align, `${c.cls} 沒靠右`).toBe('right');
      expect(c.padTop, `${c.cls} 內距是 0`).toBeGreaterThan(0);
    }
  });

  it('🔴🔴 MF2:紙上【每一個數量數字】字級一致且大於品名(從內容推導,不看 class)', async () => {
    // 🔴🔴 **這一格被我自己的突變打掉過一次,而打掉它的方式值得留著。**
    //    上一版是「掃 `td.pd-strong`,斷言 `length >= 2` 且字級一致」。
    //    突變:把「尚未出貨」那格改回 `<td class='pd-num'><span class='pd-strong'>`
    //    ⇒ `td.pd-strong` 選不到它 ⇒ 它**從分母裡消失** ⇒ 剩下 2 個仍然一致 ⇒ **綠。**
    //    ⚠️ **我把「列舉選擇器」換成了「列舉一個數字(>= 2)」—— 同一個病換了個位置。**
    //    ⇒ 現在改成從**內容**推導:**紙上每一個看起來是數量的格子**,不管它掛什麼 class。
    //      標錯 class 的格子**不會消失,它會帶著錯的字級留在分母裡**。
    const ss = await sweep();
    const rows = ss.flatMap((s) => s.rows.map((r) => ({ sect: s.title, r })));
    // 🔴🔴 **R3 MF7:分母由元件宣告(`data-slot="qty"`),不由量具猜位置。**
    //    改前用「每一列最後一格」⇒ 片5 在數量後面加一欄對帳欄(純數字、字級自洽)
    //    ⇒ 三格斷言全綠,而**真正的數量欄整組離開分母** ⇒ R2-MF2 原樣復活。
    //    ⇒ 現在**每一列都必須剛好有一格帶那個標記**,標記不見就紅。
    for (const { sect, r } of rows) {
      expect(r.qty.length, `${sect} 有一列不是剛好一格 data-slot="qty"`).toBe(1);
    }
    const qtyCells = rows.map(({ sect, r }) => ({ sect, c: r.qty[0]! }));
    const numeric = qtyCells.filter(({ c }) => /^\d+$/.test(c.text));
    const nonNumeric = qtyCells.filter(({ c }) => !/^\d+$/.test(c.text));
    // 🔴 **R3 MF6:非數字那一支【也要在分母裡】** —— 它是「數量資料尚未就緒」那一列。
    //    改前 fixture 長不出它 ⇒ 量具把它自己剛修的碼排除在外。
    expect(numeric.length, '一個數字型數量格都沒有 ⇒ 下面恆真').toBeGreaterThan(0);
    expect(nonNumeric.length, '「尚未就緒」那一支沒出現 ⇒ fixture 沒涵蓋它').toBeGreaterThan(0);
    // 非數字那一格要帶稿的狀態語彙,而且它那一列要是 `pd-wait`。
    for (const { sect, c } of nonNumeric) {
      expect(c.hasState, `${sect} 的「尚未就緒」格沒有 .pd-state`).toBe(true);
    }
    expect(
      rows.filter(({ r }) => r.qty[0] !== undefined && !/^\d+$/.test(r.qty[0].text))
        .every(({ r }) => r.rowCls.includes('pd-wait')),
      '「尚未就緒」的列沒有掛 pd-wait',
    ).toBe(true);
    const fonts = numeric.map(({ c }) => c.font);
    expect(
      new Set(fonts).size,
      `各區數量字級不一致:${numeric.map(({ sect, c }) => `${sect}=${c.font}`).join(' / ')}`,
    ).toBe(1);
    // 🔴 R2 N3:**不釘死 px 差**(上一版寫 `>= 1`,而我旁邊寫著「不釘 px 值」——直接矛盾)。
    //    改用**相對比例**:數量至少比品名大 5%。字級階梯調整時它不會假紅。
    const names = ss.flatMap((s) =>
      s.rows.map((r) => r.nameFont).filter((v): v is number => v !== null),
    );
    expect(names.length).toBeGreaterThan(0);
    expect((fonts[0] ?? 0) / Math.max(...names)).toBeGreaterThanOrEqual(1.05);
  });

  it('🔴 每一列的料號都比同一列的品名大(掃全部的列)', async () => {
    const ss = await sweep();
    let checked = 0;
    for (const s of ss) {
      for (const r of s.rows) {
        const sku = r.cells.find((c) => c.cls.includes('pd-sku'));
        if (sku === undefined || r.nameFont === null) continue;
        checked += 1;
        expect(sku.font, `${s.title} 的料號沒有比品名大`).toBeGreaterThan(r.nameFont);
      }
    }
    expect(checked, '一列都沒檢到 ⇒ 這一格恆真').toBeGreaterThanOrEqual(3);
  });

  it('🔴🔴 限制3 補洞:紙上每一格的字都看得見(對比度,不是「顏色不等於白」)', async () => {
    // 🔴 **這一格是審查用一發突變打出來的**:在 CSS 末尾加 `.pd-num,.pd-sku{color:#fff}`
    //    ⇒ **紙上料號與數量全白消失**,而改前本檔 8 passed —— 因為它**一個顏色都沒讀**。
    // 🔴 **門檻是量出來的,不是挑的**:現況最低對比 = 下面那個負向對照印出來的值。
    //    取 3.0 是因為它**低於現況最低值、又遠高於白字的 1.0** ⇒ 今天不誤紅、白字必紅。
    //    ⚠️ 若哪天有人合理地把某個灰調得更淡而撞到 3.0,**那是要討論的設計決定,不是把門檻調低**。
    const ss = await sweep();
    const cells = allCells(ss);
    expect(cells.length, '掃到 0 格 ⇒ 下面恆真').toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.contrast, `${c.cls || '(無 class)'} 「${c.text}」對比度過低`).toBeGreaterThanOrEqual(3);
    }
    // 🔴 **負向對照:把料號與數量塗白 ⇒ 這一格必須紅。**
    //    沒有它,上面那個 `>= 3` 在「contrastOf 永遠回 21」的世界裡一樣全綠。
    const white = allCells(await sweep('.pd-items .pd-num,.pd-items .pd-sku{color:#fff}'));
    expect(
      white.filter((c) => c.contrast < 3).length,
      '塗白之後竟然沒有任何一格對比度過低 ⇒ 這把尺讀不到顏色',
    ).toBeGreaterThan(0);
  });

  it('🔴 螢幕與紙面的承重字級一致(改了一邊而忘了另一邊會在這裡紅)', async () => {
    const p = await sweep('', 'print');
    const s = await sweep('', 'screen');
    const strong = (ss: Sect[]) => ss[0]?.rows[0]?.strongFont ?? -1;
    expect(strong(p)).toBeGreaterThan(0);
    expect(strong(s)).toBe(strong(p));
  });
});
