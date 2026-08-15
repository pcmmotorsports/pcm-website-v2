import { describe, expect, it } from 'vitest';

import { buildNavItems } from './nav-items';

// nav-items.test.ts — `#27` D1c-1:**旗標真的把那一項濾掉了嗎。**
//
// 🔴 **本檔與 `app-sidebar.test.ts` 是兩件事,不是重複**:
//   · `app-sidebar.test.ts` = **字面層**,看守「清單沒被偷改/偷刪」——
//     但它對 feature flag **恆綠**(旗標關掉時字面一個字都不會少),該檔 `:22-28` 自己列了這條。
//   · **本檔 = 行為層**,看守「關的時候真的沒有、開的時候真的有」。
//   ⇒ 刪掉本檔 ⇒ 旗標在側欄那側**零覆蓋**;刪掉那檔 ⇒ 有人偷改 href 沒人知道。**各擋各的。**
//
// ⚠️ 本檔**刻意不重複斷言整份清單** —— 那是 `app-sidebar.test.ts` 的職能,兩邊都寫等於
//   日後加一項 nav 要改兩處,而漏改一處的症狀是「假綠或假紅」。**一件事一個守門。**

const keysOf = (auditEnabled: boolean) => buildNavItems(auditEnabled).map((item) => item.key);

describe('buildNavItems:稽核入口受旗標控制', () => {
  it('🔴 旗標關 ⇒ 清單裡沒有稽核那一項(這是本片的主守門)', () => {
    expect(keysOf(false)).not.toContain('audit');
  });

  it('🔴 旗標開 ⇒ 稽核那一項出現(正向對照:證明上一條不是恆真)', () => {
    // 沒有這一條,把 `buildNavItems` 改成 `return BASE_NAV_ITEMS`(旗標完全失效、入口永遠不出現)
    // 上面那格照樣綠 —— 那正是「功能做完了但員工看不到」的形狀。
    expect(keysOf(true)).toContain('audit');
  });

  it('🔴 開關之間**只差**稽核那一項(不得順手動到其他項)', () => {
    // 負向對照的另一半:上面兩條只看 'audit' 在不在,對「旗標開啟時順手把別項濾掉」完全看不見。
    expect(keysOf(true)).toEqual([...keysOf(false), 'audit']);
  });

  it('稽核那一項的 href 與標籤(換字時本行要一起改,那是刻意的)', () => {
    const audit = buildNavItems(true).find((item) => item.key === 'audit');
    expect(audit?.href).toBe('/settings/audit');
    // 🔴 **「操作紀錄」是 Sean 2026-08-15 拍板的字**(`Q-選單名 = 乙`),不是暫定值。
    //    ⚠️ **內部一律 audit、只有畫面上這幾個字不是** —— 這是刻意的,不是漏改
    //    (理由見 `nav-items.ts` 該項的 docstring)。
    //    ⇒ **本行會紅 = 有人順手把畫面文案「統一」回內部語彙**,而那違反 Sean 自己的準則。
    expect(audit?.label).toBe('操作紀錄');
  });

  it('每一項都要有 icon 鍵(存字串鍵之後,打錯字不會在型別層以外的地方現形)', () => {
    // `icon: 'clcok'` 這種打錯在 `Icons[item.icon]` 會拿到 `undefined` ⇒ **render 當下才炸**。
    // 型別層擋得住(`keyof typeof Icons`),但本行讓「有人加了一項卻忘了 icon」在測試層也紅。
    for (const item of buildNavItems(true)) {
      expect(item.icon, `nav 項 ${item.key} 缺 icon`).toBeTruthy();
    }
  });
});
