// @vitest-environment node
//
// 🔴 **本檔的分母是【我自己造的】, 不是 Sean 的樣本** ——
//    他那 10 個錯字的逐字清單隨對話消失了(拍板檔只留 `evotch` / `akrpovic` 兩個)。
//    ⇒ 📌 **所以本檔證的是「這支函式的行為符合它自己的規格」, 不是「它在他的樣本上也對」。**

import { describe, expect, it } from 'vitest';
import { suggestBrand, trigramSimilarity, SUGGESTION_FLOOR, type BrandCandidate } from './brand-suggestion';

// 站上實際的品牌(2026-09-05 唯讀正式庫實查:`brands` 共 25 列)—— 這裡取一個子集。
const BRANDS: readonly BrandCandidate[] = [
  { name: 'AKRAPOVIČ', slug: 'akrapovic' },
  { name: 'GILLES TOOLING', slug: 'gilles' },
  { name: 'RIZOMA', slug: 'rizoma' },
  { name: 'LIGHTECH', slug: 'lightech' },
  { name: 'EVOTECH', slug: 'evotech' },
  { name: 'BONAMICI RACING', slug: 'bonamici' },
];

describe('trigramSimilarity', () => {
  it('🔴 完全相同 ⇒ 1', () => {
    expect(trigramSimilarity('rizoma', 'rizoma')).toBe(1);
  });

  it('🔴 毫無關係 ⇒ 0 —— 而那一格承重:suggestBrand 靠它回 null', () => {
    expect(trigramSimilarity('zzzzz', 'rizoma')).toBe(0);
  });

  it('🔵 空字串兩邊都不算「完全一樣」', () => {
    expect(trigramSimilarity('', '')).toBe(0);
    expect(trigramSimilarity('', 'rizoma')).toBe(0);
  });

  it('🔴 錯一個字母的分數要【明顯高於】不相干的牌子(這就是它能用的理由)', () => {
    const near = trigramSimilarity('akrpovic', 'akrapovic');
    const far = trigramSimilarity('akrpovic', 'rizoma');
    expect(near).toBeGreaterThan(0.3);
    expect(far).toBeLessThan(0.1);
    // 🛑 兩個絕對值都釘住 —— 只比大小的話, 一支「永遠回 0.5 與 0.4」的壞尺也會過。
  });
});

describe('suggestBrand', () => {
  it('🔴 打錯字 ⇒ 挑到對的牌子(拍板檔只留下這兩個, 就用這兩個)', () => {
    expect(suggestBrand('akrpovic', BRANDS)?.slug).toBe('akrapovic');
    expect(suggestBrand('evotch', BRANDS)?.slug).toBe('evotech');
  });

  it('🔴 亂編的字 ⇒ 回 null(一個三連字元都沒對上 ⇒ 那不是「最像」, 是「毫無關係」)', () => {
    expect(suggestBrand('zzzzzqqqqq', BRANDS)).toBeNull();
  });

  it('🔵 空查詢 / 空清單 ⇒ null', () => {
    expect(suggestBrand('   ', BRANDS)).toBeNull();
    expect(suggestBrand('akrpovic', [])).toBeNull();
  });

  it('🔴 平手要【穩定】—— 同一個輸入每次都回同一個牌子', () => {
    // 🛑 少了這一格, 一支「平手時取後面那個」的實作也會過上面每一格,
    //    而它在線上的症狀是【同一個字每次建議不同的牌子】—— 那看起來像壞掉。
    const tie: readonly BrandCandidate[] = [
      { name: 'ABC', slug: 'abc' },
      { name: 'ABC', slug: 'abc2' },
    ];
    expect(suggestBrand('abc', tie)?.slug).toBe('abc');
    expect(suggestBrand('abc', tie)?.slug).toBe('abc');
  });

  it('🔵 中文查詢不會硬湊一個英文牌子', () => {
    // 🔴 非英數會被正規化掉 ⇒ 中文的 trigram 集合是空的 ⇒ 分數 0 ⇒ null。
    //    ⚠️ **而那也是它的天花板**:本檔對中文品牌名【完全沒有判別力】,
    //       站上今天 25 個品牌全是英文 ⇒ 今天不影響, 而有中文品牌那天要重讀這一格。
    expect(suggestBrand('排氣管', BRANDS)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 🔴🔴 **變音符號那一格 —— code-reviewer R1 抓到「今天對只是因為資料剛好是 ASCII」**
// ══════════════════════════════════════════════════════════════════════
describe('變音符號', () => {
  it('🔴 只比【正式名】(沒有 slug 可以靠)時, 錯字照樣要對得上', () => {
    // 🛑 這一格把 slug 拿掉 —— 少了它, `Math.max(name, slug)` 會一直遮著 name 側是壞的。
    const onlyName: readonly BrandCandidate[] = [
      { name: 'AKRAPOVIČ', slug: 'AKRAPOVIČ' },
      { name: 'RIZOMA', slug: 'RIZOMA' },
    ];
    expect(suggestBrand('akrpovic', onlyName)?.name).toBe('AKRAPOVIČ');
  });

  it('🔴 Č / Ö 折成 C / O, 而不是【變成空白】', () => {
    // 🔬 壞掉的版本(直接 replace 非英數)算出來:`Öhlins` 的 Ö 整個消失 ⇒ 與 `ohlins` 分數偏低。
    expect(trigramSimilarity('ohlins', 'Öhlins')).toBe(1);
    expect(trigramSimilarity('akrapovic', 'AKRAPOVIČ')).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 🔴🔴 **地板 0.2**(主視窗 2026-09-05 裁, 臨時可逆;`Q-建議地板` 在 Sean 早上佇列)
//   🔬 值是在【這把尺】上量的:真錯字最低 0.500 · 噪音最高 0.111 ⇒ 中間那段是空的。
// ══════════════════════════════════════════════════════════════════════
describe('建議地板', () => {
  // 線上實際品牌清單的一個子集(2026-09-05 掃 /api/search a–z 取聯集)。
  const LIVE: readonly BrandCandidate[] = [
    { name: 'AKRAPOVIČ', slug: 'akrapovic' },
    { name: 'EVOTECH PERFORMANCE', slug: 'evotech' },
    { name: 'RIZOMA', slug: 'rizoma' },
    { name: 'CNC RACING', slug: 'cnc-racing' },
    { name: 'MATERYA', slug: 'materya' },
    { name: 'SAMCO SPORT', slug: 'samco' },
  ];

  it('🔴 三個【假的】要被殺掉:車款代號 / 太短 / 兩個字母', () => {
    // 🔬 這三個在這把尺上分別是 0.083 / 0.111 / 0.077 ⇒ 全在地板下。
    expect(suggestBrand('mt07', LIVE)).toBeNull();
    expect(suggestBrand('r1', LIVE)).toBeNull();
    expect(suggestBrand('co', LIVE)).toBeNull();
  });

  it('🔴 兩個【真的品牌錯字】要活著 —— 地板不能砍到它們', () => {
    // 🔬 0.583 與 0.500 ⇒ 離地板 2.5 倍以上。
    expect(suggestBrand('akrpovic', LIVE)?.slug).toBe('akrapovic');
    expect(suggestBrand('evotch', LIVE)?.slug).toBe('evotech');
  });

  it('🔵 地板是【常數一個】—— 改成 0 就回到「不設門檻」(Sean 若拍不要)', () => {
    // 🛑 這一格釘的是「它是可調的」這件事本身:
    //    若有人把地板寫死進條件式, 這個 import 會不存在 ⇒ typecheck 紅。
    expect(SUGGESTION_FLOOR).toBeGreaterThan(0);
    expect(SUGGESTION_FLOOR).toBeLessThan(0.5);
  });
});
