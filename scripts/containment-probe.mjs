// 片10 證偽用量具 —— container-type 會不會讓子孫的 position:fixed 被困住?
// 用法: npx playwright ... 見檔尾;引擎由 argv[2] 指定 (webkit|chromium|firefox)
// 📌 考古用(2026-08-19,W2):下面這段 import 的改動,**實際上是隨 `88804080`
//    「merge(w1-order-panel): 出貨區收件人…」進入 dev 的** —— 那顆 merge 的訊息一個字
//    沒提本檔,所以 `git log -- <本檔>` 那條路在此中斷過一次。審查歸屬:**主視窗(非作者)
//    逐行看過該 diff,PASS + 1 nit**;而**那件事在 git 裡沒有痕跡**,因為 merge 路徑
//    繞過 reviewer gate。
//    🔴 成因不是有人不小心:**merge 會帶走【當下共用索引裡的一切】,而做 merge 的窗
//    看不到那些是誰的**(七個窗共用同一棵工作樹、同一個索引、同一個 git 身分
//    `probe <probe@local>` ⇒ `%an` 對「誰做的」判別力為零)。⇒ 別寫「以後小心」那種規則。
//
// 從 apps/admin 的位置解析 playwright(它是那個 app 的直接依賴)。
// 🔴 為什麼不寫 `import ... from 'playwright'`:本檔在 scripts/,而 pnpm 是嚴格解析 ——
//    repo 根的 node_modules **沒有** playwright 頂層連結(實查:`ls -d node_modules/playwright-core` ⇒ 不存在)
//    ⇒ 裸 specifier 從這裡解不到。用 createRequire 指到 apps/admin 才解得到。
// 🔴 為什麼不再寫絕對路徑:原本那行釘死了機器路徑與 `playwright-core@1.60.0` 這個版本目錄
//    ⇒ 換機器、換人、或 playwright 升版都會壞。改成這樣之後三者都不影響。
// ⚠️ 前提:`apps/admin` 跑過 `pnpm install`。沒跑過會 MODULE_NOT_FOUND —— **會大聲,不會假綠**。
import { createRequire } from 'node:module';
const requireFromAdmin = createRequire(new URL('../apps/admin/package.json', import.meta.url));
// ⚠️ 這裡吃的是【檔案系統路徑】,POSIX 可以;搬到非 POSIX 平台(Windows/CI)要用
//    `pathToFileURL()` 包成 file:// URL 才穩。本 repo 只跑在 macOS ⇒ 現在不加。
const playwright = await import(requireFromAdmin.resolve('playwright'));
// playwright 是 CJS ⇒ 具名匯出掛在 default 上(實測:直接取 m.webkit 是 undefined)
const { webkit, chromium, firefox } = playwright.default ?? playwright;

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
