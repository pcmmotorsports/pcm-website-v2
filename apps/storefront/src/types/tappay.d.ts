// types/tappay.d.ts — TapPay TPDirect 全域窄型別(M-3 ②-④a)
//
// 只宣告本專案用到的面(card.setup fields 版 / onUpdate / getTappayFieldsStatus / getPrime);
// 對齊官方 example v5.19.2(context7 2026-06-12 確認、docs.tappaysdk.com)。
// SDK 由 useTapPayCard 動態注入 <script>,掛上 window.TPDirect。

/** 單欄狀態碼:0=valid / 1=empty / 2=error / 3=typing(官方 example 字面)。 */
type TapPayFieldStatusCode = 0 | 1 | 2 | 3;

interface TapPayFieldsUpdate {
  canGetPrime: boolean;
  status: {
    number: TapPayFieldStatusCode;
    expiry: TapPayFieldStatusCode;
    ccv: TapPayFieldStatusCode;
  };
  cardType?: 'visa' | 'mastercard' | 'jcb' | 'amex' | 'unknown';
}

interface TapPayGetPrimeResult {
  status: number; // 0 = 成功
  msg?: string;
  card?: {
    prime: string;
    lastfour?: string;
    type?: number;
  };
}

interface TapPayCardField {
  element: string | HTMLElement;
  placeholder?: string;
}

interface TPDirectStatic {
  setupSDK(appId: number, appKey: string, serverType: 'sandbox' | 'production'): void;
  card: {
    setup(config: {
      fields: {
        number: TapPayCardField;
        expirationDate: TapPayCardField;
        ccv: TapPayCardField;
      };
      styles?: Record<string, Record<string, string>>;
      isMaskCreditCardNumber?: boolean;
      maskCreditCardNumberRange?: { beginIndex: number; endIndex: number };
    }): void;
    onUpdate(cb: (update: TapPayFieldsUpdate) => void): void;
    getTappayFieldsStatus(): TapPayFieldsUpdate;
    getPrime(cb: (result: TapPayGetPrimeResult) => void): void;
  };
}

interface Window {
  TPDirect?: TPDirectStatic;
}
