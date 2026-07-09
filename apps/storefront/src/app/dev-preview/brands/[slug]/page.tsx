// app/dev-preview/brands/[slug]/page.tsx — 單一品牌完整版面 demo(2026-07-10 夜、#212 方向3)
//
// 渲染:①來源規模列(報價單 view 真資料 snapshot)②品牌形象版面(showcase 元件、與正式商品頁同一份)
// ③代表商品條(真商品圖/名/價/分類=接線後商品頁素材)④安裝資源 sample(該家來源真有影片才渲染;
//   驗混格式 youtube/vimeo facade——mp4 來源今晚全家皆 0、fixture 層由 InstallResources.test 覆蓋)。
// dev-preview/* 屬開發臨時驗證頁、M-6 前移除(backlog #147)。

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
// pd-* 樣式在 ProductPage.tsx 才 import(非全域);demo 頁獨立渲染 showcase → 必須自帶,否則裸奔
import '@/styles/product-page.css';
import { InstallResources } from '@/components/InstallResources';
import { EvotechShowcase } from '@/components/EvotechShowcase';
import { LightechShowcase } from '@/components/LightechShowcase';
import { CncRacingShowcase } from '@/components/CncRacingShowcase';
import { EaziGripShowcase } from '@/components/EaziGripShowcase';
import { SamcoShowcase } from '@/components/SamcoShowcase';
import { MotogadgetShowcase } from '@/components/MotogadgetShowcase';
import { Front3dShowcase } from '@/components/Front3dShowcase';
import { MateryaShowcase } from '@/components/MateryaShowcase';
import { EbcShowcase } from '@/components/EbcShowcase';
import { BRAND_FIXTURES } from '../fixtures';

export const metadata = { robots: { index: false } };

const SHOWCASES: Record<string, () => ReactNode> = {
  evotech: () => <EvotechShowcase />,
  lightech: () => <LightechShowcase />,
  'cnc-racing': () => <CncRacingShowcase />,
  'eazi-grip': () => <EaziGripShowcase />,
  samco: () => <SamcoShowcase />,
  motogadget: () => <MotogadgetShowcase />,
  front3d: () => <Front3dShowcase />,
  materya: () => <MateryaShowcase />,
  ebc: () => <EbcShowcase />,
};

export function generateStaticParams() {
  return Object.keys(SHOWCASES).map((slug) => ({ slug }));
}

export default async function BrandDemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Object.hasOwn:擋 constructor/__proto__ 等原型鏈 key(命中繼承成員 → 下行取值 TypeError 500 而非 404;
  // 對齊 supplier-config fail-closed 慣例、adversarial F5)
  if (!Object.hasOwn(SHOWCASES, slug) || !Object.hasOwn(BRAND_FIXTURES, slug)) notFound();
  const render = SHOWCASES[slug]!;
  const fixture = BRAND_FIXTURES[slug]!;

  // 安裝資源 sample:該家來源真有影片才示範(cnc=Vimeo、ebc=YouTube;fixture snapshot 真 URL)
  const sampleVideo = fixture.videoSamples[0] ?? fixture.products.find((p) => p.video)?.video ?? undefined;

  return (
    <main className="pd-page">
      <p style={{ fontFamily: 'var(--f-mono)', fontSize: 12, margin: '0 0 6px' }}>
        <Link href="/dev-preview/brands" style={{ color: 'var(--c-text-2)' }}>← 品牌放量 demo 索引</Link>
      </p>
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline',
          border: '1px solid var(--c-border)', background: 'var(--c-surface)',
          padding: '10px 14px', marginBottom: 18, fontFamily: 'var(--f-mono)', fontSize: 12,
        }}
      >
        <strong style={{ fontSize: 14 }}>{slug}</strong>
        <span>{fixture.groups.toLocaleString()} 群 / {fixture.variants.toLocaleString()} 變體</span>
        <span>PDF {fixture.pdfGroups.toLocaleString()} 群 · 影片 {fixture.videoGroups} 群</span>
        <span style={{ color: 'var(--c-text-3)' }}>{fixture.topCats.map((c) => `${c.cat} ${c.groups}`).join(' · ')}</span>
      </div>

      {/* 品牌形象版面(與正式商品頁同一份元件) */}
      {render()}

      {/* 代表商品條(報價單 view 真資料 snapshot;接線後商品頁的實際素材長相) */}
      <section className="pd-section" aria-label="代表商品(真資料 snapshot)">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">Ⅴ</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">代表商品 · 報價單真資料</span>
          </div>
        </div>
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            {fixture.products.slice(0, 4).map((p) => (
              <article key={p.mainSku} className="pd-bs-mcard">
                {/* 外部商品圖(報價單 view image_url、與商品頁同授權基礎) */}
                <img className="pd-bs-mcard-img" src={p.img} alt={p.nameZh} loading="lazy" />
                <div className="pd-bs-mcard-b">
                  <div className="pd-bs-mcard-en">{p.cat} · {p.mainSku}</div>
                  <div className="pd-bs-mcard-t">{p.nameZh}</div>
                  <div className="pd-bs-mcard-d">
                    {p.vehicle ? `${p.vehicle} · ` : ''}
                    {p.price != null ? `NT$${p.price.toLocaleString()}` : '—'}
                    {p.pdfs > 0 ? ` · 說明書 ${p.pdfs}` : ''}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 安裝資源 sample(真影片 URL、驗混格式 facade;無影片來源家不渲染) */}
      {sampleVideo && (
        <section className="pd-section" aria-label="安裝資源 sample" style={{ maxWidth: 480 }}>
          <div className="pd-section-head">
            <div className="pd-eyebrow">
              <span className="pd-eb-no">Ⅵ</span>
              <span className="pd-eb-sep" aria-hidden="true" />
              <span className="pd-eb-label">安裝資源 sample(來源真影片)</span>
            </div>
          </div>
          <InstallResources videoUrl={sampleVideo} />
        </section>
      )}
    </main>
  );
}
