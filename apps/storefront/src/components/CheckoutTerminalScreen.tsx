'use client';

// CheckoutTerminalScreen.tsx — 結帳付款終態畫面(M-3 兩步結帳 Slice U4a-0)
//
// 🔴 抽出理由 = 鐵則 6:CheckoutView.tsx 是付款 orchestrator,U4a-0 開工時 392 行、硬上限 400,
//   而 U4a(卡片欄錯誤)與 U4b(focus registry)都還要往 View 加行 → 先把純 presentational 的
//   終態 render 搬出來騰跑道。**行為零變更**:四態 JSX 逐字搬移、判斷順序不變、文案與 props 契約不變。
//
// 🔴 這四態屬鐵則 12 ①錢:搬錯會出現「顯示付款成功但其實沒收到錢」或「unknown 的『勿重複付款』
//   警示消失」→ 本檔的判斷順序不得重排、不得合併分支。
//   ⚠️ 名稱裡的 Terminal 指「整頁取代表單」,**不是「四個都已是付款結果」** ——
//   `redirect` 是 3DS 導向中、付款尚未裁決(不清車);別把 paid/processing 的成功語意套上去。
//
// 🔴 呼叫端判斷「是不是終態」一律用 `isTerminalChargeState` 型別守衛,**絕不可**寫成
//   「`<CheckoutTerminalScreen …>` 是否 truthy」—— JSX 元素恆為 truthy,子元件回 `null` 也擋不住,
//   會讓非終態的整個結帳頁消失(codex 關卡1 R1 must-fix 抓到的真 bug;守門測試見 test「非終態」段)。

import type { ChargeState } from '@/hooks/useChargePayment';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';
import { CheckoutRedirecting } from '@/components/CheckoutRedirecting';

// 🔴 分類表 = **真正的**編譯期窮盡保護(codex 關卡2 must-fix)。
//   `Record<ChargeState['status'], boolean>` 要求**列出每一個** status:日後 ChargeState 新增狀態
//   而這裡沒補,tsc 立刻紅 → 不會靜默落成「非整頁態」。
//   (前一版用 `as const satisfies readonly ChargeState['status'][]` **不是窮盡檢查** ——
//    它只驗證「列出來的值都合法」,漏列不會紅;且清單與 Extract 是兩份手寫字面、會各說各話。)
const FULL_PAGE_BY_STATUS = {
  idle: false,
  submitting: false,
  error: false,
  wait: false,
  in_flight: false,
  paid: true,
  processing: true,
  unknown: true,
  redirect: true,
} as const satisfies Record<ChargeState['status'], boolean>;

type FullPageStatus = {
  [K in keyof typeof FULL_PAGE_BY_STATUS]: (typeof FULL_PAGE_BY_STATUS)[K] extends true ? K : never;
}[keyof typeof FULL_PAGE_BY_STATUS];

/**
 * 會整頁取代結帳表單的四個狀態。
 *
 * 🔴 **命名誠實化(codex 關卡2 nit):這四個不是「都已成付款結果」** ——
 *   `paid` / `processing` / `unknown` 是付款結果(已成立 / 處理中 / 回應遺失),
 *   而 **`redirect` 是 3DS 導向中的 UI 鎖定態、付款尚未裁決**(見 `useChargePayment.tsx` 該 variant 註解)。
 *   它們的共同點只有「整頁取代表單」這件事,**不得**把 paid/processing 的清車或成功語意套到 redirect 上。
 *
 * 🔴 由 FULL_PAGE_BY_STATUS 推導,**不是**第二份手寫字面 → 分類表改了型別自動跟著改。
 */
export type TerminalChargeState = Extract<ChargeState, { status: FullPageStatus }>;

/** 🔴 放行判斷的唯一依據(非「元件回傳值是否 truthy」;見檔頭)。 */
export function isTerminalChargeState(state: ChargeState): state is TerminalChargeState {
  return FULL_PAGE_BY_STATUS[state.status];
}

export function CheckoutTerminalScreen({ state }: { state: TerminalChargeState }) {
  if (state.status === 'paid') {
    return <CheckoutSuccess displayId={state.displayId} />;
  }
  if (state.status === 'processing') {
    return (
      <CheckoutSuccess
        displayId={state.displayId}
        variant="processing"
        message={state.message}
      />
    );
  }
  // unknown(②-④ fix、審查側 BLOCKER):action throw = 回應遺失層、可能已扣款 → 終態勿重複
  // 付款(無單號;hook 已清車 + 持鎖、不可重送)。
  if (state.status === 'unknown') {
    return <CheckoutSuccess variant="unknown" message={state.message} />;
  }
  // 🔴 3DS-6b(flag on 3DS 啟動成功):整頁導向 TapPay payment_url(導向副作用封裝於 CheckoutRedirecting
  //   的 useEffect、render 期不副作用;付款狀態非終態、不清車)。
  if (state.status === 'redirect') {
    return <CheckoutRedirecting redirectUrl={state.redirectUrl} />;
  }
  // 🔴 窮盡守門:日後 FULL_PAGE_BY_STATUS 多開一個 true 卻沒在上面補分支 → `never` 指派立刻 tsc 紅,
  //   不會靜默漏渲染(客人會在該狀態看到空白畫面)。
  const exhaustive: never = state;
  return exhaustive;
}
