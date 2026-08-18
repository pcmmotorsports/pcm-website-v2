// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 🔴 與 `cancel-forms-browser.test.tsx` 同因:本檔 `renderToStaticMarkup(真元件)`,而真元件
//    (間接)載入帶 `import 'server-only'` 的模組 ⇒ 不 mock 的話整檔紅。逐檔 mock = 本 repo 既有處置。
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

// orders-status-visibility-browser.test.tsx — 片 A-1 **驗收 13**(`plan §7#13`)。
//
// 🔴🔴 **為什麼非真瀏覽器不可,而且為什麼這一格不准缺席**
//    截斷時狀態欄印「未知」,那是 `Q-EMBED-2`(Sean 2026-08-16 拍甲)唯一的落地點。
//    既有兩格(`orders-table.test.tsx` 的 `itemsTruncated` 那組)斷言的是 **`textContent`**
//    ⇒ **樣式把那兩個字吃掉的世界,它們照樣全綠。** 而片 A-1 **正是動 `.col-status` 的樣式改版片**。
//    `orders-table.test.tsx:909` 自己也寫著:postcss 給的是**原始碼結構**,不是瀏覽器的計算樣式。
//
// 🔴 **這一格的身世(寫下來,免得被讀成「一直都有」)**
//    片 A-1 本體 `5e46360e`(2026-08-17 14:44)已進 dev;驗收 13 是 `b174532f`(21:36)才補進 plan
//    —— **實作之後 7 小時**,而且 plan 原稿還寫著「做不到就明寫本片未驗」。
//    2026-08-17 V 窗對抗審查 P3 判 must-fix:**harness 是現成的 ⇒ 藉口不成立**。本檔就是那個藉口的下場。
//
// 🔴🔴 **CSS 從哪來 —— 這是本檔判別力的全部來源**
//    量「computed style」而餵無樣式的 DOM = 恆綠。所以本檔吃的是 **`.next` 裡編譯後的真 CSS**
//    (Tailwind 源碼 `globals.css` 帶 `@import`/`@theme`,瀏覽器直接吃不了)。
//    ⚠️ **檔名是 build 產生的雜湊、會變** ⇒ 本檔**動態掃**,不寫死檔名。
//    🔴 **找不到就【紅】,不是 skip** —— 「沒有 CSS 所以跳過」與「CSS 正常所以通過」在報表上長得一樣,
//       那正是今天全陣最貴的那個形狀。訊息會告訴你先跑 `TURBO_FORCE=1 pnpm build`。

/** 掃 `.next` 找那支含 `.orders-grid` 規則的編譯後 CSS。找不到 ⇒ throw(整檔紅)。 */
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
      else if (name.endsWith('.css')) hits.push(full);
    }
  };
  for (const r of roots) walk(r, 0);

  // 🔴 判準是**內容**不是檔名:要那支真的帶 `.orders-grid` 規則的。
  //    只看副檔名會撿到 301 bytes 那支無關的 chunk ⇒ 量到一個沒有規則的世界、恆綠。
  for (const f of hits) {
    const css = readFileSync(f, 'utf8');
    if (css.includes('orders-grid') && css.includes('col-status')) return css;
  }
  throw new Error(
    `找不到含 .orders-grid / .col-status 的編譯後 CSS(掃到 ${hits.length} 支 .css)。` +
      `本檔量的是真瀏覽器 computed style,沒有真 CSS 就沒有判別力 ⇒ 這裡刻意【紅】而不是 skip。` +
      `修法(本機):先跑 TURBO_FORCE=1 pnpm build,或只建這個 app:pnpm --filter @pcm/admin build。` +
      `修法(CI):ci.yml 已有 Build admin 那一步 ⇒ 在 CI 看到這則代表那一步被拿掉或失序了。` +
      `🔴 不要把 pnpm build(全 monorepo)加進 ci.yml —— 那個做法 2026-08-18 已被裁定否決,` +
      `理由與代價寫在該檔那一步上方的註解。`,
  );
}

// 🔴 欄位名**從 `packages/domain/src/order/types.ts:461` 讀出來**,不憑印象拼 ——
//    我第一版寫了 `productTitle/sku/brandName/vehicleSnapshot` 四個不存在的名字,
//    當場炸在 `formatOrderItemVehicle` 讀 `undefined.kind`(不是型別錯,是**執行期**才炸)。
//    ⇒ 同一條教訓在 `orders-table.test.tsx:1764` 也記過一次。
function lineAt(id: string, quantity: number): AdminOrderLine {
  return {
    id,
    variantSku: 'SKU-1',
    title: '測試品項',
    brand: 'PCM',
    vehicle: null,
    workflowStatus: null,
    version: 1,
    quantity,
    unitPrice: { amount: toMoneyAmount(6000), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(6000 * quantity), currency: 'TWD' },
    quantitySummary: {
      quantity,
      orderedQuantity: quantity,
      instockQuantity: quantity,
      shippedQuantity: quantity,
      cancelledQuantity: 0,
      cancellableQuantity: 0,
    },
  };
}

function order(itemsTruncated: boolean): AdminOrderSummary {
  return {
    id: 'ord-1',
    itemsTruncated,
    displayId: 'PCM-0001',
    createdAt: '2026-08-06T02:00:00.000Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    total: { amount: toMoneyAmount(12000), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName: '王小明',
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    displayPosition: null,
    lines: [lineAt('l1', 2)],
  };
}

let browser: Browser;
let compiledCss: string;
beforeAll(async () => {
  compiledCss = findCompiledCss();
  browser = await chromium.launch();
}, 120_000);
// 🔴 `afterAll` 的 timeout 要跟 `beforeAll` 一樣長(`#334`;不對稱會在機器忙的時候
//    變成「檔案紅、零個測試紅」的收尾逾時,而且重跑就綠 ⇒ 最容易被誤記成 flake)。
afterAll(async () => {
  await browser?.close();
}, 120_000);

/**
 * 把 `OrdersTable` 靜態渲染 + 真編譯 CSS 掛上 server,回傳「未知」那顆膠囊的 computed style。
 *
 * @param extraCss 追加樣式 —— **量具自檢用**:注入一條把它藏起來的規則,這把尺必須量得到。
 */
async function measureStatusCapsule(
  itemsTruncated: boolean,
  extraCss = '',
): Promise<{
  text: string;
  display: string;
  visibility: string;
  width: number;
  height: number;
  tdWidth: string;
} | null> {
  const html = renderToStaticMarkup(
    <ShippingSelectionProvider>
      <OrdersTable buildPanelHref={(id) => `/orders?panel=${id}`} orders={[order(itemsTruncated)]} />
    </ShippingSelectionProvider>,
  );
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<html><head><style>${compiledCss}\n${extraCss}</style></head><body>${html}</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const page = await browser.newPage();
  try {
    await page.goto(`http://localhost:${port}/`);
    return await page.evaluate(() => {
      const td = document.querySelector('td.col-status');
      const el = td?.querySelector('span');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent ?? '',
        display: cs.display,
        visibility: cs.visibility,
        width: r.width,
        height: r.height,
        // 🔴 給「編譯 CSS 真的載入了嗎」那道自檢用(見 13d)。
        tdWidth: getComputedStyle(td as Element).width,
      };
    });
  } finally {
    await page.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('驗收 13 — 截斷時「未知」那顆膠囊在真瀏覽器裡看得見', () => {
  it('🔴 13a:截斷時膠囊 computed style 可見(非 display:none / visibility:hidden / 零尺寸)', async () => {
    const m = await measureStatusCapsule(true);
    expect(m).not.toBeNull();
    // 🔴 先釘住「我量到的確實是那顆」—— 沒有這一條,下面三個斷言可能是在量另一顆膠囊。
    expect(m?.text).toBe('未知');
    expect(m?.display).not.toBe('none');
    expect(m?.visibility).not.toBe('hidden');
    expect(m?.width).toBeGreaterThan(0);
    expect(m?.height).toBeGreaterThan(0);
  }, 60_000);

  /**
   * 🔴🔴 **量具自檢 —— 這一格證明上面那格【量得到不可見的世界】。**
   * 沒有它,13a 可能只是因為「這把尺對任何東西都回可見」而通過(恆真格)。
   * 做法:注入一條把 `.col-status` 藏掉的規則,**尺必須當場讀到 `none`**。
   */
  it('🔴 13b 量具自檢:注入 .col-status{display:none} ⇒ 這把尺【要量得到】它不見了', async () => {
    const m = await measureStatusCapsule(true, 'td.col-status{display:none}');
    // display:none 之後 getBoundingClientRect 是 0 ⇒ 兩個面都要驗,免得只有一個面有判別力。
    expect(m?.display === 'none' || (m?.width === 0 && m?.height === 0)).toBe(true);
  }, 60_000);

  /**
   * 🔴 **正向對照** —— 非截斷態那顆狀態膠囊同樣要看得見。
   * 沒有它,13a 可能被讀成「截斷態被特別處理過」,而真正要守的是**這一欄整體沒被樣式吃掉**。
   */
  /**
   * 🔴🔴 **量具自檢之二 —— 證明【編譯後的真 CSS 確實生效】。**
   *
   * 13b 注入的是**我自己寫的**那一行規則 ⇒ 它只證「這把尺讀得到樣式」,
   * **不證「頁面上那份 70KB 編譯 CSS 有被套用」**。少了本格,`findCompiledCss()` 哪天撈到
   * 一支不相干的 CSS(或 Tailwind 改了輸出結構),13a 會**照樣全綠** —— 因為
   * **無樣式的 `<span>` 本來就是可見的**。那正是「量錯東西」最典型的形狀。
   *
   * 兩個判準都取自真 CSS,無樣式時**兩個都不會是這個值**:
   *   `td.col-status` 寬度 = `88px`(`globals.css` 唯三命中 col-status 的規則之一)
   *   膠囊 `display`   = `inline-flex`(無樣式的 `<span>` 是 `inline`)
   */
  it('🔴 13d 量具自檢:編譯後的真 CSS 有生效(td 寬 88px + 膠囊 inline-flex)', async () => {
    const m = await measureStatusCapsule(true);
    expect(m?.tdWidth).toBe('88px');
    expect(m?.display).toBe('inline-flex');
  }, 60_000);

  it('13c 正向對照:非截斷時那顆狀態膠囊一樣可見', async () => {
    const m = await measureStatusCapsule(false);
    expect(m).not.toBeNull();
    expect(m?.text).not.toBe('未知');
    expect(m?.display).not.toBe('none');
    expect(m?.visibility).not.toBe('hidden');
    expect(m?.width).toBeGreaterThan(0);
  }, 60_000);
});
