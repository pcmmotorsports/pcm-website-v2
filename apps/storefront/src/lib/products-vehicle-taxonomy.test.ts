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

  // ⚠️ **這格的已知極限(關卡2 指出,接受)**:它斷言的是「我的假 builder 收到四次 order」,
  //   碰不到真正的 PostgREST builder。若 `@supabase/postgrest-js` 升版把 `.order()`
  //   從 append 改成覆寫,分頁會真的壞掉而這格仍然綠。
  //   2026-08-11 已查:本機 `postgrest-js@2.105.3` 產出的是
  //   `moto_brand.asc,model_code.asc,year_start.asc,year_end.asc`(append,行為正確)。
  //   ⇒ 這是**升版回歸的缺口**,要補得靠整合測試(打真 PostgREST),不在本片範圍。
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

  // 🔴 這格守的是 migration `20260811100000` 一個**刻意的取捨**所依賴的下游行為:
  //   view 的 anti-join 用原字面等值(不 lower/btrim),因為正規化版實測 413ms → 1,170ms
  //   且排序溢出磁碟。代價 = 同一台車的別名字面會回兩列(實測 3 組,如 `"Forza 250 "` 帶年份
  //   + `"Forza 250"` 無年份;另有 `"Panigale V4"` / `"panigale v4"` 這種大小寫差)。
  //
  // 🔴 **併回去靠的是兩個不同的機制,要分開測**(第一版我只測空白、註解還把機制寫成
  //   `normalizeVehicleQuery` 的 trim —— 突變證明那是**假綠**:拿掉它照樣全過,
  //   因為空白是被 `vehicle-taxonomy.ts:72-73` 自己的 `.trim()` 吃掉的):
  //     空白差  → **兩處都會 trim**:`buildVehicleTaxonomy` 的 `brand.trim()`(:72-73)
  //               與 `normalizeVehicleQuery` 的 `.trim()`(vehicle-match.ts:8)
  //     大小寫差 → 只有 `normalizeVehicleQuery` 的 `.toLowerCase()`
  //
  // 🔴 **突變實測結果(2026-08-11)**,兩格的判別力形狀不同,寫在這裡免得後人誤判:
  //     大小寫格:拿掉 `.toLowerCase()` → **紅**(單點突變即可證明)
  //     空白格  :單獨拿掉任一處 trim → **綠**(另一處補上了);**兩處都拿掉才紅**
  //   ⇒ 空白這條是**刻意的重複覆蓋(defense in depth),不是死碼**。
  //     誰要「順手精簡」掉其中一個 trim:它現在確實刪得掉而測試不會紅,
  //     但你就把這條不變式從兩道減成一道了。要刪請先讓這格改成單點可紅。
  it('🔴 空白字面差必須併成一個節點、年份取聯集', async () => {
    pages = [
      [
        row('Honda', 'Forza 250 ', 2018, 2020), // direct 那半:尾端空格 + 有年份
        row('Honda', 'Forza 250', null, null), // 下半補的別名:無年份
      ],
    ];
    const out = await fetchVehicleTaxonomy();

    expect(out).toHaveLength(1);
    expect(
      out[0]?.models,
      '兩個字面必須併成一台車;沒併的話客人會看到兩台一樣的 Forza 250',
    ).toHaveLength(1);
    expect(
      out[0]?.models[0]?.years,
      '年份要取聯集 —— 若挑到無年份那筆當贏家,2018-2020 就沒了',
    ).toEqual([2018, 2019, 2020]);
  });

  it('🔴 大小寫字面差必須併成一個節點(實測 Ducati "Panigale V4" / "panigale v4" 兩表都有)', async () => {
    pages = [
      [
        row('Ducati', 'Panigale V4', 2023, 2023),
        row('Ducati', 'panigale v4', null, null),
      ],
    ];
    const out = await fetchVehicleTaxonomy();

    expect(out[0]?.models, '大小寫不同的同一台車不得變成兩個選項').toHaveLength(1);
    expect(out[0]?.models[0]?.years).toEqual([2023]);
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

    // 沒 log = 沒走到 error 分支(拿掉 `if (error) throw ...` 這格必須紅 —— 因為 error 路徑下
    // data 是 null、迴圈零次、也會回 [],光看回傳值兩條路完全分不出來)。
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]?.[1] as Error;
    expect(logged?.message, '底層錯誤訊息要保留').toContain('boom');
    // 9 頁裡哪一頁掛的必須看得出來(逾時通常只發生在後段頁,那正是要診斷的資訊)
    expect(logged?.message, '錯誤要帶頁碼/offset,否則 9 頁失敗全長一樣').toMatch(/第 1 頁.*offset 0/);

    fromSpy.mockRestore();
    spy.mockRestore();
  });
});
