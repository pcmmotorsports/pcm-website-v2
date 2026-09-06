import { recordManualCancelNoticeAction } from '@/lib/orders/manual-cancel-notice-actions';
import type { ManualCancelNoticeEligibility } from '@/lib/orders/manual-cancel-notice-read';

/**
 * ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B ①:「登錄我已人工寄出取消通知」。
 *
 * ══ 這顆鈕為什麼存在 ═══════════════════════════════════════════════════════
 * 卡 + 現金混合退款的取消單, 系統**刻意不寄**取消信(怕信裡的金額寫錯)⇒ 要人工寄。
 * 而人工寄完之後**系統不知道** ⇒ 提醒會一直叫。這顆鈕就是那句「我寄好了」。
 *
 * ══ 🔴 鐵則 1:視覺不是我發明的 ══════════════════════════════════════════════
 * class 逐字抄 OD 專案 `pcm-524f` 的 `order-detail-states.html` 裡**「登錄這筆收款」**那一組:
 *   `bg-primary text-primary-foreground mt-3 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50`
 * 🎯 抄那一顆是因為**它們是同一種動作** —— 人把系統外面發生的事**登記進來**(連動詞都一樣)。
 * ⚠️ **而稿上【沒有】這顆鈕**(2026-09-06 量:兩支訂單稿掃 `人工`/`補寄`/`手動`/`取消通知`
 *    ⇒ 各 0 命中;🟢 正對照 `出貨` ⇒ `order-detail-states.html` **8 行** ·
 *    `預覽-訂單明細.html` **2 行**;🔵 負對照現造字面 ⇒ 0)
 *    ⇒ 照鐵則 1「查無 ⇒ 照既有動作鈕的最小形狀做, 不自己發明視覺」。
 *
 * ══ 🛑 不合格時【不要什麼都不畫】 ═══════════════════════════════════════════
 * 直接 `return null` 的話, 「這張單不用人工寄」與「我讀不到」在畫面上**長得一模一樣**,
 * 而後者代表**那張單可能正在等人**。⇒ `unreadable` 要說出來。
 * 🔵 而其餘幾種不合格**確實不畫** —— 那些訂單頁本來就不該出現這顆鈕(絕大多數訂單都是)。
 */
export function ManualCancelNoticeButton({
  orderId,
  eligibility,
}: {
  orderId: string;
  eligibility: ManualCancelNoticeEligibility;
}) {
  if (!eligibility.eligible) {
    if (eligibility.blocker !== 'unreadable') return null;
    return (
      <p className='text-muted-foreground mt-3 text-xs'>
        暫時讀不到這張單能不能登錄人工寄信(不是「不需要」)—— 重新整理看看。
      </p>
    );
  }

  return (
    <form action={recordManualCancelNoticeAction} className='mt-3 border-t pt-3'>
      <input type='hidden' name='order_id' value={orderId} />
      <p className='text-muted-foreground text-xs'>
        這張單是<strong>卡 + 現金混合退款</strong>,系統不會自動寄取消信,要人工寄。
        寄好之後在這裡登錄一下,提醒才會消失。
      </p>
      <label className='mt-2 block text-xs'>
        <span className='text-muted-foreground'>你寄到哪個信箱</span>
        <input
          type='email'
          name='recipient_email'
          required
          defaultValue={eligibility.suggestedEmail ?? ''}
          placeholder='填你實際寄出去的那個信箱'
          className='mt-1 block w-full rounded-md border px-2 py-1 text-sm'
        />
      </label>
      {/* 🔴 兩個信箱都空是**合法**的, 而那正是最需要人工處理的那批單
          ⇒ 不預填假的、不擋住他, 只是要他自己填【實際寄到哪裡】。 */}
      {eligibility.suggestedEmail === null ? (
        <p className='text-muted-foreground mt-1 text-xs'>
          這張單上沒有留信箱 —— 請填你實際寄出去的那一個。
        </p>
      ) : null}
      <button
        type='submit'
        className='bg-primary text-primary-foreground mt-3 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
      >
        登錄我已人工寄出取消通知
      </button>
    </form>
  );
}
