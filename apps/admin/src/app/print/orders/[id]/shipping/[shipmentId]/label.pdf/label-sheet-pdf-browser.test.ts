// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { extractHctLabelImage } from '@/lib/shipping/hct-label-image';
import { buildLabelPages, buildLabelSheetHtml } from '@/lib/shipping/hct-label-layout';

// 標籤那張紙的**PDF 層**證據。⟦ship-HCTLABELCAPTURE⟧ 片 D2(codex 2026-09-06 R1 must-fix)。
//
// 🔴🔴 **它為什麼存在**:在它之前, 這一片的每一格都只在**比字串** ——
//    `buildLabelSheetHtml` 回的 HTML 裡有沒有那幾個字。
//    🛑 而那把尺**看不到**:①`297mm` 會不會多印一頁 ②那張圖 Chromium 解不解得開
//    ③格子在紙上到底幾公釐。⇒ 📌 **三件事全部只有真的產一份 PDF 才答得出來。**
//
// 🔴 **而 codex 點名的那一格是②**:一份「PNG 簽名 + 一堆垃圾」的 fixture
//    在字串層完全正常, 而真的 Chromium 把它當破圖 ⇒ **`page.pdf()` 照樣回 200, 紙是空白的。**
//    ⇒ ✅ 所以本檔用一張**真的解得開**的 PNG, 並**去問它的 `naturalWidth`** ——
//      那個值在「解開了」與「沒解開」兩個世界印不同的東西(`0` vs `>0`)。
//
// 🔵 **它走的是【raw → HTML 那一段真鏈】**:`extractHctLabelImage` → `buildLabelPages` → `buildLabelSheetHtml`
//    ⇒ 那三層裡任何一層把圖弄壞, 這裡都會看到。
//    ⛔ ~~「整條真鏈」~~(2026-09-06 codex R2 訂正)—— **那句話太寬**:
//      它**沒有**經過 `route.ts`, 也**沒有**經過 `@pcm/pdf` 的 `htmlToPdf`
//      ⇒ 📌 route 的授權與那幾道 409、以及 `htmlToPdf` 自己的行為, 本檔一格都沒有量到。
//
// 🛑🛑 **本檔【證不到】的**:
//    ① **線上那條 route 產得出 PDF** —— 這裡用的是 playwright 的 chromium,
//      而正式環境是 `@sparticuz/chromium`(Linux binary, 本機 macOS `spawn ENOEXEC`)。
//      ⇒ 兩個不同的瀏覽器二進位檔。守 tracing 那一半的是 `label-pdf-tracing.test.ts`。
//    ② **紙上量起來對不對** —— 下面的 mm 是**瀏覽器算的**, 不是尺量的。
//      條碼掃不掃得到要真的印一張(那是 Sean 的驗收, 見 `hct-label-layout.ts` 檔頭)。
//
// ⚠️ 本檔會被 `scripts/browser-test-family.py` **自動收進**「要起真瀏覽器」那一族
//    (它掃 import, 不是手寫清單)⇒ 不需要有人記得把它加進去。

/** 一張**真的**能解開的 1×1 PNG(標準最小樣本)。 */
const REAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** 同一張圖的 hex 版 —— 新竹很可能送這一種(見 `hct-label-image.ts` 檔頭)。 */
const REAL_PNG_HEX = Buffer.from(REAL_PNG_B64, 'base64').toString('hex');

const MM = 96 / 25.4; // CSS px per mm

let browser: Browser | null = null;
const getBrowser = async (): Promise<Browser> => (browser ??= await chromium.launch());
// 🔴🔴 **`afterAll` 也要給 timeout —— 而這是量出來的, 不是保險**(front `145e4b5cf` 2026-09-06):
//   `Error: Hook timed out in 10000ms.` 指在 `afterAll` 的 `browser?.close()` ——
//   機器有負載時關 chromium 會超過 vitest 預設的 10s。
//   🛑 **而它的症狀是【檔級 FAIL 而零測項紅】** ⇒ 看起來像「這支檔壞了」, 而每一格其實都過了。
//   ✅ `beforeAll` 早就有 `60_000` 了, 而 `afterAll` 沒有 —— **那個不對稱就是這個 bug。**
afterAll(async () => {
  await browser?.close();
}, 60_000);

/** 走整條真鏈:整包 raw → 那張圖 → 版面 → HTML。 */
function sheetHtml(count: number, sheet: 'single' | 'a4-2x3', startAt?: number): string {
  const img = extractHctLabelImage([{ image: REAL_PNG_HEX }]);
  if (!img.ok) throw new Error(`前提壞了:那張真 PNG 被擋掉了(${img.reason})`);
  const labels = Array.from({ length: count }, (_, i) => ({
    imageBase64: img.imageBase64,
    shipmentRef: `S-${i + 1}`,
  }));
  return buildLabelSheetHtml(buildLabelPages({ labels, sheet, startAt }), img.mime, sheet);
}

async function measure(
  html: string,
): Promise<{
  pages: number;
  bytes: number;
  decoded: number[];
  cellMm: { w: number; h: number } | null;
  /** 🔴 **紙上真的看得到的字**(`innerText` 尊重 `display:none`)—— 丁那道的兩個世界就靠它分。 */
  visibleText: string;
  /** 警告框與大叉的**幾何** —— 字有了而框塌成 0, `innerText` 照樣印字。 */
  warn: { w: number; h: number; xW: number; xH: number };
}> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const probe = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      const cell = document.querySelector('.cell') as HTMLElement | null;
      const r = cell?.getBoundingClientRect() ?? null;
      // 🔴 **警告框與大叉的【幾何】要一起回**(2026-09-06 code-reviewer nit):
      //    把 `.x` 的寬高改成 0, 字面層與 `innerText` 那一格**全綠**, 而紙上什麼都看不到
      //    ⇒ 📌 `innerText` **不管幾何也不管顏色**。
      //    🛑 **天花板照實寫**:這一格殺得掉「幾何塌成 0」那一族, **殺不掉顏色**
      //      (`.warn{color:#fff}` 這一發它仍然全綠)—— 顏色要真的看像素, 本檔不做。
      const warnBox = (document.querySelector('.warn') as HTMLElement | null)?.getBoundingClientRect() ?? null;
      const xBox = (document.querySelector('.x') as HTMLElement | null)?.getBoundingClientRect() ?? null;
      return {
        // 🔴 `naturalWidth` —— **解開了才會 > 0**。破圖在畫面上與「還沒載入」長得一樣,
        //    而這個數字在兩個世界不同。
        decoded: imgs.map((i) => i.naturalWidth),
        box: r === null ? null : { w: r.width, h: r.height },
        visibleText: (document.body.innerText ?? '').trim(),
        warnW: warnBox?.width ?? 0,
        warnH: warnBox?.height ?? 0,
        xW: xBox?.width ?? 0,
        xH: xBox?.height ?? 0,
      };
    });
    // 🔴 **`margin` 明寫 0** —— 這是貼紙, 不是文件:任何邊距都會把格子推離貼紙的格線。
    //    (`page.pdf` 的預設剛好也是 0, 而**預設不是宣告** —— 下一個人升級 puppeteer/playwright
    //     時, 一個被明寫的 0 會留在 diff 上, 一個沒寫的不會。)
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    // 🔵 先驗它真的是一份 PDF —— 否則「數不到頁」與「版面錯」會印同一個 0,
    //    而讀的人會去查版面, 壞的卻是工具(page-measure 那支的 reviewer nit)。
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // 🔴🔴 **位元組數回出去, 不在這裡設地板** —— 本檔量到的:
    //    一張真圖的紙 ≈ **1.6 KB 以上**;而**一張壞圖的紙只有 661 bytes** ——
    //    ⇒ 📌 那就是「空白紙」的形狀, 而它**HTTP 200、`%PDF` 開頭、一切正常**。
    //    ⛔ 我第一版把 `>1000` 焊在這支共用函式裡 ⇒ **負對照被它擋下, 而那正是要量的東西。**
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    return {
      pages,
      bytes: pdf.length,
      decoded: probe.decoded,
      cellMm: probe.box === null ? null : { w: probe.box.w / MM, h: probe.box.h / MM },
      visibleText: probe.visibleText,
      warn: { w: probe.warnW, h: probe.warnH, xW: probe.xW, xH: probe.xH },
    };
  } finally {
    await page.close();
  }
}

describe('標籤那張紙的 PDF 層(真瀏覽器)', () => {
  it('那張圖【真的被解開了】—— 而這正是字串層看不到的那一格', async () => {
    const m = await measure(sheetHtml(1, 'a4-2x3'));
    expect(m.decoded.length, '紙上一張圖都沒有 ⇒ 下面那個斷言是恆真的').toBe(1);
    expect(m.decoded[0], 'naturalWidth = 0 ⇒ Chromium 解不開這張圖 ⇒ 那是一張空白貼紙').toBeGreaterThan(0);
    // ⛔ ~~`expect(m.bytes).toBeGreaterThan(1000)`~~(2026-09-06 codex R2 訂正:**不要斷言它**)——
    //    那個門檻是 Chromium 版本 / 平台 / PDF 壓縮細節湊出來的**偶然讀數**, 不是一個穩定的性質。
    //    ⇒ 📌 **一個會隨著別人升級瀏覽器而變紅的斷言, 紅起來的時候沒有人知道是誰壞了。**
    //    ✅ 改成**記錄**:數字留在輸出裡給下一個人看, 而判別力押在 `naturalWidth` 那一格。
    console.info(`[label-sheet-pdf] 真圖那份 PDF = ${m.bytes} bytes(僅記錄, 不斷言)`);
    // 🔴 丁的**好圖那一半**:正常的貼紙上一個字都沒有 ⇒ 警告框沒有被觸發。
    expect(m.visibleText, '正常的貼紙上出現了字 ⇒ 警告框誤觸發, 而那張紙會被丟掉').toBe('');
    // 🔵 正常那一半的幾何也要是 0(`display:none`)—— 否則警告框在好紙上佔了位置。
    expect(m.warn.w + m.warn.h, '好圖的紙上警告框佔了空間 ⇒ 它沒有被藏起來').toBe(0);
  }, 60_000);

  // 🔴🔴 `.sheet{height:297mm}` 那一格:本 repo 已量到「剛好整張紙」會多印一頁
  //    (`print-a4.css` 那族 —— 而那發是瀏覽器列印 + `@page` 邊距, **不是這個世界**)。
  //    ⇒ 📌 所以這一格不是照抄那個結論, 是**在這個世界裡自己量一次**。
  it('1 張標籤 ⇒ 恰 1 頁(297mm 沒有溢出成兩頁)', async () => {
    expect((await measure(sheetHtml(1, 'a4-2x3'))).pages).toBe(1);
  }, 60_000);

  it('6 張 ⇒ 恰 1 頁;7 張 ⇒ 恰 2 頁(兩個世界要印不同的數)', async () => {
    expect((await measure(sheetHtml(6, 'a4-2x3'))).pages).toBe(1);
    expect((await measure(sheetHtml(7, 'a4-2x3'))).pages).toBe(2);
  }, 120_000);

  it('single 版面:一張圖一頁, 兩張圖兩頁', async () => {
    expect((await measure(sheetHtml(1, 'single'))).pages).toBe(1);
    expect((await measure(sheetHtml(2, 'single'))).pages).toBe(2);
  }, 120_000);

  it('格子在紙上是 105×99mm(a4-2x3)/ 210×297mm(single)', async () => {
    const six = await measure(sheetHtml(1, 'a4-2x3'));
    expect(six.cellMm!.w).toBeCloseTo(105, 0);
    expect(six.cellMm!.h).toBeCloseTo(99, 0);
    const one = await measure(sheetHtml(1, 'single'));
    expect(one.cellMm!.w).toBeCloseTo(210, 0);
    expect(one.cellMm!.h).toBeCloseTo(297, 0);
  }, 120_000);

  // 🔴🔴 **這一格【釘的是一個缺口】, 不是一個功能**(2026-09-06 code-reviewer nit ⇒ 我實測補上)。
  //
  //    問題:「頭尾都對而中間壞掉」那一類, **今天零讀數** —— 上面那個負對照的圖是
  //    **連 IHDR 都壞的**(`Buffer.alloc(56, 0x7f)`), 它量到的是「完全解不開」。
  //
  //    🔬 **我拿真圖去改壞它的 IDAT payload(CRC 因此不符)實測**:
  //      `真圖 {"naturalWidth":1}` / `中間壞掉 {"naturalWidth":1}`
  //      ⇒ 🛑 **Chromium 不理會 PNG 的 CRC 錯誤 —— 它照樣解開、照樣不觸發 `onerror`。**
  //
  //    ⇒ 📌 **兩個推論, 都比這一格本身重要**:
  //      ① 檔頭那句「解得開而內容錯 ⇒ 兩層都不兜」**是真的, 而且比我想的更寬** ——
  //        連「資料真的被改壞」都可能落在「解得開」這一邊。
  //      ② codex 原本建議的甲案(伺服器層驗 CRC)**會擋掉一張 Chromium 願意畫的圖**
  //        ⇒ 主視窗裁掉甲是對的, 而**理由不是它給的那個** —— 是這一發量出來的。
  //
  //    ⚠️ 這一格若哪天變紅 = Chromium 對壞 PNG 的態度變了 ⇒ **回來重讀上面那兩句**, 不要直接改期望值。
  it('釘缺口:CRC 壞掉的 PNG ⇒ Chromium 照樣解開、警告框【不會】出現', async () => {
    const real = Buffer.from(REAL_PNG_B64, 'base64');
    const corrupted = Buffer.from(real);
    // 動 IDAT 的 payload(IHDR 與 IEND 都不碰)。`noUncheckedIndexedAccess` 之下要顯式讀寫。
    const at = real.length - 20;
    corrupted[at] = (corrupted[at] ?? 0) ^ 0xff;
    const html = buildLabelSheetHtml(
      buildLabelPages({
        labels: [{ imageBase64: corrupted.toString('base64'), shipmentRef: 'S-c' }],
        sheet: 'single',
      }),
      'image/png',
      'single',
    );
    const m = await measure(html);
    expect(m.decoded[0], 'Chromium 開始拒絕壞 CRC 的 PNG 了 ⇒ 回來重讀上面那段').toBeGreaterThan(0);
    expect(m.visibleText, '警告框出現了 ⇒ 那也很好, 而上面那段註解就過期了').toBe('');
  }, 60_000);

  // 🔵 **負對照**:一張【解不開的】圖 —— 證明上面那個 `naturalWidth > 0` 不是什麼都會過。
  //    ⚠️ 它繞過 `extractHctLabelImage`(那一層現在就會擋掉它)⇒ 直接餵版面層,
  //    量的是「**如果**一張壞圖走到了紙上, 這把尺看不看得見」。
  it('負對照:壞圖 ⇒ naturalWidth = 0(所以上面那一格有判別力)', async () => {
    const broken = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(56, 0x7f),
    ]).toString('base64');
    const html = buildLabelSheetHtml(
      buildLabelPages({ labels: [{ imageBase64: broken, shipmentRef: 'S-x' }], sheet: 'single' }),
      'image/png',
      'single',
    );
    const m = await measure(html);
    expect(m.decoded[0], '壞圖也回非 0 ⇒ 這把尺量不到解碼這件事').toBe(0);
    // 🔴🔴 **丁的壞圖那一半**(`Q-標籤10` 主視窗 2026-09-06 裁):
    //    伺服器層驗不到「中間壞掉」⇒ 這種圖會走到紙上 ⇒ 📌 **那張紙必須【看得出來錯了】**,
    //    而不是一張空白貼紙。這一格就是在問「它有沒有長出形狀」。
    expect(m.visibleText, '壞圖的那一格沒有出聲 ⇒ 那是一張【空白貼紙】, 而員工會把它貼上箱子').toContain(
      '標籤圖片損壞, 勿貼, 請重印',
    );
    // 🔵 英文那一行是**豆腐字保險**:這條路零字型, 中文萬一畫不出來, ASCII 一定畫得出來。
    expect(m.visibleText).toContain('DO NOT USE');
    // 🔴 **字有了不等於看得見** —— 見 `measure()` 裡那段:`.x{width:0}` 這個突變會讓上面全綠。
    expect(m.warn.w, '警告框的寬是 0 ⇒ 紙上看不到它, 而 innerText 照樣印字').toBeGreaterThan(0);
    expect(m.warn.h).toBeGreaterThan(0);
    expect(m.warn.xW, '大叉塌成 0 ⇒ 豆腐字那條保險沒了').toBeGreaterThan(0);
    expect(m.warn.xH).toBeGreaterThan(0);
    // 🔴 **而這一格量到的東西比預期的多**:那份 PDF **661 bytes(本機這一發)、`%PDF` 開頭、HTTP 會是 200**
    //    ⇒ 📌 「空白貼紙」在每一個非視覺的訊號上都與「正常」一模一樣。
    //    ⛔ ~~而我一度把它寫成 `toBeLessThan(1000)`~~(codex R2 訂正)—— **那是偶然讀數不是性質**。
    console.info(`[label-sheet-pdf] 壞圖那份 PDF = ${m.bytes} bytes(僅記錄, 不斷言)`);
    expect(m.pages).toBe(1);
  }, 60_000);
});
