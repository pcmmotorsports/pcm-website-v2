'use client';

// ClearCartOnSuccess.tsx — 3DS callback 成交/處理中清購物車品項(M-3 3DS-3)
//
// 為什麼:3DS 成功是「全新 callback 頁」(銀行把瀏覽器 GET 導回 /checkout/callback)、原結帳 SPA 連同
//   useChargePayment.clear() 政策已隨導頁消失 → 殘留的 localStorage 購物車會在成功後誘導客人重複下單/重複扣款
//   (master plan v5 B)。本元件在 callback 的 paid / processing 渲染樹掛載、主動清品項(A4:paid + pending +
//   no_attempt 都清、只 failed 不清〔失敗已釋鎖、車保留可立即重結帳〕)。
//
// 🔴 must-fix(codex 關卡1):清車必 gate isHydrated。CartProvider mount effect 先 readStorage()→setItems +
//   setIsHydrated(true)、寫回 localStorage 又被 isHydrated gate。子元件 effect 早於 provider effect,若在 hydrate
//   「前」clear()、setItems([]) 會被 provider 隨後的 readStorage() 覆寫回舊車 = 成功未清。故等 isHydrated===true
//   才清(此時 readStorage 已跑完、clear 的空陣列才會被寫回 localStorage 生效)。
//
// 🔴 TODO(3DS-7、master plan v5 §2 + B):本片只清「購物車品項」;cart_session_id 的 regenerate(換新 key、TTL 24h)
//   留 3DS-7 —— 現 CartContext 無 cart_session_id 概念(Phase II 3DS-7 才引入)。3DS-7 接 cart_session_id 後,於此
//   isHydrated gate 內 clear() 旁補 regenerateCartSession()。
//
// 不渲染任何視覺(return null);**只掛 callback page 的 paid/processing 渲染樹**、不入 CheckoutSuccess 預設分支
//   (CheckoutSuccess 為共用元件、CheckoutView 同步路徑復用、該路徑清車已由 useChargePayment 政策做、避免雙清)。

import { useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';

export function ClearCartOnSuccess() {
  const { clear, isHydrated } = useCart();
  useEffect(() => {
    // isHydrated 完成才清(防 hydrate-race 覆寫;codex 關卡1 must-fix)。clear/isHydrated 入 deps、無 disable。
    if (isHydrated) clear();
  }, [isHydrated, clear]);
  return null;
}
