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
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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

/**
 * 解開 PDF 裡所有 Flate 壓縮串流,回傳 Chromium 畫出來的**繪圖指令**。
 * 🔴 這是本檔唯一問得出「那條槓在不在」的方法 —— 比檔案大小、比位元組數都不行。
 */
function inkOps(pdf: Buffer): string {
  let out = '';
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf.toString('latin1'))) !== null) {
    const from = m.index + m[0].length;
    const to = pdf.toString('latin1').indexOf('endstream', from);
    if (to < 0) continue;
    try {
      out += inflateSync(Buffer.from(pdf.toString('latin1').slice(from, to), 'latin1')).toString('latin1');
    } catch {
      /* 沒壓縮或不是我們看得懂的:跳過 —— 而真正的內容流一定解得開 */
    }
  }
  return out;
}

/**
 * 找那條槓,回傳它的**絕對左緣**(PDF pt);找不到回 `null`。
 *
 * 🔴 為什麼要位置而不只是「在不在」:2026-09-02 的舊版(`@page` 邊距框)**有畫**,
 *    而它畫在 `x = 0` —— 貼著紙緣,正好落在印表機那圈不可印帶 ⇒ **螢幕預覽看得到、印出來沒有**。
 *    ⇒ 📌 所以「在不在」答不出這一題,要問「**離紙緣多遠**」。
 * ⚠️ 這裡的 CTM 追蹤是簡化版(不處理 q/Q 堆疊)⇒ **絕對值不準,只有「是不是 0」可信**。
 */
function barLeftPt(ops: string): number | null {
  let sx = 1;
  let tx = 0;
  for (const line of ops.split('\n')) {
    const l = line.trim();
    const cm = /^([\d.]+) 0 0 [\d.]+ ([\d.]+) [\d.]+ cm$/.exec(l);
    if (cm) {
      sx = Number(cm[1]);
      tx = Number(cm[2]);
      continue;
    }
    const re = /^([\d.]+) [\d.]+ ([\d.]+) ([\d.]+) re$/.exec(l);
    if (re && Number(re[2]) < 20 && Number(re[3]) > 400) return tx + Number(re[1]) * sx;
  }
  return null;
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
  // 🔴🔴 這一格 2026-09-03 重寫過 —— **舊版是假綠**。
  //    舊版比的是「兩份 PDF 位元組長度不同」⇒ 而換一個具名 page 本來就會讓長度不同
  //    (實測 18470 vs 12232,差在**字型子集**)⇒ 它在那條槓完全沒被畫出來時照樣通過。
  //    🛑 而 Sean 實印回報「印出來沒有黑邊,預覽有而已」的時候,這一格是綠的。
  //    ⇒ 📌 **一個比「有沒有差別」的斷言,答不出「差別是不是我要的那個東西」。**
  // 🔴🔴 這一格 2026-09-03 重寫過兩次 —— 而**前兩版都是綠的,在紙上什麼都沒有的時候。**
  //    第一版比「兩份 PDF 位元組長度不同」⇒ 換一個具名 page 本來就會不同(18470 vs 12232,
  //      差在字型子集)⇒ 📌 一個比「有沒有差別」的斷言,答不出「差別是不是我要的那個東西」。
  //    第二版比「那條槓在不在」⇒ 🔴 **它在** —— 舊版真的畫了一條,而它畫在 `x = 0`,
  //      貼著紙緣、落在印表機不可印帶裡 ⇒ **Sean 實印:「印出來沒有黑邊,預覽有而已」。**
  //    ⇒ ⇒ 🎯 所以問題不是「有沒有畫」,是「**畫在哪**」。
  it('🔴 真 PDF:那條槓要離紙緣夠遠(不是只有「畫出來」)', async () => {
    const [marked, plain] = await Promise.all([
      renderPdf(sheetHtml(css, true)),
      renderPdf(sheetHtml(css, false)),
    ]);
    const x = barLeftPt(inkOps(marked));
    expect(x, '找不到那條槓 ⇒ 印出來不會有').not.toBeNull();
    // 20pt ≈ 7mm。印表機那圈不可印帶約 4-5mm ⇒ 低於這條線就是「預覽看得到、印不出來」。
    expect(x!, `那條槓在 x=${x}pt ⇒ 太靠紙緣,印表機會裁掉`).toBeGreaterThan(20);
    // 🔵 負對照:沒掛標記的那張不得有 —— 少了它,一把「永遠說有」的尺也會通過
    expect(barLeftPt(inkOps(plain)), '沒掛標記的那張也長出槓 ⇒ 兩張紙又分不出來').toBeNull();
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
