// app/dev-preview/brands/page.tsx — 品牌放量 9 家 showcase demo 索引(2026-07-10 夜、#212 方向3)
//
// Sean 晨間驗收入口:每家一列(來源規模 + 附件覆蓋 + 連結)。
// 資料 = 報價單 view 真資料 snapshot(fixtures.ts、kickoff §2-6);versus 版面內容為 showcase 元件本體。
// dev-preview/* 全部 route 屬開發臨時驗證頁、在 M-6 / 部署前移除(backlog #147)。

import Link from 'next/link';
// pd-page 容器樣式在 ProductPage.tsx 才 import(非全域)→ demo 頁自帶
import '@/styles/product-page.css';
import { BRAND_FIXTURES } from './fixtures';

export const metadata = { title: '品牌放量 demo 索引 | dev-preview', robots: { index: false } };

const NAMES: Record<string, string> = {
  evotech: 'Evotech Performance',
  lightech: 'LighTech',
  'cnc-racing': 'CNC Racing',
  'eazi-grip': 'Eazi-Grip',
  samco: 'Samco Sport',
  motogadget: 'Motogadget',
  front3d: 'Front3D',
  materya: 'Materya',
  ebc: 'EBC Brakes',
  'k-speed': 'K-SPEED',
  extreme: 'Extreme Components',
};

export default function BrandDemoIndexPage() {
  return (
    <main className="pd-page">
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '8px 0 4px' }}>品牌放量 demo(11 家)</h1>
      <p style={{ color: 'var(--c-text-2)', fontSize: 14, margin: '0 0 20px' }}>
        每家 = 品牌形象版面(N°01+N°02)+ 報價單真資料代表商品。點品牌名進入完整版面。
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        {Object.entries(BRAND_FIXTURES).map(([slug, f]) => (
          <Link
            key={slug}
            href={`/dev-preview/brands/${slug}`}
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline',
              border: '1px solid var(--c-border)', background: 'var(--c-surface)',
              padding: '14px 16px', textDecoration: 'none', color: 'var(--c-text)',
            }}
          >
            <strong style={{ fontSize: 16, minWidth: 190 }}>{NAMES[slug] ?? slug}</strong>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--c-text-2)' }}>
              {f.groups.toLocaleString()} 群 / {f.variants.toLocaleString()} 變體
              {f.pdfGroups > 0 && ` · PDF ${f.pdfGroups.toLocaleString()} 群`}
              {f.videoGroups > 0 && ` · 影片 ${f.videoGroups} 群`}
            </span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--c-text-3)' }}>
              {f.topCats.slice(0, 3).map((c) => c.cat).join(' · ')}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
