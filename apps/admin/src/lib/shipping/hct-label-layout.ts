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
