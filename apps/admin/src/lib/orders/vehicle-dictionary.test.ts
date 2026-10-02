import { describe, expect, it } from 'vitest';
import { looseIlikePattern, rankVehicleHits, type VehicleDictionaryHit } from './vehicle-dictionary';

// 2026-10-02 Sean:後台車種搜尋要跟顧客站一樣聰明(大小寫、連字號、空格、全形半形都忽略;打部分字也列出;相關度排序)。
// 比對規則共用顧客站的 vehicle-match(@pcm/domain), 不另寫一份。字典真的沒有那台車 ⇒ 不列候選(畫面照舊只剩「照打」)。

// 正式庫 2026-10-02 唯讀查到的 GSX-8 系列, 外加幾台同為 GSX 開頭的車, 驗「打 GSX 也找得到 GSX-8T」。
const DICT: VehicleDictionaryHit[] = [
  { brand: 'Suzuki', model: 'GSX-R1000' },
  { brand: 'Suzuki', model: 'GSX-R600' },
  { brand: 'Suzuki', model: 'GSX1300R Hayabusa' },
  { brand: 'Suzuki', model: 'GSX-S1000' },
  { brand: 'Suzuki', model: 'GSX-8S Team Edition' },
  { brand: 'Suzuki', model: 'GSX-8TT' },
  { brand: 'Suzuki', model: 'GSX-8S' },
  { brand: 'Suzuki', model: 'GSX-8T' },
  { brand: 'Suzuki', model: 'GSX-8R' },
  { brand: 'Suzuki', model: 'GSX-8S EVO' },
  { brand: 'Yamaha', model: 'YZF-R6' },
  { brand: 'Honda', model: 'CBR1000RR-R' },
];
const models = (q: string, max = 20) => rankVehicleHits(DICT, q, max).map((h) => h.model);

describe('rankVehicleHits(後台車種搜尋, 共用顧客站比對)', () => {
  it('GSX8s ⇒ 第一個是 GSX-8S(沒打連字號、大小寫不同也對得到)', () => {
    expect(models('GSX8s')[0]).toBe('GSX-8S');
    expect(models('GSX8s')).toEqual(['GSX-8S', 'GSX-8S EVO', 'GSX-8S Team Edition']);
  });

  it('gsx 8t ⇒ GSX-8T 在最前, GSX-8TT 其次', () => {
    expect(models('gsx 8t')).toEqual(['GSX-8T', 'GSX-8TT']);
  });

  it('GSX-8S(照字典寫法)⇒ 一樣找得到', () => {
    expect(models('GSX-8S')[0]).toBe('GSX-8S');
  });

  it('全形 ＧＳＸ－８Ｔ ⇒ 一樣找得到', () => {
    expect(models('ＧＳＸ－８Ｔ')[0]).toBe('GSX-8T');
  });

  it('只打 GSX ⇒ 列出 GSX 開頭的車, 短的(較接近)排前面, GSX-8T 在候選裡', () => {
    const out = models('GSX');
    expect(out).toContain('GSX-8T');
    expect(out.indexOf('GSX-8T')).toBeLessThan(out.indexOf('GSX1300R Hayabusa'));
  });

  it('只打部分字 8T ⇒ 中段命中也列出(開頭命中的會排在前面)', () => {
    expect(models('8T')).toEqual(['GSX-8T', 'GSX-8TT']);
  });

  it('字典沒有的車 ⇒ 沒有候選(畫面照舊只剩「照打」)', () => {
    expect(models('GSX-9X')).toEqual([]);
  });

  it('最多回 max 筆', () => {
    expect(models('GSX', 3)).toHaveLength(3);
  });
});

describe('looseIlikePattern(資料庫粗篩, 讓連字號 / 空格不擋路)', () => {
  it('GSX8s / gsx 8t / 全形 ⇒ 每個字之間插 %', () => {
    expect(looseIlikePattern('GSX8s')).toBe('%g%s%x%8%s%');
    expect(looseIlikePattern('gsx 8t')).toBe('%g%s%x%8%t%');
    expect(looseIlikePattern('ＧＳＸ－８Ｔ')).toBe('%g%s%x%8%t%');
  });
  it('萬用字元被剝掉;不到 2 個字 ⇒ null(不查)', () => {
    expect(looseIlikePattern('g%s_x')).toBe('%g%s%x%');
    expect(looseIlikePattern('g')).toBeNull();
    expect(looseIlikePattern(' - ')).toBeNull();
  });
  it('anchored ⇒ 開頭不加 %(開頭命中那一組另撈, 短查詢不被 1000 列截掉)', () => {
    expect(looseIlikePattern('MT', true)).toBe('m%t%');
  });
});
