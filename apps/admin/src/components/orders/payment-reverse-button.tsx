'use client';

// payment-reverse-button.tsx — 收款列展開區裡的「沖銷」入口(#372-A12 的 client island)。
//
// 🔴 **props 只收純量**(同 `shipment-void-button.tsx:5-7` 的紅線):訂單詳情的讀模型帶成交價與 PII,
//    整包不得進 client props。
//
// 🔴 **沒有冪等鍵,而且不該有**:`admin_reverse_manual_payment` 的簽章是三個參數、
//    沒有 `p_request_id`(`database.types.ts` 的 `Args` 逐字)⇒ 這裡**不要**照抄建箱彈窗
//    或收款登錄那套「開窗時鑄一把鍵」的寫法。連按兩次由 RPC 的 G8 硬擋
//    (`20260812150000:414-422`:同一列不可能被沖兩次)。
//    ⚠️ 下面的 `busy` 只是體驗層(避免看起來沒反應),**不是**防重機制。
//
// 🔴 **確認詞兩句、不共用**:一般收款列沖掉是把錢從「已收」扣掉;
//    沖銷列沖掉是**把原本那筆收款恢復到帳上**(方向相反)。共用一句 = 在最需要分辨的那一刻不給分辨。
//    兩句都是合約字面(plan §12 A/B),住在 `payment-reverse-state.ts`,本檔只挑不改。

import { useCallback, useState } from 'react';
import { reversePaymentAction } from '../../lib/orders/payment-reverse-actions';
import {
  REVERSE_CONFIRM_PAYMENT,
  REVERSE_CONFIRM_REVERSAL,
  REVERSE_SUCCESS,
  reverseMessageFor,
} from '../../lib/orders/payment-reverse-state';

export function PaymentReverseButton({
  paymentId,
  orderId,
  returnTo,
  isReversal,
}: {
  paymentId: string;
  orderId: string;
  returnTo: string;
  /** 這一列本身是不是一筆沖銷紀錄 —— 只用來挑確認詞,不參與「准不准沖」的判斷。 */
  isReversal: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirmCopy = isReversal ? REVERSE_CONFIRM_REVERSAL : REVERSE_CONFIRM_PAYMENT;

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await reversePaymentAction({
        paymentId,
        orderId,
        returnTo,
        reason: reason.trim(),
      });
      if (r.ok) {
        // 成功後收起面板。列表由 action 的 `revalidateOrderViews` 重取,
        // 這一列會長出「已沖銷」標記、鈕跟著消失。
        // 🔴 但**重取回來之前**畫面上什麼都沒變 —— 而「面板收起來」與「什麼都沒發生」
        //    長得一模一樣 ⇒ 留一句正面確認蓋住那段空窗(關卡2 R2 nit7)。
        setNotice(REVERSE_SUCCESS);
        setOpen(false);
        setReason('');
        return;
      }
      setError(r.message);
    } catch {
      // 🔴🔴 **這個 catch 是必要的,而且它是這一片最危險的那條路**(關卡2 R1 MF1):
      //    server action 的呼叫本身可能 **reject**(瀏覽器到 server 之間斷線、
      //    RSC 回應壞掉)—— 而那正是「**DB 可能已經 commit,只是回應沒回來**」的形狀。
      //    沒有這個 catch 的話:①核可句 C(唯一告訴他怎麼辦的那句)永遠不會出現
      //    ②`busy` 卡在 true、鈕永久 disabled ⇒ 員工看到一個死掉的面板、零指示,
      //    而帳上可能已經沖掉了。
      //    ⇒ 一律映成 `unknown`(= 核可句 C 的雙分支),**不得**映成任何說「沒有沖成」的句子。
      setError(reverseMessageFor('unknown'));
    } finally {
      // 🔴 `finally` 而不是在每條路徑各寫一次:漏掉任何一條 = 鈕永久卡死。
      setBusy(false);
    }
  }, [paymentId, orderId, returnTo, reason]);

  if (!open) {
    return (
      <div className='mt-1 space-y-1'>
        <button
          type='button'
          onClick={() => {
            setNotice(null);
            setOpen(true);
          }}
          className='text-destructive border-destructive/40 rounded-md border-input border px-2 py-1 text-xs'
        >
          沖銷這一筆
        </button>
        {notice !== null && <p className='text-foreground text-xs'>{notice}</p>}
        {/* 失敗後面板會收起來的情況(目前沒有這條路,留著避免訊息無處可畫)。 */}
        {error !== null && <p className='text-destructive text-xs'>{error}</p>}
      </div>
    );
  }

  return (
    <div className='mt-2 space-y-2'>
      <p className='text-foreground text-xs'>{confirmCopy}</p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder='沖銷原因(必填)'
        aria-label='沖銷原因'
        className='w-full rounded-md border-input border px-2 py-1 text-xs'
      />
      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          // 🔴 空白也要擋:RPC 的 G3 是 `btrim` 後判空(`20260812150000:382-385`)——
          //    只擋空字串的話,全是空白的原因會送到 DB 才被拒,員工拿到的是一句通用訊息。
          disabled={busy || reason.trim() === ''}
          onClick={() => void run()}
          className='bg-destructive rounded-md px-2 py-1 text-xs text-white disabled:opacity-50'
        >
          確認沖銷
        </button>
        <button
          type='button'
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className='rounded-md border-input border px-2 py-1 text-xs'
        >
          取消
        </button>
      </div>
      {error !== null && <p className='text-destructive text-xs'>{error}</p>}
    </div>
  );
}
