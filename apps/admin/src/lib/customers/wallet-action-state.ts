// wallet-action-state.ts — 儲值金調整 server action 的**回傳 state**(⟦b4-WALLETDEDUPE⟧ 2026-09-06)
//
// ══ 🔴 為什麼失敗路徑要「回傳 state」而不是 redirect ═══════════════════════
// Sean 2026-08-02 對訂單備註那片(A6)已經拍過同一題,而**那條拍板的理由在本片一字不差**:
// `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §9 `Q1=A` 逐字:
//   「新增 H13:失敗 state **必須帶回員工輸入的 body**(否則「保留輸入」是空宣稱);
//     且**不得**把 body 塞進 URL」
//   「失敗 state **必須原樣帶回 `requestToken`** … 推導:H8 要求失敗路也 `revalidatePath`
//     ⇒ server component 重渲染 ⇒ hidden input 拿到**新 token**;而 `error` 這個分支的定義
//     正是「RPC **可能已 commit**、只是回應斷在路上」⇒ 員工重按 = 新 token = 真的第二筆」
//
// 🔴 **我第一版寫成了 redirect + query string**(`?r=error&t=…&a=…&n=<備註>`),
//    codex 審 diff 當場指出那**逐字違反上面那條拍板**。三個後果,它全說對了:
//    ① **扣款方向遺失** —— query 只帶了金額與備註,沒帶 direction
//    ② **同鍵不同內容被唸成「請稍後再試」** —— RPC RAISE 被收斂成 `error`
//       ⇒ 員工會**一直按**,而那條路永遠不會成功
//    ③ **備註進了 URL** —— 直接撞 H13 那句「不得把 body 塞進 URL」
// ⇒ ✅ 本檔就是照 A6 那個形狀重寫的結果。

/** 失敗碼(每一個都要有自己的訊息;新增碼卻忘了寫訊息會在型別層轉紅)。 */
export type WalletFailureCode =
  | 'denied'
  | 'invalid'
  | 'not_found'
  /** 🔴 同一把 token 帶著**不同內容**回來 —— 不是重送, 是「同一把鑰匙去開別的門」。 */
  | 'mismatch'
  /** 🔴 RPC 可能已 commit、只是回應斷在路上 —— **這一格就是本片存在的理由**。 */
  | 'error';

/**
 * 🔴🔴 **訊息要讓員工做出【正確的下一個動作】, 而 `mismatch` 與 `error` 的動作是【相反】的。**
 * (同一條紀律在 `result-banner.tsx` 的 `invoice_blocked` 那段有逐字說明:
 *  唸錯會讓員工一直按, 而他很可能已經扣過一次了。)
 */
export const WALLET_FAILURE_MESSAGE: Readonly<Record<WalletFailureCode, string>> = {
  denied: '沒有權限做這個操作。',
  invalid: '表單內容不正確,沒有存進去。',
  not_found: '找不到這位客人。',
  // 🔴 這一句要他**停下來改回原本的內容**, 不是重試。
  mismatch:
    '這張表單剛才已經送出過一次了,而你這次改了內容。系統沒有動任何一筆錢。請重新整理頁面再操作一次。',
  // 🔴 而這一句要他**放心再按一次** —— 因為同一把鑰匙會被認出來, 不會重複扣款。
  error:
    '送出時連線出了問題,而這一筆可能已經處理好了。可以直接再按一次:系統認得出是同一筆,不會重複扣款。',
};

export type WalletAdjustActionState =
  | { status: 'idle' }
  | {
      status: 'failed';
      code: WalletFailureCode;
      message: string;
      /**
       * 🔴 **原樣帶回, 不是重產**(A6 §9 Q1=A 的 R2-2 推導):
       * 失敗路徑也會 `revalidatePath` ⇒ server component 重渲染 ⇒ hidden input 會拿到**新 token**
       * ⇒ 員工重按 = 新 token = **系統認不出是重送** = 真的再扣一次。
       */
      requestToken: string;
      /** 🔴 員工打的內容原樣帶回(不帶回 =「保留輸入」是空宣稱)。 */
      direction: 'deposit' | 'use';
      /** 未轉號的正整數字串(UI 恆收正整數;轉號在 server)。 */
      amount: string;
      note: string;
    };

/** 組失敗 state。訊息表與碼一對一 ⇒ 少寫一個訊息會在型別層轉紅。 */
export function walletFailure(
  code: WalletFailureCode,
  keep: { requestToken: string; direction: 'deposit' | 'use'; amount: string; note: string },
): WalletAdjustActionState {
  return {
    status: 'failed',
    code,
    message: WALLET_FAILURE_MESSAGE[code],
    requestToken: keep.requestToken,
    direction: keep.direction,
    amount: keep.amount,
    note: keep.note,
  };
}
