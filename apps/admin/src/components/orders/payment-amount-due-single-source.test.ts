import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../lib/test-support/strip-comments';

// payment-amount-due-single-source.test.ts —— M-4b「三處『已收/尾款』的來源必須同一個」守門。
//
// 🔴🔴 **為什麼需要它**:`toPaymentSummary()` 今天有 **3 個呼叫端**,三處都渲染在**同一頁**
//    (訂單詳情:頭條 / 付款卡 / 出貨區)。三處**共用那支函式,但【不共用它的第一個引數】** ——
//    兩處就地讀 `detail.total.amount`,一處靠呼叫端一路傳進去。
//    ⇒ 誰把其中一處改成別的口徑(例如「應收 − 已退款」),**另外兩處不會跟**,
//      而畫面上會同時出現**兩個不同的尾款**:沒有錯誤、沒有紅字、沒有 log。
//    ⇒ 而出貨區那一格**就在「出貨」鈕旁邊** ⇒ 它直接決定員工按不按下去。
//
// 📌 **這個病 2026-08-16 已經被 code-reviewer 更正過一次**(逐字在
//    `order-detail-summary-cards.tsx` 搜 `不是它的第一個引數`)—— 而更正之後**又多了第 3 面**
//    (片9 的出貨區)⇒ **更正本身沒有機制在擋新增的面。這支就是那個機制。**
//
// ⚠️⚠️ **誠實邊界 —— 本檔是【文字層】斷言,不是渲染測試。**
//    它證的是「三處寫的是同一個運算式」,**證不到「畫面上那三個數字相等」**。
//    要後者得渲染整個 `OrderDetail`,而本 repo 今天沒有那支 harness(`order-detail.test.tsx` 不存在)。
//    ⇒ **不要把本檔讀成「三個數字已驗證一致」。**

const ROOT = 'apps/admin/src';
const strip = stripComments;

function sourceFiles(): string[] {
  return readdirSync(ROOT, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => `${ROOT}/${f}`);
}

/** `toPaymentSummary(<第1引數>, …)` 的呼叫端。**排除函式宣告本身**(`function toPaymentSummary(`)。 */
function callSites(): { file: string; firstArg: string }[] {
  const out: { file: string; firstArg: string }[] = [];
  for (const file of sourceFiles()) {
    const src = strip(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/(function\s+)?toPaymentSummary\(\s*([^,]+?)\s*,/g)) {
      if (m[1] !== undefined) continue; // 宣告,不是呼叫
      out.push({ file, firstArg: (m[2] ?? '').replace(/\s+/g, ' ') });
    }
  }
  return out;
}

/** `toPaymentSummary(<第1引數>, <第2引數>)` —— 第 2 引數是 fail-closed 那一軸。 */
function callSitesWithSecondArg(): { file: string; secondArg: string }[] {
  const out: { file: string; secondArg: string }[] = [];
  for (const file of sourceFiles()) {
    const src = strip(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/(function\s+)?toPaymentSummary\(([\s\S]*?)\)\s*;/g)) {
      if (m[1] !== undefined) continue;
      const args = (m[2] ?? '').replace(/\s+/g, ' ').trim().replace(/,$/, '');
      const comma = args.indexOf(',');
      out.push({ file, secondArg: comma < 0 ? '' : args.slice(comma + 1).trim() });
    }
  }
  return out;
}

/** JSX 上 `amountDue={…}` 的每一次傳遞(含中繼轉傳)。 */
function amountDueProps(): { file: string; value: string }[] {
  const out: { file: string; value: string }[] = [];
  for (const file of sourceFiles()) {
    const src = strip(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/amountDue=\{([^}]*)\}/g)) {
      out.push({ file, value: (m[1] ?? '').replace(/\s+/g, ' ') });
    }
  }
  return out;
}

describe('「尾款/已收」的第一個引數只有一個來源', () => {
  it('正向對照:掃描器真的掃到東西(否則下面每一格都會恆綠)', () => {
    // 🔴 沒有這一格,任何讓 `sourceFiles()` 回空陣列的改動(改路徑、改副檔名判斷)
    //    都會讓下面三格「全部通過」——而它們一個字都沒檢查。
    expect(sourceFiles().length).toBeGreaterThan(100);
    expect(callSites().length).toBeGreaterThan(0);
    expect(amountDueProps().length).toBeGreaterThan(0);
  });

  it('🔴 `toPaymentSummary` 恰有 3 個呼叫端 —— 多一個就要有人看過這條不變式', () => {
    const sites = callSites();
    expect(
      sites.map((s) => s.file).sort(),
      '呼叫端數量變了。新增一處請確認它的第一個引數與另外三處同源,然後把數字改成新的值。',
    ).toEqual([
      `${ROOT}/components/orders/order-detail-summary-cards.tsx`,
      `${ROOT}/components/orders/payment-list.tsx`,
      `${ROOT}/components/orders/shipment-section.tsx`,
    ]);
  });

  it('🔴🔴 三個呼叫端的第一個引數只能是這兩種寫法之一', () => {
    // `detail.total.amount` = 就地讀;`amountDue` = 由呼叫端一路傳進來(下一格驗它的來源)。
    const bad = callSites().filter((s) => !['detail.total.amount', 'amountDue'].includes(s.firstArg));
    expect(
      bad,
      '有呼叫端改用了別的運算式 ⇒ 同一頁上會出現兩個不同口徑的「尾款」,而畫面上不會有東西紅。',
    ).toEqual([]);
  });

  it('🔴🔴 `amountDue` 這條 prop 鏈的**源頭**必須是 `detail.total.amount`', () => {
    // 鏈路(2026-08-19 實查,兩跳):
    //   order-detail.tsx  <PaymentSection amountDue={detail.total.amount}>
    //   → payment-section.tsx  <PaymentList amountDue={amountDue}>   ← 純轉傳
    //   → payment-list.tsx  toPaymentSummary(amountDue, …)
    const props = amountDueProps();
    const sources = props.filter((p) => p.value !== 'amountDue');
    expect(
      sources.map((p) => `${p.file} ⇒ ${p.value}`),
      'amountDue 的源頭變了(或多了第二個源頭)⇒ 付款卡會與頭條、出貨區脫鉤。',
    ).toEqual([`${ROOT}/components/orders/order-detail.tsx ⇒ detail.total.amount`]);
  });
});

describe('第 2 引數:讀不到明細時必須 fail-closed(傳 null,不是傳一個空陣列)', () => {
  // 🔴🔴 **這是與上面【不同的一條軸】,兩條都會壞而症狀不同:**
  //    · 上面那軸壞掉 ⇒ 同一頁出現**兩個不同的**尾款。
  //    · 這一軸壞掉 ⇒ 三處**一致地**印出一個**假的 0**(「已收 0 / 尾款 = 全額」),
  //      而那讀起來完全正常 —— 沒有東西會不一致,所以上面那些格**一格都不會紅**。
  //    理由逐字在 `payment-list.tsx` 搜 `必然是假的`:「讀不到明細時算出來的『已收』必然是假的」。
  //
  // ⚠️ **射程(不要讀寬)**:本組是**字面守門**。它擋得住「拿掉那個守衛」與「新呼叫點漏寫守衛」,
  //    **擋不住** `toPaymentSummary` 內部把 `null` 當成 0 來算(那是那支函式自己的測試的事)。

  it('三處的第 2 引數都必須是 `<資料>.status === \'ok\' ? <資料>.rows : null`', () => {
    const sites = callSitesWithSecondArg();
    expect(sites.length, '沒掃到呼叫端 ⇒ 下面的斷言會恆綠').toBe(3);
    const shape = /^([A-Za-z_$][\w$]*)\.status === 'ok' \? \1\.rows : null$/;
    const bad = sites.filter((s) => !shape.test(s.secondArg));
    expect(
      bad.map((b) => `${b.file} ⇒ ${b.secondArg}`),
      '有呼叫端不再 fail-closed ⇒ 讀不到明細時會算出一個【假的已收】,而三處會一致地印錯。',
    ).toEqual([]);
  });

  it('負向對照:這把尺真的會對「傳空陣列」翻紅(否則上面那格證明不了什麼)', () => {
    // 🔴 沒有這一格,上面那條 regex 可能寬到什麼都通過,而它會安靜地全綠。
    const shape = /^([A-Za-z_$][\w$]*)\.status === 'ok' \? \1\.rows : null$/;
    expect(shape.test("payments.status === 'ok' ? payments.rows : null")).toBe(true);
    expect(shape.test("payments.status === 'ok' ? payments.rows : []"), '傳空陣列竟然通過').toBe(false);
    expect(shape.test('payments.rows'), '無條件傳 rows 竟然通過').toBe(false);
    // 🔴 兩邊的識別字必須是同一個 —— `a.status === 'ok' ? b.rows : null` 是真的會發生的手滑。
    expect(shape.test("a.status === 'ok' ? b.rows : null"), '兩個不同的識別字竟然通過').toBe(false);
  });
});
