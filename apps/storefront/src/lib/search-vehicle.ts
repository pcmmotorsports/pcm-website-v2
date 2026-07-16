// search-vehicle.ts — 讀全站選車 context → 購物車車款(V-2a 帶入路徑1「搜尋情境自動帶」)。
//
// V-2h/MF-4 抽出:原邏輯內嵌 ProductInfo.addToCart,但手機 sticky buybar(ProductPage.addToCart)
// 加購時未帶車款 = 同一商品經不同入口加購、車款有無不一致。抽成純函式供兩入口共用單一來源。
//
// 🔴 車種鐵律零猜:名稱字面欄齊全(brandName+modelName,REQUIRED-3 additive 欄)才帶入 kind:'dict'
// source:'search';舊 context 缺名稱欄 → undefined(不自動帶、禁 label 反解析)。

import type { CartItemVehicle } from '@/contexts/CartContext';
import { readVehicleContext } from '@/lib/vehicle-context';

/** 讀選車 context → CartItemVehicle(kind:'dict' source:'search');名稱不齊 → undefined(零猜)。 */
export function readSearchVehicle(): CartItemVehicle | undefined {
  const ctx = readVehicleContext();
  return ctx && ctx.brandName && ctx.modelName
    ? { kind: 'dict', brand: ctx.brandName, model: ctx.modelName, year: ctx.year, source: 'search' }
    : undefined;
}
