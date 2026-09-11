// inflight-marker.ts — 付款進行中 client 記號(P3、pivot A 整頁 redirect 另開分頁防呆)
//
// 🔴 定位(誠實):這是 client UX 提示層、**非雙扣防線**。雙扣真防線 = server preflight(§2.3 R3:
//   同 cartSessionId sibling lookup → settle → hold/existing_paid、不重複建單扣款)+ W1 偵測退款。
//   本記號只讓客人「知道」有付款進行中(另開分頁再結帳時軟提醒)、減少困惑與重複打 server。
//
// 機制:跳 TapPay 前(useChargePayment redirect 分支)、或回應遺失/送出逾時 catch(S1a unknown 終態、可能已扣未定)寫 localStorage 記號 {cartSessionId, ts};
//   下次結帳送出前(CheckoutView handleSubmit)檢查未過期記號 → window.confirm 軟提醒(可繼續/取消);
//   付款有結論(callback paid/failed/no_attempt 掛 ClearPaymentInflight)或逾 TTL(6 分)→ 清/失效。
// 🔴 localStorage 跨分頁同源共享 → 適合做「另開分頁」偵測。
// SSR-safe:typeof window 守衛(結帳為 client component、守衛防意外 SSR import);
//   localStorage 不可用(隱私模式/配額/throw)→ 一律 fail-safe 靜默略過,**絕不可炸結帳**(P3 非關鍵防線)。
// 🔴 S1a 重用於 unknown 終態(回應遺失/逾時、可能已扣未定):不確定窗可能長達數小時(sweeper 目前每日一次),
//   TTL 6 分後另分頁零警示=已知警示窗縮短(無新雙扣路:同 key server dedup 硬防、不同 key 殘餘已於 useChargePayment 揭示);完整化留 S1b。

const KEY = 'pcm-payment-inflight';
/** 6 分鐘(TapPay OTP 約 5 分過期 + 緩衝;Sean 2026-06-27 Q2=6 分)。 */
const TTL_MS = 6 * 60 * 1000;

// 🔵 `channel` 只在【匯款】那一發回應遺失 / 逾時時寫(2026-09-11):另一個分頁的確認框據此講匯款語境。
//    刷卡(3DS redirect / 回應遺失)不寫 ⇒ 刷卡的記號 JSON 與今天逐字相同;舊記號沒有這欄 ⇒ 照刷卡那句。
export type PaymentInflightMarker = { cartSessionId: string; ts: number; channel?: 'bank_transfer' };

/** 寫記號:redirect 分支(跳 TapPay 前)、或回應遺失/逾時 catch(S1a,可能已扣未定)。fail-safe:localStorage throw 不影響結帳。
 *  cartSessionId 目前僅輔助記錄(confirmProceedIfInflight 只看記號存在性);null → '' 仍設記號。 */
export function setPaymentInflight(cartSessionId: string | null, channel?: 'bank_transfer'): void {
  if (typeof window === 'undefined') return;
  try {
    const marker: PaymentInflightMarker = {
      cartSessionId: cartSessionId ?? '',
      ts: Date.now(),
      ...(channel === 'bank_transfer' ? { channel } : {}),
    };
    window.localStorage.setItem(KEY, JSON.stringify(marker));
  } catch {
    // 隱私模式/配額/不可用 → 略過(P3 是 UX 提示、非關鍵防線)。
  }
}

/** 清記號(付款有結論 / 客人明確要再付)。 */
export function clearPaymentInflight(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 略過(同上)。
  }
}

/** 回未過期的進行中記號;無 / 壞值 / 逾 TTL → null(逾期 / 壞值順手清)。 */
export function getActivePaymentInflight(): PaymentInflightMarker | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let marker: PaymentInflightMarker;
  try {
    const parsed = JSON.parse(raw) as Partial<PaymentInflightMarker>;
    if (typeof parsed?.cartSessionId !== 'string' || typeof parsed?.ts !== 'number') {
      clearPaymentInflight(); // 壞值清掉
      return null;
    }
    marker = {
      cartSessionId: parsed.cartSessionId,
      ts: parsed.ts,
      // 只認得這一個值;其他任何值(含舊記號沒有這欄)⇒ 當刷卡, 走原本那句。
      ...(parsed.channel === 'bank_transfer' ? { channel: 'bank_transfer' as const } : {}),
    };
  } catch {
    clearPaymentInflight(); // 非 JSON 清掉
    return null;
  }
  if (Date.now() - marker.ts >= TTL_MS) {
    clearPaymentInflight(); // 逾期失效、順手清
    return null;
  }
  return marker;
}

/**
 * 結帳送出前的另開分頁軟提醒(Q1=A、L2 文案):有未過期記號 → window.confirm 軟提醒;
 * 回 true = 可繼續送出(並清舊記號、新一筆跳轉前會重設)、false = 客人取消不送。
 * 🔴 SSR / localStorage 不可用 → getActivePaymentInflight 回 null → 回 true(不擋、fail-open;
 *    後端 preflight 才是雙扣真防線、本提示不可阻斷正常結帳)。抽進 util 讓 CheckoutView 不破鐵則 6。
 */
export function confirmProceedIfInflight(): boolean {
  const marker = getActivePaymentInflight();
  if (!marker) return true;
  const proceed = window.confirm(
    marker.channel === 'bank_transfer'
      ? // 🔵 匯款那一發斷線:單可能已成立、而匯款不會扣款 ⇒ 不問「再付一次」, 問「再下一張」。
        '您剛才有一張匯款訂單可能已經成立(匯款不會扣款)。請先到會員中心查看訂單。確定要再下一張嗎?'
      : '您有一筆付款可能還在進行中。若您已在另一個視窗 / 分頁完成付款,請勿重複付款。確定要再付一次嗎?',
  );
  if (proceed) clearPaymentInflight();
  return proceed;
}
