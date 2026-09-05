// hct-trans-data-pdf-conformance.test.ts —— 把廠商規格的【欄位名與長度】離線釘住。
//
// 🔴🔴 **這一格能做, 是因為 PDF 給了欄位表 —— 而它【沒有】給 JSON 範例。**
//    來源:`API服務說明_V1.pdf`(公開文件, `https://www.hct.com.tw/Report/API%E6%9C%8D%E5%8B%99%E8%AA%AA%E6%98%8E_V1.pdf`)
//    **第 13 頁**, 標題逐字「Data 欄位、說明、長度(使用Json 傳入託運資料)」。
//    重抽法:`pdftotext -layout <pdf> -` ⇒ 文字行 `:384-406`(第 10 頁 `:261-284` 是 DataSet 版, 同一張表)。
//
// 🛑 **本檔證不到什麼 —— 三件, 先講**:
//    ① **外層形狀未知**:那個 `json` 參數到底是 `[ {...} ]` / `{"data":[...]}` / `{...}`,
//       **PDF 一個字都沒說**(全文含 `{"` 的行 = **0**)。本檔只驗【一筆的內容】, 不驗【外層】。
//       ⇒ 📌 那一格已端 Sean(跟新竹要範例), 在他拿回來之前**不要用第一張真單去試**。
//    ② **PDF 是 2022 版**。它的方法簽章寫大寫 `Company`, 而**線上服務描述頁是小寫 `<company>`**
//       ⇒ 🔴 **大小寫一律以線上為準**(今晚已經因為這個踩過一次)。而**欄位名的大小寫**兩邊一致, 所以本檔用得下去。
//    ③ 本檔**零對外請求** —— 它只跑 `buildHctTransData`, 不打任何網路。
import { describe, expect, it } from 'vitest';
import { buildHctTransData } from './hct-trans-data';

// 逐字抄自 PDF 第 13 頁那張表(欄位名 ⇒ Char(n))。
// 🔴 只列【本 repo 真的會送出去】的那幾個 —— 表上共 20 欄, 而我們送 9 欄。
//    沒列的那 11 欄不是漏掉, 是我們不送(它們在規格上都有預設值)。
const PDF_MAX = {
  epino: 30, // 訂單編號   必要欄位
  ercsig: 40, // 收貨人名稱 必要欄位
  ertel1: 15, // 收貨人電話1 必要欄位
  eraddr: 100, // 收貨人地址 必要欄位
  ejamt: 4, // 件數       必要欄位
  eqamt: 5, // 重量       必要欄位
  eprdct: 2, // 傳票類別   預設月結 11
  eprdcl2: 3, // 商品種類   預設 001
  emark: 100, // 備註
} as const;

const baseInput = {
  displayId: 'PCM-0001',
  recipient: { name: '王小明', phone: '0912345678', line: '台北市信義區信義路五段 7 號' },
  itemCount: 1,
  note: '',
};

describe('hct-trans-data 對 PDF 第 13 頁欄位表(離線, 零對外請求)', () => {
  it('① 送出去的每一個欄位都在規格表上 —— 沒有我們自己發明的鍵', () => {
    const { fields } = buildHctTransData(baseInput);
    const unknown = Object.keys(fields).filter((k) => !(k in PDF_MAX));
    expect(unknown, `這些鍵不在 PDF 第 13 頁那張表上 ⇒ 新竹會忽略它, 或整筆被拒`).toEqual([]);
    // 🔵 分母:一個空的 fields 也會讓上面那格綠。
    expect(Object.keys(fields).length, 'fields 是空的 ⇒ 上面那個空陣列什麼都不證明').toBeGreaterThan(0);
  });

  it('② 六個【必要欄位】一個都不能少', () => {
    const { fields } = baseInput && buildHctTransData(baseInput);
    const required = ['epino', 'ercsig', 'ertel1', 'eraddr', 'ejamt', 'eqamt'];
    const missing = required.filter((k) => !(k in fields) || String((fields as never)[k]) === '');
    expect(missing, 'PDF 標「必要欄位」而我們沒送或送空的 ⇒ 那一筆一定被拒').toEqual([]);
  });

  it('③ 每個欄位的長度都不超過規格 —— 餵超長輸入也一樣', () => {
    const { fields } = buildHctTransData({
      ...baseInput,
      displayId: 'X'.repeat(200),
      recipient: { name: '名'.repeat(200), phone: '0'.repeat(200), line: '址'.repeat(300) },
      note: '備'.repeat(300),
    });
    const over = Object.entries(fields)
      .filter(([k, v]) => k in PDF_MAX && String(v).length > PDF_MAX[k as keyof typeof PDF_MAX])
      .map(([k, v]) => `${k}: ${String(v).length} > ${PDF_MAX[k as keyof typeof PDF_MAX]}`);
    expect(over, `超過 PDF 第 13 頁的欄位長度 ⇒ 新竹會截斷或拒收, 而我們不知道是哪一種`).toEqual([]);
  });

  it('🔴 ④ `ejamt` 件數:規格是 Char(4) —— 而它是唯一沒有上限的欄位', () => {
    // 🔴 `hct-trans-data.ts:150` 逐字 `ejamt: String(input.itemCount)` —— **沒有 take() 包住**。
    //    其餘五個必要欄位都走 `take(..., HCT_MAX.x)`, 只有這一個是裸的。
    // 🎯 這一格【現在會紅】, 而那正是它存在的理由:件數到 5 位數就超過規格。
    //    ⚠️ 而它今天在真實資料上到不了 —— 一張訂單不會有 10000 件。
    //    ⇒ 📌 所以這是【規格違反】不是【今天的 bug】, 修法與急迫性由主視窗排。
    // ✅ 修法【不是截斷】而是 throw —— 截成 4 位會把錯的數量變成合法的請求。
    expect(() => buildHctTransData({ ...baseInput, itemCount: 12345 })).toThrow(/超過規格上限 9999/);

    // 🟢 邊界兩側各一格:9999 要過, 10000 要擋。少了這兩格, 一個「永遠 throw」的實作也會通過。
    expect(String(buildHctTransData({ ...baseInput, itemCount: 9999 }).fields.ejamt)).toBe('9999');
    expect(() => buildHctTransData({ ...baseInput, itemCount: 10000 })).toThrow();

    // 🔵 而正常值不受影響(否則上面三格可以靠「一律 throw」通過)。
    expect(String(buildHctTransData({ ...baseInput, itemCount: 3 }).fields.ejamt)).toBe('3');
  });

  it('🟢 ⑤ 正對照:這把尺在【該找到東西】時真的找得到', () => {
    // 少了這一格, 把 PDF_MAX 改成 {} 之後上面每一格都會綠。
    const fake = { epino: 'X'.repeat(31) };
    const over = Object.entries(fake).filter(
      ([k, v]) => String(v).length > PDF_MAX[k as keyof typeof PDF_MAX],
    );
    expect(over.length, '正對照:餵一個超長 epino, 這把尺必須看得到').toBe(1);
    expect(PDF_MAX.epino, '正對照:PDF_MAX 被清空的話上面每一格都會恆綠').toBe(30);
  });
});
