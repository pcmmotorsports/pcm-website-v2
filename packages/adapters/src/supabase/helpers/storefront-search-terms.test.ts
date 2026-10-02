import { describe, expect, it } from 'vitest';
import {
  isStorefrontQueryTooShort,
  MAX_SINGLE_CHAR_TERMS,
  splitStorefrontSearchTerms,
} from './product-query-support';

// 2026-10-02 Sean 拍搜尋短字 Q1 甲、Q2 甲(計畫 ~/pcm-mailbox/計畫-前台搜尋短字-20261002.md)。
// 正式庫量到:只打「a」每次 3 秒逾時回 500;「R」「2」「-」各 1.1–2.4 秒;8 個單字母每次逾時;單一中文字 0.2–0.4 秒。
describe('splitStorefrontSearchTerms — 前台搜尋的詞', () => {
  it('🔴 純符號詞不拿去比對(-、/、+ 這種對找商品沒有幫助, 只會變慢)', () => {
    expect(splitStorefrontSearchTerms('Beeline Moto - 2')).toEqual(['Beeline', 'Moto', '2']);
    expect(splitStorefrontSearchTerms('rizoma / 後照鏡 +')).toEqual(['rizoma', '後照鏡']);
  });

  it('🔴 單一個英文字母或數字最多留 2 個, 多的忽略(先打的先留)', () => {
    expect(MAX_SINGLE_CHAR_TERMS).toBe(2);
    expect(splitStorefrontSearchTerms('a b c d e f g h')).toEqual(['a', 'b']);
    expect(splitStorefrontSearchTerms('Moto 2 R 1 X carbon')).toEqual(['Moto', '2', 'R', 'carbon']);
  });

  it('全形英數也算單字母(ＡＢ 會被當成 A、B)', () => {
    expect(splitStorefrontSearchTerms('ｘ ｙ ｚ 排氣')).toEqual(['ｘ', 'ｙ', '排氣']);
  });

  it('單一中文字、兩個字以上的英文詞、料號照留', () => {
    expect(splitStorefrontSearchTerms('管 ab ZA-222Y')).toEqual(['管', 'ab', 'ZA-222Y']);
  });

  it('一般查詢不受影響(與共用的拆詞結果相同)', () => {
    expect(splitStorefrontSearchTerms('rpm rsv4 油箱貼')).toEqual(['rpm', 'rsv4', '油箱貼']);
  });

  it('全部都是符號 ⇒ 零詞(呼叫端照既有規矩 fail-closed 回空結果, 不送查詢)', () => {
    expect(splitStorefrontSearchTerms('- / +')).toEqual([]);
  });
});

describe('isStorefrontQueryTooShort — 只剩一個英文字母或數字時先不查', () => {
  it.each(['a', 'R', '2', ' a ', 'a -', 'ｂ'])('🔴 %j ⇒ 太短', (q) => {
    expect(isStorefrontQueryTooShort(q)).toBe(true);
  });

  it.each(['管', 'ab', 'a b', '22', 'R1', '-', ''])('%j ⇒ 不算太短(中文單字照查;純符號 / 空白另由零詞那條擋)', (q) => {
    expect(isStorefrontQueryTooShort(q)).toBe(false);
  });
});
