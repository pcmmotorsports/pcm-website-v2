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
// 🔴 **fixture 要有【好幾個不同的父】** —— 只有一個父時, 「剛好那個父對」與
//    「拼路徑真的用了那一列自己的父」印同一個綠(主視窗 2026-09-04 點名)。
// 🔬 這些名字與層級是**正式站實查的**(唯讀連線, `products_list_public`, 分母 24,312, 2026-09-04):
//      止滑貼與保護膜 · 油箱止滑貼          614 件
//      止滑貼與保護膜 · 車身保護膜(犀牛皮)  507 件   ← 🔴 半形括號**會進網址**
//      外觀與後視鏡 · 風鏡與定風翼          239 件
//      拉桿與把手 · 握把與平衡端子          343 件   ← 🔵 父自己直屬 0 件而子有貨
//    ⚠️ 件數不進本檔的斷言(本檔驗參數值, 不驗件數)—— 寫在這裡是為了讓下一個人知道**來源**。
const CATS = [
  { id: 'grip', name: '止滑貼與保護膜', count: 3, children: [
    { id: 'tank', name: '油箱止滑貼', count: 2 },
    { id: 'ppf', name: '車身保護膜(犀牛皮)', count: 2 },
  ] },
  { id: 'front', name: '外觀與後視鏡', count: 4, children: [
    { id: 'screen', name: '風鏡與定風翼', count: 2 },
  ] },
  { id: 'bar', name: '拉桿與把手', count: 4, children: [
    { id: 'grips', name: '握把與平衡端子', count: 2 },
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
    // 🔴🔴 **期望值是【全路徑】不是短名。** 2026-09-04:短名讓每顆分類膠囊都回 0 件
    //    (RPC 只認 `category_raw = X` 或 `LIKE X || ' · %'`, 而 raw 是 `父 · 子`)。
    //    ⚠️ 這一行**先前是** `'油箱止滑貼'` —— 而它是綠的, 因為 fixture 自己也是短名比短名。
    expect(r.category).toBe('止滑貼與保護膜 · 油箱止滑貼');
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

  // 🔵🔵 **負對照:頂層分類回的就是它自己, 不得多一個分隔符。**
  //    它擋的是「無條件拼路徑」那個過頭的修法 —— 而那個修法在上面那一格是綠的。
  it('🔵 前綴就中, 不必動字典:「排氣」⇒ 排氣管(頂層 ⇒ 零分隔符)', () => {
    const r = parse('排氣');
    expect(r.category).toBe('排氣管');
    expect(r.category).not.toContain(' · ');
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

  it('🔴 子分類的短名【不得】原樣進網址 —— 而它與正確值只差一個前綴', () => {
    // 🎯 這一格是那個缺陷的正臉:兩個字串都「看起來像分類名」, 而只有一個撈得到商品。
    const r = parse('油箱止滑貼');
    expect(r.category, '回短名 ⇒ RPC 兩個分支都不中 ⇒ 客人看到 0 件').not.toBe('油箱止滑貼');
    expect(r.category).toBe('止滑貼與保護膜 · 油箱止滑貼');
  });

  // 🔴 三列, 而**三列的父不同** —— 少了這一格,「拼路徑」可能只是碰巧撞對唯一那個父。
  it.each([
    ['油箱止滑貼', '止滑貼與保護膜 · 油箱止滑貼'],
    ['風鏡與定風翼', '外觀與後視鏡 · 風鏡與定風翼'],
    ['握把與平衡端子', '拉桿與把手 · 握把與平衡端子'],
  ])('🔴 子分類「%s」⇒ 要帶【自己那一列的父】', (word, expected) => {
    expect(parse(word).category).toBe(expected);
  });

  // 🔴 半形括號是分類名的一部分, 而它會進網址。
  // 🛑 **本格只驗【值本身】—— 編碼那一段不歸它管。**
  //    ⛔ ~~我原本還加了一發 `URLSearchParams` 來回, 並宣稱「與 page.tsx 同一種寫法」~~
  //    ⇒ 🔴 code-reviewer 2026-09-04 實測:那一發**對任何字串都綠**(`'a b'` / `''` /
  //      `'anything+at all%20&=?#'` 四發全 true)⇒ **零判別力**, 已刪。
  //    ⇒ 🔵 而它替我核了真正的解碼端(Next 的 `searchParamsToUrlQuery`)⇒ **那條路是對的**,
  //      只是**這一格證不到它**。⇒ 📌 一個恆真的斷言, 比沒有斷言更會讓人放心。
  it('🔴 分類名含半形括號 ⇒ 值本身要逐字正確', () => {
    expect(parse('車身保護膜(犀牛皮)').category).toBe('止滑貼與保護膜 · 車身保護膜(犀牛皮)');
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
