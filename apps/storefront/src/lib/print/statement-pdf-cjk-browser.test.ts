// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// 🔵 storefront 這一側的 playwright 走 '@playwright/test'(既有兩支 browser 測試都是這樣 import 的);
//    admin 那邊是 'playwright' —— 兩個 app 各自打包, 不要跨過去抄。
import { chromium, type Browser } from '@playwright/test';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { buildStatementPdfHtml } from './statement-pdf';

// statement-pdf-cjk-browser.test.ts — ⟦f3-SHIPPDF1⟧ plan 自己標的那格【沒量過】。
//
// 🔴🔴 **這一格補的是「下載了一個檔」與「那個檔裡中文是對的」之間的距離**
//    `~/pcm-mailbox/線-出貨-plan-412-伺服器產PDF-20260830.md` 逐字:
//    「Sean 2026-09-05 回過『.pdf 連結 ⇒ 下載了一個檔』, 而**『下載了一個檔』與『那個檔裡中文是對的』
//      是兩個宣稱。**」
//
// 🔬 **而缺的只有顧客站這一半 —— 那是量出來的, 不是猜的**(2026-09-07, 用
//    `apps/admin/.../page-measure.test.tsx:110` 檔內自己給的那把尺 `grep -cE`):
//      🟢 後台 `page-measure.test.tsx`(**從產出的 PDF 抽字**)⇒ **8 格** CJK 斷言
//      🔴 顧客站 `statement-pdf.test.ts` ⇒ 4 格 CJK, **而 4 格的受詞全是 `built.html`**
//         —— HTML **變成 PDF 之前**的東西
//      ⚪ 負對照 同一把尺找一個不可能的字 ⇒ 0
//    ⇒ 🎯 **「HTML 裡有中文」證不了「PDF 裡的字型嵌進去了」。而客人拿到的是 PDF。**
//
// 🔵 形狀照 `page-measure.test.tsx:1022` 的 `pagesOf()`:`page.pdf()` 產真檔 + `gs -sDEVICE=txtwrite` 抽字。
//    · `gs` 不在 ⇒ `execFileSync` throw ⇒ 本檔**紅**。那是刻意的 —— 「沒有 gs 所以跳過」與
//      「抽出來都對所以通過」在報表上長得一樣。
//    · `waitUntil: 'load'` + `document.fonts.ready` —— **這一族真正要等的是【字型套上】**(同上那支檔的理由)。
//    · `afterAll` 的 timeout 與 `beforeAll` **一樣長** —— 不對稱會在機器忙時變成「檔案紅、零個測試紅」。

function twd(n: number) {
  return { amount: toMoneyAmount(n), currency: 'TWD' as const };
}

/** 與 `statement-pdf.test.ts` 同款的最小訂單 —— 這裡只要它**帶中文**。 */
function orderFixture(title = '碳纖維下鏈條蓋 第 1 項'): MemberOrderDetail {
  return {
    id: 'o1',
    displayId: 'A1B2C3',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    paymentMethod: 'tappay',
    paymentChannel: 'tappay' as const,
    paidAt: '2099-04-18T03:00:00Z',
    shippedAt: null,
    allItemsShipped: false,
    subtotal: twd(12000),
    shippingFee: twd(100),
    discountTotal: twd(0),
    taxTotal: twd(0),
    total: twd(12100),
    balanceDue: null,
    overpaidTotal: null,   // ⟦b4-PAIDTHENOVERPAID⟧ 第二層:null = 沒多付 / 算不出來
    shippingMethod: 'home',
    shippingAddress: {
      name: '王小明',
      phone: '0912345678',
      line: '新北市新莊區化成路 736 巷 18 號',
    },
    cancelledAt: null,
    cancelKind: 'none',
    items: [
      {
        id: 'oi1',
        variantSku: 'SKU-1',
        brand: 'CNC RACING',
        title,
        spec: { color: 'black' },
        imageUrl: null,
        vehicle: null,
        quantity: 1,
        unitPrice: twd(1000),
        lineTotal: twd(1000),
        shipped: false,
        shippedQuantity: 0,
        cancelledQuantity: null,
      },
    ],
    itemCount: 1,
    itemsTruncated: false,
  };
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
}, 120_000);

/**
 * 把一份 HTML 印成真的 `.pdf`, 回**兩個不同的讀數**:
 *   · `text`  —— gs 從 PDF **文字層**抽出來的字
 *   · `bytes` —— PDF 的原始位元組(拿來問「字型子集有沒有被嵌進去」)
 *
 * 🔴🔴 **為什麼要兩個 —— 這是本檔最要緊的一句, 而它是我踩到才知道的**:
 *    我原本以為「文字層抽得到中文」就等於「中文字型嵌進去了」。**不是。**
 *    🔬 2026-09-07 實測同一份紙的兩個世界(字型拔掉 vs 沒拔):
 *      文字層 ⇒ **兩個世界都抽得到「碳纖維下鏈條蓋」**(Chrome 照樣把字元寫進文字層)
 *      位元組 ⇒ 好的世界 `FontFile2` **23** 次 · 字型名含 `Noto` **54** 次;
 *              壞的世界 **兩個都是 0**
 *    ⇒ 📌 **文字層那把尺對「字型有沒有嵌」零判別力** —— 而客人看到的是**字形**, 不是文字層。
 *    ⇒ ⇒ 所以兩件事各有各的尺, **不能拿一把去代替另一把**。
 */
async function pdfOf(html: string): Promise<{ text: string; bytes: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'pcm-stmt-cjk-'));
  const htmlPath = join(dir, 'x.html');
  const pdfPath = join(dir, 'x.pdf');
  writeFileSync(htmlPath, html, 'utf8');
  const page = await browser.newPage();
  try {
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  } finally {
    await page.close();
  }
  // 🛑 gs 不在 ⇒ throw ⇒ 本格紅(刻意)。
  execFileSync('gs', ['-sDEVICE=txtwrite', '-dNOPAUSE', '-dBATCH', '-o', join(dir, 'p%d.txt'), pdfPath], {
    stdio: 'ignore',
  });
  const files = readdirSync(dir).filter((f) => /^p\d+\.txt$/.test(f));
  // 🔴 前提斷言:gs 真的吐出頁了。0 頁 ⇒ 下面每一格在空字串上比對 ⇒ 全是假綠。
  expect(files.length, 'gs 抽出來的頁數(0 ⇒ 這把尺沒接上, 不是「PDF 正常」)').toBeGreaterThan(0);
  return {
    text: files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n'),
    // 🔵 `latin1` —— 我們只在位元組層面找 `FontFile2` / `Noto` 這種 ASCII 標記, 不解析 PDF。
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

describe('⟦f3-SHIPPDF1⟧ 顧客站 statement.pdf —— 中文真的進了 PDF 嗎', () => {
  it('🔴 中文從 HTML 一路活到 PDF 的【文字層】', async () => {
    const built = await buildStatementPdfHtml(orderFixture());
    // 🔵 前提:HTML 這一端本來就有(這是 statement-pdf.test.ts 已經在守的那一半)。
    expect(built.html).toContain('王小明');
    const { text } = await pdfOf(built.html);
    // 🎯 受詞是【從 PDF 抽出來的字】, 不是 HTML。它守的是「字掉了 / 變成亂碼」那一族。
    expect(text, '收件人姓名沒有活到 PDF 文字層').toContain('王小明');
    expect(text, '品名沒有活到 PDF 文字層').toContain('碳纖維下鏈條蓋');
    expect(text, '地址沒有活到 PDF 文字層').toContain('新莊區');
  }, 120_000);

  it('🔴🔴 中文【字型子集】真的被嵌進 PDF —— 那才是客人看得到字形的條件', async () => {
    const built = await buildStatementPdfHtml(orderFixture());
    const { bytes } = await pdfOf(built.html);
    const ev = fontEvidence(bytes);
    // 🔬 2026-09-07 實測基準:FontFile2 = 23 · Noto = 54。這裡只要求 > 0 ——
    //    釘死那兩個數會在字型子集化策略變動時假紅, 而本格要守的是「有沒有嵌」。
    expect(ev.fontFile2, 'PDF 裡一個 TrueType 字型子集都沒有 ⇒ 中文會是豆腐').toBeGreaterThan(0);
    expect(ev.noto, '字型名裡找不到 Noto ⇒ 嵌進去的不是我們送的那套中文字型').toBeGreaterThan(0);
  }, 120_000);

  it('🔴🔴 尺的完整性:換一份訂單 ⇒ 抽出來的字要跟著換(這一格殺得死「把 text 寫死」)', async () => {
    // 🛑 **這一格是突變逼出來的, 而那個突變是我自己跑的**:
    //    我把 `text` 那一行改成一個【寫死的字串】(剛好含那三個詞)⇒ **上面四格全綠**。
    //    ⇒ 📌 一組「這幾個字在不在」的斷言, 分不出【從 PDF 抽出來的】與【一個常數】。
    //    ✅ 殺法:餵兩份**只差一個品名**的訂單, 各自抽字 ——
    //       每一份要含自己的品名、且**不含對方的**。寫死的 `text` 過不了後半。
    const a = await buildStatementPdfHtml(orderFixture('甲品名獨有詞'));
    const b = await buildStatementPdfHtml(orderFixture('乙品名獨有詞'));
    const ta = (await pdfOf(a.html)).text;
    const tb = (await pdfOf(b.html)).text;
    expect(ta, '甲那份抽不到自己的品名').toContain('甲品名獨有詞');
    expect(tb, '乙那份抽不到自己的品名').toContain('乙品名獨有詞');
    expect(ta, '甲那份抽到了乙的品名 ⇒ 這把尺讀的不是那份文件').not.toContain('乙品名獨有詞');
    expect(tb, '乙那份抽到了甲的品名 ⇒ 這把尺讀的不是那份文件').not.toContain('甲品名獨有詞');
  }, 120_000);

  it('⚪ 負對照:一個不在這份訂單裡的中文詞, PDF 裡不該有', async () => {
    // 🔴 沒有這一格, 上面那組可能只是因為「這把尺對任何字都說有」而通過(恆真格)。
    const built = await buildStatementPdfHtml(orderFixture());
    const { text } = await pdfOf(built.html);
    expect(text).not.toContain('這個詞不可能出現在對帳單上');
  }, 120_000);

  // 🔴 **只在 macOS 跑這一格**(Sean 2026-09-11 拍甲「GitHub 上先不跑這一小步, 在 Mac 上照樣跑」;只跳這一格):
  //    Linux 的 Chrome 沒字型就連文字層都印不出, 造不出「拔字型而文字仍在」的世界。
  //    📎 CI run 34564927198(ca4c31f25)實測:空 fontconfig 下 fontFile2/noto 歸零那半過了,
  //       文字層那半 `expected '' to contain '碳纖維下鏈條蓋'`;沒帶空 fontconfig 時則是系統中文字被嵌進來(fontFile2 = 4)。
  //    ⚠️ 上面四格(文字層、字型有嵌、尺的完整性、負對照)在 Linux 照跑 —— 客人 PDF 有沒有嵌 Noto 仍由 CI 守。
  it.skipIf(process.platform !== 'darwin')('🔴🔴 量具自檢:把中文字型拔掉 ⇒ 【字型那把尺】要量得到, 而【文字層那把尺】量不到', async () => {
    // 🛑 這一格同時證明兩件事, 而第二件是我一開始搞錯的那件:
    //    ① 字型那把尺**有判別力**(拔掉之後 FontFile2 / Noto 掉到 0)
    //    ② 文字層那把尺**對這個世界沒有判別力**(照樣抽得到中文)
    //    ⇒ 📌 **把 ② 寫成斷言, 是為了讓「有一天它變了」會紅** —— 那時該重讀本檔而不是照抄。
    const built = await buildStatementPdfHtml(orderFixture());
    const broken = built.html
      .replace(/font-family:[^;"}]*/g, 'font-family:"NoSuchLatinOnly"')
      .replace(/src:\s*url\(data:font\/woff2;base64,[^)]*\)/g, 'src:url(data:font/woff2;base64,AA==)');
    const { text, bytes } = await pdfOf(broken);
    const ev = fontEvidence(bytes);
    expect(ev, '字型拔掉之後仍嵌著字型 ⇒ 上面那格沒有判別力').toEqual({ fontFile2: 0, noto: 0 });
    expect(text, '⚠️ 這一格【期望它仍抽得到】—— 它紅了代表文字層那把尺的行為變了, 要重讀本檔').toContain(
      '碳纖維下鏈條蓋',
    );
  }, 120_000);
});
