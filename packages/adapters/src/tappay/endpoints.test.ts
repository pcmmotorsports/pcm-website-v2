// endpoints.test.ts — env↔host↔path 全字面釘死(RW2a 隨模組搬入:URL 兩格原樣、第三格拆留 storefront)
//
// 🔴 斷言「完整 URL 字串」而非拆開驗 host/path(codex 關卡1 R3):一次涵蓋三種失效 ——
// ①sandbox/production 值對調(正式站退款打進 sandbox=客戶收不到錢而帳面全對)
// ②欄位錯接(refund 接到 query URL)③https 被降成 http(partner key 明文外送)。
// 字面權威 = docs/reference/tappay-reference.md §2(:77)+ §2.3(:97)逐字。
// ⚠️ 原第三格(composition 接線守門)沒搬 —— 它守的是 storefront 的 composition.ts 原始碼,
// 留在 apps/storefront/src/lib/payment/composition-tappay-wiring.test.ts(本套件搆不到 apps)。

import { describe, it, expect } from 'vitest';

import { tapPayUrlsFor } from './endpoints';

describe('tapPayUrlsFor — 三端點完整字面(對調/錯接/降協定即紅)', () => {
  it('sandbox:三 URL 完整字面', () => {
    expect(tapPayUrlsFor('sandbox')).toEqual({
      payByPrimeUrl: 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime',
      recordQueryUrl: 'https://sandbox.tappaysdk.com/tpc/transaction/query',
      refundUrl: 'https://sandbox.tappaysdk.com/tpc/transaction/refund',
    });
  });

  it('production:三 URL 完整字面(與 sandbox 僅 host 段不同)', () => {
    expect(tapPayUrlsFor('production')).toEqual({
      payByPrimeUrl: 'https://prod.tappaysdk.com/tpc/payment/pay-by-prime',
      recordQueryUrl: 'https://prod.tappaysdk.com/tpc/transaction/query',
      refundUrl: 'https://prod.tappaysdk.com/tpc/transaction/refund',
    });
  });
});
