import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// 工具列現在 import 搜尋的 server action(它 import `next/headers` ⇒ `server-only`);這裡只渲染靜態 markup,拔掉那兩支。
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
import { serveHtmlAndVisit } from '@/lib/test-support/serve-html-and-visit';
import { OrderToolbar } from './order-toolbar';
import { ORDER_DENSITY_DEFAULT, PANEL_CLOSED } from '../../lib/orders/order-list-view';
import { STATUS_CHIPS } from '../../lib/orders/order-toolbar-view';

// order-toolbar-browser.test.tsx — v22 工具列的**真瀏覽器幾何**(2026-09-13 晚重寫;舊版量的是 08-14 那條
//    35px 單列工具列,連同它的 chip 31px / 390 折行 / 「全部」54px 那組數字一起退場 ——
//    `git show 81f668d41:apps/admin/src/components/orders/order-toolbar-browser.test.tsx`)。
//
// 量什麼(稿是 1440 桌機稿,窄版沒有真權威 ⇒ 只釘「不壞」,不釘窄版長相):
//   · 1440:主列(訂單 · 月份 · 六顆 chip · 搜尋 · 新增)**單行**、無橫向捲軸、六顆 chip 都有計數字
//   · 768:無橫向捲軸(允許折行)、入口鈕與六顆 chip 都打得到自己(沒被蓋住)
//   · 稿的字級真值:h1 16px、chip 12.5px、計數 13px/600、搜尋框 30px 高 260 寬(`tool-final-css.py` 抽)

const DEN = { density: ORDER_DENSITY_DEFAULT, boss: false } as const;
const CONTENT_PADDING = 48;
const SIDEBAR_EXPANDED = 144;
const sidebarAt = (viewport: number) => (viewport < 768 ? 0 : SIDEBAR_EXPANDED);
const ADMIN_SRC = join(__dirname, '../..');

let browser: Browser;
let css = '';

beforeAll(async () => {
  const globals = join(ADMIN_SRC, 'app/globals.css');
  const compiled = await postcss([tailwindcss()] as postcss.AcceptedPlugin[]).process(
    readFileSync(globals, 'utf8'),
    { from: globals },
  );
  css = compiled.css;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
}, 120_000);

type Box = { 文字: string; 寬: number; 高: number; 上: number; 打得到自己: boolean; 字級: number };
type Measured = {
  可用寬: number;
  橫向捲軸: boolean;
  h1字級: number;
  主列單行: boolean;
  rowWidths: string[];
  chip: Box[];
  計數字級: number;
  計數字重: string;
  搜尋框: { 寬: number; 高: number };
  入口鈕: Box | null;
};

async function measure(viewport: number): Promise<Measured> {
  const counts = STATUS_CHIPS.map((c, i) => ({ href: `/orders?c=${c.key}`, count: i * 7 }));
  const markup = renderToStaticMarkup(
    <OrderToolbar
      filter={{}}
      display={DEN}
      panelTarget={PANEL_CLOSED}
      total={13}
      chipCounts={counts}
      now={new Date('2026-09-13T04:00:00Z')}
      datePresetOptions={[{ key: 'm6', label: '近半年', fromYmd: '2026-03-13', toYmd: '2026-09-13' }]}
      selectedDatePresetKey='m6'
      keyword={null}
      keywordMatchCount={null}
      keywordTruncated={false}
    />,
  );
  const shellWidth = viewport - sidebarAt(viewport);
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style></head>
<body class="bg-background text-foreground font-sans antialiased">
<div id="shell" style="width:${shellWidth}px"><div id="content" class="p-6">${markup}</div></div>
</body></html>`;
  return await serveHtmlAndVisit(browser, html, async (page) => {
    await page.setViewportSize({ width: viewport, height: 900 });
    return await page.evaluate((padding) => {
      const content = document.getElementById('content')!;
      const box = (el: HTMLElement): Box => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          文字: (el.textContent ?? '').trim(),
          寬: Math.round(r.width),
          高: Math.round(r.height),
          上: Math.round(r.top),
          打得到自己: hit === el || (hit !== null && el.contains(hit)),
          字級: parseFloat(getComputedStyle(el).fontSize),
        };
      };
      const mainRow = content.querySelector('[data-testid="order-toolbar"] > div')! as HTMLElement;
      const rowKids = [...mainRow.children] as HTMLElement[];
      // 單行判定:每個有高度的子元素,垂直中心都落在同一條線上(spacer 是零高的 flex-1,跳過)。
      const centers = rowKids
        .filter((k) => k.getBoundingClientRect().height > 0)
        .map((k) => Math.round(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2));
      const tops = new Set(centers.map((c) => Math.round(c / 4)));
      const rowWidths = rowKids.map((k) => `${k.tagName}:${Math.round(k.getBoundingClientRect().width)}@${Math.round(k.getBoundingClientRect().top)}`);
      const chips = [...content.querySelectorAll('[role="group"] a[data-chip]')] as HTMLElement[];
      const b = chips[0]!.querySelector('b')! as HTMLElement;
      const search = content.querySelector('form[role="search"]')! as HTMLElement;
      const entry = [...content.querySelectorAll('a')].find((a) => (a.textContent ?? '').includes('新增訂單')) as HTMLElement | undefined;
      const h1 = content.querySelector('h1')! as HTMLElement;
      return {
        可用寬: content.clientWidth - padding,
        橫向捲軸: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        h1字級: parseFloat(getComputedStyle(h1).fontSize),
        主列單行: tops.size === 1,
        rowWidths,
        chip: chips.map(box),
        計數字級: parseFloat(getComputedStyle(b).fontSize),
        計數字重: getComputedStyle(b).fontWeight,
        搜尋框: { 寬: Math.round(search.getBoundingClientRect().width), 高: Math.round(search.getBoundingClientRect().height) },
        入口鈕: entry ? box(entry) : null,
      };
    }, CONTENT_PADDING);
  });
}

describe('v22 工具列 · 真瀏覽器幾何', () => {
  it('1440 桌機:主列單行、無橫向捲軸、六顆 chip 帶計數、稿的字級真值', async () => {
    const m = await measure(1440);
    expect(m.可用寬).toBe(1440 - SIDEBAR_EXPANDED - CONTENT_PADDING);
    expect(m.橫向捲軸).toBe(false);
    expect(m.主列單行, `主列折成兩行 = 稿那一列塞不下:${m.rowWidths.join(' ')}`).toBe(true);
    expect(m.h1字級).toBe(16);
    expect(m.chip).toHaveLength(STATUS_CHIPS.length);
    for (const [i, c] of m.chip.entries()) {
      expect(c.文字, `第 ${i + 1} 顆 chip 要帶計數字`).toBe(`${STATUS_CHIPS[i]!.label}${i * 7}`);
      expect(c.字級).toBe(12.5);
      expect(c.打得到自己).toBe(true);
    }
    expect(m.計數字級).toBe(13);
    expect(m.計數字重).toBe('600');
    expect(m.搜尋框.寬).toBe(260);
    expect(m.搜尋框.高).toBeGreaterThanOrEqual(30);
    expect(m.入口鈕).not.toBeNull();
    expect(m.入口鈕!.打得到自己).toBe(true);
  }, 60_000);

  it('768:允許折行,但無橫向捲軸、入口鈕與六顆 chip 都打得到自己', async () => {
    const m = await measure(768);
    expect(m.橫向捲軸).toBe(false);
    expect(m.入口鈕).not.toBeNull();
    expect(m.入口鈕!.打得到自己).toBe(true);
    for (const c of m.chip) expect(c.打得到自己, `${c.文字} 被蓋住`).toBe(true);
  }, 60_000);

  it('🔴 判別力自檢:同一支量法,拿掉計數 ⇒ chip 文字變短(證明「帶計數字」那格不是恆真)', async () => {
    const markup = renderToStaticMarkup(
      <OrderToolbar
        filter={{}}
        display={DEN}
        panelTarget={PANEL_CLOSED}
        total={13}
        chipCounts={[]}
        now={new Date('2026-09-13T04:00:00Z')}
        datePresetOptions={[]}
        selectedDatePresetKey='m6'
        keyword={null}
        keywordMatchCount={null}
        keywordTruncated={false}
      />,
    );
    expect(markup).toContain('未完成<b');
    expect(markup).toContain('>—</b>');
    expect(markup).not.toContain('>0</b>');
  });
});
