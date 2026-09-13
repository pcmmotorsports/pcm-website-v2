import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const keysOf = () => buildNavItems().map((item) => item.key);

// 🏁 2026-09-14 Sean 拍 Q2 乙:操作紀錄常開,旗標退場 ⇒ 原本「旗標關 ⇒ 沒有 / 開 ⇒ 有 / 只差一項」三格改成「一定在、在最後」。
describe('buildNavItems:稽核入口常開(2026-09-14 Q2 乙)', () => {
  it('🔴 清單裡一定有稽核那一項,而且排最後(設定群組的最後一個)', () => {
    const keys = keysOf();
    expect(keys).toContain('audit');
    expect(keys[keys.length - 1]).toBe('audit');
  });

  it('🔴 旗標檔不得回來 —— 回來就是又多一道「沒設就 404」的閘', () => {
    expect(existsSync(fileURLToPath(new URL('../../lib/audit/audit-ui-flag.ts', import.meta.url)))).toBe(false);
  });

  it('稽核那一項的 href 與標籤(換字時本行要一起改,那是刻意的)', () => {
    const audit = buildNavItems().find((item) => item.key === 'audit');
    expect(audit?.href).toBe('/settings/audit');
    expect(audit?.label).toBe('操作紀錄');
  });

  it('每一項都要有 icon 鍵(存字串鍵之後,打錯字不會在型別層以外的地方現形)', () => {
    // `icon: 'clcok'` 這種打錯在 `Icons[item.icon]` 會拿到 `undefined` ⇒ **render 當下才炸**。
    // 型別層擋得住(`keyof typeof Icons`),但本行讓「有人加了一項卻忘了 icon」在測試層也紅。
    for (const item of buildNavItems()) {
      expect(item.icon, `nav 項 ${item.key} 缺 icon`).toBeTruthy();
    }
  });
});
