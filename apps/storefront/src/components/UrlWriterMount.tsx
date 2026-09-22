'use client';
// UrlWriterMount.tsx — 掛 `useUrlWriter` 的空元件(:901,plan §3-4)。
// 放在 `app/products/(catalog)/layout.tsx` 與 `app/products/[slug]/layout.tsx`,排在 `children` 之後:
//   ① layout 不跟著頁面元件卸載 ⇒ 導航完成追蹤不會一起重置(第三輪實測 S13);
//   ② 排在後面 ⇒ 頁面的 effect 先跑、先登記落地處理,這裡才做落地分類。
// 🔴 不包 Suspense:詳情頁不能有載入邊界(`app/products/[slug]/no-loading-boundary.test.ts`)。
import { useUrlWriter } from '@/lib/url-writer';

export function UrlWriterMount() {
  useUrlWriter();
  return null;
}
