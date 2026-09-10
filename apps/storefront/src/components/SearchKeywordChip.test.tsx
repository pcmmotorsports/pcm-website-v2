// @vitest-environment jsdom
// SearchKeywordChip.test.tsx — ⟦搜尋-落點換 /products⟧ 2026-09-03
//
// 🔴🔴 **這支元件的存在理由是【誠實】,所以它的測試守的也是誠實,不是版面。**
//    `/products?search=` 走的是關鍵字資料路,而**那條路吃不到 facet**。
//    沒有這顆膠囊 ⇒ 客人看到一個「篩選都排在那裡、點了卻不會變」的目錄頁 = **安靜的錯**。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SearchKeywordChip } from './SearchKeywordChip';

const push = vi.fn();
let currentParams = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams(currentParams),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  currentParams = '';
});

describe('SearchKeywordChip — 關鍵字要看得見、而且拿得掉', () => {
  it('🔵 沒有關鍵字 ⇒ 整區不畫(不要留一條空的膠囊列)', () => {
    const { container } = render(<SearchKeywordChip keyword={undefined} />);
    expect(container.textContent).toBe('');
  });

  // ── ⟦search-CAPSULEPARSE⟧ 2026-09-03:「丟掉的字要看得見」──────────────
  it('🔴🔴 有【沒用到的字】⇒ 要把那幾個字印出來', () => {
    const { container } = render(<SearchKeywordChip unmatchedWords='好看的' />);
    expect(container.textContent).toContain('好看的');
    expect(container.textContent, '沒說「沒有用到」⇒ 客人會以為它在過濾').toContain('沒有用到');
  });

  it('🔵 負對照:沒有沒用到的字, 也沒有關鍵字 ⇒ 整區不畫', () => {
    const { container } = render(
      <SearchKeywordChip keyword={undefined} unmatchedWords={undefined} />,
    );
    expect(container.textContent).toBe('');
  });

  // 🛑 兩種模式互斥 —— 有 keyword 時走關鍵字那一套(它要有 ✕ 與提示句)。
  it('🔵 有 keyword ⇒ 走關鍵字模式(有 ✕ 可按), 不是「沒用到」那一句', () => {
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    expect(container.querySelectorAll('.ac-chip')).toHaveLength(1);
    expect(container.textContent).not.toContain('沒有用到');
  });

  it('🔴 有關鍵字 ⇒ 印出那個字, 而且帶「搜尋:」前綴', () => {
    const { container } = render(<SearchKeywordChip keyword='akrapovic' />);
    // 🎯 前綴是必要的 —— 少了它, 這顆與旁邊的品牌/分類膠囊長得一模一樣,
    //    而它們的意思完全不同(那些是篩選, 這顆是**這批商品的來源**)。
    expect(container.textContent).toContain('搜尋:akrapovic');
  });

  // 🔴🔴 **[2026-09-10 · 這一格【整個反過來】—— 它守的那個世界已經不存在了]**
  //    ⛔ ~~本片的驗收核心就是這一格:那句提示要同時講出【篩選沒生效】與【他可以怎麼辦】~~
  //    🔵 **它在 `cc8a79188`(合路)之前是對的** —— 那時 facet 與關鍵字真的互斥。
  //    🔴 **而合路之後, 那句話變成假的** ⇒ 這一格就從「守著一句必要的說明」
  //      變成「**守著一句對客人說謊的話**」。
  //      ⇒ 🎯 📌 **一個測試不會因為它守的事實過期而變紅 —— 它會【繼續綠著保護那句假話】。**
  //    🔬 2026-09-10 正式站實測:`?search=carbon` 1,135 件 · 加 `&pbrands=rizoma` ⇒ **2 件**;
  //      三種排序第一筆各不同而筆數都是 1,135 ⇒ **篩選與排序兩半都有效。**
  //    ✅ 所以改成反過來釘:那兩個詞**不准再出現**。
  it('🔴🔴 那句「篩選/排序要先移除關鍵字」不准再出現 —— 合路之後它是假的', () => {
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    const text = container.textContent ?? '';
    expect(text, '那句話回來了 ⇒ 它在說一件 2026-09-10 起不成立的事').not.toMatch(
      /篩選.*排序|排序.*篩選/,
    );
    expect(text, '「移除關鍵字」那個出路也不該再提 —— 現在不用移除也能篩').not.toContain(
      '移除關鍵字才會生效',
    );
    // 🟢 **正對照:膠囊本身要還在** —— 否則「整支元件壞掉」與「只拿掉那一行」印同一個綠。
    expect(text, '連膠囊都不見了 ⇒ 拿掉的不只是那一行').toContain('搜尋:mt07');
  });

  it('🔴 ✕ 掉 ⇒ 導到同一頁但沒有 search', () => {
    currentParams = 'search=mt07&sort=price-asc';
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    fireEvent.click(container.querySelector('.ac-chip')!);
    const url = String(push.mock.calls[0]?.[0] ?? '');
    expect(url.includes('search='), '關鍵字沒被拿掉 ⇒ 這顆膠囊的 ✕ 是假的').toBe(false);
    // 🎯 而**其他參數要留著** —— 客人排好的順序不該因為拿掉關鍵字就被清空。
    expect(url).toContain('sort=price-asc');
  });

  // 🔴 分母換了, 頁碼就不是同一批東西。
  it('🔴 ✕ 掉時 page 也要一起清(關鍵字幾百件 ⇒ 全目錄兩萬多件)', () => {
    currentParams = 'search=mt07&page=3';
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    fireEvent.click(container.querySelector('.ac-chip')!);
    const url = String(push.mock.calls[0]?.[0] ?? '');
    expect(url.includes('page='), '留著第 3 頁 ⇒ 他落在一個看起來像壞掉的位置').toBe(false);
  });

  it('🔵 負對照:只有 search 一個參數 ⇒ 清掉之後是乾淨路徑, 不是留一個 ?', () => {
    currentParams = 'search=mt07';
    const { container } = render(<SearchKeywordChip keyword='mt07' />);
    fireEvent.click(container.querySelector('.ac-chip')!);
    expect(push).toHaveBeenCalledWith('/products');
  });

  // 🔴 2026-09-06 Sean 逐字拍【甲】:那行字改成「已用品牌篩選」的說法。
  //   📌 為什麼要改:舊句**是誠實的而讀起來像失敗** —— 客人打「GILLES TOOLING」結果是對的
  //      (正式站實走 50/50 全是那個品牌), 而畫面說「有幾個字沒有用到」⇒ 他以為沒搜到。
  it('🔴 有品牌名 ⇒ 講【做了什麼】:整串文案 toBe(對外字面, 不許只驗片段)', () => {
    const { container } = render(
      <SearchKeywordChip unmatchedWords="TOOLING" matchedBrandNames="GILLES TOOLING" />,
    );
    const note = container.querySelector('.ac-note');
    expect(note, '那一行不見了').not.toBeNull();
    // 🛑 **整串 toBe** —— 對外字面只驗片段的話, 改壞前半段不會紅。
    expect(note!.textContent).toBe(
      '🔍 已用品牌篩選:「GILLES TOOLING」—— 其餘的字沒有用到:「TOOLING」。',
    );
    expect(note!.textContent, '舊句還在 ⇒ 兩句並存').not.toContain('上面的篩選條件是我們認得的那部分');
  });

  // 🔴🔴 **[2026-09-08 `front`]這一句在今天之前【沒有任何測試釘著】** ——
  //   而本檔自己的慣例逐字是「**整串 toBe**(對外字面, 不許只驗片段)」。
  //   ⇒ 📌 我改它的時候才發現:**同一支檔裡, 有的對外字面被釘得死死的, 有的一格都沒有**
  //     ⇒ 而「這支檔有在驗文案」會讓人以為每一句都被驗了。
  // 🔴🔴 **[2026-09-10 · 這一格的期望值【反過來了】, 而那是因為它守的那句話被拿掉了]**
  //   ⛔ ~~期望「目前顯示「X」的關鍵字結果;篩選與排序要先移除關鍵字才會生效。」~~
  //   🔵 那句話在 `cc8a79188`(合路)之前是對的, 而合路把 facet 與關鍵字兩條路併成一條
  //     ⇒ **障礙消失, 而那句話住在另一支元件沒有跟著走** ⇒ 📌 它不是錯誤, 是【過期】。
  //   🔬 2026-09-10 正式站實測兩半都失效:`?search=carbon` 1,135 件 · 加 `&pbrands=rizoma`
  //     ⇒ **2 件**(篩選有效);三種排序第一筆各不同而筆數都是 1,135(排序有效)。
  //   🛑 **而這一格【不刪】** —— 改成釘「那一行不再出現」。理由:
  //     一個被刪掉的測試, 與一句從來沒有被驗過的文案, 在檔案上長得一模一樣。
  //     ⇒ 🎯 留著它, 下一個人才看得出「這裡曾經有一句話, 而它是【被決定拿掉的】」。
  it('🔴 只有關鍵字時【不再印那一行】—— 那句「篩選要先移除關鍵字」2026-09-10 起是假的', () => {
    const { container } = render(<SearchKeywordChip keyword="Trident 660" />);
    expect(
      container.querySelector('.ac-note'),
      '那一行又回來了 ⇒ 合路之後篩選與排序都有效, 它在對客人說假話',
    ).toBeNull();
    // 🟢 **正對照:膠囊本身要還在** —— 否則「整支元件壞掉」與「只拿掉那一行」印同一個綠。
    const chip = container.querySelector('.ac-chip');
    expect(chip, '連膠囊都不見了 ⇒ 我拿掉的不只是那一行').not.toBeNull();
    expect(chip!.textContent).toContain('Trident 660');
  });

  it('🟢 正對照:【沒有】品牌名時退回舊句(解析器認出來的可能是分類, 那時印「品牌」是假的)', () => {
    // 🛑 少了這一格,「無條件印品牌那句」會讓上面那格照樣綠 —— 而那會對分類的世界說謊。
    const { container } = render(<SearchKeywordChip unmatchedWords="TOOLING" />);
    const note = container.querySelector('.ac-note');
    expect(note!.textContent).toBe(
      '🔍 這幾個字沒有用到:「TOOLING」—— 上面的篩選條件是我們認得的那部分。',
    );
    expect(note!.textContent, '沒有品牌卻說「已用品牌篩選」= 對客人說謊').not.toContain('已用品牌篩選');
  });

  it('🔵 leftover 空掉之後那一行【整個不畫】—— 而那是對的,不是漏掉', () => {
    // 🔬 ⟦search-BRANDSLUGHYPHEN⟧ 之後,多字品牌打全名的 leftover 變成空
    //    ⇒ `unmatchedWords` 是 undefined ⇒ 本元件早退回 `null`。
    // 🛑 **主視窗預期的是「只印【已用品牌篩選:「X」】」,而實際是【整行不畫】** ——
    //    我把差異釘在這裡, 不改成他預期的那樣。理由:
    //    ✅ **沒有東西沒用到, 就沒有話要說** —— 而**品牌本身已經以膠囊的形式在畫面上**
    //       (`ActiveChips:101` 畫的)⇒ 再印一次「已用品牌篩選」是**同一件事講兩遍**。
    //    📌 那一行的存在理由是「解釋我沒用到的那些字」, 而那些字現在沒有了。
    const { container } = render(<SearchKeywordChip matchedBrandNames="CNC RACING" />);
    expect(container.querySelector('.ac-note'), 'leftover 空還印那一行 ⇒ 與膠囊重複').toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
