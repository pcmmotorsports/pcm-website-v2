import { describe, expect, it } from 'vitest';
import { bannerSourceLabel, bannerTextIssues, socialTextState } from './home-banner-social';

describe('bannerSourceLabel', () => {
  it.each([
    [{ sourceProductId: 'p', sourceEmailId: null }, '每日新品'],
    [{ sourceProductId: null, sourceEmailId: 'm' }, '廠商來信'],
    [{ sourceProductId: null, sourceEmailId: null }, '手動新增'],
  ])('%o ⇒ %s', (b, want) => expect(bannerSourceLabel(b)).toBe(want));
});

describe('socialTextState', () => {
  it('🔴 有「現貨」⇒ 紅字, 複製與下載按不下去', () => {
    const s = socialTextState('Materya｜拉桿護弓\n台灣現貨', ['Materya']);
    expect(s.issues.map((i) => i.word)).toEqual(['現貨']);
    expect(s.blockedWhy).toBe('有紅字,改好才能複製或下載');
  });
  it('品牌名開頭的原廠保固放行', () => {
    expect(socialTextState('Materya 原廠提供兩年保固', ['Materya'])).toEqual({ issues: [], blockedWhy: null });
  });
  it('空的 ⇒ 沒有紅字, 但按不下去', () => {
    expect(socialTextState('  ', [])).toEqual({ issues: [], blockedWhy: '還沒有文字' });
  });
});

describe('bannerTextIssues', () => {
  it('大圖上的原廠保固也算紅字(比 FB / IG 嚴)', () => {
    expect(bannerTextIssues(['拉桿護弓', '原廠提供兩年保固']).map((i) => i.word)).toEqual(['保固']);
  });
});
