import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishKeepsLiveHint } from './home-banner-constants';

// home-banner-publish-hint.test.ts — 釘住按「發布」之前那一句提醒(Sean 2026-09-17 Q3 甲)。
//
// 🔴 **要抓的病是【時機】不是【有沒有寫】**:「舊的不會自動收掉」這句話在 2026-09-16 就存在,
//    而它只出現在按【複製】那一步的結果條上 ⇒ 按發布時早就被蓋掉了。
//    📌 **話說過了而時機不對, 與沒說一樣。**
//
// ✅ 證得到:那句話的**形狀**(張數是算出來的、不用指示代名詞、該不印的時候回 null),
//    以及它**真的被畫在面板上**。
// ⛔ 證不到:Sean 讀完會不會真的去下架舊的。那要他自己走一次。

describe('🔬 正對照:它真的被畫在面板上(不是死碼)', () => {
  it('editor 叫了 publishKeepsLiveHint, 而且只在草稿時畫', () => {
    const src = readFileSync(
      join(process.cwd(), 'apps/admin/src/components/home-banners/home-banner-editor.tsx'),
      'utf8',
    );
    expect(src).toContain('publishKeepsLiveHint(liveCount)');
    expect(src).toContain("isDraft && keepsLive !== null");
  });
});

describe('判準 ③:首頁本來就空的時候不要印', () => {
  it('liveCount = 0 ⇒ null', () => {
    expect(publishKeepsLiveHint(0)).toBeNull();
  });

  it('🔴 liveCount = 1 ⇒ 要印 —— 那正是「發布之後會變兩張」那一刻', () => {
    // ⚠️ 這一格容易被寫反。判準是【發布之後會不會同時掛兩張】:
    //    現在 0 張 ⇒ 發布後 1 張 ⇒ 沒事;現在 1 張 ⇒ 發布後 2 張 ⇒ 要提醒。
    expect(publishKeepsLiveHint(1)).not.toBeNull();
  });
});

describe('判準 ①②:張數要算出來, 而且不准用指示代名詞', () => {
  it('② 張數跟著 liveCount 走, 不是寫死的', () => {
    expect(publishKeepsLiveHint(1)).toContain('1 張');
    expect(publishKeepsLiveHint(4)).toContain('4 張');
  });

  it('① 不出現「這張 / 那張」', () => {
    for (const n of [1, 2, 4, 9]) {
      const hint = publishKeepsLiveHint(n);
      expect(hint).not.toBeNull();
      // 🟢 「要收的【那一張】」過得了 —— 它有修飾語當錨點, 而且字面不是「那張」。
      expect(hint as string).not.toMatch(/[這那]張(?!$)/u);
      expect(hint as string).toContain('要收的那一張');
    }
  });
});

describe('🔬 負對照:把已知的錯法餵進去要咬', () => {
  it('🔴 不同的 liveCount 不准印出同一句話(= 有人把張數寫死)', () => {
    // 最可能的退化:嫌 N 麻煩, 收成一句「首頁可能還掛著別張」。
    // 那一版看起來還是「有提醒」, 而它把 2026-09-16 那個病原封不動帶回來。
    expect(publishKeepsLiveHint(1)).not.toBe(publishKeepsLiveHint(2));
  });

  it('🔴 這道「不准有代名詞」的尺本身量得到東西', () => {
    // 沒有這一格的話, 上面那個 not.toMatch 可能只是因為正規式寫壞而恆綠。
    expect('要收起來請按那張的下架').toMatch(/[這那]張(?!$)/u);
    expect('發布新的不會把這張下架').toMatch(/[這那]張(?!$)/u);
  });
});
