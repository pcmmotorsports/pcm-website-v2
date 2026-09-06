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

// 🔴🔴 **[2026-09-06 改 RPC] 這支 mock 原本演的是【分頁 builder】(`.from().select().order().range()`)。**
//   ⛔ ~~那整組~~ 已隨 `⟦db-TAXONOMYVIEW⟧` 裁乙(一發拿完)拿掉;現在演的是 `.rpc('get_vehicle_taxonomy')`。
//   🔵 **而下面那幾格【語意仍然成立】的測試一格都沒刪**(年份 null / 別名併節點 / 撈失敗回空)——
//     它們守的是**對映語意**,與資料怎麼運過來無關。
//   🛑 **被拿掉主詞的那幾格**(滿頁續撈 / `count` 說謊 / `count` 是 NaN / 中間某頁失敗)
//     在檔尾有一段 `[主詞已消失]` 交代它們去了哪裡 —— **不是靜靜刪掉的。**

/** RPC 要回的 payload;各測試自己設 —— **它可以說謊**(`n` 與 `rows.length` 不一致)。 */
let rpcPayload: unknown = { n: 0, rows: [] };
/** 設成 truthy ⇒ RPC 回 error(驗準則③:失敗要 throw)。 */
let rpcError: { message: string } | null = null;
/** 記下實際叫了哪支函式 —— 那是「別又撈錯來源」那一格的主詞。 */
let rpcCalls: string[] = [];

const client = {
  rpc(fn: string) {
    rpcCalls.push(fn);
    return Promise.resolve(
      rpcError ? { data: null, error: rpcError } : { data: rpcPayload, error: null },
    );
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

// 🔵 **欄序固定 `[moto_brand, model_code, year_start, year_end]`** —— RPC 回的是 array-of-arrays
//   (db 線實測:490,120 vs 734,060 bytes, 省 33%)⇒ **位置就是欄名, 打錯順序沒有東西會叫**
//   ⇒ 📌 所以測試這一端也走同一個 helper, 不要在各格裡手打裸陣列。
function row(
  moto_brand: string | null,
  model_code: string | null,
  year_start: number | null,
  year_end: number | null,
) {
  return [moto_brand, model_code, year_start, year_end];
}

/** 把幾列包成 RPC 的回傳形狀;`n` 預設 = 實際列數(要說謊的那格自己傳 `n`)。 */
function payload(rows: ReturnType<typeof row>[], n?: number) {
  return { n: n ?? rows.length, rows };
}

beforeEach(() => {
  rpcPayload = payload([]);
  rpcError = null;
  rpcCalls = [];
});

describe('#277 段二 車輛下拉來源', () => {
  it('🔴 撈的是 vehicle_taxonomy_public(含 inherited),不是 products_public(只有 direct)', async () => {
    rpcPayload = payload([row('Yamaha', 'MT-07 ABS', 2021, 2021)]);
    const out = await fetchVehicleTaxonomy();

    // ⛔ ~~expect(fromCalls).toEqual(['vehicle_taxonomy_public'])~~ ⇒ 2026-09-06 改 RPC。
    // 🔵 **這一格的【意圖】一個字都沒變**:守的是「別又去撈只有 direct 的那個來源」。
    //   而那支 RPC 讀的仍然是 `vehicle_taxonomy_public`(它是 `SECURITY INVOKER`,
    //   `anon` 對那張 view 本來就有 SELECT)⇒ 換的是**運輸方式**, 不是來源。
    expect(
      rpcCalls,
      'products_public 只看得到 direct 標記 ⇒ 純推導子款(MT-07 ABS 等 197 組)客人選不到',
    ).toEqual(['get_vehicle_taxonomy']);
    expect(out[0]?.models[0]?.name).toBe('MT-07 ABS');
  });

  // ⛔⛔ **[主詞已移走 · 2026-09-06]** 這一格原本斷言「app 有對四欄各叫一次 `.order()`」。
  //   ~~它斷言的是「我的假 builder 收到四次 order」, 碰不到真正的 PostgREST builder~~
  //   改成 RPC 之後 app 這一端**不再叫 `.order()`**:排序寫在 `get_vehicle_taxonomy()` 裡
  //   (四欄同序, 由 `⟦db-TAXONOMYVIEW⟧` 那支 migration 擁有)。
  //
  // 🔴🔴 **而我第一版把這一格改錯了, 錯法值得留著** ——
  //   我寫成「app 不得重排:進來什麼順序, 出去就是什麼順序」, **而它紅了**:
  //   `vehicle-taxonomy.ts:115,118` 逐字 `.sort((a, b) => a.name.localeCompare(b.name, 'en'))`
  //   ⇒ **`buildVehicleTaxonomy` 本來就會按名字排**(而且是刻意的:locale 固定、防 hydration mismatch)。
  //   🎯 **⇒ 那四欄 order 從來就不是為了【畫面順序】, 是為了【翻頁不漏列】**
  //     —— 而分頁沒有了, 那個理由**整個消失**, 不是換了個地方。
  //   📌 **所以正確的繼承者不是「順序」, 是「一列都不能少」** ⇒ 這一格改成問那個。
  it('🔴 RPC 給幾列就要有幾列 —— 一列都不能少(四欄 order 原本守的是這個, 不是畫面順序)', async () => {
    rpcPayload = payload([
      row('Yamaha', 'MT-07', 2021, 2021),
      row('Aprilia', 'RS 660', 2021, 2021),
      row('Zero', 'SR/F', 2021, 2021),
    ]);
    const out = await fetchVehicleTaxonomy();
    // 🔵 比「有哪些廠牌」而不是「順序」—— 順序由 `buildVehicleTaxonomy` 決定, 不由 RPC 決定。
    expect([...out.map((b) => b.name)].sort()).toEqual(['Aprilia', 'Yamaha', 'Zero']);
    expect(out).toHaveLength(3);
  });

  it('🔴 year_end = null 是開放式(展到資料上界),不是單年', async () => {
    rpcPayload = payload([
        row('Ducati', 'Panigale V4', 2023, null), // 開放式 "2023+"
        row('Ducati', 'Monster', 2026, 2026), // 讓資料上界 = 2026
    ]);
    const out = await fetchVehicleTaxonomy();
    const v4 = out[0]?.models.find((m) => m.name === 'Panigale V4');

    expect(
      v4?.years,
      'null 若被當成單年,2024-2026 這幾年客人就選不到自己的車',
    ).toEqual([2023, 2024, 2025, 2026]);
  });

  it('🔴 year_start = null ⇒ 該列不貢獻年份(不可當 0,否則下拉冒出「西元 0 年」)', async () => {
    rpcPayload = payload([row('KTM', '790 Duke L', null, null)]);
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
    rpcPayload = payload([
        row('Honda', 'Forza 250 ', 2018, 2020), // direct 那半:尾端空格 + 有年份
        row('Honda', 'Forza 250', null, null), // 下半補的別名:無年份
    ]);
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
    rpcPayload = payload([
        row('Ducati', 'Panigale V4', 2023, 2023),
        row('Ducati', 'panigale v4', null, null),
    ]);
    const out = await fetchVehicleTaxonomy();

    expect(out[0]?.models, '大小寫不同的同一台車不得變成兩個選項').toHaveLength(1);
    expect(out[0]?.models[0]?.years).toEqual([2023]);
  });

  // 🔴 這格原本是**假綠**(2026-08-11 code-reviewer 抓到、我自己的 5 個突變沒涵蓋到):
  //   只斷言「回 []」的話,把 `if (error) throw error` 整行刪掉照樣綠 ——
  //   因為 error 路徑下 `data` 是 null ⇒ 迴圈零次 ⇒ break ⇒ 也是 []。
  //   兩條路徑的**觀察結果相同**,所以要改看「有沒有真的走到錯誤分支」= console.error 被呼叫。
  // 🔵 **2026-09-06 改 RPC:那個【兩條路長一樣】的形狀原封不動地留著** ——
  //   RPC 回 error 時 `data` 也是 null ⇒ 少了 throw 一樣會回 `[]`。⇒ 判準仍然是 console.error。
  it('撈失敗 → 回空陣列不 crash,且錯誤有被記下來(VehicleFinder 顯空下拉)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpcError = { message: 'boom' };

    await expect(fetchVehicleTaxonomy()).resolves.toEqual([]);

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]?.[1] as Error;
    expect(logged?.message, '底層錯誤訊息要保留').toContain('boom');
    expect(logged?.message, '看得出是哪一支叫失敗的').toContain('get_vehicle_taxonomy');
    spy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⛔⛔ **[主詞已消失 · 2026-09-06] 原本這裡有六格分頁守門, 而【分頁沒有了】。**
//   ~~滿頁會續撈下一頁 / 五頁一列都不能少 / `count` 說謊照樣撈到底 /
//     中間某頁失敗要 throw / `count` 是 NaN / `count` 缺席~~
//   🔴 **它們不是「過時的測試」, 是【它們守的那條路被拿掉了】** ——
//     `⟦db-TAXONOMYVIEW⟧` 裁乙:一發 `.rpc('get_vehicle_taxonomy')`, 沒有 `.range()`、沒有 `count`。
//   🟢 **而它們守的【那個東西】換了一個載體, 沒有消失**:
//     那六格全部在問同一句話 —— **「我拿到的是不是全部?」**
//     分頁世界裡它靠「短頁才停 + count 不當終止判準」;
//     一發世界裡它靠 **`rows.length === n`**(而 `n` 是 DB 端**另一次獨立的 `count(*)`**,
//     不是從同一個聚合推出來的 —— 那是它多花 211 ms 買到的判別力)。
//   ⇒ 📌 **下面那三格就是那六格的繼承者。**
//   🛑 **而有一格【真的沒有繼承者】**:`db-max-rows` 那條隱形依賴(backlog `#629`)——
//     這條路不再經過 PostgREST 的列數上限, 所以這裡量不到它了;
//     而它對**別的** `.range()` 迴圈仍然成立 ⇒ 那條債留在 `products.ts` 的 `[已作廢]` 標頭裡。
// ══════════════════════════════════════════════════════════════════════════
describe('一發拿完:我拿到的是不是全部', () => {
  it('🔴🔴 `rows.length` 與 `n` 對不上 ⇒ throw(這是本片唯一擋得住【靜默截斷】的東西)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 🛑 一份被截斷的回應與一份完整的回應**長得一模一樣**:兩邊都是合法 JSON、都有 rows、
    //   畫面都畫得出來, 而客人的車款下拉安靜地少一半。⇒ 只有這個對照分得出來。
    rpcPayload = payload([row('Honda', 'ONLY', 2021, 2021)], 12197);
    await expect(fetchVehicleTaxonomy()).resolves.toEqual([]);
    const logged = spy.mock.calls[0]?.[1] as Error;
    expect(logged?.message).toContain('列數對不上');
    // 🔵 兩個數都要印出來 —— 只印「對不上」的話, 下一個人得自己去撈才知道差多少。
    expect(logged?.message).toContain('12197');
    expect(logged?.message).toContain('1');
    spy.mockRestore();
  });

  it('🔵 負對照:`rows.length === n` ⇒ 正常回傳(上面那格不可以是恆紅)', async () => {
    rpcPayload = payload([row('Honda', 'CB650R', 2021, 2021)]);
    const out = await fetchVehicleTaxonomy();
    expect(out[0]?.models[0]?.name).toBe('CB650R');
  });

  it('🔴 回傳形狀不對(缺 `n` / `rows` 不是陣列)⇒ throw, 不得當成「沒有車款」', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpcPayload = { rows: 'oops' };
    await expect(fetchVehicleTaxonomy()).resolves.toEqual([]);
    expect((spy.mock.calls[0]?.[1] as Error)?.message).toContain('回傳形狀不對');
    spy.mockRestore();
  });

  it('🔵 空表:`rows` 是 `[]` 且 `n` 是 0 ⇒ 回空陣列, 而【不是】錯誤', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpcPayload = payload([]);
    await expect(fetchVehicleTaxonomy()).resolves.toEqual([]);
    // 🛑 這一格與上面兩格的回傳值**一模一樣(都是 `[]`)** ⇒ 分辨它們的是「有沒有 log」。
    //   少了這一格, 一個「什麼都當錯誤」的實作也會讓上面兩格綠。
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
