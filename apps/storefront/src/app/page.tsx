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
import { Header } from '@/components/Header';
import { HomeHero } from '@/components/HomeHero';
import { VehicleFinder } from '@/components/VehicleFinder';
import { FeatureEditorial } from '@/components/FeatureEditorial';
import { CategoryGrid } from '@/components/CategoryGrid';
import { HomeSelect } from '@/components/HomeSelect';
import { HomeStatement } from '@/components/HomeStatement';
import { BrandIndex } from '@/components/BrandIndex';
import { HomeFooter } from '@/components/HomeFooter';
import { fetchFeaturedProducts, fetchVehicleTaxonomy, fetchCategories } from '@/lib/products';
import { resolveTierFromRequest } from '@/lib/tier';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getVehicleRepo } from '@/lib/auth/composition';

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
  // tier 解析:?tier= override(env flag PCM_DEV_TIER_OVERRIDE=1)> cookie `pcm-tier` > 'general'
  // 邏輯抽至 @/lib/tier resolveTierFromRequest(M-1-13e-pre-1、Sean Q1=B 業務拍板:
  // 金額頁面必須區分會員、helper 立即抽、不等第 3 處撞 trigger)
  const params = await searchParams;
  const cookieStore = await cookies();
  const tier = await resolveTierFromRequest(params, cookieStore);

  // 三段互不依賴 → Promise.all 並行(perf/P2:原逐一 await 串行、跨區延遲三段相加是首頁
  // TTFB 主因之一;三函式的 adapter 查詢錯誤各自 catch 回 fallback → Promise.all 收到的是
  // resolved fallback 非 rejection。client 建構(env 缺)在 try 外會 throw——舊串行版同炸、非本片新增語意)。
  // - featured(perf/P3 釘 general、unstable_cache 900s):不再收 tier——public view 的
  //   store/premiumStore 價是 dummy 0、傳真 tier 會顯 NT$0 錯價,且 tier 變體不得進共用快取
  //   (plan §P3 明示語意變更;真 tier 定價待 #215)。tier 仍寫進 data-tier 供 dev DOM inspector debug。
  // - motoBrands(S2/#220b):VehicleFinder 接真 fitment 衍生車輛清單(輕量 fitments-only 查詢、
  //   失敗回 []);與 /products 解析端同一衍生函式 = 首頁選車深連結 id 空間一致、必命中列表過濾
  // - categories(Q4-S5):CategoryGrid 真分類化(修「首頁分類卡點了無過濾」死連結;同 /products
  //   側欄的 fetchCategories→buildCategoryTree,只列有商品分類、深連結 ?category=<真分類名> 必命中過濾)
  // - garage(V-1c):登入會員愛車 chips(RLS vehicles_*_own 守自己 row;未登入/讀取失敗
  //   → [] chips 整排不顯示、頁面不 500;本頁已 force-dynamic+讀 cookies=零額外快取語意變更)
  const [featured, motoBrands, categories, garage] = await Promise.all([
    fetchFeaturedProducts(),
    fetchVehicleTaxonomy(),
    fetchCategories(),
    (async () => {
      try {
        const supabase = await createServerSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return [];
        // 序列化面收窄:chips 只需 id/name/year(engine/km/mods 等不進 client props;皆為
        // 本人 own 資料、此為最小面原則非洩漏修補)
        const vehicles = await (await getVehicleRepo()).listByCustomer(user.id);
        return vehicles.map((v) => ({ id: v.id, name: v.name, year: v.year }));
      } catch (garageError) {
        console.error('[home] 愛車清單讀取失敗、chips 退化不顯示:', garageError);
        return [];
      }
    })(),
  ]);

  return (
    <div data-screen-label="Home" data-tier={tier} className="ed-page">
      <Header currentPage="home" />
      <HomeHero />
      <VehicleFinder motoBrands={motoBrands} garage={garage} />
      <FeatureEditorial />
      <CategoryGrid categories={categories} />
      <HomeSelect featured={featured} />
      <HomeStatement />
      <BrandIndex />
      <HomeFooter />
    </div>
  );
}
