// @vitest-environment jsdom
//
// ComingSoon smoke test — 全站重設計 第2批(/coming-soon、/stores、/install 共用元件)。
//
// 🔴 **這支守的核心是「兩個變體的差別」**,不是「畫得出來」。
//    整站版與功能版共用同一支元件,唯一分岔是 `hasNav`;而那個布林值背後是一條產品規則:
//    「站內頁要保留天地、整站上線前的唯一一頁刻意沒有」(Sean 2026-08-05 拍板兩次、
//    設計端 `coming-soon-handoff.md` 驗收 #14/#15 明列「這是刻意的,不是漏做」)。
//    ⇒ 把 `hasNav` 接反、或哪天有人「順手統一」成都有天地,只有這裡看得見。
//
// ⚠️ **它擋不住什麼**:這支只看 markup。「整站版真的沒有殼」還有一半在
//    `app/coming-soon/page.tsx`(不 import Header/HomeFooter)與 `MobileTabBar.tsx`(hidden 判定)
//    —— 前者由 `styles/coming-soon.test.ts` 的 import 面守、後者由 `MobileTabBar.test.tsx` 守。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ComingSoon } from './ComingSoon';

afterEach(cleanup);

const BASE = {
  eyebrow: 'N°06 · PARTNER STORES',
  titleLead: '新功能，',
  titleAccent: '即將上線。',
  lede: <>合作店家地圖正在整理中。</>,
  etaText: '名單整理中',
  secondaryCta: { href: '/', label: '回首頁', icon: 'home' as const },
};

const SITEWIDE = {
  ...BASE,
  eyebrow: 'PCM MOTOR PARTS ‧ 重機零件與改裝精品',
  titleLead: '新網站，',
  etaText: '最後整備中',
  secondaryCta: {
    href: 'https://www.instagram.com/pcm_officialtw/',
    label: '看最新到貨',
    icon: 'instagram' as const,
    external: true,
  },
};

describe('ComingSoon · 兩個變體的差別(這才是重點)', () => {
  it('🔴 功能版(hasNav)= 沒有主區大 logo、而且**整個頁尾都不渲染**', () => {
    const { container } = render(<ComingSoon {...BASE} hasNav />);
    // 驗收 #15:頂欄已經有一顆 logo,主區不重複。
    expect(container.querySelector('.cs-logo'), '功能版仍渲染了主區大 logo(與頂欄重複)').toBeNull();
    // 🔴 R1 must-fix:頁尾由頁面自己的 <HomeFooter> 提供。元件再渲染一份 ⇒ 門市 / 營業時間 /
    //    社群 / 版權 / 統編各出現兩次(真瀏覽器實測過)。
    expect(container.querySelector('.cs-foot'), '功能版渲染了自己的頁尾 ⇒ 會有兩個頁尾').toBeNull();
    expect(container.querySelector('.cs-base'), '功能版渲染了自己的版權列 ⇒ 會出現兩次').toBeNull();
    expect(container.querySelector('.cs-foot-nav'), '「快速前往」欄又回來了').toBeNull();
    expect(container.querySelector('.cs-page')?.className).toContain('cs-has-nav');
    // 反面:主區本身照常渲染(不是整個元件變空)。
    expect(container.querySelector('.cs-wall img'), '功能版連 logo 牆都沒了').not.toBeNull();
  });

  it('🔴 整站版(!hasNav)= 有主區大 logo + 頁尾**沒有**任何站內連結', () => {
    const { container } = render(<ComingSoon {...SITEWIDE} hasNav={false} />);
    expect(container.querySelector('.cs-logo'), '整站版少了主區大 logo').not.toBeNull();
    // 驗收 #14:那時其他頁都還沒上線,擺站內連結點了只會 404。
    expect(container.querySelector('.cs-foot-nav'), '整站版出現站內連結 ⇒ 上線前點了會 404').toBeNull();
    expect(container.querySelector('.cs-page')?.className).not.toContain('cs-has-nav');
    // 反面:整站版的頁尾**仍然**有外部社群連結(那些永遠點得到)—— 不是把整個頁尾拿掉。
    expect(container.querySelectorAll('.cs-social a').length, '整站版把社群連結也砍了').toBe(3);
  });
});

describe('ComingSoon · 品牌 logo 牆', () => {
  it('🔴 20 顆、順序與設計稿逐字相同(重排會讓錯落的呼吸失效)', () => {
    const { container } = render(<ComingSoon {...BASE} hasNav />);
    const imgs = [...container.querySelectorAll('.cs-wall img')];
    expect(imgs.length, 'logo 牆不是 20 顆').toBe(20);
    // 🔴 順序**是承重的**:`nth-child(5n+…)` 的錯落相位照這個順序算,
    //    排序或抽換順序 = 同一列同時亮起來,而那是「隱隱約約」唯一的來源。
    // `next/image` 會把 src 改寫成 `/_next/image?url=%2Fbrands-dark%2Fakrapovic.png&w=…`
    // ⇒ 先 decode 再抽 slug,不要對原字串比對(那會連「有沒有走 image 最佳化」都一起釘死)。
    const slugs = imgs.map((i) => {
      const raw = decodeURIComponent(i.getAttribute('src') ?? '');
      const m = /\/brands-dark\/([\w-]+)\.png/.exec(raw);
      expect(m, `logo 的 src 不在 /brands-dark/ 底下:${raw}`).not.toBeNull();
      return m?.[1];
    });
    expect(slugs).toEqual([
      'akrapovic', 'rizoma', 'lightech', 'evotech', 'gilles',
      'bonamici', 'cnc-racing', 'rpm-carbon', 'kineo', 'ebc',
      'gb-racing', 'motogadget', 'samco', 'eazi-grip', 'wrs',
      'dbk', 'extreme', 'materya', 'front3d', 'k-speed',
    ]);
  });

  it('🔴 牆對讀屏是純裝飾(aria-hidden + 空 alt)—— 真正的品牌資訊在 /brands', () => {
    const { container } = render(<ComingSoon {...BASE} hasNav />);
    expect(container.querySelector('.cs-wall')?.getAttribute('aria-hidden')).toBe('true');
    const alts = [...container.querySelectorAll('.cs-wall img')].map((i) => i.getAttribute('alt'));
    expect(new Set(alts), 'logo 牆的 alt 不是全空 ⇒ 讀屏會念 20 個品牌名').toEqual(new Set(['']));
  });
});

describe('ComingSoon · 字面與連結', () => {
  it('🔴 主 CTA 一律是 LINE、且是外開', () => {
    const { container } = render(<ComingSoon {...BASE} hasNav />);
    const primary = container.querySelector('.cs-btn-primary');
    expect(primary?.getAttribute('href')).toBe('https://lin.ee/R6QZUH2');
    expect(primary?.getAttribute('rel'), '外開連結少了 noopener').toContain('noopener');
  });

  it('🔴 次要 CTA:整站版外開 IG、功能版站內回首頁(且**不**加 target=_blank)', () => {
    const site = render(<ComingSoon {...SITEWIDE} hasNav={false} />);
    const siteCta = site.container.querySelector('.cs-btn-ghost');
    expect(siteCta?.getAttribute('href')).toContain('instagram.com');
    expect(siteCta?.getAttribute('target')).toBe('_blank');
    cleanup();
    const fn = render(<ComingSoon {...BASE} hasNav />);
    const fnCta = fn.container.querySelector('.cs-btn-ghost');
    expect(fnCta?.getAttribute('href')).toBe('/');
    // 站內連結開新分頁 = 客人的返回鍵失效,正是「回不去」那個問題的另一種版本。
    expect(fnCta?.getAttribute('target'), '站內的「回首頁」被開成新分頁').toBeNull();
  });

  it('🔴 沒有上線日期、沒有倒數計時器(設計端 §五-1:沒有來源就不編)', () => {
    const { container } = render(<ComingSoon {...SITEWIDE} hasNav={false} />);
    const text = container.textContent ?? '';
    expect(text, '狀態標的字面不見了').toContain('最後整備中');
    // 反面:任何看起來像日期的東西出現在這頁 = 有人編了一個沒有來源的上線日。
    expect(text, '頁面上出現了日期樣式的字面 ⇒ 那是編出來的,設計端明文不寫').not.toMatch(
      /\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/,
    );
  });

  it('🔴 統編走 site-config 的 SSoT、不是硬寫的字面(只有整站版自帶版權列)', () => {
    const { container } = render(<ComingSoon {...SITEWIDE} hasNav={false} />);
    expect(container.textContent).toContain('統一編號 90003020');
  });
});
