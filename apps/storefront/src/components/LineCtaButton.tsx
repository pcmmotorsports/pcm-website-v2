// LineCtaButton.tsx — 商品頁「LINE 詢價」懸浮 icon 圓鈕(新功能、無 design-reference 源;Sean 規格)。
//
// 接通現況唯一真實成交管道(站內無 /checkout、現有 LINE 提及全是純文字無連結)。
// 用原生 <a target="_blank"> 直跳(非 window.open;Sean 2026-06-04 真機驗:手機 window.open 被當 popup
// 擋 → 點無反應、原生 <a> 不被擋,對齊參考專案 pcm-moto):
// - 手機:href = oaMessage deep link、開 LINE App @pcmmoto 對話並預填(車型留空、車種鐵律)。
// - 桌機:href = lin.ee 加好友頁(oaMessage 預填桌機無效)。
//
// 🔴 車種鐵律:預填零車款字串(由 lib/line-cta.ts buildPrefillMessage 保證、本元件不碰車款欄)。
// business_override: lineCtaDeepLinkPrefill。
//
// href 策略:SSR + 初始 render 給 lin.ee(桌機 fallback、hydration-safe);mount 後 client 偵測
// 手機 → 換 oaMessage deep link。RWD:小圓鈕 fixed、手機 bottom 抬到 buybar 上方(z49、不擋購買列)。

'use client';

import { useEffect, useState } from 'react';
import type { MockProduct } from '@/data/mock-products';
import { LINE_ADD_URL, buildOaDeepLink, buildPrefillMessage } from '@/lib/line-cta';
import '@/styles/line-cta.css';

export type LineCtaButtonProps = { product: MockProduct };

/** 手機裝置偵測(deep link 預填僅手機 LINE App 有效;對齊 layout.tsx UA regex、補 iPad/iPod)。 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
}

export function LineCtaButton({ product }: LineCtaButtonProps) {
  // SSR + 初始 render 給 lin.ee 加好友(桌機 fallback、hydration-safe);
  // mount 後 client 偵測手機 → 換 oaMessage 預填 deep link。
  const [href, setHref] = useState(LINE_ADD_URL);

  useEffect(() => {
    if (isMobileDevice()) {
      const pageUrl = `${window.location.origin}/products/${product.slug}`;
      setHref(buildOaDeepLink(buildPrefillMessage(product, pageUrl)));
    }
  }, [product]);

  return (
    <a className="line-cta-fab" href={href} target="_blank" rel="noopener noreferrer" aria-label="用 LINE 詢價">
      <svg className="line-cta-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3C6.48 3 2 6.74 2 11.28c0 4.06 3.55 7.47 8.35 8.12.33.07.77.22.88.5.1.25.06.64.03.9l-.14.85c-.04.25-.2.98.86.54 1.07-.45 5.76-3.4 7.86-5.82C21.32 14.62 22 13.02 22 11.28 22 6.74 17.52 3 12 3z" />
      </svg>
    </a>
  );
}
