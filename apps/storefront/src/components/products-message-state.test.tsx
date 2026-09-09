// @vitest-environment jsdom
// products-message-state.test.tsx — 訊息態的兩件事:
//   ① 車款讀不到那句話【只有一個定義點】(複製成兩份會分岔, 而分岔不會紅)
//   ② `VehicleTaxonomyNotice` 只在 `failed` 為真時說話
//
// 🔴 **①【不是潔癖】** —— `packages/domain/src/catalog/supplier-placeholder.ts` 檔頭
//    逐字警告過「複製成兩份 ⇒ 它們會分岔, 而分岔不會紅」。四處共用一句話, 正是那個形狀。
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  BRAND_TAXONOMY_UNAVAILABLE,
  FACET_COUNTS_UNAVAILABLE,
  CATEGORY_TAXONOMY_UNAVAILABLE,
  VEHICLE_TAXONOMY_UNAVAILABLE,
  VehicleTaxonomyNotice,
  SearchAllResultsLink,
  originalSearchQueryFor,
} from './products-message-state';

afterEach(cleanup);

describe('車款讀不到那句話 · 單一定義點(⟦search-TAXONOMYTIMEOUT⟧)', () => {
  // 🔴 **用 `git grep -l` 數【檔】不是數行** —— 同一支檔裡出現兩次仍是一個定義點。
  // 🛑 **排除 `.test.` 是【必要的】而且要講明**:本檔自己就含那個字面
  //    ⇒ 不排除的話這一格會被自己的存在弄紅, 而那個紅什麼都沒證明。
  const nonTestFilesContaining = (literal: string): string[] => {
    let out: string;
    try {
      out = execFileSync('git', ['grep', '-l', '--', literal, 'apps', 'packages'], {
        encoding: 'utf8',
      });
    } catch (err) {
      // 🔴🔴 **`git grep` 查無時 rc=1** —— 而「查無」是本函式的**正常回答之一**, 不是故障。
      //   ⛔ ~~初版把負對照寫成 `expect(...).toThrow()`~~ ⇒ 🔴 **那個綠只在【這支檔還沒被 git 追蹤】的世界成立**:
      //     負對照那個現造字面**住在這支檔自己裡**, `git add` 之後 `git grep` 就命中它 ⇒ 不再 throw ⇒ **那一格落地即紅**。
      //     (2026-09-06 code-reviewer R1 Critical;我 commit 前量到的「紅 0」是 **add 之前**的讀數。)
      //   ✅ **修法不是換一個字面** —— 換了下一次照樣被自己追蹤。改成**認 rc**:
      //     rc=1 且 stdout 空 ⇒ 那就是「零支」;其餘 rc 才是真的壞了(例如根本不在 git 樹裡)⇒ 照樣往上丟。
      const e = err as { status?: number; stdout?: unknown };
      if (e.status === 1 && String(e.stdout ?? '') === '') return [];
      throw err;
    }
    return out.split('\n').filter((f) => f !== '' && !f.includes('.test.'));
  };

  // 🔴 三句話【各驗一次】—— 只驗車款那句的話, 另外兩句複製兩份也不會紅。
  it.each([
    ['車款', VEHICLE_TAXONOMY_UNAVAILABLE],
    ['分類', CATEGORY_TAXONOMY_UNAVAILABLE],
    ['品牌', BRAND_TAXONOMY_UNAVAILABLE],
    // 🔴 2026-09-07 ⟦search-SILENTDOORS2⟧ 第四句 —— code-reviewer nit 6:
    //   它原本【沒有】加進這三組守門 ⇒ 改一個字不會紅, 而前三句都被釘著。
    ['件數', FACET_COUNTS_UNAVAILABLE],
  ])('🔴 %s 那句:非測試檔裡只有一支含它, 而它就是定義處', (_名, 字面) => {
    expect(nonTestFilesContaining(字面)).toEqual([
      'apps/storefront/src/components/products-message-state.tsx',
    ]);
  });

  it('🔵 四句話彼此不同(否則上面那幾格會在「句子一樣」時一起假綠)', () => {
    const set = new Set([
      VEHICLE_TAXONOMY_UNAVAILABLE,
      CATEGORY_TAXONOMY_UNAVAILABLE,
      BRAND_TAXONOMY_UNAVAILABLE,
      FACET_COUNTS_UNAVAILABLE,
    ]);
    expect(set.size).toBe(4);
  });

  // 🔴🔴 **2026-09-06 R3(codex `gpt-5.6-sol`)must-fix**:上面那幾格都只比【前綴】或【子字串】
  //   ⇒ 📌 **把尾巴改成錯字(「請稍後再詩」)全部照樣綠** —— 而那是客人唯一會看到的東西。
  //   ✅ 這一格把三句話**逐字釘死**。期望值是**手打在測試裡的字面**, 不是 import 進來的常數
  //      —— 拿常數比常數是恆真的(`account-profile-copy.test.ts:8` 檔頭記過同一個病)。
  it('🔴🔴 三句話【逐字】釘死(改一個字 ⇒ 本格紅)', () => {
    expect(VEHICLE_TAXONOMY_UNAVAILABLE).toBe('車款清單暫時無法載入,請稍後再試或改用自行輸入');
    expect(CATEGORY_TAXONOMY_UNAVAILABLE).toBe('分類清單暫時無法載入,請稍後再試');
    expect(BRAND_TAXONOMY_UNAVAILABLE).toBe('品牌清單暫時無法載入,請稍後再試');
    // 🔴 第四句刻意與上面三句【不同形狀】:上面是「清單載不到」(整區沒東西),
    //   這一句是「清單在、只是每個項目後面的數字沒了」⇒ 說成「清單無法載入」會嚇到客人。
    // 🔴🔴 **而它【只講量到的那一件】** —— ⛔ ~~`'件數暫時無法顯示,分類與品牌仍可正常篩選'`~~
    //   後半那句在**三扇同壞**時是**假的**(三扇共用同一個 Supabase)⇒ 客人會同時讀到
    //   「分類清單暫時無法載入」與「分類仍可正常篩選」⇒ 主視窗 2026-09-07 裁「拿掉」。
    //   🛑 **本格就是那個決定的守門**:把那半句加回去 ⇒ 這裡紅。
    expect(FACET_COUNTS_UNAVAILABLE).toBe('件數暫時無法顯示');
  });

  // 🔵 **R3 nit**:刪掉 `style={MESSAGE_STATE_STYLE}` 之前所有格子都還是綠的。
  //   而那組樣式**不是我發明的** —— 它逐字等於 OD 稿 `pcm-home-redesign/products-list-page.html`
  //   的 `#pp-error`(見 `products-message-state.tsx` 的 JSDoc)⇒ 這一格守的是**鐵則 1**:
  //   期望值是**稿上那四個值手打**, 改樣式就等於偏離稿, 必須有人看見。
  it('🔵 那句話的樣式要等於 OD 稿 `#pp-error` 那四個值(拔掉 style ⇒ 本格紅)', () => {
    render(<VehicleTaxonomyNotice failed />);
    const el = screen.getByRole('alert');
    // ⚠️ **`0` 讀回來是 `0px`** —— 稿上與 `MESSAGE_STATE_STYLE` 都寫 `64px 0`,
    //    而 CSSOM 會正規化。這是**量具的讀數**, 不是值變了(實測 2026-09-06)。
    expect(el.style.padding).toBe('64px 0px');
    expect(el.style.textAlign).toBe('center');
    expect(el.style.color).toBe('var(--c-text-3)');
    // ⚠️ 同上, CSSOM 把 `14px/1.6` 正規化成 `14px / 1.6`(空格)。
    expect(el.style.font).toBe('14px / 1.6 system-ui, sans-serif');
  });

  it('🔴 分類/品牌那兩句【不得】帶「自行輸入」的尾巴', () => {
    // 🛑 車款那句尾巴是「或改用自行輸入」, 因為帳號那邊真的有自由輸入車款那條路;
    //    而分類與品牌【沒有】—— 照抄那個尾巴就是告訴客人一條不存在的路。
    expect(CATEGORY_TAXONOMY_UNAVAILABLE).not.toContain('自行輸入');
    expect(BRAND_TAXONOMY_UNAVAILABLE).not.toContain('自行輸入');
    // 🟢 正對照:車款那句【要】有它, 否則上面兩格用一個空字串也會過
    expect(VEHICLE_TAXONOMY_UNAVAILABLE).toContain('自行輸入');
  });

  it('🟢 正對照:這把尺會動 —— 拿一個【確定散落多處】的字面去問, 要回多支', () => {
    // `motoBrands` 這個識別字在多支非測試檔裡都有 ⇒ 若尺壞了(恆回 1 支)這一格會紅。
    expect(nonTestFilesContaining('motoBrands').length).toBeGreaterThan(3);
  });

  it('🔵 負對照:一個【全 repo 都沒有】的現造字面 ⇒ 零支', () => {
    // 🛑 這個字面**組出來、不寫成完整字面**, 否則它會被自己這一行追蹤到(見上面那段訃聞)。
    expect(nonTestFilesContaining(['zq', 'Taxonomy', 'Nope', 'XY9'].join(''))).toEqual([]);
  });

  it('🔵 第二個負對照:一個【只住在測試檔裡】的字面 ⇒ 也是零支(證明 .test. 那道過濾在動)', () => {
    // 🔴 這一格與上一格**不是同一件事**:上一格證「查無 ⇒ 零支」, 這一格證「有而在測試檔 ⇒ 仍是零支」。
    //   少了它, 把 `.test.` 過濾拿掉時上一格照樣綠。
    expect(nonTestFilesContaining('第二個負對照:一個【只住在測試檔裡】的字面')).toEqual([]);
  });
});

describe('VehicleTaxonomyNotice · 讀不到與真的沒有是兩種東西', () => {
  it('failed=true ⇒ 說話, 而且是 role="alert"', () => {
    render(<VehicleTaxonomyNotice failed />);
    expect(screen.getByRole('alert').textContent).toBe(VEHICLE_TAXONOMY_UNAVAILABLE);
  });

  it('🔵 負對照:failed=false ⇒ 什麼都不畫(這才是「真的沒有」那一態)', () => {
    const { container } = render(<VehicleTaxonomyNotice failed={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('🔵 負對照:連 prop 都沒給 ⇒ 什麼都不畫(舊呼叫端零改動)', () => {
    const { container } = render(<VehicleTaxonomyNotice />);
    expect(container.innerHTML).toBe('');
  });
});

describe('⟦Q47 甲⟧「查看全部搜尋結果」那一行 —— 兩個世界要看得出差', () => {
  // 🔴 **兩個世界**:命中分類而轉址過來的詞 ⇒ 有那一行;沒轉址(料號)⇒ 整行不存在。
  //    判準是 `q0` 在不在。⛔ ~~而 `q0` 只有轉址那條路會寫。~~
  //    🔴 **2026-09-08 訂正:`q0` 有【三】個產生點**(⛔ ~~兩個~~ —— R2 抓到我沒跟上)—— 轉址那條路(`page.tsx` 的 `next.set('q0', …)`)與
  //       刪 `search` 那兩格(`use-catalog-filter-url-sync.tsx` 點 facet ·
  //       `products-url-state.tsx` 的 `useBrowseUrlSync` 改排序), 合稱 ⟦搜尋-關鍵字消失無聲⟧。
  //       ⇒ 「沒有 q0」今天的意思是「**三條路都沒寫過它**」, 不是「沒轉址」。
  it('沒有 q0(料號那種不轉址的詞)⇒ 整行不渲染', () => {
    const { container } = render(<SearchAllResultsLink originalQuery={null} total={123} />);
    expect(container.textContent).toBe('');
    // 🛑 連結也不能有 —— 只檢查文字的話, 一個空字的 <a> 會漏掉。
    expect(container.querySelector('a')).toBeNull();
  });

  it('有 q0 而數字還沒回來 ⇒ 顯示【沒有數字】那一版, 不是 0', () => {
    render(<SearchAllResultsLink originalQuery="煞車" total={null} />);
    // 🔴 這一條就是「一個代表沒有的值」那族的守門:出現 `0` 就是回歸。
    expect(screen.getByRole('link').textContent).toBe('查看全部搜尋結果 →');
    expect(screen.getByRole('link').textContent).not.toContain('0');
  });

  // 🔴🔴 ⟦search-MODELNICKNAME⟧ 2026-09-09:**數字是 0 ⇒ 整行不畫**。
  //   🔬 病是在瀏覽器上看到的:打 `rsv4` ⇒ 帶 Aprilia 膠囊 ⇒ 這一行畫成「查看全部 **0** 筆搜尋結果 →」,
  //     而 `rsv4` 真的不在任何商品標題裡 ⇒ 📌 那個 0 是真的, 而它指向一個真的空頁 = 一條看得見的死路。
  //   ✅ 本檔上方那段自己就把「查看全部 0 筆」點名為不准畫的形狀 —— 這一格把那條規矩補完。
  it('數字回來是 0 ⇒ 整行不渲染(不畫一條通往空頁的死路)', () => {
    const { container } = render(<SearchAllResultsLink originalQuery="rsv4" total={0} />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('a')).toBeNull();
  });

  // 🟢 正對照:`null`(還沒數到)**仍然要畫** —— 少了這格,「total 不是正數就不畫」也會綠,
  //    而那會讓客人在數字回來之前完全沒有回頭路。上面那格已經釘了字面, 這裡釘的是**它有出現**。
  it('🔵 total 還是 null(沒數到)⇒ 照舊要畫, 不得被 0 那條規矩順手收掉', () => {
    render(<SearchAllResultsLink originalQuery="rsv4" total={null} />);
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('有 q0 且數字回來了 ⇒ 字面照稿 `查看全部 N 筆搜尋結果 →`', () => {
    render(<SearchAllResultsLink originalQuery="煞車" total={2560} />);
    // 🔴 **字面是稿上的 `查看全部`(鐵則 1), 不是 Sean 口語的「看全部」** ——
    //    `design-reference/components/HomePage.jsx:172` 逐字 `查看全部 11 類`。
    expect(screen.getByRole('link').textContent).toBe('查看全部 2560 筆搜尋結果 →');
  });

  // 🔴🔴 **[2026-09-08 訂正標題 —— 主視窗 A 判 nit, 同顆 commit 順手改]**
  //    ⛔ 舊標題 ~~「落地頁(search 與 q0 同時在)⇒ 那一行【不該再出現】—— 否則它指向自己」~~
  //    🛑 **那個標題宣稱進了一個它沒進去的世界** —— 本格傳的是**寫死的 `originalQuery={null}`**,
  //       它**從來沒有構造過** `?search=詞&q0=詞` 那個網址。
  //    🔴 **而危險在於「只有標題會出現在測試報告的那一行」** ——
  //       下一個人來找「誰在守 search 與 q0 同時在」, 會先撞到這個看起來對的標題, **然後停止找**。
  //       📌 (誠實的那半原本住在下面的註解裡, 而**沒有人會讀到那裡**。)
  //    ✅ **真正守那個決策的是本檔 `describe('⟦Q47 甲⟧ 判準:q0 在【而 search 不在】才畫')` 那一組**,
  //       特別是「🔴 落地頁 ?search=詞&q0=詞 ⇒ null」那一格 —— 它餵真的網址給 `originalSearchQueryFor`。
  //       🔬 **量到的**:突變 `originalSearchQueryFor` 拿掉 `if (params.get('search') !== null) return null;`
  //       ⇒ **只紅 1 格, 就是那一格**(本格 48 個世界全綠)⇒ **覆蓋沒有洞, 壞的只有標題。**
  it('元件合約:`originalQuery` 傳 null ⇒ 整行不渲染(呼叫端算得對不對由 ⟦Q47 甲⟧ 那組守)', () => {
    // 🔴 code-reviewer must-fix 2:判準不是「q0 在不在」, 是「q0 在【而 search 不在】」。
    //    這一格守的是元件的合約:呼叫端把 `originalQuery` 傳 null 時整行消失。
    //    (「呼叫端算得對不對」由 ProductsPage 那一側的條件與這一條一起守。)
    const { container } = render(<SearchAllResultsLink originalQuery={null} total={2560} />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('連結要帶 q0 回去 —— 少了它會被再轉址一次(無窮來回)', () => {
    render(<SearchAllResultsLink originalQuery="煞車" total={null} />);
    const href = screen.getByRole('link').getAttribute('href') ?? '';
    // 🔴 **這一條是本片的突變靶**:把 `page.tsx` 的 `next.set('q0', …)` 拿掉,
    //    或把這裡的 `&q0=` 拿掉 ⇒ 這一格必須紅。
    expect(href).toContain('search=');
    expect(href).toContain('q0=');
    // 🛑 詞要編碼過 —— 中文直接塞進 URL 是另一種壞法。
    expect(href).toContain(encodeURIComponent('煞車'));
  });
});

describe('⟦Q47 甲⟧ 判準:q0 在【而 search 不在】才畫(code-reviewer must-fix 2)', () => {
  const P = (s: string) => new URLSearchParams(s);

  it('🔴 落地頁 ?search=詞&q0=詞 ⇒ null(否則那一行指向自己)', () => {
    expect(originalSearchQueryFor(P('search=%E7%85%9E%E8%BB%8A&q0=%E7%85%9E%E8%BB%8A'))).toBeNull();
  });

  it('🟢 被轉過來的分類頁 ?categories=…&q0=詞 ⇒ 回原詞', () => {
    expect(originalSearchQueryFor(P('categories=x&q0=%E7%85%9E%E8%BB%8A'))).toBe('煞車');
  });

  it('🔴 ?q0=%20%20(只有空白)⇒ null —— 否則會畫出「查看全部 0 筆」那個假 0', () => {
    expect(originalSearchQueryFor(P('q0=%20%20'))).toBeNull();
  });

  it('🟢 沒有 q0(料號那種不轉址的詞)⇒ null', () => {
    expect(originalSearchQueryFor(P('search=AZ203'))).toBeNull();
    expect(originalSearchQueryFor(P(''))).toBeNull();
  });
});
