// line-cta.ts — 商品頁「LINE 詢價」CTA 的常數 + 預填訊息 / deep link 組裝(純函式、無副作用、可測)。
//
// 接通現況唯一真實成交管道:站內無 /checkout、現有 LINE 提及全是純文字無連結。
// 手機點 → LINE App 開官方帳號對話並預填商品資訊;桌機點 → QRCODE / 加好友(deep link 桌機無效)。
//
// 🔴 車種鐵律(PCM):預填訊息**零車款字串** —— 不拼任何廠牌 / 車型 / 年式(原文車種常錯、一件常裝多台、
//   AI 挑一台 = 捏造)。車型欄留空、由客人自填,PCM 再人工確認適用性。故本檔**不讀** product.fits。
//
// LINE 帳號 = @pcmmoto(PCM 部品賣場與精選車輛展間 pcm-moto 同一官方帳號;Sean 2026-06-04 確認真值)。
// deep link 格式經參考專案 pcm-moto 驗證(line.me/R/oaMessage/{basic-id}/?{urlencode});
// 桌機點 oaMessage 會被導向 www.line.me/en/(無效)→ 桌機改走 QRCODE / 加好友短網址。

import type { MockProduct } from '@/data/mock-products';

/** LINE 官方帳號 basic ID(含 @;oaMessage deep link 用;與精選車輛展間 pcm-moto 同帳號)。 */
export const LINE_OA_ID = '@pcmmoto';

/** 加好友短網址(桌機 fallback / QRCODE 替代;⚠️ lin.ee 短網址不可帶預填訊息、只能加好友)。 */
export const LINE_ADD_URL = 'https://lin.ee/R6QZUH2';

/** 加好友 QRCODE 圖(放 public/line-qr.png;Sean 補真圖前 img onError → modal 顯 fallback 提示 + 下方加好友連結兜底)。 */
export const LINE_QR_SRC = '/line-qr.png';

/**
 * 組商品頁 LINE 詢價預填訊息。
 * 🔴 車種鐵律:**不帶任何車款字串**(不讀 product.fits / 廠牌 / 車型);車型欄留空讓客人自填、PCM 再確認適用。
 * 必含:商品名 + 料號(productCode、無則 slug)+ 該商品頁完整 URL(讓 PCM 一眼知道客人問哪件)。
 *
 * @param product 商品(MockProduct)
 * @param pageUrl 該商品頁完整 URL(client 端傳 window.location.origin + 路徑;lib 保持純函式不讀 window)
 */
export function buildPrefillMessage(product: MockProduct, pageUrl: string): string {
  // 料號:MockProduct 主碼欄 productCode(對齊 16c-4b vendor 真主碼如 RPM-DCC01);無則退 slug 當識別。
  const partNo = product.productCode ?? product.slug;
  return [
    `我想詢問商品:${product.name}`,
    `料號:${partNo}`,
    pageUrl,
    '我的車是(請告知年式 / 車型,幫您確認適用):',
  ].join('\n');
}

/** 組 LINE 官方帳號預填 deep link(oaMessage;僅手機 LINE App 有效、桌機無效→走 QRCODE)。 */
export function buildOaDeepLink(message: string): string {
  return `https://line.me/R/oaMessage/${LINE_OA_ID}/?${encodeURIComponent(message)}`;
}
