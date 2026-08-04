'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import {
  judgeRefundExceptionAction,
  resolveRefundExceptionAction,
} from '../../lib/payment/refund-recovery-actions';
import { RESOLUTION_REQUIRED_VERDICT } from '../../lib/payment/refund-judgment';
import {
  RECOVERY_CONFIRM_FIELD,
  RECOVERY_DR_CODE_FIELD,
  RECOVERY_REFUND_ID_FIELD,
  RECOVERY_REQUEST_TOKEN_FIELD,
  RECOVERY_RESOLUTION_FIELD,
  type RefundJudgeState,
  type RefundResolveState,
} from '../../lib/payment/refund-recovery-state';

// refund-exception-resolve.tsx — M-3 A7c RW4:異常清單列的對帳判定+人工結案(高風險片、鐵則 12 ①)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 流程(§4-1):①員工按「執行對帳判定」→ server 讀 Record 算差額回讀數 ②依判定只開放
// 對應的一顆結案按鈕(delta=0 → 標記失敗;delta=登記額 → Portal 真碼恢復;其餘=停+告警、
// 零按鈕)。**畫面上的判定只是預覽 —— 結案 action 送出當下會重新對帳再過判定閘**,
// 這裡藏按鈕只是人因降噪,不是防護(A1 同型教訓:可見性看伺服端閘)。
//
// 🔴 本元件不吃退款發起旗標(refund-ui-flag.ts;字面刻意不寫):結案流程是旗標的開啟前置,
//    被旗標鎖住=卡列永遠無人能收(refund-recovery-actions.ts 檔頭同記)。
//
// 🔴 bfcache 還原絕不 client 換鍵(refund-section MF1 同紀律):pageshow persisted →
//    `router.refresh()` 向 server 重取;結案重放權威=RPC G5 CAS,舊 token 重送零風險。

const TH_NUM = 'font-medium tabular-nums';

export function RefundExceptionResolve({
  refundId,
  serverToken,
}: {
  refundId: string;
  /** server component 渲染期產(每列一把;refund-action-state.ts:41-43 紀律)。 */
  serverToken: string;
}) {
  const [judgeState, judgeAction, judgePending] = useActionState<RefundJudgeState, FormData>(
    judgeRefundExceptionAction,
    { status: 'idle' },
  );
  const [resolveState, resolveAction, resolvePending] = useActionState<
    RefundResolveState,
    FormData
  >(resolveRefundExceptionAction, { status: 'idle', requestToken: serverToken });
  const [drCode, setDrCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  useEffect(() => {
    if (resolveState.status !== 'failed') return;
    // denied 例外:授權閘在讀表單之前、帶回的是空殼,灌回畫面會清掉員工剛打的碼。
    if (resolveState.code === 'denied') return;
    setDrCode(resolveState.drCode);
    setConfirmCode(resolveState.confirmCode);
  }, [resolveState]);

  const pending = judgePending || resolvePending;
  const requestToken =
    resolveState.status === 'failed' ? resolveState.requestToken : serverToken;
  // 🔴 結果不明凍結(codex R2 nit):finalize_unknown=「確認前什麼都別做」,舊判定與按鈕
  //    留在畫面就是与訊息打架 —— 整格只剩告警,出口=重新整理(向 server 重取現況)。
  const frozen = resolveState.status === 'failed' && resolveState.code === 'finalize_unknown';
  const judged = !frozen && judgeState.status === 'judged' ? judgeState : null;

  return (
    <div className='space-y-2'>
      {!frozen && (
        <form action={judgeAction}>
          <fieldset disabled={pending} className='border-0 p-0'>
            <input type='hidden' name={RECOVERY_REFUND_ID_FIELD} value={refundId} />
            <button
              type='submit'
              className='bg-secondary text-secondary-foreground h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-50'
            >
              {judgePending ? '對帳中…' : '執行對帳判定'}
            </button>
          </fieldset>
        </form>
      )}

      {judgeState.status === 'failed' && (
        <p
          role='alert'
          className='border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs'
        >
          {judgeState.message}
        </p>
      )}

      {judged && (
        <div className='bg-muted/40 space-y-2 rounded-md border p-3 text-xs'>
          <p className='text-muted-foreground'>
            {/* 讀數快照:結案送出時 server 會重新對帳,這裡只是預覽。 */}
            Record 對帳讀數(判定時刻 {judged.judgedAtIso};送出結案時會重新對帳):
          </p>
          <p className='flex flex-wrap gap-x-4 gap-y-1'>
            <span>
              發起前累計已退:<span className={TH_NUM}>NT$ {formatOrderAmount(judged.baseline)}</span>
            </span>
            <span>
              現在累計已退:
              <span className={TH_NUM}>
                {judged.refundedNow === null ? '無讀數' : `NT$ ${formatOrderAmount(judged.refundedNow)}`}
              </span>
            </span>
            <span>
              差額:
              <span className={TH_NUM}>
                {/* 負差額(Portal 端取消過退款)顯示成 -NT$ X,不讓負號黏進金額(opus nit)。 */}
                {judged.delta === null
                  ? '無讀數'
                  : judged.delta < 0
                    ? `-NT$ ${formatOrderAmount(-judged.delta)}`
                    : `NT$ ${formatOrderAmount(judged.delta)}`}
              </span>
            </span>
            <span>
              本筆登記金額:<span className={TH_NUM}>NT$ {formatOrderAmount(judged.refundAmount)}</span>
            </span>
          </p>
          <p className='text-muted-foreground'>
            {/* RF8 對帳結論由 server 算(期望和含本列;opus C1:executed 不得恆報不一致)。 */}
            帳本已登記(confirmed)合計:
            <span className={TH_NUM}>NT$ {formatOrderAmount(judged.ledgerConfirmedSum)}</span>
            {judged.ledgerMatchesRecord === true && (
              <span>;含本筆在內與 Record 累計一致。</span>
            )}
            {judged.ledgerMatchesRecord === null && (
              <span>;本筆讀數異常,帳本與 Record 的對帳請以人工為準。</span>
            )}
          </p>
          {judged.ledgerMatchesRecord === false && (
            <p role='alert' className='text-destructive font-medium'>
              ⚠ 帳本合計與 Record 累計不一致(可能有 Portal 場外操作),
              請以 TapPay Record/Portal 人工對帳並通知系統維護。
            </p>
          )}
          {judged.confirmedMissingRefundId > 0 && (
            <p role='alert' className='text-destructive font-medium'>
              ⚠ 有 {judged.confirmedMissingRefundId} 筆已完成退款缺 TapPay 對帳碼(資料異常),
              請通知系統維護。
            </p>
          )}
          <p
            className={
              judged.verdict === RESOLUTION_REQUIRED_VERDICT.mark_failed ||
              judged.verdict === RESOLUTION_REQUIRED_VERDICT.recover_confirmed
                ? 'font-medium'
                : 'text-destructive font-medium'
            }
          >
            {judged.message}
          </p>

          {judged.verdict === RESOLUTION_REQUIRED_VERDICT.mark_failed && (
            <form action={resolveAction}>
              {/* 確認碼閘(opus C3;Q2=A 同款):標記失敗寫入不可逆(P7C14 write-once、
                  failed 終態),一鍵零摩擦=相鄰列誤點就是帳本永久錯記;server 端驗。 */}
              <fieldset disabled={pending} className='flex flex-wrap items-center gap-2 border-0 p-0'>
                <input type='hidden' name={RECOVERY_REFUND_ID_FIELD} value={refundId} />
                <input type='hidden' name={RECOVERY_REQUEST_TOKEN_FIELD} value={requestToken} />
                <input type='hidden' name={RECOVERY_RESOLUTION_FIELD} value='mark_failed' />
                <label className='flex items-center gap-1.5'>
                  確認碼(訂單號末 4 碼)
                  <input
                    name={RECOVERY_CONFIRM_FIELD}
                    required
                    maxLength={4}
                    autoComplete='off'
                    autoCapitalize='off'
                    spellCheck={false}
                    value={confirmCode}
                    onChange={(event) => setConfirmCode(event.target.value)}
                    className='border-input bg-background h-8 w-28 rounded-md border px-2 font-mono text-xs'
                    placeholder='對照本列訂單編號'
                  />
                </label>
                <button
                  type='submit'
                  className='bg-destructive h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50'
                >
                  {resolvePending ? '結案中…' : '標記失敗(確認錢未動)'}
                </button>
              </fieldset>
            </form>
          )}

          {judged.verdict === RESOLUTION_REQUIRED_VERDICT.recover_confirmed && (
            <form action={resolveAction}>
              <fieldset disabled={pending} className='flex flex-wrap items-center gap-2 border-0 p-0'>
                <input type='hidden' name={RECOVERY_REFUND_ID_FIELD} value={refundId} />
                <input type='hidden' name={RECOVERY_REQUEST_TOKEN_FIELD} value={requestToken} />
                <input type='hidden' name={RECOVERY_RESOLUTION_FIELD} value='recover_confirmed' />
                <label className='flex items-center gap-1.5'>
                  Portal 退款編號
                  <input
                    name={RECOVERY_DR_CODE_FIELD}
                    required
                    maxLength={64}
                    autoComplete='off'
                    autoCapitalize='off'
                    spellCheck={false}
                    value={drCode}
                    onChange={(event) => setDrCode(event.target.value)}
                    className='border-input bg-background h-8 rounded-md border px-2 font-mono text-xs'
                    placeholder='到 TapPay Portal 抄這筆退款的編號'
                  />
                </label>
                <button
                  type='submit'
                  className='bg-destructive h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50'
                >
                  {resolvePending ? '結案中…' : '恢復結案(登記為已退)'}
                </button>
              </fieldset>
            </form>
          )}
        </div>
      )}

      {resolveState.status === 'failed' && (
        <p
          role='alert'
          className='border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs'
        >
          {resolveState.message}
        </p>
      )}
    </div>
  );
}
