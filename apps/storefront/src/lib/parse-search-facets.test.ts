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

describe('⟦M-4b 多顆分類膠囊⟧ 真字典 · 一個俗稱兩個目標(不 mock)', () => {
  // 🔵 用**真的** `SEARCH_SYNONYMS` 驗 —— 合了 `-auth` 的多筆列之後這條路真資料到得了。
  //    🛑 而它依賴字典裡那兩列還在:少一列 ⇒ 本格紅, 而那個紅是對的(Sean 要「同時列」)。
  it('🔴 打「魚雷管」⇒ 全段與尾段【兩個都】解出來, 不是只有第一個', () => {
    const cats = [
      { id: 'ex', name: '排氣系統', count: 9, children: [
        { id: 'slip', name: '尾段排氣管(Slip-On)', count: 5 },
        { id: 'full', name: '全段排氣管', count: 4 },
      ] },
    ];
    const p = parseSearchFacets('魚雷管', { motoBrands: [], brands: [], categories: cats } as never);
    expect(p.categories.length, '只解出一個 ⇒ 客人少看到一半的排氣管').toBe(2);
    expect([...p.categories].sort()).toEqual(
      ['排氣系統 · 全段排氣管', '排氣系統 · 尾段排氣管(Slip-On)'].sort(),
    );
  });
});

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

// ─────────────────────────────────────────────────────────────────────────────
// ⟦search-PREFIXWRONGCAT⟧ 2026-09-04:客人打的詞落到哪個分類
//
// 🔴 **這組 fixture 的名字與件數【抄自 2026-09-04 正式站唯讀實查】**(117 個分類),
//    不是我編的 —— 因為這條規則用 `count` 挑落點, **編的件數會讓測試測到一個不存在的世界**。
// 🛑 而**它仍然是抽樣**:只留下這幾條規則會走到的分類。**摘要非全部。**
// 🔴🔴 **這個順序是刻意的, 不要「整理」它** —— `引擎與冷卻` 那組排在 `拉桿與把手` 前面,
//    所以打 `離合` 時**陣列第一個命中的是 196 件那個小桶**, 而正確答案(1,136 件)排在後面。
//    🛑 **上一版我把大的排在前面 ⇒「取最大」與「取第一個」給同一個答案**
//      ⇒ 那一格突變測試**全過** ⇒ 📌 **它零判別力, 而它看起來完全正常。**
//    ⇒ 這個順序也**與正式站一致**:舊規則實測落在 `引擎與冷卻 · 離合器機構與分泵`。
const REAL = [
  { id: 'eng', name: '引擎與冷卻', count: 900, children: [
    { id: 'cl1', name: '離合器機構與分泵', count: 196 },
    { id: 'cl2', name: '離合器外蓋', count: 112 },
  ] },
  { id: 'bar', name: '拉桿與把手', count: 2368, children: [
    { id: 'blever', name: '煞車離合器拉桿', count: 1136 },
  ] },
  { id: 'light', name: '燈具與電子', count: 500, children: [
    { id: 'hl', name: '大燈與護網', count: 96 },
    { id: 'cowl', name: '車頭罩與大燈罩', count: 78 },
  ] },
  { id: 'cf', name: '碳纖維部品', count: 2642, children: [
    { id: 'cfmisc', name: '其他碳纖維飾件', count: 379 },
    // 🔴 這一列是刻意放進來的, 而它**在正式站真的長這樣**(唯讀實查:`引擎與排氣護蓋` 的父是 `碳纖維部品`, 239 件)。
    //    它讓「排氣」在陣列裡的**第一個子字串命中是 239 件那個**, 而**最大的 852 排在後面**
    //    ⇒ 這是分開兩發突變唯一需要的形狀(見下方那格測試)。
    { id: 'cfexh', name: '引擎與排氣護蓋', count: 239 },
  ] },
  // 🔴 這兩列給 R2 抓到的那兩條 Critical 用(跨詞遮蔽 / 落到 0 件分類)。
  { id: 'gripR', name: '止滑貼與保護膜', count: 1663, children: [
    { id: 'tankR', name: '油箱止滑貼', count: 614 },
  ] },
  // 🔬 `煞車系統` 涵蓋 **398**(唯讀實查:煞車皮 68 · 煞車碟盤 16 · 來令片 0 · 自身 0)。
  { id: 'brk', name: '煞車系統', count: 398, children: [
    { id: 'pad', name: '煞車皮', count: 68 },
    // 🔬 這一列 **0 件**, 而它在正式站也是 0(`search-synonyms.ts` 自己記著)。
    { id: 'padz', name: '煞車皮(來令片)', count: 0 },
  ] },
  { id: 'exh', name: '排氣系統', count: 852, children: [
    { id: 'slip', name: '尾段排氣管(Slip-On)', count: 319 },
    { id: 'pipe', name: '排氣管配件', count: 92 },
  ] },
] as unknown as MockCategory[];
const REAL_SRC: FacetSources = { motoBrands: MOTO, brands: BRANDS, categories: REAL };
const pickReal = (q: string) => parseSearchFacets(q, REAL_SRC).category;

describe('⟦search-PREFIXWRONGCAT⟧ 落點規則', () => {
  it('🔴 客人打的詞【在名字中間】也要算命中 —— 舊規則只認開頭, 所以送錯', () => {
    // 🔬 正式站實測:打 `離合` 舊規則落到 `離合器機構與分泵`(196 件),
    //    而他要的 `煞車離合器拉桿` 有 1,136 件 —— **後者不是以「離合」開頭。**
    expect(pickReal('離合')).toBe('拉桿與把手 · 煞車離合器拉桿');
  });

  it('🔴 名字含這個詞的有好幾個時, 取【涵蓋最多】的那一個', () => {
    // 三個候選:離合器機構與分泵(196) · 離合器外蓋(112) · 煞車離合器拉桿(1136)
    expect(pickReal('離合器')).toBe('拉桿與把手 · 煞車離合器拉桿');
  });

  it('🔵 而【完全同名】比「比較大的那個」優先 —— 客人打的就是那個分類名', () => {
    // `排氣管配件` 只有 92 件, 而 `排氣系統` 852 件也含「排氣」;
    // 但客人逐字打了 `排氣管配件` ⇒ 意圖最明確 ⇒ 不准被大桶蓋過去。
    expect(pickReal('排氣管配件')).toBe('排氣系統 · 排氣管配件');
  });

  it('🟢 回歸:本來就對的那幾個【不准被弄壞】—— 落到頂層而他要的在底下', () => {
    // 🔴 這一格是刻意的:這四個詞在改規則【之前】就已經是對的,
    //    而改挑選規則最容易安靜地把它們弄壞, 而沒有東西會叫。
    expect(pickReal('拉桿')).toBe('拉桿與把手');
    expect(pickReal('排氣')).toBe('排氣系統');
    // ⚠️ 這兩格是 2026-09-04 補的 —— 原本註解寫「四個」而只斷言了兩個
    //    ⇒ 📌 **一段說四個而只守兩個的註解, 讀起來像四個都守著。**
    expect(pickReal('碳纖維')).toBe('碳纖維部品');
    expect(pickReal('碳纖')).toBe('碳纖維部品');
  });

  it('🔴 只有【取最大】守得住的那一格 —— 兩發突變會給【三個不同的答案】', () => {
    // 🔬 `合器` 是 離合器機構與分泵(196) · 離合器外蓋(112) · 煞車離合器拉桿(1136) 的**中綴**,
    //    而**誰的前綴都不是**。
    //    ⇒ 真檔      ⇒ 煞車離合器拉桿(1136, 最大)
    //    ⇒ 突變 includes⇒startsWith ⇒ 一個都不中 ⇒ **null**
    //    ⇒ 突變 取最大⇒取第一個      ⇒ 離合器機構與分泵(196, 陣列最前面)
    // 🛑 **上一版兩發突變殺掉的是【同一格】** ⇒ 沒有任何一格單獨證明「取最大」被守住。
    //    這一格把兩者分開:三個世界三個答案。
    expect(pickReal('合器')).toBe('拉桿與把手 · 煞車離合器拉桿');
  });

  it('🔴 這一格【只有取最大守得住】—— 換成子字串的那一半照樣會過', () => {
    // 🛑 **上一版我加了一格自稱「分開兩發突變」, 而實測它沒有分開** ——
    //    兩發突變殺掉的仍是同三格 ⇒ 📌 **一格自稱能分辨的測試, 要拿兩發突變去驗它真的分辨得出來。**
    // 🔬 `排氣` 的命中(照陣列順序):引擎與排氣護蓋(239) · 排氣系統(852) · 尾段排氣管(319) · 排氣管配件(92)
    //    ⇒ 真檔                    ⇒ 排氣系統(852, 最大)          ✅
    //    ⇒ 突變 includes⇒startsWith ⇒ 只剩 排氣系統/排氣管配件 ⇒ 最大仍是 排氣系統 ⇒ **這格會過**
    //    ⇒ 突變 取最大⇒取第一個      ⇒ 引擎與排氣護蓋(239)          🔴 **只有這發會紅**
    expect(pickReal('排氣')).toBe('排氣系統');
  });

  it('🔵 負對照:一個誰的名字都不含的詞 ⇒ 沒有膠囊, 而那個字要留在 leftover', () => {
    const r = parseSearchFacets('ZZ不存在的詞ZZ', REAL_SRC);
    expect(r.category).toBeNull();
    expect(r.leftover).toEqual(['ZZ不存在的詞ZZ']);
  });

  it('🔴🔴 R3 抓到的:同一條規則, 兩個庫存快照, 兩個答案 —— 而中間沒有人改碼', () => {
    // 🔬 **量到的(兩份快照都在, 都是唯讀正式庫)**:
    //    03:0x(答案表那份, `~/pcm-mailbox/網站庫分類名-117-20260904.txt:20,96`)
    //      大燈與護網 **63** · 車頭罩與大燈罩 **78** ⇒ 78 贏 ⇒ 答案表寫「他要的是車頭罩」
    //    12:29(本 fixture 這份)
    //      大燈與護網 **96** · 車頭罩與大燈罩 **78** ⇒ 96 贏 ⇒ 規則給大燈與護網
    //    🛑 **中間發生的事是 dbk 灌了 1,508 件, 不是有人改規則。**
    // ⛔ ~~我原本寫「大燈刻意不修, 因為任何讓它過的調整就是照答案調規則」~~ **⇒ 作廢。**
    //    🎯 **那句話守的是一個【不存在的誘惑】** —— 在答案表自己的快照下, 這條規則本來就給「對」的答案。
    // 🔴🔴 **⇒ 這一格真正在講的事**:`count` 是一個**會動的量**, 而拿它當**語意判準**
    //    ⇒ **落點會在沒有人改碼的日子裡自己翻。** 而那對「那 16 個修好了」這個放行條件是承重的:
    //    **它可以在沒有人碰它的情況下自己變回沒修好。**
    // 📎 而那個「答案」自己也站不住:`車頭罩與大燈罩` 的父是 `碳纖維部品`(碳纖維頭罩)
    //    ⇒ 客人打「大燈」被送去碳纖維罩, 未必比 `大燈與護網` 對。它被寫成正解只因為 78 > 63。
    expect(pickReal('大燈')).toBe('燈具與電子 · 大燈與護網');
  });

  it('🔴🔴 R3 抓到的【我造成的退步】—— 釘住它, 因為它現在是壞的', () => {
    // 🔬 **用真函式對正式站 117 個分類量到的**:
    //    打 `煞車` ⇒ 落 `拉桿與把手 · 煞車離合器拉桿`(**1,136** 件)
    //    而名字**就叫** `煞車系統` 的那個大類涵蓋 **398** 件(煞車皮 68 · 煞車碟盤 16 · 來令片 0)。
    // 🔴🔴 **舊規則(前綴)在這個詞上是【對的】** —— `煞車系統` 以「煞車」開頭 ⇒ 舊規則會給它。
    //    ⇒ 🛑 **所以這是本片造成的退步, 不是本來就有的洞。**
    // 🎯 **成因是系統性的**(R3 的話):**配件桶天然比本體桶大** ——
    //    拉桿的 SKU 數多過煞車皮, 貼紙多過儀表, 護蓋多過齒盤。
    //    ⇒ 「取涵蓋最大」在這一族上**穩定地挑錯邊**。
    // 🔬 同族還有(都用真函式量過, 都**不在**那 25 個裡):
    //    `齒盤` ⇒ 鏈條蓋與齒盤護蓋(157) 勝 齒盤與傳動(143) —— **14 件之差**讓「蓋子」贏「本體」
    //    `儀表` ⇒ 儀表保護貼(430) 勝 儀表與控制器(93)
    //    `蓋`   ⇒ 引擎護蓋與護桿(688) —— **一個字就吃到一顆膠囊**(`splitWords` 無最短詞長)
    // 🛑 **而修法是拍板題不是我能挑的**:改成「前綴優先」會修好 `煞車`/`齒盤`,
    //    **而它會把 `離合`/`管束`/`濾芯` 那幾個重新弄壞**(那些詞正是【不在前綴位置】才要修的)。
    //    ⇒ 📌 **兩邊互斥, 而選哪邊要有真實客人打過的字才判得出來 —— 而我們沒有在記。**
    //    ⇒ ✅ 已端主視窗(用 `煞車` 這一個詞問, 不用 25 個)。
    // 🛑 **這一格釘的是【現在這個壞掉的行為】** —— 不是因為它對, 是因為
    //    **一個沒有被釘住的退步, 會在下一個人讀到「24/25」時消失在那個分數裡。**
    expect(pickReal('煞車')).toBe('拉桿與把手 · 煞車離合器拉桿');
  });

  it('🔴🔴 R2-C1 跨詞遮蔽:早出現的詞用模糊比對, 不准把晚出現的詞的【字典】吃掉', () => {
    // 🔬 R2 實測本片的缺陷:`護網` 用子字串先吃到 `大燈與護網` ⇒ `油箱貼` 那條字典從此讀不到
    //    (舊規則下 `護網` 不是任何分類名的前綴 ⇒ 輪得到 `油箱貼`)。
    // ✅ 修法是**兩趟**:全部詞先試「完全同名 + 字典」, 都沒有才輪到模糊比對。
    // 🛑 所以這一句的答案要是**字典那個**, 不是 `大燈與護網`。
    const r = parseSearchFacets('護網 油箱貼', REAL_SRC);
    expect(r.category).toBe('止滑貼與保護膜 · 油箱止滑貼');
    expect(r.usedSynonyms.map((x) => x.from)).toEqual(['油箱貼']);
  });

  it('🔴🔴 R2-C2 模糊比對不准落到【0 件】的分類, 而且不准吃掉那個詞', () => {
    // 🔬 R2 實測:`來令` 子字串命中 `煞車皮(來令片)`, 而那個分類 **0 件**
    //    ⇒ 客人拿到一頁空的, **而那個詞被吃掉了**(leftover 空)⇒ 他連「我打的字沒被用到」都看不到。
    // 📌 **一顆送到空分類的膠囊, 比一顆都沒有糟** —— 沒有膠囊至少還有全文搜尋那條退路。
    const r = parseSearchFacets('來令', REAL_SRC);
    expect(r.category).toBeNull();
    expect(r.leftover).toEqual(['來令']);
  });
});

// ⟦search-BRANDSLUGHYPHEN⟧ 2026-09-06:多字品牌打全名。
//
// 🔬 **分母不是我挑的** —— 正式庫 `brands` 表 `name ~ '\s'` 全撈, **12 筆一個不漏**。
//   改法之前逐一過同一支解析器:**認得 8 / 不認得 4**(`CNC RACING` · `FRONT 3D` ·
//   `GB RACING` · `RPM CARBON` —— 它們的 slug **帶連字號或等於整句**, 而舊碼只比單字)。
// 🛑 **而那 8 個「認得」的 leftover 期望【也改了】** —— 改成空。
//   理由:`RACING` / `PARTS` / `FILTERS` 那些字**本來就被用到了**(它們是品牌名的一部分),
//   舊的 leftover 是**比對單位選錯**的副產物, 不是一個該保留的行為。
describe('⟦search-BRANDSLUGHYPHEN⟧ 多字品牌打全名 ⇒ 整句先比一次', () => {
  const MULTIWORD: ReadonlyArray<readonly [string, string]> = [
    ['BONAMICI RACING', 'bonamici'], ['CNC RACING', 'cnc-racing'], ['DBK SPECIAL PARTS', 'dbk'],
    ['DNA FILTERS', 'dna'], ['EBC BRAKES', 'ebc'], ['EVOTECH PERFORMANCE', 'evotech'],
    ['EXTREME COMPONENTS', 'extreme'], ['FRONT 3D', 'front3d'], ['GB RACING', 'gb-racing'],
    ['GILLES TOOLING', 'gilles'], ['RPM CARBON', 'rpm-carbon'], ['SAMCO SPORT', 'samco'],
  ];
  const src = {
    motoBrands: [],
    categories: [],
    brands: MULTIWORD.map(([name, id]) => ({ id, name })),
  } as never;

  it('🔴 12 筆全部認得, 而且 leftover 全部是空的(改法之前是 8/12, 且 8 個都留字)', () => {
    const miss: string[] = [];
    const withLeftover: string[] = [];
    for (const [name, id] of MULTIWORD) {
      const p = parseSearchFacets(name, src);
      if (!p.brandIds.includes(id)) miss.push(`${name}(期望 ${id})`);
      if (p.leftover.length > 0) withLeftover.push(`${name} ⇒ [${p.leftover.join(' ')}]`);
    }
    expect(miss, `這幾個打全名還是解不出品牌:${miss.join(' · ')}`).toEqual([]);
    expect(withLeftover, `這幾個還留著沒用到的字:${withLeftover.join(' · ')}`).toEqual([]);
  });

  it('🟢 正對照:一個【不在表上】的多字詞不得被認成品牌(證明上面不是無條件命中)', () => {
    // 🛑 少了這一格,「整句一律當品牌」也會讓上面那格全綠。
    const p = parseSearchFacets('NOT A BRAND', src);
    expect(p.brandIds).toEqual([]);
    expect(p.leftover).toEqual(['NOT', 'A', 'BRAND']);
  });

  it('🟢 正對照:品牌 + 額外的字 ⇒ 整句對不上 ⇒ 照舊逐字, 額外那個字留在 leftover', () => {
    // 📌 這一格釘住「整句比對【不會】把不相干的字一起吃掉」——
    //    那正是它與「任意子集比對」的差別(子集會產生一堆沒有客觀判準的候選)。
    const p = parseSearchFacets('GILLES 煞車', src);
    expect(p.brandIds).toEqual(['gilles']);
    expect(p.leftover).toEqual(['煞車']);
  });

  it('🔵 打【slug 那種寫法】也要中 —— 而它是靠 `b.name` 中的(折疊器剝掉連字號)', () => {
    // 🔬 **這一格的來歷值得記**:code-reviewer 2026-09-06 說「`b.id` 那一半沒有測試殺得死」,
    //    我補了這一格想守住它 ⇒ **突變實測:拿掉 `|| foldEquals(整句, b.id)` 之後全部照樣綠**
    //    ⇒ 📌 **這一格守不到那一半** —— 打 `cnc-racing` 與打 `CNC RACING` 折完是同一個字串,
    //       `b.name` 就中了。⇒ 那一半已經拿掉(見該處註解)。
    // ✅ **而這一格留著**:它釘的是「**兩種寫法都要中**」這個對外行為, 那與內部走哪一半無關。
    const p = parseSearchFacets('cnc-racing', src);
    expect(p.brandIds).toEqual(['cnc-racing']);
    expect(p.leftover).toEqual([]);
  });

  it('🔴 不相鄰的兩個字【不得】被接成品牌 —— 中間被吃掉的那個世界', () => {
    // 🛑 code-reviewer 2026-09-06 抓到的假命中:車款吃掉中間那個字之後,
    //    `unusedIdx = [0, 2]` 會被 join 成「FRONT 3D」—— 而那兩個字從來沒有相鄰過。
    //    🔵 `foldEquals` 分辨不出來(它剝掉所有分隔符)⇒ 必須在**組句之前**擋。
    const withVehicle = {
      motoBrands: [{ id: 'yamaha', name: 'Yamaha', models: [{ id: 'mt07', name: 'MT-07' }] }],
      categories: [],
      brands: [{ id: 'front3d', name: 'FRONT 3D' }],
    } as never;
    const p = parseSearchFacets('FRONT MT-07 3D', withVehicle);
    expect(p.vehicle, '車款那一段沒中 ⇒ 這一格證不到它要證的事').toBe('yamaha:mt07');
    expect(p.brandIds, '不相鄰的兩個字被接成了品牌').toEqual([]);
    expect(p.leftover).toEqual(['FRONT', '3D']);
  });

  it('🟢 回歸:單字品牌不受影響(整句 = 單字, 兩條路都會中, 而結果必須一樣)', () => {
    const single = { motoBrands: [], categories: [], brands: [{ id: 'rizoma', name: 'RIZOMA' }] } as never;
    const p = parseSearchFacets('RIZOMA', single);
    expect(p.brandIds).toEqual(['rizoma']);
    expect(p.leftover).toEqual([]);
  });
});
