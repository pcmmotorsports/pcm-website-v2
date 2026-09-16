import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitHomeBannerTitle } from '@pcm/domain';
import { describe, expect, it } from 'vitest';
import { titleLayoutHint } from './home-banner-constants';

// home-banner-title-hint.test.ts — 釘住「標題第一行 / 第二行」那兩格旁邊那句說明,
// **必須跟 `splitHomeBannerTitle` 的兩條分支對得上**。
//
// 🔴 **這一格要抓的病**:欄位的名字叫「標題第一行」,而**它不一定是標題** ——
//    第一行純英數字 + 有第二行 ⇒ 第一行變成大標上面那行**小字車款名**。
//    2026-09-16 Sean 建的那張就踩到:第一行填中文「新品上市」⇒ 兩行都當大標印
//    ⇒ 「2026 Ninja ZX-10R」用 CJK 粗體印出來(pcm-banner skill 的 T2 明文禁止)。
//    📌 **欄位的名字沒有騙人,它只是【沒有說】。**
//
// ✅ 證得到:那句說明**兩條分支各講對自己那一邊**,而且**真的被畫出來**。
// ⛔ 證不到:Sean 讀完會不會填對。那要他自己開一次。

/** 🔬 兩組輸入各自踩中 `splitHomeBannerTitle` 的一條分支(第二行都給,才有得分)。 */
const 英數第一行 = splitHomeBannerTitle('Ninja ZX-10R', '賽道出身的鋁合金部品');
const 中文第一行 = splitHomeBannerTitle('新品上市', '2026 Ninja ZX-10R');

describe('🔬 正對照:兩組輸入真的落在不同分支', () => {
  it('英數第一行 ⇒ 有 model;中文第一行 ⇒ 沒有', () => {
    // 沒有這一格的話,下面兩格可能兩邊都在測同一條分支而全綠。
    expect(英數第一行.model).toBe('Ninja ZX-10R');
    expect(中文第一行.model).toBeNull();
  });

  it('🔴 而那句說明真的被畫在面板上(不是死碼)', () => {
    const src = readFileSync(
      join(process.cwd(), 'apps/admin/src/components/home-banners/home-banner-editor.tsx'),
      'utf8',
    );
    expect(src).toContain('titleLayoutHint(title.model)');
  });
});

describe('那句說明要講對自己那一邊', () => {
  it('英數第一行 ⇒ 說第一行是小字車款名,不能說成大標', () => {
    const hint = titleLayoutHint(英數第一行.model);
    expect(hint).toContain('小字');
    expect(hint).not.toContain('兩行都');
  });

  it('中文第一行 ⇒ 說兩行都是大標,而且要講【怎麼換成另一種】', () => {
    const hint = titleLayoutHint(中文第一行.model);
    expect(hint).toContain('兩行都');
    // 🔴 只說「現在兩行都是大標」還不夠 —— 那是描述, 不是出路。
    //    Sean 當天需要的是「那我要怎麼讓車款名變小字」, 所以這句必須帶條件。
    expect(hint).toContain('英數字');
  });
});

describe('🔬 負對照:把已知的錯法餵進去要咬', () => {
  it('🔴 兩條分支不准講同一句話', () => {
    // 這是最可能發生的退化:有人嫌麻煩, 把它收成一句固定的說明。
    // 那一版看起來還是「有寫說明」, 而它對其中一半的情況是錯的。
    expect(titleLayoutHint(英數第一行.model)).not.toBe(titleLayoutHint(中文第一行.model));
  });

  it('🔴 第一行是英數字【而沒有第二行】⇒ 不算車款名, 說明要走另一邊', () => {
    // 分支條件是「純英數字 **且有第二行**」。少測這一格的話,
    // 有人把條件改成只看第一行, 上面兩格照樣全綠。
    const 只有一行 = splitHomeBannerTitle('Ninja ZX-10R', null);
    expect(只有一行.model).toBeNull();
    expect(titleLayoutHint(只有一行.model)).toContain('兩行都');
  });
});
