// @vitest-environment node
//
// products-vehicle-taxonomy.test.ts — #277 段二:車輛下拉改讀 `vehicle_taxonomy_public` 的守門。
//
// 🔴 這裡守的四件事**壞掉都不會紅、不會 crash、客人也不會回報** —— 症狀全是「下拉少了東西」
//   或「下拉多了沒商品的年」,而 `buildVehicleTaxonomy` 自己的單元測試(vehicle-taxonomy.test.ts)
//   對它們**零判別力**:那支測的是純函式,餵什麼算什麼,不管餵進去的東西是怎麼撈的。
//
//   ① 撈錯表        → 退回 direct 層,197 組(8.2%)子款又不見了(就是 #277 這個 bug 本身)
//   ② 少 order 一欄 → view 唯一性是四欄,少一欄則同鍵列相對順序未定義 ⇒ **翻頁會漏列**
//   ③ year_end null 當單年 → 開放式車款的年份下拉只剩起始年
//   ④ year_start null 當 0 → 該車款憑空多出一個「西元 0 年」選項(不是數千個 ——
//                            `MAX_YEAR_SPAN = 60` 封住展開,本格 fixture 實際只產得出 `[0]`)
//
// 對映語意的依據(實測、非推論)寫在 `products.ts` 的 `getVehicleTaxonomyCached` 註解。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/** 每個 `.range()` 依序回傳的頁;`.order()` 呼叫記在 orderCalls。 */
let pages: Array<Array<Record<string, unknown>>> = [];
let orderCalls: string[] = [];
let fromCalls: string[] = [];
let selectCalls: string[] = [];
let rangeCalls: Array<[number, number]> = [];

const client = {
  from(table: string) {
    fromCalls.push(table);
    const builder = {
      select(cols: string) {
        selectCalls.push(cols);
        return builder;
      },
      order(col: string) {
        orderCalls.push(col);
        return builder;
      },
      range(from: number, to: number) {
        rangeCalls.push([from, to]);
        const data = pages.shift() ?? [];
        return Promise.resolve({ data, error: null });
      },
    };
    return builder;
  },
};

vi.mock('@pcm/adapters', () => ({
  createSupabaseAnonClient: () => client,
  SupabaseProductAdapter: class {},
  availabilityToBool: () => true,
}));

// unstable_cache 直通,否則測不到快取內側真正撈的東西。
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

import { fetchVehicleTaxonomy } from '@/lib/products';

function row(
  moto_brand: string | null,
  model_code: string | null,
  year_start: number | null,
  year_end: number | null,
) {
  return { moto_brand, model_code, year_start, year_end };
}

beforeEach(() => {
  pages = [];
  orderCalls = [];
  fromCalls = [];
  selectCalls = [];
  rangeCalls = [];
});

describe('#277 段二 車輛下拉來源', () => {
  it('🔴 撈的是 vehicle_taxonomy_public(含 inherited),不是 products_public(只有 direct)', async () => {
    pages = [[row('Yamaha', 'MT-07 ABS', 2021, 2021)]];
    const out = await fetchVehicleTaxonomy();

    expect(
      fromCalls,
      'products_public 只看得到 direct 標記 ⇒ 純推導子款(MT-07 ABS 等 197 組)客人選不到',
    ).toEqual(['vehicle_taxonomy_public']);
    expect(selectCalls[0]).toBe('moto_brand, model_code, year_start, year_end');
    expect(out[0]?.models[0]?.name).toBe('MT-07 ABS');
  });

  it('🔴 四欄全部 order —— view 唯一性是四欄,少一欄翻頁就會漏列', async () => {
    pages = [[row('Yamaha', 'MT-07', 2021, 2021)]];
    await fetchVehicleTaxonomy();
    expect(orderCalls).toEqual(['moto_brand', 'model_code', 'year_start', 'year_end']);
  });

  it('🔴 year_end = null 是開放式(展到資料上界),不是單年', async () => {
    pages = [
      [
        row('Ducati', 'Panigale V4', 2023, null), // 開放式 "2023+"
        row('Ducati', 'Monster', 2026, 2026), // 讓資料上界 = 2026
      ],
    ];
    const out = await fetchVehicleTaxonomy();
    const v4 = out[0]?.models.find((m) => m.name === 'Panigale V4');

    expect(
      v4?.years,
      'null 若被當成單年,2024-2026 這幾年客人就選不到自己的車',
    ).toEqual([2023, 2024, 2025, 2026]);
  });

  it('🔴 year_start = null ⇒ 該列不貢獻年份(不可當 0,否則下拉冒出「西元 0 年」)', async () => {
    pages = [[row('KTM', '790 Duke L', null, null)]];
    const out = await fetchVehicleTaxonomy();

    expect(out[0]?.models[0]?.name).toBe('790 Duke L');
    expect(out[0]?.models[0]?.years).toEqual([]);
  });

  it('滿頁會續撈下一頁、短頁就停(PostgREST Max rows=1000 硬上限)', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row('Honda', `M${i}`, 2020, 2020));
    pages = [full, [row('Honda', 'CB650R', 2021, 2021)]];
    const out = await fetchVehicleTaxonomy();

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(
      out[0]?.models.some((m) => m.name === 'CB650R'),
      '第二頁的車款必須出現在結果裡 —— 少 order 或提早 break 都會讓它靜靜消失',
    ).toBe(true);
  });

  // 🔴 這格原本是**假綠**(2026-08-11 code-reviewer 抓到、我自己的 5 個突變沒涵蓋到):
  //   只斷言「回 []」的話,把 `if (error) throw error` 整行刪掉照樣綠 ——
  //   因為 error 路徑下 `data` 是 null ⇒ 迴圈零次 ⇒ break ⇒ 也是 []。
  //   兩條路徑的**觀察結果相同**,所以要改看「有沒有真的走到錯誤分支」= console.error 被呼叫。
  it('撈失敗 → 回空陣列不 crash,且錯誤有被記下來(VehicleFinder 顯空下拉)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      from: () => ({
        select: () => broken.from(),
        order: () => broken.from(),
        range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }),
    };
    const fromSpy = vi.spyOn(client, 'from').mockImplementation(broken.from as never);

    await expect(fetchVehicleTaxonomy()).resolves.toEqual([]);
    expect(
      spy,
      '沒 log = 沒走到 error 分支;拿掉 `if (error) throw error` 這格必須紅',
    ).toHaveBeenCalledWith('[fetchVehicleTaxonomy] cached fitments fetch failed:', {
      message: 'boom',
    });

    fromSpy.mockRestore();
    spy.mockRestore();
  });
});
