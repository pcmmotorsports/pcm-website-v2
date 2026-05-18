// app/dev-preview/filter-side/page.tsx — M-1-09 肉眼驗 harness
//
// FilterSide 元件單獨預覽頁(ProductsPage M-1-12 尚未做、無宿主頁可驗)。
// 並排兩種模式:design ProductsPage.jsx L291 `hideVehicle={isCascade}` —
//   side 樣式 → hideVehicle=false → 含「依車輛搜尋」
//   cascade 樣式 → hideVehicle=true → 無「依車輛搜尋」(車輛改上方 CascadeFilterTop / M-1-10)
// dev-preview/* 全部 route 屬開發臨時驗證頁、在 M-6 / 部署前移除(backlog #147)。

import { FilterSide, type FilterSideData } from '@/components/FilterSide';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { MOCK_CATEGORIES } from '@/data/mock-categories';
import { MOCK_BRANDS } from '@/data/mock-brands';

const data: FilterSideData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

const labelStyle = {
  font: '600 13px/1.5 system-ui, sans-serif',
  padding: '12px 16px',
  background: '#f4f4f5',
  margin: 0,
} as const;

export default function FilterSidePreviewPage() {
  return (
    <main style={{ display: 'flex', gap: 48, minHeight: '100vh', padding: 24 }}>
      <div>
        <p style={labelStyle}>side 樣式 — hideVehicle=false(含「依車輛搜尋」)</p>
        <FilterSide data={data} />
      </div>
      <div>
        <p style={labelStyle}>cascade 樣式 — hideVehicle=true(車輛改上方 CascadeFilterTop / M-1-10)</p>
        <FilterSide data={data} hideVehicle />
      </div>
    </main>
  );
}
