// app/dev-preview/_components/PreviewHarness.tsx — dev-preview 共用骨架(WO-4)
//
// 抽出所有 dev-preview 頁的共同結構:「多變體並排 + 每變體上方說明標籤」。
// M-1-09 filter-side 預覽頁原本各自手刻 flex layout + labelStyle;M-1-10 FilterTop /
// M-1-11 FilterModal 等後續 Filter slice 直接複用本骨架、不重造。
//
// `_components/` 是 Next.js 私有資料夾(底線前綴)、不會被當成 route。
// dev-preview/* 全部 route 屬開發臨時驗證頁、在 M-6 / 部署前移除(backlog #147);
// 本骨架同屬 dev-preview/ 子樹、一併移除。
//
// mock data 注入:各 dev-preview 頁自行組 mock data、透過 variant.node 傳入
// (mock 形狀依元件而異、不適合骨架統一持有);骨架只負責並排 layout + 標籤。

import type { ReactNode } from 'react';

export type PreviewVariant = {
  /** 該變體上方的說明標籤(講清楚這個並排格在驗什麼) */
  label: string;
  /** 要預覽的元件節點(mock data 已由呼叫頁注入) */
  node: ReactNode;
};

const labelStyle = {
  font: '600 13px/1.5 system-ui, sans-serif',
  padding: '12px 16px',
  background: '#f4f4f5',
  margin: 0,
} as const;

export function PreviewHarness({ variants }: { variants: PreviewVariant[] }) {
  return (
    <main style={{ display: 'flex', gap: 48, minHeight: '100vh', padding: 24 }}>
      {variants.map((v) => (
        <div key={v.label}>
          <p style={labelStyle}>{v.label}</p>
          {v.node}
        </div>
      ))}
    </main>
  );
}
