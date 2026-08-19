// 片10 證偽用量具 —— container-type 會不會讓子孫的 position:fixed 被困住?
// 用法: npx playwright ... 見檔尾;引擎由 argv[2] 指定 (webkit|chromium|firefox)
// 由絕對路徑載入:本 worktree 沒有自己的 node_modules(worktree 不共用),
// 而主樹的 pnpm store 有 playwright-core。要換機器跑就改這一行。
import { webkit, chromium, firefox } from '/Users/sean_1/pcm-website-v2/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs';

const ENGINES = { webkit, chromium, firefox };
const name = process.argv[2] || 'webkit';
const engine = ENGINES[name];
if (!engine) { console.error(`未知引擎 ${name}`); process.exit(2); }

// 逐字對應 apps/admin/src/app/@panel/orders/page.tsx 那個 div 的 class:
//   @container sticky top-0 max-h-svh overflow-y-auto border-l p-4
const REAL_PANEL =
  'container-type:inline-size;position:sticky;top:0;max-height:100svh;' +
  'overflow-y:auto;border-left:1px solid #ccc;padding:16px;';

const CASES = [
  ['負對照 · 無任何 containment',      ''],
  ['受測 A · 真面板完整組合',           REAL_PANEL],
  ['受測 B · 只有 container-type:inline-size', 'container-type:inline-size;'],
  ['受測 C · container-type:size',      'container-type:size;'],
  ['正對照 D · contain:layout',         'contain:layout;'],
  ['正對照 E · transform:translateZ(0)','transform:translateZ(0);'],
  ['正對照 F · filter:blur(0)',         'filter:blur(0px);'],
];

const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.setContent('<!doctype html><meta charset=utf-8><body style="margin:0;height:2000px">');

const out = await page.evaluate((cases) => {
  const vw = innerWidth, vh = innerHeight;
  const rows = cases.map(([label, css]) => {
    const host = document.createElement('div');
    host.style.cssText = 'width:576px;height:300px;' + css;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;';
    host.appendChild(ov); document.body.appendChild(host);
    const b = ov.getBoundingClientRect();
    const w = Math.round(b.width), h = Math.round(b.height);
    const applied = getComputedStyle(host).containerType || '(n/a)';
    host.remove();
    return { label, size: `${w}x${h}`, trapped: !(w === vw && h === vh), containerType: applied };
  });
  return { viewport: `${vw}x${vh}`, ua: navigator.userAgent, rows };
}, CASES);

console.log(`引擎: ${name}   viewport: ${out.viewport}`);
console.log(`UA: ${out.ua}\n`);
for (const r of out.rows) {
  console.log(`${r.trapped ? '被困住  ' : '未被困  '} ${r.size.padEnd(10)} container-type=${String(r.containerType).padEnd(12)} ${r.label}`);
}

// 🔴 自檢:量具必須雙向表演得出來,否則整發作廢
const pos = out.rows.filter((r) => r.label.startsWith('正對照'));
const neg = out.rows.filter((r) => r.label.startsWith('負對照'));
const ok = pos.length > 0 && pos.every((r) => r.trapped) && neg.every((r) => !r.trapped);
console.log(`\nselfCheck.ok = ${ok}   (正對照 ${pos.filter(r=>r.trapped).length}/${pos.length} 被困, 負對照 ${neg.filter(r=>!r.trapped).length}/${neg.length} 未被困)`);
if (!ok) { console.log('🔴 自檢失敗 ⇒ 本發量測作廢,不得引用'); process.exitCode = 1; }
await browser.close();
