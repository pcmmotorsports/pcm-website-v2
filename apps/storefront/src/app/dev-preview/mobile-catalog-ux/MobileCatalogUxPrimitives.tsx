import styles from './mobile-catalog-ux.module.css';

export type Sheet = 'vehicle' | 'category' | 'filter' | 'sort' | null;
export type Vehicle = { brand: string; model: string; year: string };
export type Category = { name: string; count: number };

export const EMPTY_VEHICLE: Vehicle = { brand: '', model: '', year: '' };
export const CBR600RR: Vehicle = { brand: 'HONDA', model: 'CBR600RR', year: '2021' };
export const MT09: Vehicle = { brand: 'YAMAHA', model: 'MT-09', year: '2021' };

export const VEHICLE_OPTIONS = [
  { brand: 'HONDA', models: [{ name: 'CBR600RR', years: ['2024', '2023', '2022', '2021'] }, { name: 'CBR1000RR-R', years: ['2024', '2023', '2022'] }] },
  { brand: 'YAMAHA', models: [{ name: 'MT-09', years: ['2024', '2023', '2022', '2021'] }, { name: 'YZF-R7', years: ['2024', '2023', '2022'] }] },
  { brand: 'KAWASAKI', models: [{ name: 'NINJA 400', years: ['2023', '2022', '2021'] }, { name: 'ZX-6R', years: ['2024', '2023', '2022'] }] },
  { brand: 'DUCATI', models: [{ name: 'PANIGALE V4', years: ['2024', '2023', '2022'] }, { name: 'MONSTER', years: ['2024', '2023', '2022', '2021'] }] },
];

export const CATEGORIES: Category[] = [
  { name: '拉桿與把手', count: 36 },
  { name: '外觀與後視鏡', count: 26 },
  { name: '碳纖維部品', count: 20 },
  { name: '騎士用品與配件', count: 16 },
  { name: '燈具與電子', count: 15 },
  { name: '車身防護與防摔', count: 14 },
  { name: '腳踏後移與傳動', count: 11 },
  { name: '引擎與冷卻', count: 6 },
  { name: '操控部品', count: 6 },
  { name: '煞車系統', count: 5 },
  { name: '排氣系統', count: 3 },
  { name: '精品螺絲與螺帽', count: 2 },
  { name: '車殼外觀', count: 1 },
];

export const PRODUCTS = [
  { name: '可調式煞車離合器拉桿組', brand: 'EVOTECH', price: 'NT$ 6,280' },
  { name: '短版煞車拉桿', brand: 'LIGHTECH', price: 'NT$ 3,680' },
  { name: '鋁合金拉桿護弓', brand: 'CNC RACING', price: 'NT$ 4,180' },
  { name: '平衡端子組', brand: 'BARRACUDA', price: 'NT$ 1,280' },
  { name: '碳纖維前土除', brand: 'RPM CARBON', price: 'NT$ 8,900' },
  { name: '可調式腳踏後移', brand: 'LIGHTECH', price: 'NT$ 15,800' },
];

export function SheetHeader({ title, closeLabel, onClose }: {
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header className={styles.sheetHeader}>
      <span className={styles.sheetHandle} aria-hidden="true" />
      <h2>{title}</h2>
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label={closeLabel}>×</button>
    </header>
  );
}

export function FilterIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
