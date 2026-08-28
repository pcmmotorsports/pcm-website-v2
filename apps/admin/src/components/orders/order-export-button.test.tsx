// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderExportButton } from './order-export-button';

// order-export-button.test.tsx — `#24` 片B 的靜態守門。
//
// 🔴🔴 **本檔不驗下載。** 下載那一半只有真瀏覽器算數 ——
//    2026-08-26 已在鑽機上實跑過(`localhost:3073`,真的按下去):
//      createObjectURL 1 次 / revokeObjectURL 1 次 / 帶 download 的 anchor 被 click /
//      位元組前三個 = EF BB BF(而 `blob.text()` 會剝掉 BOM ⇒ 那把尺會說謊)
//    ⚠️ 而那一發**攔掉了 anchor 的原生 click** ⇒ 證的是「產得出正確位元組並走到下載那一步」,
//      **不是「檔案落到磁碟上」**。
//    🔴 而 code-reviewer `I4` 指出那個攔截讓**一整類缺陷完全逃過**:
//      「revoke 太早」在攔掉 click 的世界裡,與「revoke 得剛好」**印一模一樣的東西**。
//      ⇒ 那一格的修法(`setTimeout(…, 0)`)是照著「**我量不到它**」做的,
//        不是照著「我量到它壞了」做的。**本檔也量不到它。**
//
// 📌 「本檔的綠」與「下載可用」是兩個宣稱 —— 不要把前者讀成後者。
//
// 🔴 本檔在 R1 之後改過形狀:元件不再收 `orders`,改收 server 端組好的字串
//    (`I3`:整包讀模型跨進 client bundle 是前向且無訊號的風險)。
//    ⇒ 這些測試因此變得**與訂單資料無關** —— 那正是這次改動要的效果。

const CSV = '﻿"本檔 = …"\r\n單號,日期\r\nPCM-0001,08/26\r\n';

describe('匯出鈕:可以匯出時', () => {
  it('渲染出一顆按鈕', () => {
    const html = renderToStaticMarkup(
      <OrderExportButton csv={CSV} filename='訂單商品-20260826-第1頁.csv' blockedReason={null} />,
    );
    expect(html).toContain('data-export-button');
    expect(html).toContain('匯出這一頁');
    // 負對照:此時【不該】出現擋下來的那個訊息
    expect(html).not.toContain('data-export-blocked');
  });

  it('🔴 高度是 h-8 —— 不得撐高所在的那一列', () => {
    const html = renderToStaticMarkup(
      <OrderExportButton csv={CSV} filename='x.csv' blockedReason={null} />,
    );
    /* 上界來自那一列(`order-toolbar-browser.test.tsx:208` 把整列釘在 35,
       而那個 35 是 Sean 2026-08-24 拍板的字級規則撐的);
       下界來自 OD `orders-admin-v2.html:5718` 的 `#od-stage button{min-height:24px}`。
       📌 我在 `fc6a1edf` 用 `py-2` 撐高過一次(修在 `03f7e27f`)—— 這一格就是防它再來。 */
    expect(html).toContain('h-8');
    expect(html).not.toContain('py-2');
  });

  it('🔴 元件本身不含任何訂單資料的結構 —— 它只收字串', () => {
    /* `I3` 的修法要看得出來:這顆元件的 props 裡沒有 `orders`。
       ⇒ 這一格不是測畫面, 是**釘住那個介面形狀** ——
         哪天有人把 `orders` 傳回來, TypeScript 會擋, 而這句註解說得出為什麼。 */
    const html = renderToStaticMarkup(
      <OrderExportButton csv={CSV} filename='x.csv' blockedReason={null} />,
    );
    // 🔴 **分母守門(2026-08-28 量到這一格是恆綠的)**:元件空渲染時 `html` 幾乎是空字串
    //    ⇒ `not.toContain` 恆真 ⇒「沒帶訂單資料」與「整顆鈕沒渲染」印同一個綠。
    //    釘的是**有一顆鈕**(結構),不是鈕上的字。
    expect(html, '連一顆 button 都沒渲染 ⇒ 下面那條恆真').toContain('<button');
    expect(html).not.toContain('PCM-0001');
  });
});

describe('🔴🔴 匯出鈕:資料是半份的時候【不給匯出】, 而且把理由講出來', () => {
  const REASON = '這一頁有 1 張單的品項沒有全部載入,匯出會少東西 ⇒ 不要拿這份檔對帳。';

  it('有理由 ⇒ 出現理由, 而按鈕消失', () => {
    const html = renderToStaticMarkup(
      <OrderExportButton csv={CSV} filename='x.csv' blockedReason={REASON} />,
    );
    expect(html).toContain('data-export-blocked');
    expect(html).toContain('不要拿這份檔對帳');
    // 🔴 這一格是重點:不是把按鈕變灰, 是【它不在】
    //    「變灰」是一個看起來有處理過的狀態, 而它讓人以為按下去會有事發生。
    expect(html).not.toContain('data-export-button');
  });

  it('負對照:沒有理由時不會誤擋(證上面那格不是恆真)', () => {
    const html = renderToStaticMarkup(
      <OrderExportButton csv={CSV} filename='x.csv' blockedReason={null} />,
    );
    // 🔴 **分母守門**:同上。⚠️ 這一格的標題自稱「負對照,證上面那格不是恆真」——
    //    **而它自己在「元件沒渲染」那個世界也印綠** ⇒ 一個對照組在兩個世界印同一個東西,
    //    它沒有在對照。(2026-08-28 量到。)
    expect(html, '連一顆 button 都沒渲染 ⇒ 下面那條恆真').toContain('<button');
    expect(html).not.toContain('不要拿這份檔對帳');
  });
});
