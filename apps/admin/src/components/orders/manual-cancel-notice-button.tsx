'use client';

import {
  recordManualCancelNoticeAction,
  revokeManualCancelNoticeAction,
  markPhoneNotifiedAction,
} from '@/lib/orders/manual-cancel-notice-actions';
import type {
  ManualCancelNoticeEligibility,
  PhoneNotifiedMark,
} from '@/lib/orders/manual-cancel-notice-read';

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
  phoneNotified = null,
}: {
  orderId: string;
  eligibility: ManualCancelNoticeEligibility;
  /**
   * 🔴 **這一格不是 `eligibility` 的反面** —— `already_recorded` 有兩種成因
   *    (人工登錄的 / 系統寄的), 而**只有前者准撤**。由伺服器現讀決定, 見
   *    `canRevokeManualCancelNotice`。
   */
  canRevoke?: boolean;
  /**
   * ⟦mail-PHONEONLYNOTIFY⟧:那張單有沒有被標記「已電話通知」(誰、何時)。
   * 🔵 有 ⇒ 把鈕換成一行事實(主視窗 2026-09-06 裁的代價③ 修法)——
   *    那種單**不會出現在通知信那一區**(根本沒有 outbox 列), 所以這一行是客服唯一看得到的痕跡。
   */
  phoneNotified?: PhoneNotifiedMark | null;
}) {
  // 🔴 **已標記 ⇒ 先畫那一行** —— 而**不 `return`**(code-reviewer 2026-09-06 important ⑤)。
  //    ⛔ 舊版直接 return ⇒ 標記之後**整個元件只剩那一行**:登錄鈕沒了、**撤銷鈕也沒了**
  //    ⇒ 🛑 而四處字面都寫著「按錯的後果**只是那張單不再被提醒**」
  //      ⇒ 📌 **那句話比實際行為窄** —— 它同時永久收掉了那張單的登錄與撤銷入口。
  //    ✅ 改成先畫再往下走;電話鈕那側已經有 `phoneNotified === null` 擋著不會重畫。
  //    ⚠️ 而它**不綁 blocker** 仍然是刻意的:標記過的單資格會回**各種** blocker,
  //      綁上就會像撤銷鈕那次一樣被資格漂移藏掉(codex 對那顆的 must-fix ②)。
  const notifiedLine = phoneNotified ? (
    <p className='text-muted-foreground mt-3 border-t pt-3 text-xs'>
      ☎️ <strong>已電話通知</strong> · {phoneNotified.actor} ·{' '}
      {new Date(phoneNotified.at).toLocaleString('zh-TW')}
      <br />
      這張單沒有客人的信箱,所以是用電話通知的 —— 它不會出現在上面的「通知信」紀錄裡。
    </p>
  ) : null;
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
        <>
        {notifiedLine}
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
        </>
      );
    }
    if (eligibility.blocker !== 'unreadable') return notifiedLine;
    return (
      <>
        {notifiedLine}
        <p className='text-muted-foreground mt-3 text-xs'>
          暫時讀不到這張單能不能登錄人工寄信(不是「不需要」)—— 重新整理看看。
        </p>
      </>
    );
  }

  return (
    <>
    {notifiedLine}
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
          <br />
          <strong>如果你是打電話通知的</strong>,別填這裡 —— 用下面那顆。
        </p>
      ) : null}
      <button
        type='submit'
        className='bg-primary text-primary-foreground mt-3 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
      >
        登錄我已人工寄出取消通知
      </button>
    </form>
    </>
  );
}

/**
 * ⟦mail-PHONEONLYNOTIFY⟧:「已電話通知」——**只在那張單沒有信箱時出現**。
 *
 * 🔴 **為什麼要分成兩顆鈕而不是一顆**:寄信與打電話**留下的痕跡完全不同**
 *    (前者進 `email_outbox` 有紀錄可查, 後者只有稽核), 而客服**要知道自己按的是哪一種**。
 * 🛑 **這顆【不可撤銷】** —— 稽核 append-only。而它與登錄鈕**不對稱, 那是刻意的**:
 *    誤按登錄鈕會讓客人**收不到信**;誤按這顆只是**那張單不再被提醒**, 主管在稽核裡看得到誰按的。
 */
export function PhoneNotifiedButton({
  orderId,
  show,
  emailReadFailed = false,
}: {
  orderId: string;
  /** 🔵 由呼叫端決定:合格(要人工處理)· 兩個信箱都空 · **而且不是讀失敗**。 */
  show: boolean;
  /**
   * 🔴 **讀 `customers` 失敗** ⇒ 不出鈕, 但**要說出來**(code-reviewer important ④)。
   * ⛔ 什麼都不畫的話,「這張單有信箱(不需要這顆鈕)」與「我讀不到」在畫面上長得一樣,
   *    而後者代表**那張單可能正在等人**。
   */
  emailReadFailed?: boolean;
}) {
  if (emailReadFailed) {
    return (
      <p className='text-muted-foreground mt-2 text-xs'>
        ⚠️ 客人的資料暫時讀不到,所以先不顯示「我是用電話通知的」那顆鈕
        —— <strong>不是這張單不需要</strong>。重新整理看看。
      </p>
    );
  }
  if (!show) return null;
  return (
    <form
      action={markPhoneNotifiedAction}
      className='mt-2'
      onSubmit={(event) => {
        if (
          !window.confirm(
            '確定要標記「已電話通知」嗎?\n\n' +
              '⚠️ 這個動作【不能撤銷】:標記之後這張單就不會再出現在提醒裡。\n' +
              '⇒ 只有你**真的打過電話通知客人**才按。按錯了要請主管在稽核紀錄裡查。',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type='hidden' name='order_id' value={orderId} />
      <button
        type='submit'
        className='rounded-md border px-2 py-1 text-xs disabled:opacity-50'
      >
        我是用電話通知的(標記已處理)
      </button>
    </form>
  );
}
