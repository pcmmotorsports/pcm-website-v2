import { describe, expect, it } from 'vitest';
import {
  HCT_DEFAULT_WEIGHT,
  HCT_INVOICE_TYPE,
  HCT_MAX,
  HCT_PRODUCT_KIND,
  buildHctTransData,
} from './hct-trans-data';

// hct-trans-data.test.ts — ⟦ship-HCTAPI⟧ 片 A 的守門。
//
// 🔴🔴 **這一片的正確性【完全靠這支檔】** —— 它零網路零 env 零 DB,
//    所以沒有任何「真的跑一次」可以幫它。⇒ 📌 **這裡漏掉的,線上沒有第二道會接。**
//
// 🔴 **而斷言【寫字面值, 不寫 import 來的常數】** —— 那是 2026-09-04 adversarial-reviewer
//    在同一條線上打出來的:畫面測試全部 `import` 常數去比 ⇒ **把常數的值改掉每一格照樣全綠**
//    ⇒ 🎯 測試問的是「產出的與常數一樣嗎」, 而**沒有人問「常數是他拍的那個值嗎」**。
//    ⇒ ✅ 所以下面 Sean 拍的那三個值**逐字寫死**, 而常數那一側另有一格釘它。

const RECIPIENT = { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' };
const BASE = { displayId: 'PCM-2026-0001', recipient: RECIPIENT, itemCount: 1 };

describe('⟦ship-HCTAPI⟧ 片 A · Sean 拍的三個值(字面寫死, 不從常數 import)', () => {
  /**
   * 🔴🔴 **重量那一格要釘【兩件事】, 而第二件才是重點。**
   * 他 2026-09-04 拍 `2`, 而他同天附的樣張五張標籤逐張印 **`重 5`**。
   * ⇒ 🛑 **下一個看到樣張的人會把 2「修正」成 5, 而他每一步都做對了。**
   * ⇒ ✅ 所以這一格同時斷言「是 2」與「**不是 5**」—— 後者讓那個修正**當場紅**,
   *    而紅的訊息會告訴他樣張上那個 5 是什麼。
   */
  it('🔴 重量 = 2 —— 而它【不是】樣張上那個 5', () => {
    const { fields } = buildHctTransData(BASE);
    expect(fields.eqamt, 'Sean 2026-09-04 逐字「你填入2吧」').toBe('2');
    expect(
      fields.eqamt,
      '樣張 PDF 五張標籤逐張印「重 5」—— 那是他【過去的實務】, 不是拍板值。改成 5 = 推翻一個拍板。',
    ).not.toBe('5');
  });

  it('🔴 傳票類別 = 11(元付)· 商品種類 = 001(一般)', () => {
    const { fields } = buildHctTransData(BASE);
    expect(fields.eprdct, 'Sean 逐字「商品種類 11元付、一般小物」的前半').toBe('11');
    expect(fields.eprdcl2, '同一句的後半:類型「一般」= 規格第 10 頁的 001').toBe('001');
  });

  /**
   * 🔵 **常數那一側也釘一格** —— 上面三格吃的是**產出**,
   * 而若有人改了常數**又同時**改了測試, 兩邊會一起走。這一格讓常數自己也有一個字面錨。
   */
  it('🔵 常數本身也是那三個字面(產出與常數各釘一半)', () => {
    expect(HCT_DEFAULT_WEIGHT).toBe('2');
    expect(HCT_INVOICE_TYPE).toBe('11');
    expect(HCT_PRODUCT_KIND).toBe('001');
  });
});

describe('⟦ship-HCTAPI⟧ 片 A · 截斷 —— 而截斷這件事要被看見', () => {
  /**
   * 🔴 **規格長度是量到的**(PDF 第 10 頁):`ercsig` 40 / `ertel1` 15 / `eraddr` 100 / `epino` 30。
   * 而我們這邊 `AddressInput` 那三欄**一個 `.max()` 都沒有** ⇒ 這一族是真的會發生。
   */
  it('🔴 超長的三欄各自被截到規格長度, 而【每一欄都出現在 truncated 裡】', () => {
    const { fields, truncated } = buildHctTransData({
      ...BASE,
      recipient: { name: '名'.repeat(60), phone: '0'.repeat(30), line: '路'.repeat(200) },
    });
    expect(fields.ercsig.length).toBe(40);
    expect(fields.ertel1.length).toBe(15);
    expect(fields.eraddr.length).toBe(100);
    // 🔴 承重:少了這一行, 一個「安靜截斷」的實作照樣通過上面三格。
    // ⚠️ 兩邊都要排序 —— 我第一版只排了實際值, 期望值照著【欄位在型別裡的順序】寫
    //    ⇒ 紅在一個與行為無關的地方。📌 一個沒有排序的集合比較, 綠不綠取決於實作的迭代順序。
    expect([...truncated].sort()).toEqual(['ercsig', 'eraddr', 'ertel1'].sort());
  });

  /**
   * 🔵 **負對照** —— 沒有這一格, 一個「永遠回滿一份 truncated 清單」的實作也會全綠。
   * 而它同時釘住:**沒超長時不得動那個值**(`clip` 回原字串, 不 trim、不正規化)。
   */
  it('🔵 負對照:沒超長 ⇒ truncated 是空的, 而每一欄逐字等於原值', () => {
    const { fields, truncated } = buildHctTransData(BASE);
    expect(truncated).toEqual([]);
    expect(fields.ercsig).toBe('王小明');
    expect(fields.ertel1).toBe('0912345678');
    expect(fields.eraddr).toBe('新北市新莊區化成路 736 巷 18 號');
    expect(fields.epino).toBe('PCM-2026-0001');
  });

  it('🔵 剛好等於上限 ⇒ 不算截斷(邊界是 <=, 不是 <)', () => {
    const { truncated } = buildHctTransData({
      ...BASE,
      recipient: { ...RECIPIENT, name: '名'.repeat(HCT_MAX.name) },
    });
    expect(truncated, '剛好 40 字被判成截斷 ⇒ 員工會看到一個不存在的警告').toEqual([]);
  });
});

describe('⟦ship-HCTAPI⟧ 片 A · 件數 —— 錯的輸入不得被夾成合法值', () => {
  /**
   * 🔴 規格逐字「必要欄位(**最小為 1**)」。
   * 🛑 **而我刻意不夾** —— `itemCount = 0` 不是「這箱沒東西」, 是**呼叫端算錯了**。
   *    夾到 1 會讓一個錯的輸入變成一個**合法的請求**, 而那正是最難查的那種:
   *    🎯 **新竹會收下它, 而錯誤在司機拿到箱子的那一刻才顯形。**
   */
  it.each([0, -1, 1.5, Number.NaN])('🔴 件數 %s ⇒ 丟例外, 不夾到 1', (n) => {
    expect(() => buildHctTransData({ ...BASE, itemCount: n })).toThrow(/件數必須是/);
  });

  it('🔵 正對照:件數 3 ⇒ 逐字 "3"(證明上面那幾格不是因為它永遠丟例外)', () => {
    expect(buildHctTransData({ ...BASE, itemCount: 3 }).fields.ejamt).toBe('3');
  });
});

describe('⟦ship-HCTAPI⟧ 片 A · 本檔【不做】的事', () => {
  /**
   * 🔴🔴 **這一格守的是【爆炸半徑】, 不是行為。**
   * 片 A 的整個存在理由是「零網路零 env 零 DB」⇒ 而那是一個**會被人順手破壞**的性質:
   * 下一個人要接線時, 最自然的動作就是在這裡加一支 `fetch`。
   * ⇒ 📌 那一刻這一片就不再是「用單元測試驗得完」的東西了, **而沒有東西會叫。**
   *
   * 🛑 **先去註解再掃** —— 本檔的註解裡大量提到 `fetch` / `env` / 送出,
   *    而**掃原始檔會恆紅, 恆紅的閘會被關掉**(2026-09-04 同一條線上學到的)。
   */
  it('🔴 本檔不得出現網路 / env / DB 呼叫(去註解之後掃)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./hct-trans-data.ts', import.meta.url)), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const bad of ['fetch(', 'process.env', 'axios', 'supabase', 'createClient']) {
      expect(code, `片 A 出現 ${bad} ⇒ 它不再是「零網路零 env 零 DB」, 而那是它整片的前提`).not.toContain(bad);
    }
    // 🟢 正對照:去註解之後碼還在(否則上面每一格都是恆綠的)。
    expect(code, 'stripComments 把整支檔吃光了 ⇒ 上面那幾個 not.toContain 什麼都證不到').toContain(
      'export function buildHctTransData',
    );
  });
});
