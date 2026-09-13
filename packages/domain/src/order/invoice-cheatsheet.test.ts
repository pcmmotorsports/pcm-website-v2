import { describe, expect, it } from 'vitest';
import { invoiceCheatSheet } from './invoice-cheatsheet';

// 發票小抄三個數的守門。
//
// 🔴🔴 **這三個數會被員工抄到【紙本發票】上, 而紙收不回來。**
//    所以本檔的每一格都是「印錯會怎樣」, 不是「函式回什麼」。
//
// 🔬 **算式的依據都是量出來的, 不是推的**:
//    · `inclusive` 殘差 = 貼板 121(`20260910090000` 檔頭實量 1100 ⇒ 1048 / 52)
//    · `exclusive` 的 total = `v_subtotal + p_shipping_fee + v_tax`(`20260910090000:722` 逐字)

const base = { invoiceRequested: true, taxTotal: 0, total: 0 } as const;

describe('invoiceCheatSheet — inclusive(顧客站單 + 所有舊單)', () => {
  it('🔴 總計【必須】等於 orders.total 原值 —— 那是客人真的付的錢', () => {
    // ⛔ 規格 v2 原本在這裡寫錯過一次:在一個**已經含稅**的數上再課 5%
    //    ⇒ 客人付 1,050 的單會印出總計 1,103, 而他照著抄上紙本發票。
    const r = invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', total: 1050 });
    expect(r?.total, '總計比 orders.total 大 = 發票開得比客人付的多').toBe(1050);
  });

  it('🔴 殘差, 與貼板 121 同一支算式(檔頭實量的那一組:1100 ⇒ 1048 / 52)', () => {
    const r = invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', total: 1100 });
    expect(r).toEqual({ untaxed: 1048, tax: 52, total: 1100 });
  });

  // 🔴🔴 **這一格是被 codex 2026-09-13 must-fix 2 重寫過的 —— 舊版是一個【恆綠的守門】。**
  //    ⛔ 舊版只舉了 1000 這個例子, 而 1000 在殘差與正推下**剛好同值** ⇒ 守不到任何東西。
  //    🔬 codex 實際重放的突變(它是**寫實的**那一種正推, 不是我自己試的粗糙版):
  //         tax = Math.round(Math.round(total / 1.05) * 0.05)
  //       ⇒ **原本 29 個案例全部通過。**
  //    🔴 **而下面那組加總恆等式救不了它** —— 未稅是由 `total − tax` 反推的,
  //       所以**不管稅算錯多少, 三個數永遠加得起來**。
  //       📌 **一個結構上恆真的斷言, 長得跟一個很嚴謹的斷言一模一樣。**
  //    ⇒ ✅ 改法:對**兩種算法真的分岔**的金額, 直接斷言三個數的完整值。
  it.each([
    // [含稅總計, 正確的未稅, 正確的稅,   (正推會印成什麼)]
    [10, 10, 0, '9 / 1'],
    [31, 30, 1, '29 / 2'],
  ])(
    '🔴 含稅 %i ⇒ %i / %i —— 正推會印成 %s(兩種算法在這裡分岔)',
    (total, untaxed, tax) => {
      const r = invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', total });
      expect(r, '殘差被換成正推 ⇒ 稅多一元, 而那一元會被抄到紙上').toEqual({
        untaxed,
        tax,
        total,
      });
    },
  );

  it.each([1, 2, 5, 9, 10, 21, 100, 105, 999, 1000, 1050, 1100, 12345, 99999])(
    '🔵 恆等式:未稅 + 稅 === 總計(含稅 %i)—— ⚠️ 它【結構上恆真】, 見上面那組',
    (total) => {
      // 🛑 **這一組守不到算式對不對** —— 未稅由 `total − tax` 反推 ⇒ 稅算錯多少它都平衡。
      //    留著的理由只有一個:哪天有人把 `untaxed` 改成別的來源(例如印 `subtotal` 原值),
      //    這裡會當場紅。**判別力在上面那組分岔金額, 不在這裡。**
      const r = invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', total });
      expect(r).not.toBeNull();
      expect(r!.untaxed + r!.tax, '兩個數加起來不等於總計 ⇒ 那張發票是錯的').toBe(total);
      expect(r!.total).toBe(total);
      expect(r!.tax).toBeGreaterThanOrEqual(0);
    },
  );

  it('🔵 總計 0(全額折抵之類)⇒ 三個數都是 0, 不炸', () => {
    expect(invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', total: 0 })).toEqual({
      untaxed: 0,
      tax: 0,
      total: 0,
    });
  });
});

describe('invoiceCheatSheet — exclusive(2026-09-05 起的後台手動單)', () => {
  it('🔴 稅直接讀 orders.tax_total, **不重算**(重算 = 第二份實作、第二個真相)', () => {
    // 正式庫那張真單:subtotal 1000 / tax_total 50 / total 1050
    const r = invoiceCheatSheet({ priceTaxMode: 'exclusive', invoiceRequested: true, taxTotal: 50, total: 1050 });
    expect(r).toEqual({ untaxed: 1000, tax: 50, total: 1050 });
  });

  it('🔴🔴 **有運費的單:未稅要含運費, 否則那張紙加不起來**(規格 §6-13 逐字做會錯在這裡)', () => {
    // 🔬 RPC 逐字(`20260910090000:681` / `:722`):
    //      稅基 = 小計 + 運費 − 折扣 · v_total := v_subtotal + p_shipping_fee + v_tax
    //    小計 1000 · 運費 200 · 稅 round(1200 × 5%) = 60 · 總計 1260
    //    ⛔ 照規格印 subtotal 原值 ⇒ 未稅 1000 / 稅 60 ⇒ 1000 + 60 = 1060 ≠ 1260
    //    ✅ 本檔 total − tax ⇒ 未稅 1200 / 稅 60 ⇒ 1200 + 60 = 1260
    const r = invoiceCheatSheet({ priceTaxMode: 'exclusive', invoiceRequested: true, taxTotal: 60, total: 1260 });
    expect(r!.untaxed, '未稅漏掉運費 ⇒ 三聯式發票上兩個數加不到總計').toBe(1200);
    expect(r!.untaxed + r!.tax).toBe(1260);
  });

  it('🔵 `exclusive` 而稅 0 是**真實存在**的單 ⇒ 照樣直接讀, 不可以被當成 inclusive 去除 1.05', () => {
    // 🔬 兩種真實來源(`order-detail-items-support.tsx:155-160` 逐字):
    //      後台手動單稅基 < 10 元 ⇒ 5% 捨入成 0 · 前台經銷客人付轉帳 ⇒ v_tax := 0
    //    ⛔ 若誤判成 inclusive:5 ⇒ round(5/1.05)=5, tax=0 —— 這個金額剛好同值,
    //      所以用一個**會分岔**的金額當證人:
    const r = invoiceCheatSheet({ priceTaxMode: 'exclusive', invoiceRequested: true, taxTotal: 0, total: 1100 });
    // 誤判成 inclusive 的話這裡會是 { untaxed: 1048, tax: 52 }
    expect(r, '被當成含稅去拆 ⇒ 憑空生出 52 元的稅, 而這張單根本沒有稅').toEqual({
      untaxed: 1100,
      tax: 0,
      total: 1100,
    });
  });
});

describe('invoiceCheatSheet — fail-closed(算不出來就不印)', () => {
  it('🔴🔴 priceTaxMode = null ⇒ null,**不得**當成 inclusive', () => {
    const r = invoiceCheatSheet({ ...base, priceTaxMode: null, total: 1100 });
    // 🔴 兩個方向都釘:當成 inclusive 會是 1048/52、當成 exclusive 會是 1100/0。
    //    只寫 `toBeNull()` 已經擋住兩者, 而這一行是為了讓紅的時候看得出是哪一種誤判。
    expect(r, '讀不到稅口徑卻照印 ⇒ 有一半機率印出比訂單少的數').toBeNull();
  });

  it('🔴 invoiceRequested = false ⇒ null(這張單沒有「發票上要寫的數」這回事)', () => {
    expect(invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', invoiceRequested: false, total: 1050 })).toBeNull();
  });

  it.each([
    ['負數', -1],
    ['小數(元位以下)', 10.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('🔵 total 是 %s ⇒ null(壞資料寧可不印)', (_label, total) => {
    expect(invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', total })).toBeNull();
  });

  // 🔴🔴 **codex 2026-09-13 must-fix 1:`inclusive` 而稅不是 0 = 兩個來源互相矛盾。**
  //    `inclusive` 的定義就是「稅沒有另計」⇒ 系統存的稅必然是 0,
  //    ⚠️ **而表級 CHECK 沒有強制這件事** ⇒ 這種列在 DB 裡是合法的。
  //    ⛔ 舊版直接忽略 `taxTotal` 去算殘差 ⇒ `total 1050 / taxTotal 49` 印出 `1000 / 50 / 1050`,
  //       **把系統存的 49 丟掉, 而畫面完全正常。**
  //    📌 **兩個來源互相矛盾的時候, 挑一個來信就是替資料做決定** —— 那不是這支函式的位置。
  it.each([1, 49, 50, -1])(
    '🔴 inclusive 而 tax_total = %i(不是 0)⇒ null, 不得自己挑一個來信',
    (taxTotal) => {
      expect(
        invoiceCheatSheet({ priceTaxMode: 'inclusive', invoiceRequested: true, taxTotal, total: 1050 }),
        '忽略矛盾的 tax_total 去算殘差 ⇒ 印出一個沒有任何來源支持的數',
      ).toBeNull();
    },
  );

  // 🔵 codex nit 1:金額欄在 DB 是 `integer` ⇒ 超過上限之後 JS 除法開始掉精度,
  //    **而加總檢查照樣成立** ⇒ 紙上多一元而沒有東西會叫。現行資料走不到, 這道閘讓它是紅的。
  it.each([
    ['剛好上限 ⇒ 照常算', 2147483647, false],
    ['上限 +1 ⇒ null', 2147483648, true],
    ['codex 舉的那個安全整數 ⇒ null', 9007199254740795, true],
  ])('🔵 %s', (_label, total, expectNull) => {
    const r = invoiceCheatSheet({ ...base, priceTaxMode: 'inclusive', total });
    if (expectNull) expect(r).toBeNull();
    else expect(r).not.toBeNull();
  });

  it('🔴 exclusive 而 tax_total 比 total 還大(資料壞掉)⇒ null, 不得印出負的未稅', () => {
    const r = invoiceCheatSheet({ priceTaxMode: 'exclusive', invoiceRequested: true, taxTotal: 9999, total: 1050 });
    expect(r, '不擋的話未稅會是 -8949, 而那會被抄到紙上').toBeNull();
  });

  it('🔵 exclusive 而 tax_total 是負的 ⇒ null', () => {
    expect(
      invoiceCheatSheet({ priceTaxMode: 'exclusive', invoiceRequested: true, taxTotal: -1, total: 1050 }),
    ).toBeNull();
  });
});
