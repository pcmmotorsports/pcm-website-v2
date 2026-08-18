// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import { OrdersTable } from './orders-table';
import { ShippingSelectionProvider } from './shipping-selection';

// orders-screenshot.test.tsx — **這不是守門,是一支【產圖工具】。**
//
// 🔴🔴 **它存在的理由是一句話**:`A-223-STOP` §4-① 逐字 ——
//    「本機 `apps/admin` 沒有資料 ⇒ 那個面板【從未真的渲染過】;
//      四張 artifact 全部是我自己的 CSS 重製,**不是 `apps/admin` 的編譯產物**。」
//    ⇒ **A 窗給 Sean 看的視覺一直是【仿品】。** 而 2026-08-17 他逐字說
//      「我覺得 A 窗做事有點笨,沒有抓到我要的重點」。
//    🔴 **「本機沒資料」這個藉口,在 `orders-status-visibility-browser.test.tsx` 那支 harness
//       出現之後就不成立了** —— 那條路 `renderToStaticMarkup(真元件) + .next 真編譯 CSS + 真 chromium`,
//       **完全不需要 DB**。本檔就是把那條路接到「產圖」上。
//
// 🔴 **平常 skip,要圖的時候才跑**(它是工具、不是守門,每次測試都跑純屬浪費):
//    ```
//    TURBO_FORCE=1 pnpm build            # 🔴 先 build，本檔吃 .next 的編譯後 CSS
//    ADMIN_SHOT=1 npx vitest run apps/admin/src/components/orders/orders-screenshot.test.tsx
//    ```
//    圖落在 `apps/admin/.next/__shots/`(build 產物目錄,不進 git)。
//
// ⚠️ **這張圖是什麼、不是什麼(先講死,免得又變成一個仿品)**:
//    ✅ 是   真的 `OrdersTable` 元件 + 真的編譯後 CSS，在真的 chromium 裡量出來的版面
//    ❌ 不是 真的 admin 站(沒有側邊欄、沒有頁首、沒有工具列、沒有右側面板)
//    ❌ 不是 真的資料(fixture 是我編的假訂單;而**版面**不受這件事影響)
//    ⇒ **拿它談「這一欄擠不擠、對不對齊、顏色對不對」可以;拿它談「整頁長怎樣」不行。**

function findCompiledCss(): string {
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
  walk(join(__dirname, '../../../.next'), 0);
  for (const f of hits) {
    const css = readFileSync(f, 'utf8');
    if (css.includes('orders-grid') && css.includes('col-status')) return css;
  }
  throw new Error(
    `找不到含 .orders-grid 的編譯後 CSS(掃到 ${hits.length} 支)。` +
      `本機:先跑 TURBO_FORCE=1 pnpm build,或只建這個 app:pnpm --filter @pcm/admin build。` +
      `CI:ci.yml 已有 Build admin 那一步 ⇒ 在 CI 看到這則代表那一步被拿掉或失序了。` +
      `🔴 不要把 pnpm build(全 monorepo)加進 ci.yml —— 那個做法 2026-08-18 已被裁定否決。`,
  );
}

function line(id: string, qty: number, lineTotal: number, title: string, brand: string): AdminOrderLine {
  return {
    id,
    variantSku: `SKU-${id.toUpperCase()}`,
    title,
    brand,
    vehicle: null,
    workflowStatus: null,
    version: 1,
    quantity: qty,
    unitPrice: { amount: toMoneyAmount(lineTotal / qty), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(lineTotal), currency: 'TWD' },
    quantitySummary: {
      quantity: qty,
      orderedQuantity: qty,
      instockQuantity: qty,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      cancellableQuantity: qty,
    },
  };
}

function order(
  id: string,
  displayId: string,
  customerName: string,
  lines: AdminOrderLine[],
  total: number,
  extra: Partial<AdminOrderSummary> = {},
): AdminOrderSummary {
  return {
    id,
    itemsTruncated: false,
    displayId,
    createdAt: '2026-08-06T02:00:00.000Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    total: { amount: toMoneyAmount(total), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName,
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    displayPosition: null,
    lines,
    ...extra,
  };
}

/**
 * 🔴 **fixture 刻意「乘出來」**(Sean 2026-08-17 常設令:視覺選項要放**多品項/多列**的樣子,
 * 不是單一元件) —— 一張多品項單、一張單品項單、一張截斷單、一張已取消單。
 * **版面問題只有在【乘出來】之後才看得見。**
 */
const ORDERS: AdminOrderSummary[] = [
  order(
    'o1',
    'PCM-0001',
    '王小明',
    [
      line('a', 2, 24000, 'Brembo 輻射對四卡鉗', 'Brembo'),
      line('b', 1, 8600, 'RPM CARBON 前土除', 'RPM CARBON'),
    ],
    32600,
  ),
  order('o2', 'PCM-0002', '陳大文', [line('c', 1, 15800, 'Öhlins TTX 後避震', 'Öhlins')], 15800),
  order('o3', 'PCM-0003', '林美玲', [line('d', 3, 2700, 'K-SPEED 手把端子', 'K-SPEED')], 2700, {
    itemsTruncated: true,
  }),
  order('o4', 'PCM-0004', '張志豪', [line('e', 1, 45000, 'Akrapovič 全段排氣', 'Akrapovič')], 45000, {
    cancelledAt: '2026-08-07T02:00:00.000Z',
  }),
];

const SHOULD_RUN = process.env.ADMIN_SHOT === '1';

describe('產圖工具(預設 skip;ADMIN_SHOT=1 才跑)', () => {
  it.skipIf(!SHOULD_RUN)('截 1440 桌機 + 390 手機兩張真元件圖', async () => {
    const css = findCompiledCss();
    const html = renderToStaticMarkup(
      <ShippingSelectionProvider>
        <OrdersTable
          buildPanelHref={(id) => `/orders?panel=${id}`}
          orders={ORDERS}
          selectedOrderId='o2'
        />
      </ShippingSelectionProvider>,
    );
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      // 🔴 **這一條浮水印是【要件】,不是裝飾**(主視窗 2026-08-18):
      //    這張圖與「手寫 CSS 重製的仿品」**看起來一樣**,而差別正是這次的重點。
      //    ⇒ 圖裡沒有這句話,它就會在被轉貼三次之後變回一張來歷不明的圖。
      const stamp =
        `<div style="font:12px/1.6 ui-monospace,monospace;color:#0066b1;` +
        `border-left:3px solid #0066b1;padding:6px 10px;margin-bottom:16px;background:#f2f7fc">` +
        `這是 <b>apps/admin 真元件</b>的編譯產物（OrdersTable + .next 編譯後 CSS + 真 chromium）,不是手繪稿。` +
        `<br>⚠️ 沒有側邊欄／頁首／工具列／右側面板;訂單資料是假的,<b>版面是真的</b>。` +
        `</div>`;
      res.end(
        `<html><head><style>${css}</style></head>` +
          `<body style="margin:0;padding:24px;background:var(--background,#fff)">${stamp}${html}</body></html>`,
      );
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const outDir = join(__dirname, '../../../.next/__shots');
    mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();
    try {
      for (const [w, h, tag] of [
        [1440, 900, 'desktop-1440'],
        [390, 844, 'mobile-390'],
      ] as const) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto(`http://localhost:${port}/`);
        const path = join(outDir, `orders-${tag}.png`);
        await page.screenshot({ path, fullPage: true });
        // 🔴 印出來,不然跑完不知道圖在哪(這支是給人用的工具,不是給 CI 看的)
        console.log(`[shot] ${path}`);
        await page.close();
      }
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
    expect(SHOULD_RUN).toBe(true);
  }, 180_000);
});
