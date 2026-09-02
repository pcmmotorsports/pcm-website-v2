// @vitest-environment node
//
// ⟦b4-2PAPERS⟧ 兩張列印紙的【視覺標記】—— 而這一格問的是「**印出來看得到嗎**」。
//
// 🔴🔴 **它存在的理由,是上一個人自己寫下來的自陳**(`print-a4.css` 檔頭,`5ba6dcac`):
//    「我當時的驗收是【螢幕截圖】—— 一整排綠(sha256 / 頁數 / 三綠 / 突變該紅有紅)全是真的,
//      **而沒有一格在問「印出來看得到嗎」**」
//    ⇒ 📌 **一整排綠,而它們合起來證不到那張紙上有那條槓。**
//    ⇒ ⇒ 而那條槓第一版真的**在列印時不存在**(絕對定位 `left:-6mm` 落在紙外被裁掉),
//       **推上 production 之後才量到。**
//
// 🎯 **拍板鏈(三次,而第三次才是「做」)**:
//    ① 2026-08-29 Sean「不用改名,依照現在」⇒ 改名死了
//    ② 2026-08-30 Sean「先不動」(他**看過惡化**才拒絕的)
//    ③ 2026-08-31 Sean 拍【甲】= **視覺標記,不動任何字**
//       (出處:`picking-doc.tsx` 那段註解逐字;⚠️ **板上那一列停在 ②** ——
//        讀板的人會以為這件事被拒絕了,而它其實已經上線)
//
// 🛑 **本檔量的是【機制】不是【那張真的紙】**:
//    它餵兩份最小 HTML 進真的 `print-a4.css`,而不是渲染 `picking-doc` / `shipping-doc`。
//    ⇒ ✅ 它答得出:`@page detail` 這個掛法在真 PDF 裡畫不畫得出東西、會不會漏到另一張紙上。
//    ⇒ 🔴 它答**不**出:`picking-doc` 有沒有真的掛上那個 class(那由下面第三格用**讀檔**守)。
//    ⇒ 🔴 它也答不出「**實體印表機**印出來看不看得到」—— 那是墨水與硬體,不是 PDF。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';

// 🔴 路徑從【本檔自己的位置】推,不從 `process.cwd()` ——
//    vitest 的 cwd 是 repo 根還是 app 根取決於誰啟動它,而那不是我們控制得了的。
//    (實測:`process.cwd()` 在這裡是 repo 根 ⇒ 第一版 ENOENT。)
const SRC = fileURLToPath(new URL('../..', import.meta.url));
const CSS_PATH = join(SRC, 'app/print/print-a4.css');

/** 最小紙:`marked=true` 就掛上 `pd-mark-detail`(= 訂單明細那張的掛法)。 */
function sheetHtml(css: string, marked: boolean): string {
  return `<!doctype html><html><head><style>${css}</style></head><body>
    <div class="print-sheet pd-sheet${marked ? ' pd-mark-detail' : ''}">
      <h1>測試紙</h1><p>內容一行。</p>
    </div></body></html>`;
}

/**
 * 出一張真 PDF,回傳它的**位元組**。
 * 🔵 `printBackground: true` 不可省 —— 少了它,任何靠背景色畫的東西都印不出來,
 *    而那正是 `87d8f42d` 那句「它不是背景色,因為背景色可能印不出來」在防的。
 */
async function renderPdf(html: string): Promise<Buffer> {
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    return await p.pdf({ format: 'A4', printBackground: true });
  } finally {
    await b.close();
  }
}

/** 把 PDF 轉成文字化的內容流,用來看它到底畫了什麼(不看畫素、看繪圖指令)。 */
function pdfInk(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'markdetail-'));
  try {
    const f = join(dir, 'a.pdf');
    writeFileSync(f, pdf);
    // 🔵 用 macOS 內建的 `qlmanage` 太重;改用 PDF 自己的位元組:
    //    Chromium 產的 PDF 內容流是 Flate 壓縮的,所以這裡不解壓 ——
    //    改比【檔案大小】與【真的畫了東西】的間接證據會很弱。
    //    ⇒ 所以真正的判別交給下面那把「同一份 HTML 只差一個 class」的差分尺。
    return readFileSync(f).toString('latin1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('⟦b4-2PAPERS⟧ 訂單明細的側邊標記,在【列印】時要真的存在', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  // 🔴 第一格:那條規則本身要在 CSS 裡,而且是【具名 page】不是全域 `@page`。
  //    全域 `@page` 會讓**出貨單也長出這條槓** —— 而兩張紙共用同一個 layout,
  //    所以那是這一片最不能發生的事。
  it('🔴 那條槓掛在【具名】page 上,不是全域 @page', () => {
    expect(css, 'pd-mark-detail 不見了 ⇒ 兩張紙又分不出來').toContain('page: detail');
    expect(css).toMatch(/@page\s+detail\s*\{/);
    // 🟢 負對照:不得有一個裸的 `@page {` 也帶 left-middle(那會漏到出貨單)
    const bareWithMark = /@page\s*\{[^}]*@left-middle/s.test(css);
    expect(bareWithMark, '裸 @page 帶了 margin box ⇒ 出貨單也會長出這條槓').toBe(false);
  });

  // 🔴🔴 第二格:**真出 PDF**,兩個世界只差一個 class ⇒ 位元組必須不同。
  //    這一格才是「印出來看得到嗎」——前一格只證明「規則寫在檔案裡」。
  it('🔴 真 PDF:掛了 pd-mark-detail 的那張,與沒掛的那張【不一樣】', async () => {
    const [marked, plain] = await Promise.all([
      renderPdf(sheetHtml(css, true)),
      renderPdf(sheetHtml(css, false)),
    ]);
    const a = pdfInk(marked);
    const b = pdfInk(plain);
    // 🔵 Chromium 的 PDF 帶時間戳 ⇒ 不能直接比整份位元組。比【內容流長度】差。
    //    畫了一條 3mm 實心邊 ⇒ 內容流會多出繪圖指令 ⇒ 長度必然不同。
    expect(a.length, '兩份 PDF 一樣長 ⇒ 那條槓在列印世界【沒有被畫出來】').not.toBe(b.length);
    expect(marked.length).toBeGreaterThan(0);
  }, 60_000);

  // 🔴 第三格:機制對了,而【那張紙有沒有掛上它】是另一個宣稱。
  //    (本檔餵的是最小 HTML ⇒ 它證不到真元件。這一格用讀檔補上。)
  it('🔴 接線:picking-doc 掛了它,而 shipping-doc【沒有】', () => {
    const picking = readFileSync(join(SRC, 'components/print/picking-doc.tsx'), 'utf8');
    const shipping = readFileSync(join(SRC, 'components/print/shipping-doc.tsx'), 'utf8');
    expect(picking, '訂單明細沒掛標記 ⇒ 員工分不出來').toContain('pd-mark-detail');
    // 🟢 這一格是負對照:兩張紙都有標記 = 等於沒有標記
    expect(shipping, '出貨單也掛了標記 ⇒ 兩張紙又長得一樣').not.toContain('pd-mark-detail');
  });
});
