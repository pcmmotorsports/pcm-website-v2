'use client';

import { useActionState, useEffect, useState } from 'react';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { toTaipeiInputValue } from '../../lib/orders/procurement-view';
import { recordManualPaymentAction } from '../../lib/orders/payment-actions';
import {
  PAYMENT_RAILS,
  PAY_AMOUNT_FIELD,
  PAY_BANK_REFERENCE_FIELD,
  PAY_ORDER_ID_FIELD,
  PAY_PAYER_NOTE_FIELD,
  PAY_RAIL_FIELD,
  PAY_RECEIVED_DATE_FIELD,
  paymentStampFields,
  type PaymentActionState,
  type PaymentFormStamp,
  type PaymentRail,
} from '../../lib/orders/payment-action-state';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// payment-record-form.tsx — M-4b E10 #15-B2-c 片2a:手動收款登錄表單(client)。
// 🔴 中文字面暫定稿、待 Sean 肉眼定案(鎖結構不鎖字)。
//
// 🔴🔴 **印章(request_id + cash_received_at)的封裝是「型別+單一入口」,不是物理不可能**
//    —— 主視窗 `D-527-A` 裁 Q-D1=A 的偏離申報:`payment-form.ts:247-250` 原本要求
//    「鑄章與兩個 hidden input 包在同一個 server 元件裡」,但那與失敗沿用舊章(H4)互斥:
//    `useActionState` 的 state 只有 client 讀得到,server 元件挑不了「這次要用哪一組」。
//    ⇒ 折法 = `stamp` prop **收成整組兩格必填的物件**(只傳一半在型別層就編不過),
//      展開一律走 `paymentStampFields()`(成組展開)。
//
// 🔴 **本檔唯一會「換鍵」的路徑是員工按「開始下一筆」**;其餘任何 render / revalidate
//    都不准換 —— 換鍵 = RPC 的 G8 認不出這是重送 ⇒ 重複入帳
//    (`payment-action-state.ts:193-200` 逐字)。

/** 可編輯欄位。🔴 **印章不在裡面** —— 兩者脫鉤是 D1 的全部重點(見 `activeStamp`)。 */
type EditableValues = {
  rail: PaymentRail;
  amount: string;
  receivedDate: string;
  bankReference: string;
  payerNote: string;
};

const EMPTY_EDITABLE: EditableValues = {
  rail: 'bank_transfer',
  amount: '',
  receivedDate: '',
  bankReference: '',
  payerNote: '',
};

/** 帶回來的 `rail` 是任意字串(可能來自偽造 payload)⇒ 不認得就落回預設,不讓它污染受控狀態。 */
function coerceRail(value: string): PaymentRail {
  return (PAYMENT_RAILS as readonly string[]).includes(value) ? (value as PaymentRail) : 'bank_transfer';
}

const RAIL_LABEL: Record<PaymentRail, string> = {
  bank_transfer: '銀行匯款',
  cash: '現金',
};

/**
 * 🔴 **「開始下一筆」只在「不能排除已寫入」的兩個碼出現**(plan v4 §3 D4)。
 *  · `error` = 連線類/無碼,RPC 可能已 commit、回應斷在路上(`payment-action-state.ts:98-103`)。
 *  · `rejected` = P0001,而 P0001 是**一碼多義**(`payment-action-state.ts:82` 逐字:
 *    「輸入形狀 + 業務拒絕」)⇒ 匯款軌缺單號那種**零寫入**也走這個碼。
 *    ⚠️ 收它的理由是「**無法排除** G8(同鍵不同內容 ⇒ 那把鍵已有一筆 commit)」,
 *    **不是**「一定已經寫入」—— 上一版 plan 就是在這裡寫成斷言、被 Fable R3 F3 打掉。
 *    ⇒ 所以按鈕文案**不得**寫「已入帳」之類的斷言(見下方 `NEXT_BUTTON_LABEL`)。
 * 其餘碼確定沒寫入 ⇒ 沿用同一把重送才是對的,不給換鍵的出口。
 */
const RAIL_SWITCH_ALLOWED_CODES = new Set(['error', 'rejected']);

/** 🔴 文案紅線(plan v4 §4a):**不得斷言已入帳**,只能叫他去對明細。 */
const NEXT_BUTTON_LABEL = '確認明細後開始下一筆';

export function PaymentRecordForm({
  orderId,
  returnTo,
  stamp,
  detailsReadable,
}: {
  orderId: string;
  /**
   * 動作做完回哪裡 = 這個視圖自己的網址。
   * 🔴 值不可信任(client 送得回來):action 端一律再過 `parseOrderReturnTo` fail-closed。
   */
  returnTo: string;
  /**
   * 🔴 **整組兩格必填**(`D-527-A` Q-D1=A 附帶條件①):型別上不存在「只傳一半」的呼叫,
   *    突變靶就是把它拆成兩個 string prop —— 那會在 typecheck 轉紅。
   *    由 `PaymentSection`(server)每次 render 用 `mintPaymentFormStamp()` 鑄一組新的。
   */
  stamp: PaymentFormStamp;
  /**
   * 上方收款明細**這一次真的讀到了**嗎(`payments.status === 'ok'`)。
   * 🔴 讀不到時本表單**不卸載、只停用送出**(plan v4 §3 D3):卸載會銷毀 `state` 裡那組舊印章,
   *    重新掛載 = 新印章 = 重複入帳那條路。
   */
  detailsReadable: boolean;
}) {
  const [state, formAction, isPending] = useActionState<PaymentActionState, FormData>(
    recordManualPaymentAction,
    { status: 'idle' },
  );
  const [values, setValues] = useState<EditableValues>(EMPTY_EDITABLE);
  /** 🔴 員工按「開始下一筆」時**釘住**當下這組 server 章(不是清空)—— 見 `activeStamp`。 */
  const [pinnedStamp, setPinnedStamp] = useState<PaymentFormStamp | null>(null);
  /** 🔴 被按過「開始下一筆」的那個 `state` 物件(用**身分**比,不是比 code/message)。 */
  const [dismissedState, setDismissedState] = useState<PaymentActionState | null>(null);
  /** #437 ③:表單收合狀態(預設收起來);`formOpen` 才是實際餵給 `details` 的值。 */
  const [open, setOpen] = useState(false);
  /** 🔴 Sean 2026-08-12 拍 Q-D8=B:全新掛載預設停用送出,勾了才啟用。 */
  const [confirmed, setConfirmed] = useState(false);

  // 🔴 `#493`(Sean 2026-08-14 拍 `Q-日期預設` = A):**「已經發生的」欄位預設當下。**
  //    「收款日期」= 錢已經收到了我才在登記 ⇒ 已發生那一類。
  // ⚠️ 紀律與採購/到貨兩支相同:掛載後才填(避開 SSR 的 hydration mismatch)、**只在空的時候填**
  //    (失敗回來時下面那個 effect 會把員工自己打的值寫回來,不得被今天蓋掉)。
  // 🔴 `slice(0, 10)`:本欄是 `type='date'`(只到日),而 `toTaipeiInputValue` 回的是
  //    `YYYY-MM-DDTHH:mm` ⇒ 取前 10 碼。**時區換算共用同一支**,不在這裡自己算一份。
  useEffect(() => {
    setValues((prev) =>
      prev.receivedDate === ''
        ? { ...prev, receivedDate: toTaipeiInputValue(new Date().toISOString()).slice(0, 10) }
        : prev,
    );
  }, []);

  // 🔴 **每一個新的 failed state 同步一次**受控欄位:不這樣做的話「保留員工輸入」是空頭支票
  //    (`receipt-record-form.tsx:82-85` 立過同一條:`defaultValue` 只在掛載那一次寫進 DOM)。
  useEffect(() => {
    if (state.status !== 'failed') return;
    setValues({
      rail: coerceRail(state.values.rail),
      amount: state.values.amount,
      receivedDate: state.values.receivedDate,
      bankReference: state.values.bankReference,
      payerNote: state.values.payerNote,
    });
  }, [state]);

  /**
   * 🔴 **已被 dismiss 的失敗態不再有資格供章**(Fable R3 F2)。
   *    少了這道閘:按完「開始下一筆」之後 `state` 還是那個 `failed` 物件、還是會供出**舊鍵**,
   *    而下面的 `pinnedStamp` 永遠輪不到 ⇒ 那顆鈕是虛設的。
   *    用物件身分比對的好處:action 每次回來都是新物件 ⇒ **新的失敗自動重新生效**,不必清旗標。
   */
  const isLiveFailure = state.status === 'failed' && dismissedState !== state;

  /**
   * 🔴🔴 **印章來源 = `state`,不是受控 `values`**(plan v4 §3 D1)。
   *    受控欄位由 `useEffect` 同步 ⇒ **失敗後的第一次 render** 印章兩格還是空的,
   *    那一格 render 就會挑到剛被 revalidate 換掉的新 `stamp` ⇒ 換鍵 ⇒ 重複入帳。
   *    直接讀 `state` 則**同一次 render 內就是對的值**,不存在「effect 跑完才對」的窗口。
   *
   * 🔴 `state.values` 的印章**已經在 server 端驗過形狀**(`payment-form.ts:222-238`:
   *    整組合法才帶回、任一格壞掉就兩格一起清空)⇒ 這裡只需判「非空」,不必再驗一次。
   */
  const activeStamp: PaymentFormStamp =
    isLiveFailure && state.values.requestId !== '' && state.values.cashReceivedAt !== ''
      ? { requestId: state.values.requestId, cashReceivedAt: state.values.cashReceivedAt }
      : (pinnedStamp ?? stamp);

  const showNextButton =
    isLiveFailure && RAIL_SWITCH_ALLOWED_CODES.has(state.code) && detailsReadable;

  /**
   * 按下「開始下一筆」= 一個 handler 做四件事(plan v4 §3 D5)。
   * 少任何一件都會留下一個看起來換了、其實沒換的表單。
   *
   * 🔴 **這顆鈕的效力已經在真環境量過**(2026-08-12 OP5 真往返煙測,`D-564-NOTE`)——
   *    它釘住的是**當下的 `stamp` prop**,而「按下去真的拿得到一把**新**鍵」繫於
   *    失敗路徑的 revalidate 有沒有讓 server 重新鑄章(`payment-actions.ts:123`)。
   *    在那次煙測之前這是**假設**(單元測試用 `rerender` 換 prop 模擬),現在有證據:
   *
   *    實測環境 = 拋棄式 PG17 + 真 PostgREST + 真 RPC + 真瀏覽器,序列與結果:
   *    · 表單握著鍵 K → **從別的路徑**拿 K 寫進一筆(= 首送已 commit、回應斷在路上的 DB 形狀)
   *    · 表單照常送出(內容不同)⇒ 真的 G8 `rejected`、**零新列**
   *    · **不按鈕**重送 ⇒ 仍然零新列(對照組:沒有這顆鈕就登不了下一筆)
   *    · **按鈕** ⇒ 鍵換成新的一把 ⇒ 送出 ⇒ 第二列成立(2 列 / 2 鍵)
   *    ⇒ 「換鍵只由這個人為動作觸發」與「換完真的登得了下一筆」兩半都有行為證據。
   *
   * ⓘ 仍然要記得的天花板:失敗形狀落在 fail-safe 那一邊 —— 萬一哪天 revalidate 不再供新章,
   *    症狀是第二筆被 G8 當成重送而**合併**(員工看到「先前已登錄過」),不是雙重入帳。
   */
  function startNextPayment() {
    setPinnedStamp(stamp); // ① 釘住當下這組 server 章 ⇒ 之後 revalidate 換再多次都不影響
    setDismissedState(state); // ② 舊失敗態失去供章與顯示資格
    setValues(EMPTY_EDITABLE); // ③ 清空可編輯欄位
    // ④ 🔴 **重新武裝確認閘**:按這顆鈕**不是**全新掛載,不顯式重設的話,
    //    上一筆勾的那一格會延用到下一筆 —— 而下一筆正是最需要他再去對一次明細的時候。
    setConfirmed(false);
  }

  const isCash = values.rail === 'cash';
  const submitDisabled = isPending || !detailsReadable || !confirmed;

  /**
   * #437 ③ 的收合狀態。預設 `false`(收起來)。
   *
   * 🔴 `mustStayOpen` 為真時**不准收**:那兩塊(失敗訊息 / 開始下一筆鈕)畫在 `details` 裡面,
   *    收起來 = 送出後畫面看起來什麼都沒發生,而這條路上的「沒發生」會被讀成「沒送出去」。
   *    ⇒ 用 `formOpen = open || mustStayOpen`,連使用者手動收合都蓋過去
   *    (他可以收,但只要還有話要對他說就會再張開)。
   */
  const mustStayOpen = isLiveFailure || showNextButton;
  const formOpen = open || mustStayOpen;

  return (
    // #437 ③:預設收合、點開才展開欄位(Sean 肉眼驗:平常用不到,攤開來只是佔掉明細的位置)。
    // 🔴 **有話要對員工說的時候一律強制展開** —— 失敗訊息(`:isLiveFailure`)與
    //    「開始下一筆」鈕(`showNextButton`)都畫在裡面,收著就等於送出後畫面毫無反應,
    //    而這條路上「毫無反應」會被讀成「沒送出去」⇒ 他再送一次 ⇒ 重複入帳。
    // 🔴 收合狀態下欄位仍在 DOM 裡、送得出去(`details` 只是不顯示)⇒ 隱藏欄位不必搬出去。
    <details
      open={formOpen}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className='mt-4 border-t pt-4'
    >
      <summary className='text-muted-foreground mb-3 cursor-pointer text-xs font-medium'>
        新增收款
      </summary>
      <form action={formAction}>

      <input type='hidden' name={PAY_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
      {/* 🔴 **成組展開,不逐格手寫**(`payment-form.ts:277-281`):少放一格要是刻意的動作。 */}
      {paymentStampFields(activeStamp).map((field) => (
        <input key={field.name} type='hidden' name={field.name} value={field.value} />
      ))}

      <div className='mb-3 flex flex-wrap gap-3'>
        {PAYMENT_RAILS.map((rail) => (
          <label key={rail} className='flex items-center gap-1.5 text-sm'>
            <input
              type='radio'
              name={PAY_RAIL_FIELD}
              value={rail}
              checked={values.rail === rail}
              onChange={() => setValues((v) => ({ ...v, rail }))}
            />
            {RAIL_LABEL[rail]}
          </label>
        ))}
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        <AdminFormField label='金額(新臺幣元)'>
          <input
            className={ADMIN_INPUT_CLASS}
            name={PAY_AMOUNT_FIELD}
            inputMode='numeric'
            value={values.amount}
            onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))}
          />
          {/* 🔴 操作直覺化:解析器只收「整數元、無分隔符」(`payment-form.ts` 的 `toAmount`),
              打了逗號會被判 invalid,而 invalid 只回一句通用的「表單內容不正確」——
              員工看不出是哪一欄、哪裡不對。規則寫在輸入格旁邊,不要等他撞。 */}
          <p className='text-muted-foreground mt-1 text-xs'>整數的元,不要打逗號或小數點。</p>
        </AdminFormField>

        {/* 🔴 兩軌的欄位不同、不是「同一組欄位有些可留空」:
            · 匯款軌要**銀行入帳日**與**單號**(兩者解析器都必填,`payment-form.ts:182-184`)。
            · 現金軌**不得帶單號**(帶了當場判偽造 payload,`payment-form.ts:178`)
              ⇒ 這兩欄在現金軌**不渲染**,而不是渲染成空的。
            · 現金軌的時點來自 server 蓋的章(hidden),員工沒有那一欄。 */}
        {!isCash && (
          <>
            <AdminFormField label='銀行入帳日'>
              <input
                className={ADMIN_INPUT_CLASS}
                type='date'
                name={PAY_RECEIVED_DATE_FIELD}
                value={values.receivedDate}
                onChange={(e) => setValues((v) => ({ ...v, receivedDate: e.target.value }))}
              />
            </AdminFormField>
            <AdminFormField label='銀行單號 / 末五碼'>
              <input
                className={ADMIN_INPUT_CLASS}
                name={PAY_BANK_REFERENCE_FIELD}
                value={values.bankReference}
                onChange={(e) => setValues((v) => ({ ...v, bankReference: e.target.value }))}
              />
            </AdminFormField>
          </>
        )}

        <AdminFormField label='備註(選填)'>
          <input
            className={ADMIN_INPUT_CLASS}
            name={PAY_PAYER_NOTE_FIELD}
            value={values.payerNote}
            onChange={(e) => setValues((v) => ({ ...v, payerNote: e.target.value }))}
          />
        </AdminFormField>
      </div>

      {/* 🔴 現金軌的時點是 server 在鑄表單那一刻蓋的章。
          **文案不得寫「系統自動記錄」**(`payment-action-state.ts:54-57` 逐字):
          這個值 FormData 偽造得掉,把它講成可信來源就是把追不到人的時點講成有人負責。 */}
      {isCash && (
        <p className='text-muted-foreground mt-3 text-xs'>
          現金的收款時間以<strong>打開這張表單的時刻</strong>為準(表單開很久才送出的話,兩者會差)。
        </p>
      )}

      {isLiveFailure && (
        <p className='mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800'>{state.message}</p>
      )}

      {showNextButton && (
        <button
          type='button'
          onClick={startNextPayment}
          className='mt-2 rounded-md border px-3 py-1.5 text-xs font-medium'
        >
          {NEXT_BUTTON_LABEL}
        </button>
      )}

      {/* 🔴 Sean 拍 Q-D8=B:全新掛載時**每一次**都要勾 —— 全新掛載分不出
          「第一次開」與「失敗後重整」,分得出來的話就不需要這道防線了。
          🔴 明細讀不到時**這一格也停用**:叫他去看的東西不在,就不該讓他勾「我看過了」。
          ⚠️ 這句話只涵蓋**這一格**;畫面上兩段文字會不會互相打架是下面那段的事(見該段註解)。 */}
      <label className='mt-4 flex items-start gap-2 text-xs'>
        <input
          type='checkbox'
          checked={confirmed}
          disabled={!detailsReadable}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>我已看過上方的收款明細,確認要登錄的是<strong>一筆新的</strong>收款。</span>
      </label>

      {/* 🔴🔴 **兩段字不可以同框各說各話**(片2a code-reviewer must-fix 1)。
          第一版這裡無條件寫「請先重新整理」,而失敗訊息(`error`)逐字寫「先不要重新整理」——
          兩個條件**可以同時為真**:送出失敗(可能已寫入)之後那次 revalidate 的明細讀取也掛掉。
          員工照下面這句去重整 ⇒ 表單重掛拿到新章 ⇒ RPC 的 G8 認不出是重送 ⇒ **第二筆入帳**。
          ⇒ 有活的失敗態時這段**不得出現「重新整理」四個字**,改叫他等明細回來。
          ⓘ 我原本在確認閘那格的註解宣稱「不讓兩段互打」——那句話當時只涵蓋勾選格,
            對這裡是**字面大於事實**,一併修正。 */}
      {!detailsReadable &&
        (isLiveFailure ? (
          <p className='mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800'>
            上方的收款明細這次沒有載入,而上一次送出<strong>可能已經寫進去了</strong>
            ⇒ 現在不能登錄。請稍等一下讓明細重新載入,確認有沒有那一筆。
            <strong>在那之前不要重新整理頁面</strong>——重新整理會換一把新的鍵,
            再送就會變成第二筆收款。若一直讀不到,請通知系統維護。
          </p>
        ) : (
          <p className='text-muted-foreground mt-2 text-xs'>
            上方的收款明細這次沒有載入,無從確認這筆是不是重複的 ⇒ 暫時不能登錄。請先重新整理。
          </p>
        ))}

      <button
        type='submit'
        disabled={submitDisabled}
        className='bg-primary text-primary-foreground mt-3 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
      >
        {isPending ? '登錄中…' : '登錄這筆收款'}
      </button>
      </form>
    </details>
  );
}
