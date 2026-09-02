// @vitest-environment jsdom
//
// RizomaShowcase smoke test — 上架第 18 家 N°01 + N°02(2026-09-02)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 hero 影片帶(海報+不預載)+ 故事兩段 + 信任狀四格(逐格釘字面)。
// jsdom 無 IntersectionObserver → 元件內建降級(不自動播、停留海報),render 不得丟錯。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RizomaShowcase } from './RizomaShowcase';

afterEach(cleanup);

describe('RizomaShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<RizomaShowcase />);
    expect(document.querySelector('#pd-h-rizoma01')).not.toBeNull();
    expect(screen.getByAltText('RIZOMA')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 RIZOMA' })).toBeDefined();
    expect(screen.getByText(/義大利的設計取向部品廠/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '看不見的比例' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '從整塊鋁削出來' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '不只做機車' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  // 🔴 **敘述 2026-09-02 誠實降級**(`-0e` R1 F1):原本寫「品牌色 modifier」——
  //    而 `pd-bs--rizoma` 這個 class **在 `product-page.css` 裡不存在**
  //    (`grep -oE '^\.pd-bs--[a-z0-9-]+'` ⇒ 8 家, 而 tsx 用到的有 10 家;`dna` 早就一樣)。
  //    🟢 它不壞版:`:1182` `.pd-bs { --bs-accent: var(--c-text); }` ⇒ 退成一般文字色。
  //    🛑 而這一格斷言的是【class 掛上去了】, 不是【有品牌色】——
  //       **在「有品牌色」與「沒有品牌色」兩個世界裡, 它印同一個綠。**
  //    ⇒ 所以敘述改成 `class`。要不要真的給 RIZOMA 一個顏色 = **Sean 的品味題**, 不在本片。
  it('N°02:hero 影片帶 + 故事兩段 + 信任狀四格(pd-bs 共用骨架 + 品牌色 modifier class)', () => {
    render(<RizomaShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '好看是門檻，合手才是理由' })).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--rizoma')).not.toBeNull();
    const video = document.querySelector('video.pd-hero-band');
    expect(video).not.toBeNull();
    // 🟡 影片是【暫定】—— repo 裡另有 rizoma-fashion.mp4,挑哪一支是 Sean 的品味。
    //    這一格釘的不是「哪一支比較好」,是「換它的人會被迫在這裡留下痕跡」。
    expect(video?.getAttribute('src')).toBe('/brands/rizoma/hero.mp4');
    expect(video?.getAttribute('poster')).toBe('/brands/rizoma/hero-poster.jpg');
    expect(video?.getAttribute('preload')).toBe('none');
    expect(screen.getByText('讓它自然到你回不去')).toBeDefined();
    expect(screen.getByText('同一套做法，換一種車')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });

  it('🔴 信任狀四格逐格釘死字面(官網當場查證值;改動 = 對外可見的事實變更)', () => {
    render(<RizomaShowcase />);
    // Billet / ricavato dal pieno — cycle.rizoma.com 逐字
    //   "Corpo in alluminio ricavato dal pieno e struttura resistente, precisa e a peso ridotto."
    expect(screen.getByText('Billet')).toBeDefined();
    expect(screen.getByText('ricavato dal pieno')).toBeDefined();
    // Zeiss® — 同頁逐字 "Lente ottica ultraleggera con tecnologia Zeiss® … Infrangibile, antitaglio, afocale"
    expect(screen.getByText('Zeiss®')).toBeDefined();
    expect(screen.getByText('不碎 · 抗切割 · 無度數')).toBeDefined();
    // V-Twin / Americana — rizoma.com/en/americana-collection/ 逐字
    //   "enhance the visual identity of V-Twin motorcycles"
    expect(screen.getByText('V-Twin')).toBeDefined();
    expect(screen.getByText('Americana 系列')).toBeDefined();
    // 18 g — cycle.rizoma.com 的 R21 規格
    expect(screen.getByText('18 g')).toBeDefined();
  });

  it('🛑 四格【不得】出現創立年份或創辦人 —— 官網查無,那是一個拍板不是漏掉', () => {
    // 🔴 主視窗 2026-09-02 判【甲】:不放沿革數字。
    //    本窗實測 rizoma.com/en/about-us 與 /en/company 皆 404、首頁無 about 連結;
    //    而 OD brand-content-data.js:1090 獨立寫著「rizoma.com 本身仍無可連線的 About 頁」。
    //    ⇒ 這一格擋的是「有人日後從品牌頁把 2001 / Rigolio 搬過來湊數字」——
    //      而那個動作在 diff 上看起來只是補了一格。
    render(<RizomaShowcase />);
    const stats = document.querySelector('.pd-bs-stats')?.textContent ?? '';
    expect(stats).not.toContain('2001');
    expect(stats).not.toContain('Rigolio');
    expect(stats).not.toContain('Ferno');
    // 🟢 正對照:這把尺在【有】的時候會叫 —— 四格裡真的存在的那些字它抓得到
    expect(stats).toContain('Billet');
  });
});
