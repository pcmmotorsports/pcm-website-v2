import { describe, expect, it } from 'vitest';
import { applyBrandSynonym, applyBrandSynonyms } from './brand-synonyms';

// S6:後台認顧客站人核過的品牌俗名。分類草稿不接。

describe('applyBrandSynonym', () => {
  it('人核過的品牌俗名 ⇒ 正式品牌名', () => {
    expect(applyBrandSynonym('阿卡')).toBe('Akrapovic');
    expect(applyBrandSynonym('蠍子管')).toBe('Akrapovic');
    expect(applyBrandSynonym('碳蠍')).toBe('Akrapovic');
  });
  it('分類俗名(多半是草稿)⇒ 不換', () => {
    expect(applyBrandSynonym('油箱貼')).toBe('油箱貼');
  });
  it('不是整個詞相等 ⇒ 不換(「阿」不會變成 Akrapovic)', () => {
    expect(applyBrandSynonym('阿')).toBe('阿');
    expect(applyBrandSynonym('阿卡波')).toBe('阿卡波');
  });
  it('本來就是正式名、一般詞、空字串 ⇒ 原樣', () => {
    expect(applyBrandSynonym('Akrapovic')).toBe('Akrapovic');
    expect(applyBrandSynonym('排氣管')).toBe('排氣管');
    expect(applyBrandSynonym('')).toBe('');
  });
});

describe('applyBrandSynonyms(整串)', () => {
  it('每個詞各換一次, 空白原樣保留(含全形空白)', () => {
    expect(applyBrandSynonyms('阿卡 排氣管')).toBe('Akrapovic 排氣管');
    expect(applyBrandSynonyms('排氣管　蠍子管')).toBe('排氣管　Akrapovic');
    expect(applyBrandSynonyms('  阿卡  ')).toBe('  Akrapovic  ');
  });
  it('沒有俗名 ⇒ 整串原樣(含 * 萬用字元)', () => {
    expect(applyBrandSynonyms('arw*71 panigale')).toBe('arw*71 panigale');
  });
});
