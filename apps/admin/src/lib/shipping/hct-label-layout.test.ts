import { describe, expect, it } from 'vitest';
import {
  A4_GRID,
  HCT_LABEL_BATCH_MAX,
  buildLabelPages,
  buildLabelSheetHtml,
  type LabelPage,
  type LabelSlot,
} from './hct-label-layout';

// hct-label-layout.test.ts — ⟦ship-HCTAPI⟧ 片 D 的守門。
//
// 🔴 **這一片的正確性完全靠這支檔** —— 它零網路零 env 零 DB。
// 🛑 **而它【證不到】紙上印出來對不對** —— 我沒有印表機、也沒有那種標籤貼紙。
//    ⇒ 📌 下面每一格問的都是「哪一張圖擺進哪一格」, **不是「那一格在紙上多大」**。

/** 一張「看起來像圖」的假 base64(長度過關、字元合法)。內容不重要 —— 本片不解圖。 */
const OK_IMG = 'iVBORw0KGgoAAAANSUhEUg'.repeat(4);
const lab = (n: number, img = OK_IMG) => ({ imageBase64: img, shipmentRef: `REF${n}` });
const kinds = (slots: LabelSlot[]) => slots.map((s) => s.kind);

describe('⟦ship-HCTAPI⟧ 片 D · single —— 一張圖一頁', () => {
  it('🔵 三張圖 ⇒ 三頁, 每頁一格', () => {
    const pages = buildLabelPages({ labels: [lab(1), lab(2), lab(3)], sheet: 'single' });
    expect(pages.length).toBe(3);
    expect(pages.every((p) => p.slots.length === 1)).toBe(true);
  });

  it('🔵 single 不理會 startAt(那個概念只對貼紙有意義)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'single', startAt: 4 });
    expect(pages.length).toBe(1);
    expect(kinds(pages[0]!.slots), 'single 也跳格 ⇒ 會平白多印三張紙').toEqual(['label']);
  });
});

describe('⟦ship-HCTAPI⟧ 片 D · a4-2x3 —— 六格一頁, 而【從第幾格開始】是版面參數', () => {
  it('🔵 六張圖 + 從第 1 格 ⇒ 一頁六格全是標籤', () => {
    const pages = buildLabelPages({
      labels: [1, 2, 3, 4, 5, 6].map((n) => lab(n)),
      sheet: 'a4-2x3',
      startAt: 1,
    });
    expect(pages.length).toBe(1);
    expect(kinds(pages[0]!.slots)).toEqual(Array(6).fill('label'));
  });

  /**
   * 🔴 **這一格是「從第幾格開始」的承重。**
   * 少了它, 一個**忽略 `startAt`** 的實作照樣通過上面那格 ——
   * 而後果是:🎯 **第一張標籤印在一個【已經撕走的格子】上 ⇒ 一張浪費掉的貼紙。**
   */
  it('🔴 從第 3 格開始 ⇒ 前兩格是 skipped, 而標籤從第 3 格接下去', () => {
    const pages = buildLabelPages({
      labels: [lab(1), lab(2)],
      sheet: 'a4-2x3',
      startAt: 3,
    });
    expect(pages.length).toBe(1);
    expect(kinds(pages[0]!.slots)).toEqual(['skipped', 'skipped', 'label', 'label']);
  });

  it('🔵 跨頁:從第 5 格開始放 4 張 ⇒ 第一頁六格(4 skipped + 2 label)· 第二頁 2 格', () => {
    const pages = buildLabelPages({
      labels: [1, 2, 3, 4].map((n) => lab(n)),
      sheet: 'a4-2x3',
      startAt: 5,
    });
    expect(pages.length).toBe(2);
    expect(kinds(pages[0]!.slots)).toEqual([
      'skipped', 'skipped', 'skipped', 'skipped', 'label', 'label',
    ]);
    // 🔵 第二頁【不補 skipped】—— 它是一張新的貼紙, 從第 1 格開始。
    expect(kinds(pages[1]!.slots)).toEqual(['label', 'label']);
  });

  it.each([0, -1, 7, 1.5, Number.NaN])('🔴 起始格 %s ⇒ 丟例外, 不夾到 1', (n) => {
    expect(() =>
      buildLabelPages({ labels: [lab(1)], sheet: 'a4-2x3', startAt: n }),
    ).toThrow(/起始格必須是/);
  });

  it('🔵 正對照:起始格 6(邊界內最大)⇒ 正常走(證明上面那幾格不是因為它永遠丟例外)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'a4-2x3', startAt: 6 });
    expect(kinds(pages[0]!.slots)).toEqual([
      'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'label',
    ]);
  });

  it('🔵 沒給 startAt ⇒ 當作 1(整張新的貼紙)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'a4-2x3' });
    expect(kinds(pages[0]!.slots)).toEqual(['label']);
  });
});

describe('⟦ship-HCTAPI⟧ 片 D · 壞掉的圖 —— 這一格【要說話】, 不得靜靜空白', () => {
  /**
   * 🔴🔴 **這一族是主視窗指名要的第三條**:假 base64 要能演兩個世界。
   *
   * 🎯 **理由**:「這一格沒有標籤」與「這一格的標籤壞了」**在紙上長得一模一樣** ——
   *    而員工會把那張紙拿去貼箱子。
   * ⇒ 📌 一張少了一格的紙他**會發現**(數量不對);一張那一格印壞的紙他會
   *    **貼一張空白上去** —— 而那個箱子就這樣出門了。
   */
  it.each([
    ['空字串', ''],
    ['只有空白', '   \n '],
    ['不是 base64', '<<<這不是圖>>>'],
    ['太短', 'iVBORw0KGgo'],
  ])('🔴 %s ⇒ broken, 而它帶得出【是哪一張單】與【為什麼】', (_n, bad) => {
    const pages = buildLabelPages({ labels: [lab(9, bad)], sheet: 'single' });
    const slot = pages[0]!.slots[0]!;
    expect(slot.kind, '壞圖被當成正常標籤 ⇒ 紙上一格空白, 而員工會貼上去').toBe('broken');
    // 🔴 承重:少了這兩行, 一個「壞了就回 broken 但不說是哪張」的實作也會過
    //    ⇒ 而員工拿著一張紙, 不知道少的是哪一箱。
    expect(slot).toMatchObject({ shipmentRef: 'REF9' });
    expect((slot as { reason: string }).reason.length).toBeGreaterThan(0);
  });

  it('🔵 負對照:好的圖 ⇒ label(證明上面那幾格不是因為它把每一張都判壞)', () => {
    const pages = buildLabelPages({ labels: [lab(1)], sheet: 'single' });
    expect(pages[0]!.slots[0]!.kind).toBe('label');
  });

  it('🔵 好壞混在同一頁 ⇒ 各自歸各自, 壞的那一格不吃掉好的', () => {
    const pages = buildLabelPages({
      labels: [lab(1), lab(2, ''), lab(3)],
      sheet: 'a4-2x3',
      startAt: 1,
    });
    expect(kinds(pages[0]!.slots)).toEqual(['label', 'broken', 'label']);
  });
});

describe('⟦ship-HCTAPI⟧ 片 D · 那兩個常數', () => {
  it('🔵 A4 制式貼紙是 2 欄 × 3 列 = 六格(來源 = Sean 的截圖, 不是規格書)', () => {
    expect(A4_GRID.cols).toBe(2);
    expect(A4_GRID.rows).toBe(3);
    // 🔴 承重:`perSheet` 若與 cols×rows 不一致, 跨頁那幾格會安靜地切錯。
    expect(A4_GRID.perSheet).toBe(A4_GRID.cols * A4_GRID.rows);
  });

  it('🔴 一次上限 5 筆(規格第 12 頁逐字「若使用回傳圖檔, 一次上限為 5 筆」)', () => {
    // 🛑 Sean 說「幾乎不會 —— 一天出幾單而已」⇒ 今天不會撞到。
    //    而「今天不會撞到」與「撞到時會被擋下」是兩件事, 業務會長大。
    expect(HCT_LABEL_BATCH_MAX).toBe(5);
  });
});

describe('buildLabelSheetHtml(⟦ship-HCTLABELCAPTURE⟧ 片 D2)', () => {
  const lab = (n: number): LabelPage => ({
    slots: [{ kind: 'label', imageBase64: `AAAA${n}`, shipmentRef: `S-${n}` }],
  });

  it('圖進了 data URI, 而 mime 用傳進來的那一個', () => {
    const html = buildLabelSheetHtml([lab(1)], 'image/bmp', 'single');
    expect(html).toContain('src="data:image/bmp;base64,AAAA1"');
  });

  // 🔴 兩種版面的格子大小不同, 而**少了那個分岔照樣印得出來**(圖擠在左上角)。
  it('single = 整頁一格;a4-2x3 = 105×99mm 兩欄', () => {
    const one = buildLabelSheetHtml([lab(1)], 'image/png', 'single');
    expect(one).toContain('--hct-label-w:210mm');
    expect(one).toContain('repeat(1,');
    const six = buildLabelSheetHtml([lab(1)], 'image/png', 'a4-2x3');
    expect(six).toContain('--hct-label-w:105mm');
    expect(six).toContain(`repeat(${A4_GRID.cols},`);
  });

  it('skipped 那幾格是空的 div(貼紙上次撕走的位置)', () => {
    const page: LabelPage = { slots: [{ kind: 'skipped' }, ...lab(2).slots] };
    const html = buildLabelSheetHtml([page], 'image/png', 'a4-2x3');
    expect(html).toContain('<div class="cell"></div>');
  });

  // 🔴🔴 走到這裡代表呼叫端那道閘漏了 ⇒ **丟例外, 不畫一格空白**:
  //    一張少一格的紙比一個錯誤難發現, 而員工會把那格空白貼上箱子。
  it('收到 broken ⇒ 丟例外(不得靜靜畫一格空白)', () => {
    const page: LabelPage = { slots: [{ kind: 'broken', shipmentRef: 'S-9', reason: 'empty' }] };
    expect(() => buildLabelSheetHtml([page], 'image/png', 'single')).toThrow(/broken\(empty\)/);
  });

  it('多頁 ⇒ 多個 section, 而最後一頁不強制分頁', () => {
    const html = buildLabelSheetHtml([lab(1), lab(2)], 'image/png', 'a4-2x3');
    expect(html.match(/<section class="sheet">/g)).toHaveLength(2);
    expect(html).toContain('.sheet:last-child{page-break-after:auto}');
  });

  // 🔵 這張紙上**一個字都沒有** —— 零文字 ⇒ 零字型 ⇒ 完全避開「線上豆腐字」那條路。
  //    ⚠️ 射程:它問的是**我們產的 HTML**, 不是**新竹畫在圖裡的字**(那些是圖不是文字)。
  // 🔴 ⛔ ~~舊版問的是 `/[\u4e00-\u9fff]/`~~(2026-09-06 codex R1 nit 訂正)——
  //    那只涵蓋基本漢字:**假名 / 韓文 / 甚至英文可見文字都通得過**,
  //    而政策是「零可見文字」不是「零漢字」⇒ 📌 **一把只擋得住一種字的尺, 讀起來像擋住了全部。**
  //    ✅ 改成剝掉標籤之後看剩下什麼 —— 那才是**紙上真的看得到的東西**。
  // 🔴 ⛔ ~~舊版斷言「body 剝掉標籤之後是空字串」~~ —— **2026-09-06 起不再成立**:
  //    `Q-標籤10` 裁的「丁」把警告框的字**放進了 HTML**(預設 `display:none`, 壞圖才顯示)。
  //    ⇒ ✅ 改成問**正確的那個問題**:那些字**只准住在警告框裡**。
  //      正常情況下它們不顯示 ⇒ 零字型的前提仍然成立;而它們一旦顯示, 那張紙本來就該被丟掉。
  it('負對照:可見文字【只】住在警告框裡(正常的格子仍然一個字都沒有)', () => {
    const html = buildLabelSheetHtml([lab(1)], 'image/png', 'a4-2x3');
    const body = html.split('<body>')[1]?.split('</body>')[0] ?? '';
    expect(body, '抓不到 body ⇒ 本格是恆真的').not.toBe('');
    // 把警告框整段挖掉之後, 剩下的地方不准有任何字。
    const withoutWarn = body.replace(/<div class="warn">[\s\S]*?<\/div><\/div>/g, '');
    const leaked = withoutWarn.replace(/<[^>]*>/g, '').trim();
    expect(leaked, `警告框以外出現可見文字「${leaked}」⇒ 它需要字型, 而這條路一支都沒帶`).toBe('');
    // 🔵 正對照:警告框自己**真的有字**(否則上面那一格是恆真的 —— 挖掉一個空的東西)。
    expect(body).toContain('標籤圖片損壞, 勿貼, 請重印');
  });

  // 🔴 丁的字面守門:那句話與那顆 `onerror` 是**這一片最後一道**, 改字面要有東西紅。
  // ⛔ ~~舊標題寫「(豆腐字時也看得出來)」~~(2026-09-06 code-reviewer nit 訂正)——
  //    **本格沒有任何一句在看像素**, 它只在比字面。那個括號是一個宣稱, 不是這一格做到的事。
  //    ✅ 幾何那一半在 `label.pdf/label-sheet-pdf-browser.test.ts`(真瀏覽器量框)。
  it('丁:每張圖都掛 onerror, 而警告框的大叉是純 CSS 畫的(字面層)', () => {
    const html = buildLabelSheetHtml([lab(1), lab(2)], 'image/png', 'a4-2x3');
    expect(html.match(/onerror=/g), '有圖的格子沒掛 onerror ⇒ 壞圖會變成一張空白貼紙').toHaveLength(2);
    expect(html).toContain("classList.add('broken')");
    expect(html).toContain('<div class="x"></div>');
    expect(html, '大叉是純 CSS 畫的 —— 它不依賴任何字型').toContain('.x::before,.x::after');
    // 🔵 預設不顯示 —— 否則每一張正常的貼紙上都會多一個警告框。
    expect(html).toContain('.warn{display:none}');
  });
});
