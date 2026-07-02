// vehicle-taxonomy 單元測試 — buildVehicleTaxonomy 從 fitment 動態衍生 品牌→車型→年份。

import { describe, expect, it } from 'vitest';
import { buildVehicleTaxonomy } from './vehicle-taxonomy';
import type { MockProduct } from '@/data/mock-products';

type Fitments = NonNullable<MockProduct['fitments']>;

function makeProduct(id: number, fitments: Fitments): MockProduct {
  return {
    id,
    slug: `p-${id}`,
    brand: 'RPM CARBON',
    name: `Product ${id}`,
    fits: 'x',
    price: 1000,
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: true,
    category: '碳纖維部品',
    color: 'silver',
    imgTone: 'neutral',
    fitments,
  };
}

describe('buildVehicleTaxonomy', () => {
  it('returns [] for empty input', () => {
    expect(buildVehicleTaxonomy([])).toEqual([]);
  });

  it('ignores products without fitments', () => {
    const p = makeProduct(1, []);
    delete (p as { fitments?: unknown }).fitments;
    expect(buildVehicleTaxonomy([p])).toEqual([]);
  });

  it('builds brand → model → year tree from fitments', () => {
    const tax = buildVehicleTaxonomy([
      makeProduct(1, [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2020, yearEnd: 2022 }]),
    ]);
    expect(tax).toHaveLength(1);
    expect(tax[0]!.name).toBe('Ducati');
    expect(tax[0]!.id).toBe('ducati');
    expect(tax[0]!.models).toHaveLength(1);
    expect(tax[0]!.models[0]!.name).toBe('Panigale V4');
    expect(tax[0]!.models[0]!.id).toBe('panigale-v4');
    // 明確範圍 2020..2022 inclusive
    expect(tax[0]!.models[0]!.years).toEqual([2020, 2021, 2022]);
  });

  it('expands single year (yearEnd omitted) to [yearStart]', () => {
    const tax = buildVehicleTaxonomy([
      makeProduct(1, [{ motoBrand: 'Honda', modelCode: 'CBR', yearStart: 2024 }]),
    ]);
    expect(tax[0]!.models[0]!.years).toEqual([2024]);
  });

  it('expands open-ended (yearEnd null) up to data max year', () => {
    // Panigale 2020+ (open-ended) 與 Monster 2023(單年)共存 → maxYear=2023 → Panigale 展到 2023
    const tax = buildVehicleTaxonomy([
      makeProduct(1, [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2020, yearEnd: null }]),
      makeProduct(2, [{ motoBrand: 'Ducati', modelCode: 'Monster', yearStart: 2023 }]),
    ]);
    const panigale = tax[0]!.models.find((m) => m.name === 'Panigale V4')!;
    expect(panigale.years).toEqual([2020, 2021, 2022, 2023]);
  });

  it('dedupes and sorts years across multiple products', () => {
    const tax = buildVehicleTaxonomy([
      makeProduct(1, [{ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020, yearEnd: 2021 }]),
      makeProduct(2, [{ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2021, yearEnd: 2022 }]),
    ]);
    expect(tax[0]!.models[0]!.years).toEqual([2020, 2021, 2022]);
  });

  it('sorts brands and models alphabetically', () => {
    const tax = buildVehicleTaxonomy([
      makeProduct(1, [
        { motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2020 },
        { motoBrand: 'BMW', modelCode: 'S1000RR', yearStart: 2020 },
        { motoBrand: 'BMW', modelCode: 'M1000RR', yearStart: 2020 },
      ]),
    ]);
    expect(tax.map((b) => b.name)).toEqual(['BMW', 'Yamaha']);
    expect(tax[0]!.models.map((m) => m.name)).toEqual(['M1000RR', 'S1000RR']);
  });

  it('dedupes colliding brand slugs with suffix (keeps both nodes addressable)', () => {
    // #211 未正規化來源:兩個名稱 slugify 撞同 slug → 第二個加序號、React key / URL 反查不撞
    const tax = buildVehicleTaxonomy([
      makeProduct(1, [{ motoBrand: 'MV Agusta', modelCode: 'F3', yearStart: 2020 }]),
      makeProduct(2, [{ motoBrand: 'MV-Agusta', modelCode: 'F4', yearStart: 2020 }]),
    ]);
    expect(tax).toHaveLength(2);
    expect(tax.map((b) => b.id).sort()).toEqual(['mv-agusta', 'mv-agusta-2']);
  });

  it('only lists vehicles that actually have products (no dead options)', () => {
    const tax = buildVehicleTaxonomy([
      makeProduct(1, [{ motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2020 }]),
    ]);
    // 只有 Ducati Panigale V4;不會憑空冒出主表其他 4003 車型
    expect(tax).toHaveLength(1);
    expect(tax[0]!.models).toHaveLength(1);
  });
});
