import { describe, expect, it } from 'vitest';
import { parseSearchFacets, hasAnyFacet, type FacetSources } from './parse-search-facets';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { MockBrand } from '@/data/mock-brands';
import type { MockCategory } from '@/data/mock-categories';

// ⟦search-CAPSULEPARSE⟧ 2026-09-03
//
// 🔴 **fixture 用真實形狀** —— 車款名帶連字號(`MT-07`)、品牌名帶變音符號(`AKRAPOVIČ`)、
//    分類名是完整的中文(`油箱止滑貼`)。
//    ⚠️ 今晚吃過一次虧:我自己編的 31 筆料號語料**不含正式站真實的形狀**,
//      而那讓我下錯結論。⇒ 📌 fixture 編得太乾淨, 測試就只證明「我想的那個世界」。
const MOTO: MockMotoBrand[] = [
  { id: 'yamaha', name: 'YAMAHA', models: [
    { id: 'mt-07', name: 'MT-07', years: [2021, 2022] },
    { id: 'mt-09', name: 'MT-09', years: [2021] },
  ] },
  { id: 'aprilia', name: 'APRILIA', models: [{ id: 'rsv4', name: 'RSV4', years: [2021] }] },
];
const BRANDS = [
  { id: 'akrapovic', name: 'AKRAPOVIČ', count: 9, country: 'SI', tagline: '', since: 1990 },
  { id: 'ohlins', name: 'Öhlins', count: 4, country: 'SE', tagline: '', since: 1976 },
] as unknown as MockBrand[];
const CATS = [
  { id: 'grip', name: '止滑貼與保護膜', count: 3, children: [
    { id: 'tank', name: '油箱止滑貼', count: 2 },
  ] },
  { id: 'exhaust', name: '排氣管', count: 5, children: [] },
] as unknown as MockCategory[];
const SRC: FacetSources = { motoBrands: MOTO, brands: BRANDS, categories: CATS };

const parse = (q: string) => parseSearchFacets(q, SRC);

describe('parseSearchFacets — Sean 親口給的兩句', () => {
  // 🔵 這兩句是 **Sean 逐字打的**, 不是我編的。
  it('🔴 「mt07 akrapovic」⇒ 車款 + 品牌兩顆膠囊, 零剩字(他原話那個例子)', () => {
    const r = parse('mt07 akrapovic');
    expect(r.vehicle).toBe('yamaha:mt-07');
    expect(r.brandIds).toEqual(['akrapovic']);
    expect(r.leftover, '有剩字就要畫出來 —— 而這一句不該有').toEqual([]);
    // 🎯 而這兩顆**一條字典都沒用到** —— 純格式正規化。
    expect(r.usedSynonyms).toEqual([]);
  });

  it('🔴 「MT07 油箱貼」⇒ 車款 + 分類(而分類這顆【用到字典】)', () => {
    const r = parse('MT07 油箱貼');
    expect(r.vehicle).toBe('yamaha:mt-07');
    expect(r.category).toBe('油箱止滑貼');
    expect(r.leftover).toEqual([]);
    // 🔵 而它要標出「這一顆是猜的」—— 那是 draft 字典。
    expect(r.usedSynonyms.map((s) => s.from)).toEqual(['油箱貼']);
  });
});

describe('parseSearchFacets — 我編的句子(標明是我編的)', () => {
  // ⚠️ **以下五句是我編的, 不是 Sean 給的。**
  it('🔵 只有品牌:「akrapovic」', () => {
    const r = parse('akrapovic');
    expect(r.brandIds).toEqual(['akrapovic']);
    expect(r.vehicle).toBeNull();
  });

  // 🔴🔴 **這一句是本片最重要的一格** —— 解析一半, 而剩下的字要看得見。
  it('🔴🔴 「mt07 排氣管好看的」⇒ 帶到兩顆, 而「好看的」**必須留在 leftover**', () => {
    const r = parse('mt07 排氣管好看的');
    expect(r.vehicle).toBe('yamaha:mt-07');
    // 🎯 「排氣管好看的」整串不是分類名, 也不是前綴 ⇒ 它是剩字
    expect(r.leftover, '丟掉的字沒出現在 leftover ⇒ 客人不會知道我們沒懂').toContain(
      '排氣管好看的',
    );
  });

  it('🔵 前綴就中, 不必動字典:「排氣」⇒ 排氣管', () => {
    const r = parse('排氣');
    expect(r.category).toBe('排氣管');
    expect(r.usedSynonyms, '這一顆不該動用字典').toEqual([]);
  });

  it('🔴 變音符號原字也要中:「AKRAPOVIČ」(fold 剝變音 ⇒ 正確的字反而可能被剝壞)', () => {
    // 🎯 主視窗點名的方向:最容易漏的是**正確的字**, 不是打錯的字。
    expect(parse('AKRAPOVIČ').brandIds).toEqual(['akrapovic']);
    expect(parse('Öhlins').brandIds).toEqual(['ohlins']);
  });

  it('🔵 多顆品牌全部帶上(Q1=A)', () => {
    expect(parse('akrapovic ohlins').brandIds).toEqual(['akrapovic', 'ohlins']);
  });

  // 🔴 code-reviewer 2026-09-04 minor:兩個車款詞的行為沒有被釘住 ——
  //    而把 `outer:` label 拿掉(只 break 內層)⇒ **第二個會覆蓋第一個**, 而當時零測試會紅。
  it('🔴 一句裡兩個車款 ⇒ 只認第一個, 第二個留在 leftover(而不是被覆蓋)', () => {
    const r = parse('mt07 mt09');
    expect(r.vehicle, '取到 mt-09 ⇒ `outer:` label 被拿掉了').toBe('yamaha:mt-07');
    // 🎯 而第二個**要看得見** —— 客人打了它, 而我們沒有用它。
    expect(r.leftover).toContain('mt09');
  });
});

describe('parseSearchFacets — 🔴 那條退路:解析不出東西時', () => {
  // 🛑 這一族守的是主視窗點名「絕對不准」的失敗態。
  it.each([
    ['完全不存在的字', 'zzz不存在zzz'],
    ['空字串', ''],
    ['純空白', '   '],
    ['純標點', '--- ...'],
  ])('🔴 %s ⇒ 零 facet(呼叫端照舊走關鍵字路)', (_label, q) => {
    const r = parse(q);
    expect(hasAnyFacet(r), '憑空生出 facet ⇒ 客人會拿到一個他沒要的篩選').toBe(false);
  });

  it('🔴🔴 一個詞只能被用掉一次(否則同一個字會生出兩顆膠囊)', () => {
    const r = parse('排氣');
    expect(r.category).toBe('排氣管');
    expect(r.leftover, '被用掉的字還留在 leftover ⇒ 畫面會說「這個字沒用到」而它用到了').toEqual(
      [],
    );
  });

  // 🔴 防迴圈那一格的前提:解析出東西時 leftover **必須真的變短**。
  //    ⚠️ 主視窗問「解析出東西而 leftover = 原輸入,那可能嗎?」
  //    ⇒ **我構造不出來** —— 每一條命中路徑都 `used.add(i)`,而 leftover 是 `!used` 的補集。
  //      這一格就是那個不變式的守門。
  it('🔴 有 facet ⇒ leftover 一定比原輸入的詞數少(redirect 迴圈的前提)', () => {
    for (const q of ['mt07 akrapovic', 'MT07 油箱貼', '排氣', 'akrapovic ohlins']) {
      const r = parse(q);
      const wordCount = q.split(/\s+/).filter((w) => w !== '').length;
      expect(hasAnyFacet(r), q).toBe(true);
      expect(r.leftover.length, `${q} 的 leftover 沒變短 ⇒ redirect 會迴圈`).toBeLessThan(
        wordCount,
      );
    }
  });
});
