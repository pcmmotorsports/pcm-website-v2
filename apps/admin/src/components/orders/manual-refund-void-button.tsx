'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { voidManualRefundAction } from '../../lib/payment/manual-refund-void-actions';
import {
  MANUAL_REFUND_VOID_ID_FIELD,
  MANUAL_REFUND_VOID_ORDER_ID_FIELD,
  MANUAL_REFUND_VOID_REASON_FIELD,
  MANUAL_REFUND_VOID_REASON_MAX,
  shouldShowVoidFailure,
  type ManualRefundVoidActionState,
} from '../../lib/payment/manual-refund-void-action-state';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

// manual-refund-void-button.tsx — M-4b E10 片 D3-c:帳本每一列的「作廢」入口。
//
// 🔴 **作廢不動錢。** 它說的是「這筆登記本身記錯了」——
//    ⇒ 文案一律用「這筆登記」,絕不用「退款」當受詞,免得員工以為按了會把錢收回來。
//
// 🔴 **兩段式(先按『作廢這筆登記』展開,填理由才送出)** ——
//    這一列旁邊就是金額,一鍵直送的誤觸成本是一筆帳對不起來。
//    ⚠️ 而它不是防線:真正擋住亂按的是 RPC 那道「理由不能空白」+ 作廢後不可覆蓋。
//
// 🔴 bfcache 還原做 router.refresh()(同 manual-refund-entry-section.tsx):
//    作廢是狀態轉移,回上一頁看到的是舊狀態 ⇒ 員工會對著一列已作廢的資料再按一次。

export function ManualRefundVoidButton({
  refundId,
  orderId,
  returnTo,
}: {
  refundId: string;
  orderId: string;
  returnTo: string;
}) {
  const [state, formAction, isPending] = useActionState<ManualRefundVoidActionState, FormData>(
    voidManualRefundAction,
    { status: 'idle' },
  );
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  // 🔴 失敗回來的值要真的進畫面 + 面板要保持展開(同 entry-section 的理由:
  //    useState 初值只在掛載時求值)。denied 例外——那一格 reason 是空殼。
  useEffect(() => {
    // 🔴 判斷用 shouldShowVoidFailure,**不要在這裡另寫一份比對** ——
    //    第一版這裡與下面 `failedHere` 各寫一份,而兩份都漏了「授權失敗帶回空 ID」那格。
    //    兩份規格漂移正是 manual-refund-entry-gate.ts 檔頭在警告的那個病。
    if (!shouldShowVoidFailure(state, refundId)) return;
    setOpen(true);
    if (state.status === 'failed' && state.code !== 'denied') setReason(state.reason);
  }, [state, refundId]);

  const failedHere = shouldShowVoidFailure(state, refundId);

  if (!open) {
    return (
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='text-destructive hover:bg-destructive/10 h-7 rounded-md border border-current/30 px-2 text-xs'
      >
        作廢這筆登記
      </button>
    );
  }

  return (
    <form action={formAction} className='min-w-[13rem] space-y-2'>
      <input type='hidden' name={MANUAL_REFUND_VOID_ID_FIELD} value={refundId} />
      <input type='hidden' name={MANUAL_REFUND_VOID_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />

      {failedHere && (
        <p
          role='alert'
          className='border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-2 py-1.5 text-xs'
        >
          {state.message}
        </p>
      )}

      <fieldset disabled={isPending} className='min-w-0 space-y-2 border-0'>
        <input
          name={MANUAL_REFUND_VOID_REASON_FIELD}
          required
          // 🔴 **HTML 的 maxLength 數的是 UTF-16 code unit,不是字**(codex R1 nit,2026-08-22):
          //    emoji 與部分 CJK 擴充字各佔 2 個 ⇒ 瀏覽器實際只讓人打到約 100 個 emoji,
          //    而 server 端的 parser 用 `[...reason].length` 數字、允許 200 個。
          //    ⇒ **兩邊不一致,而不一致的方向是【瀏覽器比較嚴】** ⇒ fail-closed,不會放進超長的值。
          //    ⚠️ 留著它是因為它擋的是「貼上一大段」那種誤操作;**真權威是 server 那道**,
          //      而 DB 那道(text 欄 + RPC)是最後一道。這裡不做字素級的 JS 計數 ——
          //      為了讓兩個數字對齊而在 client 端重寫一套計數,是拿一個新的漂移點換一個顯示細節。
          maxLength={MANUAL_REFUND_VOID_REASON_MAX}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={ADMIN_INPUT_CLASS}
          placeholder='為什麼這筆記錯了?會寫進稽核'
          aria-label='作廢理由'
        />
        {/* 🔴🔴 **這段文案是 Fable R2 must-fix F1 改的,而原句是【反的】**(2026-08-22):
            原句寫「不會把錢收回來,**也不會退第二次**」——
            而作廢的實際系統效果**正好相反**:`pcm_order_refundable_remaining` 只計入
            `voided_at IS NULL` 的列(`20260820100000:259-263`),而那個餘額**餵退款發起入口的閘**
            (同檔 COMMENT 逐字:「後台退款發起入口的閘吃它的輸出」)
            ⇒ **作廢一筆正確的登記 = 重新開啟同額第二次退款的資格。**
            ⇒ 失敗情境(Fable 構造,不是理論):現金 5000 已退並正確登記 → 員工誤按作廢
              (而文案向他保證「不會退第二次」)→ 可退餘額回到 5000 → 另一員工照閘發起卡退
              → **客人拿兩次錢**。而作廢無法反悔(`:353-357` 不覆蓋)、重記又被 #787 封著。
            📌 **「作廢不動錢」在 DB 層為真,在【按的人的心智模型】層是反的** ——
              兩層各自為真而沒人對過。這行字就是那個對帳。 */}
        <p className='text-muted-foreground text-xs'>
          作廢是把這筆<strong>登記</strong>標成記錯了,系統不會去把錢收回來。
          <strong className='text-destructive'>
            而這張單的可退餘額會加回這筆金額 —— 系統會當作這筆從來沒退過。
          </strong>
          如果錢其實已經還給客人了,作廢之後這張單就可能被再退一次。
        </p>
        <div className='flex gap-2'>
          <button
            type='submit'
            disabled={isPending}
            className='bg-destructive h-7 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50'
          >
            {isPending ? '送出中…' : '確認作廢'}
          </button>
          <button
            type='button'
            onClick={() => setOpen(false)}
            disabled={isPending}
            className='h-7 rounded-md border px-3 text-xs disabled:opacity-50'
          >
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}
