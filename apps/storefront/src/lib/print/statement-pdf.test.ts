// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { buildStatementPdfHtml, findFontPkgInPnpmStore, fontPkgDir } from './statement-pdf';
// 🛑 ⛔ ~~`import { htmlToPdf }`~~ **拿掉了**(codex R1 must-fix):我 import 了它而**一次都沒呼叫**
//    ⇒ 📌 一個「被 import 的函式」讀起來像被測過了, 而那支函式的覆蓋率是 **0**。
//    ⇒ 它為什麼測不到、以及我改用什麼守它, 見本檔最下面那一組。

// statement-pdf 的守門(2026-09-01,⟦b4-MAILPDF1⟧ 前置)。
//
// 🔴 **這一組要證的是一句【被問到而還沒有人證過】的話**:
//    「那條 route 的產檔函式吃的是【一個 React 元素】不是一個網址 ⇒ 餵訂單資料 = 換一個元件」
//    ⇒ 而在這一片之前, 那句話**只是讀碼讀出來的**。這裡把它變成量到的。
//
// ⚠️ **射程(照實寫, 不要讀成別的)**:
//    · 它證得出「餵一份訂單資料 ⇒ 產得出一份自足的 HTML / 一份 PDF」
//    · 它**證不出**「在 Vercel 上產得出來」—— 那條路壞過一次(200 而每個中文是方框),
//      而唯一守它的是 `statement.pdf/statement-pdf-tracing.test.ts`(讀 `.nft.json`),
//      **那支自己寫著「答得出 Next 打算帶哪些檔, 答不出 Vercel 真的帶了」。**

// 🔴 `Money` 是 `{ amount, currency }` 不是一個數字 —— 我第一版寫 `toMoneyAmount(n)` 就直接
//    回一個 branded number ⇒ `order.total.amount` 是 `undefined` ⇒ `toLocaleString` 當場炸。
//    📌 而 TypeScript **沒有攔住它** ⇒ 抓到它的是這支測試自己跑了一發。
const twd = (amount: number) => ({ amount: toMoneyAmount(amount), currency: 'TWD' as const });

/** 12 項的訂單 —— 刻意不是 1 項:`maxDuration = 60` 那個估值要有個【接近上限】的樣本。 */
function orderFixture(itemCount: number): MemberOrderDetail {
  return {
    id: 'o1',
    displayId: 'A1B2C3',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    paymentMethod: 'tappay',
    paidAt: '2099-04-18T03:00:00Z',
    shippedAt: null,
    allItemsShipped: false,
    subtotal: twd(12000),
    shippingFee: twd(100),
    discountTotal: twd(0),
    total: twd(12100),
    shippingMethod: 'home',
    shippingAddress: {
      name: '王小明',
      phone: '0912345678',
      line: '新北市新莊區化成路 736 巷 18 號',
    },
    cancelledAt: null,
    cancelKind: 'none',
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: `oi${i + 1}`,
      variantSku: `SKU-${i + 1}`,
      brand: 'CNC RACING',
      title: `碳纖維下鏈條蓋 第 ${i + 1} 項`,
      spec: { color: 'black' },
      imageUrl: null,
      vehicle: null,
      quantity: 1,
      unitPrice: twd(1000),
      lineTotal: twd(1000),
    })),
    itemCount,
    itemsTruncated: false,
  };
}

// 🔵 直接餵 `order` —— codex R1 之後本函式不收元素了(`printButton: false` 鎖在它裡面)。
const el = (n: number) => orderFixture(n);

describe('statement-pdf · 它吃得下訂單資料嗎', () => {
  it('🔴 餵一份訂單 ⇒ 產得出【自足的】HTML(字型內嵌、對外請求 0)', async () => {
    const built = await buildStatementPdfHtml(el(12));
    // 🔴 前提斷言:訂單的字真的進去了。少了它, 一份空殼 HTML 也會過下面每一格。
    expect(built.html).toContain('A1B2C3');
    expect(built.html).toContain('王小明');
    expect(built.html).toContain('第 12 項');
    // 🔴🔴 **自足** = 字型是 data: URI, 而**沒有任何一個對外的 http(s) 資源**。
    //    那是這條路的全部設計理由(route 檔頭:「對外網路請求 0」)。
    expect(built.html).toContain('data:font/woff2;base64,');
    const external = [...built.html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect({ 對外資源: external }).toEqual({ 對外資源: [] });
    // 🔵 而這三個數字是那條 route 的**政策判準**在讀的東西 ⇒ 它們要真的被算出來。
    expect(built.embedded).toBeGreaterThan(0);
    expect(built.missingCss).toBe(false);
  });

  it('🔴🔴 版面 CSS 讀不到 ⇒ `missingCss` 要翻成 true(那是 route 拒絕產檔的判準之一)', async () => {
    // 🔴 **這一格是跑突變才發現要加的**:我原本只在快樂路徑斷言 `missingCss === false`,
    //    而把 `missingCss: pageCss.length === 0` 改成 `missingCss: false` ⇒ **兩格照樣全綠**
    //    ⇒ 📌 **我斷言的那個值, 在【正確計算】與【寫死 false】兩個世界一模一樣。**
    //    ⇒ ⇒ 而它承重:route 用它決定要不要回 500(一張沒有任何樣式的紙不得寄給客人)。
    // 🔵 造法:版面 CSS 是從 `process.cwd()` 底下兩個候選路徑讀的 ⇒ **把 cwd 換到一個空目錄**
    //    ⇒ 兩個候選都讀不到。而字型走 `require.resolve` ⇒ **不受 cwd 影響**
    //    ⇒ ⇒ 所以這一發只動 CSS 那一軸, 而 `embedded` 仍然 > 0(那正是本格的判別力來源)。
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const here = process.cwd();
    const empty = mkdtempSync(join(tmpdir(), 'pcm-nocss-'));
    try {
      process.chdir(empty);
      const built = await buildStatementPdfHtml(el(1));
      expect({ missingCss: built.missingCss }).toEqual({ missingCss: true });
      // 🔴 而字型那一軸要**仍然是好的** —— 否則這一格證的是「什麼都讀不到」, 不是「CSS 讀不到」。
      expect(built.embedded).toBeGreaterThan(0);
    } finally {
      process.chdir(here);
    }
  });

  it('🔴🔴 產出的 HTML 裡【沒有任何一個非 data: 的資源引用】—— 那是「對外請求 0」的實體', async () => {
    // 🔴 **這一格是 codex R1 must-fix 補的, 而它守的是一個【我原本只是宣稱】的性質**:
    //    `htmlToPdf` **沒有**攔截 Chrome 的請求 ⇒ 「對外網路請求 0」不是那裡強制的,
    //    是**這份 HTML 的內容碰巧沒有對外引用**。
    //    ⇒ ⇒ 📌 元件或 CSS 哪天長出一個 `url(https://…)` / `@import` / `srcset`,
    //      **伺服器就會真的去抓它**(對外, 或對內網 ⇒ SSRF 面)⇒ 而那時只有這一格會叫。
    // ⚠️ **射程**:它掃的是**這份 HTML 的字面**。攔不住 JS 在瀏覽器裡動態產生的請求
    //    (這份紙沒有 script, 而「沒有 script」本身也在下面那一格釘著)。
    const built = await buildStatementPdfHtml(el(12));
    const refs = [
      ...[...built.html.matchAll(/\burl\(\s*['"]?([^'")]+)/g)].map((m) => m[1]),
      ...[...built.html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
      ...[...built.html.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+)/g)].map((m) => m[1]),
      ...[...built.html.matchAll(/\bsrcset\s*=\s*"([^"]+)"/g)].map((m) => m[1]),
    ].filter((u): u is string => typeof u === 'string');
    // 🔴 前提斷言:真的抽到東西了。抽到 0 個 ⇒ 下面那格恆綠(而這份紙一定有字型 url())。
    expect({ 抽到的資源引用數: refs.length > 0 }).toEqual({ 抽到的資源引用數: true });
    const nonData = refs.filter((u) => !u.startsWith('data:'));
    expect({ 非data的資源引用: nonData }).toEqual({ 非data的資源引用: [] });
    // 🔴 而「沒有 script」要一起釘 —— 有了 script, 上面那個字面掃描就不再是完整的分母。
    expect({ script標籤: /<script[\s>]/i.test(built.html) }).toEqual({ script標籤: false });
  });

  it('🔴 負對照:換一份【不同的】訂單 ⇒ 產出的 HTML 要跟著變(否則上一格是恆真)', async () => {
    const a = await buildStatementPdfHtml(el(1));
    const b = await buildStatementPdfHtml(el(12));
    // 少了這一格,「它把訂單畫進去了」與「它回一份固定樣板」印同一個綠。
    expect(a.html).not.toEqual(b.html);
    expect(a.html).not.toContain('第 12 項');
    expect(b.html).toContain('第 12 項');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// `htmlToPdf` —— 🛑 **它在本機【執行不了】, 而這一組是退而求其次的替代品**
// ══════════════════════════════════════════════════════════════════════════
// 🔴 **為什麼執行不了(量到的, 不是推的)**:`@sparticuz/chromium` 是 **Linux binary**
//    ⇒ macOS 上跑它 ⇒ `Error: spawn ENOEXEC`(2026-09-01 實測)。
// 🔴 **而我第一版做錯的事**(codex R1 must-fix):我 `import { htmlToPdf }` 而**一次都沒呼叫**
//    ⇒ 📌 一支被 import 的函式讀起來像被測過了, 而它的覆蓋率是 **0** ——
//      刪掉 `fonts.ready` / 改成 Letter / 關掉 `printBackground` / 忘了 `browser.close()`
//      ⇒ **上面每一格照樣全綠**。
// ✅ **替代品 = 掃它自己的原始碼**。這很弱, 而它殺得掉上面那四個突變, 所以它不是零。
// 🛑 **它證不到的**:那些參數**真的產出一份對的 PDF** ——
//    那要一個跑得動 `@sparticuz/chromium` 的環境(Linux 容器 / 真部署), 而那不在這一片。
describe('htmlToPdf · 本機執行不了 ⇒ 只釘得住它的形狀', () => {
  const src = readFileSync(join(__dirname, 'statement-pdf.ts'), 'utf8');

  it('🔴 前提斷言:真的讀到那支檔(讀到空字串 ⇒ 下面每一格恆綠)', () => {
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain('export async function htmlToPdf');
  });

  it('🔴 四個【改了客人就會拿到不同的紙】的參數, 逐個釘', () => {
    for (const must of [
      "format: 'A4'",            // 改成 Letter ⇒ 紙的尺寸就變了
      'printBackground: true',   // 關掉 ⇒ 底色/框線全部不見
      'document.fonts.ready',    // 刪掉 ⇒ 字型還沒載完就截圖 ⇒ 可能是方框
      'await browser.close()',   // 漏掉 ⇒ 殘留行程(平台強殺時本來就不保證, 更不能自己也漏)
    ]) {
      expect({ [must]: src.includes(must) }).toEqual({ [must]: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 `findFontPkgInPnpmStore` —— 修法【丁】的本體,而**它在本機跑不到**
//
// `fontPkgDir()` 的候選①(`require.resolve`)在本機**一定會過** ⇒ 候選②永遠不被執行到。
// 🛑 **而候選② 正是【只在 Vercel 才走】的那條路** —— 2026-09-03 18:40 正式站逐字
//    `拒絕產檔 … 內嵌 0 · 拿不到字型檔 0 · 版面 CSS 缺 false · 字型套件=null`
//    ⇒ 那邊 `require.resolve` throw, 而**同一支函式裡 `process.cwd()` 相對讀檔是成功的**
//      (`版面 CSS 缺 false` 就是它的讀數)⇒ 丁照抄那個已經會動的形狀。
//
// ⇒ ✅ 收成 `cwd` 參數 + 具名 export ⇒ **餵一個假的 store 佈局就走得到它, 不必等部署。**
// 🛑🛑 **而本組證不到什麼(寫在最前面, 不要讀漏)**:
//    它證的是**這段挑選邏輯**對得起來;**證不到 Vercel 的函式裡那棵檔案樹長什麼樣**。
//    ⇒ 丙就是死在那一格(本機 `.nft.json` 讀數是好的, 而正式站仍然 `null`)。
//    ⇒ **丁成功的定義仍然在正式站:打那個網址, 那張紙上的中文是【字】不是方框。**
//      🔴 **不要看 log** —— 成功時 route 回 200, 而那行只住在 500 分支。
describe('findFontPkgInPnpmStore · 丁的本體(本機跑不到的那條路)', () => {
  const PREFIX = '@fontsource+noto-sans-tc@';
  /**
   * 造一棵假的 pnpm store。`usable=false` ⇒ **目錄在而執行時要讀的檔不在**。
   * 🔴 造的是 `400.css` / `700.css` **而不是 `package.json`** —— 判準 2026-09-03 改了
   *    (code-reviewer must-fix:`package.json` 是代理, 執行時真正讀的是這兩支)。
   */
  const makeStore = (versions: string[], usable = true) => {
    const root = mkdtempSync(join(tmpdir(), 'pcm-fontstore-'));
    // cwd 會是 <root>/apps/storefront ⇒ `../../node_modules/.pnpm` 就是 <root>/node_modules/.pnpm
    const cwd = join(root, 'apps', 'storefront');
    mkdirSync(cwd, { recursive: true });
    for (const v of versions) {
      const dir = join(root, 'node_modules', '.pnpm', PREFIX + v, 'node_modules', '@fontsource', 'noto-sans-tc');
      mkdirSync(dir, { recursive: true });
      if (usable) {
        writeFileSync(join(dir, '400.css'), '');
        writeFileSync(join(dir, '700.css'), '');
      }
    }
    return { root, cwd };
  };

  it('🟢 前提斷言:真的 repo 佈局找得到(否則下面每一格都在測一個假世界)', () => {
    // 🔴 這一格餵的是**真的 apps/storefront**, 走的是 base①(`../../node_modules/.pnpm`)——
    //    也就是正式站量到 `cwd=/var/task/apps/storefront` 的那一種形狀。
    const got = findFontPkgInPnpmStore(resolve(process.cwd(), 'apps/storefront'));
    expect(got, '真 repo 上都找不到 ⇒ 丁的路徑推導本身就錯了').not.toBeNull();
    expect(got).toContain(PREFIX);
  });

  it('🔴 假 store · 一支版本 ⇒ 回那一支', () => {
    const { root, cwd } = makeStore(['5.3.0']);
    try {
      expect(findFontPkgInPnpmStore(cwd)).toBe(
        join(root, 'node_modules', '.pnpm', PREFIX + '5.3.0', 'node_modules', '@fontsource', 'noto-sans-tc'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('🔴 命中多支 ⇒ 決定性地取排序後第一支(不是「隨便一支」)', () => {
    // 🛑 這一格釘的是**決定性**, 不是「挑到最新」—— 註解裡寫明了它是字典序。
    //    兩次部署嵌到不同版本的字型, 是一個**沒有任何東西會叫**的壞法。
    const { root, cwd } = makeStore(['5.3.0', '4.9.0', '5.10.0']);
    try {
      expect(findFontPkgInPnpmStore(cwd)).toContain(PREFIX + '4.9.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('🔴 目錄在而【要讀的那兩支 CSS】不在 ⇒ 回 null(不要回一條讀不到東西的路徑)', () => {
    // 🎯 這正是丙的失敗形狀:**位元組/目錄在, 而那個套件不成立。**
    const { root, cwd } = makeStore(['5.3.0'], false);
    try {
      expect(findFontPkgInPnpmStore(cwd)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('🔵 負對照:store 裡沒有這個套件 ⇒ null(證明上面不是恆真)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pcm-fontstore-empty-'));
    const cwd = join(root, 'apps', 'storefront');
    mkdirSync(join(root, 'node_modules', '.pnpm', '@zzq9137never@1.0.0'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    try {
      expect(findFontPkgInPnpmStore(cwd)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('🔵 base② 也要會動:cwd 就是 repo 根的那一種佈局', () => {
    // 🔴 兩個 base 對齊 `cssCandidates` 的兩個候選 ⇒ 只驗 base① 的話, 第二條是死碼而沒人知道。
    const root = mkdtempSync(join(tmpdir(), 'pcm-fontstore-root-'));
    const dir = join(root, 'node_modules', '.pnpm', PREFIX + '5.3.0', 'node_modules', '@fontsource', 'noto-sans-tc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '400.css'), '');
    writeFileSync(join(dir, '700.css'), '');
    try {
      expect(findFontPkgInPnpmStore(root)).toBe(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 `fontPkgDir` 的【候選①→②接縫】—— code-reviewer 2026-09-03 must-fix
//
// **它為什麼要單獨一組**:我原本三發突變**全在 `findFontPkgInPnpmStore` 內部**,
// 而 reviewer 實測「把候選① 改成 `return null` ⇒ **12 格全綠**」
// ⇒ 📌 **沒有任何一格證明 `fontPkgDir()` 真的接上了候選②。**
// ⇒ ⇒ 🎯 **我為候選②做的推理(「只在正式站走 ⇒ 要能餵它」)在【往上一層】停了一步** ——
//    測得到那個函式, 不等於測得到「有沒有人呼叫它」。
describe('fontPkgDir · 候選①→② 的接縫', () => {
  const PREFIX = '@fontsource+noto-sans-tc@';
  const makeUsable = () => {
    const root = mkdtempSync(join(tmpdir(), 'pcm-seam-'));
    const cwd = join(root, 'apps', 'storefront');
    mkdirSync(cwd, { recursive: true });
    const dir = join(root, 'node_modules', '.pnpm', PREFIX + '5.3.0', 'node_modules', '@fontsource', 'noto-sans-tc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '400.css'), '');
    writeFileSync(join(dir, '700.css'), '');
    return { root, cwd, dir };
  };

  it('🔴 候選① throw(= Vercel 那一種)⇒ 真的落到候選②', () => {
    const { root, cwd, dir } = makeUsable();
    try {
      expect(
        fontPkgDir(() => {
          throw new Error('MODULE_NOT_FOUND');
        }, cwd),
      ).toBe(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('🔴 候選①【成功但目錄不可用】⇒ 也要落到候選②(不是回那條讀不到東西的路徑)', () => {
    // 🎯 這一格是 reviewer 的第一條 must-fix:判「非 null」與判「可用」是兩件事。
    const { root, cwd, dir } = makeUsable();
    const emptyDir = mkdtempSync(join(tmpdir(), 'pcm-seam-empty-'));
    try {
      expect(fontPkgDir(() => join(emptyDir, 'package.json'), cwd)).toBe(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('🟢 正對照:候選① 可用 ⇒ 用它, 不往下走(否則上面兩格可能是恆真)', () => {
    const { root, cwd, dir } = makeUsable();
    const winner = mkdtempSync(join(tmpdir(), 'pcm-seam-win-'));
    writeFileSync(join(winner, '400.css'), '');
    writeFileSync(join(winner, '700.css'), '');
    try {
      expect(fontPkgDir(() => join(winner, 'package.json'), cwd)).toBe(winner);
      expect(fontPkgDir(() => join(winner, 'package.json'), cwd)).not.toBe(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(winner, { recursive: true, force: true });
    }
  });

  it('🔵 兩個 base 同時命中 ⇒ base① 贏(釘住註解那句「base① 優先」)', () => {
    // 🔴 reviewer nit:我原句寫「取排序後第一支」而實作是「base① 優先, base 內字典序」
    //    ⇒ 這一格把【實作的語意】釘住, 免得下次有人照註解改。
    const root = mkdtempSync(join(tmpdir(), 'pcm-seam-2base-'));
    const cwd = join(root, 'apps', 'storefront');
    mkdirSync(cwd, { recursive: true });
    const mk = (base: string, v: string) => {
      const d = join(base, 'node_modules', '.pnpm', PREFIX + v, 'node_modules', '@fontsource', 'noto-sans-tc');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, '400.css'), '');
      writeFileSync(join(d, '700.css'), '');
      return d;
    };
    const base1 = mk(root, '5.10.0'); // ../../ 那個 base
    mk(cwd, '4.9.0'); // cwd 自己底下那個 base
    try {
      expect(findFontPkgInPnpmStore(cwd)).toBe(base1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
