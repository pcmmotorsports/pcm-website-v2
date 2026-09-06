'use client';

import {
  recordManualCancelNoticeAction,
  revokeManualCancelNoticeAction,
} from '@/lib/orders/manual-cancel-notice-actions';
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
  canRevoke = false,
}: {
  orderId: string;
  eligibility: ManualCancelNoticeEligibility;
  /**
   * 🔴 **這一格不是 `eligibility` 的反面** —— `already_recorded` 有兩種成因
   *    (人工登錄的 / 系統寄的), 而**只有前者准撤**。由伺服器現讀決定, 見
   *    `canRevokeManualCancelNotice`。
   */
  canRevoke?: boolean;
}) {
  if (!eligibility.eligible) {
    // 🔵 有一列人工登錄可以撤 ⇒ 給撤銷鈕(誤按的唯一救援)。
    // 🔴🔴 **不綁 `blocker === 'already_recorded'`**(codex 2026-09-06 must-fix ②)——
    //    ⛔ 舊版綁了, 而**資格會漂**:那張單的 `payment_status` 若被降成 `partiallyRefunded`
    //      (有人作廢了一筆人工退款), 資格回的是 `not_card_refunded` **不是** `already_recorded`
    //      ⇒ 🛑 **撤銷鈕整個消失, 而那一列還在、SQL 也還准撤**
    //      ⇒ 📌 **合法的救援入口在他最需要的時候不見了。**
    //    ✅ 判準只看一件事:**有沒有一列人工登錄可以撤**。那由伺服器現讀決定。
    if (canRevoke) {
      return (
        <form
          action={revokeManualCancelNoticeAction}
          className='mt-3 border-t pt-3'
          onSubmit={(event) => {
            if (
              !window.confirm(
                '確定要撤銷「已人工寄出取消通知」的登錄嗎?\n\n' +
                  // ⛔ ~~系統之後可能會自己寄一封取消信給客人~~
                  // 🔴 **那句話是錯的**(code-reviewer must-fix, 我開檔核過):
                  //    自動寄的掃描面是 `pcm_cancelled_email_pending`, 而它逐字帶
                  //    `NOT EXISTS (order_manual_refunds WHERE voided_at IS NULL)`
                  //    (`20260905310000:193-196`)⇒ 🛑 **混合退款的單被【永久排除】**
                  //    ⇒ 📌 刪掉那一列**不會**讓它回到自動寄的隊列, 只會回到**人工提醒**。
                  //    ⇒ ⇒ 再寄的是**人**, 不是系統。方向不同, 而客服照這句話決定要不要撤。
                  '⚠️ 撤銷之後這張單會【重新回到「要人工寄」的提醒裡】。\n' +
                  // 🔴 codex must-fix ③:那句「不會自動補寄」**是有條件的**, 不是永遠成立 ——
                  //    自動寄的 view 排除的是「**有未作廢的人工退款**」, 而那是**可變的**:
                  //    人工退款被作廢、卡上又補退滿之後, 這張單會重新符合自動寄的條件
                  //    ⇒ 🛑 **刪掉那一列之後系統【真的會】排一封信出去。**
                  //    ⇒ 所以這裡不敢再說死「一定是人再寄」, 改成兩種都講。
                  '⇒ 只有【按錯了、其實沒寄】才撤。如果你其實真的寄過信,' +
                  '撤掉之後客人可能收到第二封(多數情況是由人再寄一次;' +
                  '而如果那筆現金退款後來被作廢、錢改成全退回卡上,系統也可能自己寄)。',
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type='hidden' name='order_id' value={orderId} />
          <p className='text-muted-foreground text-xs'>
            這張單已經登錄過「人工寄出取消通知」。
            <strong>按錯了</strong>才需要撤銷 —— 撤了它會重新回到提醒裡。
          </p>
          <button
            type='submit'
            className='mt-3 rounded-md border px-2 py-1 text-xs disabled:opacity-50'
          >
            撤銷這筆人工登錄
          </button>
        </form>
      );
    }
    if (eligibility.blocker !== 'unreadable') return null;
    return (
      <p className='text-muted-foreground mt-3 text-xs'>
        暫時讀不到這張單能不能登錄人工寄信(不是「不需要」)—— 重新整理看看。
      </p>
    );
  }

  return (
    <form
      action={recordManualCancelNoticeAction}
      className='mt-3 border-t pt-3'
      /**
       * 🔴🔴 **送出前 confirm —— 而這一顆【不可撤銷】, 不是一般的二次確認。**
       * 主視窗 2026-09-06 裁乙時逐字要求「確認對話框兩顆鈕都要」;R2 must-fix ② 指出我沒做。
       * 🛑 **為什麼特別重要**:按下去插的那一列會吃掉 `email_outbox` 上
       *    `(order_cancelled, <orderId>)` 那個唯一鍵, 而掃描 view 的 anti-join **只問 event_type**
       *    ⇒ 📌 **誤按 = 那張單從「要人工寄」的提醒裡消失。**
       *    ⛔ ~~而後台今天沒有撤銷入口(撤銷那一片還沒做)~~
       *    🔵 **2026-09-06 起有了** —— 就是下面那顆「撤銷這筆人工登錄」(同一片做的)。
       *      ⇒ ⚠️ 但**撤銷需要管理者權限**, 而按錯的人不一定有 ⇒ confirm 仍然要。
       * 🔵 形狀照既有的 `note-compose-form.tsx:216-220`(同樣是「不可撤回 ⇒ 送出前 confirm」),
       *    不自己發明。⚠️ 而 `window.confirm` 只擋得住**手滑**, 擋不住**看錯單** ——
       *    所以訊息裡把**收件信箱**印出來, 讓他有一個可以核對的東西。
       */
      onSubmit={(event) => {
        const email = new FormData(event.currentTarget).get('recipient_email');
        if (
          !window.confirm(
            `確定要登錄「已人工寄出取消通知」嗎?\n\n` +
              // 🔴 codex R3 nit ④:SOP 叫客服「看清楚是不是那張單」而框裡**沒有單號**
              //    ⇒ 同一個客人有兩張合格單、信箱又一樣時, 兩個分頁的框**長得一模一樣**。
              `訂單:${eligibility.displayId ?? orderId}\n收件人:${String(email ?? '')}\n\n` +
              // ⛔ ~~這個動作不可撤銷…後台目前沒有地方可以把它改回來~~
              // 🔴 **2026-09-06 那句話在【同一顆 diff 裡】變成假的** —— 撤銷鈕就是這一片做的。
              //    (code-reviewer 抓到, 並指出 repo 有同型前科:`receipt-undo-bar.tsx:75`)
              '登錄之後,系統就不會再把這張單列進「還沒寄」的提醒。' +
              '⚠️ 按錯了可以用下面的「撤銷這筆人工登錄」改回來,而那需要管理者權限。',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
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
