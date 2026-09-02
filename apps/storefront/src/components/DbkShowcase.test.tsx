// @vitest-environment jsdom
//
// DbkShowcase smoke test — 上架第 19 家 N°01 + N°02(2026-09-03)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 影片 facade(點擊前不載 iframe、點擊後才載)
// + 故事兩段 + 信任狀四格(逐格釘官網字面)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { DbkShowcase } from './DbkShowcase';

afterEach(cleanup);

describe('DbkShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<DbkShowcase />);
    expect(document.querySelector('#pd-h-dbk01')).not.toBeNull();
    expect(screen.getByAltText('DBK SPECIAL PARTS')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 DBK' })).toBeDefined();
    expect(screen.getByText(/義大利波隆那近郊的自有工廠/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '從 Ducati 開始，不止於 Ducati' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '透明離合器外蓋是他們帶起來的' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '三軸與五軸，都在自家廠裡' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:故事兩段 + 信任狀四格(pd-bs 共用骨架)', () => {
    render(<DbkShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '設計、製造、銷售，在同一個總部' })).toBeDefined();
    expect(screen.getByText('把看不見的那一半打開')).toBeDefined();
    expect(screen.getByText('外觀相近，不代表孔位相同')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });

  // 🔴 **facade 的重點是【點擊前不載 iframe】** —— 只斷言「點完有 iframe」會在
  //    「一開始就直接放 iframe」那個世界裡照樣綠 ⇒ 兩個世界要分別問一次。
  it('🔴 影片 facade:點擊前【沒有】iframe、點擊後才有,且 src 帶正確的 YouTube ID', () => {
    render(<DbkShowcase />);
    expect(document.querySelector('iframe'), '點擊前就有 iframe ⇒ facade 沒作用, 白載一支 YouTube').toBeNull();
    const facade = screen.getByRole('button', { name: '播放 DBK Special Parts 官方形象影片' });
    expect(document.querySelector('.pd-bona-video-thumb')?.getAttribute('src')).toBe(
      '/brands/dbk/video-thumb.jpg',
    );
    fireEvent.click(facade);
    const frame = document.querySelector('iframe');
    expect(frame, '點擊後仍沒有 iframe ⇒ facade 點不開').not.toBeNull();
    // 🟡 ID 釘死:換掉這支影片的人會被迫在這裡留下痕跡(官網首頁 2026-09-03 實見同一支)
    expect(frame?.getAttribute('src')).toContain('HmESGjFkVPw');
  });

  it('🔴 信任狀四格逐格釘死字面(官網當場查證值;改動 = 對外可見的事實變更)', () => {
    render(<DbkShowcase />);
    // 四格佐證全部來自 dbkspecialparts.com/en/content/6-about-us(2026-09-03 live fetch, HTTP 200)
    //   "The factory, which has over 2600 square meters"
    expect(screen.getByText('2600 m²')).toBeDefined();
    expect(screen.getByText('over 2600 square meters')).toBeDefined();
    //   "highly qualified personnel manage operations on 3 and 5 axis equipment"
    expect(screen.getByText('3 + 5')).toBeDefined();
    expect(screen.getByText('3 and 5 axis equipment')).toBeDefined();
    //   "since 2014, creating an headquarter with more than 22 employees"
    // 🔴 `22+` 拆成兩個節點(數字 + `pd-bs-stat-plus` 的 `+`, 同 Akrapovic 等 7 個前例)
    //    ⇒ 用整格 textContent 問, 而不是 getByText 單一節點。
    //    🟢 同時釘住那個 `+` 真的掛著縮小 class —— 少了它「+」會以全尺寸印, 而沒有東西會紅。
    const staffStat = [...document.querySelectorAll('.pd-bs-stat')].find((el) =>
      el.textContent?.includes('名員工'),
    );
    expect(staffStat?.querySelector('.pd-bs-stat-n')?.textContent).toBe('22+');
    expect(staffStat?.querySelector('.pd-bs-stat-plus')?.textContent).toBe('+');
    expect(screen.getByText('2014 年起的自有總部')).toBeDefined();
    //   "All DBK's products are 100% Made in Italy by our company."
    expect(screen.getByText('100%')).toBeDefined();
    expect(screen.getByText('Made in Italy by our company')).toBeDefined();
  });

  // 🔴 **本格 2026-09-03 由黑名單改白名單(R1 F4)。**
  //   ~~原版:`not.toContain('1999')` + `not.toContain('2009')`~~ ⇒ **它漏掉第四個年份**:
  //   `mock-brands.ts:22` 的 `since: 2008` —— 正好是那兩項黑名單沒列到的那一個。
  //   🎯 **黑名單永遠在跟【下一個沒想到的值】賽跑**,而它漏掉時印的是綠
  //   (同 CLAUDE.md §Git 紀律 token 前綴那條:黑名單擋不住沒列的前綴 ⇒ 改成釘住允許的完整形狀)。
  //   ⇒ 改問「四格裡的四位數年份**只准是 2014 這一個**」—— 不論日後冒出來的是 1999 / 2009 / 2008
  //     還是還沒有人寫過的第五個,它都會紅。
  it('🛑 四格裡的年份【白名單】:只准出現 2014 —— repo 裡有四個互不相容的 DBK 年份', () => {
    render(<DbkShowcase />);
    const stats = document.querySelector('.pd-bs-stats')?.textContent ?? '';
    const years = stats.match(/\b(?:19|20)\d{2}\b/g) ?? [];
    // 🟢 這一格同時是正對照:2014 真的在四格裡 ⇒ 尺抓得到年份、不是恆空
    //    (若它回 [] 就表示尺根本沒接上,而那會讓上面那個 not-contain 式的斷言恆真)
    expect(years, '四格出現了 2014 以外的年份 ⇒ 有人把 1999/2009/2008 搬進來湊數字了').toEqual([
      '2014',
    ]);
  });
});
