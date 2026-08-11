// 相對 import(非 @/):vitest 的 `@` alias 指向 storefront(見 `lib/session/actor.ts` 註解)
// ⇒ 用 `@/` 會讓本元件在測試環境解析失敗。
import { NOTE_ADDED_RESULT_CODE } from '../../lib/orders/note-action-state';
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
import {
  REFUND_MARKED_FAILED_RESULT_CODE,
  REFUND_RECOVERED_RESULT_CODE,
} from '../../lib/payment/refund-recovery-state';
import {
  FAILURE_MESSAGES as CANCEL_FAILURE_MESSAGES,
  toOrderCancelResultCode,
} from '../../lib/orders/cancel-action-state';

// result-banner.tsx — 改單 PRG 結果提示(M-4a Slice C;server action redirect 帶 ?r=<code> 後顯示)。
// server-render;code 由頁面從 searchParams.r 讀入。未知/缺 → 不顯示。

// 🔴 **匯出是為了讓「零碰撞」那道守門有判別力**(A13b D1 code-review must-fix):
//    測試原本拿一份**硬寫的既有碼快照**(只有改單線那 7 顆)去比對,而本表實際有 16 顆鍵
//    ⇒ 快照漏掉的那 7 顆(備註 1 + 退款 3 + 採購 3)就算被撞上也照樣綠。改成由測試讀本表的鍵集合、逐顆歸類,
//    **新增任何一顆沒被歸類的碼都會轉紅** —— 那時要做的是去測試裡把它歸到對的線,不是放寬斷言。
export const MESSAGES: Readonly<Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }>> =
  Object.freeze({
  saved: { text: '已儲存變更。', tone: 'ok' },
  noop: { text: '沒有變更(內容與原本相同)。', tone: 'ok' },
  conflict: { text: '這張單在你編輯期間被改過了,已重新載入最新狀態,請確認後再存一次。', tone: 'warn' },
  invalid: { text: '表單內容不正確,未儲存。', tone: 'warn' },
  denied: { text: '沒有權限或登入狀態已失效,未儲存。', tone: 'error' },
  not_found: { text: '找不到對象資料(可能已被移除),未儲存。', tone: 'warn' },
  error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
  // 🔴 M-4b E10 A9d2-1:備註**只有成功**會走 redirect 到這裡 —— 失敗一律回 action state
  //    (Sean 拍板 Q1=A:保留員工打的內容)⇒ 這裡**不該**出現 note 的任何失敗碼。
  //    `APPENDED` 與 `DUPLICATE_REQUEST` **共用這一則**:後者意謂「這個請求已寫入過且經查驗」,
  //    對員工就是同一件事(母 plan v4 §5 F3:顯示成別的會誘發他換一把 token 重送 = 製造重複備註)。
  [NOTE_ADDED_RESULT_CODE]: { text: '備註已新增。', tone: 'ok' },
  // 🔴 M-3 RW2c:退款也只有成功走 redirect(失敗全回 action state,同備註片 Q1=A 慣例)。
  //    措辭鐵律:confirmed = TapPay **受理** ≠ 已入帳(入帳以對帳為準;plan §3 第一列)。
  //    `DUPLICATE_REQUEST`(前次已 confirmed)共用本則 —— 對員工是同一件事。
  [REFUND_SUBMITTED_RESULT_CODE]: {
    text: '退款已送出,TapPay 已受理。受理不等於已入帳,入帳以之後的對帳為準。',
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
  // 🔴 M-4b E10 A10b:採購同樣**只有成功**會走 redirect(失敗回 action state、保留輸入)。
  //    三個成功碼**刻意不共用一則** —— 員工要看得出「這次到底有沒有改到東西」:
  //    `NO_CHANGE` 意謂「送出的內容與現況完全相同、零寫入」(A5a `:300-322`),
  //    若與「已更新」說同一句話,他會以為改成功了而不再檢查。
  [PROCUREMENT_CREATED_RESULT_CODE]: { text: '已新增這筆採購。', tone: 'ok' },
  [PROCUREMENT_UPDATED_RESULT_CODE]: { text: '已更新這筆採購。', tone: 'ok' },
  [PROCUREMENT_NO_CHANGE_RESULT_CODE]: {
    text: '沒有變更(送出的內容與目前的採購紀錄完全相同)。',
    tone: 'ok',
  },
  // 🔴 M-4b E10 **#352-b**:到貨登錄同樣只有成功走 redirect(失敗回 action state、保留輸入)。
  //    🔴 **括號那半句不是贅字**:本片主打的出路是「到貨 0 件 / 溢收 N 件」(取消後到貨),
  //    那種登錄**不會讓採購列的「到貨」欄動一格** ⇒ 只寫「已登錄」的話,員工按完看到數字沒變,
  //    會以為沒成功而再按一次。一句話把「為什麼看起來沒變」講掉。
  [RECEIPT_RECORDED_RESULT_CODE]: {
    text: '已登錄這筆到貨(溢收的件數不計入「到貨」欄)。',
    tone: 'ok',
  },
  //    `DUPLICATE_REQUEST` **只有在產物仍在時**才走到這裡 —— 產物已被刪的那條回 action state
  //    的 `DUPLICATE_DELETED`(RPC 不重新建立 ⇒ 顯示成功會是謊)。兩者刻意不共用一則。
  [RECEIPT_DUPLICATE_RESULT_CODE]: {
    text: '這筆到貨先前已經登錄過了,沒有重複記帳。',
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
