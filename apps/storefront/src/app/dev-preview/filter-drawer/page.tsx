// app/dev-preview/filter-drawer/page.tsx — M-1-11 肉眼驗 harness
//
// FilterDrawer 元件單獨預覽頁(ProductsPage M-1-12 尚未做、無宿主頁可驗)。
// FilterDrawer 為 position:fixed modal、需宿主控制 open;本頁用 DrawerDemo 小型
// client wrapper 提供「開啟篩選抽屜」按鈕 + open state、模擬宿主。
// 並排兩變體:
//   桌機 modal — 預設右側 440px 抽屜
//   手機模擬   — 包 [data-mobile="true"]、套 filter-drawer.css 手機浮動面板樣式
// dev-preview/* 全部 route 屬開發臨時驗證頁、在 M-6 / 部署前移除(backlog #147)。
//
// 並排 layout + 標籤用共用骨架 PreviewHarness(WO-4)。

'use client';

import { useState } from 'react';
import { FilterDrawer, type FilterDrawerData } from '@/components/FilterDrawer';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { MOCK_CATEGORIES } from '@/data/mock-categories';
import { MOCK_BRANDS } from '@/data/mock-brands';
import { PreviewHarness } from '../_components/PreviewHarness';

const data: FilterDrawerData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

const openButtonStyle = {
  font: '600 14px/1 system-ui, sans-serif',
  padding: '12px 20px',
  margin: 16,
  border: '1px solid #18181b',
  background: '#18181b',
  color: '#fff',
  cursor: 'pointer',
} as const;

function DrawerDemo({ mobile }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <button style={openButtonStyle} onClick={() => setOpen(true)}>開啟篩選抽屜</button>
      <FilterDrawer open={open} onClose={() => setOpen(false)} data={data} resultCount={128} />
    </>
  );
  return mobile ? <div data-mobile="true">{content}</div> : content;
}

export default function FilterDrawerPreviewPage() {
  return (
    <PreviewHarness
      variants={[
        {
          label: '桌機 modal — 右側 440px 抽屜',
          node: <DrawerDemo />,
        },
        {
          label: '手機模擬 — [data-mobile="true"] 浮動面板',
          node: <DrawerDemo mobile />,
        },
      ]}
    />
  );
}
