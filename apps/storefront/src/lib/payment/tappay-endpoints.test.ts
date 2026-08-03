// tappay-endpoints.test.ts — env↔host↔path 全字面釘死(M-3 退款線第一片)
//
// 🔴 斷言「完整 URL 字串」而非拆開驗 host/path(codex 關卡1 R3):一次涵蓋三種失效 ——
// ①sandbox/production 值對調(正式站退款打進 sandbox=客戶收不到錢而帳面全對)
// ②欄位錯接(refund 接到 query URL)③https 被降成 http(partner key 明文外送)。
// 字面權威 = docs/reference/tappay-reference.md §2(:77)+ §2.3(:97)逐字。

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { tapPayUrlsFor } from './tappay-endpoints';

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

  it('🔴 composition.ts 本體真的走 tapPayUrlsFor:含展開注入、零 tappaysdk 字面(防 inline 回歸;codex 關卡2)', () => {
    // 值比對(上兩格)證不了 composition 有用這個模組 —— 若有人把 composition 改回 inline URL
    // 字面(繞過本模組),上兩格照綠。本格直接觀察 composition 源碼:必須展開注入、
    // 且不得再出現任何 tappaysdk 端點字面(單一來源=本模組)。
    const src = readFileSync(path.join(__dirname, 'composition.ts'), 'utf8');
    expect(src).toMatch(/\.\.\.tapPayUrlsFor\(env\)/);
    expect(src).not.toMatch(/tappaysdk\.com/);
  });
});
