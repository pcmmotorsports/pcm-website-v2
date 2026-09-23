// @vitest-environment jsdom
//
// search-vehicle.test.ts — V-2h/MF-4 讀選車 context → 購物車車款(ProductInfo + mobile buybar 共用來源)。

import { afterEach, describe, expect, it } from 'vitest';
import { readSearchVehicle } from './search-vehicle';
import {
  commitVehicleIntent,
  initVehicleIntent,
  resetVehicleIntentForTests,
  setUnverifiedUrlVehicle,
  setVehicleIntent,
} from './vehicle-intent';

const CTX_KEY = 'pcm.vehicle.v1';
afterEach(() => window.sessionStorage.clear());

describe('readSearchVehicle（V-2a 路徑1、零猜)', () => {
  it('context 名稱字面齊全 → kind:dict source:search', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', modelId: 'mt-09-sp', year: 2021, label: 'x', brandName: 'Yamaha', modelName: 'MT-09 SP', savedAt: 1 }),
    );
    expect(readSearchVehicle()).toEqual({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' });
  });

  it('缺 modelName(brand-only)→ undefined(零猜)', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', label: 'x', brandName: 'Yamaha', savedAt: 1 }),
    );
    expect(readSearchVehicle()).toBeUndefined();
  });

  it('舊 context 缺名稱欄 → undefined(不 label 反解析)', () => {
    window.sessionStorage.setItem(
      CTX_KEY,
      JSON.stringify({ brandId: 'yamaha', modelId: 'mt-09-sp', label: 'x', savedAt: 1 }),
    );
    expect(readSearchVehicle()).toBeUndefined();
  });

  it('無 context → undefined', () => {
    expect(readSearchVehicle()).toBeUndefined();
  });
});

// ── Codex 總審(跨片)那兩條:客人看到的車與買到的車必須是同一台 ──────────────
const R7 = { kind: 'vehicle', segment: 'yamaha:yzf-r7', brandName: 'Yamaha', modelName: 'YZF-R7' } as const;
const MT07 = { kind: 'vehicle', segment: 'yamaha:mt-07', brandName: 'Yamaha', modelName: 'MT-07' } as const;
const mirrorMT07 = () =>
  window.sessionStorage.setItem(
    CTX_KEY,
    JSON.stringify({ brandId: 'yamaha', modelId: 'mt-07', label: 'Yamaha MT-07', brandName: 'Yamaha', modelName: 'MT-07', savedAt: 1 }),
  );

describe('Codex 總審必修 1:還沒畫出來的那次 render 改的車款不算', () => {
  afterEach(() => resetVehicleIntentForTests());

  it('新頁在 render 當中換了車、而畫面還沒換 ⇒ 購物車仍是客人眼前那一台', () => {
    setVehicleIntent(MT07); // 客人現在看的這一頁:MT-07
    expect(readSearchVehicle()).toMatchObject({ model: 'MT-07' });
    initVehicleIntent(R7, { force: true }); // 新頁那次 render 改了意圖,而 React 把那次 render 丟掉
    expect(readSearchVehicle(), '畫面還是 MT-07, 購物車卻已經改成 R7').toMatchObject({ model: 'MT-07' });
  });

  it('那一頁真的畫出來之後 ⇒ 購物車才跟著換', () => {
    setVehicleIntent(MT07);
    initVehicleIntent(R7, { force: true });
    commitVehicleIntent(); // = 畫面提交之後跑的那一發 effect
    expect(readSearchVehicle()).toMatchObject({ model: 'YZF-R7' });
  });
});

describe('Codex 總審必修 2:網址指名了一台車而這一頁驗不了', () => {
  afterEach(() => resetVehicleIntentForTests());

  it('選車紀錄是別台車 ⇒ 不帶車', () => {
    mirrorMT07();
    setUnverifiedUrlVehicle('yamaha:yzf-r7'); // 網址寫 R7,這一頁沒有車款清單可以驗
    expect(readSearchVehicle(), '網址上寫 R7, 購物車卻帶了選車紀錄裡的 MT-07').toBeUndefined();
  });

  it('舊的車款意圖也不能頂替 ⇒ 一樣不帶車', () => {
    setVehicleIntent(MT07);
    setUnverifiedUrlVehicle('yamaha:yzf-r7');
    expect(readSearchVehicle()).toBeUndefined();
  });

  it('選車紀錄就是網址上那一台(只差大小寫 / 橫線)⇒ 照樣帶,那不是猜的', () => {
    mirrorMT07();
    setUnverifiedUrlVehicle('Yamaha:MT 07');
    expect(readSearchVehicle(), '對得起來卻不帶車 = 通用商品加購把客人的車弄丟了').toMatchObject({
      brand: 'Yamaha',
      model: 'MT-07',
    });
  });
});
