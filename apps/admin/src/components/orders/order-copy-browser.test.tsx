// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import { requireFreshBuild } from '../../lib/build-stamp';
import { serveHtmlAndVisit } from '../../lib/test-support/serve-html-and-visit';
import { OrdersTable } from './orders-table';
import { ShippingSelectionProvider } from './shipping-selection';
import { ShipToEditFields } from './ship-to-edit-fields';

vi.mock('server-only', () => ({}));

// 使用真正表格 markup 與本次 build 的 CSS，量命中區／裁切／選字。
// 這裡沒有 hydration；剪貼簿及表單事件由相鄰的互動測試驗證。
const money = { amount: toMoneyAmount(1000), currency: 'TWD' as const };
const item: AdminOrderLine = {
  id: 'copy-line-1', variantSku: 'DEMO-LONG-001-ABCDEFGHIJK',
  title: '測試專用完整商品名稱（加長款）', brand: 'EVOTECH PERFORMANCE',
  vehicle: { kind: 'dict', source: 'dict', brand: 'Kawasaki', model: 'Z900', year: 2023 },
  workflowStatus: null, version: 1, quantity: 1, unitPrice: money, lineTotal: money,
  quantitySummary: { quantity: 1, orderedQuantity: 0, instockQuantity: 0, shippedQuantity: 0, cancelledQuantity: 0, cancellableQuantity: 1 },
};
const order: AdminOrderSummary = {
  id: 'copy-order', itemsTruncated: false, displayId: 'DEMO01', createdAt: '2026-09-21T01:00:00Z',
  paymentStatus: 'paid', fulfillmentStatus: 'notOrdered', orderSource: 'web', paymentChannel: 'bank_transfer',
  total: money, taxTotal: { amount: toMoneyAmount(0), currency: 'TWD' }, customerUserId: 'copy-customer',
  customerName: '測試客戶', shippingAddress: { name: '測試收件人', phone: '0900000000', line: '測試市測試路1號' },
  tierAtCheckout: 'general', invoiceStatus: 'not_issued', invoiceRequested: true, balanceDue: 0,
  cancelledAt: null, displayPosition: null, lines: [item, { ...item, id: 'copy-line-2', variantSku: 'DEMO-002' }],
};

let browser: Browser;
let css: string;
let interactionScript: string;
beforeAll(async () => {
  requireFreshBuild();
  const root = join(__dirname, '../../../.next/static');
  const paths = readdirSync(root, { recursive: true }).filter((path): path is string => typeof path === 'string' && path.endsWith('.css'));
  css = paths.map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
  expect(css).toContain('.order-copy');
  expect(css).toContain('.orders-grid');
  // 使用專案 tsx 已安裝的轉譯器，把真 client 元件放入瀏覽器，沒有重寫複製行為。
  const localRequire = createRequire(import.meta.url);
  const { buildSync } = createRequire(localRequire.resolve('tsx/package.json'))('esbuild') as {
    buildSync: (options: Record<string, unknown>) => { outputFiles: { text: string }[] };
  };
  interactionScript = buildSync({
    stdin: { contents: `
      import { createRoot } from 'react-dom/client';
      import { OrderCopyButton } from './order-copy-button';
      import { TruncationReveal } from './truncation-reveal';
      createRoot(document.getElementById('interactive')).render(<>
        <div className="orders-grid" style={{width:650, margin:40}}>
          <div style={{position:'relative', height:64, padding:8}}>
            <a href="#unexpected-navigation" style={{position:'absolute', inset:0}}>展開訂單</a>
            <div style={{width:130, overflow:'hidden', whiteSpace:'nowrap'}}>
              <OrderCopyButton text label="複製測試長文字" value="DEMO-001 完整測試品名 extended product name for clipboard" />
            </div>
          </div>
        </div>
        <TruncationReveal />
      </>);
    `, resolveDir: __dirname, loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0]!.text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

function html(expanded: boolean) {
  return `<!doctype html><html><head><style>${css}</style></head><body>${renderToStaticMarkup(
    <main style={{ padding: 16 }}>
      <ShippingSelectionProvider>
        <OrdersTable orders={[order]} buildOpenHref={() => expanded ? '/orders' : '/orders?open=copy-order'}
          selectedOrderId={expanded ? order.id : null}
          expanded={expanded ? { orderId: order.id, node: <div>測試展開摘要</div> } : null} />
      </ShippingSelectionProvider>
      <form style={{ maxWidth: 600, marginTop: 24 }}>
        <ShipToEditFields name='測試收件人' phone='0900000000' line='測試市測試路1號' />
      </form>
    </main>,
  )}</body></html>`;
}

describe('甲方案的實際命中區', () => {
  it('長文字氣泡單擊能真的複製，原格外雙擊不穿透；拖曳選字不覆蓋剪貼簿', async () => {
    await serveHtmlAndVisit(browser, `<!doctype html><style>${css}</style><div id="interactive"></div>`, async (page) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.addScriptTag({ content: interactionScript });
      const source = page.getByRole('button', { name: '複製測試長文字' });
      await source.waitFor();
      // 先把滑鼠移出來源，再移入，確保 useEffect 已掛好 hover 監聽。
      await page.mouse.move(5, 5);
      await source.hover();
      const layer = page.locator('[data-truncation-reveal]');
      await layer.waitFor({ state: 'visible' });
      const box = (await layer.boundingBox())!;
      const sourceBox = (await source.boundingBox())!;
      const x = box.x + Math.min(box.width - 10, sourceBox.width + 80);
      const y = box.y + box.height / 2;
      expect(x).toBeGreaterThan(sourceBox.x + sourceBox.width);
      await page.mouse.click(x, y);
      await page.getByRole('status').waitFor();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('DEMO-001 完整測試品名 extended product name for clipboard');
      expect(await layer.isVisible()).toBe(true);
      await page.mouse.dblclick(x, y);
      expect(new URL(page.url()).hash).toBe('');
      expect(await layer.isVisible()).toBe(true);
      expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
      await page.evaluate(async () => {
        window.getSelection()?.removeAllRanges();
        await navigator.clipboard.writeText('原本剪貼簿');
      });
      await page.mouse.move(box.x + 8, y);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.up();
      expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('原本剪貼簿');
      expect(new URL(page.url()).hash).toBe('');
    }, { viewport: { width: 1000, height: 600 } });
  });
  for (const width of [1440, 1920]) {
    for (const expanded of [false, true]) {
      it(`${width}px／${expanded ? '展開' : '收合'}：文字可點、空白仍到訂單連結`, async () => {
        await serveHtmlAndVisit(browser, html(expanded), async (page) => {
          for (const label of ['複製客戶姓名', '複製車款', '複製廠牌', '複製料號', '複製商品名稱']) {
            const target = page.getByRole('button', { name: label }).first();
            await target.click({ trial: true });
            expect(await target.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return el.contains(document.elementFromPoint(r.left + Math.min(12, r.width / 2), r.top + r.height / 2));
            })).toBe(true);
          }
          const blankHit = await page.locator('tbody td.col-qty').first().evaluate((el) => {
            const r = el.getBoundingClientRect();
            return document.elementFromPoint(r.left + 2, r.top + 4)?.closest('a')?.getAttribute('data-nav');
          });
          expect(blankHit).toBe('inline');
          const link = page.locator('a[data-nav="inline"]').first();
          expect(await link.getAttribute('aria-expanded')).toBe(String(expanded));
          // 單號仍完整可見，增加箭頭不能擠掉末碼。
          expect(await link.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const cell = el.closest('td')!.getBoundingClientRect();
            return r.right <= cell.right && r.left >= cell.left;
          })).toBe(true);
          if (expanded) {
            expect(await page.getByRole('button', { name: '複製商品資料' }).count()).toBe(2);
            for (const button of await page.getByRole('button', { name: '複製商品資料' }).all()) await button.click({ trial: true });
          }
          // 用真滑鼠拖曳；不能只以 CSS user-select 的字面當作選字成功。
          const phone = page.getByRole('button', { name: '複製電話' });
          await phone.scrollIntoViewIfNeeded();
          const box = (await phone.boundingBox())!;
          await page.mouse.move(box.x + 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
          await page.mouse.up();
          expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('0900000000');
        }, { viewport: { width, height: 1000 } });
      });
    }
  }

  it('窄版可水平捲到商品複製按鈕，姓名與地址可選取', async () => {
    await serveHtmlAndVisit(browser, html(true), async (page) => {
      const target = page.getByRole('button', { name: '複製商品資料' }).first();
      await target.scrollIntoViewIfNeeded();
      await target.click({ trial: true });
      await page.getByRole('button', { name: '複製地址' }).click({ trial: true });
      expect(await page.getByRole('button', { name: '複製地址' }).textContent()).toBe('測試市測試路1號');
    }, { viewport: { width: 768, height: 1000 } });
  });
});
