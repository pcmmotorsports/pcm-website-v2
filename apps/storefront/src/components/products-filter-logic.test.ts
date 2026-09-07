// products-filter-logic 單元測試 — filterProducts / sortProducts 純函式。
//
// M-1-12 Codex finding 3 regression:品牌篩選改 id→name 解析後,hyphen id
// (cnc-racing / gb-racing)不再因 design 原 substring 模糊比對而誤判無結果。

import { describe, expect, it } from 'vitest';
import type { CascadeFilterState } from '@pcm/ui';
import { filterProducts, sortProducts, effectiveUnitPrice } from './products-filter-logic';
import { makeInitialExtraFilters } from './filter-state';
import { MOCK_PRODUCTS, type MockProduct } from '../data/mock-products';
import { MOCK_BRANDS } from '../data/mock-brands';

type Fitments = NonNullable<MockProduct['fitments']>;
function vp(id: number, brand: string, fitments: Fitments): MockProduct {
  return {
    id, slug: `p-${id}`, brand, name: `P${id}`, fits: 'x', price: 1000, origPrice: null,
    isNew: false, isSale: false, inStock: true, category: '碳纖維部品',
    color: 'silver', imgTone: 'neutral', fitments,
  };
}

const emptyCascade: CascadeFilterState = { vehicle: null, category: null, brands: [] };

describe('filterProducts', () => {
  it('should return all products when no filter is applied', () => {
    const result = filterProducts(MOCK_PRODUCTS, emptyCascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result).toHaveLength(MOCK_PRODUCTS.length);
  });

  it('should match brands by hyphen id (cnc-racing → "CNC RACING")', () => {
    const cascade: CascadeFilterState = { ...emptyCascade, brands: ['cnc-racing'] };
    const result = filterProducts(MOCK_PRODUCTS, cascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.brand === 'CNC RACING')).toBe(true);
  });

  it('should match brands by hyphen id (gb-racing → "GB RACING")', () => {
    const cascade: CascadeFilterState = { ...emptyCascade, brands: ['gb-racing'] };
    const result = filterProducts(MOCK_PRODUCTS, cascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.brand === 'GB RACING')).toBe(true);
  });

  it('brand 比對兩端 trim → 帶頭尾空白的 p.brand 仍命中(F2:防「側欄 count 說有、選了結果變少」靜默不一致)', () => {
    // 商品 brand 帶頭尾空白(未來髒資料);選取名(MOCK_BRANDS 'RPM CARBON')已乾淨 → 未 trim p.brand 會漏此商品
    const products = [vp(1, '  RPM CARBON  ', []), vp(2, 'GB RACING', [])];
    const cascade: CascadeFilterState = { ...emptyCascade, brands: ['rpm-carbon'] };
    const result = filterProducts(products, cascade, makeInitialExtraFilters(), MOCK_BRANDS);
    expect(result.map((p) => p.id)).toEqual([1]); // trim 後 '  RPM CARBON  ' 仍命中 rpm-carbon
  });

  it('should keep only in-stock products when inStock is set', () => {
    const result = filterProducts(
      MOCK_PRODUCTS,
      emptyCascade,
      { ...makeInitialExtraFilters(), inStock: true },
      MOCK_BRANDS,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.inStock)).toBe(true);
  });

  it('should filter by price range label', () => {
    const result = filterProducts(
      MOCK_PRODUCTS,
      emptyCascade,
      { ...makeInitialExtraFilters(), price: 'NT$ 0 – 3,000' },
      MOCK_BRANDS,
    );
    // 🔴🔴 **`every()` 對空陣列恆真**(2026-08-29 線C;⟦b4-MONEY4⟧ 分母體檢逼出來的)
    //    ~~原本這一格只有 `every(p => 0 <= p.price <= 3000).toBe(true)`~~
    //    ⇒ **篩選回傳 `[]` 時它照樣綠**, 而那是使用者看得到的功能壞掉。
    //    實測(把 `filterProducts` 改成 `return []`):舊版那一格【沒有被列為失敗】,
    //    改完之後紅在這裡 ⇒ 剛好一格從過變紅。
    //
    // 🔴🔴 **而我第一版的修法只堵了【端點】, 沒堵【中間帶】**(code-reviewer 2026-08-29 抓到):
    //    我原本加的是 `expect(result.length).toBeGreaterThan(0)` ——
    //    它只擋「回傳全空」。而**回傳一個【錯的真子集】照樣全綠**:
    //      · 把價格表那格改成 [0, 2500] ⇒ 回傳 2 支 ⇒ length>0 ✅ 且 every(<=3000) ✅ ⇒ 綠
    //      · `<= hi` 改成 `< hi` ⇒ 沒有商品剛好 3000 ⇒ 兩端邊界零判別力
    //      · 誤加一道 inStock 過濾 ⇒ 這三支的 inStock 全是 true ⇒ 結果一字不變
    //    📌 **「兩個方向都堵了」這句話, 列完的只有兩個端點 —— 中間那一整段無人守。**
    // 🔴 而 reviewer 直說了我為什麼選那個較弱的:**因為它貼著隔壁 `:59` 抄比較好寫**,
    //    不是因為它比較對。而隔壁那一格用它是合理的(inStock 沒有天然的「應該剩哪幾支」),
    //    **這一格有** —— 本檔已有六格(`:49`/`:130`/`:135`/`:140`/`:146`/`:155`)是這個做法。
    // ⚠️ **代價明寫**:釘死 id 清單會與 MOCK_PRODUCTS 的內容耦合 ——
    //    新增一支 <=3000 的 mock 就會紅。而**那時本來就該回來看這一格**;
    //    本檔 `:27` 也已經是這種耦合, 不是本次引入的新負擔。
    expect(result.map((p) => p.id).sort((a, b) => a - b)).toEqual([11, 14, 16]);
  });
});

describe('filterProducts — vehicle 不在 client 過濾(S1 下推 DB、F4)', () => {
  // S1(2026-07-12):車款篩選走 server RPC(product_fitments ∪ effective 去重、繼承件也命中);
  // products prop 已是相容子集。舊 matchesVehicle(只認 direct)已移除 —— 本測試鎖「選了車
  // client 不再二次過濾」:若未來有人把 client vehicle 過濾加回來,繼承命中(fitments 沒有
  // 該子款字面的商品)會被靜默濾掉 = 74→124 回歸,此測試即紅。
  const extras = makeInitialExtraFilters();

  it('cascade.vehicle 有值 → 不過濾(server 已濾;繼承命中商品的 fitments 無該車字面仍保留)', () => {
    // 模擬繼承命中:商品 fitments 只標母款 MT-09、使用者選的是子款 MT-09 SP(server RPC 命中)
    const inheritedHit = [vp(1, 'BONAMICI', [{ motoBrand: 'Yamaha', modelCode: 'MT-09' }])];
    const r = filterProducts(
      inheritedHit,
      { ...emptyCascade, vehicle: { brand: 'Yamaha', model: 'MT-09 SP', year: 2021 } },
      extras,
      MOCK_BRANDS,
    );
    expect(r).toHaveLength(1);
  });

  it('未選車輛 → 全數保留(既有行為不變)', () => {
    const products = [
      vp(1, 'RPM CARBON', [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2020, yearEnd: 2022 }]),
      vp(2, 'RPM CARBON', []),
    ];
    const r = filterProducts(products, emptyCascade, extras, MOCK_BRANDS);
    expect(r).toHaveLength(2);
  });
});

describe('filterProducts — category(兩層階層 rollup、#212 子類)', () => {
  const cp = (id: number, category: string): MockProduct => ({ ...vp(id, 'RPM CARBON', []), category });
  // 1=別大類直掛;2=操控部品「大類直掛」(舊單層向後相容);3/4=操控部品底下子類(麵包屑);5=別大類子類
  const products = [
    cp(1, '碳纖維部品'),
    cp(2, '操控部品'),
    cp(3, '操控部品 · 腳踏後移'),
    cp(4, '操控部品 · 拉桿'),
    cp(5, '排氣系統 · 全段排氣'),
  ];
  const extras = makeInitialExtraFilters();
  const ids = (r: MockProduct[]) => r.map((p) => p.id).sort((a, b) => a - b);

  it('選大類 → rollup 涵蓋自身直掛 + 底下所有子類(前綴比對)', () => {
    const r = filterProducts(products, { ...emptyCascade, category: { mainId: 'x', main: '操控部品' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([2, 3, 4]); // 2 直掛 + 3/4 子類;不含 5(別大類、不因「操控部品」子字串誤命中)
  });

  it('選子類 → 精確比對「大類 · 子類」麵包屑(不涵蓋同大類其他子類/直掛)', () => {
    const r = filterProducts(products, { ...emptyCascade, category: { mainId: 'x', main: '操控部品', subId: 's', sub: '腳踏後移' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([3]);
  });

  it('未選分類 → 不因 category 過濾(全數保留)', () => {
    const r = filterProducts(products, emptyCascade, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([1, 2, 3, 4, 5]);
  });

  it('單層向後相容:選無子類大類「碳纖維部品」(商品直掛)= 精確比對', () => {
    const rpmAll = [cp(1, '碳纖維部品'), cp(2, '碳纖維部品'), cp(3, '碳纖維部品')];
    const r = filterProducts(rpmAll, { ...emptyCascade, category: { mainId: 'x', main: '碳纖維部品' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([1, 2, 3]);
  });

  it('category 過濾與 cascade.vehicle 並存時仍生效(vehicle 由 server 濾、category 留 client)', () => {
    const mixed: MockProduct[] = [
      { ...vp(1, 'RPM CARBON', [{ motoBrand: 'Ducati', modelCode: 'V4' }]), category: '操控部品 · 腳踏後移' },
      { ...vp(2, 'RPM CARBON', [{ motoBrand: 'BMW', modelCode: 'S1000RR' }]), category: '排氣系統 · 全段排氣' },
    ];
    const r = filterProducts(mixed, { ...emptyCascade, category: { mainId: 'x', main: '操控部品' }, vehicle: { brand: 'Ducati' } }, extras, MOCK_BRANDS);
    expect(ids(r)).toEqual([1]); // category 濾掉 2;vehicle 不在 client 過濾(S1)
  });
});

describe('sortProducts', () => {
  it('should sort by price ascending', () => {
    const result = sortProducts(MOCK_PRODUCTS, 'price-asc');
    // 🔴 同一族的第二個形狀, 而它【不是 every()】(code-reviewer 2026-08-29 掃到, 我沒掃到):
    //    下面是一個 for 迴圈 ⇒ **`result` 是 [] 或掉了商品時, 迴圈零次迭代 ⇒ 零斷言 ⇒ 綠。**
    //    📌 我這一輪掃的字集是 `every(`, 而**它的病不長那個樣子** ——
    //       「零次迭代也算過」與「空集合恆真」是同一件事的兩種寫法。
    //    ⚠️ 而下面 `:176` 那格的 toEqual 擋不到它 —— 那是**另一個 case 分支**(recommend)。
    expect(result).toHaveLength(MOCK_PRODUCTS.length);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.price).toBeGreaterThanOrEqual(result[i - 1]!.price);
    }
  });

  it('should leave order unchanged for recommend', () => {
    const result = sortProducts(MOCK_PRODUCTS, 'recommend');
    expect(result.map((p) => p.id)).toEqual(MOCK_PRODUCTS.map((p) => p.id));
  });
});

// ══ ⟦b4-DEALERSIGNUPUNSEEN⟧ 第二半:篩選與排序要吃【經銷會員自己那個價】 ══
//   🔴🔴 **而下面這一組【不構成正式行為的證據】** —— 本檔測的那兩支函式在正式頁面上
//      沒有呼叫者(`ProductsPage.tsx:288`:server 已篩選排序分頁, 禁止 client 二次篩選)。
//      ⇒ 📌 它們守的是 design 對齊的那條路, **不是客人實際走的那條**。真修法在 server 查詢。
//   🔴 每一格都問**兩個世界**:壞世界(沒吃經銷價)要紅 · 好世界(吃了)要通且值真的不同。
//      只驗一個方向會全綠 —— **把功能整個關掉也通過**。
describe('經銷價:篩選與排序吃有效價(⚠️ 這條路正式頁不走 —— 見本函式檔檔頭)', () => {
  // 牌價 12,000(落在 10,000-30,000 桶)· 經銷價 4,800(落在 3,000-10,000 桶)
  const dealerish = (): MockProduct & { dealerPrice?: number } => ({
    ...vp(901, 'LIGHTECH', []),
    price: 12000,
    dealerPrice: 4800,
  });

  it('🔴 經銷選 3,000-10,000 ⇒ 看得到那個 4,800(壞世界:用牌價 12,000 ⇒ 撈不到)', () => {
    const out = filterProducts([dealerish()], emptyCascade, { ...makeInitialExtraFilters(), price: 'NT$ 3,000 – 10,000' }, MOCK_BRANDS);
    expect(out).toHaveLength(1);
  });

  it('🔵 反方向:同一件在 10,000-30,000 桶【不該】出現(否則上一格只是「什麼都撈得到」)', () => {
    const out = filterProducts([dealerish()], emptyCascade, { ...makeInitialExtraFilters(), price: 'NT$ 10,000 – 30,000' }, MOCK_BRANDS);
    expect(out).toHaveLength(0);
  });

  it('🟢 而一般會員(沒有 dealerPrice)照舊落在 10,000-30,000 —— 保護沒有把功能關掉', () => {
    const general = { ...dealerish() };
    delete (general as { dealerPrice?: number }).dealerPrice;
    const hit = filterProducts([general], emptyCascade, { ...makeInitialExtraFilters(), price: 'NT$ 10,000 – 30,000' }, MOCK_BRANDS);
    expect(hit).toHaveLength(1);
  });

  it('🔴 price-asc 用有效價排 —— 經銷那件(4,800)要排在牌價 9,000 那件前面', () => {
    const cheap: MockProduct = { ...vp(902, 'RPM', []), price: 9000 };
    const sorted = sortProducts([cheap, dealerish()], 'price-asc');
    expect(sorted.map((p) => p.id)).toEqual([901, 902]);
  });

  it('🔵 而拿掉 dealerPrice 之後順序【要翻過來】(證明上一格量的是經銷價不是 id 順序)', () => {
    const cheap: MockProduct = { ...vp(902, 'RPM', []), price: 9000 };
    const noDealer = { ...dealerish() };
    delete (noDealer as { dealerPrice?: number }).dealerPrice;
    const sorted = sortProducts([cheap, noDealer], 'price-asc');
    expect(sorted.map((p) => p.id)).toEqual([902, 901]);
  });

  it('🔴 真 0 元是合法價 —— 判準是「在不在」不是「> 0」', () => {
    expect(effectiveUnitPrice({ price: 12000, dealerPrice: 0 })).toBe(0);
  });

  it('🔵 而 undefined 才退回牌價(上一格若用 `> 0` 這裡也會過 ⇒ 兩格一起才分得開)', () => {
    expect(effectiveUnitPrice({ price: 12000 })).toBe(12000);
  });

  it('🛑 price 是 null(查不到價)⇒ 回 null, 不偽造成 0 元', () => {
    expect(effectiveUnitPrice({ price: null })).toBeNull();
  });

  it('🛑 而查不到價的那件排序恆在最後 —— 兩個方向都是', () => {
    const unknown = { ...vp(903, 'RPM', []), price: null as unknown as number };
    const normal: MockProduct = { ...vp(904, 'RPM', []), price: 5000 };
    expect(sortProducts([unknown, normal], 'price-asc').map((p) => p.id)).toEqual([904, 903]);
    expect(sortProducts([unknown, normal], 'price-desc').map((p) => p.id)).toEqual([904, 903]);
  });
});
