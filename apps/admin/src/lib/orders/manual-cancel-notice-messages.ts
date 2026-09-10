// manual-cancel-notice-messages.ts — ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B ①②③
//
// 🔴 **為什麼這些東西住在【自己的檔】, 而不是跟 action 放一起**:
//    `'use server'` 的檔**只能匯出 async function** —— 匯出一個物件會讓 build 直接紅
//    (逐字 `A "use server" file can only export async functions, found object.`)。
//    🔬 2026-09-06 實測:我第一版把它們放在 actions 裡 ⇒ **typecheck rc=0 · lint rc=0 · build rc=1**
//    ⇒ 📌 **只有 build 這一把尺看得見它** —— 而 CLAUDE.md 鐵則 11 那句「動 .ts/.tsx 加 build」
//      擋下的正是這一格。
//    ✅ 而 repo 早就有這個形狀:`apps/admin/src/lib/mail/dead-letter-messages.ts`
//      是獨立一支檔, **理由一模一樣**。照抄, 不發明。

/**
 * 🔴🔴 **前綴不是裝飾**(理由逐字抄自 `manual-order-action-state.ts:105-110`)——
 * `?r=` 是這一批頁面**唯一共用**的參數, 上面還有改單線 / 取消線 / 改金額線的碼在跑,
 * 而 `denied` / `invalid` / `not_found` **已經被改單線佔走**
 * (`result-banner.tsx:112` `:123` `:124`)。
 * ⇒ 🛑 不加前綴 = 員工按了這顆鈕, 卻看到**改單線**的「未儲存」。
 *
 * 🔬 **而這一格是 code-reviewer 2026-09-06 抓到的**:我第一版自己發明了一個 `?mcn=` 參數,
 *    而訂單頁**根本不讀那個參數**(它讀 `r`, `page.tsx:55`)
 *    ⇒ 📌 **12 個碼一個都不會顯示** —— 正是本檔下面那句自己寫的病。
 *    ⛔ ~~13 個碼~~ 🔴 R2 nit 訂正:那個 13 把已經拿掉的成功碼 `ok` 一起算了 ——
 *       **它是加出來的, 不是數出來的**。🔬 數法:`grep -c "manualCancelNoticeResultCode('" 本檔` ⇒ **12**。
 */
export function manualCancelNoticeResultCode(code: ManualCancelNoticeFailureCode): string {
  return `manual_cancel_notice_${code}`;
}

/**
 * 🔴🔴 **成功【沒有】結果碼, 而這是刻意的** ——
 * 理由逐字照 `result-banner.tsx` 那段裁定(取消線 D1 關卡2 must-fix):
 *   `?r=` 是**任何人都能自己打的字** ⇒ 若登錄一則綠色「已登錄」進表裡,
 *   對一張**根本沒被登錄過**的單貼上那個網址, 畫面就會說成功。
 * 🛑 **而錯的方向正好是危險的那一邊**:員工看到綠字**就不會再去登錄它**
 *    ⇒ 那位客人的取消信永遠沒有人補寄, 而提醒還在叫、沒有人相信它。
 * ✅ **成功的證據改用【看得到的事實】**:那顆鈕消失(資格變成 `already_recorded`)
 *    + 寄信紀錄多一列。**兩個都是伺服器現讀的, 網址偽造不了。**
 */
export type ManualCancelNoticeFailureCode =
  | 'denied'
  | 'invalid'
  | 'email_invalid'
  | 'not_found'
  | 'not_card_refunded'
  | 'not_cancelled'
  | 'not_mixed_rail'
  | 'already_recorded'
  | 'unreadable'
  | 'audit_failed'
  | 'write_failed'
  | 'raced';

/**
 * 🔴 **每一個碼都要有一句給人看的話** —— 一個碼沒有對應句子時,
 * `ResultBanner` 什麼都不畫(它只渲染 `MESSAGES` 裡有的鍵),
 * 而員工會以為他按成功了。
 * ⇒ 這張表的鍵**必須**是 namespaced 之後的字面, 不是裸碼。
 *
 * ⚠️ **而「12 顆都看得到」不成立, 照實寫**(codex R3 nit ⑤):`not_found` 這一顆**到不了畫面** ——
 *    訂單詳情頁在讀結果碼**之前**就先 `notFound()` 了(`order-detail-route.tsx` 那一段),
 *    所以送一個「格式合法而不存在」的訂單 id 進來, 使用者看到的是 **404 頁**, 不是這句話。
 *    🔵 **那顆碼仍然留著**:它讓 action 那一側的失敗**有名字**(log 與測試看得到),
 *    而使用者看到 404 也**不是假訊息** —— 那張單真的不存在。
 *    ⇒ 📌 **這裡記的是「12 顆有名字」, 不是「12 顆都會顯示」。**
 */
export const MANUAL_CANCEL_NOTICE_MESSAGES: Readonly<
  Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }>
> = Object.freeze({
  [manualCancelNoticeResultCode('denied')]: {
    text: '你沒有權限,要找管理者。這一次什麼都沒寫進去。',
    tone: 'error',
  },
  [manualCancelNoticeResultCode('invalid')]: {
    text: '表單有欄位沒填,什麼都沒寫進去。',
    tone: 'warn',
  },
  [manualCancelNoticeResultCode('email_invalid')]: {
    text: '這個 Email 不合格式(或者是系統自己產的假信箱),什麼都沒寫進去。',
    tone: 'warn',
  },
  [manualCancelNoticeResultCode('not_found')]: {
    text: '找不到這張訂單,什麼都沒寫進去。',
    tone: 'warn',
  },
  [manualCancelNoticeResultCode('not_card_refunded')]: {
    text: '這張單不是「刷卡而且已經全額退款」,這顆鈕對它沒用。',
    tone: 'warn',
  },
  [manualCancelNoticeResultCode('not_cancelled')]: {
    text: '這張單還沒取消,這顆鈕對它沒用。',
    tone: 'warn',
  },
  // 🔴🔴 **這一句【不可以】說「系統會自己寄」**(codex R3 must-fix ③)——
  //    「沒有人工退款」只推得出「**不是混合軌**」, **推不出「會自動寄」**:
  //    那支 view(`20260905310000:201-211`)還有**另外兩道閘** —— 至少一個信箱非空、
  //    以及手動建單(`manual_phone` 等)要有 `notification_email`。
  //    🔬 反例:`order_source='manual_phone'` + `notification_email IS NULL` 而客人資料有信箱
  //      ⇒ 沒有人工退款 ⇒ 這裡回 `not_mixed_rail`, 而那支 view **照樣排除它**
  //      ⇒ 📌 **客服照這句話等, 而那封信永遠不會寄。**
  [manualCancelNoticeResultCode('not_mixed_rail')]: {
    text:
      '這張單沒有人工退款紀錄,所以不是「混合退款」那一類,這顆鈕不適用。' +
      '⚠️ 而這【不表示】系統一定會自己寄 —— 自動寄還有別的條件(例如單上要有信箱)。' +
      '客人若說沒收到,去看這張單的「通知信」那一區有沒有紀錄;沒有就找工程查。',
    tone: 'warn',
  },
  [manualCancelNoticeResultCode('already_recorded')]: {
    text: '這張單已經有取消通知紀錄了,沒有重複登錄。',
    tone: 'warn',
  },
  // 🔴 這一句**不可以**寫成「不適用」——「讀不到」與「不符合」是兩件事,
  //    而把前者說成後者會讓一張**還在等人**的單看起來像「不用管」。
  [manualCancelNoticeResultCode('unreadable')]: {
    text: '暫時讀不到這張單,等一下再試。什麼都沒寫進去。',
    tone: 'warn',
  },
  [manualCancelNoticeResultCode('audit_failed')]: {
    text: '稽核紀錄寫不進去,所以這一筆【沒有】登錄。請再試一次。',
    tone: 'error',
  },
  [manualCancelNoticeResultCode('write_failed')]: {
    text: '登錄沒成功,再試一次。連續失敗請找工程師。',
    tone: 'error',
  },
  // 🔴 撞鍵不等於成功(codex 關卡1 must-fix ③):**不可以**回報「已登錄」。
  [manualCancelNoticeResultCode('raced')]: {
    text: '剛才有別人同時登錄了這張單,你這次沒寫進去。請重新整理看一下紀錄。',
    tone: 'warn',
  },
});

/**
 * ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B 的【撤銷登錄】結果碼(主視窗 2026-09-06 裁乙)。
 * 🔵 **與上面那組共用同一個前綴家族但各自具名** —— 兩個動作的下一步不一樣,
 *    共用一顆碼會讓「登錄失敗」與「撤銷失敗」給出同一句話。
 * 🔴 **一樣沒有成功碼**(理由同上面那段):`?r=` 偽造得出來,
 *    而一則假的「已撤銷」會讓員工**不再去撤** —— 那張單就停在提醒外面。
 *    ✅ 成功的證據是**看得到的事實**:那顆撤銷鈕消失、登錄鈕回來、寄信紀錄少一列。
 */
export type ManualCancelRevokeFailureCode =
  | 'denied'
  | 'invalid'
  | 'not_found'
  | 'not_manual'
  | 'audit_failed'
  | 'revoke_failed';

export function manualCancelRevokeResultCode(code: ManualCancelRevokeFailureCode): string {
  return `manual_cancel_revoke_${code}`;
}

export const MANUAL_CANCEL_REVOKE_MESSAGES: Readonly<
  Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }>
> = Object.freeze({
  [manualCancelRevokeResultCode('denied')]: {
    text: '你沒有權限,要找管理者。這一次什麼都沒寫進去。',
    tone: 'error',
  },
  [manualCancelRevokeResultCode('invalid')]: {
    text: '表單有欄位沒填,什麼都沒寫進去。',
    tone: 'warn',
  },
  // 🔵 「沒有那一列」不細分「已經被撤掉」與「從來沒登錄過」—— 對下一步是同一件事。
  [manualCancelRevokeResultCode('not_found')]: {
    text: '這張單目前沒有人工登錄的取消通知紀錄(可能已經被撤掉了),沒有撤銷任何東西。',
    tone: 'warn',
  },
  // 🔴🔴 這一句要說清楚**為什麼不准** —— 不然員工會以為是壞掉而一直按。
  [manualCancelRevokeResultCode('not_manual')]: {
    text:
      '這一列是【系統自己寄的】,不是人工登錄的,所以不能撤銷。' +
      // 🔴 codex nit:舊句寫死「撤掉它會讓系統再寄一次」——**那要看那張單現在符不符合自動寄的條件**,
      //    而混合退款的單被那支 view 排除 ⇒ 對它們不成立。改成不講死。
      '⚠️ 撤掉它可能讓那位客人再收到一封通知(要看那張單現在的狀態)。要處理請找工程。',
    tone: 'warn',
  },
  [manualCancelRevokeResultCode('audit_failed')]: {
    text: '稽核紀錄寫不進去,所以這一筆【沒有】撤銷。請再試一次。',
    tone: 'error',
  },
  [manualCancelRevokeResultCode('revoke_failed')]: {
    text: '撤銷沒成功,再試一次。連續失敗請找工程師。',
    tone: 'error',
  },
});

/**
 * ⟦mail-PHONEONLYNOTIFY⟧「已電話通知」(Sean 2026-09-06 拍甲;主視窗裁記法 = 甲)。
 * 🔵 **一樣沒有成功碼**(理由同上面兩組)。成功的證據是**看得到的事實**:
 *    那顆鈕換成一行「已電話通知 · 誰 · 何時」。
 * 🔴 **這個動作沒有撤銷**(稽核 append-only)—— 主視窗裁「接受」:
 *    按錯的後果只是那張單不再被提醒(**不是寄錯信給客人**), 而誰按的稽核留著。
 */
export type ManualCancelPhoneFailureCode = 'denied' | 'invalid' | 'audit_failed' | 'already_marked';

export function manualCancelPhoneResultCode(code: ManualCancelPhoneFailureCode): string {
  return `manual_cancel_phone_${code}`;
}

export const MANUAL_CANCEL_PHONE_MESSAGES: Readonly<
  Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }>
> = Object.freeze({
  [manualCancelPhoneResultCode('denied')]: {
    text: '你沒有權限,要找管理者。這一次什麼都沒寫進去。',
    tone: 'error',
  },
  [manualCancelPhoneResultCode('invalid')]: {
    text: '表單有欄位沒填,什麼都沒寫進去。',
    tone: 'warn',
  },
  [manualCancelPhoneResultCode('audit_failed')]: {
    text: '稽核紀錄寫不進去,所以這一筆【沒有】記錄。請再試一次。',
    tone: 'error',
  },
  [manualCancelPhoneResultCode('already_marked')]: {
    text: '這張單已經標記過「已電話通知」了,沒有重複記錄。',
    tone: 'warn',
  },
});

/**
 * 🔴🔴 **動作名是【契約】, 不是自由字串。**
 * 它同時住在三個地方:①`20260906960000` 那支計數函式的述詞 ②本檔(寫稽核用)
 * ③讀回來顯示那一句。**沒有任何東西會在它們分岔時叫。**
 * ⇒ 📌 分岔的症狀是**安靜的**:計數不會歸零(述詞找不到那筆), 而畫面說「已電話通知」
 *   —— **兩邊各自看起來都正常。**
 * ⇒ ⇒ **所以它在 TS 這側只寫一次**, 由這個常數供給兩個呼叫端。
 */
export const PHONE_NOTIFIED_AUDIT_ACTION = 'email.order_cancelled.phone_notified';
