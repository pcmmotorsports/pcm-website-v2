// MobileContext.tsx — 把 layout SSR 端用 UA 算的「是否手機」下傳給 client 元件(主要 Header),
// 讓 Header 在 SSR 階段就渲染正確的手機 / 桌機版,不靠不可靠的 client useEffect 切換
// (修 Sean 2026-06-04 真機驗:iPhone 卡在桌機版 header + 可水平平移)。
//
// 為何需要:Header 在各頁面渲染(非 layout)、且是 client 元件讀不到 server UA;
//   layout(server)用 user-agent 算 isMobile 後透過此 context 下傳。
//   Header 消費邏輯:isMobileProp ?? (ctxMobile || autoMobile)
//   — 明確 prop(單元測試 / dev-preview)優先;否則 server UA(SSR 首屏正確)OR client viewport(桌機縮窗響應)。
//
// design 對照(鐵則 1):design-reference/Header.jsx 是純前端 demo、無 SSR,故無此問題、也無此 context;
//   本檔為 storefront SSR 適配(business_override headerServerUAContext),手機 header 視覺不變。

'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** layout SSR 端 UA 判斷的「是否手機」;Provider 外(如單元測試)為 undefined → 退化用 Header 自身 autoMobile。 */
const MobileContext = createContext<boolean | undefined>(undefined);

export function MobileProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <MobileContext.Provider value={value}>{children}</MobileContext.Provider>;
}

/** Header 消費:取 layout SSR UA 判斷;Provider 外為 undefined。 */
export const useServerMobile = (): boolean | undefined => useContext(MobileContext);
