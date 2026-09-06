// manual-customer-create-request.ts — 「用這份收件人建客人」的**事件契約**
// (⟦b4-收件即建客⟧ 2026-09-06;plan `~/pcm-mailbox/plan-fable-建單頁兩件-20260906.md` §2)
//
// ══ 🔴 為什麼是事件, 而且是【表單範圍】的事件 ═══════════════════════════════════
// 收件那一塊(`manual-order-ship-to.tsx`)與客人那一塊(`manual-customer-picker.tsx`)
// 在版面上是**兄弟**, 沒有共同的父層可以掛 prop —— 而把 state 提到 form-body 是**不行的**:
// `manual-customer-picker.test.tsx` 有一道原始碼層守門逐字釘著
// 「表單本體不得持有任何 state」(它連負對照都寫好了)。
//
// 🔵 **同一片場地已經有一個 `window` 事件**(`manual-order-line-seed.ts`), 而這裡**不抄它**:
//    那一支的收訊者是**畫面上唯一一份清單**, 誰收到都一樣;
//    這一支會**在伺服器上建一個真的帳號** ⇒ 收訊者是誰要說得出來。
//    ⇒ 走 `form.dispatchEvent(...)` —— 射程就是這張表單。
//
// 🔬 **⛔ ~~`bubbles: true`~~ 拿掉了, 而理由是量到的不是讀碼推的**(2026-09-06):
//    plan §4 列的突變是「拿掉 `bubbles: true` ⇒ 驗收 A 紅」。實跑 ⇒ **68 passed, 一格都沒紅。**
//    去看為什麼:派發端拿的是 `fieldset.form`、收訊端掛的**也是** `fieldset.form`
//    ⇒ **target 與 listener host 是同一個元素** ⇒ 事件根本沒有「往上冒」這一段。
//    ⇒ 📌 它不是「保險」, 是**零判別力的死重** —— 留著會讓下一個人以為冒泡是承重的。
//    ⚠️ 而這也是一句射程限定:**要改成派發在別的元素上(例如 ship-to 自己的 fieldset), 就得把它加回來。**
//
// ══ 🔴🔴 `cancelable: true` 是承重的, 不是順手加的 ═══════════════════════════════
// `manual-order-ship-to.tsx:57` 檔頭自己記著一句血:
//   **「一顆『按了沒反應』的鈕, 與一顆『按了但我看不出來』的鈕, 在畫面上長一樣。」**
// ⇒ 派發端**不准假設有人在聽**。picker 收下時呼叫 `preventDefault()`,
//   於是 `dispatchEvent` 回 `false` ⇒ 派發端**量得到「真的有人接手」**。
// 🛑 沒有這一道的話:picker 沒掛上(渲染在表單外 / 事件名打錯 / 未來有人拆檔)
//   ⇒ 鈕照樣說「已送去建客人」, 而**什麼都沒發生**, 零訊號。

/** 事件名。表單範圍、可取消。 */
export const MANUAL_CUSTOMER_CREATE_REQUEST_EVENT = 'pcm:manual-customer-create';

/**
 * 要拿去建客人的那兩格。
 * 🔴 **原樣帶過去, 這裡不做正規化、不做長度檢查** —— 修剪與門檻在
 * `manual-customer-actions.ts:275-281`(`normalizeManualPhone` + `MIN_PHONE_DIGITS`),
 * 在這裡再做一次就是**第二套規則**, 而兩套規則遲早會不一樣。
 */
export type ManualCustomerCreateRequest = { name: string; phone: string };

/**
 * 往這張表單丟一次「請用這兩格建客人」。
 *
 * @returns `true` = **有人接手了**(picker 掛在這張表單上並收下);
 *          `false` = 沒有人在聽 ⇒ 呼叫端**必須說實話**, 不得回報成功。
 */
export function requestManualCustomerCreate(
  form: HTMLFormElement | null | undefined,
  detail: ManualCustomerCreateRequest,
): boolean {
  if (!form) return false;
  // 🔴 `dispatchEvent` 在 `preventDefault()` 被呼叫時回 `false` ⇒ 這裡**反過來**才是「有人接手」。
  return !form.dispatchEvent(
    new CustomEvent<ManualCustomerCreateRequest>(MANUAL_CUSTOMER_CREATE_REQUEST_EVENT, {
      detail,
      cancelable: true,
    }),
  );
}
