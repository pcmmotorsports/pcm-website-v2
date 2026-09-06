// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 🔴 本檔【零斷言改動】—— 只加這一行 mock。
//    成因:本元件現在渲染 `ManualOrderLinePriceCheck`(⟦b4-PURCHTAX1⟧ 甲案),
//    而它那條 import 鏈上有 `server-only` ⇒ jsdom 載不動整支檔(`Tests no tests`)。
//    形狀抄隔壁 `manual-order-catalog-lookup.test.tsx:12`, 不自己發明一套。
//    🛑 **這不是放寬守門** —— 下面那三道原始碼層守門(:105-118)一個字都沒動, 而且仍然要綠。
vi.mock('server-only', () => ({}));
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MANUAL_ORDER_LINE_SEED_EVENT } from '../../lib/orders/manual-order-line-seed';

import { ManualOrderLines } from './manual-order-lines';
import { MANUAL_ORDER_MAX_LINES } from '@/lib/orders/manual-order-form';

// manual-order-lines.test.tsx — A3-c 品項列的守門。
//
// 🔴 本檔守兩件**不同層**的事,不要混著讀:
//   ① **行為層**:加一列 / 刪一列 / 送出去的 FormData 逐格對得上畫面
//   ② **原始碼層**:不變式 (i)「送出值不由 client state 產生或回寫」——
//      體例抄 `cancel-form-body` 那條線的原始碼層守門(它釘住「數量欄名一次都不出現」)。
//      🔴 **行為層測不到不變式** —— 一個受控元件在測試裡也會乖乖送出正確的值,
//         它壞的那天是「reset / 競態之後 state 與 DOM 不一致」,而那不是元件測試量得到的。
//         ⇒ 所以要有一格**去讀原始碼**。

afterEach(cleanup);

const SRC = readFileSync(join(__dirname, 'manual-order-lines.tsx'), 'utf8');
/**
 * 只看**程式碼**,不看註解 —— 註解裡寫 `value=` 來解釋規矩是正常的。
 *
 * 🔴 **要剝【兩種】註解,而我第一版只剝了一種**(2026-08-24 夜 R1 抓到):
 *   · 行註解 `//` 與區塊註解 `/* … *\/`
 *   · 🔴 **JSX 註解 `{/* … *\/}`** —— 它在 `.tsx` 裡是常態,而它**不是**以 `//` 開頭
 *     ⇒ 只剝第一種的話,有人在 JSX 註解裡寫 `value=` 會讓下面那格**紅錯地方**。
 *     方向雖然是偏假紅(安全那一側),但「這把尺只看程式碼」那句宣稱**當時是假的**。
 * ⚠️ 剝法是字串處理不是解析器 ⇒ 它會被字面裡的 `*\/` 騙。
 *    下面有**正對照 + 負對照各一格**釘住「剝這一步真的在做事、而且沒做過頭」。
 *
 * 🔴🔴 **`{` 與 `/*` 之間【不允許空白】,而那一格我踩過**(2026-08-24 夜,同一輪):
 *    我原本寫 `\{\s*\/\*…\*\/\s*\}`,以為寬鬆一點比較保險。**它會回溯**:
 *    從 `type ManualOrderLinesProps = {` 那個大括號一路吃到**後面某個** `*\/`,
 *    再找一個前面只有空白的 `}` 收尾 ⇒ **一整段真的程式碼被當成註解剝掉了。**
 *    🔴 **而它壞的方向是【假綠】** —— `CODE` 變小 ⇒ 下面那格 `not.toMatch(/value=/)` **更容易過**。
 *    抓到它的是**正對照**那一格(`useState<number[]>` 不見了),不是負對照。
 *    📌 **一把會「多剝」的尺,和一把好用的尺,在只看負對照時長得一模一樣。**
 */
const CODE = SRC
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX 註解 `{/* … */}`(兩端不留空白, 見上)
  .replace(/\/\*[\s\S]*?\*\//g, '') // 區塊註解 / JSDoc
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

/** 欄名的 base(不含列號)。🔴 **手打**, 不從常數組 —— 拼錯了兩邊一起錯會全綠。 */
const BASES = {
  sku: 'line_sku',
  title: 'line_title',
  qty: 'line_qty',
  unitPrice: 'line_unit_price',
  variant: 'line_variant_id',
  spec: 'line_spec',
} as const;
/** 第 `i` 列的欄名。🔴 列號寫在**欄名裡**, 這樣每一格的身分不靠出現順序(codex R1 逼出來的形狀)。 */
const f = (base: string, i: number) => `${base}_${i}`;

/** 從渲染出來的 DOM 收一份 FormData —— **這才是瀏覽器真的會送的東西**。 */
function submitted(container: HTMLElement): Record<string, string[]> {
  const form = document.createElement('form');
  form.appendChild(container.cloneNode(true));
  const fd = new FormData(form);
  const out: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) (out[k] ??= []).push(String(v));
  return out;
}

const addRow = () => fireEvent.click(screen.getByText('加一列'));

describe('🔴 原始碼層:不變式 (i) —— 送出值不由 client state 產生或回寫', () => {
  it('🔴🔴 本檔的 `value=` 只准出現在 `<option>` 上, 而且只准是那兩顆常數', () => {
    // 失敗情境:有人把某一格改成受控 ⇒ 「畫面顯示的」與「送出去的」開始有兩個來源
    //   ⇒ reset / 競態之後兩者可以不同,而**沒有東西會紅**。取消線就是這樣被咬的。
    //
    // 🔴🔴 **2026-09-06 ⟦b4-PURCHTAX1⟧ 換尺(⛔ ~~`expect(CODE).not.toMatch(/\bvalue=/)`~~)**:
    //    稅基那一格是 `<select>` + 兩顆 `<option value=…>` ——
    //    而 **`<option>` 的 `value` 不會讓那個 select 變成受控**(受控的是 `select` 上的 `value=`)。
    //    🛑 **而這不是放寬** —— 舊尺是「一個都不准」, 新尺是兩個條件:
    //      ① `value=` **只准長在 `<option` 上**(其他任何標籤上出現 ⇒ 紅)
    //      ② 每一個 option 的值**只准是那兩顆匯入的常數**(寫死字串 / 塞 state 進去 ⇒ 紅)
    //    ⇒ 📌 ② 是新增的約束:舊尺根本沒有它, 因為舊尺底下 `<option>` 不可能存在。
    const OPTION_TAG = /<option value=\{([A-Za-z0-9_.]+)\}>/g;
    const allowed = ['MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED', 'MANUAL_ORDER_LINE_TAX_BASIS_TAXED'];
    const optionValues = Array.from(CODE.matchAll(OPTION_TAG)).map((m) => m[1]);
    // 🔵 正對照:這把尺真的撈得到東西(不然下面兩格在「一顆 option 都沒有」的世界也全綠)。
    expect(optionValues.length).toBeGreaterThan(0);
    for (const v of optionValues) expect(allowed).toContain(v);
    // ① 把合法的那幾個 `<option value={…}>` 拿掉之後, **不准再有任何 `value=`**。
    const rest = CODE.replace(OPTION_TAG, '<option>');
    expect(rest).not.toMatch(/\bvalue=/);
    // 🔴🔴 **③ 標籤與值要配對**(codex nit, 2026-09-06)——
    //    上面兩條都過, 而**把兩顆常數對調**(未稅那顆掛 taxed、含稅那顆掛 untaxed)
    //    仍然全綠 ⇒ **畫面上寫「未稅」而送出去的是 taxed**, 錢直接錯而沒有東西會叫。
    //    ⇒ 這一格釘住那個配對。🔵 用渲染出來的畫面問, 不讀原始碼(繞法見隔壁檔那條血)。
    cleanup();
    render(<ManualOrderLines />);
    const sel = document.querySelector('select[name^="line_tax_basis_"]');
    expect(sel, '稅基那一格不見了').toBeTruthy();
    const opts = Array.from((sel as HTMLSelectElement).options).map((o) => [o.textContent, o.value]);
    expect(opts).toEqual([
      ['未稅', 'untaxed'],
      ['含稅', 'taxed'],
    ]);
  });

  it('🔴 也沒有 `onChange` / `onInput`(state 連【讀】都不讀值)', () => {
    expect(CODE).not.toMatch(/\bonChange=/);
    expect(CODE).not.toMatch(/\bonInput=/);
  });

  it('🔴 正對照:這把尺量得到東西(不然上面兩格是【因為讀不到檔】而綠)', () => {
    expect(CODE.length).toBeGreaterThan(500);
    expect(CODE).toContain('useState');
    expect(CODE).toMatch(/\bonClick=/); // 加/刪那兩顆鈕是真的存在的
  });

  it('🔴 負對照:剝註解這一步【真的在做事】—— 兩種註解各挑一句只住在註解裡的字面', () => {
    // 沒有這一格, 剝法壞掉(例如漏了 JSX 註解)會表現成「全部都乾淨」而不是紅。
    const LINE_COMMENT_ONLY = 'E-011-STOP'; // 住在檔頭 `//` 註解裡
    const JSX_COMMENT_ONLY = '沒有畫面入口'; // 住在 `{/* … */}` 裡
    expect(SRC, '這句應該在原始碼裡(行註解)').toContain(LINE_COMMENT_ONLY);
    expect(CODE, '剝完就不該在了').not.toContain(LINE_COMMENT_ONLY);
    expect(SRC, '這句應該在原始碼裡(JSX 註解)').toContain(JSX_COMMENT_ONLY);
    expect(CODE, 'JSX 註解沒被剝乾淨 ⇒ 上面那兩格會紅錯地方').not.toContain(JSX_COMMENT_ONLY);
  });

  // 🔴🔴 **這一格從 `number[]` 改成 `LineRow[]`, 而那是【放寬】——所以同一批補了兩道更嚴的。**
  //  ⛔ ~~`useState<number[]>`~~ 作廢:⟦b4-建單加成一列⟧ 之後那個 state 要帶 `seed`。
  //  🛑 **原本那一格在守的東西不能跟著消失**:它守的是「state 裡不准裝【會送出去的值】」。
  //     `LineRow` 裡就有值了 ⇒ 光看型別已經守不住 ⇒ 改成守**那些值怎麼用**:
  //       ① `seed` 只准出現在含 `defaultValue={` 的行(= 開場值, 瀏覽器拿一次就歸員工)
  //       ② 全檔 `.value` 零命中(= 沒有任何回寫)
  //     ⇒ 📌 **兩道合起來比原本那一道嚴**:原本只問型別, 現在問的是用法。
  it('🔴 state 的型別是 `LineRow[]`(列 id + 開場種子)', () => {
    expect(CODE).toContain('useState<LineRow[]>');
  });

  it('🔴🔴 `seed` 只准出現在含 `defaultValue={` 的那一行(逐行比)', () => {
    const offenders = CODE.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /\bseed\b/.test(l))
      .filter(({ l }) => !l.includes('defaultValue={'))
      // 🔵 這幾種不是「用值」(最後一種是【去重比對】—— 它拿 variantId 去比, 不把它寫進任何欄位):型別宣告 / 事件接線 / setRows 裡把 seed 放進新列。
      .filter(({ l }) => !/type LineRow|ManualOrderLineSeed|CustomEvent|detail|\bseed\?: |\{ id: newRowId\(\), seed \}|r\[0\]\?\.seed|manual-order-line-seed|setAddedNote|x\.seed\?\.variantId === seed\.variantId/.test(l));
    expect(offenders.map((o) => `${o.n}: ${o.l.trim()}`), '這幾行在用 seed 而不是拿它當開場值').toEqual(
      [],
    );
  });

  // 🔴🔴 **DOM 直取的絆線**(code-reviewer R1 抓到:這一支反而守得比隔壁鬆)。
  //  🔬 它示範的繞法逐字可跑:把 `seed` 改名 `v`、local 改 `d`, 再寫
  //     `document.getElementsByName('line_sku_0')[0].setAttribute('value', d.sku)`
  //     ⇒ **原本八道全綠**, 而那是真的回寫送出欄位。
  //  🛑 隔壁 `catalog-lookup.test.tsx` 早就擋了 `querySelector` / `getElementById` ——
  //     而**握著六個具名欄位的是這一支**。⇒ 補齊。
  //  ⚠️ **射程照隔壁那段逐字繼承:這是【最直白那幾種寫法的絆線】, 不是資料流保證。**
  //     藏進 imported helper、或用 `form.elements` 都繞得過 ⇒ 不得寫成「證明了不回寫」。
  it('🔴 不得用 DOM 直取去碰欄位(絆線, 不是證明)', () => {
    for (const bad of [
      'querySelector',
      'getElementById',
      'getElementsByName',
      'getElementsByTagName',
      'setAttribute',
      'form.elements',
      'FormData(',
    ]) {
      expect(CODE, `出現 ${bad} ⇒ 這一支開始自己摸 DOM 了`).not.toContain(bad);
    }
  });

  it('🔴 全檔 `.value` 零命中(沒有任何回寫)', () => {
    expect(CODE.match(/\.value\b/g) ?? []).toHaveLength(0);
  });

  // 🔴🔴 下面兩格是 codex R1 #8 逼出來的:**只禁字面 `value=` 擋不住 spread。**
  //    `const p = { value: draft, onChange: setDraft }; <input {...p} />`
  //    ⇒ 上面那兩格全綠, 而送出值已經由 client state 回寫。
  it('🔴 沒有任何 `{...spread}` 灑在元素上(那是繞過上面那兩格的路)', () => {
    expect(CODE).not.toMatch(/\{\s*\.\.\./);
  });

  // 🔴🔴 **這一格從「恰好一個」放寬成「恰好兩個」, 而放寬要拿更嚴的來換。**
  //  ⛔ ~~`toHaveLength(2)`(import 一次 + 呼叫一次)~~ —— code-reviewer R1 MF3 要求
  //     「按了要出聲」(按了沒聲音 ⇒ 員工再按一次 ⇒ 兩列同 `variant_id` ⇒ **整張單被拒**),
  //     而那句話需要第二個 state。
  //  🛑 **原本那一格在守什麼**:多一個 state 就可能是**裝【會送出去的值】**的那個。
  //     ⇒ 放寬數量之後, 改成直接守那件事:**第二個 state 不得進任何 `name=` 欄位**。
  //  ✅ 兩格合起來比原本嚴:①數量仍然釘死(第三個 state 會紅)②那個 state 送不出去。
  it('🔴 全檔【恰好兩個】 `useState`(第三個會紅)', () => {
    expect(CODE.match(/useState/g) ?? []).toHaveLength(3); // import 一次 + 呼叫兩次
  });

  it('🔴🔴 `addedNote` 不得出現在任何帶 `name=` 的行(它是畫面訊息, 不是送出的值)', () => {
    const offenders = CODE.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /addedNote/.test(l));
    // 🔴🔴 **只比「同一行有沒有 `name=`」是繞得過的**(codex 抓到):
    //    JSX 的一個 input 跨好幾行 ⇒ 把 `defaultValue={addedNote}` 寫在**別一行**就全綠了。
    // ✅ 改成:`addedNote` 只准出現在**它自己那三種用法**的行 —— 宣告 / setter / 那句話本身。
    //    任何別的用法(尤其是進到某個 JSX 屬性)都會落進 offenders。
    const allowed =
      /const \[addedNote, setAddedNote\]|setAddedNote\(|addedNote !== ''|\{addedNote\}/;
    const bad = offenders.filter(({ l }) => !allowed.test(l));
    expect(bad.map((o) => `${o.n}: ${o.l.trim()}`), '那個 state 跑到別的地方去了').toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════
  // 🔴🔴 **這一格是 codex 對抗審查逼出來的(2026-09-03, ⟦b4-PURCHTAX1⟧ 甲案)。**
  //
  // 上面那三道守門**只掃這一支檔**。而本片把比價那段搬進了子元件
  // `manual-order-line-price-check.tsx` ——
  // 🛑 **搬完之後, 那三道守門對子元件是失明的**:子元件日後新增一個具名欄位、
  //    或去寫 `form.elements[...].value`, **三道全綠**, 而不變式已經破了。
  //
  // 🎯 **⇒ 我搬碼的當下沒有弄壞不變式, 而我把守門的涵蓋面縮小了 —— 那兩件事不一樣。**
  // ⇒ 📌 所以這一格把子元件拉進同一個分母。**不是因為它今天有問題, 是因為守門要跟著碼走。**
  // ══════════════════════════════════════════════════════════════════
  //
  // 🔴🔴 **2026-09-03 第二次同一件事(線【帳號】`-account` 補)**:
  //    Q32 甲那片新增了 `manual-order-leave-guard.tsx` —— 它**握著 `form.elements` 裡的每一顆節點**,
  //    而它當時不在這個分母裡 ⇒ 有人在那裡寫一行回寫, **這三道守門全綠**。
  //    🎯 **而那一片的作者(我)當時拿「這 23 格沒紅」當「不變式沒破」的證據** ——
  //       R1 finding 9 逐字擊破:那個分母裡**沒有那支檔** ⇒ **那個綠沒有判別力**。
  //    📌 ⇒ 與上面那段是同一課:**碼搬到哪裡, 守門的分母就要跟到哪裡** ——
  //       而它不會自己跟, 也不會有東西叫。
  const strip = (name: string) =>
    readFileSync(join(__dirname, name), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');

  /** 這道守門的分母:所有【摸得到這張表單的控制項】而不是它自己那支檔的元件。 */
  const SIBLINGS: ReadonlyArray<readonly [string, string]> = [
    ['manual-order-line-price-check.tsx', strip('manual-order-line-price-check.tsx')],
    ['manual-order-leave-guard.tsx', strip('manual-order-leave-guard.tsx')],
    // 🔴 ⟦b4-建單加成一列⟧ 2026-09-06:查詢那支**開始摸得到這張表單了**(它會丟種子事件)
    //    ⇒ 進分母。🔵 它自己有 `value={keyword}` + `onChange`, 而那是**它自己的搜尋框**、
    //      沒有 `name=` ⇒ 不會送值 ⇒ 下面兩格對它成立。
    //    🛑 **而它進分母的理由不是「它現在乾淨」, 是「它現在有能力弄髒」** ——
    //      哪天有人在那支檔裡直接寫一個 `name=` 的 input 或回寫 `.value`, 這兩格會叫。
    ['manual-order-catalog-lookup.tsx', strip('manual-order-catalog-lookup.tsx')],
  ];
  const CHILD = SIBLINGS[0]![1];

  // 🔴🔴 **這條 regex 的兩個放寬與一個【已知邊界】(2026-09-04 線【權限登入】`-auth` 驗出來的)**:
  //    我原本只寫 `=[^=]` ⇒ 🔴 **複合指派全部漏掉, 而它們都是【寫】**:
  //      `el.value += x` · `el.value ??= x` · `el.value ||= x` ⇒ 三個都沒命中
  //    ✅ 現在收 `[+\-*/%|&^?]{1,2}=` 那一族。
  //    🟢 而它不誤殺【讀】—— 兩個世界各實跑過:
  //       該抓的 6 種(= += ??= ||= &&= *=)全中 · 該放的 5 種(!== === >= 賦值到別處)全放
  it.each(SIBLINGS)('🔴 %s 不回寫任何 input(分母:摸得到表單的都算)', (_name, code) => {
    expect(code, '寫 `.value =` / `+=` / `??=` ⇒ 那就是回寫 ⇒ 不變式破了').not.toMatch(
      /\.value\s*(=[^=]|[+\-*/%|&^?]{1,2}=)/,
    );
  });

  // ⚠️ **這把尺的已知邊界(`-auth` 2026-09-04 指出;刻意不補)**:
  //    它只認【小寫開頭的原生標籤】⇒ `<input name=…>` 抓得到,而 `<Input name=…>` **穿得過去**。
  //    🛑 **而補它會變成一個看起來有守、實際靠運氣的東西** —— 要判「那個自訂元件會不會渲染 name」,
  //       不是字面尺做得到的事。⇒ **已知,不是漏。** 下一個撞到的人:那是邊界,不是 bug。
  it.each(SIBLINGS)('🔴 %s 不渲染任何具名欄位(原生標籤那一層)', (_name, code) => {
    expect(code, '出現 `name=` ⇒ 它開始送值了').not.toMatch(/<[a-z][^>]*\sname=/);
  });

  it('🟢 正對照:剝註解之後兩支檔的碼都還在(否則上面四格是假綠)', () => {
    for (const [name, code] of SIBLINGS) {
      expect(code.length, `${name} 剝完只剩 ${code.length} 字元 ⇒ 尺多剝了`).toBeGreaterThan(400);
    }
  });

  it('🔴 子元件【不渲染任何具名欄位】—— 它只說話, 不參與送出', () => {
    expect(CHILD, "出現 `name=` ⇒ 它開始送值了, 而上面三道守門看不到它").not.toMatch(
      /<[a-z][^>]*\sname=/,
    );
  });

  it('🔴 子元件【不回寫】任何 input(Sean 2026-08-31 拍丙:查到的自己抄, 不回寫)', () => {
    expect(CHILD, '寫 `.value =` ⇒ 那就是回寫').not.toMatch(/\.value\s*=[^=]/);
  });

  it('🔴 負對照:這把尺量得到子元件裡真的有的東西(否則上面兩格是空的)', () => {
    // 缺這一格 ⇒ 檔案讀錯路徑/讀成空字串時, 上面兩格照樣全綠。
    expect(CHILD, '讀到的不是那支檔').toContain('resolveLinePriceCheck');
    expect(CHILD).toContain("'focusout'");
  });
});

describe('行為層:加一列 / 刪一列', () => {
  it('一開始就有一列可以打字', () => {
    render(<ManualOrderLines />);
    expect(screen.getAllByTestId('manual-order-line-row')).toHaveLength(1);
  });

  it('按「加一列」⇒ 多一列;而六個欄位【每一欄都多一格】(拉鍊長度必須全等)', () => {
    const { container } = render(<ManualOrderLines />);
    addRow();
    expect(screen.getAllByTestId('manual-order-line-row')).toHaveLength(2);
    const fd = submitted(container);
    // 🔴 兩列 ⇒ **每個 base 各有 `_0` 與 `_1` 一份**(列號寫在欄名裡, 不靠出現順序)
    for (const base of Object.values(BASES)) {
      expect(fd[f(base, 0)], `${f(base, 0)}`).toHaveLength(1);
      expect(fd[f(base, 1)], `${f(base, 1)}`).toHaveLength(1);
    }
  });

  it('🔴 刪掉一列 ⇒ 那一列的六格【一起消失】,不是只消失一格', () => {
    const { container } = render(<ManualOrderLines />);
    addRow();
    fireEvent.click(screen.getByLabelText('刪掉第 1 列'));
    const fd = submitted(container);
    // 🔴 剩一列 ⇒ 只剩 `_0`,而 `_1` **整組消失**(不是留下空殼)
    for (const base of Object.values(BASES)) {
      expect(fd[f(base, 0)], `${f(base, 0)}`).toHaveLength(1);
      expect(fd[f(base, 1)], `${f(base, 1)} 應該整個不見`).toBeUndefined();
    }
  });

  it('🔴 刪掉的是【那一列】,不是最後一列', () => {
    const { container } = render(<ManualOrderLines />);
    addRow();
    (container.querySelector(`input[name="${f(BASES.sku, 0)}"]`) as HTMLInputElement).value = 'FIRST';
    (container.querySelector(`input[name="${f(BASES.sku, 1)}"]`) as HTMLInputElement).value = 'SECOND';
    fireEvent.click(screen.getByLabelText('刪掉第 1 列'));
    // 🔴 刪掉第 1 列之後, 留下來的那一列**重新編號成 `_0`** —— 而值仍然是 SECOND 的。
    //    (列號是渲染位置, 不是身分;身分是 React 的 key。)
    expect(submitted(container)[f(BASES.sku, 0)]).toEqual(['SECOND']);
  });

  it('只剩一列時不出刪除鈕(刪光之後畫面上沒有東西可以打字)', () => {
    render(<ManualOrderLines />);
    expect(screen.queryByLabelText('刪掉第 1 列')).toBeNull();
    addRow();
    expect(screen.queryByLabelText('刪掉第 1 列')).not.toBeNull();
  });
});

describe('🔴 送出的內容 = 畫面上打的內容(逐格)', () => {
  it('兩列各自的值不會錯位', () => {
    const { container } = render(<ManualOrderLines />);
    addRow();
    const set = (base: string, values: string[]) =>
      values.forEach((v, i) => {
        (container.querySelector(`input[name="${f(base, i)}"]`) as HTMLInputElement).value = v;
      });
    set(BASES.sku, ['A', 'B']);
    set(BASES.title, ['甲', '乙']);
    set(BASES.qty, ['1', '2']);
    set(BASES.unitPrice, ['10', '20']);

    const fd = submitted(container);
    expect(fd[f(BASES.sku, 0)]).toEqual(['A']);
    expect(fd[f(BASES.sku, 1)]).toEqual(['B']);
    expect(fd[f(BASES.title, 0)]).toEqual(['甲']);
    expect(fd[f(BASES.title, 1)]).toEqual(['乙']);
    expect(fd[f(BASES.qty, 0)]).toEqual(['1']);
    expect(fd[f(BASES.qty, 1)]).toEqual(['2']);
    expect(fd[f(BASES.unitPrice, 0)]).toEqual(['10']);
    expect(fd[f(BASES.unitPrice, 1)]).toEqual(['20']);
  });

  it('🔴 代購品項:商品編號留白 ⇒ 送空字串(解析器把它收斂成 null)', () => {
    const { container } = render(<ManualOrderLines />);
    expect(submitted(container)[f(BASES.variant, 0)]).toEqual(['']);
  });

  it('🔴 `line_spec` 沒有畫面入口,但【仍然逐列送出】—— 少送它會讓拉鍊長度不等', () => {
    const { container } = render(<ManualOrderLines />);
    addRow();
    expect(submitted(container)[f(BASES.spec, 0)]).toEqual(['']);
    expect(submitted(container)[f(BASES.spec, 1)]).toEqual(['']);
  });
});

describe('上限', () => {
  it(`加到 ${MANUAL_ORDER_MAX_LINES} 列 ⇒ 鈕停用,而且【說出來】`, () => {
    render(<ManualOrderLines initialRows={MANUAL_ORDER_MAX_LINES} />);
    expect(screen.getByText('加一列')).toHaveProperty('disabled', true);
    // 🔴 按不動而沒有話 ⇒ 員工會以為網頁壞了。
    expect(screen.getByRole('status').textContent).toContain(String(MANUAL_ORDER_MAX_LINES));
  });

  it('🔴 對照:沒到上限時鈕是可以按的、而那句話不在', () => {
    render(<ManualOrderLines initialRows={MANUAL_ORDER_MAX_LINES - 1} />);
    expect(screen.getByText('加一列')).toHaveProperty('disabled', false);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('🔴 含稅安全標籤(⟦b4-PURCHTAX1⟧ 甲;2026-08-29)', () => {
  // 🔴 這一族守的不是排版,是【那句話還在不在】——
  //    代購單價全程只被驗「是不是非負整數」(`manual-order-form.ts:219` /^\d+$/),
  //    而未稅 1000 與含稅 1050 **兩個世界一起通過** ⇒ 今天擋這件事的只有這行字。
  //    ⇒ 它被刪掉 / 被改軟 ⇒ 這幾格要紅,而不是靜靜地通過。
  // ⛔ ~~「含稅」兩個字在畫面上~~ ⇒ 🔴 **Sean 2026-09-05 拍甲:單價填【未稅】、系統算稅**
  //    ⇒ 方向反過來。而**舊那格今天照樣綠** —— 因為新文案裡「含稅」出現在
  //    「填成**含稅**會多課一次稅」那半句 ⇒ 🛑 **它從「守對的方向」變成「對兩個方向都綠」。**
  //    ⇒ 📌 **一格守關鍵詞的測試, 在文案反向之後不會紅, 它只是不再測任何東西。**
  it('🔴 「未稅」兩個字在【那句橘字上】(不是只在註解裡, 也不是靠新加的下拉選單充數)', () => {
    // 🔴🔴 **2026-09-06 ⟦b4-PURCHTAX1⟧ 換尺(⛔ ~~`screen.getByText(/未稅/)`~~)**:
    //    稅基那一欄的 `<option>未稅</option>` 讓「未稅」在畫面上出現很多次
    //    ⇒ 舊寫法先是**多重命中直接爆**(那是它救了我一次), 而若改成 `getAllByText`
    //      就會變成**恆綠** —— 只要有下拉選單在, 那句橘字整段被刪掉它也照樣過。
    //    ⇒ 📌 **改成釘住【那一句】本身**, 而不是「畫面上某處有這兩個字」。
    const { container } = render(<ManualOrderLines />);
    const p = Array.from(container.querySelectorAll('p')).find((e) =>
      /單價這一格/.test(e.textContent || ''),
    );
    expect(p, '那句橘字不見了').toBeTruthy();
    expect(p!.textContent).toMatch(/未稅/);
  });

  it('🔴🔴 而【舊方向那句不可以還在】—— 兩句同時在, 員工會照先看到的那句做', () => {
    // 🛑 改文案最常見的壞法不是「沒改到」, 是**新的加上去而舊的留著**
    //    ⇒ 畫面上兩句互相矛盾, 而各自的測試都綠。
    // 🔴🔴 **不可以用 `queryByText`** —— 它逐節點比對, 而那句被 `<strong>` 切成好幾段
    //    ⇒ 沒有單一節點同時含「請填」「含稅」「金額」⇒ 永遠回 null ⇒ **恆綠**。
    //    🔬 實測:突變(把舊那句加回去)在 `queryByText` 版本下**全綠**。
    const { container } = render(<ManualOrderLines />);
    const p = Array.from(container.querySelectorAll('p')).find((e) =>
      /單價這一格/.test(e.textContent || ''),
    );
    expect(p).toBeTruthy();
    expect(p!.textContent).not.toMatch(/請填.*含稅.*金額/);
  });

  // ⛔ ~~舊版守的是「少收」+「5%」~~ —— 那是**填含稅→少收**那個方向。
  // ✅ 方向反過來之後, 填錯的後果是**多課一次**。
  it('🔴🔴 而它要說得出【填錯會怎樣】—— 只說「請填未稅」的標籤,員工會憑印象填', () => {
    render(<ManualOrderLines />);
    const el = screen.getByText(/多課/);
    expect(el.textContent).toContain('未稅');
    expect(el.textContent).toContain('系統自己算');
  });

  it('🔴 負對照:這把尺量得到「不在」—— 換一句沒寫過的話 ⇒ 必須查無', () => {
    render(<ManualOrderLines />);
    // 缺這一格 ⇒ 上面兩格「有找到」與「getByText 對任何東西都回真」印同一個綠。
    expect(screen.queryByText(/請填零稅率金額/)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⟦b4-建單加成一列⟧ 2026-09-06 —— 「查商品 ⇒ 點一下加成一列」的接收端
// 🔴 上面那三道守門看的是**原始碼**;它們答不出「點下去真的多一列嗎」。
//    ⇒ 這一組是行為層, 每一格都答得出「什麼樣的爛實作會讓它變紅」。
// ══════════════════════════════════════════════════════════════════════════
describe('行為層:收到種子 ⇒ 長出一列並帶著開場值', () => {
  const seed = {
    sku: 'SKU-A',
    title: '前叉油封',
    qty: '1',
    unitPrice: '900',
    variantId: 'v-1',
  };
  const emit = (detail: typeof seed) =>
    fireEvent(window, new CustomEvent(MANUAL_ORDER_LINE_SEED_EVENT, { detail }));

  const rowCount = (c: HTMLElement) =>
    c.querySelectorAll('[data-testid="manual-order-line-row"]').length;
  const val = (c: HTMLElement, name: string) =>
    (c.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value;

  it('🔴🔴 先打再種:員工在第 1 列手打的字【不得消失】', () => {
    // 🛑 **這一格取代了我原本那格「種進那一列」—— 那一格斷言的是一個 bug。**
    //    代購品項本來就沒有料號、沒有 seed ⇒ 「這一列沒有 seed」**不等於**「這一列是空的」。
    //    舊實作會把那一列換成新 id ⇒ key 變 ⇒ React 重建 ⇒ **他打的字全沒了, 零提示。**
    // 🔵 而既有那格「員工改過的字不會被蓋掉」是【先種再打】—— **分母不含出事的世界**。
    const { container } = render(<ManualOrderLines />);
    const title = container.querySelector('[name="line_title_0"]') as HTMLInputElement;
    const price = container.querySelector('[name="line_unit_price_0"]') as HTMLInputElement;
    fireEvent.change(title, { target: { value: '代購 · 原廠避震' } });
    fireEvent.change(price, { target: { value: '8800' } });

    emit(seed);

    expect(rowCount(container), '要長成第 2 列, 不是換掉第 1 列').toBe(2);
    expect(val(container, 'line_title_0'), '他打的品名要還在').toBe('代購 · 原廠避震');
    expect(val(container, 'line_unit_price_0'), '他打的單價要還在').toBe('8800');
    expect(val(container, 'line_sku_1'), '種子落在第 2 列').toBe('SKU-A');
  });

  it('🔴 已經有種子的列不會被蓋掉 —— 第二筆長成新的一列', () => {
    const { container } = render(<ManualOrderLines />);
    emit(seed);
    emit({ ...seed, sku: 'SKU-B', title: '後避震', unitPrice: '12000', variantId: 'v-2' });
    // 🔵 一律 append ⇒ 開場那一列空白列留著, 兩筆落在第 2、3 列(共 3 列)。
    //    ⚠️ 那一列空白的**要不要自動收掉**是另一個題(plan 沒要求, 本片不做)。
    expect(rowCount(container)).toBe(3);
    expect(val(container, 'line_sku_0'), '開場那一列還在, 沒被吃掉').toBe('');
    expect(val(container, 'line_sku_1')).toBe('SKU-A');
    expect(val(container, 'line_sku_2')).toBe('SKU-B');
    // 🔵 index 連號 —— 解析器要求 `_0.._n`,缺號整張被拒。
    expect(val(container, 'line_unit_price_2')).toBe('12000');
  });

  it('🔴 沒有經銷價(unitPrice 空字串)⇒ 單價那格留白, **不得種 0**', () => {
    // 🛑 0 是一個合法的價格 —— 種 0 會安靜地變成一張零元的單。
    const { container } = render(<ManualOrderLines />);
    emit({ ...seed, unitPrice: '' });
    // 🔴 **改成 append 之後種子落在第 2 列(`_1`)** —— codex 抓到我這一格還在驗 `_0`,
    //    而 `_0` 是那個一開始就在的空白列 ⇒ **它本來就是空的** ⇒ 這一格【恆綠】。
    // 🔵 順便釘住「這一格量的是種子那一列」:先確認第 2 列真的是那一筆。
    expect(val(container, 'line_sku_1'), '先證明我在看種子那一列').toBe('SKU-A');
    expect(val(container, 'line_unit_price_1')).toBe('');
  });

  it('🔴 員工改過的字不會被下一筆種子蓋掉', () => {
    const { container } = render(<ManualOrderLines />);
    emit(seed);
    const qty = container.querySelector('[name="line_qty_0"]') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '3' } });
    emit({ ...seed, sku: 'SKU-B', variantId: 'v-2' });
    expect(val(container, 'line_qty_0'), '第一列的數量要留著他打的 3').toBe('3');
  });

  it('🔴🔴 同一個商品連按兩次 ⇒ 只長一列(不然整張單會被 RPC 拒掉)', () => {
    // 🛑 兩列同 `variant_id` ⇒ 建單 RPC `RAISE EXCEPTION '重複品項'` ⇒ **整張單被拒**。
    //    ⇒ 那一句「已加成第 N 列」是**回饋不是守門** —— 它擋不住連按。
    const { container } = render(<ManualOrderLines />);
    emit(seed);
    emit(seed);
    expect(rowCount(container), '第二次不得再長一列').toBe(2); // 開場空白列 + 一列
    expect(val(container, 'line_variant_id_1')).toBe('v-1');
    expect(val(container, 'line_variant_id_2'), '不該有第三列').toBe(undefined);
  });

  it('🔵 而【代購】品項(沒有商品編號)可以開兩列 —— 那是合法的', () => {
    const { container } = render(<ManualOrderLines />);
    emit({ ...seed, variantId: '', sku: '' });
    emit({ ...seed, variantId: '', sku: '' });
    expect(rowCount(container), '沒有編號就不算重複').toBe(3);
  });

  it('🔵 撞到上限就不再長(而既有的列一格都不動)', () => {
    const { container } = render(<ManualOrderLines />);
    for (let i = 0; i < MANUAL_ORDER_MAX_LINES + 3; i += 1) {
      emit({ ...seed, sku: `S-${i}`, variantId: `v-${i}` });
    }
    expect(rowCount(container)).toBe(MANUAL_ORDER_MAX_LINES);
    expect(val(container, 'line_sku_0'), '開場那一列還在(它沒有 seed)').toBe('');
    expect(val(container, 'line_sku_1'), '第一筆種子落在第 2 列').toBe('S-0');
  });

  it('🔴 元件卸載之後不再接事件(不然換頁回來會長出鬼列)', () => {
    const { container, unmount } = render(<ManualOrderLines />);
    unmount();
    emit(seed);
    expect(container.querySelectorAll('[data-testid="manual-order-line-row"]').length).toBe(0);
  });
});
