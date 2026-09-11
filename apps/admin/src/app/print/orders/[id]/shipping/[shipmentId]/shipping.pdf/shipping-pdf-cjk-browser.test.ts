// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 🔴 本檔載入 `@pcm/pdf`, 而它(間接)碰到帶 `import 'server-only'` 的模組 ⇒ 逐檔 mock(本 repo 既有處置)。
vi.mock('server-only', () => ({}));
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { buildStatementHtml, isInsideDir, resolveFontPkgs } from '@pcm/pdf';

// shipping-pdf-cjk-browser.test.ts — ⟦f3-SHIPPDF1⟧ **P-3:後台這一側各自量**。
//
// 🛑🛑 **為什麼不能沿用顧客站的讀數 —— 這是 plan 自己下的判準, 我照著做**
//    `~/pcm-mailbox/線-出貨-plan-412-伺服器產PDF-20260830.md` 逐字:
//    「`P-3` 後台這一側【各自】量體積與字型 —— 🔴 **不得沿用顧客站的讀數(兩個 app 各自打包)**」
//    ⇒ 顧客站那支 `statement-pdf-cjk-browser.test.ts` 綠, 只證明 **storefront** 那個包裡字型在。
//      admin 是**另一個 Next app、另一份 node_modules 解析、另一次打包**。
//
// 🔴🔴 **而這一族最要緊的一句(顧客站那支已經記過, 這裡是【各自】驗它成不成立)**:
//    **「PDF 文字層抽得到中文」≠「中文字型嵌進去了」。**
//    Chrome 就算拿不到字形, 照樣把字元寫進文字層 ⇒ 文字層那把尺對「字型有沒有嵌」**零判別力**,
//    而客人/員工看到的是**字形**。⇒ 兩件事各有各的尺, 不能拿一把代替另一把。
//
// 🔵 走的是 **route 那一條真鏈**:`resolveFontPkgs()` → 讀 400/700 的 `@font-face` CSS →
//    `buildStatementHtml({ bodyHtml, pageCss, fontCss, readFont })` —— 與
//    `shipping.pdf/route.ts:104-145` 同一組零件, 而不是抄顧客站的組法。
// 🛑 `gs` 不在 ⇒ `execFileSync` throw ⇒ 本檔**紅**。「沒有 gs 所以跳過」與「抽出來都對所以通過」
//    在報表上長得一樣。

/** 與 route 同一條:兩個字型套件的 400/700 `@font-face` CSS 併起來。 */
function adminFontCss(): { css: string; pkgs: string[] } {
  const { latin, tc } = resolveFontPkgs();
  const pkgs = [latin, tc].filter((d): d is string => d !== null);
  const css = pkgs
    .flatMap((dir) =>
      ['400.css', '700.css'].map((f) => {
        try {
          return readFileSync(join(dir, f), 'utf8');
        } catch {
          return null;
        }
      }),
    )
    .filter((s): s is string => s !== null)
    .join('\n');
  return { css, pkgs };
}

/** 一份帶中文的最小出貨單身體 —— 這裡只要它**有中文而且可變**。 */
function bodyOf(title = '碳纖維下鏈條蓋'): string {
  return (
    `<div data-slot="shipping-doc"><h1>出貨單</h1>` +
    `<p>收件人:王小明</p><p>地址:新北市新莊區化成路 736 巷 18 號</p>` +
    `<p>品名:${title}</p></div>`
  );
}

function buildAdminHtml(title?: string, breakFonts = false) {
  const { css, pkgs } = adminFontCss();
  const built = buildStatementHtml({
    bodyHtml: bodyOf(title),
    pageCss: 'body{font-family:"Noto Sans TC","Noto Sans",sans-serif}',
    // 🔴 「拔掉字型」= 把 `@font-face` 那一整份 CSS 換成空的 ⇒ 沒有任何字型可嵌。
    fontCss: breakFonts ? '' : css,
    readFont: (rel) => {
      for (const dir of pkgs) {
        const p = resolve(dir, rel);
        // 🔴 防目錄逃逸 —— 逐支各判一次(照 route 的寫法)。
        if (!isInsideDir(dir, p)) continue;
        if (existsSync(p)) return new Uint8Array(readFileSync(p));
      }
      return null;
    },
  });
  return built;
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
// 🔴 `afterAll` 的 timeout 要與 `beforeAll` 一樣長 —— 不對稱會在機器忙時變成
//    「檔案紅、零個測試紅」, 而重跑就綠 ⇒ 最容易被誤記成 flake。
afterAll(async () => {
  await browser?.close();
}, 120_000);

/** 印成真的 `.pdf`, 回文字層與原始位元組兩個讀數。 */
async function pdfOf(html: string): Promise<{ text: string; bytes: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'pcm-admin-cjk-'));
  const htmlPath = join(dir, 'x.html');
  const pdfPath = join(dir, 'x.pdf');
  writeFileSync(htmlPath, html, 'utf8');
  const page = await browser.newPage();
  try {
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    // 🛑 這一族真正要等的是【字型套上】—— 版面與字形都靠它。
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  } finally {
    await page.close();
  }
  execFileSync('gs', ['-sDEVICE=txtwrite', '-dNOPAUSE', '-dBATCH', '-o', join(dir, 'p%d.txt'), pdfPath], {
    stdio: 'ignore',
  });
  const files = readdirSync(dir).filter((f) => /^p\d+\.txt$/.test(f));
  // 🔴 前提斷言:gs 真的吐出頁了。0 頁 ⇒ 下面每一格在空字串上比對 ⇒ 全是假綠。
  expect(files.length, 'gs 抽出來的頁數(0 ⇒ 這把尺沒接上, 不是「PDF 正常」)').toBeGreaterThan(0);
  return {
    text: files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n'),
    bytes: readFileSync(pdfPath).toString('latin1'),
  };
}

/** PDF 裡嵌了幾個 TrueType 字型子集, 以及字型名提到 Noto 幾次。 */
function fontEvidence(bytes: string): { fontFile2: number; noto: number } {
  return {
    fontFile2: (bytes.match(/FontFile2/g) ?? []).length,
    noto: (bytes.match(/Noto/g) ?? []).length,
  };
}

describe('⟦f3-SHIPPDF1⟧ P-3 · 後台 shipping.pdf —— admin 這一側【各自】量', () => {
  it('🔬 前提:admin 這個 app 自己解析得到兩支字型套件(不是「顧客站有」)', () => {
    const { latin, tc } = resolveFontPkgs();
    // 🔴 少了這一格, 下面每一格在「字型套件根本找不到」的世界裡會用【別的理由】紅,
    //    而讀的人會去查錯的地方。
    expect({ latin: latin !== null, tc: tc !== null }).toEqual({ latin: true, tc: true });
    const { css } = adminFontCss();
    expect(css.length, '400/700 的 @font-face CSS 讀成空的').toBeGreaterThan(0);
  });

  it('🔴 中文從 HTML 一路活到 PDF 的【文字層】', async () => {
    const built = buildAdminHtml();
    expect(built.html).toContain('王小明');
    const { text } = await pdfOf(built.html);
    expect(text, '收件人姓名沒有活到 PDF 文字層').toContain('王小明');
    expect(text, '品名沒有活到 PDF 文字層').toContain('碳纖維下鏈條蓋');
    expect(text, '地址沒有活到 PDF 文字層').toContain('新莊區');
  }, 120_000);

  it('🔴🔴 中文【字型子集】真的被嵌進 admin 產的 PDF', async () => {
    const built = buildAdminHtml();
    // 🔵 `embedded` 是 buildStatementHtml 自己算的 —— 先釘住它, 否則下一格可能在
    //    「一個字型都沒嵌進 HTML」的世界裡用別的理由紅。
    expect(built.embedded, 'HTML 這一端就沒嵌任何字型').toBeGreaterThan(0);
    const ev = fontEvidence((await pdfOf(built.html)).bytes);
    expect(ev.fontFile2, 'PDF 裡一個 TrueType 字型子集都沒有 ⇒ 中文會是豆腐').toBeGreaterThan(0);
    expect(ev.noto, '字型名裡找不到 Noto ⇒ 嵌進去的不是我們送的那套中文字型').toBeGreaterThan(0);
  }, 120_000);

  it('⚪ 負對照:一個不在這張紙上的中文詞, PDF 裡不該有', async () => {
    const { text } = await pdfOf(buildAdminHtml().html);
    expect(text).not.toContain('這個詞不可能出現在出貨單上');
  }, 120_000);

  // 🔴 **只在 macOS 跑這一格**(Sean 2026-09-11 拍甲「GitHub 上先不跑這一小步, 在 Mac 上照樣跑」;只跳這一格):
  //    Linux 的 Chrome 沒字型就連文字層都印不出, 造不出「拔字型而文字仍在」的世界。
  //    📎 CI 讀數見顧客站那支 `statement-pdf-cjk-browser.test.ts` 同一格的註解(同一個原因, 本檔 CI 讀到 fontFile2 = 2)。
  //    ⚠️ 其餘格(前提、文字層、字型有嵌、負對照、尺的完整性)在 Linux 照跑。
  it.skipIf(process.platform !== 'darwin')('🔴🔴 量具自檢:拔掉字型 ⇒ 【字型那把尺】要歸零, 而【文字層那把尺】照樣抽得到', async () => {
    // 🛑 兩個斷言各證一件事, 而第二件是這一族的核心誤解:
    //    ① 字型那把尺有判別力(拔掉 ⇒ FontFile2 / Noto 掉到 0)
    //    ② 文字層那把尺對這個世界**沒有**判別力(照樣抽得到中文)
    //    ⇒ ② 寫成斷言是為了讓「有一天它變了」會紅 —— 那時該重讀本檔, 不是照抄。
    const built = buildAdminHtml(undefined, true);
    expect(built.embedded, '拔掉之後 HTML 端仍嵌著字型 ⇒ 這一發沒有造出那個世界').toBe(0);
    const { text, bytes } = await pdfOf(built.html);
    expect(fontEvidence(bytes), '拔掉字型之後 PDF 仍嵌著字型 ⇒ 上面那格沒有判別力').toEqual({
      fontFile2: 0,
      noto: 0,
    });
    expect(text, '⚠️ 這一格【期望它仍抽得到】—— 它紅了代表文字層那把尺的行為變了').toContain(
      '碳纖維下鏈條蓋',
    );
  }, 120_000);

  it('🔴🔴 尺的完整性:換一份內容 ⇒ 抽出來的字要跟著換(這一格殺得死「把 text 寫死」)', async () => {
    // 🛑 顧客站那支是**突變逼出來的**:把 `text` 改成一個寫死的字串 ⇒ 其餘格全綠
    //    ⇒ 一組「這幾個字在不在」的斷言, 分不出【從 PDF 抽出來的】與【一個常數】。
    const ta = (await pdfOf(buildAdminHtml('甲品名獨有詞').html)).text;
    const tb = (await pdfOf(buildAdminHtml('乙品名獨有詞').html)).text;
    expect(ta).toContain('甲品名獨有詞');
    expect(tb).toContain('乙品名獨有詞');
    expect(ta, '甲那份抽到了乙的品名 ⇒ 這把尺讀的不是那份文件').not.toContain('乙品名獨有詞');
    expect(tb, '乙那份抽到了甲的品名 ⇒ 這把尺讀的不是那份文件').not.toContain('甲品名獨有詞');
  }, 120_000);
});
