// tappay-endpoints.ts — TapPay API 端點純常數(M-3 退款線第一片自 composition.ts 抽出)
//
// 🔴 為什麼抽:composition.ts 是 server-only + pg 依賴、無法單元測試 ⇒ 舊 inline map 寫法下
// 「sandbox/production 值對調」「欄位錯接」「https 被降成 http」全套測試照綠(codex 關卡1 R2#8/R3)。
// 抽成純模組後:
// - env→host 單一綁定點(HOSTS);三端點自 host 推導 ⇒ 對調/降協定 = tappay-endpoints.test.ts 紅。
// - composition 以 `...tapPayUrlsFor(env)` 物件展開注入 ⇒ 欄位錯接在型別層不可能。
// 官方字面:docs/reference/tappay-reference.md §2 共通(:77)+ §2.3(:97);https 為官方唯一協定。

export type TapPayEnv = 'sandbox' | 'production';

const HOSTS: Record<TapPayEnv, string> = {
  sandbox: 'https://sandbox.tappaysdk.com',
  production: 'https://prod.tappaysdk.com',
};

/** 回三端點完整 URL(pay-by-prime / record query / refund);composition 展開注入 adapter config。 */
export function tapPayUrlsFor(env: TapPayEnv): {
  payByPrimeUrl: string;
  recordQueryUrl: string;
  refundUrl: string;
} {
  const host = HOSTS[env];
  return {
    payByPrimeUrl: `${host}/tpc/payment/pay-by-prime`,
    recordQueryUrl: `${host}/tpc/transaction/query`,
    refundUrl: `${host}/tpc/transaction/refund`,
  };
}
