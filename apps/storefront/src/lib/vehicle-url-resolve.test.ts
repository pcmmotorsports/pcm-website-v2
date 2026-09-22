// vehicle-url-resolve.test.ts — :901 網址車款判斷(plan `docs/plans/2026-09-20-vehicle-url-silent-drop-plan.md` §9-2)。
//
// Sean 2026-09-22:只差空白、橫線、大小寫就自動選那一台;差更多就不猜,列同品牌最接近的 3 台。
// 測試車款照正式庫實況(經主視窗唯讀查):Yamaha 有 YZF-R7、YZF R7 70th、YZF R7 World GP 60th Anniversary。
import { describe, it, expect } from 'vitest';
import { resolveVehicleFromUrl, suggestVehicleModels, withVehicleParam } from './vehicle-url';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const TAXONOMY: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'yzf-r7', name: 'YZF-R7', years: [2021, 2022] },
      { id: 'yzf-r7-70th', name: 'YZF R7 70th', years: [] },
      { id: 'yzf-r7-world-gp-60th-anniversary', name: 'YZF R7 World GP 60th Anniversary', years: [] },
      { id: 'mt-07', name: 'MT-07', years: [] },
      { id: 'yzf-r6', name: 'YZF-R6', years: [] },
    ],
  },
  {
    id: 'honda',
    name: 'Honda',
    // 正式庫有 15 組這種「寬鬆鍵相同」的車型(id 靠撞名序號分開)
    models: [
      { id: 'mt-09', name: 'MT-09', years: [] },
      { id: 'mt-09-2', name: 'MT 09', years: [] },
    ],
  },
];

const r = (qs: string) => resolveVehicleFromUrl(new URLSearchParams(qs), TAXONOMY);

describe('resolveVehicleFromUrl', () => {
  it('沒有車款輸入 ⇒ none(含單獨的商品品牌 ?brand=、空的 ?vehicle=)', () => {
    expect(r('')).toEqual({ kind: 'none' });
    expect(r('brand=yamaha')).toEqual({ kind: 'none' });
    expect(r('vehicle=')).toEqual({ kind: 'none' });
    expect(r('category=A&page=2')).toEqual({ kind: 'none' });
  });

  it('正規 id ⇒ ok、canonical', () => {
    expect(r('vehicle=yamaha:yzf-r7')).toEqual({
      kind: 'ok',
      vehicle: { brand: 'Yamaha', model: 'YZF-R7', year: undefined },
      segment: 'yamaha:yzf-r7',
      canonical: true,
    });
  });

  it('🔴 只差空白 / 橫線 / 大小寫 ⇒ 自動選 YZF-R7,但不是正規寫法', () => {
    for (const model of ['YZF R7', 'yzfr7', 'YZF-R7', 'Yzf-r7']) {
      const res = r(`vehicle=yamaha:${encodeURIComponent(model)}`);
      expect(res, model).toMatchObject({ kind: 'ok', vehicle: { model: 'YZF-R7' }, segment: 'yamaha:yzf-r7', canonical: false });
    }
  });

  it('牌子也可以寬鬆比對(YAMAHA ⇒ Yamaha)', () => {
    expect(r('vehicle=YAMAHA:yzf-r7')).toMatchObject({ kind: 'ok', segment: 'yamaha:yzf-r7', canonical: false });
  });

  it('只有牌子 ⇒ ok(整個品牌),與今天相同', () => {
    expect(r('vehicle=yamaha')).toEqual({ kind: 'ok', vehicle: { brand: 'Yamaha' }, segment: 'yamaha', canonical: true });
  });

  it('其他 id 的正規寫法照舊命中(yzf-r7-70th、撞名序號 mt-09-2)', () => {
    expect(r('vehicle=yamaha:yzf-r7-70th')).toMatchObject({ kind: 'ok', vehicle: { model: 'YZF R7 70th' }, canonical: true });
    expect(r('vehicle=honda:mt-09-2')).toMatchObject({ kind: 'ok', vehicle: { model: 'MT 09' }, canonical: true });
  });

  it('🔴 寬鬆鍵撞到兩台 ⇒ 不猜,notFound 並列建議', () => {
    const res = r('vehicle=honda:MT09');
    expect(res.kind).toBe('notFound');
    if (res.kind !== 'notFound') return;
    expect(res.brandName).toBe('Honda');
    expect(res.suggestions.map((s) => s.modelId).sort()).toEqual(['mt-09', 'mt-09-2']);
  });

  it('🔴 差更多(yzf-r9)⇒ notFound,同品牌寬鬆鍵開頭相同最多的 3 台、同分依名字,不自動選', () => {
    const res = r('vehicle=yamaha:yzf-r9');
    expect(res.kind).toBe('notFound');
    if (res.kind !== 'notFound') return;
    expect(res.input).toBe('yamaha:yzf-r9');
    // yzfr9 與 YZF-R6 / YZF-R7 / R7 70th / R7 World GP 都是前 4 字相同 ⇒ 同分,依名字取前 3
    expect(res.suggestions.map((s) => s.modelId)).toEqual(['yzf-r7-70th', 'yzf-r7-world-gp-60th-anniversary', 'yzf-r6']);
    expect(res.suggestions.every((s) => s.brandId === 'yamaha')).toBe(true);
  });

  it('底線不在寬鬆規則內 ⇒ notFound;排序照同一條規則(yzf_r7 與各台只有前 3 字相同 ⇒ 全部同分、依名字)', () => {
    const res = r('vehicle=yamaha:yzf_r7');
    expect(res.kind).toBe('notFound');
    if (res.kind !== 'notFound') return;
    expect(res.suggestions.map((s) => s.modelId)).toEqual(['yzf-r7-70th', 'yzf-r7-world-gp-60th-anniversary', 'yzf-r6']);
  });

  it('牌子找不到 ⇒ notFound、沒有建議', () => {
    expect(r('vehicle=zzq:nosuchbike')).toEqual({ kind: 'notFound', input: 'zzq:nosuchbike', suggestions: [] });
  });

  it('年份照今天不驗、原樣帶進 segment', () => {
    expect(r('vehicle=yamaha:yzf-r7:1999')).toMatchObject({ kind: 'ok', vehicle: { year: 1999 }, segment: 'yamaha:yzf-r7:1999', canonical: true });
  });

  it('長版網址:brand + model 同在才算,且永遠不是正規寫法', () => {
    expect(r('brand=yamaha&model=yzf-r7')).toMatchObject({ kind: 'ok', segment: 'yamaha:yzf-r7', canonical: false });
    expect(r('brand=yamaha&model=nosuch')).toMatchObject({ kind: 'notFound', brandName: 'Yamaha' });
  });

  it('短長版並存:短版非空優先;短版空才讀長版', () => {
    expect(r('vehicle=yamaha:yzf-r7&brand=yamaha&model=nosuch')).toMatchObject({ kind: 'ok', segment: 'yamaha:yzf-r7' });
    expect(r('vehicle=&brand=yamaha&model=nosuch')).toMatchObject({ kind: 'notFound', brandName: 'Yamaha' });
  });
});

describe('suggestVehicleModels', () => {
  it('依開頭相同字數排序,同分依名字(不看長度)', () => {
    const brand = TAXONOMY[0] as MockMotoBrand;
    // yzfr7x:R7 70th / R7 World GP / YZF-R7 都是前 5 字相同,YZF-R6 只有 4 ⇒ R6 出局;同分依名字
    expect(suggestVehicleModels(brand, 'yzf-r7x').map((s) => s.modelId)).toEqual([
      'yzf-r7-70th',
      'yzf-r7-world-gp-60th-anniversary',
      'yzf-r7',
    ]);
  });

  it('開頭相同字數多的排前面,即使名字排序較後', () => {
    const brand = TAXONOMY[0] as MockMotoBrand;
    // yzfr6x:YZF-R6 前 5 字相同,其他 YZF 只有 4 ⇒ R6 第一
    expect(suggestVehicleModels(brand, 'YZF R6X').map((s) => s.modelId)[0]).toBe('yzf-r6');
  });

  it('輸入含其他符號(句點):照寬鬆鍵原樣比,句點不會被去掉', () => {
    const brand = TAXONOMY[0] as MockMotoBrand;
    // yzf.r7 與各台只有前 3 字 yzf 相同 ⇒ 全部同分、依名字
    expect(suggestVehicleModels(brand, 'yzf.r7').map((s) => s.modelId)).toEqual([
      'yzf-r7-70th',
      'yzf-r7-world-gp-60th-anniversary',
      'yzf-r6',
    ]);
  });
});

describe('withVehicleParam', () => {
  const w = (qs: string, seg: string | null) => withVehicleParam(new URLSearchParams(qs), seg).toString();
  it('設定短版、保留其他參數', () => {
    expect(w('category=A&page=2', 'yamaha:yzf-r7')).toBe('category=A&page=2&vehicle=yamaha%3Ayzf-r7');
  });
  it('清除:短版與長版一起刪', () => {
    expect(w('vehicle=yamaha:mt-07&page=2', null)).toBe('page=2');
    expect(w('brand=yamaha&model=mt-07&year=2020&page=2', null)).toBe('page=2');
  });
  it('🔴 單獨的 ?brand=(商品品牌篩選)不能被刪', () => {
    expect(w('brand=akrapovic&vehicle=yamaha:mt-07', null)).toBe('brand=akrapovic');
    expect(w('brand=akrapovic', 'yamaha:yzf-r7')).toBe('brand=akrapovic&vehicle=yamaha%3Ayzf-r7');
  });
});
