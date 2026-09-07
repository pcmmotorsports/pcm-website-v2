import { describe, expect, it } from 'vitest';

import { NEEDS_YOU_CARDS, needsYouSentence } from './needs-you-cards';

/**
 * 🔴 **這裡守的是【句子裡的數目】與【句子裡列的東西】對不對得上**(2026-09-08 `-auth`)。
 *
 * 🛑 **兩個數都從【輸出字串】讀,不從 `NEEDS_YOU_CARDS` 讀** ——
 *    從陣列讀 `length` 再去比句子,是**拿它驗它自己**(本 repo 同族:`page.test.tsx:628-629`
 *    逐字記過同一件事);而那樣的斷言在「量詞寫死」的舊碼上**也會綠**。
 *
 * 🟢 **正對照 = 餵四筆的那一格**:舊碼(量詞逐字寫死「三」)在那一格會印
 *    「下面這**三**格…甲 · 乙 · 丙 · 丁」⇒ **必紅**。實測過才留這一格。
 */
const 量詞 = /下面這 (\d+) 格/;

function 讀句子(s: string): { 說幾格: number; 真的列了幾個: number } {
  const m = 量詞.exec(s);
  if (!m) throw new Error(`句子裡讀不到「下面這 N 格」:${s}`);
  const 名單 = s.split('單:')[1]?.split('。')[0] ?? '';
  return { 說幾格: Number(m[1]), 真的列了幾個: 名單.split(' · ').filter(Boolean).length };
}

describe('needsYouSentence', () => {
  it('真清單:句子說的格數 == 句子真的列出來的個數', () => {
    const { 說幾格, 真的列了幾個 } = 讀句子(needsYouSentence());
    expect(說幾格).toBe(真的列了幾個);
    // 🔵 而它同時要等於清單長度 —— 這一條是【接線】,上面那條是【內部一致】,兩件事
    expect(說幾格).toBe(NEEDS_YOU_CARDS.length);
  });

  it('🟢 有人加了第四格:句子要跟著變成 4,不能還說三', () => {
    const 四筆 = [
      ...NEEDS_YOU_CARDS,
      { testId: 'zz-new-count', 名稱: '第四種等你處理的' },
    ] as typeof NEEDS_YOU_CARDS;
    const { 說幾格, 真的列了幾個 } = 讀句子(needsYouSentence(四筆));
    expect(說幾格).toBe(4);
    expect(真的列了幾個).toBe(4);
  });

  it('⚪ 負對照:量詞的樣式真的會挑剔 —— 讀不到就丟例外,不是靜靜回 0', () => {
    expect(() => 讀句子('下面這三格加起來, 就是今天等你處理的單:甲 · 乙。')).toThrow();
  });

  it('那半句「不是全部」不可以被拿掉', () => {
    expect(needsYouSentence()).toContain('不是全部');
  });
});
