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
import { toShipmentReference } from '@pcm/domain';
import { describe, expect, it } from 'vitest';
import { buildHctTransData, HCT_MAX } from './hct-trans-data';

// ═══ 🔴🔴 **2026-09-09 換版:出處從 V1(2022)換成 V15,而換版改到了一個值** ═══
// ✅ 現行權威 = `新竹物流出貨串接WebServices文件-V15_-20260826.pdf`(42 頁,Sean 2026-09-09 交來),
//    欄位表在**第 12–13 頁**,標題逐字「No Name Description Length Remark」。
// 🛑 **`ertel1` 從 15 改成 20 —— 而 15 是【出貨人】電話的上限,不是收貨人的。**
//    V15 第 12 頁逐字 `3 ertel1 收貨人電話1 String(20) 必要欄位。規則請參考電話規則`;
//    第 13 頁逐字 `13 ettel1 出貨人電話1 String(15)` / `14 ettel2 出貨人電話2 String(15)`。
//    ⇒ 📌 **這張表自稱「逐字抄」,而它抄錯了一欄 —— 錯的方向是【把別的欄位的值搬過來】。**
//    ⇒ 🔴 **這一格是為了擋這種事而存在的,而它沒擋住** —— 因為它抄的是同一份錯的來源。
//      **一份離線副本擋不住「副本本身抄錯」**,那要靠換版時逐欄重核(本次做了,見下表 ✅ 標記)。
// 🔵 順帶更新:V15 那張表共 **26 欄**(V1 是 20 欄,多出 `erenum` / `HAWB` / `boxNo` / `MAWB` /
//    `Declare` / `esstno` 等跨境與回單欄)。我們仍然只送 9 欄,那 17 欄都有預設值。
// ⚠️ 而 §3 那條「PDF 沒有給 JSON 範例」**已經過期** —— Sean 同日交來
//    `新竹物流串接postman.postman_collection.json`,裡面有 7 支真實請求範例(含外層形狀
//    `<json>[ {...} ]</json>`)⇒ 那一格的未知解掉了,而**本檔仍然零對外請求**。
//
// 逐字抄自 V15 第 12–13 頁那張表(欄位名 ⇒ String(n))。每一欄 2026-09-09 重核過。
const PDF_MAX = {
  epino: 30, // 訂單編號    必要欄位          ✅ 與 V1 一致
  ercsig: 40, // 收貨人名稱  必要欄位          ✅ 與 V1 一致
  ertel1: 20, // 收貨人電話1 必要欄位          🔴 V1 抄成 15(那是 ettel1 出貨人電話的值)
  eraddr: 100, // 收貨人地址  必要欄位          ✅ 與 V1 一致
  ejamt: 4, // 件數        必要欄位(最小為1) ✅ 與 V1 一致
  eqamt: 5, // 重量        必要欄位          ✅ 與 V1 一致
  eprdct: 2, // 傳票類別    預設月結 11       ✅ 與 V1 一致
  eprdcl2: 3, // 商品種類    預設 001          ✅ 與 V1 一致
  emark: 100, // 備註                          ✅ 與 V1 一致
} as const;

const baseInput = {
  shipmentReference: toShipmentReference('B7K3MN'),
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

  it('③ 【epino 以外】每個欄位的長度都不超過規格 —— 餵超長輸入也一樣(epino 見檔內註解)', () => {
    const { fields } = buildHctTransData({
      ...baseInput,
      // ⛔ ~~`displayId: 'X'.repeat(200)`~~ —— 2026-09-06 起 `epino` 有**格式閘**,
      //    200 個 X 會**在這裡之前就 throw** ⇒ 本格量不到其餘欄位的長度。
      //    🔴 **而這【不是】把期望值改鬆**:epino 的長度現在由「必須是 6 碼」保證,
      //      那比「截到 30」嚴 ⇒ 本格改餵合法箱號, 而**超長 epino 由 `hct-trans-data.test.ts`
      //      的「逐項負對照」那一格接手**(⛔ ~~由下面新增那一格~~ —— 那一格在【另一支檔】, codex R1 nit)。
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

  /**
   * 🔴🔴 **⑥ 我們的截短表要與規格表對得起來 —— 這一格擋的是【2026-09-09 那個錯本身】。**
   *
   * 病史(不要刪,它解釋這一格為什麼存在):`HCT_MAX.phone` 一度是 **15**,
   * 而 15 是 `ettel1`(**出貨人**電話 String(15))的值,不是 `ertel1`(**收貨人**電話 String(20))。
   * ⇒ 📌 **兩個欄位的中文名只差一個字,而我們拿錯了那一邊。**
   * ⇒ 後果是誤報:16–20 字的收貨人電話會被判成「超長要截短」,員工看到確認框、或送出被剪掉的號碼。
   *
   * 🛑 **上面 ①③ 那幾格為什麼沒擋住**:它們拿 `PDF_MAX` 當尺,而 `PDF_MAX` 抄的是**同一份錯的來源**
   *    ⇒ 兩邊一起錯 ⇒ **全綠**。本格改成把【我們的截短表】與【規格表】兩份**對撞**,
   *    ⇒ 任何一邊被單獨改動都會紅,而那正是漂移發生的形狀。
   * ⚠️ **它仍然擋不住「兩邊被同時改成同一個錯值」** —— 那要靠換版時開 PDF 逐欄重核。
   *    這一格買到的是「不會【安靜地】漂」,不是「不會錯」。
   */
  it('🔴 ⑥ `HCT_MAX` 的每一欄都等於規格表上對應的那一欄', () => {
    const PAIRS: ReadonlyArray<readonly [keyof typeof HCT_MAX, keyof typeof PDF_MAX]> = [
      ['orderNo', 'epino'],
      ['name', 'ercsig'],
      ['phone', 'ertel1'],
      ['address', 'eraddr'],
      ['remark', 'emark'],
    ];
    for (const [ours, theirs] of PAIRS) {
      expect(
        HCT_MAX[ours],
        `HCT_MAX.${ours} 與 V15 第 12–13 頁的 ${theirs} 對不上 ⇒ 截短表與規格漂了`,
      ).toBe(PDF_MAX[theirs]);
    }
    // 🎯 **釘住那個值本身與它的出處** —— 上面那個迴圈在「兩邊一起被改」時仍會綠,
    //    而這一行不會:它寫死 20,而 20 的出處是 V15 第 12 頁 `ertel1 收貨人電話1 String(20)`。
    expect(HCT_MAX.phone, 'V15 第 12 頁:ertel1 收貨人電話1 String(20)。15 是出貨人電話,不是這一欄').toBe(20);
  });
});
