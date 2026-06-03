// LineCtaButton.tsx — 商品頁「LINE 詢價」懸浮 CTA(新功能、無 design-reference 源;Sean 規格:
//   懸浮按鈕 + 手機 deep link 預填 + 桌機 QRCODE modal;概念對齊 Sean 二手車販售頁 pcm-moto)。
//
// 接通現況唯一真實成交管道(站內無 /checkout、現有 LINE 提及全是純文字無連結)。
// - 手機:點 → LINE App 開 @pcmmoto 對話、預填商品名 / 料號 / 頁面 URL(車型留空、車種鐵律)。
// - 桌機:點 → QRCODE modal(oaMessage deep link 桌機無效;顯掃碼圖 + 加好友連結 fallback)。
//
// 🔴 車種鐵律:預填零車款字串(由 lib/line-cta.ts buildPrefillMessage 保證、本元件不碰車款欄)。
// business_override: lineCtaDeepLinkPrefill。
//
// RWD:懸浮按鈕 z-index 45(< buybar 50、不擋立即購買 / 加入購物車);手機 bottom 避開底部 buybar。
// modal 沿用 SwatchLightbox 範式(role=dialog + ESC + body 捲動鎖 + 點遮罩關)。

'use client';

import { useEffect, useState } from 'react';
import type { MockProduct } from '@/data/mock-products';
import { LINE_ADD_URL, LINE_QR_SRC, buildOaDeepLink, buildPrefillMessage } from '@/lib/line-cta';
import '@/styles/line-cta.css';

export type LineCtaButtonProps = { product: MockProduct };

/** 手機裝置偵測(deep link 僅手機 LINE App 有效;對齊 layout.tsx UA regex、補 iPad/iPod)。 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
}

export function LineCtaButton({ product }: LineCtaButtonProps) {
  const [showQr, setShowQr] = useState(false);
  const [qrFailed, setQrFailed] = useState(false); // QR 圖載入失敗(Sean 補圖前)→ 退 fallback 提示

  // QR modal 開啟時鎖 body 捲動 + ESC 關閉(沿用 SwatchLightbox 範式)。
  useEffect(() => {
    if (!showQr) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowQr(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showQr]);

  function handleClick() {
    if (isMobileDevice()) {
      // 手機:新分頁開 LINE App 預填對話(保留商品頁、不離站)。
      const pageUrl = `${window.location.origin}/products/${product.slug}`;
      const msg = buildPrefillMessage(product, pageUrl);
      window.open(buildOaDeepLink(msg), '_blank', 'noopener,noreferrer');
    } else {
      // 桌機:deep link 無效 → 開 QRCODE modal 引導手機掃碼。
      setShowQr(true);
    }
  }

  return (
    <>
      <button type="button" className="line-cta-fab" onClick={handleClick} aria-label="LINE 詢價">
        <svg className="line-cta-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3C6.48 3 2 6.74 2 11.28c0 4.06 3.55 7.47 8.35 8.12.33.07.77.22.88.5.1.25.06.64.03.9l-.14.85c-.04.25-.2.98.86.54 1.07-.45 5.76-3.4 7.86-5.82C21.32 14.62 22 13.02 22 11.28 22 6.74 17.52 3 12 3z" />
        </svg>
        <span className="line-cta-label">LINE 詢價</span>
      </button>

      {showQr && (
        <div
          className="line-cta-modal"
          role="dialog"
          aria-modal="true"
          aria-label="LINE 加好友詢價"
          onClick={() => setShowQr(false)}
        >
          <div className="line-cta-modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="line-cta-modal-x" onClick={() => setShowQr(false)} aria-label="關閉">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="line-cta-modal-title">手機掃碼加 LINE 詢問</div>
            {qrFailed ? (
              <div className="line-cta-qr-fallback">QR 圖準備中,請點下方加 LINE 好友</div>
            ) : (
              <img
                className="line-cta-qr"
                src={LINE_QR_SRC}
                alt="PCM LINE 官方帳號 QR Code"
                width={180}
                height={180}
                onError={() => setQrFailed(true)}
              />
            )}
            <a className="line-cta-add-link" href={LINE_ADD_URL} target="_blank" rel="noopener noreferrer">
              或點此加 LINE 好友
            </a>
          </div>
        </div>
      )}
    </>
  );
}
