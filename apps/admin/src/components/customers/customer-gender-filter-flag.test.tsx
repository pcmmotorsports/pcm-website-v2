// @vitest-environment jsdom
// customer-gender-filter-flag.test.tsx — `:573` 段③ 的【部署順序閘】兩半綁在一起。
//
// ══ 🔴🔴 為什麼需要這一支(它不是「多測一次」)═══════════════════════════════
//   那顆閘有**兩半**,而它們住在不同的檔:
//     ① 顯示  `customer-filter-bar.tsx`  —— `showGender` 為 false 時不算繪那顆下拉
//     ② 查詢  `app/customers/page.tsx`   —— 旗標關時把 `filter.gender` 抹掉
//   兩邊都呼叫 `genderFilterEnabled()`,
//   🔴 **而「兩半呼叫同一支函式」不等於「兩半綁在一起」** ——
//      有人改了其中一半(例如把 `page.tsx` 那行抹除刪掉,因為「下拉都不出現了嘛」),
//      `gender-filter-flag.test.ts` 照樣全綠、typecheck 照樣綠、畫面也看不出來,
//      **直到有人手打一條 `?gender=male` 進網址 ⇒ PostgREST 42703 ⇒ 整頁炸掉。**
//   ⇒ 本支就是那條橋:**同一格裡驗兩件事。**
//
// ══ ⚠️ 本支【證不到】什麼(先讀,免得把它讀成「這條閘已經被守住了」)═══════════
//   ① 🔵 **2026-09-01 已收窄一格**:抹除那半現在呼叫**產品函式** `applyGenderGate`,
//      不再是測試自抄的副本(codex R1 must-fix)。
//      🔴 **而仍然剩一格**:有人把 `page.tsx` 裡那一句 `applyGenderGate(...)` **整行刪掉**
//      ⇒ 本支照樣全綠(它測的是那支函式,不是那個呼叫)。
//      ⇒ **那一格由 `lib/customers/gender-filter-flag.test.ts` 的原始碼掃描盯著**,
//        不是由這裡盯。📌 明寫出來,是因為「有一支測試在盯」這句話
//        比「沒有測試」更容易讓人停止檢查。
//   ② 它不驗 view 上到底有沒有 `gender` 欄 —— 那是 apply 的事,測試碰不到正式庫。

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { AdminCustomerFilter } from '@pcm/domain';
import { CustomerFilterBar } from './customer-filter-bar';
import { GENDER_PARAM } from '../../lib/customers/customer-list-view';
// 🔴 **產品那一份**,不是測試自己抄的 —— codex R1 must-fix(2026-09-01)。
import { applyGenderGate } from '../../lib/customers/gender-filter-flag';

afterEach(cleanup);

const FILTER: AdminCustomerFilter = { tier: 'general', gender: 'male' };

// ⛔ ~~上一版這裡有一支 `effectiveFilter`,自己重抄了一份 `page.tsx` 的抹除邏輯~~
//    🔴 codex R1 逐字:「刪掉正式頁面的抹除,這支仍全綠」⇒ **已改為呼叫產品那一份。**
const effectiveFilter = applyGenderGate;

function genderSelect(showGender: boolean): Element | null {
  const { container } = render(
    <CustomerFilterBar
      filter={effectiveFilter(FILTER, showGender)}
      sort={undefined}
      ageInputs={{ swapped: false }}
      showGender={showGender}
    />,
  );
  return container.querySelector(`select[name="${GENDER_PARAM}"]`);
}

describe('`:573` 段③ 部署順序閘 — 關掉時兩半都要關', () => {
  it('🔴 旗標關 ⇒ 下拉不出現 __且__ 送進查詢的 filter 不帶 gender', () => {
    expect(genderSelect(false), '旗標關而下拉還在 ⇒ 員工按得到一個會炸頁的東西').toBeNull();
    cleanup();
    expect(
      effectiveFilter(FILTER, false).gender,
      '旗標關而 filter 仍帶 gender ⇒ 手打網址就會走到 .eq(gender) ⇒ 42703',
    ).toBeUndefined();
  });

  // 🟢 正對照 —— 沒有它的話,上面那格在「這支測試根本沒 render 到東西」時也會綠。
  it('🟢 旗標開 ⇒ 下拉出現, 且三個選項齊全, 且 filter 帶得過去', () => {
    const el = genderSelect(true);
    expect(el, '旗標開而下拉不見 ⇒ 這道閘把功能整個關掉了').not.toBeNull();
    const values = [...(el?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    // 置頂那顆是「不限」(空 value), 後面三顆是代碼, 最後一顆是「未填」哨兵。
    // 🔴 **`unset` 那一格是規格要的, 不是我加的**
    //    (`docs/specs/2026-08-26-customer-gender-birthday-spec.md:86` 逐字:
    //     「後台篩選的 UI 要**分得開「未填」與「不透露」**,不要只給一個「空白」」)。
    //    ⚠️ **這一格紅的時候, 不要靠刪選項把它弄綠** —— codex R3 逐字預測過這個修法:
    //       「實作者補正產品時測試必紅, 最可能的錯誤修法是撤回正確的『未填』選項」。
    //       ⇒ 真的要改選項, 先回去讀那份規格, 並在 commit body 寫為什麼。
    expect(values).toEqual(['', 'male', 'female', 'undisclosed', 'unset']);
    expect(effectiveFilter(FILTER, true).gender).toBe('male');
  });

  // 🔵 負對照 —— 證明這把尺量得到「選了誰」, 不是只要有下拉就綠。
  it('🔵 旗標開時, 下拉的預設值就是 filter 裡那個值', () => {
    const el = genderSelect(true) as HTMLSelectElement | null;
    expect(el?.value).toBe('male');
  });
});
