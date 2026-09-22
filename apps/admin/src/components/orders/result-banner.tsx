// ══ 🔴 2026-09-10:「哪一格不對會標在旁邊」這句話被【整批拿掉】了。不要補回來。 ══════
//
// · 那句是**同一天**由 Sean 批准加進來的(第一批 42 條文案改寫),本檔 `invalid` 是其中一處,
//   第二批又複製到另外 7 支 action-state ⇒ 全樹共 8 處。
// · 🔴 而**當天稍晚查證:那 7 支表單全部沒有逐欄標示** ——
//   員工會照那句話去畫面上找被標起來的那一格,而畫面上沒有。
//   - 到貨那支雖然**有**逐欄標示的機制,而 `lib/orders/receipt-action-state.ts:201`
//     逐字寫著 `invalid: []` ⇒ **這個碼刻意不指向任何欄位。**
//   - 🟢 正對照:同一張表 `:188-194` 有 7 個碼**真的**指到欄位
//     ⇒ `invalid: []` 是一個決定,不是漏寫。
// · ⇒ Sean 看過這份查證之後拍甲:**整批拿掉,而且【不補一句新的】**
//   —— 📌 拿掉假話不是文案題,補一句新的才是。
//
// 🎯 **教訓**:把術語改成白話的時候,很容易順手加一句「幫你想好下一步」的貼心指示,
//    而**那句指示是一個【新的事實主張】,沒有人去驗它**。這一片就是那樣長出來的。
// ═════════════════════════════════════════════════════════════════════════════
// 相對 import(非 @/):#606 前的歷史遺留(見 `lib/session/actor.ts` 註解;#612 更新:#606 起可用 @/,既有不回改)
// ⇒ 用 `@/` 會讓本元件在測試環境解析失敗。
import { LISTING_NOOP_NOTE_DROPPED_RESULT_CODE } from '../../lib/products/product-listing-form';
import {
  NOTE_ADDED_RESULT_CODE,
  NOTE_DELETED_RESULT_CODE,
  NOTE_UPDATED_RESULT_CODE,
} from '../../lib/orders/note-action-state';
import {
  PAYMENT_DUPLICATE_RESULT_CODE,
  PAYMENT_LATE_REFUND_NEW_ORDER_RESULT_CODE,
  PAYMENT_LATE_REFUND_RESULT_CODE,
  PAYMENT_RECORDED_RESULT_CODE,
  PAYMENT_REVIVED_RESULT_CODE,
} from '../../lib/orders/payment-action-state';
import {
  PROCUREMENT_CREATED_RESULT_CODE,
  PROCUREMENT_NO_CHANGE_RESULT_CODE,
  PROCUREMENT_UPDATED_RESULT_CODE,
} from '../../lib/orders/procurement-action-state';
import {
  RECEIPT_DUPLICATE_RESULT_CODE,
  RECEIPT_RECORDED_RESULT_CODE,
} from '../../lib/orders/receipt-action-state';
import { REFUND_SUBMITTED_RESULT_CODE } from '../../lib/payment/refund-action-state';
import { MANUAL_REFUND_SUBMITTED_RESULT_CODE } from '../../lib/payment/manual-refund-action-state';
import { MANUAL_REFUND_VOIDED_RESULT_CODE } from '../../lib/payment/manual-refund-void-action-state';
import {
  REFUND_MARKED_FAILED_RESULT_CODE,
  REFUND_RECOVERED_RESULT_CODE,
} from '../../lib/payment/refund-recovery-state';
import {
  CORRECTION_BUG_RESULT_CODE,
  CORRECTION_DENIED_RESULT_CODE,
  CORRECTION_DONE_RESULT_CODE,
  CORRECTION_DUPLICATE_RESULT_CODE,
  CORRECTION_INVALID_RESULT_CODE,
  CORRECTION_NOT_APPLICABLE_RESULT_CODE,
  CORRECTION_STALE_RESULT_CODE,
} from '../../lib/payment/refund-correction-state';
import {
  FAILURE_MESSAGES as CANCEL_FAILURE_MESSAGES,
  toOrderCancelResultCode,
} from '../../lib/orders/cancel-action-state';
import {
  ORDER_AMOUNT_ERROR_MESSAGE_GENERIC,
  ORDER_AMOUNT_ERROR_RESULT_CODE,
  ORDER_AMOUNT_REJECTED_MESSAGE,
  ORDER_AMOUNT_REJECTED_RESULT_CODE,
} from '../../lib/orders/amount-action-state';

import { manualOrderResultCode } from '@/lib/orders/manual-order-action-state';
import {
  MANUAL_CANCEL_NOTICE_MESSAGES,
  MANUAL_CANCEL_REVOKE_MESSAGES,
  MANUAL_CANCEL_PHONE_MESSAGES,
} from '@/lib/orders/manual-cancel-notice-messages';
import { WALLET_DUPLICATE_RESULT_CODE } from '../../lib/customers/wallet-action-state';
import { ITEM_SWAP_MESSAGES } from '../../lib/orders/item-swap-state';
import { emailChangeResultCode } from '../../lib/customers/email-change-state';

// result-banner.tsx — 改單 PRG 結果提示(M-4a Slice C;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。

// 🔴 **匯出是為了讓「零碰撞」那道守門有判別力**(A13b D1 code-review must-fix):
//    測試原本拿一份**硬寫的既有碼快照**(只有改單線那 7 顆)去比對,而本表實際有 16 顆鍵
//    ⇒ 快照漏掉的那 7 顆(備註 1 + 退款 3 + 採購 3)就算被撞上也照樣綠。改成由測試讀本表的鍵集合、逐顆歸類,
//    **新增任何一顆沒被歸類的碼都會轉紅** —— 那時要做的是去測試裡把它歸到對的線,不是放寬斷言。
export const MESSAGES: Readonly<Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }>> =
  Object.freeze({
  // ── ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B:登錄人工寄出取消通知(12 顆, 全部帶
  //    `manual_cancel_notice_` 前綴;**成功刻意沒有碼**, 理由在那支 messages 檔)────
  ...MANUAL_CANCEL_NOTICE_MESSAGES,
  // ── ⟦b4-CANCELMAILMIXEDRAIL⟧ 撤銷登錄六顆(**成功一樣沒有碼**)────────────
  ...MANUAL_CANCEL_REVOKE_MESSAGES,
  // ── ⟦mail-PHONEONLYNOTIFY⟧ 電話通知四顆(**成功一樣沒有碼**)────────────
  ...MANUAL_CANCEL_PHONE_MESSAGES,
  // 換商品(plan 2026-09-22-admin-order-item-swap-plan.md):結果碼與文字都在 item-swap-state.ts。
  ...ITEM_SWAP_MESSAGES,

  // ── M12-A3-b 手動建單線(`#858`)八顆(沒送到 2 + 送到之後 6) ────────────────────────────────────────
  // 🔴 **全部帶 `manual_order_` 前綴**:`denied` / `invalid` / `error` 這三個字面在本表裡
  //    已經被改單線用掉了,而**兩條線的下一步不一樣** ⇒ 撞號在畫面上長得像「訊息偶爾會不對」。
  // 🔴🔴 **`concurrent` 與 `mismatch` 這兩句必須讓員工做出【相反】的動作**,不得共用、不得互換:
  //    前者「再按一次」是因為那一刻可能已經有人在寫同一顆鍵;
  //    後者「不要重送」是因為那顆鍵已經建過一張單了。
  //    ⇒ 弄反的代價:`mismatch` 唸成「再按一次」= 叫他去撞一顆已經用掉的鍵(永遠不會成功、他會一直按);
  //      `concurrent` 唸成「不要重送」= 他放棄一張其實還沒建成的單。
  //    ⇒ `result-banner.test.tsx` 有一格逐字釘住這兩句不得互換。
  // ⚠️ **這七句都是【固定文案】,不是 RPC 說的原話**(M12-A3 plan Q1=甲,主視窗 2026-08-24 裁)。
  //    RPC 的原文只進 log —— 因為 `?r=` 是任何人都能自己打的字,把它放進 URL
  //    = 讓任何人對員工顯示任意一句「系統說的話」。
  [manualOrderResultCode('denied')]: {
    text: '登入已過期，請重新登入後建立訂單。',
    tone: 'error',
  },
  [manualOrderResultCode('invalid')]: {
    // 🔴 不寫「檢查紅字那幾格」(codex R1 nit):導頁之後表單是重新繪的,**畫面上沒有紅字**
    //    ⇒ 那句話會讓他去找一個不存在的東西。
    text: '訂單尚未建立。請補齊必填欄位後重新送出。',
    tone: 'warn',
  },
  [manualOrderResultCode('concurrent')]: {
    text: '另一位使用者正在建立這張訂單。請在目前表單再次送出，不要重開表單。',
    tone: 'warn',
  },
  [manualOrderResultCode('mismatch')]: {
    // 🔴🔴 **不得叫他直接放棄**(codex R1 must-fix):`?r=` 是任何人都能自己打的字
    //    ⇒ 一句「已經建過了,不要再送」貼在一張其實從沒建成的單上,
    //    會讓他**放棄一張真的還沒建的訂單**。
    //    ⇒ 文案改成叫他**去確認**(那個動作在兩個世界都是對的),而不是叫他停手。
    text: '此編號可能已有訂單，且內容與本次送出不同。請勿直接再次送出，請先到訂單列表查詢：若訂單已存在，請編輯該筆訂單；確認不存在後，才重新開啟空白表單。',
    tone: 'warn',
  },
  [manualOrderResultCode('exhausted')]: {
    text: '暫時無法產生訂單編號，已通知系統維護人員。請稍後再試，勿連續送出。',
    tone: 'error',
  },
  // 🔴 `bug` 這一顆 **第一版漏掉了**(codex R1 must-fix):送到 RPC 之後的失敗有六支,
  //    而我只登錄了五支 ⇒ RPC 已寫入但回傳形狀漂移時,員工會拿到**一張空白表單、零訊息**,
  //    然後很可能換一顆新鍵再建一張。⇒ 「零碰撞」那格數的是鍵集合,數不出「少一顆」。
  [manualOrderResultCode('bug')]: {
    text: '無法確認建單結果，訂單可能已建立。請先到訂單列表查詢該客戶的新訂單；若找不到，請聯絡系統管理員協助確認，勿重複送出。',
    tone: 'error',
  },
  [manualOrderResultCode('rejected')]: {
    text: '訂單尚未建立。請重新整理表單，確認客戶與經手人資料有效後再試。',
    tone: 'error',
  },
  [manualOrderResultCode('error')]: {
    text: '尚未確認訂單是否建立成功。請先到訂單列表查詢該客戶的新訂單；若已存在，請勿再次送出。確認不存在後，可在目前表單再次送出，系統會沿用同一編號以避免重複建單。',
    tone: 'error',
  },
  saved: { text: '已儲存變更。', tone: 'ok' },
  noop: { text: '沒有變更(內容與原本相同)。', tone: 'ok' },
  conflict: { text: '此訂單已被其他人修改，畫面已更新為最新資料。請核對後再儲存。', tone: 'warn' },
  // #954 換等級:確認句上的「從 X」跟資料庫現值不同(別人剛改過)⇒ RPC 回 STALE 零寫入。
  //    刻意不共用 `conflict`:那句講「這張單」,而這裡是一位客人的等級。
  tier_stale: { text: '此客戶的會員等級已被其他人修改，本次變更未儲存。畫面已更新為最新資料，請核對後再修改。', tone: 'warn' },
  invalid: { text: '表單內容不正確，尚未儲存。請檢查填寫內容。', tone: 'warn' },
  // 「老闆:成本」批次寫入(`lib/orders/item-costs-actions.ts`;code 型別在 `item-costs-view.ts` `CostResultCode`)。
  //    RPC 的人話不進網址 ⇒ 這裡把每一種結果講完整;`cost_no_fx` 是「先去設定 › 匯率填」而不是重按。
  cost_saved: { text: '成本已儲存。', tone: 'ok' },
  cost_denied: { text: '僅管理者可修改成本，本次變更未儲存。', tone: 'error' },
  cost_invalid: { text: '成本須為數字，且最多四位小數。這批變更尚未儲存，請修正後再試。', tone: 'warn' },
  cost_no_fx: { text: '此幣別尚未設定匯率，成本未儲存。請先到「設定 › 匯率」完成設定，再回來儲存。', tone: 'warn' },
  cost_rejected: { text: '成本未儲存，部分品項可能已不存在。請重新整理並確認品項。', tone: 'warn' },
  cost_error: { text: '系統異常，成本未儲存。請稍後再試；若持續失敗，請聯絡系統管理員。', tone: 'error' },
  // M-4b-03 B(2026-09-14):員工提「改品項單價」申請(`lib/orders/amount-request-actions.ts`)。RPC 的人話不進網址 ⇒ 這裡講完整。
  amount_request_sent: { text: '申請已送出。管理者核准後才會調整價格；核准前，客戶看到的金額不變。', tone: 'ok' },
  amount_request_denied: { text: '沒有權限或登入過期,申請沒有送出。重新登入再試一次。', tone: 'error' },
  amount_request_invalid: { text: '申請未送出。金額須為整數，並填寫修改原因；若改為 0 元，還須填寫 0 元原因。', tone: 'warn' },
  // 🔴 20260915130000:提申請那支也先擋改價 RPC 的三道硬擋(已收款 / 折扣 / 未稅)⇒ 走同一顆碼, 字要講得到它們。
  amount_request_rejected: { text: '申請未受理。可能已有待審申請、訂單已被修改，或申請金額與目前相同。已收款、有折扣或使用未稅價的訂單，目前也不開放改價。請重新整理並確認。', tone: 'warn' },
  amount_request_error: { text: '系統異常，申請未送出。請稍後再試；若持續失敗，請聯絡系統管理員。', tone: 'error' },
  // M-4b-03 C(2026-09-14):管理者核 / 退(`lib/orders/amount-review-actions.ts`)。
  amount_review_approved: { text: '申請已核准，單價已更新，改價紀錄已登記在你的名下。', tone: 'ok' },
  amount_review_rejected: { text: '申請已退回，金額未變更。員工可在此訂單查看退回原因。', tone: 'ok' },
  amount_review_superseded: { text: '訂單已取消，申請已作廢，金額未變更。', tone: 'warn' },
  // 🔴 20260915130000(跨片審查 confirmed):核准撞「單子在提案後被改過」⇒ RPC 第 2 代自動退回、pending 放掉 ⇒ 員工才提得了新的。
  amount_review_stale: { text: '訂單在申請後曾被修改，因此系統已自動退回申請，未調整價格。請員工重新整理後，依最新訂單內容重新申請。', tone: 'warn' },
  // 🔴 同一支第 2 代:核准撞改價 RPC 的三道業務硬擋 ⇒ 自動退回。跟 stale 不同:這種【重提也提不了】, 所以不叫員工重提。
  amount_review_blocked: { text: '訂單狀態已變更，目前不符合改價條件，例如已收款、有折扣、使用未稅價或有稅額。系統已自動退回申請，價格未變更；詳細原因請查看申請紀錄。', tone: 'warn' },
  amount_review_denied: { text: '僅管理者可核准或退回申請，本次操作未儲存。若你具有管理者權限，請重新登入後再試。', tone: 'error' },
  amount_review_invalid: { text: '表單內容不正確，尚未儲存。退回申請時須填寫理由。', tone: 'warn' },
  // ⛔ ~~(請員工重提)~~ —— 申請還是待審時員工【提不了】(一品項一條待審)⇒ 那句把人指向錯的動作。能結掉它的是這裡的「退回」。
  amount_review_refused: { text: '本次未調整價格。申請可能已被處理、單價與目前相同，或訂單在申請後曾被修改。若申請仍為待審，請按「退回」，員工才能重新申請。', tone: 'warn' },
  amount_review_error: { text: '系統異常，尚未確認處理結果。請重新整理，核對申請狀態與單價後，再決定是否重新操作。若持續異常，請聯絡系統管理員。', tone: 'error' },
  // 🔴 ⟦b4-WALLETDEDUPE⟧ 2026-09-06:同一筆儲值金調整被送了第二次(同一個冪等 token、內容相符)。
  // 🔵 **只有這個碼還走橫幅** —— 它是【成功】語意, 走 PRG redirect。
  //    儲值金的**失敗**訊息不在這張表裡:照 A6 §9 Q1=A, 失敗回傳 state、訊息在表單旁邊
  //    (`wallet-action-state.ts` 的 `WALLET_FAILURE_MESSAGE`)。
  // 🛑 **tone 是 `ok` 不是 `warn`** —— 這不是失敗,也不是員工做錯了什麼:
  //    他做的是「不確定成不成功所以再按一次」,而**系統剛好做對了**(沒有重複扣款)。
  //    ⇒ 📌 唸成警告會讓他以為出事了 ⇒ 去做多餘的補償動作,而那才會真的弄壞帳。
  // 🔴 **R2 nit 8 說這是「未來的坑」, 而它當天就變成【現在的坑】** ——
  //    39d 的鏈跑 `result-banner.test.tsx:443` 紅,逐字 `expected 42 keys, received 43 (+ "duplicate")`:
  //    那道守門要求**每一顆鍵都歸得了線**, 而我加了一顆沒有線的裸碼。
  //    ✅ 已改成帶前綴的 `wallet_duplicate`(常數在 `lib/customers/wallet-action-state.ts`)。
  // ⚠️ 原本的理由留著(它仍然成立):
  //    這張 `MESSAGES` 是 orders / products / customers **共用**的, 而「沒有重複扣款」
  //    是**儲值金專屬**的話。⇒ 📌 哪天別的線也送 `?r=duplicate` 過來, 員工會看到一句
  //    講錢的話, 而他做的事跟錢無關。
  //    🔬 **現在不會**(掃過:目前零個其他來源送這個碼到本表;supplier 那條走
  //      `SettingsResultBanner` + `SUPPLIER_RESULT_MESSAGES`, 不同命名空間)。
  //    ⇒ 🔵 **要加第二個來源之前**, 先照上面 `manual_order_` 那族的做法**加前綴**
  //      (那一族的註解逐字寫著為什麼:同一個字面被兩條線用掉, 而兩條線的下一步不一樣)。
  [WALLET_DUPLICATE_RESULT_CODE]: { text: '這筆已經處理過了,沒有重複扣款。', tone: 'ok' },

  // ── 後台改客人信箱十二顆(Sean 2026-09-08 最終拍 A;code-reviewer + codex 兩輪之後)────
  // 🔴 **全部帶 `customer_email_` 前綴**:`denied` / `invalid` / `not_found` / `error`
  //    這四個字面在本表裡已經被改單線用掉了,而**兩條線的下一步不一樣**
  //    ⇒ 撞號在畫面上長得像「訊息偶爾會不對」(同上面 `manual_order_` 那族的紀律)。
  // 🔴🔴 **這一族裡有三組「必須讓員工做相反動作」的碼, 不得共用語氣、不得互換**
  //    (同本表下面 `error` vs `invoice_blocked` 那條紀律):
  //    ① `half_done`(再按一次會好)vs `half_done_stuck`(永遠不會好, 不要按)
  //    ② `unreadable`(等一下再試) vs `not_eligible`(這種帳號永遠不行)
  //    ③ `error`(暫時性)          vs `taken`(那個位址有主, 重按無用)
  //    ⇒ `result-banner.test.tsx` 有一格逐字釘住這三組不得互換。
  [emailChangeResultCode('saved')]: {
    // 🔵 把【沒有跟著變的東西】講出來:員工的心智模型預設是「改了信箱 = 以後都寄新的」,
    //    而舊訂單的通知信箱是刻意不動的(Sean 明令)⇒ 不講, 他會以為系統漏寄。
    text: '登入信箱已更新。舊訂單仍保留當時的通知信箱。',
    tone: 'ok',
  },
  // 🔴 **與 `saved` 刻意不共用一句話**:信箱真的改了, 而**沒有留下紀錄**。
  //    講成一樣的話, 之後查「是誰改的」會查不到, 而沒有人知道為什麼。
  [emailChangeResultCode('saved_audit_failed')]: {
    text: '信箱已更新，但變更未寫入操作紀錄。請聯絡系統管理員處理；勿再次送出，重送無法補齊紀錄。',
    tone: 'warn',
  },
  // 🔵 後台那一欄本來就是這個值(或別人先寫成了)⇒ 沒有東西再變。
  //    **不講成 `saved`**:員工要看得出「這一發到底有沒有改到東西」。
  [emailChangeResultCode('no_change')]: {
    text: '信箱與目前資料相同，未做變更。',
    tone: 'ok',
  },
  [emailChangeResultCode('denied')]: {
    // 🔵 ⛔ ~~本片原本走管理者閘 ⇒ 這一句要同時涵蓋「登入過期」與「你不是管理者」~~
    //    ⇒ Sean 2026-09-08 拍乙放寬成任何登入員工 ⇒ **「你不是管理者」那一種不存在了**
    //    ⛔ ~~而我第二版寫成「你的登入過期了, 或這個頁面開太久」~~ —— **那是把一個過寬的句子
    //    換成了一個過窄的句子**(codex R 訂正):`authorizeAdminMutation` 回 null 還有別的成因 ——
    //    有效票之下 staff 查詢失敗、帳號被停用、備援登入沒有具名操作者, 都會走到這裡;
    //    而 Origin 不符**與頁面開多久無關**。
    //    ⇒ 📌 **不要替員工猜成因**:說「被擋下來了」+ 一個在每一種成因下都對的下一步。
    text: '系統未允許此次修改。請重新登入後再試；若仍無法修改，請聯絡系統管理員。',
    tone: 'error',
  },
  [emailChangeResultCode('invalid')]: {
    text: '信箱未變更。請填寫有效的 Email，且不可使用系統自動產生的信箱位址。',
    tone: 'warn',
  },
  // 🔴🔴 **這一句與 `unreadable` 必須讓員工做出【相反】的動作**:
  //    這一顆是**永久的**(LINE 登入 / 後台建立 / 用 Google 之類的方式登入)
  //    ⇒ 🔴 **重試永遠是同一個結果。**
  [emailChangeResultCode('not_eligible')]: {
    text: '此客戶的信箱無法在此修改，例如 LINE、Google 登入或後台建立的帳號。請查看表單中的帳號說明，勿重複送出。',
    tone: 'warn',
  },
  // 🔴 與上面那顆相反:這是**現在讀不到**, 不是不能改。
  //    ⚠️ 而導頁之後那一次讀取可能剛好是成功的 ⇒ 畫面上會出現表單而**沒有灰字**
  //    ⇒ 所以這句話自己講完整, 不指望灰字還在。
  [emailChangeResultCode('unreadable')]: {
    text: '帳號登入資料載入失敗，本次未做任何變更。請重新整理後再試；若持續失敗，請聯絡系統管理員。',
    tone: 'warn',
  },
  // 🔴 **不得寫「請稍後再試」** —— 這一顆重試永遠是同一個結果。
  [emailChangeResultCode('taken')]: {
    text: '此 Email 已被另一個帳號使用，信箱未變更。請與客戶確認是否曾以此信箱註冊；若已註冊，請使用原帳號，勿重複送出。',
    tone: 'warn',
  },
  // 🔴🔴 **「不知道成沒成」自己一顆碼 —— 它不可以說成 `error`**(codex R3 must-fix)。
  //    `error` 那句是「請再試一次」, 而那句話暗示【什麼都沒發生】。
  //    這一顆的世界是:請求可能已經到了 Auth 那邊、也可能沒有 ⇒ 盲目重按可能是第二次改。
  //    ⇒ 叫他**去確認**(那個動作在兩個世界都是對的), 不是叫他重按也不是叫他放棄。
  [emailChangeResultCode('auth_unknown')]: {
    // 🔴 **第一個指示必須有判別力**:⛔ ~~「重新整理看上面的 Email 欄」~~ —— 那一欄印的是
    //    `customers.email`, 而這條路上它**從來沒被寫過** ⇒ 改了與沒改都顯示舊值
    //    ⇒ 員工會得到「沒改到」的**錯誤結論**。⇒ 把真的分得出兩個世界的那一句提到最前面。
    // ⚠️ **只有【登得進去】那一半是結論, 另一半不是**(R5 訂正):
    //    登不進去的成因不只「沒改到」—— 密碼打錯、限流、服務異常都會長同一個樣子
    //    ⇒ 🔴 **不得寫「登不進去才需要重做」**, 那是把一個未知講成了結論。
    text: '無法確認信箱修改結果，請勿再次送出。請客戶嘗試以新信箱登入；若登入成功，請聯絡系統管理員同步後台資料。登入失敗也不代表修改失敗，仍須請系統管理員確認後再處理。',
    tone: 'error',
  },
  [emailChangeResultCode('not_found')]: {
    text: '找不到此客戶，可能已被移除。本次未做任何變更。',
    tone: 'warn',
  },
  // 🔴🔴 **改了一半, 而【重按會好】** —— 最可能的成因:`20260908100000` 那支 migration
  //    還沒貼進正式庫 ⇒ `customers.email` 沒有欄級 UPDATE 權 ⇒ 每一次都停在同一個地方。
  //    ⇒ 叫他「再按一次同一個信箱」是對的:Auth 那半冪等, 第二發只補後台這半。
  [emailChangeResultCode('half_done')]: {
    text: '登入信箱已更新，但後台資料尚未同步。請使用同一個信箱再次送出；若仍未同步，請聯絡系統管理員。',
    tone: 'error',
  },
  // 🔴🔴 **與上面那顆相反:改了一半, 而【重按永遠不會好】。**
  //    成因:那個位址被別位客人的資料占著(UNIQUE), 或有人在你送出之後把它改成了第三個值。
  //    ⇒ 叫他重按 = 叫他去撞一顆撞不開的鍵, 或去蓋掉別人剛做的變更。
  [emailChangeResultCode('half_done_stuck')]: {
    text: '登入信箱已更新，但後台資料同步失敗。可能是信箱已被其他客戶使用，或資料同時被修改。請提供客戶資料給系統管理員協助處理，勿再次送出。',
    tone: 'error',
  },
  [emailChangeResultCode('error')]: {
    text: '系統異常，信箱未變更。請再試一次；若持續失敗，請聯絡系統管理員。',
    tone: 'error',
  },
  // 🔴🔴 **這一句與 `error` 那句必須讓員工做出【相反】的動作**(同本表上面 `concurrent` / `mismatch` 那條紀律):
  //    · `error`           ⇒「請稍後再試」= **這是暫時性失敗, 再試會成功**
  //    · `invoice_blocked` ⇒ **不要再試** —— 那張單建單時就決定不開發票, 而那是一個【狀態不變式】
  //      ⇒ 🔴 **它永遠不會成功。**
  //    ⇒ 📌 弄反的代價是可算的:唸成「請稍後再試」⇒ 員工一直按 ⇒
  //      而**他很可能已經在財政部平台開了一張真發票**(那正是這一片要防的事)。
  invoice_blocked: {
    text: '此訂單建立時已選擇不開發票，無法登記發票資料。如需開立，請作廢後重新建單，勿重複送出。',
    tone: 'error',
  },
  // ── 2026-09-13 P2:開立日期三句 ────────────────────────────────────────────────
  // 🔴 字面**逐字**來自規格 `~/pcm-mailbox/0912-後台UX/規格-發票金額月統計-v3.md` §2-a-iii,
  //    Sean 2026-09-13 答甲:**兩段(狀態 + 行動), 不升三段** —— 「日期填錯」只是資料不完整,
  //    不是在擋一個會造成損害的動作 ⇒ 沒有【風險/原因】那一段(照他四條原則的判準)。
  //    🛑 **改任何一個字 = 改他核過的文案 ⇒ 要他點頭**, 不是三綠過了就算。
  // 🔵 第二句的 `{{created}}` 是**訂單成立日(台北 MM/DD)**, 由 `ResultBanner` 的 `detail` 帶進來 ——
  //    它來自頁面已載入的 `detail.createdAt`, **不是 query string**(那是任何人都打得出來的字)。
  //    帶不到就整段括號拿掉, 句子仍成立。
  invoice_date_missing: {
    text: '尚未填寫開立日期，發票資料未儲存。請填入實際開立日期後再送出。',
    tone: 'warn',
  },
  invoice_date_before_order: {
    text: '開立日期早於訂單成立日{{created}}，發票資料未儲存。請核對發票日期，或確認是否選到正確的訂單。',
    tone: 'warn',
  },
  invoice_date_future: {
    text: '開立日期不可晚於今天，發票資料未儲存。若尚未開立發票，請將開立狀態保留為「未開立」。',
    tone: 'warn',
  },
  denied: { text: '權限不足或登入已過期，資料未儲存。請重新登入後再試；若仍失敗，請聯絡系統管理員。', tone: 'error' },
  // M-4b-01 P1(2026-09-14):改品項金額升管理者紅線(amount-actions.ts)。
  'permission-denied': { text: '僅管理者可修改品項金額，本次變更未儲存。若你具有管理者權限，請重新登入後再試。', tone: 'error' },
  not_found: { text: '找不到此筆資料，可能已被刪除。本次未儲存，請重新整理並確認。', tone: 'warn' },
  // 🔴🔴 M-4b ⟦b4-NOVARIANT1⟧ 上架前的確認(Sean 2026-08-31 拍 `Q2=甲`;codex R1 #6 must-fix 補這兩則)。
  //    ⛔ 少了這兩則 ⇒ action 擋下之後**畫面完全靜默** ⇒ 員工看到的是「按了沒反應」,
  //      而且**不知道商品其實沒上架** ⇒ 他會再按幾次, 然後找別的路。
  //    📌 而 CLAUDE.md 記過同一條:**守門紅了沒有出路會被整支刪掉, 存活率取決於有沒有給出路。**
  //    ⇒ 所以這兩則都**說得出下一步**, 而不是只說「失敗了」。
  variant_sku_collision: {
    text: '此商品可能屬於另一項商品的規格，尚未上架。請核對提示內容，勾選「我確認」後再送出；無法確認時，請先保留不上架。',
    tone: 'warn',
  },
  variant_sku_check_unavailable: {
    text: '商品規格資料無法載入，暫時無法上架。請再試一次；若仍失敗，請聯絡系統管理員，勿略過檢查。',
    tone: 'error',
  },
  error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
  // 🔴 M-4b E10 A9d2-1:備註**只有成功**會走 redirect 到這裡 —— 失敗一律回 action state
  //    (Sean 拍板 Q1=A:保留員工打的內容)⇒ 這裡**不該**出現 note 的任何失敗碼。
  //    `APPENDED` 與 `DUPLICATE_REQUEST` **共用這一則**:後者意謂「這個請求已寫入過且經查驗」,
  //    對員工就是同一件事(母 plan v4 §5 F3:顯示成別的會誘發他換一把 token 重送 = 製造重複備註)。
  // 🔴 M-4b #20 上下架線:同狀態再按一次【而且打了備註】—— RPC 走 NO_CHANGE 零寫入
  //    ⇒ **那段字哪裡都沒有**(2026-08-19 拋棄式 PG 實測:稽核表提到那句備註的列數 = 0)。
  //    ⚠️ **刻意不與裸 `noop` 共用一則** —— 共用的話員工會以為他留了紀錄,而世界上沒有。
  [LISTING_NOOP_NOTE_DROPPED_RESULT_CODE]: {
    text: '商品狀態未變更，因此本次填寫的變更原因也未儲存。原因僅會隨實際狀態變更記錄。',
    tone: 'warn',
  },
  [NOTE_ADDED_RESULT_CODE]: { text: '備註已新增。', tone: 'ok' },
  // 🔴🔴 貼板 138:軟刪除。**Sean 2026-09-13 逐字定案:「備註已收起。」**
  //    字面說「收起」而不是「刪掉」—— 列與內容都還在,說「刪掉了」會讓員工以為查不到而放棄去找。
  //    ⚠️ 與那顆鈕旁邊的 `DELETE_KEEPS_RECORD_NOTICE`(「僅收起，不刪除。」)是
  //       **兩句話、兩個位置,刻意不共用** —— 那也是他拍板的一部分:
  //       按之前那句回答「我按下去會怎樣」,本句回答「剛剛發生了什麼」。合成一句會把前者殺掉。
  //    🔵 **「備註已更新」那句留給【改備註】那一片**(放寬連續更正,尚未開工)——
  //       他 2026-09-13 另外定了那一句。兩顆鈕做兩件事,結果訊息共用會讓員工分不出按到哪一顆。
  [NOTE_DELETED_RESULT_CODE]: { text: '備註已收起。', tone: 'ok' },
  // 🔴🔴 **Sean 2026-09-13 逐字定案:「備註已更新」—— 四個字, 【沒有句號】。**
  //    ⚠️ 上面那則「備註已收起。」**有**句號。兩則不一致**是照抄他的字, 不是漏統一**;
  //       看到就想補一個句號的人請先問他, 不要順手改。
  //    🔴 為什麼不與「備註已新增。」共用:員工按的是**兩顆不同的鈕**(新增 / 更正),
  //       而 DB 側兩者都是 append 一列 ⇒ 後端同一件事, 對員工不是。共用的話按更正的人
  //       會以為自己多開了一筆新的, 然後回頭找那筆不存在的重複。
  //    🛑 **本表是 `Record<string, …>`(`:80`)⇒ 少一則 key 型別不會叫、測試也不會叫**,
  //       員工看到的是**一片空白橫幅**, 而他會以為沒寫進去、再寫一次。
  //       ⇒ 新增結果碼時, 這一格是**最容易漏掉的那一格**(碼定義了、action 送了、這裡沒接)。
  [NOTE_UPDATED_RESULT_CODE]: { text: '備註已更新', tone: 'ok' },
  // 🔴 M-3 RW2c:退款也只有成功走 redirect(失敗全回 action state,同備註片 Q1=A 慣例)。
  //    `DUPLICATE_REQUEST`(前次已 confirmed)共用本則 —— 對員工是同一件事。
  //
  // 🏁 **2026-08-14 措辭鐵律換版(Sean 在正式站退了兩筆真錢之後回報)。**
  //    舊鐵律逐字 = 「confirmed = TapPay **受理** ≠ 已入帳(入帳以對帳為準;plan §3 第一列)」。
  //    **它作廢了,而且不是刪掉、是換成下面這條 —— 理由寫在這裡,免得下一個人只看到規則消失:**
  //    ① 本則**只在 `succeeded` 為真時**才被 redirect 帶出來(`refund-actions.ts:438`),
  //       而 `succeeded` 全檔只有兩處賦值(`grep -n succeeded`):`:285`(`DUPLICATE_REQUEST`
  //       且 `rowStatus === 'confirmed'`)與 `:371`(accepted → finalize `FINALIZED`)
  //       ⇒ **兩處都落在 `confirmed`**,沒有第三條路徑會看到這則。
  //    ② `supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:337-339` 的
  //       UPDATE 守門**本體**:`IF NEW.status = 'confirmed' AND NEW.tappay_refund_id IS NULL THEN RAISE`
  //       (`ERRCODE = 'P7C09'`、constraint `a7c_confirm_requires_tappay_refund_id`)
  //       ⇒ **能走到 `confirmed` 的列必然帶著 TapPay 退款憑證**。這是**結構保證**,
  //       不是「Sean 那兩筆剛好同步拿到憑證」的歸納。
  //       ⚠️ 同檔 `:365` 的 COMMENT 只是這道守門的**描述**(「④結案必須帶 `tappay_refund_id`」)——
  //          承重要引本體、不要引描述:COMMENT 改掉不會讓任何東西紅,守門本體改掉才會。
  //    ⇒ 此刻「錢退了」不是待確認的事,我們有憑證。**把已知寫成未知,員工會以為還要再追一次。**
  //
  // 🔴 **新鐵律**:`confirmed` = 退款**成立**,講「完成」是準確的;
  //    但**入帳時間不准寫死鐘點** —— 依各家銀行而定,寫死一個時間就是對員工說謊。
  // ⚠️ **只換 `confirmed` 這一態**:`processing` 的「已受理」仍然準確
  //    (`refund-ledger-view.ts:12`),**一個字都不要動**。整批換掉會製造反向的錯 ——
  //    把不確定的講成確定的,那比原本這個 bug 嚴重。
  [REFUND_SUBMITTED_RESULT_CODE]: {
    text: '退款完成。客人入帳時間依照各家銀行而定。',
    tone: 'ok',
  },
  // M-4b E10 D3:非卡退款登記(現金/匯款)——**只有成功走 redirect**(失敗回 action state、
  // 保留輸入)。文案刻意不說「退款完成」:錢是人交回去的,系統只是記一筆帳,同族措辭鐵律
  // 見 manual-refund-ledger-section.tsx 檔頭。
  [MANUAL_REFUND_SUBMITTED_RESULT_CODE]: {
    text: '退款登記已儲存。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 D3-c:非卡退款【作廢】(Fable R2 F3 —— 第一版漏了這顆碼)。
  //    漏掉的後果不是「少一句話」:returnTo 落在 /orders 列表時橫幅回 null,而帳本列不在那一頁
  //    ⇒ **成功之後零回饋**,而那正是 manual-refund-ledger-section.tsx 檔頭自陳要治的病
  //    (「員工按了之後沒有任何地方能確認他按成功了」)。登記那半有碼、作廢這半沒有 = 兄弟片漂移。
  // 🔴 文案要把【後果】講出來,不是只講「成功了」——理由同 manual-refund-void-button.tsx 的
  //    那段 F1 註解:作廢會把金額加回可退餘額,而按的人的心智模型預設是反的。
  [MANUAL_REFUND_VOIDED_RESULT_CODE]: {
    text: '退款登記已作廢，金額已加回此訂單的可退餘額。此操作只更正紀錄，不會收回已退給客戶的款項。',
    tone: 'ok',
  },
  // 🔴 M-3 RW4:人工結案兩碼(同樣只有成功走 redirect;失敗全回 action state)。
  //    兩碼刻意不共用 —— 「錢沒動、已作廢」與「錢已退、登記完成」是相反的事實。
  [REFUND_MARKED_FAILED_RESULT_CODE]: {
    text: '已標記失敗結案:對帳確認這筆退款的錢沒有動。若仍需退款,請回訂單頁重新發起。',
    tone: 'ok',
  },
  [REFUND_RECOVERED_RESULT_CODE]: {
    text: '已恢復結案:這筆退款以 Portal 退款編號登記為完成,訂單付款狀態已同步。',
    tone: 'ok',
  },
  // 🔴 `#890` 人工判定更正(片2c)。**只有成功走 redirect,失敗全回 action state** ——
  //    而失敗那幾碼**也登錄在這裡**,理由見下面 `correction_bug` 那一則。
  //    🔴🔴 全部帶 `correction_` 前綴:`denied` / `invalid` 這兩個字面已被改單線用掉,
  //         而**兩條線的下一步不一樣** ⇒ 撞號在畫面上長得像「訊息偶爾會不對」。
  [CORRECTION_DONE_RESULT_CODE]: {
    text: '退款判定已更正。系統保留原判定紀錄，並以本次更正作為目前判定。',
    tone: 'ok',
  },
  // ⚠️ 這一則**不是**成功的另一種說法:員工按了兩次,而系統只做了一次。
  //    不告訴他 ⇒ 他會以為兩次都寫進去了。
  [CORRECTION_DUPLICATE_RESULT_CODE]: {
    text: '此筆更正已送出過，系統未重複登記。畫面已顯示目前結果。',
    tone: 'warn',
  },
  // 🔴🔴 **這一則與 `correction_bug` 必須讓員工做出【相反】的動作,不得共用、不得互換**:
  //    這裡「重看一次再決定」是因為**有人真的在你之前改過**,現況已經不是你按下去時看到的那個;
  //    而 bug 那則要他**停手找工程師** —— 再按幾次都一樣。
  [CORRECTION_STALE_RESULT_CODE]: {
    text: '此筆判定已被其他人修改，本次未儲存。請重新整理並核對目前判定，再決定是否修改。',
    tone: 'warn',
  },
  [CORRECTION_NOT_APPLICABLE_RESULT_CODE]: {
    text: '此筆退款不屬於「人工判定失敗」，無法在此更正。',
    tone: 'warn',
  },
  [CORRECTION_INVALID_RESULT_CODE]: {
    text: '內容不符合要求，尚未送出。請填寫理由，不可只有空白，且不得超過 500 字。',
    tone: 'warn',
  },
  [CORRECTION_DENIED_RESULT_CODE]: {
    text: '沒有權限做這個動作。',
    tone: 'error',
  },
  // 🔴 **不得寫「請稍後再試」** —— 這一族是我們這一側出事,重試不會好。
  //    寫成可重試 ⇒ 員工會對著一個 bug 一直按,而每一次都拿到同一句話。
  [CORRECTION_BUG_RESULT_CODE]: {
    text: '系統異常，本次更正未儲存。請勿重試，並聯絡系統管理員處理。',
    tone: 'error',
  },
  // 🔴 M-4b E10 A10b:採購同樣**只有成功**會走 redirect(失敗回 action state、保留輸入)。
  //    三個成功碼**刻意不共用一則** —— 員工要看得出「這次到底有沒有改到東西」:
  //    `NO_CHANGE` 意謂「送出的內容與現況完全相同、零寫入」(A5a `:300-322`),
  //    若與「已更新」說同一句話,他會以為改成功了而不再檢查。
  [PROCUREMENT_CREATED_RESULT_CODE]: { text: '採購紀錄已新增。', tone: 'ok' },
  [PROCUREMENT_UPDATED_RESULT_CODE]: { text: '採購紀錄已更新。', tone: 'ok' },
  [PROCUREMENT_NO_CHANGE_RESULT_CODE]: {
    text: '內容與目前的採購紀錄相同，未做變更。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 **#352-b**:到貨登錄同樣只有成功走 redirect(失敗回 action state、保留輸入)。
  //    🔴 **括號那半句不是贅字**:本片主打的出路是「到貨 0 件 / 溢收 N 件」(取消後到貨),
  //    那種登錄**不會讓採購列的「到貨」欄動一格** ⇒ 只寫「已登錄」的話,員工按完看到數字沒變,
  //    會以為沒成功而再按一次。一句話把「為什麼看起來沒變」講掉。
  [RECEIPT_RECORDED_RESULT_CODE]: {
    text: '到貨已登記，超出訂購數量的件數不計入「到貨」欄。',
    tone: 'ok',
  },
  //    `DUPLICATE_REQUEST` **只有在產物仍在時**才走到這裡 —— 產物已被刪的那條回 action state
  //    的 `DUPLICATE_DELETED`(RPC 不重新建立 ⇒ 顯示成功會是謊)。兩者刻意不共用一則。
  [RECEIPT_DUPLICATE_RESULT_CODE]: {
    text: '此筆到貨已登記過，系統未重複登記。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 **#15-B2-c 片2**:手動收款登錄同樣只有成功走 redirect(失敗回 action state)。
  //    **兩碼刻意不共用一則**(主視窗裁 Q-D6=A):「剛記好」與「先前已登錄過」是不同事實,
  //    講成同一句會讓員工分不出這次到底有沒有真的寫進去。
  //    🔴 **不加回讀核對**(對照 `order_cancelled` 那段的立場):偽造 `?r=` 的綠字會被**同一張卡**
  //    下面的真實收款明細當場打臉(H6② 保證兩者同掛)—— 取消線當年沒有那個對照物,這裡有。
  [PAYMENT_RECORDED_RESULT_CODE]: { text: '收款已登記。', tone: 'ok' },
  [PAYMENT_DUPLICATE_RESULT_CODE]: {
    text: '此筆收款已登記過，系統未重複入帳。',
    tone: 'ok',
  },
  // 🔴 稽核 P0-2:逾期自動取消的匯款單補登記。三句刻意分開 —— 「單恢復了」與「單維持取消、錢排了退款」是相反的兩件事。
  //    付款狀態不寫死「已付款」:少付是部分付款、多付不翻狀態(plan §5.2)。
  [PAYMENT_REVIVED_RESULT_CODE]: {
    text: '收款已登記，原本因逾期而取消的訂單已恢復。付款狀態依實收金額判定。',
    tone: 'ok',
  },
  [PAYMENT_LATE_REFUND_RESULT_CODE]: {
    text: '收款已登記。因匯款日期超過付款期限，訂單維持取消，並已建立待退款紀錄。',
    tone: 'warn',
  },
  [PAYMENT_LATE_REFUND_NEW_ORDER_RESULT_CODE]: {
    text: '收款已登記。因客戶在付款期限後另建新訂單，此訂單維持取消，並已建立待退款紀錄，請確認後續退款方式。',
    tone: 'warn',
  },
  // 🔴 M-4b E10 **A13b D1**:取消線改走 PRG 整頁化 ⇒ 這是它第一次有結果提示。
  //    **失敗碼**一律 namespaced(`order_cancel_*`):`?r=` 是本頁唯一共用的參數,而上面
  //    `invalid`/`denied`/`error`/`not_found` 已被改單線佔走 —— 取消線送裸 `invalid`
  //    會讓員工看到改單的「未儲存」。實算:六顆裸碼裡真正會撞的是 `denied`/`invalid`/`error` **三顆**。
  //
  //    🔴🔴 **成功碼 `order_cancelled` 刻意不在這張表裡**(D1 關卡2 must-fix,推翻我第一版):
  //    第一版把它登錄成一則靜態綠色「取消已完成。」,而 `?r=` 是**任何人都能自己打的字**
  //    ⇒ 對一張根本沒被取消的單(甚至在訂單列表頁、退款異常頁)貼上 `?r=order_cancelled`,
  //    畫面就會說「取消已完成」。**錯的方向是危險的那一邊**:員工看到綠字就不會再去取消它。
  //    ⓘ 對照:下面 A 類兩碼被偽造時說的是「取消**沒有**送出」—— 錯的方向是**比較不危險**的那一邊
  //    (它讓人多做一次,而不是漏做)。
  //    🔴 **但不是無害**(關卡2 R2 打掉我上一版寫的「重送會被冪等鍵吸收」——那句是錯的):
  //    重新渲染會拿到**一把新的 token** ⇒ 新的 payload_hash ⇒ **部分取消在剩餘量足夠時會真的再扣一次**。
  //    這與 plan §6-5 記的是同一個殘餘風險(backlog #353),不是這裡多出來的新洞,
  //    但**不准**再寫成「被冪等吸收」。
  //    ⇒ 成功訊息移交 **D5**:那片有 `?rt=` 對取消帳本的核對,說得出「真的寫進去了」才顯示。
  //    在 D5 落地之前,取消成功後畫面上沒有提示 —— 與 D1 之前相同,**不是回歸**。
  //
  //    ⓘ 下面兩顆用 computed key(`toOrderCancelResultCode(...)`)⇒ **全樹 grep `order_cancel_denied`
  //    在本檔找不到字面**;這是刻意的(單一真相 > 好 grep),要找請 grep 那支函式。
  // 🔴 **只收「沒送到 RPC」那兩支**(`CANCEL_NOT_SENT_CODES`)。已送到 RPC 的四支
  //    (`rejected`/`retry`/`bug`/`error`)**刻意不在這張表裡** —— 它們要的不是一則靜態文案,
  //    而是拿 `?rt=` 去取消帳本核對「到底寫進去了沒有」(plan v3.1 §1c,D5 的面板)。
  //    誤把它們加進來 = 員工看到一句安心的話、卻錯過那道核對 ⇒ 測試對這件事有**反向斷言**。
  // 🔴 文案逐字沿用 `cancel-action-state.ts` 的 `FAILURE_MESSAGES`,不在這裡另寫一份。
  [toOrderCancelResultCode('denied')]: { text: CANCEL_FAILURE_MESSAGES.denied, tone: 'error' },
  [toOrderCancelResultCode('invalid')]: { text: CANCEL_FAILURE_MESSAGES.invalid, tone: 'warn' },
  [toOrderCancelResultCode('invalid_reason')]: { text: CANCEL_FAILURE_MESSAGES.invalid_reason, tone: 'warn' },
  [toOrderCancelResultCode('invalid_reason_detail')]: { text: CANCEL_FAILURE_MESSAGES.invalid_reason_detail, tone: 'warn' },
  [toOrderCancelResultCode('invalid_quantity')]: { text: CANCEL_FAILURE_MESSAGES.invalid_quantity, tone: 'warn' },
  // 🔴🔴 **`shipment_unconfirmed`(取消已出貨的單, 2026-09-03)——【差一點漏登錄】。**
  //    那顆碼加進了 `cancel-action-state.ts` 的 `FAILURE_MESSAGES` 與 `CANCEL_NOT_SENT_CODES`,
  //    **而沒有加到這張表** ⇒ server 擋下來、導頁帶著那顆碼回來, 而 banner 查不到它
  //    ⇒ 🛑 **員工看到的是一片空白** —— 他按了取消, 什麼都沒發生, 而畫面一句話都沒有。
  //    ⇒ 📌 那正是「擋住了人而沒有告訴他下一步」的最壞形狀:**連「被擋住」都沒說。**
  //    🟢 而抓到它的是 `result-banner.test.tsx` 那格逐碼掃 `CANCEL_NOT_SENT_CODES` 的斷言
  //       —— 它逐字寫著「先釘【有註冊】:少了這句, 碼被拿掉時 `entry?.tone` 是 undefined、
  //       `not.toBe('ok')` 照樣綠」。**那一格今天真的接住了東西。**
  //    🔵 tone 用 `warn` 不是 `error`:這不是系統故障, 是**要他確認一次**;
  //       而 `error` 的紅框會讓他以為出事了。🛑 而它**不得是 `ok`** —— 失敗不准畫成綠色。
  [toOrderCancelResultCode('shipment_unconfirmed')]: {
    text: CANCEL_FAILURE_MESSAGES.shipment_unconfirmed,
    tone: 'warn',
  },
  // 🔴 M-4b E10 **#13 片1c-2**:改金額線**只登錄這一顆失敗碼**。
  //    ⚠️ 它的成功/無變更/衝突走**裸碼**(`saved`/`noop`/`conflict`)—— 那三則文案對改金額剛好也對,
  //    為整齊多造三顆是純成本;`invalid`/`denied` 同理(而且它們導去 `/orders`,
  //    namespace 了卻沒登錄反而讓員工什麼都看不到)。**理由全文在 `amount-action-state.ts` 檔頭。**
  //    🔴 文案逐字沿用該檔的 `ORDER_AMOUNT_ERROR_MESSAGE`,**不在這裡另寫一份**(同取消線的做法)。
  //    🔴🔴 而那句話**刻意不說是哪一條**:七條業務拒絕共用同一個 `P2C13`,
  //    要分得開得拿到拒絕的名字。🔴 **`#518`(2026-08-16)之後拿得到了**(RPC 送 `DETAIL`),
  //    但**文案仍然刻意不說是哪一條** —— 那是另一個決定,本片沒做。
  //    ⇒ 它涵蓋七條全部,因為它不宣稱是哪一條。**不得改成含具體判定的版本。**
  //    🔴 **兩顆,不是一顆**(codex R1 must-fix):`_rejected` = 業務拒絕
  //    (`#518` 之後 = `code === 'P2C13'` **且** `details` 在白名單七條內)、
  //    `_error` = 其餘一切(含 DB 斷線 / timeout)。把兩者塞同一顆會**把系統故障說成訂單狀態問題**。
  [ORDER_AMOUNT_REJECTED_RESULT_CODE]: { text: ORDER_AMOUNT_REJECTED_MESSAGE, tone: 'error' },
  [ORDER_AMOUNT_ERROR_RESULT_CODE]: { text: ORDER_AMOUNT_ERROR_MESSAGE_GENERIC, tone: 'error' },
  // 🔴 `Object.freeze`(關卡2 R2):本表 D1 起被匯出給測試讀鍵集合,凍住才擋得掉
  //    「某個正式模組 import 後偷加一顆碼」——那條路測試抓不到(測試不會載入那個模組)。
  //    ⚠️ **誠實界線:這是淺 freeze** —— 擋得住「加/刪一顆碼」,擋**不住** `MESSAGES.saved.text = '…'`
  //    這種改內層物件的寫法。要擋那個得逐顆 freeze;目前 repo 零 mutator,不先付這個複雜度。
});

const TONE = {
  ok: 'border-green-500/30 bg-green-500/5 text-green-700',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
} as const;

/**
 * 🔵 2026-09-13 P2:`detail` 是**可選**的補充資料 —— 只有訂單明細那一頁有東西可給。
 *    `orderCreatedMmDd` 要是 `MM/DD` 形狀;不是就當沒給(不渲染括號), **不會**把任意字串印出來。
 *    📌 五頁既有呼叫端零改動(參數可選)。
 */
export function ResultBanner({
  code,
  detail,
}: {
  code: string | undefined;
  detail?: { orderCreatedMmDd?: string | null };
}) {
  if (!code) return null;
  // 🔴 **守門形狀必須是 `Object.hasOwn`,不得退回裸索引 `MESSAGES[code]`**(#332-2,Sean 2026-08-02
  //    拍板 B 退回過一次、2026-08-06 拍板 Q1=A 修回來):`code` 來自頁面的 `searchParams.r`,
  //    是**任意字串**。裸索引時 `MESSAGES['__proto__']` / `['constructor']` / `['toString']` /
  //    `['valueOf']` / `['hasOwnProperty']` 取到的是**原型鏈上的屬性**且為 truthy
  //    ⇒ 下一行的 `if (!msg)` 這道守門形同虛設 ⇒ 畫出一個 `class="… undefined"` 的空框。
  //    無注入風險(`msg.text` 是 undefined ⇒ React 不渲染任何文字),但那是
  //    「守門的名字大於它的實際能力」——`if (!msg)` 承諾擋掉所有非自有 key,實際擋不掉最好猜的那五個。
  //    ⇒ 回歸測試釘在 `result-banner.test.tsx`(五個向量逐字入測);姊妹元件
  //    `settings/settings-result-banner.tsx` 同形、測試在 `settings-result-banner.test.tsx`。
  //    背景與爆炸半徑(本元件 **5 頁**〔#365 加了 `app/customers/page.tsx`〕+ 姊妹元件 2 頁 = **7 頁**)見
  //    `docs/specs/2026-08-06-result-banner-cleanup-plan.md`。
  const msg = Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined;
  if (!msg) return null;
  // 🔴 佔位詞只認 `MM/DD`(兩位/兩位)—— 這把尺刻意窄:通過的字最多 5 個、全是數字與斜線。
  const mmdd = detail?.orderCreatedMmDd;
  const created = typeof mmdd === 'string' && /^\d{2}\/\d{2}$/.test(mmdd) ? `(${mmdd})` : '';
  const text = msg.text.replace('{{created}}', created);
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {text}
    </div>
  );
}
