// @vitest-environment jsdom
//
// Price smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「三條價格分支(純價 / retail discount / isMember)render 不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Price } from './Price';

afterEach(cleanup);

describe('Price', () => {
  it('should render a plain price without crashing', () => {
    render(<Price price={12800} />);
    expect(screen.getByText('NT$ 12,800')).toBeDefined();
  });

  it('should render the retail discount branch with a struck-through original price', () => {
    render(<Price price={5800} originalPrice={7200} />);
    expect(screen.getByText('NT$ 7,200')).toBeDefined();
    expect(screen.getByText('NT$ 5,800')).toBeDefined();
  });

  it('should render the dealer branch with a tier label', () => {
    render(<Price price={4800} originalPrice={6000} tierLabel="P價" />);
    expect(screen.getByText('P價')).toBeDefined();
  });
});

/**
 * 🔴🔴 **「NT$ 0」守門** —— 拿不到價格時**拒絕變成一個數字**。
 *
 * 起因:`lib/catalog-page.ts:64` `price: row.price_general ?? 0`,
 * 而 `price_general` 型別為 `number | null`(產生檔 `database.types.ts:2908`)
 * ⇒ **「查不到價格」會被印成「免費」**,對象是客人,而客人不會抱怨。
 *
 * ⚠️ **本組測試【不】證明「NT$ 0 不會再出現在顧客站」** ——
 *   `ProductInfo.tsx:243` / `ProductPage.tsx:324` / `account/tabs/FavoritesTab.tsx:66`
 *   各自有自己的 `NT$ {x.toLocaleString()}`,**本元件的守門對它們無效**。
 *   它證明的是:**這一個元件**在拿到 0/null/NaN 時不會印出一個價格。
 *
 * 🔴 **突變證明(2026-08-25 實跑,不是「看起來會紅」)**:
 *   把 `isRenderablePrice` 的 `v > 0` 改成 `v >= 0`
 *   ⇒ 下面「0 元」那格**紅**、其餘全綠 ⇒ 本組不是在斷言已經為真的東西。
 */
describe('Price:拿不到價格時不得印出價格', () => {
  // 🔴 這些值走的是不同來路,但終點相同:它們都**不是一個可以收錢的價格**。
  //   `0`        = 上游 `?? 0` 造出來的假值(本案主因)
  //   `null`     = 上游老實承認拿不到
  //   `undefined`= 型別上已擋掉,但 runtime 仍可能溜進來(JS 呼叫端 / 反序列化)
  //   `NaN`      = 算出來的價格壞掉(例:某個 undefined 進了算式)
  //   `Infinity` = 🔴 **codex R1 補的**:它 `> 0` 為真 ⇒ **只有 `Number.isFinite` 那層擋得住**。
  //                沒有這一格,拿掉 `Number.isFinite` 其餘全綠 ⇒ 那層等於沒受測。
  //   `-1`       = 負價,任何情況都不該印給客人
  const notAPrice: Array<[string, number | null | undefined]> = [
    ['0 元(上游 `?? 0` 造的假值)', 0],
    ['null', null],
    ['undefined(型別已擋、守 runtime)', undefined],
    ['NaN', Number.NaN],
    ['Infinity(只有 Number.isFinite 擋得住)', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['負數', -1],
    // 🔴 codex 連兩輪判 must-fix 才加的:本 repo 金額規則是「整數元位」
    //   ⇒ 小數價格**本身就違反規則**,不是一個該照樣印給客人的價格。
    //   這兩格是 `Number.isInteger` 那層唯一的測試 —— 拿掉那層,只有它們會紅。
    ['小數 0.001(違反「整數元位」)', 0.001],
    ['小數 1234.5(第一版曾把它當成合法價格背書)', 1234.5],
  ];

  it.each(notAPrice)('❌ %s ⇒ 畫面上不得留下任何數字,只能是 —', (_label, value) => {
    // 🔴 codex R1 must-fix:第一版只斷言「不含 `NT$`」⇒ 改印 `$0` / `0 元` 照樣全綠,
    //   **標題宣稱的比斷言驗到的寬**。改成釘死渲染結果:整個元件的文字**恰好等於** `—`。
    const { container } = render(<Price price={value as number | null} />);
    const text = (container.textContent ?? '').trim();
    expect(
      text,
      `🔴 \`price=${String(value)}\` 印出了「${text}」—— 客人會把它當成一個真的價格`,
    ).toBe('—');
    expect(text, '🔴 畫面上還留著數字 —— 任何數字都可能被讀成金額').not.toMatch(/\d/);
  });

  it('🟡 `aria-label="價格未提供"` 這個屬性有掛在那個 — 上面', () => {
    // 🔴🔴 **這格的宣稱只到「屬性存在」為止,不要再讀寬。**
    //   codex R2 逐字:「`getByLabelText` 只能證明查得到 `aria-label`,
    //   不能證明一般 `span` 得到可靠語意。」**它是對的,標題已照這句改窄。**
    //   ⇒ 一般 `span` 沒有 role,各家螢幕閱讀器對它上面的 `aria-label` 支援不一致;
    //     **真實 AT 會不會唸出來,我沒有量過,而 jsdom 也量不出來。**
    //   📌 這個狀態要長什麼樣、要唸什麼,是 Sean 的板(design 稿對此狀態 0 命中)——**尚未拍**。
    render(<Price price={null} />);
    screen.getByLabelText('價格未提供');
  });

  // 🔴 同一個病的**第二個出口**:原判斷是 `originalPrice !== null`,而 `0` 通得過。
  //   codex R1:第一版只測 0 ⇒ 撐不起註解說的「同一把尺一起收」。逐值測。
  it.each([
    ['0', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['負數', -1],
    ['null', null],
  ] as Array<[string, number | null]>)(
    '❌ 經銷分支 originalPrice=%s ⇒ 不得印出劃掉的假原價,而本人的價要照印',
    (_label, orig) => {
      const { container } = render(<Price price={4800} originalPrice={orig} tierLabel="P價" />);
      const text = container.textContent ?? '';
      expect(text, `🔴 originalPrice=${String(orig)} 被印成了原價:「${text}」`).toBe(
        'NT$ 4,800P價',
      );
    },
  );

  /**
   * 🟢🟢 **對照的另一半:該綠真的綠。**
   * 主視窗 2026-08-25 逐字:「② 該綠真的綠(正常價格不得被誤擋)—— **這半今天全隊壞過四次**」。
   * 一道**永遠回 `—`** 的守門會讓上面每一格都通過,而顧客站的價格全部消失。
   */
  // 🔴 codex R1 抓到:第一版把四個正常價格塞進**同一個 `it`** ⇒ 恆假突變在第一個就中止,
  //   後三個根本沒跑過 ⇒ 「6 格紅」證明不了那四格【各自】有突變殺傷力。改 `it.each`,一格一發。
  //   ⚠️ **`1234.5` 已從本清單移除,並移到上面的「不是價格」那一組** ——
  //      第一版把它寫成「合法的新台幣價格」,而本 repo 規則寫著金額是**整數元位**
  //      (CLAUDE.md Server 端鐵則)。**我當時是在替一個違反自家規則的值背書。**
  it.each([
    [1, 'NT$ 1'], // 邊界:剛好通過 `> 0`
    [12800, 'NT$ 12,800'],
    [98000, 'NT$ 98,000'],
    [Number.MAX_SAFE_INTEGER, `NT$ ${Number.MAX_SAFE_INTEGER.toLocaleString()}`],
  ] as Array<[number, string]>)('🟢 正常價格 %s 不得被誤擋', (value, expected) => {
    render(<Price price={value} />);
    expect(
      screen.queryByText('—'),
      `🔴 \`price=${value}\` 被守門擋掉了 —— 誤擋比漏擋更糟:客人看不到價格,而沒有人會來報修`,
    ).toBeNull();
    screen.getByText(expected); // getByText 找不到即拋;不再多接 toBeDefined(codex R1 nit)
  });

  it.each([
    ['經銷', <Price key="d" price={4800} originalPrice={6000} tierLabel="P價" />, 'NT$ 6,000'],
    ['折扣', <Price key="s" price={5800} originalPrice={7200} showSavedTag />, '省 NT$ 1,400'],
    ['純價', <Price key="p" price={12800} />, 'NT$ 12,800'],
  ] as Array<[string, React.ReactElement, string]>)(
    '🟢 既有 %s 分支不得回歸',
    (_label, element, expected) => {
      render(element);
      screen.getByText(expected);
    },
  );
});
