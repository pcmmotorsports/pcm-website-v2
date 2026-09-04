import { describe, expect, it } from 'vitest';
import {
  MANIFEST_INVOICE_TYPE,
  MANIFEST_WEIGHT_KG,
  buildHctManifest,
  type ManifestInput,
} from './hct-manifest';
import { HCT_DEFAULT_WEIGHT, HCT_INVOICE_TYPE } from './hct-trans-data';

// hct-manifest.test.ts — ⟦ship-HCTAPI⟧ 片 E(排版那半)的守門。
//
// 🛑 **本檔零網路零 env 零 DB, 而且【零時間判斷】** —— 那是刻意的:
//    「18 時前確認出貨」是**營運題**(誰在什麼時候按、沒趕上會怎樣), 主視窗端 Sean。
//    ⇒ 而下面**最後一格**就是守那個空位:本檔不得出現任何時限字面。

const one = (over: Partial<ManifestInput> = {}): ManifestInput => ({
  shipmentRef: 'P4Q5R6',
  edelno: '1234567890',
  arrivalStation: '台北',
  consigneeName: '王小明',
  phone1: '0912345678',
  address: '新北市新莊區化成路 736 巷 18 號',
  pieces: 1,
  ...over,
});

describe('⟦ship-HCTAPI⟧ 片 E · 合計 —— 而它是【對帳用】的', () => {
  /**
   * 🔴🔴 **總件數是【加起來】的, 不是列數。**
   * 樣張(第 9 頁)上「總筆數」與「總件數」是**兩行** —— 而一張單可以有多件。
   * 🎯 司機拿這張紙**當場點貨**:數字對不上他就不會簽
   * ⇒ 📌 算錯的後果不是「表格難看」, 是【交接停在現場】, 而那時貨已經在他車旁邊了。
   */
  it('🔴 三張單共 6 件 ⇒ 總筆數 3 / 總件數 6(不是 3)', () => {
    const m = buildHctManifest([
      one({ shipmentRef: 'A', pieces: 1 }),
      one({ shipmentRef: 'B', pieces: 2 }),
      one({ shipmentRef: 'C', pieces: 3 }),
    ]);
    expect(m.totals.totalOrders).toBe(3);
    // 🔴 承重:一個把 totalPieces 寫成 rows.length 的實作, 只有這一行殺得死它。
    expect(m.totals.totalPieces, '總件數寫成列數 ⇒ 司機點到 6 件而紙上寫 3').toBe(6);
  });

  it('🔵 一式二份 —— 規格第 9 頁逐字, 而它是資料不是「記得按兩次列印」', () => {
    expect(buildHctManifest([one()]).copies).toBe(2);
  });
});

describe('⟦ship-HCTAPI⟧ 片 E · 進不了總表的單 —— 要【列出來】不是丟掉', () => {
  /**
   * 🔴 總表是**交接憑證** —— 一張沒有貨號的單, 司機收不了。
   * 🛑 而**安靜地少一列**與**明白地列出來**, 對員工是完全不同的兩件事:
   *    前者他**點不出來**(他不知道本來該有幾張), 後者他知道**哪一張還沒好**。
   * ⇒ 📌 與片 D 那條同一句:**壞掉的那一格要說話, 不得靜靜空白。**
   */
  it.each([
    ['貨號是 null', { edelno: null }],
    ['貨號是空字串', { edelno: '' }],
    ['貨號只有空白', { edelno: '   ' }],
  ])('🔴 %s ⇒ 不進 rows, 而【出現在 excluded 裡並說得出理由】', (_n, over) => {
    const m = buildHctManifest([one({ shipmentRef: 'NOEDEL', ...over })]);
    expect(m.rows).toHaveLength(0);
    // 🔴 承重:少了這兩行, 一個「安靜丟掉」的實作照樣通過上一行。
    expect(m.excluded).toHaveLength(1);
    expect(m.excluded[0]).toMatchObject({ shipmentRef: 'NOEDEL' });
    expect(m.excluded[0]!.reason.length).toBeGreaterThan(0);
  });

  it.each([0, -1, 1.5, Number.NaN])('🔴 件數 %s ⇒ 排除, 而不是靜靜當 0 湊進合計', (n) => {
    const m = buildHctManifest([one({ shipmentRef: 'BADQTY', pieces: n })]);
    expect(m.rows).toHaveLength(0);
    // 🔴 而這一行才是重點:合計不得被一個壞掉的數污染。
    expect(m.totals, '把壞掉的件數當 0 塞進合計 ⇒ 司機簽下一個錯的數').toEqual({
      totalOrders: 0,
      totalPieces: 0,
    });
    expect(m.excluded[0]).toMatchObject({ shipmentRef: 'BADQTY' });
  });

  it('🔵 好壞混在一起 ⇒ 好的照樣進, 而合計只算好的', () => {
    const m = buildHctManifest([
      one({ shipmentRef: 'OK1', pieces: 2 }),
      one({ shipmentRef: 'NOEDEL', edelno: null }),
      one({ shipmentRef: 'OK2', pieces: 3 }),
    ]);
    expect(m.rows.map((r) => r.consigneeName)).toHaveLength(2);
    expect(m.totals).toEqual({ totalOrders: 2, totalPieces: 5 });
    expect(m.excluded).toHaveLength(1);
  });

  it('🔵 負對照:全部都好 ⇒ excluded 是空的(證明上面那些不是因為它排除每一張)', () => {
    expect(buildHctManifest([one(), one({ shipmentRef: 'B' })]).excluded).toEqual([]);
  });
});

describe('⟦ship-HCTAPI⟧ 片 E · 我們【沒有】的欄位, 留空不編', () => {
  it('🔴 收貨人代號留空 —— 我們真的沒有這一欄, 而填一個編的值比留空糟', () => {
    expect(buildHctManifest([one()]).rows[0]!.consigneeCode).toBe('');
  });

  it('🔵 代收貨款 / 報值金額都是 0(線上先付、不報值)—— 那是【現況】不是拍板', () => {
    const r = buildHctManifest([one()]).rows[0]!;
    expect(r.codAmount).toBe(0);
    expect(r.declaredValue).toBe(0);
  });
});

describe('⟦ship-HCTAPI⟧ 片 E · 重量與傳票區分 —— 字面寫死, 而兩張紙【不共用常數】', () => {
  it('🔴 重量 = 2(Sean 拍的), 而【不是】樣張上那個 5', () => {
    const r = buildHctManifest([one()]).rows[0]!;
    expect(r.weightKg, 'Sean 2026-09-04 逐字「你填入2吧」').toBe(2);
    expect(r.weightKg, '樣張五張標籤逐張印「重 5」—— 那是他過去的實務, 不是拍板值').not.toBe(5);
  });

  it('🔴 傳票區分 = 11(元付)', () => {
    expect(buildHctManifest([one()]).rows[0]!.invoiceType).toBe('11');
  });

  /**
   * 🔵 **總表與託運單是【兩張紙】, 所以刻意不共用常數。**
   * 哪天其中一張要改, 共用一個常數會讓另一張**安靜地跟著改**。
   * ⇒ 🔴 **而「今天它們相同」這件事本身要被釘住** —— 這一格就是那個釘子:
   *    它們不一致的那一天**會紅**, 而不是安靜地分家。
   */
  it('🔵 今天兩張紙的值相同 —— 而它們不一致時這一格會紅', () => {
    expect(String(MANIFEST_WEIGHT_KG)).toBe(HCT_DEFAULT_WEIGHT);
    expect(MANIFEST_INVOICE_TYPE).toBe(HCT_INVOICE_TYPE);
  });
});

describe('⟦ship-HCTAPI⟧ 片 E · 本檔【不得】碰時限', () => {
  /**
   * 🔴🔴 **這一格守的是一個【空位】, 不是一個行為。**
   *
   * 規格第 8 頁 `TransReport` 的說明欄逐字有「當日確認出貨時(**18時前**上傳)」,
   * 而**誰在什麼時候按、沒趕上會怎樣**是他公司怎麼運作 ⇒ **我們沒有來源答得出來。**
   * 🛑 而主視窗明文交代:**連 TODO 都不要寫成「預設 18:00」** ——
   *    📌 **一個寫了預設值的 TODO, 下一個人會把它當成已經拍過的。**
   * ⇒ ✅ 所以這一格掃本檔:出現任何時限字面 ⇒ 紅。
   */
  it('🔴 本檔不得出現 18 時 / cutoff / deadline 之類的時限字面(去註解之後掃)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./hct-manifest.ts', import.meta.url)), 'utf8');
    // 🛑 先去註解 —— 本檔的註解【必須】提到 18 時(那段話正是在解釋為什麼碼裡沒有它)
    //    ⇒ 掃原始檔會恆紅, 而恆紅的閘會被關掉。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const bad of ['18:00', 'cutoff', 'CUTOFF', 'deadline', 'DEADLINE', 'getHours']) {
      expect(code, `本檔出現 ${bad} ⇒ 時限那半是營運題, 而它還沒有人答`).not.toContain(bad);
    }
    // 🟢 正對照:去註解之後碼還在(否則上面每一格都是恆綠的)。
    expect(code).toContain('export function buildHctManifest');
  });
});
