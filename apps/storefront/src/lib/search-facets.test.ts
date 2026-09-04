import { describe, expect, it } from 'vitest';

import { filterFacets, SEARCH_FACET_LIMIT } from './search-facets';
import type { MockBrand } from '@/data/mock-brands';
import type { MockCategory } from '@/data/mock-categories';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

// search-facets.test.ts — ⟦搜尋-第2刀⟧ 2a
//
// 🔴 **本檔最承重的不是「有沒有過濾到」, 是【三個 failed 各自一格】。**
//    合成一個(`failed: a || b || c`)在型別上完全合法、在多數測試下全綠
//    ——(因為多數測試只造【一區失敗】的世界)⇒ 所以那一格要用一個
//    **三區狀態互不相同**的世界去問, 而不是三個各自的世界。

function brand(id: string, name: string): MockBrand {
  return {
    id,
    name,
    count: 3,
    country: 'IT',
    tagline: '',
    since: 2000,
    hero: '',
    logo: '',
    logoBg: '',
  };
}
function category(id: string, name: string): MockCategory {
  return { id, name, count: 5, children: [] };
}
function moto(id: string, name: string, models: Array<[string, string]>): MockMotoBrand {
  return { id, name, models: models.map(([mid, mname]) => ({ id: mid, name: mname, years: [] })) };
}

function data(over: {
  brands?: MockBrand[];
  categories?: MockCategory[];
  motoBrands?: MockMotoBrand[];
  failed?: { brands?: boolean; categories?: boolean; vehicles?: boolean };
} = {}) {
  return {
    brands: { brands: over.brands ?? [], failed: over.failed?.brands ?? false },
    categories: { categories: over.categories ?? [], failed: over.failed?.categories ?? false },
    vehicles: { motoBrands: over.motoBrands ?? [], failed: over.failed?.vehicles ?? false },
  };
}

describe('filterFacets', () => {
  it('should match a brand by its name or its id', async () => {
    const res = filterFacets('akra', data({ brands: [brand('akrapovic', 'Akrapovič'), brand('x', 'Other')] }));
    expect(res.brands.map((b) => b.id)).toEqual(['akrapovic']);

    const byId = filterFacets('akrapov', data({ brands: [brand('akrapovic', '別的名字')] }));
    expect(byId.brands).toHaveLength(1);
  });

  it('should match a vehicle when either the model name or the brand name hits', async () => {
    // 稿 :47-54 逐字:model 名或 brand 名【任一】命中就算
    // ⇒ 打「YAMAHA」要撈得出它旗下的車款, 不是只有名字裡有 YAMAHA 的型號。
    const bikes = [moto('yamaha', 'YAMAHA', [['r1', 'YZF-R1'], ['mt09', 'MT-09']])];

    expect(filterFacets('yamaha', data({ motoBrands: bikes })).vehicles).toHaveLength(2);
    expect(filterFacets('mt-09', data({ motoBrands: bikes })).vehicles).toHaveLength(1);
  });

  it('should cap every section at the number the design uses', async () => {
    // 🔴 那個 6 是【視覺決定】(疊層裡塞得下幾列)—— 稿 SearchOverlay.jsx :40/46/57 `.slice(0, 6)`。
    //    有人日後改大它 ⇒ 疊層會長到看不完, 而那是 Sean 的板不是我們的。
    const many = Array.from({ length: 20 }, (_, i) => brand(`b${i}`, `Brembo ${i}`));
    const cats = Array.from({ length: 20 }, (_, i) => category(`c${i}`, `Brembo ${i}`));
    const bikes = [moto('m', 'Brembo', Array.from({ length: 20 }, (_, i) => [`x${i}`, `M${i}`] as [string, string]))];

    const res = filterFacets('brembo', data({ brands: many, categories: cats, motoBrands: bikes }));

    expect(res.brands).toHaveLength(SEARCH_FACET_LIMIT);
    expect(res.categories).toHaveLength(SEARCH_FACET_LIMIT);
    expect(res.vehicles).toHaveLength(SEARCH_FACET_LIMIT);
  });

  it('should keep the three failed flags apart', async () => {
    // 🔴🔴 **本檔的核心一格。** 三區狀態【互不相同】—— 合成一個的實作在這裡一定紅:
    //    `a || b || c` ⇒ 三格都變 true;`a && b && c` ⇒ 三格都變 false。
    const res = filterFacets(
      'x',
      data({ failed: { brands: true, categories: false, vehicles: true } }),
    );

    expect(res.failed).toEqual({ brands: true, categories: false, vehicles: true });
  });

  it('should still report the flags when the query is empty (unit-only path)', async () => {
    // 🛑 **本格守的是【純函式自己的契約】, 不是正式路徑** ——
    //    `route.ts:61` 在空 `q` 時就 return 了(R1:搜尋框剛打開不該把 DB 叫醒)
    //    ⇒ 這個分支**只有單元測試到得了**(`-c7` 2026-09-02 R1 抓到)。
    //    📌 而寫清楚它, 是因為一發綠的測試守著一段到不了的碼,
    //       在覆蓋率上與真的守住長得一模一樣。
    // 🔴 而它仍然要帶旗標:短路掉結果, 不可以順手短路掉「沒查」這件事。
    const res = filterFacets('   ', data({ failed: { brands: true } }));

    expect(res.brands).toEqual([]);
    expect(res.failed.brands).toBe(true);
  });

  it('should look identical in results but not in flags when a section could not be read', async () => {
    // 🔴 「這次查不到」與「沒有符合的」⇒ **結果都是空陣列**,
    //    而唯一分得開它們的東西就是那個旗標 ⇒ 這一格釘的是【那個旗標是唯一的判別依據】。
    const couldNotRead = filterFacets('brembo', data({ failed: { categories: true } }));
    const nothingMatched = filterFacets('brembo', data({ categories: [category('a', '別的')] }));

    expect(couldNotRead.categories).toEqual(nothingMatched.categories); // 兩個世界的【結果】相同
    expect(couldNotRead.failed.categories).not.toBe(nothingMatched.failed.categories); // 而旗標不同
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 品牌那一區改用 `foldIncludes`(2026-09-04 線【身分】`-auth`)
  //    每一格都對應線上量到的一個真實缺口, 不是我想出來的形狀:
  //    `~/pcm-mailbox/量-品牌打錯字-20260904-auth.md`
  // ══════════════════════════════════════════════════════════════════════
  it('🔴 去掉分隔符也要中(eazigrip / cncracing —— 線上這兩格今天是 0)', () => {
    const d = data({ brands: [brand('eazi-grip', 'EAZI-GRIP'), brand('cnc-racing', 'CNC RACING')] });
    expect(filterFacets('eazigrip', d).brands.map((b) => b.id)).toEqual(['eazi-grip']);
    expect(filterFacets('cncracing', d).brands.map((b) => b.id)).toEqual(['cnc-racing']);
  });

  it('🔴 分隔符【換一種】也要中(eazi grip —— 線上這格商品有 8 筆而膠囊是空的)', () => {
    const d = data({ brands: [brand('eazi-grip', 'EAZI-GRIP')] });
    // 🛑 這一格修的不只是「少一顆膠囊」, 是**兩層對同一個輸入給相反的答案**。
    expect(filterFacets('eazi grip', d).brands.map((b) => b.id)).toEqual(['eazi-grip']);
  });

  it('🔴 重音要折掉 —— 而它要靠【名字】中, 不可以只靠 slug 剛好長對', () => {
    // 🎯 線上今天 `akrapovic` 會中, 而**那是因為 slug 就叫 akrapovic** ——
    //    名字那一半實測 `name ILIKE '%akrapovic%'` ⇒ 0 筆(Č ≠ C)。
    //    ⇒ 這裡把 slug 換成一個對不上的字, 逼它非靠名字不可。
    const d = data({ brands: [brand('zzz-slug-does-not-help', 'AKRAPOVIČ')] });
    expect(filterFacets('akrapovic', d).brands).toHaveLength(1);
  });

  it('🟢 負對照:編造的品牌字仍然 0 —— 折兩端【不是】變成模糊比對', () => {
    const d = data({ brands: [brand('akrapovic', 'AKRAPOVIČ'), brand('lightech', 'LIGHTECH')] });
    expect(filterFacets('zzqbrandnotreal', d).brands).toEqual([]);
    // 🔴 而**打錯一個字母照樣 0** —— 那一半要 pg_trgm, 不在本片。
    //    寫成會紅的斷言, 免得有人把「今天做到哪」讀成「已經模糊比對了」。
    expect(filterFacets('akrpovic', d).brands, 'akrpovic 中了 ⇒ 有人偷偷加了模糊比對, 那要另外驗').toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 **2026-09-04 Sean 第十七題拍甲 ⇒ 三區都折。而這一段原本是【相反的斷言】**
  //    ⛔ ~~「分類與車種那兩區行為不變 —— 它們是另一個分母, 本片刻意不動」~~
  //    ⇒ 那時我停下來問(因為同日另一板寫著「全部不改」), 他回「甲 = 要」⇒ 三區照做。
  //    📌 **兩板管的不是同一件事**:那一板管【過度命中】(R6 跑出 CBR600, 維持不改);
  //       第十七題管【命中不足】(eazigrip 找不到 EAZI-GRIP)。
  // ══════════════════════════════════════════════════════════════════════
  it('🔴 分類那一區也要折(`slipon` 對 `尾段排氣管(Slip-On)`)', () => {
    const d = data({ categories: [{ id: 'c1', name: '尾段排氣管(Slip-On)', count: 1 } as never] });
    expect(filterFacets('slipon', d).categories).toHaveLength(1);
    // 🟢 正對照:沒折也會中的那一種仍然要中 —— 否則上面那格與「什麼都中」印同一個綠。
    expect(filterFacets('尾段排氣管', d).categories).toHaveLength(1);
    // 🔵 負對照:不相干的字仍然 0。
    expect(filterFacets('zzq不存在的分類', d).categories).toEqual([]);
  });

  it('🔴 車款那一區也要折(`mt07` 對 `MT-07`)', () => {
    const d = data({
      motoBrands: [{ id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt-07', name: 'MT-07' }] } as never],
    });
    expect(filterFacets('mt07', d).vehicles).toHaveLength(1);
    expect(filterFacets('zzq不存在的車', d).vehicles).toEqual([]);
  });

  // 🔴🔴 **正對照用【正式庫真的有的那一對】—— 不是我編的形狀。**
  //    2026-09-04 正式庫唯讀 + 拿【真的】`foldSearchTerm` 跑 3,536 個「品牌×車款」配對:
  //    折後撞名 **16 組, 而 16 組全部同一個品牌**(跨品牌 0)⇒ 那是**同一台車的兩種寫法**。
  //    🎯 而 Sean 要的就是「兩種寫法都中」⇒ 這一格把它釘住。
  it('🔴 同一台車的兩種寫法(NC 700 S / NC700S)⇒ 折後【兩筆都要中】', () => {
    const d = data({
      motoBrands: [
        {
          id: 'honda',
          name: 'Honda',
          models: [
            { id: 'nc-700-s', name: 'NC 700 S' },
            { id: 'nc700s', name: 'NC700S' },
          ],
        } as never,
      ],
    });
    expect(filterFacets('nc700s', d).vehicles.map((v) => v.modelName).sort()).toEqual(['NC 700 S', 'NC700S']);
  });

  // 🛑🛑 **而 `+` 那一族【不可以】被折在一起 —— 它們是不同的車。**
  //    `Tracer 9 GT`(226 件)與 `Tracer 9 GT+`(48 件)是兩台車, 而 `foldSearchTerm` 不剝 `+`。
  //    ⇒ 這一格會在有人「順手」把 `+` 加進剝除字元集的那一刻紅。
  it('🔴 `+` 不得被折掉 —— Tracer 9 GT 與 Tracer 9 GT+ 是【不同的車】', () => {
    const d = data({
      motoBrands: [
        {
          id: 'yamaha',
          name: 'YAMAHA',
          models: [
            { id: 'tracer-9-gt', name: 'Tracer 9 GT' },
            { id: 'tracer-9-gt-plus', name: 'Tracer 9 GT+' },
          ],
        } as never,
      ],
    });
    // 打帶 `+` 的那個 ⇒ 只該中它自己
    expect(filterFacets('tracer 9 gt+', d).vehicles.map((v) => v.modelName)).toEqual(['Tracer 9 GT+']);
  });

});

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **子分類那一層**(`⟦search-CATNAMEQUERY⟧` 2026-09-05 · 線【身分】`-auth`)
// ══════════════════════════════════════════════════════════════════════════
//   🔬 病是量到的:正式站打**子分類全名**⇒ 商品 0 筆、分類區 `[]`,
//     而 `failed.categories = false` ⇒ **那一腿跑了且沒壞, 是真的沒對到。**
//   🛑 **這四個名字不是我編的** —— 逐字取自
//     `docs/specs/2026-07-11-category-taxonomy-v1-draft.md:30/31/36`,
//     件數 1,064 / 5,120 / 1,229 / 567 ⇒ **它們是有貨的真子類, 不是空殼。**
describe('filterFacets — 子分類那一層(⟦search-CATNAMEQUERY⟧)', () => {
  /** 逐字照正式庫的層級關係建:大類底下掛真的子類名。 */
  function withKids(id: string, name: string, kids: Array<[string, string, number]>): MockCategory {
    return {
      id,
      name,
      count: 100,
      children: kids.map(([kid, kname, kcount]) => ({ id: kid, name: kname, count: kcount })),
    };
  }
  const TREE: MockCategory[] = [
    withKids('c-protect', '車身防護與防摔', [
      ['s-slider', '車身防倒球與滑塊', 1064],
      ['s-engine', '引擎護蓋與護桿', 567],
    ]),
    withKids('c-bolt', '精品螺絲與螺帽', [['s-boltkit', '精品螺絲組', 5120]]),
    withKids('c-rider', '騎士用品與配件', [['s-phone', '手機架與導航支架', 1229]]),
    withKids('c-exhaust', '排氣系統', []),
  ];

  // 🔴 四個子類全名各一格 —— 用 `it.each` 是因為**四個字要分別紅**:
  //    塞成一格的話, 修好一個就綠了, 而另外三個的失敗被第一個遮住。
  it.each([
    ['車身防倒球與滑塊', '車身防護與防摔 · 車身防倒球與滑塊', 1064],
    ['引擎護蓋與護桿', '車身防護與防摔 · 引擎護蓋與護桿', 567],
    ['精品螺絲組', '精品螺絲與螺帽 · 精品螺絲組', 5120],
    ['手機架與導航支架', '騎士用品與配件 · 手機架與導航支架', 1229],
  ])('🔴 打子類全名 `%s` ⇒ 分類區要有它, 而 path 帶父類', (q, path, count) => {
    const hits = filterFacets(q, data({ categories: TREE })).categories;
    // 🛑 **只驗「有一格」不夠** —— 一個「把整棵樹都吐出來」的實作也會過。
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe(q);
    // 🔴 `path` 才是寫進 `?category=` 的東西, 而它**必須帶父類** ——
    //    只給短名的話那個網址撈不到東西(實測:不存在的子類路徑 ⇒ RSC 裡 0 個 slug)。
    expect(hits[0]!.path).toBe(path);
    expect(hits[0]!.count).toBe(count);
  });

  // 🟢🟢 **負對照 —— 打大類名不得把它底下的子類一起吐出來**
  //   📌 這一格擋的是「攤平之後 filter 太寬」那個世界:`車身防護與防摔` 是父類名,
  //     而子類的 `path` 裡**含有父類名** ⇒ 若哪天有人把 filter 改成比 `path`,
  //     這三格會一起中 ⇒ 疊層被自己的子類洗版。
  it('🟢 負對照:打大類 `車身防護與防摔` ⇒ 只回它自己, 不回兩個子類', () => {
    const hits = filterFacets('車身防護與防摔', data({ categories: TREE })).categories;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe('車身防護與防摔');
    // 🔴 大類的 `path` **逐字等於 `name`** ⇒ 大類那一區的行為一個字都沒變。
    expect(hits[0]!.path).toBe('車身防護與防摔');
  });

  // 🟢 **正對照:改之前就會中的那些, 現在還要中**(回歸)
  it('🟢 正對照:大類 `排氣` 仍然回 `排氣系統`(這是改之前就成立的行為)', () => {
    const hits = filterFacets('排氣', data({ categories: TREE })).categories;
    expect(hits.map((c) => c.path)).toEqual(['排氣系統']);
  });

  // 🔵 **同名子類不去重** —— `⟦search-DUPCATNAMES⟧` 記著正式站有三組同名分類。
  //   它們的 `path` 不同(父類不同)⇒ **兩格是兩個不同的落點, 合併會丟掉一個。**
  it('🔵 兩個父類底下有同名子類 ⇒ 兩格都要在, 而 path 不同', () => {
    const dup: MockCategory[] = [
      withKids('c-a', '甲大類', [['s-a', '維修零件', 10]]),
      withKids('c-b', '乙大類', [['s-b', '維修零件', 20]]),
    ];
    const hits = filterFacets('維修零件', data({ categories: dup })).categories;
    expect(hits).toHaveLength(2);
    expect(hits.map((c) => c.path)).toEqual(['甲大類 · 維修零件', '乙大類 · 維修零件']);
  });

  // 🔴 **`children` 缺席不得炸掉** —— `filterFacets` 是公開純函式, 它對自己的輸入負責。
  //   🎯 它壞掉的樣子:throw ⇒ `/api/search` 整發炸掉 ⇒ **疊層全空**(不是少一區)。
  it('🔴 分類物件沒有 children ⇒ 不得 throw, 大類那一半照常回', () => {
    const noKids = [{ id: 'c-x', name: '排氣系統', count: 5 } as unknown as MockCategory];
    expect(() => filterFacets('排氣', data({ categories: noKids }))).not.toThrow();
    expect(filterFacets('排氣', data({ categories: noKids })).categories).toHaveLength(1);
  });
});
