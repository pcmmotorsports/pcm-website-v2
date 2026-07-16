// cart-vehicle-format.ts — 購物車車款顯示字面(純函式、無 React/DOM 依賴)。
//
// V-2h/MF-6 抽出理由:formatCartVehicle 原在 components/CartVehicleField.tsx('use client'、
// 內含 VehicleSelect/garage-chip/fitment-match 等重依賴)。結帳確認頁 CheckoutStep3 只需這顆
// 純顯示格式化函式、卻會被迫把整個 CartVehicleField 模組拉進 checkout bundle;故把純函式搬到
// 本無依賴模組供多處共用(對齊 lib/vehicle-url.ts 自 products-url-state 抽出的先例)。
// CartVehicleField re-export 保 back-compat(既有 import + 測試零動)。

import type { CartItemVehicle } from '@/contexts/CartContext';
import { vehicleLabel } from '@/lib/vehicle-match';

/** 車款欄顯示字面(dict=品牌車型+年;free=raw+年)。 */
export function formatCartVehicle(v: CartItemVehicle): string {
  if (v.kind === 'dict') {
    return [v.year, vehicleLabel(v.brand, v.model)].filter(Boolean).join(' ');
  }
  return [v.year, v.raw].filter(Boolean).join(' ');
}
