'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { initiateRefundAction } from '../../lib/payment/refund-actions';
import {
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_ORDER_ID_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  type RefundActionState,
} from '../../lib/payment/refund-action-state';
import { REFUND_KINDS, type RefundKind } from '../../lib/payment/refund-form';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// refund-section.tsx — M-3 A7c RW2d:訂單詳情的退款入口(Q4=B 全額+部分;高風險片、鐵則 12 ①)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 🔴 本元件只是 `REFUND_UI_ENABLED` 旗標的**顯示面**(掛載閘在 order-detail.tsx、
//    server 閘在 refund-actions.ts 步 ②,兩端讀同一個 `isRefundUiEnabled()`)。
//    這裡不再讀 env —— client bundle 拿不到 server-only env,讀了也是恆 undefined 的裝飾。
//
// 🔴 token 兩態(refund-action-state.ts 檔頭的三去向;成功=PRG 由 server 產新):
//    失敗 state 帶回的那把(去向由 `refundFailure` 集中決定:終態換新、未定原樣)
//    > server 渲染期發的那把(正常路徑權威;order-detail.tsx 渲染期產、頁層 force-dynamic 零快取)。
//
// 🔴🔴 **bfcache 還原「絕不」client 換鍵**(關卡2 codex MF1;與 note-compose-form 債④ 刻意相反):
//    退款的重送保護**就是**舊 token —— 還原後同表單重按,舊鍵撞 G4 → DUPLICATE(前次已完成
//    =誠實回報成功)或 RAISE(內容變了=bug 畫面叫他重新整理),兩條都零動錢。換新鍵則讓
//    同一張舊表單變成「全新請求」,餘額夠就**真的第二退**。備註片換鍵是對的(新內容=合法
//    新備註);錢不是。這裡改做 `router.refresh()`(item-procurement-form 同慣例):向 server
//    重取訂單狀態+新 serverToken,新鍵只從 server 來(「開新請求=新表單」的字面意義)。
//
// 🔴 契約債①(RW2c refund-form.ts 檔頭):切到全額退必清空金額欄 —— 這裡用**不渲染**實作:
//    kind=full 時 amount input 不在 DOM ⇒ FormData 結構上不可能帶 amount 鍵
//    (解析器 fail-closed 拒「full 帶金額」;比「清 value 但欄位還在」少一整族
//    autofill/表單還原塞回舊值的路)。切回 partial 時 state 已清空、必須重新輸入。
//
// 🔴 失敗回來的值要真的進畫面(A10b 關卡2 finding 2 同型):useState 初值只在掛載時求值,
//    用 effect 套 `state.input`。denied 例外 —— 授權閘在讀表單之前,input 是空殼,
//    灌進畫面會清掉員工剛打的內容(refund-action-state.ts:169 明寫此例外)。
//
// ⚠️ 無 JS(hydration 前)送出路徑**未實測**(codex R1 nit;note-compose N3 同款誠實標注):
//    形狀上只做得了全額(kind 預設 full、amount 欄不在 DOM),安全底 = server 端閘
//    (授權/旗標/確認碼/G0/RPC)全數照常、不靠任何 client 守門 —— 但「送得出去且體驗合理」
//    沒有 SSR/hydration 測試背書,只是推理。

const KIND_LABEL: Record<RefundKind, string> = {
  full: '全額退款',
  partial: '部分退款',
};

export function RefundSection({
  orderId,
  returnTo,
  serverToken,
}: {
  orderId: string;
  /**
   * #350d-4 C1:動作做完回哪裡 = 這個視圖自己的網址。
   * 🔴 值不可信任(client 送得回來):action 端一律再過 `parseOrderReturnTo`。
   *    它**決定不了退哪一張單的錢** —— 退款目標吃的是 `order_id`,本欄只影響 PRG 之後停在哪。
   */
  returnTo: string;
  /** 🔴 由 server component 渲染期產(refund-action-state.ts:41-43;不得落任何快取層)。 */
  serverToken: string;
}) {
  const [state, formAction, isPending] = useActionState<RefundActionState, FormData>(
    initiateRefundAction,
    { status: 'idle', requestToken: serverToken },
  );
  const [kind, setKind] = useState<RefundKind>('full');
  const [amount, setAmount] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [reason, setReason] = useState('');
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      // 🔴 只 refresh、絕不 client 換鍵(檔頭 MF1 段):狀態與新鍵一律向 server 重取;
      //    refresh 完成前的空窗若重送,舊鍵由 G4 承接(DUPLICATE/RAISE 皆零動錢)。
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  useEffect(() => {
    if (state.status !== 'failed') return;
    // denied 的 input 是空殼(見檔頭);其餘失敗碼的 input = 剛送出的那份,套回畫面。
    if (state.code === 'denied') return;
    if (state.input.kind === 'full' || state.input.kind === 'partial') {
      setKind(state.input.kind);
    }
    setAmount(state.input.amount);
    setConfirmCode(state.input.confirmCode);
    setReason(state.input.reason);
  }, [state]);

  const failed = state.status === 'failed';
  const requestToken = failed ? state.requestToken : serverToken;

  return (
    <section className='border-destructive/40 bg-destructive/5 rounded-lg border p-4'>
      <h2 className='text-destructive mb-1 text-sm font-semibold'>線上退款(TapPay)</h2>
      <p className='text-muted-foreground mb-3 text-xs'>
        送出後 TapPay 立即受理、無法取消。全額退款以 TapPay 端剩餘可退額為準;
        部分退款需 TapPay 已請款,金額不得超過剩餘可退額。
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
        {/* 🔴 pending 全鎖(關卡2 codex MF2):送出後 FormData 已被捕捉在跑,欄位再可編輯
            = 「眼前值」與「正在動的錢」分岔(改成 500 看著 500、實際在退 100)。
            fieldset disabled 一刀鎖全部後代控制項,不逐欄記。 */}
        <fieldset disabled={isPending} className='min-w-0 space-y-3 border-0'>
          <input type='hidden' name={REFUND_ORDER_ID_FIELD} value={orderId} />
          <input type='hidden' name={REFUND_REQUEST_TOKEN_FIELD} value={requestToken} />
          <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />

          <div className='flex flex-wrap gap-4'>
            {REFUND_KINDS.map((k) => (
              <label key={k} className='flex items-center gap-1.5 text-sm'>
                <input
                  type='radio'
                  name={REFUND_KIND_FIELD}
                  value={k}
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    // 契約債①:切到全額退清空金額(欄位本身也會 unmount,雙保險)。
                    if (k === 'full') setAmount('');
                  }}
                />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            {kind === 'partial' && (
              <AdminFormField label='退款金額(元、正整數)'>
                <input
                  name={REFUND_AMOUNT_FIELD}
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
            )}
            <AdminFormField label='確認碼(訂單號末 4 碼)'>
              {/* Q2=A 人因閘:「你真的在退這一張」;server 端驗(action 步 ④),這裡不預填、不提示答案。 */}
              <input
                name={REFUND_CONFIRM_FIELD}
                required
                maxLength={4}
                autoComplete='off'
                autoCapitalize='off'
                spellCheck={false}
                value={confirmCode}
                onChange={(event) => setConfirmCode(event.target.value)}
                className={ADMIN_INPUT_CLASS}
                placeholder='對照本頁訂單號輸入'
              />
            </AdminFormField>
          </div>

          <AdminFormField label='退款原因'>
            {/* 單行 input 而非 textarea:解析器與 RPC 都拒控制字元(含換行,refund-form.ts:43)
                —— textarea 一按 Enter 就是保證 invalid 的形狀,結構上不給輸入換行。
                maxLength 數 UTF-16 units、解析器數碼位:含 emoji 時這裡先擋,方向安全(note-form N6 同款)。 */}
            <input
              name={REFUND_REASON_FIELD}
              required
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={ADMIN_INPUT_CLASS}
              placeholder='會寫入退款紀錄與稽核,例:商品缺貨,顧客同意退款'
            />
          </AdminFormField>

          <div className='flex flex-wrap items-center justify-end gap-3'>
            <span className='text-muted-foreground mr-auto text-xs'>
              {kind === 'full'
                ? '全額退款:金額以送出當下 TapPay 剩餘可退額凍結。'
                : '部分退款:TapPay 尚未請款時會被拒(這筆會作廢、錢不會動)。'}
            </span>
            <button
              type='submit'
              disabled={isPending}
              className='bg-destructive h-9 rounded-md px-5 text-sm font-medium text-white disabled:opacity-50'
            >
              {isPending ? '送出中…' : KIND_LABEL[kind]}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
