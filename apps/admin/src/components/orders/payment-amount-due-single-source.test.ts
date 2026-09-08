import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../lib/test-support/strip-comments';

// payment-amount-due-single-source.test.ts —— M-4b「每一處『已收/尾款』的來源必須同一個」守門。
//
// 🔴 **2026-09-04 檔頭訂正(codex nit9;同日第二次)**:全檔原本多處寫死「**三處**／3 個呼叫端」,
//    而 09-04 起是 **4**。⛔ ~~第四處在 `shipment-section.tsx`~~ ⇒ ✅ **同日下午它搬到
//    `lib/shipping/shipment-balance-warning.ts`**(兩個出貨入口都要用它)。
//    ⚠️ **舊字面留著**:codex 第二輪指出這段檔頭「同時寫 4 又寫 3、時態互相否定」——
//    那正是這支檔在防的病長在它自己身上。
//    ⇒ 📌 **這支檔存在的理由就是「數字與現況脫鉤會沒有人發現」, 而它自己的說明字面正在脫鉤。**
//    ✅ 處置:**會紅的那一行留數字**(它會叫), **說明字面改成不帶數字**。
//    ⚠️ 下面那些「三處」字面**沒有全部改掉** —— 它們描述的是當時的病史與推理, 改成 4 會讓那段話變成
//       另一個時點的假紀錄。**要引用數量, 看會紅的那兩行, 不要看散文。**
//
// 🔴🔴 **為什麼需要它**:`toPaymentSummary()` 今天有 **3 個呼叫端**,三處都渲染在**同一頁**
//    (訂單詳情:頭條 / 付款卡 / 出貨區)。三處**共用那支函式,但【不共用它的第一個引數】** ——
//    兩處就地讀 `detail.total.amount`,一處靠呼叫端一路傳進去。
//    ⇒ 誰把其中一處改成別的口徑(例如「應收 − 已退款」),**另外兩處不會跟**,
//      而畫面上會同時出現**兩個不同的尾款**:沒有錯誤、沒有紅字、沒有 log。
//    ⇒ 而出貨區那一格**就在「出貨」鈕旁邊** ⇒ 它直接決定員工按不按下去。
//
// 🔴🔴 **2026-09-08:上面那句括號裡的事【真的發生了】, 而本檔原本一格都沒紅。**
//    (code-reviewer must-fix;Sean 拍【乙】= 已收扣退款只顯示淨額。)
//    ⇒ 頭條與付款卡把 `toPaymentSummary()` 的**回傳值**再餵一層 `toReceivedNetSummary()`
//      改成淨額口徑;出貨區兩處**刻意不改**(語意 = 還欠多少)。
//    🛑 **⇒「同一頁兩個口徑不可能並存」這句話, 從今天起【不成立】** —— 現在是**刻意**並存的。
//      ⛔ ~~本檔原本靠「第 1 引數同源 + 第 2 引數 fail-closed」就守得住那條不變式~~ **作廢**:
//      那兩格看的是**引數**, 而換口徑發生在**回傳值**上 ⇒ 它們**構造上看不到**。
//    ✅ 補法在下面那個 `describe('已收淨額口徑…')`:**釘住「吃 toReceivedNetSummary 的檔恰有哪幾支」**
//      —— 多一支就要有人看過「它到底該不該扣退款」。
//    📌 這一段是**機制優先律**的直接應用:承載不變式的是守門, 不是註解。
//
// 📌 **這個病 2026-08-16 已經被 code-reviewer 更正過一次**(逐字在
//    `order-focal-row.tsx` 搜 `不是它的第一個引數`;🔴 2026-08-27 隨焦點列搬檔,
//    舊檔 grep 該字面 ⇒ 0)—— 而更正之後**又多了第 3 面**
//    (片9 的出貨區)⇒ **更正本身沒有機制在擋新增的面。這支就是那個機制。**
//
// ⚠️⚠️ **誠實邊界 —— 本檔是【文字層】斷言,不是渲染測試。**
//    它證的是「三處寫的是同一個運算式」,**證不到「畫面上那三個數字相等」**。
//    要後者得渲染整個 `OrderDetail`,而本 repo 今天沒有那支 harness(`order-detail.test.tsx` 不存在)。
//    ⇒ **不要把本檔讀成「三個數字已驗證一致」。**

const ROOT = 'apps/admin/src';
const strip = stripComments;

// 🔴🔴 **這兩層快取是 ⟦01-TREESCANTIMEOUT⟧「乙-小」的修法, 而它【沒有動任何 timeout、也沒有動任何斷言】**
//    (2026-09-06;板列明文:調高 timeout 是把警報關掉 ⇒ 不做)。
//    🔬 量到的:`sourceFiles()` 在本檔被叫 **5 次**, 而三個呼叫端【各自】再把每支檔讀一遍
//      ⇒ 同一棵樹走 5 遍 + 同一批檔案讀 5 遍。
//    ⇒ ✅ 檔案系統在一次 vitest run 之內不會變 ⇒ **走一遍、讀一遍, 記起來**。
//    🛑 **判別力一格沒動** —— 斷言、正規表達式、排除規則全部原樣。
let _files: string[] | undefined;
const _src = new Map<string, string>();
/** 剝過註解的原始碼, 同一支檔只讀一次。 */
function srcOf(file: string): string {
  const hit = _src.get(file);
  if (hit !== undefined) return hit;
  const code = strip(readFileSync(file, 'utf8'));
  _src.set(file, code);
  return code;
}

function sourceFiles(): string[] {
  if (_files) return _files;
  _files = readdirSync(ROOT, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => `${ROOT}/${f}`);
  return _files;
}

/** `toPaymentSummary(<第1引數>, …)` 的呼叫端。**排除函式宣告本身**(`function toPaymentSummary(`)。 */
function callSites(): { file: string; firstArg: string }[] {
  const out: { file: string; firstArg: string }[] = [];
  for (const file of sourceFiles()) {
    const src = srcOf(file);
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
    const src = srcOf(file);
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
    const src = srcOf(file);
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

  it('🔴 `toPaymentSummary` 恰有 4 個呼叫端 —— 多一個就要有人看過這條不變式', () => {
    const sites = callSites();
    expect(
      sites.map((s) => s.file).sort(),
      '呼叫端數量變了。新增一處請確認它的第一個引數與另外三處同源,然後把數字改成新的值。',
    ).toEqual([
      // 🔴 2026-08-27:焦點列從 `order-detail-summary-cards.tsx` 搬到自己的檔(Sean 拍乙)。
      //    **呼叫端數量沒有變(仍是 3), 換的是【路徑】** —— 第一引數 `detail.total.amount`
      //    整段搬家、逐字未動。
      //    ⚠️ **而「改路徑」與「換掉一個呼叫端」在 diff 上長得一樣** ⇒ 審這一行的人要看的是
      //       下面那格(第一引數同源), 不是這張名單的長度。
      // 🔴 2026-09-04:`shipment-section.tsx` 從 1 個呼叫端變成 **2 個** ——
      //    新的那個是 `shipmentBalanceWarning()`,它把「尾款 X 元未收」那句話算出來
      //    送進**建箱彈窗**(Sean 當天逐字:「甲 可以 —— 但那個框裡要明顯寫『尾款 X 元未收』」)。
      //    🟢 **而它與同檔那個 `ShipmentBalanceNote` 第一引數逐字相同**(`detail.total.amount`)
      //       ⇒ 下面那格(第一引數同源)照樣綠 ⇒ **這一行加的是【一個新的顯示面】,不是新的口徑。**
      //    ⚠️ **本閘當場紅了, 而它紅得對** —— 它逐字說「新增一處請確認它的第一個引數與另外三處
      //       同源, 然後把數字改成新的值」。📌 **先確認同源、再改數字, 順序不能反。**
      `${ROOT}/components/orders/order-focal-row.tsx`,
      `${ROOT}/components/orders/payment-list.tsx`,
      `${ROOT}/components/orders/shipment-section.tsx`,
      // 🔴 2026-09-04 **同日第二次動這張名單** —— 舊字面留著看得出它移動過:
      //    ⛔ ~~`components/orders/shipment-section.tsx`(第二筆)~~ ⇒ ✅ `lib/shipping/shipment-balance-warning.ts`
      //    那句「尾款 X 元未收」從**元件檔**搬到 **lib**, 因為兩個出貨入口都要用它
      //    (Sean 逐字「甲 也要顯示 —— 那條路要去拿到金額」)。
      //    🟢 **呼叫端【數量沒變】(仍是 4), 換的是【路徑】** —— 第一引數 `detail.total.amount` 逐字未動。
      //    ⚠️ 而「改路徑」與「換掉一個呼叫端」在 diff 上長得一樣 ⇒ 審這一行的人要看的是
      //       下面那格(第一引數同源), 不是這張名單的長度。(同 2026-08-27 焦點列搬檔那次的教訓。)
      `${ROOT}/lib/shipping/shipment-balance-warning.ts`,
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
    // 鏈路(2026-08-19 實查,兩跳;2026-08-24 拆檔片:源頭那一跳隨 money 分頁 content 搬檔):
    //   order-detail-money-tab.tsx  <PaymentSection amountDue={detail.total.amount}>
    //   → payment-section.tsx  <PaymentList amountDue={amountDue}>   ← 純轉傳
    //   → payment-list.tsx  toPaymentSummary(amountDue, …)
    // 🔴 拆檔片 re-point:期望值只換【檔名】—— 運算式同字、源頭仍恰一個(本格當場紅過,
    //    紅的內容就是「同運算式、新檔名」,它證明這把尺按內容掃全樹、搬家躲不掉它)。
    const props = amountDueProps();
    const sources = props.filter((p) => p.value !== 'amountDue');
    expect(
      sources.map((p) => `${p.file} ⇒ ${p.value}`),
      'amountDue 的源頭變了(或多了第二個源頭)⇒ 付款卡會與頭條、出貨區脫鉤。',
    ).toEqual([`${ROOT}/components/orders/order-detail-money-tab.tsx ⇒ detail.total.amount`]);
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

  it('每一處的第 2 引數都必須是 `<資料>.status === \'ok\' ? <資料>.rows : null`', () => {
    const sites = callSitesWithSecondArg();
    // 🔴 2026-09-04 `3` ⇒ `4`:`shipment-section.tsx` 多了 `shipmentBalanceWarning()`
    //    (「尾款 X 元未收」送進建箱彈窗)。它的第 2 引數逐字就是上面那個形狀 ⇒ 下面那格照樣綠。
    //    ⚠️ 標題原本寫死「**三處**」—— 那個字每加一個呼叫端就過期一次而**沒有東西會叫**
    //    ⇒ 改成不帶數字的說法, 數字只留在這一行(它會紅)。
    expect(sites.length, '沒掃到呼叫端 ⇒ 下面的斷言會恆綠').toBe(4);
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


// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 已收淨額口徑(2026-09-08 Sean 拍【乙】)—— **誰吃了 `toReceivedNetSummary`。**
//
// 上面那組守的是 `toPaymentSummary` 的**引數**;淨額是把它的**回傳值**再換一次口徑
// ⇒ 上面那組對它**構造上失明**(code-reviewer 2026-09-08 must-fix,實測四格全綠)。
//
// ⚠️ **誠實邊界(與檔頭同一句)**:本組也是**文字層**斷言。
//    它證的是「哪幾支檔在換口徑」,**證不到「畫面上那些數字是對的」** ——
//    後者釘在 `app/orders/[id]/refund-wiring.test.tsx`(真渲染整個 `OrderDetail`)
//    與 `lib/orders/payment-list-view.test.ts`(純函式)。
// ─────────────────────────────────────────────────────────────────────────────

/** 呼叫 `toReceivedNetSummary(` 的檔(排除函式宣告本身)。 */
function netSummaryCallers(): string[] {
  const out: string[] = [];
  for (const file of sourceFiles()) {
    const src = srcOf(file);
    for (const m of src.matchAll(/(function\s+)?toReceivedNetSummary\(/g)) {
      if (m[1] !== undefined) continue; // 宣告,不是呼叫
      out.push(file);
    }
  }
  return out;
}

describe('已收淨額口徑:換口徑的檔必須是被看過的那幾支', () => {
  it('🟢 正向對照:掃描器真的掃到東西', () => {
    expect(sourceFiles().length).toBeGreaterThan(100);
    // 🔴 **這一句不是「否則下面那格恆綠」**(codex R3 must-fix 更正我原本的說法):
    //    regex 永遠不匹配的話,下面那格會拿空陣列去比兩個檔名 ⇒ **它會紅,不會恆綠**。
    //    ⇒ 本格真正的作用是**把失敗的原因分開**:掃不到東西 vs 名單真的變了,
    //      兩者在下一格的錯誤訊息裡長得一樣,而**下一步完全不同**。
    expect(netSummaryCallers().length).toBeGreaterThan(0);
  });

  it('🔴 `toReceivedNetSummary` 恰有這 2 次呼叫 —— 多一次就要有人看過「它該不該扣退款」', () => {
    // 🔴 **數的是【呼叫次數】不是【檔案數】**(codex R3 must-fix + 主視窗 A 2026-09-08 逐字
    //    「不要只改名字讓它誠實, 先問我們要守的是幾個檔還是幾次呼叫」)。
    //    ⛔ ~~第一版用 `new Set(...)` 去重~~ ⇒ **同一支檔叫兩次照樣過**,而
    //    **同一支檔裡多一次呼叫 = 多一格採用淨額口徑的顯示面**,那正是本組要攔的東西。
    //    ⇒ 期望值一行一次呼叫(與本檔上方 `toPaymentSummary` 那格同一種形狀)。
    expect(
      netSummaryCallers().sort(),
      '換口徑的地方變了。\n' +
        '· 多一次 ⇒ 先問「那一格的語意是【客人付了多少】還是【還欠我們多少】」——\n' +
        '  後者(出貨尾款那一族)**不該**扣退款,扣了會讓一張退過款的單看起來還欠更多。\n' +
        '· 少一次 ⇒ **可能**是同一頁又出現兩個口徑不同的「已收」(2026-09-08 這一片在修的病),\n' +
        '  **也可能**是有人把它換成等價封裝或內聯 ⇒ 本格只答「名單變了」,判定要開檔。',
    ).toEqual([
      `${ROOT}/components/orders/order-focal-row.tsx`,
      `${ROOT}/components/orders/payment-list.tsx`,
    ]);
  });

  it('🛑 出貨區那兩支【不得】提到 `toReceivedNetSummary`', () => {
    // 🔴 這一格與上一格**不是同一件事**:上一格擋「名單變了」,本格擋「名單沒變而出貨區偷偷加了一處」
    //    ——它用**指名**的方式問,所以就算上面那份期望名單被一起改掉,本格仍會紅。
    // ⚠️ **射程(codex R3 must-fix)**:它用的是**字串包含**,不是呼叫偵測
    //    ⇒ 只要那兩支檔**提到**這個名字(import / 註解 / 字串)就會紅。
    //    📌 那是**刻意保守**的:出貨尾款那一族連「看起來要用它」都該先有人看過。
    //    ⇒ 但**紅了不等於已經改口徑** —— 失敗訊息照這個射程寫,不要宣判。
    const banned = [
      `${ROOT}/components/orders/shipment-section.tsx`,
      `${ROOT}/lib/shipping/shipment-balance-warning.ts`,
    ];
    const bad = banned.filter((f) => srcOf(f).includes('toReceivedNetSummary'));
    expect(
      bad,
      '出貨那兩支提到了 `toReceivedNetSummary`。\n' +
        '先開檔看它是**真的改吃淨額**還是只是 import / 提及:\n' +
        '· 真的改了 ⇒ 一張退過款的單會被畫成「還欠更多」,而 Sean 沒有拍過那件事。\n' +
        '· 只是提及 ⇒ 那也要有人看過,本格刻意保守。',
    ).toEqual([]);
  });
});
