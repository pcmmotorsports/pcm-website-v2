// vehicle-match 單測(V-1b 比對核心;REQUIRED-2 正規化規格)。

import { describe, it, expect } from 'vitest';
import { normalizeVehicleQuery, filterVehicleOptions, uniqueExactMatch } from './vehicle-match';

const BRANDS = [{ name: 'Yamaha' }, { name: 'Kawasaki' }, { name: 'KTM' }, { name: 'Kymco' }];
const nameOf = (b: { name: string }) => b.name;

describe('normalizeVehicleQuery', () => {
  it('trim+小寫+全形→半形(NFKC);不動內容字面以外的東西', () => {
    expect(normalizeVehicleQuery('  Ya ')).toBe('ya');
    expect(normalizeVehicleQuery('ＹＡＭＡＨＡ')).toBe('yamaha');
    expect(normalizeVehicleQuery('ｒ６')).toBe('r6');
  });
});

describe('filterVehicleOptions — prefix 優先、substring 殿後、字典字面直出', () => {
  it('ya → Yamaha(prefix);k → Kawasaki/KTM/Kymco 保序', () => {
    expect(filterVehicleOptions(BRANDS, 'ya', nameOf).map(nameOf)).toEqual(['Yamaha']);
    expect(filterVehicleOptions(BRANDS, 'k', nameOf).map(nameOf)).toEqual([
      'Kawasaki',
      'KTM',
      'Kymco',
    ]);
  });

  it('substring 命中排 prefix 之後;空查詢=全清單;全形查詢可命中', () => {
    const models = [{ name: 'MT-09 SP' }, { name: 'SP-9' }];
    expect(filterVehicleOptions(models, 'sp', nameOf).map(nameOf)).toEqual(['SP-9', 'MT-09 SP']);
    expect(filterVehicleOptions(BRANDS, '', nameOf)).toHaveLength(4);
    expect(filterVehicleOptions(BRANDS, 'ＹＡ', nameOf).map(nameOf)).toEqual(['Yamaha']);
  });

  it('查無 → 空陣列(不猜、不模糊)', () => {
    expect(filterVehicleOptions(BRANDS, 'zzz', nameOf)).toEqual([]);
  });
});

describe('uniqueExactMatch — 唯一精確命中才回(REQUIRED-2 自動套用條件)', () => {
  it('正規化全等恰一 → 回原字面物件;prefix 命中不算', () => {
    expect(uniqueExactMatch(BRANDS, 'yamaha', nameOf)?.name).toBe('Yamaha');
    expect(uniqueExactMatch(BRANDS, 'ＹＡＭＡＨＡ ', nameOf)?.name).toBe('Yamaha');
    expect(uniqueExactMatch(BRANDS, 'ya', nameOf)).toBeNull();
  });

  it('0 或多個全等 → null;空查詢 → null', () => {
    const dup = [{ name: 'R6' }, { name: 'r6' }];
    expect(uniqueExactMatch(dup, 'R6', nameOf)).toBeNull();
    expect(uniqueExactMatch(BRANDS, '', nameOf)).toBeNull();
  });
});
