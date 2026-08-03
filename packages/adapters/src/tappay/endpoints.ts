// endpoints.ts — TapPay API 端點純常數(RW2a 自 apps/storefront/src/lib/payment/tappay-endpoints.ts
// 搬入:功能本體逐字等值〔SHA 比對過〕、檔頭註解依新家改寫)
//
// 🔴 為什麼住在 @pcm/adapters:admin 的退款接線(RW2b composition)需要與 storefront
// 完全同一個 env→host 綁定點 —— 留在 storefront 會逼 admin 複製第二份「正確值」,
// 而複製品正是「sandbox/production 對調也全綠」那類靜默失效的溫床(plan v3.2 §1 RW2a)。
// 🔴 為什麼抽成純模組(原檔頭論證,保留):composition 是 server-only + pg 依賴、無法單元測試 ⇒
// 舊 inline map 寫法下「sandbox/production 值對調」「欄位錯接」「https 降 http」全套測試照綠
// (codex 關卡1 R2#8/R3)。抽出後:env→host 單一綁定點(HOSTS);三端點自 host 推導 ⇒
// 對調/降協定 = endpoints.test.ts 紅;composition 以 `...tapPayUrlsFor(env)` 物件展開注入 ⇒
// 欄位錯接在型別層不可能。
// 官方字面:docs/reference/tappay-reference.md §2 共通(:77)+ §2.3(:97);https 為官方唯一協定。
// ⚠️ 各 app composition「真的走本模組、零 inline 字面」的接線守門**不在本套件**(套件搆不到 apps
// 原始碼):storefront = apps/storefront/src/lib/payment/composition-tappay-wiring.test.ts;
// admin 的同款守門 = RW2b 交付項。

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
