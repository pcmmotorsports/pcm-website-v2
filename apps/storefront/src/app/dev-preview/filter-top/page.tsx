// app/dev-preview/filter-top/page.tsx — M-1-10 肉眼驗 harness
//
// FilterTop / CascadeFilterTop 兩變體單獨預覽頁(ProductsPage M-1-12 尚未做、
// 無宿主頁可驗)。並排:
//   FilterTop        — top 樣式(chip + dropdown)
//   CascadeFilterTop — cascade 樣式(品牌 / 車型 / 年份 連動下拉)
// dev-preview/* 全部 route 屬開發臨時驗證頁、在 M-6 / 部署前移除(backlog #147)。
//
// 並排 layout + 標籤用共用骨架 PreviewHarness(WO-4)。

import { FilterTop, type FilterTopData } from '@/components/FilterTop';
import { CascadeFilterTop } from '@/components/CascadeFilterTop';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { MOCK_CATEGORIES } from '@/data/mock-categories';
import { MOCK_BRANDS } from '@/data/mock-brands';
import { PreviewHarness } from '../_components/PreviewHarness';

const data: FilterTopData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

export default function FilterTopPreviewPage() {
  return (
    <PreviewHarness
      variants={[
        {
          label: 'FilterTop — top 樣式(chip + dropdown)',
          node: <FilterTop data={data} resultCount={128} />,
        },
        {
          label: 'CascadeFilterTop — cascade 樣式(品牌 / 車型 / 年份 連動下拉)',
          node: <CascadeFilterTop data={data} />,
        },
      ]}
    />
  );
}
