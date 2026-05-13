// app/page.tsx — 首頁(8 sections compose)
//
// 對齊 design-reference/components/HomePage.jsx @ 25d3a2a 字面(M-1-04-mini-slice 修:25d3a2a HomePage.jsx 加 tier prop、storefront 走 server-side cookie + designTierToSchema + tierLabel 預算 conceptually 更佳、不重做):
//   <Header /> + <HomeHero /> + <VehicleFinder /> + <FeatureEditorial />
//   + <CategoryGrid /> + <HomeSelect /> + <HomeStatement /> + <BrandIndex /> + <HomeFooter />
//
// page.tsx 本身為 server component(無 'use client'、不傳 callback prop);8 sections + Header + ProductCard
// 各自 'use client'(因 design 字面全含 onClick callback、Next.js server component 不可傳 function)。
// 此偏離 d1 指令 Step 4.2 字面「HomeHero / FeatureEditorial / HomeStatement / HomeFooter Server Component」
// 是 design 字面 vs Next.js 16 server-client boundary 衝突的 trade-off、commit body 揭示。
//
// d2 揭示(2026-05-09):N°04 真資料 server-side fetch、HomeSelect 接 props.featured(FeaturedResult
// = MockProduct[] + error flag)、priceByTier server-side strip 在 lib/products.ts toUIProduct 落實。
// 真實狀態:Supabase products 表 0 row(M-1-16 種子前)、HomeSelect 必走 Q-empty=b 分支。

import { cookies } from 'next/headers';
import { designTierToSchema } from '@pcm/domain';
import type { MemberTier } from '@pcm/domain';
import { Header } from '@/components/Header';
import { HomeHero } from '@/components/HomeHero';
import { VehicleFinder } from '@/components/VehicleFinder';
import { FeatureEditorial } from '@/components/FeatureEditorial';
import { CategoryGrid } from '@/components/CategoryGrid';
import { HomeSelect } from '@/components/HomeSelect';
import { HomeStatement } from '@/components/HomeStatement';
import { BrandIndex } from '@/components/BrandIndex';
import { HomeFooter } from '@/components/HomeFooter';
import { fetchFeaturedProducts } from '@/lib/products';

// d2 build 揭示:本頁 server-side fetch Supabase、build 階段預生成 SSG 會撞 env 未注入
// (build worker 不讀 monorepo root .env.local、`createSupabaseAnonClient` requireEnv throw)。
// 改 force-dynamic = SSR 每次 render 重撈、對齊 Phase 1 dev project 階段「真資料動態」精神。
// Production Vercel deploy 時 env 從 dashboard 注入、build/runtime 都 OK。
// 未來考慮 ISR(`export const revalidate = N`)平衡 latency vs 即時性、待 M-1-XX trigger。
export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // tier 來源 priority:?tier= 覆寫(PCM_DEV_TIER_OVERRIDE=1 時)→ cookie `pcm-tier` → 預設 'general'
  // env flag 包 ?tier=:production 預設關、防訪客 URL 加 ?tier=store 取得 dealer 價(對齊 PRD §3.1 R Q1=B)
  const params = await searchParams;
  const cookieStore = await cookies();
  const tierOverride =
    process.env.PCM_DEV_TIER_OVERRIDE === '1' && typeof params.tier === 'string'
      ? params.tier
      : undefined;
  const rawTier = tierOverride ?? cookieStore.get('pcm-tier')?.value ?? 'general';

  // designTierToSchema 對非預期值 throw、server 端 corrupt cookie / 攻擊 URL fallback 'general'
  let tier: MemberTier;
  try {
    tier = designTierToSchema(rawTier);
  } catch {
    tier = 'general';
  }

  // tier 傳給 fetchFeaturedProducts、由 toUIProduct 走 computeEffectivePrice 算 price / originalPrice / tierLabel
  // tier 同時寫進 data-tier 供 dev DOM inspector debug(server-side render 不影響 UI)
  const featured = await fetchFeaturedProducts(tier);

  return (
    <div data-screen-label="Home" data-tier={tier} className="ed-page">
      <Header cartCount={4} currentPage="home" />
      <HomeHero />
      <VehicleFinder />
      <FeatureEditorial />
      <CategoryGrid />
      <HomeSelect featured={featured} />
      <HomeStatement />
      <BrandIndex />
      <HomeFooter />
    </div>
  );
}
