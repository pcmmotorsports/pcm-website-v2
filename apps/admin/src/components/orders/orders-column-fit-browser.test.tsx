// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 同 `orders-status-visibility-browser.test.tsx`:真元件間接載入 `server-only` ⇒ 逐檔 mock。
vi.mock('server-only', () => ({}));
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import { OrdersTable } from './orders-table';
import { ShippingSelectionProvider } from './shipping-selection';

// orders-column-fit-browser.test.tsx — 14 欄「真的裝不裝得下真實資料」的**同尺量測**。
//
// 🔴🔴 **為什麼一定要在同一次量測裡產生兩邊的數字(這是本檔存在的全部理由)**
//    `globals.css` 每一欄旁邊都寫著「實測需求 = N px」,而那些 N 是**不同時期、不同機器、
//    不同字級**量出來的。2026-08-22 線 B 用另一把尺重量,六個字串**四個偏小一個偏大**
//    (`EVOTECH PERFORMANCE` 註解 187 / 重量 171.3;那台 Ducati 註解 213 / 重量 227.1)。
//    ⇒ **拿「今天量到的欄寬」減「註解裡的需求」會得到一個看起來完全正常的錯誤數字。**
//    本檔的作法是:**欄寬與文字寬在同一個瀏覽器、同一份編譯後 CSS、同一個 viewport 裡一起量出來**,
//    然後才相減。跨尺相減這件事本檔結構上做不到。
//
// 🔴 **`table-layout: fixed` 之下,宣告寬不是使用者看到的寬。**
//    宣告加總 < 容器 ⇒ 瀏覽器把鬆弛**按比例**分回每一欄(線 B 2026-08-22 實量:
//    vw 1728 下鬆弛 172、溢出 0)。⇒ 只讀 `globals.css` 的 `width` 值會低估每一欄的實際可用寬。
//    ⇒ 本檔一律量 `getBoundingClientRect()`,不讀宣告值。
//
// 🔴 CSS 來源與 `orders-status-visibility-browser.test.tsx` 同款:掃 `.next` 的編譯產物,
//    **找不到就紅、不 skip**(「沒有 CSS 所以跳過」與「CSS 正常所以通過」在報表上長得一樣)。
//    訊息會叫你先跑 `TURBO_FORCE=1 pnpm build`。

function findCompiledCss(): string {
  const roots = [join(__dirname, '../../../.next/static'), join(__dirname, '../../../.next')];
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
  for (const r of roots) walk(r, 0);
  if (hits.length === 0) {
    throw new Error(
      '找不到含 .orders-grid 的編譯後 CSS ⇒ 本檔沒有判別力,判紅不判 skip。先跑 `TURBO_FORCE=1 pnpm build`。',
    );
  }
  return hits.join('\n');
}

/**
 * 正式站今天的**最長真值**(2026-08-22 唯讀查證 / 取自 `globals.css` 既有註解的字串)。
 * 🔴 客戶名用 8 個中文字的**替身**,不放真實姓名(PII 不進 repo);長度取自
 *    `customers` 全表實查的最長「有下過單」者 = 8 字。
 * 🔴 32 字那位不納入:Sean 2026-08-22 拍板為測試資料,而且他**從來沒下過單**
 *    ⇒ 訂單列表結構上照不到他。
 */
const WORST = {
  displayId: 'PCM-2026-0104',
  vehicleBrand: 'Ducati',
  vehicleModel: 'Hypermotard 1100 Evo',
  vehicleYear: 2012,
  brand: 'EVOTECH PERFORMANCE',
  sku: 'PRN-013-2350-B-XXL',
  title: '品牌貼紙（白色）',
  customerName: '陳大文王小美美',
} as const;

function worstLine(): AdminOrderLine {
  return {
    id: 'l1',
    variantSku: WORST.sku,
    title: WORST.title,
    brand: WORST.brand,
    vehicle: {
      kind: 'dict',
      brand: WORST.vehicleBrand,
      model: WORST.vehicleModel,
      year: WORST.vehicleYear,
      source: 'dict',
    },
    workflowStatus: null,
    version: 1,
    quantity: 12,
    unitPrice: { amount: toMoneyAmount(128000), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(128000 * 12), currency: 'TWD' },
    quantitySummary: {
      quantity: 12,
      orderedQuantity: 12,
      instockQuantity: 12,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      cancellableQuantity: 12,
    },
  };
}

function worstOrder(): AdminOrderSummary {
  return {
    id: 'ord-1',
    itemsTruncated: false,
    displayId: WORST.displayId,
    createdAt: '2026-08-06T02:00:00.000Z',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'bank_transfer',
    total: { amount: toMoneyAmount(1536000), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName: WORST.customerName,
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    displayPosition: null,
    lines: [worstLine()],
  };
}

type ColFit = {
  col: string;
  label: string;
  cellW: number;
  contentW: number;
  padL: number;
  padR: number;
  textW: number;
  fontSize: string;
  clipped: boolean;
};

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
 * 在指定 viewport 下量 14 欄:格寬 / 內距 / content box / **文字自己的寬** / 字級 / 有沒有被裁。
 *
 * 🔴 文字寬用 `Range.selectNodeContents().getBoundingClientRect().width` ——
 *    不用 `scrollWidth`:那是從 content box 起算,對**帶自己內距的元件**(膠囊/連結)必然溢出、恆回 true
 *    (`globals.css` 的 `col-pick` 那段就是這個誤報的墓碑)。
 * @param extraCss 量具自檢用:注入一條規則,這把尺必須量得到它。
 */
async function measureColumns(viewport: number, extraCss = ''): Promise<ColFit[]> {
  const html = renderToStaticMarkup(
    <ShippingSelectionProvider>
      <OrdersTable buildPanelHref={(id) => `/orders?panel=${id}`} orders={[worstOrder()]} />
    </ShippingSelectionProvider>,
  );
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<html><head><style>${compiledCss}\n${extraCss}</style></head><body>${html}</body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const page = await browser.newPage({ viewport: { width: viewport, height: 900 } });
  try {
    await page.goto(`http://localhost:${port}/`);
    return await page.evaluate(() => {
      const out: ColFit[] = [];
      for (const td of Array.from(document.querySelectorAll('tbody td[class*="col-"]'))) {
        const cls = Array.from(td.classList).find((c) => c.startsWith('col-'));
        if (cls === undefined) continue;
        const cs = getComputedStyle(td);
        const padL = parseFloat(cs.paddingLeft);
        const padR = parseFloat(cs.paddingRight);
        const cellW = td.getBoundingClientRect().width;
        /* 🔴🔴 **文字寬要量【文字節點】,不能量 `td` 的 contents。**
           `selectNodeContents(td)` 在格子裡裝的是**區塊元素**(`<div>` / block `<a>`)時,
           回的是那個區塊的寬 = **整個 content box** ⇒ 讀數恆等於「可用寬」、永遠不會判裁。
           🔴 2026-08-22 本檔第一版就是這樣:客戶欄印出 `文字 123.9 / 可用 123.9`,
              兩個數字**一模一樣**,而我差點拿它去宣告「客戶欄修好了」。
              **那個相等本身就是尺壞掉的訊號** —— 真的文字寬幾乎不可能剛好等於容器寬。
           ⇒ 改成走 TreeWalker 收所有文字節點,各自量、取聯集寬。 */
        let left = Infinity;
        let right = -Infinity;
        const eat = (rect: DOMRect): void => {
          if (rect.width === 0) return;
          left = Math.min(left, rect.left);
          right = Math.max(right, rect.right);
        };
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          if ((n.textContent ?? '').trim() === '') continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          eat(r.getBoundingClientRect());
        }
        /* 🔴 **只量文字會低報「自己帶內距的元件」**(狀態膠囊、操作連結、勾選框)。
           實例:狀態膠囊的字是 54px,而**膠囊本身**(含左右內距與外框)是 70px ——
           被裁的是膠囊不是字,量字會漏報 16px。
           ⚠️ **只收 inline 級的子元素**:區塊級子元素的 rect 會填滿整個 content box
              ⇒ 讀數又變回「恆等於可用寬」,那正是本檔第一版壞掉的方式。 */
        for (const el of Array.from(td.querySelectorAll('*'))) {
          const d = getComputedStyle(el).display;
          if (d !== 'inline' && d !== 'inline-block' && d !== 'inline-flex') continue;
          eat(el.getBoundingClientRect());
        }
        /* 🔴 勾選框是 `<input>`(替換元素,沒有文字節點、`display` 也不一定是 inline)
           ⇒ 單獨收它,否則勾選欄永遠回 0 = 恆綠。 */
        for (const el of Array.from(td.querySelectorAll('input, img, svg'))) {
          eat(el.getBoundingClientRect());
        }
        const textW = right > left ? Math.round((right - left) * 10) / 10 : 0;
        out.push({
          col: cls,
          label: (td.getAttribute('data-l') ?? td.textContent ?? '').trim().slice(0, 24),
          cellW: Math.round(cellW * 10) / 10,
          contentW: Math.round((cellW - padL - padR) * 10) / 10,
          padL,
          padR,
          textW: Math.round(textW * 10) / 10,
          fontSize: cs.fontSize,
          clipped: textW > cellW - padL - padR + 0.5,
        });
      }
      return out;
    });
  } finally {
    await page.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('🔴 14 欄在 Sean 的真實視窗下裝不裝得下真值(同尺量測)', () => {
  it('量具自檢 — 硬把客戶欄壓成 20px,那一欄【必須】翻成被裁', async () => {
    const before = await measureColumns(1728);
    const after = await measureColumns(1728, '.orders-grid .col-customer{width:20px !important}');
    const b = before.find((c) => c.col === 'col-customer');
    const a = after.find((c) => c.col === 'col-customer');
    expect(b, '客戶欄沒被量到 ⇒ 下面每一格都恆綠').toBeDefined();
    // 🔴 兩個世界都要表演:沒壓的時候不裁、壓了就裁。只驗一側 = 分不出「守住了」與「尺沒力」。
    expect(b?.clipped, '客戶欄在 1728 下就已經被裁 ⇒ 本片的加寬沒生效').toBe(false);
    expect(a?.clipped, '壓成 20px 仍回「沒被裁」⇒ 這把尺沒有判別力,下面所有結論作廢').toBe(true);
  }, 120_000);

  /**
   * 🔴 **`col-vehicle` 是【被允許】裁的,那是 Sean 2026-08-22 拍的乙**
   *    (逐字:「切字但滑過去顯示全名」)⇒ 它出現在裁切名單裡**不是缺陷**。
   *    ⚠️ 而那個 hover **今天還沒做**(吃 JS、鑽機的 client JS 沒跑 ⇒ 驗不了)
   *    ⇒ **現況是「裁了而且沒有 hover」= 只做了乙的一半。** 這句留著,別讓本檔綠燈讀成「乙做完了」。
   *    ⇒ hover 落地後要回來加一格「trigger 真的收得到 hover」,那一格只有真瀏覽器證得了
   *      (整列 stretched link 蓋在車種格上,`shipping-selection.test.tsx` 自陳它的 z 規則
   *       是「原始碼層規則、不是真的層疊計算」)。
   */
  const ALLOWED_TO_CLIP = new Set(['col-vehicle']);

  /**
   * 🏁 **2026-08-23 Sean 拍板「依照 OD」** —— OD 改版稿 `FIX-43` 逐字
   *    「欄位再緊縮:不寫 NT$、內距 12→7px、欄寬依量到的自然寬重算」。
   *    **欄幾何整個換了,而代價是下面這幾欄裝不下今天的最長真值。他知道並接受。**
   *
   * 🔴🔴 **做成【具名記錄差距】,不是把它們丟進 `ALLOWED_TO_CLIP`。**
   *    丟進去 = 那幾欄從此**不管裁多兇都不會紅** ⇒ 用一個恆綠格換掉一個會說話的格子。
   *    記差距的話:**新的一欄開始裁 ⇒ 紅;既有的一欄裁得更兇 ⇒ 紅。** 判別力留著。
   *
   * ⚠️ **數字是量出來的**(2026-08-23 本檔實跑,viewport 1728、真編譯 CSS、真元件),
   *    不是抄的。容差 6px:字體 hinting 與抗鋸齒在不同機器上會差個一兩 px。
   * ⚠️ **`col-ops` 那筆不是「被裁」,是【欄位被移除】**(OD `FIX-34 移除「操作」欄 —— 開明細一律點整列`)
   *    ⇒ 它的文字寬 0、可用寬 -4(內距吃掉)。
   *    🔴 ~~「留在這裡是為了讓它消失也會紅」~~ **這句 2026-08-23 之前是【假的】,審查點名。**
   *       登記項只是沒被用到 ⇒ 它消失時整圈 filter 碰不到它 ⇒ 零紅。
   *       **現在有一格真的在守這件事了**(見下方 `measured` 那格)—— 句子才追上事實。
   */
  const KNOWN_CLIP_GAP: Record<string, number> = {
    'col-brand': 171.3 - 127.4,
    'col-unit': 87.4 - 83.4,
    'col-amount': 100.1 - 96,
    'col-ops': 0 - -4,
  };
  const GAP_TOLERANCE = 6;

  // 🔴🔴 **2026-08-24 拆分:本 describe 原本把【跟字型無關】與【字型決定】的斷言綁在同一格。**
  //    成因與代價都量過了:
  //      · CI 容器【零中文字型】(`grep -icE "font|fonts-noto|fontconfig" .github/workflows/ci.yml` ⇒ 0)
  //      · 而本檔用 `Range.getBoundingClientRect()` 量【文字的真實像素寬】⇒ 字型換掉, 答案就換掉
  //      · 實測:同一顆 SHA, 本機 `3 passed / EXIT=0`, CI `1 failed`(唯一紅 = 絕對像素那一格)
  //    ⇒ 那不是 bug, 是**一支量環境的測試被當成量程式碼在用**。
  //
  // 🔴 **而【不要在 CI 裝中文字型】** —— 審查窗 2026-08-24 的原話, 我採納:
  //    「它量的是 Sean 的機器。CI 裝了字型只會從【紅錯理由】變成【綠錯理由】。」
  //    裝字型會讓它變綠, 而它量的還是錯的東西, **從此沒有人會再回來看**。
  //
  // ⚠️ **而下面兩格(量具自檢、車種欄前提)也含字型相依的斷言, 只是今天在 CI 上碰巧綠。**
  //    那是運氣不是設計 —— GitHub 換 runner 映像檔的那天它們會翻。已記 backlog, 本次不動。

  it('CI 可攜 — DOM 分母與登記表守門(不碰任何像素比較)', async () => {
    const cols = await measureColumns(1728);
    // ① 分母:量不到欄位 ⇒ 下面每一格都恆綠
    expect(cols.length, '一欄都沒量到 ⇒ 恆綠').toBeGreaterThanOrEqual(13);
    // ③ 登記表本身要被守:有人往裡面加一欄 = 靜靜放行一個新的截斷
    expect(
      Object.keys(KNOWN_CLIP_GAP).length,
      '已登記的截斷欄變多了 ⇒ 有人在放行新的截斷,這需要拍板不是順手加',
    ).toBe(4);
    // ④ 登記表不得腐爛:指向不存在欄位的具名豁免, 讀起來像在保護什麼
    const measured = new Set(cols.map((c) => c.col));
    expect(
      Object.keys(KNOWN_CLIP_GAP).filter((k) => !measured.has(k)),
      '登記表裡有欄位在畫面上量不到了 ⇒ 那一筆登記已經失效(而它看起來仍在保護什麼)',
    ).toEqual([]);
    },
    120_000,
  );

  // 🔴 **死亡偵測(dead-man)** —— 這一格【在 CI 跑】, 而它守的是「本機那一格還有沒有人在跑」。
  //    沒有它, 把絕對像素那格移成本機專用 = **安樂死不是搬家**(審查窗 must-fix 2)。
  //    機制:本機那一格每次跑完會寫 `column-fit-measured.json`(含 measuredAt);
  //         本格讀它, 超過 90 天沒更新就紅。
  //    ⇒ 🔴 **「三個月沒跑, 什麼東西會紅?」的答案就是這一格。**
  it('死亡偵測 — 本機像素量測不得超過 90 天沒跑', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const recPath = join(here, 'column-fit-measured.json');
    expect(
      existsSync(recPath),
      '找不到 column-fit-measured.json ⇒ 本機像素量測從來沒跑過, 或紀錄被刪了',
    ).toBe(true);
    const rec = JSON.parse(readFileSync(recPath, 'utf8')) as { measuredAt: string };
    const days = (Date.now() - Date.parse(rec.measuredAt)) / 86_400_000;
    expect(Number.isFinite(days), `measuredAt 讀不出日期:${rec.measuredAt}`).toBe(true);
    expect(
      days,
      `本機像素量測已經 ${days.toFixed(0)} 天沒跑(上次 ${rec.measuredAt})` +
        ' ⇒ 在 Sean 的機器上跑 PCM_PIXEL_MEASURE=1 npx vitest run <本檔> 重新量一次',
    ).toBeLessThan(90);
  });

  // 🔴 **只在 Sean 的機器上跑** —— 需要中文字型才算得對。
  //    CI 上它會顯示成 skipped(而不是消失)⇒ `Tests ... N skipped` 那個數字看得到它。
  it.skipIf(!process.env.PCM_PIXEL_MEASURE)(
    '🔴 [本機專用] Sean 的視窗(1728)下,除了車種欄之外沒有一欄裁掉真值',
    async () => {
    const cols = await measureColumns(1728);
    expect(cols.length, '一欄都沒量到 ⇒ 恆綠').toBeGreaterThanOrEqual(13);
    // eslint-disable-next-line no-console
    console.log(
      '\n量測(viewport 1728、真編譯 CSS、真元件、同一次量測):\n' +
        cols
          .map(
            (c) =>
              `  ${c.col.padEnd(14)} 格${String(c.cellW).padStart(6)}  可用${String(c.contentW).padStart(6)}` +
              `  文字${String(c.textW).padStart(6)}  字級${c.fontSize.padStart(5)}` +
              `  ${c.clipped ? '❌裁' : '✅'}`,
          )
          .join('\n'),
    );
    const bad = cols
      .filter((c) => c.clipped && !ALLOWED_TO_CLIP.has(c.col))
      .filter((c) => {
        const known = KNOWN_CLIP_GAP[c.col];
        if (known === undefined) return true; // 🔴 沒登記過的一欄開始裁 ⇒ 一定要紅
        return c.textW - c.contentW > known + GAP_TOLERANCE; // 裁得比登記的更兇 ⇒ 紅
      });
    expect(
      bad
        .map(
          (c) =>
            `${c.col} 文字${c.textW} > 可用${c.contentW}` +
            (KNOWN_CLIP_GAP[c.col] === undefined
              ? '(未登記:新的一欄開始裁了)'
              : `(登記差距 ${KNOWN_CLIP_GAP[c.col]!.toFixed(1)},現在 ${(c.textW - c.contentW).toFixed(1)} ⇒ 惡化了)`),
        )
        .join(' / '),
      '這些欄在 Sean 的視窗下裝不下今天的最長真值(車種與 2026-08-23「依照 OD」已登記的那幾欄除外)',
    ).toBe('');

    // 🔴 **跑完就把量測寫下來** —— 那份紀錄是上面「死亡偵測」那一格的食物。
    //    沒有這一步, 本格移成本機專用 = 沒有人知道它多久沒跑了。
    const { writeFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    writeFileSync(
      join(here, 'column-fit-measured.json'),
      `${JSON.stringify(
        {
          measuredAt: new Date().toISOString().slice(0, 10),
          viewport: 1728,
          note: '在 Sean 的機器上跑 PCM_PIXEL_MEASURE=1 才會更新。CI 不跑它(容器零中文字型)。',
          columns: cols.map((c) => ({
            col: c.col,
            cellW: Math.round(c.cellW),
            contentW: Math.round(c.contentW),
            textW: Math.round(c.textW),
            fontSize: c.fontSize,
            clipped: c.clipped,
          })),
        },
        null,
        2,
      )}\n`,
    );

    // 🔴🔴 **2026-08-23 審查 Important-9:上面那段註解宣稱 `col-ops` 留在登記表是
    //    「為了讓它消失也會紅」—— 而那句話【不成立】,是本檔自己的字面 vs 事實。**
    //    機制:那一欄若從 DOM 消失,`cols` 裡就沒有它 ⇒ 登記項只是**沒被用到**,
    //    整圈 filter 一次都碰不到它 ⇒ **零紅**;而 `cols.length >= 13` 在 14→13 時仍然過。
    //    ⇒ 這一格就是把那句宣稱**變成真的**:登記表裡的每一欄都必須真的在畫面上量得到。
    //    📌 這同時守住登記表不腐爛 —— 一個指向不存在欄位的具名豁免,讀起來像在保護什麼。
    const measured = new Set(cols.map((c) => c.col));
    expect(
      Object.keys(KNOWN_CLIP_GAP).filter((k) => !measured.has(k)),
      '登記表裡有欄位在畫面上量不到了 ⇒ 那一筆登記已經失效(而它看起來仍在保護什麼)',
    ).toEqual([]);
  }, 120_000);

  it('前提 — 車種欄【確實】仍在裁(乙只做了一半,hover 還沒上)', async () => {
    const cols = await measureColumns(1728);
    const v = cols.find((c) => c.col === 'col-vehicle');
    expect(v, '車種欄沒量到 ⇒ 上面那格的白名單恆真').toBeDefined();
    // 🔴 這一格是【反向】的:它紅代表「車種不再裁了」——那時候白名單該拿掉,不是留著。
    expect(
      v?.clipped,
      '車種欄已經不裁了 ⇒ 上面的 ALLOWED_TO_CLIP 白名單變成一張恆真的免死金牌,請拿掉它',
    ).toBe(true);
  }, 120_000);
});

export type { ColFit };
