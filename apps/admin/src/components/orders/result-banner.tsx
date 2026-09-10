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
import { NOTE_ADDED_RESULT_CODE } from '../../lib/orders/note-action-state';
import {
  PAYMENT_DUPLICATE_RESULT_CODE,
  PAYMENT_RECORDED_RESULT_CODE,
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
    text: '登入過期了。重新登入之後再建一次。',
    tone: 'error',
  },
  [manualOrderResultCode('invalid')]: {
    // 🔴 不寫「檢查紅字那幾格」(codex R1 nit):導頁之後表單是重新繪的,**畫面上沒有紅字**
    //    ⇒ 那句話會讓他去找一個不存在的東西。
    text: '表單有欄位沒填,單沒建出來。請補齊每一格再送一次。',
    tone: 'warn',
  },
  [manualOrderResultCode('concurrent')]: {
    text: '有另一個人同時在送這張單。請【再按一次送出】——不要重開表單。',
    tone: 'warn',
  },
  [manualOrderResultCode('mismatch')]: {
    // 🔴🔴 **不得叫他直接放棄**(codex R1 must-fix):`?r=` 是任何人都能自己打的字
    //    ⇒ 一句「已經建過了,不要再送」貼在一張其實從沒建成的單上,
    //    會讓他**放棄一張真的還沒建的訂單**。
    //    ⇒ 文案改成叫他**去確認**(那個動作在兩個世界都是對的),而不是叫他停手。
    text: '這個編號可能已經建過一張單了,而內容不一樣。【先不要再按送出】——請去訂單列表找一下這位客人的單:有,就去那張單上改;沒有,再重開一張空白表單。',
    tone: 'warn',
  },
  [manualOrderResultCode('exhausted')]: {
    text: '系統排不出單號,已通知維護。等一下再試,不要連按。',
    tone: 'error',
  },
  // 🔴 `bug` 這一顆 **第一版漏掉了**(codex R1 must-fix):送到 RPC 之後的失敗有六支,
  //    而我只登錄了五支 ⇒ RPC 已寫入但回傳形狀漂移時,員工會拿到**一張空白表單、零訊息**,
  //    然後很可能換一顆新鍵再建一張。⇒ 「零碰撞」那格數的是鍵集合,數不出「少一顆」。
  [manualOrderResultCode('bug')]: {
    text: '這張單送出去之後系統回了看不懂的東西,它可能已經建好了。請先去訂單列表找一下這位客人的新單:有就不要再按;沒有請找人看一下,不要重複送。',
    tone: 'error',
  },
  [manualOrderResultCode('rejected')]: {
    text: '這張單沒建出來。請重新整理表單,確認客人與經手人都還在,再試一次。',
    tone: 'error',
  },
  [manualOrderResultCode('error')]: {
    text: '建單可能已經寫進去了,也可能沒有。請先去訂單列表找一下這位客人的新單:有就不要再按;沒有再送一次(編號不變,不會建成兩張)。',
    tone: 'error',
  },
  saved: { text: '已儲存變更。', tone: 'ok' },
  noop: { text: '沒有變更(內容與原本相同)。', tone: 'ok' },
  conflict: { text: '你在改的時候,這張單被別人改過了。畫面已經換成最新的,確認後再存一次。', tone: 'warn' },
  invalid: { text: '表單有地方不對,沒有存進去。', tone: 'warn' },
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
    text: '已改好登入信箱。舊訂單上的通知信箱不會跟著變(那是當時的紀錄)。',
    tone: 'ok',
  },
  // 🔴 **與 `saved` 刻意不共用一句話**:信箱真的改了, 而**沒有留下紀錄**。
  //    講成一樣的話, 之後查「是誰改的」會查不到, 而沒有人知道為什麼。
  [emailChangeResultCode('saved_audit_failed')]: {
    text: '信箱已經改好了,但是這次的變更【沒有寫進稽核紀錄】。請告訴工程師這件事 —— 不要重按(重按不會補上紀錄)。',
    tone: 'warn',
  },
  // 🔵 後台那一欄本來就是這個值(或別人先寫成了)⇒ 沒有東西再變。
  //    **不講成 `saved`**:員工要看得出「這一發到底有沒有改到東西」。
  [emailChangeResultCode('no_change')]: {
    text: '後台這一欄本來就是這個信箱,沒有再改一次。',
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
    text: '改不了 —— 系統沒有讓這個動作通過。請先重新登入再試一次;還是不行請找管理者或工程師(不是你填錯東西)。',
    tone: 'error',
  },
  [emailChangeResultCode('invalid')]: {
    text: '沒有改到 —— 新的 Email 看起來不合格式(也不能用系統自己產的位址)。請重新打一次。',
    tone: 'warn',
  },
  // 🔴🔴 **這一句與 `unreadable` 必須讓員工做出【相反】的動作**:
  //    這一顆是**永久的**(LINE 登入 / 後台建立 / 用 Google 之類的方式登入)
  //    ⇒ 🔴 **重試永遠是同一個結果。**
  [emailChangeResultCode('not_eligible')]: {
    text: '這個客人的信箱不能從這裡改(LINE 登入、後台建立、或他是用 Google 之類的方式登入)。畫面上那一段灰字寫了是哪一種;先不要重試。',
    tone: 'warn',
  },
  // 🔴 與上面那顆相反:這是**現在讀不到**, 不是不能改。
  //    ⚠️ 而導頁之後那一次讀取可能剛好是成功的 ⇒ 畫面上會出現表單而**沒有灰字**
  //    ⇒ 所以這句話自己講完整, 不指望灰字還在。
  [emailChangeResultCode('unreadable')]: {
    text: '現在讀不到這個帳號的登入資料,所以這一發沒有動任何東西 —— 這不代表不能改。請重新整理再按一次;一直這樣請找工程師。',
    tone: 'warn',
  },
  // 🔴 **不得寫「請稍後再試」** —— 這一顆重試永遠是同一個結果。
  [emailChangeResultCode('taken')]: {
    text: '這個 Email 已經有另一個帳號在用了,所以沒有改。請先跟客人確認他是不是早就用這個信箱註冊過;是的話請用那個帳號,不要重試。',
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
    text: '這一發送出去之後系統回了看不懂的東西 ——【先不要再按】。客人的登入信箱可能已經改了,也可能沒有。請客人用【新信箱】試著登入一次:登得進去就是已經改好了(這時請找工程師把後台這一欄補上)。登不進去【不代表沒改到】(可能只是密碼錯或系統忙)—— 那一種請直接找工程師,不要自己再改一次。',
    tone: 'error',
  },
  [emailChangeResultCode('not_found')]: {
    text: '找不到這位客人(可能剛被移除),沒有改到任何東西。',
    tone: 'warn',
  },
  // 🔴🔴 **改了一半, 而【重按會好】** —— 最可能的成因:`20260908100000` 那支 migration
  //    還沒貼進正式庫 ⇒ `customers.email` 沒有欄級 UPDATE 權 ⇒ 每一次都停在同一個地方。
  //    ⇒ 叫他「再按一次同一個信箱」是對的:Auth 那半冪等, 第二發只補後台這半。
  [emailChangeResultCode('half_done')]: {
    text: '客人的【登入信箱已經改好了】,但是後台這一欄還沒跟上。請用同一個信箱再按一次;還是不行請找工程師(可能是資料庫權限還沒開)。',
    tone: 'error',
  },
  // 🔴🔴 **與上面那顆相反:改了一半, 而【重按永遠不會好】。**
  //    成因:那個位址被別位客人的資料占著(UNIQUE), 或有人在你送出之後把它改成了第三個值。
  //    ⇒ 叫他重按 = 叫他去撞一顆撞不開的鍵, 或去蓋掉別人剛做的變更。
  [emailChangeResultCode('half_done_stuck')]: {
    text: '客人的【登入信箱已經改好了】,而後台這一欄卡住了 ——【不要再按】。可能是這個信箱被另一位客人的資料占著,或者有人剛剛也改過同一位客人。請找工程師處理,並告訴他是哪一位客人。',
    tone: 'error',
  },
  [emailChangeResultCode('error')]: {
    text: '改不了,而這不是你打錯 —— 系統這一側出了問題。請再試一次;連續失敗請找工程師。',
    tone: 'error',
  },
  // 🔴🔴 **這一句與 `error` 那句必須讓員工做出【相反】的動作**(同本表上面 `concurrent` / `mismatch` 那條紀律):
  //    · `error`           ⇒「請稍後再試」= **這是暫時性失敗, 再試會成功**
  //    · `invoice_blocked` ⇒ **不要再試** —— 那張單建單時就決定不開發票, 而那是一個【狀態不變式】
  //      ⇒ 🔴 **它永遠不會成功。**
  //    ⇒ 📌 弄反的代價是可算的:唸成「請稍後再試」⇒ 員工一直按 ⇒
  //      而**他很可能已經在財政部平台開了一張真發票**(那正是這一片要防的事)。
  invoice_blocked: {
    text: '這張單建單時決定不開發票,所以不能填發票資料。要開請作廢重開;先不要重試。',
    tone: 'error',
  },
  denied: { text: '沒存進去 —— 可能沒有權限,也可能登入過期了。先重新登入試一次;還是不行請找管理者。', tone: 'error' },
  not_found: { text: '找不到這筆資料(可能剛被刪掉),沒有存進去。請重新整理看它還在不在。', tone: 'warn' },
  // 🔴🔴 M-4b ⟦b4-NOVARIANT1⟧ 上架前的確認(Sean 2026-08-31 拍 `Q2=甲`;codex R1 #6 must-fix 補這兩則)。
  //    ⛔ 少了這兩則 ⇒ action 擋下之後**畫面完全靜默** ⇒ 員工看到的是「按了沒反應」,
  //      而且**不知道商品其實沒上架** ⇒ 他會再按幾次, 然後找別的路。
  //    📌 而 CLAUDE.md 記過同一條:**守門紅了沒有出路會被整支刪掉, 存活率取決於有沒有給出路。**
  //    ⇒ 所以這兩則都**說得出下一步**, 而不是只說「失敗了」。
  variant_sku_collision: {
    text: '沒有上架 —— 這支商品看起來是另一支商品的一個規格。請在上面那句話旁邊勾「我確認」再按一次;不確定的話先不要上架。',
    tone: 'warn',
  },
  variant_sku_check_unavailable: {
    text: '沒有上架 —— 現在查不到這支商品的規格資料,所以不敢讓它上架。請再按一次;還是不行就找人看一下,不要繞過去。',
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
    text: '這件商品本來就是這個狀態,沒有變更。⚠️ 你打的變更原因【沒有被記錄】——原因只會跟著真正的變更一起存。',
    tone: 'warn',
  },
  [NOTE_ADDED_RESULT_CODE]: { text: '備註加好了。', tone: 'ok' },
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
    text: '退款登記好了。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 D3-c:非卡退款【作廢】(Fable R2 F3 —— 第一版漏了這顆碼)。
  //    漏掉的後果不是「少一句話」:returnTo 落在 /orders 列表時橫幅回 null,而帳本列不在那一頁
  //    ⇒ **成功之後零回饋**,而那正是 manual-refund-ledger-section.tsx 檔頭自陳要治的病
  //    (「員工按了之後沒有任何地方能確認他按成功了」)。登記那半有碼、作廢這半沒有 = 兄弟片漂移。
  // 🔴 文案要把【後果】講出來,不是只講「成功了」——理由同 manual-refund-void-button.tsx 的
  //    那段 F1 註解:作廢會把金額加回可退餘額,而按的人的心智模型預設是反的。
  [MANUAL_REFUND_VOIDED_RESULT_CODE]: {
    text: '已作廢這筆退款登記。這筆金額已回到這張單的可退餘額 —— 系統會當作它從來沒退過。',
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
    text: '已更正這筆退款的人工判定。舊的判定紀錄留著(它是「我們曾經判錯」的證據),而現在生效的是新的這一筆。',
    tone: 'ok',
  },
  // ⚠️ 這一則**不是**成功的另一種說法:員工按了兩次,而系統只做了一次。
  //    不告訴他 ⇒ 他會以為兩次都寫進去了。
  [CORRECTION_DUPLICATE_RESULT_CODE]: {
    text: '這一筆更正剛剛已經送出過了,系統沒有重複寫入。畫面上顯示的就是現況。',
    tone: 'warn',
  },
  // 🔴🔴 **這一則與 `correction_bug` 必須讓員工做出【相反】的動作,不得共用、不得互換**:
  //    這裡「重看一次再決定」是因為**有人真的在你之前改過**,現況已經不是你按下去時看到的那個;
  //    而 bug 那則要他**停手找工程師** —— 再按幾次都一樣。
  [CORRECTION_STALE_RESULT_CODE]: {
    text: '沒有改到 —— 這一筆的判定在你送出之前已經被人改過了。請重新整理看現在的判定是什麼,再決定要不要改。',
    tone: 'warn',
  },
  [CORRECTION_NOT_APPLICABLE_RESULT_CODE]: {
    text: '這一筆不是「人工判定失敗」的列,這個入口改不了它。',
    tone: 'warn',
  },
  [CORRECTION_INVALID_RESULT_CODE]: {
    text: '沒有送出 —— 填的內容不合規(理由必填、不能只有空白,且不超過 500 字)。改一下再送。',
    tone: 'warn',
  },
  [CORRECTION_DENIED_RESULT_CODE]: {
    text: '沒有權限做這個動作。',
    tone: 'error',
  },
  // 🔴 **不得寫「請稍後再試」** —— 這一族是我們這一側出事,重試不會好。
  //    寫成可重試 ⇒ 員工會對著一個 bug 一直按,而每一次都拿到同一句話。
  [CORRECTION_BUG_RESULT_CODE]: {
    text: '沒有改到,而這不是你填錯 —— 系統這一側出了問題。請不要重試,直接聯絡工程師處理。',
    tone: 'error',
  },
  // 🔴 M-4b E10 A10b:採購同樣**只有成功**會走 redirect(失敗回 action state、保留輸入)。
  //    三個成功碼**刻意不共用一則** —— 員工要看得出「這次到底有沒有改到東西」:
  //    `NO_CHANGE` 意謂「送出的內容與現況完全相同、零寫入」(A5a `:300-322`),
  //    若與「已更新」說同一句話,他會以為改成功了而不再檢查。
  [PROCUREMENT_CREATED_RESULT_CODE]: { text: '採購加好了。', tone: 'ok' },
  [PROCUREMENT_UPDATED_RESULT_CODE]: { text: '採購改好了。', tone: 'ok' },
  [PROCUREMENT_NO_CHANGE_RESULT_CODE]: {
    text: '沒有變更(送出的內容與目前的採購紀錄完全相同)。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 **#352-b**:到貨登錄同樣只有成功走 redirect(失敗回 action state、保留輸入)。
  //    🔴 **括號那半句不是贅字**:本片主打的出路是「到貨 0 件 / 溢收 N 件」(取消後到貨),
  //    那種登錄**不會讓採購列的「到貨」欄動一格** ⇒ 只寫「已登錄」的話,員工按完看到數字沒變,
  //    會以為沒成功而再按一次。一句話把「為什麼看起來沒變」講掉。
  [RECEIPT_RECORDED_RESULT_CODE]: {
    text: '到貨記好了(溢收的件數不計入「到貨」欄)。',
    tone: 'ok',
  },
  //    `DUPLICATE_REQUEST` **只有在產物仍在時**才走到這裡 —— 產物已被刪的那條回 action state
  //    的 `DUPLICATE_DELETED`(RPC 不重新建立 ⇒ 顯示成功會是謊)。兩者刻意不共用一則。
  [RECEIPT_DUPLICATE_RESULT_CODE]: {
    text: '這筆到貨先前登錄過了,沒有重複記帳。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 **#15-B2-c 片2**:手動收款登錄同樣只有成功走 redirect(失敗回 action state)。
  //    **兩碼刻意不共用一則**(主視窗裁 Q-D6=A):「剛記好」與「先前已登錄過」是不同事實,
  //    講成同一句會讓員工分不出這次到底有沒有真的寫進去。
  //    🔴 **不加回讀核對**(對照 `order_cancelled` 那段的立場):偽造 `?r=` 的綠字會被**同一張卡**
  //    下面的真實收款明細當場打臉(H6② 保證兩者同掛)—— 取消線當年沒有那個對照物,這裡有。
  [PAYMENT_RECORDED_RESULT_CODE]: { text: '收款記好了。', tone: 'ok' },
  [PAYMENT_DUPLICATE_RESULT_CODE]: {
    text: '這筆收款先前登錄過了,沒有重複入帳。',
    tone: 'ok',
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

export function ResultBanner({ code }: { code: string | undefined }) {
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
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE[msg.tone]}`} role='status'>
      {msg.text}
    </div>
  );
}
