// account-nav.ts — 會員中心分頁清單的**單一來源**。
//
// 🔴🔴 **為什麼它不住在 `AccountView.tsx` 裡了(2026-08-27,真瀏覽器抓到的)**:
//    `AccountView.tsx` 有 `'use client'`。從 **server component**(`app/account/page.tsx`)
//    import 它的普通 export 時,拿到的**不是那個陣列** —— 是 React 的 client reference。
//    ⇒ 執行期炸:`ACCOUNT_TAB_IDS.includes is not a function`,頁面 500。
//    🔴 **而單元測試【全綠】** —— vitest 直接 import 那支模組,**它的世界裡沒有 RSC 邊界**。
//    📌 **那把尺量得到邏輯,量不到「這段碼會跑在哪一側」。而畫面壞在後者。**
//    ⇒ 本檔**不帶 `'use client'`**、只有純資料 ⇒ server 與 client 都 import 得到同一份。
//
// ⚠️ 往這裡加分頁時:`path` 是 SVG 的 `d`/`rect` 片段(字串,不是 JSX)——
//    保持純資料,一旦放進 JSX 或 icon 元件,這支檔就又跨不過邊界了。

export const NAV = [
  {
    id: 'overview',
    label: '總覽',
    path: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  },
  {
    id: 'orders',
    label: '訂單記錄',
    path: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  },
  {
    id: 'wallet',
    label: '儲值金',
    path: '<rect x="2" y="6" width="20" height="13" rx="1"/><path d="M2 10h20"/><path d="M16 15h3"/>',
  },
  {
    id: 'favorites',
    label: '收藏清單',
    path: '<path d="M12 20.5 4.2 13a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3A4.6 4.6 0 0 1 19.8 13z"/>',
  },
  {
    id: 'vehicles',
    label: '我的愛車',
    // 原為汽車 path,2026-08-07 Sean 拍板 Q2=A 換成重機(複用 tabbar「找車」那支)。
    path: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h8l-2-6h-3L6 17Z"/><path d="m14 11 1-3h3"/>',
  },
  {
    id: 'address',
    label: '收件地址',
    path: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  },
  {
    id: 'profile',
    label: '個人資料',
    path: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  },
] as const;

type TabId = (typeof NAV)[number]['id'];

/**
 * 合法分頁代號的**唯一副本**,從 `NAV` 推出來(2026-08-27)。
 * 🔴 **`page.tsx` 要驗 `?tab=` 是不是合法值,而它【不再自己打一份七個字串】** ——
 *    兩份清單會漂,而漂掉的那天:`NAV` 加了第八個分頁,`page.tsx` 那份沒加
 *    ⇒ 那個合法分頁被判成不合法、**安靜落總覽**,而沒有任何東西會紅。
 * ⚠️ 這是 `export`,而它是**給 server 端用的**(純陣列、不帶任何 client 依賴)。
 */
export const ACCOUNT_TAB_IDS = NAV.map((n) => n.id);
export type AccountTabId = TabId;
