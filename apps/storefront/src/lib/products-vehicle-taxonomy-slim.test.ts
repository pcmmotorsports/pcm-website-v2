// @vitest-environment node
//
// products-vehicle-taxonomy-slim.test.ts —— 車款樹瘦身(⟦db-TAXONOMYVIEW⟧ :2550)的守門。
//
// 🔬 **為什麼有這一片**:正式站實測 `get_vehicle_taxonomy` 一發回 **12,503 列 / 443 KB**,
//   而 DB 那一段只花 1,225.7 ms(EXPLAIN ANALYZE)⇒ **約 3.3 秒花在搬東西, 不是查東西。**
//   而首屏畫面只用得到 69 個牌子、server 的搜尋解析只用得到 3,770 組「牌子+車款」——
//   **年份那 8,733 列(70%)要等客人選了車款才有人看。**
//
// 🛑 **這一片為什麼是【新增兩支】而不是【給舊那支加參數】** —— 這一段不要刪, 刪了下一個人會改回去:
//   加參數那一版(甲″)撞到 `lib/single-flight-stale.ts:13-18` 一個硬約束 ——
//   它吃的是**零參數** loader、而且只記**一份**值(`let last`)⇒ 參數一旦會變,
//   那一層會把【A 牌子的年份】發給【問 B 牌子的人】。
//   🔴 **而那是【靜默的錯資料】**:typecheck 綠、測試綠、沒有任何東西會叫。
//
// 🔴 本檔三格守的東西, 壞掉【都不會紅也不會 crash】:
//   ① base 那支撈錯來源 ⇒ 年份憑空出現/消失, 而畫面照樣有東西
//   ② years 那支沒把牌子送進去 ⇒ 每個牌子拿到同一份年份
//   ③ per-brand 快取鍵沒接對 ⇒ 第二個牌子拿到第一個牌子的年份(主視窗 2026-09-20 指定加這一格)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

let rpcPayload: unknown = { n: 0, rows: [] };
let rpcError: { message: string } | null = null;
/** 每一發的 `[函式名, 參數]` —— ②③ 兩格的主詞就是這個。 */
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
/** 依函式名 + 參數決定要回什麼(③ 那格用它演「兩個牌子兩份年份」)。 */
let rpcRouter: ((fn: string, args: unknown) => unknown) | null = null;

const client = {
  rpc(fn: string, args?: unknown) {
    rpcCalls.push({ fn, args: args ?? null });
    if (rpcError) return Promise.resolve({ data: null, error: rpcError });
    const routed = rpcRouter ? rpcRouter(fn, args ?? null) : undefined;
    return Promise.resolve({ data: routed ?? rpcPayload, error: null });
  },
};

vi.mock('@pcm/adapters', () => ({
  createSupabaseAnonClient: () => client,
  SupabaseProductAdapter: class {},
  availabilityToBool: () => true,
}));

// unstable_cache 直通 —— 本檔測的是快取【內側】每一發怎麼組。
// ⛔ ~~快取鍵本身的守門在 route 那一層(`vehicle-models/route.test.ts`)~~
//   🔴 **2026-09-20 R1 N1:那句是假的。** 那支檔【在】, 而它 5 格全是 400 / 404 / 503 / s-maxage,
//   **沒有一格碰 per-brand 的快取鍵** ⇒ 我指到了一個不存在的守門。
//   ✅ **改法選【補一格】不是【改字】** —— 改字只是把謊拿掉, 補那一格才是把它變成真的。
//   ⇒ 那一格在下面「N1」。
// 🔴 直通, **而且記下 keyParts** —— N1 那一格要的就是這個:
//   `unstable_cache` 的鍵由 `keyParts` 組(next `unstable-cache.js` 逐字
//   `${cb.toString()}-${Array.isArray(keyParts) && keyParts.join(',')}`)
//   ⇒ 牌子沒進 keyParts = 每個牌子共用一把鍵 = 那個【靜默錯資料】。
// 🛑 `vi.mock` 會被提到檔頭 ⇒ 它的工廠讀不到下面用 `let` 宣告的變數
//   (實撞:`ReferenceError: Cannot access 'cacheKeyParts' before initialization`)
//   ⇒ 用 `vi.hoisted` 把它一起提上去。
const hoisted = vi.hoisted(() => ({ cacheKeyParts: [] as string[][] }));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown, keyParts?: string[]) => {
    if (Array.isArray(keyParts)) hoisted.cacheKeyParts.push(keyParts);
    return fn;
  },
}));
vi.mock('@/lib/single-flight-stale', () => ({
  singleFlightStale: (fn: () => Promise<unknown>) => fn,
}));

import {
  fetchVehicleTaxonomy,
  fetchVehicleTaxonomyBase,
  fetchVehicleYearsForBrand,
} from '@/lib/products';

function row(b: string | null, m: string | null, ys: number | null, ye: number | null) {
  return [b, m, ys, ye];
}
function payload(rows: ReturnType<typeof row>[], n?: number) {
  return { n: n ?? rows.length, rows };
}

beforeEach(() => {
  hoisted.cacheKeyParts = [];
  rpcPayload = payload([]);
  rpcError = null;
  rpcCalls = [];
  rpcRouter = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('⟦db-TAXONOMYVIEW⟧ 車款樹瘦身', () => {
  it('🔴 ① base 那一發走 get_vehicle_taxonomy_base, 而且【不帶參數】(零參數才進得了既有那兩層快取)', async () => {
    rpcPayload = payload([row('Yamaha', 'MT-07', null, null)]);

    const out = await fetchVehicleTaxonomyBase();

    expect(rpcCalls.map((c) => c.fn)).toEqual(['get_vehicle_taxonomy_base']);
    expect(rpcCalls[0]?.args).toBeNull();
    expect(out[0]?.models[0]?.name).toBe('MT-07');
    // 🔵 base 不帶年份 ⇒ 年份是空的, 而那【不是壞掉】:走既有語意
    //   (`products-vehicle-taxonomy.test.ts:149`「year_start = null ⇒ 該列不貢獻年份」)。
    expect(out[0]?.models[0]?.years).toEqual([]);
  });

  // 🔴 **送進去的是【牌子的名字】不是 slug id** —— 這一格的字面不要「順手改成 id」:
  //   `lib/vehicle-taxonomy.ts:116` 逐字 `id: uniqueId(slugify(brandName), usedBrandIds)`
  //   ⇒ id 是 **TS 這一側算出來的**(而且撞名會加序號)⇒ SQL 那一端**還原不回去**。
  //   ⇒ 呼叫端手上已經有底盤樹, 由它把 id 換成 name 再送 —— 那是唯一一個兩邊都同意的字面。
  it('🔴 ② years 那一發要把【牌子的名字】送進去 —— 沒送 = 每個牌子拿到同一份年份', async () => {
    rpcPayload = payload([row('Honda', 'CBR1000RR', 2020, 2021)]);

    await fetchVehicleYearsForBrand('Honda');

    expect(rpcCalls.map((c) => c.fn)).toEqual(['get_vehicle_model_years']);
    expect(rpcCalls[0]?.args).toEqual({ p_brand: 'Honda' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 下面三格是 R1 對抗審查(2026-09-20)指定補的 —— 而**補它們的理由要留著**:
  //   上面 ①②③ 三格**餵不到** M1/M2 那兩個壞法(②③ 只餵【閉區間】2020-2021 / 2014-2015)
  //   ⇒ 📌 **那才是那兩個 must-fix 躲過三綠的原因** —— 不是三綠壞了, 是【沒有一格餵得到它】。
  // ══════════════════════════════════════════════════════════════════════════

  it('🔴 M1 年份那支【不准】回 null year_end —— 上界是 SQL 的責任, TS 這端看不到全站最大年', async () => {
    // 🔴🔴 **這一格的形狀被我改過一次, 改的理由留著**:
    //   ⛔ ~~第一版我在這裡斷言「年份要展到全站上界」~~ ⇒ **TS 這一端做不到那個判斷** ——
    //   `vehicle-taxonomy.ts:57-63` 的 `maxYear` 是【從餵進去那批列】算的, 而 per-brand 只餵一個牌子
    //   ⇒ 它**結構上不知道**全站最大年是多少。上界只能由 SQL 給。
    //   ✅ **所以 TS 這一端該守的是【契約】不是【數值】**:年份那支回來的列不可以還帶 null year_end。
    //   🎯 而那正好是一道**雙向**的閘:SQL 哪天不再 COALESCE ⇒ 這一格會紅, 不會靜靜縮水。
    //   📌 真正的數值靶在 migration 的事後斷言裡(那一端才知道全站最大年)。
    rpcRouter = (fn, args) =>
      fn === 'get_vehicle_model_years' &&
      (args as { p_brand?: string } | null)?.p_brand === 'Honda'
        ? payload([row('Honda', 'CBR1000RR', 2014, null)]) // ← 沒被 COALESCE 過的那一種
        : undefined;

    await expect(fetchVehicleYearsForBrand('Honda')).rejects.toThrow(/year_end/);
  });

  it('🔴 M2 牌子字面對不上 ⇒ 要【大聲】, 不可以回一棵空樹', async () => {
    // 🔬 正式庫實測(2026-09-20):今天 btrim(lower()) 分 69 群, 群內多字面 **0**、
    //   未 trim 的列 **0** ⇒ 這個壞法【今天不存在】。
    // 🛑 **而那是【現況】不是【約束】** —— view 上沒有任何東西擋下一筆 `'Honda '`。
    //   ⇒ 📌 「今天 0」與「不會發生」是兩件事, 這一格守的是後者。
    // 🔴 而它今天的壞法是【靜默】:n=0 過得了形狀驗證 ⇒ 那個牌子年份整個空而沒有東西會叫。
    // 🔬 靶的形狀就是審查舉的那一個:view 裡是 `'Honda '`(尾空白),
    //   而底盤樹的 name 被 `vehicle-taxonomy.ts:72` `trim()` 過 ⇒ 呼叫端送 `'Honda'`
    //   ⇒ migration `WHERE v.moto_brand = p_brand` 原字面等值 ⇒ **0 列**。
    rpcRouter = (fn, args) => {
      if (fn !== 'get_vehicle_model_years') return undefined;
      // 只有【原字面】對得上才有資料 —— 呼叫端送的是 trim 過的那個
      return (args as { p_brand?: string } | null)?.p_brand === 'Honda '
        ? payload([row('Honda ', 'CBR1000RR', 2020, 2021)])
        : payload([]);
    };

    await expect(fetchVehicleYearsForBrand('Honda')).rejects.toThrow();
  });

  it('🔴 N5 空的牌子名 ⇒ 要紅, 不可以靜靜回一棵空樹', async () => {
    rpcRouter = (fn) => (fn === 'get_vehicle_model_years' ? payload([]) : undefined);

    await expect(fetchVehicleYearsForBrand('')).rejects.toThrow();
  });

  it('🔴 M1 對帳:同一台【開放式】的車, 舊那支與新那支要給出【逐字相同】的 years', async () => {
    // 🛑 **這一格證的是一句推論, 而不是讓我用讀的**(主視窗 2026-09-20 指定):
    //   「今天 `vehicle-taxonomy.ts:93` 的 maxYear 就是【餵進去那批列的最大年】,
    //     而今天餵的是【整張 view】⇒ 全表 max == 今天的 maxYear」
    //   📌 今晚每一個出事的地方都是「看起來顯然對的推論」⇒ 這一格把它變成讀數。
    const all = [
      row('Honda', 'CBR1000RR', 2014, null), // ← 開放式
      row('Honda', 'CB650R', 2016, 2016),
      row('Ducati', 'Monster', 2027, 2027), // ← 全站上界由【別的牌子】給
    ];
    rpcPayload = payload(all);
    const oldTree = await fetchVehicleTaxonomy();

    rpcRouter = (fn, args) =>
      fn === 'get_vehicle_model_years' &&
      (args as { p_brand?: string } | null)?.p_brand === 'Honda'
        ? // 🔵 修法讓 SQL 先把上界算好 ⇒ 這裡演的是「year_end 已經被 COALESCE 成全表 max」
          payload([row('Honda', 'CBR1000RR', 2014, 2027), row('Honda', 'CB650R', 2016, 2016)])
        : undefined;
    const newTree = await fetchVehicleYearsForBrand('Honda');

    const pick = (t: Awaited<ReturnType<typeof fetchVehicleTaxonomy>>) =>
      t.find((b) => b.name === 'Honda')?.models.find((m) => m.name === 'CBR1000RR')?.years;

    expect(pick(newTree)).toEqual(pick(oldTree));
  });

  it('🔴 N1 每個牌子要有【自己那把】unstable_cache 鍵 —— 共用一把 = 那個靜默錯資料', async () => {
    rpcPayload = payload([row('Honda', 'CBR1000RR', 2020, 2021)]);
    await fetchVehicleYearsForBrand('Honda');
    await fetchVehicleYearsForBrand('Yamaha');

    const yearsKeys = hoisted.cacheKeyParts.filter((k) => k[0] === 'vehicle-model-years-v1');
    expect(yearsKeys).toHaveLength(2);
    // 🔴 牌子必須【真的進鍵】—— 不進去的話兩發的鍵一模一樣。
    expect(yearsKeys[0]).toContain('Honda');
    expect(yearsKeys[1]).toContain('Yamaha');
    expect(yearsKeys[0]).not.toEqual(yearsKeys[1]);
  });

  it('🔴 ③ 連續問兩個【不同】牌子 ⇒ 第二發不可以拿到第一發的內容', async () => {
    rpcRouter = (fn, args) => {
      if (fn !== 'get_vehicle_model_years') return undefined;
      const brand = (args as { p_brand?: string } | null)?.p_brand;
      if (brand === 'Honda') return payload([row('Honda', 'CBR1000RR', 2020, 2021)]);
      if (brand === 'Yamaha') return payload([row('Yamaha', 'MT-07', 2014, 2015)]);
      return payload([]);
    };

    const honda = await fetchVehicleYearsForBrand('Honda');
    const yamaha = await fetchVehicleYearsForBrand('Yamaha');

    expect(honda[0]?.models[0]?.years).toEqual([2020, 2021]);
    // 🔴 這一格就是那個【靜默錯資料】的靶:回 2020/2021 = 第二個牌子吃到第一個牌子的快取。
    expect(yamaha[0]?.models[0]?.years).toEqual([2014, 2015]);
    expect(rpcCalls).toHaveLength(2);
  });
});
