// hct-label-layout.ts — 新竹回傳的標籤圖 → 兩種版面的擺放(⟦ship-HCTAPI⟧ 片 D)。
//
// 🔴🔴 **本檔【零網路、零 env、零 DB】** —— 它只回答「N 張圖要擺在哪幾格」。
//    ⇒ 餵一張假的 base64 就驗得完 ⇒ 📌 **所以它不依賴那支 migration、不依賴帳密、不依賴片 C。**
//
// 📎 **來源**:Sean 2026-09-04 拍甲「用他們的圖就好」+ 逐字
//    「應該有兩種版面, 一個適合單個的標籤紙, 一個是他們制式的 A4 貼紙」。
//    而**制式 A4 貼紙是 2 欄 × 3 列** —— 那是**他截圖裡的格子圖**, 不是規格書寫的。
//
// 🛑🛑 **我量到的是哪一層 —— 這一段不要被讀寬**:
//    ✅ **量得到**:哪一張圖擺進哪一格、空格會不會被填、壞圖會不會靜靜空白 ⇒ **純邏輯, 單元測試驗得完**
//    ❌ **量不到**:🔴 **紙上印出來對不對** —— 我**沒有印表機**, 也沒有那種標籤貼紙。
//      ⇒ 而**列印預覽不算** —— 這條線今天早上才因為「拿預覽當事實」錯過一次
//        (主視窗說「1 項印 2 張紙是 bug」而 Sean 實印是 1 頁)。
//      ⇒ 📌 **所以下面那些 mm 值是【版面意圖】, 不是【驗過的事實】。**
//
// 🔴 **而規格【沒有】給整張標籤的長寬** —— 標籤規格書逐頁掃過, 只有局部標註
//    (左上 2.5cm / 中段 5.5cm / 底部 6.5cm 與 3.2cm), **方向、可印邊界、一張紙幾張全部未提及**。
//    ⇒ 🛑 **所以 2×3 那個格子大小是【我從 A4 除出來的】, 不是規格說的。** 見 `A4_GRID` 的註解。

/**
 * 「從第幾格開始印」—— 🔴 **這是【版面參數】, 不是 API 參數。**
 *
 * 🔬 我掃過兩處確認新竹**沒有**這個功能:第 8 頁的 SOAP 服務清單(12 支逐支)
 *    與第 10 頁 `TransData` 的完整參數表 ⇒ **沒有任何一支或任何一欄與列印位置有關**。
 * 🎯 **而它【不需要】有** —— `TransData` 回傳的是**每一筆自己的一張圖**,
 *    把 N 張圖排到一張 2×3 的紙上、從第幾格開始, **本來就是我們這邊的事**。
 * 📌 Sean 說「後台可以選從第幾格開始」⇒ 那是**新竹自家後台自己排版**的功能
 *    ⇒ 與重量那格同一個形狀:**網頁後台有 ≠ API 有** —— 而這次的結論是「不需要它有」。
 *
 * 🔵 **它存在的理由是【一張貼紙可以用兩次】** —— 上次印了 2 張, 這次從第 3 格開始接著印。
 */
export type LabelSheet = 'single' | 'a4-2x3';

/**
 * 🔴 **A4 制式貼紙 = 2 欄 × 3 列 = 一張 6 格。**
 *
 * ⚠️ **`2 × 3` 這個數字的來源是【Sean 的截圖】**(他後台畫面上的格子圖), **不是規格書**。
 *    規格書對「一張紙幾張標籤」逐字**未提及**(全 30 頁掃過)。
 * 🛑 **而每一格的 mm 是我從 A4(210×297mm)除出來的算術, 不是任何人給的值**
 *    ⇒ 那個算術**沒有扣掉貼紙本身的邊界與格間距**, 而真的貼紙一定有。
 *    ⇒ 📌 **所以它會需要被校準, 而校準要一張真的貼紙 + 一次真的印** —— 那兩樣我都沒有。
 *    ⇒ ✅ 校準的鈕留在 CSS 變數上(`--hct-label-w` / `--hct-label-h`), 不寫死在這裡。
 */
export const A4_GRID = { cols: 2, rows: 3, perSheet: 6 } as const;

/** 一格的內容:有圖、或刻意留空(前面被跳過的格)。 */
export type LabelSlot =
  | { kind: 'label'; imageBase64: string; shipmentRef: string }
  /** 🔵 起始位置之前那幾格 —— **刻意留白**(那裡的貼紙上次已經撕走了)。 */
  | { kind: 'skipped' }
  /**
   * 🔴🔴 **圖是壞的 / 空的 ⇒ 這一格【要說話】, 不得靜靜空白。**
   *
   * 🎯 因為**「這一格沒有標籤」與「這一格的標籤壞了」在紙上長得一模一樣** ——
   *    而員工會把那張紙拿去貼箱子。
   * ⇒ 📌 一張少了一格標籤的紙, 與一張那一格印壞了的紙, **後果完全不同**:
   *    前者他會發現(數量不對), 後者他會**貼一張空白上去**。
   */
  | { kind: 'broken'; shipmentRef: string; reason: string };

export type LabelPage = { slots: LabelSlot[] };

export type BuildLabelPagesInput = {
  /** 新竹回傳的圖(`TransData` 的 `image` 欄), 一筆一張。 */
  labels: { imageBase64: string; shipmentRef: string }[];
  sheet: LabelSheet;
  /**
   * 從第幾格開始(1-based, 只對 `a4-2x3` 有意義)。
   * 🔵 1 = 從左上角開始(整張新的貼紙)。
   */
  startAt?: number;
};

/** 一個 base64 字串「看起來像不像一張圖」—— 而它**只答得起這一層**。 */
function brokenReason(b64: string): string | null {
  if (b64.trim() === '') return 'empty';
  // 🔴 只擋明顯壞的:非 base64 字元。
  // 🛑 **而它【證不到】那是一張看得懂的標籤** —— 一個合法的 base64 可以解出一張全黑的圖,
  //    而本函式會說它好。⇒ 📌 **這一層擋的是「傳輸/欄位壞掉」, 不是「內容不對」。**
  //    ⇒ 內容對不對要靠人眼看那張紙, 而那是 Sean 的驗收, 不是這支檔的。
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return 'not_base64';
  if (b64.replace(/\s/g, '').length < 64) return 'too_short';
  return null;
}

/**
 * 把 N 張標籤排成一頁或多頁。
 *
 * 🔵 **`single` 版面 = 一張圖一頁**(單張標籤紙那條路)⇒ 沒有跳格、沒有空格的概念。
 * 🔵 **`a4-2x3` 版面 = 六格一頁**, 而第一頁**從 `startAt` 開始**, 之前那幾格是 `skipped`。
 */
export function buildLabelPages(input: BuildLabelPagesInput): LabelPage[] {
  const toSlot = (l: { imageBase64: string; shipmentRef: string }): LabelSlot => {
    const bad = brokenReason(l.imageBase64);
    return bad === null
      ? { kind: 'label', imageBase64: l.imageBase64, shipmentRef: l.shipmentRef }
      : { kind: 'broken', shipmentRef: l.shipmentRef, reason: bad };
  };

  if (input.sheet === 'single') {
    return input.labels.map((l) => ({ slots: [toSlot(l)] }));
  }

  const start = input.startAt ?? 1;
  // 🔴 起始格超出範圍 ⇒ **丟例外, 不夾**。
  //    夾到 1 會讓員工以為「它從第 1 格開始了」而他手上那張貼紙的第 1 格已經撕走
  //    ⇒ 🎯 **第一張標籤會印在一個不存在的格子上, 而那是一張浪費掉的貼紙。**
  if (!Number.isInteger(start) || start < 1 || start > A4_GRID.perSheet) {
    throw new Error(
      `buildLabelPages: 起始格必須是 1..${A4_GRID.perSheet} 的整數, 收到 ${String(start)} —— ` +
        '夾到 1 會讓標籤印在一個已經撕走的格子上, 而那是一張浪費掉的貼紙。',
    );
  }

  const slots: LabelSlot[] = [];
  for (let i = 1; i < start; i += 1) slots.push({ kind: 'skipped' });
  for (const l of input.labels) slots.push(toSlot(l));

  const pages: LabelPage[] = [];
  for (let i = 0; i < slots.length; i += A4_GRID.perSheet) {
    pages.push({ slots: slots.slice(i, i + A4_GRID.perSheet) });
  }
  return pages;
}

/**
 * 🔴 **一次上限 5 筆** —— 規格第 12 頁逐字
 * 「PS:傳送一批資料請不要超過 30 筆, **若使用回傳圖檔, 一次上限為 5 筆**。」
 *
 * 🔵 而 Sean 拍甲時逐字說「**幾乎不會 —— 一天出幾單而已**」⇒ 這個上限對他不構成問題。
 * 🛑 **而它仍然要在碼裡** —— 「今天不會撞到」與「撞到時會被擋下」是兩件事,
 *    而**業務會長大**, 那一天不會有人回來讀這段註解。
 */
export const HCT_LABEL_BATCH_MAX = 5;

/**
 * 把排好的頁變成一份可以餵給 `htmlToPdf` 的 HTML。⟦ship-HCTLABELCAPTURE⟧ 片 D2。
 *
 * 🔴🔴 **這張紙上【一個字都沒有】—— 而那是刻意的, 不是偷懶。**
 *    ① 貼紙那條路(`a4-2x3`)上的任何多餘文字都會**印在貼紙上**跟著貼上箱子。
 *    ② 零文字 ⇒ **零字型** ⇒ 這條路完全避開了出貨單那條踩過的「本機好、線上豆腐字」。
 *    ⇒ 📌 所以 `broken` 那一格**不在這裡處理** —— 呼叫端在產檔【之前】就要擋下來
 *      (`route.ts` 逐字:一格不是 `label` ⇒ 回 409, 不產檔)。本函式收到 `broken` 會**丟例外**,
 *      因為走到這裡代表那道閘漏了, 而**一張少一格的紙比一個錯誤難發現**。
 *
 * 🛑🛑 **`mm` 那組值我【沒有印出來量過】** —— 我沒有印表機也沒有那種貼紙(同本檔檔頭)。
 *    ⇒ ✅ 校準鈕就是 `--hct-label-w` / `--hct-label-h`(本檔檔頭 `:43` 承諾過的那兩顆),
 *      改它們不用動碼。**而條碼掃不掃得到只有真的印一張拿尺量才知道。**
 *
 * 🔴 圖用 `object-fit: contain` 而**不拉伸** —— 拉伸會改掉條碼的實體寬度,
 *    而**一張變形的條碼在螢幕上看起來完全正常**。
 *
 * 🛑🛑 **已知限制(`Q-標籤10` 主視窗 2026-09-06 裁「丙 + 丁」, 而它是【決定】不是疏漏)**:
 *    `hct-label-image.ts` 驗得到那張圖的**頭與尾**, **驗不到中間**。而中間壞掉有**兩種**, 分開講:
 *    ① **解不開**(結構壞到 decoder 拒絕)⇒ ✅ **丁兜得到** —— `onerror` 觸發, 紙上長出警告框。
 *    ② **解得開而內容是錯的**(結構合法、CRC 過, 而條碼是噪訊 / 是別張單的圖)
 *       ⇒ 🛑 **兩層都不兜。** `error` 事件**不會**發(它 `load`), 伺服器層也看不出來。
 *       ⇒ 📌 **只有人眼與掃碼機分得出來。**
 *    ⛔ ~~我原本寫「兜它的是這一層的 onerror」~~(2026-09-06 code-reviewer must-fix 訂正)——
 *      **那句話把 ① 的能力借給了 ②**, 而讀的人會以為②也被守住了。
 *    ⛔ ~~甲案(伺服器層走 PNG chunk 鏈 + CRC)~~ 被裁掉, 理由逐字:
 *      「一張真圖都沒看過、格式都未定, 為 PNG 寫 60 行驗證是替沒量過的東西付錢, 而它擋不住像素壞」。
 *    ⚠️ **重估條件**:**拿到第一張真圖之後**回來重看要不要甲。板列 `⟦ship-HCTLABELCAPTURE⟧`。
 */
export function buildLabelSheetHtml(pages: LabelPage[], mime: string, sheet: LabelSheet): string {
  // 🔴 `mime` 會被直接串進 `src="data:${mime};base64,..."` 這個**屬性值**裡。
  //    今天唯一的呼叫端餵的是 `hct-label-image.ts` 那張固定表 ⇒ **今天不可達**;
  //    🛑 而「今天不可達」不是「擋住了」—— 下一個呼叫端餵 `x" onerror="…` 就破得出屬性。
  //    ⇒ 📌 一行白名單, 而它擋的是**下一個人**, 不是現在這個。
  if (!/^image\/[a-z0-9.+-]+$/.test(mime)) {
    throw new Error(`buildLabelSheetHtml: mime 不是一個 image/* 字面(收到 ${JSON.stringify(mime)})`);
  }
  const cells = (p: LabelPage): string =>
    p.slots
      .map((s) => {
        if (s.kind === 'skipped') return '<div class="cell"></div>';
        if (s.kind === 'broken') {
          // 走到這裡 = 呼叫端那道閘漏了。**丟例外, 不畫一格空白。**
          throw new Error(`buildLabelSheetHtml: 收到 broken(${s.reason}) —— 產檔前那道閘沒擋住`);
        }
        // 🔴🔴 **`onerror` 是這一片最後一道, 而它守的是【伺服器層驗不到的那一種壞】**
        //    (`Q-標籤10`, 主視窗 2026-09-06 裁「丙 + 丁」):
        //    `hct-label-image.ts` 驗得到**頭與尾**, **驗不到中間** —— codex R2 逐字打掉了我那個
        //    「頭尾對 ⇒ 解得開」的推論(它餵我的 fixture ⇒ `ok:true`, 而第一個 chunk type
        //    是非法的 `7f7f7f7f`, 真 Chromium 解不開)。
        //    ⇒ 🛑 **而那種圖走到紙上, 就是一張【空白貼紙】** —— 而空白貼紙與正常貼紙
        //      在每一個非視覺訊號上都一樣(HTTP 200、`%PDF`、頁數對)。
        //    ⇒ ✅ 所以這裡不再賭「它解得開」, 改成**讓解不開這件事在紙上長出形狀**。
        //
        // 🔵 **那個形狀刻意不只靠文字**:警告框有一個**純 CSS 畫的大叉**(兩條旋轉的槓)——
        //    這條路零字型, 而萬一中文變成豆腐字, **那個叉照樣看得出來**。
        //    英文那一行同理(ASCII 一定畫得出來)。⇒ 📌 一張看得到錯的紙, 而不是一張空白的紙。
        return (
          `<div class="cell"><img alt="" src="data:${mime};base64,${s.imageBase64}" ` +
          `onerror="this.closest('.cell').classList.add('broken')">` +
          `<div class="warn"><div class="x"></div>` +
          `<b>標籤圖片損壞, 勿貼, 請重印</b><span>DO NOT USE - REPRINT</span>` +
          // 🔵 `shipmentRef` **沒有跳脫, 而它今天是安全的** —— 不是我漏了(對照正上方 `mime` 那道白名單):
          //    DB 那一層釘死了它的字元集, `20260805170000_m4b_e10_b2_s1a1_shipments.sql` 逐字
          //    `CHECK (shipment_reference ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$')`
          //    ⇒ 六個大寫英數, **造不出任何 HTML 語法字元**。
          //    📌 寫這一句的理由:不寫的話, 下一個人看到的是「一個守了、一個沒守」。
          `<small>${s.shipmentRef}</small></div></div>`
        );
      })
      .join('');
  const sheets = pages.map((p) => `<section class="sheet">${cells(p)}</section>`).join('');
  // 🔴 **兩種版面的格子大小不同, 而它在同一份 CSS 裡** ——
  //    `single` = 一張圖一頁(整頁一格);`a4-2x3` = 105×99mm 六格。
  //    ⛔ 少了這個分岔的話, 單張那條路會把圖擠進左上角 105×99mm 的角落, **而它照樣印得出來。**
  const cols = sheet === 'single' ? 1 : A4_GRID.cols;
  const cellW = sheet === 'single' ? '210mm' : '105mm';
  const cellH = sheet === 'single' ? '297mm' : '99mm';
  // 🔴🔴 **紙高也要是一顆鈕 —— 而 `297mm` 恰好落在本 repo 已經量到的那一格**
  //    (code-reviewer 2026-09-06):`print-a4.css` 那族留著量測 ——
  //    `min-height` 設成「宣告紙高」時**0 項的單也印 2 頁**, 壓下去才 1 頁。
  //    ⚠️ **射程要寫清楚**:那一發量的是**瀏覽器列印 + `@page` 邊距**,
  //      不是這條路的 puppeteer(`format:'A4'`, 邊距預設 0)⇒ **兩者不是同一個世界**。
  //    🛑 而這條路**一份 PDF 都沒有產出來過** ⇒ 我沒有理由說它安全, 也沒有理由說它壞。
  //    ⇒ ✅ 把它變成 `--hct-sheet-h`:**多印一頁的那天, 改一個值就好, 不必動碼。**
  const sheetH = '297mm';
  // 🔴 **下面那份 CSS 裡的 `@page{size:A4;margin:0}` 今天【是死的】** ——
  //    `packages/pdf/src/index.ts` 的 `page.pdf({ format: 'A4' })` 沒帶 `preferCSSPageSize`
  //    ⇒ CSS 的紙張設定被忽略(結果剛好一樣, 因為那支的邊距預設就是 0)。
  //    ⇒ 📌 下一個人來改那一行會得到【零效果】, 而他不會知道為什麼。要它生效得改那一支。
  //
  // 🛑🛑 **而這段話住在【碼的註解】裡, 不住在那份 CSS 裡 —— 那是被守門逼出來的**:
  //    我第一版把它寫成 CSS 註解 ⇒ 它**跟著進了每一份 PDF**,
  //    而同檔那格「HTML 裡不得有中日韓文字」的負對照當場紅
  //    (2026-09-06 實撞;那格本來是為了「零文字 ⇒ 零字型」而寫的, 結果先抓到我自己)。
  //    ⇒ 📌 **給下一個人看的字, 不要放進要送出去的產物裡。**
  //
  // ⚠️ 另一個實撞:那段話裡原本有反引號 ⇒ 它住在 template literal 裡 ⇒ **字串被截斷**,
  //    而 `build` 的錯誤訊息指到 CSS 那一行, 不是指到寫錯的地方(rc=1, 2026-09-06)。
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--hct-label-w:${cellW};--hct-label-h:${cellH};--hct-sheet-h:${sheetH}}
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4;margin:0}
.sheet{display:grid;grid-template-columns:repeat(${cols},var(--hct-label-w));
  grid-auto-rows:var(--hct-label-h);width:210mm;height:var(--hct-sheet-h);page-break-after:always}
.sheet:last-child{page-break-after:auto}
.cell{display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.cell img{max-width:100%;max-height:100%;object-fit:contain}
.warn{display:none}
.cell.broken img{display:none}
.cell.broken .warn{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:4mm;width:100%;height:100%;border:2mm solid #000;text-align:center;font-size:6mm;font-weight:700}
.cell.broken .warn span{font-size:5mm;letter-spacing:.5mm}
.cell.broken .warn small{font-size:4mm;font-weight:400}
.x{width:24mm;height:24mm;position:relative}
.x::before,.x::after{content:'';position:absolute;top:11mm;left:0;width:24mm;height:2mm;background:#000}
.x::before{transform:rotate(45deg)}
.x::after{transform:rotate(-45deg)}
</style></head><body>${sheets}</body></html>`;
}
