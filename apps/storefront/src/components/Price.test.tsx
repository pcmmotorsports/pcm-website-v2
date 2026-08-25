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
 * 🔴🔴 **「拿不到價格」守門** —— 拿不到價格時**拒絕變成一個數字**。
 *   ~~原標題是「『NT$ 0』守門」~~ ⇒ 2026-08-25 Sean 拍板之後那個名字會誤導:
 *   **`NT$ 0` 現在是贈品的合法顯示**,被擋的是 `null` / `NaN` / `Infinity` / 負數 / 小數 / `-0`。
 *
 * 起因:`lib/catalog-page.ts` 曾寫 `price: row.price_general ?? 0`,
 * 而 `price_general` 型別為 `number | null`(產生檔 `database.types.ts:2908`)
 * ⇒ **「查不到價格」會被印成「免費」**,對象是客人,而客人不會抱怨。
 * ✅ **那一行 `e31f22ae` 已經拆掉了**(改成 `?? null`)⇒ 現在 `null` 會原封走到這裡。
 *
 * ⚠️ **本組測試【不】證明「NT$ 0 不會再出現在顧客站」** ——
 *   `ProductInfo.tsx:243` / `ProductPage.tsx:324` / `account/tabs/FavoritesTab.tsx:66`
 *   各自有自己的 `NT$ {x.toLocaleString()}`,**本元件的守門對它們無效**。
 *   它證明的是:**這一個元件**在拿到 `null`/`NaN`/`-0` 這類值時不會印出一個價格。
 *
 * 🔴 **突變證明(2026-08-25 片B 實跑,不是「看起來會紅」)**:
 *   ~~把 `v > 0` 改成 `v >= 0` ⇒ 「0 元」那格紅~~ ⇒ **那是拍板前的突變, 現在 `>= 0` 才是對的。**
 *   現行雙向突變見各組標題旁的註記。
 */
describe('Price:拿不到價格時不得印出價格', () => {
  // 🔴 這些值走的是不同來路,但終點相同:它們都**不是一個可以收錢的價格**。
  //   🔴🔴 **`0` 曾經在這張表裡,2026-08-25 被搬出去了** —— 見下面「0 是合法價格」那個 describe。
  //      Sean 當天拍板:商店會有 0 元商品(贈品 / 買一送一的那個「送」/ 試用品)
  //      ⇒ **0 從「假值」變成「合法價格」。** 這張表現在**不涵蓋 0**,不要把它加回來。
  //      ⚠️ 搬的時候是照順序做的:**先只改 `Price.tsx` 的判準、一個測試都不動** ⇒ 這一格必須先紅
  //      (實際紅了,而且**紅兩格** —— 另一格是 `originalPrice=0`,那格才是拆兩支判準的理由)
  //      ⇒ 紅了才證明這張表真的在守著那個輸入。**沒紅就直接改期望值 = 什麼都沒證明。**
  //   `null`     = 上游老實承認拿不到
  //   `undefined`= 型別上已擋掉,但 runtime 仍可能溜進來(JS 呼叫端 / 反序列化)
  //   `NaN`      = 算出來的價格壞掉(例:某個 undefined 進了算式)
  //   `Infinity` = 🔴 **codex R1 補的**,而它當時附的理由**是錯的**:
  //                ~~「它 `> 0` 為真 ⇒ 只有 `Number.isFinite` 那層擋得住」~~
  //                🔴 **實測(2026-08-25 片B)**:`Number.isInteger(Infinity)` ⇒ `false`
  //                ⇒ `Number.isInteger` 就擋住它了。把 `Number.isFinite(v)` 整句拿掉
  //                ⇒ **本檔 31 格全綠, 一格都沒紅**(突變實跑, 不是推的)。
  //                ⇒ 那句自述**活過了兩輪 codex 對抗審查**, 是 codex 片B R2 才戳破的。
  //                📌 這一格本身仍然有價值(它釘住「Infinity 不得印給客人」這個行為),
  //                   **失效的是它旁邊那句「哪一層在守它」。**
  //   `-1`       = 負價,任何情況都不該印給客人
  const notAPrice: Array<[string, number | null | undefined]> = [
    ['null', null],
    ['undefined(型別已擋、守 runtime)', undefined],
    ['NaN', Number.NaN],
    ['Infinity(~~只有 Number.isFinite 擋得住~~ ⇒ 見上方訂正)', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['負數', -1],
    // 🔴 `-0` 是 `>= 0` 帶進來的**新破口**(codex 片B R1 must-fix):
    //   `Number.isFinite(-0)` / `Number.isInteger(-0)` / `-0 >= 0` 全為 true,
    //   而 **`(-0).toLocaleString()` ⇒ `"-0"`** ⇒ 畫面會印「NT$ -0」(node 實測)。
    //   舊寫法 `v > 0` 天然擋住它(`-0 > 0` 為 false)⇒ **這一格只有在 `>= 0` 之後才需要存在。**
    //   `JSON.parse('-0')` 保留 `-0` ⇒ 反序列化這條路進得來(而 `JSON.stringify(-0)` 是 `0`)。
    ['負零 -0(`>= 0` 帶進來的新破口)', -0],
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
    //   ✅ **~~「尚未拍」~~ 已失效**(codex 片B R2 nit):Sean 2026-08-25 拍了乙 ——
    //     **卡片留著、價格那格印一條槓「—」**。⇒ 這個狀態要長什麼樣**已經定了**。
    //     🔴 仍然未驗的只剩一件:**真實螢幕閱讀器會不會把那個 `aria-label` 唸出來**(jsdom 量不出來)。
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
    [1, 'NT$ 1'], // ~~「剛好通過 `> 0`」~~ ⇒ 判準已是 `>= 0`,真正的下界是 0(在下面那組)
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

describe('🔴 `0` 是合法價格(贈品)—— Sean 2026-08-25 拍板', () => {
  // ── 這一格為什麼從「假值」翻面成「合法價格」──────────────────────────
  // Q「我們會不會有 0 元的商品(贈品 / 買一送一的那個『送』/ 試用品)?」⇒ A【乙:會, 偶爾有】
  // ⇒ `0` 從 `notAPrice` 那張表搬出來, 變成這裡。落點 memory
  //   `project_0825-sean-zero-price-is-real-print-ntd-zero`。
  //
  // 🔴 判準因此拆成兩支, 而它們對【同一個值 0】要的答案相反:
  //     isRenderablePrice         `>= 0`  顯示價 ⇒ 贈品要印 NT$ 0
  //     isRenderableOriginalPrice `>  0`  劃掉的原價 ⇒ 「原價 NT$ 0」沒有意義
  //   ⇒ **同一個判準被兩個要求相反的用途共用 ⇒ 判準在說謊。**
  //
  // ⚠️ 而「查不到價格」仍然印「—」—— 那是 Sean 同一天稍晚拍的另一半(卡片留著、印一條槓)。
  //   **0 與 null 從此是兩件事;把它們黏回去的那一行已經在 `catalog-page.ts` 被拆掉了(e31f22ae)。**

  it('🔴 `0`(贈品)⇒ 要印出「NT$ 0」, 不得印成一條槓', () => {
    const { container } = render(<Price price={0} />);
    const text = (container.textContent ?? '').trim();
    // 🔴 分母守門:先確認這一發【真的渲染出東西】。
    //   一個什麼都沒渲染的 render 會讓下面兩句安靜地成立 ——
    //   「它跑了」與「它什麼都沒做」在報告裡印同一句話。
    expect(text.length, '🔴 這一發什麼都沒渲染 ⇒ 下面的斷言零判別力').toBeGreaterThan(0);
    expect(text, '🔴 贈品被印成一條槓 —— 那是 Sean 明確否決的行為').not.toBe('—');
    expect(text).toContain('NT$ 0');
  });

  it('🔴 `0` 不得誤觸「價格未提供」那個無障礙標籤', () => {
    render(<Price price={0} />);
    expect(screen.queryByLabelText('價格未提供')).toBeNull();
  });

  it('🔴 而 `originalPrice = 0` 仍然不得印出一條劃掉的「NT$ 0」(這支判準是 `> 0`)', () => {
    // 拆兩支判準的直接理由就是這一格:先只把單一判準改成 `>= 0`(測試零改動)時,
    // 它會紅 —— 而它紅的意思是「贈品的原價變成 0 元」,那不是一個客人曾經要付的金額。
    const { container } = render(<Price price={0} originalPrice={0} tierLabel="P價" />);
    const text = (container.textContent ?? '').trim();
    expect(text.length).toBeGreaterThan(0);
    expect(container.querySelector('.price-strike')).toBeNull();
    expect(text).toContain('NT$ 0'); // 本人的價要照印
  });

  it('🔴 經銷分支:originalPrice 比 price 【低】時不得劃掉它(會暗示一個不存在的折扣)', () => {
    // codex 片B R1 must-fix:isMember 那支原本只檢查「原價是個可印的數」,
    // 沒有檢查「原價 > 現價」—— 而隔壁 retail 分支的 `hasRetailDiscount` 本來就含這個比較。
    // ⇒ price=5000 / originalPrice=1000 會把**比較低的 1000** 劃掉,
    //   讀起來像「原價 1,000 → 現在 5,000」。
    const { container } = render(<Price price={5000} originalPrice={1000} tierLabel="P價" />);
    const text = (container.textContent ?? '').trim();
    expect(text.length).toBeGreaterThan(0);
    expect(container.querySelector('.price-strike')).toBeNull();
    expect(text).toContain('NT$ 5,000');
    expect(text).not.toContain('NT$ 1,000');
  });

  it('🟢 正對照:originalPrice 比 price 高 ⇒ 經銷分支照樣要劃掉它', () => {
    const { container } = render(<Price price={4800} originalPrice={6000} tierLabel="P價" />);
    expect(container.querySelector('.price-strike')).not.toBeNull();
    expect((container.textContent ?? '')).toContain('NT$ 6,000');
  });

  it('🟢 正對照:`0` 搭真原價 5000 ⇒ 原價要劃掉、省 NT$ 5,000', () => {
    const { container } = render(<Price price={0} originalPrice={5000} showSavedTag />);
    expect(container.querySelector('.price-strike')).not.toBeNull();
    expect((container.textContent ?? '')).toContain('省 NT$ 5,000');
  });
});
