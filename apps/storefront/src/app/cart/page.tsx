// app/cart/page.tsx — 購物車頁 route(M-3-S2-b2-d)
//
// /cart 對齊 design AccountPages.jsx CartPage(L11-178)。
// 版面 / 互動 / cart state 由 client 元件 CartView 負責(購物車內容在 localStorage、client-only);
// 顯示價由 CartView 經 app/cart/actions.ts resolveCartLines(server action)向 server 取
// (鐵則 12:價由 server 依 tier 取、client 不存價;階段① general-only)。
//
// Header NAV_ROUTE_MAP.cart 早已指向 '/cart'(M-1-04)、MobileTabBar 購物車 tab 本片解除 disabled(#194)。

import type { Metadata } from 'next';
import { CartView } from '@/components/CartView';
import { fetchVehicleTaxonomy } from '@/lib/products';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getVehicleRepo } from '@/lib/auth/composition';

export const metadata: Metadata = {
  title: '購物車 — PCM Motorsports',
  description: '查看你選購的部品、數量與金額，前往結帳。',
};

// V-2a:車款欄需車款字典(VehicleSelect)+ 登入會員愛車(快選);per-user 車庫讀取 → force-dynamic
// (對齊 products/page.tsx;避免 build 階段 SSG 撈 Supabase)。
export const dynamic = 'force-dynamic';

export default async function CartRoute() {
  // 併行取數:車款字典(全訪客快取版)+ 車庫(RLS own、容錯 []、序列化收窄、鏡像 products/page)
  const [motoBrands, garage] = await Promise.all([
    fetchVehicleTaxonomy(),
    (async () => {
      try {
        const supabase = await createServerSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return [];
        const vehicles = await (await getVehicleRepo()).listByCustomer(user.id);
        return vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          year: v.year,
          dictBrandName: v.dictBrandName,
          dictModelName: v.dictModelName,
          isPrimary: v.isPrimary,
        }));
      } catch (garageError) {
        console.error('[cart] 愛車清單讀取失敗、快選退化不顯示:', garageError);
        return [];
      }
    })(),
  ]);
  return <CartView motoBrands={motoBrands} garage={garage} />;
}
