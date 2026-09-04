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

/**
 * 🔴 **去掉註解之後的 CSS** —— 本檔每一格斷言都吃這一份, 不吃原始檔。
 *
 * 🎯 **理由是本 repo 反覆記過的病**:`.pd-mark-detail` 與 `#1f1f1f` 這兩個字面,
 *    在拿掉那條規則之後**仍然大量留在註解裡**(病史刻意留著給搜舊字面的人)
 *    ⇒ 🛑 一個直接對原始檔 `toContain` 的斷言, **分不出「規則還在」與「只有註解在講它」**
 *    ⇒ ⇒ 而那正是舊版第三格的形狀:它 `toContain('pd-mark-detail')` 讀整支 tsx,
 *      而我 2026-09-04 把 className 拿掉、註解留著 ⇒ **它照樣綠**。
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('⟦b4-2PAPERS⟧ 那條黑線【已經被拍掉了】—— 而它不可以自己回來', () => {
  const adminCss = readFileSync(CSS_PATH, 'utf8');
  const storefrontCss = readFileSync(
    join(SRC, '../../storefront/src/styles/print-a4.css'),
    'utf8',
  );

  /**
   * 🔴🔴 **本 describe 2026-09-04 整個翻面 —— 而翻面的理由是一次拍板, 不是一個缺陷。**
   *
   * Sean 原話逐字:`不用黑線...真的沒關係`
   * (落點 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 檔尾「追加拍板」①)。
   *
   * ⛔ ~~舊版三格守的是「那條槓要真的存在」~~ ⇒ **全部作廢**, 而**檔案不刪**:
   *    🎯 一個守門被拍掉之後**整支刪掉**, 下一個人翻歷史會看到「這件事沒有人管過」;
   *    而留成**退場守門**, 他會看到「有人管過, 而它被拍掉了, 而且不准偷偷回來」。
   *
   * 🛑 **代價明寫**:那個病回來了 —— 員工一眼分不出【訂單明細】與【出貨明細單】。
   *    🔵 而它可能本來就要消失(Sean 2026-08-29 另拍「揀貨單廢掉、用出貨單取代」)。
   *    🛑 **不要為了補償而發明新標記** —— 主視窗明文交代, 要做新標記先端他。
   */
  it('🔴 兩份 CSS 都不得再有那條槓的規則(而註解裡的字面不算)', () => {
    for (const [name, raw] of [
      ['admin', adminCss],
      ['storefront', storefrontCss],
    ] as const) {
      const code = stripComments(raw);
      expect(code, `${name}: 那條槓的規則回來了 —— Sean 2026-09-04 拍掉它`).not.toContain(
        'pd-mark-detail',
      );
      expect(code, `${name}: 具名 page 回來了 ⇒ 那條槓的載體回來了`).not.toMatch(
        /@page\s+detail\s*\{/,
      );
    }
  });

  /**
   * 🔵 **正對照:證明 `stripComments` 沒有把整支檔吃光。**
   * 少了這一格, 一支「回空字串」的 `stripComments` 會讓上面每一格恆綠
   * ⇒ 📌 **而那正是「什麼都沒有被讀成檢查過了」那個形狀。**
   */
  it('🔵 正對照:去註解之後 CSS 還在(否則上面那格是恆綠的)', () => {
    for (const [name, raw] of [
      ['admin', adminCss],
      ['storefront', storefrontCss],
    ] as const) {
      const code = stripComments(raw);
      expect(code, `${name}: stripComments 把整支檔吃光了`).toContain('@page');
      expect(code, `${name}: stripComments 把整支檔吃光了`).toContain('.pd-sheet');
    }
  });

  /**
   * 🔴 **那兩條是【一對】** —— `@page detail{margin-left:9mm}` + `border-left:3mm`
   * ⇒ `9 + 3 = 12mm` = 原本的邊界。
   * 🛑 **只拿掉 border 不還原 margin ⇒ 內容左緣從 12mm 縮到 9mm 而右緣不動**
   *    ⇒ 版面悄悄變寬 3mm ⇒ 🎯 而那是「頁數只差一項的距離」的紙(實量 5 項 1 頁 / 6 項 2 頁)。
   * ⇒ ✅ 這一格釘住:唯一生效的頁邊距是那組 12mm。
   */
  it('🔴 內容邊界回到原本的 12mm(只刪 border 不還原 margin 會悄悄變寬 3mm)', () => {
    const code = stripComments(adminCss);
    expect(code, '@page 那組邊距不見了 ⇒ 紙面邊界沒有人定義').toContain(
      'margin: 12mm 12mm 14mm 12mm',
    );
    expect(code, '還有別的 margin-left 在覆寫頁邊距 ⇒ 兩張紙的邊界會不一樣').not.toMatch(
      /@page[^{]*\{[^}]*margin-left/s,
    );
  });

  /**
   * 🔴 **接線那一半:那張紙有沒有【真的把 class 拿掉】。**
   *
   * 🛑 **這一格讀的是 `className` 那一行, 不是整支檔** —— 而那是 2026-09-04 學到的:
   *    舊版寫 `expect(picking).toContain('pd-mark-detail')` 讀整支 tsx,
   *    而我拿掉 className、把病史留在註解裡 ⇒ **它照樣綠**。
   *    ⇒ 📌 **`grep` 分不出「碼在做這件事」與「註解在講這件事」。**
   */
  it('🔴 picking-doc 的 className 裡不得再有那個標記(讀 className, 不讀整支檔)', () => {
    // 🔴🔴 **tsx 這一側也要先去註解, 而這一格是實跑逼出來的, 不是想到的**:
    //    我在 `picking-doc.tsx` 的註解裡留了一行舊字面 `className='… pd-sheet pd-mark-detail'`
    //    (刪除線那一行, 給搜舊字面的人看的)⇒ 🎯 **它長得與一個真的 className 一模一樣**
    //    ⇒ 這一格第一版直接紅, 而**紅的理由是我自己的註解**, 不是碼。
    //    ⇒ 📌 **同一句話的兩個方向**:上面 CSS 那側是「註解讓斷言假綠」,
    //      這裡是「註解讓斷言假紅」—— 而**假紅會被修**, 修法很可能是把那行病史刪掉。
    const picking = stripComments(
      readFileSync(join(SRC, 'components/print/picking-doc.tsx'), 'utf8'),
    );
    const classNames = [...picking.matchAll(/className='([^']*)'/g)].map((m) => m[1]!);
    expect(classNames.length, '一個 className 都沒抓到 ⇒ 這把尺沒接上').toBeGreaterThan(0);
    expect(
      classNames.join(' '),
      'className 還掛著 pd-mark-detail ⇒ 一個什麼都不做的 class, 下一個人會以為標記還在',
    ).not.toContain('pd-mark-detail');
    // 🟢 正對照:同一把尺抓得到還在的那個 class ⇒ 上面那個 not.toContain 不是因為尺壞掉
    expect(classNames.join(' '), 'pd-sheet 也不見了 ⇒ 這把尺在亂報').toContain('pd-sheet');
  });

  /**
   * 🔴🔴 **真 PDF:紙上真的沒有那條槓了。**
   *
   * 🛑 **而「找不到槓」與「這把尺壞了」印同一個 `null`** ⇒ 所以這一格自帶正對照:
   *    同一支 harness 餵一份**自己畫一條粗槓**的 HTML ⇒ 它必須找得到。
   *    ⇒ 📌 少了那一半, 一支 `renderPdf` 壞掉的世界與「槓拿掉了」的世界**印同一個綠**。
   * 🔴 而它答**不**出「實體印表機印出來如何」—— 那是墨水與硬體, 不是 PDF。
   */
  it('🔴 真 PDF:掛不掛那個 class 都不再有槓(而同一把尺找得到一條真的槓)', async () => {
    const [wasMarked, plain] = await Promise.all([
      renderPdf(sheetHtml(adminCss, true)),
      renderPdf(sheetHtml(adminCss, false)),
    ]);
    expect(barLeftPt(inkOps(wasMarked)), '槓還在 ⇒ 規則沒拿乾淨').toBeNull();
    expect(barLeftPt(inkOps(plain)), '沒掛標記的那張長出槓 ⇒ 漏到全域了').toBeNull();

    // 🟢 正對照:自己畫一條, 同一支 harness 必須看得見。
    const control = await renderPdf(
      `<!doctype html><html><head><style>${adminCss}
       .zz { border-left: 3mm solid #1f1f1f; }</style></head><body>
       <div class="print-sheet pd-sheet zz"><h1>對照</h1><p>內容一行。</p></div>
       </body></html>`,
    );
    expect(
      barLeftPt(inkOps(control)),
      '連一條真的槓都找不到 ⇒ 這把尺壞了, 上面那兩個 null 什麼都證不到',
    ).not.toBeNull();
  }, 90_000);
});
