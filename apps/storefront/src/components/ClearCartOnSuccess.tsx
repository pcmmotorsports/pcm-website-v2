'use client';

// ClearCartOnSuccess.tsx — 3DS callback 清購物車品項(M-3 3DS-3)
//
// 為什麼:3DS 成功是「全新 callback 頁」(銀行把瀏覽器 GET 導回 /checkout/callback)、原結帳 SPA 連同
//   useChargePayment.clear() 政策已隨導頁消失 → 殘留的 localStorage 購物車會在成功後誘導客人重複下單/重複扣款
//   (master plan v5 B)。
// 🔴 A4 清車政策(清車 ⟺ **可能已扣款**;codex K2 r1 修正後):**paid + pending 掛本元件清品項**(pending 鎖仍持、
//   可能已扣);**no_attempt + failed 不掛**(no_attempt ⟺ failed/never 必然未扣款=清車零安全收益且摧毀失敗付款的車;
//   failed 已釋鎖、車保留可立即重結帳)。本元件由 callback page 決定是否掛載(掛 = 該清)。
//
// 🔴 must-fix(codex 關卡1):清車必 gate isHydrated。CartProvider mount effect 先 readStorage()→setItems +
//   setIsHydrated(true)、寫回 localStorage 又被 isHydrated gate。子元件 effect 早於 provider effect,若在 hydrate
//   「前」clear()、setItems([]) 會被 provider 隨後的 readStorage() 覆寫回舊車 = 成功未清。故等 isHydrated===true
//   才清(此時 readStorage 已跑完、clear 的空陣列才會被寫回 localStorage 生效)。
//
// 🔴 3DS-7(已落地、原 TODO 兌現):cart_session_id regenerate(換新 key)由 `regenerate` prop 控制。
//   callback page 僅在 **paid 分支**傳 `regenerate`(DB 確定 paid → 換新 key、防下次重購撞已 paid sibling 被
//   begin D2 誤擋);**pending 分支不傳**(模糊態、可能已扣未定 → 保留 key 讓 dedup 守住既有單、防雙扣;
//   plan §3 7b「clear() 點 × regenerate」表)。regenerate 與 clear 同 isHydrated gate(見下)。
//   (TTL 24h 為 7d、本片不做。)
//
// 不渲染任何視覺(return null);**只掛 callback page 的 paid / pending 渲染樹**(no_attempt 雖屬 processing 變體但不掛、
//   failed 不掛)、不入 CheckoutSuccess 預設分支
//   (CheckoutSuccess 為共用元件、CheckoutView 同步路徑復用、該路徑清車已由 useChargePayment 政策做、避免雙清)。

import { useEffect } from 'react';
import { useCart } from '@/contexts/CartContext';

export function ClearCartOnSuccess({ regenerate = false }: { regenerate?: boolean }) {
  const { clear, isHydrated, regenerateCartSession } = useCart();
  useEffect(() => {
    // isHydrated 完成才清/換 key(防 hydrate-race 覆寫;codex 關卡1 must-fix)。deps 全列、無 disable。
    if (!isHydrated) return;
    clear();
    // 🔴 僅 paid 分支(regenerate=true)換新 key;模糊態(pending)保留 key=dedup 防雙扣把手(plan §3 7b 表)。
    if (regenerate) regenerateCartSession();
  }, [isHydrated, clear, regenerate, regenerateCartSession]);
  return null;
}
