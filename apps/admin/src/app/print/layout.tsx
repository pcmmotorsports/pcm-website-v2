import './print-a4.css';

// `/print/...` 這段路由的 layout,**存在的唯一理由是把 `print-a4.css` 載進來**。
//
// 🔴 **為什麼需要一個 layout 而不是在兩支 `page.tsx` 各 import 一次**:
//    `@page` 沒有選擇器、侷限不了 ⇒ 只能靠「哪些路由會載入這支 CSS」來侷限它。
//    各自 import 的話**下一張紙會忘記加**,而忘記的症狀是「那張紙印出來不是 A4」——
//    沒有任何東西會紅。放 layout ⇒ 這段路由底下新增的紙**自動吃到**。
//
// ⚠️ **本檔刻意不畫任何東西**(直接回 `children`):紙上的結構全在
//    `components/print/*-doc.tsx`,這裡多包一層 div 會多一個沒人知道存在的版面節點。
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return children;
}
