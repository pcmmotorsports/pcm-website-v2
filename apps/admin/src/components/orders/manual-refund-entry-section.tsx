'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { recordManualRefundAction } from '../../lib/payment/manual-refund-actions';
import {
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_CARD_CONFIRM_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  type ManualRefundActionState,
} from '../../lib/payment/manual-refund-action-state';
import { MANUAL_REFUND_RAILS, type ManualRefundRail } from '../../lib/payment/manual-refund-form';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// manual-refund-entry-section.tsx — M-4b E10 D3:訂單詳情的非卡退款登記入口
// (現金/匯款;高風險片、鐵則 12 ①)。骨架照抄 `refund-section.tsx`(TapPay 線),
// 依 `manual-refund-actions.ts` 檔頭所述簡化:單一 RPC 呼叫,沒有 kind 切換、
// 沒有 wire 層多步驟。
//
// 🔴 bfcache 還原絕不 client 換鍵(同 refund-section.tsx MF1 段的理由:退款的重送保護
// 就是舊 token,換新鍵會讓同一張舊表單變成「全新請求」)——這裡改做 router.refresh()。
//
// 🔴 失敗回來的值要真的進畫面(同 refund-section.tsx 的理由):useState 初值只在掛載時
// 求值,用 effect 套 state.input;denied 例外(input 是空殼,見 action state 檔頭)。

const RAIL_LABEL: Record<ManualRefundRail, string> = {
  bank_transfer: '匯款',
  cash: '現金',
};

/** datetime-local 預設值:當下時刻(本機時區,精確到分)。 */
function nowLocalInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function ManualRefundEntrySection({
  orderId,
  returnTo,
  serverToken,
  ledgerSettled,
}: {
  orderId: string;
  returnTo: string;
  /** 由 server component 渲染期產(同 refund-section.tsx 慣例;不得落任何快取層)。 */
  serverToken: string;
  /**
   * 🔴🔴 ⟦b4-SETTLEDFORMVANISHES⟧:帳本未登記額**不是正數**(0 / null)⇒ 沒有東西可登記。
   *
   * 🛑 **這一格為什麼下放到 client, 而不是在 server 就擋掉**(那是原本的做法, 而它有一個安靜的洞):
   *    全額登記 ⇒ DB 寫入**成功**而 RPC 回應**遺失** ⇒ action 走失敗分支
   *    ⇒ `manual-refund-actions.ts:139` `revalidateOrderViews` ⇒ server 資料當場重取
   *    ⇒ `remaining` 已是 0 ⇒ **server 那層把本元件整個不渲染**
   *    ⇒ 而失敗訊息住在本元件的 `useActionState` state 裡 ⇒ **元件卸載 ⇒ 訊息跟著消失**
   *    ⇒ 📌 **他按下送出、畫面刷新、表單不見了、沒有任何一句話告訴他發生什麼事。**
   * 🔴 **而那個安靜比原本的病更貴**:原病是「表單在而送不出去」⇒ **他會抱怨**;
   *    這個是「表單不見而沒有訊息」⇒ **他可能以為沒成功, 然後用別的方式再退一次錢給客人。**
   * ✅ ⇒ 本元件的規則:**`ledgerSettled` 為真【而且我手上沒有未讀的失敗】才隱藏。**
   *    有失敗要講的時候, 它留在畫面上 —— 連同那個 `requestToken`
   *    (⇒ DB 的同鍵冪等重試 `UNIQUE (order_id, request_id)` 也跟著救回來了)。
   */
  ledgerSettled: boolean;
}) {
  const [state, formAction, isPending] = useActionState<ManualRefundActionState, FormData>(
    recordManualRefundAction,
    { status: 'idle', requestToken: serverToken },
  );
  const [rail, setRail] = useState<ManualRefundRail>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowLocalInput);
  /** 🔴 ⟦b4-MIXEDRAILMANUALREFUND⟧:預設【沒勾】—— 這一格必須是員工主動的動作。 */
  const [confirmCard, setConfirmCard] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  useEffect(() => {
    if (state.status !== 'failed') return;
    if (state.code === 'denied') return;
    if (state.input.rail === 'bank_transfer' || state.input.rail === 'cash') {
      setRail(state.input.rail);
    }
    setAmount(state.input.amount);
    setReason(state.input.reason);
    if (state.input.occurredAt !== '') setOccurredAt(state.input.occurredAt);
    // 🔴🔴 **⟦b4-MIXEDRAILMANUALREFUND⟧:這一行【非有不可】,而少了它 `typecheck` 不會紅。**
    //    上面那個 `type` 加了一欄, 而這個回填是**逐欄手寫**的 ⇒ 少一行只是「少 set 一個 state」。
    //    🛑 **而這一欄掉了特別難發現,理由不對稱**:
    //       別的欄位掉了 ⇒ 員工看到**空白** ⇒ 他知道要重打;
    //       **這一欄掉了 ⇒ 它回到【沒勾】—— 那是看起來完全正常的預設值**
    //       ⇒ 他勾了、送出、因別的原因失敗、回來那個勾已經被清掉 ⇒ **他會以為自己勾了**。
    setConfirmCard(state.input.confirmCardNotRefunded);
  }, [state]);

  const failed = state.status === 'failed';
  const requestToken = failed ? state.requestToken : serverToken;

  // 🔴 ⟦b4-SETTLEDFORMVANISHES⟧:**這一行的順序是重點** —— `failed` 在前面已由
  //    `state.status === 'failed'` 求出。帳本已結清**而且沒有話要說**才隱藏。
  // 🛑 而「有話要說」只有 client 知道 —— 這正是這一格不能留在 server 的理由。
  if (ledgerSettled && !failed) return null;

  return (
    <section className='border-destructive/40 bg-destructive/5 rounded-lg border p-4'>
      <h2 className='text-destructive mb-1 text-sm font-semibold'>登記退款(現金/匯款)</h2>
      <p className='text-muted-foreground mb-3 text-xs'>
        記錄一筆已經交還給客人的現金或匯款退款,系統不會實際動錢——錢是人交回去的。
      </p>

      {failed && (
        <p
          role='alert'
          className='border-destructive/30 bg-destructive/10 text-destructive mb-3 rounded-md border px-3 py-2 text-sm'
        >
          {state.message}
        </p>
      )}

      <form action={formAction}>
        <fieldset disabled={isPending} className='min-w-0 space-y-3 border-0'>
          <input type='hidden' name={MANUAL_REFUND_ORDER_ID_FIELD} value={orderId} />
          <input type='hidden' name={MANUAL_REFUND_REQUEST_TOKEN_FIELD} value={requestToken} />
          <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />

          <div className='flex flex-wrap gap-4'>
            {MANUAL_REFUND_RAILS.map((r) => (
              <label key={r} className='flex items-center gap-1.5 text-sm'>
                <input
                  type='radio'
                  name={MANUAL_REFUND_RAIL_FIELD}
                  value={r}
                  checked={rail === r}
                  onChange={() => setRail(r)}
                />
                {RAIL_LABEL[r]}
              </label>
            ))}
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <AdminFormField label='退款金額(元、正整數)'>
              <input
                name={MANUAL_REFUND_AMOUNT_FIELD}
                required
                inputMode='numeric'
                pattern='[1-9][0-9]{0,9}'
                maxLength={10}
                autoComplete='off'
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={ADMIN_INPUT_CLASS}
                placeholder='不含小數、不含逗號'
              />
            </AdminFormField>
            <AdminFormField label='錢實際交回去的時間'>
              <input
                type='datetime-local'
                name={MANUAL_REFUND_OCCURRED_AT_FIELD}
                required
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
                className={ADMIN_INPUT_CLASS}
              />
            </AdminFormField>
          </div>

          <AdminFormField label='退款原因'>
            <input
              name={MANUAL_REFUND_REASON_FIELD}
              required
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={ADMIN_INPUT_CLASS}
              placeholder='會寫入退款紀錄與稽核,例:商品缺貨,匯款退回客人帳戶'
            />
          </AdminFormField>

          {/* 🔴🔴 ⟦b4-MIXEDRAILMANUALREFUND⟧:刷卡單要用現金/匯款退,DB 在等這一格。
              `20260905280000:194` 逐字 `IF v_has_card AND p_confirm_card_not_refunded
              IS DISTINCT FROM true THEN RAISE` ⇒ 有卡而沒勾 ⇒ RPC 直接擋。
              🛑 **而它【對非卡單也顯示】,那是刻意的**:這張單有沒有卡,前端不該自己判 ——
                 那個判斷在 DB 是【鎖單之後】才讀 `order_payments` 的(`:189-192`),
                 檔內逐字「在鎖之前讀,並行插入一筆 card 收款會讓『不是刷卡單』在下一瞬間變成假的」。
              ⇒ 📌 前端自己判 = 造出第二把尺,而它會與 DB 那把在【並發那一刻】分岔。
              🔵 而對純非卡單它是一句多餘的確認,代價是員工多讀一行字;
                 反過來(該問而沒問)的代價是**退兩次**。 */}
          <label className='border-border bg-muted/30 flex items-start gap-2 rounded-md border p-3 text-sm'>
            <input
              type='checkbox'
              name={MANUAL_REFUND_CARD_CONFIRM_FIELD}
              value='1'
              checked={confirmCard}
              onChange={(event) => setConfirmCard(event.target.checked)}
              className='mt-0.5'
            />
            <span>
              <span className='font-medium'>我確認卡上那筆沒有退成功</span>
              <span className='text-muted-foreground block text-xs'>
                這張單如果是刷卡收的,先去 TapPay 後台看那筆退款有沒有成功。
                <span className='font-medium'>已經退成功了就不要在這裡登記</span>
                ——那會變成退兩次。
              </span>
            </span>
          </label>

          <div className='flex flex-wrap items-center justify-end gap-3'>
            <span className='text-muted-foreground mr-auto text-xs'>
              這是一筆登記,不會實際扣款或匯款——請先完成實際退款,再回來登記。
            </span>
            <button
              type='submit'
              disabled={isPending}
              className='bg-destructive h-9 rounded-md px-5 text-sm font-medium text-white disabled:opacity-50'
            >
              {isPending ? '送出中…' : '登記退款'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
