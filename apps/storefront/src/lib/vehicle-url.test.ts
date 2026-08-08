// @vitest-environment jsdom
//
// vehicle-url.test.ts — R3 車輛 URL 解析(vehicleUrlParam + parseVehicleFromUrl 抽出鎖)
//                     + Q28① vehicleFromContext(全站選車鏡 → VehicleSelection)。
// (jsdom:vehicleFromContext 的預設參數要真讀 window.sessionStorage,注入版恆綠會漏掉接線那格。)
import { describe, it, expect, afterEach } from 'vitest';
import { vehicleUrlParam, parseVehicleFromUrl, vehicleFromContext } from './vehicle-url';
import { writeVehicleContext, VEHICLE_CONTEXT_KEY, type VehicleContextValue } from '@/lib/vehicle-context';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const TAXONOMY: MockMotoBrand[] = [
  { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt09', name: 'MT-09', years: [2024] }] },
];

// codex R3 r2:CTA href 需的車輛短版 slug(短版 ?vehicle 或長版合成),避免長版書籤退成品牌 filter。
describe('vehicleUrlParam', () => {
  it('短版 ?vehicle 直接回傳', () => {
    expect(vehicleUrlParam(new URLSearchParams('vehicle=yamaha:mt09:2024'))).toBe('yamaha:mt09:2024');
  });
  it('長版 ?brand&model&year → 合成短版 brandId:modelId:year', () => {
    expect(vehicleUrlParam(new URLSearchParams('brand=yamaha&model=mt09&year=2024'))).toBe('yamaha:mt09:2024');
  });
  it('長版無 year → brand:model', () => {
    expect(vehicleUrlParam(new URLSearchParams('brand=yamaha&model=mt09'))).toBe('yamaha:mt09');
  });
  it('?brand 單獨(商品品牌 filter 語意)→ null(不合成車輛)', () => {
    expect(vehicleUrlParam(new URLSearchParams('brand=bonamici'))).toBeNull();
  });
  it('無車輛參數 → null', () => {
    expect(vehicleUrlParam(new URLSearchParams('from=catalog'))).toBeNull();
  });
  it('短版優先於長版', () => {
    expect(
      vehicleUrlParam(new URLSearchParams('vehicle=honda:cbr:2020&brand=yamaha&model=mt09')),
    ).toBe('honda:cbr:2020');
  });
});

// 抽出自 products-url-state 的 byte 等價鎖(/products 列表頁與詳情頁 route 共用同一份)。
describe('parseVehicleFromUrl(抽出後)', () => {
  it('短版解回原始車廠/車型名', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('vehicle=yamaha:mt09:2024'), TAXONOMY)).toEqual({
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2024,
    });
  });
  it('長版 ?brand&model&year fallback 解回原始名', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('brand=yamaha&model=mt09&year=2024'), TAXONOMY)).toEqual({
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2024,
    });
  });
  it('brandId 不在 taxonomy → null', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('vehicle=ktm:x'), TAXONOMY)).toBeNull();
  });
  it('只 brand 無 model → model undefined(route 據此退 Case B)', () => {
    expect(parseVehicleFromUrl(new URLSearchParams('vehicle=yamaha'), TAXONOMY)).toEqual({
      brand: 'YAMAHA',
      model: undefined,
      year: undefined,
    });
  });
});

// ── Q28①(2026-08-08):全站選車鏡 → VehicleSelection ──────────────────────────
// 供 useDeepLinkRestore 在 URL 無車時回退。與 parseVehicleFromUrl 共用 taxonomy 驗證,
// 但 model 查無**不降級**(見函式註解:鏡是自動套用、使用者沒說過「只看這個廠牌」)。
const ctx = (o: Partial<VehicleContextValue>): VehicleContextValue => ({
  brandId: 'yamaha',
  label: 'x',
  savedAt: 1,
  ...o,
});

describe('vehicleFromContext', () => {
  afterEach(() => window.sessionStorage.removeItem(VEHICLE_CONTEXT_KEY));

  it('鏡有完整車 → 回 taxonomy 名稱字面(含年)', () => {
    expect(vehicleFromContext(TAXONOMY, ctx({ modelId: 'mt09', year: 2024 }))).toEqual({
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2024,
    });
  });

  it('鏡空 → null', () => {
    expect(vehicleFromContext(TAXONOMY, null)).toBeNull();
  });

  it('brandId 不在 taxonomy → null(fail-safe)', () => {
    expect(vehicleFromContext(TAXONOMY, ctx({ brandId: 'ktm', modelId: 'mt09' }))).toBeNull();
  });

  // §6-3:改名/下架的車款不得被降級成「只看這個廠牌」——那是拿猜的條件去篩清單。
  // 突變:把 `if (!modelObj) return null` 改成降級回 { brand } ⇒ 只紅這條。
  it('🔴 modelId 不在 taxonomy → null(整筆忽略、**不**降級成 brand-only)', () => {
    expect(vehicleFromContext(TAXONOMY, ctx({ modelId: 'r1-discontinued' }))).toBeNull();
  });

  it('brand-only 鏡 → 只回廠牌(使用者本來就只選了廠牌)', () => {
    expect(vehicleFromContext(TAXONOMY, ctx({}))).toEqual({ brand: 'YAMAHA' });
  });

  // R1 MF-4:年份軸的 fail-safe(URL 側完全不驗 year、鏡側驗)。
  // 突變:`year: ctx.year` 不驗 ⇒ 只紅這條 + harness 的 MF-4。
  it('year 不在該車型的年份清單 → 丟年份、保留廠牌車款', () => {
    expect(vehicleFromContext(TAXONOMY, ctx({ modelId: 'mt09', year: 2019 }))).toEqual({
      brand: 'YAMAHA',
      model: 'MT-09',
      year: undefined,
    });
  });

  it('該車型沒有年份清單(不分年)→ year 原樣帶過(對齊 URL 側慣例)', () => {
    const noYears: MockMotoBrand[] = [
      { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'mt09', name: 'MT-09', years: [] }] },
    ];
    expect(vehicleFromContext(noYears, ctx({ modelId: 'mt09', year: 2019 }))?.year).toBe(2019);
  });

  // R1 N-2:鏡的 id 是裸 slugify、taxonomy id 撞號會加序號 ⇒ 光比 id 會命中另一台車。
  // 突變:拿掉 modelName 那道複驗 ⇒ 只紅這條(會回 MT-09,= 自動套上錯的車)。
  it('🔴 id 撞號:鏡的 modelName 對不上該 id 的車款 → null(不套錯的車)', () => {
    expect(
      vehicleFromContext(TAXONOMY, ctx({ modelId: 'mt09', modelName: 'MT-09 SP' })),
    ).toBeNull();
  });

  // 突變:拿掉 brandName 那道複驗 ⇒ 只紅這條。
  it('🔴 id 撞號:鏡的 brandName 對不上該 id 的廠牌 → null', () => {
    expect(vehicleFromContext(TAXONOMY, ctx({ brandName: 'YAMAHA MOTOR' }))).toBeNull();
  });

  it('舊鏡缺名稱字面欄 → 不驗名稱、照舊以 id 還原(additive 相容)', () => {
    expect(vehicleFromContext(TAXONOMY, ctx({ modelId: 'mt09', year: 2024 }))).toEqual({
      brand: 'YAMAHA',
      model: 'MT-09',
      year: 2024,
    });
  });

  // 接線格:不傳 ctx 時真的讀 sessionStorage(注入版全綠但預設參數接錯=這條才抓得到)。
  it('不傳 ctx → 讀 sessionStorage 的鏡', () => {
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt09', year: 2024, label: 'YAMAHA MT-09 2024' });
    expect(vehicleFromContext(TAXONOMY)).toEqual({ brand: 'YAMAHA', model: 'MT-09', year: 2024 });
  });

  it('不傳 ctx 且 sessionStorage 無鏡 → null', () => {
    expect(vehicleFromContext(TAXONOMY)).toBeNull();
  });
});
