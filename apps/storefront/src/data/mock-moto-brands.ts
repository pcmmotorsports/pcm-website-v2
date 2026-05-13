/**
 * Mock moto brands(車輛廠牌)— 字面從 design-reference/data/products.js @ 25d3a2a 直接搬
 * VehicleFinder section 用、d2 接 vehicle adapter(Phase 2 vehicle ecosystem)時 fallback
 */

export type MockMotoModel = {
  id: string;
  name: string;
  years: number[];
};

export type MockMotoBrand = {
  id: string;
  name: string;
  models: MockMotoModel[];
};

export const MOCK_MOTO_BRANDS: MockMotoBrand[] = [
  { id: 'yamaha', name: 'YAMAHA', models: [
    { id: 'r1', name: 'YZF-R1', years: [2020, 2021, 2022, 2023, 2024] },
    { id: 'r6', name: 'YZF-R6', years: [2018, 2019, 2020] },
    { id: 'mt09', name: 'MT-09', years: [2021, 2022, 2023, 2024] },
    { id: 'mt10', name: 'MT-10', years: [2022, 2023, 2024] },
  ]},
  { id: 'honda', name: 'HONDA', models: [
    { id: 'cbr1000rr', name: 'CBR1000RR-R', years: [2020, 2021, 2022, 2023] },
    { id: 'cbr600rr', name: 'CBR600RR', years: [2013, 2014, 2015, 2024] },
    { id: 'cb650r', name: 'CB650R', years: [2021, 2022, 2023, 2024] },
  ]},
  { id: 'ducati', name: 'DUCATI', models: [
    { id: 'panigale-v4', name: 'Panigale V4', years: [2020, 2021, 2022, 2023, 2024] },
    { id: 'panigale-v2', name: 'Panigale V2', years: [2020, 2021, 2022, 2023] },
    { id: 'monster', name: 'Monster', years: [2021, 2022, 2023, 2024] },
    { id: 'streetfighter', name: 'Streetfighter V4', years: [2022, 2023, 2024] },
  ]},
  { id: 'bmw', name: 'BMW', models: [
    { id: 's1000rr', name: 'S1000RR', years: [2020, 2021, 2022, 2023, 2024] },
    { id: 'm1000rr', name: 'M1000RR', years: [2023, 2024] },
    { id: 's1000r', name: 'S1000R', years: [2021, 2022, 2023, 2024] },
  ]},
  { id: 'kawasaki', name: 'KAWASAKI', models: [
    { id: 'zx10r', name: 'Ninja ZX-10R', years: [2021, 2022, 2023, 2024] },
    { id: 'zx6r', name: 'Ninja ZX-6R', years: [2019, 2020, 2023, 2024] },
  ]},
  { id: 'aprilia', name: 'APRILIA', models: [
    { id: 'rsv4', name: 'RSV4', years: [2021, 2022, 2023, 2024] },
    { id: 'tuono', name: 'Tuono V4', years: [2021, 2022, 2023, 2024] },
  ]},
  { id: 'suzuki', name: 'SUZUKI', models: [
    { id: 'gsxr1000', name: 'GSX-R1000', years: [2017, 2018, 2019, 2020, 2021] },
  ]},
  { id: 'mv-agusta', name: 'MV AGUSTA', models: [
    { id: 'f3', name: 'F3 800', years: [2020, 2021, 2022] },
  ]},
];
