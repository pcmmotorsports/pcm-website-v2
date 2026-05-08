// app/page.tsx — 首頁(8 sections compose)
//
// 對齊 design-reference/components/HomePage.jsx @ d5ea3aa 字面:
//   <Header /> + <HomeHero /> + <VehicleFinder /> + <FeatureEditorial />
//   + <CategoryGrid /> + <HomeSelect /> + <HomeStatement /> + <BrandIndex /> + <HomeFooter />
//
// page.tsx 本身為 server component(無 'use client'、不傳 callback prop);8 sections + Header + ProductCard
// 各自 'use client'(因 design 字面全含 onClick callback、Next.js server component 不可傳 function)。
// 此偏離 d1 指令 Step 4.2 字面「HomeHero / FeatureEditorial / HomeStatement / HomeFooter Server Component」
// 是 design 字面 vs Next.js 16 server-client boundary 衝突的 trade-off、commit body 揭示。

import { Header } from '@/components/Header';
import { HomeHero } from '@/components/HomeHero';
import { VehicleFinder } from '@/components/VehicleFinder';
import { FeatureEditorial } from '@/components/FeatureEditorial';
import { CategoryGrid } from '@/components/CategoryGrid';
import { HomeSelect } from '@/components/HomeSelect';
import { HomeStatement } from '@/components/HomeStatement';
import { BrandIndex } from '@/components/BrandIndex';
import { HomeFooter } from '@/components/HomeFooter';

export default function HomePage() {
  return (
    <div data-screen-label="Home" className="ed-page">
      <Header cartCount={4} currentPage="home" />
      <HomeHero />
      <VehicleFinder />
      <FeatureEditorial />
      <CategoryGrid />
      <HomeSelect />
      <HomeStatement />
      <BrandIndex />
      <HomeFooter />
    </div>
  );
}
