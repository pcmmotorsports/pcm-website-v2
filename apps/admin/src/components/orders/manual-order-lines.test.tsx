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
  it('🔴🔴 本檔的程式碼裡【一個 `value=` 都沒有】(受控輸入的形狀)', () => {
    // 失敗情境:有人把某一格改成受控 ⇒ 「畫面顯示的」與「送出去的」開始有兩個來源
    //   ⇒ reset / 競態之後兩者可以不同,而**沒有東西會紅**。取消線就是這樣被咬的。
    expect(CODE).not.toMatch(/\bvalue=/);
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

  it('🔴 state 的型別是 `number[]`(列 id),不是任何裝值的東西', () => {
    expect(CODE).toContain('useState<number[]>');
  });

  // 🔴🔴 下面兩格是 codex R1 #8 逼出來的:**只禁字面 `value=` 擋不住 spread。**
  //    `const p = { value: draft, onChange: setDraft }; <input {...p} />`
  //    ⇒ 上面那兩格全綠, 而送出值已經由 client state 回寫。
  it('🔴 沒有任何 `{...spread}` 灑在元素上(那是繞過上面那兩格的路)', () => {
    expect(CODE).not.toMatch(/\{\s*\.\.\./);
  });

  it('🔴 全檔【恰好一個】 `useState`(多一個就可能是裝值的那個)', () => {
    // 失敗情境:有人加第二個 state 裝草稿值 ⇒ `useState<number[]>` 那格照樣綠。
    expect(CODE.match(/useState/g) ?? []).toHaveLength(2); // import 一次 + 呼叫一次
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
  const CHILD = readFileSync(join(__dirname, 'manual-order-line-price-check.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

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
  it('🔴 「含稅」兩個字在畫面上(不是只在註解裡)', () => {
    render(<ManualOrderLines />);
    // getByText 讀的是**渲染後的文字**,註解不會進 DOM ⇒ 這一格分得出「寫在碼裡」與「員工看得到」。
    expect(screen.getByText(/含稅/)).toBeTruthy();
  });

  it('🔴🔴 而它要說得出【填錯會怎樣】—— 只說「請填含稅」的標籤,員工會憑印象填', () => {
    render(<ManualOrderLines />);
    const el = screen.getByText(/少收/);
    expect(el.textContent).toContain('5%');
    expect(el.textContent).toContain('未稅');
  });

  it('🔴 負對照:這把尺量得到「不在」—— 換一句沒寫過的話 ⇒ 必須查無', () => {
    render(<ManualOrderLines />);
    // 缺這一格 ⇒ 上面兩格「有找到」與「getByText 對任何東西都回真」印同一個綠。
    expect(screen.queryByText(/請填零稅率金額/)).toBeNull();
  });
});
